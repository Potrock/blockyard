import { Blueprint } from '@platform';
import type { BiomeId } from '../species';
import { FALLS } from './map';

/**
 * Places worth walking to: old stones, wrecks and strange growths set down by hand, each built by
 * code as a blueprint the generator stamps into the land (so they're there from the first frame,
 * on the server and every screen). `LANDMARKS` says where each is, for the map, for the game's
 * other parts (loot, lairs, quests) and for the test.
 */

export type LandmarkKind = 'wreck' | 'ruin' | 'stones' | 'skeleton' | 'arch' | 'temple' | 'tree' | 'log' | 'cave' | 'springs' | 'spires' | 'lighthouse' | 'falls';

export interface Landmark {
  id: string;
  name: string;
  kind: LandmarkKind;
  biome: BiomeId;
  /** Its middle, and the y of the ground there (the top solid block; a waterfall's: the water above the drop). */
  x: number;
  y: number;
  z: number;
  /** How far it reaches from its middle: within this, a visitor has found it. */
  radius: number;
  /** A place inside it for something to be kept or to lurk: open air to stand in. */
  spot: { x: number; y: number; z: number };
}

/** A whole number from three, the same every time: which stone is mossy, which rib is broken. */
function hash(x: number, y: number, z: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A blueprint written in steps from the landmark's middle on the ground. */
class Site {
  readonly bp: Blueprint;
  constructor(
    readonly cx: number,
    readonly g: number,
    readonly cz: number,
    r: number,
    down: number,
    up: number,
  ) {
    this.bp = Blueprint.centered(cx, cz, r, g - down, g + up);
  }
  set(dx: number, dy: number, dz: number, block: string): void {
    this.bp.set(this.cx + dx, this.g + dy, this.cz + dz, block);
  }
  /** A column from `y0` up to `y1`. */
  col(dx: number, dz: number, y0: number, y1: number, block: string | ((y: number) => string)): void {
    for (let y = y0; y <= y1; y++) this.set(dx, y, dz, typeof block === 'string' ? block : block(y));
  }
  hash(dx: number, dy: number, dz: number): number {
    return hash(this.cx + dx, this.g + dy, this.cz + dz);
  }
}

/** Old masonry: mostly brick, some of it fallen to cobble and moss. */
const masonry = (s: Site, dx: number, dy: number, dz: number, moss = 0.3) => {
  const r = s.hash(dx, dy, dz);
  return r < moss ? 'mossy_cobblestone' : r < moss + 0.2 ? 'cobblestone' : 'stone_bricks';
};

/** A ship broken on the shallows: the bow whole, the stern open ribs, the mast snapped. */
function wreck(cx: number, cz: number): Blueprint {
  const s = new Site(cx, 63, cz, 19, 7, 14);
  for (let i = -14; i <= 14; i++) {
    const w = Math.round(4.4 * (1 - (Math.abs(i) / 14.5) ** 2.4));
    const stern = i < -2;
    for (let j = -w; j <= w; j++) {
      // The hull's belly, heeled over to one side.
      const tilt = Math.round(j * 0.3);
      const bottom = -5 + Math.round((Math.abs(j) / Math.max(1, w)) ** 2 * 3) + tilt;
      const rib = !stern || ((i % 3 + 3) % 3 === 0);
      const gone = stern && s.hash(i, 0, j) < 0.45;
      if (rib && !(gone && Math.abs(j) < w)) s.set(i, bottom, j, j === 0 ? 'oak_log' : 'oak_planks');
      if (j === 0) s.set(i, bottom, j, 'oak_log');
      if (Math.abs(j) === w && rib) s.col(i, j, bottom, (stern ? -1 - Math.round(s.hash(i, 1, j) * 2) : 1) + tilt, stern ? 'oak_log' : (i + j) % 4 === 0 ? 'spruce_planks' : 'oak_planks');
      // The deck: what's left of it forward.
      if (!stern && Math.abs(j) < w && s.hash(i, 2, j) > 0.12) s.set(i, 0 + tilt, j, 'birch_planks');
    }
  }
  // The mast, snapped; its top lies across the bow. A bowsprit, and a chest of the hold's planks.
  for (let y = 1; y <= 8; y++) s.set(3 + Math.round(y * 0.2), y, Math.round(y * 0.25), 'oak_log');
  for (let k = 0; k <= 7; k++) s.set(6 + k, 3 + Math.round(k * 0.3), 3 + Math.round(k * 0.7), 'oak_log');
  for (let k = 0; k <= 4; k++) s.set(14 + k, 1 + Math.round(k * 0.5), 0, 'oak_log');
  s.set(8, 1, -1, 'bookshelf');
  return s.bp;
}

/** A watchtower's stump on its hill, the ring wall round it mostly down. */
function ruin(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 16, 1, 14);
  s.bp.columns(cx, cz, 15.5, (x, z, d, a) => {
    const [dx, dz] = [x - cx, z - cz];
    if (d < 4.6) s.set(dx, 0, dz, masonry(s, dx, 0, dz, 0.45));
    // The tower: highest to the north-west, down to a few courses elsewhere; a door to the south.
    if (d >= 4.6 && d < 6) {
      const top = Math.round(6 + 5 * Math.cos(a + 2.2) + 2 * s.hash(dx, 9, dz));
      const door = Math.abs(dx) <= 1 && dz > 0;
      for (let y = 0; y <= top; y++) if (!(door && y >= 1 && y <= 3) && !(y > 2 && y % 4 === 2 && s.hash(dx, y, dz) < 0.3)) s.set(dx, y, dz, masonry(s, dx, y, dz));
    }
    // The yard's wall, in stretches.
    if (d >= 13.5 && d < 15) {
      const stretch = Math.sin(a * 3 + 1) + 0.5 * Math.sin(a * 7);
      const top = Math.round(stretch * 2.2 + s.hash(dx, 7, dz));
      for (let y = 1; y <= top; y++) s.set(dx, y, dz, masonry(s, dx, y, dz, 0.5));
    }
    // Fallen stone in the yard.
    if (d >= 6.5 && d < 13 && s.hash(dx, 5, dz) < 0.035) s.set(dx, 1, dz, s.hash(dx, 6, dz) < 0.5 ? 'cobblestone' : 'mossy_cobblestone');
  });
  // A stair's first turns inside, and the hearth.
  for (let k = 0; k < 7; k++) {
    const a = k * 0.55 + 0.4;
    s.col(Math.round(Math.cos(a) * 3.4), Math.round(Math.sin(a) * 3.4), 1, 1 + k, 'cobblestone');
  }
  s.set(0, 1, -3, 'bricks');
  return s.bp;
}

