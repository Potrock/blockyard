import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type {
  DamageOptions,
  Entity,
  EntityApi,
  EntityDefinition,
  GameContext,
  GameEvents,
  ProjectileSpec,
  Vec3,
} from '../api/types';
import { wasmMemory } from '../engine/wasm';
import type { EntityGraphics, AnimState, ModelInstance } from '../render/entities';
import type { Sfx } from '../audio/sfx';
import type { Effects } from '../fx/effects';
import type { GameHud } from '../ui/hudkit';
import { Shaders } from '../render/shaders';

let boltGeo: THREE.BufferGeometry[] | null = null;

/** Two crossed quads, 0.8 long along +X and 0.22 wide, with the bolt shader's UVs (v along the length). */
function boltGeometry(): THREE.BufferGeometry[] {
  if (!boltGeo) {
    const a = new THREE.PlaneGeometry(0.22, 0.8).rotateZ(-Math.PI / 2);
    boltGeo = [a, a.clone().rotateX(Math.PI / 2)];
  }
  return boltGeo;
}

function boltMaterial(color: string): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    vertexShader: Shaders.fx.vertex,
    fragmentShader: Shaders.fx.fragment,
    glslVersion: THREE.GLSL3,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 4 }, uTime: { value: 0 }, uMode: { value: 3 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// Mirrors engine/src/entities.rs.
const B = {
  X: 0, Y: 1, Z: 2, VX: 3, VY: 4, VZ: 5, HALF_W: 6, HEIGHT: 7, SPEED: 8, ACCEL: 9, JUMP_VEL: 10, GRAVITY: 11,
  WISH_X: 12, WISH_Z: 13, MODE: 14, WANT_JUMP: 15, FLAGS: 16, IMP_X: 17, IMP_Y: 18, IMP_Z: 19,
  TX: 20, TY: 21, TZ: 22, TARGET_KIND: 23, ON_GROUND: 24, IN_WATER: 25, LOS: 26, PATH_DIST: 27, DIST: 28,
  HEADING: 29, BLOCKED: 30, LANDED_SPEED: 31,
} as const;
const P = { X: 0, Y: 1, Z: 2, VX: 3, VY: 4, VZ: 5, GRAVITY: 6, DRAG: 7, RADIUS: 8, FLAGS: 9, OWNER: 10, AGE: 11, HIT_KIND: 12, HIT_INDEX: 13 } as const;
const FLAG_ACTIVE = 1;
const FLAG_SOLID = 2;
const FLAG_SWIM = 4;
const FLAG_GHOST = 8;
const PF_ACTIVE = 1;
const PF_HITS_PLAYER = 2;
const PF_HITS_BODIES = 4;
const PF_STUCK = 8;

export interface EntityServices {
  world: VoxelWorld;
  graphics: EntityGraphics;
  scene: THREE.Scene;
  sfx: Sfx;
  fx: Effects;
  hud: GameHud;
  ctx(): GameContext;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
  dropItem(item: string, at: Vec3, count: number): void;
  damagePlayer(amount: number, opts: DamageOptions): boolean;
  playerEye(): Vec3;
  playerPos(): Vec3;
  playerVel(): Vec3;
}

type Internal = ProjectileSpec & { crit?: boolean };

interface Projectile {
  slot: number;
  spec: Internal;
  owner: EntityImpl | 'player' | null;
  group: THREE.Group;
  stuckAt: number;
  material: THREE.RawShaderMaterial;
}

const tmpColor = new THREE.Color();

class EntityImpl implements Entity {
  readonly data: Record<string, unknown> = {};
  health: number;
  readonly maxHealth: number;
  armor = 0;
  alive = true;
  dyingTime = -1;
  age = 0;
  removed = false;
  readonly model: ModelInstance;
  readonly anim: AnimState = { walkPhase: 0, walkAmount: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0 };
  lookTarget: 'player' | Vec3 | null = null;
  yaw = 0;
  hurt = 0;
  glowColor: THREE.Color | null = null;
  probeTimer = Math.random() * 0.2;
  ambientTimer = 2 + Math.random() * 6;
  speedMul = 1;

  constructor(
    private m: EntityManager,
    readonly id: number,
    readonly type: string,
    readonly def: EntityDefinition,
    readonly slot: number,
  ) {
    this.health = def.health;
    this.maxHealth = def.health;
    this.model = m.s.graphics.buildModel(def.model);
  }

  private get o(): number {
    return this.slot * this.m.bodyStride;
  }

  get position(): Vec3 {
    const b = this.m.bodies;
    const o = this.o;
    return { x: b[o + B.X], y: b[o + B.Y], z: b[o + B.Z] };
  }

  get velocity(): Vec3 {
    const b = this.m.bodies;
    const o = this.o;
    return { x: b[o + B.VX], y: b[o + B.VY], z: b[o + B.VZ] };
  }

  get onGround(): boolean {
    return this.m.bodies[this.o + B.ON_GROUND] > 0.5;
  }

  get height(): number {
    return this.def.hitbox.height;
  }

  damage(amount: number, opts: DamageOptions = {}) {
    if (!this.alive || amount <= 0 || this.def.invulnerable) return;
    amount *= 1 - Math.min(20, Math.max(0, this.armor)) * 0.04;
    this.health = Math.max(0, this.health - amount);
    this.hurt = 1;
    const pos = this.position;
    const from = opts.from ?? (opts.source === 'player' ? this.m.s.playerPos() : typeof opts.source === 'object' ? opts.source.position : null);
    const kb = (opts.knockback ?? 1) * (1 - (this.def.knockbackResistance ?? 0));
    if (from && kb > 0) {
      const dx = pos.x - from.x;
      const dz = pos.z - from.z;
      const l = Math.hypot(dx, dz) || 1;
      this.impulse((dx / l) * 6.5 * kb, 4.5 * kb, (dz / l) * 6.5 * kb);
    }
    const top = { x: pos.x, y: pos.y + this.height * this.def.model.scale * 0.55 + 0.4, z: pos.z };
    this.m.s.fx.damageNumber({ x: top.x, y: top.y + 0.4, z: top.z }, amount, { crit: opts.crit });
    this.m.s.fx.burst({ x: pos.x, y: pos.y + this.height * 0.6, z: pos.z }, { color: this.def.bloodColor ?? '#b3261e', count: opts.crit ? 22 : 12, speed: 3.5, size: 0.08 });
    this.m.s.sfx.play(this.def.sounds?.hurt ?? 'mob_hurt', { at: pos, pitch: 0.9 + Math.random() * 0.2 });
    this.m.s.emit('entityDamage', { entity: this, amount, source: opts.source });
    if (this.health <= 0) this.die(opts.source);
  }

  heal(amount: number) {
    if (this.alive) this.health = Math.min(this.maxHealth, this.health + amount);
  }

  kill() {
    if (this.alive) {
      this.health = 0;
      this.die('world');
    }
  }

  private die(killer: DamageOptions['source']) {
    this.alive = false;
    this.dyingTime = 0;
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.FLAGS] = FLAG_ACTIVE | FLAG_GHOST;
    b[o + B.MODE] = 3;
    this.anim.raised = false;
    this.anim.casting = false;
    const pos = this.position;
    this.m.s.sfx.play(this.def.sounds?.death ?? 'mob_death', { at: pos });
    const ctx = this.m.s.ctx();
    for (const d of this.def.drops ?? []) {
      if (ctx.rng.chance(d.chance)) this.m.s.dropItem(d.item, { x: pos.x, y: pos.y + 0.6, z: pos.z }, d.count ?? 1);
    }
    this.m.s.emit('entityDeath', { entity: this, killer });
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.alive = false;
    this.m.release(this);
  }

  impulse(x: number, y: number, z: number) {
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.IMP_X] += x;
    b[o + B.IMP_Y] += y;
    b[o + B.IMP_Z] += z;
  }

  moveTo(target: 'player' | Vec3) {
    const b = this.m.bodies;
    const o = this.o;
    b[o + B.MODE] = 1;
    if (target === 'player') {
      b[o + B.TARGET_KIND] = 0;
    } else {
      b[o + B.TARGET_KIND] = 1;
      b[o + B.TX] = target.x;
      b[o + B.TY] = target.y;
      b[o + B.TZ] = target.z;
    }
  }

  moveDirection(x: number, z: number) {
    const b = this.m.bodies;
    const o = this.o;
    const l = Math.hypot(x, z);
    b[o + B.MODE] = 0;
    b[o + B.WISH_X] = l > 1 ? x / l : x;
    b[o + B.WISH_Z] = l > 1 ? z / l : z;
  }

  stop() {
    this.m.bodies[this.o + B.MODE] = 3;
  }

  jump() {
    this.m.bodies[this.o + B.WANT_JUMP] = 1;
  }

  lookAt(target: 'player' | Vec3 | null) {
    this.lookTarget = target;
  }

  canSeePlayer(): boolean {
    return this.m.bodies[this.o + B.LOS] > 0.5;
  }

  distanceToPlayer(): number {
    return this.m.bodies[this.o + B.DIST];
  }

  animate(name: 'attack' | 'raise' | 'cast' | 'none') {
    this.anim.raised = name === 'raise';
    this.anim.casting = name === 'cast';
    if (name === 'attack') this.anim.attackT = 0;
  }

  setSpeed(multiplier: number) {
    this.speedMul = multiplier;
    this.m.bodies[this.o + B.SPEED] = this.def.speed * multiplier;
  }

  glow(color: string | null) {
    this.glowColor = color ? new THREE.Color(color) : null;
  }

  shoot(spec: ProjectileSpec, target: 'player' | Vec3, opts: { spread?: number; lead?: boolean } = {}) {
    const p = this.position;
    const from = { x: p.x, y: p.y + this.height * 0.82 * Math.min(1.4, this.def.model.scale), z: p.z };
    let tp = target === 'player' ? { ...this.m.s.playerEye() } : { ...target };
    if (target === 'player') tp.y -= 0.35;
    const dist = Math.hypot(tp.x - from.x, tp.y - from.y, tp.z - from.z);
    const t = dist / spec.speed;
    if (opts.lead && target === 'player') {
      const v = this.m.s.playerVel();
      tp = { x: tp.x + v.x * t * 0.8, y: tp.y, z: tp.z + v.z * t * 0.8 };
    }
    const g = spec.gravity ?? 20;
    tp.y += 0.5 * g * t * t;
    let dx = tp.x - from.x;
    let dy = tp.y - from.y;
    let dz = tp.z - from.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const sp = opts.spread ?? 0;
    dx = dx / l + (Math.random() - 0.5) * sp * 2;
    dy = dy / l + (Math.random() - 0.5) * sp * 2;
    dz = dz / l + (Math.random() - 0.5) * sp * 2;
    // Start slightly in front of the shooter so it doesn't hit itself.
    const fl = Math.hypot(dx, dz) || 1;
    from.x += (dx / fl) * (this.def.hitbox.width * 0.6 + 0.2);
    from.z += (dz / fl) * (this.def.hitbox.width * 0.6 + 0.2);
    this.m.spawnProjectile(spec, from, { x: dx, y: dy, z: dz }, this);
  }
}

