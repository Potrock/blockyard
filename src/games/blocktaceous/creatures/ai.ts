import type { Entity, GameContext, Player } from '@platform';
import { levelBonus } from './tuning';
import { brains, call, carcasses, clock, flat, herds, inPlay, isEntity, isPlayer, near, nearestPlayer, ownerOf, setClip, type Brain, type Mode } from './state';

/**
 * How the island's animals behave, wild and tame. Every animal thinks a few times a second
 * (`think`: what's near, what to do about it) and steers every step (`act`): herds graze, wander
 * and sleep at night; skittish animals bolt; territorial ones face you and roar before they
 * charge; predators stalk players, tames and smaller animals, wind up (the big ones glow and
 * bellow first) and bite; scavengers come for carcasses; pterosaurs circle and land; tames follow
 * their orders.
 */

const SEMI_AQUATIC = new Set(['spinosaurus', 'sarcosuchus']);
const scratch: Brain[] = [];

const valid = (t: Entity | Player | null): t is Entity | Player => !!t && (isPlayer(t) ? inPlay(t) : t.alive);
const isNight = (game: GameContext): boolean => game.env.time < 0.2 || game.env.time > 0.82;
/** A player an animal doesn't mind near it: sneaking, or holding out what it likes best. */
const calm = (b: Brain, p: Player): boolean => p.crouching || p.inventory.held?.item === b.s.favorite;
const wetAt = (game: GameContext, x: number, z: number): boolean => {
  const y = game.world.surfaceY(x, z);
  return y >= 0 && game.world.blockName(game.world.getBlock(x, y, z)) === 'water';
};

const CLIPS: Partial<Record<Mode, string>> = { graze: 'eat', eat: 'eat', sleep: 'sleep', air: 'fly', land: 'glide' };

/** Change what an animal is doing, for so long. */
export function go(b: Brain, mode: Mode, seconds: number) {
  b.mode = mode;
  b.until = clock.now + seconds;
  b.stuck = 0;
  if (b.wind > 0) {
    b.wind = 0;
    b.e.glow(null);
    b.e.animate('none');
  }
  if (mode !== 'hunt' && mode !== 'warn') b.e.lookAt(null);
  setClip(b, b.ko ? 'sleep' : (CLIPS[mode] ?? (b.s.locomotion === 'flyer' && mode === 'flee' ? 'fly' : null)));
}

/** Run from a spot; a pterosaur takes to the air. Its herd goes with it. */
export function flee(b: Brain, from: { x: number; z: number }, game: GameContext, alarm = true) {
  b.goal = { x: from.x, z: from.z };
  b.target = null;
  go(b, 'flee', game.rng.range(4, 7));
  if (!alarm) return;
  for (const o of near(b.e.position, 16, scratch)) if (o !== b && o.herd === b.herd && !o.tame && !o.ko && o.mode !== 'flee') flee(o, from, game, false);
}

/** Go after something until it's dead, out of reach or `seconds` have passed. */
function charge(b: Brain, target: Entity | Player, seconds: number) {
  b.target = target;
  go(b, 'hunt', seconds);
}

/**
 * Something hurt this animal: a fighter turns on whoever did it (and its herd with it), anything
 * else runs. A tame fights back unless it's been told to be passive.
 */
export function provoke(b: Brain, by: Entity | Player, game: GameContext) {
  b.hurtAt = clock.now;
  if (b.ko) return;
  if (b.tame) {
    if (b.tame.stance !== 'passive' && !valid(b.target)) b.target = by;
    return;
  }
  const s = b.s;
  const fighter = s.temper === 'aggressive' || s.temper === 'territorial' || (s.temper === 'docile' && b.t.big);
  const beaten = b.e.health < b.e.maxHealth * 0.2 && s.tameTier <= 3;
  if (!fighter || beaten) return flee(b, by.position, game);
  b.angryUntil = clock.now + 15;
  charge(b, by, 20);
  call(game, b);
  if (s.temper !== 'territorial') return;
  for (const o of near(b.e.position, 20, scratch)) {
    if (o === b || o.herd !== b.herd || o.tame || o.ko || o.mode === 'hunt') continue;
    o.angryUntil = clock.now + 15;
    charge(o, by, 20);
  }
}

