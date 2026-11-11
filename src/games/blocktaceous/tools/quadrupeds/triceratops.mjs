/**
 * Triceratops: a deep barrel of a body highest at the hips, a short thick tail, a huge skull with a
 * parrot beak, a short nose horn, two long brow horns and a broad bony frill rimmed with knobs.
 * Sandy olive hide, darker along the back in broken bands, a pale belly; the frill carries two
 * dark-ringed rust eye-spots (a display, as the frill likely was).
 */
import { Model, ell, cap, chain, union } from './lib.mjs';
import { standardClips, GAITS, strideFor, keys, bend } from './anim.mjs';

export function make() {
  const m = new Model('triceratops', 'Triceratops', 9.5);
  m.colour('hide', 0xa88c5c);
  m.colour('back', 0x5c4a35);
  m.colour('belly', 0xe8dab4);
  m.colour('frill', 0x7a6344);
  m.colour('rust', 0xc9632c);
  m.colour('ring', 0x30261d);
  m.colour('rim', 0xeadfbe);
  m.colour('horn', 0xf0e7cf, { rough: 0.5 });
  m.colour('hornTip', 0x7a6650, { rough: 0.5 });
  m.colour('beak', 0x4b4036, { rough: 0.55 });
  m.colour('nail', 0x3a3229, { rough: 0.6 });
  m.colour('eye', 0x15100c, { rough: 0.2 });
  m.colour('eyeRing', 0xe2a233);

  m.joint('body', 'root', [0, 1.9, 0]);
  m.joint('saddle', 'body', [0, 2.8, -0.2], { empty: true });
  m.joint('neck', 'body', [0, 1.8, 1.55]);
  m.joint('head', 'neck', [0, 1.8, 2.1]);
  m.joint('jaw', 'head', [0, 1.45, 2.55]);
  m.joint('tail1', 'body', [0, 1.95, -1.75]);
  m.joint('tail2', 'tail1', [0, 1.7, -2.6]);
  m.joint('tail3', 'tail2', [0, 1.4, -3.4]);
  m.jointLR('upperF', 'body', [0.7, 1.7, 1.05]);
  m.jointLR('lowerF', 'upperF*', [0.8, 0.98, 0.78]);
  m.jointLR('footF', 'lowerF*', [0.8, 0.34, 1.05]);
  m.jointLR('upperH', 'body', [0.66, 1.95, -1.0]);
  m.jointLR('lowerH', 'upperH*', [0.8, 1.1, -0.6]);
  m.jointLR('footH', 'lowerH*', [0.8, 0.38, -1.05]);
  for (const s of ['L', 'R']) {
    m.leg(`F${s}`, `upperF${s}`, `lowerF${s}`, `footF${s}`);
    m.leg(`H${s}`, `upperH${s}`, `lowerH${s}`, `footH${s}`);
  }

  // The hide: pale below, dark along the back, the dark running down the flanks in tapering bars.
  const coat = (p) => {
    if (p[1] < (p[2] < -1.7 ? 1.75 + (p[2] + 1.7) * 0.36 : 1.32)) return 'belly';
    const bar = 0.5 + 0.5 * Math.sin(p[2] * 5.2);
    if (p[1] > 2.5 - 0.15 * Math.abs(p[0]) - 0.75 * Math.max(0, bar - 0.55) / 0.45) return 'back';
    return 'hide';
  };
  m.paint('body', union(ell([0, 1.85, -0.3], [1.12, 0.9, 1.65]), ell([0, 2.0, -0.95], [1.0, 0.85, 1.0]), ell([0, 1.62, 0.85], [0.95, 0.78, 0.95])), coat);
  m.paint('neck', cap([0, 1.7, 1.4], [0, 1.78, 2.2], 0.6, 0.5), coat);
  m.paint('tail1', cap([0, 1.95, -1.5], [0, 1.7, -2.6], 0.66, 0.46), coat);
  m.paint('tail2', cap([0, 1.7, -2.6], [0, 1.4, -3.4], 0.46, 0.3), coat);
  m.paint('tail3', cap([0, 1.4, -3.4], [0, 1.12, -4.08], 0.3, 0.14), coat);

  // Legs: pillars, the fore legs a little bowed, the hind legs heavier; broad round feet.
  const foot = (z) => (p) => (p[1] < 0.2 && p[2] > z ? 'nail' : 'back');
  const upper = (p) => (coat(p) === 'back' ? 'back' : 'hide');
  m.paintLR('upperF', cap([0.7, 1.7, 1.05], [0.8, 0.98, 0.78], 0.44, 0.34), upper);
  m.paintLR('lowerF', cap([0.8, 0.98, 0.78], [0.8, 0.34, 1.05], 0.34, 0.3), 'hide');
  m.paintLR('footF', union(cap([0.8, 0.36, 1.05], [0.8, 0.22, 1.08], 0.3, 0.33), ell([0.8, 0.1, 1.14], [0.35, 0.22, 0.4])), foot(1.38));
  m.paintLR('upperH', cap([0.66, 1.95, -1.0], [0.8, 1.1, -0.6], 0.56, 0.42, 0.85), upper);
  m.paintLR('lowerH', cap([0.8, 1.1, -0.6], [0.8, 0.38, -1.05], 0.4, 0.32), 'hide');
  m.paintLR('footH', union(cap([0.8, 0.4, -1.05], [0.8, 0.22, -1.0], 0.32, 0.34), ell([0.8, 0.1, -0.94], [0.36, 0.22, 0.42])), foot(-0.7));

  // The skull: deep cheeks, a snout narrowing to the beak, and the frill sweeping up and back.
  const face = (p) => (p[1] < 1.5 ? 'belly' : 'hide');
  m.paint('head', union(ell([0, 1.8, 2.75], [0.6, 0.58, 0.8]), cap([0, 1.74, 3.1], [0, 1.6, 3.95], 0.5, 0.26, 0.9)), face);
  m.paint('head', cap([0, 1.56, 3.98], [0, 1.34, 4.2], 0.2, 0.1), 'beak');
  const frillZ = (p) => 2.55 - 0.8 * (p[1] - 1.9) - 0.25 * (p[0] / 1.2) ** 2;
  const frillR = (p) => Math.hypot(p[0] / 1.2, (p[1] - 2.0) / 1.0);
  m.paint('head', { lo: [-1.2, 1.45, 1.2], hi: [1.2, 3.0, 3.0], inside: (p) => frillR(p) <= 1 && Math.abs(p[2] - frillZ(p)) <= 0.19 }, (p) => {
    const r = frillR(p);
    const a = Math.atan2(p[1] - 2.0, p[0]);
    if (r > 0.84) return Math.sin(a * 13) > -0.2 ? 'rim' : 'frill';
    const spot = Math.hypot(Math.abs(p[0]) - 0.62, p[1] - 2.42);
    if (spot < 0.16) return 'rust';
    if (spot < 0.31) return 'ring';
    return p[1] > 2.25 && Math.abs(p[0]) < 0.1 ? 'back' : 'frill';
  });
  // The frill's base, filling in behind the skull.
  m.paint('head', ell([0, 1.95, 2.3], [0.8, 0.55, 0.5]), face);
  for (const x of [1, -1]) {
    m.paint('head', chain([[0.36 * x, 2.15, 2.85], [0.48 * x, 2.55, 3.4], [0.52 * x, 2.72, 4.1]], [0.19, 0.15, 0.07]), (p) => (p[2] > 3.85 ? 'hornTip' : 'horn'));
    m.paint('head', cap([0.55 * x, 1.6, 2.7], [0.76 * x, 1.42, 2.65], 0.14, 0.08), 'rim');
    m.paint('head', ell([0.5 * x, 1.98, 3.1], [0.1, 0.14, 0.14], 2), 'eyeRing');
    m.paint('head', ell([0.6 * x, 1.98, 3.1], [0.1, 0.07, 0.07], 2), 'eye');
  }
  m.paint('head', cap([0, 1.9, 3.7], [0, 2.25, 3.85], 0.15, 0.07), (p) => (p[1] > 2.12 ? 'hornTip' : 'horn'));
  m.paint('jaw', cap([0, 1.45, 2.6], [0, 1.36, 3.9], 0.3, 0.14, 1.15), (p) => (p[2] > 3.78 ? 'beak' : 'belly'));

  const stride = strideFor(3.2);
  const neckHead = ['neck', 'head'];
  standardClips(m, {
    body: 'body',
    neck: ['neck'],
    head: 'head',
    jaw: 'jaw',
    tail: ['tail1', 'tail2', 'tail3'],
    breath: 0.025,
    walk: { gait: GAITS.walk, stride, duty: 0.68, lift: 0.22, sink: 0.05, bob: 0.02, roll: 1.4, yaw: 1.6, pitch: 0.5, tail: 5 },
    run: { gait: GAITS.trot, stride, duty: 0.46, lift: 0.38, sink: 0.08, bob: 0.06, roll: 1, yaw: 1, pitch: 1.2, lean: 2.5, tail: 7, tailLift: -8, toe: 35 },
    // A gore: the head dropped, then driven forward and up with the horns.
    attack: (u) => {
      const down = keys(u, [[0, 0], [0.28, 1], [0.52, -0.8], [0.8, -0.2], [1, 0]]);
      const lunge = keys(u, [[0, 0], [0.25, -0.12], [0.5, 0.5], [0.75, 0.25], [1, 0]]);
      const pose = { body: { t: [0, -0.1 * Math.abs(down), lunge], r: [down * 5, 0, 0] } };
      return bend(pose, neckHead, [down * 32, 0, 0]);
    },
    eat: { neck: 36, body: 5, sink: 0.12, forward: 0.1, nod: 4, jaw: 9, weights: [1, 1.6] },
    sleep: { drop: 0.86, neck: 14, neckYaw: 14, tailYaw: 55, feet: { FL: { z: 0.55 }, FR: { z: 0.55 }, HL: { z: 0.5 }, HR: { z: 0.5 } } },
    roar: { neck: -24, jaw: 26, body: -3, sink: 0.05, weights: [1, 1.5] },
  });
  return m;
}
