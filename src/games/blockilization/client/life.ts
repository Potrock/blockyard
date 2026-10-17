import type { Client, Node } from '@platform/client';
import { SEA_Y } from '../geometry';
import type { ModelId } from '../modelids';
import { neighbours, type Grid } from '../rules/hex';
import { light } from './budget';
import { cam, centreHere, homeShift, pick, toScreen } from './camera';
import { groundAt, modelItem } from './models3d';
import { store } from './store';

/**
 * The world going about its life when nothing's happening, on this screen: fishing boats out on the
 * waters fished (one riding at anchor, one working its nets slowly round the tile), and flocks of
 * birds wheeling over the woods near where the camera looks, beating their wings and gliding. Only
 * near the screen; the flocks only over what the viewer can see, the boats where they were last
 * seen (still, out of sight).
 */

/** A boat's size (a voxel a sixteenth of a block at 1), how far the working one goes round, and how long it takes (seconds). */
const BOAT_SCALE = 1.7;
const ROUND = 1.9;
const ROUND_SECONDS = 46;
/** Flocks at most, birds in each, their size, how high over the land and how wide they wheel (blocks). */
const FLOCKS = 2;
const BIRDS = 4;
const BIRD_SCALE = 1;
const FLY_HEIGHT = 8;
const WHEEL = 3.2;
/** Seconds between looks at whether a flock should move on (its woods gone off the screen). */
const LOOK_AGAIN = 4;
/** Zoomed out further than this, the birds are too small to see; in closer than this, they'd fly in the camera's face: not drawn. */
const BIRDS_FAR = 95;
const BIRDS_NEAR = 34;

/** A model in a holder at a scale (null until its file is here). */
function model(client: Client, id: ModelId, scale: number): Node | null {
  const made = client.scene.item(modelItem(id));
  if (!made) return null;
  const holder = client.scene.node();
  made.node.scale.setScalar(scale);
  holder.add(made.node);
  client.scene.add(holder);
  return holder;
}

const onScreen = (x: number, y: number, z: number, margin: number) => {
  const s = toScreen(x, y, z);
  return !!s && s.x > -margin && s.x < window.innerWidth + margin && s.y > -margin && s.y < window.innerHeight + margin;
};

// -------------------------------------------------------------------------------------------------
// Fishing boats

const boats = new Map<number, [Node, Node]>();
let boatsFor: object | null = null;
let fished: number[] = [];

function drawBoats(client: Client) {
  const g = store.grid!;
  if (boatsFor !== store.known) {
    boatsFor = store.known;
    fished = [];
    store.known.forEach((k, t) => {
      if (k?.improvement === 'fishing_boats' && !k.pillaged) fished.push(t);
    });
    for (const [t, pair] of boats)
      if (!fished.includes(t)) {
        for (const n of pair) client.scene.remove(n);
        boats.delete(t);
      }
  }
  const now = client.time;
  for (const t of fished) {
    const c = centreHere(g, t);
    const near = onScreen(c.x, SEA_Y, c.z, 80);
    let pair = boats.get(t);
    if (!pair) {
      if (!near) continue;
      const a = model(client, 'u_boat', BOAT_SCALE);
      const b = model(client, 'u_boat', BOAT_SCALE);
      if (!a || !b) continue;
      pair = [a, b];
      boats.set(t, pair);
    }
    const live = store.known[t]?.visible ? now : 0;
    const [anchored, working] = pair;
    anchored.visible = working.visible = near;
    if (!near) continue;
    // At anchor: riding the swell. Working: slowly round the tile, its nets out.
    const seed = t * 1.618;
    anchored.position.set(c.x - 1.4, SEA_Y + 0.75 + Math.sin(live * 1.5 + seed) * 0.05, c.z + 0.8);
    anchored.rotation.set(Math.sin(live * 1.2 + seed) * 0.06, seed, 0);
    const a = (live / ROUND_SECONDS) * Math.PI * 2 + seed;
    working.position.set(c.x + Math.cos(a) * ROUND, SEA_Y + 0.75 + Math.sin(live * 1.7 + seed) * 0.05, c.z + Math.sin(a) * ROUND);
    working.rotation.set(Math.sin(live * 1.4 + seed) * 0.06, -a, 0);
  }
}

// -------------------------------------------------------------------------------------------------
// Birds

