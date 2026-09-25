import type { AimAssist, GunItem, GunOptions, ItemDefinition, PlayerHitbox, Vec3 } from '../api/types';
import type { MoveMods } from './movement';

/**
 * Gun rules shared by the host and the shooter's own screen, so both fire, spread, reload and
 * slow down the same way: the screen shows a shot the moment it's fired, and the host (which
 * decides what it hit) agrees about where it went.
 */

export const DEG = Math.PI / 180;

/** A gun's rounds and what it's doing. The host keeps one per gun a player carries; their screen keeps its own the same way. */
export interface GunState {
  mag: number;
  reserve: number;
  /** Seconds left of the reload (a shotgun: of the round going in); -1 when not reloading. */
  reload: number;
  /** Seconds until it can fire again (the fire rate, a pump, a raise after switching). */
  cooldown: number;
  /** Shots so far: each shot's spread is seeded by it, the same on both sides. */
  serial: number;
  /** Extra spread from recent shots, in degrees. */
  bloom: number;
  /** Aimed down the sights, 0..1. */
  aim: number;
  /** Shots the host may still take from a client (it can't fire faster than the gun). */
  tokens: number;
}

/** A gun's settings with the defaults filled in. */
export interface Gun {
  def: GunItem;
  near: number;
  far: number;
  falloff: [number, number];
  headshot: number;
  range: number;
  pellets: number;
  interval: number;
  spread: { hip: number; aim: number; move: number; air: number; bloom: number };
  recoil: { up: number; side: number; recover: number };
  aim: { zoom: number; time: number; move: number; sight: 'iron' | 'dot' | 'holo' | 'scope'; color: string };
  reserve: number;
  mobility: number;
}

const cache = new WeakMap<GunItem, Gun>();

export function gun(def: GunItem): Gun {
  let g = cache.get(def);
  if (g) return g;
  const [near, far] = typeof def.damage === 'number' ? [def.damage, def.damage] : def.damage;
  g = {
    def,
    near,
    far,
    falloff: def.falloff ?? [20, 50],
    headshot: def.headshot ?? 1.5,
    range: def.range ?? 150,
    pellets: Math.max(1, Math.floor(def.pellets ?? 1)),
    interval: 60 / Math.max(1, def.rpm),
    spread: { hip: 2.5, aim: 0.25, move: 1.5, air: 3, bloom: 0.35, ...def.spread },
    recoil: { up: 1, side: 0.35, recover: 0.75, ...def.recoil },
    aim: { zoom: def.aim?.zoom ?? 1.3, time: def.aim?.time ?? 0.2, move: def.aim?.move ?? 0.6, sight: def.aim?.sight ?? 'iron', color: def.aim?.color ?? '#ff2a2a' },
    reserve: def.reserve ?? def.magazine * 3,
    mobility: def.mobility ?? 1,
  };
  cache.set(def, g);
  return g;
}

export const isGun = (d: ItemDefinition | undefined): d is GunItem => d?.kind === 'gun';

export function freshGun(def: GunItem): GunState {
  const g = gun(def);
  return { mag: def.magazine, reserve: g.reserve, reload: -1, cooldown: 0, serial: 0, bloom: 0, aim: 0, tokens: 2 };
}

/** Seconds a gun takes to come up after switching to it (no firing meanwhile). */
export const RAISE = 0.35;

/**
 * A game's gun rules (`GameDefinition.guns`) with the defaults filled in. The host and each
 * shooter's screen resolve the same ones from the game's definition, so they agree.
 */
export interface GunRules {
  rewind: number;
  /** Per stance (standing, crouching, sliding): the neck and the top of the head, and the body's and head's half widths. */
  boxes: [StanceBox, StanceBox, StanceBox];
  aimSlows: boolean;
  aimStopsSprint: boolean;
  fireStopsSprint: boolean;
  autoReload: boolean;
  rateSlack: number;
  /** The game's aim assist shape (each gun's goes over it: see `assistOf`). */
  assist: AimAssist;
}

/** A stance's hitboxes: [neck, top of the head, body half width, head half width], blocks from the feet. */
type StanceBox = [number, number, number, number];

/**
 * The figure is two blocks tall: legs and body to 1.5, the head above. Crouched it's 0.3 lower;
 * sliding it leans back from the hips, so the boxes are lower and wider.
 */
const BOXES: [StanceBox, StanceBox, StanceBox] = [
  [1.5, 2.0, 0.36, 0.28],
  [1.2, 1.7, 0.38, 0.3],
  [0.85, 1.4, 0.45, 0.45],
];

