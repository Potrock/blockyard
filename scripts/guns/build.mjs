#!/usr/bin/env node
/**
 * Call of Blocky: the weapon models, built from boxes and written as binary glTF 2.0 (`.glb`) to
 * `src/games/callofblocky/models/`. Dependency-free (Node 22+): `node scripts/guns/build.mjs`.
 * Each file is parsed back and checked after it's written (chunks, JSON, accessor bounds, markers).
 *
 * Conventions (the game's code relies on these exactly):
 *
 * - Units: 1 glTF unit = 1 block = 16 pixels. Every box is authored in pixels, Blockbench style
 *   (sizes and positions on the 1/16 grid; half pixels only where an odd-width part centres on
 *   x = 0), and divided by 16 when written. Boxes are axis-aligned; a few turn about one axis (a
 *   raked pistol grip, a stock's drop), Blockbench style, about a pivot.
 * - Orientation: the barrel runs along +z (the muzzle is the +z end), +y is up. The gun's right
 *   side (ejection port, bolt handle) is -x; its left side (the thumb's side) is +x.
 * - Origin (0,0,0): the centre of the firing hand's fist around the pistol grip (= `grip`).
 * - Sizes (overall length along z, pixels): pistol 12, SMG 17, rifle 28, shotgun 29.5, sniper 33,
 *   katana 30 (blade 21 with its collar, handle 8 with the pommel, guard 1). Receivers are 2-3 px
 *   wide and 3-4 tall. Grips are 2 px wide and 5 tall, raked 15 degrees (the shotgun's wrist 25,
 *   the sniper's 18), sized for the platform's 4x4 px blocky fist.
 * - Marker nodes: empty nodes (no mesh), children of the root, their translation in blocks:
 *   - `grip`: the centre of the firing fist on the pistol grip (the origin).
 *   - `grip2`: where the support hand holds, on the underside of the handguard / pump / forend
 *     (the SMG: its hand strap; the pistol: below and in front of the grip, the cupping hand).
 *   - `muzzle`: the centre of the barrel tip (flashes and tracers start here).
 *   - `sight`: the eye point when aiming down sights. On the pistol, SMG, rifle and shotgun it is
 *     the centre of the optic's open window (a red dot or holo) at the optic's rear face: the
 *     window holds no geometry and nothing stands in front of it along +z (the platform draws the
 *     reticle), and the iron sights are gone or low enough to stay out of the view through it.
 *     On the sniper, the centre of the scope's rear lens.
 *   - `mag`: the centre of the magazine (reloads send the support hand here): the pistol's is its
 *     base plate below the grip (the rest is inside it); the shotgun's is its loading port under
 *     the receiver. The katana has none; its `grip` is the rear hand on the handle and `grip2` the
 *     front hand, and its blade runs along +z with the edge facing +y.
 * - The briefcase (a pickup, not a weapon) has no markers: its origin is the centre of its bottom
 *   face, +y up, its front (latches, the lid) toward +z; about 10 x 7 x 3 px, the handle on top.
 * - One material per file: the engine merges a held model's meshes and uses only the first
 *   material's `baseColorTexture` and `emissiveTexture` (factors are ignored). So all boxes map into
 *   one embedded PNG atlas, sampled NEAREST (9728), and one emissive PNG of the same layout: black,
 *   except glowing texels in grey/white (the engine glows the albedo by the emissive's red channel).
 * - Texturing: 1 texel per model pixel. Every visible box face gets its own w x h region of the
 *   atlas (with a 1-texel gutter), painted from its material: pixel-art shading (mottle, grain,
 *   brushed streaks, a lighter top edge and darker bottom edge), plus per-part details (slide
 *   serrations, ejection ports, ribs, checkering, the hamon, the diamond wrap...).
 * - Geometry: one merged mesh per gun, 24 vertices per box (flat normals, per-face UVs);
 *   POSITION (with min/max), NORMAL, TEXCOORD_0, indices. Faces fully covered by a neighbour are
 *   left out. Node tree: root (named after the gun's id) > [mesh node, marker nodes].
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../src/games/callofblocky/models');

// ---------------------------------------------------------------------------------------------
// Colour and noise

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const add = (c, k) => c.map((v) => v + k);
const mul = (c, k) => c.map((v) => v * k);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** A colour ramp: stops [[t, '#rrggbb'], ...] sampled at t. */
function ramp(t, stops) {
  if (t <= stops[0][0]) return hex(stops[0][1]);
  for (let k = 1; k < stops.length; k++) {
    if (t <= stops[k][0]) {
      const [t0, c0] = stops[k - 1];
      const [t1, c1] = stops[k];
      return mix(hex(c0), hex(c1), (t - t0) / (t1 - t0));
    }
  }
  return hex(stops[stops.length - 1][1]);
}

