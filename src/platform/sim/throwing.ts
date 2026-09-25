import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Actor, AudioApi, Entity, FxApi, Player, ThrownInfo, Vec3 } from '../api/types';
import type { Registry } from '../world/registry';
import type { Presentation } from './present';
import { flightWorld, flyFor, newFlight, STEP, type Flight, type FlightWorld, type Throwable } from './throwables';

/** What the host's throwables need of the simulation. */
export interface ThrowHost {
  world: VoxelWorld;
  registry: Registry;
  present: Presentation;
  /** Everyone's effects and sounds. */
  fx: FxApi;
  audio: AudioApi;
  /** Everyone who can be hurt: players (alive) and creatures. */
  targets(): { target: Player | Entity; feet: Vec3; height: number; width: number }[];
  /** A blast (see `Sim.hurtAround`, `Sim.blowBlocks`). */
  hurt(at: Vec3, reach: number, near: number, far: number, knockback: number, by: Actor, weapon: string): void;
  blow(at: Vec3, radius: number, by: Actor): void;
  /** Run game code (a `damage` listener) without it stopping the tick. */
  guard(fn: () => void): void;
}

/** One in the air (or at rest), as the host flies it. */
interface Live {
  key: string;
  item: string;
  t: Throwable;
  f: Flight;
  acc: { t: number };
  by: Player;
  /** Seconds since the throw (it can't hit its thrower straight out of their hand). */
  age: number;
}

/** A fire burning where a molotov broke. */
interface Fire {
  id: number;
  at: Vec3;
  radius: number;
  left: number;
  dps: number;
  by: Player;
  weapon: string;
  /** Seconds to its next burn. */
  next: number;
}

/** How often a fire burns whoever's in it: long enough for the default `hurtCooldown`. */
const BURN_EVERY = 0.5;

/**
 * The host's throwables: flying each one thrown (`throwables.ts`, step by step like every screen
 * that flies it), and when its fuse is out (or, with `impact`, when it strikes something or
 * someone) setting it off: the blast (damage, a push, a crater) and the fire, which burns on here
 * for its while. Every screen hears of each throw (`thrown`: from where, how fast, when it goes
 * off; not the thrower's, which flew it already) and of where it went off (`thrownEnd`).
 */
export class ThrowSim {
  private live: Live[] = [];
  private fires: Fire[] = [];
  private nextFire = 1;
  private flight: FlightWorld;

  constructor(private h: ThrowHost) {
    this.flight = flightWorld(h.world, h.registry);
  }

  /** In the air: `key` names it on every screen (the thrower's own already flies it when `mine`). */
  launch(item: string, t: Throwable, from: Vec3, v: Vec3, fuse: number, key: string, by: Player, mine: boolean) {
    const f = newFlight(from, v, fuse);
    this.live.push({ key, item, t, f, acc: { t: 0 }, by, age: 0 });
    this.h.present.send(null, 'client', 'thrown', [key, item, by.id, f.x, f.y, f.z, f.vx, f.vy, f.vz, f.fuse], mine ? by.id : undefined);
  }

  /** A throw their screen made that the host won't take: it vanishes there. */
  refuse(key: string, player: string) {
    this.h.present.send(player, 'client', 'thrownEnd', [key, null]);
  }

  /** Throwables in the air, as the game sees them (`items.thrown`: bots keeping away). */
  get flying(): ThrownInfo[] {
    return this.live.map((l) => ({
      item: l.item,
      position: { x: l.f.x, y: l.f.y, z: l.f.z },
      by: l.by,
      radius: l.t.blast?.radius ?? l.t.fire?.radius ?? 0,
      left: Math.max(0, (l.f.fuse - l.f.steps) * STEP),
    }));
  }

  /** The fires burning (`items.fires`). */
  get burning(): { position: Vec3; radius: number; left: number; by: Player }[] {
    return this.fires.map((f) => ({ position: { ...f.at }, radius: f.radius, left: f.left, by: f.by }));
  }

  update(dt: number) {
    for (const l of [...this.live]) {
      l.age += dt;
      let off = flyFor(l.f, l.t, this.flight, l.acc, dt);
      // An impact throwable breaks on whoever it meets, too (the host's word: screens fly it on until they hear).
      if (!off && l.t.impact && this.meetsSomeone(l)) off = true;
      if (!off) continue;
      this.live.splice(this.live.indexOf(l), 1);
      this.goOff(l);
    }
    for (const fire of [...this.fires]) {
      fire.left -= dt;
      fire.next -= dt;
      if (fire.next <= 0) {
        fire.next += BURN_EVERY;
        this.burn(fire);
      }
      if (fire.left <= 0) this.fires.splice(this.fires.indexOf(fire), 1);
    }
  }

  /** Someone in its way (not its thrower, for a moment after it leaves their hand). */
  private meetsSomeone(l: Live): boolean {
    const f = l.f;
    for (const o of this.h.targets()) {
      if (o.target === l.by && l.age < 0.4) continue;
      const hw = o.width / 2 + l.t.radius;
      if (Math.abs(f.x - o.feet.x) < hw && Math.abs(f.z - o.feet.z) < hw && f.y > o.feet.y - l.t.radius && f.y < o.feet.y + o.height + l.t.radius) return true;
    }
    return false;
  }

  private goOff(l: Live) {
    const h = this.h;
    const at = { x: l.f.x, y: l.f.y, z: l.f.z };
    h.present.send(null, 'client', 'thrownEnd', [l.key, [at.x, at.y, at.z]]);
    const b = l.t.blast;
    if (b) {
      h.guard(() => h.hurt(at, b.radius, b.near, b.far, b.knockback, l.by, l.item));
      h.fx.explosion(at, { size: b.size });
      if (b.carve > 0) h.blow(at, b.carve, l.by);
    }
    const fire = l.t.fire;
    if (fire) {
      // On the ground under where it broke (a wall's foot, the floor it hit).
      const down = this.flight.hit(at.x, at.y + 0.05, at.z, 0, -1, 0, 5);
      const ground = { x: at.x, y: down ? at.y + 0.05 - down.t : at.y, z: at.z };
      const id = this.nextFire++;
      this.fires.push({ id, at: ground, radius: fire.radius, left: fire.duration, dps: fire.damage, by: l.by, weapon: l.item, next: 0.15 });
      h.present.send(null, 'client', 'fire', [id, ground.x, ground.y, ground.z, fire.radius, fire.duration, fire.color]);
      h.audio.play(l.t.def.sounds?.hit ?? 'glass', { at });
      h.audio.play('fire', { at: ground });
    }
  }

  /** Whoever's standing in a fire (not behind a wall from its middle) burns. */
  private burn(fire: Fire) {
    const h = this.h;
    const c = fire.at;
    for (const o of h.targets()) {
      const p = o.feet;
      if (Math.hypot(p.x - c.x, p.z - c.z) > fire.radius + o.width / 2 || p.y < c.y - 1.2 || p.y > c.y + 1.6) continue;
      if (!h.world.line_clear(c.x, c.y + 0.5, c.z, p.x, p.y + 0.5, p.z)) continue;
      h.guard(() => o.target.damage(fire.dps * BURN_EVERY, { source: fire.by, from: c, knockback: 0, weapon: fire.weapon, cause: 'fire' }));
    }
    // Now and then a crackle.
    if (Math.random() < 0.5) h.audio.play('fire', { at: c, volume: 0.6 });
  }

  clear() {
    this.live = [];
    this.fires = [];
  }
}
