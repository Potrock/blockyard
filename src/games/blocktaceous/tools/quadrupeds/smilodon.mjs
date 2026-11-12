/**
 * Smilodon: a sabre-toothed cat built like a bear: massive shoulders and fore legs, a back sloping
 * to lighter hindquarters, a bobbed tail, a short broad muzzle and two long curved canines hanging
 * well below the chin. Tawny coat dappled with faint darker spots, pale throat and belly, dark ear
 * backs and tail tip.
 */
import { Model, ell, cap, union, noise } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend, turn, sin, cos } from './anim.mjs';
import { legs } from './parts.mjs';

export function make() {
  const m = new Model('smilodon', 'Smilodon', 22);
  m.colour('coat', 0xc79a58);
  m.colour('spot', 0xa27a40);
  m.colour('pale', 0xeedcb8);
  m.colour('dark', 0x4a3524);
  m.colour('nose', 0x2e2018, { rough: 0.4 });
  m.colour('tooth', 0xf5eedc, { rough: 0.35 });
  m.colour('eye', 0xd9a02a, { rough: 0.2 });
  m.colour('pupil', 0x15100c, { rough: 0.2 });

  const coat = (p) => {
    if (p[1] < 0.56 - 0.05 * Math.abs(p[2])) return 'pale';
    return p[1] > 0.62 && noise(p, 0.085, 2) < 0.2 ? 'spot' : 'coat';
  };
  m.joint('body', 'root', [0, 0.74, -0.3]);
  m.joint('chest', 'body', [0, 0.8, 0.05]);
  m.joint('saddle', 'chest', [0, 1.08, 0.1], { empty: true });
  m.paint('body', union(ell([0, 0.73, -0.42], [0.235, 0.25, 0.4]), cap([0, 0.72, -0.4], [0, 0.76, 0.1], 0.22, 0.25)), coat);
  m.paint('chest', union(ell([0, 0.79, 0.36], [0.27, 0.3, 0.42]), cap([0, 0.76, 0.0], [0, 0.78, 0.3], 0.25, 0.27)), coat);
  m.joint('neck', 'chest', [0, 0.9, 0.62]);
  m.paint('neck', cap([0, 0.88, 0.58], [0, 1.0, 0.88], 0.2, 0.17), coat);
  m.joint('head', 'neck', [0, 1.0, 0.86]);
  m.joint('jaw', 'head', [0, 0.93, 0.95]);
  // The head: a broad skull, a short deep muzzle, round ears; the sabres from the upper jaw.
  const face = (p) => (p[2] > 1.14 && p[1] < 0.99 ? 'pale' : p[1] < 0.9 ? 'pale' : 'coat');
  m.paint('head', union(ell([0, 1.01, 0.98], [0.165, 0.15, 0.17]), cap([0, 0.97, 1.08], [0, 0.95, 1.2], 0.11, 0.095, 1.1, 0.9)), face);
  m.paint('head', ell([0, 1.0, 1.265], [0.05, 0.035, 0.03], 2), 'nose');
  for (const x of [1, -1]) {
    m.paint('head', ell([0.12 * x, 1.17, 0.92], [0.05, 0.06, 0.035], 2), (p) => (p[2] < 0.92 ? 'dark' : 'coat'));
    m.paint('head', ell([0.105 * x, 1.045, 1.11], [0.04, 0.03, 0.03], 2), 'eye');
    m.paint('head', ell([0.13 * x, 1.045, 1.125], [0.02, 0.025, 0.02], 2), 'pupil');
    m.paint('head', cap([0.075 * x, 0.92, 1.2], [0.075 * x, 0.71, 1.165], 0.034, 0.024), 'tooth');
  }
  m.paint('jaw', cap([0, 0.9, 0.96], [0, 0.875, 1.19], 0.08, 0.06, 0.75, 0.6), 'pale');
  m.joint('tail', 'body', [0, 0.82, -0.78]);
  m.paint('tail', cap([0, 0.82, -0.76], [0, 0.72, -1.0], 0.06, 0.05), (p) => (p[2] < -0.93 ? 'dark' : 'coat'));

  const limb = (p) => (p[1] > 0.5 && noise(p, 0.085, 2) < 0.2 ? 'spot' : 'coat');
  legs(m, {
    F: { hip: [0.2, 0.74, 0.46], knee: [0.21, 0.44, 0.36], ankle: [0.21, 0.13, 0.46], r: [0.125, 0.095, 0.08], foot: [0.1, 0.11, 0.12, 0.06] },
    H: { hip: [0.17, 0.72, -0.52], knee: [0.2, 0.45, -0.36], ankle: [0.2, 0.2, -0.62], r: [0.14, 0.09, 0.065], foot: [0.09, 0.1, 0.11, 0.1] },
  }, { F: 'chest', H: 'body' }, { upper: limb, lower: 'coat', foot: 'pale', nail: 'pale' });
  // The hind paw is ahead of its hock: a cat stands on its toes.
  m.paintLR('footH', cap([0.2, 0.2, -0.62], [0.2, 0.06, -0.52], 0.06, 0.07), 'coat');

  const stride = strideFor(1.6);
  const neckHead = ['neck', 'head'];
  standardClips(m, {
    body: 'body',
    neck: ['neck'],
    head: 'head',
    jaw: 'jaw',
    tail: ['tail'],
    breath: 0.012,
    idleTail: 14,
    walkTime: 0.9,
    runTime: 0.5,
    walk: { gait: GAITS.walk, stride, duty: 0.64, lift: 0.07, sink: 0.11, bob: 0.01, roll: 1.5, yaw: 2.5, pitch: 0.8, tail: 10, neckPitch: 8, toe: 40 },
    run: { gait: GAITS.gallop, stride, duty: 0.34, lift: 0.16, sink: 0.11, bob: 0.045, beats: 1, bobAt: 0.55, pitch: 5, pitchBeats: 1, roll: 0, yaw: 0, tail: 6, tailLift: -25, neckPitch: 10, nod: 4, toe: 55 },
    // A stab: reared back with the jaws gaping, then the sabres driven down.
    attack: (u) => {
      const a = keys(u, [[0, 0], [0.3, -1], [0.55, 1], [0.8, 0.3], [1, 0]]);
      const lunge = keys(u, [[0, 0], [0.25, -0.05], [0.55, 0.22], [1, 0]]);
      const pose = { body: { t: [0, -0.04 * Math.abs(a), lunge], r: [0, 0, 0] }, chest: { r: [-8 * Math.max(0, -a) + 6 * Math.max(0, a), 0, 0] }, jaw: { r: [55 * keys(u, [[0, 0], [0.3, 1], [0.5, 0.8], [0.7, 0.1], [1, 0]]), 0, 0] } };
      return bend(pose, neckHead, [30 * a, 0, 0]);
    },
    eat: { neck: 62, body: 0, sink: 0.1, nod: 5, jaw: 16, sway: 6, weights: [1, 0.8] },
    sleep: { drop: 0.42, roll: 0, neck: 40, neckYaw: 25, tail: 20, tailYaw: 30, weights: [1, 0.6], feet: { FL: { z: 0.32 }, FR: { z: 0.3 }, HL: { z: 0.2 }, HR: { z: 0.2 } } },
    roarTime: 1.5,
    roar: { neck: -30, jaw: 62, body: 0, sink: 0.03, forward: 0.03, weights: [1, 1.2] },
    extra: (name, u, pose) => {
      // The spine: flexing in the gallop, gathering and stretching; the fore end sunk to eat.
      if (name === 'run') turn(pose, 'chest', [-7 * cos(u + 0.2), 0, 0]);
      if (name === 'walk') turn(pose, 'chest', [0, -2.5 * sin(u + 0.25), 0]);
      if (name === 'eat') turn(pose, 'chest', [9, 0, 0]);
      if (name === 'roar') turn(pose, 'chest', [-5 * keys(u, [[0, 0], [0.22, 1], [0.75, 1], [1, 0]]), 0, 0]);
    },
  });
  return m;
}
