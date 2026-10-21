import { adviseBuild } from './advisor';
import { packKnown, packStatic, packYields, type CityInfo, type CityWire, type DemographicId, type MapWire, type Relation, type SelfWire, type StatsInfo, type UnitWire, type View } from './protocol';
import { BUILDINGS } from './rules/buildings';
import { canPillage, cityMaxHp, cityStrength, strength, type Modifier } from './rules/combat';
import { atWar, citiesOf, civEffects, has, knows, seesResource, seesUnit, techCost } from './rules/core';
import { assignCitizens, blockaded, cityEffects, cityYields, goldUpkeep, goldenCost, growthThreshold, happiness, luxuries, nextTile, policyCost, purchaseCost, SPECIALIST_YIELD, specialistSlots, strategic, tileCultureCost, tileGoldCost, tileYields, workedYields } from './rules/economy';
import { ANARCHY_TURNS, blockers, buyable, canChooseIdeology, ideologySwitch, constructible, eraOf, faithPurchases, heldBuildings, itemCost, productionToward, reformationDue, score, trainable, trainOptions, upgradeCost, upgradeTo, workTurns } from './rules/game';
import { distance, neighbours, within } from './rules/hex';
import { pantheonCost } from './rules/religion';
import type { City, Game, Player, Production } from './rules/state';
import { canResearch, TECHS } from './rules/techs';
import { SPACESHIP_PARTS } from './rules/buildings';
import { allyOf, cannotBully, cannotCoup, cityStateGives, coupChance, giftWorth, influenceFall, influenceOf, restingInfluence, standing, TRIBUTE_COST, tributeGold } from './rules/citystates';
import { liberation } from './rules/liberation';
import { cannotPledge, pledged, pledgersOf, PLEDGE_REST } from './rules/pledges';
import { questsFor } from './rules/quests';
import { delegates, delegateSources, embargoed, expectedVote, proposers, RESOLUTION_KINDS, resolutionInfo, RESOLUTIONS } from './rules/congress';
import { cannotHold, isProject, openProject, PROJECTS, projectsFor, projectTotal, tiersOf } from './rules/projects';
import { cityReligion, conversionNeed, faithCost, pressureOn, prophetCost, religionsLeft } from './rules/faith';
import { promotionsDue, promotionsFor } from './rules/promotions';
import { takenBeliefs } from './rules/religion';
import { cityById, knowsOf, maxMoves, newPlayer } from './rules/core';
import { electionTurns, influence, maxRoutes, partsBuildable, routeHome, routeWay, routeYield, routesGold, routesOf, spiesOf, theft, tourismOf, tradeReach, unVote } from './rules/trade';
import type { GreatKind } from './rules/effects';
import { dissent, greatCost } from './rules/economy';
import { ALL_POLICIES } from './rules/policies';
import { masterOf, teammates, teamOf } from './rules/teams';
import { independence, tributeFrom, tributeOf } from './rules/vassals';
import { addYields, RESOURCES, YIELD_KEYS, type Yields } from './rules/terrain';
import { isMilitary, UNITS } from './rules/units';
import { opinionOf, stanceOf } from './rules/ai/opinion';
import { dealer, dealGold, dealTurns, embargoOn, embargoTurns, hasMet, researchCost, tradeable } from './rules/diplomacy';

/**
 * What each player's screen is told: the terrain once, then their own view of the game after anything
 * changes: what they know of each tile (only tiles they've seen, resources they can recognise), the
 * units and cities in sight (their own in full), their empire's numbers, and what they've to decide.
 */

export function mapWire(game: Game): MapWire {
  return { grid: game.grid, tiles: game.tiles.map(packStatic) };
}

/** A city's defences, each needing the last: how strong its walls look. */
const WALLS = ['walls', 'castle', 'arsenal', 'military_base'];

