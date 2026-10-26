/**
 * Every unit, Civilization V's numbers: what it costs to build (production), its combat strength,
 * ranged strength and range, moves, the tech that unlocks it and the one that makes it obsolete, what
 * it upgrades to, the strategic resource it needs, and what it can do. Civs' unique units are here
 * too (`civ` says whose, `replaces` what), found through `civs.ts`.
 */

export type Domain = 'land' | 'sea' | 'air';
export type UnitClass =
  | 'civilian'
  | 'recon'
  | 'melee'
  | 'gun'
  | 'ranged'
  | 'mounted'
  | 'armor'
  | 'siege'
  | 'naval_melee'
  | 'naval_ranged'
  | 'submarine'
  | 'carrier'
  | 'fighter'
  | 'bomber'
  | 'helicopter'
  | 'missile'
  | 'great'
  | 'religious'
  | 'trade';

/** What a unit can do beyond moving and fighting. */
export type Ability =
  | 'found_city'
  | 'build'
  | 'build_sea'
  | 'ignore_terrain'
  | 'no_terrain_defense'
  | 'bonus_vs_mounted'
  | 'bonus_vs_cities'
  | 'penalty_vs_cities'
  | 'must_setup'
  /** Fires over what's in the way of its shot, at anything its side sees (Civ V's Indirect Fire). */
  | 'indirect_fire'
  | 'no_attack'
  | 'coast_only'
  | 'see_submarines'
  | 'intercept'
  | 'invisible'
  | 'extra_sight'
  | 'heal_adjacent'
  | 'repair_fleet'
  | 'concert_tour'
  | 'paradrop'
  | 'nuke'
  | 'spread_religion'
  | 'remove_heresy'
  | 'found_religion'
  | 'archaeology'
  | 'trade_route'
  | 'great_work'
  | 'golden_age'
  | 'tile_improvement'
  | 'combat_bonus_aura'
  | 'hurry'
  | 'trade_mission'
  | 'discover_tech'
  | 'kill_heal'
  | 'jungle_fighter'
  /** Fighting in its own land (Ethiopia's Mehal Sefari). */
  | 'homeland'
  /** Fighting outside its own land (the Celts' Pictish Warrior). */
  | 'foreign_lands'
  /** Enemies next to it fight worse (Polynesia's Maori Warrior). */
  | 'haka'
  /** Attacks from the sea and across rivers as from the land (Denmark's Berserker). */
  | 'amphibious'
  | 'political_treatise'
  | 'withdraw';

export interface UnitType {
  id: string;
  name: string;
  class: UnitClass;
  domain: Domain;
  cost: number;
  strength: number;
  ranged?: number;
  range?: number;
  moves: number;
  sight?: number;
  tech?: string;
  obsolete?: string;
  upgrade?: string;
  resource?: string;
  abilities?: Ability[];
  /** A civ's own unit, and the one it replaces. */
  civ?: string;
  replaces?: string;
  /** Can't be built (great people, captured or given only). */
  unbuildable?: boolean;
  /** A nuclear weapon's blast: the tiles round where it lands. */
  blast?: number;
  /** Its colour on the map before it has a model. */
  color?: string;
}

const U = (u: Omit<UnitType, 'domain'> & { domain?: Domain }): UnitType => ({ domain: 'land', ...u });

/** How far a paratrooper drops (Civ V's 9, on maps about half as wide). */
export const PARADROP_RANGE = 6;

