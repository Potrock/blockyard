import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { AudioApi, BowItem, Entity, FxApi, GameContext, GameEvents, GunItem, HudApi, IconRef, InventoryApi, MeleeItem, Player, SpriteRef, Vec3 } from '../api/types';
import type { EntitySim } from './entities';
import type { Inventory, ItemSim } from './items';
import type { SimInput } from './input';
import { addBloom, canReload, damageAt, DEFAULT_GUN_RULES, gun, lookDir, pelletDirs, RAISE, rayBox, settleBloom, spreadDeg, startReload, stepAim, stepReload, type Gun, type GunRules, type GunState, type Stance } from './guns';
import type { BulletHit, Penetration } from './hitscan';
import { fuseSteps, isThrowable, lobView, throwable, throwVelocity, type Throwable } from './throwables';

/** What combat needs of the player it belongs to. */
export interface Fighter {
  readonly api: Player;
  readonly inventory: Inventory;
  readonly eye: Vec3;
  readonly look: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  /** Falling (for critical hits). */
  readonly falling: boolean;
  readonly onGround: boolean;
  /** Horizontal speed as a fraction of walking speed (for a gun's spread). */
  readonly moving: number;
  readonly stance: Stance;
  /** Their own first-person view, sounds, screen effects and HUD. */
  view(method: 'use' | 'swing', power?: number): void;
  readonly audio: AudioApi;
  readonly fx: FxApi;
  readonly hud: HudApi;
  hitMarker(kind: boolean | 'kill'): void;
  /** Guns: a bullet's path (see `castBullet`), checked where targets were at host time `seen`; through walls with `pen`. */
  bullet(from: Vec3, dir: Vec3, range: number, seen: number | null, pen: Penetration | null): BulletHit;
  /** Guns: carve where a bullet hit a block (null when the world's blocks don't carve). */
  readonly carve: ((point: Vec3, dir: Vec3, opts: { radius: number; depth: number }) => void) | null;
  /**
   * Guns: what everyone else sees and hears of a shot (the shooter's own screen showed it already):
   * `sound` where the gun has no shot of its own on a screen (its `sounds.use`, the server's or its look's).
   */
  shotSeen(shot: ShotWire, sound: string, at: Vec3): void;
  /**
   * Throwables: into the air (see `ThrowSim.launch`), named `key` on every screen, `mine` when
   * their own screen flies it already; and what everyone else sees and hears of the throw.
   */
  launch(item: string, t: Throwable, from: Vec3, v: Vec3, fuse: number, key: string, mine: boolean): void;
  /** Throwables: their screen threw one the host won't take (it vanishes there). */
  refuse(key: string): void;
  /** Host time (seconds). */
  now(): number;
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
}

/** A shot as other screens draw it: who fired what, and where each bullet ended (and what it hit). */
export interface ShotWire {
  by: string;
  item: string;
  /** Per bullet: [x, y, z, what it hit: 0 nothing, 1 a block, 2 someone], and the block's face and id. */
  ends: [number, number, number, number][];
  normals: ([number, number, number] | null)[];
  blocks: number[];
  /**
   * Per bullet, the walls it went through (wall-banging), if any did: each [in x, y, z, its face
   * x, y, z, out x, y, z, that face x, y, z, the block].
   */
  walls?: number[][][];
}

/** What a melee attack needs (the bare fist is one, with no item behind it). */
type Strike = Pick<MeleeItem, 'damage' | 'cooldown' | 'reach' | 'knockback' | 'sweep' | 'sounds'>;
const FIST: Strike = { damage: 1, cooldown: 0.3, reach: 3, knockback: 0.6 };

/** A player's attacks: melee swings, charged bow shots, guns and consumables, and choosing a hotbar slot. */
export class Combat {
  private cooldown = 0;
  private cooldownMax = 1;
  private drawing = false;
  charge = 0;
  hits = 0;
  shots = 0;
  /** The held item last tick (switching raises the new one and stops a reload). */
  private heldItem: string | null = null;
  /** Throwables: the last throw their screen made that the host has taken (or turned down), and the host's own count. */
  thrown = 0;
  private madeHere = 0;
  /** When they last threw (host time), for its `cooldown`. */
  private lastThrow = -99;
  /** A throwable being cooked with no screen to do it (a bot holding its key): which, and for how long; the keys held last tick. */
  private cooking: { item: string; cooked: number; key: string | null } | null = null;
  private keysWere = new Set<string>();

