import { airStrike, carry, isAircraft, rebase, strandedAircraft } from './air';
import { BUILDINGS, type Building } from './buildings';
import { CIVS, unitFor } from './civs';
import { canPillage, capture, citadelTurn, cityHeal, falloutTurn, cityMaxHp, cityFire, cityHooks, melee, nuke, pillage, ranged, rangeOf, type CombatResult } from './combat';
import { aName, atWar, canStand, capitalOf, cityAt, cityById, citiesOf, civEffects, civOf, endWars, has, inSentence, knows, knowsOf, maxMoves, nameTo, note, noteAll, random, removeUnit, seesResource, spawnUnit, speed, techCost, unitById, unitsOf, updateAllVisibility, updateVisibility } from './core';
import { assignCitizens, blockaders, cityEffects, cityYields, claim, coastal, foodKept, goldUpkeep, goldenCost, greatCost, greatPeopleBonus, growthThreshold, happiness, isBuilding, luxuries, nextTile, policyCost, purchaseCost, scaled, SPECIALIST_YIELD, specialistSlots, strategic, tileCultureCost, tileGoldCost, workable, dissent, preferredIdeology } from './economy';
import { CHOOSABLE, type Effects, type GreatKind, type SpecialistKind } from './effects';
import { barbarianTurn } from './barbarians';
import { allyOf, cityStates, cityStateTurn, coup, CS_WAR_INFLUENCE, gift, giftUnit, tribute } from './citystates';
import { congressTurn, inForce, propose as proposeResolution, RESOLUTION_KINDS, vote as voteOnResolution, type ResolutionKind } from './congress';
import { cannotSendDiplomat, longGameTurn, partCost, partsBuildable, routesFull, routesGold, spiesOf, startRoute, stolen, surveillanceTurns, tourismOf } from './trade';
import { canContribute, contribute, isProject, projectLeft } from './projects';
import { answer, cityTaken, declareEmbargo, denounce, liftEmbargo, diplomacyTurn, endDealings, endWar, nuclearStrike, propose, remember, WAR_WHYS, warDeclared, warWords, type DealItem, type WarWhy } from './diplomacy';
import { canBuyReligious, capFollowers, faithBuildings, faithCost, faithTurn, faithUnit, foundReligion, inquisition, spread, spreadsOf } from './faith';
import { fromPromotions, promotionsDue, promotionsFor, PROMOTIONS } from './promotions';
import { liberate, liberation } from './liberation';
import { pledge, pledgeOffended } from './pledges';
import { distance, neighbours, within } from './hex';
import { advance, campHooks, canEnter, captureHooks, moveTo, occupants, planPath, ruinHooks, sightStops, swap, swapWith } from './movement';
import { wondersBeside } from './nature';
import { adoptable, ALL_POLICIES, IDEOLOGIES, policyMet, TREES, treeDone } from './policies';
import { BELIEF_LIST, BELIEFS, pantheonCost, takenBeliefs } from './religion';
import { recordReplay } from './replay';
import { GOLDEN_SPEEDS, type City, type Game, type Player, type Production, type Unit } from './state';
import { masterOf, sameSide, sideName, sides, teamOf, teammates } from './teams';
import { breakFree, release, vassalsTurn } from './vassals';
import { checkEurekas, killDeeds } from './eurekas';
import { clanById, clanHarmed, clanHooks, clanProblem, dealWithClan, type ClanAct } from './clans';
import { merge, mergeProblem, shrink, sizeOf, unitName } from './armies';
import { canResearch, eraOfCol, ERAS, TECHS } from './techs';
import { eraStartOf, scenarioOf, startEraOf } from './starts';
import { startSequence, waitsFor, warBegun } from './turns';
import { climateTurn } from './climate';
import { disasterTurn } from './disasters';
import { FALLOUT, FEATURES, IMPROVEMENTS, RESOURCES, SEA_WORK, tapsWith, TERRAINS, type ImprovementId } from './terrain';
import { canFortify, isGreatPerson, isMilitary, PARADROP_RANGE, UNIT_LIST, UNITS } from './units';

/**
 * The rules: every order a player can give (each checked: a player only commands their own, and only
 * what the rules allow now), and the end of a turn, when every city grows and builds, research and
 * culture come in, units heal and workers work. Simultaneous turns, Civilization V's online way: orders
 * happen as they're given, and the turn ends for everyone at once (but people at war with each other
 * take theirs one side at a time: `turns.ts`).
 */

export type Order =
  | { t: 'move'; unit: number; to: number }
  | { t: 'attack'; unit: number; target: number }
  | { t: 'rebase'; unit: number; to: number }
  | { t: 'found'; unit: number }
  | { t: 'build'; unit: number; what: ImprovementId | 'road' | 'rail' | 'remove_feature' | 'scrub_fallout' | 'repair' | 'artifact' }
  | { t: 'pillage'; unit: number }
  | { t: 'paradrop'; unit: number; to: number }
  | { t: 'airlift'; unit: number; to: number }
  | { t: 'giftUnit'; unit: number; target: number }
  | { t: 'stance'; unit: number; stance: 'fortify' | 'sleep' | 'alert' | 'wake' }
  | { t: 'skip'; unit: number }
  | { t: 'setup'; unit: number }
  | { t: 'disband'; unit: number }
  | { t: 'upgrade'; unit: number }
  | { t: 'merge'; unit: number; other: number }
  | { t: 'promote'; unit: number; promotion: string }
  | { t: 'produce'; city: number; item: Production; queue?: boolean }
  | { t: 'unqueue'; city: number; index: number }
  | { t: 'reorder'; city: number; from: number; to: number }
  | { t: 'repeat'; city: number; on: boolean }
  | { t: 'buy'; city: number; item: Production; with: 'gold' | 'faith' }
  | { t: 'buyTile'; city: number; tile: number }
  | { t: 'focus'; city: number; focus: City['focus'] }
  | { t: 'work'; city: number; tile: number }
  | { t: 'specialist'; city: number; kind: SpecialistKind; add: boolean }
  | { t: 'cityFire'; city: number; target: number }
  | { t: 'research'; tech: string }
  | { t: 'policy'; id: string }
  | { t: 'ideology'; id: string }
  | { t: 'switchIdeology'; id: string }
  | { t: 'pantheon'; belief: string }
  | { t: 'religion'; unit: number; name: string; beliefs: string[] }
  | { t: 'reformation'; belief: string }
  | { t: 'greatChoice'; kind: GreatKind }
  | { t: 'greatPerson'; unit: number; action: 'improvement' | 'discover' | 'hurry' | 'trade' | 'golden' | 'work' | 'culture' | 'repair' | 'concert' }
  | { t: 'cityChoice'; city: number; choice: 'annex' | 'puppet' | 'raze' | 'liberate' }
  | { t: 'pledge'; target: number }
  | { t: 'spread'; unit: number }
  | { t: 'gift'; target: number; gold: number }
  | { t: 'tribute'; target: number; take: 'gold' | 'worker' }
  | { t: 'coup'; spy: number }
  | { t: 'trade'; unit: number; to: number; cargo?: 'food' | 'prod' }
  | { t: 'spy'; spy: number; target: number | null; diplomat?: boolean }
  | { t: 'vote'; candidate: number }
  | { t: 'congressPropose'; resolution: ResolutionKind; civ: number | null; luxury: string | null; repeal?: boolean }
  | { t: 'congressVote'; proposal: number; vote: 'yes' | 'no' | 'abstain' }
  | { t: 'inquisition'; unit: number }
  | { t: 'war'; target: number; why?: WarWhy | null }
  | { t: 'peace'; target: number }
  | { t: 'openBorders'; target: number }
  | { t: 'deal'; target: number; items: DealItem[] }
  | { t: 'answer'; offer: number; accept: boolean }
  | { t: 'denounce'; target: number }
  | { t: 'embargo'; target: number; lift?: boolean }
  /** A vassal's declaration of independence; a master setting a vassal free (`vassals.ts`). */
  | { t: 'independence' }
  | { t: 'release'; target: number }
  /** Dealing with a barbarian clan (`clans.ts`): a bribe, a warrior hired, or a raid paid for on `target`. */
  | { t: 'clan'; clan: number; act: ClanAct; target: number | null }
  | { t: 'automate'; unit: number; mode: 'work' | 'explore' | null }
  | { t: 'ready'; ready: boolean };

export interface Outcome {
  ok: boolean;
  error?: string;
  /** Fights that happened (for the screens to show). */
  combat?: CombatResult[];
}

const fail = (error: string): Outcome => ({ ok: false, error });
const OK: Outcome = { ok: true };

/** A unit's kind with its article, to begin a sentence ('A Worker', 'An Inquisitor'). */
function aUnit(type: string): string {
  const s = aName(UNITS[type]?.name ?? 'unit');
  return s[0].toUpperCase() + s.slice(1);
}

/** Why a unit has no way to a tile, in words (a move refused): what's there, or what's in the way. */
function noWay(game: Game, u: Unit, to: number): string {
  const tile = game.tiles[to];
  const land = UNITS[u.type].domain === 'land';
  const water = !!TERRAINS[tile.terrain].water;
  const city = cityAt(game, to);
  if (city && city.owner !== u.owner) return atWar(game, u.owner, city.owner) ? `${city.name} is an enemy city: attack it from next to it` : `${city.name} is ${game.players[city.owner].name}'s: no one goes into another's city in peace`;
  const here = occupants(game, to);
  const other = here.military ?? here.civilian;
  if (other && other.owner !== u.owner) return `${aUnit(other.type)} of ${game.players[other.owner].name}'s is there`;
  if (land && water && !knows(game.players[u.owner], 'optics')) return "It can't cross water yet: land units take to the sea with Optics";
  if (!land && !water && !city) return 'Ships keep to the water (and coastal cities)';
  if (!water && !canStand(game, u.type, to)) return 'Nothing crosses that (mountains, ice and some natural wonders)';
  return 'There is no way there it can take';
}

/** Why an attack on a tile can't be made, in words: no enemy there, not at war, out of reach. */
function attackWhy(game: Game, u: Unit, target: number): string {
  const p = game.players[u.owner];
  const city = cityAt(game, target);
  const here = occupants(game, target);
  const owner = city?.owner ?? (here.military ?? here.civilian)?.owner;
  if (owner === undefined || !(p.visible[target] > 0)) return 'There is nothing there it can see to attack';
  if (owner === u.owner) return 'That is your own';
  if (!atWar(game, u.owner, owner)) return `You aren't at war with ${game.players[owner].name}: declare war first (Diplomacy)`;
  if (UNITS[u.type].ranged) {
    if (u.embarked) return "It can't fire from the water";
    const range = rangeOf(u);
    return distance(game.grid, u.tile, target) > range ? `Out of range: it fires up to ${range} tile${range === 1 ? '' : 's'} away` : 'It has no clear line to it: hills, forest, jungle or mountains in the way (from a hill it sees over them)';
  }
  return neighbours(game.grid, u.tile).includes(target) ? "It can't attack that" : 'It fights hand to hand: move it next to the enemy first';
}

/** Why a worker can't build something where it stands, in words (what's needed instead). */
function buildWhy(game: Game, u: Unit, what: BuildWhat): string {
  const p = game.players[u.owner];
  const tile = game.tiles[u.tile];
  const type = UNITS[u.type];
  if (type.abilities?.includes('archaeology')) return 'An archaeologist digs only at an antiquity site';
  if (!type.abilities?.includes('build') && !(type.abilities?.includes('build_sea') && SEA_WORK.includes(what))) return type.abilities?.includes('build_sea') ? 'A work boat builds only fishing boats and offshore platforms' : 'Only workers build';
  if (tile.wonder) return 'Nothing is built on a natural wonder';
  if (cityAt(game, u.tile) && what !== 'road') return 'Nothing but a road is built in a city';
  if (what === 'road') return !knows(p, 'the_wheel') ? 'Roads come with The Wheel' : tile.road ? 'There is a road here already' : 'No road is built on the water';
  if (what === 'rail') return !knows(p, 'railroad') ? 'Railroads come with Railroad' : 'A railroad is laid over a road: build the road first';
  if (what === 'scrub_fallout') return 'There is no fallout here';
  if (tile.feature === 'fallout') return 'Scrub the Fallout first';
  if (what === 'repair') return 'Nothing here is pillaged';
  if (what === 'remove_feature') {
    const f = tile.feature ? FEATURES[tile.feature] : undefined;
    return f?.removable ? `Clearing the ${f.name} comes with ${TECHS[f.removable.tech]?.name ?? 'a tech'}` : 'There is nothing here to clear';
  }
  const imp = IMPROVEMENTS[what as ImprovementId];
  if (!imp || imp.great) return 'Only a great person builds that';
  const one = aName(imp.name);
  const One = one[0].toUpperCase() + one.slice(1);
  if (imp.tech && !knows(p, imp.tech)) return `${One} needs ${TECHS[imp.tech]?.name ?? 'a tech'}`;
  if (tile.owner !== u.owner) return 'Only in your own land';
  if (tile.improvement === what) return `There is ${one} here already`;
  if (tile.feature && ['forest', 'jungle', 'marsh'].includes(tile.feature)) return `Clear the ${FEATURES[tile.feature].name} first`;
  return `${One} can't stand on this land`;
}

// -------------------------------------------------------------------------------------------------
// What a city can build
// -------------------------------------------------------------------------------------------------

/** The units a player's cities can train now: known techs, not obsolete, unique units in place of the usual, strategic resources to hand, the bomb after the Manhattan Project. */
export function trainable(game: Game, p: Player, c: City): string[] {
  return trainOptions(game, p, c)
    .filter((o) => !o.why)
    .map((o) => o.id);
}

/**
 * The units a city could train with what its civ knows, each with why it can't now, if it can't: no
 * strategic resource to spare (a Swordsman without Iron), no citizen to spare (a Settler in a city
 * of one), or no trade route to fill (a Caravan with every route running or spoken for by one
 * waiting). What's out of reach for good (unknown, obsolete, no coast) isn't listed.
 */
export function trainOptions(game: Game, p: Player, c: City): { id: string; why?: string }[] {
  const out: { id: string; why?: string }[] = [];
  const res = strategic(game, p);
  const sea = coastal(game, c);
  const nukes = has(civEffects(game, p), 'enables_nukes');
  for (const u of UNIT_LIST) {
    if (u.unbuildable || u.civ) continue;
    if (u.tech && !knows(p, u.tech)) continue;
    if (u.obsolete && knows(p, u.obsolete) && u.class !== 'civilian' && u.class !== 'trade') continue;
    if (u.domain === 'sea' && !sea) continue;
    if (u.abilities?.includes('nuke') && (!nukes || inForce(game, 'non_proliferation'))) continue;
    const id = unitFor(p.civ, u.id, UNITS);
    const type = UNITS[id];
    if (id === 'settler' && p.cityState) continue;
    const spare = type.resource ? (res[type.resource]?.have ?? 0) - (res[type.resource]?.used ?? 0) : 1;
    const full = type.abilities?.includes('trade_route') ? routesFull(game, p) : undefined;
    if (spare <= 0) out.push({ id, why: `Needs ${RESOURCES[type.resource!]?.name ?? type.resource} (${res[type.resource!]?.have ? 'all yours is in use' : 'you have none'})` });
    else if (id === 'settler' && c.pop < 2) out.push({ id, why: 'Needs a city of 2 (it takes a citizen)' });
    else if (full) out.push({ id, why: full });
    else out.push({ id });
  }
  return out;
}

/** Whether a city meets a building's needs (tech, the building it needs, river, coast, mountain, a resource near). */
/** Each civ's own buildings, by the building each replaces (worked out once). */
const OWN_VERSION = new Map<string, string>();
for (const x of Object.values(BUILDINGS)) if (x.civ && x.replaces) OWN_VERSION.set(`${x.civ}:${x.replaces}`, x.id);

export function canConstruct(game: Game, p: Player, c: City, b: Building, withoutResource = false): boolean {
  // (Faith's buildings have no production cost: they're only bought with faith.)
  if (b.unbuildable || b.cost <= 0 || c.buildings.includes(b.id)) return false;
  if (b.civ && b.civ !== p.civ) return false;
  // A civ with its own version builds that instead.
  if (!b.civ && OWN_VERSION.has(`${p.civ}:${b.id}`)) return false;
  if (b.tech && !knows(p, b.tech)) return false;
  if (b.policy && !policyMet(p, b.policy)) return false;
  const needs = b.needs && (OWN_VERSION.get(`${p.civ}:${b.needs}`) ?? b.needs);
  if (needs && !c.buildings.includes(needs) && !c.buildings.includes(b.needs!)) return false;
  if (b.coastal && !neighbours(game.grid, c.tile).some((t) => game.tiles[t].terrain === 'coast' || game.tiles[t].terrain === 'ocean')) return false;
  if (b.river && !game.tiles[c.tile].river && !neighbours(game.grid, c.tile).some((t) => game.tiles[t].terrain === 'lake')) return false;
  if (b.mountain && !within(game.grid, c.tile, 1).some((t) => game.tiles[t].elevation === 'mountain')) return false;
  if (b.nearResource && !within(game.grid, c.tile, 3).some((t) => game.tiles[t].resource && b.nearResource!.includes(game.tiles[t].resource!))) return false;
  if (b.resource && !withoutResource) {
    const r = strategic(game, p)[b.resource];
    if (!r || r.have - r.used <= 0) return false;
  }
  if (b.kind === 'world' && b.id in game.wonders) return false;
  if (b.kind === 'world' && game.cities.some((x) => x.queue[0]?.kind === 'building' && x.queue[0].id === b.id && x !== c && x.owner === p.index)) return false;
  if (b.kind === 'national') {
    if (citiesOf(game, p.index).some((x) => x.buildings.includes(b.id))) return false;
    if (b.everyCity && !citiesOf(game, p.index).every((x) => x.puppet || x.buildings.includes(b.everyCity!) || x.buildings.some((id) => BUILDINGS[id]?.replaces === b.everyCity))) return false;
  }
  if (b.id === 'courthouse' && !c.occupied) return false;
  return true;
}

