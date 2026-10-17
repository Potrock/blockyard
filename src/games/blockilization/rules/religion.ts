import { BUILDING_LIST } from './buildings';
import { CHOOSABLE, type Effects } from './effects';
import { SPEEDS, type Game, type Player } from './state';
import { eraOfCol, ERAS, TECHS } from './techs';

/**
 * Religion: a pantheon from early faith (one belief), then a religion founded by a Great Prophet (a
 * founder belief and a follower belief), enhanced by a second Great Prophet (another follower belief
 * and an enhancer belief), reformed with Piety's Reformation (a reformation belief). Each belief is
 * taken by one civ only. A city follows the religion most of its
 * citizens follow; followers' beliefs work in that city, a founder's for the founder from all its
 * followers. The effects are Civilization V's, in our words.
 */

export type BeliefKind = 'pantheon' | 'founder' | 'follower' | 'enhancer' | 'reformation';

export interface Belief {
  id: string;
  name: string;
  kind: BeliefKind;
  text: string;
  effects: Effects;
}

const B = (kind: BeliefKind, id: string, name: string, text: string, effects: Effects): Belief => ({ id, name, kind, text, effects });

/** The world wonders of the Ancient and Classical eras (Monument to the Gods). */
const EARLY_WONDERS = BUILDING_LIST.filter((b) => b.kind === 'world' && b.tech && ERAS.indexOf(eraOfCol(TECHS[b.tech].col)) <= 1).map((b) => b.id);

