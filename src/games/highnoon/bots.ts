import type { Bot, GameContext, Player, Vec3 } from '@platform';
import type { Cell, NavGrid } from './nav';
import { WEAPONS } from './weapons';

/**
 * Bot gunslingers, driven through a keyboard and mouse (`bot.controls`) like anyone: they look
 * about, spot whoever's in view, take a beat to react, swing their aim on (never perfectly) and
 * squeeze off shots at the gun's pace; the Yellowboy at range, the Peacemaker up close. Nothing
 * reloads by itself in Dry Gulch, so they press R when they're dry, and thumb rounds in between
 * fights. Shot at, they sometimes dodge-roll (Q). Otherwise they prowl the town along the walking
 * grid toward the last place they saw someone or heard a shot. (After Call of Blocky's bots.)
 */

interface Brain {
  bot: Bot;
  /** 0..1: reaction, turn speed, aim steadiness, how often it goes for the head. */
  skill: number;
  yaw: number;
  pitch: number;
  target: Player | null;
  react: number;
  err: Vec3;
  head: boolean;
  lastSeen: Vec3 | null;
  lastSeenT: number;
  heard: { at: Vec3; t: number } | null;
  hurtT: number;
  path: Cell[] | null;
  step: number;
  goal: Vec3 | null;
  repath: number;
  strafe: number;
  strafeT: number;
  nextShot: number;
  stuckT: number;
  stuckAt: Vec3;
  wander: number;
}

const HOLD_RANGE: Record<string, number> = { revolver: 11, rifle: 22 };

export class Bots {
  private brains = new Map<string, Brain>();
  /** Everyone still standing, once the sun gives them away: bots with nobody in sight go for the nearest. */
  hunt: Player[] = [];

  constructor(
    private game: GameContext,
    private nav: () => NavGrid | null,
    private hotspots: Vec3[],
  ) {}

  add(bot: Bot, skill: number) {
    this.brains.set(bot.id, {
      bot,
      skill,
      yaw: bot.yaw,
      pitch: 0,
      target: null,
      react: 0,
      err: { x: 0, y: 0, z: 0 },
      head: false,
      lastSeen: null,
      lastSeenT: -99,
      heard: null,
      hurtT: -99,
      path: null,
      step: 0,
      goal: null,
      repath: 0,
      strafe: 0,
      strafeT: 0,
      nextShot: 0,
      stuckT: 0,
      stuckAt: bot.position,
      wander: 0,
    });
  }

  remove(bot: Player) {
    this.brains.delete(bot.id);
  }

  /** A new round: plans start over, facing the way it stands. */
  reset(bot: Player) {
    const b = this.brains.get(bot.id);
    if (!b) return;
    // (Timers too: a restart starts the game's clock again from 0.)
    Object.assign(b, { yaw: bot.yaw, pitch: 0, target: null, path: null, goal: null, lastSeen: null, lastSeenT: -99, heard: null, hurtT: -99, nextShot: 0, wander: 0 });
    b.bot.controls.release();
    b.bot.controls.look(b.yaw, 0);
  }

