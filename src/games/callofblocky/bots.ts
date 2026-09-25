import type { Bot, GameContext, Player, Vec3 } from '@platform';
import type { Cell, NavGrid } from './nav';
import { WEAPONS } from './weapons';

/**
 * Bot fighters. Each drives a real player through a keyboard and mouse (`bot.controls`): it
 * looks around, spots whoever's in view, reacts after a beat, swings its aim on (never
 * perfectly), fires, strafes, holds the range its gun likes, reloads, switches to the pistol
 * when the primary runs dry in a fight, and otherwise roams the map along the walking grid,
 * toward the last place it saw someone or heard a shot.
 */

interface Brain {
  bot: Bot;
  /** 0..1: reaction, turn speed, aim steadiness, how often it goes for the head. */
  skill: number;
  yaw: number;
  pitch: number;
  target: Player | null;
  /** Seconds until it reacts to a new target. */
  react: number;
  /** Aim error (blocks at the target), settling while it tracks. */
  err: Vec3;
  head: boolean;
  lastSeen: Vec3 | null;
  lastSeenT: number;
  heard: { at: Vec3; t: number } | null;
  path: Cell[] | null;
  step: number;
  goal: Vec3 | null;
  repath: number;
  strafe: number;
  strafeT: number;
  crouchT: number;
  nextShot: number;
  stuckT: number;
  stuckAt: Vec3;
  wander: number;
  slideCool: number;
}

const HOLD_RANGE: Record<string, number> = { rifle: 16, smg: 8, shotgun: 4, sniper: 32, pistol: 11, katana: 1.5 };

export class Bots {
  private brains = new Map<string, Brain>();
  /** Something everyone's after (the briefcase): bots head for it when there's no one to shoot. */
  objective: Vec3 | null = null;

  constructor(
    private game: GameContext,
    private nav: () => NavGrid | null,
    /** Places worth drifting toward when there's nothing better to do. */
    private hotspots: Vec3[],
  ) {}

