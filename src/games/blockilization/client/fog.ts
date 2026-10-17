import { centre, corners, extent, HEX, HEX_W, hexW, period, SEA_Y } from '../geometry';
import { NATURAL_WONDERS } from '../rules/nature';
import { cam, homeShift, toScreen, viewBasis } from './camera';
import { store } from './store';

/**
 * The fog, on this screen, as Civilization V draws it. Land nobody here has explored lies under a
 * thin layer of cloud floating over the world: a canvas over the view, each pixel the cloud where
 * the view's ray meets the layer's height (`CLOUD_Y`), so it hides all of what's under it, the
 * world's own trees and peaks included, and runs on past the map's edge. Because it floats, its near
 * edges stand a little up the screen from the ground they cover: you can see under them, onto land
 * in its shadow; its far edges overhang a little. Its shapes are anchored to the world (they don't
 * swim as the view pans) and drift very slowly; its edges are soft and wispy. Land seen before but
 * out of sight now is veiled instead: canvases under the cloud's, blended over the view (darker,
 * bluer, greyer), cover each such tile from the sea up to the top of what stands on it (so its
 * trees and peaks are veiled too).
 *
 * The cloud is a single pass of a small shader of its own (`CLOUD_SHADER`) at part of the screen's
 * resolution; what's known is a mask in the world's own coordinates (`drawMask`), drawn and
 * softened on a canvas only when what's known changes. Round a world that wraps, the mask is one
 * period across and repeats, and the cloud's noise comes round with the world: every copy of the
 * world on the screen is under its cloud, and the camera's jump of a period changes nothing.
 */

/** The cloud layer's height (the land's top is a block or two over the sea), and the ground under it (for its shadow). */
const CLOUD_Y = SEA_Y + 6.5;
const GROUND_Y = SEA_Y + 1.5;
/** The cloud canvas's pixels per CSS pixel (soft clouds don't need more). */
const CLOUD_RES = 0.6;
/** The mask's pixels per block, and its margin round the map (blocks: off the map is all cloud). */
const MASK_RES = 2;
const MASK_MARGIN = 6;
/** The veil: each of its layers blends a colour over the view where land is out of sight (a little darker and cooler, and paler in colour: still clearly itself). */
const VEIL: { blend: string; color: string }[] = [
  { blend: 'multiply', color: '#c2c9d6' },
  { blend: 'saturation', color: 'rgba(128,128,128,0.38)' },
];

/** The veil's layers: a canvas each, blended over the view. */
let layers: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; color: string }[] = [];
/** What the veil was last drawn for: the camera and the screen's size, and what was known and seen. */
let veiledFor = '';
let veiledKnown: object | null = null;

/** The cloud: its canvas, and what draws on it. */
let cloud: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; mask: WebGLTexture; at: Record<string, WebGLUniformLocation | null> } | null = null;
/** What the mask was last drawn for (the view's tiles: a new array with each view), and where it lies in the world (blocks). */
let maskedFor: object | null = null;
let maskRect = { x0: 0, z0: 0, w: 1, d: 1 };
/** The mask's canvases: what's known, sharp, and softened (and on a world that wraps, cut to its period). */
let maskSharp: HTMLCanvasElement | null = null;
let maskSoft: HTMLCanvasElement | null = null;
let maskRound: HTMLCanvasElement | null = null;
/** The cloud's noise across: its scales (the shapes', their warp's, the fine wisps'), and on a world that wraps, the cells of each round it (none: flat). */
let noiseScale = [0.05, 1.6, 0.19];
let noiseCells = [0, 0, 0];

