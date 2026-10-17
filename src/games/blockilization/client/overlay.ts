import { centre, centreNear, corners, HEX, HEX_W, hexW, SEA_Y } from '../geometry';
import type { CityInfo, CityWire } from '../protocol';
import { CIVS } from '../rules/civs';
import { neighbour, within } from '../rules/hex';
import { NATURAL_WONDERS } from '../rules/nature';
import { RESOURCES, TERRAINS, YIELD_KEYS, type Yields } from '../rules/terrain';
import { PARADROP_RANGE, UNITS } from '../rules/units';
import { centreHere, homeShift, landY, projectInto, toScreen } from './camera';
import { bar, drawFigures, figuresShowing } from './combatfx';
import { cut } from './fog';
import { iconBitmap, resourceGlyph, unitGlyph, YIELD_COLOR } from './icons';
import { activeLens, drawLens } from './lenses';
import { marchingAt } from './models3d';
import { drawPins } from './pins';
import { drawWorkTips } from './workadvice';
import { previewPath, routeOf, type Route } from './path';
import { mapFont } from './pixel';
import { cityAt, enemyAt, me, myUnit, reachOf, attackable, store, TEAM_COLORS, tone } from './store';

/**
 * Drawn over the world each frame, in the world's place on the screen (over the fog's veil,
 * `fog.ts`): the hex grid, each civ's borders, resources (and improvements, when the world's blocks
 * are too far off to tell, or pillaged), natural wonders' badges (and names, close up), units' flags
 * (Civilization's way: a badge in its civ's colours) and cities' banners, what's selected, where it
 * can go and the path it would take (the turn each leg ends on), what it could attack, the yields of
 * every tile (the lens) or of an open city's, and the fights. Shapes of one look go a few to a path.
 * Round a world that wraps, each is drawn at its tile's copy nearest the camera (`centreHere`), and a
 * way across the seam step by step from where it starts (the shorter way round).
 */

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;

/** Something drawn on the map that a click can land on: a unit's flag, a city's banner. */
export interface Hit {
  tile: number;
  unit?: number;
  city?: number;
}
/** This frame's flags and banners where they were drawn (screen pixels), in the order drawn. */
let hits: { x0: number; y0: number; x1: number; y1: number; hit: Hit }[] = [];
/** A point on the screen, worked out without making anything (a tile's middle, where a unit's tile meets the ground). */
const spot = new Float64Array(2);
/** The interface's scale this frame (`store.uiScale`): the marks over the map are drawn that much larger. */
let ui = 1;

/** The units whose flags were drawn inside a box on the screen (their middles in it). */
export function flagsIn(b: { x0: number; y0: number; x1: number; y1: number }): number[] {
  const [left, right, top, bottom] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1), Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
  return hits
    .filter((r) => r.hit.unit !== undefined && (r.x0 + r.x1) / 2 >= left && (r.x0 + r.x1) / 2 <= right && (r.y0 + r.y1) / 2 >= top && (r.y0 + r.y1) / 2 <= bottom)
    .map((r) => r.hit.unit!);
}

/** How big a target a finger needs (CSS pixels): flags and banners smaller than this are reached from this far round them. */
const FINGER = 44;

/** The flag or banner under a screen point (the one drawn on top), or null; on a touch screen, the nearest within a finger's reach of it. */
export function hitAt(x: number, y: number): Hit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const r = hits[i];
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return r.hit;
  }
  if (!matchMedia('(pointer: coarse)').matches) return null;
  let best: Hit | null = null;
  let near = Infinity;
  for (const r of hits) {
    const padX = Math.max(0, (FINGER - (r.x1 - r.x0)) / 2);
    const padY = Math.max(0, (FINGER - (r.y1 - r.y0)) / 2);
    if (x < r.x0 - padX || x > r.x1 + padX || y < r.y0 - padY || y > r.y1 + padY) continue;
    const d = Math.hypot(x - (r.x0 + r.x1) / 2, y - (r.y0 + r.y1) / 2);
    if (d < near) [best, near] = [r.hit, d];
  }
  return best;
}

export function mountOverlay(layer: HTMLElement) {
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  layer.append(canvas);
  ctx = canvas.getContext('2d')!;
}

/** A tile's height on screen: the land's top (hills and mountains higher). */
export const tileY = landY;

const colorOf = (owner: number) => CIVS[store.view?.players[owner]?.civ ?? '']?.color ?? '#888';
const accentOf = (owner: number) => CIVS[store.view?.players[owner]?.civ ?? '']?.accent ?? '#fff';

/** Each improvement's glyph, by the side of its tile. */
const IMPROVEMENT_GLYPH: Record<string, string> = {
  farm: 'wheat', mine: 'pick', trading_post: 'gold', lumber_mill: 'axe', pasture: 'cattle', camp: 'deer', plantation: 'leaf', quarry: 'stone', fishing_boats: 'fish',
  oil_well: 'oil', offshore_platform: 'oil', fort: 'shield', citadel: 'tower', academy: 'science', customs_house: 'gold', manufactory: 'gear', holy_site: 'faith', landmark: 'frame',
};

/** A box's path, on whole pixels (the pixel look: square corners). */
function boxPath(x: number, y: number, w: number, h: number, on: CanvasRenderingContext2D = ctx) {
  on.beginPath();
  on.rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** A dot's path: a square `r` from its middle (the pixel look's round thing). */
function dotPath(x: number, y: number, r: number, on: CanvasRenderingContext2D = ctx) {
  boxPath(x - r, y - r, r * 2, r * 2, on);
}

/** A block: filled, lit along its top and left, shaded along its bottom and right, edged dark. */
function block(x: number, y: number, w: number, h: number, fill: string, edge = '#07090c') {
  [x, y, w, h] = [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
  ctx.fillStyle = edge;
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x, y, w, 2);
  ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillRect(x + w - 2, y, 2, h);
}

