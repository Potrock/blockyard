/**
 * Brachiosaurus: a giant built like a giraffe: fore legs longer than hind, so the back slopes down
 * from towering shoulders, and a very long neck carried high with a small head, its nostrils in a
 * domed crest over the eyes. A fairly short tail held clear of the ground. Warm grey-brown hide in
 * big darker patches, paler under the neck and belly, a dark stripe down the spine.
 */
import { Model, ell, cap, union, noise } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend } from './anim.mjs';
import { legs, limbs } from './parts.mjs';

export function make() {
  const m = new Model('brachiosaurus', 'Brachiosaurus', 4.5);
  m.colour('hide', 0x94866a);
  m.colour('patch', 0x6f634c);
  m.colour('back', 0x54493a);
  m.colour('belly', 0xdcd0b2);
  m.colour('crest', 0xa5553a);
  m.colour('nail', 0x3a3229, { rough: 0.6 });
  m.colour('eye', 0x15100c, { rough: 0.2 });

  // The neck's line, up from the shoulders, and the tail's, back from the hips.
  const neck = [[0, 5.5, 3.1], [0, 7.0, 4.6], [0, 8.5, 6.1], [0, 9.9, 7.6], [0, 11.0, 9.0]];
  const tail = [[0, 4.6, -3.3], [0, 4.1, -5.6], [0, 3.6, -7.9], [0, 3.1, -10.2], [0, 2.7, -12.6]];
  const along = (pts, p) => {
    // The line's height over (or under) a point, by z.
    for (let i = 1; i < pts.length; i++) if ((p[2] - pts[i][2]) * (pts[0][2] < pts[1][2] ? 1 : -1) <= 0 || i === pts.length - 1) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (p[2] - pts[i - 1][2])) / (pts[i][2] - pts[i - 1][2]);
  };
  const coat = (p) => {
    const mid = p[2] > 3.1 ? along(neck, p) : p[2] < -3.3 ? along(tail, p) : 4.7 + 0.25 * p[2];
    const half = p[2] > 3.1 ? 1.1 - 0.07 * (p[2] - 3.1) : p[2] < -3.3 ? Math.max(0.2, 1.3 + 0.11 * (p[2] + 3.3)) : 1.8;
    if (p[1] < mid - half * 0.45) return 'belly';
    if (p[1] > mid + half * 0.55 && Math.abs(p[0]) < 0.7) return 'back';
    return noise([p[0] * 0.6, p[1], p[2]], 1.0, 3) < 0.45 ? 'patch' : 'hide';
  };

  m.joint('body', 'root', [0, 4.7, 0]);
  m.joint('saddle', 'body', [0, 6.75, 1.0], { empty: true });
  m.paint('body', union(ell([0, 4.5, -0.4], [2.05, 1.85, 3.3]), ell([0, 5.05, 1.7], [1.9, 1.75, 2.0])), coat);
  limbs(m, ['neck1', 'neck2', 'neck3', 'neck4'], 'body', neck, [1.3, 0.95, 0.75, 0.62, 0.5], coat);
  m.joint('head', 'neck4', neck[4]);
  m.joint('jaw', 'head', [0, 10.85, 9.3]);
  // The head: a blunt muzzle, and the nostrils' dome over the eyes.
  m.paint('head', union(ell([0, 11.1, 9.4], [0.5, 0.45, 0.65]), cap([0, 11.0, 9.8], [0, 10.9, 10.5], 0.42, 0.34, 1.1, 0.8)), (p) => (p[1] < 10.9 ? 'belly' : 'hide'));
  m.paint('head', ell([0, 11.62, 9.55], [0.3, 0.4, 0.45]), 'crest');
  for (const x of [1, -1]) m.paint('head', ell([0.45 * x, 11.2, 9.5], [0.12, 0.12, 0.12], 2), 'eye');
  m.paint('jaw', cap([0, 10.75, 9.3], [0, 10.68, 10.4], 0.3, 0.24, 1.3, 0.6), 'belly');
  limbs(m, ['tail1', 'tail2', 'tail3', 'tail4'], 'body', tail, [1.35, 0.95, 0.65, 0.42, 0.18], coat);

  const limb = (p) => (noise([p[0] * 0.6, p[1], p[2]], 1.0, 3) < 0.45 && p[1] > 2.4 ? 'patch' : 'hide');
  legs(m, {
    F: { hip: [1.3, 4.7, 2.3], knee: [1.45, 2.6, 1.95], ankle: [1.45, 0.6, 2.3], r: [0.85, 0.62, 0.52], foot: [0.62, 0.6, 0.62, 0.1] },
    H: { hip: [1.25, 4.2, -2.2], knee: [1.45, 2.35, -1.8], ankle: [1.45, 0.6, -2.25], r: [0.95, 0.68, 0.55], sx: 0.9, foot: [0.66, 0.6, 0.7, 0.15] },
  }, { F: 'body', H: 'body' }, { upper: limb, lower: 'hide', foot: 'patch', nail: 'nail' });

  const stride = strideFor(7);
  const necks = ['neck1', 'neck2', 'neck3', 'neck4'];
  const all = [...necks, 'head'];
  standardClips(m, {
    body: 'body',
    neck: necks,
    head: 'head',
    jaw: 'jaw',
    tail: ['tail1', 'tail2', 'tail3', 'tail4'],
    breath: 0.06,
    idleTime: 6,
    idleTail: 3,
    walkTime: 2.4,
    runTime: 1.6,
    attackTime: 0.9,
    walk: { gait: GAITS.walk, stride, duty: 0.72, lift: 0.35, sink: 0.12, bob: 0.03, roll: 1, yaw: 1.2, pitch: 0.4, tail: 3, nod: 1 },
    run: { gait: GAITS.amble, stride, duty: 0.6, lift: 0.5, sink: 0.16, bob: 0.06, roll: 1.4, yaw: 1.4, pitch: 0.7, lean: 1.5, tail: 4, nod: 2 },
    // A stomp: reared up off its fore feet, then down with all its weight.
    attack: (u) => {
      const up = keys(u, [[0, 0], [0.45, 1], [0.62, 0], [0.75, -0.25], [1, 0]]);
      const paw = keys(u, [[0, 0], [0.4, 1], [0.6, 0], [1, 0]]);
      const pose = { body: { t: [0, 0.25 * up, -0.3 * Math.max(0, up)], r: [-11 * up, 0, 0] }, feet: { FL: { y: 1.5 * paw, z: 0.3 * paw, pitch: 20 * paw }, FR: { y: 1.25 * paw, z: 0.5 * paw, pitch: 20 * paw } } };
      return bend(pose, all, [14 * up, 0, 0]);
    },
    // Browsing: the head swung forward and down to a branch, stripping it.
    eat: { neck: 42, sway: 5, nod: 4, jaw: 9, weights: [1.4, 1.2, 1, 0.8, 1.6] },
    sleep: { drop: 2.35, neck: 62, neckYaw: 20, tailYaw: 50, weights: [1.6, 1.3, 1, 0.8, 0.3], feet: { FL: { z: 1.2 }, FR: { z: 1.2 }, HL: { z: 1.3 }, HR: { z: 1.3 } } },
    roarTime: 2.4,
    roar: { neck: -18, jaw: 20, body: -2, sink: 0.1, tail: -6, shake: 1.2, weights: [1, 1, 1, 1, 2] },
  });
  return m;
}