export function mountFog(layer: HTMLElement) {
  layers = VEIL.map(({ blend, color }) => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;pointer-events:none;mix-blend-mode:${blend};`;
    layer.append(canvas);
    return { canvas, ctx: canvas.getContext('2d')!, color };
  });
  cloud = mountCloud(layer);
}

// -------------------------------------------------------------------------------------------------
// The cloud

/**
 * The cloud's shader: for each pixel, where its ray meets the layer (and the ground under it), how
 * known the land there is (the mask, softened), and the cloud: drifting noise warped into wisps,
 * whole over unknown land and frayed toward its edges, white on top and blue-grey in its folds,
 * paler far off; and the ground in its shadow.
 */
const CLOUD_SHADER = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform float uRes;
uniform vec3 uEye;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uFocal;
uniform float uCloudY;
uniform float uGroundY;
uniform vec4 uMaskRect;
uniform sampler2D uMask;
uniform float uTime;
uniform vec3 uScale;
uniform vec3 uCells;
out vec4 colour;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Value noise; round a world that wraps, its lattice's columns come round every \`per\` (0: they don't).
float noise(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float x0 = i.x;
  float x1 = i.x + 1.0;
  if (per > 0.0) {
    x0 = mod(x0, per);
    x1 = mod(x1, per);
  }
  return mix(mix(hash(vec2(x0, i.y)), hash(vec2(x1, i.y)), u.x), mix(hash(vec2(x0, i.y + 1.0)), hash(vec2(x1, i.y + 1.0)), u.x), u.y);
}
float fbm(vec2 p, int octaves, float per) {
  float v = 0.0;
  float a = 0.5;
  // (Each octave finer; round a world that wraps, exactly twice as fine, so each comes round with it.)
  float k = per > 0.0 ? 2.0 : 2.03;
  for (int i = 0; i < octaves; i++) {
    v += a * noise(p, per);
    p = p * k + vec2(17.1, 9.7);
    per *= 2.0;
    a *= 0.5;
  }
  return v;
}
float known(vec2 xz) {
  return texture(uMask, (xz - uMaskRect.xy) * uMaskRect.zw).r;
}

void main() {
  vec2 s = vec2(gl_FragCoord.x, uSize.y * uRes - gl_FragCoord.y) / uRes;
  vec3 ray = normalize(uFwd + uRight * (s.x - uSize.x * 0.5) / uFocal - uUp * (s.y - uSize.y * 0.5) / uFocal);
  if (ray.y > -0.001) {
    colour = vec4(0.0);
    return;
  }
  float far = (uCloudY - uEye.y) / ray.y;
  vec2 at = uEye.xz + ray.xz * far;
  vec2 ground = uEye.xz + ray.xz * ((uGroundY - uEye.y) / ray.y);

  // The cloud's shapes: noise anchored to the world, warped into wisps, drifting.
  vec2 q = at * vec2(uScale.x, 0.05) + uTime * vec2(0.006, 0.0025);
  vec2 warp = vec2(fbm(q * vec2(uScale.y, 1.6) + vec2(3.1, 1.7), 3, uCells.y), fbm(q * vec2(uScale.y, 1.6) - vec2(5.3, 2.9), 3, uCells.y));
  float n = fbm(q + 0.7 * warp, 5, uCells.x);
  float fine = fbm(at * vec2(uScale.z, 0.19) - uTime * vec2(0.01, 0.004), 3, uCells.z);

  // Whole over unknown land, frayed and thinning toward known land.
  float cover = (1.0 - known(at)) * (0.62 + 0.55 * n + 0.3 * fine);
  float alpha = smoothstep(0.22, 0.72, cover);

  // White on top, blue-grey in its folds, a little brighter at its frayed edges; paler far off.
  float lit = smoothstep(0.32, 0.78, n * 0.8 + fine * 0.35);
  vec3 cloud = mix(vec3(0.70, 0.75, 0.84), vec3(0.97, 0.98, 1.0), lit);
  cloud = mix(cloud, vec3(1.0), (1.0 - smoothstep(0.55, 0.95, alpha)) * 0.25);
  cloud = mix(cloud, vec3(0.86, 0.87, 0.88), smoothstep(110.0, 260.0, far) * 0.6);

  // The ground in its shadow: under it (seen under its far edges), and spilling softly a block or
  // two onto known land toward the camera, where the light falls past its edge.
  vec2 lit0 = (ground + vec2(0.8, 1.8) - uMaskRect.xy) * uMaskRect.zw;
  float shade = (1.0 - textureLod(uMask, lit0, 2.2).r) * 0.34;
  vec3 dark = vec3(0.05, 0.07, 0.11);
  colour = vec4(cloud * alpha + dark * shade * (1.0 - alpha), alpha + shade * (1.0 - alpha));
}
`;

const QUAD_SHADER = `#version 300 es
in vec2 corner;
void main() {
  gl_Position = vec4(corner, 0.0, 1.0);
}
`;

/** The cloud's canvas, over the veil's and under the overlay's (null without WebGL 2: the platform's own drawing needs it, so never). */
function mountCloud(layer: HTMLElement): typeof cloud {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  layer.append(canvas);
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, depth: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`The fog's shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, QUAD_SHADER));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, CLOUD_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`The fog's shader: ${gl.getProgramInfoLog(program)}`);
  gl.useProgram(program);
  // A triangle over the whole screen.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
  const mask = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, mask);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const at: Record<string, WebGLUniformLocation | null> = {};
  for (const name of ['uSize', 'uRes', 'uEye', 'uRight', 'uUp', 'uFwd', 'uFocal', 'uCloudY', 'uGroundY', 'uMaskRect', 'uMask', 'uTime', 'uScale', 'uCells']) at[name] = gl.getUniformLocation(program, name);
  return { canvas, gl, mask, at };
}

/**
 * What's known, as a mask over the map in the world's coordinates (a few pixels a block): each
 * known tile's hex filled, softened over a block or so. Off the map (and round it) is all unknown.
 * Round a world that wraps, it's one period across, repeated as it's sampled: drawn with the
 * copies either side in its margins (so it softens on over the seam), then cut to the period.
 * Returns the canvas to sample.
 */
function drawMask(): HTMLCanvasElement {
  const g = store.grid!;
  const size = extent(g);
  const round = period(g);
  const drawn = { x0: -MASK_MARGIN, z0: -MASK_MARGIN, w: size.w + MASK_MARGIN * 2, d: size.d + MASK_MARGIN * 2 };
  maskRect = round ? { ...drawn, x0: 0, w: round } : drawn;
  const pw = Math.ceil(drawn.w * MASK_RES);
  const ph = Math.ceil(drawn.d * MASK_RES);
  maskSharp ??= document.createElement('canvas');
  maskSoft ??= document.createElement('canvas');
  for (const c of [maskSharp, maskSoft]) {
    c.width = pw;
    c.height = ph;
  }
  const sharp = maskSharp.getContext('2d')!;
  sharp.fillStyle = '#000';
  sharp.fillRect(0, 0, pw, ph);
  sharp.setTransform(MASK_RES, 0, 0, MASK_RES, -drawn.x0 * MASK_RES, -drawn.z0 * MASK_RES);
  // (Each shape filled closed: closing them in the path costs more the longer it gets, in Chrome.)
  const path = new Path2D();
  const copies = round ? [-round, 0, round] : [0];
  for (let t = 0; t < store.known.length; t++) {
    if (!store.known[t]) continue;
    const cs = corners(g, t);
    for (const dx of copies) {
      if (dx && cs.every((c) => c.x + dx < drawn.x0 || c.x + dx > drawn.x0 + drawn.w)) continue;
      path.moveTo(cs[0].x + dx, cs[0].z);
      for (let i = 1; i < 6; i++) path.lineTo(cs[i].x + dx, cs[i].z);
    }
  }
  sharp.fillStyle = '#fff';
  sharp.fill(path);
  sharp.setTransform(1, 0, 0, 1, 0, 0);
  const soft = maskSoft.getContext('2d')!;
  soft.filter = `blur(${MASK_RES * 1.2}px)`;
  soft.drawImage(maskSharp, 0, 0);
  soft.filter = 'none';
  if (!round) return maskSoft;
  maskRound ??= document.createElement('canvas');
  maskRound.width = round * MASK_RES;
  maskRound.height = ph;
  maskRound.getContext('2d')!.drawImage(maskSoft, MASK_MARGIN * MASK_RES, 0, round * MASK_RES, ph, 0, 0, round * MASK_RES, ph);
  return maskRound;
}

/** The cloud's noise for a grid: its scales across, and round a world that wraps, a whole number of each one's cells round it (so the cloud's the same a period on). */
function noiseFor(round: number) {
  if (!round) {
    noiseScale = [0.05, 1.6, 0.19];
    noiseCells = [0, 0, 0];
    return;
  }
  const shapes = Math.max(1, Math.round(round * 0.05));
  const warp = Math.max(1, Math.round(shapes * 1.6));
  const fine = Math.max(1, Math.round(round * 0.19));
  noiseScale = [shapes / round, warp / shapes, fine / round];
  noiseCells = [shapes, warp, fine];
}

/** Each frame: the cloud over the view (its mask first, if what's known has changed). */
function drawCloud(now: number) {
  if (!cloud) return;
  const { canvas, gl, at } = cloud;
  const b = viewBasis();
  const w = Math.max(1, Math.round(window.innerWidth * CLOUD_RES));
  const h = Math.max(1, Math.round(window.innerHeight * CLOUD_RES));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  gl.viewport(0, 0, w, h);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!b || !store.grid || !store.view) {
    maskedFor = null;
    return;
  }
  if (maskedFor !== store.known) {
    maskedFor = store.known;
    const mask = drawMask();
    const round = period(store.grid);
    noiseFor(round);
    gl.bindTexture(gl.TEXTURE_2D, cloud.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    // (Round a world that wraps, the mask repeats across.)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, round ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
  }
  gl.uniform2f(at.uSize, b.w, b.h);
  gl.uniform1f(at.uRes, h / b.h);
  gl.uniform3f(at.uEye, b.px, b.py, b.pz);
  gl.uniform3f(at.uRight, b.rx, b.ry, b.rz);
  gl.uniform3f(at.uUp, b.ux, b.uy, b.uz);
  gl.uniform3f(at.uFwd, b.fx, b.fy, b.fz);
  gl.uniform1f(at.uFocal, b.focal);
  gl.uniform1f(at.uCloudY, CLOUD_Y);
  gl.uniform1f(at.uGroundY, GROUND_Y);
  gl.uniform4f(at.uMaskRect, maskRect.x0, maskRect.z0, 1 / maskRect.w, 1 / maskRect.d);
  gl.uniform1i(at.uMask, 0);
  gl.uniform1f(at.uTime, now);
  gl.uniform3f(at.uScale, noiseScale[0], noiseScale[1], noiseScale[2]);
  gl.uniform3f(at.uCells, noiseCells[0], noiseCells[1], noiseCells[2]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** The cloud cut out of a canvas's drawing (the overlay's grid and borders under it), as much as it hides. */
export function cut(c: CanvasRenderingContext2D) {
  if (!cloud || !maskedFor) return;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(cloud.canvas, 0, 0, c.canvas.width, c.canvas.height);
  c.restore();
}

// -------------------------------------------------------------------------------------------------
// The veil

/**
 * How high what stands on a tile reaches (blocks), and how much of its hex that top covers: water
 * at the surface, land a block over it, hills higher, trees and towns over that (trees reach a
 * little past the hex), a mountain to a peak in the middle, a natural wonder to its landmark's top.
 */
function standing(t: number): { top: number; spread: number } {
  const s = store.terrain[t];
  const k = store.known[t];
  const nature = NATURAL_WONDERS[k?.wonder ?? ''];
  if (nature) return { top: SEA_Y + nature.top + 1, spread: 0.8 };
  if (!s || s.terrain === 'ocean' || s.terrain === 'coast' || s.terrain === 'lake') return { top: SEA_Y + 1, spread: 1 };
  if (s.elevation === 'mountain') return { top: SEA_Y + s.height + 4, spread: 0.4 };
  const ground = s.elevation === 'hills' ? SEA_Y + 4.5 : SEA_Y + 2;
  if (k?.city !== undefined && k.city >= 0) return { top: ground + 6, spread: 0.9 };
  const f = k?.feature;
  if (f === 'forest' || f === 'jungle') return { top: ground + (s.terrain === 'tundra' || s.terrain === 'snow' ? 5 : 4), spread: 1.25 };
  return { top: ground + (k?.improvement ? 2.5 : 0), spread: 1 };
}

/** A tile's veil on screen, its middle at `m`: the outline round its hex at the sea and its hex (or the part its top covers) at the top of what stands on it. */
function veilHull(m: { x: number; z: number }, t: number, sx: number): { x: number; y: number }[] | null {
  const { top, spread } = standing(t);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    const dx = HEX * Math.cos(a) * sx;
    const dz = HEX * Math.sin(a);
    const lo = toScreen(m.x + dx * 1.02, SEA_Y + 0.9, m.z + dz * 1.02);
    const hi = toScreen(m.x + dx * spread, top, m.z + dz * spread);
    if (!lo || !hi) return null;
    pts.push(lo, hi);
  }
  return convexHull(pts);
}

/** The convex hull of some points (Andrew's monotone chain). */
function convexHull(p: { x: number; y: number }[]): { x: number; y: number }[] {
  const pts = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: { x: number; y: number }[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** The veil over land out of sight (only redrawn when the view or what's seen changes). */
function drawVeil() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const key = `${cam.x},${cam.z},${cam.dist},${w},${h},${dpr}`;
  if (key === veiledFor && veiledKnown === store.known) return;
  veiledFor = key;
  veiledKnown = store.known;
  for (const { canvas, ctx } of layers) {
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
  }
  const g = store.grid;
  if (!g || !store.view) return;
  // One path of every veiled tile's outline on screen (overlapping ones darken once). (Its shapes
  // are filled closed: closing each one in the path costs more the longer it gets, in Chrome.)
  // Round a world that wraps, each copy of a tile on the screen is veiled (the nearest the camera,
  // and the one either side of it at the screen's edges).
  const veil = new Path2D();
  const round = period(g);
  const copies = round ? [-round, 0, round] : [0];
  const sx = hexW(g) / HEX_W;
  for (let t = 0; t < g.width * g.height; t++) {
    const k = store.known[t];
    if (!k || k.visible) continue;
    const c = centre(g, t);
    const x = c.x + homeShift(c.x);
    for (const dx of copies) {
      const m = { x: x + dx, z: c.z };
      const s = toScreen(m.x, SEA_Y + 1, m.z);
      if (!s || s.x < -120 || s.x > w + 120 || s.y < -160 || s.y > h + 200) continue;
      const hull = veilHull(m, t, sx);
      if (!hull) continue;
      veil.moveTo(hull[0].x, hull[0].y);
      for (let i = 1; i < hull.length; i++) veil.lineTo(hull[i].x, hull[i].y);
    }
  }
  for (const { ctx, color } of layers) {
    ctx.fillStyle = color;
    ctx.fill(veil);
  }
}

/** Each frame: the veil, and the cloud over it. */
export function drawFog(now: number) {
  if (!layers.length) return;
  drawVeil();
  drawCloud(now);
}
