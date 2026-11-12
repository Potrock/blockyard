/**
 * A two-legged animal from its design (`species.mjs`): the body painted along its spine from the
 * tail's tip to the end of the neck and cut into a bone's part at each marked station, the legs a
 * tube a bone, the head, jaws and arms as each design paints them. Gives the voxels, the joints
 * and the points the clips are solved from.
 */
import { Sculpt, smooth, cellOf } from './sculpt.mjs';

/**
 * A design:
 * - `vpm`: voxels a metre. `colours`: { name: rgb }.
 * - `spine`: stations [z, y, half-width, half-depth, mark?] from the tail's tip forward to where
 *   the head joins; marks name the bone that begins there: `tail4` … `tail1` (the tail's root),
 *   `chest`, `neck` (`neck2`), `head` (the last). `skin(info)` colours it (see `Sculpt.tube`).
 * - `leg`: { x, hip, knee, ankle, ball: [y, z]; thigh, shin, meta: [[across, deep] at the top, at
 *   the bottom]; toes: { length, radius, spread, claw }; colour(bone, info) }.
 * - `hips`: [y, z] of the hips' joint (default: between the legs' hip joints).
 * - `arms(sc, part)`, `head(sc)`, `extras(sc)`: paint the left arm, the head and jaw, and
 *   whatever else (a sail, feathers) into the parts by name. `joints`: { armL, jaw: [x, y, z] }.
 * - `points`: { mouth, chin, saddle }.
 */
export function buildBiped(d) {
  const sc = new Sculpt(d.vpm);
  for (const [name, rgb] of Object.entries(d.colours)) sc.colour(name, rgb, d.paint?.[name]);
  const V = 1 / d.vpm;
  const ground = (p) => p[1] >= 0;

  // The spine.
  const stations = d.spine.map(([z, y, rx, ry]) => ({ p: [0, y, z], r: [rx, ry] }));
  const N = 4;
  const sm = smooth(stations, N);
  const sAt = [0];
  for (let i = 1; i < sm.length; i++) sAt.push(sAt[i - 1] + Math.hypot(sm[i].p[1] - sm[i - 1].p[1], sm[i].p[2] - sm[i - 1].p[2]));
  const total = sAt[sAt.length - 1];
  const last = stations[stations.length - 1];
  sc.tube('spine', sm, (info) => d.skin({ ...info, f: info.s / total, total }), { power: d.power ?? 2.4, along: true, capA: stations[0].r[1], capB: d.neckCap ?? last.r[1] * 0.8, capShrink: [0, V], clip: ground });
  const marks = d.spine.map((st, i) => ({ name: st[4], s: sAt[i * N], p: stations[i].p, r: stations[i].r })).filter((m) => m.name);
  const tails = marks.filter((m) => m.name.startsWith('tail'));
  const fronts = marks.filter((m) => !m.name.startsWith('tail') && m.name !== 'head');
  // From the tip: the last tail bone up to its own joint, …, then the hips up to the chest's, and so on.
  const cuts = [...tails.map((m) => ({ part: m.name, to: m.s })), { part: 'hips', to: fronts[0].s }, ...fronts.map((m, i) => ({ part: m.name, to: fronts[i + 1]?.s }))];
  const cutMarks = [...tails, ...fronts];
  sc.splitChain('spine', cuts, (n) => Math.max(2 * V, Math.min(cutMarks[n].r[0], cutMarks[n].r[1]) * (d.reach ?? 0.55)));

  // The legs: the left, then its mirror.
  const L = d.leg;
  const at = (q) => [L.x, q[0], q[1]];
  const bones = [
    ['thigh', L.hip, L.knee, L.thigh],
    ['shin', L.knee, L.ankle, L.shin],
    ['meta', L.ankle, L.ball, L.meta],
  ];
  for (const [name, a, b, r] of bones) {
    sc.tube(`${name}L`, [{ p: at(a), r: r[0] }, { p: at(b), r: r[1] }], (info) => L.colour(name, { ...info, len: Math.hypot(b[0] - a[0], b[1] - a[1]) }), {
      power: L.power ?? 2.2,
      capA: name === 'thigh' ? r[0][1] * 0.7 : r[0][1],
      capB: r[1][1],
      capShrink: name === 'thigh' ? [0, V] : [V, name === 'meta' ? 0 : V],
      clip: ground,
    });
  }
  const T = L.toes;
  const ball = at(L.ball);
  sc.ellipsoid('footL', [ball[0], Math.max(T.radius, ball[1] * 0.8), ball[2]], [T.pad ?? T.radius * 1.5, Math.max(T.radius, ball[1]) , T.pad ?? T.radius * 1.5], (p, i, j, k) => L.colour('foot', { p, i, j, k, t: 0 }), { clip: ground });
  for (const [turn, len] of T.fan ?? [[-T.spread, 0.85], [0, 1], [T.spread, 0.85]]) {
    const a = (turn * Math.PI) / 180;
    const tip = [ball[0] + Math.sin(a) * T.length * len, T.radius * 0.6, ball[2] + Math.cos(a) * T.length * len];
    sc.capsule('footL', [ball[0], T.radius, ball[2]], tip, T.radius, T.radius * 0.62, (p, t, i, j, k) => (t > 1 - (T.claw ?? 0.2) ? d.claw ?? 'claw' : L.colour('foot', { p, i, j, k, t })), { clip: ground });
  }
  d.foot?.(sc, 'footL', ball);
  d.arms?.(sc, 'armL');
  d.head(sc);
  d.extras?.(sc);
  for (const n of ['thigh', 'shin', 'meta', 'foot']) sc.mirrorPart(`${n}L`, `${n}R`);
  if (sc.vox.parts.has('armL')) sc.mirrorPart('armL', 'armR');
  else sc.vox.part('armL'), sc.vox.part('armR');

  // The joints, parents before children.
  const mark = (n) => marks.find((m) => m.name === n).p;
  const hips = d.hips ? [0, d.hips[0], d.hips[1]] : [0, L.hip[0], L.hip[1]];
  const joints = { hips, chest: mark('chest') };
  for (const m of fronts) if (m.name.startsWith('neck')) joints[m.name] = m.p;
  joints.head = mark('head');
  joints.jaw = d.joints.jaw;
  joints.armL = d.joints.armL;
  joints.armR = [-d.joints.armL[0], d.joints.armL[1], d.joints.armL[2]];
  for (const m of [...tails].reverse()) joints[m.name] = m.p;
  for (const [s, x] of [['L', L.x], ['R', -L.x]]) {
    joints[`thigh${s}`] = [x, ...L.hip];
    joints[`shin${s}`] = [x, ...L.knee];
    joints[`meta${s}`] = [x, ...L.ankle];
    joints[`foot${s}`] = [x, ...L.ball];
  }
  // The belly's underside (how far down it lies), under the hips and the chest.
  let belly = Infinity;
  for (const part of ['hips', 'chest']) for (const key of sc.vox.parts.get(part).keys()) belly = Math.min(belly, cellOf(key)[1]);
  const points = { tailTip: stations[0].p, tailRest: stations[0].r[1] + V, belly: belly * V, ...d.points };
  return { sc, joints, points, total };
}
