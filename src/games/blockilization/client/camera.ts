import type { Client } from '@platform/client';
import { baseX, centre, centreNear, extent, period, SEA_Y, tileAt } from '../geometry';
import type { Grid } from '../rules/hex';
import { jolt } from './combatfx';
import { store } from './store';

/**
 * The strategy camera: looking down on the map at a slant (north up the screen), panned with the keys
 * or by dragging, zoomed with the wheel, eased to a tile when something wants looking at. The screen's
 * camera is taken every frame (`client.camera.take`), so this works out the same projection itself:
 * where a point in the world lands on the screen (for the overlay), and which tile is under the mouse.
 *
 * Round a world that wraps (`geometry.ts`), the camera pans east and west without end: it's kept
 * within the world as built by a jump of exactly its period whenever it leaves (the screen draws the
 * world repeated, so that's seamless), and everything this screen draws at a tile it draws at the
 * tile's copy nearest the camera (`centreHere`, `homeShift`). It can't zoom out so far that the view
 * is wider than the world (a copy would show twice).
 */

const PITCH = (58 * Math.PI) / 180;
const FOV = 45;
const MIN = 18;
const MAX = 150;
/** How far off the camera looks while the world's being built (blocks). */
const AWAY = 4000;

export const cam = {
  x: 100,
  z: 80,
  // (Closer on a phone: its screen is small, and the world far off would be tiny on it.)
  dist: typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 520 ? 44 : 70,
  /** Easing toward a spot (a unit, a notification's tile). */
  goal: null as null | { x: number; z: number },
  keys: new Set<string>(),
};

/** The view this frame: the camera's position, its right, up and forward, its focal length and the screen's size (CSS pixels). */
export interface Basis {
  px: number;
  py: number;
  pz: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  fx: number;
  fy: number;
  fz: number;
  focal: number;
  w: number;
  h: number;
}

let basis: Basis | null = null;

/** The camera's pose this frame, from where it looks and how far. */
function pose() {
  const ty = SEA_Y + 1;
  const px = cam.x;
  const py = ty + cam.dist * Math.sin(PITCH);
  const pz = cam.z + cam.dist * Math.cos(PITCH);
  return { position: { x: px, y: py, z: pz }, target: { x: cam.x, y: ty, z: cam.z } };
}

/** Each frame: move with the keys, ease to a goal, keep to the map, and take the screen's camera. */
export function frameCamera(client: Client, dt: number) {
  measureWonders(client);
  const speed = cam.dist * 1.2 * dt;
  if (cam.keys.has('KeyW') || cam.keys.has('ArrowUp')) cam.z -= speed;
  if (cam.keys.has('KeyS') || cam.keys.has('ArrowDown')) cam.z += speed;
  if (cam.keys.has('KeyA') || cam.keys.has('ArrowLeft')) cam.x -= speed;
  if (cam.keys.has('KeyD') || cam.keys.has('ArrowRight')) cam.x += speed;
  if (cam.goal) {
    const k = 1 - Math.exp(-dt * 6);
    cam.x += (cam.goal.x - cam.x) * k;
    cam.z += (cam.goal.z - cam.z) * k;
    if (Math.hypot(cam.goal.x - cam.x, cam.goal.z - cam.z) < 0.3) cam.goal = null;
  }
  if (store.grid) {
    const size = extent(store.grid);
    if (store.grid.wrap) {
      // East and west without end: back into the world as built by whole periods, the goal with it.
      const k = Math.floor(cam.x / size.w);
      if (k) {
        cam.x -= k * size.w;
        if (cam.goal) cam.goal.x -= k * size.w;
      }
      cam.dist = Math.min(cam.dist, farthest(store.grid));
    } else cam.x = Math.max(0, Math.min(size.w, cam.x));
    cam.z = Math.max(-10, Math.min(size.d, cam.z));
  }
  const p = pose();
  // A kill just landed: the view jolted a moment (the overlay with it).
  const j = jolt(client.time);
  for (const q of [p.position, p.target]) {
    q.x += j.x;
    q.z += j.z;
  }
  // While the world's being built, it looks far off (as the server means its screens to: with the
  // map's ground loaded, a screen draws it again for each of the thousands of blocks set), and comes
  // back to the finished map.
  const away = store.lobby?.phase === 'building' ? AWAY : 0;
  client.camera.take({ position: { ...p.position, x: p.position.x + away }, target: { ...p.target, x: p.target.x + away }, fov: FOV });
  // The projection for the overlay and picking.
  const w = window.innerWidth;
  const h = window.innerHeight;
  let fx = p.target.x - p.position.x;
  let fy = p.target.y - p.position.y;
  let fz = p.target.z - p.position.z;
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // Right = forward × up(0,1,0); up' = right × forward.
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = 0 * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - 0 * fx;
  basis = { px: p.position.x, py: p.position.y, pz: p.position.z, rx, ry: 0, rz, ux, uy, uz, fx, fy, fz, focal: h / 2 / Math.tan(((FOV / 2) * Math.PI) / 180), w, h };
}

