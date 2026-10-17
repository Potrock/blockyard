import { BUILDING_LIST, BUILDINGS, FAITH_BUILDINGS } from '../rules/buildings';
import { CIV_LIST } from '../rules/civs';
import { canPillage, cityFire, cityFireStrength, cityStrength, melee, ranged, strength } from '../rules/combat';
import { maxMoves, unitSight } from '../rules/core';
import { claim, cityYields, connected, dissent, foodKept, goldUpkeep, happiness, policyCost, purchaseCost, specialistSlots, strategic, tileCultureCost, tileGoldCost, workable, workedYields } from '../rules/economy';
import { faithBuildings, faithCost, faithTurn, prophetCost, spreadsOf } from '../rules/faith';
import { apply, applyOnce, canDig, endTurn, healing, learn, plunder, productionToward, trainable, upgradeCost } from '../rules/game';
import { neighbours, within } from '../rules/hex';
import { stepCost } from '../rules/movement';
import { ALL_POLICIES } from '../rules/policies';
import { promotionsFor, PROMOTION_LIST } from '../rules/promotions';
import { BELIEF_LIST } from '../rules/religion';
import type { City, Tile, Unit } from '../rules/state';
import { cityTourism, maxRoutes, partsBuildable, routeYield, spyCount, tourismOf } from '../rules/trade';
import { relationsOf } from '../rules/diplomacy';
import { UNIT_LIST } from '../rules/units';
import { blank, city, techsTo, unit, war } from './world';

/**
 * A sweep of the rules over worlds that have everything: every civ (twelve to a world), each with every tech, policy,
 * tenet and building, a religion of every belief, every pantheon in turn, units of every kind with
 * every promotion; every rule that reads effects asked about every city and unit, the once-only
 * effects of everything applied, fights, captures, great people, trade, spies and turns played.
 * The effects coverage check runs it to see what the data does that nothing reads.
 */

/** Every building that can stand in a city (not the palace twice). */
const ALL_BUILDINGS = [...BUILDING_LIST, ...FAITH_BUILDINGS].map((b) => b.id);

/** Tiles of every kind a tile bonus can be for, to put round a city: terrain, feature, resource, improvement. */
const ZOO: Partial<Tile>[] = [
  { resource: 'wheat', improvement: 'farm' },
  { resource: 'horses', amount: 2, improvement: 'pasture' },
  { resource: 'iron', amount: 2, improvement: 'mine' },
  { resource: 'deer', improvement: 'camp', feature: 'forest' },
  { resource: 'gold_ore', improvement: 'mine' },
  { resource: 'silver', improvement: 'mine' },
  { resource: 'gems', improvement: 'mine' },
  { resource: 'copper', improvement: 'mine' },
  { resource: 'salt', improvement: 'mine' },
  { resource: 'stone', improvement: 'quarry' },
  { resource: 'bananas', improvement: 'plantation', feature: 'jungle' },
  { resource: 'wine', improvement: 'plantation' },
  { resource: 'oil', amount: 2, improvement: 'oil_well', terrain: 'desert' },
  { terrain: 'desert', improvement: 'trading_post' },
  { terrain: 'coast', resource: 'fish', improvement: 'fishing_boats' },
  { terrain: 'coast', resource: 'pearls', improvement: 'fishing_boats' },
  { terrain: 'lake' },
  { terrain: 'ocean' },
  { feature: 'jungle' },
  { feature: 'forest', improvement: 'lumber_mill' },
  { river: true },
  { improvement: 'academy' },
  { improvement: 'customs_house' },
  { improvement: 'manufactory' },
  { improvement: 'holy_site' },
  { improvement: 'landmark' },
  { resource: 'incense', improvement: 'plantation', terrain: 'plains' },
];

/** Things to build that every kind of production bonus is for. */
const ITEMS = [
  ...['shrine', 'temple', 'monument', 'harbor', 'pyramids', 'taj_mahal'].map((id) => ({ kind: 'building' as const, id })),
  ...['settler', 'warrior', 'archer', 'horseman', 'trireme', 'swordsman', 'tank'].map((id) => ({ kind: 'unit' as const, id })),
  { kind: 'project' as const, id: 'ss_booster' },
];

export function sweep() {
  // (Twelve civs at a time: as many as a large map holds side by side, two rows of six.)
  for (let i = 0; i < CIV_LIST.length; i += 12) sweepOf(CIV_LIST.slice(i, i + 12).map((c) => c.id));
}

