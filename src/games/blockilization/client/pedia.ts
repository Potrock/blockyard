import { BUILDING_LIST, BUILDINGS, FAITH_BUILDINGS, SPACESHIP_PARTS, type Building } from '../rules/buildings';
import { CITY_STATES, CIV_LIST, CIVS } from '../rules/civs';
import type { CityFilter, Effects, TileFilter } from '../rules/effects';
import { FIRST_FINDER_GOLDEN, FOUND_HAPPINESS, NATURAL_WONDER_LIST, NATURAL_WONDERS, type NaturalWonder } from '../rules/nature';
import { IDEOLOGIES, TREES, type Policy } from '../rules/policies';
import { PROMOTION_LIST, PROMOTIONS } from '../rules/promotions';
import { isProject as isWorldProject, PROJECT_IDS, PROJECTS, type ProjectId } from '../rules/projects';
import { PROJECT_LOOK } from './congress';
import { BELIEF_LIST, BELIEFS } from '../rules/religion';
import { SPEEDS } from '../rules/state';
import { baseTechCost, ERA_NAMES, ERAS, eraOfCol, TECH_LIST, TECHS, type Era } from '../rules/techs';
import { FEATURES, HILLS, IMPROVEMENTS, MOUNTAIN, RESOURCES, TERRAINS, YIELD_KEYS, type FeatureId, type ImprovementId, type TerrainId, type Yields } from '../rules/terrain';
import { UNIT_LIST, UNITS, type UnitType } from '../rules/units';
import { centre } from '../geometry';
import { lookAt } from './camera';
import { landmarkPicture } from './landmarkart';
import { ABILITY_TEXT, CITY_STATE_KINDS, CONCEPTS, SPECIAL_TEXT, VICTORIES, type Article } from './concepts';
import { buildingGlyph, emblemEl, ERA_COLOR, icon, POLICY_GLYPH, resourceGlyph, svg, techEra, techGlyph, wonderPicture, YIELD_COLOR } from './icons';
import { unitModel } from './models3d';
import { store } from './store';
import { BUILD_GLYPH, h, pic, portrait, tile, touchScreen, TREE_COLOR, togglePanel, type El } from './ui';

/**
 * The Civilopedia: an article for everything in the game (every unit, building, wonder, policy and
 * ideology tenet, belief, technology, terrain and feature, natural wonder, resource, improvement, promotion,
 * civilization, kind of city-state, way to win, and the game's core ideas), drawn from the rules'
 * own data so it says what the game does; in categories, searchable, linked to one another. Anything
 * on screen with a `data-pedia` key shows a short card when hovered and opens its article when
 * right-clicked.
 */

type Kind = 'concept' | 'victory' | 'civ' | 'citystate' | 'tech' | 'unit' | 'promotion' | 'building' | 'wonder' | 'project' | 'policy' | 'belief' | 'terrain' | 'nature' | 'resource' | 'improvement';

/** The Civilopedia's categories, in the order they're listed. */
const CATEGORIES: { id: string; name: string; glyph: string; color: string }[] = [
  { id: 'concept', name: 'Game concepts', glyph: 'lightbulb', color: '#2f6fc0' },
  { id: 'victory', name: 'Victory', glyph: 'golden', color: '#b8892a' },
  { id: 'civ', name: 'Civilizations', glyph: 'crown', color: '#8a6a3a' },
  { id: 'citystate', name: 'City-states', glyph: 'city', color: '#3f8f6f' },
  { id: 'tech', name: 'Technologies', glyph: 'science', color: '#2f6fc0' },
  { id: 'unit', name: 'Units', glyph: 'sword', color: '#b8432f' },
  { id: 'promotion', name: 'Promotions', glyph: 'xp', color: '#b8892a' },
  { id: 'building', name: 'Buildings', glyph: 'hammer', color: '#a8702a' },
  { id: 'wonder', name: 'Wonders', glyph: 'columns', color: '#b8892a' },
  { id: 'policy', name: 'Social policies', glyph: 'crown', color: '#b8892a' },
  { id: 'belief', name: 'Religion', glyph: 'faith', color: '#7a6a9a' },
  { id: 'terrain', name: 'Terrain', glyph: 'hexes', color: '#5a8a3a' },
  { id: 'nature', name: 'Natural wonders', glyph: 'peak', color: '#3f8f6f' },
  { id: 'resource', name: 'Resources', glyph: 'gems', color: '#3a7a9a' },
  { id: 'improvement', name: 'Improvements', glyph: 'pick', color: '#6a6a6a' },
];

/** An article's place in the Civilopedia: its key (`kind:id`), its category and group in the list, and its name. */
interface Entry {
  key: string;
  kind: Kind;
  id: string;
  cat: string;
  group: string;
  name: string;
}

const TERRAIN_COLOR: Record<string, string> = { grassland: '#4a8a2a', plains: '#9a8a3a', desert: '#c8a85a', tundra: '#6a7a6a', snow: '#a8b8c8', coast: '#3a7ab0', ocean: '#1e4a7a', lake: '#3a8ac0', hills: '#7a6a4a', mountain: '#6a6a72' };
const FEATURE_GLYPH: Record<FeatureId, string> = { forest: 'pine', jungle: 'leaf', marsh: 'drop', oasis: 'drop', floodplains: 'wheat', ice: 'snowflake', atoll: 'anchor' };
const FEATURE_COLOR: Record<FeatureId, string> = { forest: '#2a6a3a', jungle: '#2a7a4a', marsh: '#4a6a5a', oasis: '#3a9a8a', floodplains: '#8a8a3a', ice: '#8aa8c8', atoll: '#3a8aa0' };
const BELIEF_COLOR: Record<string, string> = { pantheon: '#8a7a4a', founder: '#b8892a', follower: '#3a7ac0', enhancer: '#7a5aa8', reformation: '#3f8f6f' };
const BELIEF_KIND: Record<string, string> = { pantheon: 'Pantheon beliefs', founder: 'Founder beliefs', follower: 'Follower beliefs', enhancer: 'Enhancer beliefs', reformation: 'Reformation beliefs' };
const YIELD_NAME: Record<string, string> = { food: 'food', prod: 'production', gold: 'gold', science: 'science', culture: 'culture', faith: 'faith' };
/** Who makes each great person's improvement. */
const GREAT_MAKER: Partial<Record<ImprovementId, string>> = { academy: 'great_scientist', manufactory: 'great_engineer', customs_house: 'great_merchant', holy_site: 'great_prophet', citadel: 'great_general', landmark: 'archaeologist' };

const eraOfTech = (tech: string | undefined): Era => (tech && TECHS[tech] ? eraOfCol(TECHS[tech].col) : 'ancient');
const isProject = (b: Building) => b.id === 'manhattan_project' || b.id === 'apollo_program';

// -------------------------------------------------------------------------------------------------
// The index
// -------------------------------------------------------------------------------------------------

function buildIndex(): Entry[] {
  const out: Entry[] = [];
  const add = (kind: Kind, id: string, name: string, group: string, cat: string = kind) => out.push({ key: `${kind}:${id}`, kind, id, cat, group, name });
  for (const a of CONCEPTS) add('concept', a.id, a.name, '');
  for (const a of VICTORIES) add('victory', a.id, a.name, '');
  for (const c of CIV_LIST) add('civ', c.id, c.name, '');
  for (const a of CITY_STATE_KINDS) add('citystate', a.id, a.name, '');
  for (const t of TECH_LIST) add('tech', t.id, t.name, ERA_NAMES[eraOfCol(t.col)]);
  const unitGroup = (u: UnitType) =>
    u.civ ? 'Unique units' : u.class === 'great' ? 'Great people' : u.class === 'religious' ? 'Religious units' : u.class === 'civilian' || u.class === 'trade' ? 'Civilians' : ERA_NAMES[eraOfTech(u.tech)];
  for (const u of UNIT_LIST) add('unit', u.id, u.name, unitGroup(u));
  for (const p of PROMOTION_LIST) {
    const melee = p.classes.includes('melee') || p.classes.includes('mounted');
    const ranged = p.classes.includes('ranged');
    add('promotion', p.id, p.name, melee && ranged ? 'Most units' : melee ? 'Melee and mounted' : ranged ? 'Ranged and siege' : 'Naval');
  }
  for (const b of [...BUILDING_LIST, ...FAITH_BUILDINGS]) {
    if (b.id === 'palace') add('building', b.id, b.name, 'The capital');
    else if (b.kind === 'building') add('building', b.id, b.name, b.civ ? 'Unique buildings' : FAITH_BUILDINGS.includes(b) ? 'Bought with faith' : ERA_NAMES[eraOfTech(b.tech)]);
    else add('wonder', b.id, b.name, isProject(b) ? 'Projects' : b.kind === 'national' ? 'National wonders' : ERA_NAMES[eraOfTech(b.tech)]);
  }
  for (const s of SPACESHIP_PARTS) add('project', s.id, s.name, 'Projects', 'wonder');
  for (const id of PROJECT_IDS) add('project', id, PROJECTS[id].name, 'World Congress projects', 'wonder');
  for (const t of TREES) for (const p of [t.opener, ...t.policies, t.finisher]) add('policy', p.id, p.name, t.name);
  for (const i of IDEOLOGIES) {
    add('policy', i.id, i.name, 'Ideologies');
    for (const level of i.tenets) for (const p of level) add('policy', p.id, p.name, `${i.name} tenets`);
  }
  for (const b of BELIEF_LIST) add('belief', b.id, b.name, BELIEF_KIND[b.kind] ?? b.kind);
  for (const [id, t] of Object.entries(TERRAINS)) add('terrain', id, t.name, 'Terrain');
  add('terrain', 'hills', HILLS.name, 'Terrain');
  add('terrain', 'mountain', MOUNTAIN.name, 'Terrain');
  for (const [id, f] of Object.entries(FEATURES)) add('terrain', id, f.name, 'Features');
  for (const w of NATURAL_WONDER_LIST) add('nature', w.id, w.name, '');
  for (const [id, r] of Object.entries(RESOURCES)) add('resource', id, r.name, r.kind === 'bonus' ? 'Bonus resources' : r.kind === 'strategic' ? 'Strategic resources' : 'Luxury resources');
  for (const [id, i] of Object.entries(IMPROVEMENTS)) add('improvement', id, i.name, i.great ? 'Great improvements' : 'Built by workers');
  // Each category's groups in their order (the eras in theirs), the rest as they first come.
  const first = new Map<string, number>();
  out.forEach((e, i) => first.has(e.group) || first.set(e.group, i));
  const rank = (g: string) => (GROUP_ORDER.includes(g) ? GROUP_ORDER.indexOf(g) : 1000 + first.get(g)!);
  return out.map((e, i) => ({ e, i })).sort((a, b) => (a.e.cat === b.e.cat ? rank(a.e.group) - rank(b.e.group) || a.i - b.i : a.i - b.i)).map((x) => x.e);
}