/** Nine standing stones in a ring, two pairs still carrying their lintels, an altar in the middle. */
function stones(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 15, 1, 10);
  const tops: number[] = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + 0.2;
    const [px, pz] = [Math.round(Math.cos(a) * 11.5), Math.round(Math.sin(a) * 11.5)];
    const top = 5 + Math.floor(s.hash(k, 1, 0) * 3);
    tops.push(top);
    const fallen = k === 4;
    for (let ox = 0; ox <= 1; ox++)
      for (let oz = 0; oz <= 1; oz++) {
        if (fallen) continue;
        s.col(px + ox, pz + oz, 0, top - (ox && oz && s.hash(k, 2, 0) < 0.5 ? 1 : 0), (y) => (y <= 1 && s.hash(px + ox, y, pz + oz) < 0.6 ? 'mossy_cobblestone' : 'andesite'));
      }
    // The fallen one lies outward on the grass.
    if (fallen) for (let t = 0; t < 6; t++) for (let o = 0; o <= 1; o++) s.set(px + Math.round(Math.cos(a) * t) + o, 1, pz + Math.round(Math.sin(a) * t), 'andesite');
  }
  for (const k of [0, 6]) {
    const [a0, a1] = [(k / 9) * Math.PI * 2 + 0.2, ((k + 1) / 9) * Math.PI * 2 + 0.2];
    const top = Math.min(tops[k], tops[k + 1]) + 1;
    for (let t = 0; t <= 10; t++) {
      const a = a0 + ((a1 - a0) * t) / 10;
      for (let o = 0; o <= 1; o++) s.set(Math.round(Math.cos(a) * 11.5) + o, top, Math.round(Math.sin(a) * 11.5) + o, 'andesite');
    }
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) s.set(dx, 1, dz, dx === 0 && dz === 0 ? 'diorite' : 'andesite');
  s.bp.columns(cx, cz, 4.5, (x, z, d) => {
    if (d > 2) s.set(x - cx, 0, z - cz, s.hash(x - cx, 0, z - cz) < 0.5 ? 'gravel' : 'cobblestone');
  });
  return s.bp;
}

