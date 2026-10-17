import { atWar, capitalOf, civEffects, has, knows, knowsOf, nameTo, note, noteAll, speed } from './core';
import { strategic } from './economy';
import type { Game, Note, Player } from './state';
import { sides, teammates } from './teams';
import { eraOfCol, ERAS, TECHS } from './techs';
import { RESOURCES, tapped } from './terrain';

/**
 * Diplomacy, Civilization V's way: two civs make deals (gold now or each turn, luxuries and strategic
 * resources for a while, open borders, embassies, research agreements, declarations of friendship,
 * defensive pacts, peace), a person answering in their own time, a bot at once; a civ can denounce
 * another; declaring war cancels what two civs had agreed, betrays a friendship, and brings in the
 * victim's defensive pacts. Everything that happens between civs is remembered for a while, for the
 * bots' opinions of each other (`ai/opinion.ts`).
 */

/** What a deal can hold: from one side (`from`), or both alike. */
export type DealItem =
  | { kind: 'gold'; from: number; amount: number }
  | { kind: 'goldPerTurn'; from: number; amount: number }
  | { kind: 'luxury'; from: number; resource: string }
  | { kind: 'strategic'; from: number; resource: string; amount: number }
  | { kind: 'openBorders'; from: number }
  | { kind: 'embassy'; from: number }
  | { kind: 'research' }
  | { kind: 'friendship' }
  | { kind: 'pact' }
  | { kind: 'peace' };

/** A deal one civ puts to another. */
export interface Deal {
  from: number;
  to: number;
  items: DealItem[];
}

/** A deal waiting for a person's answer. */
export interface Offer extends Deal {
  id: number;
  turn: number;
}

/** A deal's part that runs for a while (gold each turn, a resource lent, a research agreement): between whom, turns left. */
export interface Running {
  a: number;
  b: number;
  item: DealItem;
  turns: number;
}

/** Something one civ did to another, remembered (for opinions): when, what, by whom, to whom ('spy': a spy of theirs caught, or a theft traced to them; 'land': tiles taken by a citadel; 'liberate': a city of theirs given back, `liberation.ts`; 'pledge': a city-state under their protection bullied or attacked, `pledges.ts`; 'nuke': a nuclear weapon used on them; 'nukeSeen': a nuclear weapon used by a civ they knew, on anyone, `nuclearStrike`). */
export interface DiploEvent {
  turn: number;
  kind: 'war' | 'backstab' | 'denounce' | 'friendship' | 'peace' | 'deal' | 'capture' | 'brokeDeal' | 'spy' | 'land' | 'liberate' | 'pledge' | 'nuke' | 'nukeSeen';
  by: number;
  to: number;
}

export interface Relations {
  offers: Offer[];
  running: Running[];
  events: DiploEvent[];
  /** Deals a person turned down (or let lapse): who asked whom, when, and what was asked for (`askOf`). */
  declined?: { from: number; to: number; turn: number; ask: string }[];
}

/** What a deal asks of the side it's put to (its items from that side, in a fixed order), to tell a deal asked again. */
export const askOf = (deal: Deal) =>
  deal.items
    .filter((x) => !('from' in x) || x.from === deal.to)
    .map((x) => `${x.kind}${'resource' in x ? `:${x.resource}` : ''}`)
    .sort()
    .join(',');

/** Whether a person has turned down this ask (from anyone) within the last `turns` turns. */
export const declinedLately = (game: Game, to: number, ask: string, turns: number) => (game.relations?.declined ?? []).some((d) => d.to === to && d.ask === ask && game.turn - d.turn < turns);

/** The world's dealings (made on first use, so older saves carry on). */
export const relationsOf = (game: Game): Relations => (game.relations ??= { offers: [], running: [], events: [] });

/** How long deals, friendships, pacts and denouncements last (30 turns at standard speed, Civ V's). */
export const dealTurns = (game: Game) => Math.round(30 * speed(game));

/** What a research agreement costs each side (more each era). */
export const researchCost = (game: Game, era: number) => Math.round((150 + 75 * era) * speed(game));

/** Whether a civ is one deals are made with (not a city-state, not the barbarians, still in the game). */
export const dealer = (p: Player | undefined): p is Player => !!p && p.alive && !p.cityState && p.civ !== 'barbarian';

