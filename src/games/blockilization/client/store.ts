import { unpackKnown, unpackStatic, unpackYields, type CityInfo, type DealCheck, type KnownTile, type LobbyView, type MapWire, type ReshapeWire, type PreviewAsk, type ResearchAdvice, type StatsInfo, type UnitWire, type View } from '../protocol';
import { indirectFire } from '../rules/combat';
import type { DealItem } from '../rules/diplomacy';
import { clear, distance, ray, type Grid } from '../rules/hex';
import type { Note } from '../rules/state';
import type { Lens } from './lenses';
import type { Reaction } from './leaderscene';
import { prefs } from './prefs';
import type { CombatPreview } from '../rules/preview';
import { PROMOTIONS } from '../rules/promotions';
import { seeFromLevel, seeThroughLevel, type Yields } from '../rules/terrain';
import { isGreatPerson, isMilitary, UNITS } from '../rules/units';

/**
 * What this screen knows: the lobby, the map's terrain, this player's view of the game (the server's
 * word, nothing more), what's selected, and the camera's place. Panels and the overlay read it; the
 * server's messages and the player's clicks change it.
 */

export type StaticTile = ReturnType<typeof unpackStatic>;

/** A big moment's card: a line above, a title and a line under, and its picture (a picture file, a leader, a glyph in a colour). */
export interface Splash {
  kick: string;
  title: string;
  text: string;
  picture?: string;
  /** A natural wonder's picture (by its id, `landmarkart.ts`), and its tile: the camera eases there while it's shown, and it flares up. */
  landmark?: string;
  at?: number;
  glyph?: { name: string; color: string };
  emblem?: { civ: string; kind?: string };
  /** A wonder turning (its strip of pictures, `w_..._turn`), and a line said of it. */
  turn?: string;
  quote?: string;
  /** An era's room (`leaderscene.ts`) as the card's picture, in the viewer's colours. */
  room?: number;
  /** A tile the camera visits while it's shown (a wonder in its city), and whether it goes back after (a flyover). */
  visit?: number;
  back?: boolean;
  /** A light moment: a small card at the top for a few seconds, the map left free. */
  light?: boolean;
  /** The game's end in the world (`ending.ts`): how it was won, by whom, where (a tile the viewer knows, or none), and (science) where its spaceship stands. */
  ending?: { how: string; winner: number; tile?: number; pad?: number };
  /** A sober card (a defeat): its colours muted. */
  sober?: boolean;
  /** A leader in their room, reacting (`leaderscene.ts`): a war declared, a denouncement, peace made. */
  leader?: { player: number; kind: Reaction };
}