  heard(shooter: Player, at: Vec3) {
    const now = this.game.clock.now;
    for (const b of this.brains.values()) {
      if (b.bot === shooter || !b.bot.alive) continue;
      const p = b.bot.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) < 50) b.heard = { at: { ...shooter.position }, t: now };
    }
  }

  hurt(bot: Player, by: Player | null) {
    const b = this.brains.get(bot.id);
    if (!b) return;
    b.hurtT = this.game.clock.now;
    if (by && !b.target) b.heard = { at: { ...by.position }, t: b.hurtT };
  }

  update(dt: number, frozen: boolean) {
    for (const b of this.brains.values()) {
      if (frozen || !b.bot.alive) {
        b.bot.controls.release();
        b.target = null;
        continue;
      }
      this.think(b, dt);
    }
  }

  private think(b: Brain, dt: number) {
    const game = this.game;
    const bot = b.bot;
    const c = bot.controls;
    const now = game.clock.now;
    const eye = bot.eye;
    const pos = bot.position;
    const held = bot.inventory.held?.item ?? 'revolver';
    const def = WEAPONS[held];
    const ammo = bot.inventory.ammo(held);

    // ---- Who can it see?
    const look = bot.look;
    let best: Player | null = null;
    let bestScore = Infinity;
    for (const p of game.players) {
      if (p === bot || !p.alive) continue;
      const t = chest(p);
      const dx = t.x - eye.x;
      const dy = t.y - eye.y;
      const dz = t.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 90) continue;
      const facing = (dx * look.x + dy * look.y + dz * look.z) / d;
      const heardThem = b.heard && now - b.heard.t < 2 && Math.hypot(b.heard.at.x - p.position.x, b.heard.at.z - p.position.z) < 5;
      if (facing < 0.3 && d > 5 && !heardThem && p !== b.target) continue;
      if (!game.world.lineOfSight(eye, t)) continue;
      const score = d * (p === b.target ? 0.55 : 1) * (facing > 0.8 ? 0.8 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best !== b.target) {
      b.target = best;
      if (best) {
        b.react = 0.32 + (1 - b.skill) * 0.4 + Math.random() * 0.25;
        const miss = 1 + (1 - b.skill) * 1.8;
        b.err = { x: (Math.random() - 0.5) * miss * 2, y: (Math.random() - 0.3) * miss, z: (Math.random() - 0.5) * miss * 2 };
        b.head = Math.random() < 0.1 + b.skill * 0.2;
      }
    }

    let moveX = 0;
    let moveZ = 0;
    let sprint = false;
    let wantJump = false;

    if (b.target) {
      const t = b.target;
      b.lastSeen = { ...t.position };
      b.lastSeenT = now;
      b.react -= dt;
      const aim = b.head ? head(t) : chest(t);
      const v = t.velocity;
      const dist = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
      // The right gun for the range: the rifle out past 18, the revolver inside 12.
      const want = dist > 18 ? 'rifle' : dist < 12 ? 'revolver' : held;
      if (want !== held && (bot.inventory.ammo(want)?.magazine ?? 0) > 0) c.press(want === 'revolver' ? 'Digit1' : 'Digit2');
      const lead = Math.min(0.12, dist / 300);
      const reacting = b.react > 0;
      const settle = reacting ? 1 : Math.exp(-dt * (0.7 + b.skill * 1.5));
      const drag = reacting ? 0 : dt * (0.08 + (1 - b.skill) * 0.2);
      b.err = { x: b.err.x * settle - v.x * drag, y: b.err.y * settle, z: b.err.z * settle - v.z * drag };
      const jitter = (1 - b.skill) * 0.35 + (bot.aiming ? 0.05 : 0.22) + Math.hypot(v.x, v.z) * 0.04;
      const px = aim.x + v.x * lead + b.err.x + (Math.random() - 0.5) * jitter;
      const py = aim.y + v.y * lead * 0.5 + b.err.y + (Math.random() - 0.5) * jitter;
      const pz = aim.z + v.z * lead + b.err.z + (Math.random() - 0.5) * jitter;
      const wantYaw = Math.atan2(-(px - eye.x), -(pz - eye.z));
      const wantPitch = Math.atan2(py - eye.y, Math.hypot(px - eye.x, pz - eye.z));
      const rate = reacting ? 0 : (2.4 + b.skill * 6) * dt;
      b.yaw += clampAngle(angleDiff(wantYaw, b.yaw), rate);
      b.pitch += Math.max(-rate, Math.min(rate, wantPitch - b.pitch));
      c.look(b.yaw, b.pitch);
      const trueYaw = Math.atan2(-(aim.x - eye.x), -(aim.z - eye.z));
      const truePitch = Math.atan2(aim.y - eye.y, Math.hypot(aim.x - eye.x, aim.z - eye.z));
      const off = Math.hypot(angleDiff(trueYaw, b.yaw), truePitch - b.pitch);
      const onTarget = off < Math.atan2(0.5 + (1 - b.skill) * 0.4, dist) + 0.02;
      // Down the sights at range (always with the rifle).
      const ads = held === 'rifle' || dist > 14;
      c.button(2, ads);
      const loaded = (ammo?.magazine ?? 0) > 0;
      if (b.react <= 0 && onTarget && loaded && (!ads || bot.aiming) && now >= b.nextShot) {
        c.click(0);
        b.nextShot = now + (60 / (def?.rpm ?? 120)) * (1.1 + (1 - b.skill) * 0.9) + Math.random() * 0.2;
      }
      // Dry: switch to the other gun if it's loaded, else load.
      if (!loaded) {
        const other = held === 'revolver' ? 'rifle' : 'revolver';
        if ((bot.inventory.ammo(other)?.magazine ?? 0) > 0) c.press(other === 'revolver' ? 'Digit1' : 'Digit2');
        else c.press('KeyR');
      }
      // Move: strafe, closing or backing off to the range the gun likes.
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafe = [-1, 0, 1][Math.floor(Math.random() * 3)];
        b.strafeT = 0.4 + Math.random() * 0.9;
      }
      const tx = t.position.x - pos.x;
      const tz = t.position.z - pos.z;
      const td = Math.hypot(tx, tz) || 1;
      const range = HOLD_RANGE[held] ?? 14;
      const close = td > range * 1.3 ? 1 : td < range * 0.55 ? -1 : 0;
      moveX = (tx / td) * close + (-tz / td) * b.strafe;
      moveZ = (tz / td) * close + (tx / td) * b.strafe;
      // Just hit: a dodge roll now and then (the roll goes the way it's strafing).
      if (now - b.hurtT < 0.3 && b.strafe !== 0 && Math.random() < 0.35 * b.skill + 0.1) c.press('KeyQ');
      b.path = null;
    } else {
      c.button(0, false);
      c.button(2, false);
      // Between fights: the revolver in hand, rounds thumbed in.
      if (held !== 'revolver') c.press('Digit1');
      else if (ammo && def && ammo.magazine < def.magazine && ammo.reserve > 0 && now - b.lastSeenT > 1.2 && Math.random() < 0.1) c.press('KeyR');
      const nav = this.nav();
      b.repath -= dt;
      if (nav && (!b.path || b.step >= b.path.length || b.repath <= 0)) {
        let goal: Vec3 | null = null;
        const prey = this.hunt.filter((p) => p !== bot && p.alive).sort((p, q) => dist2(p.position, pos) - dist2(q.position, pos))[0];
        if (prey) goal = { ...prey.position };
        else if (b.heard && now - b.heard.t < 5) goal = b.heard.at;
        else if (b.lastSeen && now - b.lastSeenT < 6) goal = b.lastSeen;
        else if (!b.goal || b.wander <= 0 || (b.path && b.step >= b.path.length)) {
          goal = Math.random() < 0.6 && this.hotspots.length ? this.hotspots[Math.floor(Math.random() * this.hotspots.length)] : (nav.random(Math.random) ?? pos);
          b.wander = 6 + Math.random() * 8;
        } else goal = b.goal;
        b.goal = goal;
        b.path = nav.path(pos, goal);
        b.step = 0;
        b.repath = 1.8 + Math.random();
        if (!b.path) b.goal = null;
      }
      b.wander -= dt;
      const path = b.path;
      if (path && b.step < path.length) {
        let w = path[b.step];
        while (b.step < path.length - 1 && Math.hypot(w.x + 0.5 - pos.x, w.z + 0.5 - pos.z) < 0.7 && Math.abs(w.y - pos.y) < 1.2) w = path[++b.step];
        if (b.step === path.length - 1 && Math.hypot(w.x + 0.5 - pos.x, w.z + 0.5 - pos.z) < 0.7) b.step++;
        const ahead = path[Math.min(path.length - 1, b.step + 2)];
        const dx = w.x + 0.5 - pos.x;
        const dz = w.z + 0.5 - pos.z;
        const d = Math.hypot(dx, dz) || 1;
        moveX = dx / d;
        moveZ = dz / d;
        const prev = b.step > 0 ? path[b.step - 1] : null;
        if (w.y > pos.y + 0.6 && (prev === null || nav!.needsJump(prev, w) || w.y - pos.y > 0.9) && d < 1.6) wantJump = true;
        sprint = path.length - b.step > 5;
        const lx = ahead.x + 0.5 - eye.x;
        const lz = ahead.z + 0.5 - eye.z;
        const wantYaw = Math.atan2(-lx, -lz) + Math.sin(now * 0.9 + b.skill * 10) * 0.3;
        b.yaw += clampAngle(angleDiff(wantYaw, b.yaw), 5 * dt);
        b.pitch += (Math.atan2(ahead.y + 1.2 - eye.y, Math.hypot(lx, lz)) * 0.5 - b.pitch) * Math.min(1, dt * 4);
        c.look(b.yaw, b.pitch);
      } else if (b.heard && now - b.heard.t < 3) {
        const hp = b.heard.at;
        b.yaw += clampAngle(angleDiff(Math.atan2(-(hp.x - pos.x), -(hp.z - pos.z)), b.yaw), 6 * dt);
        c.look(b.yaw, b.pitch * 0.9);
      }
    }

    // Stuck: jump, then give up on the plan.
    if (Math.hypot(moveX, moveZ) > 0.1) {
      b.stuckT += dt;
      if (b.stuckT > 0.5) {
        if (Math.hypot(pos.x - b.stuckAt.x, pos.z - b.stuckAt.z) < 0.35) {
          wantJump = true;
          if (b.stuckT > 1.6) {
            b.path = null;
            b.goal = null;
            b.strafe = -b.strafe;
          }
        } else {
          b.stuckT = 0;
          b.stuckAt = pos;
        }
      }
    } else {
      b.stuckT = 0;
      b.stuckAt = pos;
    }

    const f = -Math.sin(b.yaw) * moveX + -Math.cos(b.yaw) * moveZ;
    const r = Math.cos(b.yaw) * moveX - Math.sin(b.yaw) * moveZ;
    c.hold('KeyW', f > 0.38);
    c.hold('KeyS', f < -0.38);
    c.hold('KeyD', r > 0.38);
    c.hold('KeyA', r < -0.38);
    c.hold('ShiftLeft', sprint && f > 0.5);
    c.hold('Space', wantJump);
  }
}

const dist2 = (a: Vec3, b: Vec3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

function chest(p: Player): Vec3 {
  const q = p.position;
  return { x: q.x, y: q.y + (p.sliding ? 0.55 : p.crouching ? 0.85 : 1.1), z: q.z };
}

function head(p: Player): Vec3 {
  const q = p.position;
  return { x: q.x, y: q.y + (p.sliding ? 1.1 : p.crouching ? 1.45 : 1.72), z: q.z };
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return d;
}

function clampAngle(d: number, max: number): number {
  return Math.max(-max, Math.min(max, d));
}