  constructor(
    private world: VoxelWorld,
    private entities: EntitySim,
    private items: ItemSim,
    private me: Fighter,
    /** Everyone's effects (the sweep). */
    private worldFx: FxApi,
    private ctx: () => GameContext,
    /** Hits land on other players too (`player.pvp`). */
    private pvp = false,
    /** The game's gun rules (`guns`): reloading by itself, how far shots may run ahead of the rate. */
    private rules: GunRules = DEFAULT_GUN_RULES,
  ) {}

  reset() {
    this.cooldown = 0;
    this.drawing = false;
    this.charge = 0;
    this.heldItem = null;
    this.cooking = null;
    this.lastThrow = -99;
  }

  /** Cooking a throwable (a bot, holding its key): for the view and the gun, which waits. */
  get isCooking(): boolean {
    return this.cooking !== null;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  /** Melee readiness 0..1 (Minecraft's attack strength). */
  get strength(): number {
    return 1 - this.cooldown / this.cooldownMax;
  }

  /** The held gun and its state, if a gun is held. */
  heldGun(): { id: string; gun: Gun; state: GunState } | null {
    const stack = this.me.inventory.held;
    const def = stack ? this.items.get(stack.item) : undefined;
    if (def?.kind !== 'gun' || !stack) return null;
    const state = this.me.inventory.gunState(stack.item);
    return state && { id: stack.item, gun: gun(def), state };
  }

  /** `locked`: a weapons-locked freeze (`freeze(true, { weapons: true })`): the controls reach no weapon. */
  update(dt: number, input: SimInput, locked = false) {
    const active = input.active && !locked;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const inv = this.me.inventory;
    if (active) {
      if (input.wheel !== 0) inv.cycle(input.wheel);
      for (let i = 0; i < 9; i++) if (input.pressed(`Digit${i + 1}`)) inv.select(i);
    }
    const stack = inv.held;
    const def = stack ? this.items.get(stack.item) : undefined;
    // Guns carried but not held settle (their bloom, their aim) and stop reloading.
    const held = stack?.item ?? null;
    if (held !== this.heldItem) {
      const was = this.heldItem ? inv.gunState(this.heldItem) : null;
      if (was) {
        was.reload = -1;
        was.aim = 0;
      }
      const now = held ? inv.gunState(held) : null;
      if (now) now.cooldown = Math.max(now.cooldown, RAISE);
      this.heldItem = held;
    }
    this.throwables(dt, input, def?.kind === 'throwable' ? stack!.item : null, locked);
    if (def?.kind === 'gun' && stack) {
      this.drawing = false;
      this.charge = 0;
      // (Not while a throwable's being cooked.)
      this.gun(dt, this.cooking ? input.without(0) : input, stack.item, def, active, locked);
      return;
    }
    if (!active) {
      this.drawing = false;
      this.charge = 0;
      return;
    }
    if (def?.kind === 'bow') {
      this.bow(dt, input, def, stack!.item);
    } else if (def?.kind === 'throwable') {
      // Thrown with the fire button (see `throwables`), not swung.
      this.drawing = false;
      this.charge = 0;
    } else {
      this.drawing = false;
      this.charge = 0;
      if (input.buttonPressed(0) || (input.button(0) && this.cooldown <= 0)) {
        // Weapons and the bare fist use their own animation; anything else just swings.
        if (this.cooldown <= 0) this.melee(def?.kind === 'melee' ? def : FIST, !def || def.kind === 'melee', stack?.item);
      }
    }
    if (def?.kind === 'consumable' && input.buttonPressed(2)) {
      if (def.use(this.ctx(), this.me.api)) {
        inv.take(stack!.item, 1);
        this.me.view('use');
        // Its own sound, as their screen has it (none by default).
        this.me.audio.play(def.sounds?.use ?? '', { item: { id: stack!.item, sound: 'use' } });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Guns
  // ---------------------------------------------------------------------------------------------

  /**
   * The held gun: aiming, reloading (R, or by itself once empty) and firing. A person's screen
   * fires its own shots the moment the trigger's pulled and sends them with its controls
   * (`PlayerInput.shots`): the host takes them as long as the gun could have fired them. Bots
   * (and anyone without a screen) fire here from the trigger.
   */
  private gun(dt: number, input: SimInput, id: string, def: GunItem, active: boolean, locked: boolean) {
    const st = this.me.inventory.gunState(id);
    if (!st) return;
    const g = gun(def);
    const trigger = active && input.button(0);
    st.aim = stepAim(g, st.aim, active && input.button(2), dt);
    st.cooldown = Math.max(0, st.cooldown - dt);
    st.bloom = settleBloom(g, st.bloom, dt);
    st.tokens = Math.min(this.rules.rateSlack, st.tokens + dt / g.interval);
    stepReload(g, st, dt, trigger);
    if (active && input.pressed('KeyR') && canReload(g, st)) this.reload(id, g, st);
    // Locked, the shots a screen fired anyway are refused: no rounds go.
    const shots = locked ? undefined : input.shots;
    if (shots) {
      for (const [serial, yaw, pitch, spread] of shots) {
        if (st.mag <= 0 || st.tokens < 0.75 || serial <= st.serial) continue;
        // A shotgun's trigger stops its reload.
        if (st.reload >= 0) {
          if (!def.shells) continue;
          st.reload = -1;
        }
        st.tokens -= 1;
        this.fire(id, g, st, serial, yaw, pitch, spread, input.seen);
      }
    } else if (active) {
      const pull = def.auto ? trigger : input.buttonPressed(0);
      if (pull && st.reload >= 0 && def.shells && st.mag > 0) st.reload = -1;
      if (pull && st.mag <= 0 && st.reload < 0 && st.cooldown <= 0) {
        this.me.audio.play(def.sounds?.empty ?? 'gun_empty', { item: { id, sound: 'empty' } });
        st.cooldown = 0.25;
      }
      while (pull && st.mag > 0 && st.reload < 0 && st.cooldown <= 0) {
        this.fire(id, g, st, st.serial + 1, this.me.yaw, this.me.pitch, null, null);
        if (!def.auto) break;
      }
    }
    // Empty: reload by itself.
    if (!locked && this.rules.autoReload && st.mag <= 0 && st.cooldown <= 0.05 && canReload(g, st)) this.reload(id, g, st);
  }

  private reload(id: string, g: Gun, st: GunState) {
    startReload(g, st);
    this.me.audio.play(g.def.sounds?.reload ?? 'gun_reload', { volume: 0.8, item: { id, sound: 'reload' } });
  }

  /** One shot: its bullets, what they hit, the damage, the shooter's hit marker, and what everyone else sees and hears. */
  private fire(id: string, g: Gun, st: GunState, serial: number, yaw: number, pitch: number, spreadIn: number | null, seen: number | null) {
    st.mag--;
    st.serial = serial;
    st.cooldown = Math.max(0, st.cooldown) + g.interval;
    // The shooter's screen says how wide its cone was; the host holds it to what the gun allows now.
    const own = spreadDeg(g, { aim: st.aim, moving: this.me.moving, air: !this.me.onGround, crouch: this.me.stance > 0, bloom: st.bloom });
    const spread = spreadIn === null ? own : Math.min(own * 1.4 + 0.5, Math.max(own * 0.6, spreadIn));
    st.bloom = addBloom(g, st.bloom);
    this.shots++;
    const eye = this.me.eye;
    const dirs = pelletDirs(g, yaw, pitch, spread, serial);
    const damage = new Map<Player | Entity, { amount: number; head: boolean; at: Vec3; through: number }>();
    const wire: ShotWire = { by: this.me.api.id, item: id, ends: [], normals: [], blocks: [] };
    dirs.forEach((dir, i) => {
      const hit = this.me.bullet(eye, dir, g.range, seen, g.penetration);
      wire.ends.push([hit.point.x, hit.point.y, hit.point.z, hit.target ? 2 : hit.block >= 0 ? 1 : 0]);
      wire.normals.push(hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null);
      wire.blocks.push(hit.block);
      if (hit.walls.length) {
        wire.walls ??= dirs.map(() => []);
        wire.walls[i] = hit.walls.map((p) => [p.entry.x, p.entry.y, p.entry.z, p.normal.x, p.normal.y, p.normal.z, p.exit.x, p.exit.y, p.exit.z, p.out.x, p.out.y, p.out.z, p.block]);
      }
      // A block it hit loses a little of itself (the host's word: everyone's world takes it); a
      // wall it went through, a hole where it went in and where it came out.
      if (g.carve && this.me.carve) {
        for (const p of hit.walls) {
          this.me.carve(p.entry, dir, g.carve);
          this.me.carve(p.exit, { x: -dir.x, y: -dir.y, z: -dir.z }, g.carve);
        }
        if (!hit.target && hit.block >= 0) this.me.carve(hit.point, dir, g.carve);
      }
      if (!hit.target) return;
      const d = damage.get(hit.target) ?? { amount: 0, head: false, at: hit.point, through: 0 };
      d.amount += damageAt(g, hit.dist, hit.head, hit.through);
      d.head ||= hit.head;
      d.through = Math.max(d.through, hit.through);
      damage.set(hit.target, d);
    });
    const look = lookDir(yaw, pitch);
    this.me.emit('shot', { player: this.me.api, weapon: id, from: eye, dir: look });
    this.me.shotSeen(wire, g.def.sounds?.use ?? 'gunshot', eye);
    let marker: boolean | 'kill' | null = null;
    for (const [target, d] of damage) {
      if (!target.alive) continue;
      const was = target.health;
      const opts = { source: this.me.api, knockback: g.def.knockback ?? 0, crit: d.head, weapon: id, headshot: d.head, from: eye, cause: 'gun' as const, part: d.head ? ('head' as const) : ('body' as const), ...(d.through > 0 && { through: Math.round(d.through * 100) / 100 }) };
      // A hit that didn't land (protected, or a `damage` listener cancelled it) gets no marker.
      if (!target.damage(d.amount, opts)) continue;
      // Numbers for the shooter alone (a creature shows its own to everyone): what it took off them.
      if (target.kind === 'player') this.me.fx.damageNumber({ x: d.at.x, y: d.at.y + 0.3, z: d.at.z }, Math.round(was - target.health), { crit: d.head });
      this.hits++;
      marker = !target.alive ? 'kill' : marker === 'kill' ? 'kill' : marker || d.head;
    }
    if (marker !== null) {
      this.me.hitMarker(marker);
      this.me.audio.play(marker === 'kill' ? 'kill' : 'hitmarker', { pitch: marker === true ? 1.25 : 1 });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Throwables
  // ---------------------------------------------------------------------------------------------

  /**
   * Throwables. A person's screen cooks and throws its own (at once, flying it there) and sends
   * each throw with its controls (`PlayerInput.throws`): the host takes it if they have one and
   * aren't throwing faster than its `cooldown`, and flies it from where their screen threw it.
   * With no screen (bots), holding a throwable's `key` (or, with it in hand, the fire button)
   * cooks it here, and letting go throws it.
   */
  private throwables(dt: number, input: SimInput, inHand: string | null, locked: boolean) {
    const sent = input.throws;
    if (sent) {
      for (const [serial, item, x, y, z, vx, vy, vz, cook] of sent) this.take(serial, item, { x, y, z }, { x: vx, y: vy, z: vz }, cook, locked);
      return;
    }
    if (!input.active || locked) {
      this.cooking = null;
      this.keysWere.clear();
      return;
    }
    const inv = this.me.inventory;
    const down = new Set<string>();
    if (this.cooking) {
      const c = this.cooking;
      c.cooked += dt;
      const def = this.items.get(c.item);
      const held = c.key ? input.isDown(c.key) : input.button(0);
      if (!isThrowable(def) || inv.count(c.item) < 1) this.cooking = null;
      else {
        const t = throwable(def);
        // Held too long: it goes off in the hand.
        if (!held || (t.cook && c.cooked >= t.fuse)) {
          this.cooking = null;
          this.throwNow(c.item, t, this.me.yaw, this.me.pitch, c.cooked);
        }
      }
    } else {
      for (const s of inv.slots) {
        const def = s ? this.items.get(s.item) : undefined;
        if (!isThrowable(def) || !def.key) continue;
        if (input.isDown(def.key)) down.add(def.key);
        if (input.isDown(def.key) && !this.keysWere.has(def.key) && this.ready(throwable(def))) {
          this.cooking = { item: s!.item, cooked: 0, key: def.key };
          break;
        }
      }
      const def = inHand ? this.items.get(inHand) : undefined;
      if (!this.cooking && inHand && isThrowable(def) && input.buttonPressed(0) && this.ready(throwable(def))) this.cooking = { item: inHand, cooked: 0, key: null };
      if (this.cooking) {
        // The pin (its own sound, as their screen has it; none by default).
        const d = this.items.get(this.cooking.item);
        this.me.audio.play(d?.sounds?.draw ?? '', { item: { id: this.cooking.item, sound: 'draw' } });
      }
    }
    this.keysWere = down;
  }

  /** Long enough since the last throw. */
  private ready(t: Throwable): boolean {
    return this.me.now() - this.lastThrow >= t.cooldown;
  }

  /** A throw their screen made: taken, or turned away. */
  /** Locked (a weapons-locked freeze), every throw is turned away. */
  private take(serial: number, item: string, from: Vec3, v: Vec3, cook: number, locked: boolean) {
    if (serial <= this.thrown) return;
    this.thrown = serial;
    const key = `${this.me.api.id}:${serial}`;
    const def = this.items.get(item);
    // A little slack on the cooldown: their screen's clock isn't ours.
    if (locked || !isThrowable(def) || this.me.inventory.count(item) < 1 || this.me.now() - this.lastThrow < throwable(def).cooldown * 0.6) return this.me.refuse(key);
    const t = throwable(def);
    // From their eyes, give or take where their screen had them; no faster than it's thrown.
    const eye = this.me.eye;
    const start = Math.hypot(from.x - eye.x, from.y - eye.y, from.z - eye.z) < 2.5 ? from : eye;
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    const vel = !(speed > 0) ? throwVelocity(t, this.me.yaw, this.me.pitch) : speed > t.speed * 1.05 ? { x: (v.x / speed) * t.speed, y: (v.y / speed) * t.speed, z: (v.z / speed) * t.speed } : v;
    this.me.inventory.take(item, 1);
    this.lastThrow = this.me.now();
    this.me.launch(item, t, start, vel, fuseSteps(t, cook), key, true);
  }

  /** A throw made here (a bot letting go of its key, `player.throw`): from their eyes along a view (as hard as `speed`). */
  private throwNow(item: string, t: Throwable, yaw: number, pitch: number, cooked: number, speed = t.speed) {
    if (!this.me.inventory.take(item, 1)) return false;
    this.lastThrow = this.me.now();
    this.me.launch(item, t, this.me.eye, throwVelocity(t, yaw, pitch, speed), fuseSteps(t, cooked), `${this.me.api.id}:h${++this.madeHere}`, false);
    return true;
  }

  /** `player.throw`: one of theirs, now, along their view (or one given, or lobbed to land at a point). */
  throwFromCode(item: string, opts: { at?: Vec3; yaw?: number; pitch?: number; cook?: number } = {}): boolean {
    const def = this.items.get(item);
    if (!isThrowable(def) || !this.me.api.alive || this.me.inventory.count(item) < 1) return false;
    const t = throwable(def);
    if (!this.ready(t)) return false;
    let yaw = opts.yaw ?? this.me.yaw;
    let pitch = opts.pitch ?? this.me.pitch;
    let speed = t.speed;
    if (opts.at) {
      const lob = lobView(t, this.me.eye, opts.at);
      if (!lob) return false;
      ({ yaw, pitch, speed } = lob);
    }
    if (this.cooking?.item === item) this.cooking = null;
    return this.throwNow(item, t, yaw, pitch, opts.cook ?? 0, speed);
  }

  // ---------------------------------------------------------------------------------------------
  // Melee and bows
  // ---------------------------------------------------------------------------------------------

  private melee(def: Strike, weapon: boolean, item?: string) {
    this.cooldown = this.cooldownMax = def.cooldown;
    this.me.view(weapon ? 'use' : 'swing');
    // A melee weapon's own sounds, as each screen has them (anything else in hand swings as a fist).
    const own = weapon && item ? item : null;
    this.me.audio.play(def.sounds?.use ?? 'swing', { pitch: 0.9 + Math.random() * 0.2, ...(own && { item: { id: own, sound: 'use' as const } }) });
    const cam = this.me.eye;
    const dir = this.me.look;
    const reach = def.reach ?? 3.3;
    const hit = this.world.pick_body(cam.x, cam.y, cam.z, dir.x, dir.y, dir.z, reach, 0.25);
    let target: Entity | Player | null = hit[0] >= 0 ? (this.entities.byBody(hit[0]) ?? null) : null;
    if (target && !target.alive) target = null;
    // Another player in the way, nearer than any monster and not behind a wall.
    if (this.pvp) {
      let best = target ? hit[1] : reach;
      for (const p of this.ctx().players) {
        if (p === this.me.api || !p.alive) continue;
        const b = p.position;
        const t = rayBox(cam, dir, { x: b.x - 0.55, y: b.y - 0.25, z: b.z - 0.55 }, { x: b.x + 0.55, y: b.y + 2.05, z: b.z + 0.55 });
        if (t === null || t >= best) continue;
        if (!this.world.line_clear(cam.x, cam.y, cam.z, cam.x + dir.x * t, cam.y + dir.y * t, cam.z + dir.z * t)) continue;
        best = t;
        target = p;
      }
    }
    if (!target) return;
    const crit = this.me.falling;
    const dmg = def.damage * (crit ? 1.5 : 1);
    target.damage(dmg, { source: this.me.api, knockback: def.knockback ?? 1, crit, weapon: item, cause: 'melee' });
    this.hits++;
    // Its own hit sound (pitched up for a crit), else the platform's hit or crit.
    const hitSound = def.sounds?.hit;
    this.me.audio.play(hitSound ?? (crit ? 'crit' : 'hit'), { at: target.position, pitch: hitSound && crit ? 1.25 : 1, ...(own && { item: { id: own, sound: 'hit' as const, pitch: crit ? 1.25 : 1 } }) });
    this.me.hitMarker(target.alive ? crit : 'kill');
    this.me.fx.shake(crit ? 0.05 : 0.025, 0.12);
    if (def.sweep) {
      const tp = target.position;
      for (const e of this.entities.near(tp, 2.4)) {
        if (e === target) continue;
        const p = e.position;
        if (Math.hypot(p.x - cam.x, p.z - cam.z) > (def.reach ?? 3.3) + 1) continue;
        e.damage(dmg * 0.5, { source: this.me.api, knockback: 0.6, cause: 'melee' });
      }
      this.worldFx.burst({ x: tp.x, y: tp.y + 1, z: tp.z }, { color: '#e8f4ff', count: 14, speed: 4, gravity: 2 });
    }
  }

  private bow(dt: number, input: SimInput, def: BowItem, item: string) {
    const inv = this.me.inventory as InventoryApi;
    const hasAmmo = !def.ammo || inv.count(def.ammo) > 0;
    if (input.button(0) && hasAmmo) {
      if (!this.drawing) {
        this.drawing = true;
        this.charge = 0;
        this.me.audio.play(def.sounds?.draw ?? 'bow_draw', { volume: 0.7, item: { id: item, sound: 'draw' } });
      }
      this.charge = Math.min(1, this.charge + dt / def.drawTime);
    } else if (this.drawing) {
      // Released: fire.
      this.drawing = false;
      if (this.charge > 0.1 && (!def.ammo || inv.take(def.ammo, 1))) {
        const c = this.charge;
        const cam = this.me.eye;
        const dir = this.me.look;
        const crit = c >= 1;
        this.entities.spawnProjectile(
          {
            sprite: def.projectile ?? spriteOf(def.ammo ? this.items.get(def.ammo)?.icon : undefined),
            glow: def.projectile || def.ammo ? undefined : '#bfe7ff',
            speed: def.speed * (0.35 + 0.65 * c),
            gravity: 20,
            damage: def.damage[0] + (def.damage[1] - def.damage[0]) * c,
            knockback: 0.3 + c * 0.5,
            sticky: true,
            crit,
            weapon: item,
          },
          { x: cam.x + dir.x * 0.4, y: cam.y - 0.1 + dir.y * 0.4, z: cam.z + dir.z * 0.4 },
          dir,
          this.me.api,
        );
        this.shots++;
        this.me.audio.play(def.sounds?.use ?? 'bow_shoot', { pitch: 0.9 + c * 0.2, item: { id: item, sound: 'use' } });
        this.me.view('use', 0.6 + c * 0.6);
      }
      this.charge = 0;
    } else if (input.buttonPressed(0) && !hasAmmo) {
      this.me.hud.toast('No arrows');
    }
  }
}

/** A sprite icon, or nothing for an item that looks like a block (it can't fly as an arrow). */
function spriteOf(icon: IconRef | undefined): SpriteRef | undefined {
  return typeof icon === 'object' && ('block' in icon || 'gltf' in icon || 'item' in icon) ? undefined : icon;
}
