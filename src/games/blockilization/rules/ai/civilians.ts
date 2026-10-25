import { BUILDINGS } from '../buildings';
import { constructible, itemCost, productionToward } from '../game';
import { ALLY, allyOf, cannotBully, cannotCoup, cityStates, coupChance, giftInfluence, influenceOf } from '../citystates';
import { pledged } from '../pledges';
import { cityById, citiesOf, knows } from '../core';
import { friends, hasMet, pacted } from '../diplomacy';
import { cityReligion, religionsLeft } from '../faith';
import { neighbours, within } from '../hex';
import type { City, Player, Unit } from '../state';
import { teamOf } from '../teams';
import { TERRAINS } from '../terrain';
import { cannotSendDiplomat, maxRoutes, routesOf, spiesOf, theft, unVote, type Spy } from '../trade';
import { isMilitary, UNITS } from '../units';
import { act, civilianAt, cityOn, diplomaticRival, dist, goTo, militaryAt, questsAsked, type Ctx } from './context';
import { bestBelief } from './civics';
import { forsakes } from './liberation';
import { isSoldier, threatTo } from './production';
import { yieldsOf } from './value';

/**
 * The bots' other people: great people used where they count (a scientist's breakthrough, an
 * engineer's hurry for a wonder, a great work while there's a slot for it, a general with the army),
 * prophets founding and spreading the faith, missionaries carrying it to the nearest cities that
 * don't follow it, caravans to the richest city in reach, spies after the leader in science, and gold
 * for the city-states a diplomat (or a rich bot) wants as allies.
 */

/** A great person's turn. */
function greatPerson(ctx: Ctx, u: Unit) {
  const { game, mem } = ctx;
  const kind = u.type.replace('great_', '');
  const slotFor = (work: 'art' | 'writing' | 'music') =>
    ctx.cities.some((c) => c.buildings.some((b) => BUILDINGS[b]?.effects.greatWorks?.kind === work && (c.works?.[b]?.length ?? 0) < BUILDINGS[b].effects.greatWorks!.slots));
  const work = ({ artist: 'art', writer: 'writing', musician: 'music' } as Record<string, 'art' | 'writing' | 'music'>)[kind];
  if (work && slotFor(work)) return void act(ctx, { t: 'greatPerson', unit: u.id, action: 'work' });
  switch (kind) {
    case 'scientist':
      // A breakthrough; with nothing left to research, an academy.
      if (!act(ctx, { t: 'greatPerson', unit: u.id, action: 'discover' })) landmark(ctx, u);
      return;
    case 'merchant':
      return void act(ctx, { t: 'greatPerson', unit: u.id, action: 'trade' });
    case 'writer':
    case 'artist':
    case 'musician':
      // Culture the aim: kept for a great work while a city builds a slot for one (one set to, if none
      // is and one can), a musician else on a concert tour; else a writer's treatise, an artist's or
      // musician's golden age.
      if (mem.aim === 'culture' && slotUnderway(ctx, work)) return;
      if (mem.aim === 'culture' && kind === 'musician' && concertTour(ctx, u)) return;
      return void act(ctx, { t: 'greatPerson', unit: u.id, action: kind === 'writer' ? 'culture' : 'golden' });
    case 'admiral':
      return admiral(ctx, u);
    case 'engineer': {
      // To the city building a wonder, the Apollo Program or a spaceship part (or the capital), and hurry it.
      const grand = (c: (typeof ctx.cities)[number]) => c.queue[0]?.kind === 'project' || c.queue[0]?.id === 'apollo_program' || (c.queue[0]?.kind === 'building' && BUILDINGS[c.queue[0].id]?.kind === 'world');
      const city = ctx.cities.filter(grand).sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0] ?? ctx.capital;
      if (!city) return;
      if (u.tile !== city.tile) return void goTo(ctx, u, city.tile, 'great');
      return void act(ctx, { t: 'greatPerson', unit: u.id, action: 'hurry' });
    }
    case 'general': {
      // With the army: beside the soldier nearest the enemy (or the rally point); in a war of
      // another's making, by the city most in danger.
      const threatened = ctx.wars.length ? [...ctx.cities].sort((a, b) => threatTo(ctx, b) - threatTo(ctx, a))[0] : undefined;
      const goal = mem.plan ? (game.cities.find((c) => c.id === mem.plan!.city)?.tile ?? mem.plan.rally) : threatened && threatTo(ctx, threatened) > 0.3 ? threatened.tile : undefined;
      // No war in view: a citadel on the border, facing the nearest neighbour.
      if (goal === undefined) {
        if (!ctx.wars.length) citadel(ctx, u);
        return;
      }
      const near = game.units.filter((x) => x.owner === ctx.me && isSoldier(x)).sort((a, b) => dist(ctx, a.tile, goal) - dist(ctx, b.tile, goal))[0];
      if (near && near.tile !== u.tile && (!civilianAt(ctx, near.tile) || civilianAt(ctx, near.tile) === u)) goTo(ctx, u, near.tile, 'great');
      return;
    }
    case 'prophet':
      return prophet(ctx, u);
    default:
      landmark(ctx, u);
  }
}