export function constructible(game: Game, p: Player, c: City): string[] {
  return Object.values(BUILDINGS)
    .filter((b) => b.cost > 0 && canConstruct(game, p, c, b))
    .map((b) => b.id);
}

/** Buildings a city could build but for a strategic resource (Coal for a Factory), and what's missing. */
export function heldBuildings(game: Game, p: Player, c: City): { id: string; why: string }[] {
  const res = strategic(game, p);
  return Object.values(BUILDINGS)
    .filter((b) => b.resource && b.cost > 0 && !canConstruct(game, p, c, b) && canConstruct(game, p, c, b, true))
    .map((b) => ({ id: b.id, why: `Needs ${RESOURCES[b.resource!]?.name ?? b.resource} (${res[b.resource!]?.have ? 'all yours is in use' : 'you have none'})` }));
}

/** Production cost of an item, at speed. */
export function itemCost(game: Game, item: Production): number {
  if (item.kind === 'unit') return scaled(game, UNITS[item.id]?.cost ?? 0);
  if (item.kind === 'building') return scaled(game, BUILDINGS[item.id]?.cost ?? 0);
  // (An international project: what it still wants, from everyone.)
  if (item.kind === 'project') return isProject(item.id) ? projectLeft(game, item.id) : scaled(game, partCost(item.id));
  return Infinity;
}

/**
 * The production a city puts toward an item this turn (its production, and bonuses for that kind of
 * thing); its effects and production can be given, worked out once for many items. (A city's
 * production doesn't depend on its empire's mood, so it's worked out without it.)
 */
export function productionToward(game: Game, c: City, item: Production, effects = cityEffects(game, c), base = cityYields(game, c, 0).prod): number {
  let pct = 0;
  if (item.kind === 'building') {
    const b = BUILDINGS[item.id];
    if (b?.kind === 'world') pct += effects.reduce((s, e) => s + (e.wonderProduction ?? 0), 0);
    pct += effects.reduce((s, e) => s + (e.buildingProduction ?? 0), 0);
    for (const e of effects) for (const boost of e.buildingBoost ?? []) if (boost.buildings.some((id) => isBuilding(item.id, id))) pct += boost.percent;
    // (Marble quarried in its land: a world wonder goes up faster. The map looked at only for a wonder.)
    if (b?.kind === 'world' && game.tiles.some((t) => t.resource === 'marble' && t.improvement === 'quarry' && !t.pillaged && t.owner === c.owner)) pct += 15;
    // Rome: a building the capital has goes up faster in the other cities.
    if (b?.kind === 'building' && has(effects, 'capital_buildings_faster')) {
      const capital = capitalOf(game, c.owner);
      if (capital && capital !== c && capital.buildings.some((x) => isBuilding(x, item.id))) pct += 25;
    }
  }
  if (item.kind === 'unit') {
    const u = UNITS[item.id];
    for (const e of effects) for (const up of e.unitProduction ?? []) if ((!up.classes || up.classes.includes(u.class) || up.classes.includes(u.id)) && (!up.domain || up.domain === u.domain)) pct += up.percent;
  }
  if (item.kind === 'project' && !isProject(item.id)) pct += effects.reduce((s, e) => s + (e.spaceshipProduction ?? 0), 0);
  return Math.floor(base * (1 + pct / 100));
}

// -------------------------------------------------------------------------------------------------
// Cities
// -------------------------------------------------------------------------------------------------

/** Whether a settler can found a city here: land, not on a mountain, and three tiles from any other city. */
export function canFound(game: Game, t: number): boolean {
  const tile = game.tiles[t];
  if (TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.feature === 'ice' || tile.wonder) return false;
  return !game.cities.some((c) => distance(game.grid, c.tile, t) < 3);
}

export function foundCity(game: Game, owner: number, t: number): City {
  const p = game.players[owner];
  const mine = citiesOf(game, owner);
  const civ = CIVS[p.civ];
  const used = new Set(game.cities.map((c) => c.name));
  const name = civ?.cities.find((n) => !used.has(n)) ?? `${civ?.adjective ?? 'New'} City ${game.cities.length + 1}`;
  const first = mine.length === 0 && !game.cities.some((c) => c.founder === owner);
  const c: City = {
    id: game.nextId++,
    name,
    owner,
    founder: owner,
    tile: t,
    pop: 1,
    food: 0,
    prod: 0,
    culture: 0,
    tilesBought: 0,
    hp: 200,
    buildings: first ? ['palace'] : [],
    queue: [],
    worked: [],
    specialists: {},
    focus: 'balanced',
    capital: first || undefined,
    saved: {},
  };
  game.cities.push(c);
  const tile = game.tiles[t];
  // A city clears what's on its tile (forest, a ruin); it stands on its hill if there's one.
  if (tile.feature && tile.feature !== 'floodplains') tile.feature = undefined;
  tile.improvement = undefined;
  tile.road = 'road';
  tile.ruin = undefined;
  tile.pillaged = undefined;
  claim(game, c, t);
  for (const n of within(game.grid, t, 1)) if (game.tiles[n].owner < 0) claim(game, c, n);
  // Free buildings the empire gives every city (policies' and wonders'), and those still owed to new cities (Legalism's...).
  for (const e of civEffects(game, p)) if (e.freeBuildingInAll && !c.buildings.includes(e.freeBuildingInAll)) c.buildings.push(e.freeBuildingInAll);
  for (const [b, left] of Object.entries(p.freeBuildings ?? {}))
    if (left > 0) {
      p.freeBuildings![b] = left - 1;
      if (!c.buildings.some((x) => isBuilding(x, b))) c.buildings.push(unitFor(p.civ, b, BUILDINGS));
    }
  if (startEraOf(game.settings) > 0 || scenarioOf(game.settings)) foundedInEra(game, p, c, first);
  assignCitizens(game, c);
  // A bot's new city starts on a Warrior; a person's asks what to build (Civ V's way: a Warrior in the Middle Ages is no help).
  c.queue = p.bot ? [{ kind: 'unit', id: unitFor(p.civ, 'warrior', UNITS) }] : [];
  updateVisibility(game, p);
  note(game, owner, { text: `${name} is founded.`, at: t, kind: 'city' });
  return c;
}

/**
 * A city founded in a game begun in a later era (`starts.ts`): bigger, with the age's everyday
 * buildings standing (those its civ knows and its site allows, its own version where it has one),
 * free of upkeep.
 * A capital's founding brings the rest of the start: culture banked for the era's first policies,
 * and its scenario's buildings and units there (the Cold War's Manhattan Project and bombs).
 */
function foundedInEra(game: Game, p: Player, c: City, capital: boolean) {
  const start = eraStartOf(game.settings);
  c.pop += start.pop;
  for (const b of start.buildings) {
    const id = unitFor(p.civ, b, BUILDINGS);
    if (!BUILDINGS[id] || !canConstruct(game, p, c, BUILDINGS[id], true)) continue;
    c.buildings.push(id);
    (c.free ??= []).push(id);
  }
  const sc = scenarioOf(game.settings);
  if (!capital || p.cityState || p.civ === 'barbarian') return;
  for (let n = 0; n < start.policies; n++) p.culture += policyCost(game, p, p.policies.length + n);
  for (const b of sc?.capitalBuildings ?? []) if (!c.buildings.includes(b)) c.buildings.push(b);
  for (const id of sc?.capitalUnits ?? []) spawnUnit(game, id, p.index, c.tile);
}

/** Gold plundered from a city taken (Civ V's, roughly: more for a bigger city; doubled by a Burial Tomb). */
export function plunder(game: Game, c: City): number {
  const gold = Math.floor((20 + 10 * c.pop) * speed(game));
  return has(cityEffects(game, c), 'double_plunder') ? 2 * gold : gold;
}

/** A city changes hands. */
function captureCity(game: Game, c: City, by: number) {
  const was = c.owner;
  const loser = game.players[was];
  const gold = plunder(game, c);
  game.players[by].gold += gold;
  const taker = game.players[by];
  noteAll(game, (r) =>
    r === taker
      ? { text: `You have taken ${c.name} from ${loser.name}!`, at: c.tile, kind: 'war' }
      : r === loser
        ? { text: `${taker.name} has taken ${c.name} from you!`, at: c.tile, kind: 'war' }
        : knowsOf(r, taker) || knowsOf(r, loser)
          ? { text: `${nameTo(r, taker, true)} has taken ${c.name} from ${nameTo(r, loser)}!`, at: r.explored[c.tile] ? c.tile : undefined, kind: 'war', topic: 'wars' }
          : null,
  );
  if (gold) note(game, by, { text: `${gold} gold is plundered from ${c.name}.`, at: c.tile, kind: 'good' });
  // Its wonders are the captor's now.
  for (const w of c.wonders ?? []) game.wonders[w] = by;
  // A capital taken loses its civ the spaceship being built there (Civ V's).
  if (c.capital && loser.spaceship.length) {
    loser.spaceship = [];
    noteAll(game, (r) => ({ text: r === loser ? 'Your spaceship is lost with your capital!' : `${nameTo(r, loser, true)} has lost its spaceship with its capital.`, kind: r === loser ? 'bad' : 'info' }));
  }
  cityTaken(game, was, by);
  // A city-state's or a civ's: it's theirs, occupied, smaller (and, taken from one who hadn't founded it, theirs to liberate: `liberation.ts`).
  c.owner = by;
  c.takenFrom = was;
  c.pop = Math.max(1, c.pop - Math.max(1, Math.floor(c.pop / 4)));
  c.hp = Math.floor(cityMaxHp(game, c) / 4);
  c.occupied = c.founder !== by;
  c.resistance = c.occupied ? Math.max(1, Math.floor(c.pop / 2)) : 0;
  c.queue = [];
  c.prod = 0;
  c.locked = [];
  // (What it was founded with free, its captor pays for.)
  c.free = undefined;
  // (Burning, it's put out: its new owner decides again, and its founder, back, keeps it.)
  c.razing = undefined;
  capFollowers(c);
  // Buildings: the palace, national wonders and some others go; world wonders stay; the captor's free buildings come.
  c.buildings = c.buildings.filter((b) => b !== 'palace' && (BUILDINGS[b]?.kind === 'world' || random(game) < 0.66) && BUILDINGS[b]?.kind !== 'national');
  for (const e of civEffects(game, game.players[by])) if (e.freeBuildingInAll && !c.buildings.includes(e.freeBuildingInAll)) c.buildings.push(e.freeBuildingInAll);
  // Great works go with the buildings that held them.
  if (c.works) c.works = Object.fromEntries(Object.entries(c.works).filter(([b]) => c.buildings.includes(b)));
  if (c.capital) c.capital = undefined;
  for (const t of game.tiles.keys()) if (game.tiles[t].city === c.id) game.tiles[t].owner = by;
  // The loser's new capital.
  const left = citiesOf(game, was);
  if (left.length && !left.some((x) => x.capital)) {
    // (Not a puppet, if it has a city of its own; a puppet that becomes its seat is annexed.)
    const seat = left.find((x) => !x.puppet) ?? left[0];
    seat.capital = true;
    seat.puppet = undefined;
    seat.buildings.push('palace');
  }
  if (!left.length && !unitsOf(game, was).some((u) => u.type === 'settler')) eliminate(game, was);
  if (game.players[by].civ !== 'barbarian') {
    c.puppet = c.founder !== by ? true : undefined;
    // (A puppet chooses its own builds: it starts on one at once, rather than standing idle till the turn ends.)
    if (c.puppet) c.queue = [defaultBuild(game, game.players[by], c)];
    if (c.puppet && !game.players[by].bot) note(game, by, { text: `${c.name} is yours: annex it, keep it as a puppet, ${liberation(game, c) ? `liberate it (back to ${game.players[c.founder].name}), ` : ''}or raze it (click to open the city).`, at: c.tile, kind: 'war', openCity: true });
  }
  assignCitizens(game, c);
  updateAllVisibility(game);
  checkVictory(game);
  // (A city taken that ends the game: the replay's last turn is this one.)
  if (game.over) recordReplay(game, game.turn, eraOf);
}

function eliminate(game: Game, p: number) {
  const pl = game.players[p];
  if (!pl.alive || pl.civ === 'barbarian') return;
  pl.alive = false;
  // (What it had agreed with anyone ends with it: no one goes on paying, or lending to, a civ that's gone.)
  for (const o of game.players) if (o !== pl) endDealings(game, p, o.index);
  for (const u of unitsOf(game, p)) removeUnit(game, u);
  endWars(game, p);
  noteAll(game, (r) => ({ text: knowsOf(r, pl) ? `${pl.name} of ${civOf(pl)?.name ?? 'a lost people'} has been destroyed.` : "A civilization you never met has been destroyed.", kind: 'war' }));
}

cityHooks.captured = captureCity;
clanHooks.found = foundCity;
cityHooks.nuked = nuclearStrike;
cityHooks.killed = (game, u, by) => {
  // (A clan's raider killed: the clan loses heart, `clans.ts`.)
  clanHarmed(game, u);
  // A battlefield: a land unit falling outside a city now and then leaves an antiquity site.
  const tile = game.tiles[u.tile];
  if (UNITS[u.type].domain === 'land' && !TERRAINS[tile.terrain].water && !cityAt(game, u.tile) && random(game) < 0.1) tile.antiquity = true;
  if (!by) return;
  const winner = game.players[by.owner];
  // (A kill is a deed: Archery's eureka, Steel's for a Swordsman's.)
  killDeeds(game, winner, by.type, u.owner);
  if (!winner.bot) checkEurekas(game, winner);
  const civ = civEffects(game, winner);
  const strength = UNITS[u.type].strength * sizeOf(u);
  // The Aztecs (every kill) and Honor (barbarians): culture; Honor finished: gold; God of War: faith, near your cities.
  if (has(civ, 'culture_from_kills')) winner.culture += strength;
  if (has(civ, 'culture_from_barbarian_kills') && game.players[u.owner].civ === 'barbarian') winner.culture += strength;
  if (has(civ, 'gold_from_kills')) winner.gold += Math.floor(strength / 2);
  if (has(civ, 'faith_from_kills') && citiesOf(game, by.owner).some((c) => distance(game.grid, c.tile, u.tile) <= 4)) winner.faith += strength;
};

/** Great general (admiral, at sea) points from a fight: one is born by the unit when there are enough (China's come half again as fast). */
cityHooks.greatPoints = (game, u, points) => {
  const p = game.players[u.owner];
  const kind: GreatKind = UNITS[u.type].domain === 'sea' ? 'admiral' : 'general';
  const have = (p.greatPoints[kind] ?? 0) + points * (1 + greatPeopleBonus(civEffects(game, p), kind) / 100);
  const cost = greatCost(game, p, kind);
  // (With nowhere to put it, the points wait.)
  p.greatPoints[kind] = have >= cost && greatPersonBorn(game, p, kind, u.tile) ? have - cost : have;
};

// (A civilian stepped onto by an enemy soldier: wired here, not in `combat.ts`, which `movement.ts` may load before it's ready.)
captureHooks.onCivilian = capture;

// -------------------------------------------------------------------------------------------------
// Ancient ruins
// -------------------------------------------------------------------------------------------------

ruinHooks.onRuin = (game, u) => {
  const tile = game.tiles[u.tile];
  tile.ruin = undefined;
  // What's left of them is for the archaeologists.
  tile.antiquity = true;
  const p = game.players[u.owner];
  p.ruins++;
  const options: (() => string)[] = [
    () => {
      const g = 25 + Math.floor(random(game) * 60);
      p.gold += g;
      return `${g} gold`;
    },
    () => {
      const c = 20;
      p.culture += c;
      return `${c} culture`;
    },
    () => {
      const options = Object.keys(TECHS).filter((t) => canResearch(new Set(p.techs), t) && TECHS[t].col <= 2);
      if (!options.length) return '';
      const t = options[Math.floor(random(game) * options.length)];
      learn(game, p, t);
      return `the secrets of ${TECHS[t].name}`;
    },
    () => {
      const near = citiesOf(game, p.index).sort((a, b) => distance(game.grid, a.tile, u.tile) - distance(game.grid, b.tile, u.tile))[0];
      if (!near) return '';
      near.pop++;
      assignCitizens(game, near);
      return `a new citizen in ${near.name}`;
    },
    () => {
      p.faith += 15;
      return '15 faith';
    },
    () => {
      for (const t of within(game.grid, u.tile, 5)) p.explored[t] = 1;
      return 'a map of the land around';
    },
    () => {
      const at = within(game.grid, u.tile, 1).find((t) => t !== u.tile && canEnter(game, { ...u, id: -1, type: 'warrior' } as Unit, t));
      if (at === undefined) return '';
      spawnUnit(game, unitFor(p.civ, 'warrior', UNITS), p.index, at, { moves: 0 });
      return 'warriors to join you';
    },
  ];
  for (let tries = 0; tries < 8; tries++) {
    const said = options[Math.floor(random(game) * options.length)]();
    if (said) {
      note(game, p.index, { text: `The ancient ruins give you ${said}.`, at: u.tile, kind: 'good' });
      return;
    }
  }
};