/** The view this frame (null before the first). */
export const viewBasis = (): Readonly<Basis> | null => basis;

/** Where a world point lands on the screen (null: behind the camera). */
export function toScreen(x: number, y: number, z: number): { x: number; y: number; depth: number } | null {
  const b = basis;
  if (!b) return null;
  const dx = x - b.px;
  const dy = y - b.py;
  const dz = z - b.pz;
  const cz = dx * b.fx + dy * b.fy + dz * b.fz;
  if (cz < 0.1) return null;
  const cx = dx * b.rx + dy * b.ry + dz * b.rz;
  const cy = dx * b.ux + dy * b.uy + dz * b.uz;
  return { x: b.w / 2 + (cx / cz) * b.focal, y: b.h / 2 - (cy / cz) * b.focal, depth: cz };
}

/** Where a world point lands on the screen, written into `out` at `at` (x, then y) without making an object; false if it's behind the camera. */
export function projectInto(out: Float64Array, at: number, x: number, y: number, z: number): boolean {
  const b = basis;
  if (!b) return false;
  const dx = x - b.px;
  const dy = y - b.py;
  const dz = z - b.pz;
  const cz = dx * b.fx + dy * b.fy + dz * b.fz;
  if (cz < 0.1) return false;
  out[at] = b.w / 2 + ((dx * b.rx + dy * b.ry + dz * b.rz) / cz) * b.focal;
  out[at + 1] = b.h / 2 - ((dx * b.ux + dy * b.uy + dz * b.uz) / cz) * b.focal;
  return true;
}

/** The point on the map (at the land's height) under a screen point. */
export function toGround(sx: number, sy: number, y = SEA_Y + 1.5): { x: number; z: number } | null {
  const b = basis;
  if (!b) return null;
  const cx = (sx - b.w / 2) / b.focal;
  const cy = -(sy - b.h / 2) / b.focal;
  const dx = b.fx + b.rx * cx + b.ux * cy;
  const dy = b.fy + b.ry * cx + b.uy * cy;
  const dz = b.fz + b.rz * cx + b.uz * cy;
  if (dy > -1e-6) return null;
  const k = (y - b.py) / dy;
  return { x: b.px + dx * k, z: b.pz + dz * k };
}

/** A tile's land as high as the mouse should find it: the top of its ground (hills and mountains higher; a natural wonder's as its landmark stands). */
export function landY(t: number): number {
  const s = store.terrain[t];
  if (!s) return SEA_Y + 1;
  const wonder = wonderGround.get(t);
  if (wonder !== undefined && store.known[t]?.wonder) return wonder;
  if (s.terrain === 'ocean' || s.terrain === 'coast' || s.terrain === 'lake') return SEA_Y + 0.9;
  if (s.elevation === 'hills') return SEA_Y + 3.2;
  if (s.elevation === 'mountain') return SEA_Y + 2 + s.height * 0.6;
  return SEA_Y + 1.6;
}

/**
 * The tile under a screen point (-1: none): down the mouse's ray from above the highest land, the
 * first tile it passes under the top of (so a hill or a mountain is picked where it's drawn, not
 * where the ray would meet the sea behind it).
 */
export function pick(sx: number, sy: number): number {
  const grid = store.grid;
  if (!grid) return -1;
  for (let y = SEA_Y + 12; y > SEA_Y + 0.9; y -= 0.25) {
    const g = toGround(sx, sy, y);
    if (!g) return -1;
    const t = tileAt(grid, g.x, g.z);
    if (t >= 0 && y <= landY(t)) return t;
  }
  const g = toGround(sx, sy, SEA_Y + 0.9);
  return g ? tileAt(grid, g.x, g.z) : -1;
}

/**
 * How far out the camera may be (its distance): on a world that wraps, no further than where the
 * view at its far edge (the top of the screen, at the sea) is as wide as the world, at the screen's
 * shape now.
 */