export interface Store {
  lobby: LobbyView | null;
  grid: Grid | null;
  terrain: StaticTile[];
  view: View | null;
  /** What each tile is known as (null: never seen), unpacked from the view. */
  known: (KnownTile | null)[];
  /** What each known tile yields this player (null: never seen, or nothing), as the server last said. */
  yields: (Yields | null)[];
  /** The lens chosen (`lenses.ts`): yields, settler, resources, religion, borders, or none. */
  lens: Lens | null;
  /** Which tab of a city's screen is open. */
  cityTab: 'build' | 'people' | 'buildings';
  /** The attack under the mouse: what was asked (with the view it was asked of), and the server's answer once it comes. */
  preview: { ask: PreviewAsk; key: string; data: CombatPreview | null; answered: boolean } | null;
  /** Counts the views received (a preview is asked again when the view changes). */
  viewSeq: number;
  selectedUnit: number | null;
  /** Other units of yours gathered with the selected one (shift-clicks on their flags, or a shift-dragged box), to be sent together. */
  group: number[];
  /** A box being dragged on the map with shift held, to gather the soldiers in it (screen pixels, from where it began). */
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  selectedCity: number | null;
  cityInfo: CityInfo | null;
  /** The demographics, as last asked for (the overview's). */
  stats: StatsInfo | null;
  /** The advisor's research advice, as last asked for (`advice.ts`). */
  advice: ResearchAdvice | null;
  /** The tile under the mouse. */
  hover: number;
  /** An open panel: the tech tree, policies, diplomacy. */
  panel: null | 'tech' | 'policies' | 'diplomacy' | 'religion' | 'espionage' | 'victory' | 'pedia' | 'notes' | 'overview' | 'keys' | 'menu' | 'win' | 'great';
  /** The Great Prophet the religion panel founds (or enhances) with. */
  prophet: number | null;
  /** Big moments waiting to be shown (a wonder built, a new era, first contact...), the first on screen since `shownAt`. */
  splashes: Splash[];
  splashAt: number;
  /** The game-over graph on show (or the replay). */
  graph: 'score' | 'science' | 'land' | 'military' | 'replay';
  /** A message for the player (an order refused), and until when. */
  toast: { text: string; until: number; good?: boolean; glyph?: string } | null;
  /** A city opened from the advisor's warning that it has no defenders, and the turn: its build list advises a defender (`defend.ts`). */
  defend: { city: number; turn: number } | null;
  /** Fights to show: where, and since when; who struck (a unit's id, or a city's as -id) and from where, whether the defender fell, or the attacker (for the models' animations), and when the blow landed (`combatfx.ts`). */
  fights: { at: number; dealt: number; taken: number; t: number; attacker?: number; from?: number; killed?: boolean; died?: boolean; lands?: number }[];
  /** Notes received (newest first), kept a while; the same note again counts up instead of stacking. */
  notes: { text: string; at?: number; kind?: string; t: number; count?: number; openCity?: boolean }[];
  /** Every note this game has brought, oldest first, with the turn it came on (the notification centre's log). */
  log: (Note & { turn: number })[];
  /** The turn's summary: the notes it began with (those in its first few seconds), when it was first on show, until it's put away. */
  digest: { turn: number; since: number; notes: Note[]; shownAt?: number; closed: boolean } | null;
  /** On a touch screen, the tile a first tap chose for a unit (its way shown): a second tap there, with that unit still selected, goes. */
  tap: { unit: number; tile: number } | null;
  /** A city of yours taking aim (its ranged attack): the next click on the map is its target. */
  cityTarget: number | null;
  /** A unit of yours choosing where to go by air (a paratrooper's drop, an airlift, an aircraft's rebase): the next click on the map is where. */
  unitAim: { unit: number; order: 'paradrop' | 'airlift' | 'rebase' } | null;
  /** A move just ordered by a click: the unit, where to, and once the server has taken it, when (this screen's time): its destination's marker pulses, then the next unit can be selected. */
  ordered: { unit: number; to: number; at: number; taken: boolean; advanced?: boolean } | null;
  /** A question waiting for a yes (the sandboxed frame has no `confirm()`). */
  confirm: { text: string; yes: string; danger?: boolean; then: () => void } | null;
  /** The turn's clock as last told (seconds left), and when (this screen's time): it counts down here. */
  timerAt: number;
  /** The game's over and its results are put away, to look at the map. */
  overHidden: boolean;
  /** The interface put away (H), to look at the world: only the world, its models and its fog show. */
  interfaceHidden: boolean;
  /** Someone watching has the bots' civilizations listed, to take one's place. */
  takeOverOpen: boolean;
  /** A panel over (nearly) all the map: the map's overlay isn't drawn under it. */
  mapCovered: boolean;
  /** How big the interface is drawn (1: as designed): the screen's own fit times the player's choice (ui.ts applyLook). The map's flags and banners follow it. */
  uiScale: number;
  /** Of that, the screen's own fit (a big screen's, larger by a step or two; 1 up to about 1600 x 1000). */
  uiFit: number;
  /** Good and bad told apart in blue and orange, not green and red (the player's choice). */
  colourBlind: boolean;
  /**
   * The diplomacy panel: the civ looked at (-1: the city-states, -2: world politics, -3: the World
   * Congress), the deal being drawn up with it (null:
   * none), the server's word on that deal, offers put off till later (by id), and a deal just put
   * (its answer clears the deal once it's made or offered); on the city-states' page, the one
   * spoken to (null: all of them).
   */
  diplo: { with: number | null; deal: DealItem[] | null; check: DealCheck | null; later: number[]; pending: boolean; cityState: number | null };
  changed: number;
}

