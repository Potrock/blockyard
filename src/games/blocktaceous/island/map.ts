import { Noise, clamp01, lerp, smoothstep } from './noise';

/**
 * The island's shape, built by code from a fixed seed: a grid of ground heights, zones (kinds of
 * land) and water levels, one sample every `CELL` blocks. The engine's generator interpolates it
 * into the real world (see `def.ts`); the rest of the game reads the same grids (`index.ts`), so
 * the server's rules, every screen and the land itself agree.
 *
 * North is -z. The south coast is gentle beaches where survivors wash up; grassland behind it,
 * jungle to the east, a marsh to the south-west, giant redwoods in the west, red mesas in the
 * east, a snowy mountain range across the north with tundra beyond it, and a volcano on the
 * north-east cape. Rivers run from the range to the sea.
 */

/** Blocks between samples, samples along each side, and the world position of sample (0, 0). */
export const CELL = 8;
export const SIZE = 832;
export const ORIGIN = -(SIZE * CELL) / 2;
export const SEA = 62;
const SEED = 20261111;

/** The zones of the map's palette (`zones.ts` says what each is made of), by index. */
export const Z = { ocean: 0, beach: 1, grassland: 2, jungle: 3, redwood: 4, swamp: 5, badlands: 6, mountain: 7, snow: 8, volcano: 9, river: 10, lava: 11, frozenRiver: 12 } as const;

/** The volcano's crater. */
export const VOLCANO = { x: 2080, z: -1780 };

interface Site {
  x: number;
  z: number;
}
interface Lowland {
  zone: number;
  /** The region's name inland, and along its shore. */
  name: string;
  shore: string;
  sites: Site[];
}

/** The lowlands: each a few sites, a column belonging to the nearest (through a warp, so borders wander). */
const LOWLANDS: Lowland[] = [
  { zone: Z.grassland, name: 'Windrow Plains', shore: 'Castaway Shore', sites: [{ x: 0, z: 1500 }, { x: -550, z: 2050 }, { x: 550, z: 2100 }, { x: 150, z: 800 }] },
  { zone: Z.grassland, name: 'Highmeadow', shore: 'Castaway Shore', sites: [{ x: -150, z: -250 }, { x: 450, z: -500 }, { x: -500, z: 300 }] },
  { zone: Z.jungle, name: 'The Emerald Tangle', shore: 'Parrot Strand', sites: [{ x: 1500, z: 700 }, { x: 1950, z: 1300 }, { x: 1250, z: 1500 }, { x: 2150, z: 300 }, { x: 1700, z: 1900 }] },
  { zone: Z.swamp, name: 'The Sunken Marsh', shore: 'Mudflat Reach', sites: [{ x: -1750, z: 1250 }, { x: -2150, z: 850 }, { x: -1350, z: 1850 }, { x: -2000, z: 1700 }] },
  { zone: Z.redwood, name: 'Titan Grove', shore: 'Driftwood Coast', sites: [{ x: -1500, z: -400 }, { x: -2000, z: -900 }, { x: -950, z: -800 }, { x: -1950, z: 50 }, { x: -1250, z: 350 }, { x: -2400, z: -1350 }] },
  { zone: Z.badlands, name: 'The Red Mesas', shore: 'Rustwater Shore', sites: [{ x: 1700, z: -900 }, { x: 2300, z: -500 }, { x: 1300, z: -1150 }, { x: 2500, z: -50 }, { x: 1150, z: -350 }] },
  { zone: Z.snow, name: 'The White Reach', shore: 'Icewind Shore', sites: [{ x: 0, z: -2450 }, { x: -900, z: -2500 }, { x: 900, z: -2450 }, { x: -1600, z: -2300 }] },
];

/** The range's ridge line, west to east, and a spur running south into the island's middle. */
const RIDGE: Site[] = [{ x: -1750, z: -1450 }, { x: -1100, z: -1700 }, { x: -300, z: -1600 }, { x: 450, z: -1800 }, { x: 1050, z: -1550 }];
const SPUR: Site[] = [{ x: -300, z: -1600 }, { x: -350, z: -1050 }, { x: -550, z: -650 }];