/** Whether `a` has met `b`: seen their land, or a unit of theirs (once met, always met). */
export function hasMet(game: Game, a: Player, b: Player): boolean {
  if (a === b || a.met?.includes(b.index)) return true;
  for (let t = 0; t < game.tiles.length; t++) if (game.tiles[t].owner === b.index && a.explored[t]) return true;
  return game.units.some((u) => u.owner === b.index && a.visible[u.tile] > 0);
}

/** Copies of each luxury a civ has in its own land (improved, or under a city). */
export function luxuryCopies(game: Game, p: Player): Map<string, number> {
  const out = new Map<string, number>();
  const cityTiles = new Set(game.cities.filter((c) => c.owner === p.index).map((c) => c.tile));
  game.tiles.forEach((tile, t) => {
    if (tile.owner !== p.index || !tile.resource || RESOURCES[tile.resource].kind !== 'luxury') return;
    if (tapped(tile) || cityTiles.has(t)) out.set(tile.resource, (out.get(tile.resource) ?? 0) + 1);
  });
  return out;
}

/** What a civ could put into a deal: copies of each luxury not lent out, strategic resources not in use. */
export function tradeable(game: Game, p: Player): { luxuries: Map<string, number>; strategic: Record<string, number> } {
  const sent = lentLuxuries(game, p).sent;
  const luxuries = new Map<string, number>();
  for (const [r, n] of luxuryCopies(game, p)) if (n - (sent.get(r) ?? 0) > 0) luxuries.set(r, n - (sent.get(r) ?? 0));
  const strategicSpare: Record<string, number> = {};
  for (const [r, x] of Object.entries(strategic(game, p))) if (x.have - x.used > 0) strategicSpare[r] = x.have - x.used;
  return { luxuries, strategic: strategicSpare };
}

/** Luxuries lent (sent) and borrowed (received) by a civ in running deals. */
export function lentLuxuries(game: Game, p: Player): { sent: Map<string, number>; got: Set<string> } {
  const sent = new Map<string, number>();
  const got = new Set<string>();
  for (const r of game.relations?.running ?? []) {
    if (r.item.kind !== 'luxury') continue;
    if (r.item.from === p.index) sent.set(r.item.resource, (sent.get(r.item.resource) ?? 0) + 1);
    else if (r.a === p.index || r.b === p.index) got.add(r.item.resource);
  }
  return { sent, got };
}

/** A civ's luxuries with its deals: those it receives added, those it's sent its only copies of taken away (`economy.luxuries`). */
export function tradeLuxuries(game: Game, p: Player, have: Set<string>) {
  if (!game.relations?.running.length) return;
  const { sent, got } = lentLuxuries(game, p);
  for (const r of got) have.add(r);
  if (!sent.size) return;
  const copies = luxuryCopies(game, p);
  for (const [r, n] of sent) if ((copies.get(r) ?? 0) <= n && !got.has(r)) have.delete(r);
}

/** A civ's strategic resources with its deals: what it receives counts as its own, what it sends as used (`economy.strategic`). */
export function tradeStrategics(game: Game, p: Player, have: Record<string, { have: number; used: number }>) {
  for (const r of game.relations?.running ?? []) {
    if (r.item.kind !== 'strategic' || (r.a !== p.index && r.b !== p.index)) continue;
    const entry = (have[r.item.resource] ??= { have: 0, used: 0 });
    if (r.item.from === p.index) entry.used += r.item.amount;
    else entry.have += r.item.amount;
  }
}

/** Whether two civs are friends (a declaration of friendship in force). */
export const friends = (game: Game, a: number, b: number) => (game.players[a]?.diplomacy.friends[b] ?? 0) > 0;
/** Whether two civs have a defensive pact. */
export const pacted = (game: Game, a: number, b: number) => (game.players[a]?.diplomacy.pacts[b] ?? 0) > 0;
/** Whether `a` has denounced `b` (and it still stands). */
export const denounced = (game: Game, a: number, b: number) => (game.players[a]?.diplomacy.denounced[b] ?? 0) > 0;

/** Something remembered. */
export function remember(game: Game, kind: DiploEvent['kind'], by: number, to: number) {
  relationsOf(game).events.push({ turn: game.turn, kind, by, to });
}