export const store: Store = {
  lobby: null,
  grid: null,
  terrain: [],
  view: null,
  known: [],
  yields: [],
  lens: null,
  cityTab: 'build',
  preview: null,
  viewSeq: 0,
  selectedUnit: null,
  group: [],
  box: null,
  selectedCity: null,
  cityInfo: null,
  stats: null,
  advice: null,
  hover: -1,
  panel: null,
  prophet: null,
  splashes: [],
  splashAt: 0,
  graph: 'score',
  toast: null,
  defend: null,
  fights: [],
  notes: [],
  log: [],
  digest: null,
  cityTarget: null,
  unitAim: null,
  ordered: null,
  tap: null,
  confirm: null,
  timerAt: 0,
  overHidden: false,
  interfaceHidden: false,
  takeOverOpen: false,
  mapCovered: false,
  uiScale: 1,
  uiFit: 1,
  colourBlind: false,
  diplo: { with: null, deal: null, check: null, later: [], pending: false, cityState: null },
  changed: 0,
};

export function setMap(m: MapWire) {
  store.grid = m.grid;
  store.terrain = m.tiles.map(unpackStatic);
  store.log = [];
  store.digest = null;
  store.stats = null;
  store.advice = null;
  store.yields = [];
  store.changed++;
}

/** Tiles the world has changed since the map was sent (`ReshapeWire`): their land as it now is. */
export function reshapeMap(m: ReshapeWire) {
  for (const [t, s] of Object.entries(m.tiles)) if (store.terrain[+t]) store.terrain[+t] = unpackStatic(s);
  store.changed++;
}

/** Each known tile's yields, as the server sends them (only when they change). */
export function setYields(packed: string) {
  store.yields = unpackYields(packed);
  store.changed++;
}

export function setView(v: View, now: number) {
  const was = store.view?.turn;
  // (The tiles come only when they've changed: else what was known still is.)
  if (!v.tiles) v.tiles = store.view?.tiles ?? [];
  store.view = v;
  store.viewSeq++;
  store.known = v.tiles.map((s) => (s ? unpackKnown(s) : null));
  // The land as it is now: a cut forest, a city's cleared ground (the map's sent once, as it began).
  store.known.forEach((k, t) => {
    const s = store.terrain[t];
    if (k && s && (s.feature ?? '') !== k.feature) s.feature = (k.feature || undefined) as typeof s.feature;
  });
  store.timerAt = now;
  // A new turn: the notes it begins with are its summary's (the stack at the top right has the rest).
  if (was !== undefined && was !== v.turn) store.digest = { turn: v.turn, since: now, notes: [], closed: false };
  const summing = store.digest?.turn === v.turn && now - store.digest.since < 4;
  for (const n of v.notes) {
    store.log.push({ ...n, turn: v.turn });
    // (A reminder of a choice to make is pinned with the decisions at the top right: it isn't news. News
    // of a kind the player has quietened is kept in the notifications, not shown as it comes.)
    if (n.remind || (n.topic && prefs.quiet.includes(n.topic))) continue;
    if (summing) {
      store.digest!.notes.push(n);
      continue;
    }
    const same = store.notes.find((x) => x.text === n.text && x.at === n.at && now - x.t < 30);
    if (same) {
      same.count = (same.count ?? 1) + 1;
      same.t = now;
    } else store.notes.unshift({ ...n, t: now });
  }
  store.notes.sort((a, b) => b.t - a.t);
  store.notes = store.notes.slice(0, 30);
  // A selected unit that's gone (died, founded a city) is deselected.
  if (store.selectedUnit !== null && !v.units.some((u) => u.id === store.selectedUnit && u.owner === v.you)) store.selectedUnit = null;
  store.group = store.selectedUnit === null ? [] : store.group.filter((id) => id !== store.selectedUnit && v.units.some((u) => u.id === id && u.owner === v.you));
  if (store.selectedCity !== null && !v.cities.some((c) => c.id === store.selectedCity && c.owner === v.you)) store.selectedCity = null;
  if (store.cityTarget !== null && !v.cities.some((c) => c.id === store.cityTarget && c.owner === v.you && !c.fired)) store.cityTarget = null;
  if (store.unitAim && !v.units.some((u) => u.id === store.unitAim!.unit && u.owner === v.you)) store.unitAim = null;
  if (!v.over) store.overHidden = false;
  store.changed++;
}