/** The coast's distance from the middle, looking along the angle `th` (0: east, a quarter turn: south), before its wobbles. */
const coastRadius = (th: number) => 2520 + 250 * Math.sin(2 * th + 0.7) + 190 * Math.sin(3 * th + 2.1) + 110 * Math.sin(5 * th + 4);
const along = (degrees: number, off: number) => {
  const th = (degrees * Math.PI) / 180;
  const r = coastRadius(th) + off;
  return { x: Math.round(r * Math.cos(th)), z: Math.round(r * Math.sin(th)) };
};

/** Bays bitten out of the coast and islets standing off it, by the angle they lie at. */
const BAYS = [
  { ...along(68, 0), r: 400 },
  { ...along(176, 0), r: 360 },
  { ...along(-83, 0), r: 250 },
  { ...along(-83, -330), r: 190 },
  { ...along(8, 0), r: 300 },
  { ...along(122, 0), r: 280 },
  { ...along(-142, 0), r: 310 },
  { ...along(38, 0), r: 240 },
  { ...along(-52, 0), r: 270 },
  { ...along(150, 0), r: 200 },
];
export const ISLETS = [
  { ...along(101, 420), r: 130, name: 'The Pups' },
  { ...along(93, 540), r: 80, name: 'The Pups' },
  { ...along(190, 420), r: 120, name: 'Gull Rock' },
  { ...along(-22, 560), r: 110, name: 'Ember Isle' },
  { ...along(52, 430), r: 100, name: 'Turtle Key' },
];

interface River {
  name: string;
  /** Source to sea; the last point lies out at sea. */
  path: Site[];
  /** How steep the valley it cuts is (blocks up per block away), and how far the valley reaches. */
  valley: number;
  reach: number;
  lava?: boolean;
  /** Lakes along it, by the index of the path point they sit on. */
  lakes?: { at: number; r: number; depth: number; name: string }[];
}

const RIVERS: River[] = [
  {
    name: 'The Longwater',
    path: [{ x: -80, z: -1330 }, { x: 60, z: -820 }, { x: 100, z: -200 }, { x: 160, z: 380 }, { x: 330, z: 1000 }, { x: 700, z: 1700 }, { x: 980, z: 2250 }, { x: 1080, z: 2650 }, { x: 1150, z: 3150 }],
    valley: 0.7,
    reach: 96,
    lakes: [{ at: 0, r: 90, depth: 7, name: 'Skyglass Tarn' }, { at: 3, r: 210, depth: 11, name: 'Mirror Lake' }],
  },
  {
    name: 'The Redwash',
    path: [{ x: 760, z: -1420 }, { x: 1180, z: -1020 }, { x: 1680, z: -700 }, { x: 2180, z: -380 }, { x: 2640, z: -120 }, { x: 3200, z: 60 }],
    valley: 2.4,
    reach: 72,
  },
  {
    name: 'The Mossrun',
    path: [{ x: -900, z: -1480 }, { x: -1280, z: -900 }, { x: -1520, z: -300 }, { x: -1650, z: 420 }, { x: -1880, z: 1000 }, { x: -2250, z: 1500 }, { x: -2650, z: 1900 }, { x: -3100, z: 2250 }],
    valley: 0.8,
    reach: 96,
    lakes: [{ at: 2, r: 130, depth: 8, name: 'Stillpool' }],
  },
  {
    name: 'The Coldrush',
    path: [{ x: -620, z: -1800 }, { x: -820, z: -2100 }, { x: -960, z: -2450 }, { x: -1050, z: -2800 }, { x: -1150, z: -3200 }],
    valley: 1.0,
    reach: 80,
  },
  {
    name: 'Parrot Creek',
    path: [{ x: 1650, z: 420 }, { x: 1880, z: 1050 }, { x: 2050, z: 1650 }, { x: 2230, z: 1950 }, { x: 2600, z: 2500 }],
    valley: 0.8,
    reach: 80,
    lakes: [{ at: 0, r: 110, depth: 8, name: 'Tangle Pool' }],
  },
  {
    name: 'The Cinderflow',
    path: [{ x: VOLCANO.x, z: VOLCANO.z }, { x: VOLCANO.x + 230, z: VOLCANO.z - 90 }, { x: VOLCANO.x + 470, z: VOLCANO.z - 300 }, { x: VOLCANO.x + 900, z: VOLCANO.z - 650 }],
    valley: 1.6,
    reach: 28,
    lava: true,
    lakes: [{ at: 0, r: 44, depth: 5, name: 'The Cauldron' }],
  },
];