/** How long a nuclear strike is remembered (turns). */
export const NUKE_MEMORY = 300;
/** The influence a civ loses with every city-state that knows it when it uses a nuclear weapon (twice with one it hit). */
export const NUKE_INFLUENCE = 30;

/**
 * A nuclear weapon used (Civ V's): every civ that knows the striker remembers it (`nukeSeen`), those
 * it hit most of all (`nuke`), for the bots' opinions (`ai/opinion.ts`); every city-state that knows
 * it thinks less of it; the world hears of it.
 */
export function nuclearStrike(game: Game, by: number, hit: number[], at: number) {
  const striker = game.players[by];
  if (!striker) return;
  for (const o of hit) if (game.players[o] && game.players[o].civ !== 'barbarian') remember(game, 'nuke', by, o);
  for (const o of game.players) {
    if (o === striker || !o.alive || o.civ === 'barbarian' || !knowsOf(o, striker)) continue;
    if (o.cityState) striker.influence[o.index] = (striker.influence[o.index] ?? 0) - NUKE_INFLUENCE * (hit.includes(o.index) ? 2 : 1);
    else remember(game, 'nukeSeen', by, o.index);
  }
  const where = game.tiles[at]?.owner >= 0 ? game.players[game.tiles[at].owner] : undefined;
  noteAll(game, (r): Note | null => {
    if (r.cityState || r.civ === 'barbarian') return null;
    if (r === striker) return { text: 'You have used a nuclear weapon: the world will not soon forget it.', at, kind: 'bad' };
    const on = where && where !== striker ? ` on ${where === r ? 'you' : nameTo(r, where)}` : '';
    return { text: `${nameTo(r, striker, true)} has used a nuclear weapon${on}!`, ...(hit.includes(r.index) ? { at } : {}), kind: 'war' };
  });
}

const whole = (n: unknown) => Number.isSafeInteger(n) && (n as number) > 0;

const KINDS: Record<DealItem['kind'], 'one' | 'both'> = { gold: 'one', goldPerTurn: 'one', luxury: 'one', strategic: 'one', openBorders: 'one', embassy: 'one', research: 'both', friendship: 'both', pact: 'both', peace: 'both' };

/** Whether something sent as a deal's item has an item's shape (a crafted order could send anything). */
function wellFormed(item: unknown): item is DealItem {
  if (!item || typeof item !== 'object') return false;
  const x = item as Record<string, unknown>;
  const kind = KINDS[x.kind as DealItem['kind']];
  if (!kind) return false;
  if (kind === 'one' && !Number.isSafeInteger(x.from)) return false;
  if ('amount' in x && !Number.isSafeInteger(x.amount)) return false;
  if ('resource' in x && typeof x.resource !== 'string') return false;
  return true;
}

