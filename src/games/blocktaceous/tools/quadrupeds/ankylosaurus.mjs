/**
 * Ankylosaurus: a low, very wide animal armoured all over: rows of bony knobs across the back, a
 * fringe of short spikes along each flank, a broad triangular skull with a horn at each back
 * corner, and a stiff tail ending in a heavy bone club. Dark earth-brown armour, the knobs bone
 * coloured, rust along the flanks, a pale belly.
 */
import { Model, ell, cap, union } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend } from './anim.mjs';
import { legs, limbs } from './parts.mjs';

export function make() {
  const m = new Model('ankylosaurus', 'Ankylosaurus', 10);
  m.colour('armour', 0x64584a);
  m.colour('flank', 0x8f5d3d);
  m.colour('knob', 0xc2b08a);
  m.colour('belly', 0xdccda6);
  m.colour('skin', 0x7b6a54);
  m.colour('horn', 0xe6dcc0, { rough: 0.5 });
  m.colour('club', 0x4a3f35);
  m.colour('nail', 0x342d26, { rough: 0.6 });
  m.colour('eye', 0x15100c, { rough: 0.2 });

  // The shell: flat on top, the flanks rust, the belly pale.
  const shell = (p) => (p[1] < 0.72 ? 'belly' : p[1] < 1.08 && Math.abs(p[0]) > 0.75 ? 'flank' : 'armour');
  m.joint('body', 'root', [0, 1.05, 0]);
  m.joint('saddle', 'body', [0, 1.72, 0], { empty: true });
  m.paint('body', ell([0, 1.05, -0.15], [1.08, 0.62, 1.85], 3.4), shell);
  // Knobs in rows across the back, and a spike at the end of each row.
  for (let row = 0; row < 8; row++) {
    const z = 1.3 - row * 0.42;
    const w = 1.08 * (1 - ((z + 0.15) / 1.85) ** 2) ** 0.4;
    for (let col = -3; col <= 3; col++) {
      const x = (col + (row % 2 ? 0.25 : -0.25)) * 0.3;
      if (Math.abs(x) > w - 0.22) continue;
      const y = 1.05 + 0.62 * (1 - Math.abs(x / 1.08) ** 3.4 - Math.abs((z + 0.15) / 1.85) ** 3.4) ** (1 / 3.4);
      m.paint('body', ell([x, y, z], [0.1, 0.12, 0.12], 2), 'knob');
    }
    for (const s of [1, -1]) m.paint('body', cap([s * (w - 0.1), 1.0, z], [s * (w + 0.12), 0.95, z - 0.06], 0.12, 0.05), 'knob');
  }
  m.joint('neck', 'body', [0, 1.0, 1.6]);
  m.paint('neck', cap([0, 1.0, 1.5], [0, 0.98, 2.15], 0.5, 0.42, 1.25, 0.8), shell);
  m.joint('head', 'neck', [0, 0.98, 2.15]);
  m.joint('jaw', 'head', [0, 0.82, 2.3]);
  // The skull: wide and flat, narrowing to a blunt beak, horns at its back corners.
  m.paint('head', union(ell([0, 1.0, 2.5], [0.56, 0.3, 0.5], 3.2), cap([0, 0.95, 2.8], [0, 0.88, 3.25], 0.3, 0.2, 1.2, 0.8)), (p) => (p[1] > 1.12 ? 'knob' : p[2] > 3.25 ? 'club' : 'skin'));
  for (const x of [1, -1]) {
    m.paint('head', cap([0.45 * x, 1.18, 2.25], [0.72 * x, 1.32, 2.05], 0.13, 0.05), 'horn');
    m.paint('head', cap([0.5 * x, 0.88, 2.3], [0.76 * x, 0.76, 2.15], 0.12, 0.05), 'horn');
    m.paint('head', ell([0.5 * x, 1.02, 2.72], [0.07, 0.07, 0.07], 2), 'eye');
  }
  m.paint('jaw', cap([0, 0.8, 2.3], [0, 0.76, 3.2], 0.24, 0.15, 1.5, 0.6), 'belly');
  limbs(m, ['tail1', 'tail2', 'tail3'], 'body', [[0, 1.0, -1.8], [0, 0.92, -2.4], [0, 0.86, -3.0], [0, 0.82, -3.45]], [0.52, 0.34, 0.24, 0.2], (p) => (p[1] < 0.74 ? 'belly' : 'armour'), 1.2, 0.85);
  m.paint('tail3', ell([0, 0.82, -3.38], [0.5, 0.27, 0.36], 2.6), (p) => (Math.abs(p[0]) < 0.12 || p[1] < 0.7 ? 'club' : 'knob'));

  legs(m, {
    F: { hip: [0.72, 0.95, 1.15], knee: [0.86, 0.56, 0.98], ankle: [0.86, 0.2, 1.15], r: [0.3, 0.24, 0.2], foot: [0.25, 0.24, 0.27, 0.06] },
    H: { hip: [0.72, 1.0, -1.25], knee: [0.88, 0.6, -1.0], ankle: [0.88, 0.22, -1.3], r: [0.36, 0.27, 0.22], foot: [0.27, 0.26, 0.3, 0.08] },
  }, { F: 'body', H: 'body' }, { upper: 'flank', lower: 'skin', foot: 'armour', nail: 'nail' });

  const stride = strideFor(2.4);
  const tail = ['tail1', 'tail2', 'tail3'];
  standardClips(m, {
    body: 'body',
    neck: ['neck'],
    head: 'head',
    jaw: 'jaw',
    tail,
    breath: 0.018,
    idleTail: 5,
    walkTime: 1.3,
    walk: { gait: GAITS.walk, stride, duty: 0.7, lift: 0.12, sink: 0.08, bob: 0.012, roll: 2, yaw: 2.5, pitch: 0.4, tail: 6 },
    run: { gait: GAITS.trot, stride, duty: 0.52, lift: 0.18, sink: 0.08, bob: 0.03, roll: 1.5, yaw: 2, pitch: 0.8, tail: 8 },
    // The club: the tail drawn to one side, then swung hard across.
    attack: (u) => {
      const a = keys(u, [[0, 0], [0.3, -0.55], [0.55, 1], [0.8, 0.3], [1, 0]]);
      const pose = { body: { t: [0, -0.03 * Math.abs(a), 0], r: [0, -12 * a, 0] } };
      bend(pose, tail, [0, 80 * a, 0], [1.4, 1, 0.6]);
      return bend(pose, ['neck', 'head'], [0, 12 * a, 0]);
    },
    eat: { neck: 26, body: 2.5, sink: 0.04, nod: 3, jaw: 10, weights: [1, 1.4] },
    sleep: { drop: 0.42, neck: 12, neckYaw: 10, tailYaw: 45, feet: { FL: { z: 0.2, x: 0.15 }, FR: { z: 0.2, x: -0.15 }, HL: { z: 0.25, x: 0.15 }, HR: { z: 0.25, x: -0.15 } } },
    roar: { neck: -22, jaw: 24, body: -2, tail: -8 },
  });
  return m;
}