/** The order of the list's groups where it isn't the data's own: civilians first, then the eras, then the rest. */
const GROUP_ORDER = ['Civilians', 'The capital', ...ERAS.map((e) => ERA_NAMES[e]), 'National wonders', 'Projects', 'World Congress projects','Unique units', 'Unique buildings', 'Bought with faith', 'Great people', 'Religious units'];

const ENTRIES = buildIndex();
const BY_KEY = new Map(ENTRIES.map((e) => [e.key, e]));

/** An item's article key (a city's build options, a tech's unlocks...). */
export function pediaKey(kind: string, id: string): string {
  if (kind === 'building') return BUILDINGS[id] && BUILDINGS[id].kind !== 'building' ? `wonder:${id}` : `building:${id}`;
  return `${kind}:${id}`;
}

// -------------------------------------------------------------------------------------------------
// Art and links
// -------------------------------------------------------------------------------------------------

/** An entry's picture: a unit's, a wonder's, a leader's, or a glyph on its colour. */
function artOf(e: Entry, size: number): El {
  switch (e.kind) {
    case 'concept':
    case 'victory':
    case 'citystate': {
      const a = articleOf(e)!;
      return tile(a.glyph, a.color, size);
    }
    case 'civ':
      return portrait(e.id, size);
    case 'tech':
      return tile(techGlyph(e.id), ERA_COLOR[techEra(e.id)], size);
    case 'unit':
      return pic(unitModel(e.id), size);
    case 'promotion':
      return tile('xp', '#9a7020', size);
    case 'building':
    case 'wonder': {
      const w = wonderPicture(e.id);
      if (w && e.kind === 'wonder') return pic(w, size);
      const g = buildingGlyph(e.id);
      return tile(g.glyph, '#22303f', size, g.color);
    }
    case 'project':
      return PROJECT_LOOK[e.id] ? tile(...PROJECT_LOOK[e.id], size) : tile('rocket', '#3a5a9a', size);
    case 'policy': {
      const tree = policyTree(e.id);
      return tile(POLICY_GLYPH[tree] ?? 'crown', TREE_COLOR[tree] ?? IDEOLOGY_COLOR[tree] ?? '#555555', size);
    }
    case 'belief':
      return tile('faith', BELIEF_COLOR[BELIEFS[e.id]?.kind ?? 'pantheon'], size);
    case 'terrain':
      return e.id in FEATURES ? tile(FEATURE_GLYPH[e.id as FeatureId], FEATURE_COLOR[e.id as FeatureId], size) : tile(e.id === 'mountain' ? 'pick' : 'hexes', TERRAIN_COLOR[e.id] ?? '#555555', size);
    case 'nature':
      return h('div.cv-pic', { style: `width:${size}px;height:${size}px` }, h('img', { src: landmarkPicture(e.id), alt: '', draggable: 'false' }));
    case 'resource':
      return tile(resourceGlyph(e.id), '#22303f', size, RESOURCES[e.id]?.color);
    case 'improvement':
      return tile(BUILD_GLYPH[e.id] ?? (IMPROVEMENTS[e.id as ImprovementId]?.great ? 'xp' : 'hammer'), IMPROVEMENTS[e.id as ImprovementId]?.color ?? '#555555', size);
  }
}

const IDEOLOGY_COLOR: Record<string, string> = { freedom: '#3a7ac0', order: '#b8432f', autocracy: '#5a5a6a' };

/** The tree (or ideology) a policy belongs to. */
function policyTree(id: string): string {
  for (const t of TREES) if ([t.opener, ...t.policies, t.finisher].some((p) => p.id === id)) return t.id;
  for (const i of IDEOLOGIES) if (i.id === id || i.tenets.some((l) => l.some((p) => p.id === id))) return i.id;
  return '';
}

/** A link to an article: its little picture and name. */
function link(key: string, label?: string): El | null {
  const e = BY_KEY.get(key);
  if (!e) return null;
  return h('button.pd-link', { 'data-pedia': key, onclick: () => go(key) }, artOf(e, 20), label ?? e.name);
}

/** An article's picture, by its key. */
export function entryArt(key: string, size: number): El {
  const e = BY_KEY.get(key);
  return e ? artOf(e, size) : tile('info', '#333333', size);
}

/** An article's name, by its key. */
export const entryName = (key: string) => BY_KEY.get(key)?.name ?? key;

const links = (keys: string[]) => keys.map((k) => link(k)).filter((x): x is El => !!x);

/** A text with `[[key|label]]` links in it. */
function rich(text: string): El {
  const p = h('p');
  let last = 0;
  for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
    p.append(text.slice(last, m.index));
    const key = m[1];
    if (key.startsWith('cat:')) p.append(h('a.pd-inline', { onclick: () => goCategory(key.slice(4)) }, m[2] ?? key));
    else if (BY_KEY.has(key)) p.append(h('a.pd-inline', { 'data-pedia': key, onclick: () => go(key) }, m[2] ?? BY_KEY.get(key)!.name));
    else p.append(m[2] ?? key);
    last = m.index! + m[0].length;
  }
  p.append(text.slice(last));
  return p;
}

/** Yields as coloured glyphs and numbers. */
function yieldsEl(y: Yields, sign = false): El {
  const keys = YIELD_KEYS.filter((k) => y[k]);
  if (!keys.length) return h('span.cv-muted', {}, 'Nothing');
  return h('span.pd-yields', {}, ...keys.map((k) => h('span', { style: `color:${YIELD_COLOR[k]}` }, icon(k, 14), `${sign && y[k]! > 0 ? '+' : ''}${y[k]}`)));
}

/** Yields in words: '+1 food, +2 production'. */
export const yieldWords = (y: Yields | undefined) =>
  YIELD_KEYS.filter((k) => y?.[k])
    .map((k) => `${y![k]! > 0 ? '+' : ''}${y![k]} ${YIELD_NAME[k]}`)
    .join(', ');

// -------------------------------------------------------------------------------------------------
// What effects do, in words
// -------------------------------------------------------------------------------------------------

function filterWords(w: TileFilter): string {
  const names: string[] = [];
  for (const t of w.terrain ?? []) names.push(TERRAINS[t]?.name ?? t);
  for (const f of w.feature ?? []) names.push(FEATURES[f]?.name ?? f);
  for (const e of w.elevation ?? []) names.push(e === 'hills' ? 'hills' : e);
  for (const r of w.resource ?? []) names.push(RESOURCES[r]?.name ?? r);
  for (const k of w.resourceKind ?? []) names.push(`${k} resources`);
  for (const i of w.improvement ?? []) names.push(IMPROVEMENTS[i as ImprovementId]?.name ?? i);
  if (w.water) names.push('water');
  if (w.river) names.push('river');
  if (w.naturalWonder) names.push('natural wonder');
  return names.join(' or ');
}

const WHEN: Record<string, string> = {
  attacking: 'when attacking',
  defending: 'when defending',
  friendly_land: 'in your land',
  vs_cities: 'against cities',
  vs_barbarians: 'against barbarians',
  beside_friend: 'beside another of your units',
  faithful_land: 'in your land around cities of your religion',
  faithful_enemy_land: "in enemy land around cities of your religion",
  always: '',
};