export class EntityManager implements EntityApi {
  readonly s: EntityServices;
  private _bodies: Float64Array = new Float64Array(0);
  private _projectiles: Float64Array = new Float64Array(0);
  readonly bodyStride: number;
  private readonly projStride: number;
  private readonly bodyCap: number;
  private readonly projCap: number;
  private types = new Map<string, EntityDefinition>();
  private list: EntityImpl[] = [];
  private bySlot: (EntityImpl | null)[];
  private freeBodies: number[] = [];
  private shots: (Projectile | null)[];
  private freeShots: number[] = [];
  private nextId = 1;
  private bossShown = false;
  private time = 0;
  private tmpV = new THREE.Vector3();
  private xAxis = new THREE.Vector3(1, 0, 0);

  constructor(services: EntityServices) {
    this.s = services;
    const w = services.world;
    this.bodyStride = w.body_stride();
    this.projStride = w.projectile_stride();
    this.bodyCap = w.body_capacity();
    this.projCap = w.projectile_capacity();
    this.bySlot = new Array(this.bodyCap).fill(null);
    this.shots = new Array(this.projCap).fill(null);
    for (let i = this.bodyCap - 1; i >= 0; i--) this.freeBodies.push(i);
    for (let i = this.projCap - 1; i >= 0; i--) this.freeShots.push(i);
    this.refreshViews();
  }

