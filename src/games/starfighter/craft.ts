import { math, type GameContext, type Prop, type PropModel, type Vec3 } from '@platform';
import { SHIP_SCALE, type ShipDesign } from './ships';

const UP = new math.Vector3(0, 1, 0);
const _q = new math.Quaternion();
const _qi = new math.Quaternion();
const _e = new math.Euler();
const _f = new math.Vector3();
const _a = new math.Vector3();
const _b = new math.Vector3();
/** Sea level (the world's water surface). */
const SEA = 62;

/** Are any of `a`'s hull points (plus its centre) inside `b`'s box (shrunk a little)? */
function pointsInside(a: Craft, b: Craft): boolean {
  const qa = a.orientation(new math.Quaternion());
  const inv = _qi.copy(b.orientation(_q)).invert();
  const box = b.type.box;
  const shrink = 0.85;
  for (const p of [...a.type.probes, new math.Vector3()]) {
    const local = _a.copy(p).applyQuaternion(qa).add(a.pos).sub(b.pos).applyQuaternion(inv);
    if (
      local.x > box.min.x * shrink && local.x < box.max.x * shrink &&
      local.y > box.min.y * shrink && local.y < box.max.y * shrink &&
      local.z > box.min.z * shrink && local.z < box.max.z * shrink
    )
      return true;
  }
  return false;
}

/** A built ship type: the meshed model plus its design data in world units. */
export interface ShipType {
  model: PropModel;
  design: ShipDesign;
  /** Laser muzzles and engine points in ship space (world units). */
  guns: math.Vector3[];
  engines: math.Vector3[];
  radius: number;
  /** The hull's box in ship space (world units), from the blocks actually built. */
  box: math.Box3;
  /** Points on the hull checked against the world: nose, tail, wingtips, top, bottom. */
  probes: math.Vector3[];
}

export function shipType(game: GameContext, design: ShipDesign): ShipType {
  const s = SHIP_SCALE;
  const box = new math.Box3();
  design.blueprint.forEach((x, y, z) => {
    box.expandByPoint(new math.Vector3(x * s, y * s, z * s));
    box.expandByPoint(new math.Vector3((x + 1) * s, (y + 1) * s, (z + 1) * s));
  });
  const c = box.getCenter(new math.Vector3());
  const { min, max } = box;
  // Slightly inside the extremes, so a probe sits on the hull rather than beside it.
  const k = 0.9;
  const probes = [
    new math.Vector3(c.x, c.y, min.z * k),
    new math.Vector3(c.x, c.y, max.z * k),
    new math.Vector3(min.x * k, c.y, c.z),
    new math.Vector3(max.x * k, c.y, c.z),
    new math.Vector3(c.x, max.y * k, c.z),
    new math.Vector3(c.x, min.y * k, c.z),
  ];
  return {
    model: game.props.model(design.blueprint, { scale: s }),
    design,
    guns: design.guns.map((g) => new math.Vector3(g.x * s, g.y * s, g.z * s)),
    engines: design.engines.map((g) => new math.Vector3(g.x * s, g.y * s, g.z * s)),
    radius: design.radius * s,
    box,
    probes,
  };
}

/** A contact from `Craft.move`: where, which way the surface faces, and how head-on (0..1). */
export interface Impact {
  at: math.Vector3;
  normal: math.Vector3;
  force: number;
  water: boolean;
}

/**
 * Arcade flight shared by the player and the AI: heading turns about world up, pitch about the
 * ship's right axis (clamped short of vertical), and bank is cosmetic (into turns, plus barrel
 * rolls). The ship always flies where its nose points.
 */
export class Craft {
  readonly pos = new math.Vector3();
  yaw = 0;
  pitch = 0;
  bank = 0;
  /** Extra roll from a barrel roll, radians. */
  spin = 0;
  speed = 40;
  hp: number;
  readonly prop: Prop;
  private flames: Prop[] = [];
  /** Seconds of "just hit" (for AI evasion and HUD). */
  hurt = 0;
  alive = true;
  /** Knock-back velocity from collisions (decays). */
  readonly knock = new math.Vector3();

  constructor(
    private game: GameContext,
    readonly type: ShipType,
    hp: number,
    flame: string,
  ) {
    this.hp = hp;
    this.prop = game.props.spawn(type.model);
    for (let i = 0; i < type.engines.length; i++) this.flames.push(game.props.bolt({ color: flame, length: 1, width: 0.5, intensity: 3 }));
  }

  get radius(): number {
    return this.type.radius;
  }

  /** World orientation (cosmetic bank included). */
  orientation(out: math.Quaternion): math.Quaternion {
    _e.set(this.pitch, this.yaw, this.bank + this.spin, 'YXZ');
    return out.setFromEuler(_e);
  }

  /** Where the nose points (no bank). */
  forward(out: math.Vector3): math.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** A point in ship space (world units) to world space. */
  toWorld(local: math.Vector3, out: math.Vector3): math.Vector3 {
    return out.copy(local).applyQuaternion(this.orientation(_q)).add(this.pos);
  }

  /** Turn toward the given heading / pitch rates (rad/s) and fly (no collision; see `move`). */
  fly(dt: number, yawRate: number, pitchRate: number, targetBank: number) {
    this.steer(dt, yawRate, pitchRate, targetBank);
    const f = this.forward(new math.Vector3());
    this.pos.addScaledVector(f, this.speed * dt);
  }