export const BELIEF_LIST: Belief[] = [
  // Pantheons
  B('pantheon', 'god_of_the_sea', 'God of the Sea', '+1 production from Fishing Boats.', { tiles: [{ where: { improvement: ['fishing_boats'] }, yields: { prod: 1 } }] }),
  B('pantheon', 'desert_folklore', 'Desert Folklore', '+1 faith from desert tiles.', { tiles: [{ where: { terrain: ['desert'] }, yields: { faith: 1 } }] }),
  B('pantheon', 'fertility_rites', 'Fertility Rites', '+10% growth in cities.', { percent: { food: 10 } }),
  B('pantheon', 'god_of_craftsmen', 'God of Craftsmen', '+1 production in cities of 3 or more.', { cities: [{ when: { minPop: 3 }, effects: { yields: { prod: 1 } } }] }),
  B('pantheon', 'god_of_war', 'God of War', 'Faith from killing units near your cities.', { special: ['faith_from_kills'] }),
  B('pantheon', 'goddess_of_love', 'Goddess of Love', '+1 happiness in cities of 6 or more.', { cities: [{ when: { minPop: 6 }, effects: { happiness: 1 } }] }),
  B('pantheon', 'goddess_of_protection', 'Goddess of Protection', "+30% to cities' combat strength, defending and firing.", { cityStrength: 30 }),
  B('pantheon', 'goddess_of_the_hunt', 'Goddess of the Hunt', '+1 food from Camps.', { tiles: [{ where: { improvement: ['camp'] }, yields: { food: 1 } }] }),
  B('pantheon', 'messenger_of_the_gods', 'Messenger of the Gods', '+2 science in cities connected to the capital.', { cities: [{ when: { connected: true }, effects: { yields: { science: 2 } } }] }),
  B('pantheon', 'monument_to_the_gods', 'Monument to the Gods', '+15% production toward Ancient and Classical wonders.', { buildingBoost: [{ buildings: EARLY_WONDERS, percent: 15 }] }),
  B('pantheon', 'one_with_nature', 'One with Nature', '+4 faith from natural wonders your cities work.', { tiles: [{ where: { naturalWonder: true }, yields: { faith: 4 } }] }),
  B('pantheon', 'god_of_the_open_sky', 'God of the Open Sky', '+1 culture from Pastures.', { tiles: [{ where: { improvement: ['pasture'] }, yields: { culture: 1 } }] }),
  B('pantheon', 'oral_tradition', 'Oral Tradition', '+1 culture from Plantations.', { tiles: [{ where: { improvement: ['plantation'] }, yields: { culture: 1 } }] }),
  B('pantheon', 'religious_idols', 'Religious Idols', '+1 culture and faith from gold and silver.', { tiles: [{ where: { resource: ['gold_ore', 'silver'] }, yields: { culture: 1, faith: 1 } }] }),
  B('pantheon', 'sacred_path', 'Sacred Path', '+1 culture from jungle tiles.', { tiles: [{ where: { feature: ['jungle'] }, yields: { culture: 1 } }] }),
  B('pantheon', 'sacred_waters', 'Sacred Waters', '+1 happiness in cities by rivers or lakes.', { cities: [{ when: { freshWater: true }, effects: { happiness: 1 } }] }),
  B('pantheon', 'stone_circles', 'Stone Circles', '+2 faith from Quarries.', { tiles: [{ where: { improvement: ['quarry'] }, yields: { faith: 2 } }] }),
  B('pantheon', 'tears_of_the_gods', 'Tears of the Gods', '+2 faith from gems and pearls.', { tiles: [{ where: { resource: ['gems', 'pearls'] }, yields: { faith: 2 } }] }),
  B('pantheon', 'god_king', 'God-King', '+1 culture, faith, gold, production and science in the capital.', { cities: [{ when: { capital: true }, effects: { yields: { culture: 1, faith: 1, gold: 1, prod: 1, science: 1 } } }] }),
  B('pantheon', 'ancestor_worship', 'Ancestor Worship', '+1 culture from Shrines.', { perBuilding: [{ buildings: ['shrine'], effects: { yields: { culture: 1 } } }] }),
  B('pantheon', 'earth_mother', 'Earth Mother', '+1 faith from iron, copper and salt.', { tiles: [{ where: { resource: ['iron', 'copper', 'salt'] }, yields: { faith: 1 } }] }),
  // Founder beliefs (for the founder, from its religion's reach)
  B('founder', 'tithe', 'Tithe', '+1 gold for every 4 followers of the religion.', { special: ['tithe'] }),
  B('founder', 'ceremonial_burial', 'Ceremonial Burial', '+1 happiness for each city following the religion.', { special: ['ceremonial_burial'] }),
  B('founder', 'church_property', 'Church Property', '+2 gold for each city following the religion.', { special: ['church_property'] }),
  B('founder', 'initiation_rites', 'Initiation Rites', '+100 gold when a city first follows the religion.', { special: ['initiation_rites'] }),
  B('founder', 'interfaith_dialogue', 'Interfaith Dialogue', 'Science when missionaries convert other religions\' followers.', { special: ['interfaith'] }),
  B('founder', 'papal_primacy', 'Papal Primacy', 'Influence with city-states following the religion rests 15 higher.', { special: ['papal_primacy'] }),
  B('founder', 'peace_loving', 'Peace Loving', '+1 happiness for every 5 followers in other civs.', { special: ['peace_loving'] }),
  B('founder', 'pilgrimage', 'Pilgrimage', '+2 faith for each foreign city following the religion.', { special: ['pilgrimage'] }),
  B('founder', 'world_church', 'World Church', '+1 culture for every 5 followers in other civs.', { special: ['world_church'] }),
  // Follower beliefs (in each city that follows)
  B('follower', 'mosques', 'Mosques', 'Mosques can be bought with faith.', { faithBuildings: ['mosque'] }),
  B('follower', 'pagodas', 'Pagodas', 'Pagodas can be bought with faith.', { faithBuildings: ['pagoda'] }),
  B('follower', 'cathedrals', 'Cathedrals', 'Cathedrals can be bought with faith.', { faithBuildings: ['cathedral'] }),
  B('follower', 'monasteries', 'Monasteries', 'Monasteries can be bought with faith.', { faithBuildings: ['monastery'] }),
  B('follower', 'feed_the_world', 'Feed the World', '+1 food from Shrines and Temples.', { perBuilding: [{ buildings: ['shrine', 'temple'], effects: { yields: { food: 1 } } }] }),
  B('follower', 'guruship', 'Guruship', '+2 production in a city with a specialist.', { cities: [{ when: { specialist: true }, effects: { yields: { prod: 2 } } }] }),
  B('follower', 'religious_community', 'Religious Community', '+1% production for each follower (up to 15%).', { special: ['religious_community'] }),
  B('follower', 'swords_into_plowshares', 'Swords into Plowshares', '+15% growth while at peace.', { special: ['plowshares'] }),
  B('follower', 'peace_gardens', 'Peace Gardens', '+2 happiness from Gardens.', { perBuilding: [{ buildings: ['garden'], effects: { happiness: 2 } }] }),
  B('follower', 'asceticism', 'Asceticism', '+1 happiness from Shrines in cities of 3 or more.', { cities: [{ when: { minPop: 3, building: ['shrine'] }, effects: { happiness: 1 } }] }),
  B('follower', 'choral_music', 'Choral Music', '+2 culture from Temples.', { perBuilding: [{ buildings: ['temple'], effects: { yields: { culture: 2 } } }] }),
  B('follower', 'liturgical_drama', 'Liturgical Drama', '+1 happiness from Amphitheaters.', { perBuilding: [{ buildings: ['amphitheater'], effects: { happiness: 1 } }] }),
  // Enhancer beliefs
  B('enhancer', 'itinerant_preachers', 'Itinerant Preachers', 'The religion reaches 30% further.', { special: ['religion_reaches_further'] }),
  B('enhancer', 'missionary_zeal', 'Missionary Zeal', 'Missionaries convert 25% more.', { special: ['missionary_zeal'] }),
  B('enhancer', 'holy_warriors', 'Holy Warriors', 'Land military units can be bought with faith.', { special: ['buy_military_faith'] }),
  B('enhancer', 'defender_of_the_faith', 'Defender of the Faith', '+20% combat strength in your land around cities following the religion.', { combat: [{ percent: 20, when: 'faithful_land' }] }),
  B('enhancer', 'just_war', 'Just War', '+20% combat strength in enemy land around cities following the religion.', { combat: [{ percent: 20, when: 'faithful_enemy_land' }] }),
  B('enhancer', 'messiah', 'Messiah', 'Great Prophets come 25% sooner and spread the religion once more.', { special: ['prophets_faster'] }),
  B('enhancer', 'religious_texts', 'Religious Texts', 'The religion spreads 34% faster.', { pressure: 34 }),
  B('enhancer', 'reliquary', 'Reliquary', '+50 faith each time a Great Person is used.', { special: ['reliquary'] }),
  // Reformation beliefs (Piety's Reformation)
  B('reformation', 'sacred_sites', 'Sacred Sites', '+2 tourism from Mosques, Pagodas, Cathedrals and Monasteries.', { perBuilding: [{ buildings: ['mosque', 'pagoda', 'cathedral', 'monastery'], effects: { tourism: 2 } }] }),
  B('reformation', 'charitable_missions', 'Charitable Missions', 'Gold gifts to city-states give 30% more influence.', { special: ['charitable_missions'] }),
  B('reformation', 'to_the_glory_of_god', 'To the Glory of God', 'Great People of every kind can be bought with faith from the Industrial Era.', { faithGreatPeople: [...CHOOSABLE] }),
  B('reformation', 'jesuit_education', 'Jesuit Education', 'Libraries, Universities and Public Schools can be bought with faith.', { special: ['buy_science_buildings'] }),
];