export const UNIT_LIST: UnitType[] = [
  // ----- Civilians
  U({ id: 'settler', name: 'Settler', class: 'civilian', cost: 106, strength: 0, moves: 2, abilities: ['found_city', 'no_attack'] }),
  U({ id: 'worker', name: 'Worker', class: 'civilian', cost: 70, strength: 0, moves: 2, abilities: ['build', 'no_attack'] }),
  U({ id: 'work_boat', name: 'Work Boat', class: 'civilian', domain: 'sea', cost: 59, strength: 0, moves: 4, tech: 'sailing', abilities: ['build_sea', 'no_attack', 'coast_only'] }),
  U({ id: 'caravan', name: 'Caravan', class: 'trade', cost: 75, strength: 0, moves: 1, tech: 'animal_husbandry', abilities: ['trade_route', 'no_attack'] }),
  U({ id: 'cargo_ship', name: 'Cargo Ship', class: 'trade', domain: 'sea', cost: 100, strength: 0, moves: 1, tech: 'sailing', abilities: ['trade_route', 'no_attack'] }),
  U({ id: 'missionary', name: 'Missionary', class: 'religious', cost: 0, strength: 0, moves: 4, abilities: ['spread_religion', 'no_attack'], unbuildable: true }),
  U({ id: 'inquisitor', name: 'Inquisitor', class: 'religious', cost: 0, strength: 0, moves: 3, abilities: ['remove_heresy', 'no_attack'], unbuildable: true }),
  U({ id: 'archaeologist', name: 'Archaeologist', class: 'civilian', cost: 200, strength: 0, moves: 4, tech: 'archaeology', abilities: ['archaeology', 'no_attack'] }),
  // Great people: born of great person points, never built.
  U({ id: 'great_prophet', name: 'Great Prophet', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['found_religion', 'spread_religion', 'tile_improvement', 'no_attack'], unbuildable: true }),
  U({ id: 'great_artist', name: 'Great Artist', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['great_work', 'golden_age', 'tile_improvement', 'no_attack'], unbuildable: true }),
  U({ id: 'great_writer', name: 'Great Writer', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['great_work', 'political_treatise', 'no_attack'], unbuildable: true }),
  U({ id: 'great_musician', name: 'Great Musician', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['great_work', 'concert_tour', 'no_attack'], unbuildable: true }),
  U({ id: 'great_scientist', name: 'Great Scientist', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['discover_tech', 'tile_improvement', 'no_attack'], unbuildable: true }),
  U({ id: 'great_engineer', name: 'Great Engineer', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['hurry', 'tile_improvement', 'no_attack'], unbuildable: true }),
  U({ id: 'great_merchant', name: 'Great Merchant', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['trade_mission', 'tile_improvement', 'no_attack'], unbuildable: true }),
  U({ id: 'great_general', name: 'Great General', class: 'great', cost: 0, strength: 0, moves: 2, abilities: ['combat_bonus_aura', 'tile_improvement', 'no_attack'], unbuildable: true }),
  U({ id: 'great_admiral', name: 'Great Admiral', class: 'great', domain: 'sea', cost: 0, strength: 0, moves: 5, abilities: ['combat_bonus_aura', 'heal_adjacent', 'repair_fleet', 'no_attack'], unbuildable: true }),

  // ----- Ancient
  U({ id: 'scout', name: 'Scout', class: 'recon', cost: 25, strength: 4, moves: 2, obsolete: 'scientific_theory', upgrade: 'explorer', abilities: ['ignore_terrain'] }),
  U({ id: 'warrior', name: 'Warrior', class: 'melee', cost: 40, strength: 8, moves: 2, obsolete: 'metal_casting', upgrade: 'swordsman' }),
  U({ id: 'archer', name: 'Archer', class: 'ranged', cost: 40, strength: 5, ranged: 7, range: 2, moves: 2, tech: 'archery', obsolete: 'machinery', upgrade: 'composite_bowman' }),
  U({ id: 'spearman', name: 'Spearman', class: 'melee', cost: 56, strength: 11, moves: 2, tech: 'bronze_working', obsolete: 'civil_service', upgrade: 'pikeman', abilities: ['bonus_vs_mounted'] }),
  U({ id: 'chariot_archer', name: 'Chariot Archer', class: 'mounted', cost: 56, strength: 6, ranged: 10, range: 2, moves: 4, tech: 'the_wheel', obsolete: 'chivalry', upgrade: 'knight', resource: 'horses', abilities: ['no_terrain_defense'] }),
  U({ id: 'trireme', name: 'Trireme', class: 'naval_melee', domain: 'sea', cost: 56, strength: 10, moves: 4, tech: 'sailing', obsolete: 'astronomy', upgrade: 'caravel', abilities: ['coast_only'] }),
  // ----- Classical
  U({ id: 'horseman', name: 'Horseman', class: 'mounted', cost: 75, strength: 12, moves: 4, tech: 'horseback_riding', obsolete: 'chivalry', upgrade: 'knight', resource: 'horses', abilities: ['no_terrain_defense', 'penalty_vs_cities', 'withdraw'] }),
  U({ id: 'composite_bowman', name: 'Composite Bowman', class: 'ranged', cost: 75, strength: 7, ranged: 11, range: 2, moves: 2, tech: 'construction', obsolete: 'machinery', upgrade: 'crossbowman' }),
  U({ id: 'catapult', name: 'Catapult', class: 'siege', cost: 75, strength: 7, ranged: 8, range: 2, moves: 2, tech: 'mathematics', obsolete: 'physics', upgrade: 'trebuchet', abilities: ['bonus_vs_cities', 'must_setup'] }),
  U({ id: 'swordsman', name: 'Swordsman', class: 'melee', cost: 75, strength: 14, moves: 2, tech: 'iron_working', obsolete: 'steel', upgrade: 'longswordsman', resource: 'iron' }),
  U({ id: 'galleass', name: 'Galleass', class: 'naval_ranged', domain: 'sea', cost: 100, strength: 16, ranged: 17, range: 2, moves: 3, tech: 'compass', obsolete: 'navigation', upgrade: 'frigate', abilities: ['coast_only'] }),
  // ----- Medieval
  U({ id: 'pikeman', name: 'Pikeman', class: 'melee', cost: 90, strength: 16, moves: 2, tech: 'civil_service', obsolete: 'metallurgy', upgrade: 'lancer', abilities: ['bonus_vs_mounted'] }),
  U({ id: 'knight', name: 'Knight', class: 'mounted', cost: 120, strength: 20, moves: 4, tech: 'chivalry', obsolete: 'military_science', upgrade: 'cavalry', resource: 'horses', abilities: ['no_terrain_defense', 'penalty_vs_cities', 'withdraw'] }),
  U({ id: 'crossbowman', name: 'Crossbowman', class: 'ranged', cost: 120, strength: 13, ranged: 18, range: 2, moves: 2, tech: 'machinery', obsolete: 'industrialization', upgrade: 'gatling_gun' }),
  U({ id: 'longswordsman', name: 'Longswordsman', class: 'melee', cost: 120, strength: 21, moves: 2, tech: 'steel', obsolete: 'gunpowder', upgrade: 'musketman', resource: 'iron' }),
  U({ id: 'trebuchet', name: 'Trebuchet', class: 'siege', cost: 120, strength: 12, ranged: 14, range: 2, moves: 2, tech: 'physics', obsolete: 'chemistry', upgrade: 'cannon', abilities: ['bonus_vs_cities', 'must_setup'] }),
  U({ id: 'caravel', name: 'Caravel', class: 'naval_melee', domain: 'sea', cost: 120, strength: 20, moves: 4, tech: 'astronomy', obsolete: 'combustion', upgrade: 'ironclad', abilities: ['extra_sight'] }),
  // ----- Renaissance
  U({ id: 'musketman', name: 'Musketman', class: 'gun', cost: 150, strength: 24, moves: 2, tech: 'gunpowder', obsolete: 'rifling', upgrade: 'rifleman' }),
  U({ id: 'lancer', name: 'Lancer', class: 'mounted', cost: 185, strength: 25, moves: 4, tech: 'metallurgy', obsolete: 'combined_arms', upgrade: 'anti_tank_gun', resource: 'horses', abilities: ['no_terrain_defense', 'penalty_vs_cities', 'bonus_vs_mounted'] }),
  U({ id: 'cannon', name: 'Cannon', class: 'siege', cost: 185, strength: 14, ranged: 20, range: 2, moves: 2, tech: 'chemistry', obsolete: 'dynamite', upgrade: 'artillery', abilities: ['bonus_vs_cities', 'must_setup'] }),
  U({ id: 'frigate', name: 'Frigate', class: 'naval_ranged', domain: 'sea', cost: 185, strength: 25, ranged: 28, range: 2, moves: 5, tech: 'navigation', obsolete: 'electronics', upgrade: 'battleship', resource: 'iron' }),
  U({ id: 'privateer', name: 'Privateer', class: 'naval_melee', domain: 'sea', cost: 150, strength: 25, moves: 5, tech: 'navigation', obsolete: 'combustion', upgrade: 'destroyer' }),
  // ----- Industrial
  U({ id: 'explorer', name: 'Explorer', class: 'recon', cost: 65, strength: 10, moves: 3, tech: 'scientific_theory', obsolete: 'radar', upgrade: 'paratrooper', abilities: ['ignore_terrain'] }),
  U({ id: 'rifleman', name: 'Rifleman', class: 'gun', cost: 225, strength: 34, moves: 2, tech: 'rifling', obsolete: 'replaceable_parts', upgrade: 'great_war_infantry' }),
  U({ id: 'cavalry', name: 'Cavalry', class: 'mounted', cost: 225, strength: 34, moves: 4, tech: 'military_science', obsolete: 'combustion', upgrade: 'landship', resource: 'horses', abilities: ['no_terrain_defense', 'penalty_vs_cities', 'withdraw'] }),
  U({ id: 'gatling_gun', name: 'Gatling Gun', class: 'ranged', cost: 225, strength: 30, ranged: 30, range: 1, moves: 2, tech: 'industrialization', obsolete: 'ballistics', upgrade: 'machine_gun' }),
  U({ id: 'artillery', name: 'Artillery', class: 'siege', cost: 250, strength: 21, ranged: 28, range: 3, moves: 2, tech: 'dynamite', obsolete: 'rocketry', upgrade: 'rocket_artillery', abilities: ['bonus_vs_cities', 'must_setup', 'indirect_fire'] }),
  U({ id: 'ironclad', name: 'Ironclad', class: 'naval_melee', domain: 'sea', cost: 250, strength: 45, moves: 4, tech: 'steam_power', obsolete: 'combustion', upgrade: 'destroyer', resource: 'coal', abilities: ['coast_only'] }),
  U({ id: 'great_war_infantry', name: 'Great War Infantry', class: 'gun', cost: 320, strength: 50, moves: 2, tech: 'replaceable_parts', obsolete: 'plastics', upgrade: 'infantry' }),
  U({ id: 'triplane', name: 'Triplane', class: 'fighter', domain: 'air', cost: 325, strength: 0, ranged: 35, range: 5, moves: 1, tech: 'flight', obsolete: 'radar', upgrade: 'fighter', resource: 'oil' }),
  U({ id: 'great_war_bomber', name: 'Great War Bomber', class: 'bomber', domain: 'air', cost: 325, strength: 0, ranged: 50, range: 6, moves: 1, tech: 'flight', obsolete: 'radar', upgrade: 'bomber', resource: 'oil' }),
  // ----- Modern
  U({ id: 'infantry', name: 'Infantry', class: 'gun', cost: 375, strength: 70, moves: 2, tech: 'plastics', obsolete: 'mobile_tactics', upgrade: 'mechanized_infantry' }),
  U({ id: 'machine_gun', name: 'Machine Gun', class: 'ranged', cost: 350, strength: 60, ranged: 60, range: 1, moves: 2, tech: 'ballistics', obsolete: 'nuclear_fission', upgrade: 'bazooka' }),
  U({ id: 'anti_aircraft_gun', name: 'Anti-Aircraft Gun', class: 'gun', cost: 300, strength: 50, moves: 2, tech: 'ballistics', obsolete: 'rocketry', upgrade: 'mobile_sam', abilities: ['intercept'] }),
  U({ id: 'landship', name: 'Landship', class: 'armor', cost: 350, strength: 60, moves: 4, tech: 'combustion', obsolete: 'combined_arms', upgrade: 'tank', resource: 'oil', abilities: ['no_terrain_defense', 'penalty_vs_cities'] }),
  U({ id: 'destroyer', name: 'Destroyer', class: 'naval_melee', domain: 'sea', cost: 375, strength: 55, moves: 6, tech: 'combustion', abilities: ['see_submarines'] }),
  U({ id: 'battleship', name: 'Battleship', class: 'naval_ranged', domain: 'sea', cost: 375, strength: 55, ranged: 65, range: 3, moves: 5, tech: 'electronics', resource: 'oil', abilities: ['indirect_fire'] }),
  U({ id: 'submarine', name: 'Submarine', class: 'submarine', domain: 'sea', cost: 325, strength: 35, ranged: 60, range: 1, moves: 5, tech: 'refrigeration', obsolete: 'telecommunications', upgrade: 'nuclear_submarine', abilities: ['invisible'] }),
  U({ id: 'carrier', name: 'Carrier', class: 'carrier', domain: 'sea', cost: 375, strength: 40, moves: 5, tech: 'electronics' }),
  U({ id: 'anti_tank_gun', name: 'Anti-Tank Gun', class: 'gun', cost: 300, strength: 50, moves: 2, tech: 'combined_arms', obsolete: 'computers', upgrade: 'helicopter_gunship' }),
  // ----- Atomic
  U({ id: 'fighter', name: 'Fighter', class: 'fighter', domain: 'air', cost: 375, strength: 0, ranged: 45, range: 8, moves: 1, tech: 'radar', obsolete: 'lasers', upgrade: 'jet_fighter', resource: 'oil' }),
  U({ id: 'bomber', name: 'Bomber', class: 'bomber', domain: 'air', cost: 375, strength: 0, ranged: 65, range: 10, moves: 1, tech: 'radar', obsolete: 'stealth', upgrade: 'stealth_bomber', resource: 'oil' }),
  U({ id: 'paratrooper', name: 'Paratrooper', class: 'gun', cost: 375, strength: 65, moves: 2, tech: 'radar', upgrade: 'xcom_squad', abilities: ['paradrop'] }),
  U({ id: 'tank', name: 'Tank', class: 'armor', cost: 375, strength: 70, moves: 5, tech: 'combined_arms', obsolete: 'lasers', upgrade: 'modern_armor', resource: 'oil', abilities: ['no_terrain_defense', 'penalty_vs_cities'] }),
  U({ id: 'bazooka', name: 'Bazooka', class: 'gun', cost: 375, strength: 85, moves: 2, tech: 'nuclear_fission' }),
  U({ id: 'mobile_sam', name: 'Mobile SAM', class: 'gun', cost: 425, strength: 65, moves: 4, tech: 'rocketry', abilities: ['intercept'] }),
  U({ id: 'atomic_bomb', name: 'Atomic Bomb', class: 'missile', domain: 'air', cost: 600, strength: 0, ranged: 0, range: 10, moves: 1, tech: 'nuclear_fission', resource: 'uranium', abilities: ['nuke'], blast: 1 }),
  U({ id: 'guided_missile', name: 'Guided Missile', class: 'missile', domain: 'air', cost: 150, strength: 0, ranged: 60, range: 8, moves: 1, tech: 'advanced_ballistics' }),
  U({ id: 'rocket_artillery', name: 'Rocket Artillery', class: 'siege', cost: 425, strength: 45, ranged: 60, range: 3, moves: 3, tech: 'rocketry', resource: 'aluminum', abilities: ['bonus_vs_cities', 'indirect_fire'] }),
  // ----- Information
  U({ id: 'helicopter_gunship', name: 'Helicopter Gunship', class: 'helicopter', cost: 425, strength: 60, moves: 6, tech: 'computers', resource: 'aluminum', abilities: ['ignore_terrain'] }),
  U({ id: 'mechanized_infantry', name: 'Mechanized Infantry', class: 'gun', cost: 375, strength: 90, moves: 3, tech: 'mobile_tactics' }),
  U({ id: 'nuclear_submarine', name: 'Nuclear Submarine', class: 'submarine', domain: 'sea', cost: 425, strength: 50, ranged: 85, range: 1, moves: 6, tech: 'telecommunications', abilities: ['invisible'] }),
  U({ id: 'missile_cruiser', name: 'Missile Cruiser', class: 'naval_ranged', domain: 'sea', cost: 425, strength: 80, ranged: 100, range: 3, moves: 7, tech: 'robotics', abilities: ['see_submarines'] }),
  U({ id: 'modern_armor', name: 'Modern Armor', class: 'armor', cost: 425, strength: 100, moves: 5, tech: 'lasers', upgrade: 'giant_death_robot', resource: 'aluminum', abilities: ['no_terrain_defense', 'penalty_vs_cities'] }),
  U({ id: 'jet_fighter', name: 'Jet Fighter', class: 'fighter', domain: 'air', cost: 425, strength: 0, ranged: 80, range: 10, moves: 1, tech: 'lasers', resource: 'aluminum' }),
  U({ id: 'stealth_bomber', name: 'Stealth Bomber', class: 'bomber', domain: 'air', cost: 425, strength: 0, ranged: 85, range: 20, moves: 1, tech: 'stealth', resource: 'aluminum' }),
  U({ id: 'nuclear_missile', name: 'Nuclear Missile', class: 'missile', domain: 'air', cost: 1000, strength: 0, ranged: 0, range: 12, moves: 1, tech: 'advanced_ballistics', resource: 'uranium', abilities: ['nuke'], blast: 2 }),
  U({ id: 'xcom_squad', name: 'XCOM Squad', class: 'gun', cost: 400, strength: 110, moves: 2, tech: 'nanotechnology', abilities: ['paradrop', 'ignore_terrain'] }),
  U({ id: 'giant_death_robot', name: 'Giant Death Robot', class: 'armor', cost: 425, strength: 150, moves: 5, tech: 'nuclear_fusion', resource: 'uranium', abilities: ['no_terrain_defense', 'penalty_vs_cities'] }),

  // ----- Unique units (`civs.ts`)
  U({ id: 'war_chariot', name: 'War Chariot', class: 'mounted', cost: 56, strength: 6, ranged: 10, range: 2, moves: 5, tech: 'the_wheel', obsolete: 'chivalry', upgrade: 'knight', civ: 'egypt', replaces: 'chariot_archer', abilities: ['no_terrain_defense'] }),
  U({ id: 'bowman', name: 'Bowman', class: 'ranged', cost: 40, strength: 6, ranged: 9, range: 2, moves: 2, tech: 'archery', obsolete: 'machinery', upgrade: 'composite_bowman', civ: 'babylon', replaces: 'archer' }),
  U({ id: 'chu_ko_nu', name: 'Chu-Ko-Nu', class: 'ranged', cost: 120, strength: 13, ranged: 14, range: 2, moves: 2, tech: 'machinery', obsolete: 'industrialization', upgrade: 'gatling_gun', civ: 'china', replaces: 'crossbowman' }),
  U({ id: 'war_elephant', name: 'War Elephant', class: 'mounted', cost: 75, strength: 9, ranged: 11, range: 2, moves: 3, tech: 'the_wheel', obsolete: 'chivalry', upgrade: 'knight', civ: 'india', replaces: 'chariot_archer', abilities: ['no_terrain_defense'] }),
  U({ id: 'immortal', name: 'Immortal', class: 'melee', cost: 56, strength: 12, moves: 2, tech: 'bronze_working', obsolete: 'civil_service', upgrade: 'pikeman', civ: 'persia', replaces: 'spearman', abilities: ['bonus_vs_mounted'] }),
  U({ id: 'turtle_ship', name: 'Turtle Ship', class: 'naval_melee', domain: 'sea', cost: 120, strength: 36, moves: 4, tech: 'astronomy', obsolete: 'combustion', upgrade: 'ironclad', civ: 'korea', replaces: 'caravel', abilities: ['coast_only'] }),
  U({ id: 'camel_archer', name: 'Camel Archer', class: 'mounted', cost: 120, strength: 21, ranged: 21, range: 2, moves: 4, tech: 'chivalry', obsolete: 'military_science', upgrade: 'cavalry', resource: 'horses', civ: 'arabia', replaces: 'knight', abilities: ['no_terrain_defense', 'withdraw'] }),
  U({ id: 'landsknecht', name: 'Landsknecht', class: 'melee', cost: 60, strength: 16, moves: 2, tech: 'civil_service', obsolete: 'metallurgy', upgrade: 'lancer', civ: 'germany', replaces: 'pikeman', abilities: ['bonus_vs_mounted'] }),
  U({ id: 'mohawk_warrior', name: 'Mohawk Warrior', class: 'melee', cost: 75, strength: 14, moves: 2, tech: 'iron_working', obsolete: 'steel', upgrade: 'longswordsman', civ: 'iroquois', replaces: 'swordsman' }),
  U({ id: 'jaguar', name: 'Jaguar', class: 'melee', cost: 40, strength: 9, moves: 2, obsolete: 'metal_casting', upgrade: 'swordsman', civ: 'aztec', replaces: 'warrior', abilities: ['kill_heal', 'jungle_fighter'] }),
  U({ id: 'cossack', name: 'Cossack', class: 'mounted', cost: 225, strength: 36, moves: 4, tech: 'military_science', obsolete: 'combustion', upgrade: 'landship', resource: 'horses', civ: 'russia', replaces: 'cavalry', abilities: ['no_terrain_defense', 'withdraw'] }),
  U({ id: 'musketeer', name: 'Musketeer', class: 'gun', cost: 150, strength: 28, moves: 2, tech: 'gunpowder', obsolete: 'rifling', upgrade: 'rifleman', civ: 'france', replaces: 'musketman' }),
  U({ id: 'legion', name: 'Legion', class: 'melee', cost: 75, strength: 17, moves: 2, tech: 'iron_working', obsolete: 'steel', upgrade: 'longswordsman', resource: 'iron', civ: 'rome', replaces: 'swordsman' }),
  U({ id: 'hoplite', name: 'Hoplite', class: 'melee', cost: 56, strength: 13, moves: 2, tech: 'bronze_working', obsolete: 'civil_service', upgrade: 'pikeman', civ: 'greece', replaces: 'spearman', abilities: ['bonus_vs_mounted'] }),
  U({ id: 'samurai', name: 'Samurai', class: 'melee', cost: 120, strength: 23, moves: 2, tech: 'steel', obsolete: 'gunpowder', upgrade: 'musketman', resource: 'iron', civ: 'japan', replaces: 'longswordsman' }),
  U({ id: 'longbowman', name: 'Longbowman', class: 'ranged', cost: 120, strength: 13, ranged: 18, range: 3, moves: 2, tech: 'machinery', obsolete: 'industrialization', upgrade: 'gatling_gun', civ: 'england', replaces: 'crossbowman' }),
  U({ id: 'keshik', name: 'Keshik', class: 'mounted', cost: 120, strength: 15, ranged: 16, range: 2, moves: 5, tech: 'chivalry', obsolete: 'military_science', upgrade: 'cavalry', resource: 'horses', civ: 'mongolia', replaces: 'knight', abilities: ['no_terrain_defense'] }),
  U({ id: 'janissary', name: 'Janissary', class: 'gun', cost: 150, strength: 26, moves: 2, tech: 'gunpowder', obsolete: 'rifling', upgrade: 'rifleman', civ: 'ottomans', replaces: 'musketman', abilities: ['kill_heal'] }),
  U({ id: 'impi', name: 'Impi', class: 'melee', cost: 90, strength: 16, moves: 3, tech: 'civil_service', obsolete: 'metallurgy', upgrade: 'lancer', civ: 'zulu', replaces: 'pikeman', abilities: ['bonus_vs_mounted'] }),
  U({ id: 'slinger', name: 'Slinger', class: 'ranged', cost: 35, strength: 5, ranged: 7, range: 2, moves: 2, tech: 'archery', obsolete: 'machinery', upgrade: 'composite_bowman', civ: 'inca', replaces: 'archer' }),
  U({ id: 'minuteman', name: 'Minuteman', class: 'gun', cost: 150, strength: 24, moves: 2, tech: 'gunpowder', obsolete: 'rifling', upgrade: 'rifleman', civ: 'america', replaces: 'musketman', abilities: ['ignore_terrain'] }),
  U({ id: 'conquistador', name: 'Conquistador', class: 'mounted', cost: 120, strength: 20, moves: 4, tech: 'chivalry', obsolete: 'military_science', upgrade: 'cavalry', resource: 'horses', civ: 'spain', replaces: 'knight', abilities: ['no_terrain_defense', 'withdraw', 'extra_sight'] }),
  U({ id: 'naresuans_elephant', name: "Naresuan's Elephant", class: 'mounted', cost: 120, strength: 25, moves: 3, tech: 'chivalry', obsolete: 'military_science', upgrade: 'cavalry', civ: 'siam', replaces: 'knight', abilities: ['no_terrain_defense'] }),
  U({ id: 'mehal_sefari', name: 'Mehal Sefari', class: 'gun', cost: 225, strength: 34, moves: 2, tech: 'rifling', obsolete: 'replaceable_parts', upgrade: 'great_war_infantry', civ: 'ethiopia', replaces: 'rifleman', abilities: ['homeland'] }),
  U({ id: 'pictish_warrior', name: 'Pictish Warrior', class: 'melee', cost: 56, strength: 11, moves: 2, tech: 'bronze_working', obsolete: 'civil_service', upgrade: 'pikeman', civ: 'celts', replaces: 'spearman', abilities: ['bonus_vs_mounted', 'foreign_lands'] }),
  U({ id: 'quinquereme', name: 'Quinquereme', class: 'naval_melee', domain: 'sea', cost: 56, strength: 13, moves: 4, tech: 'sailing', obsolete: 'astronomy', upgrade: 'caravel', civ: 'carthage', replaces: 'trireme', abilities: ['coast_only'] }),
  U({ id: 'winged_hussar', name: 'Winged Hussar', class: 'mounted', cost: 185, strength: 30, moves: 5, tech: 'metallurgy', obsolete: 'combined_arms', upgrade: 'anti_tank_gun', resource: 'horses', civ: 'poland', replaces: 'lancer', abilities: ['no_terrain_defense', 'penalty_vs_cities', 'bonus_vs_mounted'] }),
  U({ id: 'sea_beggar', name: 'Sea Beggar', class: 'naval_melee', domain: 'sea', cost: 150, strength: 27, moves: 5, tech: 'navigation', obsolete: 'combustion', upgrade: 'destroyer', civ: 'netherlands', replaces: 'privateer', abilities: ['heal_adjacent'] }),
  U({ id: 'maori_warrior', name: 'Maori Warrior', class: 'melee', cost: 40, strength: 8, moves: 2, obsolete: 'metal_casting', upgrade: 'swordsman', civ: 'polynesia', replaces: 'warrior', abilities: ['haka'] }),
  U({ id: 'berserker', name: 'Berserker', class: 'melee', cost: 120, strength: 21, moves: 3, tech: 'steel', obsolete: 'gunpowder', upgrade: 'musketman', resource: 'iron', civ: 'denmark', replaces: 'longswordsman', abilities: ['amphibious'] }),
];

