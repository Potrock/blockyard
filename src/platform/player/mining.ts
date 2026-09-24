import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Registry } from '../world/registry';
import type { Input } from './input';

export interface MiningTarget {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  id: number;
}

export interface MiningHooks {
  /** Seconds to mine this block with what's held (Infinity = can't). */
  breakTime(t: MiningTarget): number;
  /** Actually break it (rules, debris, events). */
  breakBlock(t: MiningTarget): boolean;
  /** Place block `id` against the target face; true if placed (the caller takes the item). */
  place(x: number, y: number, z: number, id: number): boolean;
  /** Arm swing while mining / placing. */
  swing(): void;
  /** Mining progress 0..1 for the HUD, or null. */
  progress(f: number | null): void;
}

const REACH = 4.6;

/**
 * Survival-style block interaction for item games: hold left-click to mine the targeted block
 * over its break time, right-click with a block item to place it against the face you're aiming at.
 */
export class Mining {
  target: MiningTarget | null = null;
  readonly outline: THREE.LineSegments;
  private progress = 0;
  private key = '';
  private swingT = 0;
  private placeT = 0;
  private dir = new THREE.Vector3();

  constructor(
    private world: VoxelWorld,
    private registry: Registry,
    private hooks: MiningHooks,
  ) {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    this.outline.matrixAutoUpdate = false;
    this.outline.visible = false;
    this.outline.renderOrder = 10;
  }

  /** Aim: the block under the crosshair within reach. */
  aim(camera: THREE.PerspectiveCamera) {
    camera.getWorldDirection(this.dir);
    const p = camera.position;
    const r = this.world.raycast(p.x, p.y, p.z, this.dir.x, this.dir.y, this.dir.z, REACH);
    this.target = r[0] ? { x: r[1], y: r[2], z: r[3], nx: r[4], ny: r[5], nz: r[6], id: r[7] } : null;
    return this.target;
  }

  /**
   * Per frame. `mine`: left-click mines (not while aiming at a mob or drawing a bow). `placeId`:
   * the block the held item places, if any (and right-click wasn't used for something else).
   */
  update(dt: number, input: Input, active: boolean, opts: { mine: boolean; placeId: number | null; showOutline: boolean }) {
    const t = this.target;
    this.placeT = Math.max(0, this.placeT - dt);
    if (t && opts.showOutline) {
      const def = this.registry.blocks[t.id];
      const cross = def?.shape === 'cross';
      const s = cross ? 0.72 : 1;
      this.outline.matrix.makeScale(s, cross ? 0.9 : 1, s).setPosition(t.x + 0.5, t.y + (cross ? 0.45 : 0.5), t.z + 0.5);
      this.outline.matrixWorld.copy(this.outline.matrix);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }

    // Mining: progress accumulates while held on the same block.
    const key = t ? `${t.x},${t.y},${t.z}` : '';
    if (!active || !opts.mine || !t || !input.button(0)) {
      this.reset();
    } else {
      if (key !== this.key) {
        this.key = key;
        this.progress = 0;
      }
      const time = this.hooks.breakTime(t);
      if (Number.isFinite(time)) {
        this.progress += time <= 0 ? 1 : dt / time;
        this.swingT -= dt;
        if (this.swingT <= 0) {
          this.swingT = 0.25;
          this.hooks.swing();
        }
        if (this.progress >= 1) {
          this.hooks.breakBlock(t);
          this.reset();
          // A short pause before the next block, like Minecraft.
          this.swingT = 0.15;
        } else {
          this.hooks.progress(this.progress);
        }
      } else {
        this.hooks.progress(null);
        if (input.buttonPressed(0)) this.hooks.swing();
      }
    }

    // Placing against the aimed face.
    if (active && t && opts.placeId !== null && (input.buttonPressed(2) || (input.button(2) && this.placeT <= 0))) {
      const hit = this.registry.blocks[t.id];
      const [x, y, z] = hit?.replaceable ? [t.x, t.y, t.z] : [t.x + t.nx, t.y + t.ny, t.z + t.nz];
      this.placeT = input.buttonPressed(2) ? 0.25 : 0.18;
      if (this.hooks.place(x, y, z, opts.placeId)) this.hooks.swing();
    }
  }

  private reset() {
    if (this.key || this.progress > 0) this.hooks.progress(null);
    this.key = '';
    this.progress = 0;
  }
}

/** A Minecraft-like default time (seconds, bare-handed-ish) to mine a block, by material. */
export function defaultBreakTime(name: string, shape: string): number {
  if (name === 'bedrock') return Infinity;
  if (shape === 'cross' || shape === 'liquid') return shape === 'liquid' ? Infinity : 0;
  if (name.endsWith('_bed')) return 0.35;
  if (name.endsWith('_wool') || name.endsWith('_leaves') || name === 'glass' || name === 'glowstone' || name === 'sea_lantern') return 0.4;
  if (/^(dirt|sand|gravel|grass_block|snowy_grass|podzol|clay|snow_block)$/.test(name)) return 0.7;
  if (/(planks|_log|bookshelf)$/.test(name)) return 1.5;
  if (name === 'obsidian') return 12;
  if (name === 'end_stone') return 3;
  return 2.2;
}