// -------------------------------------------------------------------------------------------------
// Research, policies, religion
// -------------------------------------------------------------------------------------------------

/** A tech learned: what it starts (Babylon's free scientist, a free tech's choice). */
export function learn(game: Game, p: Player, id: string) {
  if (id === 'future_tech') p.futureTechs++;
  else if (!p.techs.includes(id)) p.techs.push(id);
  delete p.research[id];
  // (Learned some other way — a ruin, a spy, a great scientist — it's no longer waited for either.)
  if (id !== 'future_tech') p.techQueue = p.techQueue.filter((t) => t !== id);
  if (p.researching === id) p.researching = p.techQueue.shift() ?? null;
  // (Future Tech, with nothing else queued and nothing else left to learn: on to the next one, unasked.)
  if (id === 'future_tech' && !p.researching && !Object.keys(TECHS).some((t) => t !== 'future_tech' && canResearch(new Set(p.techs), t))) p.researching = 'future_tech';
  note(game, p.index, { text: `You have discovered ${TECHS[id].name}.`, kind: 'tech' });
  if (id === 'writing' && has(civEffects(game, p), 'scientist_on_writing')) greatPersonBorn(game, p, 'scientist');
  updateVisibility(game, p);
}

/**
 * A team researches together, Civilization V's way: each of them chooses their own research
 * (`research` order), and the science each puts into a tech is the team's progress toward it (a tech
 * costs a team more, `techCost`): two of them on one tech finish it sooner, on two different ones
 * they research both at once. A tech learned, by any of them or any way, is learned by all. Each
 * keeps the team's progress as their own: made the same again here, after every order and as the
 * turn ends (what each has put in since the last time, added up).
 */
export function shareResearch(game: Game) {
  const shared = new Set<number>();
  for (const p of game.players) {
    if (p.team === undefined || !p.alive || shared.has(p.team)) continue;
    shared.add(p.team);
    const team = teamOf(game, p.index);
    if (team.length < 2) continue;
    // What any of them knows, all of them do (each told, each with what it brings them).
    const known = [...new Set(team.flatMap((m) => m.techs))];
    for (const m of team) for (const id of known) if (!m.techs.includes(id)) learn(game, m, id);
    const future = Math.max(...team.map((m) => m.futureTechs));
    for (const m of team) m.futureTechs = future;
    // What each has put in since, pooled.
    const base = ((game.teamResearch ??= {})[p.team] ??= {});
    const pooled: Record<string, number> = {};
    for (const id of new Set([...Object.keys(base), ...team.flatMap((m) => Object.keys(m.research))])) {
      if (known.includes(id)) continue;
      const was = base[id] ?? 0;
      const sum = team.reduce((n, m) => n + (m.research[id] ?? 0) - was, was);
      if (sum > 0) pooled[id] = sum;
    }
    // Finished between them: learned by all; what's over goes on into the next research of those
    // who were on it (shared out), or waits for their next choice, as it does for a civ alone.
    const finished = () => Object.keys(pooled).find((id) => pooled[id] >= techCost(game, p, id));
    for (let id = finished(); id; id = finished()) {
      const over = pooled[id] - techCost(game, p, id);
      delete pooled[id];
      const on = team.filter((m) => m.researching === id);
      for (const m of team) learn(game, m, id);
      const to = on.length ? on : [p];
      to.forEach((m, i) => {
        const share = Math.floor(over / to.length) + (i === 0 ? over - Math.floor(over / to.length) * to.length : 0);
        if (m.researching) pooled[m.researching] = (pooled[m.researching] ?? 0) + share;
        else {
          m.spareScience = (m.spareScience ?? 0) + share;
          if (!m.bot && on.includes(m)) note(game, m.index, { text: 'Choose what to research next.', kind: 'tech', remind: true });
        }
      });
    }
    for (const m of team) m.research = { ...pooled };
    game.teamResearch[p.team] = { ...pooled };
  }
}

/** The era a player is in: their furthest tech's (or, begun in a later era, that one till they're past it). */
export function eraOf(p: Player): number {
  let col = 0;
  for (const t of p.techs) col = Math.max(col, TECHS[t]?.col ?? 0);
  // (Begun in a later era: in it from the first turn, its techs still to learn.)
  return Math.max(p.startEra ?? 0, ERAS.indexOf(eraOfCol(col)));
}

function adoptPolicy(game: Game, p: Player, id: string) {
  const adopt = (x: string) => {
    p.policies.push(x);
    (p.policyTurns ??= {})[x] = game.turn;
    applyOnce(game, p, ALL_POLICIES[x].effects, capitalOf(game, p.index) ?? null);
  };
  adopt(id);
  // Finishing a tree: its finisher too.
  for (const t of TREES) if (t.policies.some((x) => x.id === id) && treeDone(p, t) && !p.policies.includes(t.finisher.id)) adopt(t.finisher.id);
}

/** Effects that happen once (free units, techs, golden ages, great people, buildings in all cities or the first few, Terracotta Army's copies). */
export function applyOnce(game: Game, p: Player, e: Effects, where: City | null) {
  for (const f of e.freeUnits ?? []) for (let i = 0; i < f.count; i++) if (where) spawnNear(game, unitFor(p.civ, f.unit, UNITS), p.index, where.tile);
  if (e.freeTechs) for (let i = 0; i < e.freeTechs; i++) {
    const options = Object.keys(TECHS).filter((t) => canResearch(new Set(p.techs), t) && t !== 'future_tech').sort((a, b) => TECHS[a].col - TECHS[b].col);
    if (options[0]) learn(game, p, p.researching && options.includes(p.researching) ? p.researching : options[0]);
  }
  if (e.goldenAge) startGoldenAge(game, p, e.goldenAge);
  // A free great person of the player's choosing waits for their choice (made for them at the turn's end if not).
  if (e.freeGreatPerson === 'any') {
    p.greatChoices = (p.greatChoices ?? 0) + 1;
    note(game, p.index, { text: "Choose a free great person (if you don't by the turn's end, it's the kind you're nearest to).", kind: 'great', remind: true });
  }
  else if (e.freeGreatPerson) greatPersonBorn(game, p, e.freeGreatPerson);
  if (e.freeBuildingInAll) for (const c of citiesOf(game, p.index)) if (!c.buildings.includes(e.freeBuildingInAll)) c.buildings.push(e.freeBuildingInAll);
  if (e.freeBuildings) {
    const { building, cities } = e.freeBuildings;
    const first = citiesOf(game, p.index).sort((a, b) => a.id - b.id).slice(0, cities);
    for (const c of first) if (!c.buildings.some((b) => isBuilding(b, building))) c.buildings.push(unitFor(p.civ, building, BUILDINGS));
    (p.freeBuildings ??= {})[building] = (p.freeBuildings[building] ?? 0) + cities - first.length;
  }
  if (e.freeBuildingHere && where && !where.buildings.includes(e.freeBuildingHere)) where.buildings.push(e.freeBuildingHere);
  if (e.freePolicies) p.culture += policyCost(game, p) * e.freePolicies;
  if (e.special?.includes('copy_each_land_unit'))
    for (const u of unitsOf(game, p.index)) if (UNITS[u.type].domain === 'land' && isMilitary(UNITS[u.type]) && !isGreatPerson(u.type)) spawnNear(game, u.type, p.index, u.tile);
  for (const c of citiesOf(game, p.index)) assignCitizens(game, c);
}

/** Where a new unit of a type would go near a tile: the nearest tile it may stand on (or, for a land unit, take to the sea from), or none. */
function placeNear(game: Game, type: string, owner: number, t: number): number | undefined {
  const options = within(game.grid, t, 2).filter((x) => canEnter(game, { id: -1, type, owner, tile: x, moves: 0, hp: 100, xp: 0, promotions: [] }, x));
  return options.find((x) => canStand(game, type, x)) ?? options[0];
}

function spawnNear(game: Game, type: string, owner: number, t: number): Unit | undefined {
  const at = placeNear(game, type, owner, t);
  return at === undefined ? undefined : spawnUnit(game, type, owner, at, { embarked: UNITS[type]?.domain === 'land' && TERRAINS[game.tiles[at].terrain].water ? true : undefined });
}

function startGoldenAge(game: Game, p: Player, turns: number) {
  const longer = civEffects(game, p).reduce((s, e) => s + (e.goldenAgeLength ?? 0), 0);
  p.goldenTurns += Math.round(turns * (1 + longer / 100) * GOLDEN_SPEEDS[game.settings.speed]);
  p.goldenAges++;
  note(game, p.index, { text: 'A golden age begins!', kind: 'good' });
}

/** The unit each kind of great person is. */
const GREAT_UNIT: Record<GreatKind, string> = {
  artist: 'great_artist',
  writer: 'great_writer',
  musician: 'great_musician',
  scientist: 'great_scientist',
  engineer: 'great_engineer',
  merchant: 'great_merchant',
  general: 'great_general',
  admiral: 'great_admiral',
  prophet: 'great_prophet',
};

/**
 * Where a great person would be born: by a tile (a general beside its army, one bought in its city),
 * else in the capital or another city with room (an admiral, a coastal one). In a city of its own
 * it's born in the city itself, whoever is there (a great person waits in its cities beside another
 * civilian, `canEnter`).
 */
function greatPlace(game: Game, p: Player, kind: GreatKind, near?: number): number | undefined {
  const type = GREAT_UNIT[kind];
  const homes = citiesOf(game, p.index).sort((a, b) => Number(!!b.capital) - Number(!!a.capital));
  for (const t of [...(near !== undefined ? [near] : []), ...homes.map((c) => c.tile)]) {
    const at = placeNear(game, type, p.index, t);
    if (at !== undefined) return at;
  }
  return undefined;
}

/** A great person is born (false, and nothing counted, if there's nowhere to put it). */
function greatPersonBorn(game: Game, p: Player, kind: GreatKind, near?: number): boolean {
  const at = greatPlace(game, p, kind, near);
  if (at === undefined) return false;
  p.greatCount[kind] = (p.greatCount[kind] ?? 0) + 1;
  const u = spawnUnit(game, GREAT_UNIT[kind], p.index, at, { embarked: UNITS[GREAT_UNIT[kind]].domain === 'land' && TERRAINS[game.tiles[at].terrain].water ? true : undefined });
  if (kind === 'prophet') u.spreads = spreadsOf(game, p, 'great_prophet');
  note(game, p.index, { text: `A ${UNITS[GREAT_UNIT[kind]].name} has been born!`, at, kind: 'great' });
  return true;
}

/** A free great person for a player who hasn't chosen (a bot, or a person at the turn's end): the kind they're nearest to earning. */
function chooseGreat(game: Game, p: Player) {
  while (p.greatChoices) {
    const kind = [...CHOOSABLE].sort((a, b) => (p.greatPoints[b] ?? 0) / greatCost(game, p, b) - (p.greatPoints[a] ?? 0) / greatCost(game, p, a))[0];
    if (!greatPersonBorn(game, p, kind)) return;
    p.greatChoices--;
  }
}

/** A religion takes a Reformation belief. */
function reform(game: Game, p: Player, belief: string) {
  const rel = game.religions[p.religion!];
  rel.beliefs.push(belief);
  noteAll(game, (r) => (r === p ? null : { text: `${nameTo(r, p, true)} has reformed ${rel.name}: ${BELIEFS[belief].name}.`, kind: 'religion', topic: 'religion' }));
}

// -------------------------------------------------------------------------------------------------
// Orders
// -------------------------------------------------------------------------------------------------

/** Whether a worker can build `what` on its tile now. */
export type BuildWhat = Extract<Order, { t: 'build' }>['what'];

export function canBuild(game: Game, u: Unit, what: BuildWhat): boolean {
  const p = game.players[u.owner];
  const tile = game.tiles[u.tile];
  const type = UNITS[u.type];
  if (type.abilities?.includes('archaeology')) return (what === 'landmark' || what === 'artifact') && canDig(game, u, what);
  if (!type.abilities?.includes('build') && !(type.abilities?.includes('build_sea') && SEA_WORK.includes(what))) return false;
  // Nothing's built on a natural wonder.
  if (tile.wonder) return false;
  if (cityAt(game, u.tile) && what !== 'road') return false;
  if (what === 'road') return knows(p, 'the_wheel') && !tile.road && !TERRAINS[tile.terrain].water;
  if (what === 'rail') return knows(p, 'railroad') && tile.road === 'road';
  // Fallout: scrubbed away (anywhere), and nothing built or mended under it until it is (roads aside).
  if (what === 'scrub_fallout') return tile.feature === 'fallout';
  if (tile.feature === 'fallout') return false;
  if (what === 'repair') return !!tile.pillaged;
  if (what === 'remove_feature') {
    const f = tile.feature && FEATURES[tile.feature];
    return !!f?.removable && knows(p, f.removable.tech);
  }
  if (!Object.hasOwn(IMPROVEMENTS, what)) return false;
  const imp = IMPROVEMENTS[what as ImprovementId];
  if (imp.great || (imp.tech && !knows(p, imp.tech))) return false;
  if (tile.owner !== u.owner) return false;
  if (tile.improvement === what) return false;
  const resourceFits = !!tile.resource && tapsWith(tile) === what;
  const placeFits = imp.on.some((on) => on === tile.terrain || on === tile.feature || on === tile.elevation || (on === 'any_land' && !TERRAINS[tile.terrain].water));
  if (imp.on.includes('resource') ? !resourceFits && !placeFits : !placeFits && !resourceFits) return false;
  // Farms on forest or jungle: clear it first.
  if ((what === 'farm' || what === 'trading_post' || what === 'mine') && (tile.feature === 'forest' || tile.feature === 'jungle' || tile.feature === 'marsh') && !resourceFits) return false;
  return true;
}

/** The work a civ's work boat could do on a sea tile now (its resource untapped, the tech known), if any. */
export function seaWork(game: Game, p: Player, t: number): ImprovementId | null {
  const tile = game.tiles[t];
  const imp = tapsWith(tile);
  if (!imp || !SEA_WORK.includes(imp) || !TERRAINS[tile.terrain].water || tile.improvement === imp || !seesResource(p, tile.resource)) return null;
  return !IMPROVEMENTS[imp].tech || knows(p, IMPROVEMENTS[imp].tech) ? imp : null;
}

/**
 * Whether an archaeologist can dig where it stands (Civ V's): an antiquity site (a hidden one only
 * with Treasure Fleets or Aesthetics finished), not in a city; a Landmark in its owner's land, or an
 * Artifact (a great work of art) from its owner's land or no one's, with an empty slot to hold it.
 */
export function canDig(game: Game, u: Unit, what: 'landmark' | 'artifact'): boolean {
  const p = game.players[u.owner];
  const tile = game.tiles[u.tile];
  if (!tile.antiquity || cityAt(game, u.tile) || TERRAINS[tile.terrain].water) return false;
  if (tile.hiddenAntiquity && !has(civEffects(game, p), 'reveal_hidden_antiquity')) return false;
  if (what === 'landmark') return tile.owner === u.owner;
  return (tile.owner === u.owner || tile.owner < 0) && freeSlot(game, p, 'art') !== null;
}

export function workTurns(game: Game, what: string): number {
  const base = what === 'road' ? 3 : what === 'rail' ? 4 : what === 'repair' ? 3 : what === 'remove_feature' ? 4 : what === 'scrub_fallout' ? FALLOUT.scrubTurns : what === 'artifact' || what === 'landmark' ? 6 : IMPROVEMENTS[what as ImprovementId]?.turns ?? 5;
  return Math.max(1, Math.round(base * speed(game)));
}

/** How much work a civ's units do a turn: a turn's worth, more with Citizenship, the Pyramids... */
export const workRate = (game: Game, p: Player) => 1 + civEffects(game, p).reduce((s, e) => s + (e.workRate ?? 0), 0) / 100;

/**
 * How many turns a unit's work has left at its civ's pace, and how far along it is. This turn counts
 * only if it still has a move at the turn's end (work isn't done with none: one that walked there
 * and used them up starts next turn).
 */
export function workLeft(game: Game, u: Unit): { turns: number; progress: number } | undefined {
  if (!u.work) return undefined;
  const total = workTurns(game, u.work.what);
  const turns = Math.max(1, Math.ceil((total - u.work.done) / workRate(game, game.players[u.owner]) - 1e-9));
  return { turns: turns + (u.moves > 0 ? 0 : 1), progress: Math.min(1, u.work.done / total) };
}

/** What an order's field must be: a whole number, a tile of the map, a whole number or nothing, a string, one of some strings (or nothing, null or left out, where null is one), a list of strings, a list (checked where it's used), a yes or no, a production item; `?` when it may be left out. */
type Field = 'int' | 'tile' | 'int|null' | 'string' | 'strings' | 'list' | 'bool' | 'bool?' | 'item' | readonly (string | null)[];

/** The luxuries' ids (a resolution banning one names it). */
const LUXURY_IDS = Object.keys(RESOURCES).filter((r) => RESOURCES[r].kind === 'luxury');

const STANCES = ['fortify', 'sleep', 'alert', 'wake'] as const;
const FOCUSES = ['balanced', 'food', 'prod', 'gold', 'science', 'culture', 'faith'] as const;
const ACTIONS = ['improvement', 'discover', 'hurry', 'trade', 'golden', 'work', 'culture', 'repair', 'concert'] as const;

