import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { CameraApi, GameContext, GameEvents, ItemStack, Player, PlayerOptions, Vec3 } from '../api/types';
import { Combat } from './combat';
import type { EntitySim } from './entities';
import { PlayerHealth } from './health';
import { SimInput } from './input';
import { Inventory, type ItemSim } from './items';
import type { Presentation } from './present';

const EYE = 1.62;
const SNEAK_EYE = 1.27;

/** One player as their client draws them (camera, hand, hearts, hotbar). */
export interface PlayerFrame {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  inWater: boolean;
  eyesInWater: boolean;
  inLava: boolean;
  flying: boolean;
  /** Walk-cycle phase for view bobbing. */
  bob: number;
  sneaking: boolean;
  sprinting: boolean;
  /** Where the simulation last turned them (it counts up each time: `teleport` with a view, spawn). */
  view: { seq: number; yaw: number; pitch: number };
  health: number;
  maxHealth: number;
  /** Damage is on (the hearts show). */
  mortal: boolean;
  dead: boolean;
  /** Seconds since dying. */
  deathTime: number;
  /** The items hotbar (item games). */
  hotbar: { slots: (ItemStack | null)[]; selected: number } | null;
  /** The held weapon: bow draw, and melee readiness 0..1. */
  hand: { drawing: boolean; charge: number; strength: number };
  /** The game's camera (`controller: 'none'`). */
  camera: { p: [number, number, number]; q: [number, number, number, number]; fov: number };
}

export interface PlayerSimParts {
  id: string;
  name: string;
  world: VoxelWorld;
  options: PlayerOptions;
  present: Presentation;
  entities: EntitySim;
  items: ItemSim;
  ctx(): GameContext;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
}

/**
 * A player in the simulation: moves from their controls (physics in WebAssembly), takes damage,
 * fights, carries a hotbar, and is the `Player` games see (`api`).
 */