/** A hash of integers to [0, 1). */
function hash(a, b = 0, c = 0, d = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + 0x5bd1e995, 0x9e3779b1) ^ Math.imul((d | 0) + 0x1b873593, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
/** Smooth value noise in 3D, [0, 1). */
function vnoise(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = smooth(x - xi), fy = smooth(y - yi), fz = smooth(z - zi);
  let v = 0;
  for (let dz = 0; dz < 2; dz++)
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (dz ? fz : 1 - fz);
        v += w * hash(xi + dx, yi + dy, zi + dz, seed);
      }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Materials: each paints one texel of a face from its context and returns [r, g, b] (0..255).
// ctx: { face: '+x'|'-x'|'+y'|'-y'|'+z'|'-z', i, j (texel; j = 0 is the face's top row for the
// sides), tw, th (face size in texels), p (local position of the texel centre, pixels), w (model
// position after the box's turn), box, glow (set 0..1 to make it glow) }.

const SIDE = { '+x': 1, '-x': 1, '+z': 1, '-z': 1 };
const onSide = (ctx) => ctx.face === '+x' || ctx.face === '-x';
/** A per-texel random number from its model position (and a salt). */
const rnd = (ctx, salt = 0) => hash(Math.round(ctx.w[0] * 4), Math.round(ctx.w[1] * 4), Math.round(ctx.w[2] * 4), salt * 7919 + (SIDE[ctx.face] ? 0 : 131));
/** Along the box's longest side, and the two across it (local pixels). */
function axes(ctx) {
  const s = ctx.box.size;
  const k = s[0] >= s[1] && s[0] >= s[2] ? 0 : s[1] >= s[2] ? 1 : 2;
  return { along: ctx.p[k], a: ctx.p[(k + 1) % 3], b: ctx.p[(k + 2) % 3], k };
}
/** Is this face an end of the box (across its longest side)? */
function endFace(ctx) {
  const k = axes(ctx).k;
  return ctx.face[1] === 'xyz'[k];
}

/** Pixel-art bevel: a lighter top row (and ends), a darker bottom row on the sides; top faces lit round the rim. */
function bevel(ctx, c, k = 18, dark = 0.78) {
  const { face, i, j, tw, th } = ctx;
  if (ctx.box.flat) return c;
  if (face === '+y') {
    if ((th >= 3 && (j === 0 || j === th - 1)) || (tw >= 3 && (i === 0 || i === tw - 1))) return add(c, k * 0.7);
    return c;
  }
  if (face === '-y') return mul(c, 0.86);
  if (th >= 2 && j === 0) return add(c, k);
  if (th >= 2 && j === th - 1) return mul(c, dark);
  if (tw >= 3 && (i === 0 || i === tw - 1)) return add(c, k * 0.35);
  return c;
}

/** A plain material: a base colour, texel noise, the bevel. */
const plain = (base, { noise = 6, edge = 18, dark = 0.78, top = 0, bottom = 0 } = {}) => (ctx) => {
  let c = hex(base);
  if (ctx.face === '+y') c = add(c, top);
  if (ctx.face === '-y') c = add(c, bottom);
  c = add(c, (rnd(ctx) - 0.5) * 2 * noise);
  return bevel(ctx, c, edge, dark);
};

/** Metal brushed along its longest side: streaks that run the length of the part. */
const brushed = (base, { streak = 10, noise = 3, edge = 22, dark = 0.72, top = 8 } = {}) => (ctx) => {
  const { a, b } = axes(ctx);
  let c = hex(base);
  if (ctx.face === '+y') c = add(c, top);
  if (!endFace(ctx)) c = add(c, (hash(Math.round(a * 2), Math.round(b * 2), 17) - 0.5) * 2 * streak);
  c = add(c, (rnd(ctx) - 0.5) * 2 * noise);
  return bevel(ctx, c, edge, dark);
};

/** Polished chrome: a bright sky, a dark horizon band, the ground's glow, and sparkles. */
function chrome(ctx) {
  let c;
  if (ctx.face === '+y') c = mix(hex('#dfe6ee'), hex('#ffffff'), hash(Math.round(ctx.p[0] * 2), 3) * 0.7);
  else if (ctx.face === '-y') c = hex('#747c86');
  else if (endFace(ctx)) c = ramp((ctx.j + 0.5) / ctx.th, [[0, '#e6ebf0'], [0.5, '#9aa3ad'], [1, '#7d858f']]);
  else c = ramp((ctx.j + 0.5) / ctx.th, [[0, '#ffffff'], [0.22, '#e3e8ee'], [0.48, '#8c95a0'], [0.62, '#555c66'], [0.82, '#a3acb6'], [1, '#c9d0d8']]);
  c = add(c, (rnd(ctx) - 0.5) * 8);
  if (rnd(ctx, 5) > 0.975) c = hex('#ffffff');
  return bevel(ctx, c, 8, 0.85);
}

/** Mother-of-pearl: cream with soft pink and blue lights. */
function pearl(ctx) {
  const [x, y, z] = ctx.w;
  const n1 = vnoise(x * 0.9, y * 0.9, z * 0.9, 11);
  const n2 = vnoise(x * 1.3 + 7, y * 1.3, z * 1.3, 12);
  let c = hex('#f2ebdc');
  c = mix(c, hex('#f9d9e2'), clamp01((n1 - 0.45) * 2.2));
  c = mix(c, hex('#d6e6f2'), clamp01((n2 - 0.5) * 2.2));
  c = add(c, (rnd(ctx) - 0.5) * 8);
  return bevel(ctx, c, 6, 0.86);
}

/** Polished gold: bright top, warm middle, deep bottom. */
function gold(ctx) {
  let c;
  if (ctx.face === '+y') c = hex('#ffe486');
  else if (ctx.face === '-y') c = hex('#a8741f');
  else c = ramp((ctx.j + 0.5) / ctx.th, [[0, '#fff3b0'], [0.35, '#f1c24a'], [0.7, '#d19a2c'], [1, '#9c6619']]);
  c = add(c, (rnd(ctx) - 0.5) * 10);
  if (rnd(ctx, 3) > 0.96) c = hex('#fff8d8');
  return bevel(ctx, c, 10, 0.85);
}

/** Brass: like gold, a little browner. */
function brass(ctx) {
  let c;
  if (ctx.face === '+y') c = hex('#f0c566');
  else if (ctx.face === '-y') c = hex('#8a5c1c');
  else c = ramp((ctx.j + 0.5) / ctx.th, [[0, '#f7d98a'], [0.4, '#d9a441'], [1, '#98631d']]);
  c = add(c, (rnd(ctx) - 0.5) * 10);
  return bevel(ctx, c, 10, 0.85);
}

/** Wood: grain along the part, darker streaks, a varnish glint; end grain darker. */
const wood = (pal) => (ctx) => {
  const { along, a, b } = axes(ctx);
  let c;
  if (endFace(ctx)) {
    const r = Math.sqrt(a * a + b * b);
    c = mix(hex(pal.dark), hex(pal.base), 0.5 + 0.5 * Math.sin(r * 3.1 + vnoise(a, b, 0, 5) * 3));
  } else {
    const g = Math.sin((a * 1.1 + b * 0.8) * 2.1 + vnoise(along * 0.22, a * 0.4, b * 0.4, pal.seed ?? 3) * 6.5);
    c = hex(pal.base);
    if (g > 0.62) c = hex(pal.dark);
    else if (g > 0.25) c = mix(hex(pal.base), hex(pal.dark), 0.45);
    else if (g < -0.8) c = hex(pal.light);
    c = add(c, (rnd(ctx) - 0.5) * 7);
  }
  return bevel(ctx, c, pal.edge ?? 16, 0.76);
};
const AK_WOOD = { base: '#b8642c', dark: '#7c3a17', light: '#d98543', seed: 3 };
const WALNUT = { base: '#6e4024', dark: '#46240f', light: '#8c5733', seed: 9, edge: 14 };

/** Rubber and checkered grips: a fine diamond of light and dark. */
const checker = (base, k = 9) => (ctx) => {
  let c = hex(base);
  c = add(c, (ctx.i + ctx.j) % 2 ? k : -k * 0.6);
  c = add(c, (rnd(ctx) - 0.5) * 5);
  return bevel(ctx, c, 10, 0.85);
};

/** Grip tape: loud colour with grit. */
const tape = (base) => (ctx) => {
  let c = hex(base);
  const r = rnd(ctx, 9);
  c = add(c, (r - 0.5) * 36);
  if (r > 0.9) c = mix(c, hex('#301020'), 0.45);
  return bevel(ctx, c, 12, 0.8);
};

/** Glossy lacquer paint: a bright top rim and a hot highlight on the sides. */
const gloss = (base, hi, lo) => (ctx) => {
  let c;
  if (ctx.face === '+y') c = mix(hex(base), hex(hi), 0.45);
  else if (ctx.face === '-y') c = hex(lo);
  else c = ramp((ctx.j + 0.5) / ctx.th, [[0, hi], [0.4, base], [1, lo]]);
  c = add(c, (rnd(ctx) - 0.5) * 6);
  if (rnd(ctx, 4) > 0.97) c = mix(c, hex('#ffffff'), 0.5);
  return bevel(ctx, c, 12, 0.85);
};

/** A texel that glows (tritium dots, lenses): its albedo is the glow's colour. */
const glow = (base, amount = 1) => (ctx) => {
  ctx.glow = amount;
  return add(hex(base), (rnd(ctx) - 0.5) * 6);
};

/** The bore: nearly black. */
const bore = () => hex('#0b0b0d');

/**
 * Mirror-polished blade steel. The side's upper row (toward the edge, +y) is the frosted white
 * hardened edge; the lower row is the dark mirror body with reflection bands; the hamon dips from
 * the edge into the body in waves. The edge itself (+y face) is bright, the spine (-y) dark.
 */
function blade(ctx) {
  const { face, j, th } = ctx;
  const z = ctx.w[2];
  if (face === '+y') return add(hex('#ffffff'), -rnd(ctx) * 18);
  if (face === '-y') return add(hex('#5f6b79'), (rnd(ctx) - 0.5) * 10);
  if (face === '+z' || face === '-z') return hex('#b4bfcb');
  if (j === 0) return mix(hex('#e8eef4'), hex('#ffffff'), rnd(ctx, 2) * 0.7); // the hardened edge
  const dip = Math.sin(z * 1.7) + Math.sin(z * 0.63 + 2) * 0.7 > 0.85; // the hamon's waves
  if (dip) return mix(hex('#f3f7fa'), hex('#dfe7ee'), rnd(ctx, 3));
  let c = mix(hex('#56637a'), hex('#9eabbb'), vnoise(z * 0.4, 0, 0, 23)); // the body, reflecting
  if (rnd(ctx, 6) > 0.92) c = add(c, 55);
  return c;
}

/**
 * Tsuka-ito: yellow silk wrap. On the handle's flat sides a row of black diamonds (the same
 * showing through) with shadowed points; the silk crosses between them, brightest at the crossing.
 */
function wrap(ctx) {
  const along = Math.floor(ctx.w[2] + 64); // integer column along the handle
  const m = along % 4; // 0: the crossing, 1..3: a diamond
  const across = onSide(ctx) ? ctx.j : ctx.i;
  const tall = onSide(ctx) && ctx.th >= 3;
  if (tall && m !== 0 && across === (ctx.th - 1) / 2) return add(hex('#141210'), (rnd(ctx) - 0.5) * 6);
  if (tall && m === 2) return add(hex('#9a6400'), (rnd(ctx) - 0.5) * 6);
  if (!tall && m === 2) return add(hex('#8a5a00'), (rnd(ctx) - 0.5) * 8);
  let c = m === 0 ? hex('#ffe066') : hex('#ffc81a');
  if (m === 1 || m === 3) c = mix(c, hex('#d08c00'), 0.45);
  if ((along + across) % 2) c = mix(c, hex('#e0a000'), 0.2);
  return add(c, (rnd(ctx) - 0.5) * 8);
}

/** Black leather: a soft grain, a sheen along the top edges. */
function leather(ctx) {
  const [x, y, z] = ctx.w;
  let c = hex('#1f1c1e');
  c = add(c, (vnoise(x * 1.7, y * 1.7, z * 1.7, 31) - 0.5) * 16 + (rnd(ctx) - 0.5) * 6);
  if (ctx.face === '+y') c = add(c, 12);
  return bevel(ctx, c, 26, 0.8);
}

/** What's in the briefcase: molten gold light, brightest high in the middle, with sparkles. It glows. */
function golden(ctx) {
  const [x, y] = ctx.w;
  const t = clamp01(1 - Math.abs(x) / 5.5) * 0.6 + clamp01((y - 1) / 6.5) * 0.4;
  let c = mix(hex('#ff9a1a'), hex('#fff3a8'), t);
  if (rnd(ctx, 8) > 0.88) c = mix(c, hex('#ffffff'), 0.6);
  ctx.glow = 0.8 + 0.2 * t;
  return c;
}

const M = {
  steel: brushed('#454b55'),
  darksteel: brushed('#34383f', { streak: 8, edge: 20 }),
  blued: brushed('#2d3440', { streak: 8, edge: 22 }),
  parker: plain('#2c2e32', { noise: 5, edge: 16 }),
  polymer: plain('#222327', { noise: 4, edge: 13 }),
  chrome,
  pearl,
  gold,
  brass,
  akwood: wood(AK_WOOD),
  walnut: wood(WALNUT),
  checker: checker('#3a3f47', 10),
  rubber: checker('#252526', 6),
  pinktape: tape('#ff2f92'),
  pink: gloss('#ff2f92', '#ff8cc6', '#b0115f'),
  teal: gloss('#16c6b6', '#7ff2e6', '#0b7c73'),
  cherry: gloss('#d4162f', '#ff7070', '#7e0b1a'),
  yellow: gloss('#ffd21a', '#fff1a0', '#c79400'),
  black: plain('#18181a', { noise: 4, edge: 14 }),
  lacquer: gloss('#1a1a1c', '#4a4a50', '#0c0c0d'),
  olive: plain('#3d4331', { noise: 6, edge: 14 }),
  olivedark: plain('#2c3124', { noise: 5, edge: 12 }),
  tritium: glow('#c6ff3d', 1),
  bore,
  blade,
  wrap,
  leather,
  golden,
};

// ---------------------------------------------------------------------------------------------
// Models: boxes in pixels, markers, per-part paint.

class Gun {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.boxes = [];
    this.markers = {};
    this.decals = [];
  }
  /**
   * A box from `a` to `b` (pixels) of material `mat` (a key of M, or a function).
   * o.rot: [axis, degrees, pivot] turns it (right-handed about the axis); o.faces: per-face
   * materials ({ '+x': 'pearl' }); o.paint(ctx, colour) → colour for details; o.hide: faces left out.
   */
  box(a, b, mat, o = {}) {
    const from = a.map((v, k) => Math.min(v, b[k]));
    const to = a.map((v, k) => Math.max(v, b[k]));
    this.boxes.push({ from, to, size: to.map((v, k) => v - from[k]), mat, ...o });
    return this;
  }
  /** Mirror of a box in x (for pairs). */
  pair(a, b, mat, o = {}) {
    this.box(a, b, mat, o);
    this.box([-a[0], a[1], a[2]], [-b[0], b[1], b[2]], mat, o);
    return this;
  }
  mark(name, p) {
    this.markers[name] = p;
    return this;
  }
  /** Paint on every face, by model position: fn(ctx, colour) → colour | undefined. */
  decal(fn) {
    this.decals.push(fn);
    return this;
  }
}