function cityWire(game: Game, c: City, own: boolean, mood: number): CityWire {
  const w: CityWire = { id: c.id, name: c.name, owner: c.owner, tile: c.tile, pop: c.pop, hp: c.hp, maxHp: cityMaxHp(game, c), capital: !!c.capital, strength: Math.round(cityStrength(game, c)), religion: cityReligion(c), followers: { ...(c.followers ?? {}) } };
  const wonders = c.buildings.filter((b) => BUILDINGS[b]?.kind === 'world');
  if (wonders.length) w.wonders = wonders;
  const walls = Math.min(3, WALLS.filter((b) => c.buildings.some((x) => (BUILDINGS[x]?.replaces ?? x) === b)).length);
  if (walls) w.walls = walls;
  if (blockaded(game, c)) w.blockaded = true;
  if (!own) return w;
  const y = cityYields(game, c, mood);
  const item = c.queue[0];
  const need = growthThreshold(game, c.pop);
  w.yields = { food: y.food, prod: y.prod, gold: y.gold, science: y.science, culture: y.culture, faith: y.faith, surplus: Math.round(y.surplus * 10) / 10 };
  w.food = Math.floor(c.food);
  w.foodNeed = need;
  w.growth = y.surplus > 0 ? Math.ceil((need - c.food) / y.surplus) : y.surplus < 0 ? -1 : 0;
  if (item) {
    const cost = itemCost(game, item);
    const per = Math.max(1, productionToward(game, c, item));
    w.building = { kind: item.kind, id: item.id, progress: c.prod / cost, turns: Math.max(1, Math.ceil((cost - c.prod) / per)) };
    // (An international project: how far the world has got with it, and its turns at the world's pace.)
    const project = item.kind === 'project' ? openProject(game, item.id) : undefined;
    if (project) w.building = { kind: item.kind, id: item.id, progress: projectTotal(project) / project.cost, turns: Math.max(1, Math.ceil(cost / Math.max(1, projectPace(game, item.id)))) };
  }
  w.buildings = c.buildings;
  if (c.free?.length) w.free = c.free;
  w.queue = c.queue;
  w.repeat = c.repeat;
  w.worked = c.worked;
  w.locked = c.locked ?? [];
  w.focus = c.focus;
  w.occupied = !!c.occupied && !c.puppet && !has(cityEffects(game, c), 'no_occupied_unhappiness');
  w.puppet = c.puppet;
  w.resistance = c.resistance;
  w.fired = c.fired;
  w.specialists = c.specialists as Record<string, number>;
  w.lockedSpecialists = (c.lockedSpecialists ?? {}) as Record<string, number>;
  w.culture = c.culture;
  w.cultureNeed = tileCultureCost(game, c);
  w.nextTile = nextTile(game, c);
  // (0: none coming, its culture standing still or no tile left in reach to claim.)
  w.borderTurns = y.culture > 0 && w.nextTile !== null ? Math.max(1, Math.ceil((w.cultureNeed - c.culture) / y.culture)) : 0;
  w.razing = c.razing;
  w.canRaze = c.founder !== c.owner && game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] !== c;
  const free = liberation(game, c);
  if (free) w.liberate = { to: free.to, name: game.players[free.to].name, revive: free.revive, cityState: !!game.players[free.to].cityState };
  w.works = c.works;
  return w;
}

function selfWire(game: Game, p: Player): SelfWire {
  const cities = citiesOf(game, p.index);
  let science = 0;
  let culture = 0;
  let faith = 0;
  let gold = 0;
  const happinessParts: { label: string; value: number }[] = [];
  const mood = happiness(game, p, happinessParts);
  for (const c of cities) {
    const y = cityYields(game, c, mood);
    science += y.science;
    culture += y.culture;
    faith += y.faith;
    gold += y.gold;
  }
  const up = goldUpkeep(game, p);
  // On a team, research is the team's: the science of all of them goes into it (`shareResearch`).
  const mates = p.team === undefined ? [] : teamOf(game, p.index).filter((m) => m !== p);
  const teamScience = science + mates.reduce((n, m) => n + citiesOf(game, m.index).reduce((s, c) => s + cityYields(game, c, happiness(game, m)).science, 0), 0);
  const techCosts: Record<string, number> = {};
  for (const id of Object.keys(TECHS)) techCosts[id] = techCost(game, p, id);
  // (A vassal pays its master a share of what it makes; a master gets its vassals' tribute: `vassals.ts`.)
  const made = gold + routesGold(game, p) - up.buildings - up.units - up.roads;
  const lord = masterOf(game, p.index);
  const tribute = lord ? tributeOf(made) : 0;
  const free = lord ? independence(game, p) : null;
  return {
    index: p.index,
    civ: p.civ,
    gold: p.gold,
    income: made + dealGold(game, p) - tribute + tributeFrom(game, p),
    ...(lord && free ? { vassal: { master: lord.index, tribute, people: free.people, need: free.need, why: free.why } } : {}),
    science,
    culture: p.culture,
    culturePerTurn: culture,
    policyCost: policyCost(game, p),
    faith: p.faith,
    faithPerTurn: faith,
    happiness: mood,
    happinessParts,
    goldenPoints: p.goldenPoints,
    goldenCost: goldenCost(game, p),
    goldenTurns: p.goldenTurns,
    techs: p.techs,
    researching: p.researching,
    researchScience: teamScience,
    researchBy: mates.length && p.researchBy !== undefined ? p.researchBy : null,
    research: p.research,
    techQueue: p.techQueue,
    eurekas: p.eurekas ?? [],
    techCosts,
    policies: p.policies,
    ideology: p.ideology ?? null,
    ideologySwitch: ((to) => (to ? { to, dissent: dissent(game, p), free: Math.max(0, p.policies.filter((x) => ALL_POLICIES[x]?.tree === p.ideology).length - 2), anarchy: ANARCHY_TURNS } : null))(ideologySwitch(game, p)),
    anarchy: p.anarchy ?? 0,
    freeTenets: p.freeTenets ?? 0,
    ideologyOpen: canChooseIdeology(game, p),
    reformation: reformationDue(game, p),
    greatChoices: p.greatChoices ?? 0,
    pantheon: p.pantheon ?? null,
    era: eraOf(p),
    luxuries: [...luxuries(game, p)],
    strategic: strategic(game, p),
    naturalWonders: Object.entries(game.found ?? {}).flatMap(([id, f]) => (f.by.includes(p.index) ? [{ id, first: f.by[0] === p.index }] : [])),
    blockers: blockers(game, p),
    pantheonCost: pantheonCost(game),
    ready: p.ready,
    religion: p.religion ?? null,
    prophetCost: prophetCost(game, p),
    faithCosts: Object.fromEntries(['missionary', 'inquisitor', 'great_prophet', 'mosque', 'pagoda', 'cathedral', 'monastery'].map((k) => [k, faithCost(game, k, p)])),
    takenBeliefs: [...takenBeliefs(game)],
    religionsLeft: religionsLeft(game, p),
    greatPoints: p.greatPoints as Record<string, number>,
    greatCosts: Object.fromEntries((['scientist', 'engineer', 'merchant', 'artist', 'writer', 'musician', 'general', 'admiral'] as GreatKind[]).map((k) => [k, greatCost(game, p, k)])),
    routes: routesOf(p).map((r) => ({ from: cityById(game, r.from)?.name ?? '?', to: cityById(game, r.to)?.name ?? '?', turns: r.turns, ...routeYield(game, p, r), cargo: cityById(game, r.to)?.owner === p.index ? (r.cargo ?? 'food') : null })),
    maxRoutes: maxRoutes(game, p),
    spies: spiesOf(p).map((s) => {
      const c = s.city !== null ? cityById(game, s.city) : undefined;
      const plan = c && !s.diplomat && c.owner !== p.index && !game.players[c.owner].cityState ? theft(game, p, c) : null;
      const inCityState = !!c && game.players[c.owner].cityState;
      return { id: s.id, city: s.city, cityName: c?.name ?? null, progress: s.progress, election: c && game.players[c.owner].cityState ? electionTurns(game) - s.progress : null, watch: s.watch ?? 0, need: plan && 'need' in plan ? Math.round(plan.need) : null, perTurn: plan && 'rate' in plan ? Math.round(plan.rate) : null, why: plan && 'why' in plan ? plan.why : null, diplomat: !!s.diplomat, coup: inCityState ? { chance: Math.round(coupChance(game, p, c!.owner) * 100) / 100, why: cannotCoup(game, p, s.id) } : null };
    }),
    spaceship: SPACESHIP_PARTS.map((x) => ({ id: x.id, name: x.name, count: x.count, tech: x.tech, have: p.spaceship.filter((y) => y === x.id).length })),
    apollo: cities.some((c) => c.buildings.includes('apollo_program')),
    tourism: tourismOf(game, p),
    vote: p.vote ?? null,
    trade: tradeWire(game, p),
  };
}

