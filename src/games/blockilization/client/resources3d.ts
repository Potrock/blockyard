import type { Client, Node } from '@platform/client';
import { centre } from '../geometry';
import { MODEL_IDS, type ModelId } from '../modelids';
import type { KnownTile, View } from '../protocol';
import { neighbour, type Grid } from '../rules/hex';
import { TERRAINS } from '../rules/terrain';
import { light } from './budget';
import { cam, homeShift, landY, toScreen } from './camera';
import { wonderPicture } from './icons';
import { modelItem, standingOn } from './models3d';
import { corners, dry, facing, fit, hash, KINDS, OPEN, PEN_SCALE, reachOf, spotsFor, SURFACE, topOf, type Kind, type Life } from './spots';
import { store } from './store';

/**
 * Each tile's resource, seen on the tile itself (Civilization's way, not only its badge): a few little
 * voxel models of it (`tools/resources.mjs`) set beside the units in the tile's middle, clear of its
 * trees, buildings and road. Beasts graze and turn, fish circle, a whale surfaces and blows, crabs
 * scuttle; crops, trees and the ground's riches stand still. With an improvement they go with it: a
 * pasture's fence holds the resource's own beasts, a plantation's rows show its crop, a mine its ore,
 * fishing boats sit by the fish. Each stands wholly on its own tile, none over a neighbour's, and a
 * land one wholly on dry land, none of it over a river's channel or a pool (`spots.ts`: drawn in toward
 * the middle, or a little smaller, where it would; where nowhere's dry, not at all). Drawn only from
 * this player's view (the server tells a player only the resources they can recognise), on the tiles
 * they know: under the cloud there's nothing, and a tile out of sight shows what was last seen there,
 * still. Placed lazily as tiles come on screen. Round a world that wraps, a tile's models are placed
 * about its middle in the world as built, and their node is moved each frame to the copy nearest the
 * camera.
 */

/** How many tiles are placed in a frame, at most (a big map's revealed a few at a time). */
const PLACE_PER_FRAME = 4;
/** Seconds before a tile is tried again when its ground isn't here yet; and before it's placed again after its improvement, road or pillage changed (its blocks come with the next world update). */
const RETRY = 1;
const SETTLE = 1.2;
/** Zoomed out this far (the camera's distance), a tile shows only its first model and nothing moves. */
const FAR = 110;
/** How far past the screen's edge a tile is still drawn, in the screen's heights at a camera distance of 1 (about six blocks). */
const SCREEN_REACH = 7;
/** How near a unit standing on the tile a model may be before it's hidden under it (blocks): two units on a wooded tile stand on its inner spots. */
const UNDERFOOT = 1.2;

/** One model on a tile, and how it's getting on. */
interface Member {
  holder: Node;
  body: Node;
  life: Life;
  /** Where it stands (blocks): its home, and where it's got to. */
  hx: number;
  hy: number;
  hz: number;
  x: number;
  z: number;
  yaw: number;
  /** Where it's turning (and stepping) to, and when it next picks somewhere new. */
  goalYaw: number;
  goalX: number;
  goalZ: number;
  next: number;
  /** How far it may wander from home (blocks). */
  roam: number;
  /** Its own number (0–1): out of step with the others. */
  seed: number;
  /**
   * Its tile's middle, how far it reaches round where it stands (blocks), and its footprint as it
   * stands unturned: it turns and wanders only where it's still wholly on its tile, and off the water.
   */
  cx: number;
  cz: number;
  reach: number;
  foot: [number, number][];
}

interface Placed {
  /** What it's placed for: the resource, the improvement, its pillage, the road, whether a town covers it. */
  key: string;
  kind: Kind;
  node: Node | null;
  members: Member[];
  /** When to place it (again): its ground not here yet, or its improvement's blocks still coming (0: placed). */
  at: number;
}

const placed = new Map<number, Placed>();
/** The tiles with a resource to show, as this player knows them (worked out again with each view). */
let tiles: number[] = [];
let grid: Grid | null = null;
let shownFor: (KnownTile | null)[] | null = null;
let towns = new Set<number>();
let citiesAt = new Set<number>();


