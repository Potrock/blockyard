import { atWar, capitalOf, knowsOf, note, noteAll, speed } from './core';
import { hasMet, remember } from './diplomacy';
import type { Game, Player } from './state';

/**
 * Pledges to Protect, Civ V's: a civ pledges (from the city-state's page) to protect a city-state,
 * and its influence there rests higher. Anyone else who bullies the city-state or declares war on it
 * offends the pledger (remembered, for the bots' opinions). The pledge ends if the pledger bullies or
 * attacks the city-state itself (influence lost, and no pledging again for a while), or if its
 * influence there falls below nothing.
 */

/** How much higher a pledger's influence rests. */
export const PLEDGE_REST = 10;
/** Influence lost by breaking a pledge (bullying or attacking the city-state pledged to). */
export const PLEDGE_BROKEN = 20;
/** Turns before a civ that broke a pledge (or let it lapse) may pledge to that city-state again (ten, at speed). */
export const PLEDGE_TURNS = 10;
export const pledgeCooldown = (game: Game) => Math.round(PLEDGE_TURNS * speed(game));

/** Whether `p` is pledged to protect city-state `cs`. */
export const pledged = (game: Game, p: number, cs: number) => game.players[cs]?.cityState?.pledges?.[p] !== undefined;

/** The civs pledged to protect a city-state (by index). */
export const pledgersOf = (game: Game, cs: number): number[] => Object.keys(game.players[cs]?.cityState?.pledges ?? {}).map(Number);

/** Why a civ can't pledge to protect a city-state now, if it can't: met and at peace, its influence not below nothing, no pledge broken lately. */
export function cannotPledge(game: Game, p: Player, cs: number): string | null {
  const c = game.players[cs];
  if (!c?.cityState || !c.alive || !capitalOf(game, cs)) return 'Not a city-state';
  if (p.cityState || p.civ === 'barbarian') return 'Only a civilization can pledge';
  if (pledged(game, p.index, cs)) return `You protect ${c.name} already`;
  if (atWar(game, p.index, cs)) return "You're at war with them";
  if (!hasMet(game, p, c)) return "You haven't met them";
  if ((p.influence[cs] ?? 0) < 0) return `${c.name} doesn't trust you (influence below 0)`;
  const since = c.cityState.broken?.[p.index];
  if (since !== undefined && game.turn - since < pledgeCooldown(game)) return `Your last pledge ended lately (again in ${pledgeCooldown(game) - (game.turn - since)} turns)`;
  return null;
}

/** A civ pledges to protect a city-state: said to everyone who knows them both. */
export function pledge(game: Game, p: Player, cs: number): string | null {
  const why = cannotPledge(game, p, cs);
  if (why) return why;
  const c = game.players[cs];
  (c.cityState!.pledges ??= {})[p.index] = game.turn;
  const home = capitalOf(game, cs);
  note(game, p.index, { text: `You pledge to protect ${c.name}: your influence there rests ${PLEDGE_REST} higher.`, at: home?.tile, kind: 'citystate' });
  noteAll(game, (r) => (r !== p && !r.cityState && knowsOf(r, c) && knowsOf(r, p) ? { text: `${p.name} has pledged to protect ${c.name}.`, at: home?.tile, kind: 'citystate', topic: 'quests' } : null));
  return null;
}

/** A pledge ends: by being broken (the pledger bullied or attacked it: influence lost) or let lapse; either way, no pledging again for a while. */
export function endPledge(game: Game, p: number, cs: number, broken: boolean) {
  const c = game.players[cs];
  if (!c.cityState?.pledges || !pledged(game, p, cs)) return;
  delete c.cityState.pledges[p];
  (c.cityState.broken ??= {})[p] = game.turn;
  const pl = game.players[p];
  if (broken) pl.influence[cs] = (pl.influence[cs] ?? 0) - PLEDGE_BROKEN;
  note(game, p, broken ? { text: `You have broken your pledge to protect ${c.name} (−${PLEDGE_BROKEN} influence).`, kind: 'bad' } : { text: `Your pledge to protect ${c.name} has lapsed: it no longer trusts you.`, kind: 'bad' });
}

/**
 * A city-state bullied or attacked by `by` (a tribute demanded, war declared): `by`'s own pledge to it
 * is broken, and every other civ pledged to it is offended (and told).
 */
export function pledgeOffended(game: Game, by: number, cs: number) {
  const c = game.players[cs];
  for (const p of pledgersOf(game, cs)) {
    if (p === by) {
      endPledge(game, p, cs, true);
      continue;
    }
    remember(game, 'pledge', by, p);
    note(game, p, { text: `${knowsOf(game.players[p], game.players[by]) ? game.players[by].name : 'Someone'} has threatened ${c.name}, under your protection.`, at: capitalOf(game, cs)?.tile, kind: 'bad' });
  }
}

/** Each turn: pledges lapse whose pledger has gone, is at war with the city-state, or has fallen below nothing in its influence there. */
export function pledgesTurn(game: Game) {
  for (const c of game.players) {
    if (!c.cityState?.pledges) continue;
    for (const p of pledgersOf(game, c.index)) {
      const pl = game.players[p];
      if (!c.alive || !pl?.alive) delete c.cityState.pledges[p];
      else if (atWar(game, p, c.index) || (pl.influence[c.index] ?? 0) < 0) endPledge(game, p, c.index, false);
    }
  }
}
