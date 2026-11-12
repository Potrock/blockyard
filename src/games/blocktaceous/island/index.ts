import { LANDMARKS } from './landmarks';
import type { BiomeId } from '../species';
import { CELL, ISLETS, ORIGIN, REGION_NAMES, SEA, SIZE, VOLCANO, WATERS, islandMap } from './map';
import { ZONE_BIOME } from './zones';

/**
 * The island, as the rest of the game asks about it. Pure functions of the map (no game context),
 * so the server's rules, the shared definition and every screen get the same answers. The map is
 * built the first time anything asks (about half a second) and kept.
 */

/** The map's extent in the world: outside it there is only sea. */
export const MAP = { minX: ORIGIN, minZ: ORIGIN, maxX: ORIGIN + (SIZE - 1) * CELL, maxZ: ORIGIN + (SIZE - 1) * CELL, cell: CELL, size: SIZE, seaLevel: SEA };

/** The sample nearest a column, or -1 beyond the map. */
function sampleAt(x: number, z: number): number {
  const i = Math.round((x - ORIGIN) / CELL);
  const j = Math.round((z - ORIGIN) / CELL);
  return i < 0 || j < 0 || i >= SIZE || j >= SIZE ? -1 : j * SIZE + i;
}

/** The biome at a column. */
export function biomeAt(x: number, z: number): BiomeId {
  const k = sampleAt(x, z);
  return k < 0 ? 'ocean' : ZONE_BIOME[islandMap().zones[k]];
}

/**
 * The ground's height at a column, as the map has it: the sea bed under the sea, a river's bed
 * under a river. The world's own `surfaceY` is exact (the generator adds a block or two of fine
 * noise, more in the mountains).
 */
export function groundAt(x: number, z: number): number {
  const { heights } = islandMap();
  const gx = Math.min(SIZE - 1.001, Math.max(0, (x - ORIGIN) / CELL));
  const gz = Math.min(SIZE - 1.001, Math.max(0, (z - ORIGIN) / CELL));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const k = j * SIZE + i;
  const tx = gx - i;
  const top = heights[k] + (heights[k + 1] - heights[k]) * tx;
  const bottom = heights[k + SIZE] + (heights[k + SIZE + 1] - heights[k + SIZE]) * tx;
  return (top + (bottom - top) * (gz - j)) / 256;
}

/**
 * The level of the water (or lava) over a column: the y of its top block, or null on dry land.
 * The sea is at `MAP.seaLevel`; rivers and lakes stand higher.
 */
export function waterAt(x: number, z: number): number | null {
  const k = sampleAt(x, z);
  if (k < 0) return SEA;
  const m = islandMap();
  if (m.water[k]) return m.water[k];
  return m.heights[k] / 256 < SEA ? SEA : null;
}

/** Whether a column is dry land (not sea, river, lake or lava). */
export function isLand(x: number, z: number): boolean {
  return waterAt(x, z) === null;
}

/** A named region of the island for the HUD ("The Sunken Marsh"), or null out at sea. */
export function regionAt(x: number, z: number): string | null {
  const k = sampleAt(x, z);
  return k < 0 ? null : REGION_NAMES[islandMap().regions[k]];
}

/**
 * The nearest shore to a point: where land meets the sea, searching outward up to `reach` blocks.
 * Null if there is none that near (far inland, or far out at sea).
 */
export function nearestShore(x: number, z: number, reach = 400): { x: number; z: number } | null {
  const land = (px: number, pz: number) => groundAt(px, pz) >= SEA;
  const here = land(x, z);
  for (let r = CELL; r <= reach; r += CELL) {
    const steps = Math.max(8, Math.round((r * 6.3) / CELL));
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (land(px, pz) !== here) return { x: Math.round(px), z: Math.round(pz) };
    }
  }
  return null;
}

