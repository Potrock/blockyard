import { VoxelWorld } from '@engine/voxel_engine.js';
import { check, launch } from './_harness';

/**
 * A save made the way the browser makes one: the client's copy of the world mirrors every edit
 * the host sends (here it has no terrain loaded at all), the save comes from that copy, and a new
 * host continues from it with the blocks and the player where they were.
 */
export default function saves() {
  const h = launch('sandbox', { seed: 9 });
  const mirror = new VoxelWorld();
  const follow = () => {
    for (const e of h.step(1 / 60).events) if (e.t === 'edits') for (const [x, y, z, id] of e.cells) mirror.mirror_block(x, y, z, id);
  };
  follow();
  const world = h.ctx.world;
  const me = h.me.state;
  const x = Math.floor(me.x) + 3;
  const z = Math.floor(me.z) + 2;
  const top = world.surfaceY(x, z);
  check(world.setBlock(x, top + 1, z, 'glowstone'), 'placing glowstone failed');
  check(world.setBlock(x, top, z, 'air'), 'digging failed');
  for (let i = 0; i < 10; i++) follow();
  h.me.api.teleport({ x: me.x + 5, y: me.y + 4, z: me.z - 3 }, 1.2, -0.2);
  follow();

  const save = { edits: mirror.export_edits(), player: [me.x, me.y, me.z, h.me.yaw, h.me.pitch] as [number, number, number, number, number], flying: false, time: 0.6 };
  const h2 = launch('sandbox', { seed: 9, save });
  const w2 = h2.ctx.world;
  check(w2.blockName(w2.getBlock(x, top + 1, z)) === 'glowstone', `glowstone missing after load: ${w2.blockName(w2.getBlock(x, top + 1, z))}`);
  check(w2.blockName(w2.getBlock(x, top, z)) === 'air', 'the dug block came back');
  const p = h2.me.state;
  check(Math.hypot(p.x - save.player[0], p.z - save.player[2]) < 0.01 && Math.abs(h2.me.yaw - 1.2) < 1e-9, `player not restored: ${p.x},${p.z} yaw ${h2.me.yaw}`);
  console.log(`  ${mirror.edit_count()} edits mirrored with no terrain loaded, saved, loaded into a new host: blocks and player restored`);
}
