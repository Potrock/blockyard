/**
 * The bipeds' skeleton and their clips, worked out from each animal's own proportions.
 *
 * - Skeleton: hips > chest > neck (> neck2) > head > jaw; chest > armL, armR; hips > tail1 > tail2
 *   …; hips > thighL > shinL > metaL > footL (and R); hips > saddle (an empty node). Every bone
 *   rests with no rotation, so a clip's rotation is the turn from rest.
 * - Legs really step: each foot's ball is given a path (planted and carried back at the body's own
 *   speed while it stands on it, lifted and swung forward after), the metatarsus a lean (the heel
 *   lifting before the toe leaves), and the thigh and shin are solved to reach the ankle (the knee
 *   forward, as a bird's or a theropod's). A loop of the walk or the run covers `cycle` metres
 *   (one long running stride, or two walking ones); the engine plays them by ground covered, so
 *   that is the distance a loop at which the feet don't slide.
 * - Poses that depend on the animal's shape are solved on the skeleton: how far to bow to bring
 *   the mouth to the ground to eat, how far the neck and tail drop to lie on it asleep.
 *
 * Angles are radians about a bone's own joint: pitch about x (positive: nose down, tail up), yaw
 * about y, roll about z; a bone's turn is yaw, then pitch, then roll.
 */

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
const qaxis = (axis, a) => {
  const q = [0, 0, 0, Math.cos(a / 2)];
  q[axis] = Math.sin(a / 2);
  return q;
};
/** A bone's turn: yaw, then pitch, then roll. */
const qeuler = ([pitch = 0, yaw = 0, roll = 0]) => qmul(qmul(qaxis(1, yaw), qaxis(0, pitch)), qaxis(2, roll));
function qrot(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** A value through keys [[t, v], …], eased between them. */
const keys = (list) => (t) => {
  if (t <= list[0][0]) return list[0][1];
  for (let i = 1; i < list.length; i++) if (t <= list[i][0]) return list[i - 1][1] + (list[i][1] - list[i - 1][1]) * smoothstep(list[i - 1][0], list[i][0], t);
  return list[list.length - 1][1];
};

/** Find x in lo..hi where f(x) crosses `want` (f going one way); the nearer end if it never does. */
function solve(f, lo, hi, want) {
  const a = f(lo) - want, b = f(hi) - want;
  if (a * b > 0) return Math.abs(a) < Math.abs(b) ? lo : hi;
  for (let n = 0; n < 40; n++) {
    const mid = (lo + hi) / 2;
    if ((f(mid) - want) * a > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The skeleton from an animal's joints (metres, standing at rest): `joints` by bone name, in the
 * order parents come before children; `points`: `mouth` (the snout's tip), `chin` (under the head),
 * `tailTip`, `saddle`.
 */
export function skeleton(joints, points) {
  const names = Object.keys(joints);
  const tail = names.filter((n) => /^tail\d/.test(n));
  const neck = names.filter((n) => /^neck/.test(n));
  const parent = { hips: null, chest: 'hips', armL: 'chest', armR: 'chest', head: neck[neck.length - 1], jaw: 'head' };
  neck.forEach((n, i) => (parent[n] = i ? neck[i - 1] : 'chest'));
  tail.forEach((n, i) => (parent[n] = i ? tail[i - 1] : 'hips'));
  for (const s of ['L', 'R']) Object.assign(parent, { [`thigh${s}`]: 'hips', [`shin${s}`]: `thigh${s}`, [`meta${s}`]: `shin${s}`, [`foot${s}`]: `meta${s}` });
  const order = ['hips', 'chest', ...neck, 'head', 'jaw', 'armL', 'armR', ...tail, 'thighL', 'shinL', 'metaL', 'footL', 'thighR', 'shinR', 'metaR', 'footR'];
  for (const n of order) if (!joints[n]) throw new Error(`no joint ${n}`);
  return { joints, points, parent, order, tail, neck };
}

/**
 * Where a pose puts things: `fk(sk, pose)` gives `at(bone, point)`, the world place of a point
 * given at rest (metres). A pose is { pos: the hips' offset from rest, rot: { bone: [pitch, yaw, roll] } }.
 */
function fk(sk, pose) {
  const world = {};
  for (const b of sk.order) {
    const q = qeuler(pose.rot[b] ?? [0, 0, 0]);
    const p = sk.parent[b];
    if (!p) world[b] = { q, t: add(sk.joints[b], pose.pos ?? [0, 0, 0]) };
    else world[b] = { q: qmul(world[p].q, q), t: add(world[p].t, qrot(world[p].q, sub(sk.joints[b], sk.joints[p]))) };
  }
  return (bone, point) => add(world[bone].t, qrot(world[bone].q, sub(point, sk.joints[bone])));
}

/**
 * A leg solved in its own plane (y up, z forward): the hip joint at `H`, the ball of the foot at
 * `M`, the metatarsus turned `dm` from rest and the toes `df` (both in the world). Sets the four
 * bones' turns in `rot`, given the hips' own pitch.
 */
function solveLeg(sk, side, rot, hipsPos, hipsPitch, M, dm, df) {
  const J = (n) => sk.joints[`${n}${side}`];
  const yz = (v) => [v[1], v[2]];
  const v1 = yz(sub(J('shin'), J('thigh'))), v2 = yz(sub(J('meta'), J('shin'))), v3 = yz(sub(J('foot'), J('meta')));
  const L1 = Math.hypot(...v1), L2 = Math.hypot(...v2);
  const turn = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  const ang = (v) => Math.atan2(v[1], v[0]);
  // The hip joint, carried by the hips.
  const off = turn(yz(sub(J('thigh'), sk.joints.hips)), hipsPitch);
  const H = [sk.joints.hips[1] + hipsPos[1] + off[0], sk.joints.hips[2] + hipsPos[2] + off[1]];
  const m = turn(v3, dm);
  const A = [M[0] - m[0], M[1] - m[1]];
  let d = [A[0] - H[0], A[1] - H[1]];
  const dist = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-4, Math.hypot(...d)));
  const base = ang(d);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
  // The knee forward of the line from hip to ankle.
  const cands = [base + alpha, base - alpha].map((a) => [Math.cos(a) * L1, Math.sin(a) * L1]);
  const t = cands[0][1] > cands[1][1] ? cands[0] : cands[1];
  const K = [H[0] + t[0], H[1] + t[1]];
  const reach = [H[0] + Math.cos(base) * dist, H[1] + Math.sin(base) * dist];
  const s = [reach[0] - K[0], reach[1] - K[1]];
  const d1 = wrap(ang(t) - ang(v1)), d2 = wrap(ang(s) - ang(v2));
  rot[`thigh${side}`] = [wrap(d1 - hipsPitch), 0, 0];
  rot[`shin${side}`] = [wrap(d2 - d1), 0, 0];
  rot[`meta${side}`] = [wrap(dm - d2), 0, 0];
  rot[`foot${side}`] = [wrap(df - dm), 0, 0];
  return Math.hypot(...d) / (L1 + L2);
}

/** Both feet where they stand at rest (flat, under the hips), whatever the hips do. */
function plant(sk, pose) {
  let far = 0;
  for (const s of ['L', 'R']) {
    const M = sk.joints[`foot${s}`];
    far = Math.max(far, solveLeg(sk, s, pose.rot, pose.pos, pose.rot.hips?.[0] ?? 0, [M[1], M[2]], 0, 0));
  }
  return far;
}

/**
 * The clips. `g` is the animal's own way of moving (all optional): `cycle` (metres a walk or run
 * loop covers), `tailSway`, `neckBob`, `armSwing`, `armFlap` (a bird's wings in a roar), `jaw`
 * (how wide it gapes), `bow` (how it reaches the ground: weights of hips, neck and head), `lunge`,
 * `sleepSide` (which way it curls).
 */
export function clips(sk, g = {}) {
  const hipY = sk.joints.thighL[1];
  const length = sk.points.mouth[2] - sk.points.tailTip[2];
  // A loop of the walk or the run covers `cycle` metres: a long running stride, or two (or
  // `walkCycles`) walking ones.
  const cycle = g.cycle ?? hipY * 3;
  const tailSway = (g.tailSway ?? 7) * DEG;
  const neckBob = (g.neckBob ?? 3) * DEG;
  const armSwing = (g.armSwing ?? 8) * DEG;
  const jawMax = (g.jaw ?? 34) * DEG;
  const nt = sk.tail.length, nn = sk.neck.length;
  const out = [];

  /** A blank pose. */
  const blank = () => ({ pos: [0, 0, 0], rot: {} });
  const setNeck = (pose, pitch, yaw = 0, roll = 0) => sk.neck.forEach((n) => (pose.rot[n] = [pitch / nn, yaw / nn, roll / nn]));
  /** The tail as a wave: `fn(i, f)` gives [pitch, yaw] for segment i (f: 0 at the root to 1). */
  const setTail = (pose, fn) => sk.tail.forEach((n, i) => (pose.rot[n] = [...fn(i, nt > 1 ? i / (nt - 1) : 0), 0]));

  // -- Standing: breathing, the tail swaying, the head looking about a little.
  const idle = (t) => {
    const p = blank();
    const b = Math.sin(TAU * t), b2 = Math.sin(TAU * t - 0.9);
    p.pos = [0, -hipY * 0.006 * (1 - b), 0];
    p.rot.hips = [0.6 * DEG * b2, 0, 0];
    p.rot.chest = [-1.2 * DEG * b, 0, 0];
    setNeck(p, 1.5 * DEG * b2 + 1 * DEG, 3 * DEG * Math.sin(TAU * t + 1.2));
    p.rot.head = [-1.5 * DEG * b2, 3 * DEG * Math.sin(TAU * t + 0.6), 1.5 * DEG * Math.sin(TAU * t + 2)];
    p.rot.jaw = [1.2 * DEG * (1 + b), 0, 0];
    setTail(p, (i, f) => [-0.5 * DEG * b2, tailSway * (0.5 + 0.5 * f) * Math.sin(TAU * t - 0.3 - i * 0.55)]);
    p.rot.armL = [2 * DEG * b, 0, 0];
    p.rot.armR = [2 * DEG * b, 0, 0];
    plant(sk, p);
    return p;
  };

  // -- Walking and running.
  const gait = (o) => {
    const stride = cycle / o.cycles;
    const sweep = o.duty * stride;
    // How far the hips must come down for the legs to reach both ends of the step.
    let crouch = o.crouch * hipY;
    const frame = (loop, crouchNow) => {
      const ph = loop * o.cycles;
      const p = blank();
      const bob = o.bob * hipY * Math.cos(2 * TAU * (ph - o.duty / 2));
      p.pos = [0, -crouchNow + bob, 0];
      const pitch = o.lean * DEG + o.rock * DEG * Math.sin(2 * TAU * ph + 0.6);
      p.rot.hips = [pitch, 0, 0];
      let far = 0;
      for (const [s, off] of [['L', 0], ['R', 0.5]]) {
        const q = (((ph + off) % 1) + 1) % 1;
        const M0 = sk.joints[`foot${s}`];
        let z, y, dm, df;
        const lift = o.heel * DEG, reachBack = -10 * DEG;
        if (q < o.duty) {
          const u = q / o.duty;
          z = sweep * (0.5 - u);
          y = 0;
          dm = reachBack * (1 - smoothstep(0, 0.3, u)) + lift * smoothstep(0.5, 1, u);
          df = 0;
        } else {
          const u = (q - o.duty) / (1 - o.duty);
          z = sweep * (-0.5 + smoothstep(0, 1, u) * 0.6 + u * 0.4);
          y = o.step * hipY * Math.sin(Math.PI * u) ** 0.8;
          dm = lift + (reachBack - lift) * smoothstep(0, 1, u) + o.tuck * DEG * Math.sin(Math.PI * u);
          df = o.droop * DEG * Math.sin(Math.PI * Math.min(1, u * 1.15));
        }
        far = Math.max(far, solveLeg(sk, s, p.rot, p.pos, pitch, [M0[1] + y, M0[2] + o.ahead * hipY + z], dm, df));
      }
      const sw = Math.sin(TAU * ph), sw2 = Math.sin(2 * TAU * ph + 1);
      p.rot.chest = [-pitch * 0.4 + o.chest * DEG, -2.5 * DEG * sw * o.twist, 0];
      setNeck(p, o.neck * DEG + neckBob * sw2 * o.vigor, 2 * DEG * sw * o.twist);
      p.rot.head = [o.head * DEG - neckBob * sw2 * o.vigor, 1.5 * DEG * sw * o.twist, 0];
      p.rot.jaw = [o.jaw * DEG, 0, 0];
      setTail(p, (i, f) => [(-pitch * 0.5 + o.tail * DEG * (i ? 0.4 : 1) + 1.2 * DEG * sw2 * o.vigor) * (i < 2 ? 1 : 0.6), tailSway * o.vigor * (0.45 + 0.75 * f) * Math.sin(TAU * ph - 0.5 - i * 0.6)]);
      const arm = armSwing * o.vigor;
      p.rot.armL = [o.arms * DEG + arm * sw, 0, 0];
      p.rot.armR = [o.arms * DEG - arm * sw, 0, 0];
      return { p, far };
    };
    const N = o.frames * o.cycles;
    for (let tries = 0; tries < 40; tries++) {
      let far = 0;
      for (let n = 0; n < N; n++) far = Math.max(far, frame(n / N, crouch).far);
      if (far <= 0.985) break;
      crouch += hipY * 0.01;
    }
    return (t) => frame(t, crouch).p;
  };
  const walk = gait({ cycles: g.walkCycles ?? 2, duty: 0.62, crouch: 0.02, bob: 0.012, lean: 1, rock: 0.8, heel: 34, step: 0.11, tuck: 16, droop: 30, ahead: 0, chest: 0, twist: 1, neck: 0, head: 0, jaw: 0, tail: 0, vigor: 1, arms: 0, frames: 12, ...(g.walk ?? {}) });
  const run = gait({ cycles: g.runCycles ?? 1, duty: 0.32, crouch: 0.05, bob: 0.035, lean: 5, rock: 1.6, heel: 48, step: 0.24, tuck: 30, droop: 42, ahead: 0.03, chest: 0, twist: 1.6, neck: 6, head: -4, jaw: 5, tail: -3, vigor: 1.7, arms: 14, frames: 14, ...(g.run ?? {}) });

  // -- A bite: back a touch, then the head thrown forward with the jaws wide, and shut.
  const lunge = (g.lunge ?? 0.05) * length;
  const aZ = keys([[0, 0], [0.22, -0.3], [0.5, 1], [0.64, 0.9], [1, 0]]);
  const aOpen = keys([[0, 0], [0.2, 0.75], [0.42, 1], [0.56, 0], [1, 0]]);
  const aDip = keys([[0, 0], [0.22, -0.5], [0.52, 1], [0.66, 0.8], [1, 0]]);
  const attack = (t) => {
    const p = blank();
    const dip = aDip(t);
    p.pos = [0, -hipY * 0.03 * Math.max(0, dip), lunge * aZ(t)];
    p.rot.hips = [5 * DEG * dip, 0, 0];
    p.rot.chest = [4 * DEG * dip, 0, 0];
    setNeck(p, 12 * DEG * dip);
    p.rot.head = [-(dip > 0 ? 10 : 6) * DEG * dip, 0, 0];
    p.rot.jaw = [jawMax * aOpen(t), 0, 0];
    setTail(p, (i) => [-4 * DEG * dip * (i < 2 ? 1 : 0.3), 0]);
    p.rot.armL = p.rot.armR = [-14 * DEG * Math.max(0, dip), 0, 0];
    plant(sk, p);
    return p;
  };

  // -- Feeding: bowed until the mouth is at the ground, chewing and tugging.
  const bowW = { hips: 30, crouch: 0.16, chest: 12, neck: 55, head: 12, ...(g.bow ?? {}) };
  const bowed = (k, extra = 0) => {
    const p = blank();
    const hp = bowW.hips * DEG * k;
    p.pos = [0, -hipY * bowW.crouch * k, 0];
    p.rot.hips = [hp, 0, 0];
    p.rot.chest = [bowW.chest * DEG * k, 0, 0];
    setNeck(p, bowW.neck * DEG * k + extra);
    p.rot.head = [bowW.head * DEG * k, 0, 0];
    setTail(p, (i) => [-hp * (i === 0 ? 0.55 : i === 1 ? 0.3 : 0.1), 0]);
    return p;
  };
  const mouthY = (k) => fk(sk, bowed(k))('head', sk.points.mouth)[1];
  const bowK = solve(mouthY, 0, 1.25, hipY * 0.05);
  const eat = (t) => {
    const chew = Math.sin(2 * TAU * t);
    const p = bowed(bowK, -3 * DEG * (1 + chew));
    p.rot.head[1] = 5 * DEG * Math.sin(TAU * t);
    p.rot.head[2] = 3 * DEG * Math.sin(TAU * t + 1);
    p.rot.jaw = [jawMax * 0.42 * (0.5 - 0.5 * Math.cos(2 * TAU * t)), 0, 0];
    sk.tail.forEach((n, i) => (p.rot[n][1] = tailSway * 0.5 * Math.sin(TAU * t - i * 0.6)));
    p.rot.armL = p.rot.armR = [8 * DEG, 0, 0];
    plant(sk, p);
    return p;
  };

  // -- Asleep: down on its belly with its legs folded under it, neck and tail curled on the ground.
  const side = g.sleepSide ?? 1;
  const belly = sk.points.belly;
  const lying = (neckK, tailK, breath = 0) => {
    const p = blank();
    p.pos = [0, -(belly - hipY * 0.01) + hipY * 0.012 * breath, 0];
    p.rot.hips = [0, 0, 0];
    p.rot.chest = [(g.sleepChest ?? 6) * DEG * neckK - 0.8 * DEG * breath, 0, 0];
    setNeck(p, (g.sleepNeck ?? 60) * DEG * neckK, side * (g.sleepCurl ?? 40) * DEG);
    // The head level on the ground, turned along the body.
    p.rot.head = [-((g.sleepNeck ?? 60) + (g.sleepChest ?? 6)) * (g.sleepLevel ?? 1) * DEG * neckK, side * 12 * DEG, 0];
    p.rot.jaw = [0.8 * DEG * (1 + breath), 0, 0];
    setTail(p, (i, f) => [-(i === 0 ? 1 : 0.35) * tailK, side * (10 + 14 * f) * DEG]);
    p.rot.armL = p.rot.armR = [20 * DEG, 0, 0];
    // The feet tucked under: the metatarsus flat on the ground, the ankle behind the toes.
    for (const s of ['L', 'R']) {
      const M = sk.joints[`foot${s}`];
      const v3 = sub(M, sk.joints[`meta${s}`]);
      const flat = wrap(Math.PI / 2 - Math.atan2(v3[2], v3[1]));
      solveLeg(sk, s, p.rot, p.pos, 0, [M[1], M[2] + hipY * 0.22], flat, 0);
    }
    return p;
  };
  // (The lower of the chin and the snout's tip comes to rest on the ground; `sleepK` fixes how far
  // the neck drops instead, for a bird that sleeps with its head up on its breast.)
  const lowest = (k) => {
    const at = fk(sk, lying(k, 0));
    return Math.min(at('head', sk.points.chin)[1], at('head', sk.points.mouth)[1] - (sk.points.mouth[1] - sk.points.chin[1]) * 0.5);
  };
  const neckK = g.sleepK ?? solve(lowest, 0, 1.6, hipY * 0.012);
  const tailK = solve((k) => fk(sk, lying(neckK, k))(sk.tail[nt - 1], sk.points.tailTip)[1], 0, 60 * DEG, sk.points.tailRest ?? hipY * 0.04);
  const sleep = (t) => lying(neckK, tailK, Math.sin(TAU * t));

  // -- A roar: reared up, head high, jaws wide, shaking.
  const rUp = keys([[0, 0], [0.18, 1], [0.78, 1], [1, 0]]);
  const rOpen = keys([[0, 0], [0.1, 0.1], [0.24, 1], [0.74, 0.95], [0.9, 0], [1, 0]]);
  const flap = (g.armFlap ?? 0) * DEG;
  const roar = (t) => {
    const p = blank();
    const up = rUp(t), shake = Math.sin(TAU * 6 * t) * smoothstep(0.2, 0.3, t) * (1 - smoothstep(0.7, 0.8, t));
    p.pos = [0, hipY * 0.01 * up, 0];
    p.rot.hips = [-(g.rear ?? 7) * DEG * up, 0, 0];
    p.rot.chest = [-5 * DEG * up, 2 * DEG * shake, 0];
    setNeck(p, -(g.roarNeck ?? 11) * DEG * up, 4 * DEG * shake);
    p.rot.head = [-(g.roarHead ?? 3) * DEG * up, 3 * DEG * shake, 3 * DEG * shake];
    p.rot.jaw = [jawMax * 1.15 * rOpen(t), 0, 0];
    setTail(p, (i, f) => [(g.rear ?? 7) * DEG * up * (i === 0 ? 0.7 : 0.2), tailSway * 1.2 * f * shake]);
    p.rot.armL = [-18 * DEG * up - flap * Math.abs(shake), 0, -(10 * DEG + flap) * up];
    p.rot.armR = [-18 * DEG * up - flap * Math.abs(shake), 0, (10 * DEG + flap) * up];
    plant(sk, p);
    return p;
  };

  /** Sample a pose over `n` steps of `seconds` (a loop ends on its first frame) as channels. */
  const bake = (name, fn, seconds, n, { loop = true, all = false } = {}) => {
    const times = [], poses = [];
    for (let i = 0; i <= n; i++) {
      times.push((seconds * i) / n);
      poses.push(fn(loop && i === n ? 0 : i / n));
    }
    const channels = [];
    const moving = (vals, w) => {
      for (let i = w; i < vals.length; i++) if (Math.abs(vals[i] - vals[i % w]) > 2e-4) return true;
      return false;
    };
    for (const b of sk.order) {
      const q = poses.flatMap((p) => qeuler(p.rot[b] ?? [0, 0, 0]));
      // Each key the nearer way round from the last.
      for (let i = 4; i < q.length; i += 4) if (q[i] * q[i - 4] + q[i + 1] * q[i - 3] + q[i + 2] * q[i - 2] + q[i + 3] * q[i - 1] < 0) for (let c = 0; c < 4; c++) q[i + c] = -q[i + c];
      const rest = !moving(q, 4) && Math.abs(q[3]) > 0.99999;
      if (!rest || all) channels.push(moving(q, 4) ? { bone: b, path: 'rotation', times, values: q } : { bone: b, path: 'rotation', times: [0], values: q.slice(0, 4) });
    }
    const tr = poses.flatMap((p) => add(sk.joints.hips, p.pos));
    if (moving(tr, 3)) channels.push({ bone: 'hips', path: 'translation', times, values: tr });
    else if (all || Math.hypot(...poses[0].pos) > 1e-5) channels.push({ bone: 'hips', path: 'translation', times: [0], values: tr.slice(0, 3) });
    out.push({ name, channels });
  };
  bake('idle', idle, g.idleSeconds ?? 4, 12);
  bake('walk', walk, 1.1 * (g.walkCycles ?? 2), 12 * (g.walkCycles ?? 2));
  bake('run', run, 0.6 * (g.runCycles ?? 1), 14 * (g.runCycles ?? 1));
  bake('attack', attack, 0.5, 10, { loop: false });
  // Played over the idle or the walk, which they must cover whole: every bone has a channel.
  bake('eat', eat, 2.4, 16, { all: true });
  bake('sleep', sleep, 5, 8, { all: true });
  bake('roar', roar, g.roarSeconds ?? 1.8, 24, { loop: false, all: true });
  return { clips: out, cycle };
}
