import { citiesOf, knowsOf, nameTo, noteAll } from './core';
import { remember } from './diplomacy';
import type { Game, Player } from './state';
import { masterOf, vassalsOf } from './teams';

/**
 * Vassals, Civilization IV's capitulation: a civ beaten in war can kneel to the civ beating it (a
 * peace deal's item, `diplomacy.ts`'s `kneel`) rather than be destroyed. It keeps its cities and its
 * people, but its master makes its wars and its peace (it goes to war and makes peace with its
 * master's side, `teams.ts`), it pays a quarter of its gold income in tribute each turn, and the two's
 * borders are open to each other. Its cities count as its master's toward a domination victory.
 * Grown to half its master's people, a vassal may declare its independence; a master may set one
 * free; a master gone from the game leaves its vassals free.
 */

/** The share of a vassal's gold income it pays its master each turn. */
export const TRIBUTE = 0.25;

/** The share of its master's people a vassal needs to declare its independence. */
export const INDEPENDENCE = 0.5;

/** Turns a vassal serves before it may declare its independence. */
export const SERVICE = 10;

/** What a vassal with a turn's gold income pays its master of it (none of a loss). */
export const tributeOf = (gold: number) => Math.floor(Math.max(0, gold) * TRIBUTE);

/** A civ's people: its cities' citizens. */
const peopleOf = (game: Game, i: number) => citiesOf(game, i).reduce((n, c) => n + c.pop, 0);

/** How near a vassal is to its independence: its people, its master's share it needs, and why it can't break free yet (null: it can). */
export function independence(game: Game, v: Player): { people: number; need: number; why: string | null } {
  const m = masterOf(game, v.index);
  if (!m || !v.vassal) return { people: 0, need: 0, why: 'You serve no one' };
  const people = peopleOf(game, v.index);
  const need = Math.max(1, Math.ceil(peopleOf(game, m.index) * INDEPENDENCE));
  const served = game.turn - v.vassal.since;
  const why = served < SERVICE ? `You have served ${m.name} ${served} turn${served === 1 ? '' : 's'}: you may break free after ${SERVICE}` : people < need ? `You need half ${m.name}’s people to break free: ${people} of ${need}` : null;
  return { people, need, why };
}

/** A vassal declares its independence (it's grown strong enough): free, at peace with its old master for a while, who doesn't forget it. */
export function breakFree(game: Game, v: Player): string | null {
  const why = independence(game, v).why;
  if (why) return why;
  free(game, v, 'independence');
  return null;
}

/** A master sets a vassal of its free (who remembers the kindness). */
export function release(game: Game, m: Player, v: Player | undefined): string | null {
  if (!v || masterOf(game, v.index) !== m) return 'They are not your vassal';
  free(game, v, 'freed');
  return null;
}

/**
 * A vassal goes free: by its own declaration, by its master's leave, or with its master gone. Its
 * wars stay its own (at war with whoever it was, now for itself); its borders with its old master
 * close, as anyone's do, and a peace treaty holds between them for a while.
 */
function free(game: Game, v: Player, how: 'independence' | 'freed' | 'fallen') {
  const m = game.players[v.vassal!.master];
  delete v.vassal;
  v.diplomacy.openBorders[m.index] = m.diplomacy.openBorders[v.index] = 0;
  if (how !== 'fallen') {
    v.diplomacy.peaceTurns[m.index] = m.diplomacy.peaceTurns[v.index] = 10;
    if (how === 'independence') remember(game, 'independence', v.index, m.index);
    else remember(game, 'freed', m.index, v.index);
  }
  const words = {
    independence: { v: `You have declared your independence from ${m.name}: your wars and your peace are your own again.`, m: `${v.name} has declared its independence: it serves you no longer.`, all: (r: Player) => `${nameTo(r, v, true)} has declared its independence from ${nameTo(r, m)}.` },
    freed: { v: `${m.name} has set you free: your wars and your peace are your own again.`, m: `You have set ${v.name} free.`, all: (r: Player) => `${nameTo(r, m, true)} has set its vassal ${nameTo(r, v)} free.` },
    fallen: { v: `With ${m.name} gone, you serve no one: your wars and your peace are your own again.`, m: '', all: (r: Player) => `With ${nameTo(r, m)} gone, ${nameTo(r, v)} serves no one.` },
  }[how];
  noteAll(game, (r) => (r === v ? { text: words.v, kind: 'good' } : r === m ? (words.m ? { text: words.m, kind: how === 'independence' ? 'bad' : 'info' } : null) : knowsOf(r, v) || knowsOf(r, m) ? { text: words.all(r), kind: 'info', topic: 'wars' } : null));
}

/**
 * Each turn (once the civs' incomes are in): each vassal pays its master its tribute, a quarter of the
 * turn's gold income; a vassal whose master has gone from the game goes free.
 */
export function vassalsTurn(game: Game) {
  for (const v of game.players) {
    if (!v.vassal) continue;
    if (!v.alive) {
      delete v.vassal;
      continue;
    }
    const m = game.players[v.vassal.master];
    if (!m?.alive) {
      free(game, v, 'fallen');
      continue;
    }
    const paid = Math.min(v.gold, tributeOf(v.lastIncome?.gold ?? 0));
    v.gold -= paid;
    m.gold += paid;
    // (Counted in each side's income for the turn.)
    if (v.lastIncome) v.lastIncome.gold -= paid;
    if (m.lastIncome) m.lastIncome.gold += paid;
    v.vassal.tribute = paid;
  }
}

/** What a master gets from its vassals in tribute a turn (as they paid it last). */
export const tributeFrom = (game: Game, m: Player) => vassalsOf(game, m.index).reduce((n, v) => n + (v.vassal?.tribute ?? 0), 0);
