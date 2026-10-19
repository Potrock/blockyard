import { allyOf, cityStates } from './citystates';
import { civEffects, has, knows, nameTo, note, noteAll, speed } from './core';
import type { Game, Player } from './state';
import { teammates } from './teams';
import { diplomatsOf } from './trade';
import { cannotHold, isProject, projectsTurn, startProject, type ProjectId, type WorldProject } from './projects';
import { RESOURCES } from './terrain';

/**
 * The World Congress, Civ V's (Brave New World), simply: founded when the first civ reaches the
 * Renaissance (it hosts), it meets every thirty turns (at speed). Before each session its host and
 * the civ with the most delegates besides may each put a resolution to it (or the repeal of one in
 * force); at the session every civ casts its delegates for or against each (its city-state allies'
 * with its own), and a resolution passes with more for than against. In force until repealed:
 * an embargo on a civ (no trade routes with it), a banned luxury (no happiness from it), Arts or
 * Sciences Funding (a third faster for some great people, a third slower for the others), a
 * Standing Army Tax (a quarter more for units' upkeep), Nuclear Non-Proliferation (no nuclear
 * weapons built). Or, passed once and done when built, an international project (`projects.ts`).
 */

export type ResolutionKind = 'embargo' | 'ban_luxury' | 'arts_funding' | 'sciences_funding' | 'standing_army_tax' | 'non_proliferation' | ProjectId;
export const RESOLUTION_KINDS: ResolutionKind[] = ['embargo', 'ban_luxury', 'arts_funding', 'sciences_funding', 'standing_army_tax', 'non_proliferation', 'worlds_fair', 'international_games', 'space_station'];

export interface Resolution {
  kind: ResolutionKind;
  /** The civ embargoed (by index), the luxury banned (by id). */
  civ?: number;
  luxury?: string;
  /** In force: the turn it passed. */
  since?: number;
}

export interface Proposal extends Resolution {
  id: number;
  by: number;
  /** Repealing one in force rather than enacting it. */
  repeal?: boolean;
  /** How each civ has said it will vote (none said: it abstains, or a bot decides at the session). */
  votes: Record<number, 'yes' | 'no' | 'abstain'>;
}

export interface Congress {
  host: number;
  /** The turn of the next session. */
  next: number;
  proposals: Proposal[];
  /** Resolutions in force. */
  active: Resolution[];
  /** The last session: its turn, and how each proposal went. */
  last?: { turn: number; results: (Resolution & { repeal?: boolean; passed: boolean; yes: number; no: number })[] };
  /** The international projects it has opened, under way and done. */
  projects?: WorldProject[];
}

/** The era (its index: the Renaissance) in which the World Congress is founded. */
export const CONGRESS_ERA = 3;

/** Turns between sessions (thirty, at speed). */
export const sessionTurns = (game: Game) => Math.max(10, Math.round(30 * speed(game)));

/** What a bot proposes and how it votes (`ai` may set better ones); the defaults look after its own interest simply. */
export const congressHooks: { propose: (game: Game, p: Player) => Omit<Proposal, 'id' | 'by' | 'votes'> | null; vote: (game: Game, p: Player, o: Proposal) => 'yes' | 'no' | 'abstain' } = {
  propose: (game, p) => defaultProposal(game, p),
  vote: (game, p, o) => defaultVote(game, p, o),
};

const majors = (game: Game) => game.players.filter((p) => p.alive && !p.cityState && p.civ !== 'barbarian');

/** Whether a resolution is in force. */
export const inForce = (game: Game, kind: ResolutionKind, test: (r: Resolution) => boolean = () => true) => !!game.congress?.active.some((r) => r.kind === kind && test(r));

/**
 * Whether trade between two civs is embargoed: either one embargoed by the World Congress, or one
 * of them embargoing the other on its own (`diplomacy.ts`'s `declareEmbargo`). No trade routes run
 * between them, and they make no deals of resources, gold a turn or research.
 */
export const embargoed = (game: Game, a: number, b: number) =>
  a !== b && (inForce(game, 'embargo', (r) => r.civ === a || r.civ === b) || !!game.relations?.embargoes?.some((e) => (e.by === a && e.on === b) || (e.by === b && e.on === a)));

/** Whether a luxury is banned (it gives no happiness). */
export const banned = (game: Game, luxury: string) => inForce(game, 'ban_luxury', (r) => r.luxury === luxury);