/** A game's `guns`, with the defaults filled in (a hitbox's widths halved, as `playerBoxes` uses them). */
export function resolveGunRules(o: GunOptions = {}): GunRules {
  const box = (i: Stance, h: Partial<PlayerHitbox> | undefined): StanceBox => {
    const [neck, top, bw, hw] = BOXES[i];
    return [h?.neck ?? neck, h?.height ?? top, h?.width === undefined ? bw : h.width / 2, h?.headWidth === undefined ? hw : h.headWidth / 2];
  };
  const hb = o.hitboxes ?? {};
  return {
    // A laggy shooter doesn't get to hit where someone was a second ago.
    rewind: Math.max(0, o.rewind ?? 0.35),
    boxes: [box(0, hb.stand), box(1, hb.crouch), box(2, hb.slide)],
    aimSlows: o.aimSlows ?? true,
    aimStopsSprint: o.aimStopsSprint ?? true,
    fireStopsSprint: o.fireStopsSprint ?? true,
    autoReload: o.autoReload ?? true,
    rateSlack: Math.max(1, o.rateSlack ?? 3),
    assist: o.assist ?? {},
  };
}

export const DEFAULT_GUN_RULES = resolveGunRules();

/**
 * How the held item and the mouse change movement: a gun's weight; aiming slows (to the gun's
 * `aim.move`) and stops sprinting, and so does firing, unless the game's rules say otherwise.
 */
export function moveMods(def: ItemDefinition | undefined, buttons: number, speed = 1, rules: GunRules = DEFAULT_GUN_RULES): MoveMods {
  if (!isGun(def)) return speed === 1 ? { speed: 1, noSprint: false } : { speed, noSprint: false };
  const g = gun(def);
  const aiming = (buttons & 4) !== 0;
  const firing = (buttons & 1) !== 0;
  return { speed: speed * g.mobility * (aiming && rules.aimSlows ? g.aim.move : 1), noSprint: (aiming && rules.aimStopsSprint) || (firing && rules.fireStopsSprint) };
}

/** Aim assist's shape with the defaults filled in (see `AimAssist`); `angle` in radians. */
export interface Assist {
  strength: number;
  radius: number;
  angle: number;
  slow: { hip: number; aim: number };
  follow: { hip: number; aim: number };
}

/** A gun's aim assist: its own `aim.assist` (a strength, or a shape) over the game's, over the defaults. */
export function assistOf(g: Gun, rules: GunRules): Assist {
  const a = g.def.aim?.assist;
  const own: AimAssist = typeof a === 'number' ? { strength: a } : (a ?? {});
  const game = rules.assist;
  const angle = own.cone?.angle ?? game.cone?.angle;
  return {
    strength: own.strength ?? game.strength ?? 0.6,
    radius: own.cone?.radius ?? game.cone?.radius ?? 1.1,
    angle: angle === undefined ? 0.025 : angle * DEG,
    slow: { hip: own.slow?.hip ?? game.slow?.hip ?? 0.45, aim: own.slow?.aim ?? game.slow?.aim ?? 0.6 },
    follow: { hip: own.follow?.hip ?? game.follow?.hip ?? 0.4, aim: own.follow?.aim ?? game.follow?.aim ?? 0.6 },
  };
}

/** The spread cone's half angle in degrees for a shot now. `moving` is 0..1 (a fraction of walking speed). */
export function spreadDeg(g: Gun, s: { aim: number; moving: number; air: boolean; crouch: boolean; bloom: number }): number {
  const sp = g.spread;
  let d = sp.hip + (sp.aim - sp.hip) * s.aim;
  d += Math.min(1, s.moving) * sp.move * (1 - 0.7 * s.aim);
  if (s.air) d += sp.air;
  if (s.crouch) d *= 0.8;
  return d + s.bloom;
}

/** After a shot: the bloom it adds (capped), in degrees. */
export function addBloom(g: Gun, bloom: number): number {
  return Math.min(g.spread.bloom * 8, bloom + g.spread.bloom);
}

/** Bloom settling between shots. */
export function settleBloom(g: Gun, bloom: number, dt: number): number {
  return Math.max(0, bloom - dt * Math.max(2, g.spread.bloom * 12));
}

/** Aiming down the sights moves toward held or not over the gun's aim time. */
export function stepAim(g: Gun, aim: number, held: boolean, dt: number): number {
  const k = dt / Math.max(0.05, g.aim.time);
  return held ? Math.min(1, aim + k) : Math.max(0, aim - k * 1.4);
}

