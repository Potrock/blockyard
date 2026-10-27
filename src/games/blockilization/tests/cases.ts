import { blockaded, blockaders } from '../rules/economy';
import { declareEmbargo, embargoTurns, liftEmbargo } from '../rules/diplomacy';
import { cityHeal } from '../rules/combat';
import { routeBlockaded } from '../rules/trade';
import { adviseResearch, adviseWork } from '../advisor';
import { BUILDINGS } from '../rules/buildings';
import { canFire, canPillage, cityFireStrength, cityHooks, cityMaxHp, cityStrength, damageFor, gain, indirectFire, leadership, rangeOf, strength } from '../rules/combat';
import { CITY_STATES, CIV_LIST } from '../rules/civs';
import { PERSONALITIES } from '../rules/ai/personality';
import { UNITS } from '../rules/units';
import { CIV_SYMBOL, glyphPaths } from '../client/icons';
import { atWar, canStand, cityAt, createGame, maxMoves, seesUnit, techCost, unitSight, updateAllVisibility } from '../rules/core';
import { assignCitizens, cityEffects, cityYields, workedYields, connected, dissent, foodKept, freshWater, goldUpkeep, growthThreshold, greatCost, greatPeopleBonus, happiness, policyCost, purchaseCost, strategic, tileCultureCost, tileGoldCost, tileYields, UNHAPPINESS_PER_CITY, weighing, workable } from '../rules/economy';
import { faithCost, faithTurn, faithUnit, foundReligion, maxReligions, prophetCost, religionsLeft, spreadsOf } from '../rules/faith';
import { ANARCHY_TURNS, apply, applyOnce, blockers, canBuild, workTurns, constructible, canChooseIdeology, ideologySwitch, SWITCH_DISSENT, canDig, canFound, checkVictory, endTurn, faithPurchases, healing, itemCost, learn, plunder, productionToward, score, shareResearch, trainable, trainOptions, upgradeCost, upgradeTo, wellFormed, type Order } from '../rules/game';
import { colOf, distance, line, neighbour, neighbours, rowOf, tileAt, within } from '../rules/hex';
import { generate, Rng, START_ISLAND } from '../rules/mapgen';
import { NATURAL_WONDERS } from '../rules/nature';
import { IMPROVEMENTS, TERRAINS, type Elevation, type FeatureId, type ImprovementId } from '../rules/terrain';
import { makeCtx, militaryAt } from '../rules/ai/context';
import { opinionOf } from '../rules/ai/opinion';
import { planWar } from '../rules/ai/strategy';
import { workers } from '../rules/ai/workers';
import { civilians } from '../rules/ai/civilians';
import { evaluate } from '../rules/ai/diplomacy';
import { congressProposal, congressVote } from '../rules/ai/congress';
import { moveUnits } from '../rules/ai/military';
import { exploreSea } from '../rules/ai/navy';
import { pickProduction } from '../rules/ai/production';
import { bestSite, siteValue } from '../rules/ai/settle';
import { canEnter, occupants, planPath, stepCost } from '../rules/movement';
import { adoptable, ALL_POLICIES } from '../rules/policies';
import { previewAttack, previewCityFire } from '../rules/preview';
import { promotionsDue, promotionsFor, promotionsOf } from '../rules/promotions';
import { BELIEF_LIST } from '../rules/religion';
import { campCleared, QUEST_REWARD, questsFor, questsOf, questsTurn, type Quest, type QuestKind } from '../rules/quests';
import { allyOf, cannotBully, cannotCoup, cityStateBonus, cityStateTurn, coupChance, influenceFall, TRIBUTE_COST, tributeGold, tributeTurns } from '../rules/citystates';
import { banned, cannotPropose, delegates, delegateSources, embargoed, inForce, propose as proposeResolution, proposers, sessionTurns, vote as castVote } from '../rules/congress';
import { replayAt, replayEnd, type ReplayEvent } from '../rules/replay';
import { MAP_SIZES, SPEEDS, TURN_LIMITS, type City, type Game, type MapSize, type Settings, type Unit } from '../rules/state';
import { lonLatOf, TRUE_STARTS, tileOfLonLat } from '../rules/earth';
import { cityTourism, longGameTurn, maxRoutes, routesGold, routesOf, routeYield, spiesOf, spyCount, startRoute, surveillanceTurns, theft, THEFT_COST, unVote } from '../rules/trade';
import { TECHS } from '../rules/techs';
import { dealGold, dealProblem, dealTurns, denounce, diplomacyTurn, endWar, hasMet, makeDeal, relationsOf, remember, spareIncome } from '../rules/diplomacy';
import { bindTeams } from '../rules/teams';
import { cityInfo, mapWire, viewFor } from '../views';
import { packStatic, unpackKnown, unpackStatic, type KnownTile } from '../protocol';
import { autoKey, autosaveTurns, backupsKept, discardGame, forgetGame, gameId, gameKey, inGame, keepGame, moveRoomSaves, playedElsewhere, playedNow, renameGame, restoreTurn, roomCode, saveGame, savedGames, SaveThrottle, stillPlayed, tidyGames } from '../saves';
import { baseX, centre as middleOf, extent, period, SEA_Y, tileAt as tileUnder, UNIT_SPOTS } from '../geometry';
import { decorKey, decorOf, Ground, SURFACE_BLOCKS, wallEdges } from '../improvements';
import { activeSide, advanceSequence, sequenceDone, startSequence, waitingOn } from '../rules/turns';
import { EVERGREEN, riverLinks, SNOWY, terrainEdits } from '../terrain';
import { reshapeEdits, seasonalBlocks } from '../seasons';
import { batter, disasterTurn, erupt, flood, seasonAt, seasonOf, seasonTurns, SOIL_MAX } from '../rules/disasters';
import { climateTurn, emissions, MAX_RISES, riseAt, submerge } from '../rules/climate';
import { corners, GROWN, KINDS, PEN_SCALE, spotsFor } from '../client/spots';
import { blank, city, techsTo, unit, war } from './world';
import { liberation, LIBERATE_INFLUENCE } from '../rules/liberation';
import { cannotPledge, pledged, PLEDGE_BROKEN, PLEDGE_REST } from '../rules/pledges';
import { restingInfluence } from '../rules/citystates';
import { checkEurekas, EUREKA_SHARE, EUREKAS, eurekaDone, killDeeds } from '../rules/eurekas';
import { research } from '../rules/ai/civics';
import { conquests, kneels, makePeace, trackWars, wantsPeace } from '../rules/ai/strategy';
import { kneel } from '../rules/diplomacy';
import { masterOf, sameSide, vassalsOf } from '../rules/teams';
import { breakFree, release, SERVICE, tributeOf, vassalsTurn } from '../rules/vassals';
import { forsakes, freeable, pledges as botPledges, turnsOn } from '../rules/ai/liberation';
import { openProject, startProject, type WorldProject } from '../rules/projects';
import { expectedTier, leavesProject, projectPlan, worldProject } from '../rules/ai/projects';
import { bestNukeStrike, nukeProduction, nukes as fireNukes, nukesWanted, strikeWorth } from '../rules/ai/nukes';
import { NUKE_INFLUENCE } from '../rules/diplomacy';
import { bombInterceptChance, type Modifier } from '../rules/combat';
import { bestUnit, ERA_STARTS, SCENARIOS, startEraOf, startWords, techsBefore, turnLimitFor, withScenario } from '../rules/starts';
import { TECH_LIST } from '../rules/techs';
import { TURN_CHOICES } from '../rules/state';
import { autoPromote, eraOf, foundCity } from '../rules/game';
import { botAnswer, EMOTES, isEmote, isPing, moodOf, toneOf } from '../rules/chat';
import { isMilitary, isRanged } from '../rules/units';
import { civEffects, has } from '../rules/core';
import { bribeTurns, clanCost, clansOf, clansTurn, clanUnit, hireRest, inciteTurns, newClan, raidTarget, SETTLE, spares } from '../rules/clans';
import { CLAN_STATES, SEVEN_CITIES_GOLD, speed } from '../rules/core';
import { barbarianTurn } from '../rules/barbarians';
import { clans as botClans } from '../rules/ai/clans';
import { die } from '../rules/combat';
import { campHooks } from '../rules/movement';
import { ARMY_BONUS, CORPS_BONUS, CORPS_TECH, forms, mergeProblem, unitName } from '../rules/armies';
import { formations } from '../rules/ai/armies';

/**
 * The rules' behaviour tests: each sets up a small situation and checks that an effect (or a
 * mechanism many effects share) changes what it should, usually by measuring the same thing with
 * and without it. `tests/effects.ts` runs them; `tests/effects-coverage.ts` runs them too, to see
 * that every effect in the data is read.
 */

export interface Case {
  name: string;
  run: () => void;
}

export const CASES: Case[] = [];
const test = (name: string, run: () => void) => CASES.push({ name, run });

/** A failed expectation. */
export class Failure extends Error {}
function eq<T>(actual: T, expected: T, what: string) {
  if (actual !== expected) throw new Failure(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}
function ok(cond: boolean, what: string) {
  if (!cond) throw new Failure(what);
}
const near = (a: number, b: number, what: string) => ok(Math.abs(a - b) < 1e-6, `${what}: expected ${b}, got ${a}`);

/** Adopt policies without their once-only effects (the lasting ones are what's measured). */
const adopt = (game: Game, p: number, ...ids: string[]) => {
  for (const id of ids) {
    ok(!!ALL_POLICIES[id], `no policy ${id}`);
    game.players[p].policies.push(id);
  }
};

// -------------------------------------------------------------------------------------------------
// Where effects reach
// -------------------------------------------------------------------------------------------------

test('a capital-only policy works in the capital and nowhere else (Tradition)', () => {
  const { game, at } = blank();
  const capital = city(game, 0, at(5, 5));
  const other = city(game, 0, at(12, 5));
  const before = [cityYields(game, capital).culture, cityYields(game, other).culture];
  const border = tileCultureCost(game, capital);
  adopt(game, 0, 'tradition');
  eq(cityYields(game, capital).culture - before[0], 3, 'capital culture');
  eq(cityYields(game, other).culture - before[1], 0, 'other city culture');
  ok(tileCultureCost(game, capital) < border, 'cheaper borders in the capital');
});

test('city filters: size, coast, fresh water, garrison, specialists, holy city, techs', () => {
  const { game, at } = blank(['france', 'babylon']);
  const c = city(game, 0, at(5, 5), { pop: 2 });
  const p = game.players[0];
  const prod = () => cityYields(game, c).prod;
  // God of Craftsmen: from 3 citizens.
  let base = prod();
  p.pantheon = 'god_of_craftsmen';
  eq(prod() - base, 0, 'craftsmen at 2');
  c.pop = 3;
  base = prod();
  p.pantheon = undefined;
  eq(base - prod(), 1, 'craftsmen at 3');
  // Merchant Navy: coastal cities.
  adopt(game, 0, 'merchant_navy');
  base = prod();
  game.tiles[at(6, 5)].terrain = 'coast';
  eq(prod() - base, 3, 'merchant navy on the coast');
  // Sacred Waters: a river.
  p.pantheon = 'sacred_waters';
  const mood = happiness(game, p);
  game.tiles[c.tile].river = true;
  eq(happiness(game, p) - mood, 1, 'sacred waters by a river');
  // Military Caste: a garrison.
  adopt(game, 0, 'military_caste');
  const culture = cityYields(game, c).culture;
  unit(game, 'warrior', 0, c.tile);
  eq(cityYields(game, c).culture - culture, 2, 'military caste garrison culture');
  // Guruship: a specialist (a follower belief of the city's religion).
  game.religions.r1 = { founder: 1, holyCity: -1, name: 'Test', beliefs: ['tithe', 'guruship'] };
  c.followers = { r1: c.pop };
  const withSpecialist = prod();
  c.specialists = {};
  ok(withSpecialist === prod(), 'no specialists yet in a city of 3 without slots');
  c.specialists = { scientist: 1 };
  eq(prod() - withSpecialist, 2, 'guruship with a specialist');
  // France: +1 culture until Steam Power.
  const before = cityYields(game, c).culture;
  p.techs.push('steam_power');
  eq(before - cityYields(game, c).culture, 1, 'french culture ends with steam power');
});

test('Piety finished: +3 happiness in the holy city only', () => {
  const { game, at } = blank();
  const holy = city(game, 0, at(5, 5));
  city(game, 0, at(12, 5));
  const p = game.players[0];
  game.religions.r1 = { founder: 0, holyCity: holy.id, name: 'Test', beliefs: ['tithe', 'mosques'] };
  p.religion = 'r1';
  const mood = happiness(game, p);
  adopt(game, 0, 'piety_done');
  eq(happiness(game, p) - mood, 3, 'holy city happiness');
});

test('per-building effects count each building, a civ’s own version too (Organized Religion)', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const c = city(game, 0, at(5, 5), { buildings: ['monument', 'shrine', 'burial_tomb'] });
  const faith = cityYields(game, c).faith;
  adopt(game, 0, 'organized_religion');
  eq(cityYields(game, c).faith - faith, 3, 'a faith for each of monument, shrine, burial tomb');
});

test('a wonder’s empire part reaches every city; its own part only its city (Temple of Artemis)', () => {
  const { game, at } = blank();
  const a = city(game, 0, at(5, 5), { pop: 6 });
  const b = city(game, 0, at(12, 5), { pop: 6 });
  const ranged = productionToward(game, b, { kind: 'unit', id: 'archer' });
  const sistine = cityYields(game, b).culture;
  a.buildings.push('temple_of_artemis', 'sistine_chapel');
  ok(cityEffects(game, b).some((e) => e.percent?.food === 10), 'other city has +10% food');
  eq(productionToward(game, b, { kind: 'unit', id: 'archer' }), ranged, 'no ranged production bonus elsewhere');
  ok(cityYields(game, b).culture >= sistine, 'sistine culture reaches the other city');
});

test('civ-wide effects come from wonders anywhere: combat, moves, sight, purchases', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(5, 5));
  const other = city(game, 0, at(12, 5));
  const p = game.players[0];
  game.tiles[at(8, 8)].terrain = 'coast';
  const ship = unit(game, 'trireme', 0, at(8, 8));
  const soldier = unit(game, 'warrior', 0, at(6, 6));
  const moves = maxMoves(game, ship);
  const sight = unitSight(game, ship);
  const defence = strength(game, soldier, 'defend', null, soldier.tile);
  const price = purchaseCost(game, p, 100, 'unit');
  other.buildings.push('great_lighthouse', 'himeji_castle', 'big_ben');
  eq(maxMoves(game, ship) - moves, 1, 'great lighthouse moves');
  eq(unitSight(game, ship) - sight, 1, 'great lighthouse sight');
  ok(game.tiles[soldier.tile].owner === 0, 'the soldier is in its own land');
  near(strength(game, soldier, 'defend', null, soldier.tile) / defence, 1.15, 'himeji in own land');
  ok(purchaseCost(game, p, 100, 'unit') < price, 'big ben makes buying cheaper');
  void c;
});

// -------------------------------------------------------------------------------------------------
// Yields, growth, happiness, costs
// -------------------------------------------------------------------------------------------------

test('production boosts for particular buildings and wonders (Piety, Monument to the Gods)', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(5, 5), { pop: 4, buildings: ['shrine'] });
  const p = game.players[0];
  const temple = productionToward(game, c, { kind: 'building', id: 'temple' });
  const monument = productionToward(game, c, { kind: 'building', id: 'monument' });
  adopt(game, 0, 'piety');
  eq(productionToward(game, c, { kind: 'building', id: 'temple' }), temple * 2, 'temples twice as fast');
  eq(productionToward(game, c, { kind: 'building', id: 'monument' }), monument, 'monuments as before');
  const pyramids = productionToward(game, c, { kind: 'building', id: 'pyramids' });
  const taj = productionToward(game, c, { kind: 'building', id: 'taj_mahal' });
  p.pantheon = 'monument_to_the_gods';
  ok(productionToward(game, c, { kind: 'building', id: 'pyramids' }) > pyramids, 'ancient wonders faster');
  eq(productionToward(game, c, { kind: 'building', id: 'taj_mahal' }), taj, 'renaissance wonders as before');
  const part = productionToward(game, c, { kind: 'project', id: 'ss_booster' });
  c.buildings.push('spaceship_factory');
  ok(productionToward(game, c, { kind: 'project', id: 'ss_booster' }) > part, 'spaceship factory');
});

test('specialists: extra yields, and Civil Society halves what they eat', () => {
  const { game, at } = blank(['egypt', 'korea']);
  const c = city(game, 0, at(5, 5), { pop: 4 });
  c.specialists = { merchant: 2 };
  const y = cityYields(game, c);
  adopt(game, 0, 'secularism', 'civil_society');
  const z = cityYields(game, c);
  eq(z.science - y.science, 4, 'secularism +2 science each');
  eq(y.eaten - z.eaten, 2, 'civil society: each eats 1 less');
  const korea = city(game, 1, at(14, 5), { pop: 4 });
  korea.specialists = { merchant: 1 };
  const k = cityYields(game, korea).science;
  korea.specialists = {};
  eq(k - cityYields(game, korea).science, 2, "korea's specialists +2 science");
  c.buildings.push('statue_of_liberty');
  eq(cityYields(game, c).prod - z.prod, 2, 'statue of liberty +1 production a specialist');
});

test('great person rates: Garden (city), Leaning Tower (empire), Babylon, Aesthetics', () => {
  const { game, at } = blank(['babylon', 'egypt']);
  const a = city(game, 0, at(5, 5), { pop: 4 });
  const b = city(game, 0, at(12, 5), { pop: 4 });
  a.specialists = { scientist: 1 };
  b.specialists = { artist: 1 };
  near(cityYields(game, a).greatPeople.scientist ?? 0, 3.99, 'babylon: 3 points, a third again');
  a.buildings.push('garden');
  near(cityYields(game, a).greatPeople.scientist ?? 0, 4.74, 'garden +25% here');
  eq(cityYields(game, b).greatPeople.artist, 3, 'no garden there');
  a.buildings.push('leaning_tower');
  eq(cityYields(game, b).greatPeople.artist, 3.75, 'leaning tower everywhere');
  adopt(game, 0, 'aesthetics');
  eq(cityYields(game, b).greatPeople.artist, 4.5, 'aesthetics +25% artists');
  eq(greatPeopleBonus([{ special: ['merchants_faster_25', 'generals_faster_50'] }], 'merchant'), 25, 'merchant rate');
});

test('happiness: Aristocracy, Monarchy, courthouses, Meritocracy over roads', () => {
  const { game, at } = blank();
  const capital = city(game, 0, at(5, 5), { pop: 10 });
  const other = city(game, 0, at(9, 5), { pop: 4 });
  const p = game.players[0];
  let mood = happiness(game, p);
  adopt(game, 0, 'aristocracy');
  eq(happiness(game, p) - mood, 1, 'aristocracy: one for 10 citizens');
  mood = happiness(game, p);
  adopt(game, 0, 'monarchy');
  eq(happiness(game, p) - mood, 5, 'monarchy: 5 less from 10 in the capital');
  ok(cityYields(game, capital).gold >= 5, 'monarchy gold');
  other.occupied = true;
  mood = happiness(game, p);
  other.buildings.push('courthouse');
  ok(happiness(game, p) > mood, 'a courthouse ends occupied unhappiness');
  mood = happiness(game, p);
  adopt(game, 0, 'meritocracy');
  const less = happiness(game, p) - mood;
  for (let col = 6; col <= 8; col++) game.tiles[at(col, 5)].road = 'road';
  ok(connected(game, p).has(other.id), 'a road links the cities');
  eq(happiness(game, p) - mood - less, 1, 'meritocracy: one for the connected city');
  game.tiles[at(7, 5)].pillaged = true;
  ok(!connected(game, p).has(other.id), 'a pillaged road breaks the link');
});

test('harbours link cities by sea; Messenger of the Gods follows the link', () => {
  const { game, at } = blank();
  for (let col = 0; col < 26; col++) game.tiles[at(col, 8)].terrain = 'coast';
  const capital = city(game, 0, at(3, 7), { buildings: ['harbor'] });
  const far = city(game, 0, at(20, 7));
  const p = game.players[0];
  p.pantheon = 'messenger_of_the_gods';
  const science = cityYields(game, far).science;
  far.buildings.push('harbor');
  ok(connected(game, p).has(far.id), 'harbours connect');
  eq(cityYields(game, far).science - science, 2, 'messenger +2 science when connected');
  void capital;
});

test('growth, science and production that depend on how things stand', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(5, 5), { pop: 6, buildings: ['granary', 'hanging_gardens', 'library', 'national_college'] });
  const p = game.players[0];
  game.religions.r1 = { founder: 1, holyCity: -1, name: 'Test', beliefs: ['tithe', 'swords_into_plowshares'] };
  c.followers = { r1: 6 };
  const peace = cityYields(game, c).surplus;
  war(game, 0, 1);
  ok(cityYields(game, c).surplus < peace, 'plowshares only at peace');
  game.religions.r1.beliefs = ['tithe', 'religious_community'];
  const prod = cityYields(game, c);
  ok(prod.prod >= 1, 'production');
  adopt(game, 0, 'rationalism');
  ok(happiness(game, p) >= 0, 'happy');
  ok(cityYields(game, c).science > prod.science, 'rationalism +10% while happy');
  adopt(game, 0, 'flourishing');
  const culture = cityYields(game, c).culture;
  p.goldenTurns = 5;
  ok(cityYields(game, c).culture >= Math.floor(culture * 1.5), 'golden age culture, more with flourishing');
});

test('policy costs, upkeep: Representation, Oligarchy, Trade Unions', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(3, 3));
  city(game, 0, at(10, 3));
  const c3 = city(game, 0, at(17, 3));
  for (let col = 4; col < 17; col++) game.tiles[at(col, 3)].road = 'road';
  for (let col = 4; col < 17; col++) game.tiles[at(col, 3)].owner = 0;
  p.policies = ['tradition', 'aristocracy', 'legalism', 'oligarchy', 'liberty'];
  const cost = policyCost(game, p);
  p.policies = ['tradition', 'aristocracy', 'legalism', 'oligarchy', 'representation'];
  ok(policyCost(game, p) < cost, 'representation: cities add less');
  for (let i = 0; i < 9; i++) unit(game, 'warrior', 0, at(4 + i, 6));
  unit(game, 'warrior', 0, c3.tile);
  p.policies = [];
  const upkeep = goldUpkeep(game, p);
  adopt(game, 0, 'oligarchy', 'trade_unions');
  const less = goldUpkeep(game, p);
  ok(less.units < upkeep.units, 'oligarchy: the garrison costs nothing');
  ok(less.roads < upkeep.roads, 'trade unions: roads cost less');
});

test('strategic resources: Russia, Arabia’s oil, city-state allies, Cultural Diplomacy', () => {
  const { game, at } = blank(['russia', 'arabia'], { cityStates: 1 });
  const ru = city(game, 0, at(5, 5));
  const ar = city(game, 1, at(15, 5));
  const cs = game.players.findIndex((x) => x.cityState);
  const home = city(game, cs, at(10, 12));
  for (const [c, res] of [[ru, 'iron'], [ar, 'oil']] as const) {
    const t = neighbours(game.grid, c.tile)[0];
    Object.assign(game.tiles[t], { resource: res, amount: 2, improvement: res === 'oil' ? 'oil_well' : 'mine' });
  }
  game.players[0].techs.push('bronze_working');
  game.players[1].techs.push('biology');
  eq(strategic(game, game.players[0]).iron.have, 4, 'russia doubles');
  eq(strategic(game, game.players[1]).oil.have, 4, 'arabia doubles oil');
  Object.assign(game.tiles[neighbours(game.grid, home.tile)[0]], { resource: 'iron', amount: 3 });
  game.players[1].techs.push('bronze_working');
  game.players[1].influence[cs] = 80;
  eq(strategic(game, game.players[1]).iron.have, 3, "an ally's iron");
  adopt(game, 1, 'cultural_diplomacy');
  eq(strategic(game, game.players[1]).iron.have, 6, 'cultural diplomacy doubles it');
});

test('free buildings in the first cities: Legalism now and for cities founded later', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(3, 3));
  city(game, 0, at(10, 3));
  applyOnce(game, p, ALL_POLICIES.legalism.effects, null);
  eq(game.cities.filter((c) => c.buildings.includes('monument')).length, 2, 'two cities now');
  for (const t of [at(17, 3), at(3, 10), at(10, 10)]) city(game, 0, t);
  eq(game.cities.filter((c) => c.buildings.includes('monument')).length, 4, 'four in all');
});

test('free great person of one’s choosing: chosen by order, or for them at the turn’s end', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(5, 5));
  applyOnce(game, p, ALL_POLICIES.liberty_done.effects, null);
  eq(p.greatChoices, 1, 'a choice waits');
  ok(apply(game, 0, { t: 'greatChoice', kind: 'engineer' }).ok, 'choose an engineer');
  ok(game.units.some((u) => u.type === 'great_engineer'), 'an engineer is born');
  ok(!apply(game, 0, { t: 'greatChoice', kind: 'engineer' }).ok, 'only one');
  applyOnce(game, p, ALL_POLICIES.hero_of_the_people.effects, null);
  p.greatPoints.merchant = 50;
  endTurn(game);
  ok(game.units.some((u) => u.type === 'great_merchant'), 'the nearest kind, unchosen');
});

test('weighing fights: a civ’s happiness worked out once while they’re weighed, afresh after', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(8, 8), { pop: 4 });
  const before = happiness(game, p);
  const [first, again] = weighing(game, () => {
    const first = happiness(game, p);
    // (A change weighing mustn't make: to show the happiness kept.)
    c.pop += 6;
    return [first, happiness(game, p)];
  });
  eq(first, before, 'as it was');
  eq(again, first, 'kept while weighing');
  ok(happiness(game, p) < before, 'and worked out afresh after');
});

test('a free great person is born in the capital itself with a worker in it (a soldier too), not beside it', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const capital = city(game, 0, at(5, 5));
  unit(game, 'worker', 0, capital.tile);
  applyOnce(game, p, { freeGreatPerson: 'scientist' }, capital);
  eq(game.units.find((u) => u.type === 'great_scientist')?.tile, capital.tile, 'a great scientist, in the capital beside its worker');
  unit(game, 'warrior', 0, capital.tile);
  applyOnce(game, p, { freeGreatPerson: 'engineer' }, capital);
  eq(game.units.find((u) => u.type === 'great_engineer')?.tile, capital.tile, 'a great engineer, with a warrior there too');
  const settler = unit(game, 'settler', 0, neighbours(game.grid, capital.tile).find((t) => canStand(game, 'settler', t))!);
  ok(!canEnter(game, settler, capital.tile), 'other civilians still one to a tile');
});

test('the Terracotta Army copies each land unit; Clausewitz’s Legacy runs out', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(5, 5));
  unit(game, 'warrior', 0, at(7, 7));
  unit(game, 'archer', 0, at(9, 7));
  applyOnce(game, p, BUILDINGS.terracotta_army.effects, c);
  eq(game.units.filter((u) => u.owner === 0).length, 4, 'copies');
  const soldier = unit(game, 'warrior', 0, at(20, 15));
  const enemy = unit(game, 'warrior', 1, at(21, 15));
  const base = strength(game, soldier, 'attack', enemy, soldier.tile);
  adopt(game, 0, 'clausewitzs_legacy');
  p.policyTurns = { clausewitzs_legacy: game.turn };
  near(strength(game, soldier, 'attack', enemy, soldier.tile) / base, 1.25, 'clausewitz attacking');
  game.turn += 40;
  near(strength(game, soldier, 'attack', enemy, soldier.tile) / base, 1, 'over after 50 turns (at quick speed, 34)');
});

test('workers: the Pyramids and Citizenship each a quarter faster', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(5, 5));
  techsTo(game, 0, 1);
  const w = unit(game, 'worker', 0, at(6, 5));
  ok(apply(game, 0, { t: 'build', unit: w.id, what: 'farm' }).ok, 'build a farm');
  endTurn(game);
  eq(w.work?.done, 1, 'one turn');
  c.buildings.push('pyramids');
  adopt(game, 0, 'citizenship');
  w.moves = 2;
  endTurn(game);
  eq(w.work?.done, 2.5, 'half again');
  void p;
});

test('workers: their card is told the turns left at their pace, and how far along; told again, they carry on', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(5, 5));
  techsTo(game, 0, 1);
  const w = unit(game, 'worker', 0, at(6, 5));
  const left = () => viewFor(game, p, null).units.find((x) => x.id === w.id)!.work!;
  ok(apply(game, 0, { t: 'build', unit: w.id, what: 'farm' }).ok, 'build a farm');
  const total = workTurns(game, 'farm');
  eq(left().turns, total, 'all of it, this turn the first');
  eq(left().progress, 0, 'nothing done yet');
  endTurn(game);
  eq(left().turns, total - 1, 'a turn less');
  near(left().progress, 1 / total, 'a turn of it done');
  ok(apply(game, 0, { t: 'build', unit: w.id, what: 'farm' }).ok, 'told again');
  eq(w.work?.done, 1, 'what it had done is kept');
  w.moves = 0;
  eq(left().turns, total, 'with no moves left, this turn does no work');
  w.moves = 2;
  adopt(game, 0, 'citizenship');
  eq(left().turns, Math.ceil((total - 1) / 1.25), 'a quarter faster');
});

// -------------------------------------------------------------------------------------------------
// Combat
// -------------------------------------------------------------------------------------------------

/** A fight laid out: an attacker of player 0 next to a defender of player 1, at war, on open ground. */
function duel(attacker = 'warrior', defender = 'warrior') {
  const w = blank(['egypt', 'babylon']);
  war(w.game, 0, 1);
  const a = unit(w.game, attacker, 0, w.at(10, 8));
  const d = unit(w.game, defender, 1, w.at(11, 8));
  return { ...w, a, d };
}

test('flanking: +10% for each other attacker beside the defender', () => {
  const { game, at, a, d } = duel();
  const base = strength(game, a, 'attack', d, a.tile);
  const around = neighbours(game.grid, d.tile).filter((t) => t !== a.tile);
  unit(game, 'warrior', 0, around[0]);
  unit(game, 'archer', 0, around[1]);
  near(strength(game, a, 'attack', d, a.tile) / base, 1.2, 'two flankers');
  void at;
});

test('rivers and the sea: -20% attacking into a river, -50% from a boat; boats can’t fire', () => {
  const { game, a, d } = duel();
  const base = strength(game, a, 'attack', d, a.tile);
  game.tiles[d.tile].river = true;
  near(strength(game, a, 'attack', d, a.tile) / base, 0.8, 'across a river');
  game.tiles[a.tile].river = true;
  near(strength(game, a, 'attack', d, a.tile) / base, 1, 'along the river');
  a.embarked = true;
  near(strength(game, a, 'attack', d, a.tile) / base, 0.5, 'from the sea');
  const { game: g2, a: archer, d: target } = duel('archer');
  archer.embarked = true;
  ok(!apply(g2, 0, { t: 'attack', unit: archer.id, target: target.tile }).ok, 'no fire from a boat');
  target.embarked = true;
  ok(strength(g2, target, 'defend', archer, target.tile) <= 3 + g2.players[1].techs.length * 0.2, 'embarked units are weak');
});

test('cover counts only against fire', () => {
  const { game, a, d } = duel('warrior', 'warrior');
  const archer = unit(game, 'archer', 0, neighbours(game.grid, d.tile).find((t) => t !== a.tile)!);
  const melee = strength(game, d, 'defend', a, d.tile);
  const fire = strength(game, d, 'defend', archer, d.tile);
  d.promotions.push('cover_1');
  near(strength(game, d, 'defend', a, d.tile) / melee, 1, 'no cover against a sword');
  near(strength(game, d, 'defend', archer, d.tile) / fire, 1.25, 'cover against arrows');
});

test('terrain, fortifying, forts and citadels', () => {
  const { game, at, a, d } = duel('warrior', 'spearman');
  const open = strength(game, d, 'defend', a, d.tile);
  game.tiles[d.tile].elevation = 'hills';
  near(strength(game, d, 'defend', a, d.tile) / open, 1.25, 'hills');
  game.tiles[d.tile].elevation = 'flat';
  ok(apply(game, 1, { t: 'stance', unit: d.id, stance: 'fortify' }).ok, 'fortify');
  near(strength(game, d, 'defend', a, d.tile) / open, 1, 'no bonus the turn it fortifies');
  d.fortified = 1;
  near(strength(game, d, 'defend', a, d.tile) / open, 1.25, 'a turn later');
  d.fortified = 2;
  near(strength(game, d, 'defend', a, d.tile) / open, 1.5, 'two turns later');
  d.stance = undefined;
  game.tiles[d.tile].owner = 1;
  game.tiles[d.tile].improvement = 'fort';
  near(strength(game, d, 'defend', a, d.tile) / open, 1.5, 'a fort');
  game.tiles[d.tile].improvement = 'citadel';
  near(strength(game, d, 'defend', a, d.tile) / open, 2, 'a citadel');
  const hp = a.hp;
  endTurn(game);
  ok(a.hp < hp || !game.units.includes(a), 'the citadel hurts the enemy beside it');
  const horse = unit(game, 'horseman', 1, at(3, 15));
  ok(!apply(game, 1, { t: 'stance', unit: horse.id, stance: 'fortify' }).ok, "horsemen can't fortify");
  const flat = strength(game, horse, 'defend', null, horse.tile);
  game.tiles[horse.tile].elevation = 'hills';
  near(strength(game, horse, 'defend', null, horse.tile) / flat, 1, 'no hill bonus for horsemen');
  game.tiles[horse.tile].feature = 'marsh';
  near(strength(game, horse, 'defend', null, horse.tile) / flat, 0.85, 'but the marsh still hurts');
});

test('great generals and admirals lead units within two tiles (China’s, twice as well)', () => {
  const { game, at, a } = duel();
  eq(leadership(game, a, a.tile), 0, 'no general');
  const g = unit(game, 'great_general', 0, at(8, 8));
  eq(leadership(game, a, a.tile), 15, 'a general two tiles off');
  g.tile = at(6, 8);
  eq(leadership(game, a, a.tile), 0, 'too far');
  g.tile = at(9, 8);
  game.tiles[at(9, 9)].terrain = 'coast';
  const ship = unit(game, 'trireme', 0, at(9, 9));
  eq(leadership(game, ship, ship.tile), 0, 'generals lead land units only');
  unit(game, 'great_admiral', 0, at(9, 9));
  eq(leadership(game, ship, ship.tile), 15, 'admirals lead ships');
  const china = blank(['china', 'egypt']);
  const s = unit(china.game, 'warrior', 0, china.at(5, 5));
  unit(china.game, 'great_general', 0, china.at(5, 6));
  eq(leadership(china.game, s, s.tile), 30, "china's generals");
});

test('great general points come from fights with civs (not barbarians), and a general is born at the front', () => {
  const { game, at, a, d } = duel('swordsman', 'warrior');
  city(game, 0, at(2, 2));
  const [p, q] = game.players;
  ok(apply(game, 0, { t: 'attack', unit: a.id, target: d.tile }).ok, 'attack');
  eq(p.greatPoints.general, 5, 'five points for attacking');
  eq(q.greatPoints.general, 4, 'four for defending');
  // (One fight short of a general.)
  p.greatPoints.general = greatCost(game, p, 'general') - 1;
  const foe = unit(game, 'warrior', 1, neighbours(game.grid, a.tile).find((t) => !game.units.some((u) => u.tile === t))!);
  a.moves = 2;
  a.attacks = 0;
  ok(apply(game, 0, { t: 'attack', unit: a.id, target: foe.tile }).ok, 'attack again');
  const general = game.units.find((u) => u.type === 'great_general');
  ok(!!general && general.owner === 0, 'a general is born');
  ok(Math.abs(general!.tile - a.tile) <= 2 * game.grid.width + 2, 'by the army, not at the capital');
  ok(p.greatPoints.general! < 5, 'its points spent');
  const sea = blank(['egypt', 'babylon']);
  war(sea.game, 0, 1);
  for (const t of [sea.at(10, 8), sea.at(11, 8)]) sea.game.tiles[t].terrain = 'coast';
  const ship = unit(sea.game, 'trireme', 0, sea.at(10, 8));
  const target = unit(sea.game, 'trireme', 1, sea.at(11, 8));
  apply(sea.game, 0, { t: 'attack', unit: ship.id, target: target.tile });
  eq(sea.game.players[0].greatPoints.admiral, 5, 'admiral points at sea');
  const barb = blank(['egypt', 'babylon'], { barbarians: true });
  const b = barb.game.players.findIndex((x) => x.civ === 'barbarian');
  const me = unit(barb.game, 'swordsman', 0, barb.at(10, 8));
  const them = unit(barb.game, 'warrior', b, barb.at(11, 8));
  me.xp = 28;
  apply(barb.game, 0, { t: 'attack', unit: me.id, target: them.tile });
  eq(me.xp, 30, 'barbarian experience stops at 30');
  eq(barb.game.players[0].greatPoints.general ?? 0, 0, 'no general points from barbarians');
});

test('an unhappy empire fights 2% worse for each point below zero', () => {
  const { game, at, a, d } = duel();
  city(game, 0, at(3, 3), { pop: 12 });
  const p = game.players[0];
  const mood = happiness(game, p);
  ok(mood < 0, 'unhappy');
  const s = strength(game, a, 'attack', d, a.tile);
  p.cityState = { kind: 'maritime', personality: 'x' };
  const calm = strength(game, a, 'attack', d, a.tile);
  near(s / calm, 1 + (2 * mood) / 100, 'penalty');
});

test('combat effects: Discipline, Honor, Statue of Zeus, Heroic Epic, Defender of the Faith, Just War', () => {
  const { game, at, a, d } = duel();
  const base = strength(game, a, 'attack', d, a.tile);
  adopt(game, 0, 'discipline');
  near(strength(game, a, 'attack', d, a.tile) / base, 1, 'alone');
  unit(game, 'archer', 0, at(9, 8));
  ok(strength(game, a, 'attack', d, a.tile) / base > 1.14, 'beside a friend');
  const barb = blank(['egypt', 'babylon'], { barbarians: true });
  const b = barb.game.players.findIndex((x) => x.civ === 'barbarian');
  const me = unit(barb.game, 'warrior', 0, barb.at(10, 8));
  const them = unit(barb.game, 'warrior', b, barb.at(11, 8));
  const vsBarb = strength(barb.game, me, 'attack', them, me.tile);
  adopt(barb.game, 0, 'honor');
  near(strength(barb.game, me, 'attack', them, me.tile) / vsBarb, 1.33, 'honor vs barbarians');
  const town = city(game, 1, at(12, 9));
  city(game, 0, at(2, 2));
  const vsCity = strength(game, a, 'attack', town, a.tile);
  game.cities.find((x) => x.tile === at(2, 2))!.buildings.push('statue_of_zeus');
  near(strength(game, a, 'attack', town, a.tile) - vsCity, 8 * 0.15, 'statue of zeus vs cities');
  const epic = city(game, 0, at(2, 12), { buildings: ['barracks', 'heroic_epic'] });
  ok(apply(game, 0, { t: 'buy', city: epic.id, item: { kind: 'unit', id: 'warrior' }, with: 'gold' }).ok || (game.players[0].gold = 9999, apply(game, 0, { t: 'buy', city: epic.id, item: { kind: 'unit', id: 'warrior' }, with: 'gold' }).ok), 'buy a warrior');
  const fresh = game.units.find((u) => u.owner === 0 && u.tile !== a.tile && cityAt(game, u.tile) === epic)!;
  ok(fresh.promotions.includes('morale') && fresh.xp >= 15, 'morale and barracks experience');
  eq(promotionsDue(fresh), 1, 'morale does not use up experience');
  // The religion's enhancers.
  const g = game;
  g.religions.r1 = { founder: 0, holyCity: -1, name: 'Test', beliefs: ['tithe', 'mosques', 'defender_of_the_faith', 'just_war'] };
  g.players[0].religion = 'r1';
  town.followers = { r1: town.pop };
  const inTheirs = strength(game, a, 'defend', d, a.tile);
  game.tiles[a.tile].owner = 1;
  game.tiles[a.tile].city = town.id;
  near(strength(game, a, 'defend', d, a.tile) - inTheirs, 8 * 0.2, "just war in the faithful enemy's land");
});

test('promotions are data: terrain, range, moves, sight, attacks', () => {
  const { game, a, d } = duel('swordsman', 'warrior');
  const base = strength(game, a, 'attack', d, a.tile);
  a.promotions.push('shock_1', 'drill_1');
  near(strength(game, a, 'attack', d, a.tile) / base, 1.15, 'shock in the open, not drill');
  game.tiles[d.tile].feature = 'forest';
  near(strength(game, a, 'attack', d, a.tile) / base, 1.15, 'drill in the forest, not shock');
  const moves = maxMoves(game, a);
  const sight = unitSight(game, a);
  a.promotions.push('mobility', 'sentry');
  eq(maxMoves(game, a) - moves, 1, 'mobility');
  eq(unitSight(game, a) - sight, 1, 'sentry');
});

test('the governor never starves a city it could feed, and keeps it growing on a balanced focus', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(10, 8), { pop: 3 });
  // Three hills (no food, more production: the balanced focus's first pick) and three tundra (a little food).
  neighbours(game.grid, c.tile).forEach((t, i) => Object.assign(game.tiles[t], i < 3 ? { elevation: 'hills' } : { terrain: 'tundra' }));
  assignCitizens(game, c);
  eq(c.worked.length, 3, 'citizens at work');
  ok(cityYields(game, c).surplus >= 0, `it eats (works ${c.worked.map((t) => game.tiles[t].elevation === 'hills' ? 'hills' : game.tiles[t].terrain).join(', ')})`);
  c.focus = 'prod';
  assignCitizens(game, c);
  ok(cityYields(game, c).surplus >= 0, 'it eats with a production focus too');
  // A capital of one by a gold mine (its best tile, no food) and grassland: balanced, it grows.
  const small = blank();
  const capital = city(small.game, 0, small.at(10, 8), { pop: 1 });
  const mine = neighbours(small.game.grid, capital.tile)[0];
  Object.assign(small.game.tiles[mine], { elevation: 'hills', resource: 'gold_ore', improvement: 'mine' });
  assignCitizens(small.game, capital);
  ok(cityYields(small.game, capital).surplus >= 2, 'balanced, it grows');
  capital.focus = 'gold';
  assignCitizens(small.game, capital);
  eq(capital.worked[0], mine, 'on a gold focus, the mine');
});

test('units pass through their own side’s units, but never stop on them', () => {
  const { game, at } = blank();
  const a = unit(game, 'swordsman', 0, at(10, 8));
  const b = unit(game, 'warrior', 0, at(11, 8));
  ok(apply(game, 0, { t: 'move', unit: a.id, to: at(12, 8) }).ok, 'a way past the warrior');
  eq(a.tile, at(12, 8), 'it went through');
  eq(b.tile, at(11, 8), 'the warrior stays');
  // A tile it would have to stop on: it waits before it.
  const w1 = unit(game, 'warrior', 0, at(13, 8));
  const w2 = unit(game, 'warrior', 0, at(14, 8));
  a.moves = 1;
  ok(apply(game, 0, { t: 'move', unit: a.id, to: at(15, 8) }).ok, 'ordered on');
  ok(a.tile !== w1.tile && a.tile !== w2.tile, 'one move left and two of its own ahead: it goes round them, never onto one');
  ok(!!a.path?.length, 'and keeps its way for next turn');
  apply(game, 0, { t: 'move', unit: b.id, to: at(13, 8) });
  eq(b.tile, at(11, 8), 'never onto one of its own');
  // Two of its own in a row: a knight (4 moves) goes through both.
  const k = unit(game, 'knight', 0, at(11, 10));
  unit(game, 'warrior', 0, at(12, 10));
  unit(game, 'warrior', 0, at(13, 10));
  ok(apply(game, 0, { t: 'move', unit: k.id, to: at(15, 10) }).ok, 'past two');
  eq(k.tile, at(15, 10), 'through both, the same turn');
  // A way that would end a turn on one of its own (hills there take all its moves): round it instead.
  const w = unit(game, 'warrior', 0, at(4, 14));
  unit(game, 'archer', 0, at(5, 14));
  game.tiles[at(5, 14)].elevation = 'hills';
  ok(apply(game, 0, { t: 'move', unit: w.id, to: at(7, 14) }).ok, 'ordered past the archer on the hill');
  ok(w.tile !== at(4, 14) && w.tile !== at(5, 14), 'it went round, not stuck behind it');
  // One of its own where a later turn would end: the straight way still (it'll have moved on by then, or it goes round it there).
  const s = unit(game, 'swordsman', 0, at(4, 4));
  // (A pass of hills, mountains on either side.)
  for (let x = 3; x <= 9; x++) for (const y of [3, 5]) game.tiles[at(x, y)].elevation = 'mountain';
  for (let x = 5; x <= 8; x++) game.tiles[at(x, 4)].elevation = 'hills';
  unit(game, 'archer', 0, at(6, 4));
  ok(apply(game, 0, { t: 'move', unit: s.id, to: at(8, 4) }).ok, 'ordered along the hills');
  eq(s.tile, at(5, 4), 'a hill a turn, straight on');
  ok(s.path?.[0] === at(6, 4), 'its way goes on through the archer’s hill, for next turn');
  // Round one of its own where this turn would end, not round all those further on (a marching army).
  const { game: g2, at: at2 } = blank();
  const r = unit(g2, 'warrior', 0, at2(4, 8));
  unit(g2, 'archer', 0, at2(5, 8));
  g2.tiles[at2(5, 8)].elevation = 'hills';
  for (let y = 0; y < 16; y++) unit(g2, 'warrior', 0, at2(8, y));
  ok(apply(g2, 0, { t: 'move', unit: r.id, to: at2(10, 8) }).ok, 'ordered past the archer and on through the line of its own');
  ok(r.tile !== at2(4, 8) && (r.path?.length ?? 0) <= 6, 'round the archer, then straight on through the line');
  // Through one of its own to a fork, the turn ending on another of its own on the near way: the other way, through the first still.
  const { game: g3, at: at3 } = blank();
  const start = at3(10, 8);
  const scout = unit(g3, 'warrior', 0, start);
  const [gate, ...shut] = neighbours(g3.grid, start);
  for (const t of shut) g3.tiles[t].elevation = 'mountain';
  const fork = neighbours(g3.grid, gate).filter((t) => distance(g3.grid, t, start) === 2);
  const [side, far, ...rest] = fork;
  for (const t of rest) g3.tiles[t].elevation = 'mountain';
  g3.tiles[far].elevation = 'hills';
  unit(g3, 'spearman', 0, gate);
  unit(g3, 'archer', 0, side);
  const goal = neighbours(g3.grid, far).find((t) => distance(g3.grid, t, start) === 3 && g3.tiles[t].elevation === 'flat')!;
  ok(apply(g3, 0, { t: 'move', unit: scout.id, to: goal }).ok, 'ordered through the gate');
  eq(scout.tile, far, 'its turn ends on the free side of the fork, past its spearman');
  // Behind two of its own in a pass, its turn would end on the second: it waits for them, its way kept (not the long way round).
  const { game: g4, at: at4 } = blank();
  for (let x = 2; x <= 12; x++) for (const y of [7, 9]) g4.tiles[at4(x, y)].elevation = 'mountain';
  const back = unit(g4, 'warrior', 0, at4(4, 8));
  unit(g4, 'spearman', 0, at4(5, 8));
  unit(g4, 'archer', 0, at4(6, 8));
  ok(apply(g4, 0, { t: 'move', unit: back.id, to: at4(10, 8) }).ok, 'ordered down the pass');
  eq(back.tile, at4(4, 8), 'it waits behind them this turn');
  eq(back.path?.length, 6, 'its way straight down the pass, kept for next turn');
  // Both fortified there (they won't move on): round the mountains instead, never waiting on them.
  const { game: g5, at: at5 } = blank();
  for (let x = 2; x <= 12; x++) for (const y of [7, 9]) g5.tiles[at5(x, y)].elevation = 'mountain';
  const round = unit(g5, 'warrior', 0, at5(4, 8));
  unit(g5, 'spearman', 0, at5(5, 8)).stance = 'fortify';
  unit(g5, 'archer', 0, at5(6, 8)).stance = 'fortify';
  ok(apply(g5, 0, { t: 'move', unit: round.id, to: at5(10, 8) }).ok, 'ordered down the pass');
  ok(round.tile !== at5(4, 8) && !round.path?.includes(at5(6, 8)), 'the way round, not through the archer set to stay');
});

test('a siege unit sets up as it fires when it has the moves for both (Civ V’s)', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  const t = unit(game, 'trebuchet', 0, at(10, 8));
  const d = unit(game, 'warrior', 1, at(12, 8));
  // (A siege unit sees only a tile round it, Civ V's: another unit spots for it.)
  unit(game, 'warrior', 0, at(11, 7));
  game.players[0].techs.push('physics');
  t.moves = 1;
  ok(!apply(game, 0, { t: 'attack', unit: t.id, target: d.tile }).ok, 'one move: no');
  t.moves = 2;
  ok(apply(game, 0, { t: 'attack', unit: t.id, target: d.tile }).ok, 'two moves: set up and fire');
  ok(!!t.setUp && d.hp < 100, 'set up, and hit it');
});

test('line of sight (Civ V’s): forest, jungle, hills and mountains block a shot past them, not at them; next door always; from a hill, only wooded hills and mountains', () => {
  const { game, at } = blank();
  const from = at(10, 8);
  const between = at(11, 8);
  const past = at(12, 8);
  const set = (t: number, elevation: Elevation, feature?: FeatureId) => Object.assign(game.tiles[t], { elevation, feature });
  ok(canFire(game, from, past, 2), 'over open ground');
  for (const [elevation, feature] of [['flat', 'forest'], ['flat', 'jungle'], ['hills', undefined], ['mountain', undefined]] as const) {
    set(between, elevation, feature);
    ok(!canFire(game, from, past, 2), `not past ${feature ?? elevation}`);
    ok(canFire(game, from, between, 2), `at ${feature ?? elevation} next door`);
  }
  set(between, 'flat', 'marsh');
  ok(canFire(game, from, past, 2), 'past marsh');
  set(between, 'flat');
  set(past, 'hills', 'forest');
  ok(canFire(game, from, past, 2), 'at a wooded hill, nothing between');
  set(past, 'flat');
  set(from, 'flat', 'forest');
  set(between, 'flat', 'forest');
  ok(!canFire(game, from, past, 2), 'standing in a forest is no help');
  set(from, 'hills');
  for (const [elevation, feature, sees] of [['flat', 'forest', true], ['flat', 'jungle', true], ['hills', undefined, true], ['hills', 'forest', false], ['hills', 'jungle', false], ['mountain', undefined, false]] as const) {
    set(between, elevation, feature);
    eq(canFire(game, from, past, 2), sees, `from a hill, past ${feature ? `${feature} on ` : ''}${elevation}`);
  }
  // Sight goes the same way.
  set(from, 'flat');
  set(between, 'flat', 'forest');
  unit(game, 'warrior', 0, from);
  const sees = (t: number) => game.players[0].visible[t] > 0;
  ok(sees(between) && !sees(past), 'it sees the forest, not past it');
  set(from, 'hills');
  updateAllVisibility(game);
  ok(sees(past), 'from a hill, past it');
  set(between, 'hills', 'forest');
  updateAllVisibility(game);
  ok(!sees(past), 'not past a wooded hill');
});

test('line of sight: two tiles off, a shot passing between two tiles is stopped only when both block; further, by any it crosses, or two it runs beside', () => {
  const { game, at } = blank();
  const from = at(10, 8);
  const off = at(11, 9);
  const wood = (...ts: number[]) => {
    for (const t of game.tiles) delete t.feature;
    for (const t of ts) game.tiles[t].feature = 'forest';
  };
  const sides = neighbours(game.grid, from).filter((t) => neighbours(game.grid, off).includes(t));
  eq(sides.length, 2, 'two tiles between');
  for (const t of sides) {
    wood(t);
    ok(canFire(game, from, off, 2), 'round the other side of one');
  }
  wood(...sides);
  ok(!canFire(game, from, off, 2), 'not between two');
  // Looking round it, a unit sees there too.
  wood(sides[0]);
  unit(game, 'warrior', 0, from);
  ok(game.players[0].visible[off] > 0, 'and sees it');
  // Three off (a longbowman's range): it crosses (11, 8) and (11, 9), and runs beside (10, 9) and (12, 8).
  const far = at(12, 9);
  for (const t of [at(11, 8), at(11, 9)]) {
    wood(t);
    ok(!canFire(game, from, far, 3), 'three off, not past a tile it crosses');
  }
  for (const t of [at(10, 9), at(12, 8)]) {
    wood(t);
    ok(canFire(game, from, far, 3), 'one beside it is no matter');
  }
  wood(at(10, 9), at(12, 8));
  ok(!canFire(game, from, far, 3), 'two beside it block it');
  wood(at(12, 8));
  ok(!canFire(game, from, at(13, 8), 3), 'nor round one on a straight line');
});

test('Indirect Fire: Artillery, Rocket Artillery and the Battleship fire over what blocks, at what their side sees; ranged units earn it after Accuracy III or Barrage III; cities fire over it all', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  game.tiles[at(11, 8)].feature = 'forest';
  const gun = unit(game, 'artillery', 0, at(10, 8), { moves: 2 });
  const foe = unit(game, 'warrior', 1, at(12, 8));
  ok(!apply(game, 0, { t: 'attack', unit: gun.id, target: foe.tile }).ok, 'not at what its side can’t see');
  unit(game, 'scout', 0, at(13, 8));
  ok(apply(game, 0, { t: 'attack', unit: gun.id, target: foe.tile }).ok, 'over the forest, at what a scout sees');
  ok(foe.hp < 100, 'and hits it');
  for (const [type, has] of [['artillery', true], ['rocket_artillery', true], ['battleship', true], ['cannon', false], ['frigate', false], ['missile_cruiser', false], ['crossbowman', false]] as const) eq(indirectFire({ ...gun, type }), has, type);
  ok(!canFire(game, at(10, 8), foe.tile, 2, indirectFire({ ...gun, type: 'cannon' })), 'a cannon can’t');
  // The promotion.
  const bow = unit(game, 'crossbowman', 0, at(4, 4), { xp: 200 });
  const offered = () => promotionsFor(bow).some((p) => p.id === 'indirect_fire');
  bow.promotions = ['accuracy_1', 'accuracy_2'];
  ok(!offered(), 'not before Accuracy III');
  bow.promotions.push('accuracy_3');
  ok(offered(), 'after Accuracy III');
  bow.promotions = ['barrage_1', 'barrage_2', 'barrage_3'];
  ok(offered(), 'or Barrage III');
  ok(apply(game, 0, { t: 'promote', unit: bow.id, promotion: 'indirect_fire' }).ok, 'taken');
  ok(indirectFire(bow), 'it fires over what’s in the way');
  gun.promotions = ['accuracy_1', 'accuracy_2', 'accuracy_3'];
  ok(!promotionsFor(gun).some((p) => p.id === 'indirect_fire'), 'not offered to Artillery, which has it');
  // A city fires over forest at whatever its side sees.
  const c = city(game, 0, at(10, 14));
  game.tiles[at(11, 14)].feature = 'forest';
  const raider = unit(game, 'warrior', 1, at(12, 14));
  unit(game, 'scout', 0, at(13, 14));
  ok(apply(game, 0, { t: 'cityFire', city: c.id, target: raider.tile }).ok, 'the city fires past the forest');
});

test('a soldier stepping onto an enemy’s civilian takes it; at peace it can’t step there', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  const w = unit(game, 'warrior', 0, at(10, 8));
  const worker = unit(game, 'worker', 1, at(12, 8));
  ok(apply(game, 0, { t: 'move', unit: w.id, to: at(12, 8) }).ok, 'ordered onto it');
  eq(w.tile, at(12, 8), 'it got there');
  eq(worker.owner, 0, 'and took the worker');
  const peace = blank();
  const v = unit(peace.game, 'warrior', 0, peace.at(10, 8));
  const theirs = unit(peace.game, 'worker', 1, peace.at(11, 8));
  apply(peace.game, 0, { t: 'move', unit: v.id, to: theirs.tile });
  ok(v.tile !== theirs.tile && theirs.owner === 1, 'at peace: not onto their worker');
});

test('a city struck by an enemy tells its owner, once for each city however many blows; a civilian is never sent at an enemy', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  game.players[0].bot = false;
  const c = city(game, 0, at(10, 8));
  game.players[0].notes = [];
  for (const t of neighbours(game.grid, c.tile).slice(0, 2)) {
    const a = unit(game, 'swordsman', 1, t);
    apply(game, 1, { t: 'attack', unit: a.id, target: c.tile });
  }
  const told = game.players[0].notes.filter((n) => n.text.startsWith(`${c.name} is under attack`));
  eq(told.length, 1, 'one note');
  ok(told[0].text.includes(`down to ${c.hp} of`), 'with what its defences are down to now');
  const w = unit(game, 'worker', 0, at(10, 11));
  const foe = unit(game, 'warrior', 1, at(10, 13));
  ok(!apply(game, 0, { t: 'move', unit: w.id, to: foe.tile }).ok, 'a worker isn’t sent at an enemy');
});

test('a caravan starts its route from a city of yours it stands next to (one with a civilian in it trains it outside)', () => {
  const { game, at } = blank();
  const home = city(game, 0, at(10, 8));
  const other = city(game, 0, at(16, 8));
  unit(game, 'great_general', 0, home.tile);
  game.players[0].techs.push('animal_husbandry');
  const c = unit(game, 'caravan', 0, at(11, 8));
  const r = apply(game, 0, { t: 'trade', unit: c.id, to: other.id });
  ok(r.ok, `a route from next door (${r.error ?? ''})`);
  ok(!game.units.includes(c), 'the caravan is used');
  const far = unit(game, 'caravan', 0, at(13, 12));
  ok(!apply(game, 0, { t: 'trade', unit: far.id, to: other.id }).ok, 'not from out in the country');
});

test('a city ringed by its own civilians sends its new unit two tiles out, not waiting for room', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(10, 8));
  for (const t of within(game.grid, c.tile, 1)) unit(game, 'worker', 0, t);
  c.queue = [{ kind: 'unit', id: 'worker' }];
  c.prod = 1000;
  const before = game.units.length;
  endTurn(game);
  eq(game.units.length, before + 1, 'trained');
  const made = game.units[game.units.length - 1];
  eq(distance(game.grid, made.tile, c.tile), 2, 'two tiles out');
  ok(neighbours(game.grid, made.tile).some((n) => distance(game.grid, n, c.tile) === 1 && game.tiles[n].terrain !== 'lake'), 'by land from the city');
});

test('a city taken takes the civilians in it too', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  const c = city(game, 1, at(10, 8));
  const worker = unit(game, 'worker', 1, c.tile);
  const caravan = unit(game, 'caravan', 1, c.tile);
  c.hp = 1;
  const s = unit(game, 'swordsman', 0, neighbours(game.grid, c.tile)[0]);
  ok(apply(game, 0, { t: 'attack', unit: s.id, target: c.tile }).ok, 'attacked');
  eq(c.owner, 0, 'the city is taken');
  eq(worker.owner, 0, 'and its worker with it');
  ok(!game.units.includes(caravan), 'and the caravan waiting there killed');
});

test('a caravan may wait in its own city beside a worker (other civilians one to a tile), and set off from it', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const home = city(game, 0, at(8, 8), { pop: 4 });
  const abroad = city(game, 1, at(13, 8), { pop: 4 });
  techsTo(game, 0, 3);
  unit(game, 'worker', 0, home.tile);
  const [a, b, c] = neighbours(game.grid, home.tile).filter((t) => canStand(game, 'caravan', t));
  const caravan = unit(game, 'caravan', 0, a);
  const settler = unit(game, 'settler', 0, b);
  ok(!apply(game, 0, { t: 'move', unit: settler.id, to: home.tile }).ok, 'a settler waits outside while the worker is in');
  ok(apply(game, 0, { t: 'move', unit: caravan.id, to: home.tile }).ok && caravan.tile === home.tile, 'a caravan goes in beside it');
  ok(apply(game, 0, { t: 'trade', unit: caravan.id, to: abroad.id }).ok, 'and sets off from there');
  const outsider = unit(game, 'caravan', 1, c);
  ok(!canEnter(game, outsider, home.tile), 'not into another civ’s city');
});

test('a city taken can be razed (not an original capital): a citizen a turn, then gone', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  city(game, 0, at(4, 4));
  const capital = city(game, 1, at(16, 12));
  const town = city(game, 1, at(10, 8), { pop: 3 });
  for (const c of [capital, town]) {
    c.hp = 1;
    const s = unit(game, 'swordsman', 0, neighbours(game.grid, c.tile)[0]);
    ok(apply(game, 0, { t: 'attack', unit: s.id, target: c.tile }).ok, `${c.name} attacked`);
  }
  eq(town.owner, 0, 'taken');
  ok(town.puppet === true, 'a puppet at first');
  ok(!apply(game, 0, { t: 'cityChoice', city: capital.id, choice: 'raze' }).ok, 'not their original capital');
  ok(apply(game, 0, { t: 'cityChoice', city: town.id, choice: 'raze' }).ok, 'the town is razed');
  const pop = town.pop;
  for (let i = 0; i < pop; i++) endTurn(game);
  ok(!game.cities.includes(town), 'burned to the ground');
  ok(game.tiles[town.tile].owner === -1, 'its land is no one’s');
});

test('a settler whose site is taken on the way stops and says so; founding too close names the city', () => {
  const { game, at } = blank();
  game.players[0].bot = false;
  city(game, 0, at(2, 2));
  city(game, 1, at(24, 16));
  const s = unit(game, 'settler', 0, at(4, 8));
  ok(apply(game, 0, { t: 'move', unit: s.id, to: at(14, 8) }).ok, 'sent to a site');
  const rival = city(game, 1, at(15, 8));
  endTurn(game);
  ok(!s.path, 'it stops');
  ok(game.players[0].notes.some((n) => n.text.includes(`${rival.name} has been founded beside it`)), 'and says why');
  s.tile = at(14, 8);
  const r = apply(game, 0, { t: 'found', unit: s.id });
  ok(!r.ok && !!r.error?.includes(rival.name), `the refusal names the city (${r.error})`);
});

test('a unit whose way is blocked on the way goes round; with no way round it stops and says so', () => {
  const { game, at } = blank();
  game.players[0].bot = false;
  city(game, 0, at(2, 2));
  city(game, 1, at(24, 16));
  const w = unit(game, 'worker', 0, at(4, 8));
  ok(apply(game, 0, { t: 'move', unit: w.id, to: at(12, 8) }).ok, 'sent off');
  // Someone else's soldier stands on its way, at peace: round it.
  const stand = w.path![2];
  unit(game, 'warrior', 1, stand);
  endTurn(game);
  endTurn(game);
  endTurn(game);
  endTurn(game);
  eq(w.tile, at(12, 8), 'it got there, round them');
  // In a pass held by another's soldier: no way round, it stops and says so.
  const { game: g2, at: b } = blank();
  g2.players[0].bot = false;
  city(g2, 0, b(2, 2));
  city(g2, 1, b(24, 16));
  for (let x = 0; x < g2.grid.width; x++) for (const y of [7, 9]) g2.tiles[b(x, y)].elevation = 'mountain';
  const v = unit(g2, 'worker', 0, b(4, 8));
  ok(apply(g2, 0, { t: 'move', unit: v.id, to: b(12, 8) }).ok, 'sent down the pass');
  unit(g2, 'warrior', 1, b(8, 8));
  endTurn(g2);
  endTurn(g2);
  ok(!v.path, 'it stops');
  ok(g2.players[0].notes.some((n) => n.text.includes('way is blocked')), 'and says so');
});

test('a person’s unit moved onto one of its own of its kind next to it swaps places with it', () => {
  const { game, at } = blank();
  game.players[0].bot = false;
  const c = city(game, 0, at(10, 8));
  const worker = unit(game, 'worker', 0, c.tile);
  // (A settler: a great person would simply join the worker in its city.)
  const settler = unit(game, 'settler', 0, neighbours(game.grid, c.tile)[0]);
  const from = settler.tile;
  ok(apply(game, 0, { t: 'move', unit: settler.id, to: c.tile }).ok, 'ordered into the city');
  eq(settler.tile, c.tile, 'the settler is in the city');
  eq(worker.tile, from, 'the worker where it was');
  // Not two tiles off, and not a soldier with a civilian.
  const far = unit(game, 'worker', 0, at(14, 8));
  ok(!apply(game, 0, { t: 'move', unit: far.id, to: from }).ok || far.tile !== from, 'no swap from afar');
});

test('two of a person’s units whose ways cross, each stopping on the other’s tile, swap places and go on', () => {
  const { game, at } = blank();
  game.players[0].bot = false;
  city(game, 0, at(2, 2));
  city(game, 1, at(24, 16));
  // A pass between mountains, two hills in it: a step onto either takes a warrior's every move.
  for (let x = 0; x < game.grid.width; x++) for (const y of [7, 9]) game.tiles[at(x, y)].elevation = 'mountain';
  game.tiles[at(8, 8)].elevation = game.tiles[at(9, 8)].elevation = 'hills';
  const east = unit(game, 'warrior', 0, at(8, 8));
  const west = unit(game, 'warrior', 0, at(9, 8));
  ok(apply(game, 0, { t: 'move', unit: east.id, to: at(13, 8) }).ok, 'one sent east');
  eq(east.tile, at(8, 8), 'it waits: the other is on the hill ahead');
  ok(apply(game, 0, { t: 'move', unit: west.id, to: at(4, 8) }).ok, 'the other sent west');
  eq(west.tile, at(8, 8), 'they swap places');
  eq(east.tile, at(9, 8), 'each where the other was');
  for (let i = 0; i < 4; i++) endTurn(game);
  eq(east.tile, at(13, 8), 'and each goes on its way');
  eq(west.tile, at(4, 8), 'both of them');
});

test('the advisor’s research picks name no wonder someone has built already', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const [egypt] = game.players;
  city(game, 0, at(4, 4));
  city(game, 1, at(22, 15));
  egypt.bot = false;
  // (A wonder named in a pick's words: 'Hanging Gardens, a wonder; and the Granary'.)
  const wonder = (why: string) => why.includes(', a wonder');
  ok(adviseResearch(game, egypt).some((a) => wonder(a.why)), 'a wonder among them at first');
  for (const b of Object.values(BUILDINGS)) if (b.kind === 'world') game.wonders[b.id] = 1;
  const picks = adviseResearch(game, egypt);
  ok(picks.length > 0 && !picks.some((a) => wonder(a.why)), `none once every wonder is built (${picks.map((a) => a.why).join('; ')})`);
});

test('a worker with no recommended work is told why: enemies in reach of the land, or nothing near it', () => {
  const { game, at } = blank();
  const egypt = game.players[0];
  egypt.bot = false;
  egypt.techs = ['agriculture'];
  const home = city(game, 0, at(6, 6));
  city(game, 1, at(22, 15));
  const w = unit(game, 'worker', 0, home.tile);
  updateAllVisibility(game);
  const calm = adviseWork(game, egypt, w);
  ok(calm.tips.length > 0 && !calm.quiet, 'work advised round its city');
  war(game, 0, 1);
  unit(game, 'swordsman', 1, at(8, 6));
  updateAllVisibility(game);
  const threatened = adviseWork(game, egypt, w);
  eq(threatened.tips.length, 0, 'none with an enemy in reach of it all');
  ok(!!threatened.quiet?.startsWith('Enemies could reach the land near it'), `and it says so (${threatened.quiet})`);
  const away = adviseWork(game, egypt, unit(game, 'worker', 0, at(16, 2)));
  ok(!!away.quiet?.startsWith('Nothing near it to improve'), `far from its cities: nothing near (${away.quiet})`);
});

test('Future Tech, all else known, goes on by itself once learned', () => {
  const { game } = blank();
  const p = game.players[0];
  p.techs = Object.keys(TECHS).filter((t) => t !== 'future_tech');
  p.researching = 'future_tech';
  learn(game, p, 'future_tech');
  eq(p.researching, 'future_tech', 'the next Future Tech under way');
  eq(p.futureTechs, 1, 'one learned');
});

test('a long march stops when enemies come in sight', () => {
  const { game, at } = blank();
  game.players[0].bot = false;
  war(game, 0, 1);
  // (Each with a city, to stay in the game turn after turn.)
  city(game, 0, at(1, 1));
  city(game, 1, at(24, 16));
  const t = unit(game, 'spearman', 0, at(4, 8));
  ok(apply(game, 0, { t: 'move', unit: t.id, to: at(16, 8) }).ok, 'off it goes');
  const where = t.tile;
  unit(game, 'pikeman', 1, at(where % game.grid.width + 2, 8));
  endTurn(game);
  eq(t.tile, where, 'it waits');
  ok(!t.path, 'for new orders');
  ok(game.players[0].notes.some((n) => n.text.includes('has stopped')), 'and says why');
  // Sent on again with that one in sight: it doesn't stop for it again, turn after turn.
  game.players[0].notes = [];
  ok(apply(game, 0, { t: 'move', unit: t.id, to: at(16, 11) }).ok, 'sent on');
  endTurn(game);
  endTurn(game);
  ok(!game.players[0].notes.some((n) => n.text.includes('has stopped')), 'no stop for an enemy it has seen');
  ok(t.tile !== where, 'it went on');
  // Another enemy it hadn't seen: it stops for that one.
  ok(!!t.path?.length, 'still on its way');
  const at2 = t.tile;
  unit(game, 'spearman', 1, neighbours(game.grid, t.tile).find((n) => !game.units.some((x) => x.tile === n) && distance(game.grid, n, where) > 2)!);
  updateAllVisibility(game);
  endTurn(game);
  eq(t.tile, at2, 'a new one stops it');
  ok(game.players[0].notes.some((n) => n.text.includes('Spearman')), 'and says which');
  // One coming into sight on the way: it stops there and then, its moves kept.
  const { game: g2, at: b } = blank();
  g2.players[0].bot = false;
  war(g2, 0, 1);
  city(g2, 0, b(1, 1));
  const w = unit(g2, 'warrior', 0, b(4, 8));
  unit(g2, 'warrior', 1, b(6, 6));
  updateAllVisibility(g2);
  ok(apply(g2, 0, { t: 'move', unit: w.id, to: b(12, 8) }).ok, 'off it goes');
  ok(w.tile !== b(4, 8) && (w.moves ?? 0) > 0 && !w.path, 'it stopped as the enemy came into sight, a move to spare');
});

test('meeting goes both ways, and lasts', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const [a, b] = game.players;
  // (Nothing seen yet of the map it began with.)
  for (const p of game.players) p.explored.fill(0);
  const scout = unit(game, 'scout', 0, at(10, 8));
  city(game, 1, at(20, 14));
  ok(!hasMet(game, a, b) && !hasMet(game, b, a), 'strangers at first');
  scout.tile = at(18, 14);
  updateAllVisibility(game);
  ok(hasMet(game, a, b), 'the scout sees their land');
  ok(hasMet(game, b, a), 'and they have met it too, seen or not');
  scout.tile = at(2, 2);
  updateAllVisibility(game);
  ok(hasMet(game, a, b) && hasMet(game, b, a), 'out of sight, still met');
});

test('units in land closed to them are moved out as the turn ends, soldiers and civilians alike (they could never step anywhere there)', () => {
  const { game, at } = blank();
  city(game, 0, at(2, 2));
  const theirs = city(game, 1, at(10, 8));
  const [inside, beside, third, fourth] = neighbours(game.grid, theirs.tile);
  const w = unit(game, 'warrior', 0, inside);
  const worker = unit(game, 'worker', 0, beside);
  const musician = unit(game, 'great_musician', 0, third);
  const missionary = unit(game, 'missionary', 0, fourth);
  endTurn(game);
  ok(game.tiles[w.tile].owner !== 1, 'the warrior is out of their land');
  eq(distance(game.grid, w.tile, inside), 1, 'to the nearest tile outside (next door: their land is one ring)');
  ok(game.tiles[worker.tile].owner !== 1 && distance(game.grid, worker.tile, beside) === 1, 'the worker too');
  ok(game.tiles[musician.tile].owner !== 1, 'and a great person');
  eq(missionary.tile, fourth, 'a missionary may stay (closed borders don’t keep the faith out)');
  w.tile = inside;
  worker.tile = beside;
  game.players[1].diplomacy.openBorders[0] = 10;
  endTurn(game);
  eq(w.tile, inside, 'with open borders the warrior stays');
  eq(worker.tile, beside, 'and the worker');
  // Open borders ended: out they go.
  game.players[1].diplomacy.openBorders[0] = 0;
  endTurn(game);
  ok(game.tiles[w.tile].owner !== 1 && game.tiles[worker.tile].owner !== 1, 'once their borders close again, both are moved out');
});

test('closed borders keep civilians out as well as soldiers: no order into another civ’s land in peace, ways go round it; open borders, a war or a city-state’s land let them in; the faith goes in regardless', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const [egypt, babylon] = game.players;
  egypt.bot = false;
  const theirs = city(game, 1, at(10, 8));
  const inside = neighbours(game.grid, theirs.tile)[0];
  const worker = unit(game, 'worker', 0, at(10, 4));
  const settler = unit(game, 'settler', 0, at(10, 3));
  const caravan = unit(game, 'caravan', 0, at(9, 3));
  const musician = unit(game, 'great_musician', 0, at(11, 3));
  for (const u of [worker, settler, caravan, musician]) ok(!canEnter(game, u, inside), `a ${u.type} can't step into their land`);
  const refused = apply(game, 0, { t: 'move', unit: worker.id, to: inside });
  ok(!refused.ok && !!refused.error?.includes('borders are closed'), `the order is refused, and says why (${refused.error})`);
  eq(worker.tile, at(10, 4), 'the worker stays put');
  // Across their land: round it.
  const way = planPath(game, settler, at(10, 13))!;
  ok(!!way?.length, 'a settler finds a way past them');
  ok(way.every((t) => game.tiles[t].owner !== 1), 'round their land, not through it');
  // Faith goes in without leave.
  ok(canEnter(game, unit(game, 'missionary', 0, at(8, 4)), inside), 'a missionary may go in');
  ok(canEnter(game, unit(game, 'great_prophet', 0, at(12, 4)), inside), 'and a Great Prophet');
  // Open borders we've given them don't open their land to us; theirs given to us do.
  egypt.diplomacy.openBorders[1] = 10;
  ok(!canEnter(game, worker, inside), 'our borders open to them: theirs still closed to us');
  babylon.diplomacy.openBorders[0] = 10;
  for (const u of [worker, settler, caravan, musician]) ok(canEnter(game, u, inside), `with their borders open, a ${u.type} may go in`);
  babylon.diplomacy.openBorders[0] = 0;
  war(game, 0, 1);
  ok(canEnter(game, worker, inside), 'at war, their land is no longer closed');
  // A city-state's land is open to all.
  const cs = game.players.find((p) => p.cityState)!;
  const town = city(game, cs.index, at(18, 12));
  ok(canEnter(game, unit(game, 'worker', 0, at(18, 9)), neighbours(game.grid, town.tile)[0]), 'a city-state’s land is open to everyone');
});

test('a bot’s settler doesn’t head for a site its land is cut off from by land closed to it; open borders, and it does', () => {
  const sites = (wall: boolean, open = false) => {
    const { game, at } = blank();
    const [egypt, babylon] = game.players;
    // Poor land west, good land east.
    for (let t = 0; t < game.tiles.length; t++) if (colOf(game.grid, t) < 12) game.tiles[t].terrain = 'snow';
    city(game, 0, at(4, 8));
    const settler = unit(game, 'settler', 0, at(8, 8));
    if (wall) for (let t = 0; t < game.tiles.length; t++) if (colOf(game.grid, t) === 12 || colOf(game.grid, t) === 13) game.tiles[t].owner = 1;
    if (open) babylon.diplomacy.openBorders[0] = 10;
    for (let t = 0; t < game.tiles.length; t++) egypt.explored[t] = 1;
    const site = bestSite(makeCtx(game, egypt), settler.tile, settler);
    return site && colOf(game.grid, site.tile);
  };
  ok((sites(false) ?? 0) > 13, 'with nothing in the way, the good land east');
  ok((sites(true) ?? 0) < 12, 'beyond another’s closed land, not');
  ok((sites(true, true) ?? 0) > 13, 'with their borders open to it, east again');
});

test('a bot’s worker passes over a job it can’t get to past land closed to it for one it can', () => {
  const run = (wall: boolean) => {
    const { game, at } = blank();
    const egypt = game.players[0];
    techsTo(game, 0, 4);
    city(game, 0, at(4, 8));
    city(game, 0, at(17, 8));
    const worker = unit(game, 'worker', 0, at(9, 8));
    // A luxury by the eastern city, the western one's land bare.
    const lux = neighbours(game.grid, at(17, 8))[3];
    game.tiles[lux].resource = 'wine';
    game.tiles[lux].terrain = 'plains';
    if (wall) for (let t = 0; t < game.tiles.length; t++) if (colOf(game.grid, t) === 12 || colOf(game.grid, t) === 13) game.tiles[t].owner = 1;
    for (let t = 0; t < game.tiles.length; t++) egypt.explored[t] = 1;
    const ctx = makeCtx(game, egypt);
    workers(ctx, [worker]);
    return { to: ctx.mem.orders[worker.id]?.to, lux, moved: worker.tile !== at(9, 8), col: (t: number) => colOf(game.grid, t) };
  };
  const free = run(false);
  eq(free.to, free.lux, 'nothing in the way: off to the luxury');
  const walled = run(true);
  ok(walled.to !== undefined && walled.col(walled.to) < 12, 'walled off from it: a job on its own side');
  ok(walled.moved, 'and it sets off this turn');
});

test('news names only civs the reader has met, and speaks to who it’s about', () => {
  const { game } = blank(['egypt', 'babylon', 'germany']);
  const [me, friend, stranger] = game.players;
  me.bot = friend.bot = false;
  me.met = [friend.index];
  friend.met = [me.index, stranger.index];
  stranger.faith = friend.faith = 999;
  // (Their eurekas had: Writing's, for having met someone, isn't the news here.)
  for (const p of game.players) p.eurekas = Object.keys(EUREKAS);
  const said = (p: typeof me) => p.notes.splice(0).map((n) => n.text);
  ok(apply(game, stranger.index, { t: 'pantheon', belief: 'god_of_war' }).ok, 'a pantheon');
  eq(said(me).length, 0, 'no news of a pantheon from a civ never met');
  ok(said(friend)[0]?.startsWith(stranger.name), 'named to one who has met them');
  ok(apply(game, friend.index, { t: 'war', target: stranger.index }).ok, 'war');
  const news = said(me)[0] ?? '';
  ok(news.startsWith(friend.name) && news.includes("a civilization you haven't met"), `the stranger unnamed: ${news}`);
  eq(said(friend).length, 0, 'the one declaring is not told');
  stranger.met = [friend.index];
  eq(denounce(game, stranger, friend), null, 'denounced');
  const told = said(me)[0] ?? '';
  ok(told.startsWith('A civilization you haven') && told.includes(friend.name), `my friend denounced by a stranger: ${told}`);
  eq(said(friend)[0], `${stranger.name} has denounced you!`, 'the denounced is told in its own words');
});

test('happiness is told in parts that add up to it', () => {
  const { game, at } = blank();
  city(game, 0, at(10, 8), { pop: 6, buildings: ['colosseum'] });
  city(game, 0, at(4, 4), { pop: 3 });
  game.players[0].policies.push('liberty', 'meritocracy');
  const parts: { label: string; value: number }[] = [];
  const total = happiness(game, game.players[0], parts);
  const sum = parts.reduce((s, x) => s + x.value, 0);
  ok(Math.abs(sum - total) <= 1, `parts ${parts.map((x) => `${x.label} ${x.value}`).join(', ')} make ${sum}, not ${total}`);
  ok(parts.some((x) => x.label.startsWith('Cities') && x.value === -2 * UNHAPPINESS_PER_CITY), 'two cities');
  ok(parts.some((x) => x.label === 'Citizens' && x.value === -9), 'nine citizens');
});

test('a sensible empire is about content: four cities with two luxuries and a Circus; five with three, two Colosseums and Monarchy', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const sites = [at(4, 4), at(9, 4), at(4, 9), at(9, 9), at(14, 4)];
  const cities = sites.slice(0, 4).map((t) => city(game, 0, t, { pop: 3, buildings: ['monument'] }));
  const luxury = (i: number, res: string) => Object.assign(game.tiles[neighbours(game.grid, cities[i].tile)[0]], { resource: res, improvement: 'mine' });
  luxury(0, 'gold_ore');
  luxury(1, 'silver');
  cities[0].buildings.push('circus');
  const early = happiness(game, p);
  ok(early >= 0 && early <= 3, `early on: four cities of three, two luxuries, a Circus (${early})`);
  cities.push(city(game, 0, sites[4], { pop: 4, buildings: ['monument'] }));
  cities[0].pop = 7;
  for (const c of cities.slice(1)) c.pop = 4;
  luxury(2, 'gems');
  cities[0].buildings.push('colosseum');
  cities[1].buildings.push('colosseum');
  adopt(game, 0, 'monarchy');
  const later = happiness(game, p);
  ok(later >= 0 && later <= 3, `later: five cities (23 citizens), three luxuries, two Colosseums and Monarchy (${later})`);
});

test('a new city on open grassland reaches size 5 in about 25 turns at quick speed while its empire is content; unhappy, a quarter as fast (never stopped above -10)', () => {
  const toFive = (unhappy: boolean) => {
    const { game, at } = blank();
    const capital = city(game, 0, at(3, 3), { pop: 1 });
    neighbours(game.grid, capital.tile).slice(0, 2).forEach((t, i) => Object.assign(game.tiles[t], { resource: i ? 'silver' : 'gold_ore', improvement: 'mine' }));
    if (unhappy) for (const t of [at(20, 3), at(20, 12)]) city(game, 0, t, { pop: 6 });
    const c = city(game, 0, at(10, 8));
    const mood = happiness(game, game.players[0]);
    ok(unhappy ? mood < 0 && mood > -10 : mood >= 0, unhappy ? 'an unhappy empire' : 'a content one (two luxuries)');
    let turns = 0;
    while (c.pop < 5 && turns < 200) {
      endTurn(game);
      turns++;
    }
    return turns;
  };
  const content = toFive(false);
  ok(content >= 20 && content <= 30, `content: ${content} turns`);
  const unhappy = toFive(true);
  ok(unhappy >= content * 3 && unhappy < 200, `unhappy: growth slowed to a quarter (${unhappy} turns), not stopped`);
});

test('going wide is braked: eleven cities on three luxuries and two Colosseums are deeply unhappy; luxuries, a Colosseum each and a policy make them content', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const cities: ReturnType<typeof city>[] = [];
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4 && cities.length < 11; col++) cities.push(city(game, 0, at(3 + col * 6, 3 + row * 6), { pop: 4, buildings: ['monument'] }));
  const luxuries = ['gold_ore', 'silver', 'gems', 'copper', 'marble', 'pearls'];
  const luxury = (i: number) => Object.assign(game.tiles[neighbours(game.grid, cities[i].tile)[0]], { resource: luxuries[i], improvement: luxuries[i] === 'marble' ? 'quarry' : luxuries[i] === 'pearls' ? 'fishing_boats' : 'mine' });
  for (let i = 0; i < 3; i++) luxury(i);
  cities[0].buildings.push('colosseum');
  cities[1].buildings.push('colosseum');
  const wide = happiness(game, p);
  ok(wide <= -15, `eleven cities of four on three luxuries and two Colosseums: ${wide}`);
  for (let i = 3; i < 5; i++) luxury(i);
  for (const c of cities) if (!c.buildings.includes('colosseum')) c.buildings.push('colosseum');
  adopt(game, 0, 'monarchy');
  const built = happiness(game, p);
  ok(built >= 0, `with five luxuries, a Colosseum in every city and Monarchy: ${built}`);
});

test('the happiness curve: a few cities with a luxury or two are content; going wide needs more', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const cities = [at(4, 4), at(9, 4), at(4, 9)].map((t) => city(game, 0, t, { pop: 3 }));
  for (const [i, res] of ['gold_ore', 'silver'].entries()) Object.assign(game.tiles[neighbours(game.grid, cities[i].tile)[0]], { resource: res, improvement: 'mine' });
  ok(happiness(game, p) >= 0, `three cities of three with two luxuries are content (${happiness(game, p)})`);
  for (const t of [at(9, 9), at(14, 4), at(14, 9), at(19, 4), at(19, 9)]) city(game, 0, t, { pop: 4 });
  ok(happiness(game, p) < -5, `eight cities on two luxuries and nothing built are not (${happiness(game, p)})`);
  const mood = happiness(game, p);
  cities[2].puppet = true;
  eq(happiness(game, p) - mood, UNHAPPINESS_PER_CITY / 2, 'a puppet counts half');
});

test('what a city could train but for something missing is said, not hidden', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(10, 8), { pop: 1 });
  game.players[0].techs.push('bronze_working', 'iron_working');
  const why = (id: string) => trainOptions(game, game.players[0], c).find((o) => o.id === id)?.why ?? '';
  ok(why('settler').includes('city of 2'), `a settler waits for a second citizen (${why('settler')})`);
  ok(why('swordsman').includes('Iron'), `a swordsman waits for iron (${why('swordsman')})`);
  ok(!trainable(game, game.players[0], c).includes('swordsman'), 'and neither can be trained');
  c.pop = 2;
  ok(trainable(game, game.players[0], c).includes('settler'), 'a city of 2 trains settlers');
});

test('a repeating city builds its units again', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(10, 8), { pop: 3 });
  ok(apply(game, 0, { t: 'repeat', city: c.id, on: true }).ok, 'repeat on');
  c.queue = [{ kind: 'unit', id: 'warrior' }];
  c.prod = 999;
  endTurn(game);
  eq(c.queue.map((q) => q.id).join(), 'warrior', 'a warrior again');
  ok(game.units.some((u) => u.type === 'warrior' && u.owner === 0), 'and the first one made');
  ok(!apply(game, 0, { t: 'repeat', city: c.id, on: 'yes' as unknown as boolean }).ok, 'only yes or no');
  ok(apply(game, 0, { t: 'repeat', city: c.id, on: false }).ok && !c.repeat, 'repeat off');
});

test('what’s bought leaves the queue: the building wherever it is, the unit only if it’s being built now', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(10, 8), { pop: 3 });
  p.gold = 9999;
  c.queue = [{ kind: 'building', id: 'monument' }, { kind: 'unit', id: 'warrior' }, { kind: 'unit', id: 'warrior' }];
  c.prod = 10;
  ok(apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'building', id: 'monument' }, with: 'gold' }).ok, 'buy the monument');
  eq(c.queue.map((q) => q.id).join(), 'warrior,warrior', 'the monument is out of the queue');
  eq(c.prod, 10, 'what was put into it goes to the warrior');
  ok(apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'unit', id: 'warrior' }, with: 'gold' }).ok, 'buy a warrior');
  eq(c.queue.map((q) => q.id).join(), 'warrior', 'the one being built is the one bought');
  c.queue.push({ kind: 'unit', id: 'scout' });
  game.units = game.units.filter((u) => u.tile !== c.tile);
  ok(apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'unit', id: 'scout' }, with: 'gold' }).ok, 'buy a scout');
  eq(c.queue.map((q) => q.id).join(), 'warrior,scout', 'a unit further down the queue stays in it');
});

test('pillage: only an enemy’s (or no one’s) improvement or road; heals, gold, no yields until repaired', () => {
  const { game, at, a } = duel();
  const theirs = city(game, 1, at(14, 8));
  const farm = neighbours(game.grid, theirs.tile)[0];
  Object.assign(game.tiles[farm], { improvement: 'farm' });
  a.tile = farm;
  a.hp = 50;
  ok(canPillage(game, a), 'can pillage at war');
  const gold = game.players[0].gold;
  const food = cityYields(game, theirs).food;
  theirs.locked = [farm];
  assignCitizens(game, theirs);
  const worked = cityYields(game, theirs).food;
  ok(apply(game, 0, { t: 'pillage', unit: a.id }).ok, 'pillage');
  ok(game.tiles[farm].pillaged === true, 'pillaged');
  eq(a.hp, 75, 'heals 25');
  ok(game.players[0].gold > gold, 'gold');
  ok(cityYields(game, theirs).food < worked, 'the farm yields nothing');
  ok(!canPillage(game, a), 'not twice');
  void food;
  const peace = blank();
  const mine = city(peace.game, 1, peace.at(10, 8));
  const t = neighbours(peace.game.grid, mine.tile)[0];
  peace.game.tiles[t].road = 'road';
  const s = unit(peace.game, 'warrior', 0, t);
  ok(!canPillage(peace.game, s), 'not at peace');
  const own = unit(peace.game, 'warrior', 1, neighbours(peace.game.grid, mine.tile)[1]);
  peace.game.tiles[own.tile].improvement = 'farm';
  ok(!canPillage(peace.game, own), 'not your own');
  peace.game.tiles[peace.at(2, 2)].road = 'road';
  const wild = unit(peace.game, 'warrior', 0, peace.at(2, 2));
  ok(canPillage(peace.game, wild), "a road in no one's land");
  const w = unit(game, 'worker', 1, farm);
  game.tiles[farm].owner = 1;
  ok(apply(game, 1, { t: 'build', unit: w.id, what: 'repair' }).ok, 'repair');
  for (let i = 0; i < 3; i++) endTurn(game);
  ok(!game.tiles[farm].pillaged, 'repaired');
});

test('healing by place: city, own land, no one’s, enemy land, ships, boats, medics', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  const home = city(game, 0, at(5, 5));
  const theirs = city(game, 1, at(18, 5));
  const s = unit(game, 'warrior', 0, home.tile);
  eq(healing(game, s), 25, 'in a city');
  s.tile = neighbours(game.grid, home.tile)[0];
  eq(healing(game, s), 20, 'own land');
  s.tile = at(11, 12);
  eq(healing(game, s), 15, "no one's land");
  s.tile = neighbours(game.grid, theirs.tile)[0];
  eq(healing(game, s), 10, "the enemy's");
  const medic = unit(game, 'warrior', 0, neighbours(game.grid, s.tile).find((t) => t !== theirs.tile && !cityAt(game, t))!, { promotions: ['medic_1', 'medic_2'] });
  eq(healing(game, s), 20, 'beside a medic');
  void medic;
  game.tiles[at(11, 14)].terrain = 'coast';
  const ship = unit(game, 'trireme', 0, at(11, 14));
  eq(healing(game, ship), 0, 'ships heal only at home');
  const admiral = unit(game, 'great_admiral', 0, at(11, 14));
  eq(healing(game, ship), 15, 'beside an admiral');
  void admiral;
  s.embarked = true;
  eq(healing(game, s), 0, 'at sea in a boat');
  s.embarked = false;
  s.hp = 50;
  s.moves = 0;
  const hp = s.hp;
  endTurn(game);
  eq(s.hp, hp, 'no healing after moving');
  s.promotions.push('march');
  s.moves = 0;
  endTurn(game);
  ok(s.hp > hp, 'march heals anyway');
});

test('a taken city: plunder (doubled by a Burial Tomb), and its wonders go to the captor', () => {
  const { game, at, a } = duel('swordsman');
  const c = city(game, 1, at(11, 9), { pop: 4, buildings: ['great_library'] });
  c.wonders = ['great_library'];
  game.wonders.great_library = 1;
  const gold = plunder(game, c);
  c.buildings.push('burial_tomb');
  eq(plunder(game, c), 2 * gold, 'burial tomb doubles');
  c.buildings.pop();
  c.hp = 1;
  a.tile = at(10, 9);
  const before = game.players[0].gold;
  const scoreBefore = score(game, game.players[0]);
  for (const u of game.units.filter((x) => x.owner === 1)) game.units.splice(game.units.indexOf(u), 1);
  ok(apply(game, 0, { t: 'attack', unit: a.id, target: c.tile }).ok, 'attack');
  eq(c.owner, 0, 'taken');
  ok(game.players[0].gold - before >= gold - 1, 'plundered');
  eq(game.wonders.great_library, 0, 'the wonder is ours');
  ok(score(game, game.players[0]) > scoreBefore + 20, 'and counts for our score');
});

test('upgrades: a move left, the resource, the price (a third less with Professional Army)', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(5, 5));
  const w = unit(game, 'warrior', 0, at(6, 5));
  p.techs.push('iron_working', 'bronze_working');
  p.gold = 1000;
  w.moves = 0;
  ok(!apply(game, 0, { t: 'upgrade', unit: w.id }).ok, 'needs a move');
  w.moves = 2;
  ok(!apply(game, 0, { t: 'upgrade', unit: w.id }).ok, 'needs iron');
  Object.assign(game.tiles[at(4, 5)], { resource: 'iron', amount: 2, improvement: 'mine', owner: 0 });
  const cost = upgradeCost(game, p, w);
  adopt(game, 0, 'professional_army');
  ok(upgradeCost(game, p, w) < cost, 'cheaper');
  ok(apply(game, 0, { t: 'upgrade', unit: w.id }).ok, 'upgraded');
  eq(w.type, 'swordsman', 'a swordsman');
});

test('a frigate upgrades to a battleship (Electronics, Oil), not to Combustion’s destroyer: a ship keeps its kind, ranged or melee', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(5, 5));
  Object.assign(game.tiles[at(6, 5)], { terrain: 'coast', owner: 0 });
  const frigate = unit(game, 'frigate', 0, at(6, 5));
  techsTo(game, 0, 11);
  p.techs.push('electronics');
  ok(!p.techs.includes('combustion'), 'Electronics, not Combustion');
  p.gold = 1000;
  eq(upgradeTo(p, frigate), 'battleship', 'it would be a battleship');
  ok(!apply(game, 0, { t: 'upgrade', unit: frigate.id }).ok, 'needs oil');
  Object.assign(game.tiles[at(4, 5)], { resource: 'oil', amount: 2, improvement: 'oil_well', owner: 0 });
  ok(apply(game, 0, { t: 'upgrade', unit: frigate.id }).ok, 'upgraded');
  eq(frigate.type, 'battleship', 'a battleship');
  for (const u of Object.values(UNITS)) if (u.domain === 'sea' && u.upgrade) eq(UNITS[u.upgrade].class, u.class, `${u.name} upgrades to a ship of its kind`);
});

test('units upgrade along Civ V’s lines (Brave New World’s), and none goes out of production before the unit it upgrades to can be built', () => {
  const lines = [
    ['warrior', 'swordsman', 'longswordsman', 'musketman', 'rifleman', 'great_war_infantry', 'infantry', 'mechanized_infantry'],
    ['spearman', 'pikeman', 'lancer', 'anti_tank_gun', 'helicopter_gunship'],
    ['horseman', 'knight', 'cavalry', 'landship', 'tank', 'modern_armor', 'giant_death_robot'],
    ['chariot_archer', 'knight'],
    ['archer', 'composite_bowman', 'crossbowman', 'gatling_gun', 'machine_gun', 'bazooka'],
    ['catapult', 'trebuchet', 'cannon', 'artillery', 'rocket_artillery'],
    ['anti_aircraft_gun', 'mobile_sam'],
    ['paratrooper', 'xcom_squad'],
    ['trireme', 'caravel', 'ironclad', 'destroyer'],
    ['privateer', 'destroyer'],
    ['galleass', 'frigate', 'battleship'],
    ['submarine', 'nuclear_submarine'],
    ['triplane', 'fighter', 'jet_fighter'],
    ['great_war_bomber', 'bomber', 'stealth_bomber'],
  ];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) eq(UNITS[line[i - 1]].upgrade, line[i], `${UNITS[line[i - 1]].name} upgrades to`);
    if (line[line.length - 1] !== 'knight') eq(UNITS[line[line.length - 1]].upgrade, undefined, `${UNITS[line[line.length - 1]].name} is the last of its line`);
  }
  // A unique unit upgrades as the one it replaces does.
  for (const u of Object.values(UNITS)) if (u.replaces && UNITS[u.replaces].upgrade) eq(u.upgrade, UNITS[u.replaces].upgrade, `${u.name} upgrades as a ${UNITS[u.replaces].name}`);
  // (A tech and every tech before it.)
  const memo = new Map<string, Set<string>>();
  const before = (t: string): Set<string> => {
    if (!memo.has(t)) memo.set(t, new Set([t, ...TECHS[t].needs.flatMap((n) => [...before(n)])]));
    return memo.get(t)!;
  };
  for (const u of Object.values(UNITS)) {
    if (!u.obsolete) continue;
    ok(!u.tech || !before(u.tech).has(u.obsolete), `${u.name} isn’t obsolete before it’s available`);
    const to = u.upgrade && UNITS[u.upgrade];
    ok(!!to, `${u.name} goes out of production with something to upgrade to`);
    ok(!to || !to.tech || before(u.obsolete).has(to.tech), `${u.name} is still built until there are ${to ? to.name : ''}s`);
  }
});

test('a pikeman upgrades to a lancer (Metallurgy, Horses), a knight to cavalry', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(5, 5));
  const pikeman = unit(game, 'pikeman', 0, at(6, 5));
  const knight = unit(game, 'knight', 0, at(4, 5));
  p.techs.push('animal_husbandry', 'metallurgy', 'military_science');
  p.gold = 2000;
  eq(upgradeTo(p, pikeman), 'lancer', 'a lancer');
  eq(upgradeTo(p, knight), 'cavalry', 'cavalry');
  ok(!apply(game, 0, { t: 'upgrade', unit: pikeman.id }).ok, 'needs horses');
  Object.assign(game.tiles[at(5, 6)], { resource: 'horses', amount: 2, improvement: 'pasture', owner: 0 });
  ok(apply(game, 0, { t: 'upgrade', unit: pikeman.id }).ok, 'upgraded');
  eq(pikeman.type, 'lancer', 'a lancer now');
  ok(apply(game, 0, { t: 'upgrade', unit: knight.id }).ok && knight.type === 'cavalry', 'and the knight is cavalry');
});

test('moving: the Great Wall, the Iroquois’ forest paths, zones of control by domain', () => {
  const { game, at } = blank(['egypt', 'iroquois']);
  war(game, 0, 1);
  const wall = city(game, 0, at(10, 8), { buildings: ['great_wall'] });
  const raider = unit(game, 'warrior', 1, at(13, 8));
  const into = neighbours(game.grid, wall.tile)[0];
  const outside = neighbours(game.grid, into).find((t) => game.tiles[t].owner < 0)!;
  ok(stepCost(game, raider, outside, into) > 100, 'the wall takes every move');
  game.players[0].techs.push('dynamite');
  eq(stepCost(game, raider, outside, into), 1, 'not after dynamite');
  const iro = blank(['iroquois', 'egypt']);
  const home = city(iro.game, 0, iro.at(10, 8));
  const [x, y] = neighbours(iro.game.grid, home.tile);
  for (const t of [x, y]) iro.game.tiles[t].feature = 'forest';
  const scout = unit(iro.game, 'warrior', 0, x);
  ok(stepCost(iro.game, scout, x, y) < 1, 'forests as roads');
});

test('paths in a war keep out of enemy cities’ fire and from beside enemy soldiers, and go round by land rather than embark under the walls', () => {
  // On land: round a city's reach, once it's been seen.
  const { game, at } = blank();
  war(game, 0, 1);
  city(game, 0, at(2, 2));
  const enemy = city(game, 1, at(13, 9));
  const u = unit(game, 'swordsman', 0, at(7, 9));
  const inReach = (way: number[], c: number) => way.filter((t) => distance(game.grid, t, c) <= 2).length;
  ok(inReach(planPath(game, u, at(19, 9))!, enemy.tile) > 0, 'a city it hasn’t seen is no danger to it');
  game.players[0].explored[enemy.tile] = 1;
  const way = planPath(game, u, at(19, 9))!;
  eq(inReach(way, enemy.tile), 0, 'round the reach of a city it has seen');
  ok(way.length <= distance(game.grid, u.tile, at(19, 9)) + 4, `and not far round (${way.length} steps)`);
  // Beside an enemy soldier in sight.
  const foe = unit(game, 'warrior', 1, at(7, 14));
  const s = unit(game, 'swordsman', 0, at(5, 14));
  ok(planPath(game, s, at(10, 14))!.every((t) => distance(game.grid, t, foe.tile) > 1), 'not beside an enemy soldier');
  // A bay with an enemy city on an island in it: the way across it by boat is shorter, but under the walls.
  const sea = blank();
  war(sea.game, 0, 1);
  city(sea.game, 0, sea.at(2, 2));
  for (let col = 8; col <= 17; col++) for (let row = 5; row <= 9; row++) sea.game.tiles[sea.at(col, row)].terrain = 'coast';
  const port = city(sea.game, 1, sea.at(12, 7));
  sea.game.players[0].techs.push('optics');
  const walker = unit(sea.game, 'swordsman', 0, sea.at(6, 7));
  const wet = (way: number[]) => way.filter((t) => sea.game.tiles[t].terrain === 'coast').length;
  ok(wet(planPath(sea.game, walker, sea.at(19, 7))!) > 0, 'a city it hasn’t seen: across by boat');
  sea.game.players[0].explored[port.tile] = 1;
  eq(wet(planPath(sea.game, walker, sea.at(19, 7))!), 0, 'one it has: round by land');
  ok(planPath(sea.game, walker, sea.at(19, 7))!.every((t) => distance(sea.game.grid, t, port.tile) > 2), 'out of its reach');
});

test('nuclear weapons: the Manhattan Project first, only at enemies, and what they do', () => {
  const { game, at } = blank();
  const p = game.players[0];
  techsTo(game, 0, 14);
  const c = city(game, 0, at(5, 5));
  Object.assign(game.tiles[at(4, 5)], { resource: 'uranium', amount: 4, improvement: 'mine', owner: 0 });
  ok(!trainable(game, p, c).includes('atomic_bomb'), 'not before the Manhattan Project');
  c.buildings.push('manhattan_project');
  ok(trainable(game, p, c).includes('atomic_bomb'), 'after it');
  const bomb = unit(game, 'atomic_bomb', 0, c.tile);
  const target = city(game, 1, at(12, 5), { pop: 8 });
  ok(!apply(game, 0, { t: 'attack', unit: bomb.id, target: target.tile }).ok, 'not at peace');
  war(game, 0, 1);
  const soldier = unit(game, 'warrior', 1, target.tile);
  ok(apply(game, 0, { t: 'attack', unit: bomb.id, target: target.tile }).ok, 'at war');
  eq(target.pop, 4, 'half the people');
  ok(!game.units.includes(bomb), 'spent');
  ok(!game.units.includes(soldier) || soldier.hp <= 40, 'the garrison is broken');
});

test('paratroopers and airlifts', () => {
  const { game, at } = blank();
  techsTo(game, 0, 13);
  const a = city(game, 0, at(3, 5), { buildings: ['airport'] });
  const b = city(game, 0, at(20, 5));
  const para = unit(game, 'paratrooper', 0, a.tile);
  game.players[0].explored.fill(1);
  ok(!apply(game, 0, { t: 'paradrop', unit: para.id, to: at(15, 5) }).ok, 'too far');
  ok(apply(game, 0, { t: 'paradrop', unit: para.id, to: at(8, 5) }).ok, 'drop');
  eq(para.moves, 0, 'and done for the turn');
  const inf = unit(game, 'infantry', 0, a.tile);
  ok(!apply(game, 0, { t: 'airlift', unit: inf.id, to: b.tile }).ok, 'no airport there');
  b.buildings.push('airport');
  ok(apply(game, 0, { t: 'airlift', unit: inf.id, to: b.tile }).ok, 'airlifted');
  eq(inf.tile, b.tile, 'there');
});

test('submarines are seen only from next to them, or by destroyers within two', () => {
  const { game, at } = blank();
  for (let col = 0; col < 26; col++) for (let row = 10; row < 18; row++) game.tiles[at(col, row)].terrain = 'ocean';
  const sub = unit(game, 'submarine', 1, at(10, 14));
  const ship = unit(game, 'trireme', 0, at(12, 14));
  game.players[0].visible[sub.tile] = 1;
  ok(!seesUnit(game, game.players[0], sub), 'unseen two tiles off');
  ship.tile = at(11, 14);
  ok(seesUnit(game, game.players[0], sub), 'seen next to it');
  ship.type = 'destroyer';
  ship.tile = at(12, 14);
  ok(seesUnit(game, game.players[0], sub), 'destroyers hunt them');
});

test('rewards for kills: the Aztecs’ culture, Honor’s gold, God of War’s faith; the Jaguar heals', () => {
  const { game, at } = blank(['aztec', 'egypt']);
  war(game, 0, 1);
  city(game, 0, at(8, 8));
  const p = game.players[0];
  adopt(game, 0, 'honor_done');
  p.pantheon = 'god_of_war';
  const j = unit(game, 'jaguar', 0, at(10, 8), { hp: 60 });
  const victim = unit(game, 'worker', 1, at(11, 8));
  victim.type = 'scout';
  victim.hp = 1;
  const before = { culture: p.culture, gold: p.gold, faith: p.faith };
  ok(apply(game, 0, { t: 'attack', unit: j.id, target: victim.tile }).ok, 'attack');
  ok(!game.units.includes(victim), 'killed');
  ok(p.culture > before.culture, 'culture');
  ok(p.gold > before.gold, 'gold');
  ok(p.faith > before.faith, 'faith near our city');
  ok(j.hp >= 60, 'the jaguar heals on a kill');
  const forest = strength(game, j, 'defend', null, j.tile);
  game.tiles[j.tile].feature = 'jungle';
  ok(strength(game, j, 'defend', null, j.tile) / forest > 1.5, 'jaguars in the jungle (and its cover)');
});

test('cities’ strength: Goddess of Protection, the Kremlin; Oligarchy’s garrisoned fire', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(5, 5), { pop: 5 });
  const p = game.players[0];
  const s = cityStrength(game, c);
  p.pantheon = 'goddess_of_protection';
  near(cityStrength(game, c), Math.round(s * 1.3 * 10) / 10, 'goddess of protection');
  p.pantheon = undefined;
  city(game, 0, at(15, 5), { buildings: ['kremlin'] });
  ok(cityStrength(game, c) > s * 1.2, 'the kremlin reaches every city');
  const fire = cityFireStrength(game, c);
  adopt(game, 0, 'oligarchy');
  eq(cityFireStrength(game, c), fire, 'no garrison');
  unit(game, 'warrior', 0, c.tile);
  ok(cityFireStrength(game, c) > fire * 1.4, 'garrisoned');
});

test('siege: a catapult outlives two shots from a walled city; three and a swordsman take it in six turns', () => {
  for (const seed of [11, 222, 3333]) {
    const { game, at } = blank();
    game.rng = seed;
    techsTo(game, 0, 4);
    techsTo(game, 1, 4);
    city(game, 0, at(2, 2));
    city(game, 1, at(22, 15));
    const c = city(game, 1, at(14, 9), { pop: 5, buildings: ['walls'] });
    c.hp = cityMaxHp(game, c);
    unit(game, 'spearman', 1, c.tile, { stance: 'fortify', fortified: 2 });
    war(game, 0, 1);
    const ring = (n: number) => within(game.grid, c.tile, n).filter((t) => distance(game.grid, t, c.tile) === n);
    const catapults = ring(2).slice(0, 3).map((t) => unit(game, 'catapult', 0, t));
    const sword = unit(game, 'swordsman', 0, ring(1)[0]);
    const shot = damageFor(cityFireStrength(game, c), strength(game, catapults[0], 'defend', c, catapults[0].tile), 36);
    ok(shot * 2 < 100, `two of the city's hardest shots leave a catapult standing (${shot} each)`);
    eq(previewCityFire(game, c, catapults[0].tile)?.defender.damage[1], shot, 'the preview shows the shot as fired');
    let turns = 1;
    for (; turns <= 6 && c.owner === 1; turns++) {
      // The city fires at the most hurt catapult; the catapults fire; the swordsman goes in once it would take the city on an even roll.
      const target = catapults.filter((u) => game.units.includes(u)).sort((a, b) => a.hp - b.hp)[0];
      if (target) apply(game, 1, { t: 'cityFire', city: c.id, target: target.tile });
      for (const u of catapults) if (game.units.includes(u)) apply(game, 0, { t: 'attack', unit: u.id, target: c.tile });
      if (c.hp <= damageFor(strength(game, sword, 'attack', c, sword.tile), cityStrength(game, c), 30)) apply(game, 0, { t: 'attack', unit: sword.id, target: c.tile });
      if (c.owner === 1) endTurn(game);
    }
    eq(c.owner, 0, `taken (seed ${seed}, ${turns - 1} turns)`);
  }
});

test('a city under siege heals 8, surrounded none; two trebuchets, two crossbowmen and two longswordsmen marching in take a walled size-6 city in about five turns', () => {
  for (const seed of [11, 222, 3333]) {
    const { game, at } = blank();
    game.rng = seed;
    techsTo(game, 0, 6);
    techsTo(game, 1, 6);
    city(game, 0, at(2, 2));
    city(game, 1, at(22, 15));
    const c = city(game, 1, at(14, 9), { pop: 6, buildings: ['walls'] });
    c.hp = cityMaxHp(game, c);
    unit(game, 'pikeman', 1, c.tile, { stance: 'fortify', fortified: 2 });
    war(game, 0, 1);
    // Each starts three tiles further out than its post: the siege and the bows two from the city, the swords beside it.
    const ring = (n: number) => within(game.grid, c.tile, n).filter((t) => distance(game.grid, t, c.tile) === n && t < c.tile);
    const posts = [...ring(2).slice(0, 4), ...ring(1).slice(0, 2)];
    const army = ['trebuchet', 'trebuchet', 'crossbowman', 'crossbowman', 'longswordsman', 'longswordsman'].map((type, i) => unit(game, type, 0, posts[i] - 3 * game.grid.width));
    let turns = 1;
    for (; turns <= 6 && c.owner === 1; turns++) {
      // The city fires at the most hurt of its besiegers; each goes to its post, the siege and bows fire, a sword goes in once it would take the city on an even roll.
      const near = army.filter((u) => game.units.includes(u) && distance(game.grid, u.tile, c.tile) <= 2).sort((a, b) => a.hp - b.hp);
      if (near[0]) apply(game, 1, { t: 'cityFire', city: c.id, target: near[0].tile });
      army.forEach((u, i) => game.units.includes(u) && u.tile !== posts[i] && apply(game, 0, { t: 'move', unit: u.id, to: posts[i] }));
      for (const u of army.slice(0, 4)) if (game.units.includes(u) && posts.includes(u.tile)) apply(game, 0, { t: 'attack', unit: u.id, target: c.tile });
      for (const u of army.slice(4)) if (game.units.includes(u) && c.owner === 1 && c.hp <= damageFor(strength(game, u, 'attack', c, u.tile), cityStrength(game, c), 30)) apply(game, 0, { t: 'attack', unit: u.id, target: c.tile });
      if (c.owner === 1) {
        const hp = c.hp;
        const max = cityMaxHp(game, c);
        endTurn(game);
        if (hp < max - 20) eq(c.hp - hp, 8, 'a city attacked since its last turn heals 8');
      }
    }
    eq(c.owner, 0, `taken (seed ${seed}, ${turns - 1} turns)`);
  }
  const { game, at } = blank();
  city(game, 0, at(2, 2));
  const c = city(game, 1, at(10, 8));
  war(game, 0, 1);
  c.hp = 100;
  endTurn(game);
  eq(c.hp, 120, 'left alone, 20');
  for (const t of neighbours(game.grid, c.tile)) unit(game, game.tiles[t].terrain === 'grassland' ? 'warrior' : 'trireme', 0, t);
  endTurn(game);
  eq(c.hp, 120, 'surrounded, none');
});

// -------------------------------------------------------------------------------------------------
// Religion
// -------------------------------------------------------------------------------------------------

test('faith: Religious Tolerance, Mandate of Heaven, Holy Warriors, Messiah, the Great Mosque', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(5, 5), { pop: 6 });
  game.religions.r1 = { founder: 0, holyCity: c.id, name: 'One', beliefs: ['tithe', 'feed_the_world', 'holy_warriors'] };
  game.religions.r2 = { founder: 1, holyCity: -1, name: 'Two', beliefs: ['church_property', 'peace_gardens'] };
  p.religion = 'r1';
  c.followers = { r1: 4, r2: 2 };
  ok(!cityEffects(game, c).some((e) => e.perBuilding?.some((x) => x.buildings.includes('garden'))), 'no second religion');
  adopt(game, 0, 'free_religion');
  ok(cityEffects(game, c).some((e) => e.perBuilding?.some((x) => x.buildings.includes('garden'))), 'religious tolerance');
  const cost = faithCost(game, 'missionary', p);
  adopt(game, 0, 'mandate_of_heaven');
  eq(faithCost(game, 'missionary', p), Math.floor(cost * 0.8), 'mandate of heaven');
  p.faith = 1000;
  p.techs.push('bronze_working');
  ok(apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'unit', id: 'spearman' }, with: 'faith' }).ok, 'holy warriors');
  const prophet = prophetCost(game, p);
  const spreads = spreadsOf(game, p, 'great_prophet');
  game.religions.r1.beliefs.push('messiah');
  ok(prophetCost(game, p) < prophet, 'messiah: cheaper prophets');
  eq(spreadsOf(game, p, 'great_prophet'), spreads + 1, 'messiah: one more spread');
  c.buildings.push('great_mosque');
  eq(spreadsOf(game, p, 'missionary'), 3, 'great mosque: one more for missionaries');
});

test('religions: prophets come with a pantheon; a prophet born keeps its civ’s place among the few there’s room for', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india', 'china']);
  eq(maxReligions(game), 3, 'room for three among four civs');
  const homes = game.players.map((p) => city(game, p.index, at(3 + p.index * 6, 4)));
  const prophetOf = (p: number) => game.units.find((u) => u.owner === p && u.type === 'great_prophet');
  const [egypt, babylon] = game.players;
  egypt.faith = 1000;
  faithTurn(game);
  ok(!prophetOf(0), 'faith without a pantheon brings no prophet');
  egypt.pantheon = 'god_king';
  faithTurn(game);
  const waiting = prophetOf(0)!;
  ok(!!waiting, 'with one, a prophet');
  // India and China found the second and third religions while Egypt's prophet is on its way.
  const founders = BELIEF_LIST.filter((b) => b.kind === 'founder').map((b) => b.id);
  const followers = BELIEF_LIST.filter((b) => b.kind === 'follower').map((b) => b.id);
  for (const p of [2, 3]) {
    const u = unit(game, 'great_prophet', p, homes[p].tile);
    eq(foundReligion(game, game.players[p], u, '', [founders[p], followers[p]]), null, `${game.players[p].civ} founds one`);
  }
  eq(religionsLeft(game, babylon), 0, 'the last place is kept for Egypt’s prophet');
  babylon.pantheon = 'desert_folklore';
  babylon.faith = 1000;
  faithTurn(game);
  ok(!prophetOf(1), 'so no prophet for Babylon');
  const late = unit(game, 'great_prophet', 1, homes[1].tile);
  ok(foundReligion(game, babylon, late, '', [founders[1], followers[1]]) !== null, 'nor a religion from one it had another way');
  eq(foundReligion(game, egypt, waiting, '', [founders[0], followers[0]]), null, 'Egypt founds its religion');
  eq(religionsLeft(game, babylon), 0, 'and the world is full');
});

test('faith buys great people from the Industrial Era: the kinds a finished tree allows (every kind with To the Glory of God), each half again dearer', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(8, 8));
  const greats = () => faithPurchases(game, p, c).filter((x) => x.kind === 'unit' && x.id.startsWith('great_')).map((x) => x.id);
  adopt(game, 0, 'rationalism_done');
  eq(greats().length, 0, 'not before the Industrial Era');
  techsTo(game, 0, 9);
  eq(greats().join(), 'great_scientist', 'Rationalism finished: scientists');
  eq(faithCost(game, 'great_scientist', p), Math.floor(1000 * 0.67), 'a thousand faith at standard speed');
  p.faith = 5000;
  ok(apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'unit', id: 'great_scientist' }, with: 'faith' }).ok, 'bought');
  ok(game.units.some((u) => u.owner === 0 && u.type === 'great_scientist'), 'and born');
  eq(p.faith, 5000 - Math.floor(1000 * 0.67), 'for its price');
  eq(faithCost(game, 'great_scientist', p), Math.floor(1500 * 0.67), 'the next half again as dear');
  ok(!apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'unit', id: 'great_engineer' }, with: 'faith' }).ok, 'no engineers without Tradition or Liberty');
  adopt(game, 0, 'tradition_done');
  ok(greats().includes('great_engineer'), 'with Tradition, engineers');
  game.religions.r1 = { founder: 0, holyCity: c.id, name: 'One', beliefs: ['tithe', 'mosques', 'to_the_glory_of_god'] };
  p.religion = 'r1';
  eq(greats().length, 8, 'To the Glory of God: every kind');
});

test('religion spreads: Religious Texts, Itinerant Preachers, trade routes (Arabia’s twice)', () => {
  const { game, at } = blank(['arabia', 'egypt']);
  const source = city(game, 0, at(2, 2), { pop: 6 });
  const target = city(game, 1, at(14, 2), { pop: 6 });
  game.religions.r1 = { founder: 0, holyCity: -1, name: 'One', beliefs: ['tithe', 'mosques'] };
  source.followers = { r1: 6 };
  endTurn(game);
  eq(target.pressure?.r1 ?? 0, 0, 'twelve tiles is too far');
  game.religions.r1.beliefs.push('itinerant_preachers');
  endTurn(game);
  eq(target.pressure?.r1, 1, 'reaches further');
  game.religions.r1.beliefs.push('religious_texts');
  endTurn(game);
  near(target.pressure!.r1, 2.34, 'religious texts');
  game.players[0].routes = [{ from: source.id, to: target.id, turns: 10, sea: false }];
  endTurn(game);
  near(target.pressure!.r1, 2.34 + 1.34 + 2, "arabia's route carries it twice as strongly");
});

test('Reformation: a belief to choose, or one chosen at the turn’s end', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(5, 5));
  game.religions.r1 = { founder: 0, holyCity: c.id, name: 'One', beliefs: ['tithe', 'mosques'] };
  p.religion = 'r1';
  ok(!apply(game, 0, { t: 'reformation', belief: 'sacred_sites' }).ok, 'not without Reformation');
  adopt(game, 0, 'reformation');
  ok(!apply(game, 0, { t: 'reformation', belief: 'tithe' }).ok, 'only a reformation belief');
  ok(apply(game, 0, { t: 'reformation', belief: 'charitable_missions' }).ok, 'chosen');
  ok(!apply(game, 0, { t: 'reformation', belief: 'sacred_sites' }).ok, 'only one');
  const q = blank();
  const qp = q.game.players[0];
  const qc = city(q.game, 0, q.at(5, 5));
  q.game.religions.r1 = { founder: 0, holyCity: qc.id, name: 'One', beliefs: ['tithe', 'mosques'] };
  qp.religion = 'r1';
  adopt(q.game, 0, 'reformation');
  endTurn(q.game);
  eq(q.game.religions.r1.beliefs.length, 3, 'chosen for them');
});

test('great people used: the Mausoleum’s gold, Reliquary’s faith, Rationalism’s science, Commerce’s gold', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(5, 5), { buildings: ['mausoleum'] });
  game.religions.r1 = { founder: 0, holyCity: c.id, name: 'One', beliefs: ['tithe', 'mosques', 'reliquary'] };
  p.religion = 'r1';
  p.researching = 'pottery';
  const m = unit(game, 'great_merchant', 0, c.tile);
  const gold = p.gold;
  ok(apply(game, 0, { t: 'greatPerson', unit: m.id, action: 'trade' }).ok, 'trade mission');
  const mission = p.gold - gold - 100;
  ok(p.faith >= 50, 'reliquary');
  adopt(game, 0, 'commerce_done');
  const m2 = unit(game, 'great_merchant', 0, c.tile);
  const gold2 = p.gold;
  apply(game, 0, { t: 'greatPerson', unit: m2.id, action: 'trade' });
  eq(p.gold - gold2 - 100, 2 * mission, 'commerce finished doubles it');
  const s = unit(game, 'great_scientist', 0, c.tile);
  const research = p.research.pottery ?? 0;
  adopt(game, 0, 'rationalism_done');
  apply(game, 0, { t: 'greatPerson', unit: s.id, action: 'discover' });
  ok((p.research.pottery ?? 0) - research >= 60 || p.techs.includes('pottery'), 'half again');
  const a = unit(game, 'great_artist', 0, at(6, 5));
  game.tiles[at(6, 5)].owner = 0;
  ok(apply(game, 0, { t: 'greatPerson', unit: a.id, action: 'improvement' }).ok, 'artists build landmarks');
  eq(game.tiles[at(6, 5)].improvement, 'landmark', 'a landmark');
});

test('a Great Engineer hurries what’s being built now and no more: nothing left over for what comes after', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(10, 8), { pop: 10 });
  const monument = { kind: 'building', id: 'monument' } as const;
  c.queue = [monument, { kind: 'unit', id: 'warrior' }, { kind: 'unit', id: 'warrior' }, { kind: 'unit', id: 'warrior' }];
  const g = unit(game, 'great_engineer', 0, c.tile);
  ok(apply(game, 0, { t: 'greatPerson', unit: g.id, action: 'hurry' }).ok, 'hurried');
  eq(c.prod, itemCost(game, monument), 'as much as the monument needs');
  endTurn(game);
  ok(c.buildings.includes('monument'), 'the monument built');
  ok(c.prod < itemCost(game, { kind: 'unit', id: 'warrior' }), `only a turn's production carried to the warrior (${c.prod})`);
  endTurn(game);
  eq(game.units.filter((u) => u.type === 'warrior' && u.owner === 0).length, 0, 'which takes more than a turn');
  // Nothing to hurry: the engineer kept.
  c.queue = [];
  c.prod = 0;
  const g2 = unit(game, 'great_engineer', 0, c.tile);
  ok(!apply(game, 0, { t: 'greatPerson', unit: g2.id, action: 'hurry' }).ok && game.units.includes(g2), 'not with nothing being built');
  // A wonder far from done gets the whole of it.
  c.queue = [{ kind: 'building', id: 'cn_tower' }];
  ok(apply(game, 0, { t: 'greatPerson', unit: g2.id, action: 'hurry' }).ok, 'a wonder hurried');
  eq(c.prod, 300 + 30 * c.pop, 'with all 300 and 30 a citizen');
});

// -------------------------------------------------------------------------------------------------
// City-states, trade, spies, research agreements
// -------------------------------------------------------------------------------------------------

test('city-states: Patronage, Consulates, Papal Primacy, Gunboat Diplomacy, gifts and unit gifts', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const cs = game.players.findIndex((x) => x.cityState);
  const home = city(game, cs, at(12, 8));
  city(game, 0, at(3, 3));
  const p = game.players[0];
  p.influence[cs] = 50;
  endTurn(game);
  eq(p.influence[cs], 49, 'falls a point');
  adopt(game, 0, 'patronage');
  endTurn(game);
  eq(p.influence[cs], 48.25, 'a quarter slower');
  p.influence[cs] = 0;
  adopt(game, 0, 'consulates');
  endTurn(game);
  eq(p.influence[cs], 1, 'rises to rest at 20');
  p.gold = 1000;
  const before = p.influence[cs];
  apply(game, 0, { t: 'gift', target: cs, gold: 100 });
  const plain = p.influence[cs] - before;
  adopt(game, 0, 'philanthropy');
  const mid = p.influence[cs];
  apply(game, 0, { t: 'gift', target: cs, gold: 100 });
  ok(p.influence[cs] - mid > plain, 'philanthropy');
  const s = unit(game, 'swordsman', 0, neighbours(game.grid, home.tile)[0]);
  const inf = p.influence[cs];
  ok(apply(game, 0, { t: 'giftUnit', unit: s.id, target: cs }).ok, 'a unit given');
  eq(s.owner, cs, 'theirs now');
  ok(p.influence[cs] > inf, 'influence for it');
});

test('trade routes’ gold comes with the turn’s income (its own route’s, and one for the city at the other end), once', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const mine = city(game, 0, at(3, 3), { pop: 4 });
  const theirs = city(game, 1, at(12, 3), { pop: 6 });
  const [egypt, babylon] = game.players;
  egypt.gold = babylon.gold = 100;
  const route = { from: mine.id, to: theirs.id, turns: 10, sea: false };
  const pay = routeYield(game, egypt, route).gold;
  ok(pay > 0, 'the route pays');
  const without: Game = JSON.parse(JSON.stringify(game));
  routesOf(egypt).push(route);
  eq(routesGold(game, egypt), pay, 'Egypt’s route');
  eq(routesGold(game, babylon), 1, 'one for Babylon, at the other end');
  endTurn(game);
  endTurn(without);
  eq(egypt.lastIncome!.gold - without.players[0].lastIncome!.gold, pay, 'in Egypt’s income');
  eq(egypt.gold - without.players[0].gold, pay, 'and its treasury, once');
  eq(babylon.gold - without.players[1].gold, 1, 'and Babylon’s one');
});

test('trade routes: Trade Unions, Treasure Fleets, Merchant Confederacy, Economic Union; caravansaries reach further', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const cs = game.players.findIndex((x) => x.cityState);
  const mine = city(game, 0, at(3, 3), { pop: 4 });
  const theirs = city(game, 1, at(12, 3), { pop: 4 });
  const csCity = city(game, cs, at(12, 12), { pop: 4 });
  const p = game.players[0];
  const r = (to: number, sea = false) => routeYield(game, p, { from: mine.id, to, turns: 10, sea }).gold;
  const base = r(theirs.id);
  adopt(game, 0, 'trade_unions');
  eq(r(theirs.id) - base, 2, 'trade unions');
  adopt(game, 0, 'treasure_fleets');
  eq(r(theirs.id, true) - r(theirs.id), 4, 'sea routes: +2, and +2 more');
  const toCs = r(csCity.id);
  adopt(game, 0, 'merchant_confederacy');
  eq(r(csCity.id) - toCs, 3, 'merchant confederacy');
  p.ideology = 'freedom';
  game.players[1].ideology = 'freedom';
  const same = r(theirs.id);
  adopt(game, 0, 'economic_union');
  eq(r(theirs.id) - same, 3, 'economic union');
  const routes = maxRoutes(game, p);
  mine.buildings.push('colossus');
  eq(maxRoutes(game, p) - routes, 1, 'the colossus: a route more');
});

test('spies: the Great Firewall, constabularies, Covert Action, counterspies, the NIA', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const p = game.players[0];
  const them = game.players[1];
  city(game, 0, at(3, 3));
  const target = city(game, 1, at(14, 3), { pop: 8 });
  techsTo(game, 1, 6);
  techsTo(game, 0, 4);
  const spy = { id: 999, city: target.id, progress: 0 };
  p.spies = [spy];
  endTurn(game);
  const pace = spy.progress;
  ok(pace > 0, 'a spy at work');
  target.buildings.push('constabulary');
  spy.progress = 0;
  endTurn(game);
  near(spy.progress, Math.max(2, Math.floor(pace)) * 0.75 || spy.progress, 'constabulary slows it');
  adopt(game, 0, 'covert_action');
  const slowed = spy.progress;
  spy.progress = 0;
  endTurn(game);
  ok(spy.progress > slowed * 1.2, 'covert action speeds it');
  them.policies.push('double_agents');
  target.buildings.push('great_firewall');
  spy.progress = 0;
  endTurn(game);
  eq(spy.progress, 0, 'the great firewall stops it');
  eq(spyCount(game, p, 4), 2, 'two spies in the industrial era');
  game.cities[0].buildings.push('national_intelligence_agency');
  eq(spyCount(game, p, 4), 3, 'one more with the NIA');
});

test('spies steal as in Civ V: only from a civ ahead, the dearest tech it could learn at the city’s science (taking two and a half times its cost), after watching the city; a counterspy catches half', () => {
  const world = (seed: number) => {
    const { game, at } = blank(['egypt', 'babylon']);
    game.rng = seed;
    city(game, 0, at(3, 3));
    const target = city(game, 1, at(14, 3), { pop: 8 });
    techsTo(game, 0, 4);
    techsTo(game, 1, 4);
    game.players[0].explored[target.tile] = 1;
    return { game, target, p: game.players[0], them: game.players[1] };
  };
  const { game, target, p, them } = world(1);
  ok('why' in theft(game, p, target), 'nothing from a civ no further ahead');
  techsTo(game, 1, 6);
  const plan = theft(game, p, target);
  if (!('tech' in plan)) throw new Failure('a theft from a civ ahead');
  const learnable = Object.keys(TECHS).filter((t) => them.techs.includes(t) && !p.techs.includes(t) && TECHS[t].needs.every((n) => p.techs.includes(n)));
  ok(learnable.every((t) => techCost(game, p, t) <= techCost(game, p, plan.tech)), 'the dearest tech it could learn');
  near(plan.need, techCost(game, p, plan.tech) * THEFT_COST, 'a multiple of what it costs');
  near(plan.rate, Math.max(1, cityYields(game, target).science), 'gathered at the city’s science');
  p.spies = [{ id: 999, city: null, progress: 0 }];
  ok(apply(game, 0, { t: 'spy', spy: 999, target: target.id }).ok, 'sent');
  const spy = p.spies[0];
  eq(spy.watch, surveillanceTurns(game), 'it watches the city first');
  for (let t = 0; t < surveillanceTurns(game); t++) endTurn(game);
  eq(spy.progress, 0, 'gathering nothing meanwhile');
  endTurn(game);
  ok(spy.progress > 0, 'then at work');
  // Each theft is caught half the time with a counterspy there: the spy dies and its civ is known.
  let caught = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = world(seed * 7919);
    techsTo(w.game, 1, 6);
    w.p.spies = [{ id: 999, city: w.target.id, progress: 1e9 }];
    w.them.spies = [{ id: 998, city: w.target.id, progress: 0 }];
    const known = w.p.techs.length;
    endTurn(w.game);
    if (w.p.spies.length) eq(w.p.techs.length, known + 1, 'not caught: it steals');
    else {
      caught++;
      ok(relationsOf(w.game).events.some((e) => e.kind === 'spy' && e.by === 0 && e.to === 1), 'caught: remembered against its civ');
    }
  }
  ok(caught >= 12 && caught <= 28, `caught about half the time (${caught} of 40)`);
});

test('no caravan to train or buy with every trade route running or spoken for by one waiting', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(8, 8), { pop: 4 });
  techsTo(game, 0, 3);
  p.gold = 10000;
  const max = maxRoutes(game, p);
  ok(max >= 1, 'routes to fill');
  const caravans = Array.from({ length: max }, () => unit(game, 'caravan', 0, c.tile));
  const train = { t: 'produce', city: c.id, item: { kind: 'unit', id: 'caravan' } } as const;
  ok(!apply(game, 0, train).ok, 'every route spoken for: no training one');
  ok(!apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'unit', id: 'caravan' }, with: 'gold' }).ok, 'nor buying one');
  ok(!!trainOptions(game, p, c).find((o) => o.id === 'caravan')?.why, 'and the city says why');
  game.units.splice(game.units.indexOf(caravans[0]), 1);
  ok(apply(game, 0, train).ok, 'one route free: a caravan');
});

test('the World Leader vote: a team’s delegates stand together, given to the one of them given most, more than two thirds needed of the delegates the world began with (more than half without teams); city-states with no ally abstain', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india', 'china'], { cityStates: 2 });
  game.players.forEach((p, i) => {
    if (i < 4) {
      p.team = i < 2 ? 0 : 1;
      city(game, i, at(3 + i * 6, 3));
    }
  });
  const alone = unVote(game, () => -1);
  eq([...alone.votes.values()].join(), '4,4', 'each team’s four delegates together');
  ok(alone.votes.has(0) && alone.votes.has(2), 'for its first civ when none is given more');
  eq(alone.needed, 7, 'more than two thirds of the world’s ten delegates, in a game of teams (the city-states’ too, though they abstain)');
  const backed = unVote(game, () => 3);
  eq(backed.votes.get(3), 6, 'city-states behind China: India’s two go to China too');
  ok(!backed.votes.has(2), 'and none stand apart for India');
  eq(backed.needed, 7, 'with the city-states voting, the same');
  game.players[3].alive = false;
  game.players.find((x) => x.cityState)!.alive = false;
  eq(unVote(game, () => -1).needed, 7, 'a fallen civ’s and a fallen city-state’s delegates still among those needed');
  game.players.forEach((p) => delete p.team);
  eq(unVote(game, () => -1).needed, 6, 'without teams, more than half of them');
});

test('a World Leader: more than half the world’s delegates (half is not enough, even well ahead of anyone else)', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india', 'china'], { cityStates: 2 });
  game.players.forEach((_, i) => i < 4 && city(game, i, at(3 + i * 6, 3)));
  const [egypt, babylon, india, china] = game.players;
  game.settings.victories.diplomatic = true;
  game.wonders['united_nations'] = egypt.index;
  game.cities.find((c) => c.owner === egypt.index)!.buildings.push('united_nations');
  game.turn = 100;
  const toEgypt = () => egypt.index;
  // Egypt: the UN's four and both city-states; Babylon: its own two and India's and China's.
  (india as typeof india & { vote?: number }).vote = babylon.index;
  (china as typeof china & { vote?: number }).vote = babylon.index;
  eq(unVote(game, toEgypt).needed, 7, 'more than half of twelve');
  longGameTurn(game, () => 0, toEgypt);
  ok(!game.over, 'six each: no World Leader');
  delete (india as typeof india & { vote?: number }).vote;
  delete (china as typeof china & { vote?: number }).vote;
  game.turn = 110;
  longGameTurn(game, () => 0, toEgypt);
  ok(!game.over, 'six of twelve, against two each: still no World Leader');
  (india as typeof india & { vote?: number }).vote = babylon.index;
  game.turn = 120;
  (china as typeof china & { vote?: number }).vote = egypt.index;
  longGameTurn(game, () => 0, toEgypt);
  eq(game.over?.how, 'diplomatic', 'China’s two to Egypt: eight against four');
  eq(game.over?.winner, egypt.index, 'Egypt elected');
});

test('city-state quests: done for influence, once each (the camp and the wonder by the first only); they lapse, and only those who have met it are asked', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const [egypt, babylon] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  const home = city(game, cs.index, at(14, 9));
  city(game, 0, at(4, 4));
  city(game, 1, at(22, 15));
  egypt.met = [cs.index];
  const quests = questsOf(cs);
  const ask = (q: Partial<Quest> & { kind: QuestKind }) => quests.push({ until: game.turn + 30, done: [], ...q });
  const inf = () => egypt.influence[cs.index] ?? 0;
  // A trade route to it.
  ask({ kind: 'route' });
  let before = inf();
  routesOf(egypt).push({ from: game.cities.find((c) => c.owner === 0)!.id, to: home.id, turns: 20, sea: false });
  questsTurn(game);
  eq(inf() - before, QUEST_REWARD.route, 'a trade route to it: its influence');
  before = inf();
  questsTurn(game);
  eq(inf(), before, 'once only');
  ok(!(babylon.influence[cs.index] ?? 0), 'Babylon has never met it: asked nothing');
  // A wonder: the first to build it.
  ask({ kind: 'wonder', target: 'pyramids' });
  game.wonders.pyramids = 0;
  before = inf();
  questsTurn(game);
  eq(inf() - before, QUEST_REWARD.wonder, 'the wonder built');
  ok(!quests.some((q) => q.kind === 'wonder'), 'and the quest is over');
  // A camp: cleared by the civ.
  const camp = at(16, 9);
  game.tiles[camp].camp = true;
  ask({ kind: 'camp', target: camp });
  before = inf();
  game.tiles[camp].camp = false;
  campCleared(game, egypt, camp);
  eq(inf() - before, QUEST_REWARD.camp, 'the camp cleared');
  questsTurn(game);
  ok(!quests.some((q) => q.kind === 'camp'), 'and gone');
  // A resource, a natural wonder, a religion.
  ask({ kind: 'resource', target: 'silver' });
  ask({ kind: 'nature', target: 'sky_pillar' });
  before = inf();
  Object.assign(game.tiles[neighbours(game.grid, game.cities.find((c) => c.owner === 0)!.tile)[0]], { resource: 'silver', improvement: 'mine' });
  (game.found ??= {}).sky_pillar = { tile: 0, by: [0] };
  questsTurn(game);
  eq(inf() - before, QUEST_REWARD.resource + QUEST_REWARD.nature, 'silver brought in, a natural wonder found');
  ask({ kind: 'religion' });
  game.religions.r1 = { founder: 0, holyCity: -1, name: 'One', beliefs: ['tithe', 'mosques'] };
  egypt.religion = 'r1';
  home.followers = { r1: home.pop };
  before = inf();
  questsTurn(game);
  eq(inf() - before, QUEST_REWARD.religion, 'its city follows your religion');
  // A quest lapses.
  quests.length = 0;
  ask({ kind: 'route', until: game.turn });
  questsTurn(game);
  eq(quests.filter((q) => q.kind === 'route').length, 0, 'out of time');
  // Asked in time: a city-state with room asks something it can.
  quests.length = 0;
  routesOf(egypt).length = 0;
  egypt.techs.push('animal_husbandry');
  for (let i = 0; i < 80 && !quests.length; i++) questsTurn(game);
  ok(quests.length > 0, 'it asks');
  eq(questsFor(game, egypt, cs).length, quests.length, 'and the asked civ sees it');
  const seen = questsFor(game, egypt, cs)[0];
  eq(seen.at, home.tile, 'shown at the city-state');
  ok(seen.text.length > 0 && seen.reward > 0 && seen.turns > 0 && !seen.done, 'in words, with its reward and turns');
  eq(questsFor(game, babylon, cs).length, 0, 'not one who hasn’t met it');
});

test('a camp a city-state clears itself ends its request, met by no one', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const [egypt] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  city(game, cs.index, at(14, 9));
  city(game, 0, at(4, 4));
  city(game, 1, at(22, 15));
  egypt.met = [cs.index];
  egypt.bot = false;
  const camp = at(16, 9);
  questsOf(cs).push({ kind: 'camp', target: camp, until: game.turn + 30, done: [] });
  egypt.notes = [];
  campCleared(game, cs, camp);
  eq(questsOf(cs)[0].done.length, 0, 'not done by the city-state itself');
  questsTurn(game);
  ok(egypt.notes.some((n) => n.text === `${cs.name} no longer asks: clear the barbarian camp near us.`), 'Egypt told it no longer asks');
});

test('a city-state’s request met first by another civ: the others are told who; its notes are city-states’ notes', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const [egypt, babylon] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  city(game, cs.index, at(14, 9));
  city(game, 0, at(4, 4));
  city(game, 1, at(22, 15));
  egypt.met = [cs.index, 1];
  babylon.met = [cs.index, 0];
  egypt.bot = babylon.bot = false;
  const camp = at(16, 9);
  game.tiles[camp].camp = true;
  questsOf(cs).push({ kind: 'camp', target: camp, until: game.turn + 30, done: [] });
  egypt.notes = [];
  babylon.notes = [];
  game.tiles[camp].camp = false;
  campCleared(game, babylon, camp);
  questsTurn(game);
  ok(egypt.notes.some((n) => n.text.includes(`met first by ${babylon.name}`) && n.kind === 'citystate'), 'Egypt told Babylon met it first, in a city-state’s note');
  // A route to it: the thanks name its city as it's written.
  const home = game.cities.find((c) => c.owner === cs.index)!;
  questsOf(cs).push({ kind: 'route', until: game.turn + 30, done: [] });
  routesOf(egypt).push({ from: game.cities.find((c) => c.owner === 0)!.id, to: home.id, turns: 20, sea: false });
  questsTurn(game);
  ok(egypt.notes.some((n) => n.text.includes(`thanks you (open a trade route to ${home.name})`)), 'the thanks keep the city’s name as it is');
  ok(babylon.notes.some((n) => n.text.includes('thanks you') && n.kind === 'citystate'), 'and Babylon thanked, in one');
});

test('a resolution’s proposer is for it until they say otherwise', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const [egypt] = game.players;
  city(game, 0, at(4, 4));
  city(game, 1, at(22, 15));
  egypt.bot = false;
  game.congress = { host: 0, next: game.turn + 5, proposals: [], active: [] };
  eq(proposeResolution(game, egypt, { kind: 'arts_funding' }), null, 'Egypt proposes');
  eq(game.congress.proposals[0].votes[0], 'yes', 'and is for it');
  castVote(game, egypt, game.congress.proposals[0].id, 'abstain');
  eq(game.congress.proposals[0].votes[0], 'abstain', 'until it says otherwise');
});

test('the World Congress: another person’s vote is theirs until the session (not in the forecast, nor its totals)', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india']);
  const [egypt, babylon] = game.players;
  [at(4, 4), at(22, 15), at(12, 9)].forEach((t, i) => city(game, i, t));
  egypt.bot = babylon.bot = false;
  egypt.met = [1, 2];
  babylon.met = [0, 2];
  game.congress = { host: 0, next: game.turn + 5, proposals: [], active: [] };
  eq(proposeResolution(game, egypt, { kind: 'arts_funding' }), null, 'Egypt proposes (and is for it)');
  const id = game.congress.proposals[0].id;
  castVote(game, babylon, id, 'no');
  const seen = (p: typeof egypt) => viewFor(game, p, null).congress!.proposals[0];
  const mine = seen(egypt);
  eq(mine.vote, 'yes', 'Egypt sees its own vote');
  eq(mine.forecast.find((f) => f.player === 0)?.vote, 'yes', 'in the forecast too');
  eq(mine.forecast.find((f) => f.player === 1)?.vote, null, 'not Babylon’s');
  eq(mine.projected.no, 0, 'nor counts it');
  const theirs = seen(babylon);
  eq(theirs.forecast.find((f) => f.player === 0)?.vote, null, 'and Babylon doesn’t see Egypt’s');
  eq(theirs.projected.no, delegates(game, babylon), 'but counts its own');
  ok(theirs.forecast.find((f) => f.player === 2)?.vote !== null, 'a bot’s expected vote is shown');
});

test('the World Congress’s news names a civ only to those who have met it', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india']);
  const [egypt, babylon, india] = game.players;
  [egypt, babylon, india].forEach((p, i) => city(game, p.index, at(3 + i * 8, 4)));
  for (const p of game.players) p.bot = false;
  egypt.met = [1];
  babylon.met = [0];
  india.met = [];
  game.congress = { host: 0, next: game.turn + 5, proposals: [], active: [] };
  eq(proposeResolution(game, egypt, { kind: 'embargo', civ: 1 }), null, 'Egypt puts an embargo on Babylon');
  ok(egypt.notes.some((n) => n.text.startsWith('You have put a resolution') && n.text.includes(`Embargo on ${babylon.name}`)), 'to Egypt: its own resolution');
  ok(babylon.notes.some((n) => n.text.startsWith(`${egypt.name} has put a resolution`)), 'to Babylon: Egypt’s');
  ok(india.notes.some((n) => n.text.startsWith("A civilization you haven't met has put a resolution") && n.text.includes("Embargo on a civilization you haven't met")), 'to India: neither named');
});

test('the World Congress: founded in the Renaissance, its host and the civ with most delegates propose, delegates vote, resolutions in force until repealed', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india'], { cityStates: 1 });
  const [egypt, babylon, india] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  [egypt, babylon, india].forEach((p, i) => city(game, p.index, at(3 + i * 8, 4)));
  city(game, cs.index, at(12, 12));
  for (const p of game.players) p.bot = false;
  endTurn(game);
  ok(!game.congress, 'none before the Renaissance');
  techsTo(game, 1, 7);
  endTurn(game);
  const c = game.congress!;
  ok(!!c, 'founded');
  eq(c.host, 1, 'its host the first in the Renaissance');
  eq(c.next, game.turn + sessionTurns(game) - 1, 'it meets in thirty turns (at speed)');
  // City-state allies' delegates go with their ally.
  egypt.influence[cs.index] = 80;
  eq(delegates(game, egypt), 3, 'two, one more for a city-state ally');
  eq(delegates(game, babylon), 4, 'the host two more');
  eq(proposers(game).join(), '1,0', 'the host and the civ with most delegates besides');
  ok(cannotPropose(game, india, { kind: 'arts_funding' }) !== null, 'nobody else');
  eq(proposeResolution(game, babylon, { kind: 'embargo', civ: 2 }), null, 'the host puts an embargo on India');
  eq(proposeResolution(game, egypt, { kind: 'ban_luxury', luxury: 'silver' }), null, 'Egypt a ban on silver');
  ok(proposeResolution(game, egypt, { kind: 'arts_funding' }) !== null, 'one each');
  const [embargo, ban] = c.proposals;
  castVote(game, babylon, embargo.id, 'yes');
  castVote(game, india, embargo.id, 'no');
  castVote(game, egypt, ban.id, 'yes');
  castVote(game, india, ban.id, 'no');
  castVote(game, babylon, ban.id, 'no');
  // Silver of India's, and a route of Egypt's to India, before the session.
  Object.assign(game.tiles[neighbours(game.grid, game.cities.find((x) => x.owner === 2)!.tile)[0]], { resource: 'silver', improvement: 'mine' });
  const india0 = happiness(game, india);
  routesOf(egypt).push({ from: game.cities.find((x) => x.owner === 0)!.id, to: game.cities.find((x) => x.owner === 2)!.id, turns: 20, sea: false });
  c.next = game.turn;
  endTurn(game);
  ok(embargoed(game, 0, 2), 'the embargo passes: 4 for, 2 against');
  ok(!banned(game, 'silver'), 'the ban fails: 3 for, 6 against');
  endTurn(game);
  eq(routesOf(egypt).length, 0, 'the embargo ends trade routes with India');
  ok(startRoute(game, egypt, unit(game, 'caravan', 0, game.cities.find((x) => x.owner === 0)!.tile), game.cities.find((x) => x.owner === 2)!.id) !== null, 'and opens none');
  eq(c.proposals.length, 0, 'the proposals are done with');
  // Resolutions' effects.
  c.active.push({ kind: 'ban_luxury', luxury: 'silver' });
  ok(happiness(game, india) < india0, 'a banned luxury gives no happiness');
  const capital = game.cities.find((x) => x.owner === 0)!;
  capital.specialists.scientist = 1;
  capital.specialists.artist = 1;
  const before = cityYields(game, capital).greatPeople;
  c.active.push({ kind: 'arts_funding' });
  const after = cityYields(game, capital).greatPeople;
  near(after.artist ?? 0, (before.artist ?? 0) * 1.33, 'arts funding: artists a third faster');
  near(after.scientist ?? 0, (before.scientist ?? 0) * 0.67, 'scientists a third slower');
  for (let i = 0; i < 12; i++) unit(game, 'warrior', 0, at(1, 10));
  const upkeep = goldUpkeep(game, egypt).units;
  c.active.push({ kind: 'standing_army_tax' });
  ok(goldUpkeep(game, egypt).units > upkeep, 'a standing army tax: more upkeep');
  egypt.techs.push(...Object.keys(TECHS));
  capital.buildings.push('manhattan_project');
  ok(trainOptions(game, egypt, capital).some((o) => o.id === 'atomic_bomb'), 'nuclear weapons, with the Manhattan Project');
  c.active.push({ kind: 'non_proliferation' });
  ok(!trainOptions(game, egypt, capital).some((o) => o.id === 'atomic_bomb'), 'none with Non-Proliferation');
  // Repealed.
  c.host = 0;
  eq(proposeResolution(game, egypt, { kind: 'non_proliferation', repeal: true }), null, 'a repeal proposed');
  castVote(game, egypt, c.proposals[0].id, 'yes');
  c.next = game.turn;
  endTurn(game);
  ok(!inForce(game, 'non_proliferation'), 'and passed');
});

test('a trade route home carries food or production, as it’s sent', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const from = city(game, 0, at(4, 4), { pop: 8 });
  const to = city(game, 0, at(10, 4), { pop: 2 });
  techsTo(game, 0, 1);
  ok(!startRoute(game, p, unit(game, 'caravan', 0, from.tile), to.id, 'prod'), 'production sent');
  eq(routeYield(game, p, routesOf(p)[0]).prod, 4, 'two, and one for every four people where it comes from');
  eq(routeYield(game, p, routesOf(p)[0]).food, 0, 'no food with it');
  const prod = to.prod;
  game.players[0].routes = [{ ...routesOf(p)[0] }];
  endTurn(game);
  ok(to.prod >= prod + 4, 'the city gets it');
  routesOf(p).length = 0;
  ok(!startRoute(game, p, unit(game, 'caravan', 0, from.tile), to.id), 'food, by default');
  eq(routeYield(game, p, routesOf(p)[0]).food, 3 + Math.floor(from.pop / 4), 'three, and one for every four people');
  routesOf(p).length = 0;
  const sent = apply(game, 0, { t: 'trade', unit: unit(game, 'caravan', 0, at(4, 4)).id, to: city(game, 0, at(4, 10)).id, cargo: 'prod' });
  ok(sent.ok, `the order carries the choice (${sent.ok ? '' : sent.error})`);
  eq(routesOf(p)[0].cargo, 'prod', 'kept on the route');
});

test('tribute from a city-state (Civ V’s bullying): soldiers near enough outmatching it, gold or a worker for influence, then not again for a while', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const egypt = game.players[0];
  const cs = game.players.find((x) => x.cityState)!;
  city(game, 0, at(4, 4));
  const home = city(game, cs.index, at(14, 9));
  ok(cannotBully(game, egypt, cs.index) !== null, 'no soldiers near: no tribute');
  const ring = neighbours(game.grid, home.tile);
  for (const t of ring.slice(0, 3)) unit(game, 'swordsman', 0, t);
  eq(cannotBully(game, egypt, cs.index), null, 'three swordsmen beside it outmatch it');
  const gold = egypt.gold;
  ok(apply(game, 0, { t: 'tribute', target: cs.index, take: 'gold' }).ok, 'gold demanded');
  eq(egypt.gold - gold, tributeGold(game, egypt), 'and paid');
  eq(egypt.influence[cs.index], -TRIBUTE_COST.gold, 'for influence');
  ok(!apply(game, 0, { t: 'tribute', target: cs.index, take: 'worker' }).ok, 'not again so soon');
  cs.cityState!.tributeAt = game.turn - tributeTurns(game);
  const workers = game.units.filter((u) => u.owner === 0 && u.type === 'worker').length;
  ok(apply(game, 0, { t: 'tribute', target: cs.index, take: 'worker' }).ok, 'later, a worker');
  eq(game.units.filter((u) => u.owner === 0 && u.type === 'worker').length, workers + 1, 'given');
  eq(egypt.influence[cs.index], -TRIBUTE_COST.gold - TRIBUTE_COST.worker, 'for more influence');
});

test('great people: the Admiral’s Repair Fleet heals the ships round it; the Musician’s Concert Tour wins tourism in another civ’s land', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const [egypt, babylon] = game.players;
  city(game, 0, at(4, 4));
  const theirs = city(game, 1, at(16, 4));
  const sea = [at(10, 10), at(11, 10), at(13, 10)];
  for (const t of sea) game.tiles[t].terrain = 'coast';
  const ships = sea.map((t) => unit(game, 'trireme', 0, t, { hp: 40 }));
  const admiral = unit(game, 'great_admiral', 0, sea[0]);
  ok(apply(game, 0, { t: 'greatPerson', unit: admiral.id, action: 'repair' }).ok, 'the fleet repaired');
  eq(ships.map((s) => s.hp).join(), '100,100,40', 'on its tile and beside it, not two away');
  ok(!game.units.includes(admiral), 'the Admiral spent');
  const musician = unit(game, 'great_musician', 0, at(4, 5));
  ok(!apply(game, 0, { t: 'greatPerson', unit: musician.id, action: 'concert' }).ok, 'not at home');
  musician.tile = neighbours(game.grid, theirs.tile)[0];
  ok(apply(game, 0, { t: 'greatPerson', unit: musician.id, action: 'concert' }).ok, 'in their land');
  eq(egypt.tourism[babylon.index], Math.round(200 * 0.67), 'tourism toward them (at least 200, at speed)');
});

test('diplomats in capitals (delegates with Globalization, word of war plans) and coups in city-states (the ally overthrown, or the spy killed)', () => {
  const world = (seed: number) => {
    const { game, at } = blank(['egypt', 'babylon', 'india'], { cityStates: 1 });
    game.rng = seed;
    const [egypt, babylon] = game.players;
    const cs = game.players.find((x) => x.cityState)!;
    const homes = [0, 1, 2].map((i) => city(game, i, at(3 + i * 8, 4)));
    const other = city(game, 1, at(11, 12));
    const csHome = city(game, cs.index, at(20, 12));
    for (const c of [...homes, other, csHome]) egypt.explored[c.tile] = 1;
    egypt.spies = [{ id: 901, city: null, progress: 0 }];
    return { game, egypt, babylon, cs, homes, other, csHome };
  };
  const { game, egypt, babylon, homes, other, csHome } = world(1);
  ok(!apply(game, 0, { t: 'spy', spy: 901, target: other.id, diplomat: true }).ok, 'a diplomat only to a capital');
  ok(!apply(game, 0, { t: 'spy', spy: 901, target: csHome.id, diplomat: true }).ok, 'not to a city-state');
  ok(apply(game, 0, { t: 'spy', spy: 901, target: homes[1].id, diplomat: true }).ok, "to Babylon's capital");
  game.congress = { host: 2, next: game.turn + 30, proposals: [], active: [] };
  eq(delegateSources(game, egypt).diplomats, 0, 'no delegate without Globalization');
  egypt.techs.push('globalization');
  eq(delegateSources(game, egypt).diplomats, 1, 'one with it');
  egypt.techs = egypt.techs.filter((t) => t !== 'globalization');
  egypt.bot = false;
  babylon.ai = { aim: 'domination', aimed: 0, wars: {}, orders: {}, plan: { target: 2, city: homes[2].id, stage: 'muster', since: game.turn, rally: homes[1].tile } };
  const known = egypt.techs.length;
  endTurn(game);
  ok(egypt.notes.some((n) => n.text.includes('preparing a war on')), 'word of a war plan');
  eq(egypt.techs.length, known, 'and no theft');
  war(game, 0, 1);
  endTurn(game);
  eq(egypt.spies![0].city, null, 'sent home by a war');
  // A coup: Babylon is the ally; Egypt's spy there.
  let won = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = world(seed * 7919);
    w.babylon.influence[w.cs.index] = 70;
    w.egypt.influence[w.cs.index] = 50;
    ok(cannotCoup(w.game, w.egypt, 901) !== null, 'a spy must be there first');
    w.egypt.spies![0].city = w.csHome.id;
    near(coupChance(w.game, w.egypt, w.cs.index), 0.3, 'twenty points behind: three in ten');
    ok(apply(w.game, 0, { t: 'coup', spy: 901 }).ok, 'attempted');
    if ((w.egypt.influence[w.cs.index] ?? 0) === 70) {
      won++;
      eq(w.babylon.influence[w.cs.index], 50, 'the influence swapped');
      eq(w.egypt.spies!.length, 1, 'the spy stays');
    } else eq(w.egypt.spies!.length, 0, 'failed: the spy killed');
  }
  ok(won >= 5 && won <= 20, `about three in ten won (${won} of 40)`);
});

test('a city’s screen: what each focus would make (the city left as it was), its great person points, the pressure on it', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const p = game.players[0];
  const c = city(game, 0, at(6, 6), { pop: 5, buildings: ['library'] });
  c.specialists = { scientist: 1 };
  const before = JSON.stringify({ worked: c.worked, specialists: c.specialists, focus: c.focus });
  const info = cityInfo(game, p, c);
  eq(JSON.stringify({ worked: c.worked, specialists: c.specialists, focus: c.focus }), before, 'the city left as it was');
  const of = (f: string) => info.focuses.find((x) => x.focus === f)!;
  eq(info.focuses.length, 7, 'every focus');
  ok(of('food').surplus >= of('prod').surplus && of('prod').prod >= of('food').prod, 'food favours food, production production');
  ok((info.greatPeople.scientist ?? 0) >= 3, 'its scientist’s great scientist points');
  // A religion's city near it presses it.
  const holy = city(game, 1, at(12, 6), { pop: 3 });
  game.religions.r1 = { founder: 1, holyCity: holy.id, name: 'Faith', beliefs: [] };
  holy.followers = { r1: 3 };
  const press = cityInfo(game, p, c).pressure;
  eq(press.find((x) => x.religion === 'r1')?.perTurn, 2, 'its holy city nearby: twice the pressure');
  eq(cityInfo(game, p, c).conversionNeed, 10 + 5 * 4, 'and what a convert takes');
});

test('influence with a city-state falls a point a turn, a quarter slower with Patronage, and the screen is told so', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const p = game.players[0];
  const cs = game.players.find((x) => x.cityState)!;
  city(game, cs.index, at(12, 9));
  city(game, 0, at(4, 4));
  p.met = [cs.index];
  eq(influenceFall(game, p), 1, 'a point a turn');
  p.policies.push('patronage');
  eq(influenceFall(game, p), 0.75, 'a quarter slower with Patronage');
  eq(viewFor(game, p, null).players[cs.index].cityState!.fall, 0.75, 'as the city-state’s card is told');
});

test('research agreements pay out more with Scientific Revolution and the Porcelain Tower', () => {
  const payout = (setup: (game: Game) => void) => {
    const { game, at } = blank();
    city(game, 0, at(3, 3));
    city(game, 1, at(14, 3));
    for (const x of game.players) {
      x.researching = 'pottery';
      x.lastIncome = { gold: 0, science: 20, culture: 0, faith: 0, happiness: 0, tourism: 0 };
    }
    setup(game);
    relationsOf(game).running.push({ a: 0, b: 1, item: { kind: 'research' }, turns: 1 });
    diplomacyTurn(game);
    return game.players[0].research.pottery ?? 0;
  };
  const plain = payout(() => {});
  ok(plain > 0, 'science at the end');
  eq(payout((game) => game.players[0].policies.push('scientific_revolution')), 2 * plain, 'twice with scientific revolution');
  eq(payout((game) => game.cities[0].buildings.push('porcelain_tower')), Math.round(1.5 * plain), 'half again with the porcelain tower');
});

test('tourism: France’s art, hotels, Sacred Sites, Media Culture, The Internet, Cultural Exchange', () => {
  const { game, at } = blank(['france', 'egypt']);
  const c = city(game, 0, at(5, 5), { buildings: ['museum'] });
  c.works = { museum: ['Art 1'] };
  eq(cityTourism(game, c), 4, "france's art in the capital: 4");
  c.works = { museum: ['Art 1', 'Art 2'] };
  eq(cityTourism(game, c), 11, 'a full museum: themed, 3 more');
  c.works = { museum: ['Art 1'] };
  c.buildings.push('hotel');
  eq(cityTourism(game, c), 6, 'a hotel: +50%');
  c.buildings.push('broadcast_tower');
  game.players[0].policies.push('media_culture');
  near(cityTourism(game, c), 4 * 1.84, 'media culture with a broadcast tower');
  game.religions.r1 = { founder: 0, holyCity: c.id, name: 'One', beliefs: ['tithe', 'mosques', 'sacred_sites'] };
  game.players[0].religion = 'r1';
  c.buildings.push('mosque');
  near(cityTourism(game, c), 6 * 1.84, 'sacred sites');
  game.players[0].techs.push('the_internet');
  near(cityTourism(game, c), 6 * 2.34, 'the internet: +50%');
});

test('a revolution (Civ V’s): with enough dissent from a rival ideology, a civ may take it; its tenets lost, two fewer free, two turns of anarchy', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india']);
  const [egypt, babylon, india] = game.players;
  game.players.forEach((_, i) => city(game, i, at(3 + i * 8, 4)));
  egypt.ideology = 'freedom';
  egypt.policies.push('creative_expression', 'civil_society', 'avant_garde');
  babylon.ideology = 'order';
  india.ideology = 'order';
  egypt.lifetimeCulture = 300;
  babylon.tourism[0] = 120;
  eq(ideologySwitch(game, egypt), null, 'one rival pressing: not enough dissent');
  ok(!apply(game, 0, { t: 'switchIdeology', id: 'order' }).ok, 'no revolution yet');
  india.tourism[0] = 120;
  eq(dissent(game, egypt), SWITCH_DISSENT, 'two pressing');
  eq(ideologySwitch(game, egypt), 'order', 'its people lean to Order');
  ok(!apply(game, 0, { t: 'switchIdeology', id: 'autocracy' }).ok, 'not to another');
  ok(apply(game, 0, { t: 'switchIdeology', id: 'order' }).ok, 'a revolution');
  eq(egypt.ideology, 'order', 'Order now');
  ok(!egypt.policies.some((x) => ['creative_expression', 'civil_society', 'avant_garde'].includes(x)), "Freedom's tenets lost");
  eq(egypt.freeTenets, 1, 'two fewer free to take');
  eq(egypt.anarchy, ANARCHY_TURNS, 'anarchy');
  eq(dissent(game, egypt), 0, 'the dissent is over');
  const gold = egypt.gold;
  const culture = egypt.culture;
  endTurn(game);
  ok(egypt.gold <= gold && egypt.culture === culture, 'no gold or culture in anarchy');
  egypt.culture = 0;
  ok(apply(game, 0, { t: 'policy', id: 'five_year_plan' }).ok, 'a free tenet, without culture');
  eq(egypt.freeTenets, 0, 'taken');
  ok(!apply(game, 0, { t: 'policy', id: 'young_pioneers' }).ok, 'the next costs culture');
  endTurn(game);
  eq(egypt.anarchy ?? 0, 0, 'anarchy over after two turns');
});

test('ideologies: chosen in the Modern Era (or the Industrial with three Factories); tenets in levels', () => {
  const { game, at } = blank();
  const p = game.players[0];
  for (const col of [3, 10, 17]) city(game, 0, at(col, 3));
  techsTo(game, 0, 8);
  ok(!canChooseIdeology(game, p), 'not in the renaissance');
  techsTo(game, 0, 9);
  ok(!canChooseIdeology(game, p), 'industrial, no factories');
  for (const c of game.cities) c.buildings.push('factory');
  ok(canChooseIdeology(game, p), 'industrial with three factories');
  ok(apply(game, 0, { t: 'ideology', id: 'order' }).ok, 'order');
  ok(!apply(game, 0, { t: 'ideology', id: 'freedom' }).ok, 'once');
  const ids = adoptable(p, 4).map((x) => x.id);
  ok(ids.includes('five_year_plan') && !ids.includes('worker_faculties'), 'level one first');
  p.policies.push('five_year_plan', 'young_pioneers');
  ok(adoptable(p, 4).some((x) => x.id === 'worker_faculties'), 'two of level one open level two');
  const prod = cityYields(game, game.cities[0]).prod;
  p.policies.push('worker_faculties');
  ok(cityYields(game, game.cities[0]).science >= 0 && cityYields(game, game.cities[0]).prod === prod, 'tenets are policies with effects');
});

test('ideological dissent: civs of another ideology whose tourism tells; twice with Dictatorship of the Proletariat', () => {
  const { game, at } = blank();
  const [p, q] = game.players;
  city(game, 0, at(3, 3));
  city(game, 1, at(14, 3));
  p.ideology = 'freedom';
  q.ideology = 'order';
  p.lifetimeCulture = 300;
  q.tourism[0] = 50;
  eq(dissent(game, p), 0, 'little influence');
  q.tourism[0] = 120;
  eq(dissent(game, p), 2, 'popular: unrest');
  q.policies.push('dictatorship_of_the_proletariat');
  eq(dissent(game, p), 4, 'twice');
});

test('archaeology: sites from ruins and camps, hidden ones, landmarks and artifacts', () => {
  const { game, at } = blank();
  const p = game.players[0];
  techsTo(game, 0, 9);
  const c = city(game, 0, at(5, 5), { buildings: ['museum'] });
  const site = neighbours(game.grid, c.tile)[0];
  game.tiles[site].antiquity = true;
  game.tiles[site].hiddenAntiquity = true;
  const arch = unit(game, 'archaeologist', 0, site);
  ok(!canDig(game, arch, 'landmark'), 'hidden');
  adopt(game, 0, 'treasure_fleets');
  ok(canDig(game, arch, 'landmark') && canDig(game, arch, 'artifact'), 'revealed');
  ok(apply(game, 0, { t: 'build', unit: arch.id, what: 'artifact' }).ok, 'dig');
  for (let i = 0; i < 5; i++) endTurn(game);
  ok(!game.units.includes(arch), 'the archaeologist is done');
  eq(c.works?.museum?.length, 1, 'an artifact in the museum');
  ok(!game.tiles[site].antiquity, 'the site is used up');
  void p;
});

test('Korea’s scholars and the Hanse, Scholasticism, Fine Arts', () => {
  const { game, at } = blank(['korea', 'germany'], { cityStates: 1 });
  const p = game.players[0];
  const c = city(game, 0, at(5, 5), { pop: 4 });
  techsTo(game, 0, 2);
  p.researching = 'optics';
  p.gold = 9999;
  ok(apply(game, 0, { t: 'buy', city: c.id, item: { kind: 'building', id: 'library' }, with: 'gold' }).ok, 'a library');
  ok((p.research.optics ?? 0) >= 10, 'a boost of science');
  const cs = game.players.findIndex((x) => x.cityState);
  city(game, cs, at(15, 12), { pop: 6 });
  p.influence[cs] = 90;
  adopt(game, 0, 'scholasticism', 'fine_arts');
  const culture = p.culture;
  endTurn(game);
  ok((p.lastIncome?.science ?? 0) > cityYields(game, c).science, 'allied science');
  ok(p.culture - culture > cityYields(game, c).culture, 'excess happiness to culture');
});

test('what each screen is told: antiquity sites with Archaeology, no hidden submarines, units that can pillage, what faith buys', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  const p = game.players[0];
  const c = city(game, 0, at(5, 5));
  const site = at(9, 5);
  game.tiles[site].antiquity = true;
  unit(game, 'warrior', 0, at(8, 5));
  const known = (v: ReturnType<typeof viewFor>) => unpackKnown(v.tiles[site]!);
  ok(!known(viewFor(game, p, null)).antiquity, 'no site before Archaeology');
  p.techs.push('archaeology');
  ok(known(viewFor(game, p, null)).antiquity, 'a site with it');
  for (let col = 0; col < 26; col++) game.tiles[at(col, 12)].terrain = 'ocean';
  unit(game, 'trireme', 0, at(10, 12));
  const sub = unit(game, 'submarine', 1, at(12, 12));
  ok(!viewFor(game, p, null).units.some((u) => u.id === sub.id), 'a submarine two tiles off is hidden');
  ok(viewFor(game, null, null).units.some((u) => u.id === sub.id), 'spectators see it');
  const raider = unit(game, 'warrior', 0, at(14, 5));
  game.tiles[raider.tile].road = 'road';
  ok(viewFor(game, p, null).units.find((u) => u.id === raider.id)?.pillage === true, 'it can pillage');
  game.religions.r1 = { founder: 0, holyCity: c.id, name: 'One', beliefs: ['tithe', 'mosques', 'holy_warriors'] };
  p.religion = 'r1';
  c.followers = { r1: 1 };
  p.techs.push('bronze_working');
  const offers = cityInfo(game, p, c).options.filter((o) => o.faith);
  ok(['missionary', 'mosque', 'spearman'].every((id) => offers.some((o) => o.id === id)), 'faith buys missionaries, mosques and (Holy Warriors) spearmen');
});

test('edge cases: Great War units are soldiers, civilians are taken by stepping in, nukes spare peaceful land and cities’ roads', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  const gwi = unit(game, 'great_war_infantry', 1, at(10, 8));
  eq(occupants(game, gwi.tile).military, gwi, 'great war infantry is a military unit');
  const swordsman = unit(game, 'swordsman', 0, at(9, 8));
  ok(apply(game, 0, { t: 'attack', unit: swordsman.id, target: gwi.tile }).ok && gwi.owner === 1, 'it is fought, not captured');
  const worker = unit(game, 'worker', 1, at(12, 12));
  const raider = unit(game, 'warrior', 0, at(11, 12));
  ok(apply(game, 0, { t: 'attack', unit: raider.id, target: worker.tile }).ok, 'capture a worker');
  ok(raider.tile === worker.tile && worker.owner === 0, 'the captor steps onto its tile');
  techsTo(game, 0, 14);
  const home = city(game, 0, at(3, 3), { buildings: ['manhattan_project'] });
  const bomb = unit(game, 'atomic_bomb', 0, home.tile);
  const theirs = city(game, 1, at(12, 3));
  game.players[1].diplomacy.war[0] = game.players[0].diplomacy.war[1] = false;
  ok(!apply(game, 0, { t: 'attack', unit: bomb.id, target: neighbours(game.grid, theirs.tile)[0] }).ok, "no nuking a peaceful civ's land");
  war(game, 0, 1);
  ok(apply(game, 0, { t: 'attack', unit: bomb.id, target: theirs.tile }).ok, 'at war');
  ok(!game.tiles[theirs.tile].pillaged, "the city's own tile keeps its road");
});

test('edge cases: great people find room (an admiral by the sea), captured works go with their buildings, no gifts of garrisons', () => {
  const { game, at } = blank();
  const p = game.players[0];
  city(game, 0, at(3, 3));
  game.tiles[at(4, 14)].terrain = 'coast';
  city(game, 0, at(3, 14));
  p.greatChoices = 1;
  ok(apply(game, 0, { t: 'greatChoice', kind: 'admiral' }).ok, 'an admiral');
  const admiral = game.units.find((u) => u.type === 'great_admiral');
  ok(!!admiral && distance(game.grid, admiral.tile, at(3, 14)) <= 2, 'born by the city on the coast');
  war(game, 0, 1);
  const art = city(game, 1, at(14, 12), { buildings: ['museum', 'amphitheater'] });
  art.works = { museum: ['A'], amphitheater: ['B'] };
  art.hp = 1;
  const sword = unit(game, 'swordsman', 0, neighbours(game.grid, art.tile)[0]);
  ok(apply(game, 0, { t: 'attack', unit: sword.id, target: art.tile }).ok && art.owner === 0, 'taken');
  ok(Object.keys(art.works ?? {}).every((b) => art.buildings.includes(b)), 'no works in buildings that are gone');
  const gifts = blank(['egypt', 'babylon'], { cityStates: 1 });
  const cs = gifts.game.players.findIndex((x) => x.cityState);
  const csCity = city(gifts.game, cs, gifts.at(10, 8));
  const mine = city(gifts.game, 0, gifts.at(13, 8));
  for (const t of neighbours(gifts.game.grid, mine.tile)) if (distance(gifts.game.grid, t, csCity.tile) <= 1) gifts.game.tiles[t].owner = cs;
  const guard = unit(gifts.game, 'warrior', 0, mine.tile);
  ok(!apply(gifts.game, 0, { t: 'giftUnit', unit: guard.id, target: cs }).ok, "not a city's garrison");
});

test('a capital taken loses its civ the spaceship (Civ V’s)', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  city(game, 0, at(3, 3));
  const capital = city(game, 1, at(14, 12));
  ok(!!capital.capital, 'their first city is their capital');
  game.players[1].spaceship = ['ss_booster', 'ss_cockpit'];
  capital.hp = 1;
  const sword = unit(game, 'swordsman', 0, neighbours(game.grid, capital.tile)[0]);
  ok(apply(game, 0, { t: 'attack', unit: sword.id, target: capital.tile }).ok && capital.owner === 0, 'taken');
  eq(game.players[1].spaceship.length, 0, 'its parts lost with it');
});

test('a puppet chooses its own builds and takes no purchases; annexed, it is unhappy till a Courthouse', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  city(game, 0, at(3, 3));
  city(game, 1, at(14, 12));
  const taken = city(game, 1, at(10, 6), { pop: 6 });
  taken.hp = 1;
  const sword = unit(game, 'swordsman', 0, neighbours(game.grid, taken.tile)[0]);
  ok(apply(game, 0, { t: 'attack', unit: sword.id, target: taken.tile }).ok && taken.owner === 0 && !!taken.puppet, 'taken, a puppet');
  ok(taken.queue.length === 1, 'building something of its own');
  const p = game.players[0];
  p.gold = 5000;
  const orders: Order[] = [
    { t: 'produce', city: taken.id, item: { kind: 'unit', id: 'warrior' } },
    { t: 'buy', city: taken.id, item: { kind: 'unit', id: 'warrior' }, with: 'gold' },
    { t: 'unqueue', city: taken.id, index: 0 },
    { t: 'repeat', city: taken.id, on: true },
  ];
  for (const o of orders) ok(!apply(game, 0, o).ok, `a puppet refuses ${o.t}`);
  eq(p.gold, 5000, 'nothing bought');
  const puppet = happiness(game, p);
  ok(apply(game, 0, { t: 'cityChoice', city: taken.id, choice: 'annex' }).ok && !taken.puppet, 'annexed');
  ok(happiness(game, p) <= puppet - 2, 'annexed, its people are unhappy at the occupation');
  ok(apply(game, 0, { t: 'produce', city: taken.id, item: { kind: 'unit', id: 'warrior' } }).ok, 'and it takes orders');
  taken.buildings.push('courthouse');
  ok(happiness(game, p) > puppet - 2, 'a Courthouse calms it');
});

test('a bot warns a person of its war five turns ahead (its army massing, its leader’s words), and names its reason as it declares', () => {
  const { game, at } = blank();
  const me = game.players[0];
  const bot = game.players[1];
  me.bot = false;
  const home = city(game, 0, at(4, 6));
  city(game, 1, at(17, 6));
  const rally = at(11, 6);
  for (const t of within(game.grid, rally, 2).slice(0, 10)) unit(game, 'swordsman', 1, t);
  bot.ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {}, plan: { target: 0, city: home.id, stage: 'muster', since: game.turn, rally, why: 'land' } };
  ok(opinionOf(game, bot, me).reasons.some((r) => r.text === 'We covet your land'), 'its leader says why before');
  let warned = -1;
  for (let i = 0; i < 12 && !atWar(game, 0, 1); i++) {
    planWar(makeCtx(game, bot));
    if (warned < 0 && me.notes.some((n) => n.text.includes('army is massing'))) warned = game.turn;
    if (!atWar(game, 0, 1)) game.turn++;
  }
  ok(warned >= 0, 'told its army is massing');
  ok(atWar(game, 0, 1), 'war comes');
  ok(game.turn - warned >= 5, `five turns after the warning at the soonest (${game.turn - warned})`);
  ok(me.notes.some((n) => n.text.includes('has declared war on you! “We covet your land.”')), 'its reason named');
});

test('a person’s automated worker keeps out of reach of an army it was warned of, as of an enemy’s', () => {
  const { game, at } = blank();
  const me = game.players[0];
  me.bot = false;
  const home = city(game, 0, at(4, 6));
  city(game, 1, at(17, 6));
  const worker = unit(game, 'worker', 0, at(6, 6));
  unit(game, 'swordsman', 1, at(8, 6));
  game.players[1].ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {}, plan: { target: 0, city: home.id, stage: 'muster', since: game.turn, rally: at(11, 6), why: 'land', warned: game.turn } };
  // (As its automation moves it: the bots' own workers' logic.)
  workers(makeCtx(game, me), [worker]);
  eq(worker.tile, home.tile, 'gone to its city');
});

test('a bot steals where it can (from a civ ahead), keeps a counter-spy in its best science city once a rival has spies, and reads spies caught in its opinion', () => {
  const { game, at } = blank();
  const me = game.players[0];
  const bot = game.players[1];
  const theirs = city(game, 0, at(4, 6));
  city(game, 1, at(16, 6), { pop: 2 });
  const best = city(game, 1, at(16, 12), { pop: 8, buildings: ['library'] });
  bot.met = [0];
  bot.explored[theirs.tile] = 1;
  spiesOf(me).push({ id: 900, city: null, progress: 0 });
  spiesOf(bot).push({ id: 901, city: null, progress: 0 });
  // (A tech the other could learn now.)
  const open = (p: typeof me, not: string[] = []) => Object.keys(TECHS).find((t) => !p.techs.includes(t) && !not.includes(t) && TECHS[t].needs.every((n) => p.techs.includes(n)))!;
  const start = [...bot.techs];
  me.techs = [...start, open(bot)];
  civilians(makeCtx(game, bot));
  eq(spiesOf(bot)[0].city, theirs.id, 'a lone spy, behind, steals');
  bot.techs = [...me.techs, open(me)];
  civilians(makeCtx(game, bot));
  eq(spiesOf(bot)[0].city, best.id, 'ahead, nothing to steal: it guards its best city for science');
  spiesOf(bot).push({ id: 902, city: null, progress: 0 });
  bot.techs = [...start];
  civilians(makeCtx(game, bot));
  ok(spiesOf(bot).some((s) => s.city === best.id) && spiesOf(bot).some((s) => s.city === theirs.id), 'with two, one guards and one steals');
  const before = opinionOf(game, bot, me).total;
  remember(game, 'spy', 0, 1);
  ok(opinionOf(game, bot, me).total < before, 'a spy caught (or a theft traced) is held against the thief');
});

test('a bot city in reach of the enemy’s bombers trains an anti-aircraft gun first, and the gun keeps by its city', () => {
  const { game, at } = blank();
  const bot = game.players[1];
  const theirs = city(game, 0, at(4, 6));
  const home = city(game, 1, at(9, 6), { pop: 6 });
  techsTo(game, 1, TECHS.ballistics.col);
  war(game, 0, 1);
  unit(game, 'great_war_bomber', 0, theirs.tile);
  eq(pickProduction(makeCtx(game, bot), home).id, 'anti_aircraft_gun', 'an anti-aircraft gun');
  const gun = unit(game, 'anti_aircraft_gun', 1, at(12, 6));
  game.turn = 100;
  moveUnits(makeCtx(game, bot), new Set());
  ok(distance(game.grid, gun.tile, home.tile) < 3, 'back toward its city');
});

test('a bot in the World Congress proposes the funding its aim wants, and votes down an embargo on itself', () => {
  const { game, at } = blank();
  const bot = game.players[1];
  city(game, 0, at(4, 6));
  city(game, 1, at(16, 6));
  game.congress = { host: 1, next: game.turn + 30, proposals: [], active: [] };
  bot.ai = { aim: 'culture', aimed: game.turn, wars: {}, orders: {} };
  eq(congressProposal(game, bot)?.kind, 'arts_funding', 'Arts Funding for a culture aim');
  eq(congressVote(game, bot, { id: 1, by: 0, kind: 'embargo', civ: 1, votes: {} }), 'no', 'no embargo on itself');
  eq(congressVote(game, bot, { id: 2, by: 0, kind: 'sciences_funding', votes: {} }), 'no', 'nor the funding against its aim');
  game.congress.active.push({ kind: 'sciences_funding', since: game.turn });
  ok(congressProposal(game, bot)?.repeal === true, 'and it moves to repeal what hurts it');
});

/** A bot (the second civ) with an army at its rally point against a person (the first): the world, and the turns from its plan to its war (and its massing note). */
function warOnPerson(plan: { since: number; why?: 'land' }): { warned: number; war: number; note: string } {
  const { game, at } = blank();
  const me = game.players[0];
  const bot = game.players[1];
  me.bot = false;
  game.turn = 100;
  const home = city(game, 0, at(4, 6));
  city(game, 1, at(17, 6));
  const rally = at(11, 6);
  for (const t of within(game.grid, rally, 2).slice(0, 10)) unit(game, 'swordsman', 1, t);
  bot.ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {}, plan: { target: 0, city: home.id, stage: 'muster', since: game.turn + plan.since, rally, ...(plan.why ? { why: plan.why } : {}) } };
  let warned = -1;
  for (let i = 0; i < 12 && !atWar(game, 0, 1); i++) {
    planWar(makeCtx(game, bot));
    if (warned < 0 && me.notes.some((n) => n.text.includes('army is massing'))) warned = game.turn;
    if (!atWar(game, 0, 1)) game.turn++;
  }
  return { warned, war: atWar(game, 0, 1) ? game.turn : -1, note: me.notes.find((n) => n.text.includes('army is massing'))?.text ?? '' };
}

test('a war plan from an old save (no reason, no warning, long since made) still warns, with a reason, five turns ahead', () => {
  const { warned, war, note } = warOnPerson({ since: -40 });
  ok(warned >= 0 && war >= 0, `warned (${warned}) and at war (${war})`);
  ok(war - warned >= 5, `five turns after the warning (${war - warned})`);
  ok(note.includes('“'), `with its reason (${note})`);
});

test('a war plan whose army is in place from the start still warns five turns ahead', () => {
  const { warned, war } = warOnPerson({ since: 0, why: 'land' });
  eq(warned, 100, 'the warning on the plan’s first turn');
  ok(war >= warned + 5, `the war five turns on at the soonest (${war})`);
});

test('ships explore: a warship may be set to explore, and sails for the edge of the known sea', () => {
  const { game, at } = blank();
  const me = game.players[0];
  me.bot = false;
  city(game, 0, at(4, 6));
  // (A sea down the map's middle, its far end unseen.)
  for (let row = 0; row < game.grid.height; row++) for (let col = 6; col <= 8; col++) Object.assign(game.tiles[at(col, row)], { terrain: 'coast', height: 0 });
  const ship = unit(game, 'trireme', 0, at(7, 6));
  me.explored = me.explored.map(() => 0);
  for (const t of within(game.grid, at(7, 6), 2)) me.explored[t] = 1;
  ok(apply(game, 0, { t: 'automate', unit: ship.id, mode: 'explore' }).ok, 'a warship can be set to explore');
  const before = ship.tile;
  ok(exploreSea(makeCtx(game, me), ship) && ship.tile !== before, 'and it sails for the unknown');
});

// -------------------------------------------------------------------------------------------------
// Natural wonders
// -------------------------------------------------------------------------------------------------

/** A natural wonder on a tile, as the map makes one (a mountain to the rules unless it can be entered), found by whoever has seen the tile. */
function naturalWonder(game: Game, t: number, id: string) {
  const w = NATURAL_WONDERS[id];
  ok(!!w, `no natural wonder ${id}`);
  game.tiles[t].wonder = id;
  if (!w.passable) Object.assign(game.tiles[t], { elevation: 'mountain', height: w.top });
  updateAllVisibility(game);
}

test('natural wonders: found once by each civ, happier for good; the first finder has golden-age points (and the Gilded Peak its gold)', () => {
  const { game, at } = blank();
  const [a, b] = game.players;
  // (A person: bots aren't told things.)
  a.bot = false;
  city(game, 0, at(3, 8));
  city(game, 1, at(21, 8));
  const peak = at(12, 8);
  naturalWonder(game, peak, 'gilded_peak');
  const moods = [happiness(game, a), happiness(game, b)];
  unit(game, 'scout', 0, at(10, 8));
  eq(game.found?.gilded_peak?.by.join(), '0', 'found by the first');
  eq(happiness(game, a) - moods[0], 1, 'happier for it');
  eq(a.goldenPoints, 40, 'golden-age points (60, quick speed)');
  eq(a.gold, 67, 'the Gilded Peak’s gold (100, quick speed)');
  ok(a.notes.some((n) => n.kind === 'wonder' && n.at === peak && n.text.includes('first')), 'told, as the first');
  unit(game, 'scout', 1, at(14, 8));
  eq(game.found?.gilded_peak?.by.join(), '0,1', 'then by the second');
  eq(happiness(game, b) - moods[1], 1, 'the second is happier too');
  eq(b.goldenPoints + b.gold, 0, 'but has no finder’s gifts');
  endTurn(game);
  eq(game.found?.gilded_peak?.by.join(), '0,1', 'found once each');
  eq(happiness(game, a) - moods[0], 1, 'still one happier');
  // City-states and barbarians find nothing; nor does anyone what they haven't seen.
  const v = viewFor(game, a, null);
  eq(unpackKnown(v.tiles[peak]!).wonder, 'gilded_peak', 'its id on the known tile');
  eq(v.self.naturalWonders.map((x) => `${x.id}:${x.first}`).join(), 'gilded_peak:true', 'in the finder’s view');
  const far = at(12, 15);
  naturalWonder(game, far, 'sky_pillar');
  ok(viewFor(game, a, null).tiles[far] === null, 'an unseen one isn’t sent');
});

test('natural wonders: their tile yields their own yields, worked though it can’t be entered; nothing built or founded on them; One with Nature', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(8, 8), { pop: 1 });
  const t = neighbours(game.grid, c.tile)[0];
  naturalWonder(game, t, 'mount_solace');
  eq(JSON.stringify(tileYields(game, t, game.players[0])), JSON.stringify({ faith: 6 }), 'its yields');
  ok(workable(game, c).includes(t), 'workable');
  ok(!canStand(game, 'warrior', t), 'can’t be entered');
  c.locked = [t];
  assignCitizens(game, c);
  ok(c.worked.includes(t), 'worked');
  const faith = cityYields(game, c).faith;
  game.players[0].pantheon = 'one_with_nature';
  eq(cityYields(game, c).faith - faith, 4, 'One with Nature: +4 faith');
  // Mount Solace: +2 happiness in its owner's land.
  const mood = happiness(game, game.players[0]);
  game.tiles[t].owner = -1;
  eq(mood - happiness(game, game.players[0]), 2, 'Mount Solace’s happiness');
  // A wonder that can be entered: no improvements, roads, cities or great people's works on it.
  const grove = at(12, 8);
  game.tiles[grove].elevation = 'hills';
  naturalWonder(game, grove, 'stone_grove');
  game.tiles[grove].owner = 0;
  const w = unit(game, 'worker', 0, grove);
  ok(canStand(game, 'warrior', grove), 'the Stone Grove can be entered');
  ok(!canBuild(game, w, 'mine') && !canBuild(game, w, 'road'), 'nothing built on it');
  ok(!canFound(game, grove), 'no city on it');
  const gp = unit(game, 'great_engineer', 0, grove);
  ok(!apply(game, 0, { t: 'greatPerson', unit: gp.id, action: 'improvement' }).ok, 'no great improvement on it');
});

test('natural wonders: the Ember Throne enriches the land round it; the falls and the spring give fresh water', () => {
  const { game, at } = blank();
  const t = at(10, 8);
  const n = neighbours(game.grid, t)[0];
  const food = tileYields(game, n, null).food ?? 0;
  ok(!freshWater(game, n), 'no fresh water on open grassland');
  naturalWonder(game, t, 'ember_throne');
  eq((tileYields(game, n, null).food ?? 0) - food, 1, 'ash: +1 food next to it');
  eq(tileYields(game, at(13, 8), null).food ?? 0, food, 'not further off');
  game.tiles[t].wonder = 'emerald_falls';
  ok(freshWater(game, n), 'fresh water by the falls');
  game.tiles[t].wonder = 'ageless_spring';
  ok(freshWater(game, n), 'and by the spring');
});

test('natural wonders: beside the Ageless Spring units heal fully, beside the Cloudcrown they train, beside the Sky Pillar they see further', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  const spring = at(10, 8);
  naturalWonder(game, spring, 'ageless_spring');
  const [n1, n2] = neighbours(game.grid, spring);
  const rested = unit(game, 'warrior', 0, n1, { hp: 30 });
  const marched = unit(game, 'warrior', 0, n2, { hp: 30, moves: 0 });
  const away = unit(game, 'warrior', 0, at(16, 8), { hp: 30 });
  endTurn(game);
  eq(rested.hp, 100, 'healed fully');
  eq(marched.hp, 100, 'even after moving');
  ok(away.hp < 100, 'not further off');
  const crown = at(10, 13);
  naturalWonder(game, crown, 'cloudcrown');
  const [c1, c2] = neighbours(game.grid, crown);
  const soldier = unit(game, 'warrior', 0, c1);
  const worker = unit(game, 'worker', 0, c2);
  endTurn(game);
  ok(soldier.promotions.includes('altitude_training'), 'Altitude Training');
  ok(!worker.promotions.includes('altitude_training'), 'only for units that fight');
  eq(promotionsDue(soldier), 0, 'given, not earned');
  // Altitude Training: heals on the march.
  soldier.hp = 50;
  soldier.moves = 0;
  endTurn(game);
  ok(soldier.hp > 50, 'heals after moving');
  const pillar = at(18, 4);
  naturalWonder(game, pillar, 'sky_pillar');
  const scout = unit(game, 'warrior', 0, neighbours(game.grid, pillar)[0]);
  eq(unitSight(game, scout) - unitSight(game, away), 1, 'one further beside the Sky Pillar');
});

test('map generation: Horses and Iron within four tiles of every civ’s start, Coal and Oil on its landmass (Strategic Balance)', () => {
  let starts = 0;
  let coal = 0;
  let oil = 0;
  for (const wrap of [false, true])
    for (const size of ['small', 'standard'] as MapSize[])
      for (const type of ['continents', 'pangaea', 'archipelago'] as const)
        for (const seed of [1, 2, 3, 4]) {
          const m = MAP_SIZES[size];
          const g = { width: m.width, height: m.height, wrap };
          const map = generate(g, seed, type, m.players, m.cityStates);
          for (const s of map.starts.slice(0, m.players)) {
            const has = (id: string, r: number) => within(g, s, r).some((t) => map.tiles[t].resource === id);
            ok(has('horses', 4) && has('iron', 4), `${size} ${type} ${seed}${wrap ? ' (wraps)' : ''}: Horses and Iron near the start at ${s}`);
            starts++;
            if (has('coal', 10)) coal++;
            if (has('oil', 10)) oil++;
          }
        }
  ok(coal >= starts * 0.9 && oil >= starts * 0.9, `Coal (${coal}) and Oil (${oil}) within reach of nearly all ${starts} starts`);
});

test('map generation: Aluminum and Uranium across every map, as in Civ V (about as much Aluminum as Iron, Uranium about half), and most city-states with a little Coal, Oil or Aluminum beside them', () => {
  const total = { iron: 0, aluminum: 0, uranium: 0 };
  let cityStates = 0;
  let supplied = 0;
  for (const size of ['duel', 'small', 'standard'] as MapSize[])
    for (const type of ['continents', 'pangaea', 'archipelago', 'fractal'] as const)
      for (const seed of [1, 2, 3, 4]) {
        const m = MAP_SIZES[size];
        const g = { width: m.width, height: m.height, wrap: true };
        const map = generate(g, seed, type, m.players, m.cityStates);
        const count = (id: string) => map.tiles.filter((t) => t.resource === id).length;
        // (Left to chance before, a small map often had no Aluminum at all.)
        ok(count('aluminum') > 0 && count('uranium') > 0, `${size} ${type} ${seed}: Aluminum (${count('aluminum')}) and Uranium (${count('uranium')}) somewhere`);
        for (const id of ['iron', 'aluminum', 'uranium'] as const) total[id] += count(id);
        for (const cs of map.starts.slice(m.players, m.players + m.cityStates)) {
          cityStates++;
          if (within(g, cs, 3).some((t) => ['coal', 'oil', 'aluminum'].includes(map.tiles[t].resource ?? ''))) supplied++;
        }
      }
  ok(total.aluminum >= total.iron * 0.75 && total.aluminum <= total.iron * 1.5, `about as much Aluminum (${total.aluminum}) as Iron (${total.iron})`);
  ok(total.uranium >= total.aluminum * 0.35 && total.uranium <= total.aluminum * 0.8, `Uranium (${total.uranium}) about half as common as Aluminum`);
  ok(supplied >= cityStates * 0.7, `most city-states (${supplied} of ${cityStates}) with Coal, Oil or Aluminum beside them`);
});

test('map generation: an archipelago is many islands, the civs mostly each on their own, each with room for three or four cities', () => {
  for (const wrap of [false, true])
    for (const size of ['small', 'standard', 'large'] as MapSize[]) {
      const m = MAP_SIZES[size];
      const g = { width: m.width, height: m.height, wrap };
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { tiles, starts } = generate(g, seed, 'archipelago', m.players, m.cityStates);
        const land = tiles.map((x) => !TERRAINS[x.terrain].water);
        const island = new Array<number>(tiles.length).fill(-1);
        const sizes: number[] = [];
        for (let t = 0; t < tiles.length; t++) {
          if (!land[t] || island[t] >= 0) continue;
          const stack = [t];
          island[t] = sizes.length;
          let count = 0;
          while (stack.length) {
            const x = stack.pop()!;
            count++;
            for (const y of neighbours(g, x)) if (land[y] && island[y] < 0) (island[y] = sizes.length), stack.push(y);
          }
          sizes.push(count);
        }
        const total = sizes.reduce((a, b) => a + b, 0);
        ok(sizes.length >= m.players, `${size} ${seed}${wrap ? ' (wraps)' : ''}: ${sizes.length} islands`);
        ok(Math.max(...sizes) < total * 0.3, `${size} ${seed}${wrap ? ' (wraps)' : ''}: the largest ${Math.max(...sizes)} of ${total}`);
        const homes = new Set(starts.slice(0, m.players).map((t) => island[t]));
        ok(homes.size >= Math.ceil(m.players * 0.75), `${size} ${seed}${wrap ? ' (wraps)' : ''}: the civs on ${homes.size} islands`);
        for (const t of starts.slice(0, m.players)) ok(sizes[island[t]] >= START_ISLAND, `${size} ${seed}${wrap ? ' (wraps)' : ''}: a civ's island of ${sizes[island[t]]} (room for three or four cities: ${START_ISLAND})`);
      }
    }
});

test('map generation: natural wonders by the map’s size, the same for a seed, off the starts, spread apart, each its tiles’ own', () => {
  for (const wrap of [false, true])
    for (const [size, want] of [['duel', 2], ['small', 3], ['standard', 4], ['large', 5]] as [MapSize, number][]) {
      const m = MAP_SIZES[size];
      const g = { width: m.width, height: m.height, wrap };
      for (const seed of [3, 11]) {
        const { tiles, starts } = generate(g, seed, 'continents', m.players, m.cityStates);
        const again = generate(g, seed, 'continents', m.players, m.cityStates).tiles;
        const placed = tiles.flatMap((tile, t) => (tile.wonder ? [t] : []));
        const ids = new Set(placed.map((t) => tiles[t].wonder!));
        eq(ids.size, want, `${size} ${seed}${wrap ? ' (wraps)' : ''}: how many`);
        eq(again.map((x) => x.wonder ?? '').join(), tiles.map((x) => x.wonder ?? '').join(), `${size} ${seed}${wrap ? ' (wraps)' : ''}: the same each time`);
        for (const t of placed) {
          const tile = tiles[t];
          const w = NATURAL_WONDERS[tile.wonder!];
          const own = placed.filter((o) => tiles[o].wonder === w.id);
          eq(own.length, w.pair ? 2 : 1, `${w.name}: its tiles`);
          ok(own.every((o) => o === t || distance(g, o, t) === 1), `${w.name}: its tiles side by side`);
          ok(starts.slice(0, m.players).every((s) => distance(g, s, t) >= 4), `${w.name}: off the starts`);
          ok(placed.every((o) => own.includes(o) || distance(g, o, t) >= 5), `${w.name}: apart from the others`);
          ok(!tile.resource && !tile.feature && !tile.ruin && !tile.river, `${w.name}: nothing else on it`);
          ok(w.passable ? tile.elevation !== 'mountain' : tile.elevation === 'mountain', `${w.name}: entered or not`);
        }
      }
    }
});

// -------------------------------------------------------------------------------------------------
// A world that wraps round east to west
// -------------------------------------------------------------------------------------------------

test('a world that wraps: the east edge’s neighbours are on the west edge; distances and lines go the short way round', () => {
  const { game, at } = blank(undefined, { wrap: true });
  const g = game.grid;
  const w = g.width;
  // (Odd rows sit half a tile east: the last tile of one has three neighbours in the first column.)
  for (const [a, b] of [[at(w - 1, 4), at(0, 4)], [at(w - 1, 5), at(0, 5)], [at(w - 1, 5), at(0, 4)], [at(w - 1, 5), at(0, 6)], [at(0, 4), at(w - 1, 3)], [at(0, 4), at(w - 1, 5)]]) {
    ok(neighbours(g, a).includes(b) && neighbours(g, b).includes(a), `${a} and ${b}: neighbours across the seam`);
    eq(distance(g, a, b), 1, `${a} and ${b}: a step apart`);
  }
  ok([0, 3, 4, w - 1].every((col) => neighbours(g, at(col, 8)).length === 6), 'six neighbours at either edge');
  eq(at(-1, 8), at(w - 1, 8), 'a column off the west edge is the last');
  eq(distance(g, at(1, 8), at(w - 2, 8)), 3, 'three steps round the back, not across the map');
  eq(distance(g, at(1, 3), at(w - 2, 9)), 6, 'and so on a slant');
  eq(distance(g, at(0, 8), at(w / 2, 8)), w / 2, 'half the world away is as far as it gets');
  for (let a = 0; a < g.width * g.height; a += 37) for (let b = 0; b < g.width * g.height; b += 23) eq(distance(g, a, b), distance(g, b, a), `the same both ways (${a}, ${b})`);
  eq(line(g, at(2, 8), at(w - 3, 8)).join(), [at(2, 8), at(1, 8), at(0, 8), at(w - 1, 8), at(w - 2, 8), at(w - 3, 8)].join(), 'a line runs across the seam');
  const round = within(g, at(0, 8), w);
  eq(new Set(round).size, round.length, 'every tile within reach once, even round the whole world');
  // A flat world (an old save's) is as it was.
  const flat = blank();
  eq(distance(flat.game.grid, flat.at(1, 8), flat.at(w - 2, 8)), w - 3, 'flat: the long way');
  eq(neighbours(flat.game.grid, flat.at(0, 4)).length, 3, 'flat: an edge tile has fewer neighbours');
  eq(flat.at(-1, 8), -1, 'flat: nothing off the edge');
});

test('a world that wraps: units see, walk, fire and settle across the seam; cities’ borders run across it', () => {
  const { game, at } = blank(undefined, { wrap: true });
  const w = game.grid.width;
  game.players[0].bot = false;
  city(game, 0, at(6, 3));
  city(game, 1, at(16, 14));
  const scout = unit(game, 'warrior', 0, at(1, 8));
  ok(game.players[0].visible[at(w - 1, 8)] > 0, 'it sees round the seam');
  const way = planPath(game, scout, at(w - 2, 8))!;
  eq(way.length, 3, 'the way west across the seam is three steps');
  ok(way.includes(at(0, 8)) && way.includes(at(w - 1, 8)), 'through the edge columns');
  ok(apply(game, 0, { t: 'move', unit: scout.id, to: at(w - 2, 8) }).ok, 'sent across');
  endTurn(game);
  endTurn(game);
  eq(scout.tile, at(w - 2, 8), 'it got there');
  // A city on the west edge: its first ring across the seam.
  const port = city(game, 0, at(0, 12));
  for (const t of within(game.grid, port.tile, 1)) eq(game.tiles[t].owner, 0, `its tile ${t}`);
  ok(game.tiles[at(w - 1, 12)].owner === 0, 'its land on the east edge');
  // An archer fires across.
  war(game, 0, 1);
  const archer = unit(game, 'archer', 0, at(1, 16));
  const foe = unit(game, 'warrior', 1, at(w - 1, 16));
  const hp = foe.hp;
  ok(apply(game, 0, { t: 'attack', unit: archer.id, target: foe.tile }).ok, 'it shoots across the seam');
  ok(foe.hp < hp, 'and hits');
});

test('a world that wraps: new games wrap unless the lobby says not; the wrap is saved and sent; a game saved flat stays flat', () => {
  const settings = { size: 'duel', type: 'continents', speed: 'quick', timer: 0, cityStates: 0, barbarians: false, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330 } as const;
  const seats = [
    { user: null, name: 'A', civ: 'egypt', bot: true },
    { user: null, name: 'B', civ: 'babylon', bot: true },
  ];
  const round = createGame({ ...settings, victories: { ...settings.victories } }, seats, 5);
  eq(round.grid.wrap, true, 'wraps by default');
  eq(JSON.parse(JSON.stringify(round)).grid.wrap, true, 'saved with it');
  eq(mapWire(round).grid.wrap, true, 'and the screens told');
  const flat = createGame({ ...settings, victories: { ...settings.victories }, wrap: false }, seats, 5);
  ok(!('wrap' in flat.grid), 'a flat one is as a game always was');
  // The same seed, flat, makes the same world as it always did (one saved before the wrap is the same).
  const before = generate({ width: MAP_SIZES.duel.width, height: MAP_SIZES.duel.height }, 5, 'continents', 2, 0);
  eq(flat.tiles.map((t) => t.terrain).join(), before.tiles.map((t) => t.terrain).join(), 'a flat world from a seed as before');
});

test('map generation on a world that wraps: land runs across the seam, starts spread round it', () => {
  let across = 0;
  for (const type of ['continents', 'pangaea', 'fractal', 'archipelago'] as const)
    for (const size of ['duel', 'small', 'standard', 'large'] as MapSize[])
      for (const seed of [1, 2, 3]) {
        const m = MAP_SIZES[size];
        const g = { width: m.width, height: m.height, wrap: true };
        const { tiles, starts } = generate(g, seed, type, m.players, m.cityStates);
        const land = (t: number) => !TERRAINS[tiles[t].terrain].water;
        for (let row = 0; row < g.height; row++) if (land(row * g.width) && land(row * g.width + g.width - 1)) across++;
        const civs = starts.slice(0, m.players);
        eq(civs.length, m.players, `${type} ${size} ${seed}: a start for every civ`);
        for (const a of civs) for (const b of civs) ok(a === b || distance(g, a, b) >= 4, `${type} ${size} ${seed}: starts apart round the world (${distance(g, a, b)})`);
        // (The poles: ice or sea on the top and bottom rows.)
        for (const row of [0, g.height - 1]) for (let col = 0; col < g.width; col++) ok(!land(row * g.width + col), `${type} ${size} ${seed}: sea at the poles`);
      }
  ok(across > 20, `land crosses the seam (${across} rows)`);
});

test('the new map types: every civ a start, spread apart, Strategic Balance kept; the same seed the same world', () => {
  for (const type of ['inland_sea', 'highlands', 'earth'] as const)
    for (const size of ['duel', 'small', 'standard', 'large', 'huge'] as MapSize[])
      for (const wrap of [true, false])
        for (const seed of [1, 2]) {
          const m = MAP_SIZES[size];
          const g = { width: m.width, height: m.height, wrap };
          const what = `${type} ${size} ${seed}${wrap ? ' (wraps)' : ''}`;
          const { tiles, starts } = generate(g, seed, type, m.players, m.cityStates);
          eq(JSON.stringify(generate(g, seed, type, m.players, m.cityStates).tiles), JSON.stringify(tiles), `${what}: the same each time`);
          const civs = starts.slice(0, m.players);
          eq(civs.length, m.players, `${what}: a start for every civ`);
          for (const a of civs) for (const b of civs) ok(a === b || distance(g, a, b) >= 4, `${what}: starts apart (${distance(g, a, b)})`);
          for (const t of civs) ok(within(g, t, 4).some((x) => tiles[x].resource === 'horses') && within(g, t, 4).some((x) => tiles[x].resource === 'iron'), `${what}: Horses and Iron near ${t}`);
        }
});

test('an inland sea: one great sea in the middle with land all round it; highlands: hills and mountains over much of the land', () => {
  for (const seed of [1, 2, 3]) {
    const m = MAP_SIZES.standard;
    const g = { width: m.width, height: m.height };
    const { tiles } = generate(g, seed, 'inland_sea', m.players, m.cityStates);
    const water = (t: number) => !!TERRAINS[tiles[t].terrain].water;
    ok(water(tileAt(g, Math.floor(g.width / 2), Math.floor(g.height / 2))), `${seed}: sea in the middle`);
    const land = tiles.filter((_, t) => !water(t)).length;
    ok(land > tiles.length * 0.5, `${seed}: mostly land (${land} of ${tiles.length})`);
    const high = generate(g, seed, 'highlands', m.players, m.cityStates).tiles.filter((x) => !TERRAINS[x.terrain].water);
    const rough = high.filter((x) => x.elevation !== 'flat').length;
    ok(rough > high.length * 0.4, `${seed}: highlands ${rough} of ${high.length} land tiles hills or mountains`);
    const plain = generate(g, seed, 'fractal', m.players, m.cityStates).tiles.filter((x) => !TERRAINS[x.terrain].water);
    ok(rough / high.length > (2 * plain.filter((x) => x.elevation !== 'flat').length) / plain.length, `${seed}: twice a fractal map's share`);
  }
});

test('the Earth map: its continents, deserts, ranges and great rivers where they are, and true starting places where the civs began', () => {
  for (const size of ['small', 'standard', 'large', 'huge'] as MapSize[]) {
    const m = MAP_SIZES[size];
    const g = { width: m.width, height: m.height, wrap: true };
    const civs = ['egypt', 'china', 'england', 'aztec', 'russia', 'india'];
    const { tiles, starts } = generate(g, 4, 'earth', civs.length, 0, civs);
    const at = (lon: number, lat: number) => tiles[tileOfLonLat(g, [lon, lat])];
    const land = (lon: number, lat: number) => !TERRAINS[at(lon, lat).terrain].water;
    ok(land(20, 0) && land(100, 50) && land(-100, 45) && land(-60, -10) && land(135, -25), `${size}: Africa, Asia, the Americas, Australia`);
    ok(!land(-35, 30) && !land(-150, 10) && !land(80, -20), `${size}: the Atlantic, Pacific and Indian Oceans`);
    eq(at(10, 25).terrain, 'desert', `${size}: the Sahara`);
    ok(at(86, 28).elevation !== 'flat', `${size}: the Himalaya`);
    ok(tiles.some((x, t) => x.river && Math.abs(lonLatOf(g, t)[0] - 32) < 8 && Math.abs(lonLatOf(g, t)[1] - 22) < 6), `${size}: the Nile`);
    civs.forEach((civ, i) => ok(distance(g, starts[i], tileOfLonLat(g, TRUE_STARTS[civ])) <= 3, `${size}: ${civ} starts where it began (${distance(g, starts[i], tileOfLonLat(g, TRUE_STARTS[civ]))} away)`));
    // (England on its island: not joined by land to France's.)
    const fair = generate(g, 4, 'earth', civs.length, 0).starts;
    ok(civs.some((civ, i) => distance(g, fair[i], tileOfLonLat(g, TRUE_STARTS[civ])) > 3), `${size}: without true starts, starts are placed the usual way`);
  }
  // A game on the Earth, true starts asked, seats each civ at home; city-states at theirs where they fit.
  const seats = ['germany', 'korea'].map((civ) => ({ user: null, name: civ, civ, bot: true }));
  const settings = { ...blank().game.settings, size: 'standard' as MapSize, type: 'earth' as const, trueStarts: true, cityStates: 4, wrap: true };
  const game = createGame(settings, seats, 9);
  for (const p of game.players.filter((x) => !x.cityState && TRUE_STARTS[x.civ])) {
    const u = game.units.find((x) => x.owner === p.index && x.type === 'settler')!;
    ok(distance(game.grid, u.tile, tileOfLonLat(game.grid, TRUE_STARTS[p.civ])) <= 3, `${p.civ}'s settler at home`);
  }
});

test('game speeds: Epic and Marathon stretch growth, research, deals and golden ages as Civ V does, and set their turn limits', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(5, 5), { pop: 4 });
  const measure = () => ({ grow: growthThreshold(game, 4), tech: techCost(game, game.players[0], 'writing'), deal: dealTurns(game) });
  game.settings.speed = 'standard';
  const std = measure();
  for (const [sp, k] of [['quick', 0.67], ['epic', 1.5], ['marathon', 3]] as const) {
    game.settings.speed = sp;
    const x = measure();
    ok(Math.abs(x.grow / std.grow - k) < 0.05 && Math.abs(x.tech / std.tech - k) < 0.05 && Math.abs(x.deal / std.deal - k) < 0.05, `${sp}: ${JSON.stringify(x)} against ${JSON.stringify(std)}`);
    eq(TURN_LIMITS[sp], { quick: 330, epic: 750, marathon: 1500 }[sp], `${sp}'s turn limit`);
  }
  ok(c.pop === 4, 'the city stands');
});

test('a huge map: ten civs and ten city-states, each with a start', () => {
  const civs = CIV_LIST.slice(0, 10).map((c) => c.id);
  const settings = { ...blank().game.settings, size: 'huge' as MapSize, type: 'continents' as const, cityStates: 10, wrap: true };
  const game = createGame(settings, civs.map((civ) => ({ user: null, name: civ, civ, bot: true })), 3);
  eq(game.grid.width * game.grid.height, 88 * 56, 'its size');
  eq(game.players.filter((p) => p.alive && !p.cityState).length, 10, 'every civ in it');
  eq(game.players.filter((p) => p.alive && p.cityState).length, 10, 'every city-state in it');
});

test('natural wonders draw settlers: the bots value a site near one more', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  const site = at(12, 8);
  const before = siteValue(makeCtx(game, game.players[0]), site);
  naturalWonder(game, at(14, 8), 'emerald_falls');
  const after = siteValue(makeCtx(game, game.players[0]), site);
  ok(after > before + 6, `a site two from Emerald Falls is worth more (${before.toFixed(1)} → ${after.toFixed(1)})`);
  ok(siteValue(makeCtx(game, game.players[0]), at(14, 8)) === -Infinity, 'no city on the wonder itself');
});

// -------------------------------------------------------------------------------------------------
// Orders
// -------------------------------------------------------------------------------------------------

test('orders that make no sense fail cleanly (never throw)', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(5, 5));
  const u = unit(game, 'warrior', 0, at(6, 5));
  const junk: unknown[] = [
    null,
    42,
    'move',
    {},
    { t: 'nonsense' },
    { t: '__proto__' },
    { t: 'move' },
    { t: 'move', unit: u.id },
    { t: 'move', unit: u.id, to: -1 },
    { t: 'move', unit: u.id, to: 1e9 },
    { t: 'move', unit: 'x', to: 3 },
    { t: 'attack', unit: u.id, target: NaN },
    { t: 'build', unit: u.id, what: '__proto__' },
    { t: 'build', unit: u.id },
    { t: 'stance', unit: u.id, stance: 'dance' },
    { t: 'produce', city: c.id },
    { t: 'produce', city: c.id, item: null },
    { t: 'produce', city: c.id, item: { kind: 'building', id: '__proto__' } },
    { t: 'produce', city: c.id, item: { kind: 'building', id: 'constructor' } },
    { t: 'buy', city: c.id, item: { kind: 'project', id: 'ss_booster' }, with: 'gold' },
    { t: 'buy', city: c.id, item: { kind: 'unit', id: 'toString' }, with: 'faith' },
    { t: 'buy', city: c.id, item: { kind: 'unit', id: 'warrior' }, with: 'love' },
    { t: 'research', tech: '__proto__' },
    { t: 'research', tech: 'constructor' },
    { t: 'research' },
    { t: 'policy', id: 7 },
    { t: 'religion', unit: u.id, name: 5, beliefs: 'all' },
    { t: 'religion', unit: u.id, name: 'x', beliefs: ['constructor', 'toString'] },
    { t: 'greatChoice', kind: 'prophet' },
    { t: 'greatPerson', unit: u.id, action: 'fly' },
    { t: 'focus', city: c.id, focus: 'everything' },
    { t: 'cityChoice', city: c.id, choice: 'sell' },
    { t: 'gift', target: 9, gold: Infinity },
    { t: 'spy', spy: 1 },
    { t: 'war', target: -5 },
    { t: 'war', target: 99 },
    { t: 'peace', target: 99 },
    { t: 'openBorders', target: 0 },
    { t: 'deal', target: 99, items: 'all' },
    { t: 'automate', unit: u.id, mode: 'fly' },
    { t: 'reorder', city: c.id, from: 0 },
    { t: 'giftUnit', unit: u.id, target: 0 },
    { t: 'paradrop', unit: u.id, to: 3 },
    { t: 'airlift', unit: u.id, to: c.tile },
    { t: 'pillage', unit: u.id },
    { t: 'ready', ready: 'yes' },
  ];
  for (const o of junk) {
    let result;
    try {
      result = apply(game, 0, o as Order);
    } catch (e) {
      throw new Failure(`${JSON.stringify(o)} threw ${String(e)}`);
    }
    ok(!result.ok, `${JSON.stringify(o)} should fail`);
  }
  ok(wellFormed(game, { t: 'move', unit: u.id, to: 3 }), 'a good order is well formed');
  endTurn(game);
  ok(game.cities.includes(c) && !c.buildings.includes('__proto__'), 'nothing odd got in');
});


// -------------------------------------------------------------------------------------------------
// Teams
// -------------------------------------------------------------------------------------------------

/** Players on teams (by index, team by team from 0), bound as a new game binds them. */
function teamUp(game: Game, ...teams: number[][]) {
  teams.forEach((members, t) => {
    for (const i of members) game.players[i].team = t;
  });
  bindTeams(game);
  updateAllVisibility(game);
}

test('teams: teammates have met, their borders are open for good; no war or denouncing between them', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  const [a, b, c] = game.players;
  ok(hasMet(game, a, b) && hasMet(game, b, a), 'teammates have met');
  ok(!hasMet(game, a, c), 'others are strangers still');
  const theirs = city(game, 1, at(10, 8));
  const w = unit(game, 'warrior', 0, neighbours(game.grid, theirs.tile)[0]);
  for (let i = 0; i < 40; i++) endTurn(game);
  eq(game.tiles[w.tile].owner, 1, 'a soldier may stay in a teammate’s land, turn after turn');
  ok(!apply(game, 0, { t: 'war', target: 1 }).ok, 'no war on a teammate');
  ok(denounce(game, a, b) !== null, 'no denouncing a teammate');
});

test('teams: each sees what any of them sees', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  const scout = unit(game, 'scout', 1, at(20, 14));
  const far = unit(game, 'warrior', 2, at(21, 14));
  ok(game.players[0].visible[scout.tile] > 0, 'my teammate’s scout’s sight is mine');
  ok(seesUnit(game, game.players[0], far), 'so is what it sees');
  ok(game.players[0].explored[far.tile] === 1, 'and I’ve explored it');
  ok(!(game.players[2].visible[at(2, 2)] > 0), 'others see only their own');
  const view = viewFor(game, game.players[0], null);
  ok(view.units.some((u) => u.id === far.id), 'my screen shows it');
  eq(view.players[1].team, 0, 'and says who is on my team');
  eq(view.players[2].team, null, 'and who plays alone');
});

test('teams: war and peace are made together', () => {
  const { game } = blank(['egypt', 'babylon', 'germany', 'france']);
  teamUp(game, [0, 1], [2, 3]);
  // (News is for people.)
  game.players[1].bot = false;
  ok(apply(game, 0, { t: 'war', target: 2 }).ok, 'war declared');
  for (const [x, y] of [[0, 2], [0, 3], [1, 2], [1, 3]]) ok(game.players[x].diplomacy.war[y] && game.players[y].diplomacy.war[x], `${x} and ${y} at war`);
  ok(!game.players[0].diplomacy.war[1] && !game.players[2].diplomacy.war[3], 'teammates still at peace');
  ok(game.players[1].notes.some((n) => n.text.includes('your team is at war')), 'a teammate is told');
  endWar(game, game.players[3], game.players[1]);
  for (const [x, y] of [[0, 2], [0, 3], [1, 2], [1, 3]]) ok(!game.players[x].diplomacy.war[y] && game.players[x].diplomacy.peaceTurns[y] === 10, `${x} and ${y} at peace, with a treaty`);
  ok(!apply(game, 1, { t: 'war', target: 2 }).ok, 'the treaty holds for the whole team');
});

test('teams: a team wins together (conquest: holding every capital between them; score: theirs together)', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany', 'france'], { size: 'small' });
  game.settings.victories = { domination: true, science: false, culture: false, diplomatic: false, score: true };
  teamUp(game, [0, 1], [2, 3]);
  game.players[2].bot = false;
  const capitals = [at(3, 3), at(12, 3), at(22, 15), at(30, 18)].map((t, i) => city(game, i, t));
  checkVictory(game);
  ok(!game.over, 'nobody yet');
  capitals[2].owner = 0;
  checkVictory(game);
  ok(!game.over, 'one capital of theirs held: not yet');
  capitals[3].owner = 1;
  for (const t of game.tiles) if (t.city === capitals[3].id) t.owner = 1;
  checkVictory(game);
  ok(!!game.over && game.over.how === 'domination' && [0, 1].includes(game.over.winner), `every capital held between them (${JSON.stringify(game.over)})`);
  ok(game.players[2].notes.some((n) => n.text.startsWith('Team 1 has conquered')), 'the world is told which team won');

  const later = blank(['egypt', 'babylon', 'germany'], { size: 'small' });
  const late = later.game;
  late.settings.victories.score = true;
  late.settings.turnLimit = 0;
  teamUp(late, [0, 1]);
  [later.at(3, 3), later.at(16, 3), later.at(26, 16)].forEach((t, i) => city(late, i, t));
  // (Four points a tech: the loner six ahead of each of them.)
  const known = Object.keys(TECHS).filter((t) => t !== 'future_tech');
  late.players[2].techs = known.slice(0, 10);
  late.players[0].techs = known.slice(0, 4);
  late.players[1].techs = known.slice(0, 4);
  const [s0, s1, s2] = late.players.slice(0, 3).map((p) => score(late, p));
  ok(s2 > s0 && s2 > s1 && s0 + s1 > s2, `the loner beats each of them, not both together (${s0}, ${s1}, ${s2})`);
  checkVictory(late);
  ok([0, 1].includes(late.over?.winner ?? -1), `the team wins on score (${JSON.stringify(late.over)})`);
});

test('team research: each of them chooses their own (Civ V’s): a teammate’s choice changes nobody else’s', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  [at(3, 3), at(14, 3), at(22, 15)].forEach((t, i) => city(game, i, t));
  const [a, b] = game.players;
  for (const p of game.players) p.techs.push('agriculture');
  a.bot = b.bot = false;
  ok(apply(game, 0, { t: 'research', tech: 'pottery' }).ok, 'one chooses');
  eq(b.researching, null, 'the other’s isn’t chosen for them');
  ok(apply(game, 1, { t: 'research', tech: 'mining' }).ok, 'the other chooses another');
  eq(a.researching, 'pottery', 'the first one’s stands');
  eq(b.researching, 'mining', 'and the second one’s');
  ok(apply(game, 0, { t: 'research', tech: 'writing' }).ok, 'a far tech');
  ok(a.researching === 'pottery' && a.techQueue.includes('writing'), 'its way there, queued');
  ok(b.researching === 'mining' && !b.techQueue.length, 'for them alone');
  b.bot = true;
  ok(apply(game, 1, { t: 'research', tech: 'animal_husbandry' }).ok && a.researching === 'pottery', 'a bot teammate chooses its own too');
  ok(apply(game, 2, { t: 'research', tech: 'mining' }).ok && game.players[2].researching === 'mining', 'a civ alone as ever');
});

test('team research: on different techs, a team researches both at once; on the same one, both put into it', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  [at(3, 3), at(14, 3), at(22, 15)].forEach((t, i) => city(game, i, t));
  const [a, b] = game.players;
  // (Eurekas aside: they'd be science too.)
  for (const p of game.players) (p.techs.push('agriculture'), (p.eurekas = Object.keys(EUREKAS)));
  a.bot = b.bot = false;
  const science = (i: number) => game.cities.filter((c) => c.owner === i).reduce((n, c) => n + cityYields(game, c).science, 0);
  ok(science(0) > 0 && science(1) > 0, 'both make science');
  apply(game, 0, { t: 'research', tech: 'pottery' });
  apply(game, 1, { t: 'research', tech: 'mining' });
  endTurn(game);
  eq(a.research.pottery, science(0), 'the one’s science into theirs');
  eq(a.research.mining, science(1), 'the other’s into theirs');
  eq(JSON.stringify(b.research), JSON.stringify(a.research), 'the progress the team’s: the same for both');
  ok(a.researching === 'pottery' && b.researching === 'mining', 'each still on their own');
  // The other joins in: both into one.
  apply(game, 1, { t: 'research', tech: 'pottery' });
  const before = a.research.pottery;
  endTurn(game);
  eq(a.research.pottery, before + science(0) + science(1), `a turn's science from both (${science(0)} + ${science(1)})`);
  eq(a.research.mining, science(1), 'what went into the other is kept');
});

test('team research: a turn with nothing chosen, each one’s science waits for their own choice (as a civ alone’s does)', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  [at(3, 3), at(14, 3), at(22, 15)].forEach((t, i) => city(game, i, t));
  const [a, b] = game.players;
  for (const p of game.players) (p.techs.push('agriculture'), (p.eurekas = Object.keys(EUREKAS)));
  a.bot = b.bot = false;
  const science = (i: number) => game.cities.filter((c) => c.owner === i).reduce((n, c) => n + cityYields(game, c).science, 0);
  endTurn(game);
  ok(a.researching === null && b.researching === null, 'nothing chosen');
  ok(apply(game, 1, { t: 'research', tech: 'pottery' }).ok, 'then one chooses');
  eq(a.research.pottery, science(1), 'what they made meanwhile goes into it, the team’s');
  eq(a.spareScience, science(0), 'the other’s waits for their own choice');
  ok(apply(game, 0, { t: 'research', tech: 'mining' }).ok, 'which they make');
  eq(b.research.mining, science(0), 'and theirs goes into it');
});

test('teams: a bot on a team with a person sells no peace for the team (its people make it)', () => {
  const { game } = dealers(['egypt', 'babylon', 'china']);
  teamUp(game, [0, 1]);
  game.players[1].bot = true;
  ok(apply(game, 0, { t: 'war', target: 2 }).ok, 'the person takes the team to war');
  ok(game.players[1].diplomacy.war[2], 'the bot with them');
  game.players[2].gold = 5000;
  const answer = evaluate(game, game.players[1], { from: 2, to: 1, items: [{ kind: 'peace' }, { kind: 'gold', from: 2, amount: 5000 }] });
  ok(!answer.accept, `peace and a fortune offered to the bot, declined (${answer.why})`);
});

test('team research: what each puts in is pooled; finished between them, it’s learned by all and the rest goes on', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  [at(3, 3), at(14, 3), at(22, 15)].forEach((t, i) => city(game, i, t));
  const [a, b] = game.players;
  // (Eurekas aside: Writing's, for having met each other, would be science too.)
  for (const p of game.players) (p.techs.push('agriculture'), (p.eurekas = Object.keys(EUREKAS)));
  a.bot = b.bot = false;
  apply(game, 0, { t: 'research', tech: 'pottery' });
  apply(game, 1, { t: 'research', tech: 'pottery' });
  const cost = techCost(game, a, 'pottery');
  a.research.pottery = Math.ceil(cost * 0.3);
  b.research.pottery = Math.ceil(cost * 0.3);
  shareResearch(game);
  eq(a.research.pottery, b.research.pottery, 'the same for both');
  eq(a.research.pottery, Math.ceil(cost * 0.3) * 2, 'what each put in, together');
  // Each with their own next.
  a.techQueue = ['writing'];
  b.techQueue = ['mining'];
  a.research.pottery += Math.ceil(cost * 0.3);
  b.research.pottery += Math.ceil(cost * 0.3);
  shareResearch(game);
  ok(a.techs.includes('pottery') && b.techs.includes('pottery'), 'learned by both');
  ok(a.researching === 'writing' && b.researching === 'mining', 'each on to their own next');
  eq((a.research.writing ?? 0) + (a.research.mining ?? 0), Math.ceil(cost * 0.3) * 4 - cost, 'what was over goes on, shared between them');
  eq(JSON.stringify(b.research), JSON.stringify(a.research), 'the same for both');
  // One finishing theirs: the other's goes on as it was.
  const mining = a.research.mining ?? 0;
  a.research.writing = techCost(game, a, 'writing');
  shareResearch(game);
  ok(b.techs.includes('writing'), 'writing learned by both');
  eq(b.researching, 'mining', 'the other still on theirs');
  eq(b.research.mining, mining, 'with what was in it');
});

test('team research: a tech learned by one, any way, is learned by all; a team’s techs cost more', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  [at(3, 3), at(14, 3), at(22, 15), at(5, 12)].forEach((t, i) => city(game, i === 3 ? 0 : i, t));
  const alone = techCost(game, game.players[0], 'writing');
  teamUp(game, [0, 1]);
  const [a, b] = game.players;
  const together = techCost(game, a, 'writing');
  ok(together > alone * 1.5, `half again for the second civ, and their cities all count (${alone} alone, ${together} together)`);
  eq(techCost(game, b, 'writing'), together, 'the same for both');
  eq(techCost(game, game.players[2], 'writing') <= alone, true, 'a civ alone pays what it did');
  learn(game, b, 'mining');
  ok(apply(game, 0, { t: 'skip', unit: unit(game, 'warrior', 0, at(4, 4)).id }).ok, 'an order');
  ok(a.techs.includes('mining'), 'the tech a teammate learned is theirs too');
});

// -------------------------------------------------------------------------------------------------
// The replay

/** The events of a kind in a replay. */
const eventsOf = (game: Game, kind: ReplayEvent[1]) => (game.replay?.events ?? []).filter((e) => e[1] === kind);

test('the replay records the game as it goes: borders, cities founded, taken and lost, wars, peace, wonders, eras, the fallen, the end', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  game.settings.victories.domination = true;
  const thebes = city(game, 0, at(4, 4));
  const babylon = city(game, 1, at(20, 12));
  const berlin = city(game, 2, at(20, 3));
  const memphis = city(game, 0, at(10, 14));
  endTurn(game);
  const first = game.turn - 1;
  const found = eventsOf(game, 'found');
  eq(found.length, 4, 'four cities founded');
  ok(found.some((e) => e[2] === thebes.id && e[0] === first && e[3] === 0 && e[4] === thebes.tile && e[5] === 'Thebes' && e[6] === 1), 'Thebes, a capital, this turn');
  ok(found.some((e) => e[2] === memphis.id && e[6] === 0), 'Memphis, not a capital');
  const owners = (turn: number) => replayAt(game.replay!, game.tiles.length, turn).owners;
  ok(game.tiles.every((tile, t) => owners(Infinity)[t] === tile.owner), 'every tile’s owner as it is');
  ok(owners(first - 1).every((o) => o === -1), 'nobody’s, before');
  // A war, a wonder, a new era.
  war(game, 0, 1);
  game.wonders.pyramids = 0;
  thebes.buildings.push('pyramids');
  techsTo(game, 0, 3);
  endTurn(game);
  const second = game.turn - 1;
  ok(eventsOf(game, 'war').some((e) => e[0] === second && e[2] === 0 && e[3] === 1), 'Egypt and Babylon at war');
  ok(eventsOf(game, 'wonder').some((e) => e[0] === second && e[2] === 'pyramids' && e[3] === 0 && e[4] === thebes.id), 'the Pyramids, in Thebes');
  ok(eventsOf(game, 'era').some((e) => e[0] === second && e[2] === 0 && e[3] === 1), 'Egypt in the Classical Era');
  eq(eventsOf(game, 'found').length, 4, 'nothing founded twice');
  // A city lost (its land nobody's again), peace.
  game.cities = game.cities.filter((c) => c !== memphis);
  for (const tile of game.tiles) if (tile.city === memphis.id) (tile.owner = -1), delete tile.city;
  endWar(game, game.players[0], game.players[1]);
  endTurn(game);
  const third = game.turn - 1;
  ok(eventsOf(game, 'lost').some((e) => e[0] === third && e[2] === memphis.id && e[3] === 0), 'Memphis lost');
  ok(eventsOf(game, 'peace').some((e) => e[0] === third && e[2] === 0 && e[3] === 1), 'peace');
  ok(game.tiles.every((tile, t) => owners(Infinity)[t] === tile.owner), 'its land nobody’s again');
  ok(owners(second)[memphis.tile] === 0, 'Egypt’s, the turn before');
  // Babylon's last city taken mid-turn: Babylon falls; Germany's too; Egypt holds every capital and wins.
  war(game, 0, 1);
  war(game, 0, 2);
  cityHooks.captured(game, berlin, 0);
  ok(eventsOf(game, 'taken').length === 0, 'nothing recorded mid-turn while the game goes on');
  cityHooks.captured(game, babylon, 0);
  ok(!!game.over, 'over');
  const last = game.turn;
  ok(eventsOf(game, 'taken').some((e) => e[0] === last && e[2] === babylon.id && e[3] === 0 && e[4] === 1), 'Babylon taken, this turn');
  ok(eventsOf(game, 'out').some((e) => e[0] === last && e[2] === 1), 'Babylon fallen');
  ok(eventsOf(game, 'won').some((e) => e[0] === last && e[2] === 0 && e[3] === 'domination'), 'Egypt wins');
  eq(replayEnd(game.replay!), last, 'the replay ends with the game');
  ok([...replayAt(game.replay!, game.tiles.length, Infinity).cities.values()].every((c) => c.owner === 0), 'every city Egypt’s at the end');
});

test('the replay after a load carries on where it was (nothing twice); a turn costs three characters and three a tile gained', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  city(game, 0, at(4, 4));
  city(game, 1, at(20, 12));
  endTurn(game);
  const loaded = JSON.parse(JSON.stringify(game)) as Game;
  const events = loaded.replay!.events.length;
  endTurn(loaded);
  endTurn(loaded);
  eq(loaded.replay!.events.length, events, 'no events again after the load');
  const size = JSON.stringify(loaded.replay).length;
  const before = loaded.tiles.map((tile) => tile.owner);
  endTurn(loaded);
  const moved = loaded.tiles.filter((tile, t) => tile.owner !== before[t]).length;
  eq(JSON.stringify(loaded.replay).length - size, 3 + 3 * moved, `a turn's record: three characters, and three for each of the ${moved} tiles that changed hands`);
});

test('saved games are each person’s, by account: listed in any room, carried on anywhere, never replaced by a new game; room saves moved over', () => {
  // A store as `game.store` is: every room's keys together.
  const data = new Map<string, unknown>();
  let reads = 0;
  const store = {
    get: <T,>(k: string) => ((k.startsWith('save:') || k.startsWith('game:')) && reads++, structuredClone(data.get(k)) as T | undefined),
    set: (k: string, v: unknown) => void data.set(k, structuredClone(v)),
    delete: (k: string) => void data.delete(k),
    keys: (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
  const seat = (key: string, name: string, civ: string | null, bot = false) => ({ key, name, civ, bot });
  const ann = 'acct:ann';
  const at = (iso: string) => new Date(iso);
  // Kept by room, as before: Ann and Bob's game in the public room (with autosaves), one in room k3x9f2, one won, and an old note.
  data.set('save:public', { game: { turn: 79, over: null }, seats: [seat(ann, 'Ann', 'korea'), seat('acct:bob', 'Bob', 'arabia'), seat('bot:1', 'Bot', 'china', true)] });
  data.set('autosave:public:78', { game: { turn: 78 }, seats: [] });
  data.set('save:k3x9f2', { game: { turn: 30, over: null }, seats: [seat(ann, 'Ann', 'greece')] });
  data.set('save:won', { game: { turn: 300, over: { winner: 0 } }, seats: [seat(ann, 'Ann', 'rome')] });
  data.set('savenote:k3x9f2', { turn: 30, seats: [] });
  moveRoomSaves(store, at('2026-10-21T00:00:00Z'));
  ok(!store.keys('save:').length && !store.keys('savenote:').length && !data.has('autosave:public:78'), 'the room keys gone');
  ok(data.has('game:room-public') && data.has('game:room-k3x9f2') && !data.has('game:room-won'), 'each unfinished game kept under an id of its own (a won one not)');
  eq(JSON.stringify(autosaveTurns(store, 'room-public')), '[78]', 'its autosaves with it');
  moveRoomSaves(store);
  ok(data.has('game:room-public'), 'moved once: nothing left to move');
  // Ann's lobby, in any room: both her games, the latest played first, not Bob's alone.
  saveGame(store, 'room-k3x9f2', 'k3x9f2', { game: { turn: 31 }, seats: [seat(ann, 'Ann', 'greece')] }, at('2026-10-21T00:10:00Z'));
  saveGame(store, 'solo-bob', 'zz', { game: { turn: 5 }, seats: [seat('acct:bob', 'Bob', 'inca')] }, at('2026-10-21T00:20:00Z'));
  reads = 0;
  const now = at('2026-10-21T00:30:00Z');
  eq(JSON.stringify(savedGames(store, ann, now)), JSON.stringify([
    { id: 'room-k3x9f2', turn: 31, civ: 'greece', with: [], at: '2026-10-21T00:10:00.000Z', live: false, backups: [], playing: [] },
    { id: 'room-public', turn: 79, civ: 'korea', with: ['Bob'], at: '2026-10-21T00:00:00.000Z', live: false, backups: [78], playing: [] },
  ]), 'Ann’s two games, wherever they were played, latest first');
  eq(reads, 0, 'listing them reads no save, only notes');
  eq(savedGames(store, 'acct:bob', now).length, 2, 'Bob sees theirs too (the one with Ann, and his own)');
  ok(inGame(store, 'room-public', ann) && !inGame(store, 'solo-bob', ann), 'only someone with a seat can carry one on or throw it away');
  // A game being played right now in another room can't be carried on in a second one.
  saveGame(store, 'solo-bob', 'zz', { game: { turn: 6 }, seats: [seat('acct:bob', 'Bob', 'inca')] }, at('2026-10-21T00:29:30Z'));
  ok(playedElsewhere(store, 'solo-bob', 'public', now) && !playedElsewhere(store, 'solo-bob', 'zz', now), 'under way in room zz: not to be opened elsewhere');
  ok(savedGames(store, 'acct:bob', now).find((g) => g.id === 'solo-bob')?.live === true, 'listed as being played now (to join)');
  ok(!playedElsewhere(store, 'solo-bob', 'public', at('2026-10-21T00:40:00Z')), 'some minutes quiet: free to carry on anywhere');
  saveGame(store, 'solo-bob', 'zz', { game: { turn: 6 }, seats: [seat('acct:bob', 'Bob', 'inca')] }, at('2026-10-21T00:29:30Z'), false);
  ok(!playedElsewhere(store, 'solo-bob', 'public', now), 'saved as its last person left: free at once');
  // A new game (its own id) leaves every saved game alone; a won game goes, with its autosaves.
  const id = gameId(() => 0.5);
  ok(/^[a-z0-9]{10}$/.test(id) && id !== gameId(), `a new game's id (${id})`);
  saveGame(store, id, 'public', { game: { turn: 1 }, seats: [seat('name:Player', 'Player', 'egypt')] });
  ok(data.has('game:room-public') && data.has('game:room-k3x9f2'), 'a new game in the public room replaces nothing');
  store.set(autoKey(id, 1), { game: { turn: 1 }, seats: [] });
  saveGame(store, id, 'public', { game: { turn: 9, over: { winner: 0 } }, seats: [] });
  ok(!data.has(`game:${id}`) && !data.has(`gamenote:${id}`) && !autosaveTurns(store, id).length, 'won: its save, note and autosaves gone');
  // Each game is played at an address of its own: a new one's id is a room's code; one from before
  // (an id with a dash) is moved to a new id, its save, note and autosaves with it.
  ok(roomCode(id) && roomCode('korea79') && !roomCode('room-public') && !roomCode('ab'), 'a new game’s id is a room’s code; one from before isn’t');
  store.set(autoKey('room-public', 78), { game: { turn: 78 }, seats: [] });
  renameGame(store, 'room-public', 'abcdefghij');
  ok(!data.has('game:room-public') && !data.has('gamenote:room-public') && !autosaveTurns(store, 'room-public').length, 'the old keys gone');
  ok((store.get<{ game: { turn: number } }>(gameKey('abcdefghij'))?.game.turn ?? 0) === 79 && JSON.stringify(autosaveTurns(store, 'abcdefghij')) === '[78]', 'its save and autosaves under the new id');
  eq(JSON.stringify(savedGames(store, ann, now).map((g) => [g.id, g.with])), JSON.stringify([['room-k3x9f2', []], ['abcdefghij', ['Bob']]]), 'listed under its new id, for both of them');
  forgetGame(store, 'abcdefghij');
  eq(savedGames(store, ann, now).length, 1, 'gone: no longer listed');
});

test('no game is lost: backups of its last turns to take it back to, and discarding only takes it off one person’s list, for a week', () => {
  const data = new Map<string, unknown>();
  const store = {
    get: <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
    set: (k: string, v: unknown) => void data.set(k, structuredClone(v)),
    delete: (k: string) => void data.delete(k),
    keys: (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
  const ann = 'acct:ann';
  const bob = 'acct:bob';
  const seats = [
    { key: ann, name: 'Ann', civ: 'korea', bot: false },
    { key: bob, name: 'Bob', civ: 'arabia', bot: false },
  ];
  const at = (iso: string) => new Date(iso);
  const day = 86400e3;
  // Which backups are kept: the latest two, and one from before them (the latest tenth, else the earliest).
  const kept = (turns: number[]) => JSON.stringify([...backupsKept(turns)].sort((a, b) => b - a));
  eq(kept([45, 44, 43, 42, 41, 40, 39]), '[45,44,40]', 'the latest two, and the tenth turn before them');
  eq(kept([52, 51, 50, 40]), '[52,51,50]', 'a later tenth in its place');
  eq(kept([46, 45, 44, 43]), '[46,45,43]', 'no tenth: the earliest');
  eq(kept([3, 2]), '[3,2]', 'two: both');
  eq(kept([]), '[]', 'none: none');
  // Ann and Bob's game, saved at turn 41 with its backups.
  const save = (turn: number) => ({ game: { turn, over: null, players: [{ bot: false, notes: [] as { text: string }[] }] }, seats });
  saveGame(store, 'k3x9f2', 'k3x9f2', save(41), at('2026-10-21T00:00:00Z'), false);
  for (const t of [41, 40, 37]) store.set(autoKey('k3x9f2', t), save(t));
  eq(JSON.stringify(savedGames(store, ann, at('2026-10-21T00:01:00Z'))[0].backups), '[41,40,37]', 'listed with its backups, the latest first');
  // Played quietly (no order for minutes), its room says so every half a minute: not to be taken back meanwhile.
  saveGame(store, 'k3x9f2', 'k3x9f2', save(41), at('2026-10-21T00:00:00Z'), true, [ann]);
  ok(!playedNow(store, 'k3x9f2', at('2026-10-21T00:03:00Z')), 'three minutes without a save or a word: taken as not played');
  stillPlayed(store, 'k3x9f2', at('2026-10-21T00:02:40Z'), [ann, bob]);
  ok(playedNow(store, 'k3x9f2', at('2026-10-21T00:03:00Z')), 'its room’s word a moment ago: being played');
  // Who's playing it now, on each one's list: the others in it who are in its room.
  eq(JSON.stringify(savedGames(store, ann, at('2026-10-21T00:03:00Z'))[0].playing), '["Bob"]', 'Ann’s list: Bob is playing it now');
  eq(JSON.stringify(savedGames(store, ann, at('2026-10-21T00:09:00Z'))[0].playing), '[]', 'some minutes on, no word: nobody');
  saveGame(store, 'k3x9f2', 'k3x9f2', save(41), at('2026-10-21T00:00:00Z'), false, [ann]);
  ok(!store.get<{ here?: string[] }>('gamenote:k3x9f2')?.here, 'saved as its last person left: nobody in it');
  // Its map and speed, to tell it from one's other games.
  saveGame(store, 'maps', 'maps', { game: { turn: 3, settings: { size: 'small', type: 'pangaea', speed: 'quick' } }, seats }, at('2026-10-21T00:00:00Z'), false);
  eq(JSON.stringify(savedGames(store, ann, at('2026-10-21T00:01:00Z')).find((g) => g.id === 'maps')?.map), '{"size":"small","type":"pangaea","speed":"quick"}', 'listed with its map');
  forgetGame(store, 'maps');
  // Taken back to the start of turn 37: the later backups go, and what it's given (a word to its people) is saved with it.
  ok(!playedNow(store, 'k3x9f2', at('2026-10-21T00:01:00Z')), 'nobody playing it: free to take back');
  ok(restoreTurn(store, 'k3x9f2', 37, at('2026-10-21T00:02:00Z'), (s) => (s.game as ReturnType<typeof save>['game']).players[0].notes.push({ text: 'Ann took it back' })), 'taken back');
  const now = store.get<ReturnType<typeof save>>(gameKey('k3x9f2'))!;
  ok(now.game.turn === 37 && now.game.players[0].notes[0]?.text === 'Ann took it back', 'saved as turn 37 began, with the word');
  eq(JSON.stringify(autosaveTurns(store, 'k3x9f2')), '[37]', 'the backups after it gone');
  ok(!(store.get<ReturnType<typeof save>>(autoKey('k3x9f2', 37))!.game.players[0].notes.length), 'the backup itself as it was');
  ok(!restoreTurn(store, 'k3x9f2', 40), 'a turn with no backup: not taken back to');
  // Bob discards it: off his list (listed a week as discarded, to bring back), still on Ann's.
  discardGame(store, 'k3x9f2', bob, at('2026-10-21T01:00:00Z'));
  ok(savedGames(store, bob, at('2026-10-22T00:00:00Z'))[0]?.discarded === '2026-10-21T01:00:00.000Z', 'Bob’s list: discarded');
  ok(!savedGames(store, ann, at('2026-10-22T00:00:00Z'))[0]?.discarded, 'Ann’s: as it was');
  keepGame(store, 'k3x9f2', bob);
  ok(!savedGames(store, bob, at('2026-10-22T00:00:00Z'))[0]?.discarded, 'brought back');
  discardGame(store, 'k3x9f2', bob, at('2026-10-21T01:00:00Z'));
  eq(savedGames(store, bob, at('2026-10-29T00:00:00Z')).length, 0, 'a week on: off his list');
  // Saved by someone playing it (Ann), Bob's discard stands; Bob back in it to play, it's his again.
  saveGame(store, 'k3x9f2', 'k3x9f2', save(38), at('2026-10-21T02:00:00Z'), true, [ann]);
  ok(!!savedGames(store, bob, at('2026-10-21T03:00:00Z'))[0]?.discarded, 'Ann playing it: still off Bob’s list');
  saveGame(store, 'k3x9f2', 'k3x9f2', save(38), at('2026-10-21T02:00:00Z'), true, [ann, bob]);
  ok(!savedGames(store, bob, at('2026-10-21T03:00:00Z'))[0]?.discarded, 'Bob back in it: on his list again');
  // Kept until everyone in it has discarded it, and a week has gone by since the last of them did.
  discardGame(store, 'k3x9f2', bob, at('2026-10-21T01:00:00Z'));
  tidyGames(store, at('2026-11-01T00:00:00Z'));
  ok(data.has(gameKey('k3x9f2')), 'Ann hasn’t discarded it: kept');
  discardGame(store, 'k3x9f2', ann, at('2026-10-30T00:00:00Z'));
  tidyGames(store, new Date(Date.parse('2026-10-30T00:00:00Z') + 6 * day));
  ok(data.has(gameKey('k3x9f2')), 'the last of them six days ago: kept');
  tidyGames(store, new Date(Date.parse('2026-10-30T00:00:00Z') + 7 * day));
  ok(!store.keys().some((k) => k.includes('k3x9f2')), 'a week: gone, its note and backups with it');
});

test('the game’s save is throttled: an order’s at once, the rest at most every few seconds, none left waiting', () => {
  const t = new SaveThrottle(5);
  // Orders every half second for a minute: saved at the first, then whenever five seconds have passed with one waiting.
  let saves = 0;
  let lastAt = -Infinity;
  for (let now = 0; now < 60; now += 0.5) {
    if (t.changed(now)) {
      t.saved(now);
      saves++;
      ok(now - lastAt >= 5, `never sooner than five seconds (${now})`);
      lastAt = now;
    }
    if (t.tick(now)) {
      t.saved(now);
      saves++;
      ok(now - lastAt >= 5, `never sooner than five seconds (${now})`);
      lastAt = now;
    }
  }
  ok(saves >= 11 && saves <= 13, `about one save in five seconds over a minute of orders (${saves}), not 120`);
  // The orders stop: what waited is saved once its five seconds are up, then nothing more.
  t.changed(60);
  ok(t.pending, 'an order waits');
  ok(!t.tick(lastAt + 4.9), 'not yet');
  ok(t.tick(lastAt + 5), 'due');
  t.saved(lastAt + 5);
  ok(!t.pending && !t.tick(lastAt + 30), 'nothing left waiting');
  // A save for what matters (a turn's end) counts as the latest; a new world starts afresh.
  t.saved(100);
  ok(!t.changed(102), 'an order just after a turn’s end waits');
  t.reset();
  ok(t.changed(0), 'after a new world, the first order is saved at once (its clock starts again)');
});

test('a city-state asks only for a resource every civ it asks can see (no Uranium before Atomic Theory)', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const [egypt] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  city(game, cs.index, at(14, 9));
  city(game, 0, at(4, 4));
  egypt.met = [cs.index];
  game.tiles[at(20, 4)].resource = 'uranium';
  const asked = () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      questsOf(cs).length = 0;
      questsTurn(game);
      for (const q of questsOf(cs)) if (q.kind === 'resource') seen.add(q.target as string);
    }
    return seen;
  };
  ok(!asked().has('uranium'), 'not asked before Atomic Theory');
  egypt.techs.push('atomic_theory');
  ok(asked().has('uranium'), 'asked once it can be found');
});

test('Oil at sea takes an Offshore Platform, a work boat’s with Refrigeration; it brings the Oil in', () => {
  const { game, at } = blank();
  for (let col = 0; col < 26; col++) game.tiles[at(col, 8)].terrain = 'coast';
  const c = city(game, 0, at(6, 7));
  const p = game.players[0];
  const sea = at(7, 8);
  Object.assign(game.tiles[sea], { resource: 'oil', amount: 4, owner: 0, city: c.id });
  p.techs.push('sailing', 'biology');
  const boat = unit(game, 'work_boat', 0, sea);
  ok(!canBuild(game, boat, 'offshore_platform'), 'not before Refrigeration');
  ok(!canBuild(game, boat, 'oil_well'), 'never an oil well out at sea');
  p.techs.push('refrigeration');
  ok(canBuild(game, boat, 'offshore_platform'), 'with Refrigeration');
  ok(apply(game, 0, { t: 'build', unit: boat.id, what: 'offshore_platform' }).ok, 'built');
  eq(game.tiles[sea].improvement, 'offshore_platform', 'on the tile at once');
  ok(!game.units.includes(boat), 'the work boat is spent');
  eq(strategic(game, p).oil?.have, 4, 'the Oil is in');
  // On land, Oil still takes an oil well, a worker's.
  const land = at(5, 6);
  Object.assign(game.tiles[land], { resource: 'oil', amount: 2, owner: 0, city: c.id });
  const w = unit(game, 'worker', 0, land);
  ok(canBuild(game, w, 'oil_well') && !canBuild(game, w, 'offshore_platform'), 'an oil well on land');
});

test('a citadel takes the tiles round it, another civ’s too (not a city’s), and they remember it', () => {
  const { game, at } = blank();
  const mine = city(game, 0, at(6, 6));
  const theirs = city(game, 1, at(10, 6));
  const site = at(8, 6);
  game.tiles[site].owner = 0;
  game.tiles[site].city = mine.id;
  const around = neighbours(game.grid, site);
  const foreign = around.filter((t) => game.tiles[t].owner === 1);
  ok(foreign.length > 0, 'Babylon’s land beside it');
  const general = unit(game, 'great_general', 0, site);
  ok(apply(game, 0, { t: 'greatPerson', unit: general.id, action: 'improvement' }).ok, 'the citadel is built');
  ok(around.every((t) => game.tiles[t].owner === 0 || t === theirs.tile), 'every tile round it is Egypt’s');
  ok(foreign.every((t) => game.tiles[t].city === mine.id), 'its nearest city’s');
  ok(relationsOf(game).events.some((e) => e.kind === 'land' && e.by === 0 && e.to === 1), 'Babylon remembers');
});

test('trade routes need a way: a cargo ship only between cities on the same water, a caravan only over land', () => {
  const { game, at } = blank();
  for (let col = 0; col < game.grid.width; col++) game.tiles[at(col, 8)].terrain = 'coast';
  const p = game.players[0];
  p.techs.push('sailing', 'animal_husbandry');
  const port = city(game, 0, at(4, 7));
  const inland = city(game, 0, at(10, 4));
  const otherPort = city(game, 0, at(14, 7));
  const across = city(game, 0, at(9, 10));
  ok(startRoute(game, p, unit(game, 'cargo_ship', 0, port.tile), inland.id) !== null, 'no ship to a city inland');
  ok(startRoute(game, p, unit(game, 'caravan', 0, port.tile), across.id) !== null, 'no caravan across the water');
  eq(startRoute(game, p, unit(game, 'cargo_ship', 0, port.tile), otherPort.id), null, 'a ship from port to port');
  eq(startRoute(game, p, unit(game, 'caravan', 0, port.tile), inland.id), null, 'a caravan over land');
});

test('an annexed city shows as occupied until a Courthouse calms it', () => {
  const { game, at } = blank();
  city(game, 0, at(4, 4));
  const taken = city(game, 0, at(10, 6), { pop: 6 });
  taken.founder = 1;
  taken.occupied = true;
  const occupied = () => !!viewFor(game, game.players[0], null).cities.find((c) => c.id === taken.id)!.occupied;
  ok(occupied(), 'annexed: occupied');
  taken.buildings.push('courthouse');
  ok(!occupied(), 'with a Courthouse: calmed');
  taken.buildings.pop();
  taken.puppet = true;
  ok(!occupied(), 'a puppet doesn’t mind');
});

// -------------------------------------------------------------------------------------------------
// The world in blocks

test('each tile’s improvement, road and ruins stay on its own columns (a mine’s mound isn’t in the farm next door), and set no spot twice', () => {
  const kinds = Object.keys(IMPROVEMENTS) as ImprovementId[];
  const ores = ['gems', 'gold_ore', 'iron', 'silver', 'salt', ''];
  /** A tile's own small random number, to vary the land, its roads and its ores. */
  const roll = (t: number, k: number) => {
    const h = Math.imul(Math.imul(t + 7919, 73856093) ^ Math.imul(k + 13, 19349663), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  // Flat land, hills, and a mix of them with coast, rivers, marshes and woods (on a world that wraps
  // too): every tile's shape of hex, with and without a road through it.
  for (const land of ['flat', 'hills', 'mixed', 'wrapped'] as const) {
    const { game } = blank(undefined, { wrap: land === 'wrapped' });
    const mixed = land === 'mixed' || land === 'wrapped';
    game.tiles.forEach((tile, t) => {
      if (land === 'hills' || (mixed && roll(t, 1) < 0.3)) tile.elevation = 'hills';
      if (!mixed) return;
      if (roll(t, 2) < 0.12) tile.terrain = 'coast';
      else if (roll(t, 3) < 0.1 && tile.elevation === 'flat') tile.feature = 'marsh';
      else if (roll(t, 4) < 0.1) tile.feature = 'forest';
      if (roll(t, 5) < 0.15) tile.river = true;
    });
    const size = extent(game.grid);
    const ground = new Ground(Math.ceil(size.w), Math.ceil(size.d), terrainEdits(game.grid, game.tiles), period(game.grid));
    // A city lost on each tile: its ruins show where there's no improvement.
    game.replay = { borders: [], events: game.tiles.flatMap((_, t) => [[0, 'found', t, 0, t, 'Thebes', 0], [1, 'lost', t, 0]] as ReplayEvent[]) };
    for (let turn = 0; turn <= kinds.length; turn++)
      for (const pillaged of [false, true]) {
        game.tiles.forEach((tile, t) => {
          const water = TERRAINS[tile.terrain].water;
          const kind = kinds[(t + turn) % (kinds.length + 1)];
          if (kind && water === (kind === 'offshore_platform' || kind === 'fishing_boats')) tile.improvement = kind;
          else delete tile.improvement;
          tile.pillaged = pillaged;
          tile.resource = ores[(t + turn) % ores.length];
          const r = roll(t * 31 + turn, 6);
          if (!water && r < 0.5) tile.road = r < 0.3 ? 'road' : 'rail';
          else delete tile.road;
        });
        for (let t = 0; t < game.tiles.length; t++) {
          const at = new Set<string>();
          for (const [x, y, z, block] of decorOf(game, ground, t)) {
            const what = `${game.tiles[t].improvement ?? 'ruins'}${pillaged ? ' (pillaged)' : ''} on ${land} tile ${t}`;
            ok(tileUnder(game.grid, x + 0.5, z + 0.5) === t, `${what}: ${block} at ${x},${y},${z} is on tile ${tileUnder(game.grid, x + 0.5, z + 0.5)}`);
            ok(!at.has(`${x},${y},${z}`), `${what}: two blocks at ${x},${y},${z}`);
            at.add(`${x},${y},${z}`);
          }
        }
      }
  }
});

test('nothing of an improvement, nor any of a land resource’s models, stands in a river (its channels cut through its tiles) or a marsh’s pools', () => {
  const kinds = (Object.keys(IMPROVEMENTS) as ImprovementId[]).filter((i) => i !== 'fishing_boats' && i !== 'offshore_platform');
  const resources = Object.keys(KINDS).filter((r) => !KINDS[r]!.sea);
  for (const wrap of [false, true])
    for (let turn = 0; turn < 6; turn++) {
      // Rivers on three tiles in four (each channel runs from a tile's middle to the next river tile's), hills, woods, marshes.
      const { game } = blank(undefined, { wrap });
      const g = game.grid;
      game.tiles.forEach((tile, t) => {
        tile.river = (t * 7 + turn) % 4 !== 0;
        if (t % 5 === 0) tile.elevation = 'hills';
        else if (t % 11 === 4) tile.feature = 'marsh';
        if (t % 7 === 3) tile.feature = 'forest';
        tile.improvement = kinds[(t * 3 + turn) % kinds.length];
        if (tile.improvement === 'lumber_mill') tile.feature = 'forest';
        tile.resource = resources[(t + turn * 5) % resources.length];
        tile.pillaged = turn % 3 === 2;
      });
      const size = extent(g);
      const edits = terrainEdits(g, game.tiles);
      const ground = new Ground(Math.ceil(size.w), Math.ceil(size.d), edits, period(g));
      const wet = (x: number, z: number) => ['water', 'ice'].includes(ground.at(Math.floor(x), Math.floor(z))?.block ?? '');
      // The world as a screen has it: the land's blocks, then each tile's improvement's set over them (each only where what it covers is there).
      const world = new Map<string, string>();
      for (const [x, y, z, b] of edits) world.set(`${x},${y},${z}`, b);
      for (let t = 0; t < game.tiles.length; t++)
        for (const [x, y, z, block, under] of decorOf(game, ground, t)) {
          if (block !== 'air' && !game.tiles[t].road) ok(!wet(x, z), `${game.tiles[t].improvement} on tile ${t} (${wrap ? 'wrapped' : 'flat'}): ${block} at ${x},${y},${z} is in the water`);
          if ((world.get(`${x},${y},${z}`) ?? 'air') === under) world.set(`${x},${y},${z}`, block);
        }
      const blocks = { blockAt: (x: number, y: number, z: number) => world.get(`${baseX(g, x)},${y},${z}`) ?? (y === SEA_Y ? 'water' : y < SEA_Y ? 'civ_dirt' : 'air') };
      for (let t = 0; t < game.tiles.length; t++) {
        const tile = game.tiles[t];
        const kind = KINDS[tile.resource!]!;
        const spots = spotsFor(blocks, g, t, kind, { resource: tile.resource, improvement: tile.improvement, pillaged: tile.pillaged, feature: tile.feature } as KnownTile);
        ok(!!spots, `tile ${t}'s ground is all here`);
        const penned = tile.improvement === 'pasture' && kind.life === 'graze';
        spots!.forEach((spot, i) => {
          const what = `${tile.resource} (${tile.improvement}${tile.pillaged ? ', pillaged' : ''}) on tile ${t} (${wrap ? 'wrapped' : 'flat'})`;
          ok(!wet(spot.x, spot.z), `${what}: a model stands in the water at ${spot.x},${spot.z}`);
          // A still one's footprint, as it's turned and as big as it may be drawn, none of it over water
          // either (its corners a hair in: one may touch a column's edge).
          if (kind.life !== 'still') return;
          const foot = corners(kind.models[i % kind.models.length], kind.scale * (penned ? PEN_SCALE : 1) * GROWN * spot.size * 0.999, (spot.turn ?? 0) * (Math.PI / 2));
          for (const [fx, fz] of foot) ok(!wet(spot.x + fx, spot.z + fz), `${what}: a model reaches over the water at ${spot.x + fx},${spot.z + fz}`);
        });
      }
    }
});

test('a turn can end before the capital is founded (Civ V’s): research is asked for only once there’s a city', () => {
  const { game, at } = blank();
  const p = game.players[0];
  unit(game, 'settler', 0, at(5, 5));
  p.researching = null;
  eq(blockers(game, p).length, 0, 'nothing stops the turn with only a Settler');
  city(game, 0, at(5, 5));
  ok(blockers(game, p).some((b) => b.text === 'Choose research'), 'with a city, research is asked for');
});

test('rivers run as a tree, not a web, round their tiles’ middles: none of a river tile’s units stand in the water, and dense rivers don’t drown their land', () => {
  const seats = [
    { user: null, name: 'A', civ: 'egypt', bot: true },
    { user: null, name: 'B', civ: 'babylon', bot: true },
  ];
  const shares: number[] = [];
  const dense: number[] = [];
  for (const wrap of [true, false])
    for (const seed of [3, 41, 91, 127, 300, 555]) {
      const settings = { size: 'small', type: 'continents', speed: 'quick', timer: 0, cityStates: 4, barbarians: false, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330, wrap } as const;
      const game = createGame({ ...settings, victories: { ...settings.victories } }, seats, seed);
      const g = game.grid;
      const water = (t: number) => t >= 0 && !!TERRAINS[game.tiles[t].terrain].water;
      const river = (t: number) => t >= 0 && !!game.tiles[t].river && !water(t);
      // A tree: each run of river tiles joined by one link fewer than it has tiles, every tile reached; each mouth out to one water.
      const links = riverLinks(g, game.tiles);
      const seen = new Set<number>();
      for (let t = 0; t < game.tiles.length; t++) {
        if (!river(t) || seen.has(t)) continue;
        const run = [t];
        seen.add(t);
        let inner = 0;
        let mouths = 0;
        for (let i = 0; i < run.length; i++) {
          const ds = links.get(run[i]) ?? [];
          ok(new Set(ds).size === ds.length, `tile ${run[i]} links each way once`);
          for (const d of ds) {
            const n = neighbour(g, run[i], d);
            if (water(n)) mouths++;
            else {
              ok(river(n) && (links.get(n) ?? []).includes((d + 3) % 6), `tile ${run[i]}'s link to ${n} goes both ways`);
              inner++;
              if (!seen.has(n)) {
                seen.add(n);
                run.push(n);
              }
            }
          }
        }
        ok(run.every((x) => links.has(x) || run.length === 1), `every tile of the river at ${t} is on it`);
        eq(inner, 2 * (run.length - 1), `the river at ${t} (${run.length} tiles, ${wrap ? 'wrapped' : 'flat'}, seed ${seed}) is a tree`);
        ok(mouths <= run.filter((x) => [0, 1, 2, 3, 4, 5].some((d) => water(neighbour(g, x, d)))).length, `the river at ${t} flows out once at each mouth`);
      }
      eq(JSON.stringify([...riverLinks(g, game.tiles)]), JSON.stringify([...links]), 'the same rivers every time');
      // The land: where each river tile's units stand is dry; how much of each is water.
      const size = extent(g);
      const ground = new Ground(Math.ceil(size.w), Math.ceil(size.d), terrainEdits(g, game.tiles), period(g));
      const wet = (x: number, z: number) => ground.at(Math.floor(x), Math.floor(z))?.block === 'water';
      game.tiles.forEach((tile, t) => {
        if (!river(t) || tile.feature === 'marsh' || tile.wonder) return;
        const c = middleOf(g, t);
        for (const [ox, oz] of UNIT_SPOTS) ok(!wet(c.x + ox, c.z + oz), `seed ${seed} (${wrap ? 'wrapped' : 'flat'}): a unit on river tile ${t} stands in the water (${ox}, ${oz})`);
        let n = 0;
        let w = 0;
        for (let x = Math.floor(c.x - 5); x <= c.x + 5; x++)
          for (let z = Math.floor(c.z - 5); z <= c.z + 5; z++) {
            if (tileUnder(g, x + 0.5, z + 0.5) !== t) continue;
            n++;
            if (wet(x, z)) w++;
          }
        shares.push(w / n);
        if (neighbours(g, t).filter(river).length >= 3) dense.push(w / n);
      });
    }
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  // (Joined every way, they were 42% water on average, 58% where they're dense, and some 80%.)
  ok(mean(shares) < 0.33, `a river tile is under a third water, on average (${(mean(shares) * 100).toFixed(0)}%)`);
  ok(mean(dense) < 0.4, `where rivers are dense, well under half (${(mean(dense) * 100).toFixed(0)}%, of ${dense.length})`);
  // (The worst a fork three ways round, each a third of the tile apart: 63% on the bigger maps.)
  ok(Math.max(...shares) <= 0.65, `none is mostly water (${(Math.max(...shares) * 100).toFixed(0)}% at most)`);
});

test('wonders open as Civ V’s Brave New World has it: the Pyramids with Liberty, the Kremlin with Order, and so on, not with the tech alone', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const c = city(game, 0, at(5, 5));
  p.techs.push('masonry', 'pottery', 'bronze_working', 'calendar', 'railroad');
  const can = () => constructible(game, p, c);
  for (const id of ['pyramids', 'hanging_gardens', 'statue_of_zeus', 'kremlin']) ok(!can().includes(id), `no ${id} with only its tech`);
  ok(can().includes('stonehenge') && can().includes('mausoleum'), 'a wonder with no policy needs only its tech');
  p.policies.push('liberty');
  ok(can().includes('pyramids') && !can().includes('hanging_gardens'), 'Liberty opens the Pyramids (and only them)');
  p.policies.push('tradition', 'honor');
  ok(can().includes('hanging_gardens') && can().includes('statue_of_zeus'), 'Tradition the Hanging Gardens, Honor the Statue of Zeus');
  p.ideology = 'order';
  ok(can().includes('kremlin'), 'the Order ideology opens the Kremlin');
  eq(Object.values(BUILDINGS).filter((b) => b.policy).length, 11, 'eleven wonders need a policy');
});

test('the Great Wall stands in blocks round the land of the civ that holds it, where it meets land not theirs, with gates for roads', () => {
  for (const wrap of [false, true]) {
    const { game, at } = blank(undefined, { wrap });
    const g = game.grid;
    const c = city(game, 0, at(6, 6));
    // Their land: the city and the ring round it, and one more tile two out to the east.
    const ours = new Set([c.tile, ...neighbours(g, c.tile), at(8, 6)]);
    for (const t of ours) game.tiles[t].owner = 0;
    const size = extent(g);
    const ground = new Ground(Math.ceil(size.w), Math.ceil(size.d), terrainEdits(g, game.tiles), period(g));
    const bricks = (t: number) => decorOf(game, ground, t).filter((p) => p[3] === 'stone_bricks').length;
    for (const t of ours) eq(wallEdges(game, t), 0, `no wall before the wonder (tile ${t})`);
    const before = decorKey(game, neighbours(g, c.tile)[0]);
    game.wonders.great_wall = 0;
    ok(decorKey(game, neighbours(g, c.tile)[0]) !== before, 'building it changes what the border tiles show');
    eq(wallEdges(game, c.tile), 0, 'none round the city itself');
    for (const t of neighbours(g, c.tile)) {
      const edges = wallEdges(game, t);
      ok(edges !== 0, `a wall along the ring tile ${t} (${wrap ? 'wrapped' : 'flat'})`);
      for (let d = 0; d < 6; d++) {
        const n = neighbour(g, t, d);
        eq(!!(edges & (1 << d)), n >= 0 && !ours.has(n), `tile ${t}'s edge toward ${n}: walled only where the land isn't theirs`);
      }
      ok(bricks(t) >= 4, `tile ${t} has its wall in blocks (${bricks(t)})`);
      for (const [x, , z] of decorOf(game, ground, t)) eq(tileUnder(g, x + 0.5, z + 0.5), t, `tile ${t}'s wall stays on its own columns`);
    }
    // Not along the coast: a ring tile beside the sea walls only its land edges.
    const coastal = neighbours(g, c.tile)[0];
    const sea = neighbours(g, coastal).find((n) => n >= 0 && !ours.has(n))!;
    game.tiles[sea].terrain = 'coast';
    eq(wallEdges(game, coastal) & (1 << neighbours(g, coastal).indexOf(sea)), 0, 'no wall facing the sea');
    game.tiles[sea].terrain = 'grassland';
    // A road leaves a gate.
    const t = neighbours(g, c.tile)[1];
    const walled = bricks(t);
    game.tiles[t].road = 'road';
    game.tiles[neighbours(g, t).find((n) => n >= 0 && !ours.has(n))!].road = 'road';
    ok(bricks(t) < walled, `a road through the wall leaves a gate (${walled} bricks, then ${bricks(t)})`);
    // It goes with the wonder's city.
    game.wonders.great_wall = 1;
    for (const t of ours) eq(wallEdges(game, t), 0, `taken, it's no longer round the old owner's land (tile ${t})`);
    game.wonders.great_wall = -1;
    eq(wallEdges(game, neighbours(g, c.tile)[0]), 0, 'gone with a razed city, gone from the land');
  }
});

test('what’s left over is kept: production past a finished build goes into the next one chosen, science past a tech into the next tech', () => {
  const { game, at } = blank();
  const p = game.players[0];
  p.bot = false;
  const c = city(game, 0, at(5, 5));
  c.queue = [];
  c.prod = 30;
  ok(apply(game, 0, { t: 'produce', city: c.id, item: { kind: 'building', id: 'monument' } }).ok, 'chose a monument');
  eq(c.prod, 30, 'the production left over went into it');
  // Switching away still keeps each thing's own.
  ok(apply(game, 0, { t: 'produce', city: c.id, item: { kind: 'unit', id: 'warrior' } }).ok, 'switched');
  eq(c.prod, 0, 'nothing carried from the monument to the warrior');
  eq(c.saved?.['building:monument'], 30, 'the monument keeps its 30');
  // Science: a tech learned with nothing chosen next.
  p.researching = 'agriculture';
  p.research.agriculture = techCost(game, p, 'agriculture') + 40;
  p.techQueue = [];
  endTurn(game);
  ok(p.techs.includes('agriculture') && !p.researching, 'learned, and nothing chosen next');
  const spare = p.spareScience ?? 0;
  ok(spare >= 40, `the science over is kept (${spare})`);
  endTurn(game);
  ok((p.spareScience ?? 0) > spare, 'and the next turn’s, with nothing chosen');
  const kept = p.spareScience!;
  ok(apply(game, 0, { t: 'research', tech: 'pottery' }).ok, 'chose pottery');
  eq(Math.round(p.research.pottery ?? 0), Math.round(kept), 'all of it went into pottery');
  eq(p.spareScience, undefined, 'none left over');
});

test('a building that needs a strategic resource uses one up, as a unit does', () => {
  const { game, at } = blank();
  const p = game.players[0];
  const a = city(game, 0, at(4, 4), { buildings: ['workshop'] });
  const b = city(game, 0, at(10, 4), { buildings: ['workshop'] });
  techsTo(game, 0, TECHS.industrialization.col);
  const coal = neighbours(game.grid, a.tile)[0];
  Object.assign(game.tiles[coal], { owner: 0, city: a.id, resource: 'coal', amount: 1, improvement: 'mine' });
  ok(constructible(game, p, a).includes('factory') && constructible(game, p, b).includes('factory'), 'one Coal: either city may build a Factory');
  a.buildings.push('factory');
  eq(strategic(game, p).coal?.used, 1, 'the Factory uses the Coal');
  ok(!constructible(game, p, b).includes('factory'), 'so the other city can’t build one too');
});

test('a city taken back while it burns is put out; annexing is for good; nothing is bought in resistance', () => {
  const { game, at } = blank();
  war(game, 0, 1);
  city(game, 0, at(4, 4));
  city(game, 1, at(16, 12));
  const town = city(game, 1, at(10, 8), { pop: 6 });
  town.hp = 1;
  const s = unit(game, 'swordsman', 0, neighbours(game.grid, town.tile)[0]);
  ok(apply(game, 0, { t: 'attack', unit: s.id, target: town.tile }).ok && town.owner === 0, 'Egypt takes it');
  game.players[0].gold = 5000;
  ok((town.resistance ?? 0) > 0, 'in resistance');
  ok(apply(game, 0, { t: 'cityChoice', city: town.id, choice: 'annex' }).ok, 'annexed');
  const buy = apply(game, 0, { t: 'buy', city: town.id, item: { kind: 'unit', id: 'warrior' }, with: 'gold' });
  ok(!buy.ok && /resistance/.test(buy.error ?? ''), `nothing bought in resistance (${buy.error})`);
  ok(!apply(game, 0, { t: 'cityChoice', city: town.id, choice: 'puppet' }).ok, 'and it can’t be made a puppet again');
  ok(apply(game, 0, { t: 'cityChoice', city: town.id, choice: 'raze' }).ok, 'razed');
  endTurn(game);
  const here = game.units.find((u) => u.tile === town.tile);
  if (here) game.units.splice(game.units.indexOf(here), 1);
  town.hp = 1;
  const b = unit(game, 'swordsman', 1, neighbours(game.grid, town.tile)[2]);
  ok(apply(game, 1, { t: 'attack', unit: b.id, target: town.tile }).ok && town.owner === 1, 'Babylon takes it back');
  eq(town.razing, undefined, 'the fire’s out');
  for (let i = 0; i < 8; i++) endTurn(game);
  ok(game.cities.includes(town), 'it still stands');
});

test('a city that shrinks keeps no more followers than citizens; a city grows keeping the food over; a missionary bought appears on land, not on an enemy', () => {
  const { game, at } = blank();
  const c = city(game, 0, at(6, 6), { pop: 6 });
  c.followers = { r1: 6 };
  c.food = -500;
  endTurn(game);
  eq(c.pop, 5, 'it starved');
  const total = Object.values(c.followers ?? {}).reduce((s, k) => s + k, 0);
  ok(total <= c.pop, `followers ${JSON.stringify(c.followers)} in a city of ${c.pop}`);
  // Growth.
  const g = city(game, 0, at(12, 6), { pop: 1 });
  const need = growthThreshold(game, 1);
  g.food = need + 40;
  const kept = Math.floor(growthThreshold(game, 1) * (foodKept(game, g) / 100));
  endTurn(game);
  ok(g.pop >= 2, 'grew');
  ok(g.food >= 40 + kept, `kept the 40 over (${g.food})`);
  // A missionary: every tile round the city is sea but one, which an enemy holds.
  const p = game.players[0];
  const m = city(game, 0, at(6, 12));
  war(game, 0, 1);
  const ring = neighbours(game.grid, m.tile);
  for (const t of ring.slice(1)) game.tiles[t].terrain = 'ocean';
  unit(game, 'warrior', 1, ring[0]);
  unit(game, 'worker', 0, m.tile);
  const u = faithUnit(game, p, m, 'missionary')!;
  ok(!TERRAINS[game.tiles[u.tile].terrain].water, 'not out at sea');
  ok(!game.units.some((x) => x.tile === u.tile && x.owner === 1), 'not on the enemy');
});

test('an aircraft strikes once a turn, not after rebasing, and only at what its civ sees', () => {
  const { game, at } = blank();
  city(game, 0, at(5, 5));
  const second = city(game, 0, at(5, 10));
  city(game, 1, at(25, 5));
  war(game, 0, 1);
  const bomber = unit(game, 'great_war_bomber', 0, at(5, 5));
  const foe = unit(game, 'machine_gun', 1, at(8, 5));
  unit(game, 'scout', 0, at(7, 5));
  ok(apply(game, 0, { t: 'attack', unit: bomber.id, target: foe.tile }).ok, 'the first strike');
  const hp = foe.hp;
  ok(!apply(game, 0, { t: 'attack', unit: bomber.id, target: foe.tile }).ok, 'no second strike this turn');
  eq(foe.hp, hp, 'and no more damage');
  // Rebased, it has flown its turn.
  const other = unit(game, 'great_war_bomber', 0, at(5, 5));
  ok(apply(game, 0, { t: 'rebase', unit: other.id, to: second.tile }).ok, 'rebased');
  ok(!apply(game, 0, { t: 'attack', unit: other.id, target: foe.tile }).ok, 'no strike after rebasing');
  // Out of sight: nothing to strike.
  const hidden = unit(game, 'machine_gun', 1, at(10, 10));
  const third = unit(game, 'great_war_bomber', 0, second.tile);
  updateAllVisibility(game);
  ok(!(game.players[0].visible[hidden.tile] > 0), 'the tile is out of sight');
  ok(!apply(game, 0, { t: 'attack', unit: third.id, target: hidden.tile }).ok, 'no strike on what it can’t see');
  eq(hidden.hp, 100, 'unhurt');
});

test('a carrier sunk (by a city’s fire, or a strike) loses the aircraft aboard', () => {
  const { game, at } = blank();
  city(game, 0, at(5, 5));
  const enemy = city(game, 1, at(15, 5));
  war(game, 0, 1);
  for (const c of [13, 14]) for (const r of [6, 7]) game.tiles[at(c, r)].terrain = 'coast';
  const carrier = unit(game, 'carrier', 0, at(14, 7), { hp: 1 });
  const fighter = unit(game, 'fighter', 0, at(14, 7), { carrier: carrier.id });
  ok(apply(game, 1, { t: 'cityFire', city: enemy.id, target: carrier.tile }).ok, 'the city fires');
  ok(!game.units.includes(carrier), 'the carrier is sunk');
  ok(!game.units.includes(fighter), 'its fighter with it');
});

test('a Guided Missile is spent in its strike', () => {
  const { game, at } = blank();
  city(game, 0, at(5, 5));
  city(game, 1, at(25, 5));
  war(game, 0, 1);
  const missile = unit(game, 'guided_missile', 0, at(5, 5));
  const foe = unit(game, 'machine_gun', 1, at(8, 5));
  unit(game, 'scout', 0, at(7, 5));
  updateAllVisibility(game);
  const r = apply(game, 0, { t: 'attack', unit: missile.id, target: foe.tile });
  ok(r.ok && foe.hp < 100, 'it strikes');
  ok(!game.units.includes(missile), 'and is gone');
  ok(!!r.combat?.[0].died, 'the strike says so');
});

test('aircraft aboard ships: a Carrier takes three fighters or bombers (not the Stealth Bomber), a Missile Cruiser three missiles, a Nuclear Submarine two', () => {
  const { game, at } = blank();
  const home = city(game, 0, at(5, 5));
  city(game, 1, at(25, 5));
  for (const c of [6, 7, 8]) for (const r of [4, 5, 6]) if (at(c, r) !== home.tile) game.tiles[at(c, r)].terrain = 'coast';
  const carrier = unit(game, 'carrier', 0, at(7, 5));
  const cruiser = unit(game, 'missile_cruiser', 0, at(7, 6));
  const sub = unit(game, 'nuclear_submarine', 0, at(8, 5));
  const rebase = (type: string, to: number) => {
    const a = unit(game, type, 0, home.tile);
    const r = apply(game, 0, { t: 'rebase', unit: a.id, to });
    return { a, r };
  };
  for (let i = 0; i < 3; i++) {
    const { a, r } = rebase(i ? 'bomber' : 'fighter', carrier.tile);
    ok(r.ok && a.carrier === carrier.id, `aircraft ${i + 1} aboard the Carrier`);
  }
  const full = rebase('fighter', carrier.tile).r;
  ok(!full.ok, `a fourth has no room (${full.error})`);
  const stealth = rebase('stealth_bomber', carrier.tile).r;
  ok(!stealth.ok && /cities/.test(stealth.error ?? ''), `no Stealth Bomber on a Carrier (${stealth.error})`);
  ok(!rebase('guided_missile', carrier.tile).r.ok, 'nor a missile');
  ok(!rebase('fighter', cruiser.tile).r.ok, 'no fighter on a Missile Cruiser');
  for (let i = 0; i < 3; i++) ok(rebase('guided_missile', cruiser.tile).r.ok, `missile ${i + 1} aboard the Missile Cruiser`);
  ok(!rebase('guided_missile', cruiser.tile).r.ok, 'a fourth has no room');
  for (let i = 0; i < 2; i++) ok(rebase(i ? 'nuclear_missile' : 'guided_missile', sub.tile).r.ok, `missile ${i + 1} aboard the Nuclear Submarine`);
  ok(!rebase('guided_missile', sub.tile).r.ok, 'a third has no room');
  // Where the ship sails, its missiles go.
  const aboard = game.units.filter((a) => a.carrier === sub.id);
  ok(apply(game, 0, { t: 'move', unit: sub.id, to: at(8, 4) }).ok, 'the submarine sails');
  ok(aboard.every((a) => a.tile === sub.tile), 'its missiles with it');
});

test('an aircraft rebases between a city and a ship in its port; its view lists where it could rebase to', () => {
  const { game, at } = blank();
  const home = city(game, 0, at(5, 5));
  const other = city(game, 0, at(5, 12));
  city(game, 1, at(25, 5));
  game.tiles[at(6, 5)].terrain = 'coast';
  const fighter = unit(game, 'fighter', 0, home.tile);
  const stay = apply(game, 0, { t: 'rebase', unit: fighter.id, to: home.tile });
  ok(!stay.ok && /already/.test(stay.error ?? ''), `nowhere else to be in its own city (${stay.error})`);
  const carrier = unit(game, 'carrier', 0, home.tile);
  const bases = () => viewFor(game, game.players[0], null).units.find((u) => u.id === fighter.id)?.bases ?? [];
  ok(bases().includes(home.tile) && bases().includes(other.tile), `the Carrier in port and the other city are open to it (${bases()})`);
  ok(apply(game, 0, { t: 'rebase', unit: fighter.id, to: home.tile }).ok && fighter.carrier === carrier.id, 'aboard the Carrier in port');
  eq(bases().length, 0, 'nothing more this turn');
  fighter.moves = 1;
  ok(bases().includes(home.tile), 'next turn, back to the city');
  ok(apply(game, 0, { t: 'rebase', unit: fighter.id, to: home.tile }).ok && fighter.carrier === undefined, 'back in the city');
  fighter.moves = 1;
  const far = city(game, 0, at(24, 14));
  ok(distance(game.grid, fighter.tile, far.tile) > 16 && !bases().includes(far.tile), 'not a city beyond twice its range');
  const mine = viewFor(game, game.players[1], null).units.find((u) => u.id === fighter.id);
  eq(mine?.bases, undefined, 'another’s screen isn’t told');
});

test('air promotions: open to fighters and bombers; Interception strengthens a fighter against aircraft, Evasion halves what an interception does, Air Range reaches further', () => {
  const { game, at } = blank();
  const fighter = unit(game, 'fighter', 0, at(5, 5));
  const bomber = unit(game, 'bomber', 0, at(5, 5));
  const sword = unit(game, 'swordsman', 0, at(6, 6));
  const open = (u: typeof fighter) => promotionsFor(u).map((p) => p.id);
  ok(open(fighter).includes('interception_1') && open(fighter).includes('air_siege_1'), `a fighter's (${open(fighter)})`);
  ok(open(bomber).includes('air_siege_1') && !open(bomber).includes('interception_1') && !open(bomber).includes('evasion'), `a bomber's (${open(bomber)})`);
  ok(!open(sword).some((id) => id.startsWith('air_') || id.startsWith('interception')), 'none for a swordsman');
  bomber.promotions.push('air_siege_1');
  ok(open(bomber).includes('evasion'), 'Evasion after Air Siege I');
  // Taken as any other, by experience.
  fighter.xp = 10;
  ok(apply(game, 0, { t: 'promote', unit: fighter.id, promotion: 'interception_1' }).ok, 'a fighter takes Interception I');
  const plain = unit(game, 'fighter', 0, at(5, 5));
  const s = (u: typeof fighter) => strength(game, u, 'ranged', bomber, u.tile);
  ok(Math.abs(s(fighter) / s(plain) - 1.33) < 0.02, `a third stronger against a bomber (${s(fighter)} to ${s(plain)})`);
  const range = rangeOf(plain);
  plain.promotions.push('air_range');
  eq(rangeOf(plain), range + 2, 'Air Range: two further');
  // A bot's aircraft promote as a fighter or a bomber would.
  const auto = unit(game, 'fighter', 0, at(5, 5), { xp: 10 });
  autoPromote(game, auto);
  eq(auto.promotions[0], 'interception_1', 'a bot’s fighter to Interception');
  const autoB = unit(game, 'bomber', 0, at(5, 5), { xp: 10 });
  autoPromote(game, autoB);
  eq(autoB.promotions[0], 'air_siege_1', 'a bot’s bomber to Air Siege');
  // Evasion: the same strike, intercepted, with and without it.
  const intercepted = (promotions: string[]) => {
    const w = blank();
    for (const p of w.game.players) p.bot = false;
    city(w.game, 0, w.at(5, 5));
    const theirs = city(w.game, 1, w.at(14, 5));
    war(w.game, 0, 1);
    unit(w.game, 'fighter', 1, theirs.tile, { stance: 'alert' });
    const b = unit(w.game, 'bomber', 0, w.at(5, 5), { promotions });
    unit(w.game, 'scout', 0, w.at(12, 5));
    w.game.rng = 4242;
    ok(apply(w.game, 0, { t: 'attack', unit: b.id, target: theirs.tile }).ok, 'the strike');
    const n = w.game.players[0].notes.find((x) => /was intercepted/.test(x.text));
    return Number(/\((\d+) damage\)/.exec(n?.text ?? '')?.[1] ?? NaN);
  };
  const without = intercepted(['air_siege_1']);
  const evading = intercepted(['air_siege_1', 'evasion']);
  ok(without > 0 && Math.abs(evading - without / 2) <= 1, `half the damage (${evading} to ${without})`);
});

test('a nuclear strike on a Carrier loses its aircraft once, with it', () => {
  const { game, at } = blank();
  for (const p of game.players) p.bot = false;
  techsTo(game, 0, 15);
  const home = city(game, 0, at(3, 5), { buildings: ['manhattan_project'] });
  const theirs = city(game, 1, at(12, 5));
  war(game, 0, 1);
  game.tiles[at(13, 5)].terrain = 'coast';
  const carrier = unit(game, 'carrier', 1, at(13, 5), { hp: 20 });
  // (Wounded, so the blast would finish it off again.)
  const fighter = unit(game, 'fighter', 1, carrier.tile, { carrier: carrier.id, hp: 20 });
  const bystander = unit(game, 'worker', 1, at(20, 12));
  const missile = unit(game, 'nuclear_missile', 0, home.tile);
  updateAllVisibility(game);
  ok(apply(game, 0, { t: 'attack', unit: missile.id, target: theirs.tile }).ok, 'the strike');
  ok(!game.units.includes(carrier) && !game.units.includes(fighter), 'the Carrier and its fighter are lost');
  ok(game.units.includes(bystander), 'and nothing else (a unit far off) with them');
  eq(game.players[1].notes.filter((n) => /Fighter/.test(n.text)).length, 1, 'the fighter is lost once');
});

test('a city burnt to the ground loses the aircraft there; one liberated sends its liberator’s aircraft to another base', () => {
  const { game, at } = blank(['egypt', 'babylon', 'china'], { size: 'small' });
  city(game, 0, at(3, 3));
  const near = city(game, 0, at(3, 9));
  city(game, 1, at(28, 3));
  city(game, 2, at(16, 18));
  const burning = city(game, 0, at(10, 3), { pop: 1 });
  Object.assign(burning, { founder: 1, takenFrom: 1, razing: 1 });
  const lost = unit(game, 'fighter', 0, burning.tile);
  endTurn(game);
  ok(!game.cities.includes(burning), 'the city is gone');
  ok(!game.units.includes(lost), 'its fighter with it');
  // Liberated: it flies to the nearest of its civ's bases in reach.
  const town = city(game, 0, at(8, 9), { pop: 4 });
  Object.assign(town, { founder: 2, takenFrom: 1, puppet: true });
  const flies = unit(game, 'bomber', 0, town.tile);
  ok(apply(game, 0, { t: 'cityChoice', city: town.id, choice: 'liberate' }).ok, 'liberated');
  ok(game.units.includes(flies) && flies.tile === near.tile, `the bomber flew to the nearest city (${flies.tile})`);
});

test('attacking breaks fortifying: a fortified unit that wins and moves in isn’t fortified there', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  city(game, 1, at(25, 12));
  war(game, 0, 1);
  const sw = unit(game, 'swordsman', 0, at(10, 8), { stance: 'fortify', fortified: 2 });
  const foe = unit(game, 'warrior', 1, at(11, 8), { hp: 5 });
  const r = apply(game, 0, { t: 'attack', unit: sw.id, target: foe.tile });
  ok(r.ok && !!r.combat?.[0].killed, 'it wins');
  eq(sw.tile, at(11, 8), 'and moves in');
  eq(sw.stance, undefined, 'no longer fortified');
  const why: { label: string; percent: number }[] = [];
  strength(game, sw, 'defend', null, sw.tile, why);
  ok(!why.some((m) => m.label === 'Fortified'), 'no fortifying bonus where it stands');
  // A ranged unit that fires leaves its fortifying too.
  const archer = unit(game, 'archer', 0, at(10, 10), { stance: 'fortify', fortified: 2 });
  const target = unit(game, 'warrior', 1, at(11, 10));
  ok(apply(game, 0, { t: 'attack', unit: archer.id, target: target.tile }).ok, 'it fires');
  eq(archer.fortified, 0, 'and isn’t fortified');
});

test('a unit at sea in a boat can’t fortify, nor have a fortifying bonus', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  city(game, 1, at(25, 12));
  game.players[0].techs.push('optics');
  game.tiles[at(10, 8)].terrain = 'coast';
  const sw = unit(game, 'swordsman', 0, at(10, 8), { embarked: true });
  ok(!apply(game, 0, { t: 'stance', unit: sw.id, stance: 'fortify' }).ok, 'no fortifying at sea');
  sw.stance = 'fortify';
  sw.fortified = 2;
  const why: { label: string; percent: number }[] = [];
  strength(game, sw, 'defend', null, sw.tile, why);
  ok(!why.some((m) => m.label === 'Fortified'), 'and no bonus for it');
});

test('a ship and a soldier embarked beside it share a tile at sea: one of each, as with a soldier and a civilian', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  city(game, 1, at(25, 12));
  game.players[0].techs.push('optics');
  for (let col = 10; col <= 13; col++) game.tiles[at(col, 8)].terrain = 'coast';
  const sea = at(11, 8);
  const water = (t: number) => !!TERRAINS[game.tiles[t].terrain].water;
  const [shore, beach] = neighbours(game.grid, sea).filter((t) => !water(t));
  const frigate = unit(game, 'frigate', 0, sea);
  const pikeman = unit(game, 'pikeman', 0, shore);
  ok(canEnter(game, pikeman, sea), 'a soldier may embark onto its own ship’s tile');
  ok(apply(game, 0, { t: 'move', unit: pikeman.id, to: sea }).ok, 'sent there');
  ok(pikeman.tile === sea && !!pikeman.embarked && frigate.tile === sea, 'the pikeman embarks beside the frigate');
  eq(occupants(game, sea).military, frigate, 'the frigate is the one an attack meets');
  eq(occupants(game, sea).behind, pikeman, 'the pikeman behind it');
  eq(militaryAt(makeCtx(game, game.players[1]), sea), frigate, 'as the bots see it');
  ok(!canEnter(game, unit(game, 'spearman', 0, beach), sea), 'but no second soldier embarks there');
  const away = neighbours(game.grid, sea).find((t) => water(t))!;
  ok(!canEnter(game, unit(game, 'trireme', 0, at(13, 8)), sea), 'nor a second ship comes');
  ok(canEnter(game, unit(game, 'worker', 0, at(5, 5)), sea), 'a civilian may embark there too');
  ok(apply(game, 0, { t: 'move', unit: frigate.id, to: away }).ok && frigate.tile === away, 'the frigate sails off');
  eq(occupants(game, sea).military, pikeman, 'the pikeman alone holds the tile');
  ok(apply(game, 0, { t: 'move', unit: frigate.id, to: sea }).ok && frigate.tile === sea, 'and the frigate comes back beside it');
  // (Ashore, still one soldier to a tile.)
  const archer = unit(game, 'archer', 0, at(6, 6));
  ok(!canEnter(game, unit(game, 'warrior', 0, at(6, 7)), archer.tile), 'one soldier to a tile on land');
});

test('a ship fights for the soldier embarked beside it, which holds the tile if the ship sinks; a submarine, unseen, shields nothing', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  city(game, 1, at(25, 12));
  war(game, 0, 1);
  for (let col = 10; col <= 13; col++) game.tiles[at(col, 8)].terrain = 'coast';
  const sea = at(11, 8);
  const next = neighbours(game.grid, sea).find((t) => TERRAINS[game.tiles[t].terrain].water)!;
  const frigate = unit(game, 'frigate', 0, sea, { hp: 1 });
  const pikeman = unit(game, 'pikeman', 0, sea, { embarked: true });
  const worker = unit(game, 'worker', 0, sea, { embarked: true });
  const raider = unit(game, 'caravel', 1, next);
  eq(previewAttack(game, raider, sea)?.defender.unit, 'frigate', 'the frigate is the one it would fight');
  ok(apply(game, 1, { t: 'attack', unit: raider.id, target: sea }).ok, 'attacked');
  ok(!game.units.includes(frigate), 'the frigate sinks');
  eq(pikeman.hp, 100, 'the pikeman unhurt');
  eq(raider.tile, next, 'the raider doesn’t move in past it');
  eq(worker.owner, 0, 'nor takes the worker');
  eq(occupants(game, sea).military, pikeman, 'the pikeman holds the tile now');
  const sub = unit(game, 'submarine', 0, sea);
  eq(occupants(game, sea).military, pikeman, 'beside a submarine, the pikeman is the one seen and fought');
  eq(occupants(game, sea).behind, sub, 'the submarine under it');
});

test('a siege unit’s setting up for an attack that can’t be made costs nothing', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  city(game, 1, at(25, 12));
  war(game, 0, 1);
  const cat = unit(game, 'catapult', 0, at(8, 8));
  const foe = unit(game, 'warrior', 1, at(14, 8));
  unit(game, 'scout', 0, at(13, 8));
  ok(!apply(game, 0, { t: 'attack', unit: cat.id, target: foe.tile }).ok, 'out of range');
  eq(cat.moves, 2, 'its moves kept');
  ok(!cat.setUp, 'not set up');
});

test('the combat preview agrees with the attack: mounted units take cities, mounted archers fire', () => {
  const { game, at } = blank();
  city(game, 0, at(3, 3));
  city(game, 1, at(23, 14));
  const c = city(game, 1, at(12, 8));
  war(game, 0, 1);
  c.hp = 1;
  const h = unit(game, 'horseman', 0, at(11, 8));
  ok((previewAttack(game, h, c.tile)?.takes ?? 0) > 0, 'a horseman may take the city');
  ok(!!apply(game, 0, { t: 'attack', unit: h.id, target: c.tile }).combat?.[0].captured, 'and it does');
  const ca = unit(game, 'chariot_archer', 0, at(18, 4));
  const foe = unit(game, 'warrior', 1, at(19, 4));
  const p = previewAttack(game, ca, foe.tile)!;
  ok(p.ranged, 'next door, a chariot archer’s preview is a ranged attack');
  eq(p.attacker.damage[1], 0, 'with no reply');
  const r = apply(game, 0, { t: 'attack', unit: ca.id, target: foe.tile });
  eq(r.combat?.[0].taken, 0, 'as the attack is');
});

/** Two civs who've met, each with a city, Writing to Philosophy and embassies both ways (people, so offers wait for an answer). */
function dealers(civs = ['egypt', 'babylon']) {
  const w = blank(civs, { size: civs.length > 2 ? 'small' : 'duel' });
  const { game, at } = w;
  game.players.forEach((p, i) => {
    p.bot = false;
    p.met = game.players.map((o) => o.index);
    city(game, i, at(3 + 9 * (i % 2), 3 + 9 * Math.floor(i / 2)));
    techsTo(game, i, 4);
    for (const o of game.players) if (o !== p) p.diplomacy.embassy[o.index] = true;
  });
  return w;
}

test('a deal can’t hold the same thing twice, however it’s dressed up (no research agreement paid twice, no iron given that isn’t there)', () => {
  const { game, at } = dealers();
  const [a, b] = game.players;
  a.gold = b.gold = 300;
  eq(dealProblem(game, { from: 0, to: 1, items: [{ kind: 'research' }, { kind: 'research', x: 1 } as never] }), 'The same thing twice', 'two research agreements');
  game.tiles[at(3, 3)].resource = 'iron';
  game.tiles[at(3, 3)].amount = 2;
  const twice = [{ kind: 'strategic', from: 0, resource: 'iron', amount: 2 }, { kind: 'strategic', from: 0, resource: 'iron', amount: 2, x: 1 }];
  eq(dealProblem(game, { from: 0, to: 1, items: twice as never }), 'The same thing twice', 'two lots of the same iron');
  eq(dealProblem(game, { from: 0, to: 1, items: [{ kind: 'strategic', from: 0, resource: 'iron', amount: 2 }] }), null, 'the iron it has, once');
  eq(dealProblem(game, { from: 0, to: 1, items: [{ kind: 'research' }] }), null, 'one research agreement');
});

test('gold a turn is promised only up to the payer’s income, less what its deals pay already', () => {
  const { game } = dealers();
  const [a, b] = game.players;
  a.lastIncome = { gold: 10, science: 0, culture: 0, faith: 0, happiness: 0, tourism: 0 };
  eq(spareIncome(game, a), 10, 'all of its income');
  ok(!!dealProblem(game, { from: 0, to: 1, items: [{ kind: 'gold', from: 1, amount: 0 + 1 }, { kind: 'goldPerTurn', from: 0, amount: 60 }] }), '60 a turn on an income of 10: refused');
  makeDeal(game, { from: 0, to: 1, items: [{ kind: 'goldPerTurn', from: 0, amount: 6 }] });
  eq(spareIncome(game, a), 4, 'a deal made this turn counts against it');
  ok(!!dealProblem(game, { from: 0, to: 1, items: [{ kind: 'goldPerTurn', from: 0, amount: 5 }] }), 'so 5 more is too much');
  // Next turn its income has the payment in it already: not counted twice.
  relationsOf(game).running[0].turns--;
  a.lastIncome.gold = 4;
  eq(spareIncome(game, a), 4, 'the payment counted once');
  eq(dealProblem(game, { from: 0, to: 1, items: [{ kind: 'goldPerTurn', from: 0, amount: 4 }] }), null, 'what is left can be promised');
  eq(dealGold(game, b), 6, 'the payee is owed its 6');
});

test('a defensive pact’s partner called into a war ends its own deals with the aggressor', () => {
  const { game } = dealers(['egypt', 'babylon', 'china']);
  const [a, b, c] = game.players;
  const turns = dealTurns(game);
  b.diplomacy.friends[2] = c.diplomacy.friends[1] = turns;
  b.diplomacy.pacts[2] = c.diplomacy.pacts[1] = turns;
  a.gold = c.gold = 1000;
  a.lastIncome = { gold: 50, science: 0, culture: 0, faith: 0, happiness: 0, tourism: 0 };
  makeDeal(game, { from: 0, to: 2, items: [{ kind: 'research' }, { kind: 'goldPerTurn', from: 0, amount: 10 }] });
  ok(apply(game, 0, { t: 'war', target: 1, why: null }).ok, 'Egypt declares on Babylon');
  ok(c.diplomacy.war[0], 'China honours its pact');
  eq(relationsOf(game).running.filter((r) => [r.a, r.b].includes(0) && [r.a, r.b].includes(2)).length, 0, 'their deals are over');
  eq(a.diplomacy.research[2], 0, 'their research agreement too');
});

test('war on an allied city-state ends the alliance: its influence falls, its luxuries and vote are lost', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1 });
  const cs = game.players.find((p) => p.cityState)!;
  const a = game.players[0];
  city(game, 0, at(3, 3));
  city(game, 1, at(12, 3));
  city(game, cs.index, at(7, 8));
  a.influence[cs.index] = 100;
  eq(allyOf(game, cs.index), 0, 'allies');
  ok(apply(game, 0, { t: 'war', target: cs.index, why: null }).ok, 'war declared');
  eq(allyOf(game, cs.index), -1, 'no ally');
  ok(a.influence[cs.index] <= -60, `influence ${a.influence[cs.index]}`);
  // (Even with influence regained somehow, no civ at war with it is its ally.)
  a.influence[cs.index] = 100;
  eq(allyOf(game, cs.index), -1, 'still none while at war');
});

test('a civ gone from the game takes its deals with it: no one goes on paying it', () => {
  const { game } = dealers(['egypt', 'babylon', 'china']);
  const [a, b] = game.players;
  b.gold = 1000;
  b.lastIncome = { gold: 50, science: 0, culture: 0, faith: 0, happiness: 0, tourism: 0 };
  makeDeal(game, { from: 1, to: 0, items: [{ kind: 'goldPerTurn', from: 1, amount: 20 }] });
  game.cities = game.cities.filter((c) => c.owner !== 0);
  endTurn(game);
  ok(!a.alive, 'Egypt is out');
  eq(relationsOf(game).running.length, 0, 'its deal is over');
  eq(dealGold(game, b), 0, 'Babylon pays nothing');
});

test('a deal order with nonsense items is refused, at war as at peace (it once threw)', () => {
  const { game } = dealers();
  for (const items of [[null], [7], ['peace']]) {
    ok(!apply(game, 0, { t: 'deal', target: 1, items: items as never }).ok, `at peace: ${JSON.stringify(items)}`);
  }
  war(game, 0, 1);
  for (const items of [[null], [7], ['peace'], [{ kind: 'peace' }, null]]) {
    ok(!apply(game, 0, { t: 'deal', target: 1, items: items as never }).ok, `at war: ${JSON.stringify(items)}`);
  }
});

test('a spy sent to a city-state this turn can’t stage a coup there until the next', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 2, size: 'small' });
  const [a, b] = game.players;
  city(game, 0, at(3, 3));
  city(game, 1, at(14, 3));
  const homes = game.players.filter((p) => p.cityState).map((cs, i) => city(game, cs.index, at(4 + 6 * i, 10)));
  for (const c of homes) {
    b.influence[c.owner] = 61;
    a.influence[c.owner] = 59;
  }
  a.explored.fill(1);
  const spy = { id: 999, city: null, progress: 0 };
  spiesOf(a).push(spy);
  ok(apply(game, 0, { t: 'spy', spy: 999, target: homes[0].id }).ok, 'sent');
  ok(!apply(game, 0, { t: 'coup', spy: 999 }).ok, 'no coup on arrival');
  game.turn++;
  eq(cannotCoup(game, a, 999), null, 'a turn later, it may');
  // Moved on: it waits again.
  ok(apply(game, 0, { t: 'spy', spy: 999, target: homes[1].id }).ok, 'sent on');
  ok(!!cannotCoup(game, a, 999), 'and waits again');
});

/** A city stormed by `by`'s swordsman (brought to 1 hit point, whoever stood in it gone first). */
function storm(game: Game, by: number, c: { tile: number; hp: number; owner: number }) {
  game.units = game.units.filter((u) => u.tile !== c.tile);
  c.hp = 1;
  const s = unit(game, 'swordsman', by, neighbours(game.grid, c.tile).find((t) => !game.units.some((u) => u.tile === t))!);
  ok(apply(game, by, { t: 'attack', unit: s.id, target: c.tile }).ok && c.owner === by, `taken by ${game.players[by].name}`);
}

test('a city taken from one who took it from its founder can be liberated: back to its founder, who never forgets it', () => {
  const { game, at } = blank(['egypt', 'babylon', 'china'], { size: 'small' });
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  city(game, 2, at(16, 18));
  const town = city(game, 2, at(16, 10), { pop: 6 });
  war(game, 1, 2);
  storm(game, 1, town);
  eq(liberation(game, town), null, 'taken from its founder: nothing to liberate');
  war(game, 0, 1);
  storm(game, 0, town);
  eq(liberation(game, town)?.to, 2, 'taken from Babylon: Egypt may give it back to China');
  ok(/liberate/.test(game.players[0].notes.map((n) => n.text).join(' ')) || game.players[0].bot, 'offered with the choices');
  ok(!apply(game, 1, { t: 'cityChoice', city: town.id, choice: 'liberate' }).ok, 'only its owner decides');
  const before = opinionOf(game, game.players[2], game.players[0]).total;
  ok(apply(game, 0, { t: 'cityChoice', city: town.id, choice: 'liberate' }).ok, 'liberated');
  eq(town.owner, 2, 'China’s again');
  ok(!town.puppet && !town.occupied && !town.resistance, 'its own, not occupied');
  ok(game.tiles.every((t) => t.city !== town.id || t.owner === 2), 'its land with it');
  ok(!game.units.some((u) => u.tile === town.tile && u.owner === 0), 'Egypt’s soldier has stepped out');
  const reasons = opinionOf(game, game.players[2], game.players[0]).reasons;
  ok(reasons.some((r) => r.text === 'You liberated our people' && r.value >= 20), 'China remembers it');
  ok(opinionOf(game, game.players[2], game.players[0]).total >= before + 20, 'and thinks far better of Egypt');
  game.turn += 300;
  diplomacyTurn(game);
  ok(opinionOf(game, game.players[2], game.players[0]).reasons.some((r) => r.text === 'You liberated our people' && r.value > 0), 'for good');
  // Annexed, it's no longer offered.
  const other = city(game, 2, at(10, 14));
  storm(game, 1, other);
  storm(game, 0, other);
  ok(apply(game, 0, { t: 'cityChoice', city: other.id, choice: 'annex' }).ok, 'annexed');
  eq(liberation(game, other), null, 'annexed: not to be liberated');
  ok(!apply(game, 0, { t: 'cityChoice', city: other.id, choice: 'liberate' }).ok, 'and refused');
});

test('liberating a destroyed civ’s capital brings it back to life, at peace, and it counts again for domination', () => {
  const { game, at } = blank(['egypt', 'babylon', 'china'], { size: 'small' });
  game.settings.victories.domination = true;
  city(game, 0, at(3, 3));
  const babylon = city(game, 1, at(28, 3));
  city(game, 1, at(28, 14));
  const beijing = city(game, 2, at(16, 12), { pop: 6 });
  war(game, 1, 2);
  storm(game, 1, beijing);
  ok(!game.players[2].alive, 'China is destroyed');
  war(game, 0, 1);
  storm(game, 0, beijing);
  ok(liberation(game, beijing)?.revive === true, 'it can be brought back');
  remember(game, 'denounce', 1, 2);
  ok(apply(game, 0, { t: 'cityChoice', city: beijing.id, choice: 'liberate' }).ok, 'liberated');
  const china = game.players[2];
  ok(china.alive && beijing.owner === 2 && !!beijing.capital && beijing.buildings.includes('palace'), 'China lives again, Beijing its capital');
  ok(game.units.some((u) => u.owner === 2 && u.tile === beijing.tile), 'with a soldier to hold it');
  ok(!atWar(game, 0, 2) && china.diplomacy.peaceTurns[0] > 0, 'at peace with Egypt, a treaty between them');
  ok(!atWar(game, 1, 2), 'and at war with no one');
  ok(!relationsOf(game).events.some((e) => (e.by === 2 || e.to === 2) && e.kind !== 'liberate'), 'its old quarrels forgotten');
  ok(relationsOf(game).events.some((e) => e.kind === 'liberate' && e.by === 0 && e.to === 2), 'but not its liberation');
  // Egypt takes Babylon's capital: without Beijing, it doesn't hold every original capital.
  storm(game, 0, babylon);
  checkVictory(game);
  ok(!game.over, 'no domination while China holds its own capital');
});

test('a city-state given back its city lives again, and its liberator is its ally', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1, size: 'small' });
  const cs = game.players.find((p) => p.cityState)!;
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  const home = city(game, cs.index, at(16, 12), { pop: 4 });
  war(game, 1, cs.index);
  storm(game, 1, home);
  ok(!cs.alive, 'the city-state is gone');
  war(game, 0, 1);
  storm(game, 0, home);
  game.players[0].influence[cs.index] = -20;
  ok(apply(game, 0, { t: 'cityChoice', city: home.id, choice: 'liberate' }).ok, 'liberated');
  ok(cs.alive && home.owner === cs.index && !!home.capital, 'it lives again');
  eq(game.players[0].influence[cs.index], LIBERATE_INFLUENCE, 'Egypt’s influence from nothing');
  eq(allyOf(game, cs.index), 0, 'Egypt is its ally');
  eq(game.players[1].influence[cs.index] ?? 0, 0, 'Babylon starts afresh with it');
  ok(!atWar(game, 1, cs.index), 'at war with no one');
});

test('a bot liberates a friend’s city it took from their enemy, and keeps a stranger’s', () => {
  const { game, at } = blank(['egypt', 'babylon', 'china', 'india'], { size: 'small' });
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  city(game, 2, at(16, 18));
  city(game, 3, at(3, 18));
  const friendTown = city(game, 2, at(16, 10), { pop: 5 });
  const strangerTown = city(game, 3, at(8, 12), { pop: 5 });
  war(game, 1, 2);
  war(game, 1, 3);
  storm(game, 1, friendTown);
  storm(game, 1, strangerTown);
  war(game, 0, 1);
  storm(game, 0, friendTown);
  storm(game, 0, strangerTown);
  const egypt = game.players[0];
  egypt.diplomacy.friends[2] = game.players[2].diplomacy.friends[0] = 20;
  conquests(makeCtx(game, egypt));
  eq(friendTown.owner, 2, 'the friend’s city given back');
  eq(strangerTown.owner, 0, 'the stranger’s kept');
});

test('a pledge to protect a city-state raises the influence it rests at; others offend the pledger, the pledger itself breaks it', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1, size: 'small' });
  const cs = game.players.find((p) => p.cityState)!;
  const [a, b] = game.players;
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  city(game, cs.index, at(16, 12));
  ok(!!cannotPledge(game, a, cs.index), 'not before meeting it');
  a.explored.fill(1);
  b.explored.fill(1);
  a.influence[cs.index] = -5;
  ok(/trust/.test(cannotPledge(game, a, cs.index) ?? ''), 'nor while it distrusts you');
  a.influence[cs.index] = 35;
  const rest = restingInfluence(game, a, cs.index);
  ok(apply(game, 0, { t: 'pledge', target: cs.index }).ok && pledged(game, 0, cs.index), 'pledged');
  eq(restingInfluence(game, a, cs.index), rest + PLEDGE_REST, 'its influence rests higher');
  ok(!apply(game, 0, { t: 'pledge', target: cs.index }).ok, 'not twice');
  eq(viewFor(game, a, null).players[cs.index].cityState!.pledge.by.join(), '0', 'shown on its card');
  ok(apply(game, 1, { t: 'war', target: cs.index, why: null }).ok, 'Babylon attacks it');
  ok(opinionOf(game, a, b).reasons.some((r) => /protection/.test(r.text) && r.value < 0), 'Egypt is offended');
  ok(pledged(game, 0, cs.index), 'Egypt’s pledge holds');
  a.influence[cs.index] = 35;
  ok(apply(game, 0, { t: 'war', target: cs.index, why: null }).ok, 'Egypt attacks it itself');
  ok(!pledged(game, 0, cs.index), 'its pledge is broken');
  ok(a.influence[cs.index] <= 35 - PLEDGE_BROKEN, 'influence lost');
  endWar(game, a, cs);
  a.influence[cs.index] = 35;
  ok(/lately/.test(cannotPledge(game, a, cs.index) ?? ''), 'and no pledging again for a while');
});

test('a pledge lapses when influence falls below nothing; bots pledge to the city-states they’re friends with', () => {
  const { game, at } = blank(['egypt', 'babylon'], { cityStates: 1, size: 'small' });
  const cs = game.players.find((p) => p.cityState)!;
  const [a, b] = game.players;
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  city(game, cs.index, at(16, 12));
  a.explored.fill(1);
  b.explored.fill(1);
  a.influence[cs.index] = 10;
  ok(apply(game, 0, { t: 'pledge', target: cs.index }).ok, 'pledged');
  a.influence[cs.index] = -10;
  endTurn(game);
  ok(!pledged(game, 0, cs.index), 'lapsed');
  b.influence[cs.index] = 40;
  botPledges(makeCtx(game, b));
  ok(pledged(game, 1, cs.index), 'Babylon, its friend, pledges');
});

test('a World Congress project: proposed once its tech is known, opened when passed, built from every civ’s cities (never bought), rewarded by what each put in', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india']);
  const [egypt, babylon, india] = game.players;
  const homes = [egypt, babylon, india].map((p, i) => city(game, p.index, at(3 + i * 8, 4), { pop: 6 }));
  for (const p of game.players) p.bot = false;
  egypt.met = [1, 2];
  game.congress = { host: 0, next: game.turn, proposals: [], active: [] };
  ok(!!cannotPropose(game, egypt, { kind: 'worlds_fair' }), 'not before anyone knows Industrialization');
  techsTo(game, 1, TECHS.industrialization.col);
  ok(!!cannotPropose(game, egypt, { kind: 'worlds_fair', repeal: true }), 'never repealed');
  eq(proposeResolution(game, egypt, { kind: 'worlds_fair' }), null, 'once Babylon knows it, Egypt proposes it');
  endTurn(game);
  const x = game.congress.projects?.[0] as WorldProject;
  ok(!!x && !x.done, 'passed, it opens');
  eq(game.congress.active.length, 0, 'not a resolution in force');
  eq(x.cost, Math.floor(300 * 3 * 0.67), 'its cost so much for each civ (at speed)');
  const item = { kind: 'project' as const, id: 'worlds_fair' };
  egypt.gold = 5000;
  ok(!apply(game, 0, { t: 'buy', city: homes[0].id, item, with: 'gold' }).ok, 'it can’t be bought');
  ok(cityInfo(game, egypt, homes[0]).options.some((o) => o.id === 'worlds_fair' && o.buy === null), 'it’s in the build list');
  homes.forEach((c, i) => ok(apply(game, i, { t: 'produce', city: c.id, item }).ok, 'each city builds it'));
  const prod = productionToward(game, homes[0], item);
  endTurn(game);
  eq(x.put[0], prod, 'Egypt’s production went into its share');
  eq(homes[0].prod, 0, 'none kept in the city');
  const seen = viewFor(game, egypt, null).congress!.projects[0];
  eq(seen.shares.find((s) => s.player === 0)?.put, Math.floor(x.put[0]), 'the Congress shows each civ’s share');
  // Egypt the most, Babylon next, India a twentieth: gold, silver, bronze.
  x.put = { 0: 400, 1: 160, 2: Math.ceil(x.cost / 20) };
  const culture = [egypt, babylon, india].map((p) => ({ had: p.culture, policy: policyCost(game, p) }));
  endTurn(game);
  ok(!!x.done, 'done once the total reaches its cost');
  eq(`${x.tiers?.[0]} ${x.tiers?.[1]} ${x.tiers?.[2]}`, 'gold silver bronze', 'tiers by what each put in');
  ok(egypt.culture - culture[0].had >= culture[0].policy, 'gold: a free social policy');
  ok(babylon.culture - culture[1].had >= culture[1].policy / 2, 'silver: half of one');
  ok(india.culture - culture[2].had >= culture[2].policy / 4, 'bronze: a quarter');
  ok(egypt.notes.some((n) => n.text.startsWith('Gold at the World')), 'and each is told');
  ok(homes.every((c) => !c.queue.some((q) => q.id === 'worlds_fair')), 'its cities move on');
  ok(!apply(game, 0, { t: 'produce', city: homes[0].id, item }).ok, 'nor can it be built again');
  ok(!!cannotPropose(game, egypt, { kind: 'worlds_fair' }), 'nor proposed again');
});

test('a World Congress project’s lasting rewards: the Games’ happiness and tourism, the Space Station’s faster spaceship parts (not toward the projects themselves)', () => {
  const { game, at } = blank();
  const [egypt] = game.players;
  const c = city(game, 0, at(4, 4), { pop: 6 });
  city(game, 1, at(16, 6));
  game.congress = { host: 0, next: game.turn + 30, proposals: [], active: [] };
  const mood = happiness(game, egypt, []);
  const part = productionToward(game, c, { kind: 'project', id: 'ss_booster' }, undefined, 100);
  game.congress.projects = [
    { id: 'international_games', since: 1, cost: 100, put: { 0: 100 }, done: 2, tiers: { 0: 'gold' } },
    { id: 'space_station', since: 1, cost: 100, put: { 0: 100 }, done: 2, tiers: { 0: 'gold' } },
  ];
  eq(happiness(game, egypt, []), mood + 4, 'the Games’ gold: +4 happiness in the capital');
  eq(cityEffects(game, c).reduce((s, e) => s + (e.tourismPercent ?? 0), 0), 25, 'and a quarter more tourism');
  eq(productionToward(game, c, { kind: 'project', id: 'ss_booster' }, undefined, 100), part + 25, 'the Station’s gold: spaceship parts 25% faster');
  startProject(game, 'worlds_fair');
  eq(productionToward(game, c, { kind: 'project', id: 'worlds_fair' }, undefined, 100), 100, 'but not a project of the Congress’s');
});

test('a bot proposes a World Congress project it would win, votes for it, and puts a city it can spare into it', () => {
  const { game, at } = blank();
  const [egypt, bot] = game.players;
  city(game, 0, at(4, 6));
  const home = city(game, 1, at(16, 6), { pop: 10 });
  const other = city(game, 1, at(16, 12), { pop: 8 });
  techsTo(game, 1, TECHS.industrialization.col);
  game.congress = { host: 1, next: game.turn + 30, proposals: [], active: [] };
  bot.ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {} };
  eq(expectedTier(game, bot, 'worlds_fair'), 'gold', 'the stronger cities: it expects gold');
  eq(expectedTier(game, egypt, 'worlds_fair'), 'silver', 'and Egypt silver');
  eq(congressProposal(game, bot)?.kind, 'worlds_fair', 'it proposes the World’s Fair');
  eq(congressVote(game, bot, { id: 1, by: 0, kind: 'worlds_fair', votes: {} }), 'yes', 'and votes for it, whoever proposed it');
  startProject(game, 'worlds_fair');
  ok(worldProject(makeCtx(game, bot), home, 0.5) === null, 'not a city in danger');
  eq(worldProject(makeCtx(game, bot), home, 0)?.id, 'worlds_fair', 'a city it can spare builds it');
  home.queue = [{ kind: 'project', id: 'worlds_fair' }];
  eq(worldProject(makeCtx(game, bot), other, 0), null, 'its share of cities (one, of two) on it already');
});

/** Players by index made people (a test world's are all bots). */
function people(game: Game, ...who: number[]) {
  for (const i of who) game.players[i].bot = false;
}

test('people at war with each other take their turns one side at a time; everyone else, and the bots, as before', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india', 'persia'], { size: 'small' });
  people(game, 0, 1, 2);
  for (const [i, col] of [[0, 3], [1, 12], [2, 3], [3, 12]]) city(game, i, at(col, i < 2 ? 3 : 12));
  const [a, b, c, d] = [0, 1, 2, 3].map((i) => unit(game, 'warrior', i, at([5, 10, 5, 10][i], i < 2 ? 5 : 14)));
  endTurn(game);
  eq(game.sequence, undefined, 'at peace: everyone plays at once');
  war(game, 0, 1);
  war(game, 2, 3);
  endTurn(game);
  eq(JSON.stringify(game.sequence?.sides.flat().sort()), '[0,1]', 'Egypt and Babylon (people at war) are put in order; India’s war is with a bot');
  const [first, second] = game.sequence!.sides.map((s) => s[0]);
  const mover = first === 0 ? a : b;
  const waiter = first === 0 ? b : a;
  ok(apply(game, first, { t: 'move', unit: mover.id, to: neighbours(game.grid, mover.tile)[0] }).ok, 'the side playing moves');
  const refused = apply(game, second, { t: 'move', unit: waiter.id, to: neighbours(game.grid, waiter.tile)[0] });
  ok(!refused.ok && /finish their turn/.test(refused.error ?? ''), `the other waits: ${refused.error}`);
  ok(apply(game, second, { t: 'research', tech: 'pottery' }).ok, 'its research is still its own meanwhile');
  ok(!apply(game, second, { t: 'ready', ready: true }).ok, 'nor can it end a turn it hasn’t had');
  ok(apply(game, 2, { t: 'move', unit: c.id, to: neighbours(game.grid, c.tile)[0] }).ok, 'India, at war with no person, plays at once');
  ok(apply(game, 3, { t: 'move', unit: d.id, to: neighbours(game.grid, d.tile)[0] }).ok, 'and so does the bot');
  ok(!advanceSequence(game, () => false), 'the turn isn’t handed on before the side playing is done');
  ok(apply(game, first, { t: 'ready', ready: true }).ok, 'it ends its turn');
  ok(advanceSequence(game, () => false), 'and it is handed on');
  eq(activeSide(game)?.[0], second, 'to the other side');
  eq(waitingOn(game, first)?.[0], second, 'the first now waits in its turn');
  ok(!apply(game, first, { t: 'move', unit: mover.id, to: mover.tile }).ok, 'and gives its units no more orders this turn');
  ok(apply(game, second, { t: 'move', unit: waiter.id, to: neighbours(game.grid, waiter.tile)[0] }).ok, 'the second side moves now');
  ok(advanceSequence(game, () => false, true), 'its clock run out: handed on all the same');
  ok(sequenceDone(game), 'every side has played');
  endTurn(game);
  eq(game.sequence?.sides[0][0], second, 'the next turn, the order turns round: the other side first');
});

test('a war declared between people during a turn: the side that declared plays on, the other waits its segment', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  people(game, 0, 1);
  city(game, 0, at(3, 3));
  city(game, 1, at(12, 3));
  const b = unit(game, 'warrior', 1, at(10, 5));
  endTurn(game);
  game.players[1].ready = true;
  ok(apply(game, 0, { t: 'war', target: 1 }).ok, 'Egypt declares war');
  eq(JSON.stringify(game.sequence?.sides), '[[0],[1]]', 'Egypt plays first, Babylon after');
  ok(!game.players[1].ready, 'Babylon’s turn, ended before the war, is its own to play again');
  ok(!apply(game, 1, { t: 'move', unit: b.id, to: neighbours(game.grid, b.tile)[0] }).ok, 'meanwhile it waits');
  game.players[0].ready = true;
  ok(advanceSequence(game, () => false) && apply(game, 1, { t: 'move', unit: b.id, to: neighbours(game.grid, b.tile)[0] }).ok, 'then it plays');
});

test('teammates at war with people play their segment together; a side gone, or fallen, is passed over', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india']);
  people(game, 0, 1, 2);
  game.players[0].team = game.players[2].team = 0;
  game.players[1].team = 1;
  bindTeams(game);
  for (const [i, col] of [[0, 3], [1, 12], [2, 3]]) city(game, i, at(col, i === 2 ? 12 : 3));
  war(game, 0, 1);
  war(game, 2, 1);
  game.turn = 0;
  startSequence(game);
  eq(JSON.stringify(game.sequence?.sides), '[[0,2],[1]]', 'Egypt and India together, then Babylon');
  game.players[0].ready = true;
  ok(!advanceSequence(game, () => false), 'one of a side done isn’t enough');
  ok(advanceSequence(game, (i) => i === 2), 'its other gone from the game: the side is done');
  ok(advanceSequence(game, (i) => i === 1), 'Babylon gone: passed over');
  ok(sequenceDone(game), 'and the turn can end');
  game.turn = 1;
  game.players[1].alive = false;
  startSequence(game);
  eq(game.sequence, undefined, 'its enemy fallen: no order to keep');
  game.players[1].alive = true;
  game.settings.hybridTurns = false;
  startSequence(game);
  eq(game.sequence, undefined, 'turned off in the lobby: everyone plays at once, war or not');
});

// -------------------------------------------------------------------------------------------------
// Nuclear fallout
// -------------------------------------------------------------------------------------------------

test('fallout: a nuclear blast leaves it on a share of its land, burns its forests, and spares cities and the land beyond', () => {
  const { game, at } = blank();
  techsTo(game, 0, 15);
  const home = city(game, 0, at(3, 5), { buildings: ['manhattan_project'] });
  const theirs = city(game, 1, at(12, 5));
  const area = within(game.grid, theirs.tile, 2);
  for (const t of area) if (t !== theirs.tile) game.tiles[t].owner = 1;
  const wood = area.filter((t) => t !== theirs.tile).slice(0, 6);
  for (const t of wood) game.tiles[t].feature = 'forest';
  const oasis = area.find((t) => t !== theirs.tile && !wood.includes(t))!;
  game.tiles[oasis].feature = 'oasis';
  const missile = unit(game, 'nuclear_missile', 0, home.tile);
  war(game, 0, 1);
  ok(apply(game, 0, { t: 'attack', unit: missile.id, target: theirs.tile }).ok, 'the strike');
  const fallen = area.filter((t) => game.tiles[t].feature === 'fallout');
  ok(fallen.length > 0 && fallen.length < area.length - 2, `fallout on some of the blast's land, not all (${fallen.length} of ${area.length})`);
  ok(game.tiles[theirs.tile].feature !== 'fallout', 'none on the city');
  eq(game.tiles[oasis].feature, 'oasis', 'an oasis keeps it off');
  ok(wood.every((t) => game.tiles[t].feature !== 'forest'), 'the forests burnt away');
  ok(game.tiles.every((tile, t) => tile.feature !== 'fallout' || area.includes(t)), 'none beyond the blast');
});

test('fallout: its tile yields next to nothing, nothing is built or mended under it, and it hurts units that end a turn there', () => {
  const { game, at } = blank();
  const p = game.players[0];
  techsTo(game, 0, 6);
  city(game, 0, at(5, 5));
  const t = at(6, 5);
  game.tiles[t].owner = 0;
  eq(tileYields(game, t, p).food, 2, 'grassland: 2 food');
  Object.assign(game.tiles[t], { feature: 'fallout', improvement: 'farm', pillaged: true, river: true });
  const y = tileYields(game, t, p);
  eq((y.food ?? 0) + (y.prod ?? 0) + (y.gold ?? 0), 0, 'under fallout: no food, production or gold (a river’s gold too)');
  game.tiles[t].pillaged = false;
  ok((tileYields(game, t, p).food ?? 0) <= 1, 'next to nothing even with its farm standing (Civ V’s -3 food)');
  const w = unit(game, 'worker', 0, t);
  ok(!canBuild(game, w, 'repair'), 'no repairing under it');
  game.tiles[t].improvement = undefined;
  ok(!canBuild(game, w, 'farm') && !canBuild(game, w, 'trading_post'), 'nor improving');
  ok(canBuild(game, w, 'road'), 'a road, though');
  ok(canBuild(game, w, 'scrub_fallout'), 'and scrubbing it');
  ok(!canBuild(game, { ...w, tile: at(7, 5) }, 'scrub_fallout'), 'no scrubbing where there is none');
  const soldier = unit(game, 'warrior', 0, t);
  endTurn(game);
  eq(soldier.hp, 85, 'a unit on it loses 15 hit points at the turn’s end');
  // (One that moved this turn, so it doesn't heal first.)
  soldier.hp = 10;
  soldier.moves = 0;
  endTurn(game);
  ok(!game.units.includes(soldier), 'and dies of it, weak enough');
});

test('fallout: a worker scrubs it away in its turns, and the tile yields again', () => {
  const { game, at } = blank();
  const p = game.players[0];
  techsTo(game, 0, 6);
  city(game, 0, at(5, 5));
  const t = at(6, 5);
  Object.assign(game.tiles[t], { owner: 0, feature: 'fallout' });
  const w = unit(game, 'worker', 0, t);
  ok(apply(game, 0, { t: 'build', unit: w.id, what: 'scrub_fallout' }).ok, 'set to scrubbing');
  const turns = workTurns(game, 'scrub_fallout');
  ok(turns > 1, `it takes turns (${turns})`);
  for (let i = 0; i < turns - 1; i++) endTurn(game);
  eq(game.tiles[t].feature, 'fallout', 'still there a turn short');
  endTurn(game);
  eq(game.tiles[t].feature, undefined, 'gone');
  ok(game.units.includes(w), 'the worker lived through it');
  eq(tileYields(game, t, p).food, 2, 'its food back');
  ok(canBuild(game, w, 'farm'), 'and it can be farmed');
});

test('fallout: a bot’s worker scrubs its own land first, and the advisor recommends it', () => {
  const { game, at } = blank();
  const me = game.players[0];
  techsTo(game, 0, 4);
  const home = city(game, 0, at(5, 5), { pop: 3 });
  const t = neighbours(game.grid, home.tile)[0];
  game.tiles[t].feature = 'fallout';
  const worker = unit(game, 'worker', 0, t);
  workers(makeCtx(game, me), [worker]);
  eq(worker.work?.what, 'scrub_fallout', 'the bot’s worker sets to scrubbing');
  worker.work = undefined;
  me.bot = false;
  const advice = adviseWork(game, me, worker);
  eq(advice.tips[0]?.what, 'scrub_fallout', 'the advisor’s first tip');
  eq(advice.tips[0]?.tile, t, 'on the fallout');
  ok((advice.tips[0]?.gain.food ?? 0) > 0, 'its food back, it says');
});

test('a bot brings back a fallen civ with a city it took from their common enemy; a conqueror keeps the original capital, but gives back a lesser city', () => {
  for (const aim of ['science', 'domination'] as const) {
    const { game, at } = blank(['egypt', 'babylon', 'china'], { size: 'small' });
    city(game, 0, at(3, 3));
    city(game, 1, at(28, 3));
    const beijing = city(game, 2, at(16, 12), { pop: 5 });
    const town = city(game, 2, at(10, 16), { pop: 4 });
    war(game, 1, 2);
    storm(game, 1, town);
    storm(game, 1, beijing);
    ok(!game.players[2].alive, 'China is destroyed');
    war(game, 0, 1);
    storm(game, 0, beijing);
    storm(game, 0, town);
    const egypt = game.players[0];
    egypt.ai = { aim, aimed: game.turn, wars: {}, orders: {} };
    conquests(makeCtx(game, egypt));
    ok(game.players[2].alive, `${aim}: China lives again`);
    if (aim === 'science') eq(beijing.owner, 2, 'science: Beijing given back, against Babylon');
    else {
      eq(beijing.owner, 0, 'domination: Beijing, an original capital, kept');
      eq(town.owner, 2, 'domination: the lesser city given back');
    }
    ok(relationsOf(game).events.some((e) => e.kind === 'liberate' && e.by === 0 && e.to === 2), 'China remembers it');
  }
});

test('a bot gives a city-state back its small city, and a friend’s city it took back from their enemy is one it would go to war to free', () => {
  const { game, at } = blank(['egypt', 'babylon', 'china'], { cityStates: 1, size: 'small' });
  const cs = game.players.find((p) => p.cityState)!;
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  city(game, 2, at(16, 18));
  const home = city(game, cs.index, at(16, 9), { pop: 3 });
  const town = city(game, 2, at(22, 12), { pop: 4 });
  war(game, 1, cs.index);
  war(game, 1, 2);
  storm(game, 1, home);
  storm(game, 1, town);
  const egypt = game.players[0];
  egypt.ai = { aim: 'science', aimed: game.turn, wars: {}, orders: {} };
  ok(!freeable(makeCtx(game, egypt), town), 'a stranger’s city: nothing to free');
  egypt.diplomacy.friends[2] = game.players[2].diplomacy.friends[0] = 20;
  ok(freeable(makeCtx(game, egypt), town), 'a friend’s, held by Babylon: one to free');
  war(game, 0, 1);
  storm(game, 0, home);
  conquests(makeCtx(game, egypt));
  ok(cs.alive && home.owner === cs.index, 'the city-state lives again');
  eq(allyOf(game, cs.index), 0, 'Egypt its ally');
});

test('a warmonger whose interests change breaks its pledge to a city-state, and pays for it; a peaceful leader keeps it', () => {
  for (const civ of ['china', 'india']) {
    const { game, at } = blank([civ, 'babylon'], { cityStates: 1 });
    const p = game.players[0];
    const cs = game.players.find((x) => x.cityState)!;
    city(game, 0, at(4, 4));
    const home = city(game, cs.index, at(14, 9));
    p.explored.fill(1);
    p.influence[cs.index] = 35;
    ok(apply(game, 0, { t: 'pledge', target: cs.index }).ok, `${civ} pledges`);
    p.ai = { aim: 'science', aimed: game.turn, wars: {}, orders: {} };
    for (const t of neighbours(game.grid, home.tile).slice(0, 3)) unit(game, 'swordsman', 0, t);
    eq(forsakes(makeCtx(game, p), cs.index), null, 'still its friend: the pledge holds');
    // Its influence there has waned, and it's short of gold: the city-state's tribute is wanted.
    p.influence[cs.index] = 10;
    p.gold = 0;
    const why = forsakes(makeCtx(game, p), cs.index);
    civilians(makeCtx(game, p));
    if (civ === 'india') {
      eq(why, null, 'Gandhi never breaks his word');
      ok(pledged(game, 0, cs.index), 'his pledge holds');
      continue;
    }
    ok(!!why, `Wu Zetian would break it (${why})`);
    ok(!pledged(game, 0, cs.index), 'she demands its tribute: the pledge is broken');
    ok(p.gold > 0, 'its gold taken');
    ok(p.influence[cs.index] <= 10 - PLEDGE_BROKEN - TRIBUTE_COST.gold, 'the influence lost, the pledge’s with the tribute’s');
    p.influence[cs.index] = 35;
    ok(/lately/.test(cannotPledge(game, p, cs.index) ?? ''), 'and no pledging again for a while');
  }
});

test('a pledged city-state allied with a bot’s enemy, or at war with its friend, is forsaken; a warmonger pledges only to its allies', () => {
  const { game, at } = blank(['aztec', 'babylon', 'egypt'], { cityStates: 1, size: 'small' });
  const [aztec, babylon, egypt] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  city(game, 0, at(3, 3));
  city(game, 1, at(28, 3));
  city(game, 2, at(3, 18));
  city(game, cs.index, at(16, 10));
  for (const p of [aztec, babylon, egypt]) p.explored.fill(1);
  aztec.ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {} };
  aztec.influence[cs.index] = 40;
  botPledges(makeCtx(game, aztec));
  ok(!pledged(game, 0, cs.index), 'a friend only: Montezuma doesn’t pledge');
  aztec.influence[cs.index] = 70;
  botPledges(makeCtx(game, aztec));
  ok(pledged(game, 0, cs.index), 'its ally: he pledges');
  eq(forsakes(makeCtx(game, aztec), cs.index), null, 'and keeps it while it serves him');
  // Babylon courts it away and goes to war with him.
  babylon.influence[cs.index] = 90;
  war(game, 0, 1);
  ok(/enemy/.test(forsakes(makeCtx(game, aztec), cs.index) ?? ''), 'allied with his enemy: forsaken');
  endWar(game, aztec, babylon);
  babylon.influence[cs.index] = 0;
  aztec.diplomacy.friends[2] = egypt.diplomacy.friends[0] = 20;
  war(game, 2, cs.index);
  ok(/friend/.test(forsakes(makeCtx(game, aztec), cs.index) ?? ''), 'at war with his friend: forsaken');
});

test('a bot goes for the tier of a World Congress project worth its cities: one city for bronze while it lacks it, moved on once it has it', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india'], { size: 'small' });
  const [egypt] = game.players;
  const homes = [0, 1, 2].map((i) => city(game, i, at(4 + i * 9, 4), { pop: 8 }));
  const towns = [city(game, 0, at(4, 12), { pop: 6 }), city(game, 0, at(10, 16), { pop: 6 })];
  game.congress = { host: 0, next: game.turn + 30, proposals: [], active: [] };
  startProject(game, 'worlds_fair');
  const x = openProject(game, 'worlds_fair')!;
  // Babylon and India far ahead, their capitals building it: gold and silver are theirs.
  x.put = { 1: Math.round(x.cost * 0.35), 2: Math.round(x.cost * 0.3) };
  for (const c of homes.slice(1)) c.queue = [{ kind: 'project', id: 'worlds_fair' }];
  egypt.ai = { aim: 'science', aimed: game.turn, wars: {}, orders: {} };
  let plan = projectPlan(makeCtx(game, egypt), 'worlds_fair');
  eq(plan.tier, 'bronze', 'bronze is what it can reach');
  eq(plan.cities.length, 1, 'one city for it');
  const chosen = plan.cities[0];
  eq(worldProject(makeCtx(game, egypt), chosen, 0)?.id, 'worlds_fair', 'that city builds it');
  ok([homes[0], ...towns].filter((c) => c !== chosen).every((c) => worldProject(makeCtx(game, egypt), c, 0) === null), 'the others don’t');
  chosen.queue = [{ kind: 'project', id: 'worlds_fair' }];
  ok(!leavesProject(makeCtx(game, egypt), chosen), 'it stays on it till it has its bronze');
  x.put[0] = Math.ceil(x.cost / 20) + 5;
  plan = projectPlan(makeCtx(game, egypt), 'worlds_fair');
  eq(`${plan.tier} ${plan.cities.length}`, 'bronze 0', 'its bronze had: no more cities on it');
  ok(leavesProject(makeCtx(game, egypt), chosen), 'the city moves on');
  // Ahead of the others, it goes for gold with more of its cities.
  x.put = { 0: Math.round(x.cost * 0.3), 1: Math.round(x.cost * 0.1), 2: Math.round(x.cost * 0.1) };
  plan = projectPlan(makeCtx(game, egypt), 'worlds_fair');
  eq(plan.tier, 'gold', 'gold in reach');
  ok(plan.cities.length >= 1, 'cities on it for gold');
  // The others have stopped: no reward till it's done, so it carries it to the end itself.
  for (const c of homes.slice(1)) c.queue = [];
  chosen.queue = [{ kind: 'project', id: 'worlds_fair' }];
  plan = projectPlan(makeCtx(game, egypt), 'worlds_fair');
  ok(plan.tier === 'gold' && plan.cities.length >= 1, 'the others stopped: it finishes it itself');
});

test('a warmonger at war with the ally of a city-state it pledged to protect, close by, turns on it: war, the pledge broken, kept up while its ally fights on', () => {
  const { game, at } = blank(['china', 'babylon', 'egypt'], { cityStates: 1, size: 'small' });
  const [china, babylon] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  city(game, 0, at(6, 6));
  city(game, 1, at(28, 3));
  city(game, 2, at(3, 18));
  city(game, cs.index, at(11, 8));
  china.explored.fill(1);
  china.ai = { aim: 'science', aimed: game.turn, wars: {}, orders: {} };
  china.influence[cs.index] = 35;
  ok(apply(game, 0, { t: 'pledge', target: cs.index }).ok, 'China pledges');
  turnsOn(makeCtx(game, china));
  ok(pledged(game, 0, cs.index) && !atWar(game, 0, cs.index), 'at peace with everyone: it keeps its pledge');
  babylon.influence[cs.index] = 90;
  war(game, 0, 1);
  turnsOn(makeCtx(game, china));
  ok(atWar(game, 0, cs.index), 'Babylon’s ally, at war with it: China declares war');
  ok(!pledged(game, 0, cs.index), 'its pledge broken');
  ok(!wantsPeace(makeCtx(game, china), cs.index), 'no peace while its ally fights on');
  endWar(game, china, babylon);
  ok(wantsPeace(makeCtx(game, china), cs.index), 'then peace');
});

// -------------------------------------------------------------------------------------------------
// Nuclear weapons: the world's memory, and the bots'
// -------------------------------------------------------------------------------------------------

test('a nuclear strike is remembered: by the civ it fell on most, its friends next, everyone who knew the striker, city-states too; and it fades slowly', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india', 'korea'], { cityStates: 1, size: 'small' });
  const [egypt, babylon, india, korea] = game.players;
  const cs = game.players.find((x) => x.cityState)!;
  techsTo(game, 0, 15);
  const home = city(game, 0, at(4, 5), { buildings: ['manhattan_project'] });
  const theirs = city(game, 1, at(14, 5), { pop: 8 });
  city(game, 2, at(4, 18));
  city(game, 3, at(30, 18));
  city(game, cs.index, at(20, 14));
  const missile = unit(game, 'nuclear_missile', 0, home.tile);
  // (Who has met whom, set after the last look round.)
  egypt.met = [1, 2, cs.index];
  babylon.met = india.met = cs.met = [0];
  korea.met = [];
  // India is Babylon's friend; Korea has never met Egypt.
  india.diplomacy.friends[1] = babylon.diplomacy.friends[2] = 30;
  egypt.influence[cs.index] = 20;
  egypt.bot = false;
  war(game, 0, 1);
  const before = { babylon: opinionOf(game, babylon, egypt).total, india: opinionOf(game, india, egypt).total, korea: opinionOf(game, korea, egypt).total };
  ok(apply(game, 0, { t: 'attack', unit: missile.id, target: theirs.tile }).ok, 'the strike');
  const events = relationsOf(game).events;
  ok(events.some((e) => e.kind === 'nuke' && e.by === 0 && e.to === 1), 'Babylon remembers it fell on them');
  ok(events.some((e) => e.kind === 'nukeSeen' && e.by === 0 && e.to === 2), 'India remembers it');
  ok(!events.some((e) => e.by === 0 && e.to === 3), 'Korea, who never met Egypt, has nothing to remember');
  const reason = (a: number, text: string) => opinionOf(game, game.players[a], egypt).reasons.find((r) => r.text === text)?.value ?? 0;
  ok(reason(1, 'You used nuclear weapons on us') <= -25, `Babylon: on us (${reason(1, 'You used nuclear weapons on us')})`);
  ok(reason(2, 'You used nuclear weapons on our friends') < 0, 'India: on our friends');
  ok(reason(2, 'You have used nuclear weapons') < 0, 'India: used them at all');
  const drop = { babylon: before.babylon - opinionOf(game, babylon, egypt).total, india: before.india - opinionOf(game, india, egypt).total, korea: before.korea - opinionOf(game, korea, egypt).total };
  ok(drop.babylon > drop.india && drop.india > 10, `Babylon thinks worst of it, then India (${drop.babylon}, ${drop.india})`);
  eq(drop.korea, 0, 'Korea is unmoved');
  eq(egypt.influence[cs.index], 20 - NUKE_INFLUENCE, 'the city-state thinks less of Egypt');
  ok(egypt.notes.some((n) => n.text.includes('nuclear weapon')), 'the striker is told the world will remember');
  // Slow to fade: still felt a hundred turns on, past the memory of a war declared.
  const fresh = reason(2, 'You have used nuclear weapons');
  game.turn += 100;
  diplomacyTurn(game);
  const later = reason(2, 'You have used nuclear weapons');
  ok(later < 0 && later > fresh, `fading, but still felt a hundred turns on (${fresh} then ${later})`);
  ok(relationsOf(game).events.some((e) => e.kind === 'nukeSeen'), 'not forgotten yet');
});

test('a world note when a nuclear weapon is used, to every person', () => {
  const { game, at } = blank(['egypt', 'babylon', 'india'], { size: 'small' });
  const [egypt, babylon, india] = game.players;
  for (const p of game.players) p.bot = false;
  techsTo(game, 0, 15);
  const home = city(game, 0, at(4, 5), { buildings: ['manhattan_project'] });
  const theirs = city(game, 1, at(14, 5));
  city(game, 2, at(4, 18));
  india.met = [0, 1];
  war(game, 0, 1);
  const bomb = unit(game, 'atomic_bomb', 0, home.tile);
  ok(apply(game, 0, { t: 'attack', unit: bomb.id, target: theirs.tile }).ok, 'the strike');
  ok(india.notes.some((n) => n.text === `${egypt.name} has used a nuclear weapon on ${babylon.name}!`), 'India hears of it');
  ok(babylon.notes.some((n) => n.text.includes('used a nuclear weapon on you')), 'Babylon too');
});

test('an Atomic Bomb (not a missile) may be shot down by a fighter on patrol or an anti-aircraft gun near its target', () => {
  ok(bombInterceptChance(65) > 0.4 && bombInterceptChance(1000) <= 0.75, 'a fair chance, never certain');
  let downed = 0;
  let missilesDowned = 0;
  for (let i = 0; i < 30; i++) {
    const { game, at } = blank();
    techsTo(game, 0, 15);
    techsTo(game, 1, 15);
    game.rng = 1000 + i * 7919;
    const home = city(game, 0, at(3, 5), { buildings: ['manhattan_project'] });
    const theirs = city(game, 1, at(12, 5), { pop: 8 });
    unit(game, 'mobile_sam', 1, neighbours(game.grid, theirs.tile)[0]);
    war(game, 0, 1);
    const bomb = unit(game, i % 2 ? 'nuclear_missile' : 'atomic_bomb', 0, home.tile);
    ok(apply(game, 0, { t: 'attack', unit: bomb.id, target: theirs.tile }).ok, 'the strike is made');
    ok(!game.units.includes(bomb), 'spent either way');
    if (theirs.pop === 8) (i % 2 ? missilesDowned++ : downed++);
  }
  ok(downed > 0 && downed < 15, `some bombs downed (${downed} of 15)`);
  eq(missilesDowned, 0, 'no missile downed');
});

test('a bot at war with the tech and Uranium raises the Manhattan Project and keeps a small stockpile; a peaceful one, only when losing badly', () => {
  const { game, at } = blank(['aztec', 'babylon']);
  const [aztec] = game.players;
  techsTo(game, 0, 15);
  const home = city(game, 0, at(3, 5), { pop: 10 });
  city(game, 1, at(20, 5));
  Object.assign(game.tiles[at(4, 5)], { resource: 'uranium', amount: 4, improvement: 'mine', owner: 0 });
  aztec.ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {} };
  eq(nukesWanted(makeCtx(game, aztec)), 0, 'at peace: none');
  war(game, 0, 1);
  const want = nukesWanted(makeCtx(game, aztec));
  ok(want >= 2 && want <= 4, `at war, a warmonger aiming to conquer wants a few (${want})`);
  home.buildings.push('manhattan_project');
  eq(nukeProduction(makeCtx(game, aztec), home)?.id, 'nuclear_missile', 'it builds a missile');
  for (let i = 0; i < want; i++) unit(game, 'nuclear_missile', 0, home.tile);
  eq(nukeProduction(makeCtx(game, aztec), home), null, 'its stockpile full: no more');
  const g2 = blank(['india', 'babylon']);
  techsTo(g2.game, 0, 15);
  city(g2.game, 0, g2.at(3, 5), { pop: 10, buildings: ['manhattan_project'] });
  city(g2.game, 1, g2.at(20, 5));
  Object.assign(g2.game.tiles[g2.at(4, 5)], { resource: 'uranium', amount: 4, improvement: 'mine', owner: 0 });
  war(g2.game, 0, 1);
  unit(g2.game, 'infantry', 0, g2.at(3, 5));
  eq(nukesWanted(makeCtx(g2.game, g2.game.players[0])), 0, 'Gandhi, holding his own: none');
  for (let i = 0; i < 4; i++) unit(g2.game, 'mechanized_infantry', 1, g2.at(20, 5 + (i % 2)));
  ok(nukesWanted(makeCtx(g2.game, g2.game.players[0])) >= 1, 'Gandhi, losing badly: one');
});

test('a bot fires a nuclear weapon at a worthwhile target (a city ringed by an army), not an unworthy one, nor where its own or a neutral civ would be hit', () => {
  const setup = (guards: number) => {
    const { game, at } = blank(['aztec', 'babylon', 'india']);
    const [aztec] = game.players;
    techsTo(game, 0, 15);
    const home = city(game, 0, at(3, 5), { buildings: ['manhattan_project'] });
    const theirs = city(game, 1, at(14, 5), { pop: 10 });
    city(game, 2, at(14, 16));
    aztec.ai = { aim: 'domination', aimed: game.turn, wars: {}, orders: {} };
    war(game, 0, 1);
    const ring = [theirs.tile, ...neighbours(game.grid, theirs.tile)];
    for (let i = 0; i < guards; i++) unit(game, 'infantry', 1, ring[i]);
    // (An army of its own: it isn't losing.)
    for (const t of neighbours(game.grid, home.tile).slice(0, 4)) unit(game, 'infantry', 0, t);
    const missile = unit(game, 'nuclear_missile', 0, home.tile);
    aztec.visible.fill(1);
    aztec.explored.fill(1);
    return { game, at, aztec, missile, theirs, ring };
  };
  // Worth it: a city of ten ringed by five infantry.
  let w = setup(5);
  ok(bestNukeStrike(makeCtx(w.game, w.aztec), w.missile) !== null, 'a strike worth making');
  fireNukes(makeCtx(w.game, w.aztec));
  ok(!w.game.units.includes(w.missile), 'it fires');
  eq(w.theirs.pop, 5, 'the city halved');
  // Not worth it: the city with one soldier.
  w = setup(1);
  fireNukes(makeCtx(w.game, w.aztec));
  ok(w.game.units.includes(w.missile), 'one soldier: not worth the world’s anger');
  eq(w.theirs.pop, 10, 'the city untouched');
  // Its own unit in the blast: no.
  w = setup(5);
  const own = unit(w.game, 'infantry', 0, w.ring[6]);
  w.aztec.visible.fill(1);
  eq(strikeWorth(makeCtx(w.game, w.aztec), w.missile, w.theirs.tile), null, 'its own soldier would burn');
  fireNukes(makeCtx(w.game, w.aztec));
  ok(w.game.units.includes(w.missile) && own.hp === 100, 'so it holds fire');
  // A neutral civ's unit in the blast: the rules would refuse, and it doesn't try.
  w = setup(5);
  unit(w.game, 'infantry', 2, w.ring[6]);
  w.aztec.visible.fill(1);
  eq(strikeWorth(makeCtx(w.game, w.aztec), w.missile, w.theirs.tile), null, 'India’s soldier is there');
  fireNukes(makeCtx(w.game, w.aztec));
  ok(w.game.units.includes(w.missile), 'so it holds fire (and makes no strike the rules would refuse)');
});

test('a peaceful leader holds fire where a warmonger would strike', () => {
  const { game, at } = blank(['india', 'babylon']);
  const [india] = game.players;
  techsTo(game, 0, 15);
  const home = city(game, 0, at(3, 5), { buildings: ['manhattan_project'] });
  const theirs = city(game, 1, at(14, 5), { pop: 10 });
  war(game, 0, 1);
  for (const t of [theirs.tile, ...neighbours(game.grid, theirs.tile)].slice(0, 5)) unit(game, 'infantry', 1, t);
  for (const t of neighbours(game.grid, home.tile).slice(0, 4)) unit(game, 'infantry', 0, t);
  const missile = unit(game, 'nuclear_missile', 0, home.tile);
  india.visible.fill(1);
  india.explored.fill(1);
  fireNukes(makeCtx(game, india));
  ok(game.units.includes(missile), 'Gandhi holds fire');
});

// -------------------------------------------------------------------------------------------------
// The civilizations
// -------------------------------------------------------------------------------------------------

test('every civ has its own unit and building (each replacing one that exists), a personality, a symbol, sixteen names of its own and its own colours', () => {
  const csNames = new Set(CITY_STATES.map((c) => c.civ.name));
  const named = new Map<string, string>();
  const colours = new Set<string>();
  for (const c of CIV_LIST) {
    const u = UNITS[c.unit];
    ok(!!u && u.civ === c.id && !!u.replaces && !!UNITS[u.replaces] && !UNITS[u.replaces].civ, `${c.id}: its unit ${c.unit} replaces a common one`);
    const b = BUILDINGS[c.building];
    ok(!!b && b.civ === c.id && !!b.replaces && !!BUILDINGS[b.replaces] && !BUILDINGS[b.replaces].civ, `${c.id}: its building ${c.building} replaces a common one`);
    ok(!!PERSONALITIES[c.id], `${c.id}: a leader's personality`);
    ok(!!CIV_SYMBOL[c.id] && glyphPaths(CIV_SYMBOL[c.id]) !== glyphPaths(''), `${c.id}: a symbol drawn for its emblem`);
    ok(!!c.ability.name && !!c.ability.text && Object.keys(c.ability.effects).length > 0, `${c.id}: an ability that does something`);
    eq(new Set(c.cities).size, 16, `${c.id}: sixteen different city names`);
    for (const n of c.cities) {
      ok(!csNames.has(n), `${c.id}: ${n} is a city-state's name`);
      ok(!named.has(n), `${c.id}: ${n} is ${named.get(n)}'s too`);
      named.set(n, c.id);
    }
    ok(!colours.has(c.color), `${c.id}: a colour of its own`);
    colours.add(c.color);
  }
});

test('Rome: buildings the capital has go up a quarter faster in its other cities', () => {
  const toward = (civ: string) => {
    const { game, at } = blank([civ, 'egypt']);
    const capital = city(game, 0, at(4, 4));
    const other = city(game, 0, at(12, 4));
    const fast = (c: typeof other) => productionToward(game, c, { kind: 'building', id: 'monument' }, cityEffects(game, c), 100);
    const before = fast(other);
    capital.buildings.push('monument');
    return { before, after: fast(other), capital: fast(capital) };
  };
  const rome = toward('rome');
  eq(rome.after - rome.before, 25, 'a monument in the capital: +25% toward one elsewhere');
  eq(rome.capital, rome.before, 'not in the capital itself');
  const egypt = toward('egypt');
  eq(egypt.after, egypt.before, 'nobody else');
});

test('Greece: influence with city-states falls half as fast and climbs back twice as fast', () => {
  const { game, at } = blank(['greece', 'egypt'], { cityStates: 1 });
  const cs = game.players.find((x) => x.cityState)!;
  city(game, cs.index, at(12, 9));
  const [greece, egypt] = [game.players[0], game.players[1]];
  city(game, 0, at(3, 3));
  city(game, 1, at(20, 3));
  eq(influenceFall(game, greece), 0.5, 'half as fast');
  eq(influenceFall(game, egypt), 1, 'a point a turn for others');
  greece.influence[cs.index] = -10;
  egypt.influence[cs.index] = -10;
  cityStateTurn(game);
  eq(greece.influence[cs.index], -8, 'two back a turn');
  eq(egypt.influence[cs.index], -9, 'one for others');
});

test('Japan: wounded units fight at full strength; fishing boats give culture', () => {
  const { game, at } = blank(['japan', 'egypt']);
  war(game, 0, 1);
  const samurai = unit(game, 'warrior', 0, at(4, 8), { hp: 40 });
  const foe = unit(game, 'warrior', 1, at(5, 8));
  const other = unit(game, 'warrior', 1, at(12, 8), { hp: 40 });
  const mark = unit(game, 'warrior', 0, at(13, 8));
  near(strength(game, samurai, 'attack', foe, samurai.tile), 8, 'Japanese: full strength at 40 hit points');
  near(strength(game, other, 'attack', mark, other.tile), 8 * 0.7, 'others: 30% down');
  const boats = (civ: string) => {
    const w = blank([civ, 'egypt']);
    const c = city(w.game, 0, w.at(6, 6));
    const t = neighbours(w.game.grid, c.tile)[0];
    Object.assign(w.game.tiles[t], { terrain: 'coast', resource: 'fish', improvement: 'fishing_boats' });
    return workedYields(w.game, c, t).culture ?? 0;
  };
  eq(boats('japan') - boats('egypt'), 1, '+1 culture from fishing boats');
});

test('England: +2 moves for ships and an extra spy', () => {
  const { game, at } = blank(['england', 'egypt']);
  game.tiles[at(6, 6)].terrain = 'coast';
  game.tiles[at(16, 6)].terrain = 'coast';
  const mine = unit(game, 'trireme', 0, at(6, 6));
  const theirs = unit(game, 'trireme', 1, at(16, 6));
  eq(maxMoves(game, mine) - maxMoves(game, theirs), 2, 'two more moves at sea');
  eq(maxMoves(game, unit(game, 'warrior', 0, at(3, 3))), 2, 'none more on land');
  eq(spyCount(game, game.players[0], 5) - spyCount(game, game.players[1], 5), 1, 'one more spy');
});

test('Mongolia: +30% against city-states and their units; +1 move for mounted units', () => {
  const { game, at } = blank(['mongolia', 'egypt'], { cityStates: 1 });
  const cs = game.players.find((x) => x.cityState)!;
  const rider = unit(game, 'warrior', 0, at(4, 8));
  const csFoe = unit(game, 'warrior', cs.index, at(5, 8));
  const rider2 = unit(game, 'warrior', 0, at(14, 8));
  const civFoe = unit(game, 'warrior', 1, at(15, 8));
  near(strength(game, rider, 'attack', csFoe, rider.tile) / strength(game, rider2, 'attack', civFoe, rider2.tile), 1.3, 'against a city-state’s unit');
  const town = city(game, cs.index, at(10, 14));
  const siege = unit(game, 'warrior', 0, neighbours(game.grid, town.tile)[0]);
  near(strength(game, siege, 'attack', town, siege.tile), 8 * 1.3, 'and against its city');
  near(strength(game, csFoe, 'defend', rider, csFoe.tile), 8, 'but not for the city-state');
  const horse = unit(game, 'horseman', 0, at(3, 3));
  const theirs = unit(game, 'horseman', 1, at(20, 3));
  eq(maxMoves(game, horse) - maxMoves(game, theirs), 1, 'a move more for horsemen');
  eq(maxMoves(game, rider), 2, 'none for those on foot');
});

test('the Ottomans: ships cost a third of the upkeep (and nothing else less)', () => {
  const upkeep = (civ: string, type: string) => {
    const { game, at } = blank([civ, 'egypt']);
    city(game, 0, at(3, 3));
    game.turn = 120;
    for (let i = 0; i < 12; i++) {
      game.tiles[at(i + 2, 12)].terrain = 'coast';
      unit(game, type, 0, at(i + 2, type === 'trireme' ? 12 : 8));
    }
    return goldUpkeep(game, game.players[0]).units;
  };
  ok(upkeep('egypt', 'trireme') >= 10, 'twelve ships cost an Egyptian dearly');
  eq(upkeep('ottomans', 'trireme'), 0, 'four ships’ worth: within the free four');
  eq(upkeep('ottomans', 'warrior'), upkeep('egypt', 'warrior'), 'soldiers as anyone’s');
});

test('the Zulu: melee units cost half the upkeep; units earn a third more experience', () => {
  const upkeep = (civ: string, type: string) => {
    const { game, at } = blank([civ, 'egypt']);
    city(game, 0, at(3, 3));
    game.turn = 120;
    for (let i = 0; i < 12; i++) unit(game, type, 0, at(i + 2, 8));
    return goldUpkeep(game, game.players[0]).units;
  };
  ok(upkeep('zulu', 'warrior') < upkeep('egypt', 'warrior'), 'warriors cheaper');
  eq(upkeep('zulu', 'archer'), upkeep('egypt', 'archer'), 'archers as anyone’s');
  const { game, at } = blank(['zulu', 'egypt']);
  const impi = unit(game, 'warrior', 0, at(4, 4));
  const other = unit(game, 'warrior', 1, at(14, 4));
  gain(game, impi, 6, 1);
  gain(game, other, 6, 0);
  near(impi.xp, 8, 'a third more');
  near(other.xp, 6, 'as earned for others');
});

test('the Inca: a hill is a single move; roads on hills cost no upkeep and half elsewhere', () => {
  const step = (civ: string) => {
    const { game, at } = blank([civ, 'egypt']);
    Object.assign(game.tiles[at(6, 6)], { elevation: 'hills', feature: 'forest' });
    const u = unit(game, 'warrior', 0, at(5, 6));
    return stepCost(game, u, at(5, 6), at(6, 6));
  };
  eq(step('inca'), 1, 'onto a forested hill');
  eq(step('egypt'), 2, 'two for others');
  const roads = (civ: string, hills: boolean) => {
    const { game, at } = blank([civ, 'egypt']);
    city(game, 0, at(3, 3));
    for (let i = 0; i < 8; i++) Object.assign(game.tiles[at(i + 2, 10)], { owner: 0, road: 'road', elevation: hills ? 'hills' : 'flat' });
    return goldUpkeep(game, game.players[0]).roads;
  };
  eq(roads('egypt', false), 4, 'half a gold a road');
  eq(roads('inca', false), 2, 'a quarter for the Inca');
  eq(roads('inca', true), 0, 'none on hills');
});

test('America: +1 sight for land units; tiles cost half the gold to buy', () => {
  const { game, at } = blank(['america', 'egypt']);
  const mine = unit(game, 'warrior', 0, at(4, 4));
  const theirs = unit(game, 'warrior', 1, at(16, 4));
  eq(unitSight(game, mine) - unitSight(game, theirs), 1, 'a tile further');
  const cost = (civ: string) => {
    const w = blank([civ, 'egypt']);
    const c = city(w.game, 0, w.at(6, 6));
    return tileGoldCost(w.game, c, w.at(6, 9));
  };
  ok(Math.abs(cost('america') / cost('egypt') - 0.5) < 0.02, `half the gold (${cost('america')} against ${cost('egypt')})`);
});

test('Spain: natural wonders give twice the yields and happiness; gold for finding each, three times as much for the first', () => {
  const { game, at } = blank(['spain', 'egypt']);
  const [spain, egypt] = game.players;
  city(game, 0, at(3, 8));
  city(game, 1, at(21, 8));
  const peak = at(12, 8);
  naturalWonder(game, peak, 'gilded_peak');
  const moods = [happiness(game, spain), happiness(game, egypt)];
  unit(game, 'scout', 1, at(14, 8));
  unit(game, 'scout', 0, at(10, 8));
  eq(game.found?.gilded_peak?.by.join(), '1,0', 'found by Egypt, then Spain');
  eq(happiness(game, spain) - moods[0], 2, 'twice as happy for it');
  eq(happiness(game, egypt) - moods[1], 1, 'Egypt as usual');
  eq(spain.gold, Math.floor(SEVEN_CITIES_GOLD * speed(game)), 'gold for finding it second');
  const mine = tileYields(game, peak, spain);
  const theirs = tileYields(game, peak, egypt);
  for (const k of Object.keys(theirs) as (keyof typeof theirs)[]) eq(mine[k], 2 * (theirs[k] ?? 0), `twice the ${k}`);
  const first = blank(['spain', 'egypt']);
  naturalWonder(first.game, first.at(12, 8), 'gilded_peak');
  unit(first.game, 'scout', 0, first.at(10, 8));
  eq(first.game.players[0].gold, Math.floor(SEVEN_CITIES_GOLD * 3 * speed(first.game)) + Math.floor(100 * speed(first.game)), 'three times as much first (and the Gilded Peak’s own gold)');
});

test('Siam: half again as much food, culture and faith from city-state friends', () => {
  const gifts = (civ: string) => {
    const { game, at } = blank([civ, 'egypt'], { cityStates: 3 });
    const css = game.players.filter((x) => x.cityState);
    (['maritime', 'cultured', 'religious'] as const).forEach((k, i) => {
      css[i].cityState!.kind = k;
      city(game, css[i].index, at(6 + i * 6, 12));
    });
    const p = game.players[0];
    city(game, 0, at(3, 3));
    for (const cs of css) p.influence[cs.index] = 40;
    const food = cityStateBonus(game, p).food;
    [p.culture, p.faith] = [0, 0];
    cityStateTurn(game);
    return { food, culture: p.culture, faith: p.faith };
  };
  const siam = gifts('siam');
  const egypt = gifts('egypt');
  eq(egypt.food, 1, 'a maritime friend: +1 food');
  eq(siam.food, 2, 'half again, rounded up, for Siam');
  eq(siam.culture, Math.ceil(egypt.culture * 1.5), 'culture');
  eq(siam.faith, Math.ceil(egypt.faith * 1.5), 'faith');
  ok(egypt.culture > 0 && egypt.faith > 0, 'from cultured and religious friends');
});

test('Ethiopia: +20% against civs with more cities than its own', () => {
  const { game, at } = blank(['ethiopia', 'egypt']);
  war(game, 0, 1);
  city(game, 0, at(3, 3));
  city(game, 1, at(20, 3));
  const mine = unit(game, 'warrior', 0, at(10, 9));
  const foe = unit(game, 'warrior', 1, at(11, 9));
  near(strength(game, mine, 'attack', foe, mine.tile), 8, 'as many cities: none');
  city(game, 1, at(20, 14));
  near(strength(game, mine, 'attack', foe, mine.tile), 8 * 1.2, 'they have more');
  near(strength(game, foe, 'attack', mine, foe.tile), 8, 'not for them');
});

test('the Celts: +1 faith from each forest their cities work', () => {
  const faith = (civ: string) => {
    const { game, at } = blank([civ, 'egypt']);
    const c = city(game, 0, at(6, 6));
    const t = neighbours(game.grid, c.tile)[0];
    game.tiles[t].feature = 'forest';
    return workedYields(game, c, t).faith ?? 0;
  };
  eq(faith('celts') - faith('egypt'), 1, 'a faith more');
});

test('Carthage: a free Lighthouse (its Cothon), with no upkeep, in every coastal city it founds', () => {
  const found = (civ: string, coast: boolean) => {
    const { game, at } = blank([civ, 'egypt']);
    if (coast) game.tiles[neighbours(game.grid, at(6, 6))[0]].terrain = 'coast';
    const c = city(game, 0, at(6, 6));
    return { buildings: c.buildings, upkeep: goldUpkeep(game, game.players[0]).buildings };
  };
  const carthage = found('carthage', true);
  ok(carthage.buildings.includes('cothon'), 'a Cothon by the sea');
  eq(carthage.upkeep, 0, 'that costs nothing');
  ok(!found('carthage', false).buildings.includes('cothon'), 'none inland');
  ok(!found('egypt', true).buildings.some((b) => b === 'lighthouse'), 'none for others');
});

test('Poland: a free social policy on entering each new era', () => {
  const classical = TECH_LIST.find((t) => t.col > 2 && t.col <= 4)!.id;
  const run = (civ: string) => {
    const { game } = blank([civ, 'egypt']);
    const p = game.players[0];
    p.culture = 0;
    learn(game, p, 'pottery');
    const ancient = p.culture;
    const cost = policyCost(game, p);
    learn(game, p, classical);
    return { ancient, classical: p.culture, cost };
  };
  const poland = run('poland');
  eq(poland.ancient, 0, 'nothing within the Ancient Era');
  eq(poland.classical, poland.cost, 'a policy’s culture on reaching the Classical');
  eq(run('egypt').classical, 0, 'nothing for others');
});

test('the Netherlands: +2 gold from sea trade routes; a luxury traded away keeps half its happiness', () => {
  const { game, at } = blank(['netherlands', 'egypt']);
  const mine = city(game, 0, at(3, 3), { pop: 4 });
  const theirs = city(game, 1, at(12, 3), { pop: 4 });
  const gold = (p: number, sea: boolean) => routeYield(game, game.players[p], { from: p ? theirs.id : mine.id, to: p ? mine.id : theirs.id, turns: 10, sea }).gold;
  eq(gold(0, true) - gold(0, false) - (gold(1, true) - gold(1, false)), 2, 'two more by sea');
  const traded = (civ: string) => {
    const w = blank([civ, 'babylon']);
    const c = city(w.game, 0, w.at(3, 3));
    city(w.game, 1, w.at(20, 3));
    Object.assign(w.game.tiles[neighbours(w.game.grid, c.tile)[0]], { resource: 'silver', improvement: 'mine' });
    const p = w.game.players[0];
    const before = happiness(w.game, p);
    makeDeal(w.game, { from: 0, to: 1, items: [{ kind: 'luxury', from: 0, resource: 'silver' }] });
    return before - happiness(w.game, p);
  };
  eq(traded('egypt'), 4, 'others lose all of it');
  eq(traded('netherlands'), 2, 'the Dutch half');
  const polder = city(game, 0, at(6, 12));
  game.tiles[polder.tile].river = true;
  const [marsh, flood] = neighbours(game.grid, polder.tile);
  game.tiles[marsh].feature = 'marsh';
  Object.assign(game.tiles[flood], { terrain: 'desert', feature: 'floodplains' });
  const before = [workedYields(game, polder, marsh).food ?? 0, workedYields(game, polder, flood).food ?? 0];
  polder.buildings.push('polder');
  eq((workedYields(game, polder, marsh).food ?? 0) - before[0], 2, 'the Polder: +2 food from a marsh');
  eq((workedYields(game, polder, flood).food ?? 0) - before[1], 1, '+1 from flood plains');
});

test('Polynesia: land units take to the sea and cross the ocean from the start, and see further there', () => {
  const step = (civ: string, terrain: 'coast' | 'ocean') => {
    const { game, at } = blank([civ, 'egypt']);
    game.tiles[at(6, 6)].terrain = terrain;
    const u = unit(game, 'warrior', 0, at(5, 6));
    return stepCost(game, u, at(5, 6), at(6, 6));
  };
  ok(Number.isFinite(step('polynesia', 'coast')) && Number.isFinite(step('polynesia', 'ocean')), 'onto the coast and the ocean');
  eq(step('egypt', 'coast'), Infinity, 'not others before Optics');
  const { game, at } = blank(['polynesia', 'egypt']);
  for (const t of [at(6, 6), at(16, 6)]) game.tiles[t].terrain = 'ocean';
  const mine = unit(game, 'warrior', 0, at(6, 6), { embarked: true });
  const theirs = unit(game, 'warrior', 1, at(16, 6), { embarked: true });
  eq(unitSight(game, mine) - unitSight(game, theirs), 1, 'a tile further at sea');
});

test('Denmark: taking to the sea and landing take a single move; a move more at sea', () => {
  const steps = (civ: string) => {
    const { game, at } = blank([civ, 'egypt']);
    game.players[0].techs.push('optics');
    game.tiles[at(6, 6)].terrain = 'coast';
    const u = unit(game, 'warrior', 0, at(5, 6));
    const out = [stepCost(game, u, at(5, 6), at(6, 6)), stepCost(game, u, at(6, 6), at(5, 6))];
    u.embarked = true;
    return { out, moves: maxMoves(game, u) };
  };
  eq(steps('denmark').out.join(), '1,1', 'a move each way');
  ok(steps('egypt').out.every((c) => c >= 99), 'every move for others');
  eq(steps('denmark').moves - steps('egypt').moves, 1, 'a move more at sea');
});

test('the new unique units: the Mehal Sefari at home, Pictish Warriors abroad, the Maori war dance, Berserkers from the sea', () => {
  const { game, at } = blank(['ethiopia', 'celts']);
  war(game, 0, 1);
  const home = city(game, 0, at(3, 8));
  city(game, 1, at(21, 8));
  const inLand = neighbours(game.grid, home.tile)[0];
  const sefari = unit(game, 'mehal_sefari', 0, inLand);
  const foe = unit(game, 'rifleman', 1, neighbours(game.grid, inLand).find((t) => t !== home.tile && game.tiles[t].owner !== 1 && !game.units.some((u) => u.tile === t))!);
  near(strength(game, sefari, 'attack', foe, sefari.tile), 34 * 1.25, 'Mehal Sefari: +25% in its own land');
  const away = unit(game, 'mehal_sefari', 0, at(12, 14));
  near(strength(game, away, 'attack', unit(game, 'rifleman', 1, at(13, 14)), away.tile), 34, 'none away');
  const pict = unit(game, 'pictish_warrior', 1, at(12, 2));
  near(strength(game, pict, 'attack', unit(game, 'warrior', 0, at(13, 2)), pict.tile), 11 * 1.2, 'Pictish Warrior: +20% outside its land');
  const w = blank(['polynesia', 'denmark']);
  war(w.game, 0, 1);
  const maori = unit(w.game, 'maori_warrior', 0, w.at(10, 8));
  const dane = unit(w.game, 'longswordsman', 1, w.at(11, 8));
  const far = unit(w.game, 'longswordsman', 1, w.at(16, 8));
  near(strength(w.game, dane, 'attack', maori, dane.tile), 21 * 0.9, 'beside a Maori Warrior: -10%');
  near(strength(w.game, far, 'attack', unit(w.game, 'warrior', 0, w.at(17, 8)), far.tile), 21, 'none further off');
  near(strength(w.game, maori, 'attack', dane, maori.tile), 8, 'not for the Maori');
  const berserker = unit(w.game, 'berserker', 1, w.at(10, 14), { embarked: true });
  const sword = unit(w.game, 'longswordsman', 1, w.at(14, 14), { embarked: true });
  near(strength(w.game, berserker, 'attack', unit(w.game, 'warrior', 0, w.at(11, 14)), berserker.tile), 21, 'Berserker: no penalty from the sea');
  near(strength(w.game, sword, 'attack', unit(w.game, 'warrior', 0, w.at(15, 14)), sword.tile), 21 * 0.5, 'half for others');
});

// -------------------------------------------------------------------------------------------------
// A living world: seasons, disasters, the rising sea
// -------------------------------------------------------------------------------------------------

/** A duel's settings for a real map (its land as the seed makes it), with disasters as asked. */
const worldSettings = (disasters?: boolean): Settings => ({ size: 'duel', type: 'continents', speed: 'quick', timer: 0, cityStates: 0, barbarians: false, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330, ...(disasters === undefined ? {} : { disasters }) });
const worldSeats = [
  { user: null, name: 'A', civ: 'egypt', bot: true },
  { user: null, name: 'B', civ: 'babylon', bot: true },
];

test('seasons: spring, summer, autumn, winter and round again, a season five turns at standard speed and fewer at quick', () => {
  eq([1, 6, 11, 16, 21].map((t) => seasonAt(t)).join(','), 'spring,summer,autumn,winter,spring', 'by the turn');
  eq(seasonAt(5), 'spring', 'the fifth turn still spring');
  eq(seasonTurns(SPEEDS.quick), 3, 'three turns a season at quick speed');
  eq(seasonAt(4, SPEEDS.quick), 'summer', 'so summer comes sooner');
  const { game } = blank();
  game.turn = 10;
  eq(seasonOf(game), 'winter', 'a game’s season from its turn and speed (blank worlds are quick: winter by turn 10)');
});

test('the seasons turn on the screens alone: the woods in the tropics and on a wonder are built as twins that never turn, the snowy tiles’ ground as twins that snow lies on', () => {
  const settings = { size: 'small', speed: 'quick', timer: 0, cityStates: 4, barbarians: false, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330, disasters: true } as const;
  const seats = ['egypt', 'babylon', 'china', 'india'].map((civ) => ({ user: null, name: civ, civ, bot: true }));
  const game = createGame({ ...settings, victories: { ...settings.victories }, type: 'continents', wrap: true }, seats, 4);
  const g = game.grid;
  const raw = terrainEdits(g, game.tiles);
  const edits = seasonalBlocks(g, game.tiles, raw.map((e) => [...e]));
  const latitude = (t: number) => Math.abs(((rowOf(g, t) + 0.5) / g.height) * 2 - 1);
  const under = (e: [number, number, number, string]) => tileUnder(g, e[0] + 0.5, e[2] + 0.5);
  const counts = { woods: 0, tropics: 0, ground: 0 };
  raw.forEach((e, i) => {
    const t = under(e);
    const now = edits[i][3];
    if (e[3] === 'civ_leaves') {
      const turns = t >= 0 && !game.tiles[t].wonder && latitude(t) > 0.3;
      eq(now, turns ? e[3] : EVERGREEN, `the leaves at ${e.slice(0, 3).join(',')}`);
      counts[turns ? 'woods' : 'tropics']++;
    } else if (now !== e[3]) {
      eq(now, SNOWY[e[3]], 'only the season’s twins are changed');
      counts.ground++;
    }
  });
  ok(counts.woods > 0 && counts.tropics > 0 && counts.ground > 0, `woods that turn and woods that don't, and ground under snow in winter: ${JSON.stringify(counts)}`);
  // The ground's twins are each snowy tile's column tops, and no other block of theirs.
  const size = extent(g);
  const ground = new Ground(Math.ceil(size.w), Math.ceil(size.d), edits, period(g));
  const twins = new Set(Object.values(SNOWY));
  for (const e of edits) {
    if (!twins.has(e[3])) continue;
    const top = ground.at(e[0], e[2]);
    eq(`${top?.y} ${top?.block}`, `${e[1]} ${e[3]}`, `a twin at ${e.slice(0, 3).join(',')} is its column's top`);
    const tile = game.tiles[under(e)];
    ok(latitude(under(e)) > 0.3 && !tile.wonder && (tile.elevation !== 'flat' || tile.terrain === 'tundra'), 'on a snowy tile');
    ok(SURFACE_BLOCKS.has(e[3]), `${e[3]} is the land's surface (units stand on it, improvements go on it)`);
  }
});

test('a volcano erupting hurts what’s beside it, buries improvements, and leaves the land round it rich for good', () => {
  const { game, at } = blank();
  const v = at(8, 8);
  Object.assign(game.tiles[v], { elevation: 'mountain', volcano: true, height: 7 });
  const next = neighbours(game.grid, v);
  const c = city(game, 0, next[0], { pop: 3 });
  const w = unit(game, 'warrior', 1, next[1]);
  for (const t of next.slice(2)) game.tiles[t].improvement = 'farm';
  const before = tileYields(game, next[1], null).food ?? 0;
  erupt(game, v, new Rng(3));
  eq(c.pop, 2, 'the city beside it loses a citizen');
  ok(!game.units.includes(w) || w.hp < 100, 'the warrior beside it is hurt');
  ok(next.slice(2).some((t) => game.tiles[t].pillaged), 'improvements are buried in ash');
  ok(next.slice(1).every((t) => (game.tiles[t].soil?.food ?? 0) >= 1), 'the land beside it is richer');
  eq(tileYields(game, next[1], null).food ?? 0, before + (game.tiles[next[1]].soil?.food ?? 0), 'its soil is food there');
  ok(!game.tiles[c.tile].pillaged, 'the city’s own tile isn’t pillaged');
  // Again and again: the soil grows no richer than its most.
  for (let i = 0; i < 6; i++) erupt(game, v, new Rng(10 + i));
  ok(next.every((t) => (game.tiles[t].soil?.food ?? 0) <= SOIL_MAX.food! && (game.tiles[t].soil?.prod ?? 0) <= SOIL_MAX.prod!), 'rich soil is capped');
  ok(packStatic(game.tiles[v]).length === 6 && unpackStatic(packStatic(game.tiles[v])).volcano, 'the screens are told it’s a volcano');
  ok(unpackStatic(packStatic(game.tiles[next[1]])).soil && !unpackStatic(packStatic(game.tiles[at(1, 1)])).soil, 'and where the soil is rich');
  eq(packStatic(game.tiles[at(1, 1)]).length, 5, 'a tile with no marks packs as it always did');
});

test('a river flood washes away improvements on its banks and leaves silt that feeds them for good', () => {
  const { game, at } = blank();
  const banks = [at(4, 6), at(5, 6), at(6, 6), at(7, 6), at(8, 6)];
  for (const t of banks) Object.assign(game.tiles[t], { river: true, improvement: 'farm' });
  game.tiles[banks[2]].feature = 'floodplains';
  let wrecked = 0;
  for (let i = 0; i < 4; i++) {
    for (const t of banks) game.tiles[t].pillaged = undefined;
    const reached = flood(game, banks[2], new Rng(i + 1));
    ok(reached.includes(banks[2]) && reached.every((t) => game.tiles[t].river), 'it runs along the river');
    ok(reached.every((t) => distance(game.grid, banks[2], t) <= 2), 'two tiles off at most');
    wrecked += banks.filter((t) => game.tiles[t].pillaged).length;
  }
  ok(wrecked > 0, 'improvements are washed away');
  eq(game.tiles[banks[2]].soil?.food, SOIL_MAX.food, 'the flood plain is the richer (to its most)');
  ok(!game.tiles[at(4, 9)].soil, 'land off the river is untouched');
  const p = game.players[0];
  ok((tileYields(game, banks[2], p).food ?? 0) >= 2 + 2, 'its food: the flood plain’s and the silt’s');
});

test('a storm at sea batters ships and embarked units (never sinking them), wrecks the coast, blows about and blows out', () => {
  const { game, at } = blank();
  for (let col = 0; col < game.grid.width; col++) for (let row = 0; row < 12; row++) Object.assign(game.tiles[at(col, row)], { terrain: col < 2 || row < 11 ? 'ocean' : 'coast', height: 0 });
  const eye = at(10, 5);
  const ship = unit(game, 'trireme', 0, eye);
  const boat = unit(game, 'warrior', 1, neighbour(game.grid, eye, 0), { embarked: true });
  const far = unit(game, 'trireme', 0, at(20, 2));
  const weak = unit(game, 'trireme', 1, neighbour(game.grid, eye, 3), { hp: 8 });
  const storm = { tile: eye, dir: 0, turns: 3 };
  batter(game, storm, new Rng(1));
  ok(ship.hp < 100 && ship.hp >= 10, `the ship is battered (${ship.hp})`);
  ok(boat.hp < 100, 'and the embarked warrior');
  eq(far.hp, 100, 'a ship far off is not');
  ok(game.units.includes(weak) && weak.hp === 8, 'a ship already low is left as it was, not sunk');
  // The coast's improvements: a storm by the shore, again and again.
  const shore = neighbours(game.grid, at(10, 11)).find((n) => !TERRAINS[game.tiles[n].terrain].water)!;
  game.tiles[shore].improvement = 'farm';
  let wrecked = false;
  for (let i = 0; i < 20 && !wrecked; i++) {
    batter(game, { tile: at(10, 11), dir: 0, turns: 1 }, new Rng(Math.imul(i + 1, 0x9e3779b1) >>> 0));
    wrecked = !!game.tiles[shore].pillaged;
  }
  ok(wrecked, 'a coastal improvement is wrecked');
  // Its turns: it blows on over the water, and is gone once spent.
  game.turn = 40;
  game.storms = [storm];
  disasterTurn(game);
  ok(game.storms?.[0] ? game.storms[0].tile !== eye && !!TERRAINS[game.tiles[game.storms[0].tile].terrain].water : true, 'it blows on over the sea');
  for (let i = 0; i < 5; i++) {
    game.turn++;
    disasterTurn(game);
  }
  ok(!game.storms || !game.storms.some((s) => s === storm), 'spent, it’s gone');
});

test('the coal and oil the world burns raise the sea: the low coast floods, then drowns; a city holds its tile; units go to dry land', () => {
  const { game, at } = blank();
  for (let row = 0; row < game.grid.height; row++) Object.assign(game.tiles[at(0, row)], { terrain: 'ocean', height: 0 });
  const port = city(game, 0, at(1, 4), { pop: 4 });
  port.buildings.push('factory');
  for (let row = 0; row < game.grid.height; row++) if (row !== 4) Object.assign(game.tiles[at(1, row)], { improvement: 'farm', road: 'road' });
  eq(emissions(game, game.players[0]), 1, 'a Factory burns Coal');
  eq(emissions(game, game.players[1]), 0, 'and a civ without industry burns none');
  game.climate = { co2: riseAt(game, 1) - 2, rises: 0 };
  eq(climateTurn(game).length, 0, 'below the threshold the sea stays');
  const events = climateTurn(game);
  eq(game.climate.rises, 1, 'past it, the sea rises');
  eq(events[0]?.kind, 'sea', 'the screens are told');
  const flooded = game.tiles.flatMap((tile, t) => (tile.flooded ? [t] : []));
  ok(flooded.length > 0 && flooded.every((t) => colOf(game.grid, t) === 1), `the low coast floods (${flooded.length})`);
  ok(!game.tiles[port.tile].flooded, 'never a city’s own tile');
  ok(flooded.every((t) => game.tiles[t].pillaged), 'its improvements ruined');
  ok(game.players[0].notes.length === 0 || game.players[0].notes.some((n) => n.topic === 'disasters'), 'news of it is the disasters’ (a bot hears none)');
  const t = flooded[0];
  const w = unit(game, 'warrior', 1, t);
  const owner = game.tiles[t].owner;
  game.climate.co2 = riseAt(game, 2);
  climateTurn(game);
  eq(game.climate.rises, 2, 'it rises again');
  eq(game.tiles[t].terrain, 'coast', 'what it flooded is under the sea');
  ok(!game.tiles[t].improvement && !game.tiles[t].road && !game.tiles[t].flooded, 'nothing of the land left on it');
  eq(game.tiles[t].owner, owner, 'still its owner’s water');
  ok(!TERRAINS[game.tiles[w.tile].terrain].water && !w.embarked, 'the warrior on it went to dry land');
  eq(game.tiles[port.tile].terrain, 'grassland', 'the city stands');
  ok(port.worked.every((x) => workable(game, port).includes(x)), 'and works what it has');
  game.climate.co2 = riseAt(game, MAX_RISES + 3);
  for (let i = 0; i < 6; i++) climateTurn(game);
  eq(game.climate.rises, MAX_RISES, 'no more than its most');
});

test('disasters off: no volcanoes on the map, no eruptions, floods, storms or rising sea', () => {
  const off = createGame(worldSettings(false), worldSeats, 11);
  const on = createGame(worldSettings(true), worldSeats, 11);
  eq(off.tiles.filter((t) => t.volcano).length, 0, 'no volcanoes without disasters');
  ok(on.tiles.filter((t) => t.volcano).length >= 1, 'some with them');
  // The world the seed makes is the same, but for its volcanoes.
  const land = (g: Game) => JSON.stringify(g.tiles.map((t) => ({ ...t, volcano: undefined })));
  eq(land(on), land(off), 'the same land either way');
  const { game, at } = blank();
  game.settings.disasters = false;
  Object.assign(game.tiles[at(8, 8)], { elevation: 'mountain', volcano: true });
  for (const t of [at(3, 3), at(4, 3)]) Object.assign(game.tiles[t], { river: true, feature: 'floodplains' });
  Object.assign(game.tiles[at(20, 10)], { terrain: 'ocean', height: 0 });
  game.storms = [{ tile: at(20, 10), dir: 0, turns: 3 }];
  city(game, 0, at(12, 12)).buildings.push('factory');
  game.climate = { co2: riseAt(game, 1), rises: 0 };
  for (game.turn = 20; game.turn < 600; game.turn++) {
    eq(disasterTurn(game).length, 0, `no disasters at turn ${game.turn}`);
    eq(climateTurn(game).length, 0, 'and the sea stays');
  }
  eq(game.climate.rises, 0, 'it never rose');
  ok(game.tiles.every((t) => !t.soil && !t.pillaged), 'nothing touched');
});

test('the same seed has the same disasters (a saved game goes on as it would have); they don’t move the game’s own random numbers', () => {
  const run = (seed: number) => {
    const game = createGame(worldSettings(true), worldSeats, seed);
    const rng = game.rng;
    const seen: string[] = [];
    for (game.turn = 1; game.turn < 400; game.turn++) for (const e of disasterTurn(game)) seen.push(`${game.turn}:${e.kind}:${e.tile}`);
    eq(game.rng, rng, 'the game’s own random numbers untouched');
    return { seen: seen.join(' '), land: JSON.stringify(game.tiles.map((t) => [t.soil, t.pillaged, t.feature])) };
  };
  const a = run(21);
  const b = run(21);
  ok(a.seen.length > 0, 'some disasters in four hundred turns');
  eq(a.seen, b.seen, 'the same disasters on the same turns');
  eq(a.land, b.land, 'and the same land after');
  ok(run(22).seen !== a.seen, 'another seed, others');
  // A game saved midway and carried on has the same ones.
  const whole = createGame(worldSettings(true), worldSeats, 21);
  const half = createGame(worldSettings(true), worldSeats, 21);
  const wholeSeen: string[] = [];
  const halfSeen: string[] = [];
  for (whole.turn = 1; whole.turn < 200; whole.turn++) for (const e of disasterTurn(whole)) wholeSeen.push(`${whole.turn}:${e.kind}:${e.tile}`);
  for (half.turn = 1; half.turn < 100; half.turn++) for (const e of disasterTurn(half)) halfSeen.push(`${half.turn}:${e.kind}:${e.tile}`);
  const loaded: Game = JSON.parse(JSON.stringify(half));
  for (; loaded.turn < 200; loaded.turn++) for (const e of disasterTurn(loaded)) halfSeen.push(`${loaded.turn}:${e.kind}:${e.tile}`);
  eq(halfSeen.join(' '), wholeSeen.join(' '), 'a save carried on');
});

test('the world’s changes reach the screens: the map sent marks them, the view has the storms and the turn’s disasters, the land is built again', () => {
  const { game, at } = blank();
  for (let row = 0; row < game.grid.height; row++) Object.assign(game.tiles[at(0, row)], { terrain: 'ocean', height: 0 });
  game.storms = [{ tile: at(0, 5), dir: 0, turns: 2 }];
  game.events = [{ kind: 'flood', tile: at(4, 4), tiles: [at(4, 4), at(5, 4)] }];
  for (const o of game.players) o.explored.fill(0);
  const p = game.players[0];
  p.explored[at(0, 5)] = 1;
  p.explored[at(4, 4)] = 1;
  const v = viewFor(game, p, null);
  eq(JSON.stringify(v.storms), JSON.stringify([at(0, 5)]), 'storms in waters they know');
  eq(JSON.stringify(v.events?.[0]?.tiles), JSON.stringify([at(4, 4)]), 'a flood where they know the land');
  eq(viewFor(game, game.players[1], null).storms?.length, 0, 'not in waters they don’t');
  const before = terrainEdits(game.grid, game.tiles);
  const t = at(1, 5);
  submerge(game, t);
  eq(unpackStatic(mapWire(game).tiles[t]).terrain, 'coast', 'the map sent has the sea over it');
  const built = reshapeEdits(game.grid, game.tiles, [t]);
  ok(built.tiles.includes(t), 'the tile is built again');
  ok(built.edits.every((e) => tileUnder(game.grid, e[0] + 0.5, e[2] + 0.5) === t || built.tiles.includes(tileUnder(game.grid, e[0] + 0.5, e[2] + 0.5))), 'only its own columns');
  ok(built.edits.some((e) => e[1] === SEA_Y && e[3] === 'water') && !built.edits.some((e) => e[1] > SEA_Y && e[3] !== 'air'), 'as open sea');
  ok(before.some((e) => tileUnder(game.grid, e[0] + 0.5, e[2] + 0.5) === t && e[1] > SEA_Y), 'where there was land');
});

test('tiles built again from the land round them alone come out as the whole map’s blocks have them (the seasons’ twins among them), and the ground with them', () => {
  const settings = { size: 'small', speed: 'quick', timer: 0, cityStates: 4, barbarians: false, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330, disasters: true } as const;
  const seats = ['egypt', 'babylon', 'china', 'india'].map((civ) => ({ user: null, name: civ, civ, bot: true }));
  for (const [type, wrap, seed] of [['continents', true, 3], ['highlands', false, 8], ['archipelago', true, 21], ['earth', true, 5]] as const) {
    const game = createGame({ ...settings, victories: { ...settings.victories }, type, wrap }, seats, seed);
    const g = game.grid;
    // Rivers, woods, jungle, hills, mountains and a natural wonder's neighbours among them, flooded by the sea, rich with ash or silted.
    const land = game.tiles.flatMap((tile, t) => (TERRAINS[tile.terrain].water ? [] : [t]));
    const picks = [
      land.find((t) => game.tiles[t].river),
      land.find((t) => game.tiles[t].feature === 'forest'),
      land.find((t) => game.tiles[t].feature === 'jungle'),
      land.find((t) => game.tiles[t].elevation === 'mountain'),
      land.find((t) => neighbours(g, t).some((n) => game.tiles[n].wonder)),
      land.find((t) => colOf(g, t) === 0),
      ...land.filter((_, i) => i % 37 === 5),
    ].filter((t): t is number => t !== undefined);
    picks.forEach((t, i) => {
      const tile = game.tiles[t];
      if (i % 3 === 0 && tile.elevation === 'flat' && !tile.wonder) submerge(game, t);
      else if (i % 3 === 1) tile.soil = { food: 1 };
      else if (tile.elevation === 'flat' && !tile.wonder) tile.flooded = true;
    });
    const all = seasonalBlocks(g, game.tiles, terrainEdits(g, game.tiles));
    const size = extent(g);
    const whole = new Ground(Math.ceil(size.w), Math.ceil(size.d), all, period(g));
    for (const t of picks) {
      const built = reshapeEdits(g, game.tiles, [t]);
      const want = all.filter((e) => built.columns.has(`${e[0]},${e[2]}`));
      eq(JSON.stringify(built.built), JSON.stringify(want), `${type} tile ${t} (${tile(game, t)}): its columns' blocks`);
      const ground = new Ground(Math.ceil(size.w), Math.ceil(size.d), [], period(g));
      ground.rebuild(built.columns, built.built);
      for (const key of built.columns) {
        const [x, z] = key.split(',').map(Number);
        eq(JSON.stringify(ground.at(x, z)), JSON.stringify(whole.at(x, z)), `${type} tile ${t}: the ground at ${key}`);
      }
    }
  }
  function tile(game: Game, t: number) {
    const x = game.tiles[t];
    return [x.terrain, x.elevation, x.feature, x.river && 'river'].filter(Boolean).join(' ');
  }
});

// -------------------------------------------------------------------------------------------------
// Naval blockades and embargoes
// -------------------------------------------------------------------------------------------------

test('a blockade: enemy warships near a coastal city take its sea tiles, sea routes and half its healing', () => {
  const { game, at } = blank();
  for (let col = 0; col < 26; col++) game.tiles[at(col, 8)].terrain = 'coast';
  const c = city(game, 0, at(5, 7), { pop: 3 });
  const other = city(game, 0, at(15, 7));
  const sea = neighbours(game.grid, c.tile).find((t) => game.tiles[t].terrain === 'coast')!;
  ok(sea !== undefined, 'the city is on the coast');
  c.worked = [sea];
  c.locked = [sea];
  const p = game.players[0];
  routesOf(p).push({ from: c.id, to: other.id, turns: 10, sea: true, cargo: 'food' });
  const route = routesOf(p)[0];
  const food = cityYields(game, c).food;
  const carried = routeYield(game, p, route).food;
  ok(carried > 0, 'the sea route carries food');
  const ship = unit(game, 'trireme', 1, sea);
  ok(!blockaded(game, c), 'a ship at peace blockades nothing');
  war(game, 0, 1);
  ok(blockaded(game, c), 'an enemy warship within two tiles blockades it');
  eq(blockaders(game, c)[0], ship, 'that ship');
  ok(cityYields(game, c).food < food, 'its sea tile yields nothing');
  eq(routeYield(game, p, route).food, 0, 'its sea route carries nothing');
  ok(routeBlockaded(game, route), 'the route is held up');
  c.attacked = undefined;
  eq(cityHeal(game, c), 10, 'it heals half as fast');
  const mine = unit(game, 'trireme', 0, neighbours(game.grid, sea).find((t) => game.tiles[t].terrain === 'coast' && t !== sea)!);
  ok(!blockaded(game, c), 'a warship of its own breaks the blockade');
  mine.tile = at(25, 8);
  ok(blockaded(game, c), 'and it holds again once that ship sails off');
  unit(game, 'cargo_ship', 0, sea);
  ok(blockaded(game, c), 'a cargo ship breaks nothing');
  ship.tile = at(12, 8);
  ok(!blockaded(game, c), 'nor is it blockaded from beyond two tiles');
  eq(cityHeal(game, c), 20, 'and it heals in full');
  ship.tile = sea;
  game.players[0].bot = false;
  game.players[0].notes.length = 0;
  endTurn(game);
  ok(game.players[0].notes.some((n) => n.text.includes(`${c.name} is blockaded`)), 'its owner is told');
  eq(!!viewFor(game, game.players[0], null).cities.find((x) => x.id === c.id)?.blockaded, blockaded(game, c), 'the view shows the blockade as it stands');
});

test('an embargo declared by a civ: no trade routes, resource or research deals; lifted after its turns', () => {
  const { game, at } = blank();
  const [a, b] = game.players;
  a.met = [b.index];
  b.met = [a.index];
  a.gold = b.gold = 500;
  const home = city(game, 0, at(5, 5));
  const theirs = city(game, 1, at(12, 5));
  ok(!embargoed(game, a.index, b.index), 'no embargo to begin with');
  eq(declareEmbargo(game, a, b), null, 'declared');
  ok(embargoed(game, a.index, b.index) && embargoed(game, b.index, a.index), 'it goes both ways');
  ok(declareEmbargo(game, a, b) !== null, 'not twice');
  const caravan = unit(game, 'caravan', 0, home.tile);
  techsTo(game, 0, 1);
  ok((startRoute(game, a, caravan, theirs.id) ?? '').includes('embargo'), 'no trade route to them');
  ok((dealProblem(game, { from: a.index, to: b.index, items: [{ kind: 'goldPerTurn', from: a.index, amount: 1 }] }) ?? '').includes('embargoed'), 'no gold a turn');
  eq(dealProblem(game, { from: a.index, to: b.index, items: [{ kind: 'gold', from: a.index, amount: 10 }] }), null, 'gold now is still allowed');
  ok(game.relations!.events.some((e) => e.kind === 'embargo' && e.by === a.index && e.to === b.index), 'remembered');
  ok((liftEmbargo(game, a, b) ?? '').includes('more before'), 'not lifted at once');
  ok(liftEmbargo(game, b, a) !== null, 'only by the one who declared it');
  const r = viewFor(game, a, null).players[b.index].relation;
  ok(r?.embargoed === true && (r?.youEmbargo ?? 0) > 0, 'the view says so');
  game.turn += embargoTurns(game);
  ok(apply(game, a.index, { t: 'embargo', target: b.index, lift: true }).ok, 'lifted after its turns');
  ok(!embargoed(game, a.index, b.index), 'trade is open again');
  war(game, 0, 1);
  ok(declareEmbargo(game, a, b) !== null, 'not while at war');
});

// -------------------------------------------------------------------------------------------------
// Later eras and scenarios (`rules/starts.ts`)
// -------------------------------------------------------------------------------------------------

/** A new game of bots (and a person, the first seat, if asked) on a small map, with settings over the usual. */
function newGame(over: Partial<Settings>, civs = ['egypt', 'babylon', 'china', 'india'], person = false): Game {
  const settings: Settings = { size: 'small', type: 'continents', speed: 'standard', timer: 0, cityStates: 2, barbarians: false, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 500, disasters: false, ...over };
  return createGame(settings, civs.map((id, i) => ({ user: person && i === 0 ? 'name:you' : null, name: id, civ: id, bot: !(person && i === 0) })), 11);
}

test('an Ancient start is as it was: a Settler and a Warrior, no techs, no gold', () => {
  const game = newGame({});
  const p = game.players[0];
  eq(game.units.filter((u) => u.owner === 0).map((u) => u.type).join(','), 'settler,warrior', 'its units');
  eq(p.techs.length, 0, 'no techs');
  eq(p.gold, 0, 'no gold');
  const capital = foundCity(game, 0, game.units.find((u) => u.owner === 0 && u.type === 'settler')!.tile);
  eq(capital.pop, 1, 'its capital of one');
  eq(capital.buildings.join(','), 'palace', 'with only its palace');
  ok(!capital.free, 'nothing free');
});

test('a game begun in a later era: the techs before it, the age’s settlers, workers, army and gold', () => {
  const game = newGame({ startEra: 4 });
  const p = game.players[0];
  const start = ERA_STARTS[4];
  ok(p.techs.length > 0 && p.techs.every((t) => TECHS[t].col < 9), 'only techs before the Industrial Era');
  ok(TECH_LIST.filter((t) => t.col < 9).every((t) => p.techs.includes(t.id)), 'and all of them');
  eq(eraOf(p), 4, 'so it stands in the Industrial Era from the first turn, its techs still to learn');
  const mine = game.units.filter((u) => u.owner === 0);
  eq(mine.filter((u) => u.type === 'settler').length, start.settlers, 'its settlers');
  eq(mine.filter((u) => u.type === 'worker').length, start.workers, 'its workers');
  eq(mine.filter((u) => isMilitary(UNITS[u.type])).length, start.army.reduce((n, [, k]) => n + k, 0), 'its army');
  ok(mine.some((u) => u.type === 'musketman'), 'the age’s foot soldiers (Musketmen, not Warriors)');
  ok(!mine.some((u) => u.type === 'warrior'), 'no Warrior');
  eq(p.gold, start.gold, 'its gold (at Standard speed)');
  eq(mine.find((u) => u.type === 'settler')!.tile, mine[0].tile, 'a settler on the start');
  for (const u of mine) ok(game.units.filter((x) => x.tile === u.tile && (UNITS[x.type].strength > 0) === (UNITS[u.type].strength > 0)).length === 1, `${u.type}: one soldier and one civilian to a tile`);
  // City-states know the age too, and have two of its soldiers to guard them.
  const cs = game.players.find((x) => x.cityState)!;
  ok(cs.techs.length === p.techs.length, 'a city-state knows the age’s techs');
  eq(game.units.filter((u) => u.owner === cs.index && isMilitary(UNITS[u.type])).length, 2, 'and has two soldiers');
  // Egypt's own unit stands in for the age's where it has one; a civ with none fields the usual.
  eq(bestUnit('egypt', p.techs, 'mounted'), 'lancer', 'the strongest of its kind: a Lancer, not a Knight');
  const renaissance = techsBefore(3);
  eq(bestUnit('egypt', renaissance, 'mounted'), 'knight', 'a Knight before Metallurgy');
  eq(bestUnit('arabia', renaissance, 'mounted'), 'camel_archer', 'Arabia’s Camel Archer in its place');
  eq(bestUnit('egypt', [], 'warship'), null, 'no warship before Sailing');
});

test('a city founded in a later era: bigger, with the age’s buildings free of upkeep; the capital banks culture for its policies', () => {
  const game = newGame({ startEra: 4 });
  const p = game.players[0];
  const settlers = game.units.filter((u) => u.owner === 0 && u.type === 'settler');
  const before = goldUpkeep(game, p).buildings;
  const capital = foundCity(game, 0, settlers[0].tile);
  eq(capital.pop, 1 + ERA_STARTS[4].pop, 'founded with the age’s citizens');
  for (const b of ['monument', 'shrine', 'granary', 'library', 'walls', 'market', 'temple']) ok(capital.buildings.some((x) => x === b || BUILDINGS[x]?.replaces === b), `with a ${b}`);
  ok(capital.buildings.includes('burial_tomb'), 'Egypt’s own Burial Tomb in place of a Temple');
  eq(goldUpkeep(game, p).buildings, before, 'they cost no upkeep');
  ok(capital.buildings.includes('palace') && !capital.free!.includes('palace'), 'the palace is the capital’s as ever');
  let banked = 0;
  for (let n = 0; n < ERA_STARTS[4].policies; n++) banked += policyCost(game, p, n);
  eq(p.culture, banked, 'culture for the age’s first policies');
  const second = foundCity(game, 0, game.tiles.findIndex((t, i) => canFound(game, i) && !TERRAINS[t.terrain].water && distance(game.grid, i, capital.tile) > 4));
  eq(second.pop, 1 + ERA_STARTS[4].pop, 'every city is founded so');
  eq(p.culture, banked, 'but only the capital banks culture');
  // A city taken: its captor pays for what it took.
  war(game, 0, 1);
  cityHooks.captured(game, second, 1);
  eq(second.owner, 1, 'the second city taken');
  ok(!second.free, 'what it was founded with free, its captor pays for');
});

test('the Cold War: Nuclear Fission known, the Manhattan Project and two Atomic Bombs in the capital as it’s founded', () => {
  const game = newGame(withScenario({ size: 'small', type: 'continents', speed: 'quick', timer: 0, cityStates: 2, barbarians: true, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330 }, SCENARIOS.cold_war), undefined, true);
  const p = game.players[0];
  eq(startEraOf(game.settings), 6, 'an Atomic Era start');
  ok(p.techs.includes('nuclear_fission') && p.techs.includes('atomic_theory'), 'Nuclear Fission known, and what it needs');
  ok(!game.settings.barbarians && !game.settings.victories.culture, 'no barbarians, no culture victory');
  eq(game.settings.turnLimit, 150, 'its turns at Quick speed');
  ok(p.notes.some((n) => n.text.startsWith('Cold War.') && n.text.includes('Atomic Era')), 'the person is told how it begins');
  const settler = game.units.find((u) => u.owner === 0 && u.type === 'settler')!;
  ok(apply(game, 0, { t: 'found', unit: settler.id }).ok, 'the capital founded');
  const capital = game.cities.find((c) => c.owner === 0)!;
  ok(capital.buildings.includes('manhattan_project'), 'the Manhattan Project standing there');
  eq(game.units.filter((u) => u.owner === 0 && u.type === 'atomic_bomb' && u.tile === capital.tile).length, 2, 'two Atomic Bombs in it');
  ok(has(civEffects(game, p), 'enables_nukes'), 'nuclear weapons can be built');
  ok(trainOptions(game, p, capital).some((o) => o.id === 'atomic_bomb'), 'an Atomic Bomb is on the list (wanting Uranium)');
  const second = game.units.find((u) => u.owner === 0 && u.type === 'settler')!;
  const far = game.tiles.findIndex((t, i) => canFound(game, i) && !TERRAINS[t.terrain].water && distance(game.grid, i, capital.tile) > 4);
  second.tile = far;
  ok(apply(game, 0, { t: 'found', unit: second.id }).ok, 'a second city founded');
  eq(game.units.filter((u) => u.owner === 0 && u.type === 'atomic_bomb').length, 2, 'no more bombs with it');
});

test('World War: every civ at war with every other from the first turn, but its teammates; the city-states at peace', () => {
  const base: Settings = { size: 'small', type: 'continents', speed: 'quick', timer: 0, cityStates: 2, barbarians: true, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330 };
  const settings = withScenario(base, SCENARIOS.world_war);
  eq(startEraOf(settings), 5, 'a Modern Era start');
  ok(settings.victories.domination && !settings.victories.science && !settings.victories.culture && !settings.victories.diplomatic, 'only conquest (or the score) wins');
  const game = createGame(settings, ['egypt', 'babylon', 'china', 'india'].map((id, i) => ({ user: null, name: id, civ: id, bot: true, team: i < 2 ? 0 : undefined })), 3);
  const [a, b, c, d] = game.players;
  ok(!a.diplomacy.war[b.index] && !b.diplomacy.war[a.index], 'teammates at peace');
  ok(a.diplomacy.war[c.index] && c.diplomacy.war[a.index] && c.diplomacy.war[d.index] && b.diplomacy.war[d.index], 'everyone else at war');
  const cs = game.players.find((x) => x.cityState)!;
  ok(!a.diplomacy.war[cs.index] && !cs.diplomacy.war[c.index], 'the city-states out of it');
  const army = game.units.filter((u) => u.owner === c.index && isMilitary(UNITS[u.type])).length;
  eq(army, [...ERA_STARTS[5].army, ...SCENARIOS.world_war.army!].reduce((n, [, k]) => n + k, 0), 'twice the age’s army, near enough');
});

test('scenarios and later starts set their turns at each speed; picking an era sets its own', () => {
  const base: Settings = { size: 'small', type: 'continents', speed: 'quick', timer: 0, cityStates: 4, barbarians: true, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330 };
  eq(turnLimitFor(base), 330, 'an Ancient start: the usual');
  eq(turnLimitFor({ ...base, speed: 'marathon' }), 1500, 'at every speed');
  ok(turnLimitFor({ ...base, startEra: 6 }) < 330, 'an Atomic start: fewer');
  ok(TURN_CHOICES.includes(turnLimitFor({ ...base, startEra: 3, speed: 'epic' })), 'always one the lobby offers');
  const rivals = withScenario(base, SCENARIOS.ancient_rivals, 1);
  eq(rivals.size, 'duel', 'Ancient Rivals on a duel map');
  eq(rivals.turnLimit, 150, 'for 150 turns at Quick speed');
  eq(withScenario({ ...base, speed: 'standard' }, SCENARIOS.ancient_rivals).turnLimit, 150, 'a scenario of its own speed at that speed');
  eq(withScenario({ ...base, speed: 'standard' }, SCENARIOS.island_kings).turnLimit, 330, 'one without, more at Standard (the nearest offered)');
  eq(withScenario(base, SCENARIOS.ancient_rivals, 3).size, 'small', 'but not a map too small for the people playing');
  eq(withScenario(base, SCENARIOS.island_kings).type, 'archipelago', 'Island Kings among the islands');
  eq(startWords({ startEra: 4 }), 'Industrial Era start', 'a later start in words');
  eq(startWords({ startEra: 6, scenario: 'cold_war' }), 'Cold War', 'a scenario by its name');
  eq(startWords({}), '', 'an Ancient start unsaid');
});

test('Island Kings: Astronomy known, a Caravel and a Galleass at sea by each start', () => {
  const base: Settings = { size: 'small', type: 'continents', speed: 'quick', timer: 0, cityStates: 2, barbarians: true, victories: { domination: true, science: true, culture: true, diplomatic: true, score: true }, turnLimit: 330 };
  const game = createGame(withScenario(base, SCENARIOS.island_kings), ['egypt', 'babylon', 'china', 'india'].map((id) => ({ user: null, name: id, civ: id, bot: true })), 5);
  for (const p of game.players.filter((x) => !x.cityState && x.civ !== 'barbarian')) {
    ok(p.techs.includes('astronomy'), `${p.civ} knows Astronomy`);
    const ships = game.units.filter((u) => u.owner === p.index && UNITS[u.type].domain === 'sea');
    ok(ships.every((u) => TERRAINS[game.tiles[u.tile].terrain].water), `${p.civ}'s ships at sea`);
    ok(ships.length <= 2, `${p.civ}: no more than its two`);
  }
  ok(game.units.some((u) => u.type === 'caravel') && game.units.some((u) => u.type === 'galleass'), 'Caravels and Galleasses out on the water');
});

test('a bot leader spoken to answers as it feels: bold or meek at war, its stance at peace, a teammate as a friend', () => {
  // (You lead Egypt; Montezuma, Gandhi and Nebuchadnezzar the rest.)
  const game = newGame({}, ['egypt', 'aztec', 'india', 'babylon'], true);
  const [you, aztec, india, babylon] = game.players;
  const say = (bot: typeof you, said: { text?: string; emote?: string }) => botAnswer(game, bot, you, said, 0)!;
  // At peace with nothing between them: neutral, a wave back for a greeting.
  eq(moodOf(game, babylon, you), 'neutral', 'a stranger at peace is neutral');
  ok(say(babylon, { emote: 'wave' }).text.length > 0, 'and answers a wave');
  eq(toneOf('hello friend'), 'warm', 'a greeting is warm');
  eq(toneOf('you will die'), 'cold', 'a threat is cold');
  eq(toneOf('what are you building'), 'plain', 'a question is plain');
  // At war: bold Montezuma swaggers, Gandhi (no bolder than 2) wants it over while he's no stronger.
  aztec.diplomacy.war[you.index] = you.diplomacy.war[aztec.index] = true;
  india.diplomacy.war[you.index] = you.diplomacy.war[india.index] = true;
  eq(moodOf(game, aztec, you), 'bold', 'Montezuma at war is bold');
  eq(moodOf(game, india, you), 'meek', 'Gandhi at war is meek');
  const peace = say(india, { emote: 'peace' });
  ok(/peace|war end/i.test(peace.text), `Gandhi asked for peace talks of it: ${peace.text}`);
  ok(['peace', 'cry'].includes(peace.emote), 'with a dove');
  const taunt = say(aztec, { text: 'surrender now' });
  ok(!/peace|friend/i.test(taunt.text), `Montezuma doesn't take a threat kindly: ${taunt.text}`);
  ok(!/\{you\}/.test(say(aztec, { emote: 'gg' }).text), 'its words name you, not a blank');
  // Neither a city-state nor a person answers.
  const cs = game.players.find((p) => p.cityState);
  ok(!cs || botAnswer(game, cs, you, { text: 'hi' }, 0) === null, 'a city-state says nothing');
  ok(botAnswer(game, you, aztec, { text: 'hi' }, 0) === null, 'nor does a person (they answer for themselves)');
  // Teammates are friends.
  you.team = babylon.team = 0;
  eq(moodOf(game, babylon, you), 'friendly', 'a teammate is a friend');
});

test('the emotes and pings are a fixed few: anything else is refused', () => {
  ok(isEmote('wave') && isEmote('skull'), 'the faces');
  ok(!isEmote('toString') && !isEmote('<b>') && !isEmote(3), 'not anything else');
  ok(isPing('look') && isPing('attack') && isPing('defend'), 'the pings');
  ok(!isPing('nuke') && !isPing(undefined), 'not anything else');
  ok(Object.values(EMOTES).every((e) => e.name.length > 0), 'each with its words');
});

test('vassals: a capitulation ends the war, and from then the vassal’s wars and peace are its master’s', () => {
  const { game } = dealers(['egypt', 'babylon', 'germany', 'france']);
  const [egypt, babylon, germany] = game.players;
  // (People at war with people, all playing at once.)
  game.settings.hybridTurns = false;
  ok(apply(game, 0, { t: 'war', target: 1 }).ok, 'Egypt makes war on Babylon');
  ok(apply(game, 1, { t: 'war', target: 3 }).ok, 'and Babylon has a war of its own, on France');
  ok(dealProblem(game, { from: 0, to: 1, items: [{ kind: 'vassal', from: 0 }, { kind: 'vassal', from: 1 }] }) !== null, 'not both kneeling at once');
  ok(dealProblem(game, { from: 2, to: 3, items: [{ kind: 'vassal', from: 3 }] }) !== null, 'nor at peace');
  eq(dealProblem(game, { from: 0, to: 1, items: [{ kind: 'vassal', from: 1 }] }), null, 'a capitulation alone is a peace deal');
  makeDeal(game, { from: 0, to: 1, items: [{ kind: 'vassal', from: 1 }] });
  eq(masterOf(game, 1), egypt, 'Babylon serves Egypt');
  ok(!atWar(game, 0, 1), 'their war is over');
  ok(!atWar(game, 1, 3), 'and Babylon’s war on France with it (Egypt is at peace with France)');
  ok(babylon.diplomacy.openBorders[0] > 0 && egypt.diplomacy.openBorders[1] > 0, 'their borders open to each other');
  ok(babylon.diplomacy.embassy[0] && egypt.diplomacy.embassy[1], 'embassies both ways');
  ok(babylon.notes.some((n) => n.text.startsWith('You have capitulated to')) && egypt.notes.some((n) => n.text.includes('is your vassal now')), 'both are told');
  ok(sameSide(game, 0, 1) && vassalsOf(game, 0).includes(babylon), 'one side now');
  // A war on the vassal is a war on its master; its master's wars are its.
  ok(apply(game, 2, { t: 'war', target: 1 }).ok, 'Germany declares war on Babylon');
  ok(atWar(game, 2, 0) && atWar(game, 2, 1), 'and is at war with Egypt too');
  ok(egypt.notes.some((n) => n.text.includes('you stand with')), 'Egypt is told why');
  ok(!apply(game, 1, { t: 'peace', target: 2 }).ok, 'Babylon makes no peace of its own');
  ok(dealProblem(game, { from: 2, to: 1, items: [{ kind: 'peace' }] }) !== null, 'nor deals for one');
  ok(!apply(game, 1, { t: 'war', target: 3 }).ok, 'nor war');
  ok(!apply(game, 0, { t: 'war', target: 1 }).ok, 'and its master makes none on it');
  endWar(game, egypt, germany);
  ok(!atWar(game, 1, 2), 'Egypt’s peace with Germany is Babylon’s');
  ok(apply(game, 0, { t: 'war', target: 3 }).ok, 'Egypt declares war on France');
  ok(atWar(game, 1, 3), 'Babylon follows it');
  ok(dealProblem(game, { from: 3, to: 1, items: [{ kind: 'vassal', from: 1 }] }) !== null, 'a vassal can’t kneel to another');
  ok(dealProblem(game, { from: 3, to: 0, items: [{ kind: 'vassal', from: 0 }] }) !== null, 'nor its master (it has a vassal)');
  // On the screen: who serves whom, and the vassal's lot.
  const view = viewFor(game, babylon, null);
  eq(view.players[1].master, 0, 'its master shown');
  eq(view.self.vassal?.master, 0, 'and its own screen says whom it serves');
  ok(!!view.self.vassal?.why, `not free to go yet: ${view.self.vassal?.why}`);
});

test('vassals: a quarter of the vassal’s gold income is its master’s; it breaks free with half its master’s people after ten turns, is set free, or goes free when its master falls', () => {
  const { game, at } = dealers(['egypt', 'babylon', 'germany']);
  const [egypt, babylon, germany] = game.players;
  for (const c of game.cities) c.pop = c.owner === 0 ? 8 : 2;
  kneel(game, babylon, egypt);
  babylon.gold = 100;
  egypt.gold = 0;
  babylon.lastIncome = { gold: 22, science: 0, culture: 0, faith: 0, happiness: 0, tourism: 0 };
  vassalsTurn(game);
  eq(tributeOf(22), 5, 'a quarter (rounded down)');
  eq(babylon.gold, 95, 'paid by the vassal');
  eq(egypt.gold, 5, 'to its master');
  eq(babylon.vassal?.tribute, 5, 'and kept for the screens');
  eq(tributeOf(-10), 0, 'nothing of a loss');
  eq(viewFor(game, egypt, null).players[1].relation?.tribute, 5, 'its master sees what it got');
  egypt.bot = babylon.bot = true;
  eq(moodOf(game, egypt, babylon), 'master', 'a master speaks to its vassal as one');
  eq(moodOf(game, babylon, egypt), 'vassal', 'and its vassal back');
  egypt.bot = babylon.bot = false;
  // Independence: not before ten turns' service, nor with too few people.
  ok(/served/.test(breakFree(game, babylon) ?? ''), 'too soon');
  babylon.vassal!.since = game.turn - SERVICE;
  ok(/half/.test(breakFree(game, babylon) ?? ''), `too few people (${breakFree(game, babylon)})`);
  game.cities.find((c) => c.owner === 1)!.pop = 4;
  eq(breakFree(game, babylon), null, 'with half its master’s people, it breaks free');
  ok(!masterOf(game, 1), 'free');
  eq(babylon.diplomacy.peaceTurns[0], 10, 'a peace treaty between them');
  ok(!(babylon.diplomacy.openBorders[0] > 0), 'their borders close');
  ok(opinionOf(game, egypt, babylon).reasons.some((r) => r.text === 'You broke free of us' && r.value < 0), 'Egypt doesn’t forget it');
  // Set free by its master.
  kneel(game, babylon, egypt);
  ok(release(game, germany, babylon) !== null, 'only its master sets it free');
  eq(release(game, egypt, babylon), null, 'Egypt sets Babylon free');
  ok(!masterOf(game, 1) && opinionOf(game, babylon, egypt).reasons.some((r) => r.text === 'You set us free' && r.value > 0), 'free, and grateful');
  // Its master gone, it serves no one.
  kneel(game, babylon, egypt);
  egypt.alive = false;
  ok(!masterOf(game, 1), 'a fallen master is no master');
  vassalsTurn(game);
  ok(!babylon.vassal && babylon.notes.some((n) => n.text.includes('serve no one')), 'and it is told it is free');
  void at;
});

test('vassals: a master holds its vassals’ capitals toward domination; a vassal wins nothing of its own', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany'], { size: 'small' });
  game.settings.victories = { domination: true, science: false, culture: false, diplomatic: false, score: true };
  const capitals = [at(3, 3), at(14, 3), at(24, 14)].map((t, i) => city(game, i, t));
  capitals[2].owner = 0;
  for (const t of game.tiles) if (t.city === capitals[2].id) t.owner = 0;
  checkVictory(game);
  ok(!game.over, 'Babylon still holds its capital');
  kneel(game, game.players[1], game.players[0]);
  checkVictory(game);
  ok(game.over?.how === 'domination' && game.over.winner === 0, `Babylon’s capital held for Egypt by its vassal: Egypt has conquered the world (${JSON.stringify(game.over)})`);
  // All that's left of the world kneeling: conquered too.
  const two = blank(['egypt', 'babylon'], { size: 'small' });
  two.game.settings.victories = { domination: true, science: false, culture: false, diplomatic: false, score: false };
  [two.at(3, 3), two.at(16, 3)].forEach((t, i) => city(two.game, i, t));
  kneel(two.game, two.game.players[1], two.game.players[0]);
  checkVictory(two.game);
  eq(two.game.over?.winner, 0, 'its only rival its vassal, Egypt has conquered the world');
  // On score, a vassal never wins.
  const late = blank(['egypt', 'babylon'], { size: 'small' });
  late.game.settings.victories.score = true;
  late.game.settings.turnLimit = 0;
  [late.at(3, 3), late.at(16, 3)].forEach((t, i) => city(late.game, i, t));
  late.game.players[1].techs = Object.keys(TECHS).slice(0, 12);
  kneel(late.game, late.game.players[1], late.game.players[0]);
  checkVictory(late.game);
  eq(late.game.over?.winner, 0, 'the master wins on score, its richer vassal no matter');
});

test('vassals: a beaten bot kneels (to the winner, not before it’s beaten); the winner takes it, and demands it of a beaten person', () => {
  const { game, at } = blank(['egypt', 'babylon'], { size: 'small' });
  const [egypt, babylon] = game.players;
  for (const p of game.players) p.met = [0, 1];
  [at(3, 3), at(6, 3), at(9, 3)].forEach((t) => city(game, 0, t));
  const lost = [at(14, 8), at(18, 8), at(22, 8)].map((t) => city(game, 1, t));
  for (let i = 0; i < 8; i++) unit(game, 'swordsman', 0, at(3 + i, 6));
  unit(game, 'warrior', 1, at(22, 11));
  ok(apply(game, 0, { t: 'war', target: 1 }).ok, 'war');
  for (const p of game.players) trackWars(makeCtx(game, p));
  const asked = { from: 0, to: 1, items: [{ kind: 'vassal', from: 1 }] } as const;
  const no = evaluate(game, babylon, { ...asked, items: [...asked.items] });
  ok(!no.accept, `not beaten yet (no city lost): Babylon won’t kneel (${no.why})`);
  // Two cities lost to an army many times its own.
  for (const c of lost.slice(0, 2)) {
    c.owner = 0;
    for (const t of game.tiles) if (t.city === c.id) t.owner = 0;
  }
  ok(kneels(makeCtx(game, babylon), 0), 'beaten, it would kneel');
  ok(evaluate(game, babylon, { ...asked, items: [...asked.items] }).accept, 'and accepts the demand');
  ok(evaluate(game, egypt, { from: 1, to: 0, items: [{ kind: 'vassal', from: 1 }] }).accept, 'Egypt would take its capitulation');
  // Babylon a person now: Egypt, winning a war some turns old, demands it (every few turns).
  babylon.bot = false;
  egypt.ai!.wars[1].since = game.turn - 10;
  egypt.ai!.wars[1].theirCities = 3;
  while ((game.turn + 0) % 5 !== 0) game.turn++;
  makePeace(makeCtx(game, egypt));
  const offer = relationsOf(game).offers.find((o) => o.from === 0 && o.to === 1);
  ok(!!offer && offer.items.some((x) => x.kind === 'vassal' && x.from === 1), `Egypt demands Babylon kneel (${JSON.stringify(offer?.items)})`);
  ok(atWar(game, 0, 1), 'the war goes on till it answers');
});

// -------------------------------------------------------------------------------------------------
// Eurekas
// -------------------------------------------------------------------------------------------------

test('eurekas: a deed brings its tech a third of the way, once, even before it can be researched', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const p = game.players[0];
  p.bot = false;
  p.techs = ['agriculture'];
  const c = city(game, 0, at(5, 5));
  const mine = neighbours(game.grid, c.tile)[0];
  checkEurekas(game, p);
  ok(!p.eurekas?.includes('the_wheel'), 'no Mine, no boost');
  game.tiles[mine].improvement = 'mine';
  checkEurekas(game, p);
  ok(!!p.eurekas?.includes('the_wheel'), 'a Mine built: The Wheel’s eureka');
  eq(p.research.the_wheel, Math.round(techCost(game, p, 'the_wheel') * EUREKA_SHARE), 'a third of it researched, though Animal Husbandry isn’t known yet');
  ok(p.notes.some((n) => n.text === 'Eureka! You built a Mine: The Wheel is a third of the way researched.'), `told (${p.notes.map((n) => n.text).join(' / ')})`);
  checkEurekas(game, p);
  eq(p.research.the_wheel, Math.round(techCost(game, p, 'the_wheel') * EUREKA_SHARE), 'had once only');
  eq(viewFor(game, p, null).self.eurekas.join(), p.eurekas!.join(), 'in their view, for the tree');
  // A pillaged Mine is no Mine; a tech known has no boost to give.
  const q = game.players[1];
  q.techs = ['agriculture', 'animal_husbandry', 'the_wheel'];
  const d = city(game, 1, at(16, 12));
  const theirs = neighbours(game.grid, d.tile)[0];
  Object.assign(game.tiles[theirs], { improvement: 'mine', pillaged: true });
  checkEurekas(game, q);
  ok(!q.eurekas?.length, `nothing for a known tech or a pillaged Mine (${q.eurekas})`);
  // The boost waiting in it counts once it's researched: the rest is less.
  p.techs.push('animal_husbandry');
  p.researching = 'the_wheel';
  p.research.the_wheel = techCost(game, p, 'the_wheel') - 1;
  endTurn(game);
  ok(p.techs.includes('the_wheel'), 'learned with the science that was left');
});

test('eurekas: kills count by what killed (a civ’s own unit as the one it replaces), and barbarians apart', () => {
  const { game, at, a, d } = duel('swordsman', 'warrior');
  const p = game.players[0];
  p.bot = false;
  city(game, 0, at(2, 2));
  d.hp = 1;
  ok(apply(game, 0, { t: 'attack', unit: a.id, target: d.tile }).ok, 'attack');
  ok(!game.units.includes(d), 'the warrior is killed');
  eq(p.deeds?.kill, 1, 'a kill');
  eq(p.deeds?.['kill:swordsman'], 1, 'by a Swordsman');
  ok(!!p.eurekas?.includes('archery') && !!p.eurekas?.includes('steel'), `Archery and Steel boosted (${p.eurekas})`);
  ok(!p.eurekas?.includes('bronze_working'), 'not Bronze Working: no barbarians yet');
  // Three barbarians killed: Bronze Working.
  const barb = blank(['egypt', 'babylon'], { barbarians: true });
  const b = barb.game.players.findIndex((x) => x.civ === 'barbarian');
  const me = barb.game.players[0];
  for (let i = 0; i < 3; i++) killDeeds(barb.game, me, 'warrior', b);
  checkEurekas(barb.game, me);
  eq(me.deeds?.barbarian, 3, 'three barbarians');
  ok(!!me.eurekas?.includes('bronze_working'), 'Bronze Working boosted');
  // Babylon's Bowmen are Archers: three of them for Machinery.
  const bab = blank(['babylon', 'egypt']);
  const babylon = bab.game.players[0];
  for (let i = 0; i < 3; i++) unit(bab.game, 'bowman', 0, bab.at(4 + i, 4));
  checkEurekas(bab.game, babylon);
  ok(!!babylon.eurekas?.includes('machinery'), `three Bowmen are three Archers (${babylon.eurekas})`);
});

test('eurekas: a team has each boost once, pooled into its research, and all of them are told', () => {
  const { game, at } = blank(['egypt', 'babylon', 'germany']);
  teamUp(game, [0, 1]);
  const [a, b] = game.players;
  for (const p of [a, b]) {
    p.bot = false;
    p.techs = ['agriculture'];
  }
  const ca = city(game, 0, at(3, 3));
  const cb = city(game, 1, at(14, 3));
  game.tiles[neighbours(game.grid, ca.tile)[0]].improvement = 'mine';
  game.tiles[neighbours(game.grid, cb.tile)[0]].improvement = 'mine';
  checkEurekas(game, a);
  checkEurekas(game, b);
  shareResearch(game);
  const third = Math.round(techCost(game, a, 'the_wheel') * EUREKA_SHARE);
  eq(a.research.the_wheel, third, 'once for the team');
  eq(b.research.the_wheel, third, 'the same for both');
  ok(!!b.eurekas?.includes('the_wheel'), 'had by both');
  ok(b.notes.some((n) => n.text === `Eureka! ${a.name} built a Mine: The Wheel is a third of the way researched.`), `the teammate told who did it (${b.notes.map((n) => n.text).join(' / ')})`);
});

test('eurekas: a bot has its boosts as its turn ends, and goes for the tech they make cheap', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const p = game.players[0];
  p.techs = ['agriculture', 'pottery', 'animal_husbandry', 'archery', 'mining'];
  city(game, 0, at(5, 5));
  p.pantheon = 'god_of_war';
  endTurn(game);
  ok(!!p.eurekas?.includes('calendar'), 'a pantheon: Calendar boosted');
  ok(eurekaDone('Have Cattle or Sheep in your land', 'Ana') === 'Ana has Cattle or Sheep in their land', 'said of a teammate');
  // Nearly done thanks to its boost (and what it's put in since), a tech goes to the top of a bot's list.
  p.researching = null;
  p.research.masonry = techCost(game, p, 'masonry') - 1;
  const ctx = makeCtx(game, p);
  ctx.mem.techGoal = undefined;
  research(ctx);
  eq(p.researching, 'masonry', 'Masonry, a turn from done');
});

test('clans: a camp is a clan’s; one bribed leaves its briber (and its team) alone for a while; only a civ that has found its camp deals with it', () => {
  const { game, at } = blank(['egypt', 'babylon'], { barbarians: true });
  const [egypt, babylon] = game.players;
  const b = game.players.findIndex((x) => x.civ === 'barbarian');
  eq(game.players.filter((x) => x.unsettled && x.cityState && !x.alive).length, CLAN_STATES, 'city-states kept out of the game for the clans');
  const camp = at(12, 8);
  game.tiles[camp].camp = true;
  const clan = newClan(game, camp);
  ok(clan.name.length > 0 && clansOf(game).includes(clan), 'a clan, named');
  egypt.gold = babylon.gold = 500;
  const bribe: Order = { t: 'clan', clan: clan.id, act: 'bribe', target: null };
  ok(!apply(game, 0, bribe).ok, 'not before its camp is found');
  egypt.explored[camp] = 1;
  ok(apply(game, 0, bribe).ok, 'bribed');
  eq(egypt.gold, 500 - clanCost(game, egypt, 'bribe'), 'paid for');
  ok(!apply(game, 0, bribe).ok, 'not again while it holds');
  // Its raiders: one beside an Egyptian warrior, one beside a Babylonian.
  const mine = unit(game, 'warrior', 0, at(14, 3));
  const theirs = unit(game, 'warrior', 1, at(14, 13));
  unit(game, 'warrior', b, at(15, 3), { clan: clan.id });
  unit(game, 'warrior', b, at(15, 13), { clan: clan.id });
  barbarianTurn(game);
  ok(game.units.includes(mine) && mine.hp === 100, 'the Egyptian left alone');
  ok(!game.units.includes(theirs) || theirs.hp < 100, 'the Babylonian attacked');
  egypt.team = babylon.team = 0;
  ok(spares(game, clan, 1), 'a teammate of its briber spared too');
  egypt.team = babylon.team = undefined;
  ok(!spares(game, clan, 1), 'not otherwise');
  // Seen by the civ that found it (and that bribed it), not by another.
  const seen = viewFor(game, egypt, null).clans;
  eq(seen.length, 1, 'Egypt sees the clan');
  eq(seen[0].bribed, bribeTurns(game), 'its bribe’s turns');
  eq(viewFor(game, babylon, null).clans.length, 0, 'Babylon, which hasn’t found it, doesn’t');
  // The bribe lapses.
  game.turn += bribeTurns(game);
  clansTurn(game);
  ok(!spares(game, clan, 0), 'the bribe has lapsed');
  ok(apply(game, 0, bribe).ok, 'and can be paid again');
});

test('clans: a warrior hired now and then; a clan paid to raid a civ goes after it, and it learns of it (who paid, sometimes)', () => {
  const { game, at } = blank(['egypt', 'babylon'], { barbarians: true });
  const [egypt, babylon] = game.players;
  babylon.bot = false;
  const b = game.players.findIndex((x) => x.civ === 'barbarian');
  const camp = at(12, 8);
  game.tiles[camp].camp = true;
  const clan = newClan(game, camp);
  egypt.explored[camp] = 1;
  egypt.gold = 2000;
  const hire: Order = { t: 'clan', clan: clan.id, act: 'hire', target: null };
  ok(apply(game, 0, hire).ok, 'a warrior hired');
  const hired = game.units[game.units.length - 1];
  eq(hired.owner, 0, 'Egypt’s');
  eq(hired.type, clanUnit(game), 'the clan’s warrior');
  eq(distance(game.grid, hired.tile, camp), 1, 'by the camp');
  eq(egypt.gold, 2000 - clanCost(game, egypt, 'hire'), 'paid for');
  ok(!apply(game, 0, hire).ok, 'not another so soon');
  game.turn += hireRest(game);
  ok(apply(game, 0, hire).ok, 'another, later');
  // Paid to raid Babylon.
  const home = city(game, 1, at(20, 8));
  const incite = (target: number): Order => ({ t: 'clan', clan: clan.id, act: 'incite', target });
  ok(!apply(game, 0, incite(1)).ok, 'not on a civ Egypt hasn’t met');
  egypt.met = [1];
  babylon.met = [0];
  ok(!apply(game, 0, incite(0)).ok, 'not on Egypt itself');
  ok(apply(game, 0, incite(1)).ok, 'paid to raid Babylon');
  eq(raidTarget(game, clan), 1, 'it raids Babylon');
  eq(game.units.filter((u) => u.clan === clan.id).length, 2, 'two raiders out at once');
  ok(spares(game, clan, 0), 'and spares Egypt');
  ok(!apply(game, 0, incite(1)).ok, 'not twice at once');
  const told = babylon.notes.find((n) => n.text.startsWith(`The ${clan.name} clan has been paid to raid your lands`));
  ok(!!told, 'Babylon is told');
  const named = told!.text.includes(egypt.name);
  eq(opinionOf(game, babylon, egypt).reasons.some((r) => r.text === 'You paid barbarians to raid us'), named, 'remembered against Egypt if it found out who paid');
  // A raider of the clan twelve tiles off heads for Babylon; one of another clan doesn't.
  const raider = unit(game, 'warrior', b, at(8, 8), { clan: clan.id });
  const other = unit(game, 'warrior', b, at(8, 14));
  barbarianTurn(game);
  ok(!!raider.path?.length && distance(game.grid, raider.path[raider.path.length - 1], home.tile) <= 1, `the paid raider makes for Babylon (${raider.path})`);
  ok(!other.path?.length || distance(game.grid, other.path[other.path.length - 1], home.tile) > 1, 'the other wanders');
  game.turn += inciteTurns(game);
  clansTurn(game);
  eq(raidTarget(game, clan), null, 'the raid paid for is over');
});

test('clans: one left alone grows into a city-state where its camp was, its raiders by it its soldiers; a raider killed sets it back; a camp cleared ends it', () => {
  const { game, at } = blank(['egypt', 'babylon', 'greece'], { barbarians: true });
  const [egypt, babylon, greece] = game.players;
  egypt.bot = false;
  const b = game.players.findIndex((x) => x.civ === 'barbarian');
  egypt.techs = ['agriculture', 'pottery', 'mining'];
  babylon.techs = ['agriculture', 'pottery', 'archery'];
  greece.techs = ['agriculture'];
  const camp = at(12, 8);
  game.tiles[camp].camp = true;
  const clan = newClan(game, camp);
  egypt.explored[camp] = 1;
  const guard = unit(game, 'spearman', b, at(13, 8), { clan: clan.id });
  const far = unit(game, 'warrior', b, at(22, 8), { clan: clan.id });
  clansTurn(game);
  near(clan.growth, 1 / speed(game), 'it grows each turn');
  // A raider killed: it loses heart.
  clan.growth = 50;
  die(game, unit(game, 'warrior', b, at(12, 13), { clan: clan.id }), null);
  eq(clan.growth, 40, 'a raider killed');
  // Grown, but in Egypt's land: it stays a camp.
  clan.growth = SETTLE;
  game.tiles[camp].owner = 0;
  clansTurn(game);
  ok(game.tiles[camp].camp && clansOf(game).includes(clan), 'not in Egypt’s land');
  game.tiles[camp].owner = -1;
  clansTurn(game);
  const c = cityAt(game, camp);
  ok(!!c, 'a city where the camp was');
  const cs = game.players[c!.owner];
  ok(!!cs.cityState && cs.alive && !cs.unsettled, `${cs.name}, a city-state, in the game now`);
  ok(!game.tiles[camp].camp && !clansOf(game).includes(clan), 'the camp and the clan gone');
  eq(guard.owner, cs.index, 'its raider by it its soldier');
  ok(far.owner === b && far.clan === undefined, 'one far off a lone barbarian');
  eq([...cs.techs].sort().join(), 'agriculture,pottery', 'the techs most civs know');
  ok(egypt.notes.some((n) => n.text === `The ${clan.name} clan has settled down: its camp is now ${c!.name}, a city-state.`), 'Egypt, which found the camp, is told');
  eq(game.players.filter((x) => x.unsettled).length, CLAN_STATES - 1, 'one city-state left for the clans');
  // Another camp, cleared: its clan is no more, and its raiders lone barbarians; the one clearing it told whose it was.
  const camp2 = at(6, 14);
  game.tiles[camp2].camp = true;
  const clan2 = newClan(game, camp2);
  const lone = unit(game, 'warrior', b, at(3, 3), { clan: clan2.id });
  const w = unit(game, 'warrior', 0, camp2);
  campHooks.onCamp(game, w);
  ok(!clansOf(game).includes(clan2) && lone.clan === undefined, 'the clan ended');
  ok(egypt.notes.some((n) => n.text === `You have cleared the camp of the ${clan2.name} clan: 25 gold.`), 'named when cleared');
  // A camp from before there were clans has one by the next turn.
  const camp3 = at(4, 4);
  game.tiles[camp3].camp = true;
  clansTurn(game);
  ok(clansOf(game).some((x) => x.tile === camp3), 'an old camp given a clan');
});

test('barbarians: a worker they take is led back to its captors’ camp (not into a fight), and taken back on the way or by clearing the camp', () => {
  const { game, at } = blank(['egypt', 'babylon'], { barbarians: true });
  const [egypt] = game.players;
  egypt.bot = false;
  const b = game.players.findIndex((x) => x.civ === 'barbarian');
  const camp = at(18, 10);
  game.tiles[camp].camp = true;
  const clan = newClan(game, camp);
  city(game, 0, at(6, 10));
  // (A soldier of Egypt's by its land: the worker, taken, once went for it as a raider would, and died.)
  unit(game, 'warrior', 0, at(9, 12), { stance: 'fortify' });
  const worker = unit(game, 'worker', 0, at(11, 10), { auto: 'work' });
  unit(game, 'warrior', b, at(12, 10), { clan: clan.id });
  barbarianTurn(game);
  ok(game.units.includes(worker) && worker.owner === b, 'the worker is the barbarians’');
  ok(worker.clan === clan.id && !worker.auto, 'its captors’ clan’s, and no longer at work for Egypt');
  ok(egypt.notes.some((n) => n.text.startsWith('Your Worker was captured by barbarians, who are taking it back to their camp')), 'Egypt is told where it’s taken');
  for (let i = 0; i < 10 && game.units.includes(worker) && worker.tile !== camp; i++) endTurn(game);
  ok(game.units.includes(worker) && worker.owner === b, 'it’s still there, the barbarians’');
  eq(worker.tile, camp, 'it has walked back to the camp');
  endTurn(game);
  eq(worker.tile, camp, 'and waits there');
  // Caught on the way: Egypt's again.
  const captive = unit(game, 'worker', b, at(10, 4), { clan: clan.id });
  const rescuer = unit(game, 'warrior', 0, at(9, 4));
  egypt.notes = [];
  ok(apply(game, 0, { t: 'move', unit: rescuer.id, to: captive.tile }).ok, 'stepped on');
  ok(captive.owner === 0 && captive.clan === undefined, 'taken back, no clan’s');
  ok(egypt.notes.some((n) => n.text === 'You have freed a Worker from the barbarians.'), 'Egypt is told');
  // The camp cleared: the worker in it Egypt's.
  const defender = unit(game, 'warrior', b, camp, { clan: clan.id, hp: 1 });
  const attacker = unit(game, 'swordsman', 0, neighbours(game.grid, camp)[0]);
  ok(apply(game, 0, { t: 'attack', unit: attacker.id, target: camp }).ok, 'the camp attacked');
  ok(!game.units.includes(defender) && attacker.tile === camp && !game.tiles[camp].camp, 'its defender killed, the camp cleared');
  eq(worker.owner, 0, 'the worker in it taken back');
});

test('clans: a bot bribes a clan by its cities, pays one near its enemy to raid it, and hires a warrior at war', () => {
  const { game, at } = blank(['egypt', 'babylon'], { barbarians: true });
  const [egypt] = game.players;
  city(game, 0, at(8, 8));
  city(game, 1, at(20, 8));
  const camp = at(12, 8);
  game.tiles[camp].camp = true;
  const clan = newClan(game, camp);
  egypt.explored[camp] = 1;
  egypt.gold = 3000;
  const tries = (done: () => boolean) => {
    for (let i = 0; i < 60 && !done(); i++) botClans(makeCtx(game, egypt));
    return done();
  };
  ok(tries(() => !!clan.bribes?.[0]), 'bribed');
  ok(raidTarget(game, clan) === null && clan.hired === undefined, 'nothing more at peace');
  egypt.met = [1];
  game.players[1].met = [0];
  war(game, 0, 1);
  ok(tries(() => raidTarget(game, clan) === 1), 'paid to raid Babylon');
  ok(tries(() => clan.hired !== undefined), 'a warrior hired');
});

test('formations: two of a kind side by side join as a corps, and a third as an army: far stronger, at Civ VI’s upkeep, holding their units’ resources', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const egypt = game.players[0];
  egypt.bot = false;
  const a = unit(game, 'rifleman', 0, at(8, 8));
  const b = unit(game, 'rifleman', 0, at(9, 8));
  // (Upkeep is paid past the first few units: a few more to be paid for.)
  for (let i = 0; i < 4; i++) unit(game, 'warrior', 0, at(2 + i, 2));
  const join: Order = { t: 'merge', unit: a.id, other: b.id };
  ok(!apply(game, 0, join).ok, 'not before Military Science');
  ok(!viewFor(game, egypt, null).units.find((w) => w.id === a.id)!.merge, 'nor offered');
  egypt.techs.push(CORPS_TECH);
  const offer = viewFor(game, egypt, null).units.find((w) => w.id === a.id)!.merge;
  eq(JSON.stringify(offer), JSON.stringify({ other: b.id, size: 2, why: null }), 'offered, with the Rifleman beside it');
  ok(!!mergeProblem(game, egypt, a, unit(game, 'warrior', 0, at(8, 9))), 'not with a unit of another kind');
  ok(!!mergeProblem(game, egypt, a, unit(game, 'rifleman', 0, at(11, 8))), 'nor one not beside it');
  const lone = strength(game, a, 'defend', null, a.tile);
  const upkeep = goldUpkeep(game, egypt).units;
  a.hp = 60;
  b.xp = 30;
  b.promotions = ['shock_1'];
  ok(apply(game, 0, join).ok, 'joined');
  ok(!game.units.includes(b) && a.size === 2, 'one unit, of two');
  eq(unitName(a), 'Rifleman Corps', 'named');
  eq(a.hp, 80, 'their hit points shared out');
  ok(a.xp === 30 && a.promotions.includes('shock_1'), 'the more experienced one’s experience and promotions');
  eq(a.moves, 0, 'its turn spent');
  near(strength(game, { ...a, hp: 100, promotions: [] }, 'defend', null, a.tile) / lone, 1 + CORPS_BONUS / 100, 'a corps’s strength');
  // (Its bonus multiplies the rest, so it isn't watered down fortified on a hill: Civ VI's flat +10.)
  const hill = { ...game.tiles[a.tile] };
  Object.assign(game.tiles[a.tile], { elevation: 'hills', feature: undefined });
  const dug = { stance: 'fortify' as const, fortified: 2 };
  near(strength(game, { ...a, hp: 100, promotions: [], ...dug }, 'defend', null, a.tile) / strength(game, { ...a, hp: 100, promotions: [], size: undefined, ...dug }, 'defend', null, a.tile), 1 + CORPS_BONUS / 100, 'as strong again fortified on a hill');
  game.tiles[a.tile] = hill;
  // (Eight units' worth, three free, before; seven and a half after.)
  eq(goldUpkeep(game, egypt).units, upkeep - 1, 'upkeep a unit and a half’s');
  ok(egypt.notes.some((n) => n.text.includes('A Rifleman Corps has formed')), 'said so');
  // An army: with Replaceable Parts, a corps and a third.
  const c = unit(game, 'rifleman', 0, at(7, 8));
  a.moves = 2;
  ok(!apply(game, 0, { t: 'merge', unit: a.id, other: c.id }).ok, 'not before Replaceable Parts');
  techsTo(game, 0, 11);
  const third = unit(game, 'rifleman', 0, at(20, 4));
  const single = upgradeCost(game, egypt, third);
  ok(apply(game, 0, { t: 'merge', unit: a.id, other: c.id }).ok, 'an army');
  eq(unitName(a), 'Rifleman Army', 'named');
  near(strength(game, { ...a, hp: 100, promotions: [] }, 'defend', null, a.tile) / lone, 1 + ARMY_BONUS / 100, 'an army’s strength');
  eq(upgradeCost(game, egypt, a), single * 3, 'its upgrade as three units’');
  a.moves = 2;
  ok(!!mergeProblem(game, egypt, a, unit(game, 'rifleman', 0, at(8, 7))), 'no bigger than an army');
  // At sea, a fleet; a strategic resource used for each of its units.
  const f = unit(game, 'frigate', 0, at(1, 16));
  const g = unit(game, 'frigate', 0, at(2, 16));
  const iron = strategic(game, egypt).iron?.used ?? 0;
  ok(apply(game, 0, { t: 'merge', unit: f.id, other: g.id }).ok, 'ships too');
  eq(unitName(f), 'Frigate Fleet', 'a fleet');
  eq(strategic(game, egypt).iron?.used ?? 0, iron, 'its iron as two ships’');
  ok(!forms('great_general') && !forms('settler') && !forms('fighter') && !forms('carrier'), 'not great people, civilians, aircraft or carriers');
  // Seen by others as one, its size known.
  eq(viewFor(game, game.players[1], null).units.find((w) => w.id === a.id)?.size ?? 3, 3, 'others see an army');
});

test('formations: one that can’t be paid for loses a unit, not the lot', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const egypt = game.players[0];
  egypt.bot = false;
  city(game, 0, at(20, 4));
  // (Each army's upkeep two units', Civ VI's.)
  for (let i = 0; i < 6; i++) unit(game, 'rifleman', 0, at(3 + i * 2, 4), { size: 3 });
  egypt.gold = 0;
  endTurn(game);
  eq(game.units.filter((u) => u.owner === 0).reduce((s, u) => s + (u.size ?? 1), 0), 17, 'a unit of one army gone');
  eq(game.units.filter((u) => u.owner === 0).length, 6, 'every army still there');
  ok(egypt.notes.some((n) => n.text.includes('a unit of your Rifleman Army has disbanded')), 'said so');
});

test('formations: a bot forms corps once it can, out of the enemy’s reach, never taking a garrison', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  const babylon = game.players[1];
  techsTo(game, 1, 9);
  const home = city(game, 1, at(5, 12));
  const garrison = unit(game, 'rifleman', 1, home.tile);
  const by = unit(game, 'rifleman', 1, neighbours(game.grid, home.tile)[0]);
  const a = unit(game, 'rifleman', 1, at(14, 4));
  const b = unit(game, 'rifleman', 1, at(15, 4));
  const c = unit(game, 'rifleman', 1, at(20, 14));
  const d = unit(game, 'rifleman', 1, at(21, 14));
  war(game, 0, 1);
  unit(game, 'rifleman', 0, at(23, 14));
  formations(makeCtx(game, babylon), new Set([garrison.id]));
  ok(a.size === 2 && !game.units.includes(b), 'two side by side, out of reach, joined');
  ok(game.units.includes(garrison) && game.units.includes(by) && !garrison.size && !by.size, 'not the garrison');
  ok(game.units.includes(c) && game.units.includes(d) && !c.size && !d.size, 'not those in the enemy’s reach');
});

test('combat bonuses, Civ V’s: spears +50% against horses, anti-tank +100% against armour, siege +200% against cities and no ground to hide in, armour unhindered at walls and moving on after it attacks', () => {
  const { game, at } = blank(['egypt', 'babylon']);
  war(game, 0, 1);
  const mod = (u: Unit, role: 'attack' | 'defend' | 'ranged', against: Unit | City, label: string) => {
    const why: Modifier[] = [];
    strength(game, u, role, against, u.tile, why);
    return why.find((m) => m.label === label)?.percent ?? 0;
  };
  const spear = unit(game, 'spearman', 0, at(8, 8));
  const horse = unit(game, 'horseman', 1, at(9, 8));
  eq(mod(spear, 'defend', horse, 'Against mounted'), 50, 'spearmen against horses');
  const lancer = unit(game, 'lancer', 0, at(8, 10));
  ok(promotionsOf(lancer).includes('formation_1') && mod(lancer, 'attack', horse, 'Formation I') === 33, 'a lancer’s Formation I instead');
  const gun = unit(game, 'anti_tank_gun', 0, at(4, 4));
  const tank = unit(game, 'tank', 1, at(5, 4));
  eq(mod(gun, 'defend', tank, 'Against armour'), 100, 'anti-tank guns against armour');
  const walls = city(game, 1, at(14, 8));
  const catapult = unit(game, 'catapult', 0, at(12, 8));
  eq(mod(catapult, 'ranged', walls, 'Against cities'), 200, 'siege against cities');
  eq(mod(tank, 'attack', walls, 'Against cities'), 0, 'armour at walls as anywhere');
  eq(mod(horse, 'attack', walls, 'Against cities'), -33, 'horses still a third weaker');
  Object.assign(game.tiles[catapult.tile], { elevation: 'hills', feature: undefined });
  eq(mod(catapult, 'defend', spear, 'Hills'), 0, 'no hills for a catapult to hide in');
  eq(unitSight(game, catapult), 1, 'and a tile of sight');
  ok(isRanged(UNITS.bazooka) && UNITS.bazooka.range === 1, 'a bazooka fires');
  // Armour moves on after it attacks, as horses do.
  const raider = unit(game, 'tank', 0, at(20, 14));
  unit(game, 'warrior', 1, at(21, 14));
  ok(apply(game, 0, { t: 'attack', unit: raider.id, target: at(21, 14) }).ok, 'the tank attacks');
  ok(raider.moves > 0, 'and has moves left');
  // A unique unit's own promotion: given, not earned.
  const samurai = unit(game, 'samurai', 0, at(2, 14), { xp: 10 });
  ok(promotionsOf(samurai).includes('shock_1') && !samurai.promotions.includes('shock_1'), 'a samurai is born with Shock I');
  eq(promotionsDue(samurai), 1, 'which doesn’t use up its experience');
  ok(!promotionsFor(samurai).some((x) => x.id === 'shock_1'), 'nor is offered again');
  // A Nuclear Missile ties up two Uranium.
  unit(game, 'nuclear_missile', 0, at(2, 2));
  eq(strategic(game, game.players[0]).uranium?.used, 2, 'two Uranium');
});
