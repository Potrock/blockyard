import { atWar, citiesOf, knows } from '../core';
import { BUILDINGS } from '../buildings';
import { askOf, cannotEmbargo, dealTurns, dealer, declinedLately, denounced, embargoOn, embargoTurns, friends, hasMet, lentLuxuries, luxuryCopies, pacted, relationsOf, researchCost, spareIncome, tradeable, type Deal, type DealItem } from '../diplomacy';
import { embargoed } from '../congress';
import { strategic } from '../economy';
import { eraOf } from '../game';
import type { Game, Player } from '../state';
import { teamedWithPeople, teammates } from '../teams';
import { TECHS } from '../techs';
import { UNIT_LIST } from '../units';
import { act, makeCtx, mightOf, type Ctx } from './context';
import { opinionOf } from './opinion';
import { kneels, warScore, wantsPeace } from './strategy';

/**
 * The bots at the table. A deal is weighed item by item in gold (a luxury it lacks is worth its
 * happiness for the deal's length, its only copy of one is not given lightly, the strategic resources
 * it builds with are kept, open borders are a risk with those it distrusts, friendship and pacts only
 * for those it likes), and what the leader thinks of the other side moves the line: a friend gets a
 * fair deal on less, the hated get nothing. Each bot, now and then, puts a deal to someone it gets on
 * with (luxuries swapped or bought, strategic resources it lacks, embassies, open borders, research
 * agreements, friendship, a defensive pact), and denounces those it hates.
 */

/** What a luxury the bot lacks is worth to it a turn (its four happiness, dearer the unhappier it is). */
const luxuryWorth = (ctx: Ctx) => 4 * (ctx.mood < 0 ? 3 : ctx.mood < 4 ? 2 : 1.2);

/** What one item is worth to the bot over the deal (gold): above 0 what it gains, below what it gives. */
function itemValue(ctx: Ctx, other: Player, item: DealItem, opinion: number): number {
  const { game, me, pers } = ctx;
  const turns = dealTurns(game);
  const mine = 'from' in item && item.from === me;
  const dear = 0.8 + pers.gold * 0.04;
  switch (item.kind) {
    case 'gold':
      return mine ? -item.amount * dear : item.amount;
    case 'goldPerTurn':
      // (Never more than its income can pay.)
      if (mine) return ctx.income - item.amount < 2 ? -10000 : -item.amount * turns * dear;
      // (Received: worth no more than the payer's income can keep paying.)
      return Math.min(item.amount, spareIncome(game, other)) * turns * 0.85;
    case 'luxury': {
      if (!mine) return luxuryCopies(game, ctx.p).get(item.resource) || lentLuxuries(game, ctx.p).got.has(item.resource) ? turns * 0.5 : luxuryWorth(ctx) * turns;
      const spare = (luxuryCopies(game, ctx.p).get(item.resource) ?? 0) - (lentLuxuries(game, ctx.p).sent.get(item.resource) ?? 0);
      return spare <= 1 ? -luxuryWorth(ctx) * turns * 1.1 : -turns * (1.5 + (opinion < 0 ? 1 : 0));
    }
    case 'strategic': {
      const fighting = ctx.wars.length > 0 || !!ctx.mem.plan;
      const r = strategic(game, ctx.p)[item.resource];
      const spare = r ? r.have - r.used : 0;
      const need = strategicNeed(ctx, item.resource);
      if (!mine) {
        // Received: dear when it's short of what it builds with (and in a war), cheap when it has plenty.
        const short = spare < need;
        return item.amount * turns * (short ? 1.5 : 0.3) * (fighting ? 1.5 : 1);
      }
      // Given: never what it needs for the units and buildings it makes (or will soon), and never cheap.
      if (spare - item.amount < need) return -10000;
      return -item.amount * turns * (need ? 1.5 : 0.8) * (fighting ? 1.5 : 1) * (opinion < 0 ? 2 : 1);
    }
    case 'openBorders':
      if (!mine) return 12 + (ctx.mem.aim === 'culture' ? 15 : 0);
      if (friends(game, me, other.index)) return -3;
      return -(10 + Math.max(0, -opinion) * 2 + (mightOf(ctx, other.index) > mightOf(ctx, me) * 1.2 ? 20 : 0));
    case 'embassy':
      return mine ? (opinion >= 0 ? 0 : -6) : 12;
    case 'research': {
      const science = Math.min(ctx.p.lastIncome?.science ?? 0, other.lastIncome?.science ?? 0);
      const gain = science * turns * 0.4 * (ctx.p.policies.includes('scientific_revolution') ? 2 : 1);
      return gain * (ctx.mem.aim === 'science' ? 1.2 : 0.9) - researchCost(game, Math.max(eraOf(ctx.p), eraOf(other))) * dear;
    }
    case 'friendship':
      return opinion >= 12 ? 40 : opinion >= 8 ? 5 : -400;
    case 'pact':
      return friends(game, me, other.index) && opinion >= 22 ? 40 + (ctx.wars.length ? 40 : 0) : -400;
    case 'peace':
      return wantsPeace(ctx, other.index) ? 250 : -(120 + Math.max(0, warScore(ctx, other.index)) * 5);
    case 'vassal':
      // Its own capitulation only when beaten (`kneels`), and a relief then; another's, worth more
      // than its cities taken one by one (its tribute, its army beside the bot's, its capital toward
      // a domination victory).
      if (mine) return kneels(ctx, other.index) ? 300 : -10000;
      return 250 + citiesOf(game, other.index).length * 60 + (ctx.mem.aim === 'domination' ? 150 : 0);
  }
}

