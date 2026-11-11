/**
 * Shapes for animals, painted into the platform's voxel volumes (`src/platform/character/voxels.ts`,
 * which build tools may read): tubes along a curve (a spine from tail tip to neck, a leg bone),
 * ellipsoids and boxes, each coloured by a function of where a voxel sits on the shape (its place
 * along the curve, how far up the back or down the belly), so countershading, stripes and speckles
 * follow the body. Everything is given in metres and lands on the model's own grid (`vpm` voxels a
 * metre), so one design can be built finer or coarser.
 *
 * A figure is rigid parts, one a bone. Where two meet, each reaches into the other with a core a
 * voxel in from the surface (`splitChain` for the spine, a tube's `cap` for a limb): a ball in a
 * socket, so a bend opens no gap.
 */
import { Voxels, Palette, cellKey, cellOf } from './bake.mjs';

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** A hash of a cell to 0..1 (speckles, ragged edges). */
export function hash(i, j, k, salt = 0) {
  let h = Math.imul(i + 374761 * salt + 31, 0x27d4eb2d) ^ Math.imul(j + 668265, 0x165667b1) ^ Math.imul(k + 2246822, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Stations along a curve ({ p: [x, y, z], r: [across, deep] }) resampled `n` to a span through
 * them (Catmull-Rom), so a few stations give a smooth back.
 */
export function smooth(stations, n = 4) {
  const out = [];
  const at = (i) => stations[clamp(i, 0, stations.length - 1)];
  for (let i = 0; i < stations.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let s = 0; s < n; s++) {
      const t = s / n;
      const cr = (p0, p1, p2, p3) => 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
      out.push({ p: b.p.map((_, k) => cr(a.p[k], b.p[k], c.p[k], d.p[k])), r: b.r.map((_, k) => Math.max(0.001, cr(a.r[k], b.r[k], c.r[k], d.r[k]))) });
    }
  }
  out.push(stations[stations.length - 1]);
  return out;
}

export class Sculpt {
  constructor(vpm) {
    this.vpm = vpm;
    this.vox = new Voxels();
    this.palette = new Palette();
    /** Where each cell of a part sits along the curve it was painted from (`tube` with `along`). */
    this.along = new Map();
  }
  colour(name, rgb, opts) {
    return this.palette.add(name, rgb, opts);
  }
  /**
   * Paint the cells whose centres lie in the box lo..hi (metres): `fn(p, i, j, k)` gives a colour,
   * `false` to clear, nothing to leave. `mirror` paints the other side (x to -x) as well.
   */
  fill(part, lo, hi, fn, { mirror = false } = {}) {
    const v = this.vpm;
    const p = this.vox.part(part);
    const I = (a) => [Math.floor(lo[a] * v - 0.5), Math.ceil(hi[a] * v + 0.5)];
    const [i0, i1] = I(0), [j0, j1] = I(1), [k0, k1] = I(2);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const c = fn([(i + 0.5) / v, (j + 0.5) / v, (k + 0.5) / v], i, j, k);
          if (c === undefined || c === null) continue;
          for (const ii of mirror ? [i, -1 - i] : [i]) {
            if (c === false) p.delete(cellKey(ii, j, k));
            else p.set(cellKey(ii, j, k), c);
          }
        }
  }
  ellipsoid(part, c, r, colour, opts = {}) {
    const f = typeof colour === 'function' ? colour : () => colour;
    const n = opts.power ?? 2;
    this.fill(part, c.map((x, a) => x - r[a]), c.map((x, a) => x + r[a]), (p, i, j, k) => {
      const d = Math.abs((p[0] - c[0]) / r[0]) ** n + Math.abs((p[1] - c[1]) / r[1]) ** n + Math.abs((p[2] - c[2]) / r[2]) ** n;
      if (d > 1) return;
      if (opts.clip && !opts.clip(p)) return;
      return f(p, i, j, k);
    }, opts);
  }
  box(part, lo, hi, colour, opts = {}) {
    const f = typeof colour === 'function' ? colour : () => colour;
    this.fill(part, lo, hi, (p, i, j, k) => {
      for (let a = 0; a < 3; a++) if (p[a] < lo[a] || p[a] > hi[a]) return;
      if (opts.clip && !opts.clip(p)) return;
      return f(p, i, j, k);
    }, opts);
  }
  /**
   * A tube along stations in a plane of constant x ({ p, r: [across, deep] }): a cell is inside
   * where (its offset across / r[0]) and (its offset in the plane, square to the curve / r[1])
   * lie in the unit circle (`power` 2; more is boxier). Past each end it closes in half an
   * ellipsoid `capA` / `capB` long (default: the end's depth), `capShrink` thinner (metres: a
   * joint's core, inside its neighbour). `colour(info)` gets { s (metres along), v (-1 belly or
   * back of a limb, 1 the back or front), u (-1..1 across), d (0 the axis, 1 the skin), p, i, j, k
   * }. `along`: remember each cell's `s` (for `splitChain`).
   */
  tube(part, stations, colour, opts = {}) {
    const f = typeof colour === 'function' ? colour : () => colour;
    const n = opts.power ?? 2;
    const S = stations;
    const segs = [];
    let s0 = 0;
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1];
      const dy = b.p[1] - a.p[1], dz = b.p[2] - a.p[2];
      const len = Math.hypot(dy, dz) || 1e-6;
      segs.push({ a, b, dy: dy / len, dz: dz / len, len, s0, first: i === 0, last: i === S.length - 2 });
      s0 += len;
    }
    const capA = opts.capA ?? S[0].r[1], capB = opts.capB ?? S[S.length - 1].r[1];
    const shrinks = Array.isArray(opts.capShrink) ? opts.capShrink : [opts.capShrink ?? 0, opts.capShrink ?? 0];
    const pad = Math.max(...S.map((q) => Math.max(q.r[0], q.r[1]))) + Math.max(capA, capB);
    const lo = [0, 1, 2].map((a) => Math.min(...S.map((q) => q.p[a])) - pad);
    const hi = [0, 1, 2].map((a) => Math.max(...S.map((q) => q.p[a])) + pad);
    const memo = opts.along ? (this.along.get(part) ?? this.along.set(part, new Map()).get(part)) : null;
    this.fill(part, lo, hi, (p, i, j, k) => {
      let best = null;
      for (const g of segs) {
        const py = p[1] - g.a.p[1], pz = p[2] - g.a.p[2];
        let t = (py * g.dy + pz * g.dz) / g.len;
        let over = 0, cap = 0, shrink = 0;
        // Past a segment's end: the tube's own cap at its two ends; between segments a round
        // joint (the wedge a bend opens on its outer side is filled).
        if (t < 0) {
          over = -t * g.len;
          cap = g.first ? capA : g.a.r[1];
          shrink = g.first ? shrinks[0] : 0;
          t = 0;
        } else if (t > 1) {
          over = (t - 1) * g.len;
          cap = g.last ? capB : g.b.r[1];
          shrink = g.last ? shrinks[1] : 0;
          t = 1;
        }
        if (over > cap) continue;
        const k2 = over ? shrink : 0;
        const rx = Math.max(1e-4, lerp(g.a.r[0], g.b.r[0], t) - k2), rn = Math.max(1e-4, lerp(g.a.r[1], g.b.r[1], t) - k2);
        const dx = p[0] - lerp(g.a.p[0], g.b.p[0], t);
        // Square to the curve, in its plane: positive toward the back (a curve running forward).
        const dn = py * g.dz - pz * g.dy;
        const d = Math.abs(dx / rx) ** n + Math.abs(dn / rn) ** n + (over ? (over / cap) ** n : 0);
        if (d > 1) continue;
        if (!best || d < best.d) best = { d, s: g.s0 + t * g.len + (t === 0 ? -over : over), v: dn / rn, u: dx / rx };
      }
      if (!best) return;
      if (opts.clip && !opts.clip(p)) return;
      const c = f({ ...best, d: best.d ** (1 / n), p, i, j, k });
      if (c && memo) for (const ii of opts.mirror ? [i, -1 - i] : [i]) memo.set(cellKey(ii, j, k), best.s);
      return c;
    }, opts);
  }
  /**
   * A shape lofted along z through sections [{ z, y: [bottom, top], w (half-width), x (its
   * middle, default 0) }]: each cross-section a rounded rectangle (`power` 2 an ellipse, more
   * boxier). Skulls, snouts, beaks, crests. `colour(p, { v (-1 bottom, 1 top), u, f (0..1 along) })`.
   */
  loft(part, sections, colour, opts = {}) {
    const f = typeof colour === 'function' ? colour : () => colour;
    const n = opts.power ?? 4;
    const S = sections;
    const lo = [Math.min(...S.map((q) => (q.x ?? 0) - q.w)), Math.min(...S.map((q) => q.y[0])), S[0].z];
    const hi = [Math.max(...S.map((q) => (q.x ?? 0) + q.w)), Math.max(...S.map((q) => q.y[1])), S[S.length - 1].z];
    this.fill(part, lo, hi, (p, i, j, k) => {
      if (p[2] < S[0].z || p[2] > S[S.length - 1].z) return;
      let a = 0;
      while (a < S.length - 2 && p[2] > S[a + 1].z) a++;
      const A = S[a], B = S[a + 1];
      let t = (p[2] - A.z) / (B.z - A.z || 1);
      if (opts.ease) t = t * t * (3 - 2 * t);
      const yb = lerp(A.y[0], B.y[0], t), yt = lerp(A.y[1], B.y[1], t), w = lerp(A.w, B.w, t), x = lerp(A.x ?? 0, B.x ?? 0, t);
      const hh = (yt - yb) / 2;
      if (hh <= 0 || w <= 0) return;
      const u = (p[0] - x) / w, v = (p[1] - (yb + yt) / 2) / hh;
      if (Math.abs(u) ** n + Math.abs(v) ** n > 1) return;
      if (opts.clip && !opts.clip(p)) return;
      return f(p, { u, v, f: (p[2] - S[0].z) / (S[S.length - 1].z - S[0].z), i, j, k });
    }, opts);
  }
  /**
   * A capsule between two points, its radius running from `ra` to `rb`, round at both ends;
   * `flat` squashes it in y (a toe on the ground). `colour(p, t)`: t from 0 at `a` to 1 at `b`.
   */
  capsule(part, a, b, ra, rb, colour, opts = {}) {
    const f = typeof colour === 'function' ? colour : () => colour;
    const flat = opts.flat ?? 1;
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1e-9;
    const R = Math.max(ra, rb);
    this.fill(part, a.map((x, k) => Math.min(x, b[k]) - R), a.map((x, k) => Math.max(x, b[k]) + R), (p, i, j, k) => {
      const t = clamp(((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / len2, 0, 1);
      const r = lerp(ra, rb, t);
      const q = [p[0] - a[0] - d[0] * t, (p[1] - a[1] - d[1] * t) / flat, p[2] - a[2] - d[2] * t];
      if (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] > r * r) return;
      if (opts.clip && !opts.clip(p)) return;
      return f(p, t, i, j, k);
    }, opts);
  }
  /** Copy a part to the other side (x to -x) under another name. */
  mirrorPart(from, to) {
    const src = this.vox.parts.get(from);
    const dst = this.vox.part(to);
    for (const [key, c] of src) {
      const [i, j, k] = cellOf(key);
      dst.set(cellKey(-1 - i, j, k), c);
    }
  }
  /**
   * Cut a part painted `along` a curve into a chain of parts at places along it: `cuts` is [{ part,
   * to }] in order (each part runs from the last one's `to` to its own; the last needs none). Each
   * part also takes its neighbours' cells within `reach` metres of the cut that lie under the
   * skin (every side covered), so the two overlap in a core that fills the bend.
   */
  splitChain(from, cuts, reach) {
    const src = this.vox.parts.get(from);
    const along = this.along.get(from);
    this.vox.parts.delete(from);
    const inner = (key) => [1, -1, 1024, -1024, 1048576, -1048576].every((d) => src.has(key + d));
    const bounds = cuts.map((c) => c.to ?? Infinity);
    for (const [key, colour] of src) {
      const s = along.get(key);
      if (s === undefined) throw new Error(`splitChain: a cell of ${from} painted without its place`);
      const n = bounds.findIndex((b) => s < b);
      this.vox.part(cuts[n].part).set(key, colour);
      if (!inner(key)) continue;
      const r = typeof reach === 'function' ? reach : () => reach;
      if (n > 0 && s - bounds[n - 1] < r(n - 1)) this.vox.part(cuts[n - 1].part).set(key, colour);
      if (n < cuts.length - 1 && bounds[n] - s < r(n)) this.vox.part(cuts[n + 1].part).set(key, colour);
    }
  }
  /** Set single voxels by hand (metres), mirrored: an eye, a nostril, a claw. */
  dot(part, p, colour, { mirror = true, size = [1, 1, 1] } = {}) {
    const v = this.vpm;
    const [i, j, k] = p.map((x) => Math.floor(x * v));
    for (let a = 0; a < size[0]; a++)
      for (let b = 0; b < size[1]; b++)
        for (let c = 0; c < size[2]; c++)
          for (const ii of mirror ? [i + a, -1 - i - a] : [i + a]) this.vox.set(part, ii, j + b, k + c, colour);
  }
  /** Every cell of the model: [min, max] corners in metres. */
  bounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const cells of this.vox.parts.values())
      for (const key of cells.keys()) {
        const c = cellOf(key);
        for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], c[a])), (hi[a] = Math.max(hi[a], c[a] + 1));
      }
    return [lo.map((x) => x / this.vpm), hi.map((x) => x / this.vpm)];
  }
}
export { cellKey, cellOf };
