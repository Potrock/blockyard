import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { ItemDefinition, ThrowableItem, Vec3 } from '../api/types';
import type { Registry } from '../world/registry';

/**
 * Throwables (`kind: 'throwable'`): how one flies, bounces, rolls and comes to rest, shared by the
 * host (which decides where and when it goes off) and every screen that flies it (the thrower's at
 * once, everyone else's from the host's word).
 *
 * A flight is worked out in fixed steps (`STEP`) counted from the throw, with nothing but plain
 * arithmetic and the world's own raycasts (no `Math.sin`, no clock), so the same throw on the same
 * blocks lands in the same place, step for step, however each machine's frames fall. Its fuse is
 * a number of steps, so it goes off where it's predicted to.
 */

/** Seconds a flight step lasts. */
export const STEP = 1 / 120;

export const DEG = Math.PI / 180;

/** A throwable's settings with the defaults filled in. */
export interface Throwable {
  def: ThrowableItem;
  fuse: number;
  cook: boolean;
  impact: boolean;
  key: string | null;
  speed: number;
  lift: number;
  gravity: number;
  bounce: number;
  friction: number;
  drag: number;
  radius: number;
  cooldown: number;
  blast: { radius: number; near: number; far: number; knockback: number; carve: number } | null;
  fire: { radius: number; duration: number; damage: number; color: string } | null;
}

const cache = new WeakMap<ThrowableItem, Throwable>();

export function throwable(def: ThrowableItem): Throwable {
  let t = cache.get(def);
  if (t) return t;
  const p = def.physics ?? {};
  const b = def.blast;
  const [near, far] = b ? (typeof b.damage === 'number' ? [b.damage, b.damage] : b.damage) : [0, 0];
  t = {
    def,
    fuse: Math.max(0, def.fuse ?? 3),
    cook: def.cook ?? !def.impact,
    impact: def.impact ?? false,
    key: def.key ?? null,
    speed: Math.max(1, def.speed ?? 20),
    lift: def.lift ?? 7,
    gravity: p.gravity ?? 24,
    bounce: Math.min(1, Math.max(0, p.bounce ?? 0.4)),
    friction: Math.min(1, Math.max(0, p.friction ?? 0.35)),
    drag: Math.max(0, p.drag ?? 0.1),
    radius: Math.min(0.45, Math.max(0.02, p.radius ?? 0.1)),
    cooldown: Math.max(0.05, def.cooldown ?? 0.8),
    blast: b ? { radius: Math.max(0.5, b.radius), near, far, knockback: b.knockback ?? 1, carve: Math.max(0, b.carve ?? 0) } : null,
    fire: def.fire ? { radius: Math.max(0.5, def.fire.radius), duration: Math.max(0, def.fire.duration), damage: def.fire.damage, color: def.fire.color ?? '#ff8a2a' } : null,
  };
  cache.set(def, t);
  return t;
}

export const isThrowable = (d: ItemDefinition | undefined): d is ThrowableItem => d?.kind === 'throwable';

/** One throwable in flight (or come to rest): plain numbers, the same on every machine that flies it. */
export interface Flight {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Steps flown so far. */
  steps: number;
  /** The step it goes off at (its fuse, less what was cooked off in the hand). */
  fuse: number;
  /** Rolling or sliding along the ground; at rest there. */
  ground: boolean;
  rest: boolean;
  /** It hit something (an `impact` throwable goes off). */
  struck: boolean;
}

/** What a flight asks of the world: the first solid block along a ray (unit `d`): how far, and the face it hits. */
export interface FlightWorld {
  hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number): { t: number; nx: number; ny: number; nz: number } | null;
}

/**
 * Solid blocks, as a flight meets them: through plants, torches and anything else bodies walk
 * through, stopping where a damaged block (or a slab) really is.
 */
export function flightWorld(world: VoxelWorld, registry: Registry): FlightWorld {
  return {
    hit(ox, oy, oz, dx, dy, dz, max) {
      let from = 0;
      for (let i = 0; i < 8; i++) {
        const r = world.raycast(ox + dx * from, oy + dy * from, oz + dz * from, dx, dy, dz, max - from);
        if (!r[0]) return null;
        const t = from + r[8];
        if (registry.blocks[r[7]]?.solid) return { t, nx: r[4], ny: r[5], nz: r[6] };
        from = t + 0.02;
        if (from >= max) return null;
      }
      return null;
    },
  };
}

/** How fast it leaves the hand, thrown along a view (lobbed `lift` degrees above it), at `speed` (its own, thrown hard). */
export function throwVelocity(t: Throwable, yaw: number, pitch: number, speed = t.speed): Vec3 {
  const p = Math.min(80 * DEG, pitch + t.lift * DEG);
  const cp = Math.cos(p);
  return { x: -Math.sin(yaw) * cp * speed, y: Math.sin(p) * speed, z: -Math.cos(yaw) * cp * speed };
}

/**
 * How to throw from `from` for it to come down at `to` (drag and bounces aside): lobbed up at
 * about 40 degrees, as hard as that needs (it lands steeply and doesn't roll far), or, too far
 * for that, as hard as it goes on the lower of its two arcs. The view (less its `lift`) and the
 * speed; null if it can't reach.
 */
