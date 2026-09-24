import * as THREE from 'three';
import type { ChunkManager } from '../world/chunks';
import type { Registry } from '../world/registry';
import { DEFAULT_TINT } from '../world/registry';
import type { Input } from './input';
import type { Particles } from '../render/particles';
import type { VoxelWorld } from '@engine/voxel_engine.js';

export interface Target {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  id: number;
}

const REACH = 6.5;

/** Block targeting, breaking, placing and picking. */
export class Interaction {
  target: Target | null = null;
  hotbar: number[];
  selected = 0;
  readonly outline: THREE.LineSegments;
  onHotbarChange: (() => void) | null = null;
  onEdit: (() => void) | null = null;
  onSwing: (() => void) | null = null;
  private breakTimer = 0;
  private placeTimer = 0;
  private dir = new THREE.Vector3();

  constructor(
    private chunks: ChunkManager,
    private world: VoxelWorld,
    private registry: Registry,
    private particles: Particles,
    private albedo: Uint8Array,
  ) {
    const names = ['grass_block', 'stone', 'oak_planks', 'cobblestone', 'glass', 'oak_log', 'torch', 'glowstone', 'bricks'];
    this.hotbar = names.map((n) => registry.byName.get(n)?.id ?? 1);
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.outline.matrixAutoUpdate = false;
    this.outline.visible = false;
    this.outline.renderOrder = 10;
  }

  get selectedBlock(): number {
    return this.hotbar[this.selected];
  }

  select(i: number) {
    this.selected = ((i % 9) + 9) % 9;
    this.onHotbarChange?.();
  }

  setSlot(i: number, id: number) {
    this.hotbar[i] = id;
    this.onHotbarChange?.();
  }

  update(dt: number, camera: THREE.PerspectiveCamera, input: Input, active: boolean) {
    this.breakTimer = Math.max(0, this.breakTimer - dt);
    this.placeTimer = Math.max(0, this.placeTimer - dt);
    camera.getWorldDirection(this.dir);
    const p = camera.position;
    const r = this.world.raycast(p.x, p.y, p.z, this.dir.x, this.dir.y, this.dir.z, REACH);
    this.target = r[0] ? { x: r[1], y: r[2], z: r[3], nx: r[4], ny: r[5], nz: r[6], id: r[7] } : null;

    const t = this.target;
    if (t) {
      const def = this.registry.blocks[t.id];
      const cross = def?.shape === 'cross';
      const s = cross ? 0.72 : 1;
      this.outline.matrix.makeScale(s, cross ? 0.9 : 1, s).setPosition(t.x + 0.5, t.y + (cross ? 0.45 : 0.5), t.z + 0.5);
      this.outline.matrixWorld.copy(this.outline.matrix);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
    if (!active) return;

    if (input.wheel !== 0) this.select(this.selected + input.wheel);
    for (let i = 0; i < 9; i++) if (input.pressed(`Digit${i + 1}`)) this.select(i);

    if (input.buttonPressed(0)) this.onSwing?.();
    if (t && (input.buttonPressed(0) || (input.button(0) && this.breakTimer <= 0))) {
      if (!input.buttonPressed(0)) this.onSwing?.();
      this.breakBlock(t);
      this.breakTimer = input.buttonPressed(0) ? 0.3 : 0.22;
    }
    if (t && (input.buttonPressed(2) || (input.button(2) && this.placeTimer <= 0))) {
      this.onSwing?.();
      this.place(t);
      this.placeTimer = input.buttonPressed(2) ? 0.3 : 0.2;
    }
    if (t && input.buttonPressed(1)) {
      const def = this.registry.blocks[t.id];
      if (def?.placeable) {
        const at = this.hotbar.indexOf(t.id);
        if (at >= 0) this.select(at);
        else this.setSlot(this.selected, t.id);
      }
    }
  }

  private breakBlock(t: Target) {
    const def = this.registry.blocks[t.id];
    if (!def || def.name === 'bedrock') return;
    if (this.chunks.editBlock(t.x, t.y, t.z, 0)) {
      const face = def.tex[0];
      const pixels = this.albedo.subarray(face * 1024, face * 1024 + 1024);
      this.particles.burst(t.x, t.y, t.z, pixels, def.tint ? DEFAULT_TINT : null);
      // Plants and torches resting on the broken block fall with it.
      const above = this.world.get_block(t.x, t.y + 1, t.z);
      const adef = this.registry.blocks[above];
      if (adef && adef.shape === 'cross') this.chunks.editBlock(t.x, t.y + 1, t.z, 0);
      this.onEdit?.();
    }
  }

  private place(t: Target) {
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
    if (this.chunks.editBlock(x, y, z, id)) this.onEdit?.();
  }
}
