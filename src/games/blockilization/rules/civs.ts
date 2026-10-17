import type { Effects } from './effects';
import type { TerrainId } from './terrain';

/**
 * The twenty civilizations: each with a leader, its colours, its cities' names (in founding order),
 * an ability (the effects of Civilization V's, said our own way), a unique unit and a unique building
 * (`units.ts`, `buildings.ts`), and where it likes to start.
 */

export interface Civ {
  id: string;
  name: string;
  adjective: string;
  leader: string;
  /** Its banner: the main colour and the one on it. */
  color: string;
  accent: string;
  ability: { name: string; text: string; effects: Effects };
  unit: string;
  building: string;
  cities: string[];
  /** A start it prefers: by the sea, by a river, or on a terrain. */
  startBias?: 'coast' | 'river' | TerrainId | 'hills' | 'forest' | 'jungle';
}

export const CIV_LIST: Civ[] = [
  {
    id: 'egypt',
    name: 'Egypt',
    adjective: 'Egyptian',
    leader: 'Ramesses II',
    color: '#f2d43a',
    accent: '#3a2a8a',
    ability: { name: 'Builders of Eternity', text: '+20% production toward wonders.', effects: { wonderProduction: 20 } },
    unit: 'war_chariot',
    building: 'burial_tomb',
    cities: ['Thebes', 'Memphis', 'Heliopolis', 'Elephantine', 'Alexandria', 'Pi-Ramesses', 'Giza', 'Byblos', 'Akhetaten', 'Hieraconpolis', 'Abydos', 'Asyut', 'Avaris', 'Lisht', 'Buto', 'Edfu'],
    startBias: 'desert',
  },
  {
    id: 'babylon',
    name: 'Babylon',
    adjective: 'Babylonian',
    leader: 'Nebuchadnezzar II',
    color: '#4a6ad0',
    accent: '#f2e8c8',
    ability: { name: 'Tablets of Learning', text: 'A free Great Scientist when you discover Writing. Great Scientists come a third faster.', effects: { special: ['scientist_on_writing', 'scientists_faster_33'] } },
    unit: 'bowman',
    building: 'royal_library',
    cities: ['Babylon', 'Akkad', 'Dur-Kurigalzu', 'Nippur', 'Borsippa', 'Sippar', 'Opis', 'Mari', 'Shushan', 'Eshnunna', 'Ellasar', 'Erech', 'Kutha', 'Sirpurla', 'Neribtum', 'Ashur'],
    startBias: 'river',
  },
  {
    id: 'china',
    name: 'China',
    adjective: 'Chinese',
    leader: 'Wu Zetian',
    color: '#2a8a5a',
    accent: '#f2f2f2',
    ability: { name: 'Mandate of Strategy', text: 'Great Generals come 50% faster and give +15% more combat strength.', effects: { special: ['generals_faster_50', 'generals_stronger'] } },
    unit: 'chu_ko_nu',
    building: 'paper_maker',
    cities: ['Beijing', 'Shanghai', "Guangzhou", 'Nanjing', 'Xian', 'Chengdu', 'Hangzhou', 'Tianjin', 'Macau', 'Shandong', 'Kaifeng', 'Ningbo', 'Baoding', 'Yangzhou', 'Harbin', 'Lanzhou'],
  },
  {
    id: 'india',
    name: 'India',
    adjective: 'Indian',
    leader: 'Gandhi',
    color: '#2aa84a',
    accent: '#ff9a3a',
    ability: { name: 'Many Hands', text: 'Twice the unhappiness from the number of cities, half from the number of citizens.', effects: { special: ['india_population_happiness'] } },
    unit: 'war_elephant',
    building: 'mughal_fort',
    cities: ['Delhi', 'Mumbai', 'Vijayanagara', 'Pataliputra', 'Varanasi', 'Agra', 'Calcutta', 'Lahore', 'Bangalore', 'Hyderabad', 'Madurai', 'Ahmedabad', 'Kolhapur', 'Prayaga', 'Ayodhya', 'Indraprastha'],
    startBias: 'river',
  },
  {
    id: 'persia',
    name: 'Persia',
    adjective: 'Persian',
    leader: 'Darius I',
    color: '#8a3ab0',
    accent: '#f2c840',
    ability: { name: 'Age of Splendour', text: 'Golden ages last 50% longer; in one, units have +1 move and +10% combat strength.', effects: { goldenAgeLength: 50, special: ['golden_age_moves_combat'] } },
    unit: 'immortal',
    building: 'satraps_court',
    cities: ['Persepolis', 'Pasargadae', 'Susa', 'Ecbatana', 'Tarsus', 'Gordium', 'Bactra', 'Sardis', 'Ergili', 'Dariushkabir', 'Ghulaman', 'Zohak', 'Istakhr', 'Jinjan', 'Borazjan', 'Herat'],
  },
  {
    id: 'korea',
    name: 'Korea',
    adjective: 'Korean',
    leader: 'Sejong',
    color: '#3a6ac8',
    accent: '#e8453c',
    ability: { name: 'Halls of Scholars', text: '+2 science from every specialist; a boost of science each time a science building or a wonder is finished in the capital.', effects: { specialistYields: { science: 2 }, special: ['capital_building_science'] } },
    unit: 'turtle_ship',
    building: 'seowon',
    cities: ['Seoul', 'Busan', 'Jeonju', 'Daegu', 'Pyongyang', 'Kaesong', 'Suwon', 'Gwangju', 'Gangneung', 'Hamhung', 'Wonju', 'Ulsan', 'Changwon', 'Andong', 'Gongju', 'Haeju'],
    startBias: 'coast',
  },
  {
    id: 'arabia',
    name: 'Arabia',
    adjective: 'Arabian',
    leader: 'Harun al-Rashid',
    color: '#2a7a3a',
    accent: '#f2f2f2',
    ability: { name: 'Caravan Riches', text: 'Trade routes give +2 gold and spread religion twice as strongly. Oil is doubled.', effects: { special: ['trade_gold_2', 'trade_religion_double', 'oil_double'] } },
    unit: 'camel_archer',
    building: 'bazaar',
    cities: ['Mecca', 'Medina', 'Damascus', 'Baghdad', 'Najran', 'Kufah', 'Basra', 'Khurasan', 'Anjar', 'Fustat', 'Aden', 'Yamama', 'Muscat', 'Mansura', 'Bukhara', 'Fez'],
    startBias: 'desert',
  },
  {
    id: 'germany',
    name: 'Germany',
    adjective: 'German',
    leader: 'Otto von Bismarck',
    color: '#4a4a52',
    accent: '#f2f2f2',
    ability: { name: 'Iron Recruits', text: 'Often wins barbarians over to your side when it clears their camps; 25% less upkeep for units.', effects: { unitUpkeep: 25, special: ['barbarian_recruits'] } },
    unit: 'landsknecht',
    building: 'hanse',
    cities: ['Berlin', 'Hamburg', 'Munich', 'Cologne', 'Frankfurt', 'Essen', 'Dortmund', 'Stuttgart', 'Dusseldorf', 'Bremen', 'Hannover', 'Duisburg', 'Leipzig', 'Dresden', 'Bonn', 'Bochum'],
  },
  {
    id: 'iroquois',
    name: 'Iroquois',
    adjective: 'Iroquois',
    leader: 'Hiawatha',
    color: '#8a5a2a',
    accent: '#3ad0d0',
    ability: { name: 'Forest Paths', text: 'Units move through forest and jungle in your land as if on roads, and those count as roads to connect your cities.', effects: { special: ['forest_roads'] } },
    unit: 'mohawk_warrior',
    building: 'longhouse',
    cities: ['Onondaga', 'Osininka', 'Tonawanda', 'Kanesatake', 'Akwesasne', 'Kahnawake', 'Ganondagan', 'Tuscarora', 'Oneida', 'Cayuga', 'Seneca', 'Mohawk', 'Kanonwalohale', 'Oriska', 'Ganajohi', 'Chonodote'],
    startBias: 'forest',
  },
  {
    id: 'aztec',
    name: 'Aztec',
    adjective: 'Aztec',
    leader: 'Montezuma',
    color: '#c83a3a',
    accent: '#3ab0a0',
    ability: { name: 'Warrior Offerings', text: 'Culture from every enemy unit you kill.', effects: { special: ['culture_from_kills'] } },
    unit: 'jaguar',
    building: 'floating_gardens',
    cities: ['Tenochtitlan', 'Teotihuacan', 'Tlatelolco', 'Texcoco', 'Tlaxcala', 'Calixtlahuaca', 'Xochicalco', 'Tlacopan', 'Atzcapotzalco', 'Tzintzuntzan', 'Malinalco', 'Tamuin', 'Teayo', 'Cempoala', 'Chalco', 'Tlalmanalco'],
    startBias: 'jungle',
  },
  {
    id: 'russia',
    name: 'Russia',
    adjective: 'Russian',
    leader: 'Catherine',
    color: '#e8c03a',
    accent: '#2a2a2a',
    ability: { name: 'Riches Beneath', text: 'Twice as much of every strategic resource; +1 production from them.', effects: { special: ['strategic_double'], tiles: [{ where: { resourceKind: ['strategic'] }, yields: { prod: 1 } }] } },
    unit: 'cossack',
    building: 'krepost',
    cities: ['Moscow', 'St. Petersburg', 'Novgorod', 'Rostov', 'Yaroslavl', 'Yekaterinburg', 'Yakutsk', 'Vladivostok', 'Smolensk', 'Orenburg', 'Krasnoyarsk', 'Khabarovsk', 'Bryansk', 'Tver', 'Novosibirsk', 'Magadan'],
    startBias: 'tundra',
  },
  {
    id: 'france',
    name: 'France',
    adjective: 'French',
    leader: 'Napoleon',
    color: '#3a5ad0',
    accent: '#f2f2f2',
    ability: { name: 'Grand Heritage', text: 'Twice the tourism from great works of art in the capital; +1 culture in every city until Steam Power.', effects: { special: ['capital_art_tourism'], cities: [{ when: { before: 'steam_power' }, effects: { yields: { culture: 1 } } }] } },
    unit: 'musketeer',
    building: 'chateau_hall',
    cities: ['Paris', 'Orleans', 'Lyon', 'Troyes', 'Tours', 'Marseille', 'Chartres', 'Avignon', 'Rouen', 'Grenoble', 'Dijon', 'Amiens', 'Cherbourg', 'Poitiers', 'Toulouse', 'Bayonne'],
  },
  {
    id: 'rome',
    name: 'Rome',
    adjective: 'Roman',
    leader: 'Augustus Caesar',
    color: '#5a1a6a',
    accent: '#f2c84a',
    ability: { name: 'Glory of Rome', text: '+25% production toward buildings the capital already has, in every other city.', effects: { special: ['capital_buildings_faster'] } },
    unit: 'legion',
    building: 'thermae',
    cities: ['Rome', 'Antium', 'Cumae', 'Neapolis', 'Ravenna', 'Arretium', 'Mediolanum', 'Arpinum', 'Circei', 'Setia', 'Satricum', 'Ardea', 'Ostia', 'Velitrae', 'Viroconium', 'Tarentum'],
  },
  {
    id: 'greece',
    name: 'Greece',
    adjective: 'Greek',
    leader: 'Alexander',
    color: '#5ab8e8',
    accent: '#f4f1ea',
    ability: { name: 'Hellenic League', text: 'Influence with city-states falls half as fast, and climbs back twice as fast.', effects: { cityStateInfluence: 50, special: ['influence_recovers_double'] } },
    unit: 'hoplite',
    building: 'odeon',
    cities: ['Athens', 'Corinth', 'Argos', 'Knossos', 'Mycenae', 'Pharsalos', 'Ephesus', 'Halicarnassus', 'Rhodes', 'Eretria', 'Pergamon', 'Miletos', 'Megara', 'Phocaea', 'Delphi', 'Olympia'],
    startBias: 'coast',
  },
  {
    id: 'japan',
    name: 'Japan',
    adjective: 'Japanese',
    leader: 'Oda Nobunaga',
    color: '#f0ece4',
    accent: '#c8282a',
    ability: { name: 'Bushido', text: 'Wounded units fight at their full strength; +1 culture from fishing boats.', effects: { special: ['no_wound_penalty'], tiles: [{ where: { improvement: ['fishing_boats'] }, yields: { culture: 1 } }] } },
    unit: 'samurai',
    building: 'dojo',
    cities: ['Edo', 'Osaka', 'Nagoya', 'Sendai', 'Kamakura', 'Yokohama', 'Kobe', 'Fukuoka', 'Sapporo', 'Nagasaki', 'Hiroshima', 'Nara', 'Kanazawa', 'Okayama', 'Kagoshima', 'Shizuoka'],
    startBias: 'coast',
  },
  {
    id: 'england',
    name: 'England',
    adjective: 'English',
    leader: 'Elizabeth',
    color: '#1e2858',
    accent: '#d83a3a',
    ability: { name: 'Sun Never Sets', text: '+2 moves for ships, and an extra spy.', effects: { moves: [{ domain: 'sea', moves: 2 }], special: ['extra_spy'] } },
    unit: 'longbowman',
    building: 'royal_dockyard',
    cities: ['London', 'York', 'Nottingham', 'Hastings', 'Canterbury', 'Coventry', 'Warwick', 'Newcastle', 'Oxford', 'Liverpool', 'Dover', 'Brighton', 'Norwich', 'Leeds', 'Reading', 'Bristol'],
    startBias: 'coast',
  },
  {
    id: 'mongolia',
    name: 'Mongolia',
    adjective: 'Mongolian',
    leader: 'Genghis Khan',
    color: '#7a2a1a',
    accent: '#e8b84a',
    ability: { name: 'Mongol Terror', text: '+30% combat strength against city-states and their units; +1 move for mounted units.', effects: { combat: [{ percent: 30, when: 'vs_city_states' }], moves: [{ domain: 'land', classes: ['mounted'], moves: 1 }] } },
    unit: 'keshik',
    building: 'ordu',
    cities: ['Karakorum', 'Beshbalik', 'Turfan', 'Hami', 'Kashgar', 'Old Sarai', 'New Sarai', 'Tabriz', 'Kara-Khoja', 'Uliastai', 'Kobdo', 'Khanbalik', 'Ulaanbaatar', 'Tsetserleg', 'Darkhan', 'Erdenet'],
    startBias: 'plains',
  },
  {
    id: 'ottomans',
    name: 'Ottomans',
    adjective: 'Ottoman',
    leader: 'Suleiman',
    color: '#1a8a8a',
    accent: '#f2e8c8',
    ability: { name: 'Barbary Corsairs', text: 'Ships cost a third of the usual upkeep.', effects: { special: ['naval_upkeep_third'] } },
    unit: 'janissary',
    building: 'hammam',
    cities: ['Istanbul', 'Edirne', 'Ankara', 'Bursa', 'Konya', 'Trabzon', 'Izmir', 'Sivas', 'Kayseri', 'Erzurum', 'Adana', 'Antalya', 'Gaziantep', 'Manisa', 'Sinop', 'Diyarbakir'],
  },
  {
    id: 'zulu',
    name: 'Zulu',
    adjective: 'Zulu',
    leader: 'Shaka',
    color: '#c8a878',
    accent: '#3a2414',
    ability: { name: 'Iklwa', text: 'Melee units cost half the upkeep; units earn a third more experience, so promotions come a quarter sooner.', effects: { special: ['melee_upkeep_half', 'xp_33'] } },
    unit: 'impi',
    building: 'ikanda',
    cities: ['Ulundi', 'Umgungundlovu', 'Nobamba', 'Bulawayo', 'KwaDukuza', 'Nongoma', 'Nodwengu', 'Dlinza', 'eThekwini', 'Eshowe', 'Hlobane', 'Mahlabatini', 'Nkandla', 'Babanango', 'Isandlwana', 'Kwamagwaza'],
    startBias: 'grassland',
  },
  {
    id: 'inca',
    name: 'Inca',
    adjective: 'Inca',
    leader: 'Pachacuti',
    color: '#e8902a',
    accent: '#1a5a5a',
    ability: { name: 'Great Andean Road', text: 'Units climb hills for a single move; roads on hills cost no upkeep, and half elsewhere.', effects: { special: ['andean_roads'] } },
    unit: 'slinger',
    building: 'terrace_farm',
    cities: ['Cusco', 'Tiwanaku', 'Quito', 'Ollantaytambo', 'Vilcabamba', 'Vitcos', 'Andahuaylas', 'Huanuco Pampa', 'Cajamarca', 'Arequipa', 'Nasca', 'Ica', 'Pisac', 'Tumbes', 'Chan Chan', 'Pachacamac'],
    startBias: 'hills',
  },
];

