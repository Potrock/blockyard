import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { CameraApi, GameContext, GameEvents, ItemStack, Player, PlayerOptions, Prop, Vec3, VehicleDefinition, VehicleWorld } from '../api/types';
import { IDLE_INPUT } from '../net/protocol';
import { Combat } from './combat';
import type { EntitySim } from './entities';
import { PlayerHealth } from './health';
import { SimInput } from './input';
import { Inventory, type ItemSim } from './items';
import type { Presentation } from './present';
import type { CreativeBuild } from './creative';
import { freshMemory, stepMovement, type MoveMemory } from './movement';
import type { PropState } from './props';
import { VehicleSim } from './vehicle';

const EYE = 1.62;
const SNEAK_EYE = 1.27;

/** One player as their client draws them (camera, hand, hearts, hotbar). */
export interface PlayerFrame {
  id: string;
  name: string;
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
  /**
   * The game's camera (`controller: 'none'`), or, `follow`ing, the vehicle's (the client works it
   * out from the vehicle's state, every frame).
   */
  camera: { p: [number, number, number]; q: [number, number, number, number]; fov: number; follow: boolean };
  /** Their vehicle (`player.drive`): which one, its state (their client predicts from it), its model. */
  vehicle: { name: string; state: object; prop: number | null } | null;
  /** Creative building (`player.build`): the block hotbar. */
  creative: { hotbar: number[]; selected: number } | null;
  /** Physics is off (before play, dead, a game-driven camera). */
  frozen: boolean;
  canFly: boolean;
  /** Swings and uses so far (a change swings the arm of their figure on other screens). */
  swings: number;
  /** For client-side prediction: the last input of theirs applied, and movement's memory then. */
  ack: number;
  move: MoveMemory;
  /**
   * Seconds their state trails the frame (a server plays whole inputs, and the time left over is
   * owed to them): other screens draw them this much further on, at their velocity.
   */
  lead: number;
  /** Their figure's skin (`player.setSkin`), or null for the game's. */
  skin: { uv: [number, number]; atlas?: string } | null;
  /** Their name's colour above their figure. */
  color: string | null;
}

