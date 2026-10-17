import type { Effects } from './effects';
import type { Era } from './techs';
import { SPEEDS, type Game, type Player } from './state';

/**
 * Social policies: nine trees, each opened by its first policy and finished by adopting all five of
 * the rest (which gives the finisher), opened as the eras come; then an ideology (Freedom, Order or
 * Autocracy) and its tenets in three levels. Effects are Civilization V's, in our words.
 */

export interface Policy {
  id: string;
  name: string;
  tree: string;
  text: string;
  effects: Effects;
  /** Policies in the tree it needs first. */
  needs?: string[];
}

export interface PolicyTree {
  id: string;
  name: string;
  era: Era;
  /** Trees it can't be open alongside (Piety and Rationalism; Tradition... none in BNW but Piety/Rationalism). */
  excludes?: string[];
  opener: Policy;
  policies: Policy[];
  finisher: Policy;
}

const P = (tree: string, id: string, name: string, text: string, effects: Effects, needs?: string[]): Policy => ({ id, name, tree, text, effects, needs });

export const TREES: PolicyTree[] = [
  {
    id: 'tradition',
    name: 'Tradition',
    era: 'ancient',
    opener: P('tradition', 'tradition', 'Tradition', '+3 culture in the capital, and its borders cost a third less culture to grow.', { cities: [{ when: { capital: true }, effects: { yields: { culture: 3 }, borderCost: 33 } }] }),
    policies: [
      P('tradition', 'aristocracy', 'Aristocracy', '+15% production toward wonders; +1 happiness for every 10 citizens in a city.', { wonderProduction: 15, special: ['happiness_per_10_pop'] }),
      P('tradition', 'legalism', 'Legalism', 'A free Monument in your first four cities.', { freeBuildings: { building: 'monument', cities: 4 } }),
      P('tradition', 'oligarchy', 'Oligarchy', 'Garrisons cost no upkeep; cities with one fire 50% stronger.', { special: ['garrison_free', 'garrison_city_strike'] }),
      P('tradition', 'landed_elite', 'Landed Elite', '+10% growth and +2 food in the capital.', { cities: [{ when: { capital: true }, effects: { yields: { food: 2 }, percent: { food: 10 } } }] }, ['legalism']),
      P('tradition', 'monarchy', 'Monarchy', '+1 gold and 1 less unhappiness for every 2 citizens in the capital.', { cities: [{ when: { capital: true }, effects: { perPop: { gold: 0.5 }, special: ['capital_unhappiness_half'] } }] }, ['aristocracy']),
    ],
    finisher: P('tradition', 'tradition_done', 'Tradition Finished', '+15% growth in every city; a free Aqueduct in your first four cities. From the Industrial Era, faith buys Great Engineers.', { percent: { food: 15 }, freeBuildings: { building: 'aqueduct', cities: 4 }, faithGreatPeople: ['engineer'] }),
  },
  {
    id: 'liberty',
    name: 'Liberty',
    era: 'ancient',
    opener: P('liberty', 'liberty', 'Liberty', '+1 culture in every city.', { yields: { culture: 1 } }),
    policies: [
      P('liberty', 'collective_rule', 'Collective Rule', 'A free Settler; +50% production toward Settlers in the capital.', { freeUnits: [{ unit: 'settler', count: 1 }], cities: [{ when: { capital: true }, effects: { unitProduction: [{ classes: ['settler'], percent: 50 }] } }] }),
      P('liberty', 'citizenship', 'Citizenship', 'A free Worker; workers build 25% faster.', { freeUnits: [{ unit: 'worker', count: 1 }], workRate: 25 }),
      P('liberty', 'republic', 'Republic', '+1 production in every city; +5% production toward buildings.', { yields: { prod: 1 }, buildingProduction: 5 }, ['collective_rule']),
      P('liberty', 'representation', 'Representation', 'Each city adds a third less to the cost of policies; a golden age.', { goldenAge: 10, special: ['policy_city_cost_less'] }, ['citizenship']),
      P('liberty', 'meritocracy', 'Meritocracy', '+1 happiness in every city connected to the capital; 5% less unhappiness from citizens.', { unhappinessPercent: 5, cities: [{ when: { connected: true }, effects: { happiness: 1 } }] }, ['citizenship']),
    ],
    finisher: P('liberty', 'liberty_done', 'Liberty Finished', 'A free Great Person of your choice. From the Industrial Era, faith buys Great Engineers.', { freeGreatPerson: 'any', faithGreatPeople: ['engineer'] }),
  },
  {
    id: 'honor',
    name: 'Honor',
    era: 'ancient',
    opener: P('honor', 'honor', 'Honor', '+33% combat strength against barbarians; culture from killing them.', { combat: [{ percent: 33, when: 'vs_barbarians' }], special: ['culture_from_barbarian_kills'] }),
    policies: [
      P('honor', 'warrior_code', 'Warrior Code', '+15% production toward melee units; a free Great General.', { unitProduction: [{ classes: ['melee', 'gun'], percent: 15 }], freeGreatPerson: 'general' }),
      P('honor', 'discipline', 'Discipline', '+15% combat strength for melee units next to another of yours.', { combat: [{ classes: ['melee', 'gun'], percent: 15, when: 'beside_friend' }] }),
      P('honor', 'military_tradition', 'Military Tradition', 'Units earn twice the experience.', { special: ['double_xp'] }, ['warrior_code']),
      P('honor', 'military_caste', 'Military Caste', 'A garrisoned city is +1 happier and makes +2 culture.', { cities: [{ when: { garrisoned: true }, effects: { happiness: 1, yields: { culture: 2 } } }] }, ['discipline']),
      P('honor', 'professional_army', 'Professional Army', 'Upgrades cost a third less; +1 happiness from each Walls, Castle, Arsenal and Military Base.', { special: ['upgrades_cheaper_33'], perBuilding: [{ buildings: ['walls', 'castle', 'arsenal', 'military_base'], effects: { happiness: 1 } }] }, ['military_caste']),
    ],
    finisher: P('honor', 'honor_done', 'Honor Finished', 'Gold for every enemy unit killed. From the Industrial Era, faith buys Great Generals.', { special: ['gold_from_kills'], faithGreatPeople: ['general'] }),
  },
  {
    id: 'piety',
    name: 'Piety',
    era: 'classical',
    excludes: ['rationalism'],
    opener: P('piety', 'piety', 'Piety', 'Shrines and Temples are built twice as fast.', { buildingBoost: [{ buildings: ['shrine', 'temple'], percent: 100 }] }),
    policies: [
      P('piety', 'organized_religion', 'Organized Religion', '+1 faith from Monuments, Shrines and Temples.', { perBuilding: [{ buildings: ['monument', 'shrine', 'temple'], effects: { yields: { faith: 1 } } }] }),
      P('piety', 'mandate_of_heaven', 'Mandate of Heaven', 'Faith purchases cost 20% less.', { special: ['faith_cheaper_20'] }),
      P('piety', 'theocracy', 'Theocracy', 'Temples give +10% gold.', { perBuilding: [{ buildings: ['temple'], effects: { percent: { gold: 10 } } }] }, ['organized_religion']),
      P('piety', 'reformation', 'Reformation', 'A golden age; a Reformation belief for your religion.', { goldenAge: 10, special: ['reformation_belief'] }, ['mandate_of_heaven']),
      P('piety', 'free_religion', 'Religious Tolerance', 'Cities get the follower beliefs of their second religion too.', { special: ['second_religion_beliefs'] }, ['theocracy']),
    ],
    finisher: P('piety', 'piety_done', 'Piety Finished', 'Great Prophets can be bought with faith; +3 happiness in your holy city.', { cities: [{ when: { holyCity: true }, effects: { happiness: 3 } }], special: ['buy_prophets'] }),
  },
  {
    id: 'patronage',
    name: 'Patronage',
    era: 'medieval',
    opener: P('patronage', 'patronage', 'Patronage', 'Influence with city-states falls 25% slower.', { cityStateInfluence: 25 }),
    policies: [
      P('patronage', 'philanthropy', 'Philanthropy', 'Gold gifts to city-states give 25% more influence.', { special: ['gifts_25'] }),
      P('patronage', 'consulates', 'Consulates', 'Influence with every city-state rests 20 higher.', { special: ['influence_rest_20'] }),
      P('patronage', 'scholasticism', 'Scholasticism', 'Allied city-states give a quarter of their science.', { special: ['ally_science_25'] }, ['philanthropy']),
      P('patronage', 'cultural_diplomacy', 'Cultural Diplomacy', "City-states' strategic resources count double for you; their luxuries cheer half again as much.", { special: ['cs_resources_double'] }, ['scholasticism']),
      P('patronage', 'merchant_confederacy', 'Merchant Confederacy', '+3 gold from trade routes with city-states.', { special: ['cs_trade_gold_3'] }, ['consulates']),
    ],
    finisher: P('patronage', 'patronage_done', 'Patronage Finished', 'Allied city-states sometimes send you a Great Person.', { special: ['cs_great_people'] }),
  },
  {
    id: 'aesthetics',
    name: 'Aesthetics',
    era: 'medieval',
    opener: P('aesthetics', 'aesthetics', 'Aesthetics', '+25% Great Writers, Artists and Musicians.', { special: ['culture_great_people_25'] }),
    policies: [
      P('aesthetics', 'cultural_centers', 'Cultural Centers', 'Monuments, Amphitheaters, Opera Houses, Museums and Broadcast Towers built 50% faster.', { buildingBoost: [{ buildings: ['monument', 'amphitheater', 'opera_house', 'museum', 'broadcast_tower'], percent: 50 }] }),
      P('aesthetics', 'fine_arts', 'Fine Arts', 'Half of excess happiness becomes culture.', { special: ['happiness_to_culture'] }),
      P('aesthetics', 'flourishing', 'Flourishing of the Arts', 'A golden age; +33% culture in golden ages.', { goldenAge: 10, special: ['golden_age_culture_33'] }, ['cultural_centers']),
      P('aesthetics', 'artistic_genius', 'Artistic Genius', 'A free Great Artist.', { freeGreatPerson: 'artist' }, ['cultural_centers']),
      P('aesthetics', 'cultural_exchange', 'Cultural Exchange', '+15% more tourism from a shared religion, trade routes and open borders.', { special: ['tourism_ties_15'] }, ['fine_arts']),
    ],
    finisher: P('aesthetics', 'aesthetics_done', 'Aesthetics Finished', 'Hidden antiquity sites revealed; great works give 1 more culture each. From the Industrial Era, faith buys Great Artists, Writers and Musicians.', { special: ['reveal_hidden_antiquity', 'great_works_culture_1'], faithGreatPeople: ['artist', 'writer', 'musician'] }),
  },
  {
    id: 'commerce',
    name: 'Commerce',
    era: 'medieval',
    opener: P('commerce', 'commerce', 'Commerce', '+25% gold in the capital.', { cities: [{ when: { capital: true }, effects: { percent: { gold: 25 } } }] }),
    policies: [
      P('commerce', 'trade_unions', 'Trade Unions', 'Roads and railroads cost a third less upkeep; trade routes +2 gold.', { special: ['road_upkeep_less', 'trade_gold_2'] }),
      P('commerce', 'mercenary_army', 'Mercenary Army', 'Landsknechts can be bought in any city; buying costs 15% less.', { purchaseDiscount: [{ percent: 15 }], special: ['buy_landsknechts'] }),
      P('commerce', 'entrepreneurship', 'Entrepreneurship', 'Great Merchants come 25% faster; +1 happiness per luxury.', { happinessPerLuxury: 1, special: ['merchants_faster_25'] }),
      P('commerce', 'mercantilism', 'Mercantilism', 'Buying costs 25% less; +1 science from Markets, Banks and Stock Exchanges.', { purchaseDiscount: [{ percent: 25 }], perBuilding: [{ buildings: ['market', 'bank', 'stock_exchange'], effects: { yields: { science: 1 } } }] }, ['trade_unions']),
      P('commerce', 'protectionism', 'Protectionism', '+2 happiness from each luxury.', { happinessPerLuxury: 2 }, ['mercantilism', 'entrepreneurship']),
    ],
    finisher: P('commerce', 'commerce_done', 'Commerce Finished', "Great Merchants' trade missions bring twice the gold; +1 gold from Trading Posts. From the Industrial Era, faith buys Great Merchants.", { tiles: [{ where: { improvement: ['trading_post'] }, yields: { gold: 1 } }], special: ['merchant_gold_double'], faithGreatPeople: ['merchant'] }),
  },
  {
    id: 'exploration',
    name: 'Exploration',
    era: 'medieval',
    opener: P('exploration', 'exploration', 'Exploration', '+1 move and +1 sight for ships; Harbours, Seaports and Lighthouses built 50% faster.', { moves: [{ domain: 'sea', moves: 1 }], sight: [{ domain: 'sea', sight: 1 }], buildingBoost: [{ buildings: ['harbor', 'seaport', 'lighthouse'], percent: 50 }] }),
    policies: [
      P('exploration', 'maritime_infrastructure', 'Maritime Infrastructure', '+1 production from sea tiles.', { tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { prod: 1 } }] }),
      P('exploration', 'naval_tradition', 'Naval Tradition', '+1 happiness from Harbours, Seaports and Lighthouses.', { perBuilding: [{ buildings: ['harbor', 'seaport', 'lighthouse'], effects: { happiness: 1 } }] }),
      P('exploration', 'navigation_school', 'Navigation School', 'A free Great Admiral; ships +1 move.', { freeGreatPerson: 'admiral', moves: [{ domain: 'sea', moves: 1 }] }, ['naval_tradition']),
      P('exploration', 'merchant_navy', 'Merchant Navy', '+3 production in coastal cities.', { cities: [{ when: { coastal: true }, effects: { yields: { prod: 3 } } }] }, ['maritime_infrastructure']),
      P('exploration', 'treasure_fleets', 'Treasure Fleets', 'Hidden antiquity sites revealed; sea trade routes +2 gold.', { special: ['reveal_hidden_antiquity', 'sea_trade_gold_2'] }, ['merchant_navy']),
    ],
    finisher: P('exploration', 'exploration_done', 'Exploration Finished', '+1 gold and +1 production from Harbours and Seaports. From the Industrial Era, faith buys Great Admirals.', { perBuilding: [{ buildings: ['harbor', 'seaport'], effects: { yields: { gold: 1, prod: 1 } } }], faithGreatPeople: ['admiral'] }),
  },
  {
    id: 'rationalism',
    name: 'Rationalism',
    era: 'renaissance',
    excludes: ['piety'],
    opener: P('rationalism', 'rationalism', 'Rationalism', '+10% science while your empire is happy.', { special: ['science_10_happy'] }),
    policies: [
      P('rationalism', 'secularism', 'Secularism', '+2 science from every specialist.', { specialistYields: { science: 2 } }),
      P('rationalism', 'humanism', 'Humanism', '+1 happiness from Universities, Observatories and Public Schools.', { perBuilding: [{ buildings: ['university', 'observatory', 'public_school'], effects: { happiness: 1 } }] }),
      P('rationalism', 'free_thought', 'Free Thought', '+1 science from Trading Posts; +17% science from Universities.', { tiles: [{ where: { improvement: ['trading_post'] }, yields: { science: 1 } }], perBuilding: [{ buildings: ['university'], effects: { percent: { science: 17 } } }] }, ['secularism']),
      P('rationalism', 'sovereignty', 'Sovereignty', '+15% science while the empire is happy.', { special: ['science_15_happy'] }, ['humanism']),
      P('rationalism', 'scientific_revolution', 'Scientific Revolution', 'Research agreements give twice the science.', { special: ['research_agreements_double'] }, ['free_thought']),
    ],
    finisher: P('rationalism', 'rationalism_done', 'Rationalism Finished', "A free tech; Great Scientists' breakthroughs give half again as much science. From the Industrial Era, faith buys Great Scientists.", { freeTechs: 1, special: ['scientist_science_50'], faithGreatPeople: ['scientist'] }),
  },
];