/** The bones of something vast, half in the red sand: a spine, a cage of ribs, a skull. */
function skeleton(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 30, 1, 14);
  // The spine, head to the east, sagging in the middle, the tail curling.
  for (let i = -28; i <= 16; i++) {
    const y = 1 + Math.round(2.5 * Math.cos((i + 6) / 14) ** 2) + (i < -20 ? 0 : 1);
    const z = i < -14 ? Math.round(((i + 14) / 5) ** 2) : 0;
    s.set(i, y, z, 'white_concrete');
    if (i > -18) s.set(i, y - 1, z, 'white_concrete');
    // Ribs: every third joint, a hoop down each side into the sand.
    if (i >= -12 && i <= 10 && ((i % 3) + 3) % 3 === 0) {
      const r = 6.5 - Math.abs(i + 1) * 0.28;
      const broken = s.hash(i, 0, 0) < 0.25;
      for (let t = 0; t <= 16; t++) {
        const a = (t / 16) * Math.PI * 0.62;
        const [oz, oy] = [Math.round(Math.sin(a) * r), Math.round(y - (1 - Math.cos(a)) * r * 1.1)];
        if (oy < 0) break;
        s.set(i, oy, oz, 'white_concrete');
        if (!(broken && t > 7)) s.set(i, oy, -oz, 'white_concrete');
      }
    }
  }
  // The skull: a long box with eye holes, the jaw dropped open on the ground.
  for (let dx = 17; dx <= 26; dx++)
    for (let dz = -3; dz <= 3; dz++)
      for (let dy = 2; dy <= 7; dy++) {
        const taper = dx > 22 ? Math.abs(dz) <= 2 && dy <= 6 : true;
        const shell = dx === 17 || dx === 26 || Math.abs(dz) === (dx > 22 ? 2 : 3) || dy === 2 || dy === (dx > 22 ? 6 : 7);
        const eye = dx >= 19 && dx <= 20 && dy >= 4 && dy <= 5 && Math.abs(dz) === 3;
        const nose = dx === 26 && Math.abs(dz) <= 1 && dy >= 4;
        if (taper && shell && !eye && !nose) s.set(dx, dy, dz, 'white_concrete');
      }
  for (let dx = 18; dx <= 27; dx++) for (const dz of [-2, 2]) s.set(dx, dx > 24 ? 1 : 0, dz, 'white_concrete');
  for (let dx = 20; dx <= 26; dx += 2) for (const dz of [-2, 2]) s.set(dx, 1, dz, 'white_concrete');
  for (let dz = -2; dz <= 2; dz++) s.set(27, 1, dz, 'white_concrete');
  return s.bp;
}

const STRATA = ['mesa_red', 'mesa_red', 'mesa_tan', 'mesa_red', 'sandstone', 'mesa_red', 'mesa_tan', 'granite'];

/** A fin of banded rock with the wind's hole worn through it: walk under the span. */
function arch(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 22, 1, 28);
  for (let dx = -21; dx <= 21; dx++)
    for (let dz = -6; dz <= 6; dz++)
      for (let dy = 0; dy <= 27; dy++) {
        const lump = s.hash(dx >> 1, dy >> 1, dz >> 1) * 1.6;
        // The fin: tall in the middle, thick at the foot, thin at the crest.
        const crest = 25 - (Math.abs(dx) / 21) ** 2.2 * 16 + lump;
        const thick = 5.2 - (dy / 27) * 3 + lump * 0.6 - (Math.abs(dx) > 17 ? (Math.abs(dx) - 17) * 0.8 : 0);
        if (dy > crest || Math.abs(dz) > thick) continue;
        // The eye: a tall round hole, off centre.
        const [ex, ey] = [(dx - 2) / 9.5, (dy - 3) / 14.5];
        if (ex * ex + ey * ey < 1 + (lump - 0.8) * 0.08) continue;
        s.set(dx, dy, dz, STRATA[Math.floor((dy + g + Math.round(lump)) / 2) % STRATA.length]);
      }
  return s.bp;
}