/** Every order's fields, and what each must be (orders come from screens nobody can trust). */
const SHAPES: { [K in Order['t']]: { [F in Exclude<keyof Extract<Order, { t: K }>, 't'>]-?: Field } } = {
  move: { unit: 'int', to: 'tile' },
  attack: { unit: 'int', target: 'tile' },
  found: { unit: 'int' },
  build: { unit: 'int', what: 'string' },
  pillage: { unit: 'int' },
  paradrop: { unit: 'int', to: 'tile' },
  airlift: { unit: 'int', to: 'tile' },
  rebase: { unit: 'int', to: 'tile' },
  giftUnit: { unit: 'int', target: 'int' },
  stance: { unit: 'int', stance: STANCES },
  skip: { unit: 'int' },
  setup: { unit: 'int' },
  disband: { unit: 'int' },
  upgrade: { unit: 'int' },
  merge: { unit: 'int', other: 'int' },
  promote: { unit: 'int', promotion: 'string' },
  produce: { city: 'int', item: 'item', queue: 'bool?' },
  unqueue: { city: 'int', index: 'int' },
  reorder: { city: 'int', from: 'int', to: 'int' },
  repeat: { city: 'int', on: 'bool' },
  specialist: { city: 'int', kind: ['scientist', 'engineer', 'merchant', 'artist', 'writer', 'musician'], add: 'bool' },
  buy: { city: 'int', item: 'item', with: ['gold', 'faith'] },
  buyTile: { city: 'int', tile: 'tile' },
  focus: { city: 'int', focus: FOCUSES },
  work: { city: 'int', tile: 'tile' },
  cityFire: { city: 'int', target: 'tile' },
  research: { tech: 'string' },
  policy: { id: 'string' },
  ideology: { id: 'string' },
  switchIdeology: { id: 'string' },
  pantheon: { belief: 'string' },
  religion: { unit: 'int', name: 'string', beliefs: 'strings' },
  reformation: { belief: 'string' },
  greatChoice: { kind: CHOOSABLE },
  greatPerson: { unit: 'int', action: ACTIONS },
  cityChoice: { city: 'int', choice: ['annex', 'puppet', 'raze', 'liberate'] },
  pledge: { target: 'int' },
  spread: { unit: 'int' },
  gift: { target: 'int', gold: 'int' },
  tribute: { target: 'int', take: ['gold', 'worker'] },
  coup: { spy: 'int' },
  trade: { unit: 'int', to: 'int', cargo: ['food', 'prod', null] },
  spy: { spy: 'int', target: 'int|null', diplomat: 'bool?' },
  vote: { candidate: 'int' },
  congressPropose: { resolution: RESOLUTION_KINDS, civ: 'int|null', luxury: [...LUXURY_IDS, null], repeal: 'bool?' },
  congressVote: { proposal: 'int', vote: ['yes', 'no', 'abstain'] },
  inquisition: { unit: 'int' },
  war: { target: 'int', why: [...WAR_WHYS, null] },
  peace: { target: 'int' },
  openBorders: { target: 'int' },
  deal: { target: 'int', items: 'list' },
  answer: { offer: 'int', accept: 'bool' },
  denounce: { target: 'int' },
  embargo: { target: 'int', lift: 'bool?' },
  independence: {},
  release: { target: 'int' },
  clan: { clan: 'int', act: ['bribe', 'hire', 'incite'], target: 'int|null' },
  automate: { unit: 'int', mode: ['work', 'explore', null] },
  ready: { ready: 'bool' },
};

/** Whether an order is one the rules know, with every field there and of the right kind (a crafted order with NaN gold once made everything free). */
export function wellFormed(game: Game, o: unknown): o is Order {
  if (!o || typeof o !== 'object') return false;
  const order = o as Record<string, unknown>;
  const shape = typeof order.t === 'string' && Object.hasOwn(SHAPES, order.t) ? (SHAPES as Record<string, Record<string, Field>>)[order.t] : undefined;
  if (!shape) return false;
  return Object.entries(shape).every(([k, f]) => {
    const v = order[k];
    if (Array.isArray(f)) return (typeof v === 'string' || v === null || v === undefined) && f.includes(v ?? null);
    switch (f) {
      case 'int':
        return Number.isSafeInteger(v);
      case 'tile':
        return Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) < game.tiles.length;
      case 'int|null':
        return v === null || Number.isSafeInteger(v);
      case 'string':
        return typeof v === 'string';
      case 'strings':
        return Array.isArray(v) && v.every((x) => typeof x === 'string');
      case 'list':
        return Array.isArray(v);
      case 'bool':
        return typeof v === 'boolean';
      case 'bool?':
        return v === undefined || typeof v === 'boolean';
      case 'item': {
        const item = v as Record<string, unknown> | null;
        return !!item && typeof item === 'object' && ['unit', 'building', 'project', 'process'].includes(item.kind as string) && typeof item.id === 'string';
      }
    }
    return false;
  });
}


/** Whether a city's own buildings have a special (an airport's airlift). */
const buildingsHave = (c: City, special: string) => has(c.buildings.map((b) => BUILDINGS[b]?.effects).filter((e): e is Effects => !!e), special);

/** Gold to upgrade a unit: twice the difference in cost, at speed (at least 10; a third less with Professional Army or the Pentagon), for each unit of a corps or army. */
export function upgradeCost(game: Game, p: Player, u: Unit): number {
  const to = upgradeTo(p, u);
  if (!to) return Infinity;
  const cheaper = has(civEffects(game, p), 'upgrades_cheaper_33') ? 2 / 3 : 1;
  return Math.max(10, Math.floor((UNITS[to].cost - UNITS[u.type].cost) * 2 * speed(game) * cheaper)) * sizeOf(u);
}

/** What a unit would upgrade to (its civ's own version), if the civ knows how. */
export function upgradeTo(p: Player, u: Unit): string | null {
  const to = UNITS[u.type]?.upgrade && unitFor(p.civ, UNITS[u.type].upgrade!, UNITS);
  return to && UNITS[to]?.tech && knows(p, UNITS[to].tech!) ? to : null;
}

/** Dissent (unhappiness from rival ideologies' pressure) at which a civ's people may overthrow its ideology. */
export const SWITCH_DISSENT = 4;
/** Turns of anarchy a revolution brings (Civ V's two). */
export const ANARCHY_TURNS = 2;

/**
 * The ideology a civ may switch to now (Civ V's revolution), if any: the one its people lean to
 * (`preferredIdeology`), once that dissent reaches `SWITCH_DISSENT` and it isn't in anarchy already.
 */
export function ideologySwitch(game: Game, p: Player): string | null {
  if (!p.ideology || p.anarchy || dissent(game, p) < SWITCH_DISSENT) return null;
  return preferredIdeology(game, p);
}

/**
 * A revolution: the civ takes the ideology its people lean to. Its tenets are lost, two fewer of
 * the new ideology's are free to take (without culture), and it suffers `ANARCHY_TURNS` of anarchy.
 */
function revolution(game: Game, p: Player, to: string) {
  const old = p.ideology;
  const tenets = p.policies.filter((x) => ALL_POLICIES[x]?.tree === old);
  p.policies = p.policies.filter((x) => !tenets.includes(x));
  for (const x of tenets) delete p.policyTurns?.[x];
  p.ideology = to;
  p.freeTenets = Math.max(0, tenets.length - 2);
  p.anarchy = ANARCHY_TURNS;
  const name = IDEOLOGIES.find((i) => i.id === to)!.name;
  note(game, p.index, { text: `Revolution: you follow ${name} now. ${ANARCHY_TURNS} turns of anarchy${p.freeTenets ? `, then ${p.freeTenets} of its tenets free to take` : ''}.`, kind: 'info' });
  noteAll(game, (r) => (r !== p && knowsOf(r, p) ? { text: `Revolution in ${civOf(p).adjective} lands: ${p.name} follows ${name} now.`, kind: 'info' } : null));
}

/** Whether a civ can choose its ideology now (Civ V's: in the Modern Era, or the Industrial with three Factories). */
export function canChooseIdeology(game: Game, p: Player): boolean {
  if (p.ideology || p.cityState || p.civ === 'barbarian') return false;
  const era = eraOf(p);
  return era >= 5 || (era >= 4 && citiesOf(game, p.index).filter((c) => c.buildings.some((b) => isBuilding(b, 'factory'))).length >= 3);
}

/** Whether a civ has a Reformation belief to choose (it adopted Reformation, founded a religion, and hasn't one yet). */
export function reformationDue(game: Game, p: Player): boolean {
  const rel = p.religion ? game.religions[p.religion] : undefined;
  if (!rel || rel.founder !== p.index || !has(civEffects(game, p), 'reformation_belief')) return false;
  if (rel.beliefs.some((b) => BELIEFS[b]?.kind === 'reformation')) return false;
  const taken = takenBeliefs(game);
  return BELIEF_LIST.some((b) => b.kind === 'reformation' && !taken.has(b.id));
}

/** Whether a gold purchase is open to a civ in a city: what it could build, or a Landsknecht with Mercenary Army (in its era). */
export function buyable(game: Game, p: Player, c: City, item: Production): boolean {
  if (item.kind === 'project') return false;
  if (canProduce(game, p, c, item)) return true;
  const lk = UNITS.landsknecht;
  return item.kind === 'unit' && item.id === lk.id && has(civEffects(game, p), 'buy_landsknechts') && knows(p, lk.tech!) && !knows(p, lk.obsolete!);
}

/**
 * What a city can buy with faith now: missionaries and inquisitors (where its owner's religion has
 * a foothold: followers, or its holy city), its religion's buildings, Libraries, Universities and
 * Public Schools (Jesuit Education), a Great Prophet (Piety finished), great people (To the Glory
 * of God, from the Industrial Era), land units (Holy Warriors, where the religion has a foothold).
 */
export function faithPurchases(game: Game, p: Player, c: City): Production[] {
  const civ = civEffects(game, p);
  const ours = canBuyReligious(game, p, c);
  const out: Production[] = [];
  if (ours) for (const id of ['missionary', 'inquisitor']) out.push({ kind: 'unit', id });
  for (const id of faithBuildings(game, c)) out.push({ kind: 'building', id });
  if (has(civ, 'buy_science_buildings')) for (const id of constructible(game, p, c)) if (['library', 'university', 'public_school'].some((x) => isBuilding(id, x))) out.push({ kind: 'building', id });
  if (has(civ, 'buy_prophets')) out.push({ kind: 'unit', id: GREAT_UNIT.prophet });
  // From the Industrial Era: the great people a finished policy tree (or To the Glory of God) lets faith buy.
  const greats = new Set(civ.flatMap((e) => e.faithGreatPeople ?? []));
  if (eraOf(p) >= ERAS.indexOf('industrial')) for (const k of CHOOSABLE) if (greats.has(k)) out.push({ kind: 'unit', id: GREAT_UNIT[k] });
  if (ours && has(civ, 'buy_military_faith')) for (const id of trainable(game, p, c)) if (isMilitary(UNITS[id]) && UNITS[id].domain === 'land') out.push({ kind: 'unit', id });
  return out;
}

/** Told of each fight as it's fought, and who ordered it (a person, a bot): the server shows it on every screen that sees it. */
export const fightHooks: { fought: (game: Game, by: number, combat: CombatResult[]) => void } = { fought: () => {} };

/** Apply a player's order, if it's allowed. */
export function apply(game: Game, by: number, o: Order): Outcome {
  const out = applyOrder(game, by, o);
  if (out.combat?.length) fightHooks.fought(game, by, out.combat);
  // (A person's deeds are boosts at once; a bot's, as its turn ends.)
  if (out.ok && game.players[by] && !game.players[by].bot) checkEurekas(game, game.players[by]);
  // (Whatever it did to their research is their team's: a choice, a great scientist's science, a tech from a ruin.)
  if (out.ok) shareResearch(game);
  return out;
}

/** What a puppet takes no orders for (Civ V's): what it builds, and anything bought there. */
const PUPPET_REFUSES = new Set<Order['t']>(['produce', 'unqueue', 'reorder', 'repeat', 'buy', 'buyTile']);