/** What's wrong with one item of a deal between `a` and `b` (null: nothing). */
function itemProblem(game: Game, a: Player, b: Player, item: DealItem): string | null {
  const one = 'from' in item;
  if (one && item.from !== a.index && item.from !== b.index) return 'That item belongs to neither side';
  const giver = one ? game.players[item.from] : a;
  const taker = one ? (item.from === a.index ? b : a) : b;
  const war = atWar(game, a.index, b.index);
  switch (item.kind) {
    case 'gold':
      return !whole(item.amount) ? 'Gold must be a whole amount' : giver.gold < item.amount ? `${giver.name} hasn't ${item.amount} gold` : null;
    case 'goldPerTurn':
      if (!whole(item.amount) || item.amount > 999) return 'Gold per turn must be a whole amount';
      // (Civ V's: no more a turn than the payer's income can pay, less what its deals pay already.)
      return item.amount > spareIncome(game, giver) ? `${giver.name} can't pay ${item.amount} gold a turn (${spareIncome(game, giver)} at most)` : null;
    case 'luxury': {
      if (!RESOURCES[item.resource] || RESOURCES[item.resource].kind !== 'luxury') return 'Not a luxury';
      const copies = luxuryCopies(game, giver).get(item.resource) ?? 0;
      const sent = lentLuxuries(game, giver).sent.get(item.resource) ?? 0;
      if (copies - sent <= 0) return `${giver.name} has no ${RESOURCES[item.resource].name} to spare`;
      if (luxuryCopies(game, taker).get(item.resource) || lentLuxuries(game, taker).got.has(item.resource)) return `${taker.name} has ${RESOURCES[item.resource].name} already`;
      return null;
    }
    case 'strategic': {
      if (!RESOURCES[item.resource] || RESOURCES[item.resource].kind !== 'strategic' || !whole(item.amount)) return 'Not a strategic resource';
      const r = strategic(game, giver)[item.resource];
      return !r || r.have - r.used < item.amount ? `${giver.name} hasn't ${item.amount} ${RESOURCES[item.resource].name} to spare` : null;
    }
    case 'openBorders':
      if (war) return 'Not while at war';
      if (!knows(giver, 'writing')) return `${giver.name} needs Writing to open its borders`;
      return giver.diplomacy.openBorders[taker.index] > 0 ? `${giver.name}'s borders are open to ${taker.name} already` : null;
    case 'embassy':
      if (war) return 'Not while at war';
      if (!knows(taker, 'writing') || !knows(giver, 'writing')) return 'Embassies need Writing on both sides';
      return taker.diplomacy.embassy[giver.index] ? `${taker.name} has an embassy there already` : null;
    case 'research': {
      if (war) return 'Not while at war';
      if (!knows(a, 'philosophy') || !knows(b, 'philosophy')) return 'Research agreements need Philosophy on both sides';
      if (!a.diplomacy.embassy[b.index] || !b.diplomacy.embassy[a.index]) return 'Research agreements need embassies both ways';
      if (a.diplomacy.research[b.index] > 0) return 'A research agreement is running already';
      return null;
    }
    case 'friendship':
      if (war) return 'Not while at war';
      if (denounced(game, a.index, b.index) || denounced(game, b.index, a.index)) return 'Not while one has denounced the other';
      return friends(game, a.index, b.index) ? 'Friends already' : null;
    case 'pact':
      if (war) return 'Not while at war';
      if (!friends(game, a.index, b.index)) return 'A defensive pact needs a declaration of friendship first';
      if (!a.diplomacy.embassy[b.index] || !b.diplomacy.embassy[a.index]) return 'A defensive pact needs embassies both ways';
      return pacted(game, a.index, b.index) ? 'A defensive pact holds already' : null;
    case 'peace':
      return war ? null : 'Not at war';
  }
}

/** What's wrong with a deal (null: it can be made). */
export function dealProblem(game: Game, deal: Deal): string | null {
  const a = game.players[deal.from];
  const b = game.players[deal.to];
  if (!dealer(a) || !dealer(b) || a === b) return 'No deal can be made with them';
  if (!Array.isArray(deal.items) || !deal.items.length || deal.items.length > 20) return 'The deal is empty';
  if (!hasMet(game, a, b)) return "You haven't met them";
  // (Every item's shape first: a crafted order could send anything, `null` among them.)
  if (!deal.items.every(wellFormed)) return 'That deal makes no sense';
  const war = atWar(game, a.index, b.index);
  if (war && !deal.items.some((x) => x.kind === 'peace')) return "You're at war: only a peace deal";
  const seen = new Set<string>();
  for (const item of deal.items) {
    // The same thing twice is one thing, whatever else an item carries (a crafted key, another amount):
    // so no side gives more of anything than it has, or pays for one research agreement twice.
    const key = `${item.kind}|${KINDS[item.kind] === 'one' && 'from' in item ? item.from : ''}|${'resource' in item ? item.resource : ''}`;
    if (seen.has(key)) return 'The same thing twice';
    seen.add(key);
    const why = itemProblem(game, a, b, item);
    if (why) return why;
  }
  // Gold both ways at once is the same as less gold one way: one side only.
  const gold = deal.items.filter((x) => x.kind === 'gold');
  if (gold.length > 1) return 'Gold from one side only';
  // A research agreement: each side pays its cost.
  if (deal.items.some((x) => x.kind === 'research')) {
    const cost = researchCost(game, Math.max(0, ...[a, b].map(eraIndex)));
    for (const p of [a, b]) {
      const paid = gold.find((x) => 'from' in x && x.from === p.index)?.amount ?? 0;
      if (p.gold - paid < cost) return `A research agreement costs each side ${cost} gold`;
    }
  }
  return null;
}

/** A civ's era: its furthest tech's (as `game.eraOf`, which this module can't import). */
const eraIndex = (p: Player) => ERAS.indexOf(eraOfCol(Math.max(0, ...p.techs.map((t) => TECHS[t]?.col ?? 0))));