/**
 * Whether one of the bot's cities is building a home for a great work of this kind; if none is, the
 * city that would build one soonest (and isn't on a wonder) is set to it.
 */
function slotUnderway(ctx: Ctx, work: 'art' | 'writing' | 'music'): boolean {
  const { game, p } = ctx;
  const holds = (id: string | undefined) => !!id && BUILDINGS[id]?.effects.greatWorks?.kind === work;
  if (ctx.cities.some((c) => c.queue[0]?.kind === 'building' && holds(c.queue[0].id))) return true;
  let best: { c: (typeof ctx.cities)[number]; id: string; turns: number } | null = null;
  for (const c of ctx.cities) {
    if (c.puppet || (c.queue[0]?.kind === 'building' && BUILDINGS[c.queue[0].id]?.kind === 'world')) continue;
    for (const id of constructible(game, p, c).filter((x) => holds(x) && BUILDINGS[x].kind !== 'world')) {
      const turns = itemCost(game, { kind: 'building', id }) / Math.max(1, productionToward(game, c, { kind: 'building', id }));
      if (!best || turns < best.turns) best = { c, id, turns };
    }
  }
  return !!best && best.turns <= 20 && act(ctx, { t: 'produce', city: best.c.id, item: { kind: 'building', id: best.id } });
}

/**
 * A Great Musician's concert tour, in the land of the civ the bot's culture holds least sway over (of
 * those it's met, at peace with and whose borders are open to it): there, and it plays. False if
 * there's none it can go to.
 */
function concertTour(ctx: Ctx, u: Unit): boolean {
  const { game, p } = ctx;
  const sway = (o: Player) => (p.tourism[o.index] ?? 0) / Math.max(1, o.lifetimeCulture);
  const host = game.players.filter((o) => o !== p && o.alive && !o.cityState && o.civ !== 'barbarian' && hasMet(game, p, o) && !p.diplomacy.war[o.index] && o.diplomacy.openBorders[p.index] > 0).sort((a, b) => sway(a) - sway(b))[0];
  if (!host) return false;
  if (game.tiles[u.tile].owner === host.index) return act(ctx, { t: 'greatPerson', unit: u.id, action: 'concert' });
  // (The nearest of its land it knows, not a city's own tile.)
  let best = -1;
  for (let t = 0; t < game.tiles.length; t++) if (game.tiles[t].owner === host.index && p.explored[t] && !cityOn(ctx, t) && !civilianAt(ctx, t) && !TERRAINS[game.tiles[t].terrain].water && (best < 0 || dist(ctx, u.tile, t) < dist(ctx, u.tile, best))) best = t;
  if (best < 0) return false;
  if (goTo(ctx, u, best, 'great')) act(ctx, { t: 'greatPerson', unit: u.id, action: 'concert' });
  // (There, or on its way: else, with no way there, it does something else.)
  return u.tile === best || !!ctx.mem.orders[u.id];
}

