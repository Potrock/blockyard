import { SEA_Y } from './geometry';

/**
 * The natural wonders in blocks (`rules/nature.ts`): each a landmark filling its tile (both, for
 * one of two), set in the world by the server with the rest of the map (`terrain.ts`) and drawn as
 * a picture for the screens (`client/landmarkart.ts`). Each makes its own ground (a crater's bowl, a
 * spring's pool, a reef's floor, scorched or mossy or frosted land that sets it off from the land
 * round it) and keeps to its tiles (only the Titan's Steps' last stones stand out in the sea, low),
 * and none stands taller than the highest mountains, so the cloud over unexplored land
 * (`client/fog.ts`) hides them as it hides the peaks. Made to read from the strategy camera, which
 * looks down from the south: falls, arches and lava face it. Their life (mist, sparks, glints,
 * birds) is the screens' (`client/naturefx.ts`).
 */

export type Put = (x: number, y: number, z: number, block: string) => void;

/** Where a landmark stands. */
export interface Site {
  /** Its tile's middle (blocks); of a pair, the land one's, or else the northern one's. */
  cx: number;
  cz: number;
  /** A pair's other tile's middle. */
  pair?: { cx: number; cz: number };
  /** The top block of the land round it (its terrain's). */
  cap: string;
  /** Whether a column is its own (either tile's). */
  own: (x: number, z: number) => boolean;
  /** Whether a column next to it is sea. */
  sea: (x: number, z: number) => boolean;
}

/** A column of the landmark: where it is, its offset and distance from the (first) tile's middle, and which tile it's in (1: a pair's other). */
interface Column {
  x: number;
  z: number;
  dx: number;
  dz: number;
  d: number;
  home: 0 | 1;
}