/** What a player could put into a deal. */
function tradeWire(game: Game, p: Player): SelfWire['trade'] {
  const t = tradeable(game, p);
  return { luxuries: Object.fromEntries(t.luxuries), strategic: t.strategic, researchCost: researchCost(game, eraOf(p)), writing: knows(p, 'writing'), philosophy: knows(p, 'philosophy'), dealTurns: dealTurns(game), embargoTurns: embargoTurns(game) };
}

/** The World Congress as a player sees it. */
function congressWire(game: Game, me: Player): View['congress'] {
  const c = game.congress;
  if (!c) return null;
  const living = game.players.filter((p) => p.alive && !p.cityState && p.civ !== 'barbarian');
  const known = living.filter((p) => knowsOf(me, p));
  const mine = delegateSources(game, me);
  return {
    host: c.host,
    next: c.next,
    delegates: known.map((p) => ({ player: p.index, delegates: delegates(game, p) })),
    mine: { total: mine.base + mine.host + mine.un + mine.cityStates + mine.diplomats, ...mine },
    total: living.reduce((s, p) => s + delegates(game, p), 0),
    canPropose: proposers(game).includes(me.index) && !c.proposals.some((o) => o.by === me.index),
    // (A project only once some civ knows its tech, and while it hasn't been held.)
    proposable: RESOLUTION_KINDS.filter((kind) => !isProject(kind) || !cannotHold(game, kind)).map((kind) => ({ kind, ...RESOLUTIONS[kind] })),
    projects: projectsWire(game, me, known),
    civs: living.map((p) => p.index),
    luxuries: Object.keys(RESOURCES).filter((r) => RESOURCES[r].kind === 'luxury'),
    proposals: c.proposals.map((o) => {
      // (Another person's vote is theirs until the session: neither shown nor counted in the forecast.)
      const told = (p: Player) => p.bot || p === me;
      const projected = { yes: 0, no: 0 };
      for (const p of living) {
        const how = told(p) ? expectedVote(game, p, o) : 'abstain';
        if (how === 'yes' || how === 'no') projected[how] += delegates(game, p);
      }
      return {
        id: o.id,
        kind: o.kind,
        civ: o.civ ?? null,
        luxury: o.luxury ?? null,
        ...resolutionInfo(game, o, me),
        by: o.by,
        repeal: !!o.repeal,
        vote: o.votes[me.index] ?? null,
        forecast: known.map((p) => ({ player: p.index, vote: p.bot ? expectedVote(game, p, o) : p === me ? (o.votes[p.index] ?? null) : null, delegates: delegates(game, p) })),
        projected,
      };
    }),
    last: c.last ? { turn: c.last.turn, results: c.last.results.map((r) => ({ ...resolutionInfo(game, r, me), passed: r.passed, yes: r.yes, no: r.no })) } : null,
    active: c.active.map((r) => ({ kind: r.kind, ...resolutionInfo(game, r, me), civ: r.civ ?? null, luxury: r.luxury ?? null, since: r.since ?? 0 })),
  };
}