/** A Great Admiral: repairs the fleet once enough of it is hurt about it; else to the most hurt of its ships, or a port. */
function admiral(ctx: Ctx, u: Unit) {
  const { game } = ctx;
  const ships = game.units.filter((x) => x.owner === ctx.me && UNITS[x.type].domain === 'sea' && isMilitary(UNITS[x.type]) && x !== u);
  const hurt = (t: number) => ships.filter((x) => x.hp < 60 && dist(ctx, x.tile, t) <= 1).length;
  if (hurt(u.tile) >= 2) return void act(ctx, { t: 'greatPerson', unit: u.id, action: 'repair' });
  const worst = ships.filter((x) => x.hp < 60).sort((a, b) => hurt(b.tile) - hurt(a.tile) || a.hp - b.hp)[0];
  if (worst && hurt(worst.tile) >= 2) return void goTo(ctx, u, worst.tile, 'great');
  // (Otherwise with the fleet: beside the warship furthest from home, or in the capital's port.)
  const lead = [...ships].sort((a, b) => dist(ctx, b.tile, ctx.capital?.tile ?? b.tile) - dist(ctx, a.tile, ctx.capital?.tile ?? a.tile))[0];
  if (lead && dist(ctx, lead.tile, u.tile) > 1) goTo(ctx, u, lead.tile, 'great');
}

/** A Great General's citadel: on the bot's border nearest a neighbour's city (where it claims land and holds the line), else by the capital. */
function citadel(ctx: Ctx, u: Unit) {
  const { game } = ctx;
  const foes = game.cities.filter((c) => c.owner !== ctx.me && !game.players[c.owner].cityState && game.players[c.owner].civ !== 'barbarian' && ctx.p.explored[c.tile]);
  const near = (t: number) => Math.min(...foes.map((c) => dist(ctx, c.tile, t)));
  let best: number | undefined;
  let bestScore = Infinity;
  for (const c of ctx.cities)
    for (const t of within(game.grid, c.tile, 3)) {
      const tile = game.tiles[t];
      if (tile.owner !== ctx.me || cityOn(ctx, t) || tile.improvement === 'citadel' || tile.resource || TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || (civilianAt(ctx, t) && civilianAt(ctx, t) !== u)) continue;
      if (!neighbours(game.grid, t).some((n) => game.tiles[n].owner !== ctx.me && !TERRAINS[game.tiles[n].terrain].water)) continue;
      const s = near(t) - (tile.elevation === 'hills' ? 1 : 0) + dist(ctx, u.tile, t) * 0.1;
      if (s < bestScore) (bestScore = s), (best = t);
    }
  if (best === undefined || !foes.length) return landmark(ctx, u);
  if (goTo(ctx, u, best, 'great')) act(ctx, { t: 'greatPerson', unit: u.id, action: 'improvement' });
}

/** A great person's improvement (an academy, a manufactory, a citadel...) on the bot's own land beside the capital. */
function landmark(ctx: Ctx, u: Unit) {
  const { game } = ctx;
  if (game.tiles[u.tile].owner === ctx.me && !cityOn(ctx, u.tile) && !TERRAINS[game.tiles[u.tile].terrain].water && game.tiles[u.tile].elevation !== 'mountain') return void act(ctx, { t: 'greatPerson', unit: u.id, action: 'improvement' });
  const home = ctx.capital ?? ctx.cities[0];
  const spot = home && within(game.grid, home.tile, 2).find((t) => game.tiles[t].owner === ctx.me && !cityOn(ctx, t) && !civilianAt(ctx, t) && !TERRAINS[game.tiles[t].terrain].water && game.tiles[t].elevation !== 'mountain' && !game.tiles[t].resource);
  if (spot !== undefined && goTo(ctx, u, spot, 'great')) act(ctx, { t: 'greatPerson', unit: u.id, action: 'improvement' });
}

/** A Great Prophet: found the bot's religion (or enhance it) in its holy city; else spread it at home. */
function prophet(ctx: Ctx, u: Unit) {
  const { game, p } = ctx;
  const home = ctx.capital ?? ctx.cities[0];
  if (!home) return;
  const enhance = p.religion && game.religions[p.religion].beliefs.length < 4;
  const found = !p.religion && religionsLeft(game, p) > 0;
  if (found || enhance) {
    if (u.tile !== home.tile) return void goTo(ctx, u, home.tile, 'great');
    const beliefs = p.religion ? [bestBelief(ctx, 'follower'), bestBelief(ctx, 'enhancer')] : [bestBelief(ctx, 'founder'), bestBelief(ctx, 'follower')];
    if (beliefs.every(Boolean) && act(ctx, { t: 'religion', unit: u.id, name: '', beliefs: beliefs as string[] })) return;
  }
  // No religion to found or spread: a holy site.
  if (!p.religion && !u.religion) return landmark(ctx, u);
  missionary(ctx, u);
}