function applyOrder(game: Game, by: number, o: Order): Outcome {
  if (game.over) return fail('The game is over');
  if (!wellFormed(game, o)) return fail('That order makes no sense');
  const p = game.players[by];
  if (!p?.alive) return fail('Your civilization is out of the game');
  const wait = waitsFor(game, by, o);
  if (wait) return fail(wait);
  const unit = 'unit' in o ? unitById(game, o.unit) : undefined;
  if ('unit' in o && (!unit || unit.owner !== by)) return fail("That unit is gone, or isn't yours");
  const city = 'city' in o ? cityById(game, o.city) : undefined;
  if ('city' in o && (!city || city.owner !== by)) return fail("That city is gone, or isn't yours");
  if (city?.puppet && PUPPET_REFUSES.has(o.t)) return fail(`${city.name} is a puppet: it chooses its own builds (annex it to give it orders)`);
  const u = unit!;
  // A person's order to an automated unit takes it back (the automation's own orders don't).
  if (unit && o.t !== 'automate' && !automation.running) unit.auto = undefined;
  const c = city!;
  switch (o.t) {
    case 'move': {
      if (isAircraft(u)) return fail('Aircraft rebase to your cities and carriers, and strike what is in range');
      if (u.moves <= 0 && u.tile !== o.to) {
        // Plan for next turn.
        u.path = undefined;
      }
      if (!canEnter(game, u, o.to) && canEnter(game, u, o.to, true)) {
        // Next to it: the two swap places (Civ V's). (A person's: the bots plan round their own units.)
        const other = p.bot ? null : swapWith(game, u, o.to);
        if (!other) return fail('One of your units is there (one soldier and one civilian to a tile)');
        swap(game, u, other);
        return OK;
      }
      // (A civilian sent at an enemy would only stop next to it.)
      const foe = cityAt(game, o.to) ?? occupants(game, o.to).military ?? occupants(game, o.to).civilian;
      if ((!isMilitary(UNITS[u.type]) || isGreatPerson(u.type)) && foe && atWar(game, by, foe.owner)) return fail(`${aUnit(u.type)} can't go where an enemy is`);
      const owner = game.players[game.tiles[o.to].owner];
      if (owner && owner !== p && !owner.cityState && !atWar(game, by, owner.index) && !owner.diplomacy.openBorders[by] && isMilitary(UNITS[u.type]) && !isGreatPerson(u.type)) return fail(`${owner.name}'s borders are closed to you (open borders come by a deal)`);
      // (A settler sent to a city site: it's told if the site's lost on the way.)
      u.site = UNITS[u.type].abilities?.includes('found_city') && canFound(game, o.to) ? o.to : undefined;
      if (moveTo(game, u, o.to)) return OK;
      return fail(planPath(game, u, o.to, true) ? 'Your own units are in the way: it would have to stop on one' : noWay(game, u, o.to));
    }
    case 'attack': {
      const type = UNITS[u.type];
      if (type.abilities?.includes('nuke')) {
        const r = nuke(game, u, o.target);
        updateAllVisibility(game);
        return r ? { ok: true, combat: [r] } : fail('It strikes only within its range, where everyone it would hit is someone you are at war with');
      }
      if (!isMilitary(type) || type.abilities?.includes('no_attack')) return fail(`${aUnit(u.type)} can't attack`);
      if (isAircraft(u)) {
        if (u.moves <= 0 || u.attacked) return fail('It has flown this turn already (a strike or a rebase takes its move)');
        const r = airStrike(game, u, o.target);
        return r ? { ok: true, combat: [r] } : fail(`Nothing it can strike there: an enemy it can see, within ${rangeOf(u)} tiles`);
      }
      const attacks = 1 + fromPromotions(u, 'attacks');
      if ((u.attacks ?? 0) >= attacks) return fail('It has attacked this turn already');
      if (u.moves <= 0 && !(attacks > 1 && type.ranged && (u.attacks ?? 0) > 0)) return fail('It has no moves left this turn');
      // A siege unit not set up sets up first (a move), Civ V's way, if that leaves it a move to fire with.
      const before = { setUp: u.setUp, moves: u.moves };
      if (type.abilities?.includes('must_setup') && !u.setUp) {
        if (u.moves < 2) return fail('It needs a move to set up and one to fire: set it up now, and it fires next turn');
        u.setUp = true;
        u.moves -= 1;
      }
      // Units with a ranged attack always fire; the rest fight hand to hand. (An attack that doesn't happen doesn't count.)
      const result = type.ranged ? ranged(game, u, o.target) : melee(game, u, o.target);
      if (!result) {
        // (Nor does the setting up for it.)
        u.setUp = before.setUp;
        u.moves = before.moves;
        return fail(attackWhy(game, u, o.target));
      }
      u.attacks = (u.attacks ?? 0) + 1;
      // (A city taken or a carrier sunk loses the aircraft there.)
      strandedAircraft(game);
      return { ok: true, combat: [result] };
    }
    case 'rebase': {
      if (!isAircraft(u)) return fail('Only aircraft rebase');
      const why = rebase(game, u, o.to);
      if (why) return fail(why);
      updateVisibility(game, p);
      return OK;
    }
    case 'found': {
      if (!UNITS[u.type].abilities?.includes('found_city')) return fail('Only a Settler founds cities');
      if (!canFound(game, u.tile)) {
        const near = game.cities.find((c) => distance(game.grid, c.tile, u.tile) < 3);
        return fail(near ? `Too close to ${near.name}: a city needs two tiles between it and the next` : 'No city can stand here (water, mountain, ice or a natural wonder)');
      }
      foundCity(game, by, u.tile);
      removeUnit(game, u);
      return OK;
    }
    case 'build': {
      if (!canBuild(game, u, o.what)) return fail(buildWhy(game, u, o.what));
      // (Told again what it's already at: it carries on, keeping what it's done.)
      if (u.work?.what === o.what) return OK;
      u.work = { what: o.what, done: 0 };
      u.path = undefined;
      if (SEA_WORK.includes(o.what)) {
        game.tiles[u.tile].improvement = o.what as ImprovementId;
        game.tiles[u.tile].pillaged = false;
        removeUnit(game, u);
        for (const c of citiesOf(game, u.owner)) assignCitizens(game, c);
      }
      return OK;
    }
    case 'pillage': {
      if (!canPillage(game, u)) return fail("Nothing to pillage here (an improvement or road of someone you're at war with, or in no one's land)");
      pillage(game, u, eraOf(p));
      const owner = game.tiles[u.tile].city;
      const victim = owner !== undefined ? cityById(game, owner) : undefined;
      if (victim) assignCitizens(game, victim);
      return OK;
    }
    case 'paradrop': {
      if (!UNITS[u.type].abilities?.includes('paradrop')) return fail('Only paratroopers drop from the air');
      if (moved(game, u)) return fail("It can't have moved or fought this turn");
      if (game.tiles[u.tile].owner !== by || u.embarked) return fail('It must start in your own land');
      if (distance(game.grid, u.tile, o.to) > PARADROP_RANGE || !p.explored[o.to] || TERRAINS[game.tiles[o.to].terrain].water || game.units.some((x) => x.tile === o.to) || !canEnter(game, u, o.to)) return fail(`Drop it on empty land you know, within ${PARADROP_RANGE} tiles`);
      u.tile = o.to;
      u.moves = 0;
      u.path = undefined;
      u.stance = undefined;
      u.fortified = 0;
      // What it lands on: ancient ruins, a barbarian camp.
      if (game.tiles[o.to].ruin) ruinHooks.onRuin(game, u);
      if (game.tiles[o.to].camp) campHooks.onCamp(game, u);
      updateVisibility(game, p);
      return OK;
    }
    case 'airlift': {
      const from = cityAt(game, u.tile);
      const to = cityAt(game, o.to);
      if (!from || !to || from === to || from.owner !== by || to.owner !== by || !buildingsHave(from, 'airlift') || !buildingsHave(to, 'airlift')) return fail('Fly it from one of your cities with an airport to another');
      if (UNITS[u.type].domain !== 'land') return fail('Only land units are airlifted');
      if (moved(game, u)) return fail("It can't have moved or fought this turn");
      if (!canEnter(game, u, o.to)) return fail('No room for it there');
      u.tile = o.to;
      u.moves = 0;
      u.path = undefined;
      updateVisibility(game, p);
      return OK;
    }
    case 'giftUnit': {
      const why = giftUnit(game, p, u, o.target);
      updateAllVisibility(game);
      return why ? fail(why) : OK;
    }
    case 'stance':
      if (o.stance === 'fortify' && !canFortify(UNITS[u.type])) return fail("Mounted units, armour and ships can't fortify (sleep instead)");
      if (o.stance === 'fortify' && u.embarked) return fail("A unit at sea in a boat can't fortify (sleep instead)");
      u.stance = o.stance === 'wake' ? undefined : o.stance;
      if (o.stance === 'fortify') u.fortified = 0;
      u.path = undefined;
      return OK;
    case 'skip':
      u.skip = true;
      return OK;
    case 'setup':
      if (!UNITS[u.type].abilities?.includes('must_setup')) return fail('Only siege units set up');
      if (u.moves <= 0) return fail('It has no moves left to set up with');
      u.setUp = true;
      u.moves = Math.max(0, u.moves - 1);
      return OK;
    case 'disband':
      removeUnit(game, u);
      updateVisibility(game, p);
      return OK;
    case 'upgrade': {
      const to = upgradeTo(p, u);
      if (!to) return fail('Nothing to upgrade to yet');
      if (u.moves <= 0) return fail('It needs a move left to upgrade');
      if (game.tiles[u.tile].owner !== by) return fail('Units upgrade only in your own land');
      const need = UNITS[to].resource;
      if (need && need !== UNITS[u.type].resource) {
        const r = strategic(game, p)[need];
        if (!r || r.have - r.used < sizeOf(u)) return fail(`Upgrading needs ${sizeOf(u) > 1 ? `${sizeOf(u)} ` : ''}${RESOURCES[need].name}`);
      }
      const cost = upgradeCost(game, p, u);
      if (p.gold < cost) return fail(`Upgrading costs ${cost} gold (you have ${Math.floor(p.gold)})`);
      p.gold -= cost;
      u.type = to;
      u.moves = 0;
      return OK;
    }
    case 'merge': {
      const other = unitById(game, o.other);
      const why = mergeProblem(game, p, u, other);
      if (why) return fail(why);
      merge(game, u, other!);
      updateVisibility(game, p);
      return OK;
    }
    case 'promote': {
      if (promotionsDue(u) <= 0) return fail('Not enough experience yet');
      if (!promotionsFor(u).some((x) => x.id === o.promotion)) return fail("That promotion isn't open to it");
      u.promotions.push(o.promotion);
      // Taking one heals a little.
      u.hp = Math.min(100, u.hp + 15);
      return OK;
    }
    case 'cityChoice': {
      if (o.choice === 'liberate') {
        const why = liberate(game, c);
        return why ? fail(why) : OK;
      }
      if (!c.puppet && !c.occupied && o.choice !== 'raze') return fail('Nothing to decide');
      if (o.choice === 'raze') {
        if (c.founder === by) return fail('Only a city taken from someone else can be razed');
        if (game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c) return fail("An original capital can't be razed");
        c.razing = c.pop;
        c.puppet = undefined;
        return OK;
      }
      // (Annexing is for good, as in Civ V: an annexed city isn't made a puppet again to shed its unhappiness.)
      if (o.choice === 'puppet' && !c.puppet) return fail(`${c.name} has been annexed: that can't be undone`);
      c.puppet = o.choice === 'puppet' || undefined;
      c.occupied = o.choice === 'annex' ? true : c.occupied;
      c.razing = undefined;
      if (c.puppet && !c.queue.length) c.queue = [defaultBuild(game, p, c)];
      return OK;
    }
    case 'produce': {
      if (!canProduce(game, p, c, o.item)) return fail(`${c.name} can't build that now`);
      if (o.queue) {
        if (c.queue.length >= 6) return fail('The queue is full (six at most)');
        c.queue.push({ kind: o.item.kind, id: o.item.id });
      } else {
        // Switching: keep what was put in (Civ V keeps production toward each thing), and take back
        // what was kept toward the new one (once: it's spent from the store, not copied).
        switchTo(c, o.item);
        c.queue = [{ kind: o.item.kind, id: o.item.id }, ...c.queue.slice(1)];
      }
      return OK;
    }
    case 'unqueue': {
      if (o.index < 0 || o.index >= c.queue.length) return fail('Nothing is at that place in the queue');
      if (o.index === 0) {
        const next = c.queue[1];
        if (next) switchTo(c, next);
        else stash(c);
      }
      c.queue.splice(o.index, 1);
      return OK;
    }
    case 'reorder': {
      const n = c.queue.length;
      if (o.from < 0 || o.from >= n || o.to < 0 || o.to >= n) return fail('Nothing is at that place in the queue');
      const queue = [...c.queue];
      queue.splice(o.to, 0, ...queue.splice(o.from, 1));
      // A new first item: what was put into the old one is kept, as when switching.
      if (queue[0] !== c.queue[0]) switchTo(c, queue[0]);
      c.queue = queue;
      return OK;
    }
    case 'buy': {
      // (Civ V's: a city in resistance buys nothing, with gold or faith.)
      if (c.resistance) return fail(`${c.name} is in resistance (${c.resistance} turn${c.resistance === 1 ? '' : 's'} more): nothing can be bought there yet`);
      if (o.with === 'faith') {
        const id = o.item.id;
        if (!faithPurchases(game, p, c).some((x) => x.kind === o.item.kind && x.id === id)) return fail("That can't be bought with faith here (missionaries and the like only where your religion is the city's)");
        const great = (Object.keys(GREAT_UNIT) as GreatKind[]).find((k) => GREAT_UNIT[k] === id);
        const military = o.item.kind === 'unit' && isMilitary(UNITS[id]);
        if ((military && placeFor(game, c, id) === undefined) || (great && greatPlace(game, p, great, c.tile) === undefined)) return fail('No room for it in or by the city: move a unit out first');
        const cost = faithCost(game, id, p);
        if (p.faith < cost) return fail(`It costs ${cost} faith (you have ${Math.floor(p.faith)})`);
        p.faith -= cost;
        if (o.item.kind === 'building') c.buildings.push(id);
        else if (great) {
          greatPersonBorn(game, p, great, c.tile);
          if (great !== 'prophet') p.faithGreat = (p.faithGreat ?? 0) + 1;
        } else if (military) complete(game, c, { kind: 'unit', id });
        else faithUnit(game, p, c, id);
        bought(c, o.item);
        assignCitizens(game, c);
        return OK;
      }
      if (!buyable(game, p, c, o.item)) return fail(o.item.kind === 'project' ? 'Projects are built, not bought' : `${c.name} can't build that now, so can't buy it`);
      const kind = o.item.kind === 'unit' ? 'unit' : BUILDINGS[o.item.id]?.kind === 'world' ? 'wonder' : 'building';
      const cost = purchaseCost(game, p, o.item.kind === 'unit' ? UNITS[o.item.id].cost : BUILDINGS[o.item.id].cost, kind);
      if (p.gold < cost) return fail(`It costs ${cost} gold (you have ${Math.floor(p.gold)})`);
      if (o.item.kind === 'unit' && placeFor(game, c, o.item.id) === undefined) return fail('No room for it in or by the city: move a unit out first');
      p.gold -= cost;
      complete(game, c, { kind: o.item.kind, id: o.item.id });
      bought(c, o.item);
      return OK;
    }
    case 'buyTile': {
      const t = o.tile;
      const tile = game.tiles[t];
      if (tile.owner >= 0 || distance(game.grid, c.tile, t) > 3 || !neighbours(game.grid, t).some((n) => game.tiles[n].city === c.id)) return fail("Only a tile of no one's land, beside the city's and within three tiles of it, can be bought");
      const cost = tileGoldCost(game, c, t);
      if (p.gold < cost) return fail(`It costs ${cost} gold (you have ${Math.floor(p.gold)})`);
      p.gold -= cost;
      c.tilesBought++;
      claim(game, c, t);
      assignCitizens(game, c);
      updateVisibility(game, p);
      return OK;
    }
    case 'focus':
      c.focus = o.focus;
      assignCitizens(game, c);
      return OK;
    case 'repeat':
      c.repeat = o.on || undefined;
      return OK;
    case 'work': {
      if (!workable(game, c).includes(o.tile)) return fail("That tile isn't this city's");
      const locked = new Set(c.locked ?? []);
      if (locked.has(o.tile)) locked.delete(o.tile);
      else {
        if (locked.size + specialistsPlaced(c) >= c.pop) return fail('Every citizen is placed already: take one off a tile or a slot first');
        locked.add(o.tile);
      }
      c.locked = [...locked];
      assignCitizens(game, c);
      return OK;
    }
    case 'specialist': {
      if (!Object.keys(SPECIALIST_YIELD).includes(o.kind)) return fail('No such specialist');
      const slots = specialistSlots(game, c)[o.kind] ?? 0;
      const now = c.specialists[o.kind] ?? 0;
      if (o.add) {
        if (now >= slots) return fail("Its buildings have no free slot for that specialist");
        if ((c.locked ?? []).length + specialistsPlaced(c) >= c.pop) return fail('Every citizen is placed already: take one off a tile or a slot first');
      } else if (now <= 0) return fail('No such specialist here');
      // The ones working now are kept, one more or one fewer.
      c.lockedSpecialists = { ...c.lockedSpecialists, [o.kind]: Math.max(0, Math.min(slots, now + (o.add ? 1 : -1))) };
      assignCitizens(game, c);
      return OK;
    }
    case 'cityFire': {
      const r = cityFire(game, c, o.target);
      return r ? { ok: true, combat: [r] } : fail(c.fired ? `${c.name} has fired this turn` : distance(game.grid, c.tile, o.target) > 2 ? 'Out of range: a city fires up to two tiles away' : 'A city fires only at an enemy unit it can see');
    }
    case 'research': {
      if (!Object.hasOwn(TECHS, o.tech)) return fail('No such tech');
      // (On a team, each chooses their own: what they put in is the team's, `shareResearch`.)
      if (canResearch(new Set(p.techs), o.tech)) {
        p.researching = o.tech;
        p.techQueue = [];
        spendSpare(p);
        return OK;
      }
      // A far tech: queue the way there.
      const known = new Set(p.techs);
      const order: string[] = [];
      const visit = (id: string) => {
        if (known.has(id) || order.includes(id)) return;
        for (const n of TECHS[id].needs) visit(n);
        order.push(id);
      };
      visit(o.tech);
      if (!order.length) return fail('Already known');
      p.researching = order[0];
      p.techQueue = order.slice(1);
      spendSpare(p);
      return OK;
    }
    case 'policy': {
      // (A tenet of an ideology newly taken by revolution may be free.)
      const free = (p.freeTenets ?? 0) > 0 && !!p.ideology && ALL_POLICIES[o.id]?.tree === p.ideology;
      if (!free && p.culture < policyCost(game, p)) return fail(`A policy takes ${policyCost(game, p)} culture (you have ${Math.floor(p.culture)})`);
      if (!adoptable(p, eraOf(p)).some((x) => x.id === o.id)) return fail(p.policies.includes(o.id) ? 'Adopted already' : 'Not open yet: its branch comes with a later era, needs the policies before it, or a rival branch closes it');
      if (free) p.freeTenets!--;
      else p.culture -= policyCost(game, p);
      adoptPolicy(game, p, o.id);
      return OK;
    }
    case 'switchIdeology': {
      const to = ideologySwitch(game, p);
      if (!to || to !== o.id) return fail(to ? `Your people lean to ${IDEOLOGIES.find((i) => i.id === to)!.name}, not that` : `A revolution needs your people's dissent from a rival ideology to reach ${SWITCH_DISSENT} (it's ${dissent(game, p)})`);
      revolution(game, p, to);
      return OK;
    }
    case 'ideology': {
      if (!IDEOLOGIES.some((i) => i.id === o.id) || !canChooseIdeology(game, p)) return fail("Can't choose an ideology now (the Modern Era, or the Industrial with three Factories)");
      p.ideology = o.id;
      noteAll(game, (r) => (r !== p && knowsOf(r, p) ? { text: `${p.name} has chosen ${IDEOLOGIES.find((i) => i.id === o.id)!.name}.`, kind: 'info' } : null));
      return OK;
    }
    case 'pantheon': {
      if (p.pantheon) return fail('You have a pantheon already');
      if (p.faith < pantheonCost(game)) return fail(`A pantheon takes ${pantheonCost(game)} faith (you have ${Math.floor(p.faith)})`);
      if (BELIEFS[o.belief]?.kind !== 'pantheon' || takenBeliefs(game).has(o.belief)) return fail('Another civilization has taken that belief');
      p.faith -= pantheonCost(game);
      p.pantheon = o.belief;
      noteAll(game, (r) => (r !== p && knowsOf(r, p) ? { text: `${p.name} has founded a pantheon: ${BELIEFS[o.belief].name}.`, kind: 'religion', topic: 'religion' } : null));
      return OK;
    }
    case 'religion': {
      if (!UNITS[u.type].abilities?.includes('found_religion')) return fail('Only a Great Prophet');
      const why = foundReligion(game, p, u, o.name, o.beliefs);
      return why ? fail(why) : OK;
    }
    case 'reformation': {
      if (!reformationDue(game, p)) return fail('No Reformation belief to choose now');
      if (BELIEFS[o.belief]?.kind !== 'reformation' || takenBeliefs(game).has(o.belief)) return fail('Another religion has taken that belief');
      reform(game, p, o.belief);
      return OK;
    }
    case 'greatChoice': {
      if (!p.greatChoices) return fail('No free great person to choose');
      if (!greatPersonBorn(game, p, o.kind)) return fail('No room for one by your cities now');
      p.greatChoices--;
      return OK;
    }
    case 'spread': {
      if (!UNITS[u.type].abilities?.includes('spread_religion')) return fail('Only missionaries and prophets spread a religion');
      const why = spread(game, p, u);
      return why ? fail(why) : OK;
    }
    case 'trade': {
      const why = startRoute(game, p, u, o.to, o.cargo ?? 'food');
      return why ? fail(why) : OK;
    }
    case 'spy': {
      const spy = spiesOf(p).find((s) => s.id === o.spy);
      if (!spy) return fail('No such spy');
      const where = o.target === null ? null : cityById(game, o.target);
      if (o.target !== null && !where) return fail('No such city');
      if (where && !p.explored[where.tile]) return fail("You don't know where that is");
      const why = o.diplomat && where ? cannotSendDiplomat(game, p, where) : o.diplomat ? 'Send a diplomat to a city' : null;
      if (why) return fail(why);
      spy.city = o.target;
      spy.progress = 0;
      // (Sent somewhere this turn: no coup there until it has settled in, next turn.)
      spy.arrived = game.turn;
      spy.diplomat = o.diplomat || undefined;
      spy.told = undefined;
      spy.watch = where && !o.diplomat && where.owner !== by && !game.players[where.owner].cityState ? surveillanceTurns(game) : undefined;
      return OK;
    }
    case 'congressPropose': {
      const why = proposeResolution(game, p, { kind: o.resolution, ...(o.civ !== null ? { civ: o.civ } : {}), ...(o.luxury !== null ? { luxury: o.luxury } : {}), ...(o.repeal ? { repeal: true } : {}) });
      return why ? fail(why) : OK;
    }
    case 'congressVote': {
      const why = voteOnResolution(game, p, o.proposal, o.vote);
      return why ? fail(why) : OK;
    }
    case 'vote': {
      const candidate = game.players[o.candidate];
      if (!candidate?.alive || candidate.cityState || candidate.civ === 'barbarian') return fail('Not a candidate');
      p.vote = o.candidate;
      return OK;
    }
    case 'gift': {
      const why = gift(game, p, o.target, o.gold);
      return why ? fail(why) : OK;
    }
    case 'coup': {
      const why = coup(game, p, o.spy);
      return why ? fail(why) : OK;
    }
    case 'tribute': {
      const why = tribute(game, p, o.target, o.take, (type, owner, at) => spawnNear(game, type, owner, at));
      return why ? fail(why) : OK;
    }
    case 'pledge': {
      const why = pledge(game, p, o.target);
      return why ? fail(why) : OK;
    }
    case 'inquisition': {
      if (!UNITS[u.type].abilities?.includes('remove_heresy')) return fail('Only an inquisitor');
      const why = inquisition(game, p, u);
      return why ? fail(why) : OK;
    }
    case 'greatPerson':
      return greatAction(game, p, u, o.action);
    case 'war': {
      const t = game.players[o.target];
      if (!t?.alive || o.target === by || atWar(game, by, o.target)) return fail('Already at war');
      if (teammates(game, by, o.target)) return fail('They are on your team');
      // (A vassal's wars are its master's to make; and a master's side doesn't fight its own vassals: `vassals.ts`.)
      const lord = masterOf(game, by);
      if (lord) return fail(lord.index === o.target ? `You serve ${lord.name}: declare your independence first` : `You serve ${lord.name}, who makes your wars`);
      if (sameSide(game, by, o.target)) return fail(masterOf(game, o.target)?.index === by ? `${t.name} is your vassal: set it free first` : `${t.name} is on your side`);
      // A team (with its vassals) goes to war together: each of one side's civs with each of the other's (`teams.ts`).
      const pairs = sides(game, by, o.target).filter(([a, b]) => !atWar(game, a, b));
      const treaty = Math.max(0, ...pairs.map(([a, b]) => game.players[a].diplomacy.peaceTurns[b] ?? 0));
      if (treaty > 0) return fail(`A peace treaty holds for ${treaty} more turn${treaty === 1 ? '' : 's'}`);
      for (const [a, b] of pairs) {
        const x = game.players[a];
        const y = game.players[b];
        x.diplomacy.war[b] = y.diplomacy.war[a] = true;
        x.diplomacy.openBorders[b] = y.diplomacy.openBorders[a] = 0;
        // War ends any research agreement between them (the gold is lost).
        x.diplomacy.research[b] = y.diplomacy.research[a] = 0;
        clearOffers(x, b);
        clearOffers(y, a);
        // War on a city-state: its friendship is lost (Civ V's -60 influence), and any alliance with it; its protectors are offended, and the attacker's own pledge broken (`pledges.ts`).
        if (y.cityState) pledgeOffended(game, a, b);
        if (y.cityState) x.influence[b] = Math.min(x.influence[b] ?? 0, CS_WAR_INFLUENCE);
      }
      noteAll(game, (r) =>
        r === p
          ? null
          : r === t
            ? { text: `${p.name} has declared war on you!${o.why ? ` “${warWords(game, o.why, by, o.target)}.”` : ''}`, kind: 'war' }
            : teammates(game, r.index, by) || teammates(game, r.index, o.target)
              ? { text: `${p.name} has declared war on ${t.name}: your team is at war with ${teammates(game, r.index, by) ? 'them' : 'theirs'}.`, kind: 'war' }
              : sameSide(game, r.index, by) || sameSide(game, r.index, o.target)
                ? { text: `${p.name} has declared war on ${t.name}: you stand with ${sameSide(game, r.index, by) ? p.name : t.name}, at war with ${sameSide(game, r.index, by) ? t.name : p.name} too.`, kind: 'war' }
              : knowsOf(r, p) || knowsOf(r, t)
                ? { text: `${nameTo(r, p, true)} has declared war on ${nameTo(r, t)}!`, kind: 'war', topic: 'wars' }
                : null,
      );
      for (const [a, b] of pairs) warDeclared(game, a, b);
      // (A war between people: from now they take their turns one side at a time.)
      warBegun(game, by);
      return OK;
    }
    case 'peace': {
      const t = game.players[o.target];
      if (!t || !atWar(game, by, o.target)) return fail('Not at war');
      if (t.civ === 'barbarian') return fail('The barbarians make no peace');
      // (A vassal's peace is its master's, where its master is at war too: `vassals.ts`.)
      const lord = masterOf(game, by);
      if (lord && atWar(game, lord.index, o.target)) return fail(`You serve ${lord.name}, who makes your peace`);
      const served = masterOf(game, o.target);
      if (served && atWar(game, served.index, by)) return fail(`${t.name} serves ${served.name}: make peace with ${served.name}`);
      // A bot weighs an offer once a turn; a person gets it, and it takes effect when both have offered.
      const mine = ((p as Player & { peaceOffer?: number[] }).peaceOffer ??= []);
      const theirs = (t as Player & { peaceOffer?: number[] }).peaceOffer ?? [];
      const asked = (t as Player & { peaceAsked?: Record<number, number> }).peaceAsked ?? {};
      if (t.bot && asked[by] === game.turn) return fail(`${t.name} has given an answer this turn`);
      if (t.bot) (t as Player & { peaceAsked?: Record<number, number> }).peaceAsked = { ...asked, [by]: game.turn };
      if (!mine.includes(o.target)) mine.push(o.target);
      if (t.bot ? game.turn > 10 && botHooks.acceptsPeace(game, t, p) : theirs.includes(by)) {
        endWar(game, p, t);
        return OK;
      }
      if (t.bot) return fail(`${t.name} refuses peace for now: ask again in a turn or two`);
      note(game, o.target, { text: `${p.name} offers peace (Diplomacy).`, kind: 'war' });
      return { ok: true, error: 'Offered' };
    }
    case 'openBorders': {
      const t = game.players[o.target];
      if (!t?.alive || o.target === by) return fail('No one to open borders to');
      if (!knows(p, 'writing')) return fail('Open borders come with Writing');
      if (atWar(game, by, o.target)) return fail("Not while you're at war");
      p.diplomacy.openBorders[o.target] = 30;
      return OK;
    }
    case 'deal': {
      const r = propose(game, { from: by, to: o.target, items: o.items });
      return { ok: r.ok, error: r.text };
    }
    case 'answer': {
      const why = answer(game, p, o.offer, o.accept === true);
      return why ? fail(why) : OK;
    }
    case 'denounce': {
      const why = denounce(game, p, game.players[o.target]);
      return why ? fail(why) : OK;
    }
    case 'embargo': {
      const them = game.players[o.target];
      const why = o.lift ? liftEmbargo(game, p, them) : them ? declareEmbargo(game, p, them) : 'Not a civ to embargo';
      return why ? fail(why) : OK;
    }
    case 'independence': {
      const why = breakFree(game, p);
      return why ? fail(why) : OK;
    }
    case 'release': {
      const why = release(game, p, game.players[o.target]);
      return why ? fail(why) : OK;
    }
    case 'clan': {
      const clan = clanById(game, o.clan);
      if (!clan) return fail('That clan is no more');
      const why = clanProblem(game, p, clan, o.act, o.target);
      if (why) return fail(why);
      note(game, p.index, { text: dealWithClan(game, p, clan, o.act, o.target), at: clan.tile, kind: 'good' });
      return OK;
    }
    case 'automate': {
      const type = UNITS[u.type];
      if (o.mode === 'work' && !type.abilities?.includes('build') && !type.abilities?.includes('build_sea')) return fail('Only workers improve the land by themselves');
      if (o.mode === 'explore' && (!isMilitary(type) || isGreatPerson(u.type) || (type.domain !== 'land' && type.domain !== 'sea'))) return fail('Only soldiers and warships explore by themselves');
      if (o.mode !== null && o.mode !== 'work' && o.mode !== 'explore') return fail('That order makes no sense');
      u.auto = o.mode ?? undefined;
      if (u.auto) {
        u.path = undefined;
        u.stance = undefined;
        botHooks.automate(game, p, [u]);
      }
      return OK;
    }
    case 'ready':
      p.ready = o.ready;
      return OK;
  }
}