/** The sweep over a world of these civs. */
function sweepOf(civs: string[]) {
  const { game, at } = blank(civs, { cityStates: 4, barbarians: true, size: 'large' });
  const majors = game.players.filter((p) => !p.cityState && p.civ !== 'barbarian');
  const cs = game.players.filter((p) => p.cityState);
  const barbarian = game.players.findIndex((p) => p.civ === 'barbarian');
  // A sea along the bottom, rivers here and there.
  for (let col = 0; col < game.grid.width; col++) for (const row of [27, 28, 29]) game.tiles[at(col, row)].terrain = 'coast';
  // Each civ: two linked cities (the second by the sea, with a river), everything known and built.
  const homes: City[][] = [];
  majors.forEach((p, i) => {
    const col = 2 + (i % 6) * 8;
    const row = i < 6 ? 4 : 14;
    techsTo(game, p.index, 18);
    const a = city(game, p.index, at(col, row), { pop: 12, buildings: ALL_BUILDINGS });
    const b = city(game, p.index, at(col + 4, row + 3), { pop: 7, buildings: ALL_BUILDINGS });
    game.tiles[b.tile].river = true;
    for (const t of [at(col + 1, row), at(col + 2, row + 1), at(col + 3, row + 2), at(col + 3, row + 3)]) game.tiles[t].road = 'road';
    game.tiles[neighbours(game.grid, b.tile)[3]].terrain = 'coast';
    b.occupied = true;
    p.policies = Object.keys(ALL_POLICIES);
    p.policyTurns = Object.fromEntries(p.policies.map((id) => [id, 1]));
    p.ideology = 'freedom';
    p.gold = 100000;
    p.faith = 100000;
    p.culture = 100000;
    p.lifetimeCulture = 1000;
    p.researching = 'future_tech';
    p.lastIncome = { gold: 10, science: 50, culture: 10, faith: 10, happiness: 5, tourism: 0 };
    a.specialists = { scientist: 2, artist: 1, merchant: 1, engineer: 1, writer: 1, musician: 1 };
    a.works = Object.fromEntries(a.buildings.filter((x) => BUILDINGS[x]?.effects.greatWorks).map((x) => [x, ['A work']]));
    homes.push([a, b]);
    // Its capital's land: every kind of tile.
    within(game.grid, a.tile, 3)
      .filter((t) => t !== a.tile && game.tiles[t].owner < 0)
      .slice(0, ZOO.length)
      .forEach((t, k) => {
        Object.assign(game.tiles[t], ZOO[k]);
        claim(game, a, t);
      });
  });
  for (const [i, other] of cs.entries()) city(game, other.index, at(4 + i * 12, 24), { pop: 5 });
  // Everyone's religion holds every belief (the founder's and its followers' beliefs, all at work).
  majors.forEach((p, i) => {
    const id = `r${i}`;
    game.religions[id] = { founder: p.index, holyCity: homes[i][0].id, name: id, beliefs: BELIEF_LIST.filter((b) => b.kind !== 'pantheon').map((b) => b.id) };
    p.religion = id;
    for (const c of homes[i]) c.followers = { [id]: c.pop - 1, [`r${(i + 1) % majors.length}`]: 1 };
  });
  // Ideologies apart, tourism enough to unsettle.
  majors[1].ideology = 'order';
  majors[1].tourism[majors[0].index] = 1000;
  // City-states: allies and friends of the first two.
  for (const c of cs) {
    majors[0].influence[c.index] = 90;
    majors[1].influence[c.index] = 40;
    for (const t of neighbours(game.grid, game.cities.find((x) => x.owner === c.index)!.tile).slice(0, 2)) Object.assign(game.tiles[t], { resource: 'iron', amount: 2 });
  }
  majors[0].ideology = 'freedom';
  majors[2].ideology = 'freedom';
  war(game, majors[0].index, majors[1].index);
  // Units of every kind, with every promotion they could take.
  const units: Unit[] = [];
  for (const [i, type] of UNIT_LIST.entries()) {
    const sea = type.domain === 'sea';
    const t = sea ? at(i % game.grid.width, 28) : at(i % game.grid.width, 10 + Math.floor(i / game.grid.width));
    const u = unit(game, type.id, majors[0].index, t, { xp: 500 });
    u.promotions = PROMOTION_LIST.filter((p) => p.classes.includes(type.class) || !p.classes.length).map((p) => p.id);
    units.push(u);
  }

  // Every city and unit, asked everything.
  const ask = (all = true) => {
    for (const p of all ? majors : [majors[0]]) {
      happiness(game, p);
      goldUpkeep(game, p);
      policyCost(game, p);
      strategic(game, p);
      connected(game, p);
      dissent(game, p);
      maxRoutes(game, p);
      tourismOf(game, p);
      prophetCost(game, p);
      spyCount(game, p, 7);
      for (const k of ['great_prophet', 'missionary', 'mosque', 'library', 'great_scientist', 'spearman']) faithCost(game, k, p);
      purchaseCost(game, p, 100, 'unit');
      purchaseCost(game, p, 100, 'building');
      for (const kind of ['great_prophet', 'missionary', 'inquisitor']) spreadsOf(game, p, kind);
    }
    for (const c of game.cities) {
      if (!all && c.owner !== majors[0].index) continue;
      cityYields(game, c);
      for (const t of workable(game, c)) workedYields(game, c, t);
      if (!all) continue;
      foodKept(game, c);
      tileCultureCost(game, c);
      tileGoldCost(game, c, neighbours(game.grid, c.tile)[0]);
      specialistSlots(game, c);
      cityStrength(game, c);
      cityFireStrength(game, c);
      cityTourism(game, c);
      faithBuildings(game, c);
      for (const item of ITEMS) productionToward(game, c, item);
      trainable(game, game.players[c.owner], c);
      for (const r of game.players[c.owner].routes ?? []) routeYield(game, game.players[c.owner], r);
    }
    if (!all) return;
    const enemy = unit(game, 'warrior', majors[1].index, at(30, 20));
    const archer = unit(game, 'archer', majors[1].index, at(30, 21));
    const horse = unit(game, 'horseman', majors[1].index, at(31, 21));
    const ship = unit(game, 'trireme', majors[1].index, at(30, 28));
    const rough = unit(game, 'warrior', majors[1].index, at(33, 21));
    game.tiles[rough.tile].elevation = 'hills';
    const barbarianUnit = unit(game, 'warrior', barbarian, at(32, 20));
    const town = homes[1][0];
    for (const type of UNIT_LIST) promotionsFor({ id: -1, type: type.id, owner: 0, tile: 0, moves: 0, hp: 100, xp: 0, promotions: [] });
    for (const u of units) {
      strength(game, u, 'attack', horse, u.tile);
      strength(game, u, 'defend', horse, u.tile);
      strength(game, u, 'attack', ship, u.tile);
      strength(game, u, 'ranged', rough, u.tile);
      unitSight(game, u);
      maxMoves(game, u);
      healing(game, u);
      promotionsFor(u);
      upgradeCost(game, game.players[u.owner], u);
      strength(game, u, 'attack', enemy, u.tile);
      strength(game, u, 'attack', town, u.tile);
      strength(game, u, 'ranged', town, u.tile);
      strength(game, u, 'attack', barbarianUnit, u.tile);
      strength(game, u, 'defend', archer, u.tile);
      strength(game, u, 'defend', town, u.tile);
      const n = neighbours(game.grid, u.tile)[0];
      stepCost(game, u, u.tile, n);
    }
    for (const u of [enemy, archer, horse, ship, rough, barbarianUnit]) game.units.splice(game.units.indexOf(u), 1);
  };
  // Every pantheon in turn (the first civ's cities are enough to see what each does).
  for (const b of BELIEF_LIST.filter((x) => x.kind === 'pantheon')) {
    for (const p of majors) p.pantheon = b.id;
    ask(false);
  }
  ask();
  // Terrain that matters: hills, forests, marsh, rivers, a fort and a citadel under the units.
  for (const [i, u] of units.entries()) {
    const tile = game.tiles[u.tile];
    if (tile.terrain === 'coast') continue;
    if (i % 4 === 0) tile.elevation = 'hills';
    if (i % 4 === 1) tile.feature = 'forest';
    if (i % 4 === 2) tile.feature = 'jungle';
    if (i % 4 === 3) Object.assign(tile, { owner: u.owner, improvement: i % 8 === 3 ? 'fort' : 'citadel' });
    tile.river = i % 3 === 0;
  }
  ask();
  // France before Steam Power, the Mughal Fort before Flight: and after.
  for (const p of majors) p.techs = p.techs.filter((t) => t !== 'steam_power' && t !== 'flight');
  ask();
  techsTo(game, majors[0].index, 18);

  // The once-only effects of everything.
  const p0 = majors[0];
  const [capital] = homes[0];
  for (const b of BUILDING_LIST) applyOnce(game, p0, b.effects, capital);
  for (const id of Object.keys(ALL_POLICIES)) applyOnce(game, p0, ALL_POLICIES[id].effects, capital);

  // Fights: melee, fire, a city's fire, against barbarians, a city taken.
  const fight = (attacker: string, defender: string, owner = majors[1].index) => {
    const a = unit(game, attacker, p0.index, at(20, 21));
    const d = unit(game, defender, owner, at(21, 21));
    d.hp = 1;
    const result = UNIT_LIST.find((x) => x.id === attacker)!.ranged ? ranged(game, a, d.tile) : melee(game, a, d.tile);
    for (const u of [a, d]) if (game.units.includes(u)) game.units.splice(game.units.indexOf(u), 1);
    return result;
  };
  fight('swordsman', 'warrior');
  fight('archer', 'spearman');
  fight('jaguar', 'warrior');
  fight('warrior', 'warrior', barbarian);
  const target = unit(game, 'warrior', majors[1].index, neighbours(game.grid, capital.tile)[0]);
  cityFire(game, capital, target.tile);
  const town = homes[1][1];
  plunder(game, town);
  town.hp = 1;
  for (const u of game.units.filter((x) => x.tile === town.tile)) game.units.splice(game.units.indexOf(u), 1);
  const taker = unit(game, 'swordsman', p0.index, neighbours(game.grid, town.tile)[0]);
  melee(game, taker, town.tile);

  // Pillage, a nuclear strike, a paradrop, an airlift, a gift.
  const raider = unit(game, 'swordsman', p0.index, neighbours(game.grid, homes[1][0].tile)[1]);
  game.tiles[raider.tile].improvement = 'farm';
  if (canPillage(game, raider)) apply(game, p0.index, { t: 'pillage', unit: raider.id });
  const bomb = unit(game, 'nuclear_missile', p0.index, capital.tile);
  apply(game, p0.index, { t: 'attack', unit: bomb.id, target: homes[1][0].tile });
  const para = unit(game, 'paratrooper', p0.index, capital.tile);
  p0.explored.fill(1);
  apply(game, p0.index, { t: 'paradrop', unit: para.id, to: at(8, 10) });
  const lifted = unit(game, 'infantry', p0.index, capital.tile);
  apply(game, p0.index, { t: 'airlift', unit: lifted.id, to: homes[0][1].tile });
  const csHome = game.cities.find((c) => c.owner === cs[0].index)!;
  const gift = unit(game, 'swordsman', p0.index, neighbours(game.grid, csHome.tile)[0]);
  apply(game, p0.index, { t: 'giftUnit', unit: gift.id, target: cs[0].index });
  apply(game, p0.index, { t: 'gift', target: cs[0].index, gold: 100 });

  // Great people at work, an archaeologist's dig, faith spent.
  for (const [type, action] of [['great_scientist', 'discover'], ['great_merchant', 'trade'], ['great_engineer', 'hurry'], ['great_artist', 'golden'], ['great_writer', 'culture'], ['great_musician', 'work'], ['great_general', 'improvement']] as const) {
    const g = unit(game, type, p0.index, type === 'great_general' ? neighbours(game.grid, homes[0][1].tile)[1] : capital.tile);
    apply(game, p0.index, { t: 'greatPerson', unit: g.id, action });
  }
  const site = neighbours(game.grid, capital.tile)[2];
  Object.assign(game.tiles[site], { antiquity: true, hiddenAntiquity: true });
  const digger = unit(game, 'archaeologist', p0.index, site);
  canDig(game, digger, 'artifact');
  for (const item of [{ kind: 'unit', id: 'spearman' }, { kind: 'unit', id: 'great_prophet' }, { kind: 'unit', id: 'great_scientist' }, { kind: 'building', id: 'library' }] as const) {
    capital.buildings = capital.buildings.filter((b) => b !== item.id);
    apply(game, p0.index, { t: 'buy', city: capital.id, item, with: 'faith' });
  }
  apply(game, p0.index, { t: 'buy', city: capital.id, item: { kind: 'unit', id: 'landsknecht' }, with: 'gold' });
  apply(game, p0.index, { t: 'buy', city: homes[0][1].id, item: { kind: 'unit', id: 'missile_cruiser' }, with: 'gold' });
  const prophet = unit(game, 'great_prophet', p0.index, capital.tile);
  apply(game, p0.index, { t: 'religion', unit: prophet.id, name: 'x', beliefs: [] });

  // Units that fire twice, or further; a work boat; a trireme at the ocean's edge; a worker at work; a defender of the faith.
  for (const [type, promotions] of [['swordsman', ['blitz']], ['archer', ['logistics', 'range']]] as const) {
    const u = unit(game, type, p0.index, at(24, 21), { promotions: [...promotions] });
    const foe = unit(game, 'warrior', majors[1].index, at(25, 21));
    apply(game, p0.index, { t: 'attack', unit: u.id, target: foe.tile });
    for (const x of [u, foe]) if (game.units.includes(x)) game.units.splice(game.units.indexOf(x), 1);
  }
  // An air strike into the guns of an anti-aircraft gun.
  const bomber = unit(game, 'bomber', p0.index, capital.tile);
  const mark = unit(game, 'warrior', majors[1].index, at(capital.tile % game.grid.width + 3, Math.floor(capital.tile / game.grid.width) + 3));
  unit(game, 'anti_aircraft_gun', majors[1].index, neighbours(game.grid, mark.tile)[0]);
  apply(game, p0.index, { t: 'attack', unit: bomber.id, target: mark.tile });
  const boat = unit(game, 'work_boat', p0.index, at(3, 28));
  apply(game, p0.index, { t: 'build', unit: boat.id, what: 'fishing_boats' });
  const trireme = unit(game, 'trireme', p0.index, at(5, 28));
  game.tiles[at(5, 29)].terrain = 'ocean';
  stepCost(game, trireme, trireme.tile, at(5, 29));
  const worker = unit(game, 'worker', p0.index, neighbours(game.grid, homes[0][1].tile)[0]);
  game.tiles[worker.tile].owner = p0.index;
  apply(game, p0.index, { t: 'build', unit: worker.id, what: 'road' });
  const defender = unit(game, 'warrior', p0.index, neighbours(game.grid, capital.tile)[4]);
  strength(game, defender, 'defend', null, defender.tile);
  // China's general, born of a fight; Babylon's scientist, of Writing (when they're in this world); a spaceship.
  const china = majors.find((p) => p.civ === 'china');
  if (china) {
    const chinese = unit(game, 'swordsman', china.index, at(36, 21));
    const foe = unit(game, 'warrior', majors[1].index, at(37, 21));
    war(game, china.index, majors[1].index);
    melee(game, chinese, foe.tile);
  }
  const babylon = majors.find((p) => p.civ === 'babylon');
  if (babylon) {
    babylon.techs = babylon.techs.filter((t) => t !== 'writing');
    learn(game, babylon, 'writing');
  }
  partsBuildable(game, p0);
  // Great works to fill every slot; missionaries and inquisitors; caravans and cargo ships.
  for (const type of ['great_artist', 'great_writer', 'great_musician']) for (let i = 0; i < 40; i++) apply(game, p0.index, { t: 'greatPerson', unit: unit(game, type, p0.index, capital.tile).id, action: 'work' });
  const missionary = unit(game, 'missionary', p0.index, homes[1][0].tile, { religion: p0.religion, spreads: 2 });
  apply(game, p0.index, { t: 'spread', unit: missionary.id });
  const inquisitor = unit(game, 'inquisitor', p0.index, capital.tile, { religion: p0.religion });
  apply(game, p0.index, { t: 'inquisition', unit: inquisitor.id });
  for (const type of ['caravan', 'cargo_ship']) {
    const trader = unit(game, type, p0.index, capital.tile);
    apply(game, p0.index, { t: 'trade', unit: trader.id, to: homes[2][0].id });
  }

  // Trade routes, spies, research agreements; then turns go by.
  majors.forEach((p, i) => {
    p.routes = [
      { from: homes[i][0].id, to: homes[(i + 1) % majors.length][0].id, turns: 9, sea: false },
      { from: homes[i][0].id, to: csHome.id, turns: 9, sea: true },
    ];
    p.spies = [{ id: 9000 + i, city: homes[(i + 2) % majors.length][1].id, progress: 1e6 }];
    relationsOf(game).running.push({ a: p.index, b: majors[(i + 3) % majors.length].index, item: { kind: 'research' }, turns: 1 });
  });
  for (const p of majors) {
    p.greatChoices = 1;
    p.greatPoints.merchant = 1000;
  }
  majors[0].researching = 'future_tech';
  // Spies' targets without the Great Firewall (and their own spies at home), thieves who know less; the United Nations in session.
  for (const c of game.cities) c.buildings = c.buildings.filter((x) => x !== 'great_firewall');
  majors.forEach((p, i) => p.spies!.push({ id: 9100 + i, city: homes[i][1].id, progress: 0 }));
  techsTo(game, majors[0].index, 12);
  game.settings.victories.diplomatic = true;
  game.wonders.united_nations = p0.index;
  faithTurn(game);
  game.turn = 8;
  for (let i = 0; i < 3; i++) endTurn(game);
  // A camp cleared (and Germany's recruits, when Germany is here).
  const germany = majors.find((p) => p.civ === 'germany');
  if (!germany) return;
  const camp = at(40, 22);
  game.tiles[camp].camp = true;
  const clearer = unit(game, 'swordsman', germany.index, neighbours(game.grid, camp)[0]);
  apply(game, germany.index, { t: 'move', unit: clearer.id, to: camp });
}