/** Make a deal (it's been agreed): gold changes hands, the rest starts. */
export function makeDeal(game: Game, deal: Deal) {
  const rel = relationsOf(game);
  const a = game.players[deal.from];
  const b = game.players[deal.to];
  const turns = dealTurns(game);
  const other = (i: number) => (i === a.index ? b : a);
  for (const item of deal.items) {
    switch (item.kind) {
      case 'gold':
        game.players[item.from].gold -= item.amount;
        other(item.from).gold += item.amount;
        break;
      case 'goldPerTurn':
      case 'luxury':
      case 'strategic':
        rel.running.push({ a: a.index, b: b.index, item, turns });
        break;
      case 'openBorders':
        game.players[item.from].diplomacy.openBorders[other(item.from).index] = turns;
        break;
      case 'embassy': {
        const host = game.players[item.from];
        const guest = other(item.from);
        guest.diplomacy.embassy[host.index] = true;
        // An embassy shows its host's capital.
        const capital = capitalOf(game, host.index);
        if (capital) guest.explored[capital.tile] = 1;
        break;
      }
      case 'research': {
        const cost = researchCost(game, Math.max(eraIndex(a), eraIndex(b)));
        a.gold -= cost;
        b.gold -= cost;
        a.diplomacy.research[b.index] = b.diplomacy.research[a.index] = turns;
        rel.running.push({ a: a.index, b: b.index, item, turns });
        break;
      }
      case 'friendship':
        a.diplomacy.friends[b.index] = b.diplomacy.friends[a.index] = turns;
        remember(game, 'friendship', a.index, b.index);
        pairNews(game, a, b, 'good', (x, y, you) => `${x} and ${y} have declared ${you ? 'your' : 'their'} friendship.`);
        break;
      case 'pact':
        a.diplomacy.pacts[b.index] = b.diplomacy.pacts[a.index] = turns;
        pairNews(game, a, b, 'info', (x, y) => `${x} and ${y} have signed a defensive pact.`);
        break;
      case 'peace':
        endWar(game, a, b);
        break;
    }
  }
  remember(game, 'deal', a.index, b.index);
  rel.offers = rel.offers.filter((o) => !(o.from === a.index && o.to === b.index) && !(o.from === b.index && o.to === a.index));
}

/** Two civs make peace (a treaty for ten turns), and with them their teams (`teams.ts`). */
export function endWar(game: Game, a: Player, b: Player) {
  for (const [x, y] of sides(game, a.index, b.index)) {
    const p = game.players[x] as Player & { peaceOffer?: number[] };
    const q = game.players[y] as Player & { peaceOffer?: number[] };
    p.diplomacy.war[y] = q.diplomacy.war[x] = false;
    p.diplomacy.peaceTurns[y] = q.diplomacy.peaceTurns[x] = 10;
    if (p.peaceOffer) p.peaceOffer = p.peaceOffer.filter((o) => o !== y);
    if (q.peaceOffer) q.peaceOffer = q.peaceOffer.filter((o) => o !== x);
  }
  remember(game, 'peace', a.index, b.index);
  pairNews(game, a, b, 'good', (x, y) => `${x} and ${y} have made peace.`);
}

/** Why a civ goes to war, as a bot names it (to the civ it means to fight, before and as it declares). */
export const WAR_WHYS = ['land', 'reclaim', 'winning', 'ally', 'warmonger', 'weak'] as const;
export type WarWhy = (typeof WAR_WHYS)[number];

/** A war's reason in its leader's words to the civ it's on (`by` means to fight `on`): the city it wants back named. */
export function warWords(game: Game, why: WarWhy, by: number, on: number): string {
  if (why === 'reclaim') {
    const city = game.cities.find((c) => c.founder === by && c.owner === on);
    return city ? `We want our city of ${city.name} back` : 'We want our cities back';
  }
  return { land: 'We covet your land', winning: 'Your lead worries us', ally: 'We stand with our allies against you', warmonger: 'Your warmongering must be answered', weak: 'Your weakness tempts us' }[why];
}

/**
 * War declared (the rules have set it): what the two had agreed ends (the one declaring breaks it), a
 * friendship betrayed is remembered as such, and the victim's defensive pacts bring its partners in.
 */