/**
 * How many copies of a strategic resource the bot keeps for itself: for the units and buildings that
 * use it which it can make now (two, four in a war), or soon (one, once the tech is near).
 */
export const strategicNeed = (ctx: Ctx, resource: string) => strategicNeedOf(ctx.p, resource, ctx.wars.length > 0 || !!ctx.mem.plan);

/** How many copies of a strategic resource a civ (a bot, or a person as a bot would judge it) keeps for what it makes: see `strategicNeed`. */
function strategicNeedOf(p: Player, resource: string, fighting: boolean): number {
  const known = Math.max(0, ...p.techs.map((t) => TECHS[t]?.col ?? 0));
  const uses = [...UNIT_LIST.filter((u) => u.resource === resource && !u.civ && !(u.obsolete && knows(p, u.obsolete))), ...Object.values(BUILDINGS).filter((b) => b.resource === resource)];
  if (uses.some((x) => !x.tech || knows(p, x.tech))) return fighting ? 4 : 2;
  return uses.some((x) => x.tech && (TECHS[x.tech]?.col ?? 99) <= known + 2) ? 1 : 0;
}

/** Why a bot turns down one item outright (the worst of a refused deal), if it does. */
function refusal(item: DealItem, me: number): string | null {
  if (item.kind === 'friendship') return "we don't know you well enough for friendship";
  if (item.kind === 'pact') return 'a pact is only for our closest friends';
  if (item.kind === 'peace') return 'this war is not over';
  if (item.kind === 'vassal' && item.from === me) return 'we would sooner fall than kneel';
  if (item.kind === 'luxury' && item.from === me) return 'we will not give up our only copy';
  if (item.kind === 'goldPerTurn' && item.from === me) return "we can't pay that much a turn";
  if (item.kind === 'strategic' && item.from === me) return `we need our ${item.resource} ourselves`;
  return null;
}

/** What a deal is worth to the bot, all told (gold), and what its leader thinks of the other side. */
function weigh(ctx: Ctx, deal: Deal): { value: number; opinion: number; worst: DealItem | null } {
  const other = ctx.game.players[deal.from === ctx.me ? deal.to : deal.from];
  const opinion = opinionOf(ctx.game, ctx.p, other).total;
  let value = 0;
  let worst: DealItem | null = null;
  let low = Infinity;
  // (A capitulation is the deal's peace: the peace that comes with it is worth nothing more.)
  const kneeling = deal.items.some((x) => x.kind === 'vassal');
  for (const item of deal.items) {
    const v = item.kind === 'peace' && kneeling ? 0 : itemValue(ctx, other, item, opinion);
    value += v;
    if (v < low) (low = v), (worst = item);
  }
  return { value, opinion, worst };
}

/**
 * How far a deal falls short of what the bot would take (gold; 0 or less: enough, as `evaluate` weighs
 * it, its outright refusals aside): read by the advisor's deal helper for people (`advisor.ts`).
 */
export function dealShortfall(game: Game, bot: Player, deal: Deal): number {
  const { value, opinion } = weigh(makeCtx(game, bot), deal);
  return -(value + opinion * 3);
}