/** A stepped temple the jungle has taken back: four tiers, a stair up the south face, a shrine on top. */
function temple(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 14, 1, 16);
  for (let tier = 0; tier < 4; tier++) {
    const r = 12 - tier * 3;
    for (let dy = 1; dy <= 2; dy++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const y = tier * 2 + dy;
          const edge = Math.max(Math.abs(dx), Math.abs(dz)) === r;
          // Corners and edges crumble.
          if (edge && dy === 2 && s.hash(dx, y, dz) < 0.18) continue;
          s.set(dx, y, dz, masonry(s, dx, y, dz, 0.5));
        }
  }
  // The stair: a block a step, three wide, from the ground to the top.
  for (let k = 1; k <= 11; k++) for (let dx = -1; dx <= 1; dx++) s.col(dx, 15 - k, 1, Math.min(k, 8), (y) => (y === Math.min(k, 8) ? 'stone_bricks' : masonry(s, dx, y, 15 - k)));
  // The shrine: four posts, a roof, a light that never went out, and a way down into the dark.
  for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) s.col(px, pz, 9, 12, 'stone_bricks');
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (s.hash(dx, 13, dz) > 0.12) s.set(dx, 13, dz, masonry(s, dx, 13, dz, 0.6));
  s.set(0, 12, 0, 'glowstone');
  // A chamber inside the second tier, reached by a shaft from the top.
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = 3; dy <= 5; dy++) s.set(dx, dy, dz, 'air');
  for (let dy = 6; dy <= 8; dy++) s.set(0, dy, -1, 'air');
  s.set(2, 3, 2, 'glowstone');
  for (const [px, pz] of [[-3, -3], [3, -3], [-3, 3]]) s.set(px, 3, pz, 'gold_ore');
  return s.bp;
}

/** A dead tree bigger than any living one in the marsh, its boughs hung with pale lights. */
function lanternTree(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 14, 2, 30);
  for (let dy = -2; dy <= 24; dy++) {
    const r = dy < 3 ? 4.6 - dy * 0.45 : 3.3 - dy * 0.06;
    for (let dx = -5; dx <= 5; dx++)
      for (let dz = -5; dz <= 5; dz++) {
        const d = Math.hypot(dx, dz);
        // A hollow at the foot, open to the south.
        const hollow = dy >= 1 && dy <= 4 && d < 1.6;
        const door = dy >= 1 && dy <= 3 && dx === 0 && dz > 0;
        if (d <= r + (dy < 2 ? s.hash(dx, 0, dz) * 1.4 : 0) && !hollow && !door) s.set(dx, dy, dz, 'oak_log');
      }
  }
  // Boughs: out and up, each ending in a hanging light.
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9 + 0.3;
    const y0 = 11 + k * 2;
    const len = 6 + Math.floor(s.hash(k, 3, 0) * 5);
    for (let t = 2; t <= len; t++) {
      const [bx, bz, by] = [Math.round(Math.cos(a) * t), Math.round(Math.sin(a) * t), y0 + Math.round(t * 0.45)];
      s.set(bx, by, bz, 'oak_log');
      if (t === len) {
        s.set(bx, by - 1, bz, 'oak_log');
        s.set(bx, by - 2, bz, 'sea_lantern');
      }
    }
  }
  return s.bp;
}

/** A redwood that came down long ago: a hollow trunk to walk through, its roots in the air. */
function fallenTitan(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 32, 1, 14);
  for (let i = -30; i <= 28; i++) {
    const r = 4.6 - (i + 30) * 0.022;
    // Broken through in one place.
    if (i >= 6 && i <= 8) continue;
    for (let dy = 0; dy <= 10; dy++)
      for (let dz = -5; dz <= 5; dz++) {
        const d = Math.hypot(dy - 4, dz);
        if (d > r || d < r - 1.5) continue;
        // Rot has opened the upper side here and there.
        if (dy > 6 && s.hash(i >> 1, dy >> 1, dz >> 1) < 0.14) continue;
        s.set(i, dy, dz, s.hash(i, dy, dz) < 0.1 && dy < 3 ? 'mossy_cobblestone' : 'redwood_log');
      }
  }
  // The root plate at the west end.
  for (let dy = 0; dy <= 12; dy++)
    for (let dz = -7; dz <= 7; dz++) {
      const d = Math.hypot(dy - 4, dz);
      if (d < 7.6 && s.hash(0, dy, dz) < 0.75 - d * 0.05) s.set(-31, dy, dz, s.hash(1, dy, dz) < 0.3 ? 'dirt' : 'redwood_log');
    }
  return s.bp;
}