const DEG = Math.PI / 180;
/** Turn a point about one axis through a pivot (right-handed, degrees). */
function turnOne([axis, deg, o = [0, 0, 0]], p) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  const [x, y, z] = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
  if (axis === 'x') return [o[0] + x, o[1] + y * c - z * s, o[2] + y * s + z * c];
  if (axis === 'y') return [o[0] + z * s + x * c, o[1] + y, o[2] + z * c - x * s];
  return [o[0] + x * c - y * s, o[1] + x * s + y * c, o[2] + z];
}
/** A box's placement: `rot` (one [axis, degrees, pivot] or a list, applied in order), then `move`. */
function place(box, p) {
  const rots = !box.rot ? [] : Array.isArray(box.rot[0]) ? box.rot : [box.rot];
  for (const r of rots) p = turnOne(r, p);
  return box.move ? p.map((v, k) => v + box.move[k]) : p;
}
function placeNormal(box, n) {
  const rots = !box.rot ? [] : Array.isArray(box.rot[0]) ? box.rot : [box.rot];
  for (const [axis, deg] of rots) n = turnOne([axis, deg, [0, 0, 0]], n);
  return n;
}
/** A point turned like a box with this `rot` (for markers on turned parts). */
const turn = (rot, p) => place({ rot }, p);

/** Face frames: the top-left corner, the u (right) and v (down) directions, as seen from outside. */
function faces(from, to) {
  const [x0, y0, z0] = from, [x1, y1, z1] = to;
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  return [
    { name: '+x', n: [1, 0, 0], o: [x1, y1, z1], u: [0, 0, -1], v: [0, -1, 0], W: dz, H: dy },
    { name: '-x', n: [-1, 0, 0], o: [x0, y1, z0], u: [0, 0, 1], v: [0, -1, 0], W: dz, H: dy },
    { name: '+y', n: [0, 1, 0], o: [x0, y1, z0], u: [1, 0, 0], v: [0, 0, 1], W: dx, H: dz },
    { name: '-y', n: [0, -1, 0], o: [x0, y0, z1], u: [1, 0, 0], v: [0, 0, -1], W: dx, H: dz },
    { name: '+z', n: [0, 0, 1], o: [x0, y1, z1], u: [1, 0, 0], v: [0, -1, 0], W: dx, H: dy },
    { name: '-z', n: [0, 0, -1], o: [x1, y1, z0], u: [-1, 0, 0], v: [0, -1, 0], W: dx, H: dy },
  ];
}

const sameRot = (a, b) => JSON.stringify([a.rot ?? null, a.move ?? null]) === JSON.stringify([b.rot ?? null, b.move ?? null]);
const EPS = 1e-6;

/** Is this face completely inside or against another box (in the same frame) on its outside? */
function covered(box, f, boxes) {
  const k = f.n.findIndex((v) => v !== 0);
  const plane = f.n[k] > 0 ? box.to[k] : box.from[k];
  const [p, q] = [0, 1, 2].filter((m) => m !== k);
  return boxes.some((o) => {
    if (o === box || !sameRot(o, box)) return false;
    const outward = f.n[k] > 0 ? o.from[k] <= plane + EPS && o.to[k] > plane + EPS : o.to[k] >= plane - EPS && o.from[k] < plane - EPS;
    return outward && o.from[p] <= box.from[p] + EPS && o.to[p] >= box.to[p] - EPS && o.from[q] <= box.from[q] + EPS && o.to[q] >= box.to[q] - EPS;
  });
}

/** Warnings: faces sharing a plane with another visible face (z-fighting), and hidden overlap. */
function lint(gun, visible) {
  const warn = [];
  for (let m = 0; m < visible.length; m++)
    for (let n = m + 1; n < visible.length; n++) {
      const A = visible[m], B = visible[n];
      if (A.box === B.box || !sameRot(A.box, B.box) || A.f.name !== B.f.name) continue;
      const k = A.f.n.findIndex((v) => v !== 0);
      const pa = A.f.n[k] > 0 ? A.box.to[k] : A.box.from[k];
      const pb = B.f.n[k] > 0 ? B.box.to[k] : B.box.from[k];
      if (Math.abs(pa - pb) > EPS) continue;
      const [p, q] = [0, 1, 2].filter((x) => x !== k);
      const op = Math.min(A.box.to[p], B.box.to[p]) - Math.max(A.box.from[p], B.box.from[p]);
      const oq = Math.min(A.box.to[q], B.box.to[q]) - Math.max(A.box.from[q], B.box.from[q]);
      if (op > EPS && oq > EPS) warn.push(`z-fight: ${A.f.name} of box ${gun.boxes.indexOf(A.box)} and ${gun.boxes.indexOf(B.box)}`);
    }
  let overlap = 0;
  for (let m = 0; m < gun.boxes.length; m++)
    for (let n = m + 1; n < gun.boxes.length; n++) {
      const A = gun.boxes[m], B = gun.boxes[n];
      if (!sameRot(A, B)) continue;
      const v = [0, 1, 2].reduce((acc, k) => acc * Math.max(0, Math.min(A.to[k], B.to[k]) - Math.max(A.from[k], B.from[k])), 1);
      overlap += v;
    }
  return { warn, overlap };
}

/**
 * An optic's window must be open: no box inside it from its rear face on (along +z), and from an
 * eye 16 px behind the sight (about where the platform holds it when aiming), nothing beyond the
 * optic's front shows through its front opening. Returns what's in the way.
 */
function clearView(gun) {
  const win = gun.window;
  if (!win) return [];
  const bad = [];
  const eye = [0, (win.y0 + win.y1) / 2, win.z0 - 16];
  gun.boxes.forEach((box, k) => {
    const corners = [];
    for (const x of [box.from[0], box.to[0]]) for (const y of [box.from[1], box.to[1]]) for (const z of [box.from[2], box.to[2]]) corners.push(place(box, [x, y, z]));
    const lo = [0, 1, 2].map((m) => Math.min(...corners.map((c) => c[m])));
    const hi = [0, 1, 2].map((m) => Math.max(...corners.map((c) => c[m])));
    const inside = lo[0] < win.x1 - EPS && hi[0] > win.x0 + EPS && lo[1] < win.y1 - EPS && hi[1] > win.y0 + EPS && hi[2] > win.z0 + EPS;
    if (inside) return bad.push(`box ${k} is in the window`);
    if (hi[2] <= win.z1) return;
    // Beyond the front: seen from the eye, does it cover any of the front opening?
    const zs = Math.max(lo[2], win.z1);
    const pts = corners.map((c) => [c[0], c[1], Math.max(c[2], zs)]).map((c) => {
      const t = (win.z1 - eye[2]) / (c[2] - eye[2]);
      return [eye[0] + (c[0] - eye[0]) * t, eye[1] + (c[1] - eye[1]) * t];
    });
    const px = pts.map((p) => p[0]), py = pts.map((p) => p[1]);
    if (Math.min(...px) < win.x1 - EPS && Math.max(...px) > win.x0 + EPS && Math.min(...py) < win.y1 - EPS && Math.max(...py) > win.y0 + EPS) bad.push(`box ${k} shows through the window`);
  });
  return bad;
}

// ---------------------------------------------------------------------------------------------
// Atlas packing and painting

/** Shelf-pack rects (with a 1-texel gutter) into the smallest power-of-two atlas that fits. */
function pack(rects) {
  const order = [...rects].sort((a, b) => b.th - a.th || b.tw - a.tw);
  for (const [W, H] of [[64, 64], [128, 64], [128, 128], [256, 128], [256, 256], [512, 256], [512, 512]]) {
    let x = 0, y = 0, shelf = 0, ok = true;
    for (const r of order) {
      const w = r.tw + 2, h = r.th + 2;
      if (x + w > W) {
        y += shelf;
        x = 0;
        shelf = 0;
      }
      if (y + h > H || w > W) {
        ok = false;
        break;
      }
      r.x = x + 1;
      r.y = y + 1;
      x += w;
      shelf = Math.max(shelf, h);
    }
    if (ok) return { W, H };
  }
  throw new Error('atlas too big');
}