export function lobView(t: Throwable, from: Vec3, to: Vec3): { yaw: number; pitch: number; speed: number } | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const x = Math.sqrt(dx * dx + dz * dz);
  const y = to.y - from.y;
  const g = t.gravity;
  const yaw = Math.atan2(-dx, -dz);
  if (x < 1e-3) return { yaw, pitch: (y >= 0 ? 80 : -80) * DEG - t.lift * DEG, speed: t.speed };
  const lob = 40 * DEG;
  const rise = x * Math.tan(lob) - y;
  if (rise > 0) {
    const speed = Math.sqrt((g * x * x) / (2 * Math.cos(lob) * Math.cos(lob) * rise));
    if (speed <= t.speed) return { yaw, pitch: lob - t.lift * DEG, speed };
  }
  const v2 = t.speed * t.speed;
  const disc = v2 * v2 - g * (g * x * x + 2 * y * v2);
  if (disc < 0) return null;
  const angle = Math.atan((v2 - Math.sqrt(disc)) / (g * x));
  return { yaw, pitch: angle - t.lift * DEG, speed: t.speed };
}

/** A new flight from `from` at velocity `v`, going off `fuse` steps on. */
export function newFlight(from: Vec3, v: Vec3, fuse: number): Flight {
  return { x: from.x, y: from.y, z: from.z, vx: v.x, vy: v.y, vz: v.z, steps: 0, fuse: Math.max(0, Math.round(fuse)), ground: false, rest: false, struck: false };
}

/** Steps to its going off: its fuse, less what was cooked off in the hand (a throwable that cooks). */
export function fuseSteps(t: Throwable, cooked: number): number {
  const left = t.fuse - (t.cook ? Math.min(t.fuse, Math.max(0, cooked)) : 0);
  return Math.max(0, Math.round(left / STEP));
}

/**
 * One step of a flight: gravity and drag, then along its velocity to the first block in the way,
 * where it bounces (the part of its speed into the block turned round and cut to `bounce`, the
 * part along it cut by `friction`). Landing gently on a floor it rolls, slowing, and comes to
 * rest. Returns how hard it hit something (the speed into it), 0 if it didn't.
 */
export function stepFlight(f: Flight, t: Throwable, w: FlightWorld): number {
  f.steps++;
  const r = t.radius;
  const dt = STEP;
  if (f.rest || f.ground) {
    // Still something under it?
    const under = w.hit(f.x, f.y, f.z, 0, -1, 0, r + 0.03);
    if (!under || under.ny < 0.7) {
      f.rest = false;
      f.ground = false;
    } else if (f.rest) return 0;
  }
  if (f.ground) {
    // Rolling: no falling, and the ground slows it.
    if (f.vy < 0) f.vy = 0;
    const k = Math.max(0, 1 - t.friction * 10 * dt);
    f.vx *= k;
    f.vz *= k;
  } else f.vy -= t.gravity * dt;
  const k = Math.max(0, 1 - t.drag * dt);
  f.vx *= k;
  f.vy *= k;
  f.vz *= k;
  const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy + f.vz * f.vz);
  if (f.ground && speed < 0.12) {
    f.vx = f.vy = f.vz = 0;
    f.rest = true;
    return 0;
  }
  if (speed < 1e-9) return 0;
  const dx = f.vx / speed;
  const dy = f.vy / speed;
  const dz = f.vz / speed;
  const travel = speed * dt;
  const h = w.hit(f.x, f.y, f.z, dx, dy, dz, travel + r);
  if (!h) {
    f.x += dx * travel;
    f.y += dy * travel;
    f.z += dz * travel;
    return 0;
  }
  // Up to where it touches (its radius off the block), then off it.
  const move = Math.max(0, h.t - r);
  f.x += dx * move;
  f.y += dy * move;
  f.z += dz * move;
  const vn = f.vx * h.nx + f.vy * h.ny + f.vz * h.nz;
  if (vn >= 0) return 0;
  // Along the face, less friction; into it, turned round and less the bounce.
  const tx = f.vx - vn * h.nx;
  const ty = f.vy - vn * h.ny;
  const tz = f.vz - vn * h.nz;
  const keep = 1 - t.friction;
  const out = -vn * t.bounce;
  f.vx = tx * keep + h.nx * out;
  f.vy = ty * keep + h.ny * out;
  f.vz = tz * keep + h.nz * out;
  f.struck = true;
  // A floor, gently: it stays down and rolls.
  if (h.ny > 0.7 && out < 1.6) {
    f.ground = true;
    f.vy = 0;
  }
  return -vn;
}

/**
 * Fly on by `dt` seconds' worth of whole steps (`acc` carries what's over to the next call), until
 * it's due to go off (or has struck something, for an `impact` throwable). `hit` hears each hit
 * (how hard). Returns true when it should go off.
 */
export function flyFor(f: Flight, t: Throwable, w: FlightWorld, acc: { t: number }, dt: number, hit?: (speed: number) => void): boolean {
  acc.t += dt;
  while (acc.t >= STEP - 1e-9) {
    if (f.steps >= f.fuse || (t.impact && f.struck)) return true;
    acc.t -= STEP;
    const s = stepFlight(f, t, w);
    if (s > 0) hit?.(s);
  }
  return f.steps >= f.fuse || (t.impact && f.struck);
}
