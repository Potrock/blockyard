/**
 * Stegosaurus: a high arched back over long hind legs and short fore legs, a tiny head carried low,
 * two staggered rows of upright plates from neck to tail (the tallest over the hips) and four long
 * spikes at the tail's end. Grey-green hide with a pale belly and dark dappling along the back; the
 * plates rust at the base flushing to amber at the tips.
 */
import { Model, ell, cap, union, noise } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend, turn } from './anim.mjs';
import { legs, limbs } from './parts.mjs';

export function make() {
  const m = new Model('stegosaurus', 'Stegosaurus', 9);
  m.colour('hide', 0x74805a);
  m.colour('back', 0x4b563c);
  m.colour('belly', 0xd4cca2);
  m.colour('plate', 0x8c4428);
  m.colour('plateMid', 0xc06a2c);
  m.colour('plateTip', 0xe6a23c);
  m.colour('spike', 0xe9dfc4, { rough: 0.5 });
  m.colour('beak', 0x4a4236, { rough: 0.55 });
  m.colour('nail', 0x39322a, { rough: 0.6 });
  m.colour('eye', 0x15100c, { rough: 0.2 });

  // The line of the back, from the head up over the hips and down the tail.
  const spine = [[3.6, 1.38], [3.0, 1.45], [2.3, 1.7], [1.6, 2.1], [0.8, 2.5], [-0.3, 2.78], [-1.2, 2.7], [-2.0, 2.45], [-2.9, 2.15], [-3.9, 1.85], [-5.0, 1.6]];
  const backY = (z) => {
    for (let i = 1; i < spine.length; i++) if (z >= spine[i][0]) return spine[i - 1][1] + ((spine[i][1] - spine[i - 1][1]) * (spine[i - 1][0] - z)) / (spine[i - 1][0] - spine[i][0]);
    return spine[spine.length - 1][1];
  };
  const coat = (p) => {
    const top = backY(p[2]);
    if (p[1] < top - 1.35 - 0.25 * Math.max(0, 1 - Math.abs(p[2] + 0.3) / 2.2)) return 'belly';
    if (p[1] > top - 0.28 || (p[1] > top - 0.75 && noise(p, 0.34) < 0.4)) return 'back';
    return 'hide';
  };

  m.joint('body', 'root', [0, 1.8, -0.2]);
  m.joint('saddle', 'body', [0, 2.8, 0.1], { empty: true });
  m.paint('body', union(ell([0, 1.78, -0.35], [1.12, 1.0, 1.75]), ell([0, 1.5, 1.0], [0.85, 0.72, 1.0])), coat);
  limbs(m, ['neck1', 'neck2'], 'body', [[0, 1.5, 1.75], [0, 1.32, 2.4], [0, 1.2, 3.05]], [0.5, 0.36, 0.27], coat);
  m.joint('head', 'neck2', [0, 1.2, 3.05]);
  m.joint('jaw', 'head', [0, 1.1, 3.2]);
  m.paint('head', union(ell([0, 1.2, 3.3], [0.22, 0.2, 0.36]), cap([0, 1.17, 3.5], [0, 1.1, 3.88], 0.17, 0.11)), (p) => (p[2] > 3.82 ? 'beak' : p[1] > 1.24 ? 'back' : 'hide'));
  for (const x of [1, -1]) m.paint('head', ell([0.2 * x, 1.26, 3.4], [0.06, 0.06, 0.06], 2), 'eye');
  m.paint('jaw', cap([0, 1.08, 3.2], [0, 1.03, 3.84], 0.13, 0.08, 1.1, 0.7), (p) => (p[2] > 3.8 ? 'beak' : 'belly'));
  limbs(m, ['tail1', 'tail2', 'tail3'], 'body', [[0, 1.95, -1.75], [0, 1.72, -2.9], [0, 1.52, -3.9], [0, 1.42, -5.05]], [0.72, 0.46, 0.28, 0.1], coat);
  // The tail's four spikes, out, up and back.
  for (const x of [1, -1]) for (const z of [-4.25, -4.75]) m.paint('tail3', cap([0.1 * x, 1.5, z], [0.85 * x, 1.95, z - 0.35], 0.11, 0.045), 'spike');

  // The plates: two rows either side of the spine, each plate between two of the other row's.
  const plates = [[2.55, 0.24, 0.36], [1.9, 0.32, 0.58], [1.3, 0.38, 0.78], [0.65, 0.44, 0.98], [-0.05, 0.5, 1.16], [-0.8, 0.52, 1.22], [-1.55, 0.48, 1.08], [-2.3, 0.42, 0.9], [-3.0, 0.34, 0.68], [-3.6, 0.26, 0.48]];
  plates.forEach(([z, w, h], i) => {
    const x = i % 2 ? -0.17 : 0.17;
    const part = z > 2.4 ? 'neck2' : z > 1.75 ? 'neck1' : z > -1.75 ? 'body' : z > -2.9 ? 'tail1' : 'tail2';
    const base = backY(z) - 0.25;
    m.paint(part, { lo: [x - 0.11, base, z - w], hi: [x + 0.11, base + h + 0.25, z + w], inside: (p) => p[1] - base - 0.25 <= h * (1 - (Math.abs(p[2] - z) / w) ** 1.7) }, (p) => {
      const t = (p[1] - base - 0.25) / h, edge = (p[1] - base - 0.25) / (h * (1 - (Math.abs(p[2] - z) / w) ** 1.7));
      return edge > 0.72 || t > 0.72 ? 'plateTip' : t > 0.3 ? 'plateMid' : 'plate';
    });
  });

  const limb = (p) => (p[1] > 1.75 && noise(p, 0.34) < 0.4 ? 'back' : 'hide');
  legs(m, {
    F: { hip: [0.62, 1.38, 1.15], knee: [0.78, 0.78, 0.92], ankle: [0.78, 0.27, 1.15], r: [0.36, 0.27, 0.23], foot: [0.28, 0.3, 0.3, 0.08] },
    H: { hip: [0.66, 1.95, -0.95], knee: [0.85, 1.08, -0.55], ankle: [0.85, 0.34, -1.0], r: [0.56, 0.38, 0.27], sx: 0.85, foot: [0.32, 0.36, 0.36, 0.1] },
  }, { F: 'body', H: 'body' }, { upper: limb, lower: 'hide', foot: 'back', nail: 'nail' });

  const stride = strideFor(3);
  const tail = ['tail1', 'tail2', 'tail3'];
  standardClips(m, {
    body: 'body',
    neck: ['neck1', 'neck2'],
    head: 'head',
    jaw: 'jaw',
    tail,
    breath: 0.025,
    idleTail: 5,
    walkTime: 1.3,
    walk: { gait: GAITS.walk, stride, duty: 0.7, lift: 0.2, sink: 0.05, bob: 0.02, roll: 1.5, yaw: 1.8, pitch: 0.5, tail: 6 },
    run: { gait: GAITS.trot, stride, duty: 0.5, lift: 0.3, sink: 0.07, bob: 0.045, roll: 1.2, yaw: 1.2, pitch: 1, lean: 1.5, tail: 8, toe: 30 },
    // The tail's spikes swung round: wound up one way, then whipped across.
    attack: (u) => {
      const a = keys(u, [[0, 0], [0.3, -0.5], [0.55, 1], [0.8, 0.3], [1, 0]]);
      const pose = { body: { t: [0, -0.05 * Math.abs(a), 0], r: [0, -9 * a, 0] } };
      bend(pose, tail, [-6 * Math.abs(a), 75 * a, 0], [1, 1.3, 1.5]);
      return bend(pose, ['neck1', 'neck2', 'head'], [0, 14 * a, 0]);
    },
    eat: { neck: 34, body: 3, sink: 0.06, nod: 4, jaw: 10, weights: [1.2, 1, 0.6] },
    sleep: { drop: 0.72, pitch: 2, neck: 16, neckYaw: 20, tailYaw: 60, feet: { FL: { z: 0.3 }, FR: { z: 0.3 }, HL: { z: 0.55 }, HR: { z: 0.55 } } },
    roar: { neck: -42, jaw: 24, body: -3, sink: 0.04, tail: -14, weights: [1, 1, 0.8] },
  });
  return m;
}