class Image {
  constructor(w, h, fill = [0, 0, 0, 255]) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
    for (let k = 0; k < w * h; k++) this.data.set(fill, k * 4);
  }
  set(x, y, c, a = 255) {
    const o = (y * this.w + x) * 4;
    this.data[o] = Math.max(0, Math.min(255, Math.round(c[0])));
    this.data[o + 1] = Math.max(0, Math.min(255, Math.round(c[1])));
    this.data[o + 2] = Math.max(0, Math.min(255, Math.round(c[2])));
    this.data[o + 3] = a;
  }
  copy(sx, sy, dx, dy) {
    if (dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) return;
    const s = (sy * this.w + sx) * 4, d = (dy * this.w + dx) * 4;
    for (let k = 0; k < 4; k++) this.data[d + k] = this.data[s + k];
  }
  /** Repeat a rect's border into its gutter (so edge samples never bleed). */
  gutter(r) {
    const { x, y, tw, th } = r;
    for (let i = 0; i < tw; i++) {
      this.copy(x + i, y, x + i, y - 1);
      this.copy(x + i, y + th - 1, x + i, y + th);
    }
    for (let j = -1; j <= th; j++) {
      const sj = Math.max(0, Math.min(th - 1, j));
      this.copy(x, y + sj, x - 1, y + j);
      this.copy(x + tw - 1, y + sj, x + tw, y + j);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// PNG (RGBA, 8 bit, filter 0) and GLB writing

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function png(img) {
  const { w, h, data } = img;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw, { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Build one gun: faces, atlas, mesh, GLB bytes. */
function build(gun) {
  // Visible faces.
  const visible = [];
  for (const box of gun.boxes)
    for (const f of faces(box.from, box.to)) {
      if (box.hide?.includes(f.name)) continue;
      if (f.W < EPS || f.H < EPS) continue;
      if (covered(box, f, gun.boxes)) continue;
      visible.push({ box, f, tw: Math.max(1, Math.round(f.W)), th: Math.max(1, Math.round(f.H)) });
    }
  const { warn, overlap } = lint(gun, visible);
  const { W, H } = pack(visible);
  const albedo = new Image(W, H, [0, 0, 0, 0]);
  const emissive = new Image(W, H);

  // Paint every face texel by texel.
  for (const v of visible) {
    const { box, f, tw, th } = v;
    for (let j = 0; j < th; j++)
      for (let i = 0; i < tw; i++) {
        const su = ((i + 0.5) * f.W) / tw, sv = ((j + 0.5) * f.H) / th;
        const p = [0, 1, 2].map((k) => f.o[k] + f.u[k] * su + f.v[k] * sv);
        const ctx = { face: f.name, i, j, tw, th, p, w: place(box, p), box, glow: 0, gun };
        const matName = box.faces?.[f.name] ?? box.mat;
        const mat = typeof matName === 'function' ? matName : M[matName];
        if (!mat) throw new Error(`${gun.id}: no material ${matName}`);
        let c = mat(ctx);
        if (box.paint) c = box.paint(ctx, c) ?? c;
        for (const d of gun.decals) c = d(ctx, c) ?? c;
        albedo.set(v.x + i, v.y + j, c);
        const g = Math.round(clamp01(ctx.glow) * 255);
        emissive.set(v.x + i, v.y + j, [g, g, g]);
      }
    albedo.gutter(v);
    emissive.gutter(v);
  }

  // Geometry: 4 vertices per face, two triangles, counter-clockwise from outside.
  const pos = [], nrm = [], uv = [], idx = [];
  for (const v of visible) {
    const { box, f } = v;
    const corners = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const base = pos.length / 3;
    const n = placeNormal(box, f.n);
    for (const [cu, cv] of corners) {
      const p = [0, 1, 2].map((k) => f.o[k] + f.u[k] * f.W * cu + f.v[k] * f.H * cv);
      const w = place(box, p);
      pos.push(w[0] / 16, w[1] / 16, w[2] / 16);
      nrm.push(...n);
      uv.push((v.x + cu * v.tw) / W, (v.y + cv * v.th) / H);
    }
    idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  return { visible, warn, overlap, W, H, albedo, emissive, pos, nrm, uv, idx };
}

function glb(gun, b) {
  const chunks = [];
  let offset = 0;
  const views = [];
  const addView = (buf, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    offset += buf.length;
    return views.length - 1;
  };
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
  const vcount = b.pos.length / 3;
  const big = vcount > 65535;
  const posView = addView(f32(b.pos), 34962);
  const nrmView = addView(f32(b.nrm), 34962);
  const uvView = addView(f32(b.uv), 34962);
  const idxView = addView(Buffer.from((big ? new Uint32Array(b.idx) : new Uint16Array(b.idx)).buffer), 34963);
  const albedoPng = png(b.albedo), emissivePng = png(b.emissive);
  const imgA = addView(albedoPng), imgE = addView(emissivePng);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < b.pos.length; k++) {
    min[k % 3] = Math.min(min[k % 3], Math.fround(b.pos[k]));
    max[k % 3] = Math.max(max[k % 3], Math.fround(b.pos[k]));
  }
  const markerNames = Object.keys(gun.markers);
  const json = {
    asset: { version: '2.0', generator: 'Call of Blocky scripts/guns/build.mjs' },
    scene: 0,
    scenes: [{ name: gun.id, nodes: [0] }],
    nodes: [
      { name: gun.id, children: [1, ...markerNames.map((_, k) => k + 2)], extras: { title: gun.name } },
      { name: `${gun.id}_body`, mesh: 0 },
      ...markerNames.map((m) => ({ name: m, translation: gun.markers[m].map((v) => v / 16) })),
    ],
    meshes: [{ name: `${gun.id}_body`, primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [
      {
        name: `${gun.id}_atlas`,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
        emissiveTexture: { index: 1 },
        emissiveFactor: [1, 1, 1],
      },
    ],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
    ],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [
      { name: `${gun.id}_albedo`, bufferView: imgA, mimeType: 'image/png' },
      { name: `${gun.id}_emissive`, bufferView: imgE, mimeType: 'image/png' },
    ],
    accessors: [
      { bufferView: posView, componentType: 5126, count: vcount, type: 'VEC3', min, max },
      { bufferView: nrmView, componentType: 5126, count: vcount, type: 'VEC3' },
      { bufferView: uvView, componentType: 5126, count: vcount, type: 'VEC2' },
      { bufferView: idxView, componentType: big ? 5125 : 5123, count: b.idx.length, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: 0 }],
  };
  const tail = (4 - (offset % 4)) % 4;
  if (tail) chunks.push(Buffer.alloc(tail));
  const bin = Buffer.concat(chunks);
  json.buffers[0].byteLength = bin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4); // 'BIN\0'
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

// ---------------------------------------------------------------------------------------------
// Validation: parse a GLB back and check it.

function validate(buf, gun) {
  const fail = (m) => {
    throw new Error(`${gun.id}.glb: ${m}`);
  };
  if (buf.readUInt32LE(0) !== 0x46546c67) fail('bad magic');
  if (buf.readUInt32LE(4) !== 2) fail('not version 2');
  if (buf.readUInt32LE(8) !== buf.length) fail('length mismatch');
  const jlen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a || jlen % 4) fail('bad JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const bo = 20 + jlen;
  const blen = buf.readUInt32LE(bo);
  if (buf.readUInt32LE(bo + 4) !== 0x004e4942 || blen % 4 || bo + 8 + blen !== buf.length) fail('bad BIN chunk');
  const bin = buf.subarray(bo + 8, bo + 8 + blen);
  if (json.asset?.version !== '2.0') fail('asset.version');
  if (json.buffers[0].byteLength !== blen) fail('buffer length');
  for (const v of json.bufferViews) if (v.byteOffset + v.byteLength > blen) fail('bufferView out of range');
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3 };
  const comp = { 5126: 4, 5123: 2, 5125: 4 };
  const read = (a) => {
    const v = json.bufferViews[a.bufferView];
    const n = a.count * size[a.type];
    if ((a.byteOffset ?? 0) + n * comp[a.componentType] > v.byteLength) fail('accessor out of range');
    const at = bin.byteOffset + v.byteOffset + (a.byteOffset ?? 0);
    const ab = bin.buffer.slice(at, at + n * comp[a.componentType]);
    return a.componentType === 5126 ? new Float32Array(ab) : a.componentType === 5123 ? new Uint16Array(ab) : new Uint32Array(ab);
  };
  const prim = json.meshes[0].primitives[0];
  const P = read(json.accessors[prim.attributes.POSITION]);
  const N = read(json.accessors[prim.attributes.NORMAL]);
  const T = read(json.accessors[prim.attributes.TEXCOORD_0]);
  const I = read(json.accessors[prim.indices]);
  const pa = json.accessors[prim.attributes.POSITION];
  for (let k = 0; k < 3; k++) {
    let lo = Infinity, hi = -Infinity;
    for (let m = k; m < P.length; m += 3) {
      lo = Math.min(lo, P[m]);
      hi = Math.max(hi, P[m]);
    }
    if (lo !== pa.min[k] || hi !== pa.max[k]) fail(`POSITION min/max wrong on axis ${k}`);
  }
  for (let m = 0; m < N.length; m += 3) if (Math.abs(Math.hypot(N[m], N[m + 1], N[m + 2]) - 1) > 1e-4) fail('normal not unit');
  for (const t of T) if (t < 0 || t > 1) fail('uv out of range');
  for (const i of I) if (i >= pa.count) fail('index out of range');
  // Every triangle faces the way its normal says.
  for (let m = 0; m < I.length; m += 3) {
    const [a, b2, c] = [I[m], I[m + 1], I[m + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    const e1 = a.map((v, k) => b2[k] - v), e2 = a.map((v, k) => c[k] - v);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const n = [N[I[m] * 3], N[I[m] * 3 + 1], N[I[m] * 3 + 2]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] <= 0) fail('triangle winding');
  }
  for (const img of json.images) {
    const v = json.bufferViews[img.bufferView];
    const data = bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    if (!data.subarray(0, 8).equals(PNG_SIG) || img.mimeType !== 'image/png') fail('image is not a PNG');
    // Decode enough to be sure: IHDR, IDAT inflates to the right size.
    const w = data.readUInt32BE(16), h = data.readUInt32BE(20);
    let o = 8;
    const idat = [];
    while (o < data.length) {
      const len = data.readUInt32BE(o);
      const type = data.subarray(o + 4, o + 8).toString('ascii');
      if (crc32(data.subarray(o + 4, o + 8 + len)) !== data.readUInt32BE(o + 8 + len)) fail('PNG CRC');
      if (type === 'IDAT') idat.push(data.subarray(o + 8, o + 8 + len));
      o += 12 + len;
    }
    if (inflateSync(Buffer.concat(idat)).length !== (w * 4 + 1) * h) fail('PNG data size');
  }
  const s = json.samplers[0];
  if (s.magFilter !== 9728 || s.minFilter !== 9728) fail('sampler not NEAREST');
  const names = json.nodes.map((n) => n.name);
  for (const m of Object.keys(gun.markers)) if (!names.includes(m)) fail(`marker ${m} missing`);
  return json;
}

// ---------------------------------------------------------------------------------------------
// Shared parts and paint helpers

const rake = (deg) => ['x', deg, [0, 0, 0]];

/** An ejection port on a side face: a dark slot, the bolt (or a shell) showing inside. */
const port = (face, [y0, y1], [z0, z1], inside = (ctx) => add(hex('#2a2d33'), (rnd(ctx) - 0.5) * 8)) => (ctx, c) => {
  if (ctx.face !== face) return;
  const [, y, z] = ctx.w;
  if (y > y0 && y < y1 && z > z0 && z < z1) return y > y1 - 0.75 ? hex('#0e0f11') : inside(ctx);
  return c;
};

const NORMAL = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };

/**
 * Paint for an optic's frame round its open window (x0..x1, y0..y1, from its rear face z0 to z1):
 * faces turned into the window matte black, and a lighter rim round the window on the rear face
 * (the border the eye sees). The window itself holds no geometry: the platform draws the reticle.
 */
const frame = (win, led) => (ctx, c) => {
  const n = NORMAL[ctx.face];
  const q = ctx.w.map((v, k) => v + n[k] * 0.3);
  // A texel straddling the window's edge counts as inside (half a texel of slack in the face's plane).
  const ex = n[0] ? 0 : 0.5, ey = n[1] ? 0 : 0.5;
  if (q[0] > win.x0 - ex && q[0] < win.x1 + ex && q[1] > win.y0 - ey && q[1] < win.y1 + ey && q[2] > win.z0 && q[2] < win.z1) return add(hex('#141416'), (rnd(ctx) - 0.5) * 6);
  if (ctx.face === '-z' && Math.abs(ctx.w[2] - win.z0) < 0.01) {
    const dx = Math.max(0, win.x0 - ctx.w[0], ctx.w[0] - win.x1);
    const dy = Math.max(0, win.y0 - ctx.w[1], ctx.w[1] - win.y1);
    if (Math.hypot(dx, dy) < 0.8) return mix(c, hex('#ffffff'), 0.45);
  }
  if (led && ctx.face === '+x' && Math.abs(ctx.w[1] - led[1]) < 0.5 && Math.abs(ctx.w[2] - led[2]) < 0.5) return glow(led[0], 0.9)(ctx);
  return c;
};

/**
 * A holographic sight (EOTech style): a boxy hood round an open window `w` x `h` px, the window's
 * inside spanning x -w/2..w/2 and y `y`..`y + h`, from the rear face at `z` to `z + len`. The frame
 * is `t` px thick (base 1 px) with a rear hood `e` px bigger all round; a green power pixel on the
 * left side. Returns the `sight` point: the window's centre on the rear face.
 */
function holo(g, { y, z, w = 3, h = 3, len = 5, t = 1, e = 0.5, hood, base = hood }) {
  const hw = w / 2, z1 = z + len, r = t + e;
  g.window = { x0: -hw, x1: hw, y0: y, y1: y + h, z0: z, z1 };
  const paint = frame(g.window, ['#5dff6a', y - 0.5, z + 1.5]);
  // The rear hood: a ring 1 px deep round the window.
  g.box([-hw - r, y - 1, z], [hw + r, y, z + 1], base, { paint });
  g.pair([hw, y, z], [hw + r, y + h, z + 1], hood, { paint });
  g.box([-hw - r, y + h, z], [hw + r, y + h + r, z + 1], hood, { paint });
  // The hood on to the front: sides, top, and the base under the window.
  g.pair([hw, y, z + 1], [hw + t, y + h, z1], hood, { paint });
  g.box([-hw - t, y + h, z + 1], [hw + t, y + h + t, z1], hood, { paint });
  g.box([-hw - t, y - 1, z + 1], [hw + t, y, z1], base, { paint });
  return [0, y + h / 2, z];
}

/**
 * A mini red dot (RMR style) for a slide: a small housing round an open window `w` x `h` px (its
 * bottom at `y`, from the rear face at `z`), walls half a pixel thick. Returns the `sight` point.
 */
function rmr(g, { y, z, w = 2, h = 1.5, len = 2.5, mat }) {
  const hw = w / 2, z1 = z + len;
  g.window = { x0: -hw, x1: hw, y0: y, y1: y + h, z0: z, z1 };
  const paint = frame(g.window);
  g.box([-hw - 0.5, y - 0.5, z], [hw + 0.5, y, z1], mat, { paint });
  g.pair([hw, y, z], [hw + 0.5, y + h, z1], mat, { paint });
  g.box([-hw - 0.5, y + h, z], [hw + 0.5, y + h + 0.5, z1], mat, { paint });
  return [0, y + h / 2, z];
}

/** A rail mount under an optic: teeth along its sides. */
const railTeeth = (ctx, c) => (onSide(ctx) && Math.floor(ctx.w[2] * 2 + 40) % 2 === 0 ? mul(c, 0.62) : c);

/** Tiny lighter dots (rivets, pins) at model positions on side faces. */
const rivets = (list) => (ctx, c) => {
  if (!onSide(ctx)) return;
  for (const [y, z] of list) if (Math.abs(ctx.w[1] - y) < 0.5 && Math.abs(ctx.w[2] - z) < 0.5) return add(c, 34);
  return c;
};

// ---------------------------------------------------------------------------------------------
// The guns

/** Lucky 45: a 1911 with a polished chrome slide, pearl grips, gold touches and a gold mini red dot. */
function pistol() {
  const g = new Gun('pistol', 'Lucky 45');
  const R = rake(15);
  // Grip: checkered steel straps, pearl panels with a gold medallion, a gold magazine base plate.
  g.box([-1, -2.5, -1.5], [1, 2.5, 1.5], 'checker', { rot: R, hide: ['+y'] });
  const medallion = (ctx, c) => (onSide(ctx) && ctx.i === 1 && ctx.j === 1 ? gold(ctx) : c);
  g.pair([1, -2, -1.5], [1.5, 2, 1.5], 'pearl', { rot: R, paint: medallion });
  g.box([-1, -3.5, -1.5], [1, -2.5, 1.5], 'gold', { rot: R, hide: ['+y'] });
  g.box([-0.5, -4, -1.5], [0.5, -3.5, -0.5], 'gold', { rot: R, hide: ['+y'] }); // lanyard loop
  // Frame: dust cover, beavertail, slide stop and thumb safeties.
  g.box([-1, 2, -2], [1, 3, 6], 'steel');
  g.box([-1, 2.5, -3], [1, 3, -2], 'steel');
  g.box([1, 2.5, 2.5], [1.5, 3, 5], 'darksteel');
  g.pair([1, 2.5, -2], [1.5, 3, -0.5], 'darksteel');
  g.box([-1.5, 2.5, 3], [-1, 3, 3.5], 'darksteel'); // slide stop pin, right side
  // Slide: chrome, rear serrations, the ejection port cut into its right (-x) top, the nose.
  const serrations = (ctx, c) => (onSide(ctx) && ctx.w[2] < 1 && Math.floor(ctx.w[2] + 10) % 2 === 0 ? mul(c, 0.5) : c);
  g.box([-1, 3, -2], [1, 5, 2], 'chrome', { paint: serrations });
  g.box([-1, 3, 2], [1, 4, 4.5], 'chrome', { paint: (ctx, c) => (ctx.face === '+y' ? hex('#141519') : c) });
  g.box([-0.5, 4, 2], [1, 5, 4.5], 'chrome', { faces: { '-x': 'darksteel' } });
  g.box([-1, 3, 4.5], [1, 5, 8.5], 'chrome');
  g.box([-1, 2, 6], [1, 3, 8.5], 'chrome', { paint: (ctx, c) => (ctx.face === '+z' ? mix(c, hex('#30343b'), 0.6) : c) });
  // Barrel bushing and bore.
  g.box([-0.5, 3.5, 8.5], [0.5, 4.5, 9], 'steel', { faces: { '+z': 'bore' } });
  // A gold mini red dot on the rear of the slide (the iron sights gone, so nothing shows through it).
  const sight = rmr(g, { y: 5.5, z: -1.5, w: 2, h: 1.5, len: 2.5, mat: 'gold' });
  // Hammer, cocked back over the beavertail.
  g.box([-0.5, 3.5, -3], [0.5, 5.5, -2], 'darksteel');
  // Trigger guard (hollow) and the gold trigger.
  g.box([-0.5, -0.5, 1.5], [0.5, 0.5, 5], 'steel');
  g.box([-0.5, 0.5, 4], [0.5, 2, 5], 'steel');
  g.box([-0.5, 1, 2.5], [0.5, 2, 3.5], 'gold');
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, -2, 2]);
  g.mark('muzzle', [0, 4, 9]);
  g.mark('sight', sight);
  g.mark('mag', turn(R, [0, -3, 0]));
  return g;
}

/** Mac-10: matte black, a hot-pink grip-tape band, strap and holo sight. */
function smg() {
  const g = new Gun('smg', 'Mac-10');
  // Receiver: upper and lower halves (a seam), the bolt slot on top, the port on the right.
  g.box([-1.5, 2, -4], [1.5, 6, 6], 'parker', {
    paint: (ctx, c) => {
      if (SIDE[ctx.face] && Math.abs(ctx.w[1] - 3.5) < 0.5) return add(hex('#ff2f92'), (rnd(ctx) - 0.5) * 16 + (ctx.face[1] === 'z' ? -30 : 0)); // pink pinstripe on the seam
      if (ctx.face === '+y' && Math.abs(ctx.w[0]) < 0.5 && ctx.w[2] > -2 && ctx.w[2] < 1) return hex('#0d0e10'); // bolt slot
      return c;
    },
  });
  g.decal(port('-x', [4, 5.6], [0, 3.5], (ctx) => add(hex('#6a717b'), (rnd(ctx) - 0.5) * 10)));
  g.decal(rivets([[2.5, -3], [2.5, 3.5], [2.5, 5.5]]));
  // Cocking knob; a compact hot-pink holo sight on the back of the top (the iron sights gone).
  g.box([-0.5, 6, 1], [0.5, 6.5, 2], 'steel');
  const sight = holo(g, { y: 7, z: -3.5, w: 3, h: 2.5, len: 3.5, t: 0.5, e: 0.5, hood: 'pink' });
  // Threaded barrel with a thread protector.
  const threads = (ctx, c) => (ctx.face !== '+z' && ctx.face !== '-z' && Math.floor(ctx.w[2] * 2) % 2 === 0 ? mul(c, 0.7) : c);
  g.box([-0.5, 4, 6], [0.5, 5, 10], 'darksteel', { faces: { '+z': 'bore' }, paint: threads });
  g.box([-1, 3.5, 8.5], [1, 5.5, 9.5], 'steel');
  // Grip with the pink tape band, the long magazine with a pink base, the mag release on the heel.
  g.box([-1, -3, -1.5], [1, 2, 1.5], 'polymer', { hide: ['+y'], paint: (ctx, c) => (SIDE[ctx.face] && ctx.w[1] > -2.5 && ctx.w[1] < 0.5 ? M.pinktape(ctx) : c) });
  g.box([-1, -8, -1], [1, -3, 1], 'parker', { paint: rivets([[-7.5, 0.5]]) });
  g.box([-1.5, -9, -1.5], [1.5, -8, 1.5], 'pink');
  g.box([-0.5, -3.5, -2], [0.5, -2.5, -1.5], 'darksteel');
  // Trigger guard and trigger.
  g.box([-0.5, -0.5, 1.5], [0.5, 0.5, 4], 'parker');
  g.box([-0.5, 0.5, 3], [0.5, 2, 4], 'parker');
  g.box([-0.5, 1, 2], [0.5, 2, 2.5], 'darksteel');
  // The hand strap: a pink nylon loop hanging under the front.
  g.box([-1, 0, 4.5], [1, 2, 5], 'pink');
  g.box([-1, 0, 5.5], [1, 2, 6], 'pink');
  g.box([-1, -0.5, 4.5], [1, 0, 6], 'pink');
  // Retracted wire stock: rods along the lower sides, the butt plate behind.
  g.pair([1.5, 2, -6.5], [2, 2.5, 4.5], 'steel');
  g.pair([1.5, 1.5, 4.5], [2, 3, 5.5], 'darksteel'); // stock hinges
  g.box([-2, -0.5, -7], [2, 2.5, -6.5], 'darksteel');
  g.box([-1.5, -0.5, -6.5], [1.5, 0, -5.5], 'darksteel');
  // Safety slide on the left.
  g.box([1.5, 3, 1.5], [2, 3.5, 2.5], 'steel');
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, -0.5, 5.25]);
  g.mark('muzzle', [0, 4.5, 10]);
  g.mark('sight', sight);
  g.mark('mag', [0, -5.5, 0]);
  return g;
}