/** Production going into a World Congress project each turn now: every city building it, the world over. */
const projectPace = (game: Game, id: string) =>
  game.cities.reduce((s, c) => s + (c.queue[0]?.kind === 'project' && c.queue[0].id === id ? productionToward(game, c, c.queue[0]) : 0), 0);

/** The World Congress's projects, under way and done: each civ's share (those met by name), its tier as it stands (or stood), and each tier's reward. */
function projectsWire(game: Game, me: Player, known: Player[]): NonNullable<View['congress']>['projects'] {
  return (game.congress?.projects ?? []).map((x) => {
    const tiers = x.tiers ?? tiersOf(x);
    const total = projectTotal(x);
    const pace = x.done ? 0 : projectPace(game, x.id);
    const unmet = Object.entries(x.put).filter(([i]) => !known.some((p) => p.index === Number(i))).reduce((s, [, n]) => s + n, 0);
    return {
      id: x.id,
      name: PROJECTS[x.id].name,
      cost: x.cost,
      total: Math.floor(total),
      perTurn: pace,
      turns: x.done ? 0 : pace > 0 ? Math.ceil((x.cost - total) / pace) : null,
      since: x.since,
      done: x.done ?? null,
      rewards: { gold: PROJECTS[x.id].rewards.gold.text, silver: PROJECTS[x.id].rewards.silver.text, bronze: PROJECTS[x.id].rewards.bronze.text },
      shares: known.map((p) => ({ player: p.index, put: Math.floor(x.put[p.index] ?? 0), tier: tiers[p.index] ?? null })).sort((a, b) => b.put - a.put),
      unmet: Math.floor(unmet),
      mine: tiers[me.index] ?? null,
    };
  });
}

/** The World Leader vote as it would go now. */
function unVotesWire(game: Game): NonNullable<View['unVotes']> {
  const { votes, needed } = unVote(game, allyOf);
  return { votes: [...votes].map(([candidate, n]) => ({ candidate, votes: n })).sort((a, b) => b.votes - a.votes), needed };
}

/** The embargoes between a civ and the viewer (only what's so: an older view lacks them all). */
function embargoWire(game: Game, me: Player, o: Player): Pick<Relation, 'youEmbargo' | 'embargoYou' | 'embargoed'> {
  const mine = embargoOn(game, me.index, o.index);
  return {
    ...(mine ? { youEmbargo: Math.max(0, mine.turn + embargoTurns(game) - game.turn) } : {}),
    ...(embargoOn(game, o.index, me.index) ? { embargoYou: true } : {}),
    ...(embargoed(game, me.index, o.index) ? { embargoed: true } : {}),
  };
}

/** How things stand between a civ and a player who's met it. */
function relationWire(game: Game, me: Player, o: Player): Relation {
  const opinion = o.bot ? opinionOf(game, o, me) : null;
  const t = tradeable(game, o);
  return {
    opinion: opinion && { stance: stanceOf(opinion.total), total: opinion.total, reasons: opinion.reasons },
    friends: o.diplomacy.friends[me.index] ?? 0,
    pact: o.diplomacy.pacts[me.index] ?? 0,
    research: o.diplomacy.research[me.index] ?? 0,
    denouncedYou: o.diplomacy.denounced[me.index] ?? 0,
    youDenounced: me.diplomacy.denounced[o.index] ?? 0,
    ...embargoWire(game, me, o),
    embassyThere: !!me.diplomacy.embassy[o.index],
    embassyHere: !!o.diplomacy.embassy[me.index],
    gold: o.gold,
    income: o.lastIncome?.gold ?? 0,
    luxuries: [...t.luxuries.keys()],
    strategic: t.strategic,
    writing: knows(o, 'writing'),
    philosophy: knows(o, 'philosophy'),
    // (As the rules charge it: at the later era of the two.)
    researchCost: researchCost(game, Math.max(eraOf(me), eraOf(o))),
    deals: (game.relations?.running ?? []).filter((r) => (r.a === me.index && r.b === o.index) || (r.a === o.index && r.b === me.index)).map((r) => ({ item: r.item, turns: r.turns })),
    friendsWith: game.players.filter((x) => x !== o && (o.diplomacy.friends[x.index] ?? 0) > 0).map((x) => x.index),
    denouncing: game.players.filter((x) => x !== o && (o.diplomacy.denounced[x.index] ?? 0) > 0).map((x) => x.index),
    // (The world's politics, among the civilizations the viewer knows: nothing of those they don't.)
    atWarWith: game.players.filter((x) => x !== o && x.alive && !x.cityState && x.civ !== 'barbarian' && atWar(game, o.index, x.index) && hasMet(game, me, x)).map((x) => x.index),
    pactsWith: game.players.filter((x) => x !== o && (o.diplomacy.pacts[x.index] ?? 0) > 0 && hasMet(game, me, x)).map((x) => x.index),
    ...(masterOf(game, o.index) === me ? { tribute: o.vassal?.tribute ?? 0 } : {}),
  };
}

/** A player's view (or, for someone watching, everything: `p` null). */
/**
 * A player's view of the game (`p` null: a spectator's, who sees the whole world and no one's
 * empire). `present`: the people in the room now (by their seat's key), to tell who's away.
 */