export const UNITS: Record<string, UnitType> = Object.fromEntries(UNIT_LIST.map((u) => [u.id, u]));

/** Whether a unit fights at range (archers, siege, ranged ships, aircraft). */
export const isRanged = (u: UnitType) => !!u.ranged && u.ranged > 0 && u.class !== 'missile';
/** Whether it's a military unit (holds a tile against others; can be attacked as one). */
export const isMilitary = (u: UnitType) => u.strength > 0 || (u.ranged ?? 0) > 0;

/** Whether a unit can fortify (Civ V: not mounted units, armour or ships). */
export const canFortify = (type: UnitType) => isMilitary(type) && type.domain === 'land' && type.class !== 'mounted' && type.class !== 'armor';
/** Whether a unit type is a great person (not the Great War's infantry and bombers, which only share the word). */
export const isGreatPerson = (type: string) => UNITS[type]?.class === 'great';

/**
 * Whether a unit type is kept out of land closed to it (another civ's, at peace, without open
 * borders): every unit, soldier or civilian, but those that carry a faith (missionaries,
 * inquisitors and Great Prophets go into rival land without leave, Civ V's).
 */
export const heedsBorders = (type: string) => !UNITS[type]?.abilities?.some((a) => a === 'spread_religion' || a === 'remove_heresy');

/**
 * The place a unit takes on a tile, one unit to each (Civ V's one soldier and one civilian to a
 * tile): a civilian's (great people too), a soldier's, or, at sea, a land soldier's in its boat
 * (embarked), so a ship and a soldier it sails with share the water (Civ VI's escort).
 */
export function stackKind(type: string, water: boolean): 'civilian' | 'soldier' | 'embarked' {
  const u = UNITS[type];
  if (!u || !isMilitary(u) || isGreatPerson(type)) return 'civilian';
  return water && u.domain === 'land' ? 'embarked' : 'soldier';
}
