import type { Effects } from './effects';

/**
 * Buildings, national wonders and world wonders, Civilization V's: what each costs to build, its
 * upkeep in gold a turn, the tech it needs, what it needs first (a building in the city, a river,
 * the coast, a mountain), and what it does (`Effects`). Civs' unique buildings are here too (`civ`,
 * `replaces`).
 */

export type BuildingKind = 'building' | 'national' | 'world';

export interface Building {
  id: string;
  name: string;
  kind: BuildingKind;
  cost: number;
  upkeep: number;
  tech?: string;
  /** A building the city needs first (national wonders: in every city, see `everyCity`). */
  needs?: string;
  /** A national wonder needs this building in every city first. */
  everyCity?: string;
  coastal?: boolean;
  river?: boolean;
  /** A mountain within the city's reach. */
  mountain?: boolean;
  /** A strategic resource it uses (one). */
  resource?: string;
  /** A resource that has to be near the city (worked or not). */
  nearResource?: string[];
  /** A policy tree that has to be open (or an ideology adopted) first: Civ V's wonders of Liberty, Honor and the rest. */
  policy?: string;
  effects: Effects;
  /** What it does, said plainly (for what the effects don't say alone). */
  note?: string;
  civ?: string;
  replaces?: string;
  /** Can't be built (the palace comes with the capital). */
  unbuildable?: boolean;
  /** Its colour for the map's little buildings. */
  color?: string;
}

const B = (b: Omit<Building, 'kind'> & { kind?: BuildingKind }): Building => ({ kind: 'building', ...b });
const NW = (b: Omit<Building, 'kind' | 'upkeep'> & { upkeep?: number }): Building => ({ kind: 'national', upkeep: 0, ...b });
const WW = (b: Omit<Building, 'kind' | 'upkeep'>): Building => ({ kind: 'world', upkeep: 0, ...b });