/** Percent more (or less) for a kind of great person from the funding in force. */
export function fundedGreatPeople(game: Game, kind: string): number {
  const arts = kind === 'artist' || kind === 'writer' || kind === 'musician';
  const sciences = kind === 'scientist' || kind === 'engineer' || kind === 'merchant';
  let pct = 0;
  if (inForce(game, 'arts_funding')) pct += arts ? 33 : sciences ? -33 : 0;
  if (inForce(game, 'sciences_funding')) pct += sciences ? 33 : arts ? -33 : 0;
  return pct;
}

/** Where a civ's delegates come from: two its own, two more as host, two more with the United Nations, one for each city-state it's allied with, one for each diplomat with Globalization. */
export function delegateSources(game: Game, p: Player): { base: number; host: number; un: number; cityStates: number; diplomats: number } {
  return {
    base: 2,
    host: game.congress?.host === p.index ? 2 : 0,
    un: has(civEffects(game, p), 'extra_delegates') ? 2 : 0,
    cityStates: cityStates(game).filter((cs) => allyOf(game, cs.index) === p.index).length,
    diplomats: knows(p, 'globalization') ? diplomatsOf(game, p).length : 0,
  };
}

/** A civ's delegates (`delegateSources`, together). */
export function delegates(game: Game, p: Player): number {
  const d = delegateSources(game, p);
  return d.base + d.host + d.un + d.cityStates + d.diplomats;
}

/** How a civ will vote on a proposal: as it has said (a person; none said, it abstains), or as a bot would. */
export const expectedVote = (game: Game, p: Player, o: Proposal): 'yes' | 'no' | 'abstain' => (p.bot ? congressHooks.vote(game, p, o) : (o.votes[p.index] ?? 'abstain'));

/** The civs that may put a resolution to the next session: the host, and the one with the most delegates besides. */
export function proposers(game: Game): number[] {
  const c = game.congress;
  if (!c) return [];
  const other = majors(game)
    .filter((p) => p.index !== c.host)
    .sort((a, b) => delegates(game, b) - delegates(game, a) || a.index - b.index)[0];
  return [c.host, ...(other ? [other.index] : [])].filter((i) => game.players[i]?.alive);
}

/** Each kind of resolution: its name, its effect in a line, and what it names (a civ, a luxury, or nothing). */
export const RESOLUTIONS: Record<ResolutionKind, { name: string; effect: string; names: 'civ' | 'luxury' | null }> = {
  embargo: { name: 'Embargo', effect: 'No trade routes with the civ named', names: 'civ' },
  ban_luxury: { name: 'Ban a Luxury', effect: 'The luxury named gives no happiness', names: 'luxury' },
  arts_funding: { name: 'Arts Funding', effect: 'Great Artists, Writers and Musicians a third faster; Scientists, Engineers and Merchants a third slower', names: null },
  sciences_funding: { name: 'Sciences Funding', effect: 'Great Scientists, Engineers and Merchants a third faster; Artists, Writers and Musicians a third slower', names: null },
  standing_army_tax: { name: 'Standing Army Tax', effect: "A quarter more for every unit's upkeep", names: null },
  non_proliferation: { name: 'Nuclear Non-Proliferation', effect: 'No nuclear weapons built', names: null },
  worlds_fair: { name: "World's Fair", effect: 'An international project: who puts the most production in gets a free social policy, the others culture', names: null },
  international_games: { name: 'International Games', effect: 'An international project: tourism and happiness for those who put the most production in', names: null },
  space_station: { name: 'International Space Station', effect: 'An international project: science for those who put production in, and faster spaceship parts for the most', names: null },
};

/** A resolution's name (with what it names) and effect, in words, as a reader sees it (a civ they haven't met not named). */
export function resolutionInfo(game: Game, r: Resolution & { repeal?: boolean }, reader: Player): { name: string; effect: string } {
  const info = RESOLUTIONS[r.kind];
  const target = game.players[r.civ ?? -1];
  const civ = target ? nameTo(reader, target) : '?';
  const named = r.kind === 'embargo' ? `Embargo on ${civ}` : r.kind === 'ban_luxury' ? `Ban ${RESOURCES[r.luxury ?? '']?.name ?? r.luxury}` : info.name;
  const effect = r.kind === 'embargo' ? `No trade routes with ${civ}` : r.kind === 'ban_luxury' ? `${RESOURCES[r.luxury ?? '']?.name ?? r.luxury} gives no happiness` : info.effect;
  return r.repeal ? { name: `Repeal: ${named}`, effect: `Ends: ${effect.charAt(0).toLowerCase()}${effect.slice(1)}` } : { name: named, effect };
}

