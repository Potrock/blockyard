import type { Proposal, Resolution } from '../congress';
import { knows } from '../core';
import { friends, pacted } from '../diplomacy';
import { score } from '../game';
import type { Game, Player } from '../state';
import { teammates } from '../teams';
import { RESOURCES } from '../terrain';
import { majors, routesOf } from '../trade';
import { isMilitary, UNITS } from '../units';
import { nearVictory, opinionOf } from './opinion';

/**
 * The bots in the World Congress. A bot proposes what serves it: the repeal of what hurts it, an
 * embargo on a rival close to winning (or the leader it dislikes), the funding its victory wants, a
 * luxury of the leader's banned, a tax on a conqueror's army, no bombs while it has none. It votes for
 * its own and its friends' (unless they hurt it), against what hurts it or helps a rival it fears, and
 * for what serves its aim; the rest it leaves to others.
 */

type Vote = 'yes' | 'no' | 'abstain';

/** Whether a resolution (enacted) would hurt the bot. */
function hurts(game: Game, p: Player, r: Resolution): boolean {
  const aim = p.ai?.aim;
  switch (r.kind) {
    case 'embargo':
      return r.civ === p.index || teammates(game, p.index, r.civ ?? -1) || routesOf(p).some((x) => game.cities.find((c) => c.id === x.to)?.owner === r.civ);
    case 'ban_luxury':
      return game.tiles.some((t) => t.owner === p.index && t.resource === r.luxury);
    case 'arts_funding':
      return aim === 'science' || (aim !== 'culture' && sciencePoints(p) > artsPoints(p));
    case 'sciences_funding':
      return aim === 'culture' || (aim !== 'science' && artsPoints(p) > sciencePoints(p));
    case 'standing_army_tax':
      return aim === 'domination' || soldiers(game, p.index) > average(game, (o) => soldiers(game, o.index));
    case 'non_proliferation':
      return knows(p, 'nuclear_fission');
  }
}

/** Whether a resolution (enacted) would serve the bot: hurting a rival it fears or dislikes, or helping its aim. */
function serves(game: Game, p: Player, r: Resolution): boolean {
  if (hurts(game, p, r)) return false;
  switch (r.kind) {
    case 'embargo':
      return r.civ !== undefined && feared(game, p, game.players[r.civ]);
    case 'ban_luxury':
      return game.tiles.some((t) => t.resource === r.luxury && t.owner >= 0 && t.owner !== p.index && feared(game, p, game.players[t.owner]));
    case 'arts_funding':
      return p.ai?.aim === 'culture';
    case 'sciences_funding':
      return p.ai?.aim === 'science';
    case 'standing_army_tax':
      return majors(game).some((o) => o !== p && o.ai?.aim === 'domination' && soldiers(game, o.index) > soldiers(game, p.index) * 1.5);
    case 'non_proliferation':
      return majors(game).some((o) => o !== p && knows(o, 'nuclear_fission'));
  }
}

/** A rival the bot would see held back: close to winning, or the leader by score it doesn't like (never a friend). */
function feared(game: Game, p: Player, o: Player | undefined): boolean {
  if (!o || o === p || o.cityState || teammates(game, p.index, o.index) || friends(game, p.index, o.index) || pacted(game, p.index, o.index)) return false;
  if (nearVictory(game, o)) return true;
  const leader = majors(game).filter((x) => x.alive).sort((a, b) => score(game, b) - score(game, a))[0];
  return leader === o && score(game, o) > score(game, p) && opinionOf(game, p, o).total < 0;
}

/** What the bot puts to the session, if anything. */
export function congressProposal(game: Game, p: Player): (Resolution & { repeal?: boolean }) | null {
  // The repeal of what hurts it, first.
  const hurting = game.congress?.active.find((r) => hurts(game, p, r));
  if (hurting) return { kind: hurting.kind, ...(hurting.civ !== undefined ? { civ: hurting.civ } : {}), ...(hurting.luxury !== undefined ? { luxury: hurting.luxury } : {}), repeal: true };
  const options: Resolution[] = [];
  const rivals = majors(game).filter((o) => o.alive && feared(game, p, o)).sort((a, b) => +nearVictory(game, b) - +nearVictory(game, a) || score(game, b) - score(game, a));
  for (const o of rivals) options.push({ kind: 'embargo', civ: o.index });
  if (p.ai?.aim === 'culture') options.push({ kind: 'arts_funding' });
  if (p.ai?.aim === 'science') options.push({ kind: 'sciences_funding' });
  for (const o of rivals) {
    const theirs = new Set(game.tiles.filter((t) => t.owner === o.index && t.resource && RESOURCES[t.resource].kind === 'luxury').map((t) => t.resource!));
    for (const lux of theirs) options.push({ kind: 'ban_luxury', luxury: lux });
  }
  options.push({ kind: 'standing_army_tax' }, { kind: 'non_proliferation' });
  return options.find((r) => serves(game, p, r) && !game.congress?.active.some((a) => a.kind === r.kind && a.civ === r.civ && a.luxury === r.luxury)) ?? null;
}

/** How the bot votes on a proposal at the session. */
export function congressVote(game: Game, p: Player, o: Proposal): Vote {
  if (o.by === p.index || teammates(game, p.index, o.by)) return 'yes';
  const harm = hurts(game, p, o);
  const good = serves(game, p, o);
  // A repeal: for it when what's in force hurts the bot, against when it serves it.
  if (o.repeal) return harm ? 'yes' : good ? 'no' : 'abstain';
  if (harm) return 'no';
  if (good) return 'yes';
  // The rest: with a friend (or one it likes), against one it dislikes.
  const proposer = game.players[o.by];
  if (friends(game, p.index, o.by) || pacted(game, p.index, o.by)) return 'yes';
  const thought = opinionOf(game, p, proposer).total;
  return thought >= 8 ? 'yes' : thought <= -8 ? 'no' : 'abstain';
}

const artsPoints = (p: Player) => (p.greatPoints.artist ?? 0) + (p.greatPoints.writer ?? 0) + (p.greatPoints.musician ?? 0);
const sciencePoints = (p: Player) => (p.greatPoints.scientist ?? 0) + (p.greatPoints.engineer ?? 0) + (p.greatPoints.merchant ?? 0);
const soldiers = (game: Game, i: number) => game.units.filter((u) => u.owner === i && isMilitary(UNITS[u.type])).length;
const average = (game: Game, f: (o: Player) => number) => {
  const all = majors(game).filter((o) => o.alive);
  return all.reduce((s, o) => s + f(o), 0) / Math.max(1, all.length);
};
