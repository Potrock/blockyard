import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { AudioApi, BowItem, Entity, FxApi, GameContext, GameEvents, GunItem, HudApi, IconRef, InventoryApi, MeleeItem, Player, SpriteRef, Vec3 } from '../api/types';
import type { EntitySim } from './entities';
import type { Inventory, ItemSim } from './items';
import type { SimInput } from './input';
import { addBloom, canReload, damageAt, gun, lookDir, pelletDirs, RAISE, rayBox, settleBloom, spreadDeg, startReload, stepAim, stepReload, type Gun, type GunState, type Stance } from './guns';
import type { BulletHit } from './hitscan';

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
  /** Guns: a bullet's path (see `castBullet`), checked where targets were at host time `seen`. */
  bullet(from: Vec3, dir: Vec3, range: number, seen: number | null): BulletHit;
  /** Guns: what everyone else sees and hears of a shot (the shooter's own screen showed it already). */
  shotSeen(shot: ShotWire, sound: string, at: Vec3): void;
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
  ) {}

  reset() {
    this.cooldown = 0;
    this.drawing = false;
    this.charge = 0;
    this.heldItem = null;
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

  update(dt: number, input: SimInput) {
    const active = input.active;
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
    if (def?.kind === 'gun' && stack) {
      this.drawing = false;
      this.charge = 0;
      this.gun(dt, input, stack.item, def);
      return;
    }
    if (!active) {
      this.drawing = false;
      this.charge = 0;
      return;
    }
    if (def?.kind === 'bow') {
      this.bow(dt, input, def);
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
        if (def.sounds?.use) this.me.audio.play(def.sounds.use);
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
  private gun(dt: number, input: SimInput, id: string, def: GunItem) {
    const st = this.me.inventory.gunState(id);
    if (!st) return;
    const g = gun(def);
    const active = input.active;
    const trigger = active && input.button(0);
    st.aim = stepAim(g, st.aim, active && input.button(2), dt);
    st.cooldown = Math.max(0, st.cooldown - dt);
    st.bloom = settleBloom(g, st.bloom, dt);
    st.tokens = Math.min(3, st.tokens + dt / g.interval);
    stepReload(g, st, dt, trigger);
    if (active && input.pressed('KeyR') && canReload(g, st)) this.reload(g, st);
    const shots = input.shots;
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
        this.me.audio.play(def.sounds?.empty ?? 'gun_empty');
        st.cooldown = 0.25;
      }
      while (pull && st.mag > 0 && st.reload < 0 && st.cooldown <= 0) {
        this.fire(id, g, st, st.serial + 1, this.me.yaw, this.me.pitch, null, null);
        if (!def.auto) break;
      }
    }
    // Empty: reload by itself.
    if (st.mag <= 0 && st.cooldown <= 0.05 && canReload(g, st)) this.reload(g, st);
  }

  private reload(g: Gun, st: GunState) {
    startReload(g, st);
    this.me.audio.play(g.def.sounds?.reload ?? 'gun_reload', { volume: 0.8 });
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
    const damage = new Map<Player | Entity, { amount: number; head: boolean; at: Vec3 }>();
    const wire: ShotWire = { by: this.me.api.id, item: id, ends: [], normals: [], blocks: [] };
    for (const dir of dirs) {
      const hit = this.me.bullet(eye, dir, g.range, seen);
      wire.ends.push([hit.point.x, hit.point.y, hit.point.z, hit.target ? 2 : hit.block >= 0 ? 1 : 0]);
      wire.normals.push(hit.normal ? [hit.normal.x, hit.normal.y, hit.normal.z] : null);
      wire.blocks.push(hit.block);
      if (!hit.target) continue;
      const d = damage.get(hit.target) ?? { amount: 0, head: false, at: hit.point };
      d.amount += damageAt(g, hit.dist, hit.head);
      d.head ||= hit.head;
      damage.set(hit.target, d);
    }
    const look = lookDir(yaw, pitch);
    this.me.emit('shot', { player: this.me.api, weapon: id, from: eye, dir: look });
    this.me.shotSeen(wire, g.def.sounds?.use ?? 'gunshot', eye);
    let marker: boolean | 'kill' | null = null;
    for (const [target, d] of damage) {
      if (!target.alive) continue;
      const was = target.health;
      const opts = { source: this.me.api, knockback: g.def.knockback ?? 0, crit: d.head, weapon: id, headshot: d.head, from: eye };
      if (target.kind === 'player') {
        if (!target.damage(d.amount, opts)) continue;
        // Numbers for the shooter alone (a creature shows its own to everyone).
        this.me.fx.damageNumber({ x: d.at.x, y: d.at.y + 0.3, z: d.at.z }, Math.round(Math.min(was, d.amount)), { crit: d.head });
      } else {
        target.damage(d.amount, opts);
      }
      this.hits++;
      marker = !target.alive ? 'kill' : marker === 'kill' ? 'kill' : marker || d.head;
    }
    if (marker !== null) {
      this.me.hitMarker(marker);
      this.me.audio.play(marker === 'kill' ? 'kill' : 'hitmarker', { pitch: marker === true ? 1.25 : 1 });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Melee and bows
  // ---------------------------------------------------------------------------------------------

  private melee(def: Strike, weapon: boolean, item?: string) {
    this.cooldown = this.cooldownMax = def.cooldown;
    this.me.view(weapon ? 'use' : 'swing');
    this.me.audio.play(def.sounds?.use ?? 'swing', { pitch: 0.9 + Math.random() * 0.2 });
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
    target.damage(dmg, { source: this.me.api, knockback: def.knockback ?? 1, crit, weapon: item });
    this.hits++;
    const hitSound = def.sounds?.hit;
    this.me.audio.play(hitSound ?? (crit ? 'crit' : 'hit'), { at: target.position, pitch: hitSound && crit ? 1.25 : 1 });
    this.me.hitMarker(target.alive ? crit : 'kill');
    this.me.fx.shake(crit ? 0.05 : 0.025, 0.12);
    if (def.sweep) {
      const tp = target.position;
      for (const e of this.entities.near(tp, 2.4)) {
        if (e === target) continue;
        const p = e.position;
        if (Math.hypot(p.x - cam.x, p.z - cam.z) > (def.reach ?? 3.3) + 1) continue;
        e.damage(dmg * 0.5, { source: this.me.api, knockback: 0.6 });
      }
      this.worldFx.burst({ x: tp.x, y: tp.y + 1, z: tp.z }, { color: '#e8f4ff', count: 14, speed: 4, gravity: 2 });
    }
  }

  private bow(dt: number, input: SimInput, def: BowItem) {
    const inv = this.me.inventory as InventoryApi;
    const hasAmmo = !def.ammo || inv.count(def.ammo) > 0;
    if (input.button(0) && hasAmmo) {
      if (!this.drawing) {
        this.drawing = true;
        this.charge = 0;
        this.me.audio.play(def.sounds?.draw ?? 'bow_draw', { volume: 0.7 });
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
          },
          { x: cam.x + dir.x * 0.4, y: cam.y - 0.1 + dir.y * 0.4, z: cam.z + dir.z * 0.4 },
          dir,
          this.me.api,
        );
        this.shots++;
        this.me.audio.play(def.sounds?.use ?? 'bow_shoot', { pitch: 0.9 + c * 0.2 });
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
  return typeof icon === 'object' && ('block' in icon || 'gltf' in icon) ? undefined : icon;
}