/** A resolution in a line (its name and effect), as a reader sees it. */
export function resolutionText(game: Game, r: Resolution & { repeal?: boolean }, reader: Player): string {
  const { name, effect } = resolutionInfo(game, r, reader);
  return `${name}: ${effect}`;
}

const same = (a: Resolution, b: Resolution) => a.kind === b.kind && a.civ === b.civ && a.luxury === b.luxury;

/** Why a civ can't put this to the next session, if it can't. */
export function cannotPropose(game: Game, p: Player, r: Resolution & { repeal?: boolean }): string | null {
  const c = game.congress;
  if (!c) return 'There is no World Congress yet';
  if (!proposers(game).includes(p.index)) return 'Only the host and the civ with the most delegates besides may propose';
  if (c.proposals.some((o) => o.by === p.index)) return 'You have put a resolution to this session already';
  if (!RESOLUTION_KINDS.includes(r.kind)) return 'No such resolution';
  if (r.kind === 'embargo' && !majors(game).some((o) => o.index === r.civ)) return 'Embargo which civ?';
  if (r.kind === 'ban_luxury' && RESOURCES[r.luxury ?? '']?.kind !== 'luxury') return 'Ban which luxury?';
  if (isProject(r.kind)) {
    if (r.repeal) return 'A project is built, not repealed';
    const why = cannotHold(game, r.kind);
    if (why) return why;
  }
  const inForceNow = c.active.some((a) => same(a, r));
  if (r.repeal && !inForceNow) return "That isn't in force";
  if (!r.repeal && inForceNow) return 'That is in force already';
  if (c.proposals.some((o) => same(o, r) && !!o.repeal === !!r.repeal)) return 'That has been proposed already';
  return null;
}

/** Put a resolution to the next session. */
export function propose(game: Game, p: Player, r: Resolution & { repeal?: boolean }): string | null {
  const why = cannotPropose(game, p, r);
  if (why) return why;
  const c = game.congress!;
  // (Its proposer is for it, until they say otherwise.)
  const o: Proposal = { id: game.nextId++, by: p.index, kind: r.kind, votes: { [p.index]: 'yes' }, ...(r.civ !== undefined ? { civ: r.civ } : {}), ...(r.luxury !== undefined ? { luxury: r.luxury } : {}), ...(r.repeal ? { repeal: true } : {}) };
  c.proposals.push(o);
  noteAll(game, (x) => (x.cityState || x.civ === 'barbarian' ? null : { text: `${x === p ? 'You have' : `${nameTo(x, p, true)} has`} put a resolution to the World Congress: ${resolutionText(game, o, x)}.`, kind: 'info', topic: 'congress' }));
  return null;
}

/** Say how a civ will vote on a proposal at the next session. */
export function vote(game: Game, p: Player, proposal: number, how: 'yes' | 'no' | 'abstain'): string | null {
  const o = game.congress?.proposals.find((x) => x.id === proposal);
  if (!o) return 'No such proposal';
  o.votes[p.index] = how;
  return null;
}

