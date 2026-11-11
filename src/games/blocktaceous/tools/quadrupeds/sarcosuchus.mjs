/**
 * Sarcosuchus: a crocodile relative twice the length of any alive now. A long, narrow snout ending
 * in a bulb of bone, eyes and nostrils set high, a broad flat body armoured with rows of scutes, a
 * deep muscular tail flattened side to side with a crest of scutes, short legs held out from the
 * body. Dark olive above with darker bands across the back and tail, yellow-cream flanks and belly.
 */
import { Model, ell, cap, union } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend, turn, wave, sin } from './anim.mjs';
import { legs, limbs } from './parts.mjs';

export function make() {
  const m = new Model('sarcosuchus', 'Sarcosuchus', 9);
  m.colour('hide', 0x5c6038);
  m.colour('band', 0x383b22);
  m.colour('flank', 0x8e8a55);
  m.colour('belly', 0xddd3a0);
  m.colour('scute', 0x2f311d);
  m.colour('tooth', 0xf2ecd8, { rough: 0.4 });
  m.colour('mouth', 0xb86a5a);
  m.colour('nail', 0x2c2a20, { rough: 0.6 });
  m.colour('eye', 0xd8a22c, { rough: 0.2 });
  m.colour('pupil', 0x15100c, { rough: 0.2 });

  // The line of the back: flat over the body, falling along the tail.
  const backY = (z) => (z > -1.9 ? 1.18 : 1.18 + 0.19 * (z + 1.9));
  const coat = (p) => {
    const top = backY(p[2]);
    if (p[1] < top - 0.72) return 'belly';
    if (p[1] < top - 0.45) return 'flank';
    return Math.sin(p[2] * 3.6) > 0.35 ? 'band' : 'hide';
  };
  m.joint('body', 'root', [0, 0.78, 0]);
  m.joint('saddle', 'body', [0, 1.3, 0.2], { empty: true });
  m.paint('body', ell([0, 0.76, 0], [0.88, 0.48, 2.05], 3), coat);
  m.joint('neck', 'body', [0, 0.76, 1.85]);
  m.paint('neck', cap([0, 0.76, 1.8], [0, 0.74, 2.5], 0.52, 0.44, 1.3, 0.85), coat);
  m.joint('head', 'neck', [0, 0.74, 2.5]);
  m.joint('jaw', 'head', [0, 0.62, 2.6]);
  // The skull: broad behind the eyes, then the long snout and its bulb. The teeth show along the lip.
  const upper = (p) => (p[1] < 0.69 && p[2] > 3.1 && Math.floor(p[2] * 9) % 2 === 0 && Math.abs(p[0]) > 0.12 ? 'tooth' : p[1] > 0.84 && Math.sin(p[2] * 3.6) > 0.35 ? 'band' : 'hide');
  m.paint('head', union(ell([0, 0.8, 2.85], [0.52, 0.24, 0.5], 3), cap([0, 0.78, 3.2], [0, 0.76, 4.8], 0.27, 0.2, 1.05, 0.55), ell([0, 0.77, 4.92], [0.3, 0.15, 0.27])), upper);
  m.erase('head', { lo: [-1, 0, 2.6], hi: [1, 0.66, 5.3], inside: () => true });
  for (const x of [1, -1]) {
    m.paint('head', ell([0.3 * x, 1.0, 2.95], [0.13, 0.1, 0.16], 2.4), 'hide');
    m.paint('head', ell([0.4 * x, 1.0, 3.0], [0.06, 0.06, 0.1], 2), 'eye');
    m.paint('head', ell([0.43 * x, 1.0, 3.0], [0.04, 0.06, 0.04], 2), 'pupil');
  }
  m.paint('jaw', union(cap([0, 0.56, 2.6], [0, 0.6, 4.75], 0.26, 0.17, 1.05, 0.5), ell([0, 0.6, 4.9], [0.26, 0.09, 0.24])), (p) => (p[1] > 0.61 ? (Math.floor(p[2] * 9) % 2 === 1 && Math.abs(p[0]) > 0.1 && p[2] > 3.1 ? 'tooth' : 'mouth') : 'belly'));
  // Scutes: two raised rows down the back, running into one crest on the tail.
  for (let i = 0; i < 16; i++) {
    const z = 1.75 - i * 0.24;
    for (const x of [0.28, -0.28]) m.paint('body', ell([x, 1.22, z], [0.1, 0.1, 0.09], 2), 'scute');
  }
  const tailPts = [[0, 0.76, -1.9], [0, 0.66, -2.7], [0, 0.56, -3.45], [0, 0.46, -4.15], [0, 0.38, -4.8]];
  limbs(m, ['tail1', 'tail2', 'tail3', 'tail4'], 'body', tailPts, [0.56, 0.44, 0.34, 0.26, 0.12], coat, 0.75, 1);
  ['tail1', 'tail2', 'tail3', 'tail4'].forEach((name, i) => {
    for (let k = 0; k < 3; k++) {
      const z = tailPts[i][2] - 0.12 - k * 0.25;
      const y = tailPts[i][1] + (tailPts[i + 1][1] - tailPts[i][1]) * ((tailPts[i][2] - z) / (tailPts[i][2] - tailPts[i + 1][2])) + [0.56, 0.44, 0.34, 0.26, 0.12][i] - 0.04 * k;
      m.paint(name, ell([0, y, z], [0.07, 0.14, 0.09], 2), 'scute');
    }
  });

  legs(m, {
    F: { hip: [0.72, 0.68, 1.25], knee: [0.92, 0.42, 1.05], ankle: [0.92, 0.14, 1.28], r: [0.26, 0.19, 0.15], foot: [0.22, 0.16, 0.26, 0.1] },
    H: { hip: [0.72, 0.7, -1.35], knee: [0.95, 0.46, -1.0], ankle: [0.95, 0.15, -1.4], r: [0.32, 0.22, 0.17], foot: [0.24, 0.17, 0.3, 0.1] },
  }, { F: 'body', H: 'body' }, { upper: 'hide', lower: 'flank', foot: 'hide', nail: 'nail' });

  const stride = strideFor(2.2);
  const tail = ['tail1', 'tail2', 'tail3', 'tail4'];
  standardClips(m, {
    body: 'body',
    neck: ['neck'],
    head: 'head',
    jaw: 'jaw',
    tail,
    breath: 0.015,
    idleTail: 4,
    idleTime: 5,
    walkTime: 1.3,
    runTime: 0.8,
    walk: { gait: GAITS.walk, stride, duty: 0.7, lift: 0.1, sink: 0.08, bob: 0.01, roll: 2, yaw: 5, pitch: 0.3, tail: 10 },
    run: { gait: GAITS.trot, stride, duty: 0.55, lift: 0.14, sink: 0.07, bob: 0.025, roll: 2, yaw: 7, pitch: 0.6, tail: 14 },
    // A lunge: the head thrown up with the jaws open, then snapped shut forward.
    attack: (u) => {
      const a = keys(u, [[0, 0], [0.3, 1], [0.55, 0], [1, 0]]);
      const lunge = keys(u, [[0, 0], [0.25, -0.1], [0.55, 0.6], [1, 0]]);
      const pose = { body: { t: [0, -0.06 * lunge, lunge], r: [-3 * a, 0, 0] }, jaw: { r: [34 * a, 0, 0] } };
      bend(pose, tail, [0, 20 * sin(u), 0]);
      return bend(pose, ['neck', 'head'], [-22 * a, 0, 0]);
    },
    eat: { neck: 14, body: 1, sink: 0.05, nod: 3, jaw: 14, sway: 10, weights: [1, 1] },
    sleep: { drop: 0.3, neck: 2, neckYaw: 6, tailYaw: 50, feet: { FL: { x: 0.15, z: 0.1 }, FR: { x: -0.15, z: 0.1 }, HL: { x: 0.15, z: 0.1 }, HR: { x: -0.15, z: 0.1 } } },
    roarTime: 2,
    roar: { neck: -26, jaw: 40, body: -4, tail: -6, shake: 1.5 },
  });
  // Swimming: the legs folded back along the body, the body and tail driving it in long waves.
  m.clip('swim', 1.4, (u) => {
    const pose = { legs: false, body: { t: [0, 0.03 * sin(u * 2), 0], r: [0, 5 * sin(u), 2 * sin(u + 0.2)] } };
    wave(pose, tail, u - 0.15, 16, 0.16, 1, 1.12);
    bend(pose, ['neck', 'head'], [-2, -6 * sin(u), 0]);
    for (const [s, k] of [['L', 1], ['R', -1]]) {
      const paddle = 6 * sin(u + (k > 0 ? 0 : 0.5));
      pose[`upperF${s}`] = { r: [62 + paddle, 0, k * -22] };
      pose[`lowerF${s}`] = { r: [40, 0, 0] };
      pose[`footF${s}`] = { r: [35, 0, 0] };
      pose[`upperH${s}`] = { r: [48 + paddle, 0, k * -22] };
      pose[`lowerH${s}`] = { r: [55, 0, 0] };
      pose[`footH${s}`] = { r: [60, 0, 0] };
    }
    return pose;
  }, { keys: 16 });
  return m;
}