export function warDeclared(game: Game, by: number, on: number) {
  const rel = relationsOf(game);
  const p = game.players[by];
  const t = game.players[on];
  remember(game, 'war', by, on);
  if (friends(game, by, on)) remember(game, 'backstab', by, on);
  if (rel.running.some((r) => (r.a === by && r.b === on) || (r.a === on && r.b === by))) remember(game, 'brokeDeal', by, on);
  endDealings(game, by, on);
  // The victim's pacts: its partners join the war (unless at war already, or bound to peace).
  if (!dealer(t) || !dealer(p)) return;
  for (const ally of game.players) {
    if (ally === p || ally === t || !dealer(ally) || !pacted(game, ally.index, on) || atWar(game, ally.index, by) || ally.diplomacy.peaceTurns[by] > 0 || teammates(game, ally.index, by)) continue;
    // (With their teams: a team goes to war together.)
    for (const [x, y] of sides(game, ally.index, by)) {
      const a = game.players[x];
      const b = game.players[y];
      a.diplomacy.war[y] = b.diplomacy.war[x] = true;
      a.diplomacy.openBorders[y] = b.diplomacy.openBorders[x] = 0;
      // (What they had agreed ends as it does for any war; honouring a pact breaks no deal, and calls in no further pacts.)
      endDealings(game, x, y);
    }
    remember(game, 'war', ally.index, by);
    noteAll(game, (r) =>
      r === ally
        ? { text: `You honour your defensive pact with ${t.name} and declare war on ${p.name}!`, kind: 'war' }
        : knowsOf(r, ally) || knowsOf(r, t) || knowsOf(r, p)
          ? { text: `${nameTo(r, ally, true)} honours its defensive pact with ${r === t ? 'you' : nameTo(r, t)} and declares war on ${r === p ? 'you' : nameTo(r, p)}!`, kind: 'war', topic: r === t || r === p ? undefined : 'wars' }
          : null,
    );
  }
}

/** Two civs gone to war (or one gone from the game): their running deals and offers end, and their friendship, pact and research agreement. */
export function endDealings(game: Game, x: number, y: number) {
  const rel = relationsOf(game);
  const between = (i: number, j: number) => (i === x && j === y) || (i === y && j === x);
  rel.running = rel.running.filter((r) => !between(r.a, r.b));
  rel.offers = rel.offers.filter((o) => !between(o.from, o.to));
  for (const [p, q] of [[game.players[x], y], [game.players[y], x]] as const) {
    p.diplomacy.friends[q] = 0;
    p.diplomacy.pacts[q] = 0;
    p.diplomacy.research[q] = 0;
  }
}

/**
 * News of something two civs did together (a friendship, a pact, a peace), told to every person: in
 * their own words if they're one of the two ('You and Catherine'), naming only civs they've met,
 * and not at all if they've met neither.
 */
function pairNews(game: Game, a: Player, b: Player, kind: Note['kind'], say: (x: string, y: string, you: boolean) => string) {
  noteAll(game, (r) => {
    if (r === a || r === b) return { text: say('You', (r === a ? b : a).name, true), kind };
    if (!knowsOf(r, a) && !knowsOf(r, b)) return null;
    return { text: say(nameTo(r, a, true), nameTo(r, b), false), kind };
  });
}

/** A civ denounces another: it's said before the world, friendships and pacts between them end. */
export function denounce(game: Game, p: Player, them: Player): string | null {
  if (!dealer(p) || !dealer(them) || p === them) return 'Not a civ to denounce';
  if (teammates(game, p.index, them.index)) return 'They are on your team';
  if (denounced(game, p.index, them.index)) return `You've denounced ${them.name} already`;
  if (!hasMet(game, p, them)) return "You haven't met them";
  p.diplomacy.denounced[them.index] = dealTurns(game);
  for (const [x, y] of [[p, them], [them, p]]) {
    x.diplomacy.friends[y.index] = 0;
    x.diplomacy.pacts[y.index] = 0;
  }
  remember(game, 'denounce', p.index, them.index);
  noteAll(game, (r) => (r === p ? null : r === them ? { text: `${p.name} has denounced you!`, kind: 'war' } : knowsOf(r, p) || knowsOf(r, them) ? { text: `${nameTo(r, p, true)} has denounced ${nameTo(r, them)}!`, kind: 'war', topic: 'wars' } : null));
  return null;
}

