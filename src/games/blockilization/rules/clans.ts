/**
 * Barbarian clans, Civilization VI's: every barbarian camp is a clan, with a name, and a civ that has
 * found its camp can deal with it. Bribe it and its raiders leave you alone for a while; hire one of
 * its warriors; or pay it to raid a civ you've met, which may learn who paid. A clan grows while it's
 * left to itself (and when it's paid, and as its raiders pillage), and loses heart as its raiders
 * die: grown enough, it settles where its camp is as a city-state, one of the world's city-states
 * kept out of the game for it (`CLAN_STATES`, with barbarians on), while any is left. Clearing
 * its camp ends it, as before (`barbarians.ts`).
 */
import { citiesOf, knowsOf, note, noteAll, random, spawnUnit, speed, updateAllVisibility } from './core';
import { remember } from './diplomacy';
import { distance, within } from './hex';
import { canEnter } from './movement';
import type { City, Game, Player, Unit } from './state';
import { teammates } from './teams';
import { UNITS } from './units';

export interface Clan {
  id: number;
  name: string;
  /** Its camp. */
  tile: number;
  /** Toward settling as a city-state (at `SETTLE`). */
  growth: number;
  /** The civs that paid it to leave them alone, and the turn each bribe runs to. */
  bribes?: Record<number, number>;
  /** The civ it's been paid to raid, who paid, and the turn it raids to. */
  incited?: { target: number; by: number; until: number };
  /** The turn it last let a warrior be hired (one now and then). */
  hired?: number;
}

export type ClanAct = 'bribe' | 'hire' | 'incite';

/** The growth a clan settles at, and what each dealing, each pillage by its raiders and each of them killed adds or takes (a turn adds one, more at a quicker speed: `clansTurn`). */
export const SETTLE = 100;
const PAID: Record<ClanAct, number> = { bribe: 5, hire: 5, incite: 10 };
const PILLAGED = 3;
const HARMED = 10;

const grow = (clan: Clan, n: number) => (clan.growth = Math.max(0, Math.min(SETTLE, clan.growth + n)));

/** The clans' names (each "the … clan"). */
const NAMES = ['Red Hand', 'Ashen Wolf', 'Bone Raven', 'Iron Boar', 'Storm Rider', 'Black Adder', 'Grey Lynx', 'Salt Hawk', 'Thorn Bear', 'Howling Dog', 'River Rat', 'Blood Moon', 'Broken Spear', 'White Stag', 'Dust Viper', 'Night Owl', 'Copper Jackal', 'Frost Wolf', 'Burning Tree', 'Hollow Skull', 'Swift Fox', 'Stone Fist', 'Crow Feather', 'Wild Horse'];

/** The world's clans (one for each camp). */
export const clansOf = (game: Game): Clan[] => (game.clans ??= []);
export const clanById = (game: Game, id: number | undefined) => (id === undefined ? undefined : clansOf(game).find((c) => c.id === id));

/** A new camp's clan, its name one not in use. */
export function newClan(game: Game, tile: number): Clan {
  const used = new Set(clansOf(game).map((c) => c.name));
  const free = NAMES.filter((n) => !used.has(n));
  const name = free.length ? free[game.nextId % free.length] : `${NAMES[game.nextId % NAMES.length]} ${clansOf(game).length}`;
  const clan: Clan = { id: game.nextId++, name, tile, growth: 0 };
  clansOf(game).push(clan);
  return clan;
}

/** The clan of the camp on a tile. */
export const clanAt = (game: Game, tile: number): Clan | undefined => (game.tiles[tile]?.camp ? clansOf(game).find((c) => c.tile === tile) : undefined);

/** A camp cleared: its clan is no more, and its raiders are lone barbarians. */
export function endClan(game: Game, tile: number) {
  const clan = clansOf(game).find((c) => c.tile === tile);
  if (!clan) return;
  game.clans = clansOf(game).filter((c) => c !== clan);
  for (const u of game.units) if (u.clan === clan.id) delete u.clan;
}

/** The warrior a clan sends out, or sells: by the most advanced civ's techs, as its raiders are. */
export function clanUnit(game: Game): string {
  const most = Math.max(...game.players.filter((p) => p.civ !== 'barbarian').map((p) => p.techs.length));
  return most >= 30 ? 'longswordsman' : most >= 22 ? 'swordsman' : most >= 12 ? 'spearman' : 'warrior';
}

/** A civ's era by its techs (as a city-state's gifts and tribute go). */
const eraOf = (p: Player) => Math.floor(p.techs.length / 10);

