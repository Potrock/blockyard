import { CIV_LIST } from '../rules/civs';
import { createGame, spawnUnit, updateAllVisibility } from '../rules/core';
import { assignCitizens } from '../rules/economy';
import { foundCity } from '../rules/game';
import { tileAt } from '../rules/hex';
import type { City, Game, Settings, Unit } from '../rules/state';
import { TECHS } from '../rules/techs';

/**
 * Small worlds for the rules' tests: a flat, empty grassland map (no rivers, forests, resources,
 * ruins or camps) with the civs asked for and nothing else, so each test places just what it needs
 * and every difference it measures comes from the thing it's testing.
 */

export interface World {
  game: Game;
  /** A tile by column and row. */
  at: (col: number, row: number) => number;
}

/** A blank world: the civs (by id) on a duel-sized map of open grassland, and (if asked) city-states and barbarians; flat unless asked to wrap round east to west. */
export function blank(civs: string[] = ['egypt', 'babylon'], opts: { cityStates?: number; barbarians?: boolean; size?: Settings['size']; wrap?: boolean } = {}): World {
  const settings: Settings = {
    size: opts.size ?? 'duel',
    type: 'pangaea',
    speed: 'quick',
    timer: 0,
    cityStates: opts.cityStates ?? 0,
    barbarians: opts.barbarians ?? false,
    victories: { domination: false, science: false, culture: false, diplomatic: false, score: false },
    turnLimit: 9999,
    wrap: opts.wrap ?? false,
  };
  const seats = civs.map((id) => {
    const civ = CIV_LIST.find((c) => c.id === id)!;
    return { user: null, name: civ.leader, civ: civ.id, bot: true };
  });
  const game = createGame(settings, seats, 7);
  game.units = [];
  game.cities = [];
  for (const tile of game.tiles) {
    tile.terrain = 'grassland';
    tile.elevation = 'flat';
    tile.height = 1;
    tile.owner = -1;
    for (const k of ['feature', 'resource', 'amount', 'river', 'improvement', 'pillaged', 'road', 'city', 'ruin', 'camp', 'wonder', 'antiquity', 'hiddenAntiquity', 'volcano', 'soil', 'flooded'] as const) delete tile[k];
  }
  // (Natural wonders found on the map it began with are gone with them.)
  delete game.found;
  for (const p of game.players) {
    p.gold = 0;
    p.goldenPoints = 0;
    p.notes = [];
  }
  return { game, at: (col, row) => tileAt(game.grid, col, row) };
}

/** A city of `owner`'s on a tile, of a size, with buildings (the first a player founds is their capital). */
export function city(game: Game, owner: number, t: number, opts: { pop?: number; buildings?: string[] } = {}): City {
  const c = foundCity(game, owner, t);
  c.pop = opts.pop ?? c.pop;
  for (const b of opts.buildings ?? []) if (!c.buildings.includes(b)) c.buildings.push(b);
  assignCitizens(game, c);
  updateAllVisibility(game);
  return c;
}

/** A unit of `owner`'s on a tile (and what everyone sees now). */
export function unit(game: Game, type: string, owner: number, t: number, extra: Partial<Unit> = {}): Unit {
  const u = spawnUnit(game, type, owner, t, extra);
  updateAllVisibility(game);
  return u;
}

/** Two players at war (both ways). */
export function war(game: Game, a: number, b: number) {
  game.players[a].diplomacy.war[b] = true;
  game.players[b].diplomacy.war[a] = true;
}

/** Every tech up to (and including) a column, for a player. */
export function techsTo(game: Game, p: number, col: number) {
  game.players[p].techs = Object.values(TECHS).filter((t) => t.col <= col && t.id !== 'future_tech').map((t) => t.id);
}