/** A missionary (or a prophet with nothing to found): to the nearest city that doesn't follow the faith. */
function missionary(ctx: Ctx, u: Unit) {
  const { game, p } = ctx;
  const religion = u.religion ?? p.religion;
  if (!religion) return;
  // (Nearest first, its own cities and city-states asking for the faith a little before the rest.)
  const asking = new Set(questsAsked(ctx, 'religion').map((q) => q.cs));
  const far = (c: (typeof game.cities)[number]) => dist(ctx, c.tile, u.tile) + (c.owner === ctx.me ? -3 : 0) + (asking.has(c.owner) ? -4 : 0);
  let target: (typeof game.cities)[number] | undefined;
  let nearest = Infinity;
  for (const c of game.cities) {
    if (cityReligion(c) === religion || game.players[c.owner].diplomacy.war[ctx.me]) continue;
    const d = far(c);
    if (d < nearest) (nearest = d), (target = c);
  }
  // Everyone follows it already: a prophet makes a holy site instead.
  if (!target) {
    if (u.type === 'great_prophet') landmark(ctx, u);
    return;
  }
  if (dist(ctx, target.tile, u.tile) <= 1) return void act(ctx, { t: 'spread', unit: u.id });
  const step = neighbours(game.grid, target.tile).find((t) => !civilianAt(ctx, t) && !militaryAt(ctx, t)) ?? target.tile;
  goTo(ctx, u, step, 'spread');
}

/** An inquisitor: to the nearest city of the bot's lost to another faith, and drives that faith out. */
function inquisitor(ctx: Ctx, u: Unit) {
  const { p } = ctx;
  const target = ctx.cities.filter((c) => cityReligion(c) && cityReligion(c) !== p.religion).sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
  if (!target) return;
  if (dist(ctx, target.tile, u.tile) <= 1) return void act(ctx, { t: 'inquisition', unit: u.id });
  goTo(ctx, u, target.tile, 'spread');
}

/** A caravan: from the city it's in, to the best city in reach (foreign for gold, else home for food). */
function caravan(ctx: Ctx, u: Unit) {
  const { game, p } = ctx;
  const home = cityOn(ctx, u.tile);
  if (!home || home.owner !== ctx.me) {
    const near = [...ctx.cities].sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
    if (near) goTo(ctx, u, near.tile, 'trade');
    return;
  }
  if (routesOf(p).length >= maxRoutes(game, p)) return;
  // (Abroad first, the biggest; a city-state asking for a trade route above all. At home, production
  // for a city raising a wonder or the spaceship, food for a young one.)
  const asking = new Set(questsAsked(ctx, 'route').map((q) => q.cs));
  const grand = (c: (typeof game.cities)[number]) => c.queue[0]?.kind === 'project' || (c.queue[0]?.kind === 'building' && BUILDINGS[c.queue[0].id]?.kind === 'world');
  const worth = (c: (typeof game.cities)[number]) => (c.owner !== ctx.me ? 12 + c.pop + (asking.has(c.owner) ? 15 : 0) : grand(c) ? 14 : c.pop < 4 ? 10 - c.pop : c.pop);
  const targets = game.cities.filter((c) => c !== home && !game.players[c.owner].diplomacy.war[ctx.me] && game.players[c.owner].civ !== 'barbarian' && dist(ctx, c.tile, home.tile) <= 10).sort((a, b) => worth(b) - worth(a));
  for (const t of targets) if (act(ctx, { t: 'trade', unit: u.id, to: t.id, ...(t.owner === ctx.me ? { cargo: grand(t) ? ('prod' as const) : ('food' as const) } : {}) })) return;
}

/**
 * Spies: one rigs a city-state's elections while there's a diplomatic race (see `electionTarget`); one
 * stays home to catch thieves once a rival has spies (see `counterSpy`); the rest steal, each from the
 * city of a civ ahead in learning that gives most toward a theft (one at work where it still can is
 * left there); with nothing to steal, they serve as diplomats in rivals' capitals (with Globalization,
 * a delegate each) or guard the bot's cities, the best for science first.
 */