/** Citizens a city has placed as specialists by hand. */
const specialistsPlaced = (c: City) => Object.values(c.lockedSpecialists ?? {}).reduce((s, n) => s + (n ?? 0), 0);

export function canProduce(game: Game, p: Player, c: City, item: Production): boolean {
  if (item.kind === 'unit') return trainable(game, p, c).includes(item.id);
  if (item.kind === 'building') return Object.hasOwn(BUILDINGS, item.id) && canConstruct(game, p, c, BUILDINGS[item.id]);
  if (item.kind === 'project') return isProject(item.id) ? canContribute(game, p, c, item.id) : partsBuildable(game, p).includes(item.id) || c.queue[0]?.id === item.id;
  return false;
}

/**
 * Where a city's new unit would stand: the city, else ground (or water, for ships) next to it that's
 * free, else such a tile two away in its owner's land or no one's (a city ringed with its own
 * workers and generals still sends its units out).
 */
export function placeFor(game: Game, c: City, type: string): number | undefined {
  const probe = (t: number): Unit => ({ id: -1, type, owner: c.owner, tile: t, moves: 0, hp: 100, xp: 0, promotions: [] });
  if (canEnter(game, probe(c.tile), c.tile)) return c.tile;
  const free = (t: number) => canStand(game, type, t) && canEnter(game, probe(t), t);
  const ring = neighbours(game.grid, c.tile);
  // (Two out, only by ground it could stand on: not across a lake from the city.)
  const beyond = (t: number) => distance(game.grid, c.tile, t) === 2 && [c.owner, -1].includes(game.tiles[t].owner) && neighbours(game.grid, t).some((n) => ring.includes(n) && canStand(game, type, n));
  return ring.find(free) ?? within(game.grid, c.tile, 2).find((t) => beyond(t) && free(t));
}

/**
 * Production toward the item being built is kept for it (switching away); the city starts on `item`
 * with what it had kept toward that. With nothing being built, what's left over from the last thing
 * finished goes into it too.
 */
function switchTo(c: City, item: Production) {
  const carried = c.queue.length ? 0 : c.prod;
  stash(c);
  const key = `${item.kind}:${item.id}`;
  c.prod = carried + (c.saved?.[key] ?? 0);
  if (c.saved) delete c.saved[key];
}

/**
 * What was just bought isn't built again: out of the queue goes the building (wherever it is in it),
 * or the unit if it's the one being built now (unless the city repeats its units). What had been put
 * into the one being built goes on to the next, with what was kept toward that.
 */
function bought(c: City, item: Production) {
  const was = c.queue[0];
  const same = (q: Production | undefined) => !!q && q.kind === item.kind && q.id === item.id;
  c.queue = c.queue.filter((q, i) => !same(q) || (item.kind !== 'building' && (i > 0 || !!c.repeat)));
  if (item.kind === 'building' && c.saved) delete c.saved[`building:${item.id}`];
  const next = c.queue[0];
  if (same(was) && next && next !== was) {
    const key = `${next.kind}:${next.id}`;
    c.prod += c.saved?.[key] ?? 0;
    if (c.saved) delete c.saved[key];
  }
}

/** Science kept with nothing to research goes into what's chosen. */
function spendSpare(p: Player) {
  if (!p.spareScience || !p.researching) return;
  p.research[p.researching] = (p.research[p.researching] ?? 0) + p.spareScience;
  p.spareScience = undefined;
}

/** Keep the production toward what's being built now (it's being put aside). */
function stash(c: City) {
  const cur = c.queue[0];
  if (cur && c.prod > 0) (c.saved ??= {})[`${cur.kind}:${cur.id}`] = c.prod;
  c.prod = 0;
}

/** No more standing offers of peace between two (they've made it, or gone to war again). */
function clearOffers(p: Player, other: number) {
  const q = p as Player & { peaceOffer?: number[] };
  if (q.peaceOffer) q.peaceOffer = q.peaceOffer.filter((x) => x !== other);
}

/** Something's finished (built, or bought). */
function complete(game: Game, c: City, item: Production) {
  const p = game.players[c.owner];
  if (item.kind === 'project') {
    p.spaceship.push(item.id);
    noteAll(game, (r) => ({ text: r === p ? 'You have built a spaceship part.' : `${nameTo(r, p, true)} has built a spaceship part.`, kind: 'info' }));
    return;
  }
  if (item.kind === 'unit') {
    const type = UNITS[item.id];
    const effects = cityEffects(game, c);
    const fits = (domain: string) => domain === 'all' || domain === type.domain;
    // Experience and promotions from the city's barracks and the rest (military units only).
    const xp = isMilitary(type) ? effects.reduce((s, e) => s + (e.xp ?? []).filter((x) => fits(x.domain)).reduce((a, x) => a + x.xp, 0), 0) : 0;
    const promotions = isMilitary(type) ? effects.flatMap((e) => (e.promotions ?? []).filter((x) => fits(x.domain)).map((x) => x.promotion)) : [];
    const at = placeFor(game, c, item.id);
    if (at === undefined) return; // nowhere to put it (the callers check first)
    spawnUnit(game, item.id, c.owner, at, { xp, promotions: [...new Set(promotions)], moves: 0, embarked: type.domain === 'land' && TERRAINS[game.tiles[at].terrain].water ? true : undefined });
    if (item.id === 'settler') c.pop = Math.max(1, c.pop - 1);
    note(game, c.owner, { text: `${c.name} has trained ${aName(type.name)}.`, at: c.tile, kind: 'city' });
  } else {
    const b = BUILDINGS[item.id];
    c.buildings.push(item.id);
    if (b.kind === 'world') {
      game.wonders[item.id] = c.owner;
      (c.wonders ??= []).push(item.id);
      noteAll(game, (r) => ({ text: r === p ? `You have built the ${b.name} in ${c.name}.` : `${nameTo(r, p, true)} has built the ${b.name}.`, at: r.explored[c.tile] ? c.tile : undefined, kind: 'wonder', topic: r === p ? undefined : 'wonders' }));
      // Anyone else building it loses it (their production stays for something else).
      for (const other of game.cities) if (other !== c && other.queue[0]?.kind === 'building' && other.queue[0].id === item.id) {
        note(game, other.owner, { text: `The ${b.name} has been built elsewhere: ${other.name} stops building it.`, at: other.tile, kind: 'bad' });
        other.queue.shift();
      }
    } else note(game, c.owner, { text: `${c.name} has built ${aName(b.name)}.`, at: c.tile, kind: 'city' });
    applyOnce(game, p, b.effects, c);
    // Korea: a science building or a wonder in the capital is a boost to research (four turns of the capital's science).
    const science = !!(b.effects.yields?.science || b.effects.percent?.science || b.effects.perPop?.science);
    if (c.capital && (science || b.kind === 'world') && has(civEffects(game, p), 'capital_building_science') && p.researching) {
      const boost = Math.max(10, 4 * cityYields(game, c).science);
      p.research[p.researching] = (p.research[p.researching] ?? 0) + boost;
      note(game, c.owner, { text: `The scholars of ${c.name} are inspired: ${boost} science.`, at: c.tile, kind: 'tech' });
    }
  }
  assignCitizens(game, c);
}

// -------------------------------------------------------------------------------------------------
// The turn's end
// -------------------------------------------------------------------------------------------------

/** Everyone's done (or the timer's run out): the world moves on a turn. */
export function endTurn(game: Game) {
  for (const p of game.players) if (p.alive && p.civ !== 'barbarian') playerTurn(game, p);
  shareResearch(game);
  vassalsTurn(game);
  diplomacyTurn(game);
  strandedAircraft(game);
  // Units: fresh moves, healing, work done, paths followed.
  for (const u of [...game.units]) unitTurn(game, u);
  citadelTurn(game);
  falloutTurn(game);
  for (const p of game.players) {
    for (let i = 0; i < game.players.length; i++) {
      if (p.diplomacy.peaceTurns[i] > 0) p.diplomacy.peaceTurns[i]--;
      if (p.diplomacy.openBorders[i] > 0) p.diplomacy.openBorders[i]--;
    }
    p.ready = false;
  }
  expel(game);
  for (const c of game.cities) c.fired = false;
  faithTurn(game);
  cityStateTurn(game);
  longGameTurn(game, eraOf, allyOf);
  congressTurn(game, eraOf);
  barbarianTurn(game);
  raze(game);
  // The world's own turn: its disasters and its climate (what they did kept for the screens to show).
  const events = [...disasterTurn(game), ...climateTurn(game)];
  if (events.length) game.events = events;
  else delete game.events;
  // (Science and techs the turn brought after the civs' own turns, a research agreement's or a spy's, shared again.)
  shareResearch(game);
  game.turn++;
  recordStats(game);
  updateAllVisibility(game);
  checkVictory(game);
  recordReplay(game, game.turn - 1, eraOf);
  // (People at war with each other: the order they take this turn in.)
  startSequence(game);
}