/** A unit vector along yaw / pitch (yaw 0 looks toward -z). */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Small deterministic random numbers from a seed (the same on every machine). */
function rand(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The directions a shot's bullets go: spread evenly over the cone (a shotgun's pellets in rings,
 * a rifle's bullet anywhere in it), seeded by the shot's serial so the host and the shooter's
 * screen agree.
 */
export function pelletDirs(g: Gun, yaw: number, pitch: number, spread: number, serial: number): Vec3[] {
  const f = lookDir(yaw, pitch);
  // Right and up, perpendicular to the look.
  const r = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
  const rnd = rand(serial + 1);
  const t = Math.tan(spread * DEG);
  const out: Vec3[] = [];
  const n = g.pellets;
  for (let i = 0; i < n; i++) {
    let a: number;
    let d: number;
    if (n === 1) {
      a = rnd() * Math.PI * 2;
      d = Math.sqrt(rnd());
    } else {
      // A spread pattern: a pellet near the middle, the rest round a ring, all a little jittered.
      a = (i / n) * Math.PI * 2 + rnd() * 0.6;
      d = i === 0 ? rnd() * 0.25 : 0.55 + rnd() * 0.45;
    }
    const ox = Math.cos(a) * d * t;
    const oy = Math.sin(a) * d * t;
    const x = f.x + r.x * ox + u.x * oy;
    const y = f.y + r.y * ox + u.y * oy;
    const z = f.z + r.z * ox + u.z * oy;
    const l = Math.hypot(x, y, z);
    out.push({ x: x / l, y: y / l, z: z / l });
  }
  return out;
}

/** A bullet's damage at a distance, and on the head. */
export function damageAt(g: Gun, dist: number, head: boolean): number {
  const [a, b] = g.falloff;
  const k = b > a ? Math.min(1, Math.max(0, (dist - a) / (b - a))) : dist >= b ? 1 : 0;
  return (g.near + (g.far - g.near) * k) * (head ? g.headshot : 1);
}

/** A reload makes sense: not already reloading, room in the magazine, rounds to spare. */
export function canReload(g: Gun, s: GunState): boolean {
  return s.reload < 0 && s.mag < g.def.magazine && s.reserve > 0;
}

export function startReload(g: Gun, s: GunState) {
  s.reload = g.def.reload;
}

/**
 * The reload goes on: a magazine goes in at the end; a shotgun loads a round at a time and keeps
 * going until it's full, out of rounds, or the trigger's pulled. True when rounds went in.
 */
export function stepReload(g: Gun, s: GunState, dt: number, trigger: boolean): boolean {
  if (s.reload < 0) return false;
  s.reload -= dt;
  if (s.reload > 0) return false;
  if (g.def.shells) {
    s.mag++;
    s.reserve--;
    s.reload = s.mag < g.def.magazine && s.reserve > 0 && !trigger ? s.reload + g.def.reload : -1;
  } else {
    const n = Math.min(g.def.magazine - s.mag, s.reserve);
    s.mag += n;
    s.reserve -= n;
    s.reload = -1;
  }
  return true;
}

/** Stance for hitboxes: standing, crouching or sliding. */
export type Stance = 0 | 1 | 2;

/**
 * A player's hitboxes where they stand (feet at `p`): the body and the head, as min / max corners.
 * They match the figure everyone sees: upright, crouched, or leaning back in a slide (the game's
 * `guns.hitboxes` can change them).
 */
export function playerBoxes(p: Vec3, stance: Stance, rules: GunRules = DEFAULT_GUN_RULES): { body: [Vec3, Vec3]; head: [Vec3, Vec3] } {
  const [bodyTop, headTop, bw, hw] = rules.boxes[stance];
  return {
    body: [
      { x: p.x - bw, y: p.y, z: p.z - bw },
      { x: p.x + bw, y: p.y + bodyTop, z: p.z + bw },
    ],
    head: [
      { x: p.x - hw, y: p.y + bodyTop, z: p.z - hw },
      { x: p.x + hw, y: p.y + headTop, z: p.z + hw },
    ],
  };
}

/** Where a ray (unit direction) first enters a box, or null. */
export function rayBox(o: Vec3, d: Vec3, min: Vec3, max: Vec3): number | null {
  let t0 = 0;
  let t1 = Infinity;
  const os = [o.x, o.y, o.z];
  const ds = [d.x, d.y, d.z];
  const lo = [min.x, min.y, min.z];
  const hi = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ds[i]) < 1e-9) {
      if (os[i] < lo[i] || os[i] > hi[i]) return null;
      continue;
    }
    let a = (lo[i] - os[i]) / ds[i];
    let b = (hi[i] - os[i]) / ds[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