function spies(ctx: Ctx) {
  const { game, p } = ctx;
  const all = spiesOf(p);
  if (!all.length) return;
  const rigging = electionTarget(ctx);
  const ballot = rigging !== undefined ? citiesOf(game, rigging).find((c) => p.explored[c.tile]) : undefined;
  const inCityState = (s: Spy) => s.city !== null && !!game.players[cityById(game, s.city)?.owner ?? -1]?.cityState;
  const rigger = ballot ? (all.find(inCityState) ?? all[0]) : undefined;
  if (rigger && ballot && rigger.city !== ballot.id) act(ctx, { t: 'spy', spy: rigger.id, target: ballot.id });
  // A coup there, when it's likely to work, or when the city-state is a vote a rival needs to be World Leader.
  if (rigger && ballot && rigger.city === ballot.id && !cannotCoup(game, p, rigger.id)) {
    const rival = diplomaticRival(ctx);
    if (coupChance(game, p, ballot.owner) >= 0.5 || (rival !== null && allyOf(game, ballot.owner) === rival)) act(ctx, { t: 'coup', spy: rigger.id });
  }
  // What a theft would gather in a city each turn (none where nothing can be stolen; only a civ ahead
  // in learning can be stolen from), worked out only for the cities asked about, and the cities to
  // steal from, best first, only when a spy needs one (a theft's dear to weigh).
  const rates = new Map<number, number>();
  const rate = (c: City) => {
    let r = rates.get(c.id);
    if (r === undefined) {
      const them = game.players[c.owner];
      r = c.owner !== ctx.me && !them.cityState && them.civ !== 'barbarian' && p.explored[c.tile] && them.techs.length > p.techs.length ? rateOf(theft(game, p, c)) : 0;
      rates.set(c.id, r);
    }
    return r;
  };
  let list: { c: City; rate: number }[] | undefined;
  const marks = () => (list ??= game.cities.map((c) => ({ c, rate: rate(c) })).filter((x) => x.rate > 0).sort((a, b) => b.rate - a.rate));
  // (Diplomats at their posts stay there.)
  const free = all.filter((s) => s !== rigger && !(s.diplomat && s.city !== null));
  const stealing = (s: Spy) => {
    const c = s.city !== null ? cityById(game, s.city) : undefined;
    return !!c && rate(c) > 0;
  };
  const guard = counterSpy(ctx, free, free.length === 1 && marks().length > 0);
  if (guard && guard.spy.city !== guard.city) act(ctx, { t: 'spy', spy: guard.spy.id, target: guard.city });
  const watched = new Set(free.filter(stealing).map((s) => s.city));
  const home = (s: Spy) => s.city !== null && s.city !== guard?.city && cityById(game, s.city)?.owner === ctx.me;
  const guarded = new Set([guard?.city, ...free.filter((s) => s !== guard?.spy && home(s)).map((s) => s.city)]);
  const homes = [...ctx.cities].sort((a, b) => yieldsOf(ctx, b).science - yieldsOf(ctx, a).science).filter((c) => !guarded.has(c.id));
  // (With Globalization, a spare spy is better a diplomat in a rival's capital: a delegate to the Congress.)
  const envoys = new Set(all.filter((s) => s.diplomat && s.city !== null).map((s) => cityById(game, s.city!)?.owner));
  const capitals = knows(p, 'globalization') ? game.cities.filter((c) => c.capital && !envoys.has(c.owner) && p.explored[c.tile] && !cannotSendDiplomat(game, p, c)) : [];
  for (const s of free) {
    if (s === guard?.spy || stealing(s)) continue;
    if (marks().length) {
      // (A city no other spy of its is in first: one caught there isn't all of them.)
      const mark = marks().find((x) => !watched.has(x.c.id)) ?? marks()[0];
      watched.add(mark.c.id);
      act(ctx, { t: 'spy', spy: s.id, target: mark.c.id });
    } else if (capitals.length) {
      act(ctx, { t: 'spy', spy: s.id, target: capitals.shift()!.id, diplomat: true });
    } else if (!home(s)) {
      const city = homes.shift();
      if (city) act(ctx, { t: 'spy', spy: s.id, target: city.id });
    }
  }
}

/** What a theft gathers toward each turn (none if there's nothing to steal there). */
const rateOf = (t: ReturnType<typeof theft>) => ('rate' in t ? t.rate : 0);

