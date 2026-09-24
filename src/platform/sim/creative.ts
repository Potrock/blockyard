import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Registry } from '../world/registry';
import type { PlayerSim } from './player';
import type { Presentation } from './present';
import type { WorldHost } from './world';

const REACH = 6.5;

/**
 * Creative building (`player.build`): a hotbar of blocks, instant breaking and placing, and
 * middle-click to pick the block you're looking at.
 */
export class CreativeBuild {
  hotbar: number[];
  selected = 0;
  private breakTimer = 0;
  private placeTimer = 0;

  constructor(
    private host: WorldHost,
    private world: VoxelWorld,
    private registry: Registry,
    private present: Presentation,
    private player: PlayerSim,
    /** Break a block with debris and the plant on top (the simulation's `world.breakBlock`). */
    private breakBlock: (x: number, y: number, z: number) => boolean,
  ) {
    const names = ['grass_block', 'stone', 'oak_planks', 'cobblestone', 'glass', 'oak_log', 'torch', 'glowstone', 'bricks'];
    this.hotbar = names.map((n) => registry.byName.get(n)?.id ?? 1);
  }

  get selectedBlock(): number {
    return this.hotbar[this.selected];
  }

  select(i: number) {
    this.selected = ((i % 9) + 9) % 9;
  }

  /** The block picker: put a block in the current slot. */
  pick(id: number) {
    if (this.registry.blocks[id]?.placeable) this.hotbar[this.selected] = id;
  }

  private swing() {
    this.present.send(this.player.id, 'view', 'use', [1]);
  }

  update(dt: number) {
    this.breakTimer = Math.max(0, this.breakTimer - dt);
    this.placeTimer = Math.max(0, this.placeTimer - dt);
    const eye = this.player.eye;
    const d = this.player.look;
    const r = this.world.raycast(eye.x, eye.y, eye.z, d.x, d.y, d.z, REACH);
    const t = r[0] ? { x: r[1], y: r[2], z: r[3], nx: r[4], ny: r[5], nz: r[6], id: r[7] } : null;
    this.present.send(this.player.id, 'hud', 'highlight', [t && { x: t.x, y: t.y, z: t.z }]);
    const input = this.player.input;
    if (!input.active) return;

    if (input.wheel !== 0) this.select(this.selected + input.wheel);
    for (let i = 0; i < 9; i++) if (input.pressed(`Digit${i + 1}`)) this.select(i);

    if (input.buttonPressed(0)) this.swing();
    if (t && (input.buttonPressed(0) || (input.button(0) && this.breakTimer <= 0))) {
      if (!input.buttonPressed(0)) this.swing();
      const def = this.registry.blocks[t.id];
      if (def && def.name !== 'bedrock') this.breakBlock(t.x, t.y, t.z);
      this.breakTimer = input.buttonPressed(0) ? 0.3 : 0.22;
    }
    if (t && (input.buttonPressed(2) || (input.button(2) && this.placeTimer <= 0))) {
      this.swing();
      this.place(t);
      this.placeTimer = input.buttonPressed(2) ? 0.3 : 0.2;
    }
    if (t && input.buttonPressed(1)) {
      const def = this.registry.blocks[t.id];
      if (def?.placeable) {
        const at = this.hotbar.indexOf(t.id);
        if (at >= 0) this.select(at);
        else this.hotbar[this.selected] = t.id;
      }
    }
  }

  private place(t: { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number }) {
    const id = this.selectedBlock;
    const def = this.registry.blocks[id];
    if (!def) return;
    const hitDef = this.registry.blocks[t.id];
    let x = t.x + t.nx;
    let y = t.y + t.ny;
    let z = t.z + t.nz;
    if (hitDef?.replaceable) {
      x = t.x;
      y = t.y;
      z = t.z;
    }
    if (y < 0 || y > 255) return;
    const cur = this.world.get_block(x, y, z);
    const curDef = this.registry.blocks[cur];
    if (cur === 255 || (curDef && !curDef.replaceable)) return;
    if (def.solid && this.world.player_overlaps(x, y, z)) return;
    if (def.shape === 'cross') {
      const below = this.registry.blocks[this.world.get_block(x, y - 1, z)];
      if (!below || !below.solid) return;
    }
    this.host.edit(x, y, z, id);
  }
}