/** Each turn: the World Congress is founded, takes proposals, and meets. */
export function congressTurn(game: Game, eraOf: (p: Player) => number) {
  const living = majors(game);
  if (!game.congress) {
    const founder = living.find((p) => eraOf(p) >= CONGRESS_ERA);
    if (!founder) return;
    game.congress = { host: founder.index, next: game.turn + sessionTurns(game), proposals: [], active: [] };
    noteAll(game, (x) => (x.cityState || x.civ === 'barbarian' ? null : { text: `The World Congress is founded, with ${x === founder ? 'you' : nameTo(x, founder)} as its host: it meets every ${sessionTurns(game)} turns.`, kind: 'info', topic: 'congress' }));
    return;
  }
  const c = game.congress;
  projectsTurn(game);
  if (!game.players[c.host]?.alive) c.host = living[0]?.index ?? c.host;
  // Bots who may propose do so (before the session's last turns).
  for (const i of proposers(game)) {
    const p = game.players[i];
    if (!p.bot || c.proposals.some((o) => o.by === i)) continue;
    const r = congressHooks.propose(game, p);
    if (r && !cannotPropose(game, p, r)) propose(game, p, r);
  }
  if (game.turn < c.next) return;
  // The session: each proposal voted on, with each civ's delegates.
  const results: NonNullable<Congress['last']>['results'] = [];
  for (const o of c.proposals) {
    let yes = 0;
    let no = 0;
    for (const p of living) {
      const how = expectedVote(game, p, o);
      if (how === 'yes') yes += delegates(game, p);
      if (how === 'no') no += delegates(game, p);
    }
    const passed = yes > no;
    const r: Resolution = { kind: o.kind, ...(o.civ !== undefined ? { civ: o.civ } : {}), ...(o.luxury !== undefined ? { luxury: o.luxury } : {}) };
    if (passed && o.repeal) c.active = c.active.filter((a) => !same(a, o));
    else if (passed && isProject(o.kind)) startProject(game, o.kind);
    else if (passed) c.active.push({ ...r, since: game.turn });
    results.push({ ...r, ...(o.repeal ? { repeal: true } : {}), passed, yes, no });
    noteAll(game, (x) => (x.cityState || x.civ === 'barbarian' ? null : { text: `The World Congress ${passed ? 'passes' : 'rejects'} ${resolutionText(game, o, x)} (${yes} for, ${no} against).`, kind: passed ? 'good' : 'info', topic: 'congress' }));
  }
  c.last = { turn: game.turn, results };
  c.proposals = [];
  c.next = game.turn + sessionTurns(game);
  for (const i of proposers(game)) if (!game.players[i].bot) note(game, i, { text: 'You may put a resolution to the World Congress before its next session.', kind: 'info' });
}

/** A bot's first thought for a resolution: an embargo on the civ furthest ahead of it, a luxury it lacks banned, funding for its kind of great people. */
function defaultProposal(game: Game, p: Player): Omit<Proposal, 'id' | 'by' | 'votes'> | null {
  const rivals = majors(game).filter((o) => o !== p && !teammates(game, p.index, o.index));
  const leader = rivals.sort((a, b) => b.techs.length - a.techs.length)[0];
  if (leader && leader.techs.length > p.techs.length + 4) return { kind: 'embargo', civ: leader.index };
  const theirs = new Set(game.tiles.flatMap((t) => (t.resource && RESOURCES[t.resource].kind === 'luxury' && t.owner >= 0 && rivals.some((o) => o.index === t.owner) ? [t.resource] : [])));
  const mine = new Set(game.tiles.flatMap((t) => (t.resource && t.owner === p.index ? [t.resource] : [])));
  const ban = [...theirs].find((r) => !mine.has(r));
  if (ban) return { kind: 'ban_luxury', luxury: ban };
  const arts = (p.greatPoints.artist ?? 0) + (p.greatPoints.writer ?? 0) + (p.greatPoints.musician ?? 0);
  const sciences = (p.greatPoints.scientist ?? 0) + (p.greatPoints.engineer ?? 0) + (p.greatPoints.merchant ?? 0);
  return { kind: arts > sciences ? 'arts_funding' : 'sciences_funding' };
}

/** A bot's vote: for its own (and its team's), against what hurts it; the rest it leaves to others. */
function defaultVote(game: Game, p: Player, o: Proposal): 'yes' | 'no' | 'abstain' {
  if (o.by === p.index || teammates(game, p.index, o.by)) return 'yes';
  const hurtsMe = (() => {
    switch (o.kind) {
      case 'embargo':
        return o.civ === p.index || teammates(game, p.index, o.civ ?? -1);
      case 'ban_luxury':
        return game.tiles.some((t) => t.owner === p.index && t.resource === o.luxury);
      case 'arts_funding':
        return (p.greatPoints.scientist ?? 0) + (p.greatPoints.engineer ?? 0) > (p.greatPoints.artist ?? 0) + (p.greatPoints.writer ?? 0);
      case 'sciences_funding':
        return (p.greatPoints.artist ?? 0) + (p.greatPoints.writer ?? 0) > (p.greatPoints.scientist ?? 0) + (p.greatPoints.engineer ?? 0);
      case 'standing_army_tax':
        return game.units.filter((u) => u.owner === p.index).length > game.units.length / Math.max(1, majors(game).length);
      case 'non_proliferation':
        return knows(p, 'nuclear_fission');
      default:
        return false;
    }
  })();
  if (o.repeal) return hurtsMe ? 'yes' : 'abstain';
  return hurtsMe ? 'no' : 'abstain';
}