/**
 * A counter-spy, once a rival the bot has met has spies of its own: one stays in the bot's best city
 * for science (where a thief gathers fastest), to catch them. With only one spy, only when there's
 * nothing for it to steal. One already home, or not yet sent, or idle, first.
 */
function counterSpy(ctx: Ctx, free: Spy[], canSteal: boolean): { spy: Spy; city: number } | null {
  const { game, p } = ctx;
  if (!free.length || !ctx.cities.length) return null;
  const rivals = game.players.filter((o) => o !== p && o.alive && !o.cityState && o.civ !== 'barbarian' && spiesOf(o).length > 0 && hasMet(game, p, o));
  if (!rivals.length || (free.length === 1 && canSteal)) return null;
  const best = [...ctx.cities].sort((a, b) => yieldsOf(ctx, b).science - yieldsOf(ctx, a).science)[0];
  const home = (s: Spy) => s.city !== null && cityById(game, s.city)?.owner === ctx.me;
  const idle = (s: Spy) => s.city === null || rateOf(theft(game, p, cityById(game, s.city) ?? best)) === 0;
  const spy = free.find((s) => s.city === best.id) ?? free.find(home) ?? free.find(idle) ?? free[0];
  return { spy, city: best.id };
}

/** The city-state whose elections the bot's spy should rig, if any (see `spies`). */
function electionTarget(ctx: Ctx): number | undefined {
  const { game, p, mem } = ctx;
  const rival = diplomaticRival(ctx);
  if (rival === null && mem.aim !== 'diplomatic') return undefined;
  const gap = (cs: number) => {
    const ally = allyOf(game, cs);
    return (ally >= 0 && ally !== ctx.me ? influenceOf(game.players[ally], cs) : ALLY) - influenceOf(p, cs);
  };
  return cityStates(game)
    .filter((cs) => (rival !== null ? allyOf(game, cs.index) === rival : allyOf(game, cs.index) !== ctx.me) && citiesOf(game, cs.index).some((c) => p.explored[c.tile]))
    .sort((a, b) => gap(a.index) - gap(b.index))[0]?.index;
}

/**
 * Gold for city-states: with the World Leader vote in its reach, the city-states that would carry it;
 * else a diplomat buys allies (the cheapest to win first, keeping those it has); a rich bot buys a
 * friend; and any bot that can afford it buys away the allies of a rival close to a diplomatic
 * victory, a little at a time.
 */
function giftCityStates(ctx: Ctx) {
  const { game, p, mem } = ctx;
  if (electionBid(ctx)) return;
  bully(ctx);
  const rival = diplomaticRival(ctx);
  const diplomat = mem.aim === 'diplomatic' || ctx.pers.diplomacy >= 7 || rival !== null;
  // (Against a rival, the bot digs deeper: the race is for the game.)
  const reserve = rival !== null ? 30 + ctx.era * 10 : 60 + ctx.era * 25;
  if (p.gold < reserve + (rival !== null ? 60 : diplomat ? 250 : 450 - ctx.pers.diplomacy * 30)) return;
  if (mem.gifted !== undefined && game.turn - mem.gifted < (diplomat ? 2 : 6)) return;
  const options = cityStates(game)
    .filter((cs) => !p.diplomacy.war[cs.index] && cs.alive)
    .map((cs) => {
      const mine = influenceOf(p, cs.index);
      const ally = allyOf(game, cs.index);
      const theirs = ally >= 0 && ally !== ctx.me ? influenceOf(game.players[ally], cs.index) : ALLY;
      const need = ally === ctx.me ? (mine < ALLY + 20 ? 30 : Infinity) : Math.max(ALLY, theirs + 5) - mine;
      // Taking one from the rival counts double: it's a vote off their total and one on ours.
      return { cs, need, worth: ally === rival && rival !== null ? need / 2 : need };
    })
    .filter((x) => x.need < (rival !== null ? 250 : 120))
    .sort((a, b) => a.worth - b.worth);
  const pick = options[0];
  if (!pick) return;
  // Enough to win it outright if that's to hand; else what can be spared, to wear its lead down.
  const outright = goldFor(pick.need);
  const gold = Math.min(p.gold - reserve, rival !== null ? outright : pick.need > 100 ? 1000 : pick.need > 40 ? 500 : 250);
  if (gold >= (rival !== null ? Math.min(60, outright) : 150) && act(ctx, { t: 'gift', target: pick.cs.index, gold: Math.floor(gold) })) mem.gifted = game.turn;
}