/** What each dealing costs a civ, in gold, at the game's speed (more each era; a warrior as dear as buying one). */
export function clanCost(game: Game, p: Player, act: ClanAct): number {
  const era = eraOf(p);
  if (act === 'bribe') return Math.round((40 + 20 * era) * speed(game));
  if (act === 'incite') return Math.round((80 + 30 * era) * speed(game));
  return Math.round(UNITS[clanUnit(game)].cost * 2 * speed(game));
}

/** How long a bribe and a raid paid for last, and how long a clan waits to sell another warrior. */
export const bribeTurns = (game: Game) => Math.round(20 * speed(game));
export const inciteTurns = (game: Game) => Math.round(15 * speed(game));
export const hireRest = (game: Game) => Math.round(6 * speed(game));

/** Whether a clan leaves a civ alone: it (or a teammate) has bribed it, or it's paying it to raid someone. */
export function spares(game: Game, clan: Clan, owner: number): boolean {
  if (clan.incited && game.turn < clan.incited.until && (clan.incited.by === owner || teammates(game, clan.incited.by, owner))) return true;
  return Object.entries(clan.bribes ?? {}).some(([i, until]) => game.turn < until && (Number(i) === owner || teammates(game, Number(i), owner)));
}

/** Whom a clan's raiders go after: the civ it's been paid to raid, while it's paid. */
export const raidTarget = (game: Game, clan: Clan | undefined): number | null => (clan?.incited && game.turn < clan.incited.until && game.players[clan.incited.target]?.alive ? clan.incited.target : null);

/** Why a civ can't deal with a clan this way now (null: it can). */
export function clanProblem(game: Game, p: Player, clan: Clan, act: ClanAct, target: number | null): string | null {
  if (p.cityState || p.civ === 'barbarian') return 'Only a civilization deals with the clans';
  if (!p.explored[clan.tile]) return "You haven't found its camp";
  const cost = clanCost(game, p, act);
  if (act === 'bribe' && (clan.bribes?.[p.index] ?? 0) > game.turn) return `It already leaves you alone (for ${clan.bribes![p.index] - game.turn} more turns)`;
  if (act === 'hire') {
    if (clan.hired !== undefined && game.turn < clan.hired + hireRest(game)) return `It has no warrior to spare for ${clan.hired + hireRest(game) - game.turn} more turns`;
    if (hireSpot(game, clan, p.index) === undefined) return 'There is no room by its camp';
  }
  if (act === 'incite') {
    if (raidTarget(game, clan) !== null) return 'It is paid to raid someone already';
    const why = preyProblem(game, p, target);
    if (why) return why;
  }
  if (p.gold < cost) return `It costs ${cost} gold (you have ${p.gold})`;
  return null;
}

/** Why a civ can't pay a clan to raid this one (null: it can): one it has met, not on its team, with a city. */
export function preyProblem(game: Game, p: Player, target: number | null): string | null {
  const o = target === null ? undefined : game.players[target];
  if (!o || !o.alive || o === p || o.cityState || o.civ === 'barbarian' || !knowsOf(p, o)) return 'Choose a civilization you have met';
  if (teammates(game, p.index, o.index)) return `${o.name} is on your team`;
  if (!citiesOf(game, o.index).length) return `${o.name} has no city to raid`;
  return null;
}

/** Where a hired warrior (or a raider sent out) can stand by the camp. */
function hireSpot(game: Game, clan: Clan, owner: number): number | undefined {
  const type = clanUnit(game);
  return within(game.grid, clan.tile, 1).find((t) => t !== clan.tile && canEnter(game, { id: -1, type, owner, tile: t, moves: 0, hp: 100, xp: 0, promotions: [] }, t));
}

/** A raider of the clan's sent out next to its camp (if there's room). */
export function sendRaider(game: Game, clan: Clan, type: string): Unit | undefined {
  const b = game.players.findIndex((p) => p.civ === 'barbarian');
  const at = b < 0 ? undefined : within(game.grid, clan.tile, 1).find((t) => canEnter(game, { id: -1, type, owner: b, tile: t, moves: 0, hp: 100, xp: 0, promotions: [] }, t));
  return at === undefined ? undefined : spawnUnit(game, type, b, at, { clan: clan.id });
}

