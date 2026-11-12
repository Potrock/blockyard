/**
 * Woolly mammoth: a high domed head, a hump of fat over the shoulders and a back sloping down to
 * the hips, small ears, a long trunk, and great tusks that sweep out, forward and back in toward
 * each other. A shaggy coat hanging in a ragged skirt along the flanks: dark chestnut, nearly black
 * down the back and legs, lighter streaks of guard hair; grey-brown skin on the trunk.
 */
import { Model, ell, cap, chain, union, noise } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend, sin, wave } from './anim.mjs';
import { legs, limbs } from './parts.mjs';

export function make() {
  const m = new Model('mammoth', 'Woolly Mammoth', 10);
  m.colour('fur', 0x6f4527);
  m.colour('furLight', 0x8d5d36);
  m.colour('furDark', 0x452a1a);
  m.colour('skin', 0x5e4a3c);
  m.colour('ivory', 0xf0e6cc, { rough: 0.45 });
  m.colour('nail', 0xcbb99a, { rough: 0.6 });
  m.colour('eye', 0x120d0a, { rough: 0.2 });

  // The coat: hanks of hair in vertical streaks, darker on top and at the bottom of the skirt.
  const coat = (p) => {
    const hank = noise([p[0], 0, p[2]], 0.21, 1);
    const top = p[2] > 0 ? 3.45 : 3.45 + 0.42 * p[2];
    if (p[1] > top - 0.45 - 0.25 * hank) return 'furDark';
    return hank < 0.3 ? 'furLight' : hank > 0.82 ? 'furDark' : 'fur';
  };
  m.joint('body', 'root', [0, 2.2, -0.2]);
  m.joint('saddle', 'body', [0, 3.4, 0.2], { empty: true });
  m.paint('body', union(ell([0, 2.15, -0.35], [1.1, 1.05, 1.45]), ell([0, 2.7, 0.55], [0.92, 0.8, 0.85]), ell([0, 2.1, 0.7], [1.0, 0.95, 0.8])), coat);
  // The skirt: hair hanging below the belly along the flanks, its edge ragged.
  m.paint('body', { lo: [-1.12, 0.9, -1.6], hi: [1.12, 1.9, 1.35], inside: (p) => Math.abs(p[0]) > 0.72 && ((p[0] / 1.12) ** 4 + ((p[2] + 0.1) / 1.5) ** 4 <= 1) && p[1] > 1.05 + 0.4 * noise([p[0], 0, p[2]], 0.21, 1) }, (p) => (p[1] < 1.35 ? 'furDark' : coat(p)));

  m.joint('head', 'body', [0, 2.85, 1.25]);
  m.joint('jaw', 'head', [0, 2.2, 1.7]);
  // The head: the dome, the brow sloping down to the trunk's root, and the tusks' sockets.
  m.paint('head', union(ell([0, 3.0, 1.65], [0.7, 0.6, 0.62]), cap([0, 2.85, 1.95], [0, 2.35, 2.2], 0.5, 0.38, 1.1)), coat);
  for (const x of [1, -1]) {
    m.paint('head', ell([0.72 * x, 2.82, 1.4], [0.1, 0.28, 0.2], 2.4), 'furDark');
    m.paint('head', ell([0.52 * x, 2.78, 2.1], [0.07, 0.07, 0.07], 2), 'eye');
    m.paint('head', chain([[0.36 * x, 2.35, 2.1], [0.6 * x, 1.45, 2.5], [0.82 * x, 1.0, 3.1], [0.62 * x, 1.3, 3.5], [0.3 * x, 1.85, 3.45]], [0.15, 0.14, 0.12, 0.09, 0.06]), 'ivory');
  }
  m.paint('jaw', cap([0, 2.25, 1.7], [0, 2.02, 2.15], 0.3, 0.22), coat);
  limbs(m, ['trunk1', 'trunk2', 'trunk3', 'trunk4'], 'head', [[0, 2.42, 2.28], [0, 1.85, 2.52], [0, 1.3, 2.56], [0, 0.78, 2.5], [0, 0.32, 2.42]], [0.3, 0.26, 0.22, 0.18, 0.14], (p) => (p[1] > 2.05 ? coat(p) : 'skin'));
  // A short tail with a tuft.
  m.joint('tail', 'body', [0, 2.5, -1.75]);
  m.paint('tail', cap([0, 2.5, -1.72], [0, 1.7, -1.9], 0.12, 0.09), 'furDark');

  const shag = (p) => (p[1] < 0.75 ? 'furDark' : coat(p));
  legs(m, {
    F: { hip: [0.6, 1.95, 0.75], knee: [0.66, 1.08, 0.62], ankle: [0.66, 0.32, 0.75], r: [0.46, 0.38, 0.36], foot: [0.38, 0.32, 0.4, 0.04] },
    H: { hip: [0.58, 1.75, -1.15], knee: [0.66, 1.02, -0.98], ankle: [0.66, 0.32, -1.18], r: [0.5, 0.4, 0.36], foot: [0.38, 0.32, 0.4, 0.04] },
  }, { F: 'body', H: 'body' }, { upper: coat, lower: shag, foot: 'furDark', nail: 'nail' });

  const stride = strideFor(2.8);
  const trunk = ['trunk1', 'trunk2', 'trunk3', 'trunk4'];
  standardClips(m, {
    body: 'body',
    neck: [],
    head: 'head',
    jaw: 'jaw',
    tail: ['tail'],
    breath: 0.03,
    idleTail: 10,
    walkTime: 1.4,
    walk: { gait: GAITS.walk, stride, duty: 0.72, lift: 0.2, sink: 0.08, bob: 0.025, roll: 1.6, yaw: 1.2, pitch: 0.6, tail: 12, nod: 2.5 },
    run: { gait: GAITS.amble, stride, duty: 0.58, lift: 0.3, sink: 0.08, bob: 0.05, roll: 2.2, yaw: 1.2, pitch: 1, lean: 1.5, tail: 16, nod: 4 },
    // The tusks: the head dropped, then tossed up and forward.
    attack: (u) => {
      const a = keys(u, [[0, 0], [0.3, 1], [0.55, -1], [0.8, -0.3], [1, 0]]);
      const lunge = keys(u, [[0, 0], [0.25, -0.1], [0.55, 0.45], [1, 0]]);
      const pose = { body: { t: [0, -0.06 * Math.abs(a) - 0.1 * lunge, lunge], r: [4 * a, 0, 0] }, head: { r: [24 * a, 0, 0] } };
      return bend(pose, trunk, [-70 * Math.max(0, -a) + 30 * Math.max(0, a), 0, 0]);
    },
    eat: { neck: 8, nod: 3, jaw: 10 },
    sleep: { drop: 1.12, neck: 14, tailYaw: 20, feet: { FL: { z: 0.6 }, FR: { z: 0.6 }, HL: { z: 0.55 }, HR: { z: 0.55 } } },
    roar: { neck: -22, jaw: 22, body: -3, sink: 0.04 },
    // The trunk and ears: swaying as it stands and walks, curling grass to the mouth, laid out asleep, raised to trumpet.
    extra: (name, u, pose) => {
      if (name === 'idle') wave(pose, trunk, u, 5, 0.12, 0), wave(pose, trunk, u + 0.3, 3, 0.1, 2);
      if (name === 'walk' || name === 'run') wave(pose, trunk, u * 2, name === 'run' ? 9 : 5, 0.12, 0);
      if (name === 'eat') {
        const curl = keys(u, [[0, 0], [0.3, 0.1], [0.55, 1], [0.75, 1], [1, 0]]);
        bend(pose, trunk, [-12 + 165 * curl, 0, 0], [0.5, 1, 1.2, 1.4]);
      }
      if (name === 'sleep') bend(pose, trunk, [-70, 0, 0], [1.5, 1, 0.6, 0.3]);
      if (name === 'roar') {
        const a = keys(u, [[0, 0], [0.22, 1], [0.75, 1], [1, 0]]);
        bend(pose, trunk, [-150 * a + 8 * a * sin(u * 6), 0, 0], [1.3, 1.1, 0.9, 0.7]);
      }
    },
  });
  return m;
}