export function viewFor(game: Game, p: Player | null, timer: number | null, present?: Set<string>): View {
  const all = !p;
  const sees = (t: number) => all || p!.visible[t] > 0;
  const revealsHidden = !!p && has(civEffects(game, p), 'reveal_hidden_antiquity');
  const known = (t: number) => all || p!.explored[t] > 0;
  const tiles = game.tiles.map((tile, t) =>
    known(t)
      ? packKnown({
          owner: tile.owner,
          city: tile.city ?? -1,
          improvement: tile.improvement ?? '',
          road: tile.road ?? '',
          resource: all || seesResource(p!, tile.resource) ? (tile.resource ?? '') : '',
          visible: sees(t),
          ruin: !!tile.ruin,
          pillaged: !!tile.pillaged,
          camp: !!tile.camp,
          feature: tile.feature ?? '',
          antiquity: !!tile.antiquity && (all || (knows(p!, 'archaeology') && (!tile.hiddenAntiquity || revealsHidden))),
          wonder: tile.wonder ?? '',
        })
      : null,
  );
  const units: UnitWire[] = game.units
    .filter((u) => all || seesUnit(game, p!, u))
    .map((u) => {
      const own = !!p && u.owner === p.index;
      const w: UnitWire = { id: u.id, type: u.type, owner: u.owner, tile: u.tile, hp: u.hp };
      if (own) {
        w.moves = Math.round(u.moves * 100) / 100;
        w.maxMoves = maxMoves(game, u);
        w.stance = u.stance;
        w.path = u.path;
        w.xp = u.xp;
        w.attacked = u.attacked;
        w.setUp = u.setUp;
        w.skip = u.skip;
        w.auto = u.auto;
        if (u.work) w.work = { what: u.work.what, turns: Math.max(0, Math.ceil(workTurns(game, u.work.what) - u.work.done)) };
        w.promotions = u.promotions;
        w.promotionsDue = promotionsDue(u);
        if (w.promotionsDue > 0) w.promotionOptions = promotionsFor(u).map((x) => x.id);
        w.religion = u.religion;
        w.spreads = u.spreads;
        const home = UNITS[u.type]?.abilities?.includes('trade_route') ? routeHome(game, p!, u) : undefined;
        if (home) w.destinations = tradeDestinations(game, p!, home, UNITS[u.type].domain === 'sea');
        if (canPillage(game, u)) w.pillage = true;
        if (isMilitary(UNITS[u.type])) {
          const mods: Modifier[] = [];
          w.defence = { strength: Math.round(strength(game, u, 'defend', null, u.tile, mods) * 10) / 10, mods };
        }
        const to = upgradeTo(p!, u);
        if (to) w.upgrade = { to, cost: upgradeCost(game, p!, u) };
      }
      w.embarked = u.embarked;
      return w;
    });
  const mood = p ? happiness(game, p) : 0;
  const cities = game.cities.filter((c) => (p && c.owner === p.index) || known(c.tile)).map((c) => cityWire(game, c, !!p && c.owner === p.index, mood));
  // (Someone watching is shown the numbers of an empire of no one's: none of a player's own.)
  const me = p ?? newPlayer(-1, { user: null, name: '', civ: game.players[0].civ, bot: false }, game.tiles.length, game.players.length);
  const met = (o: Player) => all || hasMet(game, me, o);
  const notes = p ? p.notes.splice(0) : [];
  return {
    turn: game.turn,
    timer,
    sequence: game.sequence && game.sequence.at < game.sequence.sides.length ? { sides: game.sequence.sides.map((x) => [...x]), at: game.sequence.at } : undefined,
    you: p ? p.index : -1,
    spectator: !p,
    players: game.players.map((o) => ({
      index: o.index,
      name: o.name,
      civ: o.civ,
      alive: o.alive,
      bot: o.bot,
      war: !!p && atWar(game, me.index, o.index),
      peaceOffered: !!p && atWar(game, me.index, o.index) && !!(o as Player & { peaceOffer?: number[] }).peaceOffer?.includes(me.index),
      here: o.user ? !present || present.has(o.user) : undefined,
      team: o.team ?? null,
      ...(masterOf(game, o.index) ? { master: masterOf(game, o.index)!.index } : {}),
      met: met(o),
      ready: o.ready,
      score: score(game, o),
      cities: citiesOf(game, o.index).length,
      peace: me.diplomacy.peaceTurns[o.index] ?? 0,
      openBorders: (me.diplomacy.openBorders[o.index] ?? 0) > 0,
      opensBorders: (o.diplomacy.openBorders[me.index] ?? 0) > 0,
      era: eraOf(o),
      cityState: o.cityState
        ? {
            kind: o.cityState.kind,
            influence: Math.round(influenceOf(me, o.index)),
            standing: standing(game, me, o.index),
            ally: allyOf(game, o.index),
            quests: questsFor(game, me, o),
            gives: { now: ((s) => (s === 'friend' || s === 'ally' ? cityStateGives(game, me, o, s) : null))(standing(game, me, o.index)), friend: cityStateGives(game, me, o, 'friend'), ally: cityStateGives(game, me, o, 'ally') },
            gifts: [100, 250, 500].map((gold) => ({ gold, influence: giftWorth(game, me, gold) })),
            rest: restingInfluence(game, me, o.index),
            fall: Math.round(influenceFall(game, me) * 100) / 100,
            tribute: { gold: tributeGold(game, me), cost: { ...TRIBUTE_COST }, why: cannotBully(game, me, o.index) },
            pledge: { mine: pledged(game, me.index, o.index), why: cannotPledge(game, me, o.index), rest: PLEDGE_REST, by: pledgersOf(game, o.index) },
          }
        : undefined,
      influence: !o.cityState && o.civ !== 'barbarian' && o !== me ? Math.round(influence(me, o) * 100) / 100 : undefined,
      army: p && !o.cityState && o.civ !== 'barbarian' && o.alive && met(o) ? militaryMight(game, o) : undefined,
      religion: o.religion ?? null,
      relation: p && o !== me && dealer(o) && met(o) ? relationWire(game, me, o) : undefined,
    })),
    self: selfWire(game, me),
    tiles,
    units,
    cities,
    notes,
    over: game.over ?? null,
    wonders: game.wonders,
    religions: Object.entries(game.religions).map(([id, r]) => ({ id, name: r.name, founder: r.founder, holyCity: cityById(game, r.holyCity)?.name ?? '?', beliefs: r.beliefs, cities: game.cities.filter((c) => cityReligion(c) === id).length })),
    history: game.over ? game.players.filter((o) => o.stats).map((o) => ({ index: o.index, ...o.stats! })) : undefined,
    replay: game.over ? game.replay : undefined,
    // (The weather and the world's disasters where the viewer knows the land or the sea: `rules/disasters.ts`.)
    storms: (game.storms ?? []).filter((s) => known(s.tile)).map((s) => s.tile),
    events: (game.events ?? []).flatMap((e) => {
      const tiles = (e.tiles ?? [e.tile]).filter((t) => t >= 0 && known(t));
      return tiles.length ? [{ ...e, tile: known(e.tile) ? e.tile : tiles[0], ...(e.tiles ? { tiles } : {}) }] : [];
    }),
    climate: game.climate ? { rises: game.climate.rises } : undefined,
    traffic: game.players.flatMap((o) =>
      routesOf(o).flatMap((r) => {
        const from = cityById(game, r.from);
        const to = cityById(game, r.to);
        return from && to && known(from.tile) && known(to.tile) ? [{ from: from.tile, to: to.tile, sea: r.sea, owner: o.index }] : [];
      }),
    ),
    un: (game.wonders['united_nations'] ?? -1) >= 0 ? game.wonders['united_nations'] : null,
    nextVote: (game.wonders['united_nations'] ?? -1) >= 0 ? Math.ceil(game.turn / 10) * 10 : null, // (held as a turn of ten ends: `longGameTurn`)
    unVotes: game.settings.victories.diplomatic ? unVotesWire(game) : null,
    congress: congressWire(game, me),
    offers: p ? (game.relations?.offers ?? []).filter((o) => o.to === p.index).map((o) => ({ id: o.id, from: o.from, items: o.items, turn: o.turn })) : [],
    waiting: p ? (game.relations?.offers ?? []).filter((o) => o.from === p.index).map((o) => o.to) : [],
    // (Their teammates' too, each its owner's to change or take up.)
    pins: p ? (game.pins ?? []).filter((x) => x.owner === p.index || teammates(game, x.owner, p.index)) : [],
  };
}