/** Which cities a city filter is for, in words. */
function citiesWords(f: CityFilter): string {
  const parts: string[] = [];
  if (f.capital) parts.push('the capital');
  if (f.capital === false) parts.push('cities but the capital');
  if (f.coastal) parts.push('coastal cities');
  if (f.freshWater) parts.push('cities by a river or lake');
  if (f.minPop) parts.push(`cities of ${f.minPop} or more`);
  if (f.garrisoned) parts.push('garrisoned cities');
  if (f.connected) parts.push('cities connected to the capital');
  if (f.holyCity) parts.push('your holy city');
  if (f.specialist) parts.push('cities with a specialist');
  if (f.building) parts.push(`cities with a ${f.building.map((b) => BUILDINGS[b]?.name ?? b).join(' or ')}`);
  if (f.after) parts.push(`once ${TECHS[f.after]?.name ?? f.after} is known`);
  if (f.before) parts.push(`until ${TECHS[f.before]?.name ?? f.before}`);
  return parts.join(', ') || 'every city';
}
const humanize = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Each thing an effect does, a line each (what a building, wonder or civ's ability brings). */
export function effectLines(e: Effects, note?: string): string[] {
  const out: string[] = [];
  if (e.yields) out.push(yieldWords(e.yields));
  if (e.perPop) out.push(`${yieldWords(e.perPop)} for each citizen`);
  if (e.percent) out.push(YIELD_KEYS.filter((k) => e.percent![k]).map((k) => `+${e.percent![k]}% ${YIELD_NAME[k]}`).join(', '));
  if (e.specialistYields) out.push(`${yieldWords(e.specialistYields)} from each specialist`);
  if (e.empire) for (const line of effectLines(e.empire)) out.push(`${line} (in every city)`);
  for (const x of e.cities ?? []) for (const line of effectLines(x.effects)) out.push(`${line} (in ${citiesWords(x.when)})`);
  for (const x of e.perBuilding ?? []) for (const line of effectLines(x.effects)) out.push(`${line} for each ${x.buildings.map((b) => BUILDINGS[b]?.name ?? b).join(', ')}`);
  for (const t of e.tiles ?? []) out.push(`${yieldWords(t.yields)} on worked ${filterWords(t.where)} tiles`);
  if (e.happiness) out.push(`${e.happiness > 0 ? '+' : ''}${e.happiness} happiness`);
  if (e.unhappinessPercent) out.push(`${e.unhappinessPercent}% less unhappiness from citizens`);
  if (e.happinessPerLuxury) out.push(`+${e.happinessPerLuxury} happiness from each luxury`);
  if (e.defense) out.push(`+${e.defense} city strength`);
  if (e.hp) out.push(`+${e.hp} city hit points`);
  if (e.cityStrength) out.push(`+${e.cityStrength}% city combat strength`);
  for (const x of e.promotions ?? []) out.push(`${x.domain === 'all' ? 'Units' : `${humanize(x.domain)} units`} trained here start with ${PROMOTIONS[x.promotion]?.name ?? x.promotion}`);
  for (const x of e.xp ?? []) out.push(`+${x.xp} experience for ${x.domain === 'all' ? '' : `${x.domain} `}units trained here`);
  for (const u of e.unitProduction ?? []) out.push(`+${u.percent}% production toward ${u.classes ? u.classes.map((c) => c.replace(/_/g, ' ')).join(' and ') : `${u.domain}`} units`);
  if (e.wonderProduction) out.push(`+${e.wonderProduction}% production toward wonders`);
  if (e.buildingProduction) out.push(`+${e.buildingProduction}% production toward buildings`);
  for (const b of e.buildingBoost ?? []) out.push(`+${b.percent}% production toward ${b.buildings.map((x) => BUILDINGS[x]?.name ?? x).join(', ')}`);
  if (e.spaceshipProduction) out.push(`+${e.spaceshipProduction}% production toward spaceship parts`);
  for (const g of e.greatPeople ?? []) out.push(`+${g.points} Great ${humanize(g.kind)} points a turn`);
  if (e.greatPeoplePercent) out.push(`+${e.greatPeoplePercent}% great people`);
  if (e.specialists?.length) out.push(e.specialists.map((s) => `${s.slots} ${s.kind} specialist slot${s.slots === 1 ? '' : 's'}`).join(', '));
  if (e.greatWorks) out.push(`${e.greatWorks.slots} slot${e.greatWorks.slots === 1 ? '' : 's'} for great works of ${e.greatWorks.kind}`);
  if (e.foodKept) out.push(`Keeps ${e.foodKept}% of its food when it grows`);
  if (e.borderCost) out.push(`Borders grow ${e.borderCost}% cheaper`);
  if (e.tileGoldCost) out.push(`Tiles cost ${e.tileGoldCost}% less gold`);
  if (e.freeTechs) out.push(e.freeTechs === 1 ? 'A free technology' : `${e.freeTechs} free technologies`);
  if (e.freePolicies) out.push(e.freePolicies === 1 ? 'A free social policy' : `${e.freePolicies} free social policies`);
  if (e.faithGreatPeople) out.push(`From the Industrial Era, faith buys Great ${e.faithGreatPeople.length >= 8 ? 'People of every kind' : e.faithGreatPeople.map((k) => humanize(k) + 's').join(', ')}`);
  if (e.freeGreatPerson) out.push(e.freeGreatPerson === 'any' ? 'A free Great Person of your choice' : `A free Great ${humanize(e.freeGreatPerson)}`);
  for (const u of e.freeUnits ?? []) out.push(`${u.count === 1 ? 'A' : u.count} free ${UNITS[u.unit]?.name ?? u.unit}${u.count === 1 ? '' : 's'}`);
  if (e.freeBuildingInAll) out.push(`A free ${BUILDINGS[e.freeBuildingInAll]?.name ?? e.freeBuildingInAll} in every city`);
  if (e.freeBuildingHere) out.push(`A free ${BUILDINGS[e.freeBuildingHere]?.name ?? e.freeBuildingHere} in this city`);
  if (e.freeBuildings) out.push(`A free ${BUILDINGS[e.freeBuildings.building]?.name ?? e.freeBuildings.building} in your first ${e.freeBuildings.cities} cities`);
  if (e.goldenAge) out.push('Starts a golden age');
  if (e.goldenAgeLength) out.push(`Golden ages last ${e.goldenAgeLength}% longer`);
  if (e.tradeRoutes) out.push(`+${e.tradeRoutes} trade route${e.tradeRoutes === 1 ? '' : 's'}`);
  if (e.unitUpkeep) out.push(`${e.unitUpkeep}% less unit upkeep`);
  if (e.policyCost) out.push(`Social policies cost ${e.policyCost}% less`);
  for (const c of e.combat ?? []) out.push(`+${c.percent}% combat strength${c.classes ? ` for ${c.classes.join(' and ')} units` : ''}${WHEN[c.when ?? 'always'] ? ` ${WHEN[c.when ?? 'always']}` : ''}`);
  for (const m of e.moves ?? []) if (m.moves) out.push(`+${m.moves} move for ${m.classes ? m.classes.join(' and ') : m.domain} units`);
  for (const x of e.sight ?? []) out.push(`+${x.sight} sight for ${x.domain === 'sea' ? 'ships' : `${x.domain} units`}`);
  if (e.workRate) out.push(`Workers build ${e.workRate}% faster`);
  for (const d of e.purchaseDiscount ?? []) out.push(`${d.kind === 'unit' ? 'Units' : d.kind === 'building' ? 'Buildings' : 'Everything'} bought with gold cost ${d.percent}% less`);
  for (const b of e.faithBuildings ?? []) out.push(`${BUILDINGS[b]?.name ?? b}s can be bought with faith`);
  if (e.turns) out.push(`For ${e.turns} turns`);
  if (e.pressure) out.push(`+${e.pressure}% religious pressure`);
  if (e.tourism) out.push(`+${e.tourism} tourism`);
  if (e.tourismPercent) out.push(`+${e.tourismPercent}% tourism`);
  if (e.cityStateInfluence) out.push(`Influence with city-states falls ${e.cityStateInfluence}% slower`);
  // Named specials: the item's own note says them best, if it has one.
  if (note) out.push(note);
  else for (const s of e.special ?? []) out.push(SPECIAL_TEXT[s] ?? humanize(s));
  return out.filter(Boolean);
}

// -------------------------------------------------------------------------------------------------
// Articles
// -------------------------------------------------------------------------------------------------

/** A fact in an article's box: a glyph, what it is, and its value. */
type Fact = [glyph: string, color: string, label: string, value: El | string];

interface Page {
  sub: string;
  facts: Fact[];
  body: El[];
  /** Linked articles, by heading. */
  related: [string, string[]][];
}

const articleOf = (e: Entry): Article | undefined =>
  e.kind === 'concept' ? CONCEPTS.find((a) => a.id === e.id) : e.kind === 'victory' ? VICTORIES.find((a) => a.id === e.id) : e.kind === 'citystate' ? CITY_STATE_KINDS.find((a) => a.id === e.id) : undefined;

/** A cost at this game's speed (or the standard one, outside a game). */
function cost(n: number): number {
  const speed = store.lobby?.settings.speed;
  return speed ? Math.max(1, Math.floor(n * SPEEDS[speed])) : n;
}

/** A worker's turns at the game's speed (rounded, as the rules' `workTurns`). */
function workTime(n: number): number {
  const speed = store.lobby?.settings.speed;
  return speed ? Math.max(1, Math.round(n * SPEEDS[speed])) : n;
}

const techKey = (t: string | undefined) => (t && TECHS[t] ? [`tech:${t}`] : []);

/** What a tech brings: units, buildings, wonders, improvements and resources it shows (a civ's own in place of the usual). */
export function techUnlocks(tech: string, civ?: string): string[] {
  const own = (x: { civ?: string; replaces?: string; id: string }, all: { civ?: string; replaces?: string; id: string }[]) =>
    x.civ ? x.civ === civ : !civ || !all.some((y) => y.civ === civ && y.replaces === x.id);
  return [
    ...UNIT_LIST.filter((u) => u.tech === tech && own(u, UNIT_LIST)).map((u) => `unit:${u.id}`),
    ...BUILDING_LIST.filter((b) => b.tech === tech && own(b, BUILDING_LIST)).map((b) => pediaKey('building', b.id)),
    ...SPACESHIP_PARTS.filter((s) => s.tech === tech).map((s) => `project:${s.id}`),
    ...(Object.entries(IMPROVEMENTS) as [ImprovementId, (typeof IMPROVEMENTS)[ImprovementId]][]).filter(([, i]) => i.tech === tech).map(([id]) => `improvement:${id}`),
    ...Object.entries(RESOURCES)
      .filter(([, r]) => r.reveal === tech)
      .map(([id]) => `resource:${id}`),
  ];
}

function unitPage(u: UnitType): Page {
  const facts: Fact[] = [];
  if (!u.unbuildable) facts.push(['prod', YIELD_COLOR.prod, 'Cost', `${cost(u.cost)} production`]);
  if (u.strength) facts.push(['strength', '#f0a24a', 'Strength', String(u.strength)]);
  if (u.ranged) facts.push(['ranged', '#6ab8ff', 'Ranged strength', `${u.ranged} (range ${u.range})`]);
  facts.push(['moves', '#7bd16a', 'Moves', String(u.moves)]);
  facts.push(['globe', '#8fa1b3', 'Kind', `${humanize(u.class)}${u.domain !== 'land' ? ` (${u.domain})` : ''}`]);
  if (u.resource) facts.push([resourceGlyph(u.resource), RESOURCES[u.resource]?.color ?? '#fff', 'Needs', RESOURCES[u.resource]?.name ?? u.resource]);
  const body: El[] = [];
  if (u.civ) body.push(rich(`The ${CIVS[u.civ]?.adjective ?? ''} unique unit, in place of the [[unit:${u.replaces}]].`));
  const abilities = (u.abilities ?? []).map((a) => ABILITY_TEXT[a]).filter(Boolean);
  if (abilities.length) body.push(h('ul.pd-list', {}, ...abilities.map((a) => h('li', {}, a))));
  const replacedBy = UNIT_LIST.filter((x) => x.replaces === u.id).map((x) => `unit:${x.id}`);
  const from = UNIT_LIST.filter((x) => x.upgrade === u.id).map((x) => `unit:${x.id}`);
  const promos = u.class === 'civilian' || u.class === 'great' || u.class === 'trade' || u.class === 'religious' ? [] : PROMOTION_LIST.filter((p) => p.classes.includes(u.class) && !p.needs?.length).map((p) => `promotion:${p.id}`);
  return {
    sub: u.civ ? `${CIVS[u.civ]?.name} · unique unit` : u.unbuildable ? 'Not built in cities' : `${ERA_NAMES[eraOfTech(u.tech)]} unit`,
    facts,
    body,
    related: [
      ['Unlocked by', techKey(u.tech)],
      ['Made obsolete by', techKey(u.obsolete)],
      ['Upgrades to', u.upgrade ? [`unit:${u.upgrade}`] : []],
      ['Upgraded from', from],
      ['Civilization', u.civ ? [`civ:${u.civ}`] : []],
      ['Replaced by', replacedBy],
      ['First promotions', promos],
    ],
  };
}

function buildingPage(b: Building): Page {
  const facts: Fact[] = [];
  if (b.cost) facts.push(['prod', YIELD_COLOR.prod, 'Cost', `${cost(b.cost)} production`]);
  if (b.upkeep) facts.push(['gold', YIELD_COLOR.gold, 'Upkeep', `${b.upkeep} gold a turn`]);
  const where: string[] = [];
  if (b.coastal) where.push('on the coast');
  if (b.river) where.push('by a river');
  if (b.mountain) where.push('near a mountain');
  if (b.nearResource) where.push(`near ${b.nearResource.map((r) => RESOURCES[r]?.name ?? r).join(' or ')}`);
  if (where.length) facts.push(['city', '#c8b07a', 'Only', `in a city ${where.join(', ')}`]);
  if (b.resource) facts.push([resourceGlyph(b.resource), RESOURCES[b.resource]?.color ?? '#fff', 'Uses', `1 ${RESOURCES[b.resource]?.name ?? b.resource}`]);
  if (b.policy) facts.push(['crown', '#b8892a', 'Needs', policyNeed(b.policy)]);
  const built = b.kind === 'world' ? store.view?.wonders[b.id] : undefined;
  if (built !== undefined) facts.push(['check', '#6fd27a', 'Built by', store.view?.players[built]?.name ?? '?']);
  const body: El[] = [];
  if (b.kind === 'world') body.push(rich('A world wonder: only one civilization can build it, and the first to finish it wins it.'));
  if (b.kind === 'national' && !isProject(b)) body.push(rich(`A national wonder: one per civilization${b.everyCity ? `, once every city has a [[building:${b.everyCity}]]` : ''}.`));
  if (b.civ) body.push(rich(`The ${CIVS[b.civ]?.adjective ?? ''} unique building, in place of the [[building:${b.replaces}]].`));
  if (FAITH_BUILDINGS.includes(b)) body.push(rich('Bought with faith, in cities that follow a religion with its belief.'));
  const lines = effectLines(b.effects, b.note);
  if (lines.length) body.push(h('ul.pd-list', {}, ...lines.map((l) => h('li', {}, l))));
  const after = BUILDING_LIST.filter((x) => x.needs === b.id || x.everyCity === b.id).map((x) => pediaKey('building', x.id));
  return {
    sub: b.civ ? `${CIVS[b.civ]?.name} · unique building` : b.kind === 'world' ? `${ERA_NAMES[eraOfTech(b.tech)]} world wonder` : isProject(b) ? 'Project' : b.kind === 'national' ? 'National wonder' : `${ERA_NAMES[eraOfTech(b.tech)]} building`,
    facts,
    body,
    related: [
      ['Unlocked by', techKey(b.tech)],
      ['Needs first', [...[b.needs, b.everyCity].filter((x): x is string => !!x).map((x) => pediaKey('building', x)), ...(b.policy ? [`policy:${b.policy}`] : [])]],
      ['Leads to', after],
      ['Civilization', b.civ ? [`civ:${b.civ}`] : []],
      ['Replaced by', BUILDING_LIST.filter((x) => x.replaces === b.id).map((x) => `building:${x.id}`)],
    ],
  };
}

/** A World Congress project: what it costs each civ in the world, what opens it, and each tier's reward. */
function worldProjectPage(id: ProjectId): Page {
  const t = PROJECTS[id];
  const tier = (name: string, color: string, text: string) => h('li', {}, h('b', { style: `color:${color}` }, `${name}: `), text);
  return {
    sub: 'World Congress project',
    facts: [
      ['prod', YIELD_COLOR.prod, 'Cost', `${cost(t.perCiv)} production for each civilization`],
      ['vote', '#3a6a9a', 'Proposed', `once some civilization knows ${TECHS[t.tech]?.name ?? t.tech}`],
    ],
    body: [
      rich('An international project, put to the World Congress as a resolution. Once it passes, every civilization’s cities may put their production into it from their build list (it can’t be bought with gold), until all they have put in together reaches its cost. Then each is rewarded by how much it put in: the most, gold; the next, silver; the rest who put in a twentieth of it or more, bronze. Each project is held once a game.'),
      h('ul.pd-list', {}, tier('Gold', '#f2c14e', t.rewards.gold.text), tier('Silver', '#c8d0dc', t.rewards.silver.text), tier('Bronze', '#c8803a', t.rewards.bronze.text)),
    ],
    related: [['Proposed after', techKey(t.tech)]],
  };
}

function projectPage(id: string): Page {
  if (isWorldProject(id)) return worldProjectPage(id);
  const s = SPACESHIP_PARTS.find((x) => x.id === id)!;
  return {
    sub: 'Spaceship part',
    facts: [
      ['prod', YIELD_COLOR.prod, 'Cost', `${cost(s.cost)} production`],
      ['rocket', '#6ab8ff', 'Needed', `${s.count}`],
    ],
    body: [rich('A part of the spaceship: build every part, after the [[wonder:apollo_program|Apollo Program]], for a [[victory:science|science victory]].')],
    related: [
      ['Unlocked by', techKey(s.tech)],
      ['Needs first', ['wonder:apollo_program']],
    ],
  };
}

function techPage(id: string): Page {
  const t = TECHS[id];
  const s = store.view?.self;
  const known = s?.techs.includes(id);
  const facts: Fact[] = [['science', YIELD_COLOR.science, 'Cost', `${s?.techCosts[id] ?? cost(baseTechCost(t))} science`]];
  facts.push(['turn', ERA_COLOR[techEra(id)], 'Era', ERA_NAMES[eraOfCol(t.col)]]);
  if (s) facts.push(known ? ['check', '#6fd27a', 'Status', 'Known'] : s.researching === id ? ['science', '#f2c14e', 'Status', 'Researching now'] : ['lock', '#8fa1b3', 'Status', 'Not yet known']);
  const body: El[] = [];
  if (t.note) body.push(h('ul.pd-list', {}, ...t.note.split('; ').map((n) => h('li', {}, n))));
  return {
    sub: `${ERA_NAMES[eraOfCol(t.col)]} technology`,
    facts,
    body,
    related: [
      ['Needs', t.needs.map((n) => `tech:${n}`)],
      ['Leads to', TECH_LIST.filter((x) => x.needs.includes(id)).map((x) => `tech:${x.id}`)],
      ['Unlocks', techUnlocks(id, s?.civ)],
    ],
  };
}

/** A wonder's policy need in words: the tree open, or the ideology adopted. */
function policyNeed(id: string): string {
  const ideology = IDEOLOGIES.find((i) => i.id === id);
  return ideology ? `The ${ideology.name} ideology` : `${TREES.find((t) => t.id === id)?.name ?? id} adopted`;
}

/** The wonders a policy tree or ideology lets a civ build. */
const wondersOf = (id: string) => BUILDING_LIST.filter((b) => b.policy === id).map((b) => pediaKey('building', b.id));

function policyPage(id: string): Page {
  const tree = TREES.find((t) => t.id === policyTree(id));
  const ideology = IDEOLOGIES.find((i) => i.id === id);
  const have = store.view?.self.policies.includes(id);
  if (ideology)
    return {
      sub: 'Ideology',
      facts: [['crown', '#f2c14e', 'Chosen', 'From the Industrial Era']],
      body: [rich('One of the three ideologies. Adopt its tenets with culture, as policies: a level-two tenet needs two of level one, a level-three tenet two of level two.')],
      related: [...ideology.tenets.map((level, i) => [`Level ${i + 1}`, level.map((p) => `policy:${p.id}`)] as [string, string[]]), ['Wonders', wondersOf(id)]],
    };
  const tenetOf = IDEOLOGIES.find((i) => i.tenets.some((l) => l.some((p) => p.id === id)));
  if (tenetOf) {
    const level = tenetOf.tenets.findIndex((l) => l.some((p) => p.id === id));
    const p = tenetOf.tenets[level].find((x) => x.id === id)!;
    return { sub: `${tenetOf.name} tenet, level ${level + 1}`, facts: have ? [['check', '#6fd27a', 'Status', 'Adopted']] : [], body: [rich(p.text)], related: [['Ideology', [`policy:${tenetOf.id}`]]] };
  }
  if (!tree) return { sub: '', facts: [], body: [], related: [] };
  const p: Policy = [tree.opener, ...tree.policies, tree.finisher].find((x) => x.id === id)!;
  const opener = p === tree.opener;
  const facts: Fact[] = [['turn', ERA_COLOR[ERAS.indexOf(tree.era)], 'Opens in', ERA_NAMES[tree.era]]];
  if (have) facts.push(['check', '#6fd27a', 'Status', 'Adopted']);
  const body: El[] = [rich(p.text)];
  if (opener) {
    body.push(rich(`Adopting it opens the ${tree.name} tree; adopt all five of its policies to complete it: ${tree.finisher.text}`));
    const wonders = BUILDING_LIST.filter((b) => b.policy === tree.id);
    if (wonders.length) body.push(rich(`Only a civ with ${tree.name} adopted can build ${wonders.map((b) => `[[wonder:${b.id}]]`).join(' and ')}.`));
    if (tree.excludes?.length) body.push(rich(`Can’t be open alongside ${tree.excludes.map((x) => `[[policy:${x}]]`).join(' or ')}.`));
  }
  if (p === tree.finisher) body.push(rich(`Comes with adopting every policy in the ${tree.name} tree.`));
  return {
    sub: opener ? 'Social policy tree' : p === tree.finisher ? `${tree.name}: finisher` : `${tree.name} policy`,
    facts,
    body,
    related: [
      ['Needs', opener ? [] : [...(p.needs ?? []), tree.id].map((n) => `policy:${n}`)],
      ['Leads to', tree.policies.filter((x) => x.needs?.includes(id)).map((x) => `policy:${x.id}`)],
      [opener ? 'Its policies' : 'Tree', opener ? [...tree.policies, tree.finisher].map((x) => `policy:${x.id}`) : [`policy:${tree.id}`]],
      ['Wonders', opener ? wondersOf(id) : []],
    ],
  };
}

function beliefPage(id: string): Page {
  const b = BELIEFS[id];
  const s = store.view?.self;
  const facts: Fact[] = [];
  if (s?.takenBeliefs.includes(id)) facts.push(['lock', '#ff8a7a', 'Status', 'Taken']);
  if (b.kind === 'pantheon' && s) facts.push(['faith', YIELD_COLOR.faith, 'A pantheon costs', `${s.pantheonCost} faith`]);
  const how: Record<string, string> = {
    pantheon: 'A pantheon belief: chosen once, with faith, before a religion; it works in all your cities.',
    founder: 'A founder belief: chosen by a religion’s founder, it works for the founder from all the religion’s followers.',
    follower: 'A follower belief: it works in every city that follows the religion.',
    enhancer: 'An enhancer belief: chosen when a religion is enhanced by a second Great Prophet.',
    reformation: 'A reformation belief.',
  };
  return { sub: BELIEF_KIND[b.kind]?.replace(/s$/, '') ?? b.kind, facts, body: [rich(b.text), rich(how[b.kind] ?? '')], related: [['About', ['concept:religion']]] };
}

function terrainPage(id: string): Page {
  const facts: Fact[] = [];
  const isFeature = id in FEATURES;
  const t = isFeature ? FEATURES[id as FeatureId] : id === 'hills' ? HILLS : id === 'mountain' ? MOUNTAIN : TERRAINS[id as TerrainId];
  const body: El[] = [];
  if (id === 'mountain') body.push(rich('Mountains can’t be crossed or worked; some wonders and buildings want one near.'));
  else {
    facts.push(['food', YIELD_COLOR.food, isFeature && !(t as (typeof FEATURES)[FeatureId]).replace ? 'Adds' : 'Yields', yieldsEl(t.yields, isFeature && !(t as (typeof FEATURES)[FeatureId]).replace)]);
    facts.push(['moves', '#7bd16a', 'Move cost', Number.isFinite(t.move) ? String(t.move) : 'Impassable']);
  }
  if (t.defense) facts.push(['shield', '#c8b07a', 'Defence', `${t.defense > 0 ? '+' : ''}${t.defense}%`]);
  if (id === 'hills') body.push(rich('Hills take the place of the terrain’s yields with their own. Units defend better on them, and cities on hills are stronger.'));
  if (isFeature) {
    const f = FEATURES[id as FeatureId];
    if (f.replace) body.push(rich('It takes the place of the terrain’s yields.'));
    if (f.removable) body.push(rich(`Workers can clear it with [[tech:${f.removable.tech}]]${f.removable.prod ? `, which brings ${f.removable.prod} production to the nearest city` : ''}.`));
  }
  if ((TERRAINS[id as TerrainId] as { water?: boolean } | undefined)?.water) body.push(rich('Water: worked from the coast, crossed by ships and embarked units.'));
  const found = Object.entries(RESOURCES)
    .filter(([, r]) => r.on.includes(id as never))
    .map(([r]) => `resource:${r}`);
  const imps = (Object.entries(IMPROVEMENTS) as [ImprovementId, (typeof IMPROVEMENTS)[ImprovementId]][]).filter(([, i]) => i.on.includes(id as never)).map(([i]) => `improvement:${i}`);
  return { sub: isFeature ? 'Feature' : 'Terrain', facts, body, related: [['Resources found here', found], ['Improvements', imps]] };
}

/** What a natural wonder does besides its yields, a line each (its article, the tile's tooltip). */
export function natureEffects(w: NaturalWonder): string[] {
  const out: string[] = [];
  if (w.sight) out.push(`Units next to it see ${w.sight} tile${w.sight === 1 ? '' : 's'} further`);
  if (w.freshWater) out.push('Fresh water for the land next to it');
  if (w.around) out.push(`${yieldWords(w.around)} on the land next to it`);
  if (w.heals) out.push('Units that end a turn next to it heal fully');
  if (w.promotion) out.push(`Land units that fight and end a turn next to it learn ${PROMOTIONS[w.promotion]?.name ?? w.promotion}`);
  if (w.happiness) out.push(`+${w.happiness} happiness for the civilization whose land it’s in`);
  if (w.finderGold) out.push(`${cost(w.finderGold)} gold for the first civilization to find it`);
  return out;
}

/** Where a natural wonder rises, in words. */
function siteWords(w: NaturalWonder): string {
  const land = w.site.terrain.includes('coast') ? 'the shallow sea by a coast' : `${w.site.elevation.map((e) => (e === 'flat' ? 'flat' : e === 'hills' ? 'hilly' : 'mountainous')).join(' or ')} ${w.site.terrain.map((t) => TERRAINS[t].name.toLowerCase()).join(', ')}`;
  return `${land}${w.site.coast ? ', by the sea' : ''}${w.site.lush ? ', with woods or fresh water near' : ''}`;
}

function naturePage(id: string): Page {
  const w = NATURAL_WONDERS[id];
  const facts: Fact[] = [
    ['food', YIELD_COLOR.food, 'Yields', yieldsEl(w.yields)],
    ['moves', '#7bd16a', 'Units', w.passable ? 'Can enter it' : 'Can’t enter it'],
  ];
  const mine = store.view?.self.naturalWonders.find((x) => x.id === id);
  if (mine) facts.push(['check', '#6fd27a', 'You found it', mine.first ? 'First of all' : 'Yes']);
  const effects = natureEffects(w);
  const body: El[] = [h('div.pd-landmark', {}, h('img', { src: landmarkPicture(id), alt: '' })), h('p.pd-flavour', {}, h('i', {}, w.flavour))];
  if (effects.length) body.push(h('ul.pd-list', {}, ...effects.map((x) => h('li', {}, x))));
  body.push(
    rich(`A natural wonder: a city whose land it’s in works it like any other tile (nothing is built on it, and no city founded there). Every civilization that finds it has +${FOUND_HAPPINESS} happiness for good, and the first to find it ${cost(FIRST_FINDER_GOLDEN)} golden-age points.`),
    rich(`Found on ${siteWords(w)}. [[belief:one_with_nature]] brings faith from natural wonders.`),
  );
  // Found: where it is.
  const g = store.grid;
  const at = g && mine ? store.known.findIndex((k) => k?.wonder === id) : -1;
  if (g && at >= 0)
    body.push(
      h(
        'button.cv-btn.small',
        {
          onclick: () => {
            const c = centre(g, at);
            lookAt(c.x, c.z);
            togglePanel('pedia');
          },
        },
        icon('moves', 13),
        'Show it on the map',
      ),
    );
  return {
    sub: `Natural wonder${w.passable ? '' : ' · impassable'}`,
    facts,
    body,
    related: [
      ['Promotion', w.promotion ? [`promotion:${w.promotion}`] : []],
      ['Pantheon', ['belief:one_with_nature']],
    ],
  };
}

function resourcePage(id: string): Page {
  const r = RESOURCES[id];
  const facts: Fact[] = [
    ['food', YIELD_COLOR.food, 'Yields', yieldsEl(r.yields, true)],
    ['hammer', '#f0a24a', 'Improved', yieldsEl(r.improved, true)],
  ];
  if (r.amount) facts.push(['hexes', r.color, 'Each deposit', `${r.amount[0]}–${r.amount[1]}`]);
  const owned = store.view?.self.strategic[id];
  if (owned) facts.push(['check', '#6fd27a', 'You have', `${owned.have - owned.used} free of ${owned.have}`]);
  const kindText: Record<string, string> = {
    bonus: 'A bonus resource: more food or production where it’s worked.',
    strategic: 'A strategic resource: each improved deposit supplies some, and each unit or building that uses one takes one while it stands.',
    luxury: 'A luxury: improved (or traded for), each kind makes your whole empire happier, once.',
  };
  const usedBy = [
    ...UNIT_LIST.filter((u) => u.resource === id).map((u) => `unit:${u.id}`),
    ...BUILDING_LIST.filter((b) => b.resource === id || b.nearResource?.includes(id)).map((b) => pediaKey('building', b.id)),
  ];
  const boosted = BUILDING_LIST.filter((b) => b.effects.tiles?.some((t) => t.where.resource?.includes(id))).map((b) => pediaKey('building', b.id));
  return {
    sub: `${humanize(r.kind)} resource`,
    facts,
    body: [rich(kindText[r.kind])],
    related: [
      ['Improved by', [`improvement:${r.improvement}`]],
      ['Shown by', techKey(r.reveal)],
      ['Found on', r.on.map((o) => `terrain:${o}`)],
      ['Used by', usedBy],
      ['Made better by', boosted],
    ],
  };
}

function improvementPage(id: ImprovementId): Page {
  const i = IMPROVEMENTS[id];
  const facts: Fact[] = [['food', YIELD_COLOR.food, 'Yields', yieldsEl(i.yields, true)]];
  if (!i.great && i.turns) facts.push(['hammer', '#f0a24a', 'Build time', `${workTime(i.turns)} worker turns`]);
  const body: El[] = [];
  if (i.great) body.push(rich(`A great person’s improvement, built where they stand${GREAT_MAKER[id] ? ` by a [[unit:${GREAT_MAKER[id]}]]` : ''}.`));
  if (i.freshWaterUntil) body.push(rich(`Built on open land anywhere. One more food with fresh water next to it (a river, lake or oasis) once you know [[tech:${i.freshWaterUntil}]], and everywhere with [[tech:fertilizer]]. Clear a forest or jungle first.`));
  if (i.on.includes('resource')) body.push(rich('Built only on the resources it taps.'));
  if (id === 'fort' || id === 'citadel') body.push(rich('Units in it defend much better.'));
  if (id === 'citadel') body.push(rich('It claims the tiles round it for your nearest city, even land of another civ’s (a city’s own tile aside), which that civ won’t forget. Each turn it hurts enemy units next to it.'));
  if (id === 'oil_well') body.push(rich('Taps [[resource:oil]] on land; out at sea it takes an [[improvement:offshore_platform]].'));
  if (id === 'offshore_platform') body.push(rich('Taps [[resource:oil]] out at sea. A [[unit:work_boat]] builds it, and is spent doing it.'));
  const taps = Object.entries(RESOURCES)
    .filter(([r, x]) => x.improvement === id || (id === 'offshore_platform' && r === 'oil'))
    .map(([r]) => `resource:${r}`);
  const where = i.on.filter((o) => o !== 'resource' && o !== 'any_land').map((o) => `terrain:${o}`);
  return {
    sub: i.great ? 'Great improvement' : 'Improvement',
    facts,
    body,
    related: [
      ['Unlocked by', techKey(i.tech)],
      ['Built on', where],
      ['Resources it taps', taps],
      ['Made by', GREAT_MAKER[id] ? [`unit:${GREAT_MAKER[id]}`] : i.tech ? (id === 'fishing_boats' || id === 'offshore_platform' ? ['unit:work_boat'] : ['unit:worker']) : []],
    ],
  };
}

function promotionPage(id: string): Page {
  const p = PROMOTIONS[id];
  return {
    sub: 'Promotion',
    facts: [['xp', '#f2c14e', 'For', p.classes.map((c) => humanize(c)).join(', ')]],
    body: [rich(p.text), rich('A unit takes a promotion each time it has the experience for one: at 10, 30, 60, 100 and so on.')],
    related: [
      ['Needs', (p.needs ?? []).map((n) => `promotion:${n}`)],
      ['Leads to', PROMOTION_LIST.filter((x) => x.needs?.includes(id)).map((x) => `promotion:${x.id}`)],
    ],
  };
}

function civPage(id: string): Page {
  const c = CIVS[id];
  const bias: Record<string, string> = { coast: 'by the coast', river: 'by a river', hills: 'among hills', forest: 'in forest', jungle: 'in jungle' };
  const facts: Fact[] = [['crown', '#f2c14e', 'Leader', c.leader]];
  if (c.startBias) facts.push(['globe', '#8fa1b3', 'Starts', bias[c.startBias] ?? `on ${TERRAINS[c.startBias as TerrainId]?.name.toLowerCase() ?? c.startBias}`]);
  const p = store.view?.players.find((x) => x.civ === id && !x.cityState);
  // (Who plays it here: you, or a person by name; a bot is its leader, said already, unless fallen.)
  if (p && store.view && p.met && (p.index === store.view.you || p.name !== c.leader || !p.alive)) facts.push(['people', '#8fa1b3', 'In this game', p.index === store.view.you ? 'You' : `${p.name}${p.alive ? '' : ' (fallen)'}`]);
  return {
    sub: `${c.leader} · ${c.adjective}`,
    facts,
    body: [h('div.pd-ability', {}, h('b', {}, c.ability.name), rich(c.ability.text)), rich(`Its cities: ${c.cities.slice(0, 6).join(', ')}…`)],
    related: [['Unique unit and building', [`unit:${c.unit}`, pediaKey('building', c.building)]]],
  };
}

function cityStatePage(id: string): Page {
  const v = store.view;
  const names = CITY_STATES.filter((c) => c.kind === id).map((c) => {
    const p = v?.players.find((x) => x.civ === c.civ.id);
    return h('span.pd-cs', {}, emblemEl(c.civ.id, 18, id), c.civ.name, p?.met && p.cityState ? h('small.cv-muted', {}, ` · ${p.cityState.standing}`) : null);
  });
  return { sub: 'Kind of city-state', facts: [], body: [h('div.pd-cslist', {}, ...names)], related: [['About', ['concept:diplomacy']]] };
}

function articlePage(a: Article, kind: Kind): Page {
  const body: El[] = [];
  for (const s of a.sections) {
    if (s.title) body.push(h('h4', {}, s.title));
    body.push(rich(s.text));
  }
  const facts: Fact[] = [];
  if (kind === 'victory') {
    const on = (store.lobby?.settings.victories as Record<string, boolean> | undefined)?.[a.id];
    if (on !== undefined) facts.push(on ? ['check', '#6fd27a', 'In this game', 'On'] : ['close', '#ff8a7a', 'In this game', 'Off']);
  }
  return { sub: a.sub, facts, body, related: [] };
}

function pageOf(e: Entry): Page {
  switch (e.kind) {
    case 'concept':
    case 'victory':
      return articlePage(articleOf(e)!, e.kind);
    case 'citystate': {
      const page = articlePage(articleOf(e)!, e.kind);
      const extra = cityStatePage(e.id);
      return { ...page, body: [...page.body, ...extra.body], related: extra.related };
    }
    case 'civ':
      return civPage(e.id);
    case 'tech':
      return techPage(e.id);
    case 'unit':
      return unitPage(UNITS[e.id]);
    case 'promotion':
      return promotionPage(e.id);
    case 'building':
    case 'wonder':
      return buildingPage(BUILDINGS[e.id]);
    case 'project':
      return projectPage(e.id);
    case 'policy':
      return policyPage(e.id);
    case 'belief':
      return beliefPage(e.id);
    case 'terrain':
      return terrainPage(e.id);
    case 'nature':
      return naturePage(e.id);
    case 'resource':
      return resourcePage(e.id);
    case 'improvement':
      return improvementPage(e.id as ImprovementId);
  }
}

// -------------------------------------------------------------------------------------------------
// The panel
// -------------------------------------------------------------------------------------------------

/** Where the Civilopedia is: the article on show, the way back, the category listed and the search. */
const nav = { at: 'concept:basics', back: [] as string[], cat: 'concept', query: '' };
/** The article last drawn (still on screen: the Civilopedia was already open). */
let shown: El | null = null;

/** Open the Civilopedia (at an article, or where it was). */
/**
 * The article for what's on a map tile, the most telling thing first: a unit there (if it can be
 * seen), its resource, its improvement, its feature, its hills or mountain, its terrain.
 */
export function tileArticle(t: number): string | null {
  const k = store.known[t];
  const s = store.terrain[t];
  if (!k || !s) return null;
  const unit = store.view?.units.find((u) => u.tile === t && (k.visible || u.owner === store.view?.you));
  if (unit) return `unit:${unit.type}`;
  if (k.resource) return `resource:${k.resource}`;
  if (k.improvement && BY_KEY.has(`improvement:${k.improvement}`)) return `improvement:${k.improvement}`;
  if (s.feature) return `terrain:${s.feature}`;
  if (s.elevation !== 'flat') return `terrain:${s.elevation}`;
  return `terrain:${s.terrain}`;
}

export function openPedia(key?: string) {
  if (key && BY_KEY.has(key)) go(key);
  store.panel = 'pedia';
  store.changed++;
}

function go(key: string) {
  const e = BY_KEY.get(key);
  if (!e) return;
  // (The panel isn't redrawn while a field has the focus.)
  if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
  if (nav.at !== key) nav.back.push(nav.at);
  if (nav.back.length > 50) nav.back.shift();
  nav.at = key;
  nav.cat = e.cat;
  store.changed++;
}

function goCategory(cat: string) {
  const first = ENTRIES.find((e) => e.cat === cat);
  nav.query = '';
  if (first) go(first.key);
}

/** The entries listed: the category's, or those matching the search (by name, then by group). */
function listed(): Entry[] {
  const q = nav.query.trim().toLowerCase();
  if (!q) return ENTRIES.filter((e) => e.cat === nav.cat);
  const named = ENTRIES.filter((e) => e.name.toLowerCase().includes(q));
  return named.length ? named.sort((a, b) => +!a.name.toLowerCase().startsWith(q) - +!b.name.toLowerCase().startsWith(q)) : ENTRIES.filter((e) => e.group.toLowerCase().includes(q));
}

/** The list of entries, grouped (by category when searching). */
function renderList(): El[] {
  const entries = listed();
  if (!entries.length) return [h('div.cv-muted', { style: 'padding:10px' }, 'Nothing by that name.')];
  const out: El[] = [];
  let group = '';
  const searching = !!nav.query.trim();
  for (const e of entries) {
    const g = searching ? (CATEGORIES.find((c) => c.id === e.cat)?.name ?? '') : e.group;
    if (g && g !== group) {
      group = g;
      out.push(h('div.cv-label.pd-group', {}, g));
    }
    out.push(h(`button.pd-entry${e.key === nav.at ? '.on' : ''}`, { onclick: () => go(e.key), 'data-key': e.key }, artOf(e, 24), h('span', {}, e.name)));
  }
  return out;
}

export function renderPedia(): El {
  const e = BY_KEY.get(nav.at) ?? ENTRIES[0];
  const page = pageOf(e);
  // (Each article and each category's list a class of its own: one opened starts at its top.)
  const list = h(`div.pd-entries.cv-scroll.pd-in-${nav.cat}`, {}, ...renderList());
  const search = h('input.cv-input.pd-search', { placeholder: 'Search the Civilopedia', value: nav.query, spellcheck: 'false' }) as HTMLInputElement;
  // (The panel isn't redrawn while the field has focus: the list is redrawn here as it's typed in.)
  search.addEventListener('input', () => {
    nav.query = search.value;
    list.replaceChildren(...renderList());
    list.scrollTop = 0;
  });
  search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      const first = listed()[0];
      if (first) {
        search.blur();
        go(first.key);
      }
    }
  });
  const cats = h(
    'div.pd-cats.cv-scroll',
    {},
    ...CATEGORIES.map((c) => h(`button.pd-cat${c.id === nav.cat && !nav.query ? '.on' : ''}`, { onclick: () => goCategory(c.id) }, tile(c.glyph, c.color, 26), h('span', {}, c.name))),
  );
  const facts = page.facts.length ? h('div.pd-facts', {}, ...page.facts.map(([glyph, color, label, value]) => h('div', {}, icon(glyph, 15, color), h('span.cv-muted', {}, label), h('b', {}, value)))) : null;
  const related = page.related.filter(([, keys]) => keys.some((k) => BY_KEY.has(k)));
  const back = nav.back[nav.back.length - 1];
  const article = h(
    `div.pd-article.cv-scroll.pd-at-${e.kind}-${e.id}`,
    {},
    h(
      'div.pd-head',
      {},
      artOf(e, 76),
      h('div.cv-grow', {}, h('div.cv-label', {}, CATEGORIES.find((c) => c.id === e.cat)?.name ?? ''), h('h2', {}, e.name), h('div.cv-muted', {}, page.sub)),
      back &&
        h(
          'button.cv-btn.small',
          {
            onclick: () => {
              if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
              nav.at = nav.back.pop()!;
              nav.cat = BY_KEY.get(nav.at)?.cat ?? nav.cat;
              store.changed++;
            },
            title: `Back to ${BY_KEY.get(back)?.name ?? ''}`,
          },
          h('span.pd-back', {}, icon('moves', 13)),
          'Back',
        ),
    ),
    facts,
    h('div.pd-text', {}, ...page.body),
    ...related.map(([title, keys]) => h('div.pd-rel', {}, h('div.cv-label', {}, title), h('div.pd-links', {}, ...links(keys)))),
  );
  // Opened just now: the search has the keys (F1 and Escape still close it). (Once it's on screen: a
  // redraw held back while a field has the focus never is.)
  const fresh = !shown?.isConnected;
  requestAnimationFrame(() => {
    if (!article.isConnected) return;
    // (Not on a touch screen: its keyboard would come up over half of it before anything's asked.)
    if (fresh && !touchScreen()) search.focus();
    shown = article;
  });
  return h(
    'div.cv-big.cv-panel.cv-pedia',
    {},
    h('button.cv-x', { onclick: () => togglePanel('pedia'), html: svg('close', 15), title: 'Close (Esc)' }),
    h('div.pd-body', {}, h('div.pd-side', {}, h('div.pd-brand', {}, tile('book', '#5a4a8a', 30), h('b', {}, 'Civilopedia')), cats), h('div.pd-mid', {}, search, list), article),
  );
}