/** A hump of rock with a mouth in its south side and a chamber inside, its walls full of `ore`. */
function cave(cx: number, g: number, cz: number, shell: string, cap: string, ore: string, glow: boolean): Blueprint {
  const s = new Site(cx, g, cz, 16, 4, 13);
  for (let dx = -15; dx <= 15; dx++)
    for (let dz = -15; dz <= 15; dz++)
      for (let dy = -4; dy <= 12; dy++) {
        const lump = s.hash(dx >> 1, dy >> 1, dz >> 1);
        const out = (dx / 14) ** 2 + (dz / 14) ** 2 + (Math.max(0, dy) / (10 + lump * 2)) ** 2;
        if (out > 1 && dy > 0) continue;
        const inside = (dx / 9.5) ** 2 + (dz / 9.5) ** 2 + ((dy - 1) / 5.5) ** 2;
        // The mouth: a passage in from the south, a little crooked.
        const mouth = dz > 4 && Math.abs(dx - Math.round((dz - 9) * 0.3)) <= 1 + (dz > 11 ? 1 : 0) && dy >= 1 && dy <= 3;
        if (inside < 1 || mouth) {
          // Spikes of the ore stand on the floor and hang from the roof.
          const spike = s.hash(dx, 77, dz);
          const tall = spike < 0.07 ? 1 + Math.floor(s.hash(dx, 78, dz) * 3) : 0;
          const floor = -Math.floor(5.5 * Math.sqrt(Math.max(0, 1 - (dx / 9.5) ** 2 - (dz / 9.5) ** 2))) + 1;
          if (!mouth && tall && (dy < floor + tall || (spike < 0.03 && inside > 0.55 && dy > 2))) s.set(dx, dy, dz, ore);
          else s.set(dx, dy, dz, 'air');
          continue;
        }
        if (out > 1) continue;
        // The chamber's skin is thick with ore; the hump's own skin is the country's rock.
        const skin = inside < 1.5;
        const r = s.hash(dx, dy, dz);
        if (dy <= 0 && !skin) continue;
        s.set(dx, dy, dz, skin && r < 0.42 ? ore : skin && glow && r > 0.985 ? 'sea_lantern' : out > 0.8 && dy >= 4 ? cap : shell);
      }
  // Teeth in the mouth.
  for (const dx of [-2, 2]) s.col(dx + 1, 13, 1, 2, shell);
  return s.bp;
}

/** Pools of hot water stepping down the mountain's foot, rimmed with pale crust. */
function springs(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 17, 3, 3);
  const pools = [
    { x: 0, z: 0, r: 5.5 },
    { x: 8, z: 5, r: 4 },
    { x: -8, z: 3, r: 3.6 },
    { x: -2, z: -9, r: 4.4 },
    { x: 9, z: -6, r: 3 },
  ];
  s.bp.columns(cx, cz, 16.5, (x, z) => {
    const [dx, dz] = [x - cx, z - cz];
    let best = 99;
    for (const p of pools) best = Math.min(best, Math.hypot(dx - p.x, dz - p.z) - p.r - s.hash(dx, 3, dz) * 0.8);
    if (best < 0) {
      // The pool: water to the brim over a pale bed, deepest in the middle.
      const depth = best < -2.5 ? 2 : 1;
      s.set(dx, -depth, dz, best < -2.5 && s.hash(dx, 4, dz) < 0.2 ? 'sea_lantern' : 'diorite');
      for (let y = 1 - depth; y <= 0; y++) s.set(dx, y, dz, 'water');
    } else if (best < 1.3) {
      s.set(dx, 0, dz, 'diorite');
      if (s.hash(dx, 5, dz) < 0.3) s.set(dx, 1, dz, 'diorite');
    } else if (best < 3 && s.hash(dx, 6, dz) < 0.5) s.set(dx, 0, dz, s.hash(dx, 7, dz) < 0.5 ? 'andesite' : 'gravel');
  });
  return s.bp;
}