/** Big Kahuna: an AK with warm orange wood, a black magazine with a yellow pop stripe, a yellow holo. */
function rifle() {
  const g = new Gun('rifle', 'Big Kahuna');
  const R = rake(15);
  g.box([-1, -2.5, -1.25], [1, 2.5, 1.25], 'akwood', { rot: R, hide: ['+y'] });
  // Receiver, dust cover (ribbed at the back), rear sight block.
  g.box([-1.5, 2, -3], [1.5, 5, 8], 'blued', {
    paint: (ctx, c) => (onSide(ctx) && ctx.w[1] > 3 && ctx.w[1] < 4 && ctx.w[2] > 5 && ctx.w[2] < 7 ? mul(c, 0.72) : c), // the magazine dimple
  });
  g.decal(port('-x', [3.5, 5], [0, 5]));
  g.decal(rivets([[2.5, -2.5], [2.5, 0.5], [2.5, 4.5], [2.5, 7.5], [4.5, 7.5]]));
  g.box([-1, 5, -3], [1, 6, 6], 'steel', { paint: (ctx, c) => (ctx.face !== '-z' && ctx.w[2] < -0.5 && Math.floor(ctx.w[2] + 10) % 2 === 0 ? mul(c, 0.68) : c) });
  g.box([-1, 5, 6], [1, 6, 8], 'blued');
  // A holographic sight on a rail mount on the top cover: yellow hood, black body.
  g.box([-1.5, 6, 0.5], [1.5, 7, 4.5], 'parker', { paint: railTeeth });
  const sight = holo(g, { y: 8, z: 0, w: 3, h: 3, len: 5, hood: 'yellow', base: 'parker' });
  // Charging handle and the big selector lever on the right.
  g.box([-2.5, 4, 5], [-1.5, 5, 6], 'steel');
  g.box([-2, 3.5, -1.5], [-1.5, 4, 3], 'steel');
  g.box([-2, 3, 2.5], [-1.5, 3.5, 3], 'steel');
  // Trigger guard and trigger; the magazine release paddle in front.
  g.box([-0.5, -0.5, 1.5], [0.5, 0.5, 4], 'blued');
  g.box([-0.5, 0.5, 3.5], [0.5, 2, 4], 'blued');
  g.box([-0.5, 1, 2], [0.5, 2, 2.5], 'darksteel');
  // Magazine: stepped into a curve, black with a yellow stripe down its sides.
  const stripe = (ctx, c) => (onSide(ctx) && ctx.i === 1 ? add(hex('#ffd21a'), (rnd(ctx) - 0.5) * 14 + (ctx.j === 0 ? 14 : 0)) : c);
  g.box([-1, 0, 4], [1, 2, 7], 'parker', { paint: stripe });
  g.box([-1, -2, 5], [1, 0, 8], 'parker', { paint: stripe });
  g.box([-1, -4, 6], [1, -2, 9], 'parker', { paint: stripe });
  g.box([-1, -6, 7], [1, -4, 10], 'parker', { paint: stripe });
  g.box([-1, -6.5, 7], [1, -6, 10], 'yellow');
  // Handguards: the wide lower one (a groove along it), the upper on the gas tube; retainer.
  g.box([-1.5, 2, 8], [1.5, 4, 12], 'akwood', { paint: (ctx, c) => (onSide(ctx) && ctx.j === 0 && ctx.w[2] > 8.5 && ctx.w[2] < 11.5 ? mul(c, 0.7) : c) });
  g.box([-1, 4, 8], [1, 5, 11.5], 'akwood');
  g.box([-1.5, 2, 12], [1.5, 4, 12.5], 'blued');
  g.box([-0.5, 4, 11.5], [0.5, 5, 13], 'steel');
  // Barrel, gas block, a low front sight tower (a post between two ears, under the holo's view), cleaning rod, brake.
  g.box([-0.5, 3, 12.5], [0.5, 4, 13], 'darksteel');
  g.box([-1, 2.5, 13], [1, 5, 14], 'blued');
  g.box([-0.5, 3, 14], [0.5, 4, 15], 'darksteel');
  g.box([-1.5, 2.5, 15], [1.5, 4.5, 16], 'blued');
  g.box([-0.5, 4.5, 15], [0.5, 5.5, 16], 'blued');
  g.pair([1, 4.5, 15], [1.5, 6, 16], 'blued');
  g.box([-0.5, 3, 16], [0.5, 4, 16.5], 'darksteel');
  g.box([-0.5, 2, 12.5], [0.5, 2.5, 15], 'steel');
  g.box([-1, 2.5, 16.5], [1, 4.5, 18], 'blued', { faces: { '+z': 'bore' }, paint: (ctx, c) => (ctx.face === '+y' && ctx.w[2] > 17 ? mul(c, 0.55) : c) });
  // Stock: stepped wood, a steel butt plate.
  g.box([-1, 2, -6], [1, 5, -3], 'akwood');
  g.box([-1, 1, -9.5], [1, 5, -6], 'akwood');
  g.box([-1, 0, -9.5], [1, 1, -8], 'akwood');
  g.box([-1, 0, -10], [1, 5, -9.5], 'blued');
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 2, 10]);
  g.mark('muzzle', [0, 3.5, 18]);
  g.mark('sight', sight);
  g.mark('mag', [0, -2, 7]);
  return g;
}

