import type { Client, Node } from '@platform/client';
import type { View } from '../protocol';
import { light } from './budget';

/**
 * A world wonder rising as it's finished: on the screen that sees it built, its model (beside its
 * city, `models3d.ts`) waits a moment for the camera to get there, then rises out of the ground,
 * rumbling, dust thrown up round its foot, and settles with a flash and a last puff. Only a wonder
 * new since the last view rises (seen as `View.wonders` gains it, as `moments.ts` sees it); every
 * wonder already there at a load, a reconnect or another player's view on a shared screen just
 * stands. Client-only, and only moves the model's holder: if anything is missing it simply stands.
 */

/** A wonder's model as a town shows it: its holder, where it stands (in its town's node) and how tall it is (blocks). */
export interface WonderShown {
  node: Node;
  x: number;
  y: number;
  z: number;
  height: number;
  across: number;
}

/** Seconds: hidden while the camera goes to it, rising, then settling. */
const HOLD = 0.7;
const RISE = 1.5;
const SETTLE = 0.35;
/** Seconds a wonder seen built waits to be drawn (its city not in sight yet, its model not loaded) before it just stands. */
const FRESH_FOR = 20;
/** Dust round its foot as it rises: every so often (seconds). */
const DUST_EVERY = 0.07;
const DUST: [number, number, number] = [0.5, 0.42, 0.3];

/** The last view seen, wonders seen built since (and when), and the wonders rising (by city and wonder). */
let lastView: View | null = null;
const fresh = new Map<string, number>();
const rising = new Map<string, { city: number; wonder: string; start: number; dust: number; stage: 0 | 1 | 2 }>();

const riseKey = (city: number, wonder: string) => `${city}|${wonder}`;

/** Each frame: a new view's newly built wonders noted (none at the first view, or another player's). */
export function watchWonders(v: View, now: number) {
  if (v === lastView) return;
  const prev = lastView;
  lastView = v;
  for (const [w, t] of fresh) if (now - t > FRESH_FOR) fresh.delete(w);
  if (!prev || prev.you !== v.you || !v.wonders) return;
  for (const [id, owner] of Object.entries(v.wonders)) if (owner >= 0 && prev.wonders?.[id] === undefined) fresh.set(id, now);
}

/** A town just built with a wonder in it: if it's new, it starts to rise (once). */
export function startRise(city: number, wonder: string, now: number) {
  const t = fresh.get(wonder);
  if (t === undefined) return;
  fresh.delete(wonder);
  if (now - t > FRESH_FOR) return;
  rising.set(riseKey(city, wonder), { city, wonder, start: now + HOLD, dust: 0, stage: 0 });
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;

/**
 * Each frame: the rising wonders moved. `find` gives a wonder's model as its town shows it now (a
 * town rebuilt while one rises gives the new one) and that town's node (where its x is, round a
 * world that wraps).
 */
export function riseWonders(client: Client, find: (city: number, wonder: string) => { w: WonderShown; town: Node } | null) {
  if (!rising.size) return;
  const now = client.time;
  const fx = client.fx;
  const few = light();
  for (const [key, r] of rising) {
    const got = find(r.city, r.wonder);
    const k = now - r.start;
    if (!got) {
      // (Its town's gone, or not drawn yet: it waits a little, then it's dropped.)
      if (k > RISE + SETTLE + FRESH_FOR) rising.delete(key);
      continue;
    }
    const { w, town } = got;
    const n = w.node;
    const foot = { x: town.position.x + w.x, y: w.y + 0.2, z: town.position.z + w.z };
    const reach = Math.max(1, w.across * 0.5);
    if (k < 0) {
      n.visible = false;
      continue;
    }
    n.visible = true;
    if (k < RISE) {
      const u = k / RISE;
      if (r.stage === 0) {
        r.stage = 1;
        fx.shockwave(foot, reach + 1.5, '#d8c49a');
        fx.particles(foot, DUST, { count: few ? 14 : 30, speed: 2.2, size: 0.45, gravity: 1, life: 1.2, spread: reach, up: 1, drag: 1.5, collide: false });
      }
      const rumble = 0.06 * (1 - u);
      n.position.set(w.x + Math.sin(now * 47) * rumble, w.y - (w.height + 0.3) * (1 - easeOut(u)), w.z + Math.cos(now * 39) * rumble);
      n.scale.set(1, 1, 1);
      if (now >= r.dust) {
        r.dust = now + DUST_EVERY * (few ? 2 : 1);
        const a = Math.random() * Math.PI * 2;
        fx.particles({ x: foot.x + Math.cos(a) * reach, y: foot.y, z: foot.z + Math.sin(a) * reach }, DUST, { count: 3, speed: 0.5, size: 0.5, gravity: -0.4, life: 1.3, spread: 0.5, up: 0.8, drag: 1, collide: false });
      }
      continue;
    }
    if (k < RISE + SETTLE) {
      // Down: a flash and a puff as it lands, and a little squash.
      if (r.stage < 2) {
        r.stage = 2;
        fx.flare({ x: foot.x, y: w.y + w.height * 0.6, z: foot.z }, 2.5);
        fx.particles(foot, DUST, { count: few ? 16 : 36, speed: 2.6, size: 0.4, gravity: 1.5, life: 1, spread: reach, up: 0.7, drag: 1.6, collide: false });
      }
      const s = Math.sin(((k - RISE) / SETTLE) * Math.PI);
      n.position.set(w.x, w.y, w.z);
      n.scale.set(1 + 0.04 * s, 1 - 0.07 * s, 1 + 0.04 * s);
      continue;
    }
    n.position.set(w.x, w.y, w.z);
    n.scale.set(1, 1, 1);
    rising.delete(key);
  }
}

/** A new map, or no view: nothing rises, and the next view is a first one. */
export function resetRises() {
  lastView = null;
  fresh.clear();
  rising.clear();
}