/** Spires in a ring round a pool or a greater spire: obsidian over lava, or ice. */
function spires(cx: number, g: number, cz: number, block: string, count: number, heart: 'lava' | 'spire'): Blueprint {
  const s = new Site(cx, g, cz, 16, 2, 26);
  const spire = (px: number, pz: number, h: number, r0: number) => {
    for (let dy = -1; dy <= h; dy++) {
      const r = r0 * (1 - dy / (h + 1)) ** 0.8;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (Math.hypot(dx, dz) <= r + s.hash(px + dx, dy, pz + dz) * 0.5) s.set(px + dx, dy, pz + dz, block);
    }
  };
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + 0.4;
    const d = 10 + s.hash(k, 1, 1) * 3;
    spire(Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d), 7 + Math.floor(s.hash(k, 2, 1) * 10), 1.6 + s.hash(k, 3, 1) * 1.2);
  }
  if (heart === 'spire') spire(0, 0, 22, 3);
  else
    s.bp.columns(cx, cz, 4.2, (x, z, d) => {
      s.set(x - cx, 0, z - cz, d < 3 ? 'lava' : block);
      s.set(x - cx, -1, z - cz, block);
      if (d < 3) s.set(x - cx, 1, z - cz, 'air');
    });
  return s.bp;
}

/** A lighthouse on its rock, the top of it gone but the lamp still alight. */
function lighthouse(cx: number, g: number, cz: number): Blueprint {
  const s = new Site(cx, g, cz, 6, 1, 22);
  s.bp.columns(cx, cz, 5.5, (x, z, d, a) => {
    const [dx, dz] = [x - cx, z - cz];
    if (d < 5.5) s.set(dx, 0, dz, 'cobblestone');
    for (let y = 1; y <= 18; y++) {
      const r = 4.4 - y * 0.09;
      const door = y <= 2 && dx === 0 && dz > 0;
      const top = 15 + Math.round(2.5 * Math.cos(a - 1));
      if (d <= r && d > r - 1.3 && !door && y <= top) s.set(dx, y, dz, Math.floor(y / 4) % 2 ? 'red_concrete' : 'white_concrete');
      // Floors every eight, with a hole for the ladder.
      if (d <= r - 1.3 && (y === 8 || y === 14) && !(dx === 1 && dz === 0)) s.set(dx, y, dz, 'oak_planks');
    }
  });
  s.set(0, 15, 0, 'sea_lantern');
  s.set(0, 16, 0, 'sea_lantern');
  return s.bp;
}

interface Built {
  mark: Landmark;
  blueprint?: Blueprint;
  /** The ground is levelled this far out under it. */
  level?: number;
}

const mark = (id: string, name: string, kind: LandmarkKind, biome: BiomeId, x: number, y: number, z: number, radius: number, spot: [number, number, number]): Landmark => ({
  id,
  name,
  kind,
  biome,
  x,
  y,
  z,
  radius,
  spot: { x: x + spot[0] + 0.5, y: y + spot[1], z: z + spot[2] + 0.5 },
});