// -------------------------------------------------------------------------------------------------
// The card a hover shows (anything with `data-pedia`), and right-click to read on
// -------------------------------------------------------------------------------------------------

/** A short card for an article: its picture and name, `note` (what the thing hovered shows), its facts, its first lines. */
function card(key: string, note: string | null): El | null {
  const e = BY_KEY.get(key);
  if (!e) return null;
  const page = pageOf(e);
  const text = page.body[0];
  const unlocks = page.related.find(([title]) => title === 'Unlocks' || title === 'Unique unit and building')?.[1] ?? [];
  return h(
    'div.pd-card',
    {},
    h('div.pd-head', {}, artOf(e, 40), h('div', {}, h('b', {}, e.name), h('div.cv-muted', {}, page.sub))),
    note && h('div.pd-note', {}, note),
    page.facts.length > 0 && h('div.pd-facts.small', {}, ...page.facts.slice(0, 4).map(([glyph, color, label, value]) => h('div', {}, icon(glyph, 13, color), h('span.cv-muted', {}, label), h('b', {}, value)))),
    text && h('div.pd-text', {}, text),
    unlocks.length > 0 && h('div.pd-unlocks', {}, ...unlocks.map((k) => h('span', {}, entryArt(k, 18), entryName(k)))),
    h('small.cv-dim', {}, touchScreen() ? 'Tap the card for the Civilopedia' : 'Right-click for the Civilopedia'),
  );
}