/** Each frame: the resources of the tiles this player knows, placed as they come on screen; those on screen living. */
export function drawResources(client: Client, dt: number) {
  const v = store.view;
  const g = store.grid;
  if (!v || !g || g !== grid) {
    clearAll(client);
    grid = g;
    if (!v || !g) return;
  }
  const now = client.time;
  if (shownFor !== store.known) {
    shownFor = store.known;
    known(client, v, now);
  }
  const far = cam.dist > FAR;
  // (Far off, or on a phone: one model a tile.)
  const one = far || light();
  const w = window.innerWidth;
  const h = window.innerHeight;
  // (A tile's models reach a few blocks from its middle: so many pixels, zoomed in.)
  const margin = 40 + (SCREEN_REACH * h) / cam.dist;
  let budget = PLACE_PER_FRAME;
  for (const t of tiles) {
    const p = placed.get(t)!;
    const c = centre(g, t);
    // (How far its copy nearest the camera is from where its models are placed.)
    const k = homeShift(c.x);
    const s = toScreen(c.x + k, landY(t), c.z);
    const onScreen = !!s && s.x > -margin && s.x < w + margin && s.y > -margin && s.y < h + margin;
    if (onScreen && budget > 0 && (!p.node || p.at > 0) && now >= p.at) {
      budget--;
      place(client, t, p, now);
    }
    if (!p.node) continue;
    // Off the screen it's not drawn at all (nor its shadow); far off, only the first of each tile's, standing still.
    p.node.visible = onScreen;
    if (!onScreen) continue;
    p.node.position.x = k;
    const feet = standingOn(t);
    for (let i = 0; i < p.members.length; i++) {
      const m = p.members[i];
      m.holder.visible = (!one || i === 0 || !!p.kind.base) && !feet?.some((f) => Math.hypot(f.x - (m.x + k), f.z - m.z) < UNDERFOOT);
    }
    if (!far && store.known[t]?.visible) for (const m of p.members) live(client, m, dt, now, k);
  }
}

/** A new view: which tiles show a resource, and what (one whose resource, improvement, road or town changed is placed again once its blocks have come). */
function known(client: Client, v: View, now: number) {
  citiesAt = new Set(v.cities.map((c) => c.tile));
  towns = townTiles(grid!, v);
  tiles = [];
  for (let t = 0; t < store.known.length; t++) {
    const k = store.known[t];
    const kind = k?.resource ? KINDS[k.resource] : undefined;
    if (!k || !kind || citiesAt.has(t) || k.wonder) continue;
    tiles.push(t);
    const key = `${k.resource}|${k.improvement}|${k.pillaged ? 1 : 0}|${k.road}|${towns.has(t) ? 1 : 0}`;
    const p = placed.get(t);
    if (!p) placed.set(t, { key, kind, node: null, members: [], at: 0 });
    else if (p.key !== key) Object.assign(p, { key, kind, at: now + SETTLE });
  }
  const showing = new Set(tiles);
  for (const [t, p] of placed)
    if (!showing.has(t)) {
      if (p.node) client.scene.remove(p.node);
      placed.delete(t);
    }
}

/**
 * The tiles round each city that its town spreads onto, as `models3d.ts` builds it: its world
 * wonders, then districts of the houses its own tile hasn't room for (four to a tile), on the land
 * round it with the tiles behind it first. There's no room on them for a resource.
 */
function townTiles(g: Grid, v: View): Set<number> {
  const out = new Set<number>();
  const models = MODEL_IDS as readonly string[];
  for (const city of v.cities) {
    if (!store.known[city.tile]) continue;
    const middle = city.capital || city.pop >= 6;
    const houses = Math.min(19, city.pop) + 1 - (middle ? 6 : 7);
    const wonders = (city.wonders ?? []).filter((id) => models.includes(wonderPicture(id) ?? '')).length;
    const beside = [2, 1, 3, 0, 4, 5]
      .map((d) => neighbour(g, city.tile, d))
      .filter((t) => {
        const s = store.terrain[t];
        return t >= 0 && s && !TERRAINS[s.terrain]?.water && s.elevation !== 'mountain' && !citiesAt.has(t);
      });
    for (const t of beside.slice(0, wonders + Math.max(0, Math.ceil(houses / 4)))) out.add(t);
  }
  return out;
}