/** The barbarians: no cities, at war with everyone, coming out of their camps (`barbarians.ts`). Not a civ anyone picks. */
export const BARBARIAN: Civ = {
  id: 'barbarian',
  name: 'Barbarians',
  adjective: 'Barbarian',
  leader: 'Barbarians',
  color: '#2a2a2a',
  accent: '#e8543a',
  ability: { name: '', text: '', effects: {} },
  unit: '',
  building: '',
  cities: [],
};

/** City-states: one city each, a kind (what being their friend gives), never expanding. */
export type CityStateKind = 'maritime' | 'cultured' | 'militaristic' | 'mercantile' | 'religious';
const CS = (name: string, _kind: CityStateKind, color: string): Civ => ({ id: 'cs_' + name.toLowerCase().replace(/[^a-z]/g, ''), name, adjective: name, leader: name, color, accent: '#f4f1ea', ability: { name: '', text: '', effects: {} }, unit: '', building: '', cities: [name] });
export const CITY_STATES: { civ: Civ; kind: CityStateKind }[] = [
  { civ: CS('Venice', 'maritime', '#3a8ab0'), kind: 'maritime' },
  { civ: CS('Lisbon', 'maritime', '#4a9ac0'), kind: 'maritime' },
  { civ: CS('Kyoto', 'cultured', '#b04a9a'), kind: 'cultured' },
  { civ: CS('Florence', 'cultured', '#c05aa8'), kind: 'cultured' },
  { civ: CS('Sparta', 'militaristic', '#a83a2a'), kind: 'militaristic' },
  { civ: CS('Almaty', 'militaristic', '#b84a3a'), kind: 'militaristic' },
  { civ: CS('Zanzibar', 'mercantile', '#c8a03a'), kind: 'mercantile' },
  { civ: CS('Samarkand', 'mercantile', '#d8b04a'), kind: 'mercantile' },
  { civ: CS('Jerusalem', 'religious', '#e8e0c8'), kind: 'religious' },
  { civ: CS('Lhasa', 'religious', '#d8d0b8'), kind: 'religious' },
  { civ: CS('Geneva', 'cultured', '#a04a8a'), kind: 'cultured' },
  { civ: CS('Hanoi', 'maritime', '#2a7aa0'), kind: 'maritime' },
];

export const CIVS: Record<string, Civ> = Object.fromEntries([...CIV_LIST, BARBARIAN, ...CITY_STATES.map((c) => c.civ)].map((c) => [c.id, c]));

/** The unit a civ builds in place of `unit` (its unique one, or the same). */
export const unitFor = (civ: string, unit: string, units: Record<string, { civ?: string; replaces?: string; id: string }>): string => {
  for (const u of Object.values(units)) if (u.civ === civ && u.replaces === unit) return u.id;
  return unit;
};