interface Flock {
  /** The woods it wheels over (-1: none yet), their middle and how high the land is there. */
  tile: number;
  x: number;
  y: number;
  z: number;
  /** Each bird: wings spread and wings up (shown in turn as it beats them), and its own number. */
  birds: { spread: Node; up: Node; seed: number }[];
  next: number;
}

const flocks: Flock[] = [];

const wooded = (t: number) => {
  const k = t >= 0 ? store.known[t] : null;
  return !!k?.visible && (k.feature === 'forest' || k.feature === 'jungle');
};

/** Deep woods the viewer can see on the screen (wooded all round, mostly: not a copse by a town), found by looking at a few points of it: a tile, or -1. */
function someWoods(g: Grid): number {
  for (let i = 0; i < 10; i++) {
    const t = pick(window.innerWidth * (0.15 + Math.random() * 0.7), window.innerHeight * (0.15 + Math.random() * 0.7));
    if (wooded(t) && neighbours(g, t).filter(wooded).length >= 4 && !flocks.some((f) => f.tile === t)) return t;
  }
  return -1;
}

function drawBirds(client: Client) {
  const g = store.grid!;
  const now = client.time;
  while (flocks.length < FLOCKS) {
    const birds: Flock['birds'] = [];
    for (let i = 0; i < BIRDS; i++) {
      const spread = model(client, 'm_bird', BIRD_SCALE);
      const up = model(client, 'm_bird2', BIRD_SCALE);
      if (!spread || !up) {
        for (const n of [...birds.flatMap((b) => [b.spread, b.up]), spread, up]) if (n) client.scene.remove(n);
        return;
      }
      birds.push({ spread, up, seed: Math.random() * 100 });
    }
    flocks.push({ tile: -1, x: 0, y: 0, z: 0, birds, next: now + flocks.length * 1.3 });
  }
  const far = cam.dist > BIRDS_FAR || cam.dist < BIRDS_NEAR || light();
  for (const f of flocks) {
    // (Round a world that wraps, over the copy of its woods nearest the camera.)
    f.x += homeShift(f.x);
    // Its woods gone from the screen (or out of sight): off to others on it.
    if (now >= f.next) {
      f.next = now + LOOK_AGAIN;
      const k = f.tile >= 0 ? store.known[f.tile] : null;
      if (!k?.visible || !onScreen(f.x, f.y, f.z, 0)) {
        f.tile = someWoods(g);
        if (f.tile >= 0) {
          const c = centreHere(g, f.tile);
          f.x = c.x;
          f.z = c.z;
          f.y = groundAt(client, f.tile, c.x, c.z) + FLY_HEIGHT;
        }
      }
    }
    const shown = f.tile >= 0 && !far;
    for (const [i, b] of f.birds.entries()) {
      if (!shown) {
        b.spread.visible = b.up.visible = false;
        continue;
      }
      // Round the woods, each bird its own way out and up, beating its wings, now and then gliding.
      const a = now * 0.45 + (i / BIRDS) * Math.PI * 2 + Math.sin(now * 0.3 + b.seed) * 0.4;
      const r = WHEEL * (0.7 + 0.3 * Math.sin(b.seed)) + Math.sin(now * 0.5 + b.seed) * 0.6;
      b.spread.position.set(f.x + Math.cos(a) * r, f.y + Math.sin(now * 0.8 + b.seed) * 0.8 + (i % 3) * 0.6, f.z + Math.sin(a) * r);
      b.spread.rotation.set(0, -a, Math.sin(now * 0.9 + b.seed) * 0.15 - 0.25);
      b.up.position.copy(b.spread.position);
      b.up.rotation.copy(b.spread.rotation);
      const gliding = Math.sin(now * 0.25 + b.seed) > 0.4;
      const beat = !gliding && Math.sin(now * 14 + b.seed * 3) > 0;
      b.up.visible = beat;
      b.spread.visible = !beat;
    }
  }
}

/** Each frame: the boats and the birds. */
export function drawLife(client: Client) {
  if (!store.view || !store.grid) return;
  drawBoats(client);
  drawBirds(client);
}

/** A new map: what's alive on the old one goes. */
export function resetLife(client: Client) {
  for (const pair of boats.values()) for (const n of pair) client.scene.remove(n);
  boats.clear();
  boatsFor = null;
  fished = [];
  for (const f of flocks) for (const b of f.birds) for (const n of [b.spread, b.up]) client.scene.remove(n);
  flocks.length = 0;
}