/**
 * Soldiers standing in land that's closed to them (borders grown over them, open borders ended) are
 * moved out, Civ V's way, to the nearest tile they may stand on (dry land first): else, unable to
 * step anywhere in that land, they'd be stuck there for good.
 */
function expel(game: Game) {
  for (const u of game.units) {
    const type = UNITS[u.type];
    if (!type || !isMilitary(type) || isGreatPerson(u.type) || isAircraft(u)) continue;
    const owner = game.tiles[u.tile].owner;
    const them = game.players[owner];
    if (!them || owner === u.owner || them.cityState || atWar(game, u.owner, owner) || them.diplomacy.openBorders[u.owner]) continue;
    const near = within(game.grid, u.tile, 8)
      .filter((t) => t !== u.tile && canEnter(game, u, t))
      .sort((a, b) => distance(game.grid, u.tile, a) - distance(game.grid, u.tile, b) || Number(!!TERRAINS[game.tiles[a].terrain].water) - Number(!!TERRAINS[game.tiles[b].terrain].water))[0];
    if (near === undefined) continue;
    u.tile = near;
    u.path = undefined;
    u.stance = undefined;
    u.fortified = 0;
    u.embarked = type.domain === 'land' && TERRAINS[game.tiles[near].terrain].water ? true : undefined;
    // (A carrier's aircraft go with it.)
    carry(game, u);
  }
}

function playerTurn(game: Game, p: Player) {
  const cities = citiesOf(game, p.index);
  let science = 0;
  let gold = 0;
  let culture = 0;
  let faith = 0;
  // (The empire's mood as the turn ends, for every city's yields.)
  const start = happiness(game, p);
  for (const c of cities) {
    const y = cityYields(game, c, start);
    science += y.science;
    gold += y.gold;
    culture += y.culture;
    faith += y.faith;
    cityTurn(game, c, y);
    for (const [k, v] of Object.entries(y.greatPeople) as [GreatKind, number][]) p.greatPoints[k] = (p.greatPoints[k] ?? 0) + v;
  }
  const civ = civEffects(game, p);
  // Scholasticism: a quarter of allied city-states' science.
  if (has(civ, 'ally_science_25')) for (const cs of cityStates(game)) if (allyOf(game, cs.index) === p.index) science += Math.floor(citiesOf(game, cs.index).reduce((s, c) => s + cityYields(game, c).science, 0) / 4);
  // Anarchy (a revolution): no gold, science, culture or faith for its turns.
  if (p.anarchy) {
    science = gold = culture = faith = 0;
    if (--p.anarchy <= 0) {
      delete p.anarchy;
      note(game, p.index, { text: 'The anarchy is over: your people settle under their new ideology.', kind: 'good' });
    }
  }
  // Gold: income (its trade routes' with it) less upkeep; broke, a unit is disbanded.
  const up = goldUpkeep(game, p);
  const net = gold + routesGold(game, p) - up.buildings - up.units - up.roads;
  p.gold += net;
  if (p.gold < 0) {
    p.gold = 0;
    const military = unitsOf(game, p.index).filter((u) => isMilitary(UNITS[u.type]));
    if (military.length) {
      const u = military[Math.floor(random(game) * military.length)];
      // (A corps or an army loses one of its units.)
      const name = unitName(u);
      if (shrink(u)) note(game, p.index, { text: `Without gold to pay it, a unit of your ${name} has disbanded.`, at: u.tile, kind: 'bad' });
      else {
        removeUnit(game, u);
        note(game, p.index, { text: `Without gold to pay it, your ${name} has disbanded.`, at: u.tile, kind: 'bad' });
      }
    }
  }
  // Science (this turn's deeds boosting it first: what's been built, grown and trained).
  checkEurekas(game, p);
  if (!p.researching) {
    const first = Object.keys(TECHS).filter((t) => canResearch(new Set(p.techs), t)).sort((a, b) => TECHS[a].col - TECHS[b].col);
    if (p.bot && first[0]) p.researching = first[Math.floor(random(game) * Math.min(3, first.length))];
  }
  if (!p.researching && science > 0) p.spareScience = (p.spareScience ?? 0) + science;
  else if (p.researching) {
    p.research[p.researching] = (p.research[p.researching] ?? 0) + science;
    const cost = techCost(game, p, p.researching);
    // (A team's research is finished between them, once all have put theirs in: `shareResearch`.)
    if (teamOf(game, p.index).length < 2 && p.research[p.researching] >= cost) {
      const over = p.research[p.researching] - cost;
      const done = p.researching;
      learn(game, p, done);
      if (p.researching) p.research[p.researching] = (p.research[p.researching] ?? 0) + over;
      else {
        p.spareScience = (p.spareScience ?? 0) + over;
        if (!p.bot) note(game, p.index, { text: 'Choose what to research next.', kind: 'tech', remind: true });
      }
    }
  }
  // Culture and faith.
  p.culture += culture;
  p.lifetimeCulture += culture;
  p.faith += faith;
  if (!p.bot && p.culture >= policyCost(game, p) && adoptable(p, eraOf(p)).length) note(game, p.index, { text: 'You can adopt a social policy.', kind: 'good', remind: true });
  if (!p.bot && !p.pantheon && p.faith >= pantheonCost(game)) note(game, p.index, { text: 'You have the faith for a pantheon.', kind: 'religion', remind: true });
  // Happiness: golden age points, or trouble; with Fine Arts, half of it is culture too.
  const mood = happiness(game, p);
  if (mood > 0 && has(civ, 'happiness_to_culture')) {
    p.culture += Math.floor(mood / 2);
    p.lifetimeCulture += Math.floor(mood / 2);
  }
  if (p.goldenTurns > 0) {
    p.goldenTurns--;
    if (!p.goldenTurns) note(game, p.index, { text: 'Your golden age has ended.', kind: 'info' });
  } else if (mood > 0) {
    p.goldenPoints += mood;
    if (p.goldenPoints >= goldenCost(game, p)) {
      p.goldenPoints = 0;
      startGoldenAge(game, p, 10);
    }
  }
  // Great people; with Patronage finished, now and then one from an allied city-state.
  for (const [k, v] of Object.entries(p.greatPoints) as [GreatKind, number][]) {
    const cost = greatCost(game, p, k);
    if (v >= cost && greatPersonBorn(game, p, k)) p.greatPoints[k] = v - cost;
  }
  if (has(civ, 'cs_great_people'))
    for (const cs of cityStates(game))
      if (allyOf(game, cs.index) === p.index && random(game) < 0.02) {
        const kind = CHOOSABLE[Math.floor(random(game) * 6)];
        note(game, p.index, { text: `Your ally ${cs.name} sends you a great person.`, kind: 'great' });
        greatPersonBorn(game, p, kind);
      }
  // Choices left unmade at the turn's end are made for them.
  chooseGreat(game, p);
  if (reformationDue(game, p)) {
    const taken = takenBeliefs(game);
    reform(game, p, BELIEF_LIST.find((b) => b.kind === 'reformation' && !taken.has(b.id))!.id);
  }
  p.lastIncome = { gold: net, science, culture, faith, happiness: mood, tourism: 0 };
}

function cityTurn(game: Game, c: City, y: ReturnType<typeof cityYields>) {
  const p = game.players[c.owner];
  // Growth (or starving).
  c.food += y.surplus;
  const need = growthThreshold(game, c.pop);
  if (c.food >= need) {
    c.pop++;
    // (What's over the threshold is kept, as Civ V does, on top of what its granary-likes keep.)
    c.food = c.food - need + Math.floor(need * (foodKept(game, c) / 100));
    note(game, c.owner, { text: `${c.name} has grown to ${c.pop}.`, at: c.tile, kind: 'city' });
  } else if (c.food < 0) {
    if (c.pop > 1) {
      c.pop--;
      capFollowers(c);
      note(game, c.owner, { text: `${c.name} is starving!`, at: c.tile, kind: 'bad' });
    }
    c.food = 0;
  }
  // Production.
  if (!c.queue.length) {
    if (p.bot || c.puppet) c.queue = [(p.bot && !c.puppet ? botHooks.choose : defaultBuild)(game, p, c)];
    else note(game, c.owner, { text: `${c.name} needs something to build.`, at: c.tile, kind: 'city', remind: true });
  }
  const item = c.queue[0];
  if (item) {
    if (!canProduce(game, p, c, item)) {
      c.queue.shift();
    } else if (item.kind === 'project' && isProject(item.id)) {
      // An international project: the city's production (and what was left over) goes into its civ's share.
      contribute(game, c, item.id, c.prod + productionToward(game, c, item, undefined, y.prod));
      c.prod = 0;
    } else {
      c.prod += productionToward(game, c, item, undefined, y.prod);
      const cost = itemCost(game, item);
      // A unit with nowhere to stand waits, done, until there's room.
      const room = item.kind !== 'unit' || placeFor(game, c, item.id) !== undefined;
      if (c.prod >= cost && !room) note(game, c.owner, { text: `${c.name} has ${aName(UNITS[item.id]?.name ?? 'unit')} ready, but no room by the city for it.`, at: c.tile, kind: 'city' });
      if (c.prod >= cost && room) {
        c.prod -= cost;
        c.queue.shift();
        delete c.saved?.[`${item.kind}:${item.id}`];
        // Repeating: a unit finished goes back to the end of the queue, to be built again.
        if (c.repeat && item.kind === 'unit') c.queue.push(item);
        complete(game, c, item);
        if (!c.queue.length && (p.bot || c.puppet)) c.queue = [(p.bot && !c.puppet ? botHooks.choose : defaultBuild)(game, p, c)];
      }
    }
  }
  // Culture claims tiles.
  c.culture += y.culture + (c.capital ? 0 : 0);
  const cost = tileCultureCost(game, c);
  if (c.culture >= cost) {
    const t = nextTile(game, c);
    if (t !== null) {
      c.culture -= cost;
      c.tilesBought++;
      claim(game, c, t);
    }
  }
  // A blockade from the sea begun or broken: its owner told, and those blockading it.
  const ships = blockaders(game, c);
  if (!!ships.length !== !!c.blockaded) {
    c.blockaded = ships.length ? true : undefined;
    if (ships.length) {
      note(game, c.owner, { text: `${c.name} is blockaded: its sea tiles and sea trade routes yield nothing, and it heals half as fast. A warship of yours nearby breaks it.`, at: c.tile, kind: 'bad' });
      for (const by of new Set(ships.map((u) => u.owner))) note(game, by, { text: `Your fleet blockades ${c.name}.`, at: c.tile, kind: 'war' });
    } else note(game, c.owner, { text: `The blockade of ${c.name} is broken.`, at: c.tile, kind: 'good' });
  }
  // Healing (less after an attack, or blockaded: `cityHeal`), resistance.
  c.hp = Math.min(cityMaxHp(game, c), c.hp + cityHeal(game, c));
  c.attacked = undefined;
  if (c.resistance) c.resistance--;
  assignCitizens(game, c);
}

/** How a bot's city picks its next build (`ai.ts` sets it; a puppet's default till then). */
/** What the bots decide that the rules ask about (`ai.ts` fills these in). */
export const botHooks: { choose: (game: Game, p: Player, c: City) => Production; acceptsPeace: (game: Game, bot: Player, from: Player) => boolean; automate: (game: Game, p: Player, units: Unit[]) => void } = {
  choose: (game, p, c) => defaultBuild(game, p, c),
  acceptsPeace: (game) => random(game) < 0.5,
  automate: () => {},
};

/** Set while a person's automated units are moved (`ai.ts`): their orders don't take them back. */
export const automation = { running: false };

/** What a city builds when nobody's said (a bot's, a puppet's): defence first, then growth and science. */
export function defaultBuild(game: Game, p: Player, c: City): Production {
  const can = constructible(game, p, c).filter((b) => BUILDINGS[b].kind !== 'world' || c.puppet === undefined);
  const units = trainable(game, p, c);
  const order = ['monument', 'granary', 'library', 'shrine', 'walls', 'market', 'temple', 'amphitheater', 'water_mill', 'workshop', 'aqueduct', 'university', 'harbor', 'colosseum', 'bank', 'observatory', 'public_school', 'factory', 'hospital', 'stock_exchange', 'research_lab'];
  for (const id of order) {
    const mine = Object.values(BUILDINGS).find((b) => b.civ === p.civ && b.replaces === id)?.id ?? id;
    if (can.includes(mine)) return { kind: 'building', id: mine };
  }
  const military = units.filter((u) => isMilitary(UNITS[u]) && UNITS[u].domain === 'land').sort((a, b) => UNITS[b].strength - UNITS[a].strength);
  return military[0] ? { kind: 'unit', id: military[0] } : { kind: 'unit', id: units[0] ?? 'warrior' };
}

/** Whether a unit has moved or fought this turn (one made this turn has, as far as healing or dropping goes). */
export const moved = (game: Game, u: Unit) => u.moves < (u.turnMoves ?? maxMoves(game, u)) || !!u.attacked || !!u.attacks;

/**
 * What a unit heals at the end of a turn it didn't move or fight (Civ V's): 25 in a city, 20 in its
 * own land, 15 in no one's (or a friend's), 10 in an enemy's; ships only in their own waters, and
 * nothing at sea in a boat; more with (or beside) a Medic, and for ships with (or beside) a Great Admiral.
 */
export function healing(game: Game, u: Unit): number {
  if (u.embarked) return 0;
  const type = UNITS[u.type];
  const tile = game.tiles[u.tile];
  const city = cityAt(game, u.tile);
  const own = tile.owner === u.owner;
  let heal = city?.owner === u.owner ? 25 : own ? 20 : type.domain === 'sea' ? 0 : tile.owner >= 0 && atWar(game, u.owner, tile.owner) ? 10 : 15;
  for (const n of [u.tile, ...neighbours(game.grid, u.tile)])
    for (const m of game.units) {
      if (m.tile !== n || m.owner !== u.owner) continue;
      for (const id of m.promotions) heal += PROMOTIONS[id]?.healsNear ?? 0;
      if (type.domain === 'sea' && UNITS[m.type]?.abilities?.includes('heal_adjacent')) heal += 15;
    }
  return heal;
}

function unitTurn(game: Game, u: Unit) {
  const type = UNITS[u.type];
  if (!type) return;
  const p = game.players[u.owner];
  // Workers' work (faster with Citizenship, the Pyramids...); an archaeologist's dig.
  if (u.work && u.moves > 0) {
    u.work.done += workRate(game, p);
    const w = u.work.what;
    if (u.work.done >= workTurns(game, w) && (w === 'artifact' || (w === 'landmark' && type.abilities?.includes('archaeology')))) {
      dig(game, p, u, w);
      if (!game.units.includes(u)) return;
    } else if (u.work.done >= workTurns(game, w)) {
      const tile = game.tiles[u.tile];
      const cleared = tile.feature ? FEATURES[tile.feature].name : '';
      if (w === 'road') tile.road = 'road';
      else if (w === 'rail') tile.road = 'rail';
      else if (w === 'repair') tile.pillaged = false;
      else if (w === 'scrub_fallout') {
        if (tile.feature === 'fallout') tile.feature = undefined;
      } else if (w === 'remove_feature') {
        const f = tile.feature && FEATURES[tile.feature];
        if (f?.removable?.prod) {
          const near = citiesOf(game, u.owner).sort((a, b) => distance(game.grid, a.tile, u.tile) - distance(game.grid, b.tile, u.tile))[0];
          if (near && distance(game.grid, near.tile, u.tile) <= 3) near.prod += Math.floor(f.removable.prod * speed(game));
        }
        tile.feature = undefined;
      } else if (w !== 'artifact') {
        tile.improvement = w;
        tile.pillaged = false;
        if ((w === 'farm' || w === 'mine' || w === 'trading_post') && (tile.feature === 'forest' || tile.feature === 'jungle' || tile.feature === 'marsh')) tile.feature = undefined;
      }
      u.work = undefined;
      // (An automated worker's work goes unsaid: that's what automating it is for.)
      const what = w === 'road' ? 'built a Road' : w === 'rail' ? 'laid a Railroad' : w === 'repair' ? 'repaired what was pillaged' : w === 'remove_feature' ? `cleared the ${cleared}` : w === 'scrub_fallout' ? 'scrubbed the Fallout' : `built ${aName(IMPROVEMENTS[w as ImprovementId]?.name ?? w)}`;
      if (!u.auto) note(game, u.owner, { text: `A Worker has ${what}.`, at: u.tile, kind: 'info' });
      for (const c of citiesOf(game, u.owner)) assignCitizens(game, c);
    }
  }
  // Healing, if it didn't move or fight (March: even so); beside the Ageless Spring, wholly.
  if (u.hp < 100 && (!moved(game, u) || u.promotions.some((id) => PROMOTIONS[id]?.healsOnTheMove))) u.hp = Math.min(100, u.hp + healing(game, u));
  natureTurn(game, u);
  if (u.stance === 'fortify') u.fortified = Math.min(2, (u.fortified ?? 0) + 1);
  // A new turn's moves.
  u.moves = u.turnMoves = maxMoves(game, u);
  u.attacked = false;
  u.attacks = 0;
  u.skip = false;
  if (u.setUp && !UNITS[u.type].abilities?.includes('must_setup')) u.setUp = false;
  // A person's unit on a long march stops when an enemy soldier it hadn't seen comes into sight near it, and asks for orders (Civ V's).
  sightStops(game, u);
  // A settler whose site was taken on the way (a city founded near it): it stops, and says so.
  if (u.site !== undefined && u.path?.length && !canFound(game, u.site) && !game.players[u.owner]?.bot) {
    const near = game.cities.find((c) => distance(game.grid, c.tile, u.site!) < 3);
    note(game, u.owner, { text: `Your Settler's site is lost${near ? `: ${near.name} has been founded beside it` : ''}. Choose another (the Settler lens shows the best you know).`, at: u.tile, kind: 'city' });
    u.path = undefined;
    u.site = undefined;
  }
  // (An automated unit's way is chosen afresh as the turn begins, out of enemy reach: not walked blindly first.)
  if (u.path?.length && !u.auto) advance(game, u);
}