/**
 * The demographics, Civ V's: the population, land, army and what the cities make of the viewer and
 * each living civilization they've met (nothing of those they haven't), the viewer's place among
 * them, and the best, the average and the worst; and the score over the game of the same.
 */
/** A civ's army as the demographics measure it: its units' strength and ranged strength, added up. */
export const militaryMight = (game: Game, o: Player) => game.units.filter((u) => u.owner === o.index).reduce((n, u) => n + (UNITS[u.type]?.strength ?? 0) + (UNITS[u.type]?.ranged ?? 0), 0);

export function statsFor(game: Game, p: Player): StatsInfo {
  const civs = game.players.filter((o) => o.alive && !o.cityState && o.civ !== 'barbarian' && hasMet(game, p, o));
  const measure = (o: Player): Record<DemographicId, number> => {
    const cities = citiesOf(game, o.index);
    const made = { food: 0, production: 0, gold: 0, science: 0, culture: 0 };
    for (const c of cities) {
      const y = cityYields(game, c);
      made.food += y.food;
      made.production += y.prod;
      made.gold += y.gold;
      made.science += y.science;
      made.culture += y.culture;
    }
    return {
      population: cities.reduce((n, c) => n + c.pop, 0),
      land: game.tiles.filter((t) => t.owner === o.index).length,
      military: militaryMight(game, o),
      ...made,
    };
  };
  const all = civs.map((o) => ({ o, m: measure(o) }));
  const mine = all.find((x) => x.o === p)?.m ?? measure(p);
  const ids: DemographicId[] = ['population', 'land', 'military', 'food', 'production', 'gold', 'science', 'culture'];
  return {
    turn: game.turn,
    civs: all.length,
    rows: ids.map((id) => {
      const sorted = [...all].sort((a, b) => b.m[id] - a.m[id]);
      const values = sorted.map((x) => x.m[id]);
      const best = sorted[0];
      return {
        id,
        you: mine[id],
        rank: 1 + values.filter((x) => x > mine[id]).length,
        best: values[0] ?? 0,
        bestBy: best?.o.index ?? p.index,
        average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0,
        worst: values[values.length - 1] ?? 0,
      };
    }),
    scores: game.players.filter((o) => !o.cityState && o.civ !== 'barbarian' && o.stats && hasMet(game, p, o)).map((o) => ({ index: o.index, score: o.stats!.score })),
  };
}