/** Pump shotgun: dark steel, cherry-red pump and holo sight, a walnut stock, red shells on a side saddle. */
function shotgun() {
  const g = new Gun('shotgun', 'Pump Shotgun');
  const R = rake(25);
  // Grip (the stock's wrist), checkered.
  g.box([-1, -2.5, -1.5], [1, 2.5, 1.5], 'walnut', { rot: R, hide: ['+y'], paint: (ctx, c) => (onSide(ctx) && ctx.j > 0 && ctx.j < 4 && (ctx.i + ctx.j) % 2 ? mul(c, 0.72) : c) });
  // Receiver: the port on the right shows a red shell, the loading port underneath.
  const shell = (ctx) => (ctx.w[2] < 3.75 ? M.brass(ctx) : M.cherry(ctx));
  g.box([-1.5, 1, 0.5], [1.5, 5, 8], 'darksteel', {
    paint: (ctx, c) => {
      if (ctx.face === '-y' && ctx.w[2] > 4 && ctx.w[2] < 7.5 && Math.abs(ctx.w[0]) < 1) return ctx.w[2] > 6.5 ? hex('#0e0f11') : hex('#3a3f47'); // loading port and lifter
      if (ctx.face === '+y' && Math.abs(ctx.w[0]) < 0.5) return mix(c, hex('#8a939e'), 0.35); // matted top groove
      return c;
    },
  });
  g.decal(port('-x', [2.5, 4.5], [3, 6.5], shell));
  // Side saddle with four red shells (brass heads down) on the left.
  g.box([1.5, 1.5, 1.5], [2, 4.5, 7.5], 'black');
  for (const z of [2, 3.5, 5, 6.5]) g.box([2, 1.5, z], [2.5, 4.5, z + 1], (ctx) => (ctx.w[1] < 2.5 ? M.brass(ctx) : M.cherry(ctx)));
  // Barrel (matted rib on top, a flush brass bead at the muzzle); magazine tube and cap; action bars.
  g.box([-1, 3, 8], [1, 5, 20], 'darksteel', {
    faces: { '+z': 'bore' },
    paint: (ctx, c) => (ctx.face !== '+y' ? c : ctx.w[2] > 19 && ctx.w[0] > 0 ? M.brass(ctx) : mix(c, hex('#1d2025'), 0.5)),
  });
  g.box([-1, 1, 8], [1, 3, 17.5], 'steel');
  g.box([-1, 1, 17.5], [1, 3, 18.5], 'darksteel', { faces: { '+z': (ctx) => mix(M.darksteel(ctx), hex('#7d858f'), 0.3) } });
  g.pair([1, 1.5, 8], [1.5, 2.5, 10], 'steel');
  // The pump: cherry red with deep grooves.
  g.box([-1.5, 0.5, 10], [1.5, 3.5, 15], 'cherry', { paint: (ctx, c) => (ctx.face !== '+z' && ctx.face !== '-z' && ctx.w[2] > 10.5 && ctx.w[2] < 14.5 && Math.floor(ctx.w[2] + 20) % 2 === 1 ? mul(c, 0.6) : c) });
  // A holographic sight on a mount on the receiver: cherry red, like the pump.
  g.box([-1.5, 5, 2.5], [1.5, 6, 6.5], 'parker', { paint: railTeeth });
  const sight = holo(g, { y: 7, z: 2, w: 3, h: 3, len: 5, hood: 'cherry' });
  // Trigger guard and trigger.
  g.box([-0.5, -1, 1.5], [0.5, 0, 4.5], 'darksteel');
  g.box([-0.5, 0, 3.5], [0.5, 1, 4.5], 'darksteel');
  g.box([-0.5, 0, 2.5], [0.5, 1, 3], 'brass');
  // Sling studs, front (on the magazine cap) and rear (under the stock).
  g.box([-0.5, 0, 17.5], [0.5, 1, 18], 'steel');
  g.box([-0.5, -0.5, -7], [0.5, 0, -6], 'steel');
  // Stock: walnut body and toe, black recoil pad.
  g.box([-1.5, 1, -8.5], [1.5, 5, 0.5], 'walnut');
  g.box([-1.5, 0, -8.5], [1.5, 1, -5], 'walnut');
  g.box([-1.5, 0, -9.5], [1.5, 5, -8.5], 'rubber');
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 0.5, 12.5]);
  g.mark('muzzle', [0, 4, 20]);
  g.mark('sight', sight);
  g.mark('mag', [0, 1, 5.75]);
  return g;
}