/** Region names by id (0: open sea). The lowlands' names and shores first, then the rest. */
export const REGION_NAMES: (string | null)[] = [null];
const regionId = (name: string) => {
  let i = REGION_NAMES.indexOf(name);
  if (i < 0) i = REGION_NAMES.push(name) - 1;
  return i;
};

/** The volcano's cone: its height `r` blocks from the crater's middle. */
const cone = (r: number) => 66 + 150 * (1 - r / 660) ** 1.3;

export interface IslandMap {
  /** Ground height at each sample, in 1/256 of a block; index `z * SIZE + x`. */
  heights: Uint16Array;
  zones: Uint8Array;
  /** The y of the top block of river, lake or lava at each sample; 0 where there is none. */
  water: Uint8Array;
  /** Each sample's region: an index into `REGION_NAMES`. */
  regions: Uint8Array;
}

/** `Math.hypot` is slow where it's called millions of times. */
const dist = (dx: number, dz: number) => Math.sqrt(dx * dx + dz * dz);

function distToLine(x: number, z: number, line: Site[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz));
    best = Math.min(best, dist(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** A smooth minimum: the lower of the two, rounded where they meet. */
function smin(a: number, b: number, k: number): number {
  const h = clamp01(0.5 + (0.5 * (b - a)) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** A path through the points as a smooth curve, a point about every 6 blocks, wandering a little. */
function spline(points: Site[], wander: Noise): Site[] {
  const out: Site[] = [];
  const p = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i + 1 < points.length; i++) {
    const [a, b, c, d] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const steps = Math.ceil(Math.hypot(c.x - b.x, c.z - b.z) / 6);
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const cr = (p0: number, p1: number, p2: number, p3: number) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
      const x = cr(a.x, b.x, c.x, d.x);
      const z = cr(a.z, b.z, c.z, d.z);
      // No wander at the very source, so a lake set there is where it says.
      const w = Math.min(1, (i * steps + s) / 20) * 46;
      out.push({ x: x + w * wander.at(x / 190, z / 190), z: z + w * wander.at(x / 190 + 40, z / 190 - 70) });
    }
  }
  return out;
}

/** Build the island. About half a second; `islandMap()` keeps the result. */
export function buildIsland(): IslandMap {
  const n = SIZE * SIZE;
  const h = new Float32Array(n).fill(30);
  const shore = new Float32Array(n).fill(-999); // blocks inland of the coast (negative: out at sea)
  const beach = new Float32Array(n); // how wide the beach is here
  const low = new Uint8Array(n); // the nearest lowland
  const env = new Float32Array(n); // how much the range lifts the land here, 0..1
  const water = new Uint8Array(n);
  const lavaAt = new Uint8Array(n);
  const lakeAt = new Uint8Array(n); // region id of the lake a wet sample is in

  const noise = (k: number) => new Noise(SEED + k * 7919);
  const [nCoastA, nCoastB, nWarpA, nWarpB, nGentle, nHill, nRidge, nMesa, nFine, nWander, nLake] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(noise);
  const lowDist = new Float64Array(LOWLANDS.length);

  // The slow warps (of the coast, of the lowlands' borders) and the shores' gentleness change
  // little over a few samples: they're worked out on a grid four times coarser and interpolated.
  const CG = 4;
  const CN = Math.floor(SIZE / CG) + 2;
  const coarse = (f: (x: number, z: number) => number) => {
    const g = new Float32Array(CN * CN);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) g[j * CN + i] = f(ORIGIN + i * CG * CELL, ORIGIN + j * CG * CELL);
    return (i: number, j: number) => {
      const ci = Math.floor(i / CG);
      const cj = Math.floor(j / CG);
      const k = cj * CN + ci;
      const tx = (i - ci * CG) / CG;
      return lerp(lerp(g[k], g[k + 1], tx), lerp(g[k + CN], g[k + CN + 1], tx), (j - cj * CG) / CG);
    };
  };
  const coastX = coarse((x, z) => 260 * nCoastA.fbm(x / 900, z / 900, 3));
  const coastZ = coarse((x, z) => 260 * nCoastB.fbm(x / 900, z / 900, 3));
  const warpX = coarse((x, z) => 260 * nWarpA.fbm(x / 700, z / 700, 2));
  const warpZ = coarse((x, z) => 260 * nWarpB.fbm(x / 700, z / 700, 2));
  const gentle = coarse((x, z) => smoothstep(-900, 600, z) + 0.5 * nGentle.fbm(x / 600, z / 600, 2));
  const cliffs = coarse((x, z) => 14 + 22 * (0.5 + 0.5 * nGentle.at(x / 300 + 50, z / 300)));

  // 1. The land before its rivers: coast, lowlands, the range, the volcano. Worked out at every
  // other sample each way (its shapes are broad) and filled in between, which quarters the work.
  for (let j = 0; j < SIZE; j += 2) {
    const z = ORIGIN + j * CELL;
    for (let i = 0; i < SIZE; i += 2) {
      const x = ORIGIN + i * CELL;
      const k = j * SIZE + i;

      // The coast: a wobbly circle with bays bitten out and islets added, seen through a warp.
      const cx = x + coastX(i, j);
      const cz = z + coastZ(i, j);
      const th = Math.atan2(cz, cx);
      let s = coastRadius(th) - Math.sqrt(cx * cx + cz * cz);
      if (s > -900 && s < 900) {
        // Near the coast: headlands and coves, and bays bitten out.
        s += 150 * nCoastA.fbm(x / 380 + 9, z / 380, 3) * smoothstep(900, 450, Math.abs(s));
        for (const b of BAYS) s = smin(s, dist(cx - b.x, cz - b.z) - b.r, 90);
      }
      let islet = 0;
      for (const b of ISLETS) {
        const d = b.r - dist(cx - b.x, cz - b.z);
        if (d > s) {
          s = d;
          islet = 1;
        }
      }
      const vd = dist(x - VOLCANO.x, z - VOLCANO.z);
      s = Math.max(s, 520 - vd + 40 * nCoastB.at(x / 130, z / 130));
      // The sea all round, whatever the noise says near the map's edge.
      s = Math.min(s, (3230 - Math.max(Math.abs(x), Math.abs(z))) * 4);
      shore[k] = s;
      if (s < -420) continue;

      // Gentle shores (wide beaches, shallow water) in the south, cliffs in the north.
      const g = islet ? 0.8 : clamp01(gentle(i, j));
      const bw = lerp(12, 80, g);
      beach[k] = bw;
      if (s < 0) {
        h[k] = 61.7 - 32 * (1 - Math.exp(s / lerp(45, 120, g)));
        continue;
      }

      // The lowlands, each with its own lie of the land, blended where they meet.
      const wx = x + warpX(i, j) + 110 * nWarpA.at(x / 210 + 3, z / 210);
      const wz = z + warpZ(i, j) + 110 * nWarpB.at(x / 210, z / 210 + 8);
      let nearest = 0;
      for (let b = 0; b < LOWLANDS.length; b++) {
        let d = Infinity;
        for (const p of LOWLANDS[b].sites) d = Math.min(d, (wx - p.x) * (wx - p.x) + (wz - p.z) * (wz - p.z));
        d = Math.sqrt(d);
        lowDist[b] = d;
        if (d < lowDist[nearest]) nearest = b;
      }
      low[k] = nearest;
      let lowland = 0;
      let total = 0;
      let marsh = 0;
      for (let b = 0; b < LOWLANDS.length; b++) {
        const w = Math.exp(-(lowDist[b] - lowDist[nearest]) / 130);
        if (w < 0.02) continue;
        total += w;
        switch (LOWLANDS[b].zone) {
          case Z.grassland:
            lowland += w * (2.5 + 4 * nHill.fbm(x / 320, z / 320, 3));
            break;
          case Z.jungle:
            lowland += w * (7 + 15 * Math.abs(nHill.fbm(x / 260 + 20, z / 260, 3)));
            break;
          case Z.redwood:
            lowland += w * (11 + 11 * nHill.fbm(x / 380, z / 380 + 30, 3));
            break;
          case Z.swamp:
            marsh += w;
            break;
          case Z.badlands: {
            // Mesas: flat tops at two heights over a low red plain.
            const t = nMesa.fbm(x / 300, z / 300, 3) * 0.5 + 0.5;
            lowland += w * (6 + 30 * smoothstep(0.5, 0.56, t) + 22 * smoothstep(0.66, 0.7, t) + 2.5 * nHill.at(x / 90, z / 90));
            break;
          }
          default:
            lowland += w * (7 + 7 * nHill.fbm(x / 300 + 60, z / 300, 3));
        }
      }
      lowland /= total;
      marsh /= total;
      const cliff = (1 - g) * cliffs(i, j) * smoothstep(0, 30, s);
      let y = 62.3 + 3 * smoothstep(0, bw, s) + cliff + 12 * smoothstep(bw * 0.6, bw + 500, s) + lowland * smoothstep(bw * 0.5, bw + 160, s);
      // The marsh lies flat at the water's level: about a third of it is shallow pools.
      y = lerp(y, 62.0 + 2.6 * nFine.fbm(x / 70, z / 70, 2), marsh * smoothstep(20, 140, s));

      // The range and its spur.
      const e = Math.max(smoothstep(660, 50, distToLine(wx, wz, RIDGE)), 0.6 * smoothstep(520, 40, distToLine(wx, wz, SPUR))) ** 1.3;
      if (e > 0) {
        env[k] = e;
        y += (e * (40 + 104 * nRidge.ridged(x / 420, z / 420, 4)) + 20 * e * e) * smoothstep(40, 420, s);
      }

      // The volcano: a cone with a crater in its top.
      if (vd < 660) {
        const rim = cone(72);
        const c = vd < 72 ? Math.max(rim - 24, rim - (72 - vd) * 0.9) : cone(vd) + 5 * nRidge.ridged(x / 110, z / 110, 2) * smoothstep(72, 160, vd);
        y = lerp(y, c, smoothstep(660, 400, vd));
      }
      if (y > 224) y = 224 + (y - 224) * 0.35;
      h[k] = Math.min(y, 250);
    }
  }

  for (let j = 0; j < SIZE; j++) {
    const j0 = j & ~1;
    const j1 = Math.min(SIZE - 2, j0 + (j & 1) * 2);
    for (let i = j & 1 ? 0 : 1; i < SIZE; i += j & 1 ? 1 : 2) {
      const i0 = i & ~1;
      const i1 = Math.min(SIZE - 2, i0 + (i & 1) * 2);
      const a = j0 * SIZE + i0;
      const b = j0 * SIZE + i1;
      const c = j1 * SIZE + i0;
      const d = j1 * SIZE + i1;
      const k = j * SIZE + i;
      h[k] = (h[a] + h[b] + h[c] + h[d]) / 4;
      shore[k] = (shore[a] + shore[b] + shore[c] + shore[d]) / 4;
      beach[k] = (beach[a] + beach[b] + beach[c] + beach[d]) / 4;
      env[k] = (env[a] + env[b] + env[c] + env[d]) / 4;
      low[k] = low[a];
    }
  }

  // 2. Rivers and lakes. Each river's level only ever falls on its way down, so it cuts through
  // any rise in its path; a lake takes the river's level where it meets it.
  interface Stamp {
    x: number;
    z: number;
    level: number;
    half: number;
    river: River;
    lake?: { r: number; depth: number; id: number; wobble: number };
  }
  const stamps: Stamp[] = [];
  const sample = (x: number, z: number) => {
    const gx = clamp01((x - ORIGIN) / CELL / (SIZE - 1)) * (SIZE - 1);
    const gz = clamp01((z - ORIGIN) / CELL / (SIZE - 1)) * (SIZE - 1);
    const i = Math.min(SIZE - 2, Math.floor(gx));
    const j = Math.min(SIZE - 2, Math.floor(gz));
    const k = j * SIZE + i;
    return lerp(lerp(h[k], h[k + 1], gx - i), lerp(h[k + SIZE], h[k + SIZE + 1], gx - i), gz - j);
  };
  RIVERS.forEach((river, ri) => {
    const path = spline(river.path, nWander);
    const lakes = (river.lakes ?? []).map((l) => ({ ...l, ...river.path[l.at], level: 0, id: regionId(l.name) }));
    let level = sample(path[0].x, path[0].z) - 2.2;
    path.forEach((p, pi) => {
      const lake = lakes.find((l) => Math.hypot(p.x - l.x, p.z - l.z) < l.r * 0.85);
      if (lake) {
        if (!lake.level) {
          lake.level = Math.max(SEA, Math.floor(level));
          stamps.push({ x: lake.x, z: lake.z, level: lake.level, half: lake.r, river, lake: { r: lake.r, depth: lake.depth, id: lake.id, wobble: ri * 7.3 } });
        }
        level = lake.level;
      } else {
        level = Math.max(SEA, Math.min(level, sample(p.x, p.z) - 2.2));
      }
      stamps.push({ x: p.x, z: p.z, level: Math.floor(level), half: river.lava ? 7 : lerp(7, 13, pi / path.length), river });
    });
  });
  // Each sample takes the nearest stretch of water: inside it, or on its banks.
  const edge = new Float32Array(n).fill(1e9);
  const stampOf = new Int32Array(n).fill(-1);
  stamps.forEach((st, si) => {
    const reach = st.half * 1.3 + st.river.reach;
    const i0 = Math.max(0, Math.floor((st.x - reach - ORIGIN) / CELL));
    const i1 = Math.min(SIZE - 1, Math.ceil((st.x + reach - ORIGIN) / CELL));
    const j0 = Math.max(0, Math.floor((st.z - reach - ORIGIN) / CELL));
    const j1 = Math.min(SIZE - 1, Math.ceil((st.z + reach - ORIGIN) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = ORIGIN + i * CELL - st.x;
        const dz = ORIGIN + j * CELL - st.z;
        const d = dist(dx, dz);
        // A lake's shore wanders in and out.
        const half = st.lake ? st.half * (1 + 0.24 * nLake.at((dx / (d + 1)) * 1.6 + st.lake.wobble, (dz / (d + 1)) * 1.6)) : st.half;
        const k = j * SIZE + i;
        if (d - half < edge[k]) {
          edge[k] = d - half;
          stampOf[k] = si;
        }
      }
    }
  });
  for (let k = 0; k < n; k++) {
    const st = stamps[stampOf[k]];
    // Out at sea a river is just sea.
    if (!st || h[k] < 57) continue;
    const d = edge[k];
    if (d < 0) {
      const depth = st.lake ? 1.6 + st.lake.depth * clamp01(-d / (st.lake.r * 0.6)) : 1.4 + 2.6 * Math.min(1, -d / st.half);
      h[k] = Math.min(h[k], st.level - depth);
      water[k] = st.level;
      lavaAt[k] = st.river.lava ? 1 : 0;
      lakeAt[k] = st.lake?.id ?? 0;
    } else if (d < st.river.reach) {
      const cut = Math.min(h[k], st.level + 1.7 + st.river.valley * d);
      h[k] = lerp(cut, h[k], smoothstep(0.55 * st.river.reach, st.river.reach, d));
    }
  }
  // Banks: dry ground next to water stands above it, so the water stays in its bed.
  for (let j = 1; j < SIZE - 1; j++) {
    for (let i = 1; i < SIZE - 1; i++) {
      const k = j * SIZE + i;
      if (water[k]) continue;
      const w = Math.max(water[k - 1], water[k + 1], water[k - SIZE], water[k + SIZE], water[k - SIZE - 1], water[k - SIZE + 1], water[k + SIZE - 1], water[k + SIZE + 1]);
      if (w > SEA && h[k] < w + 1.7) h[k] = w + 1.7;
    }
  }

  // 3. Zones and regions from the finished land.
  const heights = new Uint16Array(n);
  const zones = new Uint8Array(n);
  const regions = new Uint8Array(n);
  const lowRegion = LOWLANDS.map((l) => regionId(l.name));
  const lowShore = LOWLANDS.map((l) => regionId(l.shore));
  const [rRange, rPeaks, rVolcano] = ['The Frostspine', 'Frostspine Peaks', 'Mount Cinder'].map(regionId);
  const rIslets = ISLETS.map((b) => regionId(b.name));
  for (let j = 0; j < SIZE; j++) {
    const z = ORIGIN + j * CELL;
    for (let i = 0; i < SIZE; i++) {
      const x = ORIGIN + i * CELL;
      const k = j * SIZE + i;
      const y = h[k];
      heights[k] = Math.round(clamp01(y / 255.5) * 255.5 * 256);
      const lowland = LOWLANDS[low[k]];
      const vd = dist(x - VOLCANO.x, z - VOLCANO.z) + 50 * nFine.at(x / 150, z / 150);
      const cold = lowland.zone === Z.snow || y > 150;
      const snowline = 172 + 9 * nFine.at(x / 210, z / 210);
      let islet = -1;
      if (shore[k] > -40) for (let b = 0; b < ISLETS.length; b++) if (dist(x - ISLETS[b].x, z - ISLETS[b].z) < ISLETS[b].r + 150) islet = b;
      let zone: number;
      let region = lowRegion[low[k]];
      if (water[k]) {
        zone = lavaAt[k] ? Z.lava : cold ? Z.frozenRiver : Z.river;
        if (lakeAt[k]) region = lakeAt[k];
        else if (lavaAt[k]) region = rVolcano;
      } else if (y < 61.9 && shore[k] < 0) {
        zone = Z.ocean;
        region = 0;
      } else if (vd < 600 && (y > 64.5 || vd < 540)) {
        zone = Z.volcano;
        region = rVolcano;
      } else if (y > snowline) {
        zone = Z.snow;
        region = rPeaks;
      } else if (env[k] > 0.3 && y > 102) {
        zone = Z.mountain;
        region = rRange;
      } else if (lowland.zone === Z.snow) {
        zone = Z.snow;
        if (shore[k] < beach[k]) region = lowShore[low[k]];
      } else if (shore[k] < beach[k] && y < 66.4) {
        zone = Z.beach;
        region = lowShore[low[k]];
      } else {
        zone = lowland.zone;
      }
      if (zone !== Z.ocean && islet >= 0) region = rIslets[islet];
      zones[k] = zone;
      regions[k] = region;
    }
  }
  return { heights, zones, water, regions };
}

let built: IslandMap | undefined;
/** The island's grids, built the first time they're asked for and kept. */
export function islandMap(): IslandMap {
  return (built ??= buildIsland());
}

/** The rivers' and lakes' names and where to find them, for the map and the points of interest. */
export const WATERS = RIVERS.flatMap((r) => [
  { name: r.name, kind: r.lava ? 'lava' : 'river', ...r.path[Math.floor(r.path.length / 2)] },
  ...(r.lakes ?? []).map((l) => ({ name: l.name, kind: r.lava ? 'lava' : 'lake', ...r.path[l.at] })),
]);