/** A bot's answer to a deal put to it (the rules ask). */
export function evaluate(game: Game, bot: Player, deal: Deal): { accept: boolean; why?: string } {
  const ctx = makeCtx(game, bot);
  const other = game.players[deal.from === bot.index ? deal.to : deal.from];
  const { value, opinion, worst } = weigh(ctx, deal);
  // A teammate gets what it asks for, short of what the bot can't spare (`-10000` items) or more than a little.
  // (On a team with people, they make the team's peace: none bought from its bot, `wantsPeace`.)
  if (deal.items.some((x) => x.kind === 'peace' || x.kind === 'vassal') && teamedWithPeople(game, bot.index)) return { accept: false, why: 'our team’s people make our peace' };
  if (teammates(game, bot.index, other.index)) return value > -60 ? { accept: true } : { accept: false, why: (worst && refusal(worst, bot.index)) ?? 'we need that ourselves' };
  const onlyGifts = deal.items.every((x) => x.kind === 'peace' || ('from' in x && x.from === other.index));
  // (Beaten, a leader kneels to the one it hates as readily as to any: it has no choice.)
  const beaten = deal.items.some((x) => x.kind === 'vassal' && x.from === bot.index) && kneels(ctx, other.index);
  if (opinion <= -25 && !onlyGifts && !beaten) return { accept: false, why: 'we have nothing to discuss with you' };
  if (denounced(game, bot.index, other.index) && !onlyGifts && !beaten) return { accept: false, why: 'we have denounced you' };
  const short = -(value + (beaten ? 0 : opinion * 3));
  if (short <= 0) return { accept: true };
  const flat = worst && refusal(worst, bot.index);
  if (flat && short > 200) return { accept: false, why: flat };
  return { accept: false, why: `they'd want about ${Math.ceil(short / 10) * 10} gold more` };
}

/** Luxuries a civ has a copy to spare of (two or more, less any lent out). */
function spareLuxuries(game: Game, p: Player): string[] {
  const sent = lentLuxuries(game, p).sent;
  return [...luxuryCopies(game, p)].filter(([r, n]) => n - (sent.get(r) ?? 0) >= 2).map(([r]) => r);
}

/** Luxuries a civ lacks among those another has. */
const lacking = (game: Game, p: Player, from: string[]) => from.filter((r) => !luxuryCopies(game, p).get(r) && !lentLuxuries(game, p).got.has(r));

/** Deals worth putting to another civ, best first (each from the bot to it). */
function candidates(ctx: Ctx, o: Player, opinion: number): DealItem[][] {
  const { game, me, p } = ctx;
  const out: DealItem[][] = [];
  const mineSpare = spareLuxuries(game, p);
  const theirSpare = spareLuxuries(game, o);
  const iWant = lacking(game, p, theirSpare);
  const theyWant = lacking(game, o, mineSpare);
  // A teammate is given the luxuries it lacks that the bot has to spare, for nothing.
  if (teammates(game, me, o.index)) return theyWant.slice(0, 2).map((r) => [{ kind: 'luxury', from: me, resource: r }]);
  if (iWant.length && theyWant.length) out.push([{ kind: 'luxury', from: me, resource: theyWant[0] }, { kind: 'luxury', from: o.index, resource: iWant[0] }]);
  if (!p.diplomacy.embassy[o.index] && !o.diplomacy.embassy[me] && knows(p, 'writing') && knows(o, 'writing')) out.push([{ kind: 'embassy', from: me }, { kind: 'embassy', from: o.index }]);
  if (theyWant.length && (o.lastIncome?.gold ?? 0) >= 6) out.push([{ kind: 'luxury', from: me, resource: theyWant[0] }, { kind: 'goldPerTurn', from: o.index, amount: Math.min(6, Math.floor((o.lastIncome?.gold ?? 0) / 2)) }]);
  // (A luxury it lacks is bought readily while its people are near discontent.)
  if (iWant.length && ctx.income >= (ctx.mood < 3 ? 4 : 8)) out.push([{ kind: 'luxury', from: o.index, resource: iWant[0] }, { kind: 'goldPerTurn', from: me, amount: Math.min(ctx.mood < 3 ? 7 : 5, Math.floor(ctx.income / 2)) }]);
  // A strategic resource it needs and lacks, from one with copies to spare beyond what it needs itself.
  const theirs = tradeable(game, o).strategic;
  for (const [res, n] of Object.entries(theirs)) {
    const r = strategic(game, p)[res];
    const short = strategicNeed(ctx, res) - (r ? r.have - r.used : 0);
    const spare = n - strategicNeedOf(o, res, o.diplomacy.war.some((w, i) => w && !game.players[i].cityState && game.players[i].civ !== 'barbarian'));
    if (short > 0 && spare > 0 && ctx.income >= 6) {
      out.push([{ kind: 'strategic', from: o.index, resource: res, amount: Math.min(short, spare, 2) }, { kind: 'goldPerTurn', from: me, amount: Math.min(4, Math.floor(ctx.income / 3)) }]);
      break;
    }
  }
  if (opinion >= 8 && knows(p, 'writing') && knows(o, 'writing') && !p.diplomacy.openBorders[o.index] && !o.diplomacy.openBorders[me]) out.push([{ kind: 'openBorders', from: me }, { kind: 'openBorders', from: o.index }]);
  const cost = researchCost(game, Math.max(eraOf(p), eraOf(o)));
  if ((ctx.mem.aim === 'science' || ctx.pers.science >= 6 || friends(game, me, o.index)) && p.gold >= cost + 100 && o.gold >= cost) out.push([{ kind: 'research' }]);
  if (opinion >= 14 && !friends(game, me, o.index)) out.push([{ kind: 'friendship' }]);
  if (opinion >= 25 && friends(game, me, o.index) && !pacted(game, me, o.index)) out.push([{ kind: 'pact' }]);
  return out;
}