  /**
   * Views over the wasm body / projectile buffers. Any wasm allocation (chunk streaming, meshing
   * requests) can grow memory and detach old views, so every access re-validates.
   */
  get bodies(): Float64Array {
    this.refreshViews();
    return this._bodies;
  }

  get projectiles(): Float64Array {
    this.refreshViews();
    return this._projectiles;
  }

  private refreshViews() {
    const buf = wasmMemory().buffer;
    if (this._bodies.buffer !== buf || this._bodies.length === 0) {
      this._bodies = new Float64Array(buf, this.s.world.bodies_ptr(), this.bodyCap * this.bodyStride);
      this._projectiles = new Float64Array(buf, this.s.world.projectiles_ptr(), this.projCap * this.projStride);
    }
  }

  /** Names of the defined entity types. */
  typeNames(): string[] {
    return [...this.types.keys()];
  }

  define(type: string, def: EntityDefinition) {
    this.types.set(type, def);
  }

  spawn(type: string, at: Vec3, opts: { yaw?: number; data?: Record<string, unknown> } = {}): Entity {
    const def = this.types.get(type);
    if (!def) throw new Error(`entities.spawn: unknown type "${type}"`);
    const slot = this.freeBodies.pop();
    if (slot === undefined) throw new Error('entities.spawn: entity limit reached');
    this.refreshViews();
    const e = new EntityImpl(this, this.nextId++, type, def, slot);
    const b = this.bodies;
    const o = slot * this.bodyStride;
    b.fill(0, o, o + this.bodyStride);
    b[o + B.X] = at.x;
    b[o + B.Y] = at.y;
    b[o + B.Z] = at.z;
    b[o + B.HALF_W] = def.hitbox.width / 2;
    b[o + B.HEIGHT] = def.hitbox.height;
    b[o + B.SPEED] = def.speed;
    b[o + B.ACCEL] = 10;
    b[o + B.JUMP_VEL] = def.jump ?? 8.6;
    b[o + B.GRAVITY] = 1;
    b[o + B.MODE] = 3;
    b[o + B.FLAGS] = FLAG_ACTIVE | FLAG_SOLID | FLAG_SWIM;
    b[o + B.DIST] = 999;
    e.yaw = opts.yaw ?? 0;
    if (opts.data) Object.assign(e.data, opts.data);
    this.bySlot[slot] = e;
    this.list.push(e);
    e.model.root.position.set(at.x, at.y, at.z);
    this.s.scene.add(e.model.root);
    return e;
  }

