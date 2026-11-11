/**
 * Pteranodon: a pterosaur, not a dinosaur. A small furred body between very long, narrow membrane
 * wings (each stretched from one enormous finger back to the leg), a long toothless beak and a
 * blade of a crest sweeping back from the skull. On the ground it walks on all fours: on its feet
 * and on the knuckles of its folded wings, the wing fingers folded up along its sides.
 * Slate-grey above, cream below, sand-coloured membranes darker at the trailing edge, an orange
 * crest tipped dark and a yellow beak.
 *
 * It's modelled flying (wings spread, legs trailing: the pose `fly` and `glide` play from) and
 * stands folded at rest (`rest`); every clip gives the whole pose.
 */
import { Model, ell, cap, chain, lerp, clamp } from './lib.mjs';
import { GAITS, strideFor, keys, sin, cos, step } from './anim.mjs';

export function make() {
  const m = new Model('pteranodon', 'Pteranodon', 18);
  m.colour('back', 0x5d6672);
  m.colour('belly', 0xece4cf);
  m.colour('wing', 0xc9b48c);
  m.colour('wingEdge', 0x8d7b5e);
  m.colour('bone', 0x6c7480);
  m.colour('crest', 0xe0752a);
  m.colour('crestTip', 0x3b3138);
  m.colour('beak', 0xe8c04a, { rough: 0.5 });
  m.colour('beakTip', 0x5a4632, { rough: 0.5 });
  m.colour('eye', 0x15100c, { rough: 0.2 });
  m.colour('foot', 0x8a7a66);

  const Y = 1.0;
  m.joint('body', 'root', [0, Y, 0]);
  m.joint('saddle', 'body', [0, Y + 0.2, 0.02], { empty: true });
  m.joint('neck', 'body', [0, Y + 0.03, 0.3]);
  const HZ = 0.1;
  m.joint('head', 'neck', [0, Y + 0.1, 0.66 + HZ]);
  m.joint('jaw', 'head', [0, Y + 0.06, 0.82 + HZ]);
  const SH = [0.17, Y + 0.05, 0.2], EL = [0.56, Y + 0.05, 0.12], WR = [1.14, Y + 0.05, 0.3], KN = [1.4, Y + 0.05, 0.34], TIP = [3.0, Y + 0.05, -0.25];
  m.jointLR('arm', 'body', SH);
  m.jointLR('fore', 'arm*', EL);
  m.jointLR('hand', 'fore*', WR);
  m.jointLR('finger', 'hand*', KN);
  // The membranes, each on a joint of its own at the bone it hangs from: folded, they're drawn in (scaled) to the bone.
  m.jointLR('webArm', 'arm*', [0.35, Y + 0.05, 0.16]);
  m.jointLR('webFore', 'fore*', [0.85, Y + 0.05, 0.24]);
  m.jointLR('webFinger', 'finger*', [2.2, Y + 0.05, 0.08]);
  const HIP = [0.1, Y - 0.04, -0.33], KNEE = [0.14, Y - 0.05, -0.6], ANK = [0.15, Y - 0.05, -0.93];
  m.jointLR('thigh', 'body', HIP);
  m.jointLR('shin', 'thigh*', KNEE);
  m.jointLR('foot', 'shin*', ANK);
  // Standing, each ankle is under the hips; the knees bend forward.
  for (const [s, x] of [['L', 1], ['R', -1]]) m.leg(`H${s}`, `thigh${s}`, `shin${s}`, `foot${s}`, { plant: [0.2 * x, 0.07, -0.2], bend: 1 });

  // The body: furred, dark above and pale below; a stub of a tail.
  const fur = (p) => (p[1] > Y + 0.02 ? 'back' : 'belly');
  m.paint('body', ell([0, Y, -0.04], [0.2, 0.19, 0.44]), fur);
  m.paint('body', cap([0, Y, -0.4], [0, Y, -0.6], 0.08, 0.04), fur);
  m.paint('neck', cap([0, Y + 0.02, 0.26], [0, Y + 0.1, 0.68 + HZ], 0.12, 0.09), fur);
  // The head: a small skull, a long straight beak with no teeth, the crest a thin blade.
  m.paint('head', ell([0, Y + 0.12, 0.78 + HZ], [0.1, 0.11, 0.18]), fur);
  m.paint('head', cap([0, Y + 0.13, 0.9 + HZ], [0, Y + 0.09, 1.5 + HZ], 0.075, 0.03, 0.7), (p) => (p[2] > 1.36 + HZ ? 'beakTip' : 'beak'));
  m.paint('head', chain([[0, Y + 0.17, 0.74 + HZ], [0, Y + 0.32, 0.4], [0, Y + 0.4, -0.08]], [0.12, 0.1, 0.07], 0.45), (p) => (p[2] < 0.22 ? 'crestTip' : 'crest'));
  for (const x of [1, -1]) m.paint('head', ell([0.1 * x, Y + 0.14, 0.84 + HZ], [0.04, 0.04, 0.04], 2), 'eye');
  m.paint('jaw', cap([0, Y + 0.06, 0.82 + HZ], [0, Y + 0.05, 1.46 + HZ], 0.05, 0.025, 0.8), (p) => (p[2] > 1.36 + HZ ? 'beakTip' : 'beak'));

  // The wings: arm bones along the leading edge, the membrane one voxel thick behind them, narrowing to the tip.
  const lead = (x) => (x < WR[0] ? lerp(SH[2], WR[2], (x - SH[0]) / (WR[0] - SH[0])) : x < KN[0] ? lerp(WR[2], KN[2], (x - WR[0]) / (KN[0] - WR[0])) : lerp(KN[2], TIP[2], (x - KN[0]) / (TIP[0] - KN[0])));
  const chord = (x) => 0.74 * (1 - clamp(x / TIP[0]) ** 1.6) + 0.02;
  const sheet = (x0, x1) => ({ lo: [x0, Y + 0.02, -0.7], hi: [x1, Y + 0.07, 0.45], inside: (p) => p[2] <= lead(p[0]) + 0.02 && p[2] >= lead(p[0]) - chord(p[0]) });
  const membrane = (p) => (p[2] < lead(p[0]) - chord(p[0]) + 0.1 ? 'wingEdge' : 'wing');
  m.paintLR('webArm', sheet(0.14, EL[0]), membrane);
  m.paintLR('webFore', sheet(EL[0], KN[0]), membrane);
  m.paintLR('webFinger', sheet(KN[0], TIP[0]), membrane);
  m.paintLR('arm', cap(SH, EL, 0.075, 0.06), 'back');
  m.paintLR('fore', cap(EL, WR, 0.06, 0.05), 'bone');
  m.paintLR('hand', cap(WR, KN, 0.05, 0.05), 'bone');
  m.paintLR('hand', cap(KN, [KN[0] + 0.04, KN[1], KN[2] + 0.14], 0.035, 0.02), 'foot');
  m.paintLR('finger', cap(KN, TIP, 0.05, 0.042), 'bone');
  // The legs, trailing behind as it flies.
  m.paintLR('thigh', cap(HIP, KNEE, 0.075, 0.055), fur);
  m.paintLR('shin', cap(KNEE, ANK, 0.05, 0.04), 'foot');
  m.paintLR('foot', cap(ANK, [0.15, Y - 0.05, -1.06], 0.045, 0.035, 1.5, 0.7), 'foot');

  // -------------------------------------------------------------------------------------------
  // Poses. A side's rotations mirror to the other: about y and z the other way.
  const both = (pose, name, r) => {
    pose[name + 'L'] = { r };
    pose[name + 'R'] = { r: [r[0], -r[1], -r[2]] };
  };
  /**
   * Standing on all fours: the body pitched up, the neck up and the head level, the arms down to
   * the ground, the wing fingers folded up and back. `o`: what a clip changes (degrees, metres).
   */
  const stand = (o = {}) => {
    const pitch = -42 + (o.pitch ?? 0);
    const pose = {
      body: { t: [0, -0.23 + (o.y ?? 0), o.z ?? 0], r: [pitch, o.yaw ?? 0, o.roll ?? 0] },
      neck: { r: [-30 + (o.neck ?? 0), o.neckYaw ?? 0, 0] },
      head: { r: [80 + (o.head ?? 0), o.headYaw ?? 0, 0] },
      jaw: { r: [o.jaw ?? 0, 0, 0] },
      feet: { HL: { pitch: 180, ...(o.HL ?? {}) }, HR: { pitch: 180, ...(o.HR ?? {}) } },
    };
    for (const [s, k] of [['L', 1], ['R', -1]]) {
      const swing = o[`arm${s}`] ?? 0, lift = o[`lift${s}`] ?? 0, open = o.open ?? 0;
      pose[`arm${s}`] = { r: [-pitch + 46 + swing - (o.pitch ?? 0) * 0.5, 0, k * (-82 + open * 50)] };
      pose[`fore${s}`] = { r: [0, k * (-78 - lift * 25 + open * 40), 0] };
      pose[`hand${s}`] = { r: [0, k * (32 + lift * 25 - open * 20), 0] };
      pose[`finger${s}`] = { r: [0, k * (132 - open * 100), 0] };
      const web = [1, 1, 0.3 + 0.7 * Math.min(1, open * 1.6)];
      for (const w of ['webArm', 'webFore', 'webFinger']) pose[w + s] = { s: web };
    }
    return pose;
  };
  m.rest = stand();
  m.rest.legs = true;

  m.clip('idle', 4, (u) => stand({ y: -0.012 * (0.5 - 0.5 * cos(u)), neck: 2 * sin(u), headYaw: 8 * sin(u + 0.3), head: 2 * sin(u * 2), open: 0.03 * (0.5 + 0.5 * sin(u * 2)) }), { keys: 16 });

  // On the ground: a four-beat shuffle, hind foot then the hand on the same side.
  const ground = (u, g) => {
    const o = { y: -g.sink + g.bob * cos(u * 2), yaw: g.yaw * sin(u + 0.25), roll: g.roll * sin(u), pitch: g.pitch ?? 0, neck: (g.neck ?? 0) + 2 * sin(u * 2), head: -(g.pitch ?? 0) - (g.neck ?? 0), headYaw: -g.yaw * sin(u + 0.25) };
    for (const s of ['L', 'R']) {
      const f = step(u - g.gait[`H${s}`], g);
      o[`H${s}`] = { z: f.z, y: f.y, pitch: 180 - f.pitch };
      const a = step(u - g.gait[`F${s}`], g);
      o[`arm${s}`] = (-a.z / 0.95) * 57.3 * 0.6;
      o[`lift${s}`] = a.y / g.lift;
    }
    return stand(o);
  };
  const stride = strideFor(1.6);
  m.clip('walk', 1, (u) => ground(u, { gait: GAITS.walk, stride, duty: 0.66, lift: 0.1, sink: 0.08, bob: 0.012, yaw: 4, roll: 2.5 }), { keys: 24 });
  m.clip('run', 0.6, (u) => ground(u, { gait: GAITS.trot, stride, duty: 0.5, lift: 0.16, sink: 0.08, bob: 0.03, yaw: 5, roll: 3, pitch: 6, neck: 6 }), { keys: 24 });

  // A peck: the head drawn back, then stabbed forward and down.
  m.clip('attack', 0.5, (u) => {
    const a = keys(u, [[0, 0], [0.25, -1], [0.5, 1], [0.75, 0.3], [1, 0]]);
    return stand({ neck: 30 * a, head: 14 * a, pitch: 8 * Math.max(0, a), z: 0.1 * Math.max(0, a), jaw: 14 * keys(u, [[0, 0], [0.3, 1], [0.5, 0], [1, 0]]), open: 0.12 * Math.abs(a) });
  }, { keys: 12, loop: false });

  m.clip('eat', 2.4, (u) => stand({ pitch: 24, y: -0.06, neck: 44 + 5 * sin(u * 2), head: 6 + 4 * sin(u * 2), jaw: 8 * (0.5 + 0.5 * sin(u * 4)), headYaw: 4 * sin(u) }), { keys: 16 });

  // Asleep: settled on its belly, legs folded, the wings tight, the head laid back along its shoulders.
  m.clip('sleep', 5, (u) => {
    const pose = stand({ pitch: 34, y: -0.38 + 0.012 * (0.5 - 0.5 * cos(u)), neck: -20, head: 12, HL: { z: 0.12 }, HR: { z: 0.12 } });
    for (const [s, k] of [['L', 1], ['R', -1]]) {
      pose[`arm${s}`] = { r: [60, 0, k * -62] };
      pose[`fore${s}`] = { r: [0, k * -110, 0] };
      pose[`hand${s}`] = { r: [0, k * 20, 0] };
      pose[`finger${s}`] = { r: [0, k * 150, 0] };
    }
    return pose;
  }, { keys: 8 });

  // A call: reared up, the wings half opened, the beak wide.
  m.clip('roar', 1.8, (u) => {
    const a = keys(u, [[0, 0], [0.22, 1], [0.75, 1], [1, 0]]);
    return stand({ pitch: -10 * a, neck: -12 * a, head: -28 * a + 3 * a * sin(u * 8), jaw: 22 * keys(u, [[0, 0], [0.15, 0], [0.3, 1], [0.78, 1], [0.95, 0], [1, 0]]), open: 0.45 * a + 0.04 * a * sin(u * 6) });
  }, { keys: 24, loop: false });

  // Flying: as modelled, level, the legs trailing; the wings beat from the shoulder, the outer wing a little behind.
  const flight = (u, beat, base) => {
    const down = sin(u), late = sin(u - 0.12), later = sin(u - 0.22);
    const pose = { legs: false, body: { t: [0, -0.07 * beat * sin(u + 0.25), 0], r: [-4 + 2 * beat * sin(u + 0.3), 0, 0] }, neck: { r: [4 - 3 * beat * sin(u + 0.3), 0, 0] }, head: { r: [6, 0, 0] } };
    both(pose, 'arm', [0, 0, base + 30 * beat * down]);
    both(pose, 'fore', [0, 0, 14 * beat * late - base * 0.4]);
    both(pose, 'finger', [0, -6, 20 * beat * later - base * 0.5]);
    both(pose, 'thigh', [-4, 0, 6]);
    both(pose, 'foot', [3 * sin(u * 2), 0, 0]);
    return pose;
  };
  m.clip('fly', 0.9, (u) => flight(u, 1, 6), { keys: 16 });
  m.clip('glide', 4, (u) => {
    const pose = flight(u, 0.06, 9);
    pose.body = { t: [0, 0.02 * sin(u), 0], r: [-2, 0, 2.5 * sin(u + 0.2)] };
    return pose;
  }, { keys: 12 });
  return m;
}
