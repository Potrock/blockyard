import { automation, autoPromote, botHooks } from './game';
import { note } from './core';
import { distance } from './hex';
import type { Game, Player, Unit } from './state';
import { UNITS } from './units';
import { aircraft } from './ai/air';
import { civilians } from './ai/civilians';
import { congressProposal, congressVote } from './ai/congress';
import { greatChoice, pantheon, policies, research } from './ai/civics';
import { act, cityOn, makeCtx, type Ctx } from './ai/context';
import { pledges, turnsOn } from './ai/liberation';
import { attacks, cityFire, exploreAbroad, exploreStep, moveUnits, pillageAll } from './ai/military';
import { exploreSea, seaport } from './ai/navy';
import { manageCities, pickProduction, spend, spendFaith } from './ai/production';
import { settle } from './ai/settle';
import { acceptsPeace, chooseAim, conquests, diplomacy, makePeace, planWar, trackWars } from './ai/strategy';
import { workBoats, workers } from './ai/workers';
import { evaluate, negotiate } from './ai/diplomacy';
import { congressHooks } from './congress';
import { diploHooks } from './diplomacy';

/**
 * The bots: rivals in the way of Civilization V's, each with its leader's character (`ai/personality`)
 * and a victory it works toward. A bot's turn: its grand strategy (its aim, its wars and its peace),
 * research and policies, what its cities build and its gold buys, its settlers, workers and soldiers,
 * and its great people, caravans, missionaries and spies. They play by the same rules as people: every
 * move goes through `apply`.
 */

/** A bot plays its turn (at the start of each turn). */
export function botTurn(game: Game, p: Player) {
  if (!p.alive || p.civ === 'barbarian') return;
  const ctx = makeCtx(game, p);
  forget(ctx);
  for (const u of game.units) if (u.owner === p.index) autoPromote(game, u);
  if (!p.cityState) {
    chooseAim(ctx);
    trackWars(ctx);
    makePeace(ctx);
    planWar(ctx);
    conquests(ctx);
    diplomacy(ctx);
    pledges(ctx);
    turnsOn(ctx);
    negotiate(ctx);
    research(ctx);
    policies(ctx);
    pantheon(ctx);
    greatChoice(ctx);
  }
  // The garrison of each city (its soldier), who fires but doesn't sally out.
  const garrisons = new Set<number>();
  for (const u of game.units) if (u.owner === p.index && cityOn(ctx, u.tile)?.owner === p.index) garrisons.add(u.id);
  cityFire(ctx);
  aircraft(ctx);
  attacks(ctx, garrisons);
  manageCities(ctx);
  spend(ctx);
  spendFaith(ctx);
  const mine = game.units.filter((u) => u.owner === p.index);
  for (const u of mine) if (UNITS[u.type].abilities?.includes('found_city') && game.units.includes(u)) settle(ctx, u);
  workers(ctx, mine.filter((u) => UNITS[u.type].abilities?.includes('build') && game.units.includes(u)));
  workBoats(ctx, mine.filter((u) => u.type === 'work_boat' && game.units.includes(u)));
  moveUnits(ctx, garrisons);
  attacks(ctx, garrisons);
  pillageAll(ctx);
  civilians(ctx);
  p.ready = true;
}

/**
 * A person's automated units, moved by the bots' own logic (at the start of each turn, and when one is
 * first set to it): workers improve and connect the land, explorers go where nothing's been seen (over
 * the water too: ships, and soldiers once they can embark), out of enemy reach; an explorer with
 * nothing left to see heads home, and says so.
 */
export function automate(game: Game, p: Player, only?: Unit[]) {
  const units = (only ?? game.units).filter((u) => u.owner === p.index && u.auto && game.units.includes(u));
  if (!units.length || !p.alive) return;
  automation.running = true;
  try {
    const ctx = makeCtx(game, p);
    forget(ctx);
    workers(ctx, units.filter((u) => u.auto === 'work' && UNITS[u.type].abilities?.includes('build')));
    workBoats(ctx, units.filter((u) => u.auto === 'work' && u.type === 'work_boat'));
    for (const u of units.filter((x) => x.auto === 'explore')) {
      if (u.moves <= 0) continue;
      const sea = UNITS[u.type].domain === 'sea';
      if (sea ? exploreSea(ctx, u) : exploreStep(ctx, u, 20) || exploreAbroad(ctx, u)) continue;
      // Nothing left to see: home to the nearest city (a port, for a ship), and it says so.
      u.auto = undefined;
      const home = ctx.cities.filter((c) => !sea || seaport(ctx, c)).sort((a, b) => distance(game.grid, a.tile, u.tile) - distance(game.grid, b.tile, u.tile))[0];
      if (home && home.tile !== u.tile) act(ctx, { t: 'move', unit: u.id, to: home.tile });
      note(game, p.index, { text: `Your ${UNITS[u.type].name} has nothing left to explore${home ? `, and heads home to ${home.name}` : ''}.`, at: u.tile, kind: 'info' });
    }
  } finally {
    automation.running = false;
  }
}

/** Orders for units that are gone are forgotten. */
function forget(ctx: Ctx) {
  const ids = new Set(ctx.game.units.filter((u) => u.owner === ctx.me).map((u) => u.id));
  for (const id of Object.keys(ctx.mem.orders)) if (!ids.has(Number(id))) delete ctx.mem.orders[Number(id)];
}

botHooks.choose = (game, p, c) => pickProduction(makeCtx(game, p), c);
botHooks.acceptsPeace = acceptsPeace;
diploHooks.evaluate = evaluate;
botHooks.automate = automate;
congressHooks.propose = congressProposal;
congressHooks.vote = congressVote;
