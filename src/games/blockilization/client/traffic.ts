import type { Client, Node } from '@platform/client';
import { centre, centreNear, HEX_W, SEA_Y } from '../geometry';
import { line, neighbours, type Grid } from '../rules/hex';
import { TERRAINS } from '../rules/terrain';
import { homeShift, toScreen } from './camera';
import { groundAt, unitHolder } from './models3d';
import { store } from './store';

/**
 * Trade on the map, as Civilization shows it: each trade route this screen knows of plied by its
 * caravan (a cargo ship by sea), back and forth between its two cities without end, along the way
 * one would go (over the land round the water and the mountains, or over the water), resting a
 * moment in each city. Seen only where the viewer can see, and only on the screen (round a world
 * that wraps, its way the short way over the seam, and it at its copy nearest the camera).
 */

/** Seconds a caravan takes over a tile, and rests in a city before setting back. */
const TILE_SECONDS = 1.4;
const REST = 2;
const SPEED = HEX_W / TILE_SECONDS;

interface Plied {
  node: Node;
  sea: boolean;
  /** Its way (tiles, and their middles), how long that is (blocks), and where in its round trip it starts (seconds). */
  tiles: number[];
  pts: { x: number; z: number }[];
  len: number;
  offset: number;
}

const plied = new Map<string, Plied>();
let grid: Grid | null = null;

/** A tile a caravan (or by sea, a ship) can cross: dry land that isn't a mountain, or water. */
function crossable(t: number, sea: boolean): boolean {
  const s = store.terrain[t];
  if (!s) return false;
  const water = !!TERRAINS[s.terrain]?.water;
  return sea ? water : !water && s.elevation !== 'mountain';
}

/** The way between two cities: the fewest tiles it can cross (the cities themselves always), else the straight line. */
function way(g: Grid, from: number, to: number, sea: boolean): number[] {
  const back = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !back.has(to); i++)
    for (const n of neighbours(g, queue[i]))
      if (!back.has(n) && (n === to || crossable(n, sea))) {
        back.set(n, queue[i]);
        queue.push(n);
      }
  if (!back.has(to)) return line(g, from, to);
  const out: number[] = [];
  for (let t = to; t !== -1; t = back.get(t)!) out.unshift(t);
  return out;
}

/** A small number in [0, 1) for a route, the same each time (where its caravan starts on its round). */
const hash = (a: number, b: number) => ((Math.imul(a + 7919, 73856093) ^ Math.imul(b + 13, 19349663)) >>> 0) / 4294967296;

/** Each frame: the trade routes' caravans and ships, where they've got to. */
export function drawTraffic(client: Client) {
  const v = store.view;
  const g = store.grid;
  if (!v || !g || g !== grid) {
    for (const p of plied.values()) client.scene.remove(p.node);
    plied.clear();
    grid = g;
    if (!v || !g) return;
  }
  const keep = new Set<string>();
  for (const r of v.traffic ?? []) {
    const key = `${r.from}|${r.to}|${r.sea ? 1 : 0}`;
    keep.add(key);
    if (plied.has(key)) continue;
    const node = unitHolder(client, r.sea ? 'u_cargo' : 'u_caravan');
    if (!node) continue;
    const tiles = way(g, r.from, r.to, r.sea);
    const pts: { x: number; z: number }[] = [];
    for (const t of tiles) pts.push(pts.length ? centreNear(g, t, pts[pts.length - 1].x) : centre(g, t));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    node.visible = false;
    client.scene.add(node);
    plied.set(key, { node, sea: r.sea, tiles, pts, len, offset: hash(r.from, r.to) * 1000 });
  }
  for (const [key, p] of plied)
    if (!keep.has(key)) {
      client.scene.remove(p.node);
      plied.delete(key);
    }
  const now = client.time;
  for (const p of plied.values()) {
    // Its round trip: rest, there, rest, back.
    const going = p.len / SPEED;
    const round = 2 * (REST + going);
    const k = (now + p.offset) % round;
    const out = k >= REST && k < REST + going;
    const home = k >= 2 * REST + going;
    if ((!out && !home) || p.pts.length < 2) {
      p.node.visible = false;
      continue;
    }
    const along = out ? (k - REST) * SPEED : p.len - (k - 2 * REST - going) * SPEED;
    // Where it is along its way, and the tile it's on.
    let at = along;
    let i = 1;
    for (; i < p.pts.length - 1; i++) {
      const l = Math.hypot(p.pts[i].x - p.pts[i - 1].x, p.pts[i].z - p.pts[i - 1].z);
      if (at <= l) break;
      at -= l;
    }
    const a = p.pts[i - 1];
    const b = p.pts[i];
    const f = Math.min(1, at / (Math.hypot(b.x - a.x, b.z - a.z) || 1));
    let x = a.x + (b.x - a.x) * f;
    x += homeShift(x);
    const z = a.z + (b.z - a.z) * f;
    const tile = p.tiles[f < 0.5 ? i - 1 : i];
    const y = p.sea ? SEA_Y + 0.75 : groundAt(client, tile, x, z);
    const s = toScreen(x, y, z);
    const shown = !!store.known[tile]?.visible && !!s && s.x > -80 && s.x < window.innerWidth + 80 && s.y > -80 && s.y < window.innerHeight + 80;
    p.node.visible = shown;
    if (!shown) continue;
    // A ship rocks; a caravan's beasts plod.
    const lift = p.sea ? Math.sin(now * 1.7 + p.offset) * 0.06 : Math.abs(Math.sin(along * 1.1)) * 0.12;
    p.node.position.set(x, y + lift, z);
    p.node.rotation.set(p.sea ? Math.sin(now * 1.3 + p.offset) * 0.05 : 0, Math.atan2(b.x - a.x, b.z - a.z) + (out ? 0 : Math.PI), 0);
  }
}