export const BUILDING_LIST: Building[] = [
  B({ id: 'palace', name: 'Palace', cost: 0, upkeep: 0, unbuildable: true, effects: { yields: { prod: 3, science: 3, gold: 3, culture: 1 }, defense: 2.5 }, note: 'The capital.' }),

  // ----- Ancient
  B({ id: 'monument', name: 'Monument', cost: 40, upkeep: 1, effects: { yields: { culture: 2 } } }),
  B({ id: 'granary', name: 'Granary', cost: 65, upkeep: 1, tech: 'pottery', effects: { yields: { food: 2 }, tiles: [{ where: { resource: ['wheat', 'bananas', 'deer'] }, yields: { food: 1 } }] } }),
  B({ id: 'shrine', name: 'Shrine', cost: 40, upkeep: 1, tech: 'pottery', effects: { yields: { faith: 1 } } }),
  B({ id: 'library', name: 'Library', cost: 75, upkeep: 1, tech: 'writing', effects: { perPop: { science: 0.5 }, specialists: [{ kind: 'scientist', slots: 1 }] } }),
  B({ id: 'barracks', name: 'Barracks', cost: 75, upkeep: 1, tech: 'bronze_working', effects: { xp: [{ domain: 'all', xp: 15 }] } }),
  B({ id: 'walls', name: 'Walls', cost: 75, upkeep: 1, tech: 'masonry', effects: { defense: 5, hp: 50 } }),
  B({ id: 'water_mill', name: 'Water Mill', cost: 75, upkeep: 2, tech: 'the_wheel', river: true, effects: { yields: { food: 2, prod: 1 } } }),
  B({ id: 'stable', name: 'Stable', cost: 100, upkeep: 1, tech: 'horseback_riding', nearResource: ['horses', 'cattle', 'sheep'], effects: { unitProduction: [{ classes: ['mounted'], percent: 15 }], tiles: [{ where: { improvement: ['pasture'] }, yields: { prod: 1 } }] } }),
  B({ id: 'circus', name: 'Circus', cost: 75, upkeep: 1, tech: 'trapping', nearResource: ['horses', 'ivory'], effects: { happiness: 3 } }),
  B({ id: 'lighthouse', name: 'Lighthouse', cost: 75, upkeep: 1, tech: 'optics', coastal: true, effects: { tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { food: 1 } }], xp: [{ domain: 'sea', xp: 15 }] } }),
  B({ id: 'caravansary', name: 'Caravansary', cost: 120, upkeep: 1, tech: 'horseback_riding', effects: { yields: { gold: 2 }, special: ['land_trade_range'] }, note: 'Land trade routes from here reach half again as far.' }),
  // ----- Classical
  B({ id: 'temple', name: 'Temple', cost: 100, upkeep: 2, tech: 'philosophy', needs: 'shrine', effects: { yields: { faith: 2 } } }),
  B({ id: 'amphitheater', name: 'Amphitheater', cost: 100, upkeep: 1, tech: 'drama', needs: 'monument', effects: { yields: { culture: 1 }, happiness: 1, greatWorks: { kind: 'writing', slots: 1 } } }),
  B({ id: 'market', name: 'Market', cost: 100, upkeep: 0, tech: 'currency', effects: { yields: { gold: 2 }, percent: { gold: 25 }, specialists: [{ kind: 'merchant', slots: 1 }] } }),
  B({ id: 'mint', name: 'Mint', cost: 120, upkeep: 0, tech: 'currency', nearResource: ['gold_ore', 'silver', 'copper'], effects: { tiles: [{ where: { resource: ['gold_ore', 'silver', 'copper'] }, yields: { gold: 2 } }] } }),
  B({ id: 'colosseum', name: 'Colosseum', cost: 100, upkeep: 1, tech: 'construction', effects: { happiness: 4 } }),
  B({ id: 'courthouse', name: 'Courthouse', cost: 100, upkeep: 1, tech: 'mathematics', effects: { special: ['no_occupied_unhappiness'] }, note: 'Ends the unhappiness of an occupied city. Only in conquered cities.' }),
  B({ id: 'aqueduct', name: 'Aqueduct', cost: 100, upkeep: 1, tech: 'engineering', effects: { foodKept: 40 } }),
  B({ id: 'forge', name: 'Forge', cost: 120, upkeep: 1, tech: 'metal_casting', effects: { unitProduction: [{ domain: 'land', percent: 15 }], tiles: [{ where: { resource: ['iron'] }, yields: { prod: 1 } }] } }),
  // ----- Medieval
  B({ id: 'harbor', name: 'Harbor', cost: 120, upkeep: 2, tech: 'compass', coastal: true, effects: { tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { prod: 1 } }], special: ['sea_trade_range', 'connects_by_sea'] }, note: "Sea trade routes from here reach half again as far; links the city to the capital by sea." }),
  B({ id: 'university', name: 'University', cost: 160, upkeep: 3, tech: 'education', needs: 'library', effects: { percent: { science: 33 }, tiles: [{ where: { feature: ['jungle'] }, yields: { science: 2 } }], specialists: [{ kind: 'scientist', slots: 2 }] } }),
  B({ id: 'castle', name: 'Castle', cost: 160, upkeep: 0, tech: 'chivalry', needs: 'walls', effects: { defense: 7, hp: 25 } }),
  B({ id: 'workshop', name: 'Workshop', cost: 120, upkeep: 2, tech: 'metal_casting', effects: { yields: { prod: 2 }, percent: { prod: 10 }, specialists: [{ kind: 'engineer', slots: 1 }] } }),
  B({ id: 'garden', name: 'Garden', cost: 120, upkeep: 1, tech: 'theology', river: true, effects: { greatPeoplePercent: 25 } }),
  B({ id: 'armory', name: 'Armory', cost: 160, upkeep: 1, tech: 'steel', needs: 'barracks', effects: { xp: [{ domain: 'all', xp: 15 }] } }),
  // ----- Renaissance
  B({ id: 'bank', name: 'Bank', cost: 220, upkeep: 0, tech: 'banking', needs: 'market', effects: { yields: { gold: 2 }, percent: { gold: 25 }, specialists: [{ kind: 'merchant', slots: 1 }] } }),
  B({ id: 'observatory', name: 'Observatory', cost: 200, upkeep: 0, tech: 'astronomy', mountain: true, effects: { percent: { science: 50 } } }),
  B({ id: 'opera_house', name: 'Opera House', cost: 220, upkeep: 2, tech: 'acoustics', needs: 'amphitheater', effects: { yields: { culture: 1 }, greatWorks: { kind: 'music', slots: 1 } } }),
  B({ id: 'zoo', name: 'Zoo', cost: 220, upkeep: 2, tech: 'printing_press', needs: 'colosseum', effects: { happiness: 4 } }),
  B({ id: 'seaport', name: 'Seaport', cost: 250, upkeep: 2, tech: 'navigation', needs: 'harbor', coastal: true, effects: { tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { prod: 1, gold: 1 } }], unitProduction: [{ domain: 'sea', percent: 15 }] } }),
  // ----- Industrial
  B({ id: 'museum', name: 'Museum', cost: 300, upkeep: 3, tech: 'archaeology', needs: 'opera_house', effects: { yields: { culture: 1 }, greatWorks: { kind: 'art', slots: 2 } } }),
  B({ id: 'public_school', name: 'Public School', cost: 300, upkeep: 3, tech: 'scientific_theory', needs: 'university', effects: { yields: { science: 3 }, perPop: { science: 0.5 }, specialists: [{ kind: 'scientist', slots: 1 }] } }),
  B({ id: 'factory', name: 'Factory', cost: 300, upkeep: 3, tech: 'industrialization', needs: 'workshop', resource: 'coal', effects: { yields: { prod: 4 }, percent: { prod: 25 }, specialists: [{ kind: 'engineer', slots: 2 }] } }),
  B({ id: 'stock_exchange', name: 'Stock Exchange', cost: 300, upkeep: 0, tech: 'electricity', needs: 'bank', effects: { yields: { gold: 3 }, percent: { gold: 25 }, specialists: [{ kind: 'merchant', slots: 2 }] } }),
  B({ id: 'hospital', name: 'Hospital', cost: 360, upkeep: 2, tech: 'biology', needs: 'aqueduct', effects: { yields: { food: 5 } } }),
  B({ id: 'military_academy', name: 'Military Academy', cost: 300, upkeep: 1, tech: 'military_science', needs: 'barracks', effects: { xp: [{ domain: 'all', xp: 15 }] } }),
  B({ id: 'arsenal', name: 'Arsenal', cost: 300, upkeep: 0, tech: 'railroad', needs: 'castle', effects: { defense: 9, hp: 25 } }),
  B({ id: 'hotel', name: 'Hotel', cost: 300, upkeep: 2, tech: 'refrigeration', effects: { tourismPercent: 50 } }),
  // ----- Modern and on
  B({ id: 'broadcast_tower', name: 'Broadcast Tower', cost: 450, upkeep: 3, tech: 'radio', needs: 'museum', effects: { yields: { culture: 3 }, percent: { culture: 33 }, greatWorks: { kind: 'music', slots: 1 } } }),
  B({ id: 'stadium', name: 'Stadium', cost: 450, upkeep: 2, tech: 'refrigeration', needs: 'zoo', effects: { happiness: 4 } }),
  B({ id: 'airport', name: 'Airport', cost: 450, upkeep: 5, tech: 'radar', effects: { tourismPercent: 50, special: ['airlift'] }, note: 'A unit here can be flown to another city of yours with an airport, once a turn.' }),
  B({ id: 'medical_lab', name: 'Medical Lab', cost: 500, upkeep: 3, tech: 'penicillin', needs: 'hospital', effects: { foodKept: 25 } }),
  B({ id: 'research_lab', name: 'Research Lab', cost: 500, upkeep: 3, tech: 'computers', needs: 'public_school', effects: { yields: { science: 4 }, percent: { science: 50 }, specialists: [{ kind: 'scientist', slots: 1 }] } }),
  B({ id: 'hydro_plant', name: 'Hydro Plant', cost: 360, upkeep: 3, tech: 'electricity', needs: 'factory', river: true, resource: 'aluminum', effects: { tiles: [{ where: { river: true }, yields: { prod: 1 } }] } }),
  B({ id: 'nuclear_plant', name: 'Nuclear Plant', cost: 500, upkeep: 3, tech: 'nuclear_fission', needs: 'factory', resource: 'uranium', effects: { yields: { prod: 5 }, percent: { prod: 15 } } }),
  B({ id: 'solar_plant', name: 'Solar Plant', cost: 500, upkeep: 3, tech: 'ecology', needs: 'factory', effects: { yields: { prod: 5 }, percent: { prod: 15 } } }),
  B({ id: 'military_base', name: 'Military Base', cost: 450, upkeep: 0, tech: 'telecommunications', needs: 'arsenal', effects: { defense: 12, hp: 25 } }),
  B({ id: 'spaceship_factory', name: 'Spaceship Factory', cost: 450, upkeep: 3, tech: 'robotics', needs: 'factory', resource: 'aluminum', effects: { spaceshipProduction: 50 } }),
  B({ id: 'police_station', name: 'Police Station', cost: 300, upkeep: 2, tech: 'electricity', needs: 'constabulary', effects: { special: ['slow_spies'] }, note: "Enemy spies steal a quarter slower here." }),
  B({ id: 'constabulary', name: 'Constabulary', cost: 160, upkeep: 1, tech: 'banking', effects: { special: ['slow_spies'] }, note: "Enemy spies steal a quarter slower here." }),

  // ----- Unique buildings (`civs.ts`)
  B({ id: 'burial_tomb', name: 'Burial Tomb', cost: 100, upkeep: 0, tech: 'philosophy', needs: 'shrine', civ: 'egypt', replaces: 'temple', effects: { yields: { faith: 2 }, happiness: 2, special: ['double_plunder'] }, note: 'A Temple that cheers, but doubles the gold plundered if the city is taken.' }),
  B({ id: 'royal_library', name: 'Royal Library', cost: 75, upkeep: 1, tech: 'writing', civ: 'babylon', replaces: 'library', effects: { perPop: { science: 0.5 }, yields: { culture: 1 }, specialists: [{ kind: 'scientist', slots: 1 }], greatWorks: { kind: 'writing', slots: 1 }, xp: [{ domain: 'all', xp: 15 }] } }),
  B({ id: 'paper_maker', name: 'Paper Maker', cost: 75, upkeep: 0, tech: 'writing', civ: 'china', replaces: 'library', effects: { perPop: { science: 0.5 }, yields: { gold: 2 }, specialists: [{ kind: 'scientist', slots: 1 }] } }),
  B({ id: 'mughal_fort', name: 'Mughal Fort', cost: 160, upkeep: 0, tech: 'chivalry', needs: 'walls', civ: 'india', replaces: 'castle', effects: { defense: 7, hp: 25, yields: { culture: 2 }, cities: [{ when: { after: 'flight' }, effects: { yields: { gold: 2 } } }] }, note: 'A Castle with +2 culture, and +2 gold once Flight is known.' }),
  B({ id: 'satraps_court', name: "Satrap's Court", cost: 220, upkeep: 0, tech: 'banking', needs: 'market', civ: 'persia', replaces: 'bank', effects: { yields: { gold: 2 }, percent: { gold: 25 }, happiness: 2, specialists: [{ kind: 'merchant', slots: 1 }] } }),
  B({ id: 'seowon', name: 'Seowon', cost: 160, upkeep: 3, tech: 'education', needs: 'library', civ: 'korea', replaces: 'university', effects: { yields: { science: 2 }, percent: { science: 33 }, tiles: [{ where: { feature: ['jungle'] }, yields: { science: 2 } }], specialists: [{ kind: 'scientist', slots: 2 }] }, note: 'A University with +2 science of its own.' }),
  B({ id: 'bazaar', name: 'Bazaar', cost: 100, upkeep: 0, tech: 'currency', civ: 'arabia', replaces: 'market', effects: { yields: { gold: 2 }, percent: { gold: 25 }, tiles: [{ where: { resource: ['oil'] }, yields: { gold: 2 } }, { where: { resourceKind: ['luxury'] }, yields: { gold: 1 } }], specialists: [{ kind: 'merchant', slots: 1 }] }, note: 'A Market that makes +1 gold from the luxuries the city works, and +2 from oil.' }),
  B({ id: 'hanse', name: 'Hanse', cost: 220, upkeep: 0, tech: 'banking', needs: 'market', civ: 'germany', replaces: 'bank', effects: { yields: { gold: 2 }, percent: { gold: 25 }, specialists: [{ kind: 'merchant', slots: 1 }], special: ['hanse_trade_production'] }, note: 'A Bank that adds +5% production for each trade route from the city to a city-state.' }),
  B({ id: 'longhouse', name: 'Longhouse', cost: 120, upkeep: 2, tech: 'metal_casting', civ: 'iroquois', replaces: 'workshop', effects: { tiles: [{ where: { feature: ['forest'] }, yields: { prod: 1 } }], specialists: [{ kind: 'engineer', slots: 1 }] } }),
  B({ id: 'floating_gardens', name: 'Floating Gardens', cost: 75, upkeep: 2, tech: 'the_wheel', river: true, civ: 'aztec', replaces: 'water_mill', effects: { yields: { food: 2 }, percent: { food: 15 }, tiles: [{ where: { terrain: ['lake'] }, yields: { food: 2 } }] }, note: 'Needs a river or a lake.' }),
  B({ id: 'krepost', name: 'Krepost', cost: 100, upkeep: 1, tech: 'bronze_working', civ: 'russia', replaces: 'barracks', effects: { xp: [{ domain: 'all', xp: 15 }], borderCost: 25, tileGoldCost: 25 } }),
  B({ id: 'chateau_hall', name: 'Château', cost: 100, upkeep: 1, tech: 'construction', civ: 'france', replaces: 'colosseum', effects: { happiness: 3, yields: { culture: 1 } } }),
  B({ id: 'thermae', name: 'Thermae', cost: 100, upkeep: 1, tech: 'construction', civ: 'rome', replaces: 'colosseum', effects: { happiness: 4, yields: { food: 1 } }, note: 'A Colosseum whose baths draw people in: +1 food too.' }),
  B({ id: 'odeon', name: 'Odeon', cost: 100, upkeep: 1, tech: 'drama', needs: 'monument', civ: 'greece', replaces: 'amphitheater', effects: { yields: { culture: 2 }, happiness: 1, greatWorks: { kind: 'writing', slots: 1 } }, note: 'An Amphitheater with +1 culture more.' }),
  B({ id: 'dojo', name: 'Dojo', cost: 160, upkeep: 1, tech: 'steel', needs: 'barracks', civ: 'japan', replaces: 'armory', effects: { xp: [{ domain: 'all', xp: 15 }], yields: { culture: 2 } }, note: 'An Armory that teaches the way of the warrior: +2 culture.' }),
  B({ id: 'royal_dockyard', name: 'Royal Dockyard', cost: 120, upkeep: 2, tech: 'compass', coastal: true, civ: 'england', replaces: 'harbor', effects: { tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { prod: 1 } }], xp: [{ domain: 'sea', xp: 15 }], special: ['sea_trade_range', 'connects_by_sea'] }, note: 'A Harbor whose ships start with 15 experience. Sea trade routes from here reach half again as far; links the city to the capital by sea.' }),
  B({ id: 'ordu', name: 'Ordu', cost: 100, upkeep: 1, tech: 'horseback_riding', civ: 'mongolia', replaces: 'stable', effects: { unitProduction: [{ classes: ['mounted'], percent: 15 }], tiles: [{ where: { improvement: ['pasture'] }, yields: { prod: 1, food: 1 } }] }, note: 'A Stable that needs no horses, cattle or sheep nearby, and whose pastures give +1 food too.' }),
  B({ id: 'hammam', name: 'Hammam', cost: 100, upkeep: 1, tech: 'engineering', civ: 'ottomans', replaces: 'aqueduct', effects: { foodKept: 40, happiness: 1 } }),
  B({ id: 'ikanda', name: 'Ikanda', cost: 75, upkeep: 1, tech: 'bronze_working', civ: 'zulu', replaces: 'barracks', effects: { xp: [{ domain: 'all', xp: 15 }, { domain: 'land', xp: 10 }] }, note: 'A Barracks whose land units start with 10 more experience.' }),
  B({ id: 'terrace_farm', name: 'Terrace Farm', cost: 65, upkeep: 1, tech: 'pottery', civ: 'inca', replaces: 'granary', effects: { yields: { food: 2 }, tiles: [{ where: { resource: ['wheat', 'bananas', 'deer'] }, yields: { food: 1 } }, { where: { elevation: ['hills'] }, yields: { food: 1 } }] }, note: 'A Granary whose terraces give +1 food on every worked hill.' }),
  B({ id: 'film_studio', name: 'Film Studio', cost: 450, upkeep: 3, tech: 'radio', needs: 'museum', civ: 'america', replaces: 'broadcast_tower', effects: { yields: { culture: 3 }, percent: { culture: 33 }, greatWorks: { kind: 'music', slots: 1 }, tourismPercent: 50 }, note: 'A Broadcast Tower whose films go round the world: +50% tourism from the city.' }),
  B({ id: 'mission', name: 'Mission', cost: 100, upkeep: 2, tech: 'philosophy', needs: 'shrine', civ: 'spain', replaces: 'temple', effects: { yields: { faith: 2, science: 2 } }, note: 'A Temple that teaches too: +2 science.' }),
  B({ id: 'wat', name: 'Wat', cost: 160, upkeep: 3, tech: 'education', needs: 'library', civ: 'siam', replaces: 'university', effects: { yields: { culture: 3 }, percent: { science: 33 }, tiles: [{ where: { feature: ['jungle'] }, yields: { science: 2 } }], specialists: [{ kind: 'scientist', slots: 2 }] }, note: 'A University with +3 culture.' }),
  B({ id: 'stele', name: 'Stele', cost: 40, upkeep: 1, civ: 'ethiopia', replaces: 'monument', effects: { yields: { culture: 2, faith: 2 } }, note: 'A Monument with +2 faith.' }),
  B({ id: 'ceilidh_hall', name: 'Ceilidh Hall', cost: 220, upkeep: 2, tech: 'acoustics', needs: 'amphitheater', civ: 'celts', replaces: 'opera_house', effects: { yields: { culture: 1 }, happiness: 3, greatWorks: { kind: 'music', slots: 1 } }, note: 'An Opera House with music and dancing for everyone: +3 happiness.' }),
  B({ id: 'cothon', name: 'Cothon', cost: 75, upkeep: 1, tech: 'optics', coastal: true, civ: 'carthage', replaces: 'lighthouse', effects: { tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { food: 1 } }], xp: [{ domain: 'sea', xp: 15 }], unitProduction: [{ domain: 'sea', percent: 25 }] }, note: 'A Lighthouse with a round inner harbour: ships built a quarter faster.' }),
  B({ id: 'ducal_stable', name: 'Ducal Stable', cost: 100, upkeep: 0, tech: 'horseback_riding', nearResource: ['horses', 'cattle', 'sheep'], civ: 'poland', replaces: 'stable', effects: { unitProduction: [{ classes: ['mounted'], percent: 25 }], tiles: [{ where: { improvement: ['pasture'] }, yields: { prod: 1 } }] }, note: 'A Stable with no upkeep that builds mounted units a quarter faster.' }),
  B({ id: 'polder', name: 'Polder', cost: 75, upkeep: 2, tech: 'the_wheel', river: true, civ: 'netherlands', replaces: 'water_mill', effects: { yields: { food: 2, prod: 1 }, tiles: [{ where: { feature: ['marsh'] }, yields: { food: 2 } }, { where: { feature: ['floodplains'] }, yields: { food: 1 } }] }, note: 'A Water Mill whose dykes drain the land: +2 food from the marshes the city works, +1 from flood plains. Needs a river or a lake.' }),
  B({ id: 'marae', name: 'Marae', cost: 40, upkeep: 1, tech: 'pottery', civ: 'polynesia', replaces: 'shrine', effects: { yields: { faith: 1, culture: 2 } }, note: 'A Shrine where the people gather: +2 culture.' }),
  B({ id: 'ring_fortress', name: 'Ring Fortress', cost: 75, upkeep: 1, tech: 'masonry', civ: 'denmark', replaces: 'walls', effects: { defense: 5, hp: 50, xp: [{ domain: 'land', xp: 10 }] }, note: 'Walls round a war camp: land units trained here start with 10 experience.' }),

  // ----- National wonders
  NW({ id: 'national_college', name: 'National College', cost: 125, tech: 'philosophy', everyCity: 'library', effects: { yields: { science: 3 }, percent: { science: 50 } } }),
  NW({ id: 'national_epic', name: 'National Epic', cost: 125, tech: 'drama', everyCity: 'monument', effects: { greatPeoplePercent: 25, greatWorks: { kind: 'writing', slots: 1 } } }),
  NW({ id: 'heroic_epic', name: 'Heroic Epic', cost: 125, tech: 'iron_working', everyCity: 'barracks', effects: { promotions: [{ domain: 'land', promotion: 'morale' }] }, note: 'Land units trained here start with Morale (+15% combat strength).' }),
  NW({ id: 'circus_maximus', name: 'Circus Maximus', cost: 125, tech: 'horseback_riding', everyCity: 'colosseum', effects: { happiness: 5 } }),
  NW({ id: 'grand_temple', name: 'Grand Temple', cost: 125, tech: 'theology', everyCity: 'temple', effects: { yields: { faith: 8 }, pressure: 100 } }),
  NW({ id: 'east_india_company', name: 'East India Company', cost: 125, tech: 'economics', everyCity: 'market', effects: { yields: { gold: 4 }, percent: { gold: 15 } } }),
  NW({ id: 'ironworks', name: 'Ironworks', cost: 125, tech: 'machinery', everyCity: 'workshop', effects: { yields: { prod: 10, science: 3 } } }),
  NW({ id: 'oxford_university', name: 'Oxford University', cost: 125, tech: 'education', everyCity: 'university', effects: { yields: { science: 3 }, freeTechs: 1, greatWorks: { kind: 'writing', slots: 2 } } }),
  NW({ id: 'hermitage', name: 'Hermitage', cost: 125, tech: 'architecture', everyCity: 'opera_house', effects: { yields: { culture: 3 }, greatWorks: { kind: 'art', slots: 3 } } }),
  NW({ id: 'national_intelligence_agency', name: 'National Intelligence Agency', cost: 125, tech: 'radio', everyCity: 'police_station', effects: { special: ['extra_spy'] }, note: 'One more spy.' }),
  NW({ id: 'grand_tour_office', name: 'Grand Tour Office', cost: 125, tech: 'refrigeration', everyCity: 'hotel', effects: { tourismPercent: 25 } }),

  // ----- World wonders
  WW({ id: 'pyramids', name: 'Pyramids', cost: 185, tech: 'masonry', policy: 'liberty', effects: { yields: { culture: 1 }, freeUnits: [{ unit: 'worker', count: 2 }], workRate: 25 }, note: 'Workers build a quarter faster. Two free Workers.' }),
  WW({ id: 'stonehenge', name: 'Stonehenge', cost: 185, tech: 'calendar', effects: { yields: { faith: 5, culture: 1 } } }),
  WW({ id: 'temple_of_artemis', name: 'Temple of Artemis', cost: 185, tech: 'archery', effects: { yields: { culture: 1 }, empire: { percent: { food: 10 } }, unitProduction: [{ classes: ['ranged'], percent: 15 }] }, note: '+10% growth in every city; +15% production toward ranged units here.' }),
  WW({ id: 'great_library', name: 'Great Library', cost: 185, tech: 'writing', effects: { yields: { science: 3, culture: 1 }, freeTechs: 1, greatWorks: { kind: 'writing', slots: 2 } } }),
  WW({ id: 'colossus', name: 'Colossus', cost: 185, tech: 'sailing', coastal: true, effects: { yields: { culture: 1 }, tiles: [{ where: { terrain: ['coast', 'ocean'] }, yields: { gold: 1 } }], tradeRoutes: 1 } }),
  WW({ id: 'hanging_gardens', name: 'Hanging Gardens', cost: 185, tech: 'pottery', policy: 'tradition', effects: { yields: { food: 6, culture: 1 }, freeBuildingHere: 'garden' } }),
  WW({ id: 'great_lighthouse', name: 'Great Lighthouse', cost: 185, tech: 'optics', coastal: true, effects: { yields: { culture: 1 }, moves: [{ domain: 'sea', moves: 1 }], sight: [{ domain: 'sea', sight: 1 }] }, note: 'Every ship +1 move and +1 sight.' }),
  WW({ id: 'mausoleum', name: 'Mausoleum of Halicarnassus', cost: 250, tech: 'masonry', effects: { yields: { culture: 1 }, special: ['mausoleum_great_person_gold'] }, note: '+100 Gold whenever a Great Person is used.' }),
  WW({ id: 'statue_of_zeus', name: 'Statue of Zeus', cost: 250, tech: 'bronze_working', policy: 'honor', effects: { yields: { culture: 1 }, freeUnits: [{ unit: 'spearman', count: 1 }], combat: [{ percent: 15, when: 'vs_cities' }] }, note: 'A free Spearman; every unit +15% attacking cities.' }),
  WW({ id: 'oracle', name: 'Oracle', cost: 250, tech: 'philosophy', effects: { yields: { culture: 3 }, freePolicies: 1 } }),
  WW({ id: 'petra', name: 'Petra', cost: 250, tech: 'currency', effects: { yields: { culture: 1 }, tiles: [{ where: { terrain: ['desert'] }, yields: { food: 1, prod: 1 } }], tradeRoutes: 1 } }),
  WW({ id: 'terracotta_army', name: 'Terracotta Army', cost: 250, tech: 'construction', effects: { yields: { culture: 1 }, special: ['copy_each_land_unit'] }, note: 'A copy of each land unit you have.' }),
  WW({ id: 'great_wall', name: 'Great Wall', cost: 250, tech: 'construction', effects: { yields: { culture: 1 }, defense: 5, special: ['enemy_slowed_in_borders'] }, note: "Enemy land units take every move to enter your land (until Dynamite)." }),
  WW({ id: 'parthenon', name: 'Parthenon', cost: 250, tech: 'drama', effects: { yields: { culture: 1 }, greatWorks: { kind: 'art', slots: 1 }, freeGreatPerson: 'artist' } }),
  WW({ id: 'colosseum_flavian', name: 'Flavian Amphitheatre', cost: 250, tech: 'construction', effects: { happiness: 4, yields: { culture: 1 } } }),
  WW({ id: 'great_mosque', name: 'Great Mosque of Djenne', cost: 250, tech: 'theology', policy: 'piety', effects: { yields: { faith: 3, culture: 1 }, freeBuildingHere: 'mosque', special: ['missionaries_extra_spread'] }, note: 'A free Mosque; missionaries and prophets spread the religion once more.' }),
  WW({ id: 'hagia_sophia', name: 'Hagia Sophia', cost: 300, tech: 'theology', effects: { yields: { faith: 3, culture: 1 }, freeGreatPerson: 'prophet' } }),
  WW({ id: 'borobudur', name: 'Borobudur', cost: 300, tech: 'theology', effects: { yields: { faith: 5, culture: 1 }, freeUnits: [{ unit: 'missionary', count: 3 }] } }),
  WW({ id: 'angkor_wat', name: 'Angkor Wat', cost: 300, tech: 'education', effects: { yields: { culture: 1 }, empire: { borderCost: 25, tileGoldCost: 25 } }, note: 'Tiles cost every city 25% less culture and gold.' }),
  WW({ id: 'chichen_itza', name: 'Chichen Itza', cost: 300, tech: 'civil_service', effects: { yields: { culture: 1 }, happiness: 4, goldenAgeLength: 50 } }),
  WW({ id: 'machu_picchu', name: 'Machu Picchu', cost: 300, tech: 'guilds', mountain: true, effects: { yields: { faith: 5, culture: 1 }, percent: { gold: 25 } } }),
  WW({ id: 'notre_dame', name: 'Notre Dame', cost: 375, tech: 'physics', effects: { yields: { faith: 4, culture: 1 }, happiness: 10 } }),
  WW({ id: 'alhambra', name: 'Alhambra', cost: 375, tech: 'chivalry', effects: { yields: { culture: 3 }, happiness: 3, xp: [{ domain: 'land', xp: 15 }], greatWorks: { kind: 'art', slots: 1 } } }),
  WW({ id: 'himeji_castle', name: 'Himeji Castle', cost: 375, tech: 'steel', effects: { yields: { culture: 1 }, freeBuildingHere: 'castle', combat: [{ percent: 15, when: 'friendly_land' }] }, note: 'A free Castle; every unit +15% in your own land.' }),
  WW({ id: 'forbidden_palace', name: 'Forbidden Palace', cost: 375, tech: 'banking', policy: 'patronage', effects: { yields: { culture: 1 }, unhappinessPercent: 10 } }),
  WW({ id: 'sistine_chapel', name: 'Sistine Chapel', cost: 375, tech: 'acoustics', effects: { yields: { culture: 1 }, empire: { percent: { culture: 25 } }, greatWorks: { kind: 'art', slots: 2 } }, note: '+25% culture in every city.' }),
  WW({ id: 'leaning_tower', name: 'Leaning Tower of Pisa', cost: 375, tech: 'printing_press', effects: { yields: { culture: 1 }, empire: { greatPeoplePercent: 25 } }, note: '+25% great person points in every city.' }),
  WW({ id: 'porcelain_tower', name: 'Porcelain Tower', cost: 375, tech: 'architecture', policy: 'rationalism', effects: { yields: { culture: 1 }, freeGreatPerson: 'scientist', special: ['research_agreements_better'] }, note: 'A free Great Scientist; research agreements give half again as much science.' }),
  WW({ id: 'taj_mahal', name: 'Taj Mahal', cost: 500, tech: 'architecture', effects: { yields: { culture: 1 }, goldenAge: 10 } }),
  WW({ id: 'uffizi', name: 'Uffizi', cost: 500, tech: 'architecture', policy: 'aesthetics', effects: { yields: { culture: 1 }, greatWorks: { kind: 'art', slots: 3 }, freeGreatPerson: 'artist' } }),
  WW({ id: 'globe_theatre', name: 'Globe Theatre', cost: 500, tech: 'printing_press', effects: { yields: { culture: 1 }, greatWorks: { kind: 'writing', slots: 2 }, freeGreatPerson: 'writer' } }),
  WW({ id: 'kremlin', name: 'Kremlin', cost: 500, tech: 'railroad', policy: 'order', effects: { yields: { culture: 1 }, defense: 12, empire: { cityStrength: 25 } }, note: "Every city's combat strength +25%." }),
  WW({ id: 'big_ben', name: 'Big Ben', cost: 500, tech: 'economics', policy: 'commerce', effects: { yields: { culture: 1 }, purchaseDiscount: [{ percent: 15 }] }, note: 'Buying with gold costs 15% less.' }),
  WW({ id: 'louvre', name: 'Louvre', cost: 500, tech: 'archaeology', policy: 'exploration', effects: { yields: { culture: 1 }, greatWorks: { kind: 'art', slots: 4 }, freeGreatPerson: 'artist' } }),
  WW({ id: 'brandenburg_gate', name: 'Brandenburg Gate', cost: 625, tech: 'military_science', effects: { yields: { culture: 1 }, freeGreatPerson: 'general', xp: [{ domain: 'all', xp: 15 }] } }),
  WW({ id: 'neuschwanstein', name: 'Neuschwanstein', cost: 625, tech: 'railroad', effects: { yields: { culture: 1 }, happiness: 2, empire: { perBuilding: [{ buildings: ['castle'], effects: { yields: { gold: 3, culture: 2 }, happiness: 1 } }] } }, note: 'Every Castle +3 gold, +2 culture and +1 happiness.' }),
  WW({ id: 'statue_of_liberty', name: 'Statue of Liberty', cost: 625, tech: 'electricity', policy: 'freedom', effects: { yields: { culture: 1 }, empire: { specialistYields: { prod: 1 } } }, note: '+1 production from every specialist.' }),
  WW({ id: 'eiffel_tower', name: 'Eiffel Tower', cost: 875, tech: 'radio', effects: { yields: { culture: 1 }, happiness: 5, tourism: 12 } }),
  WW({ id: 'broadway', name: 'Broadway', cost: 875, tech: 'radio', effects: { yields: { culture: 1 }, greatWorks: { kind: 'music', slots: 3 }, freeGreatPerson: 'musician' } }),
  WW({ id: 'cristo_redentor', name: 'Cristo Redentor', cost: 875, tech: 'plastics', effects: { yields: { culture: 5 }, policyCost: 10 } }),
  WW({ id: 'pentagon', name: 'Pentagon', cost: 1000, tech: 'combined_arms', effects: { yields: { culture: 1 }, special: ['upgrades_cheaper_33'] }, note: 'Upgrading units costs a third less.' }),
  WW({ id: 'sydney_opera_house', name: 'Sydney Opera House', cost: 1000, tech: 'ecology', effects: { yields: { culture: 1 }, freePolicies: 1, greatWorks: { kind: 'music', slots: 2 } } }),
  WW({ id: 'cn_tower', name: 'CN Tower', cost: 1250, tech: 'telecommunications', effects: { yields: { culture: 1 }, freeBuildingInAll: 'broadcast_tower', empire: { happiness: 1 } }, note: 'A free Broadcast Tower in every city; +1 happiness in each.' }),
  WW({ id: 'hubble', name: 'Hubble Space Telescope', cost: 1250, tech: 'satellites', effects: { yields: { culture: 1 }, freeGreatPerson: 'scientist', spaceshipProduction: 25 }, note: 'A free Great Scientist; +25% production toward spaceship parts here.' }),
  WW({ id: 'great_firewall', name: 'Great Firewall', cost: 1250, tech: 'computers', effects: { yields: { culture: 1 }, special: ['tech_steal_immune'] }, note: "No spy can steal your techs." }),
  WW({ id: 'united_nations', name: 'United Nations', cost: 1250, tech: 'globalization', effects: { yields: { culture: 1 }, special: ['extra_delegates'] }, note: 'Two more votes for World Leader.' }),
  // Projects every civ builds for itself (Civ V's): the bomb, and the way to the stars.
  NW({ id: 'manhattan_project', name: 'Manhattan Project', cost: 1500, tech: 'nuclear_fission', effects: { special: ['enables_nukes'] }, note: 'Atomic Bombs and Nuclear Missiles can be built.' }),
  NW({ id: 'apollo_program', name: 'Apollo Program', cost: 1500, tech: 'rocketry', effects: { special: ['enables_spaceship'] }, note: 'Spaceship parts can be built.' }),
];

