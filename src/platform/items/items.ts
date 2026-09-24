import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { AtlasPixels, GameContext, GameEvents, InventoryApi, ItemApi, ItemDefinition, ItemStack, Pickup, Vec3 } from '../api/types';
import type { EntityGraphics } from '../render/entities';
import type { Sfx } from '../audio/sfx';
import { Shaders } from '../render/shaders';

export interface ItemServices {
  world: VoxelWorld;
  graphics: EntityGraphics;
  scene: THREE.Scene;
  fxScene: THREE.Scene;
  sfx: Sfx;
  ctx(): GameContext;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
  playerPos(): Vec3;
  isSolid(x: number, y: number, z: number): boolean;
  /** A small lit cube of a block, placed in the scene (block items lying on the ground). */
  blockModel(block: string, size: number): { object: THREE.Object3D; remove(): void };
}

export class Inventory implements InventoryApi {
  readonly slots: (ItemStack | null)[] = new Array(9).fill(null);
  selected = 0;
  onChange: (() => void) | null = null;

  constructor(private defs: Map<string, ItemDefinition>) {}

  get held(): ItemStack | null {
    return this.slots[this.selected];
  }

  private max(item: string): number {
    const d = this.defs.get(item);
    return d?.stack ?? (d && (d.kind === 'melee' || d.kind === 'bow') ? 1 : 64);
  }

  give(item: string, count = 1): number {
    let left = count;
    const max = this.max(item);
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.item === item && s.count < max) {
        const n = Math.min(max - s.count, left);
        s.count += n;
        left -= n;
      }
    }
    // Full inventory: a better weapon replaces the weakest weapon of lower rank.
    const def = this.defs.get(item);
    if (left > 0 && def && (def.kind === 'melee' || def.kind === 'bow') && !this.slots.includes(null)) {
      let worst = -1;
      let worstRank = def.rank ?? 0;
      this.slots.forEach((s, i) => {
        const d = s ? this.defs.get(s.item) : undefined;
        if (d && d.kind === def.kind && (d.rank ?? 0) < worstRank) {
          worstRank = d.rank ?? 0;
          worst = i;
        }
      });
      if (worst >= 0) this.slots[worst] = null;
    }
    for (let i = 0; i < 9 && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(max, left);
        this.slots[i] = { item, count: n };
        left -= n;
        // Auto-equip strictly better weapons.
        const def = this.defs.get(item);
        const cur = this.held ? this.defs.get(this.held.item) : undefined;
        if (def && (def.kind === 'melee' || def.kind === 'bow') && (!cur || (def.rank ?? 0) > (cur.rank ?? 0))) this.selected = i;
      }
    }
    this.onChange?.();
    return left;
  }

  take(item: string, count = 1): boolean {
    if (this.count(item) < count) return false;
    let left = count;
    for (let i = 8; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.item === item) {
        const n = Math.min(s.count, left);
        s.count -= n;
        left -= n;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    this.onChange?.();
    return true;
  }

  /** Use up `count` of the held stack (placing a block, eating). */
  takeHeld(count = 1): boolean {
    const s = this.slots[this.selected];
    if (!s || s.count < count) return false;
    s.count -= count;
    if (s.count === 0) this.slots[this.selected] = null;
    this.onChange?.();
    return true;
  }

  count(item: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.item === item) n += s.count;
    return n;
  }

  select(slot: number) {
    this.selected = ((slot % 9) + 9) % 9;
    this.onChange?.();
  }

  clear() {
    this.slots.fill(null);
    this.selected = 0;
    this.onChange?.();
  }
}