/** A civ deals with a clan (the order's checks made: `clanProblem`). */
export function dealWithClan(game: Game, p: Player, clan: Clan, act: ClanAct, target: number | null): string {
  p.gold -= clanCost(game, p, act);
  grow(clan, PAID[act]);
  if (act === 'bribe') {
    (clan.bribes ??= {})[p.index] = game.turn + bribeTurns(game);
    return `The ${clan.name} clan takes your gold: its raiders leave you alone for ${bribeTurns(game)} turns.`;
  }
  if (act === 'hire') {
    const type = clanUnit(game);
    spawnUnit(game, type, p.index, hireSpot(game, clan, p.index)!, { moves: 0 });
    clan.hired = game.turn;
    updateAllVisibility(game);
    return `A ${UNITS[type].name} of the ${clan.name} clan joins you, for gold.`;
  }
  const o = game.players[target!];
  clan.incited = { target: o.index, by: p.index, until: game.turn + inciteTurns(game) };
  // (Two raiders out at once, the rest as it goes: `barbarians.ts`.)
  for (let i = 0; i < 2; i++) sendRaider(game, clan, clanUnit(game));
  // The civ raided learns of it, and half the time who paid.
  const told = random(game) < 0.5;
  if (told) remember(game, 'incited', p.index, o.index);
  note(game, o.index, { text: told ? `The ${clan.name} clan has been paid to raid your lands, by ${p.name}.` : `The ${clan.name} clan has been paid to raid your lands. Who paid them, you don't know.`, at: clan.tile, kind: 'war' });
  return `The ${clan.name} clan takes your gold: it raids ${o.name} for ${inciteTurns(game)} turns.`;
}

/** One of a clan's raiders killed: it loses heart. */
export function clanHarmed(game: Game, u: Unit) {
  const clan = clanById(game, u.clan);
  if (clan) grow(clan, -HARMED);
}

/** A clan's raider pillaged: it grows. */
export function clanPillaged(game: Game, u: Unit) {
  const clan = clanById(game, u.clan);
  if (clan) grow(clan, PILLAGED);
}

/** What `clansTurn` needs of the rest of the rules: founding a city (`game.ts`). */
export const clanHooks: { found: (game: Game, owner: number, tile: number) => City } = { found: () => undefined as never };

/** The clans' turn: each grows, its old bribes and raids lapse, and one grown enough settles as a city-state. */
export function clansTurn(game: Game) {
  // (A camp from a game saved before there were clans has one now; a clan whose camp is gone is no more.)
  game.tiles.forEach((tile, t) => tile.camp && !clanAt(game, t) && newClan(game, t));
  for (const clan of [...clansOf(game)]) {
    if (!game.tiles[clan.tile]?.camp) {
      endClan(game, clan.tile);
      continue;
    }
    grow(clan, 1 / speed(game));
    for (const [i, until] of Object.entries(clan.bribes ?? {})) if (game.turn >= until) delete clan.bribes![Number(i)];
    if (clan.incited && game.turn >= clan.incited.until) clan.incited = undefined;
    if (clan.growth >= SETTLE) settle(game, clan);
  }
}

/** Whether a grown clan can settle where its camp is: no one's land, no city near, a city-state left to become (the city-state it would be). */
export function canSettle(game: Game, clan: Clan): Player | null {
  const tile = game.tiles[clan.tile];
  if (tile.owner >= 0 || tile.wonder || game.cities.some((c) => distance(game.grid, c.tile, clan.tile) < 4)) return null;
  return game.players.find((p) => p.unsettled) ?? null;
}

/** A clan settled: its camp is a city-state's city, with the techs most civs know, and its raiders by it are the city-state's. */
export function settle(game: Game, clan: Clan): City | null {
  const cs = canSettle(game, clan);
  if (!cs) return null;
  const majors = game.players.filter((p) => p.alive && !p.cityState && p.civ !== 'barbarian');
  const known = new Map<string, number>();
  for (const p of majors) for (const t of p.techs) known.set(t, (known.get(t) ?? 0) + 1);
  cs.techs = [...known].filter(([, n]) => n * 2 >= majors.length).map(([t]) => t);
  delete cs.unsettled;
  cs.alive = true;
  game.tiles[clan.tile].camp = false;
  const city = clanHooks.found(game, cs.index, clan.tile);
  for (const u of game.units) {
    if (u.clan !== clan.id) continue;
    delete u.clan;
    if (distance(game.grid, u.tile, clan.tile) > 3) continue;
    u.owner = cs.index;
    u.path = undefined;
  }
  game.clans = clansOf(game).filter((c) => c !== clan);
  updateAllVisibility(game);
  noteAll(game, (r) => (r.explored[clan.tile] ? { text: `The ${clan.name} clan has settled down: its camp is now ${city.name}, a city-state.`, at: clan.tile, kind: 'citystate' } : null));
  return city;
}