/** A column's own small random number (0..1), the same every time (`k`: another for the same column). */
function noise(x: number, z: number, k = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(k, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The tools each landmark is built with: its columns, and ways of setting blocks over the sea's level. */
function kit(s: Site, put: Put) {
  const columns: Column[] = [];
  const reach = s.pair ? 10 : 5;
  for (let x = Math.floor(s.cx - reach); x <= Math.ceil(s.cx + reach); x++)
    for (let z = Math.floor(s.cz - reach); z <= Math.ceil(s.cz + reach); z++) {
      if (!s.own(x, z)) continue;
      const dx = x + 0.5 - s.cx;
      const dz = z + 0.5 - s.cz;
      const d = Math.hypot(dx, dz);
      const home = s.pair && Math.hypot(x + 0.5 - s.pair.cx, z + 0.5 - s.pair.cz) < d ? 1 : 0;
      columns.push({ x, z, dx, dz, d, home });
    }
  /** A block `y` over the sea's surface. */
  const at = (x: number, y: number, z: number, block: string) => put(x, SEA_Y + y, z, block);
  /** A column from the sea's surface up to `h` (the top `cap`, the rest `under`). */
  const land = (c: { x: number; z: number }, h: number, cap: string, under = 'civ_dirt') => {
    for (let y = 0; y < h; y++) at(c.x, y, c.z, under);
    at(c.x, h, c.z, cap);
  };
  /** The column at a point off the middle. */
  const column = (ox: number, oz: number) => ({ x: Math.floor(s.cx + ox), z: Math.floor(s.cz + oz) });
  /** The columns round a point (in blocks off the middle) within a radius, the landmark's or not (at least the one it's in). */
  const near = (ox: number, oz: number, r: number) => {
    const out: { x: number; z: number; d: number }[] = [];
    for (let x = Math.floor(s.cx + ox - r - 1); x <= Math.ceil(s.cx + ox + r + 1); x++)
      for (let z = Math.floor(s.cz + oz - r - 1); z <= Math.ceil(s.cz + oz + r + 1); z++) {
        const d = Math.hypot(x + 0.5 - s.cx - ox, z + 0.5 - s.cz - oz);
        if (d < r) out.push({ x, z, d });
      }
    if (!out.length) out.push({ ...column(ox, oz), d: 0 });
    return out;
  };
  /** For a pair: a column's place along the way from the first tile to the other (0 at the edge they share, a tile's width on either side), and across it. */
  const axis = (c: { x: number; z: number }) => {
    const p = s.pair ?? { cx: s.cx, cz: s.cz + 1 };
    const len = Math.hypot(p.cx - s.cx, p.cz - s.cz) || 1;
    const ux = (p.cx - s.cx) / len;
    const uz = (p.cz - s.cz) / len;
    const rx = c.x + 0.5 - (s.cx + p.cx) / 2;
    const rz = c.z + 0.5 - (s.cz + p.cz) / 2;
    return { along: rx * ux + rz * uz, across: rx * -uz + rz * ux };
  };
  /** A little tree: a trunk and a crown of leaves, on ground `g` (its leaves only over the landmark's own ground). */
  const tree = (x: number, z: number, g: number, trunk: number, leaves: string) => {
    for (let y = 1; y <= trunk; y++) at(x, g + y, z, 'civ_trunk');
    const top = g + trunk + 1;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (s.own(x + dx, z + dz)) at(x + dx, top, z + dz, leaves);
    at(x, top + 1, z, leaves);
  };
  return { columns, at, land, near, column, axis, tree };
}

type Kit = ReturnType<typeof kit>;

/** Each landmark's building. */
const BUILDERS: Record<string, (s: Site, k: Kit) => void> = {
  /** A mound of pale scree filling its tile, and out of it a needle of banded stone, leaning a little, a cloud caught round its head. */
  sky_pillar(s, { columns, at, near }) {
    for (const c of columns) {
      const h = Math.max(1, Math.round(1 + 1.7 * (1 - c.d / 3.5) + noise(c.x, c.z) * 0.7));
      for (let y = 0; y < h; y++) at(c.x, y, c.z, 'civ_rock');
      at(c.x, h, c.z, noise(c.x, c.z, 1) < 0.3 ? 'civ_pale_band' : 'civ_pale');
      if (c.d > 2.2 && noise(c.x, c.z, 2) < 0.16) at(c.x, h + 1, c.z, 'civ_pale');
    }
    for (let k = 0; k < 11; k++) {
      const r = Math.max(0.6, 2.3 - k * 0.16);
      const lean = k * 0.06;
      near(lean, -lean * 0.4, r + 0.3)
        .sort((a, b) => a.d - b.d)
        .forEach((c, i) => {
          if (i === 0 || c.d < r + (noise(c.x, c.z, k) - 0.5) * 0.4) at(c.x, 3 + k, c.z, k % 3 === 2 ? 'civ_pale_band' : 'civ_pale');
        });
    }
    for (const y of [9, 10]) for (const c of near(0.6, -0.3, 3.4)) if (s.own(c.x, c.z) && c.d > 1.5 && noise(c.x, c.z, y) < 0.5) at(c.x, y, c.z, 'civ_mist');
  },

  /**
   * Two tiles: a mossy plateau on the first, a river across it to the edge they share, where it
   * falls, four streams wide, into a great turquoise pool filling the second (its mist is the screens').
   */
  emerald_falls(_, { columns, at, land, axis, tree }) {
    for (const c of columns) {
      const { along, across } = axis(c);
      if (c.home === 0) {
        // The plateau: rock faced with moss toward the falls, the river along its top.
        const h = Math.max(5, Math.round(10 - Math.max(0, c.d - 2.6) * 3));
        for (let y = 0; y < h; y++) at(c.x, y, c.z, along > -1.6 && noise(c.x, c.z, y) < 0.5 ? 'civ_moss' : 'civ_rock');
        const river = Math.abs(across) < 2.2;
        at(c.x, h, c.z, river ? 'water' : 'civ_moss');
        if (!river && Math.abs(across) > 2.6 && along < -2 && noise(c.x, c.z, 3) < 0.35) tree(c.x, c.z, h, 1, 'civ_jungle');
        else if (!river && noise(c.x, c.z, 4) < 0.3) at(c.x, h + 1, c.z, 'civ_jungle');
        continue;
      }
      // The pool, and lush land round it.
      if (along < 1.2 && Math.abs(across) < 2.4) {
        at(c.x, 0, c.z, 'civ_reef');
        at(c.x, 1, c.z, 'water');
        for (let y = Math.abs(across) < 1.8 ? 2 : 4; y <= 10; y++) at(c.x, y, c.z, 'civ_falls');
      } else if (along < 5 && Math.hypot(along - 2.6, across) < 2.7) {
        // (Turquoise under the water: the pool shines out of the woods.)
        at(c.x, 0, c.z, 'civ_reef');
        at(c.x, 1, c.z, noise(c.x, c.z, 5) < 0.06 ? 'civ_moss' : 'water');
      } else {
        land(c, 1, 'civ_moss');
        if (noise(c.x, c.z, 6) < 0.3) at(c.x, 2, c.z, 'civ_jungle');
      }
    }
  },

  /** Two tiles of sea: a long ring of coral breaking the surface in a crown's points, turquoise shallows inside it. */
  sunken_crown(s, { columns, at }) {
    const p = s.pair ?? { cx: s.cx, cz: s.cz };
    const vx = p.cx - s.cx;
    const vz = p.cz - s.cz;
    for (const c of columns) {
      // How far from the line between the two tiles' middles.
      const k = Math.max(0, Math.min(1, ((c.x + 0.5 - s.cx) * vx + (c.z + 0.5 - s.cz) * vz) / (vx * vx + vz * vz || 1)));
      const q = Math.hypot(c.x + 0.5 - s.cx - vx * k, c.z + 0.5 - s.cz - vz * k);
      if (q >= 2 && q < 3.1) {
        at(c.x, -1, c.z, 'civ_coral');
        const point = noise(c.x, c.z, 1) < 0.24;
        if (point || noise(c.x, c.z, 2) < 0.65) at(c.x, 0, c.z, 'civ_coral');
        if (point) for (let y = 1; y <= (q < 2.6 ? 2 : 1); y++) at(c.x, y, c.z, 'civ_coral_bright');
      } else at(c.x, -1, c.z, q < 2 && noise(c.x, c.z, 3) < 0.18 ? 'civ_coral_bright' : 'civ_reef');
    }
  },

  /** A cone of black rock filling its tile, grey with ash toward the top, round a crater of magma; lava runs down its face and pools at its foot. */
  ember_throne(_, { columns, at, land }) {
    const streams = [1.95, 0.85];
    for (const c of columns) {
      const stream = (wide: number) =>
        streams.some((a) => {
          const along = c.dx * Math.cos(a) + c.dz * Math.sin(a);
          return along > 1.2 && Math.abs(c.dz * Math.cos(a) - c.dx * Math.sin(a)) < wide;
        });
      if (c.d > 3.25) {
        land(c, 1, stream(0.8) ? 'civ_magma' : noise(c.x, c.z) < 0.7 ? 'civ_scorch' : 'civ_ash', 'civ_basalt');
        continue;
      }
      const h = c.d < 1.15 ? 9 : Math.max(1, Math.min(11, Math.round(1 + 10.5 * Math.pow((3.5 - c.d) / 2.35, 1.15) + (noise(c.x, c.z) - 0.5))));
      for (let y = 0; y < h; y++) at(c.x, y, c.z, y >= 6 && noise(c.x, c.z, y) < 0.6 ? 'civ_ashrock' : 'civ_basalt');
      const lava = c.d < 1.15 || stream(0.45);
      at(c.x, h, c.z, lava ? 'civ_magma' : h >= 6 ? 'civ_ashrock' : 'civ_basalt');
      if (lava && h > 1) at(c.x, h - 1, c.z, 'civ_magma');
    }
  },

  /** A bowl of scorched rock inside a ragged rim, cracks glowing across it, shards of star-metal standing at its heart. */
  starfall_crater(_, { columns, at, land }) {
    for (const c of columns) {
      if (c.d < 2.3) {
        const crack = c.d > 0.9 && Math.abs(Math.sin(Math.atan2(c.dz, c.dx) * 3 + 0.4)) < 0.2;
        at(c.x, 0, c.z, c.d < 1.1 || crack ? 'civ_star' : 'civ_scorch');
        if (c.d < 1.1) for (let y = 1, tall = 1 + Math.floor(noise(c.x, c.z, 4) * 4.5); y <= tall; y++) at(c.x, y, c.z, 'civ_star');
      } else {
        const h = 2 + (noise(c.x, c.z, 1) < 0.5 ? 1 : 0) - (c.d > 3.2 ? 1 : 0);
        land(c, h, noise(c.x, c.z, 2) < 0.7 ? 'civ_scorch' : 'civ_rock', 'civ_scorch');
        if (noise(c.x, c.z, 5) < 0.08) at(c.x, h + 1, c.z, 'civ_star');
      }
    }
  },

  /** A wide glowing pool in a ring of green, four tall palms leaning out over the sand. */
  ageless_spring(s, { columns, at, land, column, near }) {
    for (const c of columns) {
      const pool = Math.hypot(c.dx, c.dz + 0.3);
      if (pool < 2.1) {
        at(c.x, 0, c.z, 'civ_coast_floor');
        at(c.x, 1, c.z, 'civ_spring');
      } else land(c, 1, pool < 3 ? 'civ_grass' : s.cap);
      if (pool >= 2.1 && pool < 3 && noise(c.x, c.z, 2) < 0.22) at(c.x, 2, c.z, 'civ_jungle');
    }
    // Palms round the far side and the ends of the pool (none in front, where they'd hide it), leaning out.
    for (const a of [-2.7, -1.75, -0.6, 0.45]) {
      const foot = column(Math.cos(a) * 2.3, Math.sin(a) * 2.3 - 0.3);
      const out = column(Math.cos(a) * 3, Math.sin(a) * 3 - 0.3);
      const tip = s.own(out.x, out.z) ? out : foot;
      for (let y = 2; y <= 4; y++) at(foot.x, y, foot.z, 'civ_trunk');
      for (let y = 5; y <= 6; y++) at(tip.x, y, tip.z, 'civ_trunk');
      for (const c of near(tip.x + 0.5 - s.cx, tip.z + 0.5 - s.cz, 1.5)) if (s.own(c.x, c.z)) at(c.x, 7, c.z, 'civ_palm');
      for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (s.own(tip.x + dx, tip.z + dz)) at(tip.x + dx, 6, tip.z + dz, 'civ_palm');
    }
  },

  /** A lone, smooth white peak filling its tile over a dark rocky foot, a pilgrims' path winding up its face to a light at the very top. */
  mount_solace(_, { columns, at, column }) {
    const tops = new Map<string, number>();
    for (const c of columns) {
      const h = Math.max(1, Math.round(12 * Math.pow(Math.max(0, 1 - c.d / 3.5), 0.8) + (c.d > 1 ? (noise(c.x, c.z) - 0.5) * 0.8 : 0)));
      for (let y = 0; y <= h; y++) at(c.x, y, c.z, y >= 4 || (y === h && h >= 3) ? 'civ_snow' : 'civ_rock');
      tops.set(`${c.x},${c.z}`, h);
    }
    // The path: from the foot on the south side, round and up.
    for (let i = 0; i <= 90; i++) {
      const t = i / 90;
      const a = Math.PI * 0.5 + t * Math.PI * 2.3;
      const r = 3.1 * (1 - t) + 0.6;
      const c = column(Math.cos(a) * r, Math.sin(a) * r);
      const h = tops.get(`${c.x},${c.z}`);
      if (h !== undefined && h < 10) at(c.x, h, c.z, 'civ_path');
    }
    const summit = column(0, 0);
    at(summit.x, (tops.get(`${summit.x},${summit.z}`) ?? 12) + 1, summit.z, 'civ_halo');
  },

  /** A broad mountain filling its tile, forest on its slopes and snow on its table top, a ring of cloud round its shoulders. */
  cloudcrown(_, { columns, at }) {
    for (const c of columns) {
      const h = c.d < 2 ? 10 : Math.max(1, Math.round(10 - (c.d - 2) * 6 + (noise(c.x, c.z) - 0.5) * 1.2));
      for (let y = 0; y <= h; y++) at(c.x, y, c.z, y === h && h >= 7 ? 'civ_snow' : y <= 5 ? (noise(c.x, c.z, y) < 0.7 ? 'civ_jungle' : 'civ_leaves') : 'civ_rock');
      if (c.d < 1.3) at(c.x, 11, c.z, 'civ_snow');
    }
    // The cloud round its shoulders, at the edge of its own tile (so none shows before it's found).
    for (const c of columns) if (c.d > 2.5 && noise(c.x, c.z, 9) < 0.8) at(c.x, 7, c.z, 'civ_cloud');
    for (const c of columns) if (c.d > 2.8 && noise(c.x, c.z, 10) < 0.4) at(c.x, 8, c.z, 'civ_cloud');
  },

  /** Two jagged peaks filling their tile, rock veined with glinting gold, nuggets at their feet. */
  gilded_peak(_, { columns, at, land }) {
    for (const c of columns) {
      const main = 11 * Math.max(0, 1 - Math.hypot(c.dx + 0.5, c.dz - 0.2) / 3.5);
      const second = 8 * Math.max(0, 1 - Math.hypot(c.dx - 1.5, c.dz + 0.6) / 2.4);
      const h = Math.max(1, Math.round(Math.max(main, second) + (noise(c.x, c.z) - 0.5) * 1.4));
      if (h <= 1) {
        land(c, 1, noise(c.x, c.z, 2) < 0.5 ? 'civ_gold' : 'civ_rock');
        continue;
      }
      for (let y = 0; y <= h; y++) {
        const vein = Math.abs((((c.x - c.z + y) % 3) + 3) % 3 - 1.5) < 0.6 && noise(c.x, c.z, y) < 0.85;
        at(c.x, y, c.z, vein || (y === h && noise(c.x, c.z, 3) < 0.65) ? 'civ_gold' : 'civ_rock');
      }
    }
  },

  /** A rocky hill filling its tile, a grove of petrified trunks standing and fallen on it, its middle kept clear for whoever holds it. */
  stone_grove(_, { columns, at, column }) {
    const tops = new Map<string, number>();
    for (const c of columns) {
      const h = 1 + Math.round(2.2 * Math.pow(Math.max(0, 1 - c.d / 3.5), 0.6) + noise(c.x, c.z) * 0.6);
      for (let y = 0; y < h; y++) at(c.x, y, c.z, 'civ_dirt');
      at(c.x, h, c.z, noise(c.x, c.z, 1) < 0.45 ? 'civ_rock' : 'civ_ashrock');
      tops.set(`${c.x},${c.z}`, h);
    }
    const ground = (x: number, z: number) => tops.get(`${x},${z}`);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + noise(i, 3) * 0.4;
      const r = 1.7 + noise(i, 5) * 1.2;
      const t = column(Math.cos(a) * r, Math.sin(a) * r);
      const g = ground(t.x, t.z);
      if (g === undefined) continue;
      const tall = i % 4 === 3 ? 1 : 3 + Math.floor(noise(i, 7) * 3);
      for (let y = 1; y <= tall; y++) at(t.x, g + y, t.z, 'civ_petrified');
      if (tall > 2) at(t.x + (i % 2 ? 1 : -1), g + tall - 1, t.z, 'civ_petrified');
      if (tall > 3) at(t.x, g + tall - 1, t.z + (i % 3 ? 1 : -1), 'civ_petrified');
    }
    // A fallen trunk on the north side.
    for (let dx = -1; dx <= 1; dx++) {
      const t = column(dx + 0.4, -2.3);
      const g = ground(t.x, t.z);
      if (g !== undefined) at(t.x, g + 1, t.z, 'civ_petrified');
    }
  },

  /** A great violet crystal rising out of frosted ground filling its tile, smaller ones leaning out of its foot. */
  heartstone(s, { columns, at, land, near }) {
    for (const c of columns) {
      land(c, 1, 'civ_snow');
      if (c.d > 2 && noise(c.x, c.z, 1) < 0.14) at(c.x, 2, c.z, 'civ_crystal_pale');
    }
    for (let k = 0; k < 11; k++) {
      const r = k < 6 ? 1.7 : 1.7 - (k - 5) * 0.32;
      for (const c of near(0, 0, Math.max(0.5, r))) at(c.x, 2 + k, c.z, (c.x + c.z + k) % 5 === 0 ? 'civ_crystal_pale' : 'civ_crystal');
    }
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + 0.3;
      const len = 4 + (i % 3) * 1.5;
      for (let k = 0; k < len; k++) {
        const r = 1.8 + k * 0.33;
        for (const c of near(Math.cos(a) * r, Math.sin(a) * r, k < len - 1 ? 0.75 : 0.5)) if (s.own(c.x, c.z)) at(c.x, 2 + k, c.z, i % 2 ? 'civ_crystal_pale' : 'civ_crystal');
      }
    }
  },

  /** A great span of banded red rock across its tile on red sand, its opening framing whoever stands in front, hoodoos at its corners. */
  sun_arch(s, { columns, at, land, near }) {
    for (const c of columns) {
      land(c, 1, noise(c.x, c.z) < 0.7 ? 'civ_redsand' : 'civ_redrock');
      const back = c.dz + 0.7;
      if (Math.abs(back) < 1.1) {
        const w = Math.abs(c.dx);
        const bottom = w >= 2.1 ? 2 : 8 - Math.round(5 * (w / 2.1) ** 2);
        const top = w < 1.2 ? 10 : w < 2.5 ? 9 : 8;
        for (let y = bottom; y <= top; y++) at(c.x, y, c.z, 'civ_redrock');
      }
    }
    // Hoodoos: two red pillars at the front corners, a stone on each.
    for (const [ox, oz, h] of [[-2.2, 1.7, 5], [2.3, 1.5, 4]] as const) {
      for (const c of near(ox, oz, 0.75)) if (s.own(c.x, c.z)) for (let y = 2; y <= h; y++) at(c.x, y, c.z, 'civ_redrock');
      for (const c of near(ox, oz, 1.1)) if (s.own(c.x, c.z)) at(c.x, h + 1, c.z, 'civ_pale_band');
    }
  },

  /** Two tiles: six-sided black columns of every height filling its land, stepping down into the sea and on out across it. */
  titans_steps(s, { columns, at, axis }) {
    const cap = (x: number, z: number) => ((x + z) % 2 ? 'civ_basalt_top' : 'civ_basalt_pale');
    for (const c of columns) {
      const { along, across } = axis(c);
      if (c.home === 0) {
        const h = Math.max(2, Math.min(8, Math.round(4 - along * 1.05 + (noise(c.x, c.z) - 0.5) * 1.4)));
        for (let y = 0; y < h; y++) at(c.x, y, c.z, 'civ_basalt_column');
        at(c.x, h, c.z, cap(c.x, c.z));
        continue;
      }
      // At sea: the causeway runs on, sinking, its columns ever fewer.
      const h = Math.round(1.8 - along * 0.55 + (noise(c.x, c.z) - 0.5) * 1.2);
      if (h >= 0 && Math.abs(across) < 2.4 - along * 0.25 && noise(c.x, c.z, 2) < 0.9 - along * 0.12) {
        for (let y = -1; y < h; y++) at(c.x, y, c.z, 'civ_basalt_column');
        at(c.x, h, c.z, cap(c.x, c.z));
      } else at(c.x, -1, c.z, 'civ_coast_floor');
    }
    // A few last stones out in the sea past it, low.
    if (s.pair) {
      const ox = (s.pair.cx - s.cx) * 1.55;
      const oz = (s.pair.cz - s.cz) * 1.55;
      for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) {
        const x = Math.floor(s.cx + ox) + dx;
        const z = Math.floor(s.cz + oz) + dz;
        if (!s.own(x, z) && s.sea(x, z)) at(x, 0, z, cap(x, z));
      }
    }
  },

  /** A vast tree, its trunk thick as a tower and its golden crown as wide as its tile, roots running over mossy ground strewn with its leaves. */
  worldroot(s, { columns, at, land, near }) {
    for (const c of columns) land(c, 1, noise(c.x, c.z, 4) < 0.25 ? 'civ_goldleaf' : 'civ_moss');
    for (const c of near(0, 0, 2)) {
      at(c.x, 2, c.z, 'civ_bark');
      if (c.d < 1.8) at(c.x, 3, c.z, 'civ_bark');
    }
    for (let y = 4; y <= 9; y++) for (const c of near(0, 0, 1.5)) at(c.x, y, c.z, 'civ_bark');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      for (let r = 1.8; r < 3.4; r += 0.4) for (const c of near(Math.cos(a) * r, Math.sin(a) * r, 0.55)) if (s.own(c.x, c.z)) at(c.x, 2, c.z, 'civ_bark');
    }
    // The crown: as wide as its tile, and no wider (so none shows before it's found).
    for (const c of columns)
      for (let y = 9; y <= 12; y++) {
        const dy = (y - 10.5) / 2;
        if ((c.d / 3.9) ** 2 + dy * dy < 1) at(c.x, y, c.z, noise(c.x, c.z, y + 20) < 0.16 ? 'civ_leaves' : 'civ_goldleaf');
      }
  },
};

/** A natural wonder's blocks, over its tile or tiles (nothing for one with no landmark). */
export function landmark(id: string, s: Site, put: Put) {
  BUILDERS[id]?.(s, kit(s, put));
}