/** A city taken from one civ by another, remembered. */
export const cityTaken = (game: Game, from: number, by: number) => remember(game, 'capture', by, from);

/** What the bots decide of deals (`ai/diplomacy.ts` fills it in): whether to accept, and why not. */
export const diploHooks: { evaluate: (game: Game, bot: Player, deal: Deal) => { accept: boolean; why?: string } } = {
  evaluate: () => ({ accept: false, why: 'They have nothing to say' }),
};

/** What the other side would say to a deal (for a deal being drawn up): a problem, a bot's answer, or that a person will be asked. */
export function dealVerdict(game: Game, deal: Deal): { valid: boolean; ok: boolean; text: string } {
  const why = dealProblem(game, deal);
  if (why) return { valid: false, ok: false, text: why };
  const b = game.players[deal.to];
  if (!b.bot) return { valid: true, ok: true, text: `${b.name} will be asked` };
  const verdict = diploHooks.evaluate(game, b, deal);
  return verdict.accept ? { valid: true, ok: true, text: `${b.name} would accept` } : { valid: true, ok: false, text: `${b.name} would decline${verdict.why ? `: ${verdict.why}` : ''}` };
}

/**
 * A deal put to another civ: a bot answers at once; a person gets it to answer (their offers are in
 * their view). Returns what to tell the one proposing (an error, or what happened).
 */
export function propose(game: Game, deal: Deal): { ok: boolean; text: string } {
  const why = dealProblem(game, deal);
  if (why) return { ok: false, text: why };
  const a = game.players[deal.from];
  const b = game.players[deal.to];
  if (b.bot) {
    const answer = diploHooks.evaluate(game, b, deal);
    if (!answer.accept) return { ok: false, text: `${b.name} declines${answer.why ? `: ${answer.why}` : ''}` };
    makeDeal(game, deal);
    note(game, a.index, { text: `${b.name} accepts the deal.`, kind: 'good' });
    return { ok: true, text: 'Accepted' };
  }
  const rel = relationsOf(game);
  // One standing offer from each civ to each other: the newest.
  rel.offers = rel.offers.filter((o) => !(o.from === a.index && o.to === b.index));
  const offer: Offer = { ...deal, id: game.nextId++, turn: game.turn };
  rel.offers.push(offer);
  note(game, b.index, { text: `${a.name} proposes a deal (Diplomacy).`, kind: 'info' });
  return { ok: true, text: 'Offered' };
}

/** A person's answer to an offer made to them. */
export function answer(game: Game, p: Player, id: number, accept: boolean): string | null {
  const rel = relationsOf(game);
  const offer = rel.offers.find((o) => o.id === id && o.to === p.index);
  if (!offer) return 'That offer is gone';
  rel.offers = rel.offers.filter((o) => o !== offer);
  const from = game.players[offer.from];
  if (!accept) {
    (rel.declined ??= []).push({ from: offer.from, to: offer.to, turn: game.turn, ask: askOf(offer) });
    note(game, from.index, { text: `${p.name} declines your deal.`, kind: 'info' });
    return null;
  }
  const why = dealProblem(game, offer);
  if (why) return `The deal can't be made now: ${why}`;
  makeDeal(game, offer);
  note(game, from.index, { text: `${p.name} accepts your deal.`, kind: 'good' });
  return null;
}

/** Gold a turn a civ gets (above 0) or pays (below) by its deals. */
export function dealGold(game: Game, p: Player): number {
  let n = 0;
  for (const r of game.relations?.running ?? [])
    if (r.item.kind === 'goldPerTurn' && (r.a === p.index || r.b === p.index)) n += r.item.from === p.index ? -r.item.amount : r.item.amount;
  return n;
}

/**
 * Gold a turn a civ could still promise in a deal: its last turn's income without its deals' gold
 * (paid at that turn's end by those running then; one made since has paid nothing yet), less what
 * its deals pay each turn now.
 */
export function spareIncome(game: Game, p: Player): number {
  const turns = dealTurns(game);
  let base = p.lastIncome?.gold ?? 0;
  let owed = 0;
  for (const r of game.relations?.running ?? []) {
    if (r.item.kind !== 'goldPerTurn' || (r.a !== p.index && r.b !== p.index)) continue;
    const pays = r.item.from === p.index;
    if (r.turns < turns) base += pays ? r.item.amount : -r.item.amount;
    if (pays) owed += r.item.amount;
  }
  return Math.max(0, base - owed);
}

