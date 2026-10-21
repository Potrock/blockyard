import { baseX, centre, HEX, SEA_Y, tileAt } from './geometry';
import { neighbours, rowOf, within, type Grid } from './rules/hex';
import type { Tile } from './rules/state';
import { EVERGREEN, PLANT_BLOCKS, SNOWY, terrainEdits, TREE_BLOCKS, type Edit } from './terrain';

/**
 * The seasons and the world's changes in blocks, for the server (`server.ts`). In autumn the woods
 * turn red and gold; in winter snow lies on the hills, the mountains and the tundra, and on the trees
 * (none in the tropics): each screen shows the season's looks of the blocks that have them
 * (`shared.ts`), and the world is built with twins where they shouldn't turn or should (`terrain.ts`'
 * `EVERGREEN`, `SNOWY`), so nothing in the world changes as the seasons turn. Where the world itself changes a tile (the sea over it, an
 * eruption's ash, a flood's silt), its columns are built again from the map as it is now
 * (`reshapeEdits`).
 */

/** How far a tile is toward a pole (0 at the equator, 1 at a pole). */
const latitude = (g: Grid, t: number) => Math.abs(((rowOf(g, t) + 0.5) / g.height) * 2 - 1);

/** Snow in winter for a tile: hills, mountains and the tundra, away from the tropics (not a natural wonder's own). */
const snowy = (g: Grid, tile: Tile, t: number) => !tile.wonder && latitude(g, t) > 0.3 && (tile.elevation !== 'flat' || tile.terrain === 'tundra');

/**
 * The world's blocks as built (`terrainEdits`', whole columns) made to turn with the seasons only
 * where they do, in place: the woods' leaves in the tropics and on a natural wonder's tile as those
 * that never turn (`EVERGREEN`), and the top of each snowy tile's column (its last block set at its
 * highest, trees and plants aside: what `Ground` has as its top) as its twin that snow lies on (`SNOWY`).
 */
export function seasonalBlocks(g: Grid, tiles: Tile[], edits: Edit[]): Edit[] {
  const tops = new Map<string, number>();
  for (let i = 0; i < edits.length; i++) {
    const [x, y, z, block] = edits[i];
    if (block === 'civ_leaves') {
      const t = tileAt(g, x + 0.5, z + 0.5);
      if (t < 0 || tiles[t].wonder || latitude(g, t) <= 0.3) edits[i][3] = EVERGREEN;
      continue;
    }
    if (y < SEA_Y || TREE_BLOCKS.has(block) || PLANT_BLOCKS.has(block)) continue;
    const key = `${x},${z}`;
    const top = tops.get(key);
    if (top === undefined || y >= edits[top][1]) tops.set(key, i);
  }
  for (const i of tops.values()) {
    const [x, , z, block] = edits[i];
    if (!SNOWY[block]) continue;
    const t = tileAt(g, x + 0.5, z + 0.5);
    if (t >= 0 && snowy(g, tiles[t], t)) edits[i][3] = SNOWY[block];
  }
  return edits;
}

/** The columns (as built: `baseX`) of a set of tiles, keyed `x,z`. */
function columnsOf(g: Grid, ts: Set<number>): Set<string> {
  const out = new Set<string>();
  for (const t of ts) {
    const c = centre(g, t);
    for (let x = Math.floor(c.x - HEX - 1); x <= c.x + HEX + 1; x++)
      for (let z = Math.floor(c.z - HEX - 1); z <= c.z + HEX + 1; z++) if (tileAt(g, x + 0.5, z + 0.5) === t) out.add(`${baseX(g, x)},${z}`);
  }
  return out;
}

/**
 * How far round the tiles built again the map is worked out (`terrainEdits`' `only`) for their columns
 * to come out as the whole map's would: a river's channel runs into the tiles beside its own, and is
 * laid out by the land of those; a bank, a tree or a dune on a column depends on the channels next
 * to it; and a tree beside a tile spreads its leaves over it.
 */
const RESHAPE_REACH = 4;

/**
 * The blocks that build changed tiles again (and the river land next to them, whose channels run to
 * them), from the map as it is now: each of their columns cleared down to the sea (open water over
 * the sea's floor), then its blocks as the map has them (`built`: the map's blocks in those columns,
 * worked out from the land round them alone). The tiles built again come back with them, for their
 * improvements to be set again, and their columns (keyed `x,z`).
 */
export function reshapeEdits(g: Grid, tiles: Tile[], changed: number[]): { edits: Edit[]; built: Edit[]; tiles: number[]; columns: Set<string> } {
  const ts = new Set(changed);
  for (const t of changed) for (const n of neighbours(g, t)) if (tiles[n].river) ts.add(n);
  const cols = columnsOf(g, ts);
  const out: Edit[] = [];
  for (const key of cols) {
    const [x, z] = key.split(',').map(Number);
    out.push([x, SEA_Y - 1, z, 'civ_ocean_floor'], [x, SEA_Y, z, 'water']);
    for (let y = SEA_Y + 1; y <= SEA_Y + 16; y++) out.push([x, y, z, 'air']);
  }
  const near = new Set([...ts].flatMap((t) => within(g, t, RESHAPE_REACH)));
  const built = seasonalBlocks(g, tiles, terrainEdits(g, tiles, near).filter((e) => cols.has(`${e[0]},${e[2]}`)));
  for (const e of built) out.push(e);
  return { edits: out, built, tiles: [...ts], columns: cols };
}