/** Somewhere for an animal to walk to in its herd's range (the range itself moves on now and then); null if nowhere will do. */
function pickGoal(b: Brain, game: GameContext): { x: number; z: number } | null {
  const h = herds.get(b.herd);
  const p = b.e.position;
  if (!h) return null;
  const rng = game.rng;
  const aquatic = SEMI_AQUATIC.has(b.id);
  if (clock.now - h.movedAt > 45 && rng.chance(0.3)) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(10, 18);
    const [x, z] = [h.x + Math.cos(a) * d, h.z + Math.sin(a) * d];
    if (game.world.surfaceY(x, z) >= 0 && (aquatic || !wetAt(game, x, z))) [h.x, h.z, h.movedAt] = [x, z, clock.now];
  }
  const reach = 5 + b.s.length * 0.8;
  let best: { x: number; z: number } | null = null;
  for (let i = 0; i < (aquatic ? 5 : 2); i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(2, reach);
    const g = { x: h.x + Math.cos(a) * d, z: h.z + Math.sin(a) * d };
    if (game.world.surfaceY(g.x, g.z) < 0) continue;
    const wet = wetAt(game, g.x, g.z);
    // Fish-eaters and crocodiles keep to the water's edge; everything else keeps out of it.
    if (aquatic ? wet || wetAt(game, g.x + 3, g.z) || wetAt(game, g.x, g.z + 3) : !wet) return g;
    best ??= aquatic ? g : null;
  }
  return best ?? (flat(p, h) > reach ? { x: h.x, z: h.z } : null);
}

/** Nothing to react to: graze, wander, rest, sleep through the night; a pterosaur circles and comes down to rest. */
function idleLife(b: Brain, game: GameContext) {
  if (clock.now < b.until) return;
  const rng = game.rng;
  const s = b.s;
  if (s.locomotion === 'flyer' && !b.tame) {
    if (b.mode === 'air') go(b, 'land', 30);
    else if (b.mode !== 'land') go(b, 'air', rng.range(20, 45));
    return;
  }
  if (rng.chance(0.12)) call(game, b, 0.5);
  if (isNight(game) && s.diet === 'herbivore') return go(b, 'sleep', rng.range(15, 30));
  const r = rng.next();
  const herbivore = s.diet === 'herbivore';
  const lazy = b.id === 'sarcosuchus' ? 0.7 : herbivore ? 0.15 : 0.35;
  if (r < lazy) return go(b, 'idle', b.id === 'sarcosuchus' ? rng.range(8, 20) : rng.range(2, 5));
  if (herbivore && r < lazy + 0.45) return go(b, 'graze', rng.range(4, 9));
  const goal = pickGoal(b, game);
  if (!goal) return go(b, 'idle', rng.range(2, 4));
  b.goal = goal;
  go(b, 'wander', 20);
}