class PickupImpl implements Pickup {
  vel: THREE.Vector3;
  age = 0;
  settled = false;
  removed = false;
  collectT = -1;
  constructor(
    readonly id: number,
    readonly item: string,
    readonly count: number,
    readonly pos: THREE.Vector3,
    readonly group: THREE.Object3D,
    readonly fx: THREE.Object3D[],
    readonly dispose: (() => void) | null,
    readonly despawn: number,
    velocity: Vec3 | undefined,
    private onRemove: (p: PickupImpl) => void,
  ) {
    this.vel = new THREE.Vector3(velocity?.x ?? 0, velocity?.y ?? 0, velocity?.z ?? 0);
  }
  get position(): Vec3 {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
  get alive(): boolean {
    return !this.removed;
  }
  remove() {
    if (!this.removed) {
      this.removed = true;
      this.onRemove(this);
    }
  }
}

function fxMaterial(color: string, mode: number, intensity: number) {
  return new THREE.RawShaderMaterial({
    vertexShader: Shaders.fx.vertex,
    fragmentShader: Shaders.fx.fragment,
    glslVersion: THREE.GLSL3,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uTime: { value: 0 }, uMode: { value: mode } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

export class ItemSystem implements ItemApi {
  readonly defs = new Map<string, ItemDefinition>();
  readonly inventory: Inventory;
  private pickups: PickupImpl[] = [];
  private nextId = 1;
  private materials = new Map<string, THREE.RawShaderMaterial>();
  private beamGeo = new THREE.PlaneGeometry(0.9, 7).translate(0, 3.5, 0);
  private haloGeo = new THREE.PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2);
  private time = 0;

  constructor(private s: ItemServices) {
    this.inventory = new Inventory(this.defs);
  }

  define(id: string, def: ItemDefinition) {
    this.defs.set(id, def);
  }

  get(id: string): ItemDefinition | undefined {
    return this.defs.get(id);
  }

  /** Ids of the defined items. */
  ids(): string[] {
    return [...this.defs.keys()];
  }

  atlas(name: string, source: HTMLCanvasElement | OffscreenCanvas | AtlasPixels) {
    if ('pixels' in source) this.s.graphics.addAtlas(name, source.width, source.height, source.pixels, source.emissive);
    else this.s.graphics.addCanvasAtlas(name, source);
  }

  private material(atlas: string): THREE.RawShaderMaterial {
    let m = this.materials.get(atlas);
    if (!m) {
      m = this.s.graphics.material(atlas);
      this.materials.set(atlas, m);
    }
    return m;
  }

  spawnPickup(item: string, at: Vec3, opts: { count?: number; velocity?: Vec3; beam?: string; despawn?: number } = {}): Pickup {
    const def = this.defs.get(item);
    if (!def) throw new Error(`items.spawnPickup: unknown item "${item}"`);
    let group: THREE.Object3D;
    let dispose: (() => void) | null = null;
    if (def.kind === 'block' && !def.icon) {
      // Block items drop as little cubes of the block.
      const cube = this.s.blockModel(def.block, 0.3);
      group = cube.object;
      dispose = cube.remove;
    } else {
      const { geometry, atlas } = this.s.graphics.spriteGeometry(def.icon!);
      const mesh = new THREE.Mesh(geometry, this.material(atlas));
      mesh.customDepthMaterial = this.s.graphics.shadowMaterial(atlas);
      mesh.scale.setScalar(0.62);
      group = new THREE.Group();
      group.add(mesh);
      this.s.scene.add(group);
    }
    group.position.set(at.x, at.y, at.z);
    const fx: THREE.Object3D[] = [];
    const halo = new THREE.Mesh(this.haloGeo, fxMaterial(opts.beam ?? '#fff3c4', 2, opts.beam ? 1.6 : 0.6));
    halo.frustumCulled = false;
    this.s.fxScene.add(halo);
    fx.push(halo);
    if (opts.beam) {
      for (let k = 0; k < 2; k++) {
        const beam = new THREE.Mesh(this.beamGeo, fxMaterial(opts.beam, 0, 1.3));
        beam.rotation.y = k * Math.PI * 0.5;
        beam.frustumCulled = false;
        this.s.fxScene.add(beam);
        fx.push(beam);
      }
    }
    const p = new PickupImpl(this.nextId++, item, opts.count ?? 1, new THREE.Vector3(at.x, at.y, at.z), group, fx, dispose, opts.despawn ?? 90, opts.velocity, (x) => this.drop(x));
    this.pickups.push(p);
    return p;
  }

  private drop(p: PickupImpl) {
    if (p.dispose) p.dispose();
    else p.group.removeFromParent();
    for (const f of p.fx) {
      f.removeFromParent();
      ((f as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.pickups.splice(this.pickups.indexOf(p), 1);
  }

  clearPickups() {
    for (const p of [...this.pickups]) p.remove();
  }

  update(dt: number, running: boolean) {
    this.time += dt;
    const pl = this.s.playerPos();
    const ctx = this.s.ctx();
    for (const p of [...this.pickups]) {
      if (running) p.age += dt;
      if (p.age > p.despawn) {
        p.remove();
        continue;
      }
      // Fall and settle 0.3 above the ground.
      if (running && !p.settled) {
        p.vel.y -= 22 * dt;
        p.pos.addScaledVector(p.vel, dt);
        p.vel.x *= Math.exp(-2 * dt);
        p.vel.z *= Math.exp(-2 * dt);
        if (this.s.isSolid(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.3), Math.floor(p.pos.z))) {
          p.pos.y = Math.floor(p.pos.y - 0.3) + 1.3;
          p.vel.set(0, 0, 0);
          p.settled = true;
        }
      }
      const dx = pl.x - p.pos.x;
      const dy = pl.y + 0.9 - p.pos.y;
      const dz = pl.z - p.pos.z;
      const d = Math.hypot(dx, dy, dz);
      if (running && p.age > 0.5 && d < 3.2 && p.collectT < 0) {
        // Magnet toward the player, then collect.
        p.pos.x += (dx / d) * Math.min(d, dt * 9);
        p.pos.y += (dy / d) * Math.min(d, dt * 9);
        p.pos.z += (dz / d) * Math.min(d, dt * 9);
        p.settled = false;
        p.vel.set(0, 0, 0);
        if (d < 1.1) this.collect(p, ctx);
        if (p.removed) continue;
      }
      const bob = p.settled ? Math.sin(this.time * 2.5 + p.id) * 0.1 : 0;
      p.group.position.set(p.pos.x, p.pos.y + bob, p.pos.z);
      p.group.rotation.y = this.time * 1.8 + p.id;
      for (const f of p.fx) {
        f.position.set(p.pos.x, p.pos.y - 0.28, p.pos.z);
        ((f as THREE.Mesh).material as THREE.RawShaderMaterial).uniforms.uTime.value = this.time;
      }
    }
  }

  private collect(p: PickupImpl, ctx: GameContext) {
    const def = this.defs.get(p.item);
    if (!def) return p.remove();
    // Consumed on touch: the item's `onPickup` does its own thing (and sound).
    if (!def.onPickup?.(ctx, p.count)) {
      const left = this.inventory.give(p.item, p.count);
      if (left === p.count) return; // inventory full: leave it
      this.s.sfx.play('pickup');
      ctx.hud.toast(`+${p.count > 1 ? `${p.count} ` : ''}${def.name}`);
    }
    this.s.emit('pickup', { item: p.item, count: p.count });
    p.remove();
  }
}