export const BELIEFS: Record<string, Belief> = Object.fromEntries(BELIEF_LIST.map((b) => [b.id, b]));

export const RELIGION_NAMES = ['Sunfire Way', 'Order of the Grove', 'Stonefaith', 'The Tidal Path', 'Way of the Four Winds', 'Lantern Creed', 'Covenant of Stars', 'Hearthkeepers', 'The River Teaching', 'Skyward Faith', 'Path of the Ember', 'The Quiet Mountain'];

/** Faith a pantheon costs (Civ V's 10, then more for each taken), and a Great Prophet's points. */
export const pantheonCost = (game: Game) => Math.floor((10 + 5 * Object.values(game.players).filter((p) => p.pantheon).length) * SPEEDS[game.settings.speed]);

/**
 * The beliefs that work for a player's cities: its pantheon's, and its religion's founder, enhancer
 * and reformation beliefs for itself. (Follower beliefs are for each city by its own religion: see `cityBeliefEffects`.)
 */
export function beliefEffects(game: Game, p: Player): Effects[] {
  const out: Effects[] = [];
  if (p.pantheon && BELIEFS[p.pantheon]) out.push(BELIEFS[p.pantheon].effects);
  const rel = p.religion ? game.religions[p.religion] : undefined;
  if (rel && rel.founder === p.index) for (const b of rel.beliefs) if (BELIEFS[b] && BELIEFS[b].kind !== 'follower') out.push(BELIEFS[b].effects);
  return out;
}

/** The beliefs taken by anyone (each can be taken once). */
export function takenBeliefs(game: Game): Set<string> {
  const out = new Set<string>();
  for (const p of game.players) if (p.pantheon) out.add(p.pantheon);
  for (const r of Object.values(game.religions)) for (const b of r.beliefs) out.add(b);
  return out;
}