/** A unit ending its turn beside natural wonders: healed fully by one that heals; given the promotion one gives (a land unit that fights, once). */
function natureTurn(game: Game, u: Unit) {
  const type = UNITS[u.type];
  for (const w of wondersBeside(game, u.tile)) {
    if (w.heals) u.hp = 100;
    if (!w.promotion || u.promotions.includes(w.promotion) || type.domain !== 'land' || !isMilitary(type)) continue;
    u.promotions.push(w.promotion);
    note(game, u.owner, { text: `Your ${type.name} has trained on the slopes of ${inSentence(w.name)}: ${PROMOTIONS[w.promotion]?.name ?? w.promotion}.`, at: u.tile, kind: 'good' });
  }
}

/** An archaeologist's dig done: a Landmark on the site, or an Artifact (a great work of art) taken home; the site and the archaeologist are used up. */
function dig(game: Game, p: Player, u: Unit, what: 'landmark' | 'artifact') {
  const tile = game.tiles[u.tile];
  u.work = undefined;
  if (!canDig(game, u, what)) return note(game, p.index, { text: "Your archaeologists can't finish: the site (or a slot for what's in it) is gone.", at: u.tile, kind: 'bad' });
  tile.antiquity = undefined;
  tile.hiddenAntiquity = undefined;
  if (what === 'landmark') {
    tile.improvement = 'landmark';
    tile.pillaged = false;
    for (const c of citiesOf(game, p.index)) assignCitizens(game, c);
    note(game, p.index, { text: 'Your archaeologists have made the site a Landmark.', at: u.tile, kind: 'good' });
  } else note(game, p.index, { text: `Your archaeologists have found an Artifact: ${greatWork(game, p, 'art', 'Artifact')}.`, at: u.tile, kind: 'good' });
  removeUnit(game, u);
}

// -------------------------------------------------------------------------------------------------
// Winning
// -------------------------------------------------------------------------------------------------

/** A civ's score (Civ V's parts, roughly): cities, citizens, land, techs, wonders, policies, future techs. */
export function score(game: Game, p: Player): number {
  const cities = citiesOf(game, p.index);
  const land = game.tiles.filter((t) => t.owner === p.index).length;
  const wonders = Object.values(game.wonders).filter((w) => w === p.index).length;
  return cities.length * 10 + cities.reduce((s, c) => s + c.pop, 0) * 4 + Math.floor(land / 2) + p.techs.length * 4 + wonders * 25 + p.policies.length * 4 + p.futureTechs * 10;
}

/** Each civ's standing this turn, kept for the graphs at the game's end. */
function recordStats(game: Game) {
  for (const p of game.players) {
    if (p.cityState || p.civ === 'barbarian') continue;
    const s = (p.stats ??= { score: [], science: [], land: [], military: [] });
    s.score.push(p.alive ? score(game, p) : 0);
    s.science.push(p.lastIncome?.science ?? 0);
    s.land.push(game.tiles.filter((t) => t.owner === p.index).length);
    s.military.push(unitsOf(game, p.index).reduce((n, u) => n + (UNITS[u.type]?.strength ?? 0) + (UNITS[u.type]?.ranged ?? 0), 0));
  }
}

export function checkVictory(game: Game) {
  if (game.over) return;
  const majors = game.players.filter((p) => !p.cityState && p.civ !== 'barbarian');
  const living = majors.filter((p) => p.alive);
  // Majors with no city left and no settler to found one are out.
  for (const p of living) if (!game.cities.some((c) => c.owner === p.index) && !game.units.some((u) => u.owner === p.index && UNITS[u.type]?.abilities?.includes('found_city'))) eliminate(game, p.index);
  const standing = majors.filter((p) => p.alive);
  // Domination: one civ holds every original capital (or is the last standing). Not while a civ has
  // yet to found its first city (its capital isn't there to be held).
  const unfounded = standing.some((p) => !game.cities.some((c) => c.founder === p.index));
  if (game.settings.victories.domination && !(unfounded && standing.length > 1)) {
    const capitals = game.cities.filter((c) => c.founder !== undefined && game.players[c.founder] && !game.players[c.founder].cityState && game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c);
    for (const p of standing) {
      // (A team holds them together, and wins together; a side's vassals hold theirs for it, and win
      // nothing of their own: `vassals.ts`.)
      if (masterOf(game, p.index)) continue;
      const ours = (i: number) => i === p.index || sameSide(game, i, p.index);
      if (standing.some((o) => !ours(o.index)) && !capitals.every((c) => ours(c.owner))) continue;
      // (Someone conquered: a civ not on its team, its vassals among them.)
      if (majors.some((o) => o !== p && !teammates(game, o.index, p.index))) {
        game.over = { winner: p.index, how: 'domination' };
        noteAll(game, { text: `${sideName(p)} has conquered the world!`, kind: 'war' });
        return;
      }
    }
  }
  // Time: the turn limit (unless the score victory's off: then the game goes on).
  // (A team's score is its civs' together; its best civ stands for it.)
  if (game.settings.victories.score && game.turn > game.settings.turnLimit) {
    const sideScore = (p: Player) => teamOf(game, p.index).reduce((n, m) => n + score(game, m), 0);
    // (A vassal wins nothing of its own.)
    const best = living.filter((p) => !masterOf(game, p.index)).sort((a, b) => sideScore(b) - sideScore(a) || score(game, b) - score(game, a))[0];
    if (best) {
      game.over = { winner: best.index, how: 'score' };
      noteAll(game, { text: `Time is up: ${sideName(best)} wins with the highest score.`, kind: 'good' });
    }
  }
}

/** Things a player still has to decide before their turn can end (Civ V asks before ending it). */
export function blockers(game: Game, p: Player): { text: string; at?: number }[] {
  const out: { text: string; at?: number }[] = [];
  // (Research is asked for once there's a city to do it: before the capital, nothing is learned.)
  if (!p.researching && citiesOf(game, p.index).length && Object.keys(TECHS).some((t) => canResearch(new Set(p.techs), t))) out.push({ text: 'Choose research' });
  for (const c of citiesOf(game, p.index)) if (!c.queue.length && !c.puppet) out.push({ text: `${c.name} needs production`, at: c.tile });
  if (p.culture >= policyCost(game, p) && adoptable(p, eraOf(p)).length) out.push({ text: 'Choose a policy' });
  if (p.greatChoices) out.push({ text: 'Choose a free great person' });
  if (reformationDue(game, p)) out.push({ text: 'Choose a Reformation belief' });
  return out;
}

/** Units that still want orders this turn (moves left, not fortified, asleep, working or going somewhere). */
export function idleUnits(game: Game, p: number): Unit[] {
  return game.units.filter((u) => u.owner === p && u.moves > 0 && !u.stance && !u.work && !u.path?.length && !u.skip && !u.auto);
}

export { luxuries, happiness };

// -------------------------------------------------------------------------------------------------
// Razing, and great people's actions
// -------------------------------------------------------------------------------------------------

/** Cities being razed lose a citizen a turn, and are gone at none (their wonders with them). */
function raze(game: Game) {
  for (const c of [...game.cities]) {
    if (c.razing === undefined) continue;
    c.pop--;
    c.razing = c.pop;
    capFollowers(c);
    if (c.pop > 0) continue;
    noteAll(game, { text: `${c.name} has been burned to the ground.`, at: c.tile, kind: 'war' });
    for (const tile of game.tiles) if (tile.city === c.id) {
      tile.city = undefined;
      tile.owner = -1;
    }
    for (const w of c.wonders ?? []) game.wonders[w] = -1;
    game.cities.splice(game.cities.indexOf(c), 1);
    // A capital burned: the owner's biggest city takes the palace.
    if (c.capital) {
      const next = citiesOf(game, c.owner).sort((a, b) => b.pop - a.pop)[0];
      if (next) {
        next.capital = true;
        if (!next.buildings.includes('palace')) next.buildings.push('palace');
      }
    }
  }
}

/** The first of a civ's cities with an empty slot for a great work of a kind, and the building with it. */
export function freeSlot(game: Game, p: Player, kind: 'art' | 'writing' | 'music'): { city: City; building: string } | null {
  for (const c of citiesOf(game, p.index))
    for (const b of c.buildings) {
      const slots = BUILDINGS[b]?.effects.greatWorks;
      if (slots?.kind === kind && (c.works?.[b]?.length ?? 0) < slots.slots) return { city: c, building: b };
    }
  return null;
}

/** A great work put in an empty slot, named in order ("Great Work of Art 3", "Artifact 4"); where it went, or null if there's no room. */
function greatWork(game: Game, p: Player, kind: 'art' | 'writing' | 'music', title?: string): string | null {
  const slot = freeSlot(game, p, kind);
  if (!slot) return null;
  const name = `${title ?? (kind === 'art' ? 'Great Work of Art' : kind === 'writing' ? 'Great Work of Writing' : 'Great Work of Music')} ${++game.worksMade}`;
  ((slot.city.works ??= {})[slot.building] ??= []).push(name);
  return `${name} in ${slot.city.name}`;
}

/** The improvement each great person can build (Civ V's). */
const GREAT_IMPROVEMENT: Partial<Record<GreatKind, ImprovementId>> = { scientist: 'academy', engineer: 'manufactory', merchant: 'customs_house', general: 'citadel', prophet: 'holy_site', artist: 'landmark' };

/** A great person's one-time act (it's used up), or an improvement on its tile. */
function greatAction(game: Game, p: Player, u: Unit, action: Extract<Order, { t: 'greatPerson' }>['action']): Outcome {
  const kind = (Object.keys(GREAT_UNIT) as GreatKind[]).find((k) => GREAT_UNIT[k] === u.type);
  if (!kind) return fail('Only a great person');
  const abilities = UNITS[u.type].abilities ?? [];
  const tile = game.tiles[u.tile];
  const near = citiesOf(game, p.index).sort((a, b) => distance(game.grid, a.tile, u.tile) - distance(game.grid, b.tile, u.tile))[0];
  const civ = civEffects(game, p);
  const used = (text: string) => {
    removeUnit(game, u);
    note(game, p.index, { text, at: u.tile, kind: 'great' });
    // The Mausoleum: gold; Reliquary: faith.
    if (has(civ, 'mausoleum_great_person_gold')) p.gold += 100;
    if (has(civ, 'reliquary')) p.faith += 50;
    updateVisibility(game, p);
    return OK;
  };
  switch (action) {
    case 'improvement': {
      const imp = GREAT_IMPROVEMENT[kind];
      if (!imp || !abilities.includes('tile_improvement')) return fail("This great person doesn't build");
      if (tile.owner !== p.index || cityAt(game, u.tile) || TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || tile.wonder) return fail('Build it in your own land, outside a city and off natural wonders');
      tile.improvement = imp;
      tile.pillaged = false;
      tile.feature = tile.feature === 'floodplains' ? tile.feature : undefined;
      // A citadel claims the land round it (Civ V's): no one's, and another civ's too, but not a city's own tile. Those it's taken from remember it.
      const robbed = new Set<number>();
      if (imp === 'citadel' && near)
        for (const t of neighbours(game.grid, u.tile)) {
          const owner = game.tiles[t].owner;
          if (owner === p.index || cityAt(game, t)) continue;
          if (owner >= 0) robbed.add(owner);
          claim(game, near, t);
        }
      for (const o of robbed) {
        const them = game.players[o];
        // (A city-state takes it as a slight: influence lost.)
        if (them.cityState) p.influence[o] = (p.influence[o] ?? 0) - 20;
        else remember(game, 'land', p.index, o);
        note(game, o, { text: `${nameTo(them, p, true)} has built a citadel on our border and taken land from us.`, at: u.tile, kind: 'bad' });
        for (const c of citiesOf(game, o)) assignCitizens(game, c);
      }
      for (const c of citiesOf(game, p.index)) assignCitizens(game, c);
      return used(`Your ${UNITS[u.type].name} has built ${aName(IMPROVEMENTS[imp].name)}.`);
    }
    case 'discover': {
      if (!abilities.includes('discover_tech')) return fail('Only a Great Scientist');
      // Science worth eight turns of the empire's research (Civ V's); half again with Rationalism finished.
      const per = citiesOf(game, p.index).reduce((s, c) => s + cityYields(game, c).science, 0);
      const target = p.researching ?? Object.keys(TECHS).find((t) => canResearch(new Set(p.techs), t));
      if (!target) return fail('Nothing left to research');
      p.researching = target;
      p.research[target] = (p.research[target] ?? 0) + Math.floor(Math.max(40, per * 8) * (has(civ, 'scientist_science_50') ? 1.5 : 1));
      if (p.research[target] >= techCost(game, p, target)) {
        const over = p.research[target] - techCost(game, p, target);
        learn(game, p, target);
        if (p.researching) p.research[p.researching] = (p.research[p.researching] ?? 0) + over;
      }
      return used('Your Great Scientist has made a breakthrough.');
    }
    case 'hurry': {
      if (!abilities.includes('hurry')) return fail('Only a Great Engineer');
      const city = cityAt(game, u.tile);
      if (!city || city.owner !== p.index) return fail('Stand it in one of your cities');
      city.prod += 300 + 30 * city.pop;
      return used(`Your Great Engineer has hurried the work in ${city.name}.`);
    }
    case 'trade': {
      if (!abilities.includes('trade_mission')) return fail('Only a Great Merchant');
      // Twice the gold with Commerce finished.
      const gold = Math.round((300 + eraOf(p) * 100) * speed(game)) * (has(civ, 'merchant_gold_double') ? 2 : 1);
      p.gold += gold;
      return used(`Your Great Merchant's trade mission has brought back ${gold} gold.`);
    }
    case 'golden': {
      if (!abilities.includes('golden_age')) return fail('Only a Great Artist');
      startGoldenAge(game, p, 8);
      return used('Your Great Artist has begun a golden age!');
    }
    case 'work': {
      const work: 'art' | 'writing' | 'music' | null = kind === 'artist' ? 'art' : kind === 'writer' ? 'writing' : kind === 'musician' ? 'music' : null;
      if (!work || !abilities.includes('great_work')) return fail("This great person doesn't make great works");
      const where = greatWork(game, p, work);
      if (!where) return fail(`No empty slot for a great work of ${work} (an Amphitheater, a Museum, an Opera House...)`);
      return used(`A masterpiece: ${where}.`);
    }
    case 'repair': {
      // Repair Fleet (Civ V's): every ship of the civ's on the Admiral's tile and those beside it healed.
      if (!abilities.includes('repair_fleet')) return fail('Only a Great Admiral');
      const ships = game.units.filter((x) => x.owner === p.index && UNITS[x.type].domain === 'sea' && distance(game.grid, x.tile, u.tile) <= 1 && x.hp < 100);
      if (!ships.length) return fail('No damaged ship of yours here or beside it');
      for (const x of ships) x.hp = 100;
      return used(`Your Great Admiral has repaired the fleet: ${ships.length} ship${ships.length === 1 ? '' : 's'} as good as new.`);
    }
    case 'concert': {
      // A Concert Tour (Civ V's): in another civ's land, ten turns of the civ's tourism toward it at once (200 at least, at speed).
      if (!abilities.includes('concert_tour')) return fail('Only a Great Musician');
      const host = game.players[tile.owner];
      if (!host || host === p || host.cityState || host.civ === 'barbarian') return fail("Take it into another civ's land");
      if (atWar(game, p.index, host.index)) return fail("Not while you're at war with them");
      const tourism = Math.max(Math.round(200 * speed(game)), 10 * tourismOf(game, p));
      p.tourism[host.index] = (p.tourism[host.index] ?? 0) + tourism;
      return used(`Your Great Musician's concert tour has won over ${host.name}'s people: +${tourism} tourism toward them.`);
    }
    case 'culture': {
      if (!abilities.includes('political_treatise')) return fail('Only a Great Writer');
      const per = citiesOf(game, p.index).reduce((s, c) => s + cityYields(game, c).culture, 0);
      p.culture += Math.max(30, per * 6);
      return used('Your Great Writer\'s treatise has stirred the nation: culture gained.');
    }
  }
}

/** Bots and puppets: take the promotions they've earned. */
export function autoPromote(_game: Game, u: Unit) {
  while (promotionsDue(u) > 0) {
    const options = promotionsFor(u);
    if (!options.length) return;
    const pick = options.find((x) => x.id.startsWith('shock') || x.id.startsWith('accuracy')) ?? options[0];
    u.promotions.push(pick.id);
  }
}

export const promotionName = (id: string) => PROMOTIONS[id]?.name ?? id;

stolen.learn = learn;