/**
 * A new game (back to the lobby, or a new map): what this screen kept of the last one goes, so none of
 * it carries over (a deal drawn up, a group, a question, the interface put away with H...).
 */
export function resetGame() {
  store.selectedUnit = store.selectedCity = store.cityTarget = null;
  store.group = [];
  store.box = null;
  store.unitAim = null;
  store.cityInfo = null;
  store.prophet = null;
  store.preview = null;
  store.ordered = null;
  store.tap = null;
  store.confirm = null;
  store.toast = null;
  store.defend = null;
  store.fights = [];
  store.notes = [];
  store.splashes = [];
  store.splashAt = 0;
  store.graph = 'score';
  store.overHidden = false;
  store.interfaceHidden = false;
  store.takeOverOpen = false;
  store.diplo = { with: null, deal: null, check: null, later: [], pending: false, cityState: null };
  store.changed++;
}

export const me = () => store.view?.you ?? -1;

/** Each team's colour, Team 1's first. */
export const TEAM_COLORS = ['#3a7ac0', '#c0503a', '#3f9a5a', '#b8902a'];

/** Good and bad's greens and reds, and their stand-ins in the colour-blind palette (blues and oranges). */
const CB_TONES: Record<string, string> = { '#6fd27a': '#5aaeff', '#a6dd8a': '#9fd3ff', '#9be7a4': '#9fd3ff', '#ff6b5e': '#ff9a3c', '#ff9a8e': '#ffb870', '#ff7a6a': '#ffb870', '#f0a24a': '#f2c14e' };
/** A colour that means good or bad, as the player's palette has it (`store.colourBlind`). */
export const tone = (c: string) => (store.colourBlind ? (CB_TONES[c] ?? c) : c);

/** Whether a player is on the viewer's team (not the viewer; a fallen civ's people still have theirs). */
export function teammate(i: number): boolean {
  const v = store.view;
  const mine = v ? (v.fallen ?? v.you) : -1;
  const team = v?.players[mine]?.team;
  return !!v && i !== mine && typeof team === 'number' && v.players[i]?.team === team;
}
export const unitsAt = (t: number) => store.view?.units.filter((u) => u.tile === t) ?? [];
export const cityAt = (t: number) => store.view?.cities.find((c) => c.tile === t);
export const myUnit = (id: number | null) => (id === null ? undefined : store.view?.units.find((u) => u.id === id && u.owner === me()));
export const myCity = (id: number | null) => (id === null ? undefined : store.view?.cities.find((c) => c.id === id && c.owner === me()));

/** An enemy city (at war, known to this player) whose walls reach a tile: it can fire on a soldier there (two tiles). */
export function wallsOver(t: number) {
  const v = store.view;
  const g = store.grid;
  if (!v || !g) return undefined;
  return v.cities.find((c) => c.owner !== me() && v.players[c.owner]?.war && distance(g, c.tile, t) <= 2);
}

/** Whether there's an enemy (at war) on a tile, unit or city. */
export function enemyAt(t: number): boolean {
  const v = store.view;
  if (!v) return false;
  const war = (owner: number) => owner !== me() && v.players[owner]?.war;
  const city = cityAt(t);
  return unitsAt(t).some((u) => war(u.owner)) || (!!city && war(city.owner));
}

/** How far a unit reaches with an attack: its range if it fires or flies (more with promotions: Range, Air Range), else next door. */
export function reachOf(u: UnitWire): number {
  const type = UNITS[u.type];
  if (!type || (!type.ranged && type.domain !== 'air')) return 1;
  return (type.range ?? 1) + (u.promotions ?? []).reduce((s, id) => s + (PROMOTIONS[id]?.range ?? 0), 0);
}

