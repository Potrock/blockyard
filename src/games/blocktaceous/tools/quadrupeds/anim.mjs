/**
 * Blocktaceous: how the four-legged animals move. Each clip is a pose for every moment of it (see
 * `Model.clip`); these are the pieces the animals' clips are made from, and the clips most of them
 * share (`standardClips`).
 */
import { TAU, clamp, smooth, lerp } from './lib.mjs';

/**
 * One cycle of the engine's walk covers this much ground at a model scale of 1 (it advances the
 * clip's phase by 4.2 radians a block: `src/platform/client/entities.ts`), so a gait drawn for this
 * stride plants its feet without sliding. `--stride=<k>` draws them for k times as much, for a
 * figure shown at `Models.gltf(url, { scale: k })` (see build.mjs).
 */
export const ENGINE_STRIDE = TAU / 4.2;
/** How many of the engine's strides each animal's gait is drawn for (`--stride=<k>`, or `natural`: each animal's own). */
export const STRIDE = process.argv.find((a) => a.startsWith('--stride='))?.slice(9) ?? '1';
/** The ground one cycle of an animal's gait covers: `natural` is its own (metres), used with `--stride=natural`. */
/** `--stride=natural` takes this much of an animal's own stride: what its legs reach without lifting off the ground. */
const NATURAL = Number(process.argv.find((a) => a.startsWith('--natural='))?.slice(10) ?? 0.65);
export const strideFor = (natural) => (STRIDE === 'natural' ? Math.max(ENGINE_STRIDE, Math.round(natural * NATURAL * 100) / 100) : ENGINE_STRIDE * Number(STRIDE));

export const sin = (u) => Math.sin(u * TAU);
export const cos = (u) => Math.cos(u * TAU);
/** A value through keys [[u, v], …], eased between them. */
export function keys(u, list) {
  if (u <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) if (u <= list[i][0]) return lerp(list[i - 1][1], list[i][1], smooth((u - list[i - 1][0]) / (list[i][0] - list[i - 1][0])));
  return list[list.length - 1][1];
}
/** Turn a chain of joints by `r` degrees in all, shared between them (weights optional), added to the pose. */
export function bend(pose, names, r, weights = null) {
  const total = weights ? weights.reduce((a, b) => a + b, 0) : names.length;
  names.forEach((n, i) => {
    const w = (weights ? weights[i] : 1) / total;
    const p = (pose[n] ??= {});
    const o = p.r ?? [0, 0, 0];
    p.r = [o[0] + r[0] * w, o[1] + r[1] * w, o[2] + r[2] * w];
  });
  return pose;
}
/** A wave running down a chain (a tail's sway): each joint `amp` degrees about `axis`, each `lag` of a cycle behind the last. */
export function wave(pose, names, u, amp, lag = 0.12, axis = 1, grow = 1) {
  names.forEach((n, i) => {
    const p = (pose[n] ??= {});
    const o = p.r ?? [0, 0, 0];
    o[axis] += amp * grow ** i * sin(u - i * lag);
    p.r = o;
  });
  return pose;
}
export function turn(pose, name, r, t = null) {
  const p = (pose[name] ??= {});
  const o = p.r ?? [0, 0, 0];
  p.r = [o[0] + r[0], o[1] + r[1], o[2] + r[2]];
  if (t) {
    const ot = p.t ?? [0, 0, 0];
    p.t = [ot[0] + t[0], ot[1] + t[1], ot[2] + t[2]];
  }
  return pose;
}

/**
 * Where a foot is through a stride: on the ground for `duty` of it, going back as the body goes
 * forward, then lifted and carried forward. `p` is its phase (0: it lands).
 */
export function step(p, { stride, duty, lift, toe = 25 }) {
  p = ((p % 1) + 1) % 1;
  const reach = stride * duty;
  if (p < duty) {
    const s = p / duty;
    // The heel peels up at the end of its stance.
    return { z: reach * (0.5 - s), y: 0, pitch: toe * 0.5 * smooth((s - 0.75) / 0.25) };
  }
  const s = (p - duty) / (1 - duty);
  const e = s * s * (3 - 2 * s);
  return { z: reach * (-0.5 + e), y: lift * Math.sin(Math.PI * Math.min(1, s * 1.1)) ** 0.8, pitch: toe * keys(s, [[0, 0.5], [0.3, 1], [0.8, -0.3], [1, 0]]) };
}

/** When each foot lands, as a fraction of the stride. */
export const GAITS = {
  /** A walk: left hind, left fore, right hind, right fore. */
  walk: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 },
  /** An amble: the same order, each fore foot close behind its hind (elephants at speed). */
  amble: { HL: 0, FL: 0.12, HR: 0.5, FR: 0.62 },
  /** A trot: diagonal pairs together. */
  trot: { HL: 0, FR: 0.04, HR: 0.5, FL: 0.54 },
  /** A gallop: the hind feet nearly together, then the fore feet. */
  gallop: { HL: 0, HR: 0.1, FL: 0.42, FR: 0.54 },
};

/**
 * A gait's pose at `u`: the feet (`gait`: when each lands), the body's rise and fall, pitch, roll
 * and sway, the tail's wave, and the head held steady against the body's movement.
 */