/** The ideologies (from the Modern era, or the Industrial with three factories), each with tenets in three levels. */
export interface Ideology {
  id: string;
  name: string;
  tenets: Policy[][];
}

const I = (id: string, name: string, text: string, effects: Effects): Policy => ({ id, name, tree: '', text, effects });

export const IDEOLOGIES: Ideology[] = [
  {
    id: 'freedom',
    name: 'Freedom',
    tenets: [
      [
        I('creative_expression', 'Creative Expression', '+25% tourism.', { tourismPercent: 25 }),
        I('civil_society', 'Civil Society', 'Specialists eat half as much food.', { special: ['specialists_eat_half'] }),
        I('volunteer_army', 'Volunteer Army', "Six free Great War Infantry (Civ V's Foreign Legion).", { freeUnits: [{ unit: 'great_war_infantry', count: 6 }] }),
        I('avant_garde', 'Avant Garde', '+25% great person points.', { greatPeoplePercent: 25 }),
        I('covert_action', 'Covert Action', 'Spies steal a quarter faster.', { special: ['spies_faster'] }),
      ],
      [
        I('economic_union', 'Economic Union', 'Trade routes with other Freedom civs +3 gold.', { special: ['ideology_trade_gold'] }),
        I('new_deal', 'New Deal', 'Great person improvements +4 of their yield.', { tiles: [{ where: { improvement: ['academy'] }, yields: { science: 4 } }, { where: { improvement: ['customs_house'] }, yields: { gold: 4 } }, { where: { improvement: ['manufactory'] }, yields: { prod: 4 } }, { where: { improvement: ['holy_site'] }, yields: { faith: 4 } }, { where: { improvement: ['landmark'] }, yields: { culture: 4 } }] }),
        I('arsenal_of_democracy', 'Arsenal of Democracy', 'Military units given to city-states give twice the influence.', { special: ['unit_gifts_more'] }),
        I('urbanization', 'Urbanization', '+1 happiness from every Hospital and Stadium.', { perBuilding: [{ buildings: ['hospital', 'stadium'], effects: { happiness: 1 } }] }),
      ],
      [
        I('universal_suffrage', 'Universal Suffrage', 'Specialists make +1 production.', { specialistYields: { prod: 1 } }),
        I('treaty_organization', 'Treaty Organization', 'Influence with city-states falls half as fast.', { cityStateInfluence: 50 }),
        I('media_culture', 'Media Culture', '+34% tourism from cities with a Broadcast Tower.', { perBuilding: [{ buildings: ['broadcast_tower'], effects: { tourismPercent: 34 } }] }),
      ],
    ],
  },
  {
    id: 'order',
    name: 'Order',
    tenets: [
      [
        I('hero_of_the_people', 'Hero of the People', 'A free Great Person of your choice.', { freeGreatPerson: 'any' }),
        I('socialist_realism', 'Socialist Realism', 'A free Monument in every city; +2 culture from Monuments.', { freeBuildingInAll: 'monument', perBuilding: [{ buildings: ['monument'], effects: { yields: { culture: 2 } } }] }),
        I('five_year_plan', 'Five-Year Plan', '+2 production in every city; +1 from mines and quarries.', { yields: { prod: 2 }, tiles: [{ where: { improvement: ['mine', 'quarry'] }, yields: { prod: 1 } }] }),
        I('young_pioneers', 'Young Pioneers', 'Workers build 25% faster; +1 happiness in every city.', { happiness: 1, workRate: 25 }),
        I('academy_of_sciences', 'Academy of Sciences', 'A free Great Scientist; +25% science in the capital.', { freeGreatPerson: 'scientist', cities: [{ when: { capital: true }, effects: { percent: { science: 25 } } }] }),
      ],
      [
        I('worker_faculties', 'Worker Faculties', '+25% science in cities with a Factory.', { perBuilding: [{ buildings: ['factory'], effects: { percent: { science: 25 } } }] }),
        I('patriotic_war', 'Patriotic War', '+25% combat strength in your land.', { combat: [{ percent: 25, when: 'friendly_land' }] }),
        I('skyscrapers', 'Skyscrapers', 'Buildings bought with gold cost 25% less.', { purchaseDiscount: [{ kind: 'building', percent: 25 }] }),
        I('cult_of_personality', 'Cult of Personality', '+1 happiness in every city.', { happiness: 1 }),
      ],
      [
        I('dictatorship_of_the_proletariat', 'Dictatorship of the Proletariat', "Civs of other ideologies under your influence are twice as unhappy for it.", { special: ['ideology_pressure_double'] }),
        I('double_agents', 'Double Agents', 'Your counterspies catch thieves half again as often.', { special: ['spies_defend'] }),
        I('spaceflight_pioneers', 'Spaceflight Pioneers', 'A free Great Scientist; spaceship parts built 25% faster.', { freeGreatPerson: 'scientist', spaceshipProduction: 25 }),
      ],
    ],
  },
  {
    id: 'autocracy',
    name: 'Autocracy',
    tenets: [
      [
        I('elite_forces', 'Elite Forces', 'Units earn 50% more experience.', { special: ['xp_50'] }),
        I('mobilization', 'Mobilization', 'Units cost a third less upkeep.', { unitUpkeep: 33 }),
        I('united_front', 'United Front', 'Militaristic city-states send units twice as often.', { special: ['cs_units_often'] }),
        I('futurism', 'Futurism', '+20% tourism.', { tourismPercent: 20 }),
        I('industrial_espionage', 'Industrial Espionage', 'Spies steal a quarter faster.', { special: ['spies_steal_faster'] }),
      ],
      [
        I('lightning_warfare', 'Lightning Warfare', '+15% combat strength and +1 move for armour.', { combat: [{ classes: ['armor'], percent: 15, when: 'always' }], moves: [{ domain: 'land', classes: ['armor'], moves: 1 }] }),
        I('militarism', 'Militarism', 'Units bought with gold cost a third less.', { purchaseDiscount: [{ kind: 'unit', percent: 33 }] }),
        I('police_state', 'Police State', '+3 happiness from Courthouses.', { perBuilding: [{ buildings: ['courthouse'], effects: { happiness: 3 } }] }),
        I('third_alternative', 'Third Alternative', 'Strategic resources doubled; +2 culture from Barracks, Armories and Military Academies.', { special: ['strategic_double'], perBuilding: [{ buildings: ['barracks', 'armory', 'military_academy'], effects: { yields: { culture: 2 } } }] }),
      ],
      [
        I('total_war', 'Total War', '+15% combat strength attacking; units are trained with 15 more experience.', { combat: [{ percent: 15, when: 'attacking' }], xp: [{ domain: 'all', xp: 15 }] }),
        I('clausewitzs_legacy', "Clausewitz's Legacy", '+25% combat strength attacking, for 50 turns.', { combat: [{ percent: 25, when: 'attacking' }], turns: 50 }),
        I('gunboat_diplomacy', 'Gunboat Diplomacy', 'Influence with a city-state rests 20 higher while one of your military units is within 3 tiles of it.', { special: ['gunboat'] }),
      ],
    ],
  },
];