/**
 * Once the United Nations stands: if the city-states the bot lacks for a World Leader majority can be
 * bought with the gold it can spare, it buys them all now (each with enough over the rival's influence
 * to hold till the next vote): a diplomat while the vote's to come, any other bot only on the vote's
 * turn, and never against a friend ahead of it. True if it did.
 */
function electionBid(ctx: Ctx): boolean {
  const { game, p } = ctx;
  if (game.wonders['united_nations'] === undefined || !game.settings.victories.diplomatic) return false;
  // (A diplomat bids while the vote's to come; any other bot only on the vote's own turn, the win in hand.)
  const turnsLeft = (10 - (game.turn % 10)) % 10;
  if (ctx.mem.aim !== 'diplomatic' && turnsLeft > 0) return false;
  const { votes, needed } = unVote(game, allyOf);
  // (A team's votes are pooled under one of them.)
  const mine = Math.max(...teamOf(game, ctx.me).map((m) => votes.get(m.index) ?? 0));
  const short = needed - mine;
  if (short <= 0) return false;
  // Not against a friend ahead of it in the vote.
  if ([...votes].some(([i, n]) => i !== ctx.me && n > mine && (friends(game, ctx.me, i) || pacted(game, ctx.me, i)))) return false;
  // (Influence wanes a little each turn: a margin for the turns till the vote.)
  const margin = 5 + 2 * turnsLeft;
  const bids = cityStates(game)
    .filter((cs) => !teamOf(game, ctx.me).some((m) => m.index === allyOf(game, cs.index)) && !p.diplomacy.war[cs.index] && hasMet(game, p, cs))
    .map((cs) => {
      const ally = allyOf(game, cs.index);
      const need = Math.max(ALLY, (ally >= 0 ? influenceOf(game.players[ally], cs.index) : 0) + margin) - influenceOf(p, cs.index);
      return { cs, gold: goldFor(need) };
    })
    .sort((a, b) => a.gold - b.gold)
    .slice(0, short);
  // (Keeping gold for its own needs.)
  if (bids.length < short || bids.reduce((n, b) => n + b.gold, 0) > p.gold - (60 + ctx.era * 25)) return false;
  for (const b of bids) act(ctx, { t: 'gift', target: b.cs.index, gold: b.gold });
  ctx.mem.gifted = game.turn;
  return true;
}

/**
 * A warlike leader with soldiers by a city-state that outmatch it demands its gold (Civ V's bullying),
 * unless it courts the city-states (a diplomat, or allied with that one), or the UN's votes count. One
 * it pledged to protect it bullies only once it would break that pledge (`forsakes`), and pays for it.
 */
function bully(ctx: Ctx) {
  const { game, p, mem } = ctx;
  if (mem.aim === 'diplomatic' || game.wonders['united_nations'] !== undefined) return;
  for (const cs of cityStates(game)) {
    if (allyOf(game, cs.index) === ctx.me) continue;
    if (pledged(game, ctx.me, cs.index) ? !forsakes(ctx, cs.index) : ctx.pers.offense < 7) continue;
    if (!cannotBully(game, p, cs.index) && act(ctx, { t: 'tribute', target: cs.index, take: 'gold' })) return;
  }
}

/** The gold a gift must be to win this much influence. */
function goldFor(influence: number): number {
  let gold = Math.ceil(Math.pow(Math.max(1, influence) * 4, 1 / 0.9));
  while (giftInfluence(gold) < influence) gold++;
  return gold;
}

/** Every civilian's turn, and the empire's dealings with spies and city-states. */
export function civilians(ctx: Ctx) {
  const { game } = ctx;
  for (const u of game.units.filter((x) => x.owner === ctx.me)) {
    if (!game.units.includes(u)) continue;
    const t = UNITS[u.type];
    if (u.type === 'caravan' || u.type === 'cargo_ship') caravan(ctx, u);
    else if (u.type === 'missionary') missionary(ctx, u);
    else if (u.type === 'inquisitor') inquisitor(ctx, u);
    else if (t.class === 'great') greatPerson(ctx, u);
  }
  if (!ctx.p.cityState) {
    spies(ctx);
    giftCityStates(ctx);
  }
}