export interface PlayerSimParts {
  id: string;
  name: string;
  world: VoxelWorld;
  options: PlayerOptions;
  /** The game's vehicles, and the world as they see it. */
  vehicles: Record<string, VehicleDefinition>;
  query: VehicleWorld;
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
  name: string;
  /** Their physics body in the engine's world. */
  readonly slot: number;
  readonly walker: boolean;
  readonly itemMode: boolean;
  yaw = 0;
  pitch = 0;
  allowFlight: boolean;
  sneaking = false;
  sprinting = false;
  readonly state = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false, eyesInWater: false, inLava: false, flying: false, bob: 0, frozen: false };
  readonly input = new SimInput();
  readonly inventory: Inventory;
  readonly health: PlayerHealth;
  readonly combat: Combat;
  /** The game's camera, for `controller: 'none'`. */
  readonly cam = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 70 };
  private seq = 0;
  /** Double-tap state for sprinting and flying. */
  private memory = freshMemory();
  /** The last input applied, by the client's count (a predicting client replays what's after). */
  ack = -1;
  /** Seconds their state trails the step (see `PlayerFrame.lead`). */
  lead = 0;
  /** Swings and uses so far. */
  swings = 0;
  skin: { uv: [number, number]; atlas?: string } | null = null;
  color: string | null = null;
  readonly api: Player;
  /** Creative building's block hotbar and placing (games with `player.build`). */
  creative: CreativeBuild | null = null;
  /** What they're driving (`drive`): their controls move it instead of their body. */
  vehicle: VehicleSim | null = null;
  /** Their client works the camera out from the vehicle (until the game sets one). */
  followVehicle = false;
  /**
   * The first player's place while nobody holds it: their client left and the next to join
   * takes over (`game.player` stays the same object). Frozen, idle and not drawn meanwhile.
   */
  vacant = false;

  constructor(private p: PlayerSimParts) {
    this.id = p.id;
    this.name = p.name;
    this.slot = p.world.player_add(0, 100, 0);
    const o = p.options;
    this.walker = (o.controller ?? 'walk') === 'walk';
    this.itemMode = this.walker && (o.hotbar ?? (o.build ? 'blocks' : 'items')) === 'items';
    this.allowFlight = o.fly ?? false;
    const present = p.present;
    this.inventory = new Inventory(p.items.defs);
    this.health = new PlayerHealth(
      p.world,
      this.slot,
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
        view: (method, power) => {
          if (method === 'swing' || method === 'use') this.swings++;
          present.send(this.id, 'view', method, [power ?? 1]);
        },
        audio: present.audio(this.id),
        fx: present.fx(this.id),
        hud: present.hud(this.id),
        hitMarker: (crit) => present.send(this.id, 'hud', 'hitMarker', [crit]),
      },
      present.fx(null),
      p.ctx,
      o.pvp ?? false,
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
    this.p.world.player_reset(this.slot, x, y, z);
    this.syncState();
    this.setView(yaw, pitch);
    this.cam.pos.set(x, y + EYE, z);
    this.cam.quat.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
  }

  /**
   * A new player in this place (the first player's, left by someone else): nothing of the last
   * one's carries over (where they were, flying, health, what they held, their vehicle, their skin).
   */
  fresh(x: number, y: number, z: number, yaw: number) {
    this.inventory.clear();
    this.reset();
    this.health.configure(this.p.options);
    this.health.revive();
    this.p.world.set_flying(this.slot, false);
    this.vehicle = null;
    this.followVehicle = false;
    this.skin = null;
    this.color = null;
    this.ack = -1;
    this.lead = 0;
    this.swings = 0;
    this.memory = freshMemory();
    this.input.set(IDLE_INPUT);
    this.place(x, y, z, yaw);
  }

  /** Read the physics body back from WebAssembly. */
  syncState() {
    const st = this.p.world.player_state(this.slot);
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
    S.frozen = st[12] > 0.5;
  }

  /** Walk, sprint, sneak, jump, swim and fly from this tick's controls (or drive). */
  move(dt: number) {
    const world = this.p.world;
    if (this.vehicle) {
      this.vehicle.def.step(this.vehicle.state, this.input, dt, this.p.query);
      this.followBody();
      return;
    }
    if (!this.walker) {
      // No walking body: it stays put (games may teleport it, e.g. to follow a vehicle).
      world.set_frozen(this.slot, true);
      this.syncState();
      return;
    }
    const inp = this.input;
    // The client's view, once it has caught up with any the simulation set.
    if (inp.active && inp.viewSeq === this.viewSeq) {
      this.yaw = inp.yaw;
      this.pitch = inp.pitch;
    }
    const { sneak, sprint } = stepMovement(world, this.slot, inp, this.yaw, this.allowFlight, this.memory, dt);
    this.syncState();
    this.sneaking = sneak;
    this.sprinting = sprint && Math.hypot(this.state.vx, this.state.vz) > 4.5;
  }

  /**
   * Their vehicle's model where it will be `seconds` on (a server owes them that much time): a
   * step of the vehicle on a copy of its state, with the last controls. For other screens, which
   * draw the model; the vehicle itself is untouched.
   */
  aheadVehicle(seconds: number) {
    const v = this.vehicle;
    if (!v?.prop || v.prop.removed || seconds < 1e-3) return;
    const s = structuredClone(v.state);
    v.def.step(s, this.input, seconds, this.p.query);
    v.def.pose(s, v.prop.position, v.prop.quaternion);
  }

  /** The vehicle's model to where its state has it, and their (frozen) body with it. */
  followBody() {
    const v = this.vehicle;
    if (!v) return;
    const at = v.place();
    this.p.world.player_reset(this.slot, at.x, at.y, at.z);
    this.p.world.set_frozen(this.slot, true);
    this.syncState();
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
      name: this.name,
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
      camera: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], fov: this.cam.fov, follow: this.followVehicle && !!this.vehicle },
      vehicle: this.vehicle && { name: this.vehicle.name, state: this.vehicle.state, prop: this.vehicle.prop && !this.vehicle.prop.removed ? this.vehicle.prop.id : null },
      creative: this.creative ? { hotbar: [...this.creative.hotbar], selected: this.creative.selected } : null,
      frozen: s.frozen,
      canFly: this.allowFlight,
      swings: this.swings,
      ack: this.ack,
      move: { ...this.memory },
      lead: this.lead,
      skin: this.skin,
      color: this.color,
    };
  }

  /** Gone from the game: their body leaves the world. */
  remove() {
    this.p.world.player_remove(this.slot);
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
        me.followVehicle = false;
        const c = me.cam;
        c.pos.set(pos.x, pos.y, pos.z);
        const m = new THREE.Matrix4().lookAt(c.pos, new THREE.Vector3(target.x, target.y, target.z), new THREE.Vector3(up?.x ?? 0, up?.y ?? 1, up?.z ?? 0));
        c.quat.setFromRotationMatrix(m);
      },
      setPose(pos, q) {
        me.followVehicle = false;
        me.cam.pos.set(pos.x, pos.y, pos.z);
        me.cam.quat.set(q.x, q.y, q.z, q.w).normalize();
      },
      get fov() {
        return me.cam.fov;
      },
      set fov(v: number) {
        me.cam.fov = Math.max(10, Math.min(150, v));
      },
      follow() {
        me.followVehicle = true;
      },
    };
    return {
      kind: 'player',
      id: this.id,
      get name() {
        return me.name;
      },
      hud: present.hud(this.id),
      audio: present.audio(this.id),
      fx: present.fx(this.id),
      setSkin: (skin, atlas) => {
        me.skin = { uv: [skin[0], skin[1]], atlas };
        present.send(me.id, 'view', 'setSkin', [skin, atlas]);
      },
      get color() {
        return me.color;
      },
      set color(c: string | null) {
        me.color = c;
      },
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
        world.player_reset(this.slot, pos.x, pos.y, pos.z);
        this.syncState();
        if (yaw !== undefined || pitch !== undefined) this.setView(yaw ?? this.yaw, pitch ?? this.pitch);
      },
      damage: (amount, opts) => this.health.damage(amount, opts),
      heal: (amount) => this.health.heal(amount),
      revive: () => this.health.revive(),
      impulse: (x, y, z) => world.player_impulse(this.slot, x, y, z),
      freeze: (f) => world.set_frozen(this.slot, f),
      drive: <S extends object>(name: string, state: S, opts: { prop?: Prop } = {}) => {
        const def = this.p.vehicles[name];
        if (!def) throw new Error(`player.drive: no vehicle "${name}" (add it to the game's \`vehicles\`)`);
        this.vehicle = new VehicleSim(name, def, state, (opts.prop as PropState | undefined) ?? null);
        this.followVehicle = true;
        this.followBody();
        return this.vehicle as unknown as import('../api/types').Vehicle<S>;
      },
      leaveVehicle: () => {
        this.vehicle = null;
        this.followVehicle = false;
      },
      get vehicle() {
        return me.vehicle;
      },
    };
  }
}
