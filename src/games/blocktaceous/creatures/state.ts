import type { Entity, GameContext, Player, Prop, Vec3 } from '@platform';
import { SPECIES, type Species, type SpeciesId } from '../species';
import { TUNING, type Tuning } from './tuning';

/**
 * What the creatures' rules keep while the game runs: a brain for every living animal, the tames'
 * records (which also live in `game.store`), and who rides what. One room's own (a room is a
 * worker thread), reset by `start`.
 */

/** A tame's standing orders. */
export type Order = 'follow' | 'stay' | 'wander';
export type Stance = 'passive' | 'defend' | 'attack';

/** A tame as it's kept in `game.store` under `tame:<id>`: plain data. */
export interface TameRecord {
  id: string;
  /** Whose it is: `a:<account id>` for a signed-in player, `g:<player id>` for a guest. */
  owner: string;
  ownerName: string;
  species: SpeciesId;
  name: string;
  level: number;
  xp: number;
  /** Health now (of the species' health: a level's toughness comes off the damage it takes). */
  hp: number;
  x: number;
  y: number;
  z: number;
  order: Order;
  stance: Stance;
  saddled: boolean;
  /** A guest's tame lasts while this server process does (their id means nothing after): the process that made it. */
  boot?: string;
}

export type Mode = 'idle' | 'graze' | 'wander' | 'flee' | 'warn' | 'hunt' | 'eat' | 'sleep' | 'air' | 'land' | 'follow';

/** One living animal's mind. */
export interface Brain {
  e: Entity;
  id: SpeciesId;
  s: Species;
  t: Tuning;
  /** The herd it came with, and the middle of that herd's range. */
  herd: number;
  mode: Mode;
  /** When its mode runs out, and when it next thinks (seconds on the rules' clock). */
  until: number;
  thinkAt: number;
  /** Where it's walking to, or what it's fleeing from. */
  goal: { x: number; z: number } | null;
  target: Entity | Player | null;
  /** Its attack: seconds until it may start one, and what's left of the wind-up of one begun (0: none). */
  cd: number;
  wind: number;
  /** When a predator is next hungry enough to hunt other animals, and until when it's angry (it runs its target down). */
  hungryAt: number;
  angryUntil: number;
  hurtAt: number;
  /** Which way it last walked (0 faces +z), for the mount it may become. */
  yaw: number;
  /** Seconds it has been trying to walk without getting anywhere. */
  stuck: number;
  /** A flyer's circling: the height it holds over the ground. */
  alt: number;
  /** A looping clip its model is playing (`eat`, `sleep`, `fly`), or null. */
  clip: string | null;
  // Being subdued and tamed.
  daze: number;
  dazedAt: number;
  ko: boolean;
  stunUntil: number;
  trust: number;
  /** The player taming it (their id), and when it will next take food. */
  tamer: string | null;
  feedAt: number;
  /** Its record, once it's someone's. */
  tame: TameRecord | null;
}

/** A tame being ridden: its entity is gone while it is, and a model stands in for it under its rider. */
export interface Ride {
  rec: TameRecord;
  prop: Prop;
  /** The mount's attacks the rules have acted on, and the clip its model plays. */
  atk: number;
  clip: string;
  clipUntil: number;
  /** Blocks ridden since it last earned experience for it. */
  ridden: number;
}

export const brains = new Map<number, Brain>();
export const tames = new Map<string, TameRecord>();
/** Tames that are loaded: their record's id to their brain. */
export const loaded = new Map<string, Brain>();
/** Riders, by player id. */
export const rides = new Map<string, Ride>();
/** Each herd's range: where its members graze, and when it last moved on. */
export const herds = new Map<number, { x: number; z: number; movedAt: number }>();
/** Where something died lately: scavengers come for it. */
export const carcasses: { x: number; z: number; until: number }[] = [];

/** The rules' clock: seconds since `start` (it follows `game.clock.now`). */
export const clock = { now: 0 };

let nextHerd = 1;
export const newHerd = (x: number, z: number): number => {
  herds.set(nextHerd, { x, z, movedAt: clock.now });
  return nextHerd++;
};

