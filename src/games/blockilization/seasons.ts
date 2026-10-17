import { baseX, centre, HEX, SEA_Y, tileAt } from './geometry';
import type { Ground } from './improvements';
import { neighbours, rowOf, type Grid } from './rules/hex';
import type { Season } from './rules/disasters';
import type { Tile } from './rules/state';
import type { Edit } from './terrain';

/**
 * The seasons and the world's changes in blocks, for the server (`server.ts`): in autumn the woods
 * turn red and gold; in winter snow lies on the hills, the mountains and the tundra, and on the trees
 * (none in the tropics). The blocks that change are found once from the map as it's built (each
 * column's top, and the trees' leaves) and swapped as the seasons turn, a few thousand a tick. And
 * where the world itself changes a tile (the sea over it, an eruption's ash, a flood's silt), its
 * columns are built again from the map as it is now (`reshapeEdits`).
 */

/** What each block becomes in a season (the rest stay as they are). */
const SEASONAL: Partial<Record<Season, Record<string, string>>> = {
  autumn: { civ_leaves: 'civ_leaves_autumn' },
  winter: {
    civ_leaves: 'civ_leaves_snow',
    civ_pine: 'civ_pine_snow',
    civ_grass: 'civ_frost',
    civ_plains: 'civ_frost',
    civ_tundra: 'civ_frost',
    civ_rock: 'civ_frost',
    civ_bank: 'civ_frost',
    civ_loam: 'civ_frost',
  },
};

/** Every block's look in a season (a block of the year's own: what it is the rest of the year). */
export function seasonal(block: string, season: Season | null): string {
  return (season && SEASONAL[season]?.[block]) ?? block;
}

/** The blocks that can change with the seasons. */
const CHANGING = new Set(Object.values(SEASONAL).flatMap((m) => Object.keys(m!)));

/** How far a tile is toward a pole (0 at the equator, 1 at a pole). */
const latitude = (g: Grid, t: number) => Math.abs(((rowOf(g, t) + 0.5) / g.height) * 2 - 1);

/** Snow in winter for a tile: hills, mountains and the tundra, away from the tropics (not a natural wonder's own). */
const snowy = (g: Grid, tile: Tile, t: number) => !tile.wonder && latitude(g, t) > 0.3 && (tile.elevation !== 'flat' || tile.terrain === 'tundra');

/**
 * The blocks the seasons change, from the world's blocks as built (before any season's look):
 * the tops of the snowy tiles' columns (`ground`'s), and the leaves of the trees out of the tropics.
 */
export function seasonalSpots(g: Grid, tiles: Tile[], edits: Edit[], ground: Ground): Edit[] {
  const out: Edit[] = [];
  for (const [x, y, z, block] of edits) {
    if (block !== 'civ_leaves' && block !== 'civ_pine') continue;
    const t = tileAt(g, x + 0.5, z + 0.5);
    if (t >= 0 && !tiles[t].wonder && latitude(g, t) > 0.3) out.push([x, y, z, block]);
  }
  for (let x = 0; x < ground.width; x++)
    for (let z = 0; z < ground.depth; z++) {
      const top = ground.at(x, z);
      if (!top || !CHANGING.has(top.block)) continue;
      const t = tileAt(g, x + 0.5, z + 0.5);
      if (t >= 0 && snowy(g, tiles[t], t)) out.push([x, top.y, z, top.block]);
    }
  return out;
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
 * The blocks that build changed tiles again (and the river land next to them, whose channels run to
 * them), from `edits` (the whole map's, as it is now): each of their columns cleared down to the sea
 * (open water over the sea's floor), then its blocks as the map has them. The tiles built again come
 * back with them, for their improvements to be set again.
 */
export function reshapeEdits(g: Grid, tiles: Tile[], changed: number[], edits: Edit[]): { edits: Edit[]; tiles: number[] } {
  const ts = new Set(changed);
  for (const t of changed) for (const n of neighbours(g, t)) if (tiles[n].river) ts.add(n);
  const cols = columnsOf(g, ts);
  const out: Edit[] = [];
  for (const key of cols) {
    const [x, z] = key.split(',').map(Number);
    out.push([x, SEA_Y - 1, z, 'civ_ocean_floor'], [x, SEA_Y, z, 'water']);
    for (let y = SEA_Y + 1; y <= SEA_Y + 16; y++) out.push([x, y, z, 'air']);
  }
  for (const e of edits) if (cols.has(`${e[0]},${e[2]}`)) out.push(e);
  return { edits: out, tiles: [...ts] };
}