/** Text with a hard dark shadow two pixels down and right. */
function shadowText(text: string, x: number, y: number, color: string) {
  ctx.fillStyle = '#0b0d12';
  ctx.fillText(text, Math.round(x) + 2, Math.round(y) + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x), Math.round(y));
}

/** A glyph drawn centred at (x, y), `size` across (to the pixel), in a colour (once its picture's ready): its pixels unscaled, so crisp. */
function glyph(name: string, x: number, y: number, size: number, color: string, on: CanvasRenderingContext2D = ctx): boolean {
  const px = Math.max(6, Math.round(size));
  // (A bitmap of it at the screen's pixels: drawing the SVG itself costs its rendering every time.)
  const img = iconBitmap(name, px, color, Math.min(2, window.devicePixelRatio || 1));
  if (!img) return false;
  on.drawImage(img, Math.round(x - px / 2), Math.round(y - px / 2), px, px);
  return true;
}

/**
 * A unit's flag (a block in its civ's colour, edged, its kind's glyph on it) as a picture, made once
 * for each look and size: a screen full of units is a picture copied for each, not a path filled
 * and stroked and a glyph drawn. Kept for the flags' size now (zooming makes them again). Null while
 * its glyph's picture is still coming (the flag's drawn as before meanwhile).
 */
const flagSprites = new Map<string, HTMLCanvasElement>();
let flagSpriteSize = 0;
/** Room round a flag's picture for its edge (pixels). */
const FLAG_PAD = 2;

function flagSprite(w: number, fill: string, edge: string, lineWidth: number, glyphName: string, glyphColor: string): HTMLCanvasElement | null {
  if (w !== flagSpriteSize) {
    flagSprites.clear();
    flagSpriteSize = w;
  }
  const key = `${fill}|${edge}|${lineWidth}|${glyphName}|${glyphColor}`;
  const had = flagSprites.get(key);
  if (had) return had;
  const px = Math.max(6, Math.round(w * 0.7));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const icon = iconBitmap(glyphName, px, glyphColor, dpr);
  if (!icon) return null;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = Math.ceil((w + FLAG_PAD * 2) * dpr);
  const c = sprite.getContext('2d')!;
  c.scale(dpr, dpr);
  c.beginPath();
  c.rect(FLAG_PAD, FLAG_PAD, w, w);
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = lineWidth;
  c.strokeStyle = edge;
  c.stroke();
  c.drawImage(icon, FLAG_PAD + Math.round((w - px) / 2), FLAG_PAD + Math.round((w - px) / 2), px, px);
  flagSprites.set(key, sprite);
  return sprite;
}

/** A tile's hexagon (shrunk toward its middle by `shrink`) added to a path; false if it's off the screen. */
function hexInto(p: CanvasPath, t: number, y: number, shrink = 1): boolean {
  const g = store.grid!;
  const c = centre(g, t);
  const home = homeShift(c.x);
  const pts: { x: number; y: number }[] = [];
  for (const k of corners(g, t)) {
    const s = toScreen(c.x + home + (k.x - c.x) * shrink, y, c.z + (k.z - c.z) * shrink);
    if (!s) return false;
    pts.push(s);
  }
  p.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) p.lineTo(pts[i].x, pts[i].y);
  p.closePath();
  return true;
}

/** A hex's corners from its middle (blocks), clockwise from the top, as `corners()` places them. */
const CORNER_OFFSETS = Array.from({ length: 6 }, (_, i) => ({ x: HEX * Math.cos((Math.PI / 180) * (60 * i - 90)), z: HEX * Math.sin((Math.PI / 180) * (60 * i - 90)) }));

/** A tile's six corners on the screen into `xy` from `at` (x, y pairs); false if any is behind the camera. */
function cornersInto(xy: Float64Array, at: number, t: number, y: number): boolean {
  const g = store.grid!;
  const c = centreHere(g, t);
  // (Round a world that wraps, its hexes are a hair wider or narrower: `hexW`.)
  const sx = g.wrap ? hexW(g) / HEX_W : 1;
  for (let i = 0; i < 6; i++) if (!projectInto(xy, at + i * 2, c.x + CORNER_OFFSETS[i].x * sx, y, c.z + CORNER_OFFSETS[i].z)) return false;
  return true;
}

/**
 * Shapes of one look a few to a path: `add(i)` adds shape i, `draw()` fills or strokes those added.
 * Chrome draws a handful of small paths far faster than one at a time, and one huge path slowest of all.
 */
const BATCH = 8;
function batched(count: number, add: (i: number) => void, draw: () => void, size = BATCH) {
  for (let j = 0; j < count; j += size) {
    ctx.beginPath();
    for (let i = j; i < Math.min(count, j + size); i++) add(i);
    draw();
  }
}

function hexPath(t: number, y: number, shrink = 1): boolean {
  ctx.beginPath();
  return hexInto(ctx, t, y, shrink);
}

/** Each yield's glyph on the map. */
const YIELD_GLYPH: Record<string, string> = { food: 'food', prod: 'prod', gold: 'gold', science: 'science', culture: 'culture', faith: 'faith' };

/** How a tile's yields are shown: on the lens, worked by the open city, or one it could work. */
type BadgeLook = 'lens' | 'worked' | 'idle';

const badges = new Map<string, HTMLCanvasElement>();
// (Made again once the type has come: any made before it are in a stand-in face.)
document.fonts?.addEventListener('loadingdone', () => badges.clear());

/**
 * A tile's yields as a small picture, made once for each set of yields, size and look: each yield's
 * glyph and amount on a dark pill, or (small) a coloured pip with the amount for each.
 */