/** A tile's resource placed (again): its models on the spots that are clear, or nothing yet if its ground isn't here. */
function place(client: Client, t: number, p: Placed, now: number) {
  const g = grid!;
  const k = store.known[t]!;
  const kind = p.kind;
  p.at = 0;
  const spots = towns.has(t) ? [] : spotsFor(client.world, g, t, kind, k);
  if (!spots) {
    p.at = now + RETRY;
    return;
  }
  const group = client.scene.node();
  const members: Member[] = [];
  const c = centre(g, t);
  const penned = k.improvement === 'pasture' && kind.life === 'graze';
  // (A herd out on open land wanders about it; penned, a step or two.)
  const roam = penned ? 0.15 : 1.3;
  const scale = kind.scale * (penned ? PEN_SCALE : 1);
  for (let i = 0; i < spots.length; i++) {
    const { x, y, z, size, turn } = spots[i];
    if (kind.base) {
      // The base in the one spot, the models round on it.
      const base = make(client, kind.base.model, kind.base.scale * size);
      if (!base) return retry(p, now);
      base.position.set(x, y, z);
      base.rotation.set(0, hash(t, 40) * Math.PI, 0);
      group.add(base);
      const top = y + (kind.base.top / 16) * kind.base.scale * size;
      for (let n = 0; n < kind.count; n++) {
        const a = base.rotation.y + (n / kind.count) * Math.PI * 2 + 0.4;
        const m = member(client, kind.models[n % kind.models.length], kind.life, scale * size, x + Math.cos(a) * 0.6 * size, top, z + Math.sin(a) * 0.6 * size, hash(t, n + 50) * Math.PI * 2, hash(t, n + 60), 0, c);
        if (!m) return retry(p, now);
        group.add(m.holder);
        members.push(m);
      }
      break;
    }
    // (A grazer faces somewhere of its own; a tree or a rock turns only a quarter at a time, its voxels square with the land's.)
    const yaw = kind.life === 'still' ? (turn ?? Math.floor(hash(t, i + 20) * 4)) * (Math.PI / 2) : Math.atan2(x - c.x, z - c.z) + (hash(t, i + 20) - 0.5) * 2;
    const m = member(client, kind.models[i % kind.models.length], kind.life, scale * size, x, y, z, yaw, hash(t, i + 30), roam, c);
    if (!m) return retry(p, now);
    group.add(m.holder);
    members.push(m);
  }
  if (p.node) client.scene.remove(p.node);
  client.scene.add(group);
  p.node = group;
  p.members = members;
}

/** Its models' files aren't here yet: tried again in a moment. */
function retry(p: Placed, now: number) {
  p.at = now + RETRY;
}

/** One model in a holder (the holder stands and turns; the model in it is scaled, and leans as it grazes) on the tile whose middle is `c`. Null until its file's here. */
function member(client: Client, id: ModelId, life: Life, scale: number, x: number, y: number, z: number, yaw: number, seed: number, roam: number, c: { x: number; z: number }): Member | null {
  const made = client.scene.item(modelItem(id));
  if (!made) return null;
  const holder = client.scene.node();
  const drawn = scale * (0.9 + seed * 0.2);
  made.node.scale.setScalar(drawn);
  holder.add(made.node);
  holder.position.set(x, y, z);
  holder.rotation.set(0, yaw, 0);
  return { holder, body: made.node, life, hx: x, hy: y, hz: z, x, z, yaw, goalYaw: yaw, goalX: x, goalZ: z, next: seed * 6, roam, seed, cx: c.x, cz: c.z, reach: reachOf(id, drawn), foot: corners(id, drawn, 0) };
}

/** A model alone in a holder, at a scale. */
function make(client: Client, id: ModelId, scale: number): Node | null {
  const made = client.scene.item(modelItem(id));
  if (!made) return null;
  const holder = client.scene.node();
  made.node.scale.setScalar(scale);
  holder.add(made.node);
  return holder;
}

// -------------------------------------------------------------------------------------------------
// Their life

/** Seconds a whale's dive takes: up and blowing, going down, under, coming up. */
const WHALE = { up: 7, down: 1.4, under: 2.6, rise: 1.5 };