  release(e: EntityImpl) {
    const o = e.slot * this.bodyStride;
    this.bodies[o + B.FLAGS] = 0;
    this.bySlot[e.slot] = null;
    this.freeBodies.push(e.slot);
    this.list.splice(this.list.indexOf(e), 1);
    e.model.root.removeFromParent();
    e.model.dispose();
  }

  all(type?: string): Entity[] {
    return this.list.filter((e) => e.alive && (!type || e.type === type));
  }

  count(type?: string): number {
    let n = 0;
    for (const e of this.list) if (e.alive && (!type || e.type === type)) n++;
    return n;
  }

  near(center: Vec3, radius: number): Entity[] {
    const r2 = radius * radius;
    return this.list.filter((e) => {
      if (!e.alive) return false;
      const p = e.position;
      return (p.x - center.x) ** 2 + (p.y - center.y) ** 2 + (p.z - center.z) ** 2 <= r2;
    });
  }

  raycast(origin: Vec3, dir: Vec3, maxDistance: number): { entity: Entity; distance: number } | null {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    const hit = this.s.world.pick_body(origin.x, origin.y, origin.z, dir.x / l, dir.y / l, dir.z / l, maxDistance, 0.1);
    if (hit[0] < 0) return null;
    const e = this.byBody(hit[0]);
    return e && e.alive ? { entity: e, distance: hit[1] } : null;
  }