function yieldBadge(y: Yields, size: number, look: BadgeLook, dpr: number): HTMLCanvasElement | null {
  const items = YIELD_KEYS.filter((k) => (y[k] ?? 0) > 0);
  if (!items.length) return null;
  const key = `${items.map((k) => `${k}${y[k]}`).join('')}|${size}|${look}|${dpr}`;
  const had = badges.get(key);
  if (had) return had;
  const pips = size < 11;
  const font = mapFont(Math.round(size * (pips ? 0.78 : 0.92)));
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = font;
  const pad = pips ? 2 : 4;
  const widths = items.map((k) => (pips ? size : size + 2 + measure.measureText(String(y[k])).width));
  const gap = pips ? 1.5 : 4;
  const w = Math.ceil(widths.reduce((s, x) => s + x, 0) + gap * (items.length - 1) + pad * 2);
  const h = Math.ceil(size + pad * 2);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * dpr);
  cv.height = Math.ceil(h * dpr);
  const c = cv.getContext('2d')!;
  c.scale(dpr, dpr);
  c.globalAlpha = look === 'idle' ? 0.82 : 1;
  c.fillStyle = look === 'worked' ? 'rgba(28,22,8,0.92)' : 'rgba(10,14,20,0.78)';
  boxPath(0, 0, w, h, c);
  c.fill();
  if (look === 'worked') {
    c.strokeStyle = '#f2c14e';
    c.lineWidth = 1.5;
    c.stroke();
  }
  c.font = font;
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  let x = pad;
  for (let i = 0; i < items.length; i++) {
    const k = items[i];
    const colour = YIELD_COLOR[k];
    if (pips) {
      c.fillStyle = colour;
      dotPath(x + size / 2, h / 2, size / 2, c);
      c.fill();
      c.fillStyle = '#10161e';
      c.fillText(String(y[k]), x + size / 2, h / 2 + 0.5);
    } else {
      if (!glyph(YIELD_GLYPH[k], x + size / 2, h / 2, size, colour, c)) return null;
      c.fillStyle = colour;
      c.textAlign = 'left';
      c.fillText(String(y[k]), x + size + 1.5, h / 2 + 0.5);
    }
    x += widths[i] + gap;
  }
  if (badges.size > 600) badges.clear();
  badges.set(key, cv);
  return cv;
}

/** Where a tile's yields badge goes on the screen, and its size there (null: off the screen, or too small to read). */
function badgeAt(t: number): { x: number; y: number; size: number } | null {
  const c = centreHere(store.grid!, t);
  const y = tileY(t) + 0.3;
  const s = toScreen(c.x, y, c.z);
  const e = toScreen(c.x + HEX, y, c.z);
  if (!s || !e) return null;
  const r = Math.abs(e.x - s.x) / store.uiFit;
  return r < 15 ? null : { x: s.x, y: s.y, size: Math.round(Math.min(14, Math.max(7, r * 0.25)) * ui) };
}

/** A tile's yields drawn centred at a point (nothing if it yields nothing); its badge's size on the screen. */
function drawYields(y: Yields, x: number, sy: number, size: number, look: BadgeLook, dpr: number): { w: number; h: number } {
  const b = yieldBadge(y, size, look, dpr);
  if (!b) return { w: 0, h: 0 };
  const w = b.width / dpr;
  const h = b.height / dpr;
  ctx.drawImage(b, Math.round(x - w / 2), Math.round(sy - h / 2), w, h);
  return { w, h };
}