export class PlayerSim {
  readonly id: string;
  readonly name: string;
  readonly walker: boolean;
  readonly itemMode: boolean;
  yaw = 0;
  pitch = 0;
  allowFlight: boolean;
  sneaking = false;
  sprinting = false;
  readonly state = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false, eyesInWater: false, inLava: false, flying: false, bob: 0 };
  readonly input = new SimInput();
  readonly inventory: Inventory;
  readonly health: PlayerHealth;
  readonly combat: Combat;
  /** The game's camera, for `controller: 'none'`. */
  readonly cam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 };
  private seq = 0;
  private lastJumpTap = -1;
  private lastForwardTap = -1;
  private sprintLatched = false;
  private time = 0;
  readonly api: Player;

  constructor(private p: PlayerSimParts) {
    this.id = p.id;
    this.name = p.name;
    const o = p.options;
    this.walker = (o.controller ?? 'walk') === 'walk';
    this.itemMode = this.walker && (o.hotbar ?? (o.build ? 'blocks' : 'items')) === 'items';
    this.allowFlight = o.fly ?? false;
    const present = p.present;
    this.inventory = new Inventory(p.items.defs);
    this.health = new PlayerHealth(
      p.world,
      present.audio(this.id),
      present.fx(this.id),
      p.emit,
      () => this.position,
      () => this.api,
      () => present.send(this.id, 'view', 'kick', [0.6]),
    );
    this.health.configure(o);
    const me = this;
    this.combat = new Combat(
      p.world,
      p.entities,
      p.items,
      {
        get api() {
          return me.api;
        },
        inventory: this.inventory,
        get eye() {
          return me.eye;
        },
        get look() {
          return me.look;
        },
        get falling() {
          const s = me.state;
          return !s.onGround && s.vy < -1 && !s.inWater;
        },
        view: (method, power) => present.send(this.id, 'view', method, [power ?? 1]),
        audio: present.audio(this.id),
        fx: present.fx(this.id),
        hud: present.hud(this.id),
        hitMarker: (crit) => present.send(this.id, 'hud', 'hitMarker', [crit]),
      },
      present.fx(null),
      p.ctx,
    );
    this.api = this.makeApi();
  }

  get position(): Vec3 {
    const s = this.state;
    return { x: s.x, y: s.y, z: s.z };
  }

  get eye(): Vec3 {
    const s = this.state;
    return { x: s.x, y: s.y + (this.sneaking && !s.flying ? SNEAK_EYE : EYE), z: s.z };
  }

  /** Unit vector along the view (yaw 0 looks toward -z). */
  get look(): Vec3 {
    const cp = Math.cos(this.pitch);
    return { x: -Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * cp };
  }

  /** Turn the player from the simulation's side (teleports, spawning): the client follows. */
  setView(yaw: number, pitch: number) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.seq++;
  }

  /** Counts up each time the simulation turns the player; clients echo it to show they've caught up. */
  get viewSeq(): number {
    return this.seq;
  }

  /** Put the player somewhere, facing `yaw` / `pitch` (spawning, a save); a game-driven camera starts at their eyes. */
  place(x: number, y: number, z: number, yaw: number, pitch = 0) {
    this.p.world.player_reset(x, y, z);
    this.syncState();
    this.setView(yaw, pitch);
    this.cam.pos.set(x, y + EYE, z);
    this.cam.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  }

  /** Read the physics body back from WebAssembly. */
  syncState() {
    const st = this.p.world.player_state();
    const S = this.state;
    S.x = st[0];
    S.y = st[1];
    S.z = st[2];
    S.vx = st[3];
    S.vy = st[4];
    S.vz = st[5];
    S.onGround = st[6] > 0.5;
    S.inWater = st[7] > 0.5;
    S.eyesInWater = st[8] > 0.5;
    S.inLava = st[9] > 0.5;
    S.flying = st[10] > 0.5;
    S.bob = st[11];
  }

  /** Walk, sprint, sneak, jump, swim and fly from this tick's controls. */
  move(dt: number) {
    const world = this.p.world;
    if (!this.walker) {
      // No walking body: it stays put (games may teleport it, e.g. to follow a vehicle).
      world.set_frozen(true);
      this.syncState();
      return;
    }
    this.time += dt;
    const inp = this.input;
    const active = inp.active;
    // The client's view, once it has caught up with any the simulation set.
    if (active && inp.viewSeq === this.viewSeq) {
      this.yaw = inp.yaw;
      this.pitch = inp.pitch;
    }
    let f = 0;
    let s = 0;
    let jump = false;
    let sneak = false;
    let sprint = false;
    if (active) {
      if (inp.isDown('KeyW') || inp.isDown('ArrowUp')) f += 1;
      if (inp.isDown('KeyS') || inp.isDown('ArrowDown')) f -= 1;
      if (inp.isDown('KeyD') || inp.isDown('ArrowRight')) s += 1;
      if (inp.isDown('KeyA') || inp.isDown('ArrowLeft')) s -= 1;
      jump = inp.isDown('Space');
      sneak = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      if (inp.pressed('KeyW')) {
        if (this.time - this.lastForwardTap < 0.3) this.sprintLatched = true;
        this.lastForwardTap = this.time;
      }
      if (f <= 0) this.sprintLatched = false;
      sprint = (inp.isDown('ControlLeft') || inp.isDown('ControlRight') || this.sprintLatched) && f > 0 && !sneak;
      if (inp.pressed('Space') && this.allowFlight) {
        if (this.time - this.lastJumpTap < 0.3) {
          world.set_flying(!this.state.flying);
          this.lastJumpTap = -1;
        } else {
          this.lastJumpTap = this.time;
        }
      }
      if (inp.pressed('KeyF') && this.allowFlight) world.set_flying(!this.state.flying);
    }
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let wx = -sy * f + cy * s;
    let wz = -cy * f - sy * s;
    const len = Math.hypot(wx, wz);
    if (len > 1) {
      wx /= len;
      wz /= len;
    }
    world.player_step(wx, wz, jump, sneak, sprint, dt);
    this.syncState();
    this.sneaking = sneak;
    this.sprinting = sprint && Math.hypot(this.state.vx, this.state.vz) > 4.5;
  }

  /** Regeneration, fall damage, the death timer. */
  updateHealth(dt: number) {
    const s = this.state;
    this.health.update(dt, s.onGround, s.vy);
  }

  /** The built-in weapons and hotbar (after the game has had its say on the controls). */
  updateHands(dt: number, running: boolean) {
    if (this.itemMode) this.combat.update(running ? dt : 0, this.input);
  }

  reset() {
    this.combat.reset();
  }

  frame(): PlayerFrame {
    const s = this.state;
    const h = this.health;
    const c = this.combat;
    const q = this.cam.quat;
    const p = this.cam.pos;
    return {
      id: this.id,
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      onGround: s.onGround,
      inWater: s.inWater,
      eyesInWater: s.eyesInWater,
      inLava: s.inLava,
      flying: s.flying,
      bob: s.bob,
      sneaking: this.sneaking,
      sprinting: this.sprinting,
      view: { seq: this.viewSeq, yaw: this.yaw, pitch: this.pitch },
      health: h.health,
      maxHealth: h.max,
      mortal: h.enabled,
      dead: h.dead,
      deathTime: h.deathTime,
      hotbar: this.itemMode ? { slots: this.inventory.slots.map((st) => (st ? { ...st } : null)), selected: this.inventory.selected } : null,
      hand: { drawing: c.isDrawing, charge: c.charge, strength: c.strength },
      camera: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], fov: this.cam.fov },
    };
  }

  private makeApi(): Player {
    const me = this;
    const world = this.p.world;
    const present = this.p.present;
    const camera: CameraApi = {
      get position() {
        if (!me.walker) {
          const c = me.cam.pos;
          return { x: c.x, y: c.y, z: c.z };
        }
        return me.eye;
      },
      get forward() {
        if (!me.walker) {
          const d = new THREE.Vector3(0, 0, -1).applyQuaternion(me.cam.quat);
          return { x: d.x, y: d.y, z: d.z };
        }
        return me.look;
      },
      set(pos, target, up) {
        const c = me.cam;
        c.pos.set(pos.x, pos.y, pos.z);
        const m = new THREE.Matrix4().lookAt(c.pos, new THREE.Vector3(target.x, target.y, target.z), new THREE.Vector3(up?.x ?? 0, up?.y ?? 1, up?.z ?? 0));
        c.quat.setFromRotationMatrix(m);
      },
      setPose(pos, q) {
        me.cam.pos.set(pos.x, pos.y, pos.z);
        me.cam.quat.set(q.x, q.y, q.z, q.w).normalize();
      },
      get fov() {
        return me.cam.fov;
      },
      set fov(v: number) {
        me.cam.fov = Math.max(10, Math.min(150, v));
      },
    };
    return {
      kind: 'player',
      id: this.id,
      name: this.name,
      hud: present.hud(this.id),
      input: this.input,
      camera,
      viewModel: present.view(this.id),
      inventory: this.inventory,
      get position() {
        return me.position;
      },
      get eye() {
        return me.eye;
      },
      get velocity() {
        const s = me.state;
        return { x: s.vx, y: s.vy, z: s.vz };
      },
      get look() {
        return me.look;
      },
      get yaw() {
        return me.yaw;
      },
      get pitch() {
        return me.pitch;
      },
      get onGround() {
        return me.state.onGround;
      },
      get health() {
        return me.health.health;
      },
      set health(v: number) {
        me.health.health = Math.max(0, Math.min(me.health.max, v));
      },
      get maxHealth() {
        return me.health.max;
      },
      set maxHealth(v: number) {
        me.health.max = v;
        me.health.health = Math.min(me.health.health, v);
      },
      get alive() {
        return !me.health.dead;
      },
      get armor() {
        return me.health.armor;
      },
      set armor(v: number) {
        me.health.armor = v;
      },
      teleport: (pos, yaw, pitch) => {
        world.player_reset(pos.x, pos.y, pos.z);
        this.syncState();
        if (yaw !== undefined || pitch !== undefined) this.setView(yaw ?? this.yaw, pitch ?? this.pitch);
      },
      damage: (amount, opts) => this.health.damage(amount, opts),
      heal: (amount) => this.health.heal(amount),
      revive: () => this.health.revive(),
      impulse: (x, y, z) => world.player_impulse(x, y, z),
      freeze: (f) => world.set_frozen(f),
    };
  }
}
