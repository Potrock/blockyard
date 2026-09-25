import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Entity, Player, Vec3 } from '../api/types';
import type { Registry } from '../world/registry';
import { playerBoxes, rayBox, type Stance } from './guns';
import { rayHit } from './worldquery';

/** Where a player or creature was at one moment. */
interface Pose {
  x: number;
  y: number;
  z: number;
  stance: Stance;
  alive: boolean;
}

interface Snapshot {
  t: number;
  players: Map<string, Pose>;
  entities: Map<number, Pose>;
}

/** The longest a shot reaches back in time (a laggy shooter doesn't get to hit where someone was a second ago). */
export const MAX_REWIND = 0.35;

/**
 * Where everyone was, tick by tick, for the last second: a shot is checked against where its
 * targets were on the shooter's screen (which draws others a little in the past), not where the
 * host has them now. That's what makes hitscan fair online: what you aim at is what you hit.
 */
export class History {
  private snaps: Snapshot[] = [];

  record(t: number, players: Map<string, Pose>, entities: Map<number, Pose>) {
    this.snaps.push({ t, players, entities });
    while (this.snaps.length > 2 && this.snaps[1].t < t - 1) this.snaps.shift();
  }

  clear() {
    this.snaps = [];
  }

  /** A player's pose at time `t` (blended between the ticks around it); null if there's no record. */
  player(id: string, t: number): Pose | null {
    return this.pose(t, (s) => s.players.get(id));
  }

  entity(id: number, t: number): Pose | null {
    return this.pose(t, (s) => s.entities.get(id));
  }

  private pose(t: number, get: (s: Snapshot) => Pose | undefined): Pose | null {
    const s = this.snaps;
    if (!s.length) return null;
    let i = s.length - 1;
    while (i > 0 && s[i].t > t) i--;
    const a = get(s[i]);
    const b = s[i + 1] ? get(s[i + 1]) : undefined;
    if (!a) return b ?? null;
    if (!b || s[i].t >= t) return a;
    const k = Math.min(1, (t - s[i].t) / Math.max(1e-6, s[i + 1].t - s[i].t));
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k, stance: k < 0.5 ? a.stance : b.stance, alive: a.alive && b.alive };
  }
}

/** What a bullet hit: a player or creature (and whether in the head), a block, a solid prop, or nothing within range. */
export interface BulletHit {
  point: Vec3;
  dist: number;
  /** The face it hit (blocks and props), for sparks and chips. */
  normal: Vec3 | null;
  target: Player | Entity | null;
  head: boolean;
  /** The block it hit (its id), or -1. */
  block: number;
}

/** Someone a bullet can hit: where they are now and how to find them in the past. */
export interface Hittable {
  target: Player | Entity;
  /** History key. */
  key: string | number;
  now: Pose;
  /** Hitbox of a creature (players use `playerBoxes`); a humanoid's top quarter is its head. */
  box?: { width: number; height: number; head: boolean };
}

export interface HitscanWorld {
  world: VoxelWorld;
  registry: Registry;
  history: History;
  /** The first solid prop along a ray. */
  prop(o: Vec3, d: Vec3, max: number): { distance: number; point: Vec3 } | null;
  /** Everyone a shot could hit. */
  targets(): Hittable[];
}

/**
 * One bullet from `from` along the unit vector `dir`: the first player, creature, block or solid
 * prop it meets within `range`. Targets are where they were at host time `seen` (the moment the
 * shooter's screen was showing), no more than `MAX_REWIND` ago; `ignore` is the shooter. Plants,
 * torches and leaves don't stop bullets.
 */
export function castBullet(w: HitscanWorld, from: Vec3, dir: Vec3, range: number, now: number, seen: number | null, ignore: Player | Entity | null): BulletHit {
  // The world first: blocks (through foliage), then solid props nearer than that.
  let end = range;
  let normal: Vec3 | null = null;
  let block = -1;
  let o = from;
  let travelled = 0;
  for (let i = 0; i < 12; i++) {
    const h = rayHit(w.world, o, dir, range - travelled);
    if (!h) break;
    const def = w.registry.blocks[h.block];
    const along = (h.point.x - from.x) * dir.x + (h.point.y - from.y) * dir.y + (h.point.z - from.z) * dir.z;
    if (def && (def.small || def.name.endsWith('_leaves'))) {
      travelled = along + 0.02;
      o = { x: from.x + dir.x * travelled, y: from.y + dir.y * travelled, z: from.z + dir.z * travelled };
      continue;
    }
    end = along;
    normal = h.normal;
    block = h.block;
    break;
  }
  const prop = w.prop(from, dir, end);
  if (prop && prop.distance < end) {
    end = prop.distance;
    block = -1;
    normal = { x: -dir.x, y: -dir.y, z: -dir.z };
  }
  // Then whoever's in the way, where they were when the shooter saw them.
  const at = seen === null ? null : Math.max(now - MAX_REWIND, Math.min(now, seen));
  let best: Player | Entity | null = null;
  let head = false;
  for (const h of w.targets()) {
    if (h.target === ignore) continue;
    const kind = h.target.kind;
    const past = at === null ? null : kind === 'player' ? w.history.player(h.key as string, at) : w.history.entity(h.key as number, at);
    const p = past ?? h.now;
    if (!p.alive) continue;
    // Cheap reject: nowhere near the ray.
    const rx = p.x - from.x;
    const rz = p.z - from.z;
    const along = rx * dir.x + (p.y + 1 - from.y) * dir.y + rz * dir.z;
    if (along < -2 || along > end + 2) continue;
    let tBody: number | null;
    let tHead: number | null;
    if (h.box) {
      const hw = h.box.width / 2 + 0.05;
      const top = h.box.height;
      const split = h.box.head ? top * 0.76 : top;
      tBody = rayBox(from, dir, { x: p.x - hw, y: p.y, z: p.z - hw }, { x: p.x + hw, y: p.y + split, z: p.z + hw });
      tHead = h.box.head ? rayBox(from, dir, { x: p.x - hw * 0.85, y: p.y + split, z: p.z - hw * 0.85 }, { x: p.x + hw * 0.85, y: p.y + top, z: p.z + hw * 0.85 }) : null;
    } else {
      const b = playerBoxes(p, p.stance);
      tBody = rayBox(from, dir, b.body[0], b.body[1]);
      tHead = rayBox(from, dir, b.head[0], b.head[1]);
    }
    const t = tHead !== null && (tBody === null || tHead <= tBody) ? tHead : tBody;
    if (t === null || t >= end) continue;
    end = t;
    best = h.target;
    head = t === tHead;
    normal = null;
    block = -1;
  }
  return { point: { x: from.x + dir.x * end, y: from.y + dir.y * end, z: from.z + dir.z * end }, dist: end, normal, target: best, head, block };
}