export const BUILDINGS: Record<string, Building> = Object.fromEntries(BUILDING_LIST.map((b) => [b.id, b]));

/** Buildings faith can buy (with a religion's beliefs): mosques, pagodas, cathedrals. Defined in `religion.ts`, listed here so cities can hold them. */
export const FAITH_BUILDINGS: Building[] = [
  B({ id: 'mosque', name: 'Mosque', cost: 0, upkeep: 0, effects: { yields: { faith: 3, culture: 2 }, happiness: 1 } }),
  B({ id: 'pagoda', name: 'Pagoda', cost: 0, upkeep: 0, effects: { yields: { faith: 2, culture: 2 }, happiness: 2 } }),
  B({ id: 'cathedral', name: 'Cathedral', cost: 0, upkeep: 0, effects: { yields: { faith: 1 }, happiness: 3, greatWorks: { kind: 'art', slots: 1 } } }),
  B({ id: 'monastery', name: 'Monastery', cost: 0, upkeep: 0, effects: { yields: { faith: 2, culture: 2 }, tiles: [{ where: { resource: ['wine', 'incense'] }, yields: { faith: 1, culture: 1 } }] } }),
];
for (const b of FAITH_BUILDINGS) BUILDINGS[b.id] = b;

/** The spaceship's parts (science victory): built like units, by cities with a Spaceship Factory helping. */
export const SPACESHIP_PARTS = [
  { id: 'ss_booster', name: 'SS Booster', cost: 2500, tech: 'advanced_ballistics', count: 3 },
  { id: 'ss_cockpit', name: 'SS Cockpit', cost: 2500, tech: 'satellites', count: 1 },
  { id: 'ss_engine', name: 'SS Engine', cost: 2500, tech: 'particle_physics', count: 1 },
  { id: 'ss_stasis_chamber', name: 'SS Stasis Chamber', cost: 2500, tech: 'nanotechnology', count: 1 },
] as const;