export function gaitPose(c, u, g) {
  const pose = { feet: {} };
  for (const [key, off] of Object.entries(g.gait)) pose.feet[key] = step(u - off, g);
  const beats = g.beats ?? 2;
  pose[c.body] = { t: [0, -g.sink + g.bob * cos(u * beats + (g.bobAt ?? 0.1)), 0], r: [(g.lean ?? 0) + (g.pitch ?? 0) * sin(u * (g.pitchBeats ?? beats) + 0.15), (g.yaw ?? 0) * sin(u + 0.25), (g.roll ?? 0) * sin(u)] };
  if (c.tail) wave(pose, c.tail, u + 0.5, g.tail ?? 5, 0.14, 1, 1.15);
  if (c.tail && g.tailLift) bend(pose, c.tail, [g.tailLift, 0, 0]);
  if (c.neck) bend(pose, [...c.neck, c.head], [-(g.lean ?? 0) + (g.nod ?? 1.5) * sin(u * beats + 0.3) + (g.neckPitch ?? 0), -(g.yaw ?? 0) * 0.8 * sin(u + 0.25), 0]);
  return pose;
}

/**
 * The clips most animals share. `c`: { body, neck: [joints], head, jaw, tail: [joints], stride (the
 * walk's, metres), walk, run (gait settings), breath (metres), attack: (u) => pose, eat: { neck:
 * degrees of pitch through the neck and head, body: [pitch, sink] }, sleep: { drop, … }, extra:
 * (name, u, pose) => void }.
 */
export function standardClips(model, c) {
  const extra = (name, u, pose) => {
    c.extra?.(name, u, pose);
    return pose;
  };
  const neckHead = [...(c.neck ?? []), c.head];

  // Idle: breathing (the body rising and falling over planted feet), the tail swaying, a slow look.
  model.clip('idle', c.idleTime ?? 4, (u) => {
    const pose = { [c.body]: { t: [0, -(c.breath ?? 0.02) * (0.5 - 0.5 * cos(u)), 0], r: [0.4 * sin(u), 0, 0] } };
    if (c.tail) wave(pose, c.tail, u, c.idleTail ?? 4, 0.1, 1, 1.25);
    bend(pose, neckHead, [1.5 * sin(u + 0.1), 2.5 * sin(u * 1 + 0.6), 0]);
    return extra('idle', u, pose);
  }, { keys: 16 });

  model.clip('walk', c.walkTime ?? 1.2, (u) => extra('walk', u, gaitPose(c, u, c.walk)), { keys: 24 });
  model.clip('run', c.runTime ?? 0.7, (u) => extra('run', u, gaitPose(c, u, c.run)), { keys: 24 });

  model.clip('attack', c.attackTime ?? 0.5, (u) => extra('attack', u, c.attack(u)), { keys: 12, loop: false });

  // Eating: the head down at the ground (or the browse), cropping and chewing.
  model.clip('eat', 2.4, (u) => {
    const e = c.eat;
    const crop = sin(u * 2);
    const pose = { [c.body]: { t: [0, -(e.sink ?? 0), e.forward ?? 0], r: [e.body ?? 0, 0, 0] } };
    bend(pose, neckHead, [e.neck + (e.nod ?? 5) * crop, (e.sway ?? 4) * sin(u), 0], e.weights);
    if (c.jaw) turn(pose, c.jaw, [(e.jaw ?? 10) * (0.5 + 0.5 * sin(u * 4))]);
    if (c.tail) wave(pose, c.tail, u, 3, 0.1, 1, 1.25);
    if (e.feet) pose.feet = e.feet;
    return extra('eat', u, pose);
  }, { keys: 16 });

  // Asleep: down on its belly, legs folded under, head on the ground, breathing slowly.
  model.clip('sleep', 5, (u) => {
    const s = c.sleep;
    const breathe = (c.breath ?? 0.02) * 1.5 * (0.5 - 0.5 * cos(u));
    const pose = { [c.body]: { t: [0, -s.drop + breathe, 0], r: [s.pitch ?? 0, 0, s.roll ?? 0] }, feet: s.feet };
    bend(pose, neckHead, [s.neck + 1.2 * sin(u), s.neckYaw ?? 0, 0], s.weights);
    if (c.tail) bend(pose, c.tail, [s.tail ?? 0, s.tailYaw ?? 40, 0]);
    if (c.jaw) turn(pose, c.jaw, [0.5]);
    return extra('sleep', u, pose);
  }, { keys: 8 });

  // A call: the head thrown up, the jaws wide, the body braced.
  model.clip('roar', c.roarTime ?? 1.8, (u) => {
    const r = c.roar;
    const a = keys(u, [[0, 0], [0.22, 1], [0.75, 1], [1, 0]]);
    const shake = a * sin(u * 9) * (r.shake ?? 2);
    const pose = { [c.body]: { t: [0, -(r.sink ?? 0) * a, (r.forward ?? 0) * a], r: [(r.body ?? -3) * a, 0, 0] } };
    bend(pose, neckHead, [r.neck * a + shake * 0.5, shake, 0], r.weights);
    if (c.jaw) turn(pose, c.jaw, [(r.jaw ?? 28) * keys(u, [[0, 0], [0.15, 0], [0.3, 1], [0.78, 1], [0.95, 0], [1, 0]])]);
    if (c.tail) bend(pose, c.tail, [(r.tail ?? -10) * a, 6 * a * sin(u * 3), 0]);
    return extra('roar', u, pose);
  }, { keys: 24, loop: false });
}

export { clamp, smooth, lerp };
