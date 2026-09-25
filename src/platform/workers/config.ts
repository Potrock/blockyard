import type { TerrainGen } from '@engine/voxel_engine.js';
import type { WorldGenConfig } from './protocol';

/** Apply a game's world configuration to a generator (workers and the main thread). */
export function applyWorldConfig(gen: TerrainGen, cfg: WorldGenConfig) {
  if (cfg.flat !== undefined) gen.set_flat(cfg.flat);
  if (cfg.void) gen.set_void();
  if (cfg.void && cfg.ground) gen.set_void_ground(cfg.ground.y, cfg.ground.top, cfg.ground.fill, cfg.ground.depth);
  for (const t of cfg.terraforms) gen.add_terraform(t.x, t.z, t.radius, t.blend, t.height);
  for (const b of cfg.blueprints) gen.add_blueprint(b.origin.x, b.origin.y, b.origin.z, b.size.x, b.size.y, b.size.z, b.data);
}