/** Each frame: everything over the world. */
export function drawOverlay(now: number) {
  if (!canvas) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  hits = [];
  const g = store.grid;
  const view = store.view;
  // (Nothing to draw where it can't be seen: a panel over all the map.)
  if (!g || !view || store.interfaceHidden || store.mapCovered) return;
  const n = g.width * g.height;
  // Which tiles are on screen (with a margin), back to front.
  const shown: number[] = [];
  for (let t = 0; t < n; t++) {
    const c = centreHere(g, t);
    if (projectInto(spot, 0, c.x, tileY(t), c.z) && spot[0] > -80 && spot[0] < w + 80 && spot[1] > -80 && spot[1] < h + 120) shown.push(t);
  }
  const across = (() => {
    const c = centreHere(g, shown[0] ?? 0);
    const a = toScreen(c.x, SEA_Y, c.z);
    const b = toScreen(c.x + 3.5, SEA_Y, c.z);
    return a && b ? Math.abs(b.x - a.x) : 20;
  })();
  // The marks over the tiles (badges, flags, banners, pins) are the interface's, drawn as it is, `ui`
  // times larger (`store.uiScale`): sized by a tile as the screen's fit has it (`zoomed`: a big
  // screen's marks are a smaller one's, scaled), times the player's size for them.
  ui = store.uiScale;
  const zoomed = across / store.uiFit;
  const known = store.known;

  // Grid and each civ's tint: each known tile's corners found once, then drawn a few hexes to a path.
  const drawn: number[] = [];
  const xy = new Float64Array(shown.length * 12);
  for (const t of shown) if (known[t] && cornersInto(xy, drawn.length * 12, t, tileY(t))) drawn.push(t);
  const trace = (i: number) => {
    const o = i * 12;
    ctx.moveTo(xy[o], xy[o + 1]);
    for (let k = 2; k < 12; k += 2) ctx.lineTo(xy[o + k], xy[o + k + 1]);
    ctx.closePath();
  };
  const owners = new Map<number, number[]>();
  drawn.forEach((t, i) => {
    const owner = known[t]!.owner;
    if (owner < 0) return;
    const list = owners.get(owner);
    if (list) list.push(i);
    else owners.set(owner, [i]);
  });
  for (const [owner, list] of owners) {
    ctx.fillStyle = colorOf(owner) + '22';
    batched(list.length, (i) => trace(list[i]), () => ctx.fill());
  }
  if (across > 9) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    batched(drawn.length, trace, () => ctx.stroke());
  }
  // Borders: edges between a civ's tile and someone else's (or no one's), inset a little.
  const edges = new Map<number, number[]>();
  drawn.forEach((t, i) => {
    const k = known[t]!;
    if (k.owner < 0) return;
    const o = i * 12;
    const cx = (xy[o] + xy[o + 6]) / 2;
    const cy = (xy[o + 1] + xy[o + 7]) / 2;
    for (let d = 0; d < 6; d++) {
      const nb = neighbour(g, t, d);
      if (nb >= 0 && known[nb]?.owner === k.owner) continue;
      // Direction d's edge: between corners (d+1) and (d+2) going clockwise from the top (E is between 1 and 2).
      const [a, b] = edgeCorners(d);
      let list = edges.get(k.owner);
      if (!list) edges.set(k.owner, (list = []));
      list.push(cx + (xy[o + a * 2] - cx) * 0.94, cy + (xy[o + a * 2 + 1] - cy) * 0.94, cx + (xy[o + b * 2] - cx) * 0.94, cy + (xy[o + b * 2 + 1] - cy) * 0.94);
    }
  });
  ctx.lineWidth = Math.max(2, across * 0.18);
  for (const [owner, list] of edges) {
    ctx.strokeStyle = colorOf(owner);
    batched(
      list.length / 4,
      (i) => {
        ctx.moveTo(list[i * 4], list[i * 4 + 1]);
        ctx.lineTo(list[i * 4 + 2], list[i * 4 + 3]);
      },
      () => ctx.stroke(),
      BATCH * 6,
    );
  }
  // Resources (the things themselves stand on their tiles, `resources3d.ts`: a small badge in a corner,
  // growing less as the map's zoomed in; the resources lens draws its own), improvements (the world
  // shows them in blocks: a badge only far off, or pillaged), ruins. The badges go either side of the
  // tile's back, where its improvement stands (`improvements.ts`): in its front corners, as the camera
  // sees them, they were nearer the next tile's improvement than their own. Under a unit's flag,
  // which fills a tile's back, they keep to its front corners.
  if (zoomed > 7) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const resourceLens = activeLens() === 'resources';
    const flagged = new Set<number>();
    for (const u of view.units) if (known[u.tile]?.visible || u.owner === me()) flagged.add(u.tile);
    for (const t of shown) {
      const k = known[t];
      if (!k) continue;
      const c = centreHere(g, t);
      const cornerZ = flagged.has(t) ? 1.2 : -1.5;
      if (k.resource && !cityAt(t) && !resourceLens) {
        const r = RESOURCES[k.resource];
        const s = toScreen(c.x + 1.6, tileY(t), c.z + cornerZ);
        if (s && r) {
          const rad = Math.max(7, Math.min(zoomed * 0.36, 7 + zoomed * 0.08)) * ui;
          ctx.fillStyle = 'rgba(13,19,27,0.86)';
          dotPath(s.x, s.y, rad);
          ctx.fill();
          ctx.strokeStyle = r.kind === 'luxury' ? '#f2c14e' : r.kind === 'strategic' ? '#ff7a6a' : 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          glyph(resourceGlyph(k.resource), s.x, s.y, rad * 1.25, r.color);
        }
      }
      if (k.improvement && (zoomed < 12 || k.pillaged)) {
        const s = toScreen(c.x - 1.6, tileY(t), c.z + cornerZ);
        if (s) {
          const rad = Math.max(6, zoomed * 0.3) * ui;
          ctx.fillStyle = k.pillaged ? 'rgba(120,30,20,0.85)' : 'rgba(13,19,27,0.75)';
          dotPath(s.x, s.y, rad);
          ctx.fill();
          glyph(IMPROVEMENT_GLYPH[k.improvement] ?? 'hammer', s.x, s.y, rad * 1.3, k.pillaged ? '#ff9a8e' : '#f0d8a8');
        }
      }
      if (k.ruin) {
        const s = toScreen(c.x, tileY(t) + 2.4, c.z);
        if (s) glyph('urn', s.x, s.y, Math.max(12, zoomed * 0.6) * ui, '#f2c14e');
      }
    }
  }
  // What's on the ground under the cloud is hidden by it (the fog itself is `fog.ts`'s).
  cut(ctx);

  // The lens on show (`lenses.ts`); the yields lens's every known tile's yields (an open city's own
  // tiles are drawn with it, below).
  const selCity = store.selectedCity !== null ? view.cities.find((c) => c.id === store.selectedCity) : undefined;
  const info = selCity && store.cityInfo?.id === selCity.id ? store.cityInfo : null;
  const cityTiles = new Set(info?.tiles.map((x) => x.t) ?? []);
  const lens = activeLens();
  if (lens && lens !== 'yields') drawLens({ ctx, hex: hexInto, glyph, zoomed, ui }, shown);
  if (lens === 'yields') {
    for (const t of shown) {
      const y = store.yields[t];
      const k = known[t];
      // (Fallout: a sickly badge over what little it yields, so the land lost to it shows.)
      if (k?.feature === 'fallout' && !cityTiles.has(t)) {
        const at = badgeAt(t);
        if (at) {
          const rad = at.size * 0.9;
          const fy = at.y - (y ? at.size * 1.6 : 0);
          ctx.fillStyle = 'rgba(40,52,12,0.88)';
          dotPath(at.x, fy, rad);
          ctx.fill();
          glyph('mushroom', at.x, fy, rad * 1.4, '#c8e85a');
        }
      }
      if (!y || !k || cityTiles.has(t)) continue;
      const at = badgeAt(t);
      // (Far off, open sea's the same everywhere: only what's worth a look there.)
      if (!at || (at.size < 11 && TERRAINS[store.terrain[t]?.terrain]?.water && !k.resource && !k.improvement && k.owner < 0)) continue;
      drawYields(y, at.x, at.y, at.size, 'lens', dpr);
    }
  }
  if (selCity && info) drawCityTiles(selCity, info, dpr);

  // Natural wonders: a badge at the foot of each known one (of a pair, its first tile seen), and its name close up.
  const badged = new Set<string>();
  for (const t of shown) {
    const w = NATURAL_WONDERS[known[t]?.wonder ?? ''];
    if (!w || badged.has(w.id)) continue;
    badged.add(w.id);
    const c = centreHere(g, t);
    const s = toScreen(c.x, SEA_Y + 1.6, c.z + HEX * 0.72);
    if (!s) continue;
    const rad = Math.max(8, Math.min(15, zoomed * 0.4)) * ui;
    ctx.fillStyle = 'rgba(13,19,27,0.88)';
    dotPath(s.x, s.y, rad);
    ctx.fill();
    ctx.strokeStyle = w.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    glyph('peak', s.x, s.y, rad * 1.3, '#f6e7b8');
    if (zoomed < 14) continue;
    const fs = Math.round(Math.min(13, Math.max(10, zoomed * 0.38)) * ui);
    ctx.font = mapFont(fs);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(w.name).width;
    ctx.fillStyle = 'rgba(13,19,27,0.82)';
    boxPath(s.x + rad + 2, s.y - fs * 0.8, tw + fs, fs * 1.6);
    ctx.fill();
    ctx.fillStyle = '#f6e7b8';
    ctx.fillText(w.name, s.x + rad + 2 + fs / 2, s.y + 0.5);
  }

  // What's selected: what it could attack, where it can go (the turn each leg ends), the tile under the mouse.
  const sel = myUnit(store.selectedUnit);
  if (sel) {
    // A soldier selected: where enemy cities' walls reach (two tiles), and the shots of the enemy's
    // ranged units in sight, a red hatch, so a way into their fire shows.
    const soldier = UNITS[sel.type];
    if (soldier && (soldier.strength > 0 || soldier.ranged) && soldier.domain !== 'air') {
      const reach = new Path2D();
      const under = new Set<number>();
      const war = (owner: number) => owner !== me() && !!view.players[owner]?.war;
      for (const c of view.cities) {
        if (!war(c.owner) || !known[c.tile]) continue;
        for (const t of within(g, c.tile, 2)) if (t !== c.tile) under.add(t);
      }
      for (const u of view.units) {
        const type = UNITS[u.type];
        if (!war(u.owner) || !type?.ranged || type.domain === 'air' || !known[u.tile]?.visible) continue;
        for (const t of within(g, u.tile, reachOf(u))) if (t !== u.tile) under.add(t);
      }
      for (const t of under) if (known[t]) hexInto(reach, t, tileY(t), 0.98);
      ctx.fillStyle = 'rgba(255,90,74,0.14)';
      ctx.fill(reach);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,90,74,0.5)';
      ctx.stroke(reach);
    }
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffd23a';
    if (hexPath(sel.tile, tileY(sel.tile), 0.9)) ctx.stroke();
    const hover = store.hover;
    if ((sel.moves ?? 0) > 0 && !sel.attacked) {
      const targets = new Path2D();
      for (const t of within(g, sel.tile, reachOf(sel))) if (attackable(sel, t)) hexInto(targets, t, tileY(t), 0.86);
      ctx.fillStyle = 'rgba(255,90,74,0.16)';
      ctx.fill(targets);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ff5a4a';
      ctx.stroke(targets);
    }
    // Its orders: where it's going, solid, to a flag; the way to the tile under the mouse, if that's
    // somewhere else, dashed on top (so an order given is never mistaken for a way only looked at).
    const committed = routeOf(sel);
    if (committed) drawPath(sel.tile, committed, 'committed', now);
    const goal = committed?.tiles[committed.tiles.length - 1];
    if (hover >= 0 && hover !== sel.tile && attackable(sel, hover)) drawTarget(hover);
    else if (hover >= 0 && hover !== sel.tile && hover !== goal) {
      const preview = previewPath(sel, hover);
      if (preview) drawPath(sel.tile, preview, 'preview', now);
      else if (known[hover]) {
        // No way there.
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,107,94,0.85)';
        if (hexPath(hover, tileY(hover), 0.9)) ctx.stroke();
      }
    }
  }
  // Your other units on their way: faintly, each to its flag.
  for (const u of view.units) if (u.owner === me() && u.id !== store.selectedUnit && u.path?.length) {
    const route = routeOf(u, true);
    if (route) drawPath(u.tile, route, 'faint', now);
  }
  if (store.hover >= 0 && known[store.hover]) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    if (hexPath(store.hover, tileY(store.hover), 0.96)) ctx.stroke();
  }
  // A city taking aim: its reach, and the enemies in it ringed.
  const aiming = store.cityTarget !== null ? view.cities.find((c) => c.id === store.cityTarget) : undefined;
  if (aiming) {
    ctx.lineWidth = 2;
    for (const t of within(g, aiming.tile, 2)) {
      const enemy = view.units.some((u) => u.tile === t && u.owner !== me() && view.players[u.owner]?.war && known[t]?.visible);
      ctx.strokeStyle = enemy ? '#ff5a4a' : 'rgba(255,90,74,0.3)';
      ctx.fillStyle = 'rgba(255,90,74,0.18)';
      if (!hexPath(t, tileY(t), enemy ? 0.86 : 0.96)) continue;
      if (enemy) ctx.fill();
      ctx.stroke();
    }
    if (store.hover >= 0 && store.hover !== aiming.tile && enemyAt(store.hover)) drawTarget(store.hover);
  }
  // A unit choosing where to go by air: where it can (a paratrooper, empty land it knows within its
  // drop's reach; an airlift, your other cities with an airport), outlined.
  const flier = store.unitAim ? view.units.find((u) => u.id === store.unitAim!.unit) : undefined;
  if (flier && store.unitAim) {
    const places = store.unitAim.order === 'paradrop'
      ? within(g, flier.tile, PARADROP_RANGE).filter((t) => t !== flier.tile && known[t] && !TERRAINS[store.terrain[t]?.terrain]?.water && store.terrain[t]?.elevation !== 'mountain' && !view.units.some((u) => u.tile === t) && !cityAt(t))
      : view.cities.filter((c) => c.owner === me() && c.tile !== flier.tile && c.buildings?.includes('airport')).map((c) => c.tile);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(106,184,255,0.75)';
    ctx.fillStyle = 'rgba(106,184,255,0.14)';
    for (const t of places) {
      if (!hexPath(t, tileY(t), 0.9)) continue;
      ctx.fill();
      ctx.stroke();
    }
  }

  // Units: a flag each (civilian and military on one tile side by side).
  const byTile = new Map<number, typeof view.units>();
  for (const u of view.units) {
    if (!known[u.tile]?.visible && u.owner !== me()) continue;
    const list = byTile.get(u.tile) ?? [];
    list.push(u);
    byTile.set(u.tile, list);
  }
  const size = Math.max(9, Math.min(22, zoomed * 0.75)) * ui;
  // (A city's banner, drawn over its tile's flags, is this tall: the flags of its garrison hang under it, where they can be clicked.)
  const bannerH = Math.max(10, Math.min(14, zoomed * 0.52)) * 2 * ui;
  // Where each flag goes, and (not under a city's banner) the line from it down to the ground: the
  // lines all drawn first, one path, then the flags over them.
  const flags: { u: (typeof view.units)[number]; t: number; x: number; y: number }[] = [];
  const fw = Math.round(size * 1.5);
  ctx.beginPath();
  for (const [t, list] of byTile) {
    const c = centreHere(g, t);
    const garrison = !!cityAt(t) && !!known[t];
    const banner = garrison ? toScreen(c.x, tileY(t) + 6, c.z) : null;
    list.forEach((u, i) => {
      const off = list.length > 1 ? (i === 0 ? -0.9 : 0.9) : 0;
      // (On the march, over its model.)
      const walking = marchingAt(u.id);
      const s = walking
        ? toScreen(walking.x, walking.y + 4.4, walking.z)
        : banner
          ? { x: banner.x + (list.length > 1 ? (i === 0 ? -1 : 1) * (fw / 2 + 2) : 0), y: banner.y + bannerH / 2 + 9 * ui + fw / 2 }
          : toScreen(c.x + off, tileY(t) + 4.4, c.z);
      if (!s) return;
      flags.push({ u, t, x: s.x, y: s.y });
      if (!banner && projectInto(spot, 0, c.x + off, tileY(t), c.z)) {
        ctx.moveTo(s.x, s.y + size * 0.75);
        ctx.lineTo(spot[0], spot[1]);
      }
    });
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  for (const { u, t, x, y } of flags) {
    const own = u.owner === me();
    // Its flag: a block in its civ's colour, its kind's glyph, edged white if it's waiting for orders, gold if it's chosen.
    const waiting = own && (u.moves ?? 0) > 0 && !u.stance && !u.work && !u.path?.length;
    hits.push({ x0: x - fw / 2 - 2, y0: y - fw / 2 - 2, x1: x + fw / 2 + 2, y1: y + fw / 2 + 2, hit: { tile: t, unit: u.id } });
    const chosen = u.id === store.selectedUnit || store.group.includes(u.id);
    const lineWidth = chosen ? 3 : 1.5;
    const edge = chosen ? '#f2c14e' : waiting ? '#ffffff' : 'rgba(0,0,0,0.55)';
    const sprite = flagSprite(fw, colorOf(u.owner), edge, lineWidth, unitGlyph(u.type), accentOf(u.owner));
    if (sprite) ctx.drawImage(sprite, Math.round(x - fw / 2) - FLAG_PAD, Math.round(y - fw / 2) - FLAG_PAD, fw + FLAG_PAD * 2, fw + FLAG_PAD * 2);
    else {
      boxPath(x - fw / 2, y - fw / 2, fw, fw);
      ctx.fillStyle = colorOf(u.owner);
      ctx.fill();
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = edge;
      ctx.stroke();
      glyph(unitGlyph(u.type), x, y, fw * 0.7, accentOf(u.owner));
    }
    // Hurt: a bar under it (a blow's loss draining out of it, white).
    const hp = bar(u.id, u.hp, t, u.id, now);
    if (hp.ghost < 100) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      const bh = Math.round(3 * ui);
      ctx.fillRect(x - fw / 2, y + fw / 2 + 2, fw, bh);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - fw / 2, y + fw / 2 + 2, fw * (hp.ghost / 100), bh);
      ctx.fillStyle = hp.hp > 50 ? tone('#6fd27a') : hp.hp > 25 ? '#f2c14e' : tone('#ff6b5e');
      ctx.fillRect(x - fw / 2, y + fw / 2 + 2, fw * (hp.hp / 100), bh);
    }
    // Fortified, asleep, working: a small sign at its corner.
    const sign = u.stance === 'fortify' ? 'shield' : u.stance === 'sleep' ? 'turn' : u.work ? 'hammer' : '';
    if (sign && own) {
      ctx.fillStyle = 'rgba(13,19,27,0.9)';
      dotPath(x + fw / 2, y - fw / 2, size * 0.42);
      ctx.fill();
      glyph(sign, x + fw / 2, y - fw / 2, size * 0.6, '#ffffff');
    }
  }

  // Cities: a banner over each (the town itself is a model, `models3d.ts`).
  for (const city of view.cities) {
    if (!known[city.tile]) continue;
    const c = centreHere(g, city.tile);
    const s = toScreen(c.x, tileY(city.tile) + 6, c.z);
    if (!s) continue;
    const own = city.owner === me();
    const owner = store.view!.players[city.owner];
    const fs = Math.max(10, Math.min(14, zoomed * 0.52)) * ui;
    ctx.font = mapFont(fs);
    const label = city.name;
    const tw = ctx.measureText(label).width;
    const bh = Math.round(fs * 2);
    const bw = Math.round(bh + tw + fs * 1.4 + (city.capital ? fs * 1.2 : 0) + (own && city.building ? bh : 0));
    const x0 = Math.round(s.x - bw / 2);
    const y0 = Math.round(s.y - bh / 2);
    const mid = y0 + bh / 2;
    hits.push({ x0, y0, x1: x0 + bw, y1: y0 + bh, hit: { tile: city.tile, city: city.id } });
    // The banner: a name tag (dark, edged in black, or in gold when it's open), its people on a block in the civ's colour.
    ctx.fillStyle = city.id === store.selectedCity ? '#f2c14e' : '#07090c';
    ctx.fillRect(x0 - 2, y0 - 2, bw + 4, bh + 4);
    ctx.fillStyle = 'rgba(16,19,26,0.9)';
    ctx.fillRect(x0, y0, bw, bh);
    block(x0, y0, bh, bh, colorOf(city.owner), 'rgba(0,0,0,0)');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    shadowText(String(city.pop), x0 + bh / 2, mid + 1, accentOf(city.owner));
    let x = x0 + bh + fs * 0.5;
    if (city.capital) {
      glyph('crown', x + fs * 0.5, mid, fs * 1.05, '#f2c14e');
      x += fs * 1.2;
    }
    ctx.textAlign = 'left';
    shadowText(label, x, mid + 1, owner?.cityState ? '#e9eef3' : '#ffffff');
    // Its owner's team: a small numbered tab at the banner's left end.
    if (typeof owner?.team === 'number') {
      const side = Math.round(fs * 1.15);
      const tx = x0 - side - 3;
      const ty = Math.round(mid - side / 2);
      ctx.fillStyle = '#07090c';
      ctx.fillRect(tx - 2, ty - 2, side + 4, side + 4);
      ctx.fillStyle = TEAM_COLORS[owner.team] ?? '#555';
      ctx.fillRect(tx, ty, side, side);
      ctx.textAlign = 'center';
      ctx.font = mapFont(fs * 0.9);
      shadowText(String(owner.team + 1), tx + side / 2, ty + side / 2 + 1, '#ffffff');
      ctx.font = mapFont(fs);
    }
    // Its own: what it's building and how long, at the right (the block fills as it's built).
    if (own && city.building) {
      const side = bh - 8;
      const bx = x0 + bw - side - 4;
      const by = y0 + 4;
      ctx.fillStyle = 'rgba(240,162,74,0.22)';
      ctx.fillRect(bx, by, side, side);
      const done = Math.round(side * Math.min(1, city.building.progress));
      ctx.fillStyle = 'rgba(240,162,74,0.55)';
      ctx.fillRect(bx, by + side - done, side, done);
      ctx.strokeStyle = '#f0a24a';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, by + 1, side - 2, side - 2);
      ctx.textAlign = 'center';
      ctx.font = mapFont(fs * 0.85);
      shadowText(String(city.building.turns), bx + side / 2, by + side / 2 + 1, '#ffe1b0');
    }
    // Damaged: its health under the banner; growing (its own): food over it.
    const barX = x0 + bh + 2;
    const barW = bw - bh - 2;
    const hp = bar(-1 - city.id, city.hp, city.tile, -city.id, now);
    if (hp.ghost < city.maxHp) {
      ctx.fillStyle = '#07090c';
      ctx.fillRect(barX - 2, y0 + bh + 2, barW + 2, 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(barX, y0 + bh + 4, Math.round((barW - 2) * (hp.ghost / city.maxHp)), 2);
      ctx.fillStyle = tone('#6fd27a');
      ctx.fillRect(barX, y0 + bh + 4, Math.round((barW - 2) * (hp.hp / city.maxHp)), 2);
    }
    if (own && city.foodNeed) {
      ctx.fillStyle = '#07090c';
      ctx.fillRect(barX - 2, y0 - 8, barW + 2, 6);
      ctx.fillStyle = '#7bd16a';
      ctx.fillRect(barX, y0 - 6, Math.round((barW - 2) * Math.min(1, (city.food ?? 0) / city.foodNeed)), 2);
    }
  }

  // The selected worker's recommended work (`workadvice.ts`): low on its tiles, clear of the flags and banners.
  drawWorkTips({ ctx, hex: hexInto, glyph, zoomed, ui }, hits);

  // Map pins (`pins.ts`): over the rest, where they can't be missed.
  drawPins({ ctx, hex: hexInto, glyph, zoomed, ui }, hits);

  // Fights: the damage done, rising over each side as the blow lands (`combatfx.ts`).
  store.fights = store.fights.filter((f) => figuresShowing(f, now) || now - f.t < 3);
  drawFigures(ctx, now, 22 * ui);
  // A box being dragged with shift held: the soldiers it gathers.
  const b = store.box;
  if (b) {
    boxPath(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    ctx.fillStyle = 'rgba(255,210,58,0.08)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffd23a';
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** The two corners (clockwise from the top) bounding the edge toward direction d (east, north-east, ...). */
function edgeCorners(d: number): [number, number] {
  // Corners from the top: 0 top, 1 upper right, 2 lower right, 3 bottom, 4 lower left, 5 upper left.
  // Directions: 0 east, 1 north-east, 2 north-west, 3 west, 4 south-west, 5 south-east.
  return ([[1, 2], [0, 1], [5, 0], [4, 5], [3, 4], [2, 3]] as [number, number][])[d];
}

/** A route, step by step, with a marker where each turn's moves run out and at its end: the turn it's reached on (1: this one). */
/**
 * A unit's way: its orders ('committed': a solid gold line, the turn each leg ends, a flag where it's
 * going, waving harder just after the order's given), the way to where the mouse is ('preview':
 * dashed and pale, its turns marked), or another unit's orders ('faint': a thin line to its flag).
 */
function drawPath(from: number, route: Route, kind: 'committed' | 'preview' | 'faint', now: number) {
  const g = store.grid!;
  const n = route.tiles.length;
  ctx.strokeStyle = kind === 'committed' ? '#ffd23a' : kind === 'preview' ? 'rgba(255,255,255,0.8)' : 'rgba(255,210,58,0.5)';
  ctx.lineWidth = kind === 'faint' ? 2 : 3;
  ctx.setLineDash(kind === 'preview' ? [6, 5] : []);
  ctx.beginPath();
  // (Each step from the last: round a world that wraps, across the seam the shorter way.)
  const a = centreHere(g, from);
  const at: { x: number; z: number }[] = [];
  for (const t of route.tiles) at.push(centreNear(g, t, (at[at.length - 1] ?? a).x));
  const s0 = toScreen(a.x, tileY(from) + 0.3, a.z);
  if (s0) ctx.moveTo(s0.x, s0.y);
  route.tiles.forEach((t, i) => {
    const s = toScreen(at[i].x, tileY(t) + 0.3, at[i].z);
    if (s) ctx.lineTo(s.x, s.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    if (kind === 'faint' && !last) continue;
    if (!last && route.turns[i + 1] === route.turns[i]) continue;
    const t = route.tiles[i];
    const c = at[i];
    const s = toScreen(c.x, tileY(t) + 0.5, c.z);
    if (!s) continue;
    if (last && kind !== 'preview') {
      const o = store.ordered;
      const fresh = o?.taken && o.to === t ? Math.max(0, 1 - (now - o.at) / 1.6) : 0;
      drawFlag(s.x, s.y, kind === 'faint' ? 0.8 : 1 + 0.5 * fresh * Math.abs(Math.sin((now - (o?.at ?? 0)) * 9)), kind === 'faint');
      if (kind === 'faint') continue;
    }
    const r = Math.round((last ? 10 : 9) * ui);
    const y = last && kind !== 'preview' ? s.y + 16 * ui : s.y;
    block(s.x - r, y - r, r * 2, r * 2, '#0e1a24', last ? '#ffd23a' : 'rgba(255,255,255,0.75)');
    ctx.font = mapFont((last ? 12 : 11) * ui);
    shadowText(String(route.turns[i] + 1), s.x, y + 1, last ? '#ffd23a' : '#ffffff');
  }
}

/** Where a unit's been ordered to: a little gold flag on a pole (bigger by `size`; pale, for a unit not selected). */
function drawFlag(x: number, y: number, size: number, pale: boolean) {
  const k = Math.max(1, Math.round(2 * size * ui));
  x = Math.round(x);
  y = Math.round(y);
  ctx.globalAlpha = pale ? 0.7 : 1;
  ctx.fillStyle = '#07090c';
  ctx.fillRect(x - 1, y - 9 * k, k + 2, 9 * k + 2);
  ctx.fillRect(x + k - 1, y - 9 * k - 1, 6 * k + 2, 4 * k + 2);
  ctx.fillStyle = '#e8e2d0';
  ctx.fillRect(x, y - 9 * k, k, 9 * k);
  ctx.fillStyle = '#ffd23a';
  ctx.fillRect(x + k, y - 9 * k, 6 * k, 4 * k);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x + k, y - 9 * k, 6 * k, k);
  ctx.globalAlpha = 1;
}

/** An enemy under the mouse that the selection could attack: a red sight on it. */
function drawTarget(t: number) {
  const g = store.grid!;
  const c = centreHere(g, t);
  const s = toScreen(c.x, tileY(t) + 0.4, c.z);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ff5a4a';
  if (hexPath(t, tileY(t), 0.86)) ctx.stroke();
  if (!s) return;
  // A sight of square corners, a cross through it.
  const [x, y] = [Math.round(s.x) + 0.5, Math.round(s.y) + 0.5];
  ctx.lineWidth = 2;
  ctx.lineCap = 'square';
  ctx.beginPath();
  for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    ctx.moveTo(x + dx * 10 * ui, y + dy * 5 * ui);
    ctx.lineTo(x + dx * 10 * ui, y + dy * 10 * ui);
    ctx.lineTo(x + dx * 5 * ui, y + dy * 10 * ui);
  }
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(x + dx * 3 * ui, y + dy * 3 * ui);
    ctx.lineTo(x + dx * 15 * ui, y + dy * 15 * ui);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/**
 * An open city's land: each tile it could work with its yields, a citizen on the ones worked (a lock
 * on those placed by hand), the gold price on those it could buy, and the tile its borders take next.
 */
function drawCityTiles(city: CityWire, info: CityInfo, dpr: number) {
  const gold = store.view!.self.gold;
  if (info.nextTile !== null) {
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = YIELD_COLOR.culture;
    if (hexPath(info.nextTile, tileY(info.nextTile), 0.9)) ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const x of info.tiles) {
    const s = badgeAt(x.t);
    if (!s) continue;
    const size = s.size;
    const worked = !!city.worked?.includes(x.t);
    const badge = drawYields(x.yields, s.x, s.y, size, worked ? 'worked' : 'idle', dpr);
    const h = badge.h || size;
    if (worked) {
      // (At the badge's left: a unit's flag stands above the tile.)
      const r = size * 0.62;
      const cx = s.x - badge.w / 2 - r - 1;
      ctx.fillStyle = '#f2c14e';
      dotPath(cx, s.y, r);
      ctx.fill();
      glyph(city.locked?.includes(x.t) ? 'lock' : 'pop', cx, s.y, r * 1.3, '#1b1407');
    }
    if (x.buyCost !== null) {
      const fs = Math.max(9, size * 0.85);
      ctx.font = mapFont(fs);
      const label = String(x.buyCost);
      const w = fs + 4 + ctx.measureText(label).width + 10;
      const th = fs + 6;
      const ty = s.y + h / 2 + 3;
      ctx.fillStyle = 'rgba(40,30,8,0.9)';
      boxPath(s.x - w / 2, ty, w, th);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = gold >= x.buyCost ? 'rgba(246,207,74,0.8)' : 'rgba(255,138,122,0.6)';
      ctx.stroke();
      glyph('gold', s.x - w / 2 + 5 + fs / 2, ty + th / 2, fs, '#f6cf4a');
      ctx.fillStyle = gold >= x.buyCost ? '#ffe39a' : '#ff9a8e';
      ctx.fillText(label, s.x - w / 2 + 7 + fs, ty + th / 2 + 0.5);
    }
  }
}
