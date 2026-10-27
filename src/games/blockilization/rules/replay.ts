import { atWar } from './core';
import type { Game, Player } from './state';

/**
 * The game's story, kept as it's played for the replay at its end (Civilization's map timelapse):
 * each turn, the tiles whose owner changed; and what happened, in order: cities founded, taken and
 * lost, wars and peace, wonders built, eras reached, civs fallen, the victory. It's recorded by
 * comparing the game with how it stood at the last record, once a turn (and when a city taken ends
 * the game), so the rules need no hooks of their own; and it's kept small, for the save: a border
 * change is three characters (four on the largest maps), an event a short array.
 */

/** What happened, when: a city founded (1: a civ's capital, not a city-state's), taken, lost; a war, a peace (between two civs standing); a wonder built; an era reached; a civ fallen; the victory. */
export type ReplayEvent =
  | [turn: number, kind: 'found', city: number, owner: number, tile: number, name: string, capital: 0 | 1]
  | [turn: number, kind: 'taken', city: number, owner: number, from: number]
  | [turn: number, kind: 'lost', city: number, owner: number]
  | [turn: number, kind: 'war', a: number, b: number]
  | [turn: number, kind: 'peace', a: number, b: number]
  | [turn: number, kind: 'wonder', id: string, owner: number, city: number]
  | [turn: number, kind: 'era', player: number, era: number]
  | [turn: number, kind: 'out', player: number]
  | [turn: number, kind: 'won', winner: number, how: string];

export interface Replay {
  /** Each turn's border changes, by turn: per tile whose owner changed, the tile (two digits, three on a map of more than 4,096 tiles: `tileDigits`) and its owner (one; `.`: nobody). */
  borders: string[];
  events: ReplayEvent[];
}

/** The digits border changes are written in: 64 of them, none that JSON escapes. */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_';
const NOBODY = '.';
/** The digits a tile is written in: two, or three on a map too big for two to name every tile (a huge map has 4,928, a huge Earth 5,900). */
const tileDigits = (tiles: number) => (tiles > DIGITS.length ** 2 ? 3 : 2);

/** How things stand at a point of the replay: each tile's owner, the cities (by id), the wars (`a,b`, a < b), each civ's era, who has fallen, the wonders built. */
export interface ReplayState {
  owners: Int16Array;
  cities: Map<number, { owner: number; tile: number; name: string; capital: boolean }>;
  wars: Set<string>;
  eras: Map<number, number>;
  out: Set<number>;
  wonders: Set<string>;
  won: boolean;
}

const pair = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

function emptyState(tiles: number): ReplayState {
  return { owners: new Int16Array(tiles).fill(-1), cities: new Map(), wars: new Set(), eras: new Map(), out: new Set(), wonders: new Set(), won: false };
}

/** A turn's border changes applied to the owners. */
function applyBorders(owners: Int16Array, packed: string) {
  if (!packed) return;
  const n = tileDigits(owners.length);
  for (let i = 0; i + n < packed.length; i += n + 1) {
    let t = 0;
    for (let k = 0; k < n; k++) t = t * DIGITS.length + DIGITS.indexOf(packed[i + k]);
    owners[t] = packed[i + n] === NOBODY ? -1 : DIGITS.indexOf(packed[i + n]);
  }
}

/** An event applied to how things stand. */
function applyEvent(s: ReplayState, e: ReplayEvent) {
  switch (e[1]) {
    case 'found':
      s.cities.set(e[2], { owner: e[3], tile: e[4], name: e[5], capital: e[6] === 1 });
      break;
    case 'taken': {
      const c = s.cities.get(e[2]);
      if (c) c.owner = e[3];
      break;
    }
    case 'lost':
      s.cities.delete(e[2]);
      break;
    case 'war':
      s.wars.add(pair(e[2], e[3]));
      break;
    case 'peace':
      s.wars.delete(pair(e[2], e[3]));
      break;
    case 'wonder':
      s.wonders.add(e[2]);
      break;
    case 'era':
      s.eras.set(e[2], e[3]);
      break;
    case 'out':
      s.out.add(e[2]);
      break;
    case 'won':
      s.won = true;
      break;
  }
}

/**
 * A replay played through: how things stood at the end of `turn`, carried forward a turn at a time
 * (going back starts again from the beginning: the whole game is a few thousand changes).
 */