function thinkWild(b: Brain, game: GameContext) {
  const e = b.e;
  const p = e.position;
  const s = b.s;
  const now = clock.now;
  if (b.target && !valid(b.target)) {
    // What it was after is dead: a meat-eater eats its kill.
    const kill = isEntity(b.target) && s.diet !== 'herbivore';
    b.target = null;
    if (b.mode === 'hunt' || b.mode === 'warn') {
      go(b, kill ? 'eat' : 'idle', kill ? 7 : 2);
      if (kill) b.hungryAt = now + game.rng.range(70, 150);
    }
  }
  if (b.mode === 'flee') {
    if (now >= b.until) s.locomotion === 'flyer' ? go(b, 'air', game.rng.range(15, 30)) : go(b, 'idle', 2);
    return;
  }
  if (b.mode === 'hunt') {
    const d = b.target ? flat(p, b.target.position) : Infinity;
    if (now >= b.until || d > b.t.sense * 2.2 + 12) {
      b.target = null;
      b.angryUntil = 0;
      b.hungryAt = Math.max(b.hungryAt, now + 25);
      go(b, 'idle', 3);
    }
    return;
  }
  const { player: np, d: dp } = nearestPlayer(game, p);
  if (b.mode === 'warn') {
    const d = b.target ? flat(p, b.target.position) : Infinity;
    if (d > b.t.sense * 1.4) {
      b.target = null;
      go(b, 'idle', 2);
    } else if (now >= b.until || d < b.t.sense * 0.45) {
      charge(b, b.target!, 12);
    }
    return;
  }
  switch (s.temper) {
    case 'skittish': {
      if (np && dp < 9 && !calm(b, np) && now >= b.stunUntil) return flee(b, np.position, game);
      for (const o of near(p, 13, scratch)) if (o.s.temper === 'aggressive' && !o.tame && !o.ko && o.id !== b.id && o.s.health >= s.health * 0.4) return flee(b, o.e.position, game);
      if (s.diet === 'scavenger' && b.mode !== 'eat') {
        // A carcass nearby: off to pick at it.
        const c = carcasses.find((c) => c.until > now && flat(c, p) < 30);
        if (c && flat(c, p) < 2.5) return go(b, 'eat', 6);
        if (c && b.mode !== 'wander') {
          b.goal = { x: c.x, z: c.z };
          return go(b, 'wander', 15);
        }
        if (c) return;
      }
      break;
    }
    case 'territorial': {
      if (np && dp < b.t.sense && !np.crouching) {
        // Face them and bellow: back off, or it charges.
        b.target = np;
        go(b, 'warn', 3);
        e.animate('roar');
        return call(game, b);
      }
      for (const o of near(p, b.t.sense, scratch)) if (o.s.temper === 'aggressive' && !o.tame && !o.ko && o.s.health >= s.health * 0.3) return charge(b, o.e, 10);
      break;
    }
    case 'aggressive': {
      // A crocodile lies in wait: it notices less, and lunges at what comes close.
      const sense = b.t.sense * (isNight(game) ? 1.25 : 1) * (b.id === 'sarcosuchus' ? 0.5 : 1);
      if (np && dp < sense && e.canSee(np)) {
        if (b.t.big) e.animate('roar');
        call(game, b);
        return charge(b, np, 25);
      }
      if (now >= b.hungryAt) {
        let prey: Brain | null = null;
        let best = Infinity;
        for (const o of near(p, sense, scratch)) {
          if (o === b || o.id === b.id || o.ko || o.mode === 'air' || o.s.health > s.health * 1.6 || (o.s.temper === 'aggressive' && !o.tame)) continue;
          const d = flat(o.e.position, p);
          if (d < best) [best, prey] = [d, o];
        }
        if (prey) return charge(b, prey.e, 20);
        b.hungryAt = now + 4;
      }
      break;
    }
    default:
      break;
  }
  idleLife(b, game);
}

function thinkTame(b: Brain, game: GameContext) {
  const rec = b.tame!;
  const p = b.e.position;
  if (b.target && (!valid(b.target) || rec.stance === 'passive' || flat(p, b.target.position) > 45)) b.target = null;
  if (b.target) {
    if (b.mode !== 'hunt') go(b, 'hunt', 1e9);
    return;
  }
  if (b.mode === 'hunt') go(b, 'idle', 1);
  const owner = ownerOf(game, rec);
  if (rec.order === 'follow' && owner && inPlay(owner)) {
    const d = flat(p, owner.position);
    const keep = 3.5 + b.s.hitbox.width;
    if (d > keep && d < 90) {
      if (b.mode !== 'follow') go(b, 'follow', 1e9);
    } else if (b.mode !== 'idle') go(b, 'idle', 1e9);
  } else if (rec.order === 'wander') {
    if (b.mode === 'follow') go(b, 'idle', 1);
    idleLife(b, game);
  } else if (b.mode !== 'idle') go(b, 'idle', 1e9);
}

/** The bite (or gore, or tail swing) at the end of a wind-up: it lands if the target is still in reach. */
function strike(b: Brain, game: GameContext, target: Entity | Player, lands: boolean) {
  const e = b.e;
  e.glow(null);
  e.animate('attack');
  game.audio.play('bt_bite', { at: e.position, pitch: b.t.big ? 0.7 : 1.15 });
  if (!lands) return;
  const damage = b.s.damage * (b.tame ? levelBonus(b.tame.level) : 1);
  target.damage(damage, { source: e, knockback: b.t.big ? 1.4 : 0.8, cause: 'melee' });
}