/** Every landmark, with what builds it. Positions were picked on the finished map: level, dry ground of the right country. */
const BUILT: Built[] = [
  { mark: mark('wreck', 'The Wreck of the Windlass', 'wreck', 'beach', 92, 63, 2327, 24, [8, 1, 0]), blueprint: wreck(92, 2327) },
  { mark: mark('old_watch', 'The Old Watch', 'ruin', 'grassland', -226, 84, 1790, 20, [0, 1, 0]), blueprint: ruin(-226, 84, 1790), level: 18 },
  { mark: mark('nine_sisters', 'The Nine Sisters', 'stones', 'grassland', -182, 92, -170, 18, [0, 2, 2]), blueprint: stones(-182, 92, -170), level: 16 },
  { mark: mark('leviathan', "Leviathan's Rest", 'skeleton', 'badlands', 2190, 91, -220, 32, [21, 3, 0]), blueprint: skeleton(2190, 91, -220), level: 30 },
  { mark: mark('needles_eye', "The Needle's Eye", 'arch', 'badlands', 1442, 101, -900, 24, [2, 1, 0]), blueprint: arch(1442, 101, -900), level: 22 },
  { mark: mark('mossgate', 'Mossgate Temple', 'temple', 'jungle', 1692, 90, 952, 20, [0, 3, 0]), blueprint: temple(1692, 90, 952), level: 15 },
  { mark: mark('lantern_tree', 'The Lantern Tree', 'tree', 'swamp', -1380, 63, 1292, 18, [0, 1, 0]), blueprint: lanternTree(-1380, 63, 1292), level: 7 },
  { mark: mark('fallen_titan', 'The Fallen Titan', 'log', 'redwood', -1508, 105, -600, 34, [0, 3, 0]), blueprint: fallenTitan(-1508, 105, -600), level: 32 },
  { mark: mark('glimmer_hollow', 'Glimmer Hollow', 'cave', 'snow', -628, 110, -2060, 20, [0, -2, 0]), blueprint: cave(-628, 110, -2060, 'stone', 'snow_block', 'crystal_rock', true), level: 16 },
  { mark: mark('ironmaw', 'Ironmaw Cave', 'cave', 'mountain', -1016, 160, -1230, 20, [0, -2, 0]), blueprint: cave(-1016, 160, -1230, 'stone', 'gravel', 'metal_rock', false), level: 16 },
  { mark: mark('steamwell', 'Steamwell Springs', 'springs', 'volcano', 1650, 75, -1584, 20, [0, 1, 4]), blueprint: springs(1650, 75, -1584), level: 18 },
  { mark: mark('black_teeth', 'The Black Teeth', 'spires', 'volcano', 2340, 81, -1468, 18, [0, 1, 6]), blueprint: spires(2340, 81, -1468, 'obsidian_rock', 7, 'lava'), level: 15 },
  { mark: mark('ice_crown', 'The Ice Crown', 'spires', 'snow', -32, 94, -2252, 18, [0, 1, 6]), blueprint: spires(-32, 94, -2252, 'ice', 8, 'spire'), level: 15 },
  { mark: mark('pup_light', 'The Pups Light', 'lighthouse', 'grassland', -524, 70, 2878, 12, [0, 1, 0]), blueprint: lighthouse(-524, 70, 2878), level: 7 },
];

/** Waterfalls are the map's own (a river's level dropping at once); they need no blueprint. */
const FALL_LEVELS: Record<string, number> = { 'Thunder Drop': 108, 'Redwash Falls': 94, 'Mossrun Cascade': 82, 'Frostveil Falls': 125 };
const FALL_BIOME: Record<string, BiomeId> = { 'Thunder Drop': 'river', 'Redwash Falls': 'river', 'Mossrun Cascade': 'river', 'Frostveil Falls': 'river' };
for (const f of FALLS) {
  const id = f.name.toLowerCase().replace(/[^a-z]+/g, '_');
  BUILT.push({ mark: mark(id, f.name, 'falls', FALL_BIOME[f.name] ?? 'river', f.x, FALL_LEVELS[f.name] ?? 70, f.z, 28, [0, 1, 0]) });
}

/** The landmarks: where each is and what it is. */
export const LANDMARKS: Landmark[] = BUILT.map((b) => b.mark);

/** The landmark at (x, z), if that's within one's reach. */
export function landmarkAt(x: number, z: number): Landmark | null {
  for (const l of LANDMARKS) if ((x - l.x) ** 2 + (z - l.z) ** 2 <= l.radius * l.radius) return l;
  return null;
}

/** For the world's definition: the blueprints, and the ground levelled under each. */
export const STRUCTURES: Blueprint[] = BUILT.flatMap((b) => (b.blueprint ? [b.blueprint] : []));
export const TERRAFORM = BUILT.flatMap((b) => (b.level ? [{ x: b.mark.x, z: b.mark.z, radius: b.level, blend: 9, height: b.mark.y + 0.5 }] : []));