function farthest(g: Grid | null): number {
  if (!g?.wrap) return MAX;
  const t = Math.tan((FOV / 2) * (Math.PI / 180));
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  // The view's width where its top edge meets the sea, for a camera `d` away: 2·aspect·t·(d·sin + rise) / (sin − cos·t).
  const d = (period(g) * (Math.sin(PITCH) - Math.cos(PITCH) * t)) / (2 * aspect * t) - 1;
  return Math.max(MIN, Math.min(MAX, d / Math.sin(PITCH)));
}

export function zoom(by: number) {
  cam.dist = Math.max(MIN, Math.min(farthest(store.grid), cam.dist * by));
}

/** The camera eased to a point (on a world that wraps, the copy of it nearest the camera). */
export function lookAt(x: number, z: number) {
  cam.goal = { x: x + homeShift(x), z };
}

/** What to add to an x (blocks) to bring it to its copy nearest the camera: whole periods round a world that wraps (0 on a flat one). */
export function homeShift(x: number): number {
  const g = store.grid;
  if (!g?.wrap) return 0;
  const p = period(g);
  return p * Math.round((cam.x - x) / p);
}

/** A tile's middle on this screen: on a world that wraps, at its copy nearest the camera (on a flat one, its `centre`). */
export const centreHere = (g: Grid, t: number) => centreNear(g, t, cam.x);

/**
 * The ground of a natural wonder's tile as its landmark stands (`landmarks.ts`): Emerald Falls' plateau
 * ten blocks up, a crater's floor, a reef's water. The grid, the borders, the units and the mouse go
 * by it (by the tile's usual height they cut across a cliff's face, and a border ringed a plateau's
 * foot, hidden behind its falls). Measured once from the world's blocks, when they're here: the height
 * most of the tile stands at (a lowish share of its columns' tops, so an arch, a spire or a tree's
 * crown over part of it doesn't lift the rest), not counting trees, falls, mist or cloud.
 */
const wonderGround = new Map<number, number>();
let measuredFor: Grid | null = null;
const OVER_GROUND = new Set(['civ_trunk', 'civ_leaves', 'civ_pine', 'civ_jungle', 'civ_fern', 'civ_tuft', 'civ_drygrass', 'civ_reeds', 'civ_falls', 'civ_cloud', 'civ_mist', 'civ_halo', 'civ_bark', 'civ_goldleaf', 'civ_palm']);

function measureWonders(client: Client) {
  const g = store.grid;
  if (!g) return;
  if (measuredFor !== g) {
    wonderGround.clear();
    triedAt.clear();
    measuredFor = g;
  }
  // (A few a frame at most: each reads a few hundred blocks. One whose blocks aren't here yet is tried again a second later.)
  const now = performance.now();
  let budget = 2;
  for (let t = 0; t < store.known.length && budget > 0; t++) {
    if (!store.known[t]?.wonder || wonderGround.has(t) || (triedAt.get(t) ?? -Infinity) > now - 1000) continue;
    budget--;
    triedAt.set(t, now);
    const y = groundOf(client, g, t);
    if (y !== null) wonderGround.set(t, y);
  }
}
const triedAt = new Map<number, number>();

/** The height most of a tile stands at, from the world's blocks (null: they aren't here yet). */
function groundOf(client: Client, g: Grid, t: number): number | null {
  const c = centre(g, t);
  const tops: number[] = [];
  for (let x = Math.floor(c.x - 4); x <= c.x + 4; x++)
    for (let z = Math.floor(c.z - 4); z <= c.z + 4; z++) {
      if (tileAt(g, x + 0.5, z + 0.5) !== t) continue;
      // (Round a world that wraps, the blocks are those of the base copy.)
      const bx = g.wrap ? baseX(g, x) : x;
      for (let y = SEA_Y + 16; y >= SEA_Y - 2; y--) {
        const b = client.world.blockAt(bx, y, z);
        if (b === 'air' || OVER_GROUND.has(b)) continue;
        tops.push(y);
        break;
      }
    }
  // (Nothing found: the tile's blocks aren't loaded on this screen yet.)
  if (tops.length < 6) return null;
  tops.sort((a, b) => a - b);
  // (As the usual heights: a flat tile's top block is SEA_Y + 1, and its land is drawn at SEA_Y + 1.6.)
  return tops[Math.floor(tops.length * 0.3)] + 0.6;
}