/** Bolt-action sniper rifle: olive-black stock, brass-rimmed scope, a red glint in its lens. */
function sniper() {
  const g = new Gun('sniper', 'Sniper');
  const R = rake(18);
  g.box([-1, -2.5, -1.5], [1, 2.5, 1.5], 'olive', { rot: R, hide: ['+y'], paint: (ctx, c) => (onSide(ctx) && (ctx.i + ctx.j) % 2 ? mul(c, 0.8) : c) });
  // Stock: the action bed and long forend, the butt with a raised cheek piece, a rubber pad.
  g.box([-1.5, 1, -2.5], [1.5, 3.5, 15], 'olive', { paint: (ctx, c) => (onSide(ctx) && ctx.w[2] > 9 && ctx.w[2] < 14 && ctx.j === 1 ? mul(c, 0.75) : c) });
  g.box([-1.5, 1, -10], [1.5, 4.5, -2.5], 'olive');
  g.box([-1.5, -1.5, -10], [1.5, 1, -6.5], 'olive');
  g.box([-1, 4.5, -8.5], [1, 5.5, -3.5], 'olivedark');
  g.box([-1.5, -1.5, -11], [1.5, 4.5, -10], 'rubber');
  // Receiver, bolt shroud, bolt handle out to the right with a black knob.
  g.box([-1, 3.5, -1.5], [1, 5, 8.5], 'blued');
  g.decal(port('-x', [3.5, 5], [2, 5.5]));
  g.box([-0.5, 3.5, -2.5], [0.5, 4.5, -1.5], 'steel');
  g.box([-2.5, 4, 0.5], [-1, 4.5, 1.5], 'steel');
  g.box([-3.5, 3, 0], [-2.5, 4.5, 2], 'black');
  // Barrel: heavy and fluted near the action, then slimmer, then a brake with side ports.
  g.box([-1, 3, 8.5], [1, 5, 12], 'darksteel', { paint: (ctx, c) => (onSide(ctx) && ctx.j === 1 ? mul(c, 0.6) : c) });
  g.box([-0.5, 3.5, 12], [0.5, 4.5, 20], 'darksteel');
  g.box([-1, 3, 20], [1, 5, 22], 'blued', { faces: { '+z': 'bore' }, paint: (ctx, c) => (onSide(ctx) && ctx.w[1] < 4.5 && ctx.w[1] > 3.5 ? hex('#101113') : c) });
  // Rail with teeth; scope rings; the scope: tube, turrets, eyepiece and objective bells.
  g.box([-1, 5, -1], [1, 5.5, 8], 'darksteel', { paint: (ctx, c) => (ctx.face !== '-y' && Math.floor(ctx.w[2] + 10) % 2 === 0 ? mul(c, 0.6) : c) });
  for (const z of [0.5, 5.5]) {
    g.box([-1, 5.5, z], [1, 6.5, z + 1], 'darksteel');
    g.box([-1.5, 6.5, z], [1.5, 9.5, z + 1], 'darksteel');
  }
  g.box([-1, 7, -1], [1, 9, 9], 'olivedark');
  g.box([-0.5, 9, 3], [0.5, 10, 4], 'olivedark', { faces: { '+y': 'brass' } });
  g.box([1, 7.5, 3], [2, 8.5, 4], 'olivedark', { faces: { '+x': 'brass' } });
  const rim = (inner) => (ctx) => (ctx.i === 0 || ctx.j === 0 || ctx.i === ctx.tw - 1 || ctx.j === ctx.th - 1 ? M.brass(ctx) : inner(ctx));
  g.box([-1.5, 6.5, -3], [1.5, 9.5, -1], 'olivedark', { faces: { '-z': rim((ctx) => add(hex('#1d3346'), 40)) } });
  g.box([-1.5, 6.5, 9], [1.5, 9.5, 10], 'olivedark');
  const lens = (ctx) => {
    const hot = ctx.i === 1 && ctx.j === 1;
    return glow(hot ? '#ffd0c0' : ctx.i + ctx.j === 3 ? '#ff2a1a' : '#b3121a', hot ? 1 : 0.6)(ctx);
  };
  g.box([-2, 6, 10], [2, 10, 12], 'olivedark', { faces: { '+z': rim(lens) } });
  // Trigger guard, trigger, a short box magazine.
  g.box([-0.5, -1, 1.5], [0.5, 0, 3.5], 'darksteel');
  g.box([-0.5, 0, 3], [0.5, 1, 3.5], 'darksteel');
  g.box([-0.5, 0, 2], [0.5, 1, 2.5], 'steel');
  g.box([-1, -1, 4], [1, 1, 6.5], 'parker', { faces: { '-y': 'darksteel' } });
  // Bipod, folded forward under the barrel.
  g.box([-1, 0, 13.5], [1, 1, 15], 'darksteel');
  g.pair([0.5, 0.25, 15], [1, 0.75, 20], 'steel');
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 1, 10.5]);
  g.mark('muzzle', [0, 4, 22]);
  g.mark('sight', [0, 8, -3]);
  g.mark('mag', [0, 0, 5.25]);
  return g;
}