/**
 * Each turn: gold paid each turn (a payer who can't pay, or whose income no longer covers it with
 * little in the treasury, breaks the deal), deals running out (a research agreement's science when
 * it does), friendships, pacts and denouncements wearing off, old offers withdrawn, old memories
 * fading, unanswered offers lapsing.
 */
export function diplomacyTurn(game: Game) {
  const rel = game.relations;
  for (const p of game.players)
    for (let i = 0; i < game.players.length; i++) {
      const d = p.diplomacy;
      if (d.friends[i] > 0 && --d.friends[i] === 0 && p.index < i) note(game, p.index, { text: `Your declaration of friendship with ${game.players[i].name} has ended.`, kind: 'info' });
      if (d.pacts[i] > 0) d.pacts[i]--;
      if (d.denounced[i] > 0) d.denounced[i]--;
      if (d.research[i] > 0) d.research[i]--;
    }
  if (!rel) return;
  for (const r of [...rel.running]) {
    if (r.item.kind === 'goldPerTurn') {
      const payer = game.players[r.item.from];
      const payee = game.players[r.item.from === r.a ? r.b : r.a];
      // A payer spending more than it makes, its treasury running low, can't keep paying.
      const failing = (payer.lastIncome?.gold ?? 0) < r.item.amount && payer.gold < r.item.amount * 10;
      const paid = failing ? 0 : Math.min(payer.gold, r.item.amount);
      payer.gold -= paid;
      payee.gold += paid;
      // (Counted in each side's income for the turn.)
      if (payer.lastIncome) payer.lastIncome.gold -= paid;
      if (payee.lastIncome) payee.lastIncome.gold += paid;
      if (paid < r.item.amount) {
        rel.running.splice(rel.running.indexOf(r), 1);
        remember(game, 'brokeDeal', payer.index, payee.index);
        note(game, payee.index, { text: `${payer.name} couldn't pay what it owes: the deal has ended.`, kind: 'bad' });
        note(game, payer.index, { text: `You couldn't pay ${payee.name} what you owe (your income doesn't cover it): the deal has ended.`, kind: 'bad' });
        continue;
      }
    }
    if (--r.turns > 0) continue;
    rel.running.splice(rel.running.indexOf(r), 1);
    if (r.item.kind === 'research') researchDone(game, game.players[r.a], game.players[r.b]);
  }
  // Offers left unanswered lapse (as good as turned down); turned-down asks are forgotten in time.
  for (const o of rel.offers) if (game.turn - o.turn >= 5) (rel.declined ??= []).push({ from: o.from, to: o.to, turn: game.turn, ask: askOf(o) });
  rel.offers = rel.offers.filter((o) => game.turn - o.turn < 5);
  if (rel.declined) rel.declined = rel.declined.filter((d) => game.turn - d.turn < 40);
  // (A city given back is never forgotten: Civ V's liberation is a debt for good. A nuclear strike is
  // remembered longer than anything else.)
  rel.events = rel.events.filter((e) => e.kind === 'liberate' || game.turn - e.turn < (e.kind === 'nuke' || e.kind === 'nukeSeen' ? NUKE_MEMORY : 150));
}

/** A research agreement ends: each side's research gains what the two would have made together (the lesser's science, a while's worth). */
function researchDone(game: Game, a: Player, b: Player) {
  const science = (p: Player) => p.lastIncome?.science ?? 0;
  const gain = Math.round(Math.min(science(a), science(b)) * dealTurns(game) * 0.4);
  for (const p of [a, b]) {
    if (!p.alive) continue;
    // Twice with Scientific Revolution, half again with the Porcelain Tower.
    const mine = civEffects(game, p);
    const more = (has(mine, 'research_agreements_double') ? 2 : 1) * (has(mine, 'research_agreements_better') ? 1.5 : 1);
    const target = p.researching;
    if (target) p.research[target] = (p.research[target] ?? 0) + Math.round(gain * more);
    note(game, p.index, { text: `Your research agreement with ${(p === a ? b : a).name} bears fruit: ${Math.round(gain * more)} science.`, kind: 'tech' });
  }
}