/** Where a trade unit could open a route from a city, and what each would bring. */
function tradeDestinations(game: Game, p: Player, from: City, sea: boolean): NonNullable<UnitWire['destinations']> {
  const out: NonNullable<UnitWire['destinations']> = [];
  // (Not where a route from here runs already: a second is refused.)
  const running = new Set(routesOf(p).filter((r) => r.from === from.id).map((r) => r.to));
  for (const c of game.cities) {
    if (c === from || running.has(c.id) || atWar(game, p.index, c.owner) || embargoed(game, p.index, c.owner) || !p.explored[c.tile]) continue;
    if (distance(game.grid, from.tile, c.tile) > tradeReach(from, sea) || !routeWay(game, from, c, sea)) continue;
    const y = routeYield(game, p, { from: from.id, to: c.id, turns: 0, sea: false });
    const home = c.owner === p.index;
    out.push({ city: c.id, name: c.name, ...y, prod: home ? routeYield(game, p, { from: from.id, to: c.id, turns: 0, sea: false, cargo: 'prod' }).prod : 0, home });
  }
  return out.sort((a, b) => b.gold + b.science * 2 + b.food + b.prod - (a.gold + a.science * 2 + a.food + a.prod)).slice(0, 8);
}

/** A city's screen: what it can build (cost, turns, gold to buy), its tiles' yields, specialist slots. */
export function cityInfo(game: Game, p: Player, c: City): CityInfo {
  const options: CityInfo['options'] = [];
  const effects = cityEffects(game, c);
  const prod = cityYields(game, c).prod;
  // (What's been put in counts: the current build's production, or what was kept toward an item switched from.)
  const putIn = (item: Production) => (c.queue[0]?.kind === item.kind && c.queue[0]?.id === item.id ? c.prod : (c.saved?.[`${item.kind}:${item.id}`] ?? 0));
  const turns = (item: Production) => Math.max(1, Math.ceil((itemCost(game, item) - putIn(item)) / Math.max(1, productionToward(game, c, item, effects, prod))));
  const units = trainOptions(game, p, c);
  for (const { id } of units.filter((o) => !o.why)) {
    const item = { kind: 'unit' as const, id };
    options.push({ kind: 'unit', id, cost: itemCost(game, item), turns: turns(item), buy: purchaseCost(game, p, UNITS[id].cost, 'unit') });
  }
  const held = units.filter((o): o is { id: string; why: string } => !!o.why);
  for (const id of constructible(game, p, c)) {
    const item = { kind: 'building' as const, id };
    const wonder = BUILDINGS[id].kind === 'world';
    options.push({ kind: 'building', id, cost: itemCost(game, item), turns: turns(item), buy: wonder ? null : purchaseCost(game, p, BUILDINGS[id].cost, 'building') });
  }
  for (const id of partsBuildable(game, p)) {
    const item = { kind: 'project' as const, id };
    options.push({ kind: 'project', id, cost: itemCost(game, item), turns: turns(item), buy: null });
  }
  // The World Congress's projects open now: their cost what they still want from everyone, their turns at the world's pace (this city's with it).
  for (const item of projectsFor(game, p, c)) {
    const on = c.queue[0]?.kind === 'project' && c.queue[0].id === item.id;
    const pace = projectPace(game, item.id) + (on ? 0 : productionToward(game, c, item, effects, prod));
    options.push({ kind: 'project', id: item.id, cost: itemCost(game, item), turns: Math.max(1, Math.ceil(itemCost(game, item) / Math.max(1, pace))), buy: null });
  }
  // Units only bought with gold (Mercenary Army's Landsknechts), and what faith buys here.
  const landsknecht = { kind: 'unit' as const, id: 'landsknecht' };
  if (!trainable(game, p, c).includes(landsknecht.id) && buyable(game, p, c, landsknecht)) options.push({ ...landsknecht, cost: 0, turns: 0, buy: purchaseCost(game, p, UNITS.landsknecht.cost, 'unit') });
  for (const item of faithPurchases(game, p, c)) options.push({ ...item, cost: 0, turns: 0, buy: null, faith: faithCost(game, item.id, p) });
  const tiles = within(game.grid, c.tile, 3)
    .filter((t) => t !== c.tile && (game.tiles[t].city === c.id || (game.tiles[t].owner < 0 && p.explored[t] && neighbours(game.grid, t).some((n) => game.tiles[n].city === c.id))))
    .map((t) => ({
      t,
      yields: workedYields(game, c, t, effects) as Record<string, number>,
      worked: c.worked.includes(t),
      locked: (c.locked ?? []).includes(t),
      buyCost: game.tiles[t].owner < 0 && !c.puppet && distance(game.grid, c.tile, t) <= 3 ? tileGoldCost(game, c, t) : null,
    }));
  const pressure = new Map<string, number>();
  for (const [r, v] of pressureOn(game, c)) pressure.set(r, (pressure.get(r) ?? 0) + v);
  for (const r of Object.keys(c.pressure ?? {})) if (!pressure.has(r)) pressure.set(r, 0);
  return {
    id: c.id,
    options,
    held,
    heldBuildings: heldBuildings(game, p, c),
    tiles,
    slots: specialistSlots(game, c) as Record<string, number>,
    nextTile: explored(p, nextTile(game, c)),
    breakdown: yieldBreakdown(game, c),
    advice: adviseBuild(game, p, c),
    focuses: focusPreview(game, c),
    greatPeople: Object.fromEntries(Object.entries(cityYields(game, c).greatPeople).map(([k, n]) => [k, Math.round((n ?? 0) * 10) / 10])),
    pressure: [...pressure].map(([religion, perTurn]) => ({ religion, perTurn: Math.round(perTurn * 10) / 10, gathered: Math.floor(c.pressure?.[religion] ?? 0) })).sort((a, b) => b.perTurn - a.perTurn),
    conversionNeed: conversionNeed(c),
  };
}