function pursue(b: Brain, game: GameContext, dt: number) {
  const e = b.e;
  const target = b.target;
  if (!valid(target)) return e.stop();
  const p = e.position;
  const tp = target.position;
  const d = flat(p, tp);
  const reach = b.t.reach + (isEntity(target) ? (brains.get(target.id)?.s.hitbox.width ?? 1) / 2 : 0.3);
  const level = Math.abs(tp.y - p.y) < b.s.hitbox.height + 2.5;
  if (b.wind > 0) {
    e.stop();
    e.lookAt(target);
    b.wind -= dt;
    if (b.wind <= 0) strike(b, game, target, d <= reach + 0.9 && level);
    return;
  }
  if (d <= reach * 0.85 && level) {
    e.stop();
    e.lookAt(target);
    if (b.cd > 0) return;
    // The tell: it rears, and a giant flushes and bellows before the blow lands.
    b.wind = b.t.windup;
    b.cd = b.t.cooldown;
    e.animate('raise');
    if (b.t.big) {
      e.glow('#ff9a3c');
      call(game, b, 0.8);
    }
    return;
  }
  // A wild predator stalks a player at a walk until it's close (or it's been hurt): then it runs them down.
  const stalking = !b.tame && isPlayer(target) && d > 12 && clock.now > b.angryUntil;
  e.setSpeed(stalking ? 1 : b.s.run / b.s.walk);
  if (isPlayer(target)) e.moveTo(target);
  else e.moveTo(tp);
  e.lookAt(d < 10 ? target : null);
}

/** A pterosaur on the wing: round and round over its herd's range, holding its height over the ground. */
function circle(b: Brain, game: GameContext) {
  const e = b.e;
  const p = e.position;
  const h = herds.get(b.herd) ?? { x: p.x, z: p.z };
  const rx = p.x - h.x;
  const rz = p.z - h.z;
  const rd = Math.hypot(rx, rz) || 1;
  const pull = Math.max(-1, Math.min(1, (14 - rd) / 6));
  const dx = -rz / rd + (rx / rd) * pull;
  const dz = rx / rd + (rz / rd) * pull;
  const l = Math.hypot(dx, dz) || 1;
  const ground = game.world.surfaceY(p.x, p.z);
  const want = (ground >= 0 ? ground + 1 : p.y - b.alt) + b.alt;
  e.setSpeed((b.s.run / b.s.walk) * 0.6);
  e.fly(dx / l, Math.max(-0.5, Math.min(0.6, (want - p.y) / 4)), dz / l);
}

function act(b: Brain, game: GameContext, dt: number) {
  const e = b.e;
  const p = e.position;
  const v = e.velocity;
  const speed = Math.hypot(v.x, v.z);
  if (speed > 0.4) b.yaw = Math.atan2(v.x, v.z);
  switch (b.mode) {
    case 'warn':
      e.stop();
      e.lookAt(b.target);
      return;
    case 'wander': {
      const g = b.goal;
      if (!g || flat(p, g) < 1.2 + b.s.hitbox.width / 2 || b.stuck > 2) return go(b, 'idle', game.rng.range(1, 3));
      b.stuck = speed < 0.2 ? b.stuck + dt : 0;
      e.setSpeed(1);
      e.moveTo({ x: g.x, y: p.y, z: g.z });
      return;
    }
    case 'flee': {
      const g = b.goal ?? p;
      const dx = p.x - g.x;
      const dz = p.z - g.z;
      const l = Math.hypot(dx, dz) || 1;
      e.setSpeed(b.s.run / b.s.walk);
      if (b.s.locomotion === 'flyer') e.fly(dx / l, 0.45, dz / l);
      else e.moveDirection(dx / l, dz / l);
      return;
    }
    case 'follow': {
      const owner = b.tame && ownerOf(game, b.tame);
      if (!owner) return e.stop();
      const d = flat(p, owner.position);
      if (d < (3.5 + b.s.hitbox.width) * 0.8) return e.stop();
      e.setSpeed(d > 9 ? (b.s.run / b.s.walk) * 1.1 : 1);
      e.moveTo(owner);
      return;
    }
    case 'hunt':
      return pursue(b, game, dt);
    case 'air':
      return circle(b, game);
    case 'land': {
      const ground = game.world.surfaceY(p.x, p.z);
      if (wetAt(game, p.x, p.z)) return go(b, 'air', 12);
      if (ground >= 0 && p.y - ground > 1.8) return e.fly(0, -0.45, 0);
      e.stop();
      if (e.onGround) go(b, 'graze', game.rng.range(8, 15));
      return;
    }
    default:
      e.stop();
  }
}

/** Every animal's AI: its entity type's `ai`. */
export function ai(self: Entity, game: GameContext, dt: number) {
  const b = brains.get(self.id);
  if (!b) return;
  b.cd -= dt;
  if (b.ko || clock.now < b.stunUntil) return self.stop();
  if (clock.now >= b.thinkAt) {
    b.thinkAt = clock.now + 0.35 + game.rng.next() * 0.15;
    if (b.wind <= 0) b.tame ? thinkTame(b, game) : thinkWild(b, game);
  }
  act(b, game, dt);
}