  /** A bot to drive. */
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
      path: null,
      step: 0,
      goal: null,
      repath: 0,
      strafe: 0,
      strafeT: 0,
      crouchT: 0,
      nextShot: 0,
      stuckT: 0,
      stuckAt: bot.position,
      wander: 0,
      slideCool: 0,
    });
  }

  remove(bot: Player) {
    this.brains.delete(bot.id);
  }

  /** A fresh life: aim and plans start over, facing the way it spawned. */
  respawned(bot: Player) {
    const b = this.brains.get(bot.id);
    if (!b) return;
    b.yaw = bot.yaw;
    b.pitch = 0;
    b.target = null;
    b.path = null;
    b.goal = null;
    b.lastSeen = null;
    b.heard = null;
    b.bot.controls.look(b.yaw, 0);
  }

  /** Someone fired: bots in earshot turn toward it. */
  heard(shooter: Player, at: Vec3) {
    const now = this.game.clock.now;
    for (const b of this.brains.values()) {
      if (b.bot === shooter || !b.bot.alive) continue;
      const p = b.bot.position;
      if (Math.hypot(p.x - at.x, p.z - at.z) < 40) b.heard = { at: { ...shooter.position }, t: now };
    }
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
    const held = bot.inventory.held?.item ?? 'rifle';
    const def = WEAPONS[held];
    const ammo = bot.inventory.ammo(held);
    b.slideCool = Math.max(0, b.slideCool - dt);

    // ---- Who can it see? Anyone in front of it (or right next to it) with nothing in between.
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
      const heardThem = b.heard && now - b.heard.t < 2 && Math.hypot(b.heard.at.x - p.position.x, b.heard.at.z - p.position.z) < 4;
      if (facing < 0.35 && d > 5 && !heardThem && p !== b.target) continue;
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
        // A beat to react, and a first swing that's off by a body or two.
        b.react = 0.18 + (1 - b.skill) * 0.35 + Math.random() * 0.15;
        const miss = 0.6 + (1 - b.skill) * 1.6;
        b.err = { x: (Math.random() - 0.5) * miss * 2, y: (Math.random() - 0.3) * miss, z: (Math.random() - 0.5) * miss * 2 };
        b.head = Math.random() < b.skill * 0.35;
      }
    }

    let moveX = 0;
    let moveZ = 0;
    let sprint = false;
    let wantJump = false;
    c.hold('KeyC', false);

    if (b.target) {
      const t = b.target;
      b.lastSeen = { ...t.position };
      b.lastSeenT = now;
      b.react -= dt;
      // Aim: at the chest (or head), leading a little, off by the error, which settles.
      const aim = b.head ? head(t) : chest(t);
      const v = t.velocity;
      const dist = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
      const lead = Math.min(0.12, dist / 300);
      const settle = Math.exp(-dt * (0.9 + b.skill * 2.2));
      b.err = { x: b.err.x * settle, y: b.err.y * settle, z: b.err.z * settle };
      const jitter = (1 - b.skill) * 0.25 + (bot.aiming ? 0 : 0.15);
      const px = aim.x + v.x * lead + b.err.x + (Math.random() - 0.5) * jitter;
      const py = aim.y + v.y * lead * 0.5 + b.err.y + (Math.random() - 0.5) * jitter;
      const pz = aim.z + v.z * lead + b.err.z + (Math.random() - 0.5) * jitter;
      const wantYaw = Math.atan2(-(px - eye.x), -(pz - eye.z));
      const wantPitch = Math.atan2(py - eye.y, Math.hypot(px - eye.x, pz - eye.z));
      const rate = (3.5 + b.skill * 9) * dt;
      b.yaw += clampAngle(angleDiff(wantYaw, b.yaw), rate);
      b.pitch += Math.max(-rate, Math.min(rate, wantPitch - b.pitch));
      c.look(b.yaw, b.pitch);
      // Fire once it's on target (near enough: a body's width at that distance).
      const trueYaw = Math.atan2(-(aim.x - eye.x), -(aim.z - eye.z));
      const truePitch = Math.atan2(aim.y - eye.y, Math.hypot(aim.x - eye.x, aim.z - eye.z));
      const off = Math.hypot(angleDiff(trueYaw, b.yaw), truePitch - b.pitch);
      const onTarget = off < Math.atan2(0.55 + (1 - b.skill) * 0.4, dist) + 0.02;
      const sniper = held === 'sniper';
      const wantAds = def?.kind === 'gun' && (sniper || (dist > 9 && held !== 'shotgun'));
      c.button(2, wantAds);
      const ready = b.react <= 0 && onTarget && (!sniper || bot.aiming) && (ammo?.magazine ?? 1) > 0;
      if (def?.kind === 'gun' && def.auto) c.button(0, ready);
      else {
        c.button(0, false);
        if (ready && now >= b.nextShot) {
          c.click(0);
          const interval = def?.kind === 'gun' ? 60 / def.rpm : 0.7;
          b.nextShot = now + interval * (1.05 + (1 - b.skill) * 0.8) + Math.random() * 0.15;
        }
      }
      // The katana: run at them.
      if (held === 'katana' && dist < 3.2 && now >= b.nextShot) {
        c.click(0);
        b.nextShot = now + 0.7;
      }
      // Out of rounds mid-fight: the pistol's quicker than a reload.
      if (ammo && ammo.magazine === 0 && held !== 'pistol' && dist < 14 && (bot.inventory.ammo('pistol')?.magazine ?? 0) > 0) c.press('Digit2');
      // Move: strafe side to side, closing to or backing off to the range the gun likes.
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafe = [-1, 0, 1][Math.floor(Math.random() * 3)];
        b.strafeT = 0.35 + Math.random() * 0.9;
        if (Math.random() < 0.18 * b.skill && bot.onGround) wantJump = true;
        if (Math.random() < 0.2 && wantAds) b.crouchT = 0.6 + Math.random() * 0.8;
      }
      const tx = t.position.x - pos.x;
      const tz = t.position.z - pos.z;
      const td = Math.hypot(tx, tz) || 1;
      const range = HOLD_RANGE[held] ?? 12;
      const close = td > range * 1.25 ? 1 : td < range * 0.6 ? -1 : 0;
      moveX = (tx / td) * close + (-tz / td) * b.strafe;
      moveZ = (tz / td) * close + (tx / td) * b.strafe;
      if (b.crouchT > 0) {
        b.crouchT -= dt;
        c.hold('KeyC', true);
        moveX *= 0.3;
        moveZ *= 0.3;
      }
      // Rushing in with a shotgun or SMG: a slide now and then.
      if (close > 0 && (held === 'shotgun' || held === 'smg' || held === 'katana') && td > 6) {
        sprint = !wantAds;
        if (sprint && b.slideCool <= 0 && Math.random() < dt * 0.8) {
          c.press('KeyC');
          b.slideCool = 3;
        }
      }
      b.path = null;
    } else {
      c.button(0, false);
      c.button(2, false);
      // Back to the primary, topped up.
      if (held !== 'rifle' && held !== 'smg' && held !== 'shotgun' && held !== 'sniper') c.press('Digit1');
      if (ammo && def?.kind === 'gun' && ammo.magazine < def.magazine * 0.5 && ammo.reserve > 0 && now - b.lastSeenT > 1) c.press('KeyR');
      // Where to: where it last saw someone, a shot it heard, or somewhere worth being.
      const nav = this.nav();
      b.repath -= dt;
      if (nav && (!b.path || b.step >= b.path.length || b.repath <= 0)) {
        let goal: Vec3 | null = null;
        if (this.objective && b.skill > 0.5 !== Math.random() < 0.3) goal = this.objective;
        else if (b.heard && now - b.heard.t < 4) goal = b.heard.at;
        else if (b.lastSeen && now - b.lastSeenT < 6) goal = b.lastSeen;
        else if (!b.goal || b.wander <= 0 || (b.path && b.step >= b.path.length)) {
          const r = Math.random();
          goal = r < 0.55 && this.hotspots.length ? this.hotspots[Math.floor(Math.random() * this.hotspots.length)] : (nav.random(Math.random) ?? pos);
          b.wander = 8 + Math.random() * 10;
        } else goal = b.goal;
        b.goal = goal;
        b.path = nav.path(pos, goal);
        b.step = 0;
        b.repath = 2 + Math.random();
        if (!b.path) b.goal = null;
      }
      b.wander -= dt;
      const path = b.path;
      if (path && b.step < path.length) {
        // Skip waypoints already reached; head for the next.
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
        // Look where it's going (a little ahead), glancing about.
        const lx = ahead.x + 0.5 - eye.x;
        const lz = ahead.z + 0.5 - eye.z;
        const wantYaw = Math.atan2(-lx, -lz) + Math.sin(now * 0.9 + b.skill * 10) * 0.25;
        b.yaw += clampAngle(angleDiff(wantYaw, b.yaw), 5 * dt);
        b.pitch += (Math.atan2(ahead.y + 1.2 - eye.y, Math.hypot(lx, lz)) * 0.5 - b.pitch) * Math.min(1, dt * 4);
        c.look(b.yaw, b.pitch);
        if (sprint && b.slideCool <= 0 && Math.random() < dt * 0.15) {
          c.press('KeyC');
          b.slideCool = 4;
        }
      } else if (b.heard && now - b.heard.t < 3) {
        const h = b.heard.at;
        b.yaw += clampAngle(angleDiff(Math.atan2(-(h.x - pos.x), -(h.z - pos.z)), b.yaw), 6 * dt);
        c.look(b.yaw, b.pitch * 0.9);
      }
    }

    // Stuck against something: jump, and if that doesn't help, go somewhere else.
    const moving = Math.hypot(moveX, moveZ) > 0.1;
    if (moving) {
      b.stuckT += dt;
      if (b.stuckT > 0.5) {
        const moved = Math.hypot(pos.x - b.stuckAt.x, pos.z - b.stuckAt.z);
        if (moved < 0.35) {
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

    // The move as keys, relative to where it's looking.
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

function chest(p: Player): Vec3 {
  const q = p.position;
  return { x: q.x, y: q.y + (p.sliding ? 0.55 : p.crouching ? 0.85 : 1.1), z: q.z };
}

function head(p: Player): Vec3 {
  const q = p.position;
  return { x: q.x, y: q.y + (p.sliding ? 1.1 : p.crouching ? 1.45 : 1.75), z: q.z };
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return d;
}

function clampAngle(d: number, max: number): number {
  return Math.max(-max, Math.min(max, d));
}
