/**
 * Blocktaceous: the pieces most of the four-legged animals are put together from: legs (three
 * joints and a foot each side, fore and hind) and chains of joints (necks, tails, a trunk).
 */
import { cap, ell, union } from './lib.mjs';

/**
 * Four legs. `spec`: { F, H }, each { hip, knee, ankle (the left's places), r: [at the hip, the
 * knee, the ankle], sx (how wide the thigh is for its depth), foot: [half width, height, half
 * length, how far ahead of the ankle], nails: how many toes show a nail }, `parent` ({ F, H }: the
 * joints they hang from), `colour`: { upper, lower, foot, nail } (names or functions of a point).
 */
export function legs(m, spec, parent, colour) {
  for (const k of ['F', 'H']) {
    const g = spec[k];
    m.jointLR(`upper${k}`, parent[k], g.hip);
    m.jointLR(`lower${k}`, `upper${k}*`, g.knee);
    m.jointLR(`foot${k}`, `lower${k}*`, g.ankle);
    for (const s of ['L', 'R']) m.leg(`${k}${s}`, `upper${k}${s}`, `lower${k}${s}`, `foot${k}${s}`);
    const [fw, fh, fl, ahead] = g.foot;
    const [ax, ay, az] = g.ankle;
    m.paintLR(`upper${k}`, cap(g.hip, g.knee, g.r[0], g.r[1], g.sx ?? 1), colour.upper);
    m.paintLR(`lower${k}`, cap(g.knee, g.ankle, g.r[1], g.r[2]), colour.lower);
    const nailFrom = az + ahead + fl * 0.55;
    m.paintLR(`foot${k}`, union(cap(g.ankle, [ax, fh * 0.6, az + ahead * 0.5], g.r[2] * 0.95, g.r[2]), ell([ax, fh * 0.5, az + ahead], [fw, fh * 0.5 + 0.02, fl])), (p) => (p[1] < fh * 0.6 && p[2] > nailFrom ? colour.nail : typeof colour.foot === 'function' ? colour.foot(p) : colour.foot));
  }
}

/** A chain of joints through points (the last point its tip), each a tapered piece: joints `names[i]` at `pts[i]`. */
export function limbs(m, names, parent, pts, radii, colour, sx = 1, sy = 1) {
  names.forEach((name, i) => {
    m.joint(name, i ? names[i - 1] : parent, pts[i]);
    m.paint(name, cap(pts[i], pts[i + 1], radii[i], radii[i + 1], sx, sy), colour);
  });
}