  steer(dt: number, yawRate: number, pitchRate: number, targetBank: number) {
    this.yaw += yawRate * dt;
    this.pitch = math.MathUtils.clamp(this.pitch + pitchRate * dt, -1.35, 1.35);
    this.bank += (targetBank - this.bank) * Math.min(1, dt * 5);
  }

  /**
   * Fly one step and collide with the world: hull points sweep from where they were to where
   * they are going. On contact the ship stops at the surface, bounces and slides off it (the
   * heading is reflected, gently for glancing blows), loses speed, and gets knocked back.
   */
  move(dt: number): Impact | null {
    const q = this.orientation(_q);
    const step = this.forward(_f).multiplyScalar(this.speed * dt).addScaledVector(this.knock, dt);
    this.knock.multiplyScalar(Math.exp(-dt * 4));
    const w = this.game.world;
    let hit: Impact | null = null;
    let best = 1;
    for (const p of this.type.probes) {
      const from = _a.copy(p).applyQuaternion(q).add(this.pos);
      const len = step.length();
      if (len > 1e-6) {
        const r = w.raycast(from, step, len + 0.3);
        if (r) {
          // Fraction of the step before touching (voxel entry along the ray).
          const d = Math.hypot(r.x + 0.5 - from.x, r.y + 0.5 - from.y, r.z + 0.5 - from.z) - 0.7;
          const t = math.MathUtils.clamp(d / len, 0, 1);
          if (t < best || !hit) {
            best = t;
            hit = { at: from.clone().addScaledVector(step, t), normal: new math.Vector3(r.normal.x, r.normal.y, r.normal.z), force: 0, water: false };
          }
        }
      }
      // The sea: skimming below its surface counts as hitting it.
      const to = _b.copy(from).add(step);
      if (!hit && to.y < SEA + 0.4 && w.blockName(w.getBlock(to.x, to.y, to.z)) === 'water') {
        best = 0;
        hit = { at: to.clone(), normal: new math.Vector3(0, 1, 0), force: 0, water: true };
      }
    }
    if (!hit) {
      this.pos.add(step);
      return null;
    }
    const n = hit.normal;
    if (n.lengthSq() < 0.5) n.set(0, 1, 0); // started inside a block: push up
    // Move up to the surface, then out of it a little.
    this.pos.addScaledVector(step, best).addScaledVector(n, 0.25);
    const f = this.forward(_f);
    const into = -f.dot(n); // 1 = head-on
    hit.force = Math.max(0, into);
    if (into > 0) {
      const slide = f.clone().addScaledVector(n, into);
      if (slide.length() > 0.45 || Math.abs(n.y) > 0.7) {
        // Glancing, or the ground / sea: slide along the surface, angled a little away from it.
        if (slide.length() < 1e-3) slide.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        slide.normalize().addScaledVector(n, 0.25 + 0.25 * into).normalize();
        // Turn with the surface, but never spin round (a near-vertical slide keeps the heading).
        if (Math.hypot(slide.x, slide.z) > 0.3) {
          const yaw = Math.atan2(-slide.x, -slide.z);
          if (Math.abs(angleDiff(this.yaw, yaw)) < 1.75) this.yaw = yaw;
        }
        this.pitch = math.MathUtils.clamp(Math.asin(math.MathUtils.clamp(slide.y, -1, 1)), -1.35, 1.35);
      } else {
        // Nose into a wall: keep the heading and pull up; the knock-back carries you off it.
        this.pitch = Math.max(this.pitch, 0.7);
      }
      this.speed *= 1 - 0.5 * into;
    }
    this.knock.addScaledVector(n, 5 + 14 * hit.force);
    return hit;
  }

  /** Oriented-box overlap with another craft (either's hull points inside the other's box). */
  touches(o: Craft): boolean {
    const r = this.radius + o.radius;
    if (this.pos.distanceToSquared(o.pos) > r * r) return false;
    return pointsInside(this, o) || pointsInside(o, this);
  }

  /** Push the model and engine flames to the current state. */
  sync(throttle: number) {
    this.prop.position.copy(this.pos);
    this.orientation(this.prop.quaternion);
    const q = this.prop.quaternion;
    this.type.engines.forEach((e, i) => {
      const fl = this.flames[i];
      fl.position.copy(e).applyQuaternion(q).add(this.pos);
      // Flames point backward (+z in ship space).
      fl.quaternion.copy(q).multiply(_q.setFromAxisAngle(UP, Math.PI));
      fl.scale = 0.5 + throttle * 1.2 + Math.random() * 0.25;
    });
  }

  remove() {
    this.prop.remove();
    for (const f of this.flames) f.remove();
    this.alive = false;
  }
}

/** Angle between a craft's nose and a point (radians). */
export function aimError(c: Craft, at: Vec3): number {
  const f = c.forward(new math.Vector3());
  const d = new math.Vector3(at.x - c.pos.x, at.y - c.pos.y, at.z - c.pos.z).normalize();
  return Math.acos(math.MathUtils.clamp(f.dot(d), -1, 1));
}

/** Heading and pitch that point from `from` toward `to`. */
export function headingTo(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Shortest signed angle a -> b. */
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