/** Where new survivors wash up: beaches along the island's gentle southern shore. */
export const SPAWNS: { x: number; z: number; name: string }[] = [
  { x: 0, z: 2248, name: 'Castaway Shore' },
  { x: 200, z: 2328, name: 'Castaway Shore' },
  { x: -496, z: 2480, name: 'Castaway Shore' },
  { x: -696, z: 2504, name: 'Castaway Shore' },
  { x: -1000, z: 2408, name: 'Castaway Shore' },
  { x: 704, z: 1856, name: 'Castaway Shore' },
  { x: 1200, z: 1768, name: 'Parrot Strand' },
  { x: 1704, z: 1880, name: 'Parrot Strand' },
];

/** The island's named regions, each with its biome and a point well inside it. */
export const REGIONS: { name: string; biome: BiomeId; x: number; z: number }[] = [
  { name: 'Skyglass Tarn', biome: 'river', x: -72, z: -1328 },
  { name: 'Mirror Lake', biome: 'river', x: 176, z: 376 },
  { name: 'Stillpool', biome: 'river', x: -1520, z: -296 },
  { name: 'Tangle Pool', biome: 'river', x: 1640, z: 416 },
  { name: 'The Cauldron', biome: 'volcano', x: 2080, z: -1784 },
  { name: 'Windrow Plains', biome: 'grassland', x: -48, z: 1400 },
  { name: 'Highmeadow', biome: 'grassland', x: -56, z: -272 },
  { name: 'The Emerald Tangle', biome: 'jungle', x: 1568, z: 904 },
  { name: 'The Sunken Marsh', biome: 'swamp', x: -1344, z: 1208 },
  { name: 'Titan Grove', biome: 'redwood', x: -1640, z: -360 },
  { name: 'The Red Mesas', biome: 'badlands', x: 1648, z: -552 },
  { name: 'The White Reach', biome: 'snow', x: -672, z: -2160 },
  { name: 'Castaway Shore', biome: 'beach', x: -176, z: 2272 },
  { name: 'Parrot Strand', biome: 'beach', x: 2016, z: 1408 },
  { name: 'Mudflat Reach', biome: 'beach', x: -1736, z: 1296 },
  { name: 'Driftwood Coast', biome: 'beach', x: -2120, z: 96 },
  { name: 'Rustwater Shore', biome: 'beach', x: 2672, z: -576 },
  { name: 'Icewind Shore', biome: 'snow', x: 24, z: -2112 },
  { name: 'The Frostspine', biome: 'mountain', x: -480, z: -1344 },
  { name: 'Frostspine Peaks', biome: 'snow', x: -960, z: -1544 },
  { name: 'Mount Cinder', biome: 'volcano', x: 2056, z: -1736 },
  { name: 'The Pups', biome: 'grassland', x: -424, z: 2896 },
  { name: 'Gull Rock', biome: 'redwood', x: -3136, z: -496 },
  { name: 'Ember Isle', biome: 'badlands', x: 3040, z: -1224 },
  { name: 'Turtle Key', biome: 'jungle', x: 1816, z: 2424 },
];

/**
 * Places worth finding, for the map and for the other parts' rules: the volcano, the waters, the
 * islets, and the landmarks (`LANDMARKS` has more about each of those: its kind, reach and a spot inside).
 */
export const POINTS: { name: string; kind: 'peak' | 'volcano' | 'lake' | 'river' | 'lava' | 'islet' | 'landmark'; x: number; z: number }[] = [
  { name: 'Mount Cinder', kind: 'volcano', ...VOLCANO },
  ...WATERS.map((w) => ({ name: w.name, kind: w.kind as 'lake' | 'river' | 'lava', x: w.x, z: w.z })),
  ...ISLETS.filter((b, i, all) => all.findIndex((o) => o.name === b.name) === i).map((b) => ({ name: b.name, kind: 'islet' as const, x: b.x, z: b.z })),
  ...LANDMARKS.map((l) => ({ name: l.name, kind: 'landmark' as const, x: l.x, z: l.z })),
];

export { islandMap, type IslandMap } from './map';
export { ZONE_BIOME, ZONE_COLOR } from './zones';
export { LANDMARKS, landmarkAt, type Landmark, type LandmarkKind } from './landmarks';