/** Katana: a mirror blade with a wavy hamon, a gold-rimmed tsuba, a yellow-and-black wrap. */
function katana() {
  const g = new Gun('katana', 'Katana');
  // Handle: kashira (pommel cap), the wrapped tsuka, the fuchi collar.
  g.box([-1, -1.5, -3], [1, 1.5, -2], 'lacquer', { paint: (ctx, c) => (ctx.face === '-z' && (ctx.j === 0 || ctx.j === ctx.th - 1) ? gold(ctx) : c) });
  g.box([-1, -1.5, -2], [1, 1.5, 4], 'wrap');
  g.box([-1, -1.5, 4], [1, 1.5, 5], 'gold');
  // Tsuba: a rounded plate, black with a gold rim.
  const tsuba = (ctx, c) => {
    const [x, y] = ctx.w;
    return Math.abs(x) > 1.4 || Math.abs(y) > 1.9 || !(ctx.face === '+z' || ctx.face === '-z') ? gold(ctx) : c;
  };
  g.box([-1.5, -2.5, 5], [1.5, 2.5, 6], 'lacquer', { paint: tsuba });
  g.pair([1.5, -2, 5], [2, 2, 6], 'lacquer', { paint: tsuba });
  // Habaki (the blade collar).
  g.box([-0.5, -1.5, 6], [0.5, 1.5, 7], 'gold');
  // Blade, curving gently toward the spine (-y) as it runs out: three turned segments, then the tip.
  let at = [0, 0, 7];
  let last = null;
  const seg = (len, deg, parts = [[-1, 1, 0, len]]) => {
    last = { rot: ['x', deg, [0, 0, 0]], move: [...at] };
    for (const [y0, y1, z0, z1] of parts) g.box([-0.5, y0, z0], [0.5, y1, z1], 'blade', last);
    at = place(last, [0, 0, len]);
  };
  seg(7, 1.5);
  seg(7, 4);
  // The kissaki: the edge sweeps back up to the straight spine.
  seg(6, 6.5, [
    [-1, 1, 0, 4],
    [-1, 0.5, 4, 5],
    [-1, -0.25, 5, 6],
  ]);
  g.mark('grip', [0, 0, 0]);
  g.mark('grip2', [0, 0, 3]);
  g.mark('muzzle', place(last, [0, -0.625, 6]));
  return g;
}

/**
 * The Briefcase: a black leather attache case, its lid (the front half) leaning open from its
 * bottom edge so a wedge of golden light spills out along the top and sides. A pickup: no markers.
 */
function briefcase() {
  const g = new Gun('briefcase', 'The Briefcase');
  // The lid pivots on its bottom-front edge, 12 degrees forward: a ~1.5 px gap at the top, none below.
  const lid = ['x', 12, [0, 0.5, 1.5]];
  // Stitching one texel in from the edges of the big faces.
  const stitch = (ctx, c) => {
    if (ctx.face !== '+z' && ctx.face !== '-z') return;
    const { i, j, tw, th } = ctx;
    const ring = ((i === 1 || i === tw - 2) && j >= 1 && j <= th - 2) || ((j === 1 || j === th - 2) && i >= 1 && i <= tw - 2);
    return ring && (i + j) % 2 === 0 ? add(c, 14) : c;
  };
  // Light spilling from the gap onto the lips of both halves: their edges along the opening glow
  // warm, strongest at the top. `seam` is the local z of the half's edge at the gap.
  const spill = (seam) => (ctx, c) => {
    if (ctx.face === '+z' || ctx.face === '-z' || ctx.face === '-y') return;
    const [, y, z] = ctx.p;
    if (Math.abs(z - seam) > 0.5) return;
    const k = ctx.face === '+y' ? 1 : clamp01((y - 3.5) / 4);
    if (k <= 0) return;
    ctx.glow = 0.55 * k;
    return mix(c, hex('#ffb13a'), 0.35 + 0.5 * k);
  };
  const both = (a, b) => (ctx, c) => {
    const c1 = a(ctx, c) ?? c;
    return b(ctx, c1) ?? c1;
  };
  // The two halves (their inner faces lit by what's inside) and the glowing contents in the gap.
  g.box([-5, 0.5, -1.5], [5, 7.5, 0], 'leather', { faces: { '+z': 'golden' }, paint: both(stitch, spill(0)) });
  g.box([-5, 0.5, 0], [5, 7.5, 1.5], 'leather', { rot: lid, faces: { '-z': 'golden' }, paint: both(stitch, spill(0)) });
  g.box([-4.5, 1, 0], [4.5, 7.25, 0.5], 'golden');
  // Handle on top of the back half: brass mounts, leather posts and grip.
  g.pair([1.25, 7.5, -1.25], [2.75, 8, 0.25], 'brass');
  g.pair([1.5, 8, -1], [2.5, 9, 0], 'leather');
  g.box([-2.5, 9, -1], [2.5, 10, 0], 'leather');
  // Two brass latches (sprung) and the combination lock between them, on the lid.
  const keyhole = (ctx, c) => (ctx.face === '+z' && ctx.j === ctx.th - 1 ? hex('#3a2508') : c);
  g.pair([2.5, 5.5, 1.5], [3.5, 7, 2], 'brass', { rot: lid, paint: keyhole });
  const dials = (ctx, c) => (ctx.face === '+z' ? (ctx.i % 2 ? hex('#2a1a06') : hex('#f7e3a0')) : c);
  g.box([-1, 6, 1.5], [1, 7, 2], 'brass', { rot: lid, paint: dials });
  // Brass corner caps: the lid's front corners, the back half's back corners.
  for (const [x0, x1] of [[4.25, 5.25], [-5.25, -4.25]])
    for (const [y0, y1] of [[6.75, 7.75], [0.25, 1.25]]) {
      g.box([x0, y0, 1.25], [x1, y1, 1.75], 'brass', { rot: lid });
      g.box([x0, y0, -1.75], [x1, y1, -1.25], 'brass');
    }
  // Brass feet at the corners.
  for (const x of [-4.5, 3.5])
    for (const z of [-1.25, 0.5]) g.box([x, 0, z], [x + 1, 0.5, z + 0.75], 'brass');
  return g;
}

// ---------------------------------------------------------------------------------------------

const GUNS = [pistol(), smg(), rifle(), shotgun(), sniper(), katana(), briefcase()];
const only = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
for (const gun of GUNS) {
  if (only.length && !only.includes(gun.id)) continue;
  const b = build(gun);
  const bytes = glb(gun, b);
  writeFileSync(join(OUT, `${gun.id}.glb`), bytes);
  validate(readFileSync(join(OUT, `${gun.id}.glb`)), gun);
  const lo = [0, 1, 2].map((k) => Math.min(...b.pos.filter((_, m) => m % 3 === k)) * 16);
  const hi = [0, 1, 2].map((k) => Math.max(...b.pos.filter((_, m) => m % 3 === k)) * 16);
  const size = hi.map((v, k) => +(v - lo[k]).toFixed(2));
  const fmt = (p) => `(${p.map((v) => +v.toFixed(2)).join(', ')})`;
  console.log(`${gun.id}.glb  ${gun.name}: ${gun.boxes.length} boxes, ${b.visible.length} faces, atlas ${b.W}x${b.H}, ${(bytes.length / 1024).toFixed(1)} KB`);
  console.log(`  size (px) x ${size[0]}  y ${size[1]}  z ${size[2]}   z ${fmt([lo[2], hi[2]])}  y ${fmt([lo[1], hi[1]])}`);
  console.log(`  markers ${Object.entries(gun.markers).map(([k, v]) => `${k} ${fmt(v)}`).join('  ')}`);
  if (b.overlap > 0.001) console.log(`  hidden overlap ${b.overlap.toFixed(2)} px^3`);
  for (const w of b.warn) console.log(`  warning: ${w}`);
  const blocked = clearView(gun);
  if (blocked.length) throw new Error(`${gun.id}: the optic's window isn't clear: ${blocked.join('; ')}`);
  if (gun.window) {
    const { x0, x1, y0, y1, z0, z1 } = gun.window;
    console.log(`  optic window ${x1 - x0} x ${y1 - y0} px inside (x ${x0}..${x1}, y ${y0}..${y1}, z ${z0}..${z1}), clear`);
  }
}