/**
 * The bot's diplomacy each turn: it denounces a civ it has come to hate; now and then it puts a deal
 * to someone it gets on with (a bot answers at once; a person is asked, no more than every few turns).
 */
export function negotiate(ctx: Ctx) {
  const { game, p, me, mem } = ctx;
  if (p.cityState || !ctx.cities.length) return;
  const known = game.players.filter((o) => o !== p && dealer(o) && hasMet(game, p, o));
  const opinions = new Map(known.map((o) => [o.index, opinionOf(game, p, o).total]));
  // The hated are denounced (one a turn), once the bot's found its feet.
  if (game.turn > 30) {
    const hated = known.filter((o) => !denounced(game, me, o.index) && !atWar(game, me, o.index) && (opinions.get(o.index) ?? 0) <= -25).sort((a, b) => (opinions.get(a.index) ?? 0) - (opinions.get(b.index) ?? 0))[0];
    if (hated) act(ctx, { t: 'denounce', target: hated.index });
    // One it has denounced and hates still more is embargoed too (one a turn); lifted once it's no longer hated.
    const loathed = known.find((o) => denounced(game, me, o.index) && !atWar(game, me, o.index) && !embargoOn(game, me, o.index) && (opinions.get(o.index) ?? 0) <= -40);
    if (loathed && !cannotEmbargo(game, p, loathed)) act(ctx, { t: 'embargo', target: loathed.index });
    const forgiven = known.find((o) => {
      const e = embargoOn(game, me, o.index);
      return e && game.turn - e.turn >= embargoTurns(game) && (opinions.get(o.index) ?? 0) > -15;
    });
    if (forgiven) act(ctx, { t: 'embargo', target: forgiven.index, lift: true });
  }
  if ((game.turn + me) % 3 !== 0) return;
  const offered = (mem.offered ??= {});
  // A person is asked at most every ten turns by each bot, and not while any deal waits for their
  // answer; what they've turned down lately (from anyone) isn't asked again for twenty.
  const partners = known
    .filter((o) => !atWar(game, me, o.index) && !denounced(game, me, o.index) && !denounced(game, o.index, me) && !embargoed(game, me, o.index) && (opinions.get(o.index) ?? 0) > -8)
    .filter((o) => o.bot || ((game.turn - (offered[o.index] ?? -99)) >= 10 && !relationsOf(game).offers.some((x) => x.to === o.index)))
    .sort((a, b) => (opinions.get(b.index) ?? 0) - (opinions.get(a.index) ?? 0));
  for (const o of partners) {
    for (const items of candidates(ctx, o, opinions.get(o.index) ?? 0)) {
      const deal: Deal = { from: me, to: o.index, items };
      if (!o.bot && declinedLately(game, o.index, askOf(deal), 20)) continue;
      if (weigh(ctx, deal).value < 0 && !teammates(game, me, o.index)) continue;
      if (o.bot) {
        if (!act(ctx, { t: 'deal', target: o.index, items })) continue;
        return;
      }
      if (act(ctx, { t: 'deal', target: o.index, items })) {
        offered[o.index] = game.turn;
        return;
      }
    }
  }
}