  /** An entity's hitbox (from its definition). */
  hitbox(e: Entity): { width: number; height: number } {
    return (e as EntityImpl).def.hitbox;
  }

  byBody(slot: number): EntityImpl | null {
    return this.bySlot[slot] ?? null;
  }

  clear() {
    for (const e of [...this.list]) e.remove();
    for (const p of this.shots) if (p) this.removeProjectile(p);
    if (this.bossShown) {
      this.s.hud.hideBossBar();
      this.bossShown = false;
    }
  }

  projectile(spec: ProjectileSpec, from: Vec3, dir: Vec3, owner: Entity | 'player' = 'player') {
    this.spawnProjectile(spec, from, dir, owner === 'player' ? 'player' : (owner as EntityImpl));
  }

  spawnProjectile(spec: Internal, from: Vec3, dir: Vec3, owner: EntityImpl | 'player' | null) {
    const slot = this.freeShots.pop();
    if (slot === undefined) return;
    this.refreshViews();
    const p = this.projectiles;
    const o = slot * this.projStride;
    p.fill(0, o, o + this.projStride);
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    p[o + P.X] = from.x;
    p[o + P.Y] = from.y;
    p[o + P.Z] = from.z;
    p[o + P.VX] = (dir.x / l) * spec.speed;
    p[o + P.VY] = (dir.y / l) * spec.speed;
    p[o + P.VZ] = (dir.z / l) * spec.speed;
    p[o + P.GRAVITY] = spec.gravity ?? 20;
    p[o + P.DRAG] = 0.05;
    p[o + P.RADIUS] = 0.12;
    p[o + P.OWNER] = owner === 'player' || owner === null ? -1 : owner.slot;
    p[o + P.FLAGS] = PF_ACTIVE | (owner === 'player' ? PF_HITS_BODIES : PF_HITS_PLAYER);
    const group = new THREE.Group();
    if (!spec.sprite) {
      // No sprite: a glowing bolt along +X (the direction of travel).
      const material = boltMaterial(spec.glow ?? '#ffffff');
      for (const g of boltGeometry()) {
        const mesh = new THREE.Mesh(g, material);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      group.position.set(from.x, from.y, from.z);
      this.s.scene.add(group);
      this.shots[slot] = { slot, spec, owner, group, stuckAt: -1, material };
      return;
    }
    const { geometry, atlas } = this.s.graphics.spriteGeometry(spec.sprite);
    const material = this.s.graphics.material(atlas);
    if (spec.glow) {
      tmpColor.set(spec.glow);
      (material.uniforms.uTint.value as THREE.Vector4).set(tmpColor.r * 4, tmpColor.g * 4, tmpColor.b * 4, 0.7);
    }
    const shadow = this.s.graphics.shadowMaterial(atlas);
    for (let k = 0; k < 2; k++) {
      const mesh = new THREE.Mesh(geometry, material);
      // Sprites are drawn diagonally (tip top-right): align the diagonal with +X.
      mesh.rotation.set(k * Math.PI * 0.5, 0, -Math.PI / 4);
      mesh.scale.setScalar(0.85);
      mesh.customDepthMaterial = shadow;
      const pivot = new THREE.Group();
      pivot.rotation.x = k * Math.PI * 0.5;
      pivot.add(mesh);
      mesh.rotation.x = 0;
      group.add(pivot);
    }
    group.position.set(from.x, from.y, from.z);
    this.s.scene.add(group);
    this.shots[slot] = { slot, spec, owner, group, stuckAt: -1, material };
  }

  private removeProjectile(p: Projectile) {
    this.projectiles[p.slot * this.projStride + P.FLAGS] = 0;
    this.shots[p.slot] = null;
    this.freeShots.push(p.slot);
    p.group.removeFromParent();
    p.material.dispose();
  }

  /** AI, then physics in wasm, then hits, deaths and rendering sync. */
  update(dt: number, running: boolean) {
    this.refreshViews();
    this.time += dt;
    const ctx = this.s.ctx();
    if (running) {
      // Copy: AI may spawn or remove entities.
      for (const e of [...this.list]) {
        if (e.removed) continue;
        e.age += dt;
        if (!e.alive) continue;
        e.def.ai?.(e, ctx, dt);
        e.ambientTimer -= dt;
        if (e.ambientTimer <= 0 && e.def.sounds?.ambient) {
          e.ambientTimer = 4 + Math.random() * 6;
          this.s.sfx.play(e.def.sounds.ambient, { at: e.position, volume: 0.6, pitch: 0.9 + Math.random() * 0.2 });
        }
      }
      this.s.world.step_entities(dt);
      this.refreshViews();
      this.processProjectiles();
    }
    this.syncVisuals(dt, running);
  }

  private processProjectiles() {
    const p = this.projectiles;
    const S = this.projStride;
    for (const shot of this.shots) {
      if (!shot) continue;
      const o = shot.slot * S;
      const kind = p[o + P.HIT_KIND];
      const pos = { x: p[o + P.X], y: p[o + P.Y], z: p[o + P.Z] };
      if (kind !== 0) {
        p[o + P.HIT_KIND] = 0;
        const src = shot.owner === 'player' ? 'player' : shot.owner ?? 'world';
        if (kind === 1) {
          this.s.sfx.play('arrow_hit', { at: pos, volume: 0.6 });
          if (shot.spec.sticky) {
            shot.stuckAt = this.time;
            p[o + P.FLAGS] = PF_ACTIVE | PF_STUCK;
          } else {
            this.s.fx.burst(pos, { color: shot.spec.glow ?? '#cccccc', count: 10, speed: 2 });
            this.removeProjectile(shot);
            continue;
          }
        } else if (kind === 2) {
          this.s.damagePlayer(shot.spec.damage, { source: src, from: pos, knockback: shot.spec.knockback ?? 0.5 });
          this.removeProjectile(shot);
          continue;
        } else if (kind === 3) {
          const target = this.byBody(p[o + P.HIT_INDEX]);
          if (target && target.alive) {
            target.damage(shot.spec.damage, { source: src, from: { x: pos.x - p[o + P.VX] * 0.05, y: pos.y, z: pos.z - p[o + P.VZ] * 0.05 }, knockback: shot.spec.knockback ?? 0.4, crit: shot.spec.crit });
            this.s.sfx.play('hit', { at: pos, pitch: 1.2 });
          }
          this.removeProjectile(shot);
          continue;
        }
      }
      if (p[o + P.AGE] > 12 || (shot.stuckAt >= 0 && this.time - shot.stuckAt > 6)) {
        this.removeProjectile(shot);
        continue;
      }
      shot.group.position.set(pos.x, pos.y, pos.z);
      if (shot.stuckAt < 0) {
        this.tmpV.set(p[o + P.VX], p[o + P.VY], p[o + P.VZ]);
        if (this.tmpV.lengthSq() > 1e-6) shot.group.quaternion.setFromUnitVectors(this.xAxis, this.tmpV.normalize());
      }
    }
  }

  private syncVisuals(dt: number, running: boolean) {
    const b = this.bodies;
    const S = this.bodyStride;
    const pe = this.s.playerEye();
    let boss: EntityImpl | null = null;
    for (const e of [...this.list]) {
      const o = e.slot * S;
      const pos = { x: b[o + B.X], y: b[o + B.Y], z: b[o + B.Z] };
      const root = e.model.root;
      root.position.set(pos.x, pos.y, pos.z);
      const vx = b[o + B.VX];
      const vz = b[o + B.VZ];
      const hs = Math.hypot(vx, vz);
      // Facing: look target, else movement heading.
      let target = e.yaw;
      if (e.alive && e.lookTarget) {
        const t = e.lookTarget === 'player' ? pe : e.lookTarget;
        target = Math.atan2(t.x - pos.x, t.z - pos.z);
      } else if (hs > 0.4) {
        target = Math.atan2(vx, vz);
      }
      let d = target - e.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      e.yaw += d * Math.min(1, dt * 9);
      root.rotation.y = e.yaw;
      const a = e.anim;
      if (running) {
        a.time += dt;
        a.attackT += dt;
        a.walkPhase += hs * dt * (4.2 / Math.max(0.6, e.def.model.scale));
      }
      a.walkAmount += (Math.min(1, hs / Math.max(1.2, e.def.speed * 0.7)) - a.walkAmount) * Math.min(1, dt * 8);
      if (e.alive && e.lookTarget === 'player') {
        const eyeY = pos.y + e.height * 0.85;
        const dist = Math.hypot(pe.x - pos.x, pe.z - pos.z) || 1;
        a.headPitch = Math.max(-0.6, Math.min(0.6, -Math.atan2(pe.y - eyeY, dist)));
      } else {
        a.headPitch *= 0.9;
      }
      e.model.animate(a);

      // Lighting probe (staggered), hurt flash, glow and death fade.
      e.probeTimer -= dt;
      const u = e.model.material.uniforms;
      if (e.probeTimer <= 0) {
        e.probeTimer = 0.15;
        const l = this.s.world.light_probe(Math.floor(pos.x), Math.floor(pos.y + e.height * 0.6), Math.floor(pos.z));
        (u.uProbe.value as THREE.Vector2).set(l[0], l[1]);
      }
      if (running) e.hurt = Math.max(0, e.hurt - dt * 4);
      const tint = u.uTint.value as THREE.Vector4;
      if (e.hurt > 0 || !e.alive) {
        tint.set(1.0, 0.12, 0.08, e.alive ? e.hurt * 0.7 : 0.55);
      } else if (e.glowColor) {
        const pulse = 0.35 + 0.2 * Math.sin(this.time * 18);
        tint.set(e.glowColor.r * 3, e.glowColor.g * 3, e.glowColor.b * 3, pulse);
      } else {
        tint.w = 0;
      }
      if (!e.alive) {
        if (running) e.dyingTime += dt;
        a.dying = Math.min(1, e.dyingTime / 0.35);
        (u.uOpacity as { value: number }).value = Math.max(0, 1 - Math.max(0, e.dyingTime - 0.7) / 0.35);
        if (e.dyingTime > 1.05) {
          this.s.fx.burst({ x: pos.x, y: pos.y + 0.5, z: pos.z }, { color: '#dddddd', count: 20, speed: 1.6, size: 0.14, gravity: -2 });
          e.remove();
          continue;
        }
      } else if (e.def.boss && (!boss || e.health / e.maxHealth < boss.health / boss.maxHealth)) {
        boss = e;
      }
    }
    if (boss) {
      this.s.hud.bossBar(boss.def.name, boss.health / boss.maxHealth, 'linear-gradient(90deg, #7a1fd6, #d21f5c)');
      this.bossShown = true;
    } else if (this.bossShown) {
      this.s.hud.hideBossBar();
      this.bossShown = false;
    }
  }
}