/**
 * Hovers and right-clicks on anything in the interface with a `data-pedia` key; on a touch screen, a
 * finger held on it shows its card (staying until the next touch; a tap on the card opens the article),
 * and the tap that ends the hold does nothing else.
 */
export function bindPedia(root: El) {
  const holder = h('div.pd-hover');
  root.append(holder);
  let shown = '';
  let touchCard = false;
  let holding = 0;
  let held = false;
  let from = { x: 0, y: 0 };
  let lastTouch = false;
  const putAway = () => {
    shown = '';
    touchCard = false;
    holder.replaceChildren();
  };
  root.addEventListener('pointerdown', (ev) => {
    lastTouch = ev.pointerType === 'touch';
    if (!lastTouch) return;
    held = false;
    clearTimeout(holding);
    if (touchCard && !(ev.target as Element).closest?.('.pd-card')) putAway();
    const el = (ev.target as Element).closest?.('[data-pedia]');
    const key = el?.getAttribute('data-pedia') ?? '';
    if (!key || !BY_KEY.has(key)) return;
    from = { x: ev.clientX, y: ev.clientY };
    holding = window.setTimeout(() => {
      const c = card(key, el?.getAttribute('data-note') ?? null);
      if (!c) return;
      held = true;
      shown = key;
      touchCard = true;
      c.classList.add('touch');
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        putAway();
        openPedia(key);
      });
      holder.replaceChildren(c);
      place(from.x, from.y - 40);
    }, 450);
  });
  root.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'touch' && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) > 10) clearTimeout(holding);
  });
  for (const end of ['pointerup', 'pointercancel'] as const) root.addEventListener(end, () => clearTimeout(holding));
  root.addEventListener(
    'click',
    (ev) => {
      if (!held) return;
      held = false;
      ev.stopPropagation();
      ev.preventDefault();
    },
    true,
  );
  const place = (x: number, y: number) => {
    const el = holder.firstElementChild as HTMLElement | null;
    if (!el) return;
    // (In the interface's own lengths: the screen's over its scale.)
    const k = store.uiScale;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth / k - el.offsetWidth - 8, x / k + 18))}px`;
    el.style.top = `${Math.max(8, Math.min(window.innerHeight / k - el.offsetHeight - 8, y / k + 18))}px`;
  };
  root.addEventListener('pointerover', (ev) => {
    if (ev.pointerType === 'touch') return;
    const el = (ev.target as Element).closest?.('[data-pedia]');
    const key = el?.getAttribute('data-pedia') ?? '';
    if (key === shown) return;
    shown = key;
    const c = key ? card(key, el?.getAttribute('data-note') ?? null) : null;
    holder.replaceChildren(...(c ? [c] : []));
    place(ev.clientX, ev.clientY);
  });
  root.addEventListener('pointermove', (ev) => shown && place(ev.clientX, ev.clientY));
  root.addEventListener('pointerout', (ev) => {
    // (A finger lifted leaves what it was on: a card it held up stays till the next touch.)
    if (ev.pointerType === 'touch') return;
    const to = (ev.relatedTarget as Element | null)?.closest?.('[data-pedia]');
    if (!to && shown) {
      shown = '';
      holder.replaceChildren();
    }
  });
  root.addEventListener('contextmenu', (ev) => {
    // (A finger's long press is the hold above, not a right-click.)
    if (lastTouch) return ev.preventDefault();
    const key = (ev.target as Element).closest?.('[data-pedia]')?.getAttribute('data-pedia');
    if (!key || !BY_KEY.has(key)) return;
    ev.preventDefault();
    shown = '';
    holder.replaceChildren();
    openPedia(key);
  });
  // A redraw can take away what was hovered: its card goes with it.
  new MutationObserver(() => {
    if (shown && !touchCard && !root.querySelector(`[data-pedia="${CSS.escape(shown)}"]:hover`)) {
      shown = '';
      holder.replaceChildren();
    }
  }).observe(root, { childList: true, subtree: true });
}

export const PEDIA_CSS = `
.cv-pedia { padding: 0; overflow: hidden; }
.pd-body { flex: 1; display: grid; grid-template-columns: 200px 260px 1fr; min-height: 0; }
.pd-side { display: flex; flex-direction: column; border-right: 1px solid var(--line); min-height: 0; }
.pd-brand { display: flex; align-items: center; gap: 9px; padding: 14px 14px 10px; font-size: 15px; }
.pd-cats { flex: 1; padding: 4px 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.pd-cat { display: flex; align-items: center; gap: 9px; padding: 5px 8px 5px 5px; border-radius: 9px; text-align: left; font-weight: 600; color: var(--muted) !important; }
.pd-cat:hover { background: rgba(255,255,255,.06) !important; color: var(--text) !important; }
.pd-cat.on { background: rgba(242,193,78,.13) !important; color: #ffe3a1 !important; }
.pd-mid { display: flex; flex-direction: column; border-right: 1px solid var(--line); min-height: 0; padding: 12px 8px 0 10px; gap: 8px; }
.pd-entries { flex: 1; display: flex; flex-direction: column; gap: 1px; padding-bottom: 12px; }
.pd-group { margin: 10px 4px 3px; }
.pd-entry { display: flex; align-items: center; gap: 8px; padding: 4px 7px 4px 4px; border-radius: 8px; text-align: left; font-weight: 600; font-size: 12.5px; }
.pd-entry:hover { background: rgba(255,255,255,.06) !important; }
.pd-entry.on { background: rgba(106,184,255,.14) !important; color: #cfe6ff; }
.pd-entry .cv-tile, .pd-entry .cv-pic, .pd-entry .cv-portrait { border-radius: 7px; }
.pd-article { padding: 18px 54px 24px 24px; display: flex; flex-direction: column; gap: 14px; min-height: 0; }
.pd-head { display: flex; align-items: center; gap: 14px; }
.pd-head h2 { margin: 1px 0 0; font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
.pd-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 6px; }
.pd-facts > div { display: flex; align-items: center; gap: 7px; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.045); border: 1px solid var(--line); }
.pd-facts > div b { margin-left: auto; text-align: right; }
.pd-facts.small { grid-template-columns: 1fr; gap: 3px; }
.pd-facts.small > div { padding: 4px 7px; border-radius: 7px; font-size: 12px; }
.pd-text { max-width: 720px; font-size: 13.5px; line-height: 1.6; color: #d5dde6; }
.pd-text p { margin: 0 0 8px; }
.pd-text p.pd-flavour { color: var(--muted); font-size: 14px; }
.pd-landmark { float: right; width: 190px; height: 190px; margin: 0 0 10px 14px; background: radial-gradient(circle at 50% 45%, rgba(242,193,78,.16), rgba(242,193,78,0) 70%); }
.pd-landmark img { width: 100%; height: 100%; }
.pd-text h4 { margin: 14px 0 4px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--gold); }
.pd-list { margin: 4px 0 8px; padding-left: 18px; } .pd-list li { margin: 2px 0; }
.pd-inline { color: #9fd0ff; cursor: pointer; text-decoration: underline; text-decoration-color: rgba(159,208,255,.35); text-underline-offset: 2px; }
.pd-inline:hover { color: #cfe6ff; }
.pd-rel { display: flex; flex-direction: column; gap: 6px; }
.pd-links { display: flex; flex-wrap: wrap; gap: 5px; }
.pd-link { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 3px; border-radius: 9px; background: rgba(255,255,255,.06); border: 1px solid var(--line) !important; font-weight: 600; font-size: 12.5px; transition: background .12s; }
.pd-link:hover { background: rgba(255,255,255,.12); }
.pd-link .cv-tile, .pd-link .cv-pic, .pd-link .cv-portrait { border-radius: 6px; }
.pd-yields { display: inline-flex; gap: 8px; } .pd-yields span { display: inline-flex; align-items: center; gap: 2px; font-weight: 700; }
.pd-back { display: inline-flex; transform: scaleX(-1); }
.pd-ability { padding: 10px 12px; border-radius: 10px; background: rgba(242,193,78,.08); border: 1px solid rgba(242,193,78,.3); margin-bottom: 10px; }
.pd-ability b { color: #ffe3a1; } .pd-ability p { margin: 3px 0 0; }
.pd-cslist { display: flex; flex-wrap: wrap; gap: 6px; }
.pd-cs { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px 3px 4px; border-radius: 99px; background: rgba(255,255,255,.05); font-weight: 600; }
.pd-note { padding: 6px 9px; border-radius: 8px; background: rgba(242,193,78,.1); color: #ffe3a1; font-weight: 650; white-space: pre-line; }
.pd-unlocks { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 12px; font-weight: 600; }
.pd-unlocks span { display: inline-flex; align-items: center; gap: 5px; }
.pd-unlocks .cv-tile, .pd-unlocks .cv-pic { border-radius: 5px; }
.pd-hover { position: fixed; inset: 0; pointer-events: none; z-index: 30; }
.pd-card.touch { pointer-events: auto; cursor: pointer; }
.pd-card { position: absolute; width: 290px; padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; background: rgba(10,15,22,.96); border: 1px solid var(--line2); border-radius: 12px; box-shadow: var(--shadow); font-size: 12.5px; animation: cvFade .12s; }
.pd-card .pd-head { gap: 10px; } .pd-card .pd-head b { font-size: 14px; }
.pd-card .pd-text { font-size: 12.5px; line-height: 1.45; } .pd-card .pd-text p { margin: 0; } .pd-card .pd-list { margin: 0; } .pd-card .pd-ability { margin: 0; padding: 7px 9px; }
@media (max-width: 900px) {
  .pd-body { grid-template-columns: 52px 200px 1fr; }
  .pd-cat > span:last-child, .pd-brand b { display: none; }
  .pd-cat { justify-content: center; padding: 5px; }
  .pd-article { padding: 12px 40px 16px 14px; }
  .pd-head h2 { font-size: 20px; }
}
@media (max-width: 620px) {
  .pd-body { grid-template-columns: 46px 1fr; }
  .pd-mid { display: none; }
}
`;
