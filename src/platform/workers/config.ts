import type { TerrainGen } from '@engine/voxel_engine.js';
import type { BlockRef, SharedDefinition, TerrainMap } from '../api/types';
import type { WorldGenConfig } from './protocol';

/**
 * A game's world settings as the terrain generator takes them: the same on every screen (its
 * terrain workers) and on the server (its own copy of the world).
 */
export function worldGenConfig(def: Pick<SharedDefinition, 'world'>, blockId: (b: BlockRef) => number): WorldGenConfig {
  const w = def.world ?? {};
  return {
    flat: w.terrain === 'flat' ? (w.flatHeight ?? 64) : undefined,
    void: w.terrain === 'void',
    ground: w.terrain === 'void' && w.ground ? { y: w.ground.y, top: blockId(w.ground.top ?? 'grass_block'), fill: blockId(w.ground.fill ?? 'dirt'), depth: w.ground.depth ?? 4 } : undefined,
    terraforms: w.terraform ?? [],
    map: w.terrain === 'map' && w.map ? mapConfig(typeof w.map === 'function' ? w.map() : w.map, blockId) : undefined,
    blueprints: (w.structures ?? []).map((s) => s.build(blockId)),
  };
}

const TREE_SHAPES = ['oak', 'spruce', 'broad', 'column', 'palm', 'jungle', 'giant', 'dead', 'bush'];
const SCATTER_WHERE = ['on', 'in', 'under'];

/** `'#6ab045'` as [r, g, b]. */
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`world.map: "${hex}" isn't a colour like #6ab045`);
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** A game's terrain map as the engine takes it: the grids as they are, the palette with its blocks' ids. */
function mapConfig(map: TerrainMap, blockId: (b: BlockRef) => number): NonNullable<WorldGenConfig['map']> {
  const n = map.width * map.depth;
  if (map.heights.length !== n || map.zones.length !== n || (map.water && map.water.length !== n)) throw new Error(`world.map: heights, zones and water need width x depth (${n}) samples each`);
  const id = (b: BlockRef | undefined) => (b === undefined ? undefined : blockId(b));
  const palette = map.palette.map((z) => ({
    top: id(z.surface?.top),
    fill: id(z.surface?.fill),
    depth: z.surface?.depth,
    steep: id(z.surface?.steep),
    steepness: z.surface?.steepness,
    bed: id(z.surface?.bed),
    strata: z.surface?.strata?.map(blockId),
    liquid: id(z.liquid),
    frozen: z.frozen,
    grass: z.grass ? rgb(z.grass) : undefined,
    roughness: z.roughness,
    crags: z.crags,
    trees: z.trees?.map((t) => ({ shape: Math.max(0, TREE_SHAPES.indexOf(t.shape)), log: id(t.log), leaves: id(t.leaves), h: t.height, density: t.density, wet: t.wet })),
    scatter: z.scatter?.map((s) => ({ block: blockId(s.block), density: s.density, where: Math.max(0, SCATTER_WHERE.indexOf(s.where ?? 'on')), size: s.size, clumps: s.clumps })),
  }));
  return {
    x: map.origin.x,
    z: map.origin.z,
    cell: map.cell,
    width: map.width,
    depth: map.depth,
    heights: map.heights,
    zones: map.zones,
    water: map.water ?? new Uint8Array(0),
    outsideHeight: map.outside?.height ?? 30,
    outsideZone: map.outside?.zone ?? 0,
    palette: JSON.stringify(palette),
  };
}

/** Apply a game's world configuration to a generator (workers and the main thread). */
export function applyWorldConfig(gen: TerrainGen, cfg: WorldGenConfig) {
  if (cfg.flat !== undefined) gen.set_flat(cfg.flat);
  if (cfg.void) gen.set_void();
  if (cfg.void && cfg.ground) gen.set_void_ground(cfg.ground.y, cfg.ground.top, cfg.ground.fill, cfg.ground.depth);
  const m = cfg.map;
  if (m) gen.set_map(m.x, m.z, m.cell, m.width, m.depth, m.heights, m.zones, m.water, m.outsideHeight, m.outsideZone, m.palette);
  for (const t of cfg.terraforms) gen.add_terraform(t.x, t.z, t.radius, t.blend, t.height);
  for (const b of cfg.blueprints) gen.add_blueprint(b.origin.x, b.origin.y, b.origin.z, b.size.x, b.size.y, b.size.z, b.data);
}