/** Whether a unit is a nuclear weapon (it strikes a tile, not a unit: `nukeable`). */
export const isNuke = (u: UnitWire) => !!UNITS[u.type]?.abilities?.includes('nuke');

/**
 * Whether a nuclear weapon could be aimed at a tile, as far as this screen knows: a known tile in its
 * range with an enemy there, or in an enemy's land. (The rules refuse it if the blast would reach
 * anyone you're not at war with: the strike's confirmation says so.)
 */
export function nukeable(u: UnitWire, t: number): boolean {
  const v = store.view;
  const g = store.grid;
  if (!v || !g || t === u.tile || !store.known[t] || distance(g, u.tile, t) > reachOf(u)) return false;
  const owner = store.known[t]!.owner;
  return enemyAt(t) || (owner >= 0 && owner !== me() && !!v.players[owner]?.war);
}

/** Why a ranged unit can't fire at an enemy it's pointed at: too far, or something in the way of its shot. */
export function outOfReach(u: UnitWire, t: number): string {
  const g = store.grid;
  return g && distance(g, u.tile, t) <= reachOf(u) ? 'Hills, forest, jungle or mountains block its shot' : `Out of range (${reachOf(u)})`;
}

/**
 * Why an aircraft can't strike a tile or rebase to it: an enemy there out of its range, or out of
 * sight (it strikes only what its side sees, as the rules' `airTarget` has it); else no base of
 * yours there in reach.
 */
export function airWhyNot(u: UnitWire, t: number): string {
  const g = store.grid;
  if (g && enemyAt(t)) {
    if (distance(g, u.tile, t) > reachOf(u)) return `Out of range: it strikes up to ${reachOf(u)} tiles away`;
    if (!store.known[t]?.visible) return 'Not in sight: it strikes only what you can see now';
  }
  return `It rebases only to your cities and ships with room for it, within ${reachOf(u) * 2} tiles`;
}

/**
 * Whether a unit could attack a tile from where it stands: a fighting unit, an enemy in sight there,
 * in reach; and for a shot past the next tile, a line of sight to it, as the rules' `canFire` has it
 * (`inSight`: what stands higher than the shooter blocks, unless it has Indirect Fire). Aircraft need
 * no line of sight.
 */
export function attackable(u: UnitWire, t: number): boolean {
  const type = UNITS[u.type];
  const g = store.grid;
  // (A nuclear weapon has no strength of its own: it strikes where it's aimed.)
  if (type && isNuke(u)) return nukeable(u, t);
  if (!type || !isMilitary(type) || type.abilities?.includes('no_attack') || !g) return false;
  if (!store.known[t]?.visible || !enemyAt(t)) return false;
  // A ranged shot from the ground (as the rules' `ranged`): not from the water, and only at an enemy
  // city or soldier (a lone civilian is taken by moving onto it, not shot).
  if (type.ranged && type.domain !== 'air') {
    if (u.embarked) return false;
    const v = store.view!;
    const city = cityAt(t);
    const war = (owner: number) => owner !== me() && !!v.players[owner]?.war;
    if (!(city && war(city.owner)) && !unitsAt(t).some((x) => war(x.owner) && !!UNITS[x.type] && isMilitary(UNITS[x.type]) && !isGreatPerson(x.type) && UNITS[x.type].domain !== 'air')) return false;
  }
  const d = distance(g, u.tile, t);
  if (d > reachOf(u)) return false;
  if (d <= 1 || type.domain === 'air' || indirectFire(u)) return true;
  const from = store.terrain[u.tile];
  if (!from) return false;
  const eye = seeFromLevel(from);
  // (A tile not known blocks it, as the edge of the map does.)
  return clear(ray(g, u.tile, t), (x) => !store.terrain[x] || seeThroughLevel(store.terrain[x]) > eye);
}

/** Ask before doing something drastic: a dialog of the game's own, `then` on yes. */
export function ask(text: string, yes: string, then: () => void, danger = true) {
  store.confirm = { text, yes, then, danger };
  store.changed++;
}