export class ReplayPlayer {
  state: ReplayState;
  turn = -1;
  private readonly replay: Replay;
  private readonly tiles: number;
  /** The next event to apply. */
  private next = 0;
  constructor(replay: Replay, tiles: number) {
    this.replay = replay;
    this.tiles = tiles;
    this.state = emptyState(tiles);
  }
  seek(turn: number) {
    if (turn < this.turn) {
      this.state = emptyState(this.tiles);
      this.turn = -1;
      this.next = 0;
    }
    for (let t = this.turn + 1; t <= turn && t < this.replay.borders.length; t++) applyBorders(this.state.owners, this.replay.borders[t]);
    const events = this.replay.events;
    while (this.next < events.length && events[this.next][0] <= turn) applyEvent(this.state, events[this.next++]);
    this.turn = turn;
  }
}

/** How things stood at the end of a turn (all of it, with `Infinity`), from the replay's start. */
export function replayAt(r: Replay, tiles: number, turn: number): ReplayState {
  const player = new ReplayPlayer(r, tiles);
  player.seek(turn);
  return player.state;
}

/** The last turn the replay has anything for. */
export const replayEnd = (r: Replay) => Math.max(r.borders.length - 1, r.events.length ? r.events[r.events.length - 1][0] : 0);

/** How each game stood at its last record (worked out again from its replay after a load). */
const lastSeen = new WeakMap<Game, ReplayState>();

/** The civs whose wars count: everyone standing but the barbarians (always at war). */
const sides = (game: Game) => game.players.filter((p) => p.alive && p.civ !== 'barbarian');
const major = (p: Player) => !p.cityState && p.civ !== 'barbarian';

/**
 * What's changed since the last record, written down as the turn's (`turn`): the borders that moved,
 * cities founded, taken and lost, wars begun and ended, wonders built, eras reached, civs fallen, the
 * victory. `eraOf` is the rules' own (`game.ts`).
 */
export function recordReplay(game: Game, turn: number, eraOf: (p: Player) => number) {
  const r = (game.replay ??= { borders: [], events: [] });
  let s = lastSeen.get(game);
  if (!s) {
    s = replayAt(r, game.tiles.length, Infinity);
    lastSeen.set(game, s);
  }
  const push = (e: ReplayEvent) => {
    r.events.push(e);
    applyEvent(s, e);
  };
  // Borders.
  let packed = '';
  const n = tileDigits(game.tiles.length);
  for (let t = 0; t < game.tiles.length; t++) {
    const owner = game.tiles[t].owner;
    if (owner === s.owners[t] || owner >= DIGITS.length) continue;
    s.owners[t] = owner;
    for (let k = n - 1; k >= 0; k--) packed += DIGITS[Math.floor(t / DIGITS.length ** k) % DIGITS.length];
    packed += owner < 0 ? NOBODY : DIGITS[owner];
  }
  while (r.borders.length <= turn) r.borders.push('');
  r.borders[turn] += packed;
  // Cities.
  const now = new Set<number>();
  for (const c of game.cities) {
    now.add(c.id);
    const was = s.cities.get(c.id);
    if (!was) push([turn, 'found', c.id, c.owner, c.tile, c.name, c.capital && major(game.players[c.owner]) ? 1 : 0]);
    else if (was.owner !== c.owner) push([turn, 'taken', c.id, c.owner, was.owner]);
  }
  for (const [id, c] of [...s.cities]) if (!now.has(id)) push([turn, 'lost', id, c.owner]);
  // Wars and peace.
  const them = sides(game);
  for (let i = 0; i < them.length; i++)
    for (let j = i + 1; j < them.length; j++) {
      const [a, b] = [them[i].index, them[j].index];
      const war = atWar(game, a, b);
      if (war !== s.wars.has(pair(a, b))) push([turn, war ? 'war' : 'peace', a, b]);
    }
  // Wonders, eras, the fallen, the end.
  for (const [id, by] of Object.entries(game.wonders))
    if (by >= 0 && !s.wonders.has(id)) push([turn, 'wonder', id, by, game.cities.find((c) => c.owner === by && c.buildings.includes(id))?.id ?? -1]);
  for (const p of game.players) {
    if (!major(p)) continue;
    const era = eraOf(p);
    if (p.alive && era > (s.eras.get(p.index) ?? 0)) push([turn, 'era', p.index, era]);
    if (!p.alive && !s.out.has(p.index)) push([turn, 'out', p.index]);
  }
  if (game.over && !s.won) push([turn, 'won', game.over.winner, game.over.how]);
}