export function resetState() {
  brains.clear();
  tames.clear();
  loaded.clear();
  rides.clear();
  herds.clear();
  carcasses.length = 0;
  grid.clear();
  clock.now = 0;
}

export function makeBrain(e: Entity, id: SpeciesId, herd: number, rng: { range(a: number, b: number): number }): Brain {
  return {
    e,
    id,
    s: SPECIES[id],
    t: TUNING[id],
    herd,
    mode: 'idle',
    until: clock.now + rng.range(1, 5),
    thinkAt: clock.now + rng.range(0, 0.5),
    goal: null,
    target: null,
    cd: 1,
    wind: 0,
    hungryAt: clock.now + rng.range(10, 60),
    angryUntil: 0,
    hurtAt: -100,
    yaw: 0,
    stuck: 0,
    alt: rng.range(10, 18),
    clip: null,
    daze: 0,
    dazedAt: -100,
    ko: false,
    stunUntil: 0,
    trust: 0,
    tamer: null,
    feedAt: 0,
    tame: null,
  };
}

/** The key a player's tames are kept under. */
export const ownerKey = (p: Player): string => (p.account ? `a:${p.account.id}` : `g:${p.id}`);
export const ownerOf = (game: GameContext, rec: TameRecord): Player | null => game.players.find((p) => ownerKey(p) === rec.owner) ?? null;

export const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const flat = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z);
export const inPlay = (p: Player): boolean => p.alive && !p.spectating;

/** The nearest player in play to a spot, and how far (over the ground). */
export function nearestPlayer(game: GameContext, at: { x: number; z: number }): { player: Player | null; d: number } {
  let player: Player | null = null;
  let best = Infinity;
  for (const p of game.players) {
    if (!inPlay(p)) continue;
    const d = dist2(p.position, at);
    if (d < best) [best, player] = [d, p];
  }
  return { player, d: Math.sqrt(best) };
}

/**
 * The animals by where they are, in cells of 16 blocks, rebuilt a few times a second: what a
 * brain asks ("who's near me?") costs the handful of animals in the cells round it, not a pass
 * over every animal on the island.
 */
const CELL = 16;
const grid = new Map<number, Brain[]>();
const cellKey = (cx: number, cz: number): number => cx * 65536 + cz;

export function rebuildGrid() {
  grid.clear();
  for (const b of brains.values()) {
    if (!b.e.alive) continue;
    const p = b.e.position;
    const k = cellKey(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
    const cell = grid.get(k);
    if (cell) cell.push(b);
    else grid.set(k, [b]);
  }
}

/** Every living animal within `r` blocks of a spot (over the ground), as the grid last had them. */
export function near(at: { x: number; z: number }, r: number, out: Brain[] = []): Brain[] {
  out.length = 0;
  const r2 = r * r;
  for (let cx = Math.floor((at.x - r) / CELL); cx <= Math.floor((at.x + r) / CELL); cx++) {
    for (let cz = Math.floor((at.z - r) / CELL); cz <= Math.floor((at.z + r) / CELL); cz++) {
      const cell = grid.get(cellKey(cx, cz));
      if (!cell) continue;
      for (const b of cell) if (b.e.alive && dist2(b.e.position, at) <= r2) out.push(b);
    }
  }
  return out;
}

/** Loop a clip on an animal's model (or stop the one it loops): only a change is sent. */
export function setClip(b: Brain, clip: string | null) {
  if (b.clip === clip) return;
  b.clip = clip;
  b.e.animate(clip ?? 'none', clip ? { loop: true, fade: 0.3 } : undefined);
}

/** The animal's voice, at its own pitch. */
export function call(game: GameContext, b: Brain, volume = 1) {
  game.audio.play(b.t.voice, { at: b.e.position, pitch: b.t.pitch * (0.94 + game.rng.next() * 0.12), volume });
}

export const itemName = (game: GameContext, id: string): string => game.items.get(id)?.name ?? id;
export const isPlayer = (t: unknown): t is Player => typeof t === 'object' && t !== null && (t as { kind?: string }).kind === 'player';
export const isEntity = (t: unknown): t is Entity => typeof t === 'object' && t !== null && (t as { kind?: string }).kind === 'entity';
export const posOf = (t: Entity | Player): Vec3 => t.position;