export const ALL_POLICIES: Record<string, Policy> = {};
for (const t of TREES) for (const p of [t.opener, ...t.policies, t.finisher]) ALL_POLICIES[p.id] = p;
for (const ideo of IDEOLOGIES) for (const level of ideo.tenets) for (const p of level) ALL_POLICIES[p.id] = { ...p, tree: ideo.id };

/** Whether a policy that lasts some turns (Clausewitz's Legacy) has run out. */
export const expired = (p: Player, id: string, turn: number, speed: number) => {
  const turns = ALL_POLICIES[id]?.effects.turns;
  return turns !== undefined && turn - (p.policyTurns?.[id] ?? turn) >= Math.round(turns * speed);
};

/** The effects of a player's adopted policies (those still in force). */
export const policyEffects = (p: Player, game: Game): Effects[] => p.policies.filter((id) => !expired(p, id, game.turn, SPEEDS[game.settings.speed])).map((id) => ALL_POLICIES[id]?.effects).filter((e): e is Effects => !!e);

/** Whether a tree's opened, finished. */
export const treeOpen = (p: Player, tree: string) => p.policies.includes(tree);
/** Whether a civ has a policy tree open or an ideology adopted (what a wonder like the Pyramids or the Kremlin needs). */
export const policyMet = (p: Player, id: string) => treeOpen(p, id) || p.ideology === id;
export const treeDone = (p: Player, tree: PolicyTree) => tree.policies.every((x) => p.policies.includes(x.id));

/** The policies a player could adopt now (their era permitting, given what they have). */
export function adoptable(p: Player, era: number): Policy[] {
  const out: Policy[] = [];
  const eras: Era[] = ['ancient', 'classical', 'medieval', 'renaissance', 'industrial', 'modern', 'atomic', 'information'];
  for (const t of TREES) {
    if (eras.indexOf(t.era) > era) continue;
    if (t.excludes?.some((x) => treeOpen(p, x))) continue;
    if (!treeOpen(p, t.id)) {
      out.push(t.opener);
      continue;
    }
    for (const x of t.policies) if (!p.policies.includes(x.id) && (x.needs ?? []).every((n) => p.policies.includes(n))) out.push(x);
  }
  if (p.ideology) {
    const ideo = IDEOLOGIES.find((i) => i.id === p.ideology)!;
    const counts = ideo.tenets.map((level) => level.filter((x) => p.policies.includes(x.id)).length);
    ideo.tenets.forEach((level, i) => {
      // A level-two tenet needs two of level one, level three two of level two (Civ V's).
      if (i > 0 && counts[i] + 1 > counts[i - 1] - 1) return;
      for (const x of level) if (!p.policies.includes(x.id)) out.push(x);
    });
  }
  return out;
}