/** A model on screen this frame: grazing, swimming, surfacing, scuttling (`k`: how far its tile's node is moved to the copy nearest the camera, for what it throws up in the world). */
function live(client: Client, m: Member, dt: number, now: number, k: number) {
  if (m.life === 'graze') {
    if (now >= m.next) {
      // Somewhere new: a turn, and more often than not a few steps (on level open ground only: not into a
      // tree or a wall; nor into the water, nor its head over it).
      m.next = now + 2 + Math.random() * 5;
      const ashore = (x: number, z: number, yaw: number) => dry((bx, bz) => topOf(client.world, grid!, bx, bz, true), x, z, facing(m.foot, yaw));
      const yaw = m.yaw + (Math.random() - 0.5) * 2.6;
      if (ashore(m.x, m.z, yaw)) m.goalYaw = yaw;
      if (Math.random() < 0.6 && m.roam > 0) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * m.roam;
        const gx = m.hx + Math.cos(a) * r;
        const gz = m.hz + Math.sin(a) * r;
        const top = topOf(client.world, grid!, Math.floor(gx), Math.floor(gz));
        const toward = Math.atan2(gx - m.x, gz - m.z);
        if (top && OPEN.has(top.block) && top.y + 1 === m.hy && fit(gx - m.cx, gz - m.cz, m.reach) >= 1 && ashore(gx, gz, toward)) {
          m.goalX = gx;
          m.goalZ = gz;
          m.goalYaw = toward;
        }
      }
    }
    m.yaw = turnToward(m.yaw, m.goalYaw, dt * 1.6);
    const dx = m.goalX - m.x;
    const dz = m.goalZ - m.z;
    const d = Math.hypot(dx, dz);
    const walking = d > 0.02;
    if (walking) {
      const step = Math.min(d, dt * 0.5);
      m.x += (dx / d) * step;
      m.z += (dz / d) * step;
    }
    m.holder.position.set(m.x, m.hy, m.z);
    m.holder.rotation.y = m.yaw;
    // Head down to graze while it stands.
    const graze = walking ? 0 : Math.max(0, Math.sin(now * 0.45 + m.seed * 20) - 0.2);
    m.body.rotation.x = graze * 0.16;
  } else if (m.life === 'swim') {
    m.holder.rotation.y = m.yaw + now * (0.3 + m.seed * 0.15);
    m.holder.position.y = m.hy + Math.sin(now * 1.3 + m.seed * 9) * 0.04;
    // Now and then one jumps: a splash.
    if (Math.random() < dt * 0.15) {
      const a = Math.random() * Math.PI * 2;
      client.fx.particles({ x: m.hx + k + Math.cos(a) * 0.8, y: SURFACE + 0.1, z: m.hz + Math.sin(a) * 0.8 }, [0.85, 0.92, 1], { count: 6, speed: 0.9, size: 0.08, gravity: 5, life: 0.5, spread: 0.1, up: 1.8 });
    }
  } else if (m.life === 'surface') {
    const cycle = WHALE.up + WHALE.down + WHALE.under + WHALE.rise;
    const at = (now + m.seed * cycle) % cycle;
    const deep = -0.9;
    let y: number;
    if (at < WHALE.up) y = Math.sin(now * 0.9 + m.seed * 5) * 0.05;
    else if (at < WHALE.up + WHALE.down) y = deep * ease((at - WHALE.up) / WHALE.down);
    else if (at < WHALE.up + WHALE.down + WHALE.under) y = deep;
    else y = deep * (1 - ease((at - WHALE.up - WHALE.down - WHALE.under) / WHALE.rise));
    m.holder.position.y = m.hy + y;
    m.holder.rotation.y = m.yaw + Math.sin(now * 0.1 + m.seed * 7) * 0.3;
    // Blowing as it comes up, and once more a little later.
    const blow = (when: number) => at >= when && at - dt < when;
    if (blow(0.15) || blow(3.6)) {
      const s = m.body.scale.x / 16;
      const a = m.holder.rotation.y;
      client.fx.particles({ x: m.hx + k + Math.sin(a) * 7 * s, y: m.hy + 3 * s, z: m.hz + Math.cos(a) * 7 * s }, [0.86, 0.93, 1], { count: 22, speed: 0.8, size: 0.13, gravity: 2.4, life: 1.3, spread: 0.12, up: 3.6, drag: 0.6 });
    }
  } else if (m.life === 'scuttle') {
    // Sideways, a few quick steps one way and back, then still.
    const k = (now * 0.8 + m.seed * 10) % 4;
    const side = k < 1 ? Math.sin(k * Math.PI) * 0.18 : k >= 2 && k < 3 ? -Math.sin((k - 2) * Math.PI) * 0.18 : 0;
    m.holder.position.set(m.hx + Math.cos(m.yaw) * side, m.hy, m.hz - Math.sin(m.yaw) * side);
  }
}

const ease = (k: number) => k * k * (3 - 2 * k);

function turnToward(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, k);
}

function clearAll(client: Client) {
  for (const p of placed.values()) if (p.node) client.scene.remove(p.node);
  placed.clear();
  tiles = [];
  shownFor = null;
}