/** The focuses a city's governor can be given. */
const FOCUSES: City['focus'][] = ['balanced', 'food', 'prod', 'gold', 'science', 'culture', 'faith'];

/**
 * What a city would make under each focus: its citizens placed as the governor would place them (those
 * placed by hand kept), its yields and food to spare, and the turns it'd take to grow; the city left
 * as it was.
 */
function focusPreview(game: Game, c: City): CityInfo['focuses'] {
  const was = { focus: c.focus, worked: c.worked, specialists: c.specialists };
  const need = growthThreshold(game, c.pop);
  const mood = happiness(game, game.players[c.owner]);
  const out = FOCUSES.map((focus) => {
    c.focus = focus;
    assignCitizens(game, c);
    const y = cityYields(game, c, mood);
    const surplus = Math.round(y.surplus * 10) / 10;
    return { focus, food: y.food, prod: y.prod, gold: y.gold, science: y.science, culture: y.culture, faith: y.faith, surplus, growth: y.surplus > 0 ? Math.ceil((need - c.food) / y.surplus) : y.surplus < 0 ? -1 : 0 };
  });
  Object.assign(c, was);
  return out;
}

/** A tile if the player has seen it (null otherwise, or for none). */
const explored = (p: Player, t: number | null) => (t !== null && p.explored[t] ? t : null);

/** A city's own tile's yields: as a farmed one, at least 2 food, 1 production and 1 gold (as `cityYields` counts it). */
function centreYields(game: Game, c: City, effects = cityEffects(game, c)): Yields {
  const y = workedYields(game, c, c.tile, effects);
  return { ...y, food: Math.max(2, (y.food ?? 0) + 1), prod: Math.max(1, y.prod ?? 0), gold: Math.max(1, y.gold ?? 0) };
}

/**
 * Where each of a city's yields comes from: its worked tiles, its own tile, its specialists and its
 * citizens (science), and the rest from its buildings, policies and the like (bonuses less any
 * penalties); for food, what its people eat and what growth's modifiers make of the surplus.
 */
function yieldBreakdown(game: Game, c: City): CityInfo['breakdown'] {
  const y = cityYields(game, c);
  const effects = cityEffects(game, c);
  let tiles: Yields = {};
  for (const t of c.worked) tiles = addYields(tiles, workedYields(game, c, t, effects));
  let specialists: Yields = {};
  for (const [kind, n] of Object.entries(c.specialists) as [keyof typeof SPECIALIST_YIELD, number][]) specialists = addYields(specialists, SPECIALIST_YIELD[kind], n);
  const centre = centreYields(game, c, effects);
  const out: CityInfo['breakdown'] = {};
  for (const k of YIELD_KEYS) {
    const parts = [
      { label: 'Worked tiles', value: tiles[k] ?? 0 },
      { label: 'City centre', value: centre[k] ?? 0 },
      { label: 'Specialists', value: specialists[k] ?? 0 },
      { label: 'Citizens', value: k === 'science' ? c.pop : 0 },
    ];
    const rest = y[k] - parts.reduce((s, x) => s + x.value, 0);
    parts.push({ label: rest >= 0 ? 'Buildings, policies and bonuses' : 'Penalties', value: rest });
    if (k === 'food') {
      parts.push({ label: 'Eaten by citizens', value: -y.eaten });
      const growth = y.surplus - (y.food - y.eaten);
      parts.push({ label: growth < 0 ? 'Lost to the empire\'s unhappiness' : 'Growth bonuses', value: growth });
    }
    out[k] = parts.filter((x) => x.value !== 0).map((x) => ({ label: x.label, value: Math.round(x.value * 10) / 10 }));
  }
  return out;
}

/**
 * What each tile a player knows yields them, packed (`packYields`): their own cities' tiles as those
 * cities would work them (their buildings' bonuses too), the rest as the land itself yields to them.
 */
export function yieldsWire(game: Game, p: Player): string {
  const mine = new Map(citiesOf(game, p.index).map((c) => [c.id, { c, effects: cityEffects(game, c) }]));
  return packYields(
    game.tiles.map((tile, t) => {
      if (!p.explored[t]) return null;
      const city = tile.city !== undefined ? mine.get(tile.city) : undefined;
      if (city && city.c.tile === t) return centreYields(game, city.c, city.effects);
      if (city) return workedYields(game, city.c, t, city.effects);
      return tileYields(game, t, p);
    }),
  );
}

/** The techs a player can research now (for screens that ask). */
export const researchable = (p: Player) => Object.keys(TECHS).filter((t) => canResearch(new Set(p.techs), t));
