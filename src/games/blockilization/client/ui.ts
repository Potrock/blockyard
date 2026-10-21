import type { Client } from '@platform/client';
import { centre } from '../geometry';
import type { CityInfo, CityWire, ClientToServer, LobbyAction, LobbyView, UnitWire, View } from '../protocol';
import { takenAlive } from '../rules/combat';
import type { CombatPreview, PreviewSide } from '../rules/preview';
import { BUILDINGS, SPACESHIP_PARTS } from '../rules/buildings';
import { CIV_LIST, CIVS } from '../rules/civs';
import { DIFFICULTIES, DIFFICULTY_LIST, difficultyOf, type Difficulty } from '../rules/difficulty';
import type { Order } from '../rules/game';
import { distance, neighbours, type Grid } from '../rules/hex';
import { MAP_SIZES, MAP_TYPE_NAMES, MAP_TYPES, mapTypeWord, SPEED_LIST, SPEED_NAMES, TURN_CHOICES, type City, type MapSize, type MapType, type Speed } from '../rules/state';
import { ERA_NAMES, ERAS, TECHS } from '../rules/techs';
import { addYields, FEATURES, IMPROVEMENTS, RESOURCES, SEA_WORK, tapsWith, TERRAINS, YIELD_KEYS, type FeatureId, type ImprovementId } from '../rules/terrain';
import { canFortify, isGreatPerson, isMilitary, PARADROP_RANGE, UNITS } from '../rules/units';
import { ALL_POLICIES, IDEOLOGIES, TREES } from '../rules/policies';
import { lookAt } from './camera';
import { buildingGlyph, emblemEl, ERA_COLOR, GREAT_GLYPH, icon, POLICY_GLYPH, resourceGlyph, svg, techEra, techGlyph, unitGlyph, wonderPicture, YIELD_COLOR } from './icons';
import { unitModel } from './models3d';
import { cityAlerts, renderEspionage, renderGreatChoice, renderReligion, renderVictory, unitExtras } from './more';
import { PICTURES, type PictureId } from './picturefiles';
import coverArt from '../cover.webp?url';
import { play } from './sound';
import { onPrefs, prefs, setPrefs, type Palette, type UiSize } from './prefs';
import { bindPedia, natureEffects, PEDIA_CSS, pediaKey, renderPedia, yieldWords } from './pedia';
import { NATURAL_WONDERS } from '../rules/nature';
import { layOutSoon, renderTechTree, TECH_CSS } from './techtree';
import { decisions, NOTES_CSS, renderNoteCentre, renderNotesPart } from './notes';
import { ABILITY_TEXT, VICTORIES } from './concepts';
import { OVERVIEW_CSS, renderOverview } from './overview';
import { HOTKEYS_CSS, renderHotkeys, renderMenu } from './hotkeys';
import { LOBBY_CSS, lobbyFoot, mapTypeText, savedGamesBox, seatTeam, seedRow, speedText, teamMark, teamsRow, victoryCards } from './lobby';
import { ADVICE_CSS, adviceTag, researchHint } from './advice';
import { POLITICS_CSS } from './politics';
import { heldTile, tileMenuFree } from './input';
import { workQuiet, workTip, workTipLines } from './workadvice';
import { FAME_CSS, renderFame } from './fame';
import { defenceAdvice } from './defend';
import { closePinMenu, pinButtons, pinColor, pinMenuOpen, pinsButton, PINS_CSS, pinTip, renderPinList, renderPinMenu } from './pins';
import { faithColor, LENS_CSS, lensBar, lensKey, lensTip, setLens } from './lenses';
import { GUIDE_CSS, guideTips, renderHowToWin, wantsHowToWin, type Tip } from './guide';
import { CSS } from './style';
import { PIXEL_CSS, usePixelGlyphs } from './pixel';
import { PHONE_CSS } from './phone';
import { fitRibbon, renderRibbon, RIBBON_CSS } from './ribbon';
import { replayPanel, REPLAY_CSS } from './replay';
import { splashCard, splashSeconds, SPLASH_CSS } from './splash';
import { ask, attackable, cityAt, enemyAt, me, myCity, myUnit, outOfReach, reachOf, store, teammate, tone, unitsAt, wallsOver } from './store';
import { seasonName } from './weatherfx';
import { chargeFrom, previewPath, routeOf, swapsWith, whyNot, type Route } from './path';
import { leaveMarch, marchOf, marching } from './march';
import { CITYSTATES_CSS } from './citystates';
import { CONGRESS_CSS, openCongress, PROJECT_LOOK, sessionWhen, unvoted } from './congress';
import { isProject, PROJECTS } from '../rules/projects';
import { DIPLO_CSS, putOffOffer, renderDiplomacy, renderOffer, waitingOffer } from './diplomacy';
import type { DealItem } from '../rules/diplomacy';

/**
 * The interface, drawn by this screen in plain DOM over the world: the lobby before a game, then the
 * top bar (the empire's yields, the era and turn, the menus), research, notifications, the end-turn
 * button and the minimap, the selected unit's card, a city's screen, the tech tree, social policies,
 * diplomacy and the rest, big moments as they come, and an advisor's tips. Every button sends an
 * order; the server decides, and its next view shows the result.
 */

export type El = HTMLElement;
export function h(tag: string, props: Record<string, unknown> = {}, ...kids: (El | string | null | undefined | false)[]): El {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'onclick')
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (el.tagName === 'BUTTON') play('click', 0.6);
        (v as (e: MouseEvent) => void)(e as MouseEvent);
      });
    else if (k === 'style') el.style.cssText = String(v);
    else if (k === 'title') el.title = String(v);
    else if (k === 'disabled') (el as HTMLButtonElement).disabled = !!v;
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

/** A picture (one of `pictures/`) in a soft frame. */
export function pic(id: string | null | undefined, size: number): El {
  const url = id ? PICTURES[id as PictureId] : undefined;
  const frame = h('div.cv-pic', { style: `width:${size}px;height:${size}px` });
  if (url) frame.append(h('img', { src: url, alt: '', draggable: 'false' }));
  return frame;
}

/** A glyph on a coloured tile. */
export function tile(glyph: string, bg: string, size = 34, color = '#fff'): El {
  return h('span.cv-tile', { style: `width:${size}px;height:${size}px;background:linear-gradient(160deg, ${bg}, ${shade(bg, -0.3)})`, html: svg(glyph, Math.round(size * 0.58), color) });
}

/** A colour lighter or darker (by -1..1). */
function shade(hex: string, by: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(by < 0 ? c * (1 + by) : c + (255 - c) * by)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('')}`;
}

/** A leader's portrait (a city-state's or the barbarians': their emblem). */
export function portrait(civ: string, size = 52, kind?: string): El {
  if (kind || civ === 'barbarian' || !CIVS[civ] || !PICTURES[`l_${civ}` as PictureId])
    return h('div.cv-portrait', { style: `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center` }, emblemEl(civ, Math.round(size * 0.78), kind));
  return h('div.cv-portrait', { style: `width:${size}px;height:${size}px` }, h('img', { src: PICTURES[`l_${civ}` as PictureId], alt: '', draggable: 'false' }));
}

/** What an item to build looks like: a unit's picture, a wonder's, a building's glyph. */
export function itemArt(kind: string, id: string, size = 36): El {
  if (kind === 'unit') return pic(unitModel(id), size);
  if (kind === 'project') return PROJECT_LOOK[id] ? tile(...PROJECT_LOOK[id], size) : tile('rocket', '#3a5a9a', size);
  const w = wonderPicture(id);
  if (w && BUILDINGS[id]?.kind !== 'building') return pic(w, size);
  const g = buildingGlyph(id);
  return tile(g.glyph, '#22303f', size, g.color);
}

let client: Client;
let root: El;
const parts: Record<string, El> = {};
let rendered = -1;
let lastTimer = '';

/** An order from the player: a unit given one leaves any march it was on (the march's own go by `sendFor`). */
export const send = (o: Order) => {
  if ('unit' in o && typeof o.unit === 'number') leaveMarch(o.unit);
  client.send('order', o);
};
/** An order the screen gives for the player (a march's, turn by turn). */
export const sendFor = (o: Order) => client.send('order', o);
/** Ask the server what another civ would make of a deal being drawn up (its answer comes as `dealCheck`). */
export const checkDeal = (data: { target: number; items: DealItem[]; key: string }) => client.send('dealCheck', data);
const lobby = (a: LobbyAction) => client.send('lobby', a);
/** Any other message to the server. */
export const tell = (name: ClientToServer['name'], data: unknown) => client.send(name, data);

/**
 * The platform's pause menu (how to play, settings, invite friends, leave), where the platform lets
 * a game open it (`client.hud.pause`: a board game never loses the pointer lock that opens it
 * otherwise); and whether it's up, when the game's keys and clicks leave it be.
 */
const platformHud = () => client.hud as typeof client.hud & { pause?: (pane?: 'help' | 'settings') => void; paused?: boolean };
export const canOpenPlatformMenu = () => typeof platformHud().pause === 'function';
export const platformMenuOpen = () => !!client && !!platformHud().paused;
export const openPlatformMenu = (pane: 'help' | 'settings') => platformHud().pause?.(pane);

/** A touch screen (no mouse to hover with): taps, presses and fingers, not clicks and the right button. */
export const touchScreen = () => typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
/** 'Click' or, on a touch screen, 'Tap' (capitalised as asked). */
export const click = (cap = false) => (touchScreen() ? (cap ? 'Tap' : 'tap') : cap ? 'Click' : 'click');

/** The calendar: a year for each turn (4000 BC to 2050 AD over the quick game's 330 turns). */
export function year(turn: number): string {
  const marks: [number, number][] = [[0, -4000], [75, -1000], [135, 500], [200, 1500], [260, 1850], [300, 1950], [330, 2050], [600, 2300]];
  let y = -4000;
  for (let i = 1; i < marks.length; i++)
    if (turn <= marks[i][0]) {
      const [t0, y0] = marks[i - 1];
      const [t1, y1] = marks[i];
      y = Math.round(y0 + ((y1 - y0) * (turn - t0)) / (t1 - t0));
      break;
    }
  return y < 0 ? `${-y} BC` : `${y} AD`;
}

/**
 * A name with a soft hyphen in each long word (Nebuchad-nezzar), between two consonants near its
 * middle, so a narrow card breaks it as a person would (browsers don't hyphenate a capitalised word).
 */
function breakable(name: string) {
  const vowel = (c: string) => 'aeiouy'.includes(c.toLowerCase());
  return name.replace(/\p{L}{12,}/gu, (w) => {
    const mid = Math.floor(w.length / 2);
    for (let d = 0; d < mid - 3; d++)
      for (const i of [mid + d, mid - d]) if (!vowel(w[i - 1]) && !vowel(w[i]) && !/^(ch|sh|th|ph|ck|gh)$/i.test(w[i - 1] + w[i])) return `${w.slice(0, i)}\u00ad${w.slice(i)}`;
    return w;
  });
}

/** A media query's questions about the screen's size (`(max-width: 760px)`, `(orientation: portrait)`), against the rest (`(pointer: coarse)`). */
const SIZE_FEATURE = /^\((?:(?:min|max)-)?(?:width|height|orientation)\s*:/;

/**
 * A media query's prelude as a question about the interface's box: the rest of the query (asked of the
 * screen, or '') and its questions of size (asked of the box), or null where it can't be split (no
 * question of size in some part, or different other questions in each).
 */
function sizeQuery(prelude: string): [string, string] | null {
  const parts = prelude.split(',').map((alt) => {
    const all = alt.trim().split(/\s+and\s+/);
    return { size: all.filter((f) => SIZE_FEATURE.test(f)), rest: all.filter((f) => !SIZE_FEATURE.test(f)).join(' and ') };
  });
  if (parts.some((x) => !x.size.length) || parts.some((x) => x.rest !== parts[0].rest)) return null;
  const size = parts.length === 1 ? parts[0].size.join(' and ') : parts.map((x) => (x.size.length > 1 ? `(${x.size.join(' and ')})` : x.size[0])).join(' or ');
  return [parts[0].rest, size];
}

/**
 * The interface's sheets as the screen takes them, for an interface drawn larger or smaller as a whole
 * (`applyLook`): the screen's lengths (vh, vw) made its own box's (cqh, cqw), and the questions about
 * the screen's size (`@media (max-width: 760px)`) asked of its box (`@container`), so a screen drawn
 * at 130% is laid out as one that much smaller is (a query of size and pointer both, one inside the
 * other). The box's own rules can't be asked of it: those under a question of size are its children's.
 */
export function scaledCss(css: string) {
  let out = css.replace(/(\d*\.?\d+)v([hw])\b/g, '$1cq$2');
  for (let from = 0, at = out.indexOf('@media', from); at >= 0; at = out.indexOf('@media', from)) {
    const open = out.indexOf('{', at);
    const split = sizeQuery(out.slice(at + 6, open));
    from = open + 1;
    if (!split) continue;
    const [rest, size] = split;
    if (!rest) {
      out = `${out.slice(0, at)}@container ${size} {${out.slice(open + 1)}`;
      from = at + `@container ${size} {`.length;
      continue;
    }
    // (Its block closed twice: the screen's question's, then the box's inside it.)
    let depth = 1;
    let end = open + 1;
    for (; end < out.length && depth; end++) depth += out[end] === '{' ? 1 : out[end] === '}' ? -1 : 0;
    const head = `@media ${rest} { @container ${size} {`;
    out = `${out.slice(0, at)}${head}${out.slice(open + 1, end)}}${out.slice(end)}`;
    from = at + head.length;
  }
  return out;
}

/** The interface's size steps, as chosen (against what suits the screen). */
const SIZE_OF: Record<UiSize, number> = { small: 0.9, normal: 1, large: 1.15, larger: 1.3 };
/** What suits a big screen: half steps, so the pixel art's 2-pixel steps land on whole pixels (3 at 1.5, 4 at 2). */
const FITS = [1, 1.5, 2, 2.5, 3];

/**
 * A scale on whole device pixels for the pixel art (its frames' and type's 2-pixel steps), where the
 * screen has two or more to a CSS pixel (a multiple of 1 / (2 x DPR): at DPR 2, Small 0.75, Large
 * 1.25, Larger 1.5; at DPR 3, 0.83, 1.17, 1.33): Small rounds down, Larger up, the rest to the nearest.
 * At DPR 1 whole pixels would be half steps, too coarse for the choice: it's drawn as asked (the type
 * a little soft at 1.15 and 1.3; the frames' bands sharp, a pixel wider here and there).
 */
function sharp(scale: number, size: UiSize) {
  const dpr = window.devicePixelRatio || 1;
  if (dpr < 2) return scale;
  const n = scale * 2 * dpr;
  const steps = size === 'small' ? Math.floor(n + 1e-6) : size === 'larger' ? Math.ceil(n - 1e-6) : Math.round(n);
  return steps / (2 * dpr);
}

/**
 * How big the interface is drawn: what suits the screen (as designed up to about 1600 x 1000; on a
 * bigger one, half again or twice as large: 2560 x 1440 at 1.5, a 4K screen at its own size at 2)
 * times the player's choice, on whole device pixels where there are enough of them (`sharp`); and the
 * colours good and bad are told apart in. The map's flags and banners take the scale too.
 */
export function applyLook() {
  if (!root) return;
  // (A screen a little short of a step takes it: 2560 x 1440 is 1.44 of the design.)
  const fit = Math.min(window.innerWidth / 1600, window.innerHeight / 1000) + 0.1;
  const base = FITS.filter((f) => f <= fit).pop() ?? 1;
  const scale = Math.round(sharp(base * SIZE_OF[prefs.uiSize], prefs.uiSize) * 1e4) / 1e4;
  const cb = prefs.palette === 'colourblind';
  if (scale === store.uiScale && base === store.uiFit && cb === store.colourBlind && root.style.zoom === (scale === 1 ? '' : String(scale))) return;
  store.uiScale = scale;
  store.uiFit = base;
  store.colourBlind = cb;
  root.style.zoom = scale === 1 ? '' : String(scale);
  root.classList.toggle('cb', cb);
  store.changed++;
}

/** Change the interface's size or colours (and keep them). */
export function setLook(p: { uiSize?: UiSize; palette?: Palette }) {
  setPrefs(p);
  applyLook();
}

export function mountUI(c: Client, layer: El) {
  client = c;
  const style = (css: string) => c.hud.style(scaledCss(css));
  style(CSS);
  style(PEDIA_CSS);
  style(TECH_CSS);
  for (const css of [NOTES_CSS, OVERVIEW_CSS, HOTKEYS_CSS, LOBBY_CSS, DIPLO_CSS, LENS_CSS, GUIDE_CSS, RIBBON_CSS, REPLAY_CSS, ADVICE_CSS, POLITICS_CSS, PINS_CSS, SPLASH_CSS, FAME_CSS, CITYSTATES_CSS, CONGRESS_CSS]) style(css);
  // The pixel look over all of it (last, so it wins), its glyphs redrawn as they're made.
  style(PIXEL_CSS);
  // Phones and touch screens over that (fingers, small screens).
  style(PHONE_CSS);
  // (Pictures made since are swapped in where they stand: nothing to redraw.)
  usePixelGlyphs(() => {});
  root = h('div.cv-root');
  layer.append(root);
  applyLook();
  onPrefs(applyLook);
  // (A finger doesn't aim from the middle of the screen: no crosshair there on a touch screen.)
  if (touchScreen()) c.hud.crosshair.replace(h('span'));
  // A phone held upright: turn it sideways, or play on (the platform's own prompt is for games that hold the pointer).
  root.append(
    h(
      'div.cv-rotate',
      {},
      h('div.cv-rotate-phone'),
      h('div.cv-h.big', {}, 'Turn your phone sideways'),
      h('div.cv-muted', {}, 'Blockilization is made to be played wide.'),
      h('button.cv-btn', { onclick: () => root.classList.add('upright-ok') }, 'Play upright anyway'),
    ),
  );
  for (const name of ['top', 'research', 'notes', 'ribbon', 'corner', 'unit', 'city', 'advisor', 'preview', 'pin', 'big', 'lobby', 'over', 'splash', 'offer', 'confirm', 'tip', 'toast']) {
    parts[name] = h('div');
    root.append(parts[name]);
  }
  // A press on the interface holds its redraws until it's let go (else a redraw between the press and
  // the release swaps the button out from under it, and the click is lost); leaving a field redraws
  // what was held back while it was being typed in.
  root.addEventListener('pointerdown', () => (pressing = true));
  // (A finger's click comes a moment after it's lifted, not with it: the hold lasts till then.)
  let release = 0;
  window.addEventListener(
    'pointerup',
    (e) => {
      clearTimeout(release);
      if (e.pointerType === 'touch' && pressing) release = window.setTimeout(() => (pressing = false), 500);
      else pressing = false;
    },
    true,
  );
  window.addEventListener('pointercancel', () => (clearTimeout(release), (pressing = false)), true);
  window.addEventListener('click', () => (clearTimeout(release), (pressing = false)), true);
  // (A release this screen never hears of, as when the press began on a tooltip that was taken away, mustn't hold the
  // redraws for good: a mouse moving with no button down has been let go.)
  window.addEventListener('pointermove', (e) => e.buttons === 0 && (pressing = false), true);
  root.addEventListener('focusout', () => carrying || store.changed++);
  window.addEventListener('resize', () => (applyLook(), fitTop(), coverCheck()));
  // (Taken to a screen with more or fewer device pixels: whole ones again.)
  const sharpAgain = () => matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change', () => (applyLook(), sharpAgain()), { once: true });
  sharpAgain();
  bindPedia(root);
}

let pressing = false;
/** A field's focus being carried over to its new self in a redraw: its old self leaving (and losing the focus) is no reason to redraw again. */
let carrying = false;

export function closePanels() {
  // (A tile's menu first: it's over the rest.)
  if (closePinMenu()) return;
  const shown = front();
  if (shown === 'confirm') store.confirm = null;
  else if (shown === 'splash') store.splashes.shift(), (store.splashAt = 0);
  else if (shown === 'offer') putOffOffer();
  else if (store.panel) store.panel = null;
  else if (store.selectedCity !== null) store.selectedCity = null;
  else if (store.selectedUnit !== null) store.selectedUnit = null;
  else if (store.lens) store.lens = null;
  else if (store.view && !store.view.spectator) store.panel = 'menu';
  store.changed++;
}

/**
 * What holds the middle of the screen, one thing at a time: a question asked, else a big moment (a
 * wonder, first contact...), else a deal put to this player. Moments and deals wait while a panel's
 * open (a question can be asked from one); the turn's summary, the advisor and the map's tooltip
 * wait for all of them.
 */
export function front(): 'confirm' | 'splash' | 'offer' | null {
  if (store.confirm) return 'confirm';
  const v = store.view;
  if (store.panel || !v || !store.grid) return null;
  if (store.splashes.length) return 'splash';
  if (!v.over && !v.spectator && waitingOffer()) return 'offer';
  return null;
}

/** Seconds left on the turn's clock, counted down on this screen since the server last said (null: no clock). */
export function timerLeft(now: number): number | null {
  const t = store.view?.timer;
  return t === null || t === undefined ? null : Math.max(0, Math.ceil(t - (now - store.timerAt)));
}

/** Redraw what's changed (cheap enough to do whole when anything has; the clock redraws only its corner). */
export function renderUI(now: number) {
  const timerKey = `${timerLeft(now)}`;
  // The turn's summary goes after a while on show by itself.
  const digest = store.digest;
  if (digest && !digest.closed && digest.turn === store.view?.turn && digest.shownAt !== undefined && now - digest.shownAt > 25) {
    digest.closed = true;
    store.changed++;
  }
  // A big moment on show goes after a while by itself (a light one sooner: `splash.ts`).
  if (store.splashes.length && store.splashAt && now - store.splashAt > splashSeconds(store.splashes[0])) {
    store.splashes.shift();
    store.splashAt = 0;
    store.changed++;
  }
  if (pressing || (rendered === store.changed && !(store.toast && store.toast.until < now))) {
    if (!pressing && timerKey !== lastTimer && store.view && parts.corner.firstElementChild) {
      lastTimer = timerKey;
      fill(parts.corner, renderCorner(now));
      fitRibbon(parts.ribbon.firstElementChild, parts.corner.firstElementChild);
    }
    renderTip();
    return;
  }
  rendered = store.changed;
  lastTimer = timerKey;
  if (store.toast && store.toast.until < now) store.toast = null;
  const L = store.lobby;
  const playing = !!store.view && !!store.grid && (L?.phase === 'playing' || L?.phase === 'over' || !L);
  const over = playing && !!store.view?.over;
  const watching = playing && !!store.view?.spectator;
  // (The Civilopedia can be read in the lobby too, over it.)
  fill(parts.lobby, playing || store.panel === 'pedia' ? null : renderLobby());
  fill(parts.top, playing ? (watching ? renderWatching() : renderTop()) : null);
  if (playing) layOutSoon();
  fill(parts.research, playing && !over && !watching ? renderResearch() : null);
  const shown = playing ? front() : null;
  // (A big moment put aside behind a panel has its full time on show again when it's back.)
  if (shown !== 'splash') store.splashAt = 0;
  fill(parts.notes, playing ? renderNotesPart(now, !shown && !store.panel && !over) : null);
  // The leaders down the right (under a panel or a city's screen, out of the way); the notes then to their left.
  fill(parts.ribbon, playing && !over && !watching && !store.panel && store.selectedCity === null ? renderRibbon() : null);
  root.classList.toggle('ribbon-on', !!parts.ribbon.firstElementChild);
  fill(parts.corner, playing ? renderCorner(now) : null);
  // (The unit's card waits behind a big panel: only the notifications leave room for it.)
  fill(parts.unit, playing && store.selectedCity === null && (!store.panel || store.panel === 'notes') ? renderUnit() : null);
  fill(parts.city, playing ? renderCity() : null);
  fill(parts.big, (playing && !watching) || store.panel === 'pedia' ? renderBig() : null);
  fill(parts.advisor, playing && !over && !watching && !store.panel && !shown && store.selectedCity === null && store.selectedUnit === null ? renderAdvisor() : null);
  fill(parts.preview, playing && !over && !watching && !store.panel ? renderPreview() : null);
  fill(parts.pin, renderPinMenu(playing && !over && !watching && !store.panel && !shown));
  fill(parts.over, over && !store.overHidden && !store.splashes.length ? renderOver() : null);
  fill(parts.splash, shown === 'splash' ? splashCard(now) : null);
  fill(parts.offer, shown === 'offer' ? renderOffer() : null);
  fill(parts.confirm, store.confirm ? renderConfirm() : null);
  fill(parts.toast, store.toast ? h(`div.cv-toast${store.toast.good ? '.good' : ''}`, {}, icon(store.toast.glyph ?? (store.toast.good ? 'check' : 'info'), 16, tone(store.toast.good ? '#9be7a4' : '#ff9a8e')), store.toast.text) : null);
  // What's measured, once all's drawn (one layout, not one between each part): the top bar's fit, the
  // ribbon's room above the corner, whether a panel covers the map.
  fitTop();
  fitRibbon(parts.ribbon.firstElementChild, parts.corner.firstElementChild);
  // (Where the bottom-right corner starts, a list of map pins in it or not: the notes stop above it.)
  root.style.setProperty('--corner-top', `${Math.round((parts.corner.firstElementChild?.getBoundingClientRect().top ?? window.innerHeight) / store.uiScale)}px`);
  coverCheck();
  renderTip();
}

/** What can scroll in a part, in order: its own panel too, if that scrolls. */
const scrollers = (el: Element) => [...(el.matches('.cv-scroll') ? [el] : []), ...el.querySelectorAll('.cv-scroll')];

/**
 * A part's new content. One that's the same kind of panel as before skips its entrance animation and
 * keeps where it was scrolled to; one with a field being typed in (or a list open) is left as it is
 * until the field's let go, so the typing isn't lost. A number field with nothing typed since its
 * value was taken (a deal's gold, after Tab) doesn't hold it back: the focus goes on to the same field
 * in the new content, so the deal's summary and verdict keep up.
 */
/**
 * The top bar fitted to the screen, only as far as it needs: its numbers tighter, then the panels used
 * less into the menu, then the changes a turn left to each number's card (a tap or the mouse shows it),
 * and last the menu kept at its right with the numbers scrolling under it.
 */
function fitTop() {
  const bar = parts.top.firstElementChild as El | null;
  const steps = ['top-tight', 'top-fold', 'top-terse', 'top-scroll'];
  root.classList.remove(...steps);
  if (bar)
    for (const step of steps) {
      if (bar.scrollWidth <= bar.clientWidth) break;
      root.classList.add(step);
    }
  // Where the bar ends (it can take two rows on a phone held upright): what hangs under it starts there.
  root.style.setProperty('--bar-bottom', `${Math.round((bar?.getBoundingClientRect().bottom ?? 0) / store.uiScale)}px`);
}

/** Whether a big panel lies over (nearly) all the map, so the map's overlay can rest under it. */
function coverCheck() {
  const big = parts.big.firstElementChild as El | null;
  const r = big?.getBoundingClientRect();
  store.mapCovered = !!r && r.width >= window.innerWidth * 0.94 && r.height >= window.innerHeight * 0.8;
}

function fill(el: El, content: El | null) {
  const before = el.firstElementChild as El | null;
  const active = document.activeElement;
  const numbers = (x: Element) => [...x.querySelectorAll<HTMLInputElement>('input[type=number]')];
  const at = before && active instanceof HTMLInputElement && active.type === 'number' ? numbers(before).indexOf(active) : -1;
  const carried = content && at >= 0 ? numbers(content)[at] : undefined;
  const settled = !!carried && carried.value === (active as HTMLInputElement).value;
  if (content && before && active && el.contains(active) && active.matches('input, textarea, select') && !settled) return;
  const same = !!(content && before && before.className === content.className);
  const scrolled = same ? scrollers(before!).map((x) => ({ cls: x.className, top: x.scrollTop, left: x.scrollLeft })) : [];
  if (same) content!.style.animation = 'none';
  carrying = settled;
  el.replaceChildren();
  carrying = false;
  if (!content) return;
  el.append(content);
  scrollers(content).forEach((x, i) => {
    const was = scrolled[i];
    if (!was || was.cls !== x.className) return;
    x.scrollTop = was.top;
    x.scrollLeft = was.left;
  });
  if (settled) {
    carried!.focus();
    carried!.select();
  }
}

/** A question asked in the game's own dialog (the frame has no `confirm()`). */
function renderConfirm(): El | null {
  const q = store.confirm;
  if (!q) return null;
  const close = () => {
    store.confirm = null;
    store.changed++;
  };
  return h(
    'div.cv-confirm',
    { onclick: close },
    h(
      'div.cv-panel.box',
      { onclick: () => {} },
      h('div.cv-h', {}, q.text),
      h(
        'div.acts',
        {},
        h('button.cv-btn', { onclick: close }, 'Cancel'),
        h(`button.cv-btn${q.danger ? '.danger' : '.gold'}`, {
          onclick: () => {
            close();
            q.then();
          },
        }, q.yes),
      ),
    ),
  );
}

/** A spectator's bar: whose world it is, and the turn. */
function renderWatching(): El {
  const v = store.view!;
  // Someone only watching (not a fallen player) may take a bot's place, as Civ V lets a person join a game under way.
  const bots = v.fallen === undefined && !v.over ? v.players.filter((p) => p.bot && p.alive && !p.cityState && p.civ !== 'barbarian') : [];
  const toggle = () => ((store.takeOverOpen = !store.takeOverOpen), store.changed++);
  return h(
    'div.cv-top.cv-panel',
    {},
    h('div.civ', {}, icon('globe', 22), h('b', {}, v.fallen !== undefined ? 'Fallen' : 'Watching')),
    h('span.cv-muted', {}, v.fallen !== undefined ? 'Your civilization has fallen: you watch the rest of the game, every civilization’s land shown.' : bots.length ? 'Every civilization’s land is shown. Take a bot’s place to play.' : 'Every civilization’s land is shown. Join a new game from the lobby to play.'),
    bots.length > 0 && h(`button.cv-btn.small${store.takeOverOpen ? '.on' : ''}`, { onclick: toggle, title: 'Lead one of the bots’ civilizations from here on' }, icon('people', 14), 'Take a bot’s place'),
    bots.length > 0 &&
      store.takeOverOpen &&
      h(
        'div.cv-takeover.cv-panel',
        {},
        ...bots.map((p) =>
          h(
            'button.cv-btn',
            { onclick: () => (client.send('takeOver', { player: p.index }), (store.takeOverOpen = false), store.changed++) },
            emblemEl(p.civ, 20),
            h('span.cv-grow', {}, `${p.name} · ${CIVS[p.civ]?.name ?? ''}`),
            h('small.cv-muted', {}, `${p.cities} ${p.cities === 1 ? 'city' : 'cities'} · score ${p.score}${typeof p.team === 'number' ? ` · Team ${p.team + 1}` : ''}`),
          ),
        ),
      ),
    h('span.spacer'),
    h('div.when', {}, h('b', {}, `${ERA_NAMES[ERAS[Math.max(0, ...v.players.map((p) => p.era))]] ?? ''}`), h('small', {}, `Turn ${v.turn} · ${year(v.turn)}`)),
    h('div.menu', {}, h('button', { onclick: () => client.send('exit', null), title: 'Leave the game' }, icon('close', 19))),
  );
}

// -------------------------------------------------------------------------------------------------
// Lobby
// -------------------------------------------------------------------------------------------------

/** Who of a saved game's people isn't here yet (they can come back to their seat once it's under way). */
function awayFromSave(L: LobbyView): string {
  const away = L.save?.seats.filter((name) => !L.seats.some((s) => !s.bot && s.name === name)) ?? [];
  return away.length ? ` · not here yet: ${away.join(', ')} (they can join once it's under way)` : '';
}

/** Things worth knowing on the first turns (the guide's and the Civilopedia's own words), one at a time while the world is made. */
const FIRST_TIPS = [
  'Found your capital with your Settler at once: rivers, the coast and grassland make the best start.',
  'More cities, placed well, are how an empire grows. The Settler lens numbers the best sites you know.',
  'Space selects the next unit that needs orders; Enter ends the turn.',
  'Hover anything with a picture for a short card about it (on a touch screen, touch and hold it); right-click it, or tap the card, for its Civilopedia article.',
  'Y shows the yields lens: what every tile you know yields. L goes through the other lenses.',
  'Other civilizations race you for land, wonders and the win: see how you stand in Diplomacy and the Overview.',
  'F1 opens the Civilopedia; ? lists every keyboard shortcut.',
  'H hides the interface, to look at your empire (again to bring it back).',
];

/** The world being made: the cover, how far along, what kind of world, and a tip (a new one every few seconds). */
function renderBuilding(L: NonNullable<typeof store.lobby>): El {
  const done = Math.max(0, Math.min(1, L.progress ?? 0));
  const s = L.settings;
  const civs = L.seats.length;
  const tip = FIRST_TIPS[Math.floor(Date.now() / 7000) % FIRST_TIPS.length];
  return h(
    'div.cv-lobby.cv-panel.cv-building',
    {},
    h('div.bd-art', {}, h('img', { src: coverArt, alt: '', draggable: 'false' }), h('h1', {}, 'Blockilization')),
    h('div.bd-what', {}, h('b', {}, 'Shaping the world…'), h('span', {}, `${Math.round(done * 100)}%`)),
    h('div.cv-progress', {}, h('i', { style: `width:${Math.round(done * 100)}%` })),
    h('div.bd-world', {}, `A ${MAP_SIZES[s.size].name.toLowerCase()} ${mapTypeWord(s.type)} map · ${civs} ${civs === 1 ? 'civilization' : 'civilizations'}${s.cityStates ? ` · ${s.cityStates} city-states` : ''}`),
    h('div.bd-tip', {}, tile('lightbulb', '#2f5fa0', 30), h('span', {}, tip)),
  );
}

function renderLobby(): El | null {
  const L = store.lobby;
  const brand = (sub: string) => h('div.brand', {}, h('h1', {}, 'Blockilization'), h('div.tag', {}, sub));
  if (!L) return h('div.cv-lobby.cv-panel', { style: 'width:min(480px,94cqw)' }, brand('Connecting…'));
  const isHost = L.host === L.you;
  const mine = L.seats.find((s) => s.key === L.you);
  if (L.phase === 'building') return renderBuilding(L);
  // (`why`: what keeps a choice from being made, if anything.)
  const chips = <T extends string | number>(label: string, values: [T, string][], now: T, set: (v: T) => void, why?: (v: T) => string | null) =>
    h('div.row', {}, h('label', {}, label), ...values.map(([v, name]) => h(`button.chip${v === now ? '.on' : ''}`, { onclick: isHost && !why?.(v) ? () => set(v) : undefined, disabled: (!isHost || !!why?.(v)) && v !== now, title: why?.(v) ?? undefined }, name)));
  const s = L.settings;
  const bots = L.seats.filter((x) => x.bot).length;
  const people = L.seats.filter((x) => !x.bot).length;
  return h(
    'div.cv-lobby.cv-panel.cv-scroll',
    {},
    brand('Build an empire to stand the test of time.'),
    L.save &&
      h(
        'div.cv-alert',
        { style: 'justify-content:center;background:rgba(106,184,255,.08);border-color:rgba(106,184,255,.3)' },
        icon('turn', 18, '#6ab8ff'),
        h('span', {}, `A saved game: turn ${L.save.turn} (${L.save.seats.join(', ')})${awayFromSave(L)}. Begin keeps it in a room of its own.`),
        isHost && h('button.cv-btn.gold.small', { onclick: () => lobby({ a: 'resume' }) }, 'Carry on'),
        isHost && h('button.cv-btn.small', { onclick: () => lobby({ a: 'discard' }) }, 'Discard'),
      ),
    savedGamesBox(L),
    renderFame(),
    h('div.cv-label.sect', {}, 'Choose your civilization'),
    h(
      'div.cv-civs',
      {},
      ...CIV_LIST.map((civ) => {
        // (A bot's civ is free to take: the bot picks another.)
        const taken = L.seats.some((x) => x.civ === civ.id && x !== mine && !x.bot);
        return h(
          `button.cv-civ${mine?.civ === civ.id ? '.on' : ''}${taken ? '.taken' : ''}`,
          { onclick: taken || !mine ? undefined : () => lobby({ a: 'civ', civ: civ.id }), 'data-pedia': `civ:${civ.id}` },
          portrait(civ.id, 54),
          h('div.txt', {}, h('b', {}, civ.name), h('small', {}, breakable(civ.leader)), h('small', { style: 'color:#d9b25a;margin-top:2px' }, civ.ability.name)),
          h('span.em', {}, emblemEl(civ.id, 22)),
        );
      }),
    ),
    h('div.cv-label.sect', {}, 'Players'),
    h(
      'div.cv-seats',
      {},
      ...L.seats.map((x) =>
        h(
          'div.cv-seat',
          {},
          x.civ ? emblemEl(x.civ, 24) : h('span', { style: 'width:24px;height:24px;border-radius:50%;background:rgba(255,255,255,.08);display:inline-block' }),
          x.name,
          x.bot ? h('span.cv-chip', { style: 'padding:0 6px;font-size:10.5px' }, 'BOT') : x.key === L.host ? icon('crown', 14, '#f2c14e') : null,
          L.teams && seatTeam(x, isHost || x === mine, lobby),
        ),
      ),
    ),
    teamsRow(L, isHost, lobby),
    !mine && h('small.cv-muted', {}, 'Every place on this map is taken: you’ll watch the game. A place comes free if the host picks a larger map, or someone leaves.'),
    h('div.cv-label.sect', {}, 'The world'),
    chips('Map size', (Object.keys(MAP_SIZES) as MapSize[]).map((k) => [k, `${MAP_SIZES[k].name} · ${MAP_SIZES[k].players}`]), s.size, (v) => lobby({ a: 'settings', size: v }), (v) => (MAP_SIZES[v].players < people ? `Room for ${MAP_SIZES[v].players}: ${people} people are playing` : null)),
    chips('Map type', MAP_TYPES.map((t): [MapType, string] => [t, MAP_TYPE_NAMES[t]]), s.type, (v) => lobby({ a: 'settings', type: v })),
    mapTypeText(s.type),
    s.type === 'earth' && chips('Starting places', [[1, 'True'], [0, 'Fair']] as [number, string][], s.trueStarts ? 1 : 0, (v) => lobby({ a: 'settings', trueStarts: v === 1 })),
    s.type === 'earth' && h('div.lb-desc', {}, s.trueStarts ? 'Every civ starts where it really began: Egypt on the Nile, England on its island. Some get better land than others, as history did.' : 'Starts spread fairly over the Earth’s good land, wherever each civ comes from.'),
    chips('World wraps', [[1, 'On'], [0, 'Off']] as [number, string][], s.wrap === false ? 0 : 1, (v) => lobby({ a: 'settings', wrap: v === 1 })),
    h('div.lb-desc', {}, s.wrap === false ? 'The map has edges east and west, as on a table.' : 'Sail or march off the east edge and come back in from the west, as round a globe (Civ V’s worlds). The poles stay edges.'),
    chips('Speed', SPEED_LIST.map((sp): [Speed, string] => [sp, SPEED_NAMES[sp]]), s.speed, (v) => lobby({ a: 'settings', speed: v })),
    speedText(s.speed),
    chips('Difficulty', DIFFICULTY_LIST.map((d) => [d, DIFFICULTIES[d].name] as [Difficulty, string]), difficultyOf(s), (v) => lobby({ a: 'settings', difficulty: v })),
    h('div.row', {}, h('label', {}), h('small.cv-muted', {}, DIFFICULTIES[difficultyOf(s)].text)),
    // (-1: the dynamic timer, here only.)
    chips('Turn timer', [[0, 'None'], [-1, 'Dynamic'], [60, '1 min'], [90, '90 s'], [120, '2 min'], [180, '3 min'], [300, '5 min']] as [number, string][], s.dynamicTimer ? -1 : s.timer, (v) => lobby(v < 0 ? { a: 'settings', dynamicTimer: true } : { a: 'settings', timer: v, dynamicTimer: false })),
    s.dynamicTimer && h('div.lb-desc', {}, 'Each turn’s clock is set as it begins, Civilization VI’s way: longer as the eras pass and as the busiest player’s cities and units grow (from 30 seconds to 5 minutes).'),
    chips('At war', [[1, 'Take turns'], [0, 'All at once']] as [number, string][], s.hybridTurns === false ? 0 : 1, (v) => lobby({ a: 'settings', hybridTurns: v === 1 })),
    h('div.lb-desc', {}, s.hybridTurns === false ? 'Everyone plays at the same time, at war or not.' : 'People at war with each other take their turns one side at a time, Civilization V’s hybrid turns: everyone else plays at once.'),
    chips('Turns', TURN_CHOICES.map((n): [number, string] => [n, String(n)]), s.turnLimit, (v) => lobby({ a: 'settings', turnLimit: v })),
    chips('City-states', [[0, 'None'], [2, '2'], [4, '4'], [6, '6'], [8, '8'], [12, '12']] as [number, string][], s.cityStates, (v) => lobby({ a: 'settings', cityStates: v })),
    chips('Barbarians', [[1, 'On'], [0, 'Off']] as [number, string][], s.barbarians ? 1 : 0, (v) => lobby({ a: 'settings', barbarians: v === 1 })),
    // (Volcanoes, floods, storms and the rising sea: `rules/disasters.ts`.)
    chips('Disasters', [[1, 'On'], [0, 'Off']] as [number, string][], s.disasters ? 1 : 0, (v) => lobby({ a: 'settings', disasters: v === 1 })),
    h(
      'div.row',
      {},
      h('label', {}, 'Bots'),
      isHost && h('button.cv-btn.small', { onclick: () => lobby({ a: 'bots', count: bots - 1 }) }, '−'),
      h('b', { style: 'min-width:16px;text-align:center' }, String(bots)),
      isHost && h('button.cv-btn.small', { onclick: () => lobby({ a: 'bots', count: bots + 1 }) }, '+'),
      h('small.cv-muted', {}, `up to ${MAP_SIZES[s.size].players} players on this map`),
    ),
    seedRow(L, isHost, lobby),
    h('div.cv-label.sect', {}, 'Ways to win'),
    victoryCards(L, isHost, lobby),
    lobbyFoot(L, isHost, lobby),
  );
}

// -------------------------------------------------------------------------------------------------
// Top bar, research, notes, end turn, minimap
// -------------------------------------------------------------------------------------------------

const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** A number in the top bar: what it is (`note`, on its card) and its article (`pedia`). */
function stat(glyph: string, cls: string, value: string, delta: string | null, note: string, pedia: string): El {
  return h(`span.cv-stat.${cls}`, { 'data-pedia': pedia, 'data-note': note }, icon(glyph, 17), value, delta !== null && h('small', {}, delta));
}

function renderTop(): El {
  const v = store.view!;
  const s = v.self;
  const civ = CIVS[s.civ];
  const policyReady = s.culture >= s.policyCost;
  const pantheonReady = !s.pantheon && s.faith >= s.pantheonCost;
  const deciding = decisions().length;
  // (Anarchy, after a revolution: no gold, science, culture or faith while it lasts.)
  const none = (what: string) => (s.anarchy > 0 ? `\nAnarchy: no ${what} at all for ${s.anarchy} more turn${s.anarchy === 1 ? '' : 's'}` : '');
  // (`.fold`: on a small screen, in the menu instead; the menu's dot then says one of them wants a choice.)
  const menu = (panel: NonNullable<typeof store.panel>, glyph: string, title: string, dot = false, cls = '') =>
    h(`button${store.panel === panel ? '.on' : ''}${cls}`, { onclick: () => togglePanel(panel), title }, icon(glyph, 19), dot && h('span.dot'));
  return h(
    'div.cv-top.cv-panel',
    {},
    h('div.civ', {}, emblemEl(s.civ, 30), h('b', {}, civ?.name ?? '')),
    s.anarchy > 0 && h('span.cv-stat.y-anarchy', { 'data-note': `Anarchy after your revolution: no gold, science, culture or faith for ${s.anarchy} more turn${s.anarchy === 1 ? '' : 's'}`, 'data-pedia': 'concept:policies' }, icon('war', 16), `Anarchy: ${s.anarchy} turn${s.anarchy === 1 ? '' : 's'}`),
    stat('science', 'y-science', sign(s.science), null, `${sign(s.science)} science a turn${none('science')}`, 'concept:research'),
    stat('gold', 'y-gold', String(s.gold), sign(s.income), `${s.gold} gold, ${sign(s.income)} a turn${none('gold')}`, 'concept:gold'),
    stat(
      s.happiness < 0 ? 'unhappy' : 'happy',
      s.happiness < 0 ? 'y-sad' : 'y-happy',
      String(s.happiness),
      null,
      [`${s.happiness} happiness${s.happiness <= -10 ? ': your cities stop growing' : s.happiness < 0 ? ': your cities grow slowly' : ''}`, ...s.happinessParts.map((x) => `${sign(x.value)}  ${x.label}`)].join('\n'),
      'concept:happiness',
    ),
    stat('golden', 'y-golden', s.goldenTurns ? `${s.goldenTurns}` : `${s.goldenPoints}`, s.goldenTurns ? 'turns' : `/${s.goldenCost}`, s.goldenTurns ? `A golden age: ${s.goldenTurns} turns left` : `${s.goldenPoints} of ${s.goldenCost} toward a golden age`, 'concept:golden'),
    stat('culture', 'y-culture', `${s.culture}`, `/${s.policyCost} ${sign(s.culturePerTurn)}`, `${s.culture} of ${s.policyCost} culture toward the next social policy, ${sign(s.culturePerTurn)} a turn${none('culture')}`, 'concept:policies'),
    stat('faith', 'y-faith', `${s.faith}`, sign(s.faithPerTurn), `${s.faith} faith, ${sign(s.faithPerTurn)} a turn${none('faith')}`, 'concept:religion'),
    s.tourism > 0 && stat('tourism', 'y-tourism', String(s.tourism), null, `${s.tourism} tourism a turn`, 'concept:tourism'),
    ...Object.entries(s.strategic).map(([id, r]) => h('span.cv-stat', { 'data-pedia': `resource:${id}`, 'data-note': `${r.have - r.used} free of ${r.have}`, style: `color:${RESOURCES[id]?.color}` }, icon(resourceGlyph(id), 16), `${r.have - r.used}`)),
    h('span.spacer'),
    h('div.when', {}, h('b', {}, `${ERA_NAMES[ERAS[s.era]]}`), h('small', {}, `Turn ${v.turn} · ${year(v.turn)} · ${seasonName(v)}`)),
    h(
      'div.menu',
      {},
      menu('tech', 'science', 'Technology (T)', !s.researching),
      menu('policies', 'crown', 'Social policies (P)', policyReady),
      menu('religion', 'faith', 'Religion (R)', pantheonReady, '.fold'),
      menu('diplomacy', 'peace', 'Diplomacy'),
      v.congress && h(`button.fold${store.panel === 'diplomacy' && store.diplo.with === -3 ? '.on' : ''}`, { onclick: () => openCongress(), title: `World Congress: ${sessionWhen(v.congress, v.turn)}` }, icon('vote', 19), unvoted(v.congress).length > 0 && h('span.dot')),
      menu('espionage', 'trade', 'Trade routes & spies', false, '.fold'),
      menu('victory', 'golden', 'Victory (V)', false, '.fold'),
      h('span.sep'),
      menu('overview', 'chart', 'Overview: cities, units, demographics (O)', false, '.fold'),
      h(`button${store.panel === 'notes' ? '.on' : ''}`, { onclick: () => togglePanel('notes'), title: 'Notifications (N)' }, icon('bell', 19), deciding > 0 && h('span.count', {}, String(deciding))),
      menu('pedia', 'book', 'Civilopedia (F1)', false, '.fold'),
      menu('menu', 'menu', 'Menu (Esc)', pantheonReady, '.folds'),
    ),
  );
}

/** The yields lens on or off (Y). */
export function toggleLens() {
  setLens('yields');
  play('click', 0.5);
}

export function togglePanel(p: NonNullable<typeof store.panel>) {
  store.panel = store.panel === p ? null : p;
  if (store.panel) play('open', 0.7);
  store.changed++;
}

function renderResearch(): El {
  const s = store.view!.self;
  const t = s.researching ? TECHS[s.researching] : null;
  const cost = t ? s.techCosts[t.id] : 1;
  const have = t ? (s.research[t.id] ?? 0) : 0;
  const turns = t && s.researchScience > 0 ? Math.max(1, Math.ceil((cost - have) / s.researchScience)) : null;
  return h(
    `div.cv-research.cv-panel${t ? '' : '.none'}`,
    { onclick: () => togglePanel('tech'), 'data-pedia': t ? `tech:${t.id}` : 'concept:research' },
    t ? tile(techGlyph(t.id), ERA_COLOR[techEra(t.id)], 38) : tile('science', '#2f6fc0', 38),
    h(
      'div.cv-grow',
      {},
      h('div.cv-row', { style: 'justify-content:space-between' }, h('span.name', {}, t ? t.name : 'Choose research'), turns !== null && h('small.cv-muted', {}, `${turns} turn${turns === 1 ? '' : 's'}`)),
      h('div.cv-bar', {}, h('i', { style: `width:${t ? Math.round((have / cost) * 100) : 0}%` })),
      !t && h('small.cv-muted', {}, `${click(true)} to open the tech tree`),
      !t && researchHint() && h('div.adv-hint', {}, icon('lightbulb', 11, '#ffe48a'), researchHint()),
      // (On a team: the team's research, and whose choice it is.)
      t && s.researchBy !== null && h('small.cv-muted', {}, `Team research · ${researchChooser()}`),
    ),
  );
}

/** Who chose a team's research, in words ('chosen by Bo', 'your choice'). */
export function researchChooser(): string {
  const v = store.view!;
  const by = v.self.researchBy;
  return by === v.you ? 'your choice' : `chosen by ${v.players[by ?? -1]?.name ?? 'your team'}`;
}

/** '2 units need orders'. */
const needOrders = (n: number) => `${n} unit${n === 1 ? ' needs' : 's need'} orders`;

/** The unit the next-unit button (or Space) last went to, which of how many it was, and when: said by the corner a moment (ms). */
let cycled: { unit: number; i: number; n: number; at: number } | null = null;
const CYCLED_MS = 2500;

/** Whether a unit can be left to explore by itself (Explore, E): a soldier or a warship (not a great person, nor a work boat or cargo ship). */
/** Why a unit can't upgrade now, as the rules' `upgrade` order would refuse it (null: it can, or nothing to upgrade to). */
export function upgradeWhy(u: UnitWire): string | null {
  const up = u.upgrade;
  if (!up) return null;
  const s = store.view!.self;
  if (store.known[u.tile]?.owner !== me()) return 'Upgrade it in your own land';
  if (!u.moves) return 'It needs a move left to upgrade: next turn';
  const need = UNITS[up.to]?.resource;
  if (need && need !== UNITS[u.type]?.resource) {
    const r = s.strategic[need];
    if (!r || r.have - r.used <= 0) return `Upgrading needs ${RESOURCES[need]?.name ?? need}`;
  }
  if (s.gold < up.cost) return `It costs ${up.cost} gold (you have ${s.gold})`;
  return null;
}

export const explores = (u: UnitWire) => {
  const type = UNITS[u.type];
  return !!type && (type.domain === 'land' || type.domain === 'sea') && isMilitary(type) && !isGreatPerson(u.type);
};

/** Units that still want orders (not fortified, asleep, on sentry, at work, on their way, skipping the turn or left to themselves). */
export function idleUnits() {
  const v = store.view;
  if (!v) return [];
  return v.units.filter((u) => u.owner === v.you && (u.moves ?? 0) > 0 && !u.stance && !u.work && !u.path?.length && !u.skip && !u.auto);
}

/** The next unit that wants orders (or, `step` -1, the one before), selected and looked at. */
export function selectNextIdle(step = 1) {
  const idle = idleUnits();
  if (!idle.length) return false;
  const at = idle.findIndex((u) => u.id === store.selectedUnit);
  const i = at < 0 ? (step > 0 ? 0 : idle.length - 1) : (at + step + idle.length) % idle.length;
  const u = idle[i];
  store.selectedUnit = u.id;
  store.selectedCity = null;
  const c = centre(store.grid!, u.tile);
  lookAt(c.x, c.z);
  cycled = { unit: u.id, i, n: idle.length, at: performance.now() };
  setTimeout(() => store.changed++, CYCLED_MS + 50);
  store.changed++;
  return true;
}

/** A city the end-turn button opened for want of something to build: once it has something, it closes (and the turn's next need shows). */
let askedToBuild: number | null = null;

/** Before the first city: the Settler that founds it (the first thing to do), if there's one. */
export function foundingSettler(): UnitWire | undefined {
  const v = store.view;
  if (!v || v.cities.some((c) => c.owner === v.you)) return undefined;
  return v.units.find((u) => u.owner === v.you && UNITS[u.type]?.abilities?.includes('found_city'));
}

/** A unit of yours selected, and looked at. */
export function selectUnitAt(id: number, at: number) {
  store.selectedUnit = id;
  store.selectedCity = null;
  if (store.grid) {
    const c = centre(store.grid, at);
    lookAt(c.x, c.z);
  }
  store.changed++;
}

export function endTurnAction() {
  const v = store.view;
  if (v?.over && store.overHidden) {
    store.overHidden = false;
    store.changed++;
  }
  if (!v || v.over || v.spectator) return;
  const s = v.self;
  // (At war with another person, between your side's segments: nothing to end or take back.)
  if (sequenceWait(v)) return;
  if (s.ready) return send({ t: 'ready', ready: false });
  // (No city yet: the turn ends all the same, as Civ V's; a Settler may walk to a better site first.)
  const block = s.blockers[0];
  if (block) {
    if (block.text === 'Choose research') store.panel = 'tech';
    else if (block.text === 'Choose a policy') store.panel = 'policies';
    else if (block.text === 'Choose a free great person') store.panel = 'great';
    else if (block.text === 'Choose a Reformation belief') store.panel = 'religion';
    else if (block.at !== undefined) {
      const city = cityAt(block.at);
      if (city) {
        openCity(city.id);
        askedToBuild = city.id;
      }
    }
    store.changed++;
    return;
  }
  send({ t: 'ready', ready: true });
}

/**
 * People at war with each other take their turns one side at a time (`rules/turns.ts`): whom the
 * viewer waits on (their side's segment yet to come, or played), or null (theirs now, or not at war with a person).
 */
function sequenceWait(v: View): { names: string; done: boolean } | null {
  const q = v.sequence;
  if (!q) return null;
  const mine = q.sides.findIndex((x) => x.includes(v.you));
  if (mine < 0 || mine === q.at) return null;
  const names = q.sides[q.at].map((i) => (i === v.you ? 'you' : v.players[i]?.name ?? 'another')).join(' and ');
  return { names, done: mine < q.at };
}

/** Whether it's the viewer's side's segment now, with people at war taking their turns in order. */
export const sequenceMine = (v: View) => !!v.sequence?.sides[v.sequence.at]?.includes(v.you);

function renderCorner(now: number): El {
  const v = store.view!;
  const s = v.self;
  // The people playing (those away count as done), and those still deciding: named, when only a few.
  const seated = v.players.filter((p) => p.alive && !p.bot && !p.cityState && p.civ !== 'barbarian');
  const people = seated.filter((p) => p.here !== false);
  const deciding = people.filter((p) => !p.ready && p.index !== v.you);
  const waiting = deciding.length;
  const awaited = waiting <= 2 ? deciding.map((p) => p.name).join(' and ') : `${waiting} players`;
  const idle = idleUnits().length;
  let label = 'End turn';
  let sub = '';
  let cls = 'gold';
  let glyph = 'moves';
  if (v.over) {
    label = store.overHidden ? 'Results' : 'Game over';
    cls = store.overHidden ? 'gold' : 'wait';
    glyph = 'golden';
  } else if (v.spectator) {
    label = 'Watching';
    cls = 'wait';
    glyph = 'globe';
    sub = waiting ? `${awaited} still deciding` : '';
  } else if (sequenceWait(v)) {
    // At war with another person: their side plays its segment, then (if yours is to come) yours.
    const w = sequenceWait(v)!;
    label = w.done ? 'Turn over' : 'Their turn';
    sub = w.done ? `${w.names} ${w.names.includes(' and ') ? 'are' : 'is'} taking their turn` : `${w.names} first (at war: turns in order)`;
    cls = 'wait';
    glyph = 'war';
  } else if (s.ready) {
    label = 'Waiting…';
    sub = waiting ? `for ${awaited} · ${click()} to take back` : 'the turn is ending';
    cls = 'wait';
    glyph = 'turn';
  } else if (s.blockers.length) {
    label = s.blockers[0].text;
    sub = 'needed before the turn ends';
    cls = 'need';
    glyph = 'info';
  } else if (foundingSettler()) {
    // (A reminder, not a demand: the turn can end before the capital's founded.)
    sub = 'your capital isn’t founded yet';
  } else if (idle) {
    sub = `${needOrders(idle)}${touchScreen() ? '' : ' (Space)'}`;
  }
  // (Your side's segment, with people at war taking turns in order: the others at war wait on you.)
  const q = v.sequence;
  if (!v.over && !v.spectator && !s.ready && q && sequenceMine(v) && q.sides.length > 1) {
    // (A side at war with you still to move after yours, or every one of them done.)
    const after = q.at < q.sides.length - 1;
    sub = sub ? `${after ? 'your move, then theirs' : 'your move: theirs is done'} · ${sub}` : after ? 'your move: those at war with you wait' : 'your move: those at war have moved';
  }
  const left = timerLeft(now);
  // (The clock first: the line may be cut short.)
  if (left !== null && !v.over) sub = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left${sub ? ` · ${sub}` : ''}`;
  if (left !== null && left <= 10 && !v.over && !s.ready && !v.spectator) cls += '.hurry';
  const map = h('canvas', { width: '270', height: '150' }) as HTMLCanvasElement;
  drawMinimap(map);
  map.addEventListener('click', (e) => {
    e.stopPropagation();
    const g = store.grid;
    if (!g) return;
    const r = map.getBoundingClientRect();
    const col = (Math.floor(((e.clientX - r.left) / r.width) * g.width) + miniFirst(g)) % g.width;
    const row = Math.floor(((e.clientY - r.top) / r.height) * g.height);
    const c = centre(g, Math.max(0, Math.min(g.width * g.height - 1, row * g.width + col)));
    lookAt(c.x, c.z);
  });
  // With other people in the game: who's done (a tick), who's still deciding, and who's away.
  const roster =
    seated.length > 1 && !v.over
      ? h(
          'div.cv-roster.cv-panel',
          {},
          ...seated.map((p) => {
            const away = p.here === false;
            const done = p.ready && !away;
            return h(
              `div.who${away ? '.away' : done ? '.done' : ''}`,
              { title: `${p.name}: ${away ? 'away (their turn counts as done, their units wait)' : done ? 'done' : 'still deciding'}` },
              h(`span${done ? '.done' : ''}`, {}, emblemEl(p.civ, 20), done && h('i', { html: svg('check', 10, '#fff') })),
              h('b', {}, p.index === v.you ? 'You' : p.name),
              typeof p.team === 'number' && teamMark(p.team),
              away && h('small', {}, 'away'),
            );
          }),
        )
      : null;
  // A finger's first tap on a tile shows the way there; this says what the second does.
  const tapped = store.tap && store.tap.unit === store.selectedUnit ? myUnit(store.selectedUnit) : null;
  const tapHint = tapped
    ? h('div.cv-taphint', {}, icon(enemyAt(store.tap!.tile) ? 'war' : 'moves', 14), enemyAt(store.tap!.tile) ? 'Tap it again to attack' : 'Tap the tile again to go there')
    : null;
  // The next unit wanting orders (Space), for a finger as much as a mouse: what the count is, on hover; which of them it went to, a moment after.
  const next = idle && !v.over && !v.spectator ? h('button.cv-next.cv-btn', { onclick: () => selectNextIdle(), title: `${needOrders(idle)}: ${click()} to go to each in turn${touchScreen() ? '' : ' (Space; comma for the one before)'}` }, icon('moves', 18), h('b', {}, String(idle))) : null;
  const went = cycled && cycled.unit === store.selectedUnit && performance.now() - cycled.at < CYCLED_MS ? myUnit(cycled.unit) : undefined;
  const nextHint = went && cycled ? h('div.cv-taphint', {}, icon('moves', 14), `${UNITS[went.type]?.name ?? 'Unit'}: ${cycled.i + 1} of ${cycled.n} needing orders`) : null;
  return h(
    'div.cv-corner',
    {},
    roster,
    tapHint ?? nextHint,
    renderPinList(),
    lensKey(),
    h('div.cv-minimap.cv-panel', {}, map, lensBar(), pinsButton()),
    h('div.cv-endrow', {}, next, h(`button.cv-endturn.cv-btn.${cls}`, { onclick: () => endTurnAction() }, icon(glyph, 22), h('div', {}, h('div.t', {}, label), sub && h('small', {}, sub)))),
  );
}

const MINI: Record<string, string> = { grassland: '#5a9a3a', plains: '#a8a44a', desert: '#e8d49a', tundra: '#8a9a7a', snow: '#f4f8fa', coast: '#4a8ac0', ocean: '#1e3a5a', lake: '#4a8ac0' };

/**
 * On a world that wraps, the column the minimap starts at: the one that puts your capital (or before
 * it, your first unit) in its middle. On a flat one, the first.
 */
function miniFirst(g: Grid): number {
  if (!g.wrap) return 0;
  const v = store.view;
  const home = v?.cities.find((c) => c.owner === me() && c.capital)?.tile ?? v?.units.find((u) => u.owner === me())?.tile;
  return home === undefined ? 0 : ((home % g.width) - Math.floor(g.width / 2) + g.width) % g.width;
}

function drawMinimap(cv: HTMLCanvasElement) {
  const g = store.grid;
  if (!g) return;
  const ctx = cv.getContext('2d')!;
  const cw = cv.width / g.width;
  const ch = cv.height / g.height;
  // (Round a world that wraps, each column drawn where it falls from the minimap's first.)
  const first = miniFirst(g);
  const colOf = (col: number) => (col - first + g.width) % g.width;
  ctx.fillStyle = '#0b0f16';
  ctx.fillRect(0, 0, cv.width, cv.height);
  for (let t = 0; t < g.width * g.height; t++) {
    const k = store.known[t];
    if (!k) continue;
    const s = store.terrain[t];
    const col = colOf(t % g.width);
    const row = Math.floor(t / g.width);
    ctx.fillStyle = k.owner >= 0 ? (CIVS[store.view!.players[k.owner]?.civ]?.color ?? '#888') : k.wonder ? (NATURAL_WONDERS[k.wonder]?.color ?? '#f2c14e') : s.elevation === 'mountain' ? '#8a8a8c' : MINI[s.terrain];
    ctx.globalAlpha = k.visible ? 1 : 0.55;
    ctx.fillRect(col * cw + (row & 1 ? cw / 2 : 0), row * ch, Math.ceil(cw), Math.ceil(ch));
  }
  ctx.globalAlpha = 1;
  for (const c of store.view!.cities) {
    const col = colOf(c.tile % g.width);
    const row = Math.floor(c.tile / g.width);
    ctx.fillStyle = '#fff';
    ctx.fillRect(col * cw + (row & 1 ? cw / 2 : 0) - 1, row * ch - 1, 4, 4);
  }
  // Map pins: a dot each in its icon's colour.
  for (const p of store.view!.pins) {
    const col = colOf(p.tile % g.width);
    const row = Math.floor(p.tile / g.width);
    const x = Math.round(col * cw + (row & 1 ? cw / 2 : 0));
    const y = Math.round(row * ch);
    ctx.fillStyle = '#07090c';
    ctx.fillRect(x - 2, y - 2, 7, 7);
    ctx.fillStyle = pinColor(p);
    ctx.fillRect(x - 1, y - 1, 5, 5);
  }
}

// -------------------------------------------------------------------------------------------------
// The selected unit
// -------------------------------------------------------------------------------------------------

/** Improvements a worker might build on its tile, and what each does there (the server checks it can). */
function buildOptions(t: number): { what: string; name: string; does: string }[] {
  const v = store.view!;
  const techs = new Set(v.self.techs);
  const s = store.terrain[t];
  const k = store.known[t];
  // (Nothing's built on a natural wonder, not even a road.)
  if (!s || !k || k.wonder) return [];
  const out: { what: string; name: string; does: string }[] = [];
  // (No road on the water: an embarked worker builds none, as the rules' `canBuild` has it.)
  if (!k.road && techs.has('the_wheel') && !TERRAINS[s.terrain].water) out.push({ what: 'road', name: 'Road', does: 'Faster moves, and a link from a city to your capital' });
  if (k.road === 'road' && techs.has('railroad')) out.push({ what: 'rail', name: 'Railroad', does: 'Much faster moves' });
  // (Under fallout: only scrubbing it away, Civ V's; nothing's built or mended there till it's gone.)
  if (s.feature === 'fallout') {
    if (!cityAt(t)) out.push({ what: 'scrub_fallout', name: 'Scrub Fallout', does: 'Clean up the fallout: the tile yields again, stops hurting units on it, and can be improved' });
    return out;
  }
  if (k.pillaged) out.push({ what: 'repair', name: 'Repair', does: 'Mend what was pillaged here: its yields come back' });
  if (k.owner !== v.you || cityAt(t)) return out;
  for (const [id, imp] of Object.entries(IMPROVEMENTS) as [ImprovementId, (typeof IMPROVEMENTS)[ImprovementId]][]) {
    if (imp.great || (imp.tech && !techs.has(imp.tech)) || k.improvement === id || cleared(id, t)) continue;
    const res = k.resource && tapsWith({ resource: k.resource, terrain: s.terrain }) === id ? RESOURCES[k.resource] : undefined;
    const gain = yieldWords(addYields(imp.yields, res?.improved ?? {}));
    if (imp.on.includes('resource') ? res : fitsLand(id, t) || res) out.push({ what: id, name: imp.name, does: `${imp.name}: ${gain || 'no yields of its own'} here${res ? ` (with the ${res.name}${res.kind === 'bonus' ? '' : `: your empire gets the ${res.name}`})` : ''}` });
  }
  if (s.feature && FEATURES[s.feature].removable && techs.has(FEATURES[s.feature].removable!.tech)) out.push({ what: 'remove_feature', name: `Clear ${FEATURES[s.feature].name}`, does: `Clear the ${FEATURES[s.feature].name}${FEATURES[s.feature].removable!.prod ? ': its wood is production for the nearest city' : ''}` });
  return out;
}

/** Whether an improvement can stand on a tile's land (its terrain, feature or hills; not counting a resource). */
const fitsLand = (id: ImprovementId, t: number) => {
  const s = store.terrain[t];
  return !!s && IMPROVEMENTS[id].on.some((on) => on === s.terrain || on === s.feature || on === s.elevation || on === 'any_land');
};

/** Whether a farm, mine or trading post waits for a tile's forest, jungle or marsh to be cleared (as the rules have it: not on a resource it taps). */
const cleared = (id: ImprovementId, t: number) => {
  const s = store.terrain[t];
  const res = store.known[t]?.resource;
  return (id === 'farm' || id === 'trading_post' || id === 'mine') && !!s?.feature && ['forest', 'jungle', 'marsh'].includes(s.feature) && !(res && tapsWith({ resource: res, terrain: s.terrain }) === id);
};

/**
 * Improvements a worker can't build where it stands that a player might look for there, and why
 * (too early, a forest to clear first, only on a resource), shown greyed on its card: so a Quarry
 * missing from hills says it's only for Stone or Marble.
 */
function buildBlocked(t: number): { what: ImprovementId; name: string; why: string }[] {
  const v = store.view!;
  const techs = new Set(v.self.techs);
  const s = store.terrain[t];
  const k = store.known[t];
  if (!s || !k || k.wonder || k.owner !== v.you || cityAt(t) || TERRAINS[s.terrain].water) return [];
  const out: { what: ImprovementId; name: string; why: string }[] = [];
  for (const [id, imp] of Object.entries(IMPROVEMENTS) as [ImprovementId, (typeof IMPROVEMENTS)[ImprovementId]][]) {
    if (imp.great || k.improvement === id || id === 'fort') continue;
    const res = !!k.resource && tapsWith({ resource: k.resource, terrain: s.terrain }) === id;
    const place = !imp.on.includes('resource') && fitsLand(id, t);
    if (res || place) {
      if (s.feature === 'fallout') out.push({ what: id, name: imp.name, why: 'scrub the Fallout first' });
      else if (imp.tech && !techs.has(imp.tech)) out.push({ what: id, name: imp.name, why: `needs ${TECHS[imp.tech]?.name ?? imp.tech}` });
      else if (cleared(id, t)) out.push({ what: id, name: imp.name, why: `clear the ${FEATURES[s.feature as FeatureId]?.name ?? 'forest'} first` });
    } else if (id === 'quarry' && s.elevation === 'hills') {
      const on = Object.values(RESOURCES).filter((r) => r.improvement === 'quarry').map((r) => r.name);
      out.push({ what: id, name: imp.name, why: `only on ${on.join(' or ')} (hills take a Mine)` });
    }
  }
  return out;
}

/** Why a work boat on a sea resource can't build its fishing boats or offshore platform there: not in your waters, or the tech not known. */
function seaBlocked(t: number): { what: ImprovementId; name: string; why: string }[] {
  const v = store.view!;
  const k = store.known[t];
  const s = store.terrain[t];
  const what = k?.resource && s ? tapsWith({ resource: k.resource, terrain: s.terrain }) : undefined;
  if (!k || !what || !SEA_WORK.includes(what) || k.improvement === what) return [];
  const imp = IMPROVEMENTS[what];
  if (imp.tech && !v.self.techs.includes(imp.tech)) return [{ what, name: imp.name, why: `needs ${TECHS[imp.tech]?.name ?? imp.tech}` }];
  if (k.owner === v.you) return [];
  return [{ what, name: imp.name, why: k.owner >= 0 ? `only in your own waters (these are ${v.players[k.owner]?.name ?? 'another civ'}'s)` : 'only in your own waters: your borders must reach it first' }];
}

export const BUILD_GLYPH: Record<string, string> = {
  road: 'trade', rail: 'rail', repair: 'hammer', farm: 'wheat', mine: 'pick', pasture: 'cattle', camp: 'deer', plantation: 'leaf', quarry: 'stone',
  trading_post: 'gold', lumber_mill: 'hammer', fishing_boats: 'fish', oil_well: 'oil', offshore_platform: 'oil', fort: 'shield', remove_feature: 'axe', scrub_fallout: 'drop',
};

/** The selected unit's card's line for where the mouse is (how many turns to get there), kept current every frame. */
let arrival: El | null = null;

function renderUnit(): El | null {
  const u = myUnit(store.selectedUnit);
  arrival = null;
  if (!u) return null;
  const type = UNITS[u.type];
  const civ = CIVS[store.view!.self.civ];
  const acts: El[] = [];
  // (`pedia`: its hover card, the article's, with what it does, or why not, as the card's note: such a
  // button can't be off the browser's way, which shows a disabled button no card, so it's only made to look off.)
  const act = (label: string, o: Order | (() => void), title?: string, glyph?: string, cls = '', disabled = false, pedia?: string) =>
    acts.push(
      h(
        `button.cv-btn.small${cls}${disabled && pedia ? '.off' : ''}`,
        { onclick: disabled ? undefined : () => (typeof o === 'function' ? o() : send(o)), title: pedia ? undefined : title, 'data-pedia': pedia, 'data-note': pedia ? title : undefined, disabled: disabled && !pedia, 'aria-disabled': disabled ? 'true' : undefined },
        glyph && icon(glyph, 14),
        label,
      ),
    );
  if (type.abilities?.includes('found_city')) act('Found city', { t: 'found', unit: u.id }, 'Found a city here (B)', 'city', '.gold');
  // Leaving it to itself: a worker improves the land, a soldier or a warship explores; either until told otherwise.
  if (u.auto) act('Stop automating', { t: 'automate', unit: u.id, mode: null }, 'Take it back: it waits for your orders again', 'close', '.gold');
  else if (type.abilities?.includes('build') || type.abilities?.includes('build_sea')) act('Automate', { t: 'automate', unit: u.id, mode: 'work' }, 'Let it improve your land by itself each turn (E): luxuries and resources first, then the tiles your cities work, then roads', 'gear');
  else if (explores(u)) act('Explore', { t: 'automate', unit: u.id, mode: 'explore' }, `Let it explore by itself each turn, until there is nothing left to see${type.domain === 'sea' ? ' on the seas' : ''}; then it heads home (E)`, 'compass');
  // (The advisor's recommended work here, if any, in gold: `workadvice.ts`.)
  const advised = workTip(u.tile);
  // (A work boat builds fishing boats, or an offshore platform on Oil, on a sea resource in your waters, and is spent doing it.)
  const sea = !type.abilities?.includes('build') && !!type.abilities?.includes('build_sea');
  const builds = type.abilities?.includes('build') ? buildOptions(u.tile) : sea ? buildOptions(u.tile).filter((b) => SEA_WORK.includes(b.what)).map((b) => ({ ...b, does: `${b.does}. The ${type.name} is spent building it` })) : [];
  for (const b of builds) act(b.name, { t: 'build', unit: u.id, what: b.what as never }, advised?.what === b.what ? `Advised: ${advised.why}. ${b.does}` : b.does, BUILD_GLYPH[b.what] ?? 'hammer', advised?.what === b.what || sea ? '.gold' : '');
  const blocked = type.abilities?.includes('build') ? buildBlocked(u.tile) : sea ? seaBlocked(u.tile) : [];
  // (Why the advisor marks no work for it, when it marks none.)
  const quiet = workQuiet();
  if (u.pillage) act('Pillage', { t: 'pillage', unit: u.id }, 'Pillage what stands here: gold, and it heals; the land yields nothing until a worker repairs it', 'axe');
  // By air: a paratrooper's drop, an airlift between airports; the next click on the map says where.
  const aim = (order: 'paradrop' | 'airlift') => () => {
    store.unitAim = store.unitAim?.unit === u.id && store.unitAim.order === order ? null : { unit: u.id, order };
    store.changed++;
  };
  const city = cityAt(u.tile);
  if (type.abilities?.includes('paradrop')) act('Paradrop', aim('paradrop'), `Drop it on empty land you know, within ${PARADROP_RANGE} tiles (from your own land, before it moves)`, 'plane', store.unitAim?.unit === u.id ? '.gold' : '');
  if (type.domain === 'land' && city?.owner === me() && city.buildings?.includes('airport')) act('Airlift', aim('airlift'), 'Fly it to another of your cities with an airport (before it moves)', 'jet', store.unitAim?.unit === u.id ? '.gold' : '');
  // A soldier in (or next to) a friendly city-state's land can be given to it, for influence.
  const cs = [u.tile, ...neighbours(store.grid!, u.tile)].map((t) => store.view!.players[store.known[t]?.owner ?? -1]).find((p) => p?.cityState && !p.war);
  // (Not with another unit on its tile, as the rules' `giftUnit` has it.)
  const stacked = unitsAt(u.tile).some((x) => x.id !== u.id);
  if (cs && isMilitary(type) && !city) act(`Gift to ${cs.name}`, () => ask(`Give this ${type.name} to ${cs.name}? It becomes theirs, for influence with them.`, 'Give it', () => send({ t: 'giftUnit', unit: u.id, target: cs.index }), false), stacked ? 'Not with another unit on its tile: move one off first' : undefined, 'peace', '', stacked);
  // A fighter on patrol intercepts enemy aircraft striking within its range.
  if (type.class === 'fighter') {
    if (u.stance === 'alert') act('Stop patrolling', { t: 'stance', unit: u.id, stance: 'wake' }, 'It stops intercepting', 'close');
    else act('Patrol', { t: 'stance', unit: u.id, stance: 'alert' }, `On patrol it intercepts enemy aircraft striking within ${reachOf(u)} tiles (once a turn)`, 'shield');
  } else if (canFortify(type)) {
    act('Fortify', { t: 'stance', unit: u.id, stance: 'fortify' }, 'Fortify (F): stronger in defence', 'shield');
    if (type.abilities?.includes('must_setup') && !u.setUp) act('Set up', { t: 'setup', unit: u.id }, undefined, 'cannon');
  }
  const extras = unitExtras(u, (label, o, title, more) => act(label, o, more?.why ?? title, undefined, '', !!more?.why, more?.pedia));
  act('Sleep', { t: 'stance', unit: u.id, stance: 'sleep' }, 'Sleep (Z): skipped until woken', 'turn');
  act('Skip', { t: 'skip', unit: u.id }, 'Skip this turn', 'moves');
  if (u.path?.length) act('Stop', { t: 'stance', unit: u.id, stance: 'wake' }, 'Stop its journey', 'close');
  if (u.upgrade) {
    const why = upgradeWhy(u);
    act(`Upgrade to ${UNITS[u.upgrade.to]?.name ?? u.upgrade.to} · ${u.upgrade.cost}`, { t: 'upgrade', unit: u.id }, why ?? `${u.upgrade.cost} gold: ${describe('unit', u.upgrade.to)}`, 'xp', '', !!why);
  }
  act('Disband', () => ask(`Disband this ${type.name}? It's gone for good.`, 'Disband', () => send({ t: 'disband', unit: u.id })), undefined, 'close', '.danger');
  const hint = store.group.length
    ? 'Shift-click more of your units to add them, or shift-drag a box round them (shift-click one in the group to take it out).'
    : store.unitAim?.unit === u.id
    ? `${click(true)} where it should ${store.unitAim.order === 'paradrop' ? 'land' : 'fly to'}${touchScreen() ? '.' : ' (Esc to change your mind).'}`
    : u.auto === 'work'
    ? 'Automated: it improves your land by itself each turn. Any order takes it back.'
    : u.auto === 'explore'
      ? 'Exploring by itself each turn. Any order takes it back.'
      : type.abilities?.includes('found_city')
    ? 'Move to good land (rivers, coast, food), then found a city.'
    : type.abilities?.includes('build')
      ? 'Improve tiles your cities work: farms, mines, roads.'
      : type.abilities?.includes('combat_bonus_aura')
        ? `${ABILITY_TEXT.combat_bonus_aura} Keep it with your army (it can share a tile with a soldier), out of the enemy's reach.`
      : type.domain === 'air'
        ? `${click(true)} an enemy within ${reachOf(u)} tiles to strike it (they're ringed in red), or one of your cities or carriers within ${reachOf(u) * 2} to rebase there. Fighters and anti-aircraft guns near a target may intercept.`
      : type.ranged
        ? `Enemies in reach are ringed in red: ${touchScreen() ? 'tap one to see how a shot would go, tap it again to fire' : 'point at one to see how a shot would go, click to fire'}.`
        : type.strength
          ? `Enemies next to it are ringed in red: ${touchScreen() ? 'tap one to see how the fight would go, tap it again to attack' : 'point at one to see how the fight would go, click to attack'}.`
          : '';
  const hpColour = u.hp > 50 ? 'green' : u.hp > 25 ? 'gold' : 'red';
  const role = ['civilian', 'great', 'trade', 'religious'].includes(type.class) ? '' : type.class.replace('_', ' ');
  arrival = h('div.arrive', {});
  return h(
    'div.cv-unit.cv-panel.cv-in',
    {},
    h('button.cv-x', { onclick: () => ((store.selectedUnit = null), store.changed++), title: 'Deselect (Esc)', html: svg('close', 15) }),
    h(
      'div.top',
      {},
      h('div', { 'data-pedia': `unit:${u.type}` }, pic(unitModel(u.type), 66)),
      h(
        'div.cv-grow',
        {},
        h('div.cv-row', { style: 'gap:6px' }, h('span.cv-h', {}, type.name), emblemEl(store.view!.self.civ, 18)),
        h('small.cv-muted', { style: 'text-transform:capitalize' }, `${civ?.adjective ?? ''} ${role}`),
        h(
          'div.cv-ustats',
          {},
          type.strength ? h('span', { title: 'Strength' }, icon('strength', 14, '#f0a24a'), h('b', {}, String(type.strength))) : null,
          type.ranged ? h('span', { title: 'Ranged strength · range' }, icon('ranged', 14, '#6ab8ff'), h('b', {}, `${type.ranged}`), ` · ${reachOf(u)}`) : null,
          h('span', { title: 'Moves' }, icon('moves', 14, '#7bd16a'), h('b', {}, `${Math.round((u.moves ?? 0) * 10) / 10}/${u.maxMoves ?? type.moves}`)),
          u.xp ? h('span', { title: 'Experience' }, icon('xp', 14, '#f2c14e'), h('b', {}, String(u.xp))) : null,
          u.work ? h('span', {}, icon('hammer', 14), h('b', {}, `${u.work.turns} turn${u.work.turns === 1 ? '' : 's'}`)) : null,
        ),
      ),
    ),
    h('div', { style: 'display:flex;align-items:center;gap:8px' }, icon('hp', 14, '#ff8a7a'), h(`div.cv-bar.${hpColour}.cv-grow`, {}, h('i', { style: `width:${u.hp}%` })), h('small.cv-muted', {}, `${u.hp}`)),
    // (Aircraft aren't attacked where they're based.)
    u.defence &&
      type.domain !== 'air' &&
      h(
        'div.cv-defence',
        { title: 'Its strength if attacked where it stands, and what changes it' },
        icon('shield', 14, '#9fc4e8'),
        h('span', {}, 'Defending here ', h('b', {}, u.defence.strength.toFixed(1))),
        ...u.defence.mods.map((m) => h(`span.cv-mod.${m.percent > 0 ? 'up' : 'down'}`, {}, `${m.percent > 0 ? '+' : ''}${Math.round(m.percent)}% ${m.label}`)),
      ),
    // (Standing where an enemy city's walls reach: they fire at it each turn, fortified or not.)
    isMilitary(type) && type.domain !== 'air' && wallsOver(u.tile) && h('div.going.danger', {}, icon('war', 14, '#e0604a'), h('span', {}, `In range of ${wallsOver(u.tile)!.name}'s walls: they fire at it each turn`)),
    // Its orders: where it's going, and when it gets there; the units gathered with it.
    u.path?.length ? h('div.going', {}, icon('moves', 14, '#ffd23a'), h('span', {}, `Moving to ${placeName(u.path[u.path.length - 1])} · ${arrives(routeOf(u))}${marching(u.id) ? ' (with its group, at the pace of the slowest)' : ''}`)) : null,
    // (One of a march that's ahead waits a turn for the slowest, with no way of its own to show.)
    !u.path?.length &&
      marchOf(u.id) &&
      h(
        'div.going',
        {},
        icon('moves', 14, '#ffd23a'),
        h('span', {}, marchOf(u.id)!.to === u.tile ? `There with its group: waits for the other ${marchOf(u.id)!.others}` : `Marching to ${placeName(marchOf(u.id)!.to)} with ${marchOf(u.id)!.others} more: waits this turn for the slowest`),
      ),
    store.group.length > 0 &&
      h(
        'div.going',
        {},
        icon('people', 14, '#ffd23a'),
        h('span.cv-grow', {}, `With ${store.group.length} more: click a tile to send them all, to arrive together`),
        h('button.cv-btn.small', { onclick: () => ((store.group = []), store.changed++), title: 'Break up the group' }, icon('close', 12)),
      ),
    // (The way to the tile under the mouse above the buttons: the card stands on the screen's foot, so
    // as it comes and goes, when the mouse leaves the map for them, they stay where they are.)
    arrival,
    h('div.acts', {}, ...acts),
    blocked.length > 0 && h('div.cv-blocked', {}, ...blocked.map((b) => h('div', { 'data-pedia': `improvement:${b.what}` }, icon(BUILD_GLYPH[b.what] ?? 'hammer', 13), h('span', {}, h('b', {}, b.name), `: ${b.why}`)))),
    quiet && h('div.cv-blocked', {}, h('div', {}, icon('lightbulb', 13, '#f2c14e'), h('span', {}, quiet))),
    ...extras,
    hint && h('div.hint', {}, hint),
  );
}

/** A tile as a place: a city's name, else its land and the nearest city ('the Hills near Dortmund'). */
function placeName(t: number): string {
  const g = store.grid;
  const s = store.terrain[t];
  const city = cityAt(t);
  if (city) return city.name;
  if (!g || !s) return 'a tile';
  const land = s.elevation === 'mountain' ? 'the mountains' : `the ${s.feature ? FEATURES[s.feature].name : s.elevation === 'hills' ? 'Hills' : TERRAINS[s.terrain].name}`;
  const near = store.view?.cities.filter((c) => store.known[c.tile]).sort((a, b) => distance(g, a.tile, t) - distance(g, b.tile, t))[0];
  return near && distance(g, near.tile, t) <= 5 ? `${land} near ${near.name}` : land;
}

/** When a unit on its way arrives, counted as the map's turn markers count (this turn the first). */
function arrives(route: Route | null): string {
  const k = route ? route.turns[route.turns.length - 1] + 1 : 1;
  return k <= 1 ? 'arrives this turn' : `${k} turns to get there`;
}

/** How long a route takes, counting this turn as the first (as the map's turn markers do). */
const wayThere = (route: Route, u?: UnitWire) => {
  const turns = route.turns[route.turns.length - 1] + 1;
  const to = route.tiles[route.tiles.length - 1];
  // Next to one of its own of its kind: the two swap places.
  const other = u && swapsWith(u, to);
  if (other) return `Swaps places with your ${UNITS[other.type]?.name ?? 'unit'}`;
  // Onto an enemy's civilian alone: a soldier takes it as it steps there.
  const v = store.view!;
  const foes = unitsAt(to).filter((x) => x.owner !== me() && v.players[x.owner]?.war);
  if (u && foes.length && !cityAt(to) && foes.every((x) => !isMilitary(UNITS[x.type])) && isMilitary(UNITS[u.type])) {
    const what = `${takenAlive(foes[0].type) ? 'captures' : 'kills'} the ${UNITS[foes[0].type]?.name ?? 'unit'}`;
    return `${turns === 1 ? 'Gets there this turn' : `${turns} turns to get there`} and ${what}`;
  }
  // Toward an enemy: whether it can attack it this turn (a ranged unit in reach is shown its preview instead).
  if (u && enemyAt(to) && isMilitary(UNITS[u.type])) {
    if (UNITS[u.type]?.ranged) return `${outOfReach(u, to)}: it moves toward it`;
    return chargeFrom(u, to, route) !== null ? 'Goes next to it and attacks, this turn' : "Can't reach it to attack this turn: it moves toward it";
  }
  return turns === 1 ? 'Gets there this turn' : `${turns} turns to get there`;
};

/** A soldier's way that ends a turn under an enemy city's walls (they fire on it): whose, in a few words. */
const wallsOnWay = (route: Route, u: UnitWire): string | null => {
  const type = UNITS[u.type];
  if (!type || !isMilitary(type) || type.domain === 'air') return null;
  const stops = route.tiles.filter((_, i) => i === route.tiles.length - 1 || route.turns[i + 1] !== route.turns[i]);
  const walls = stops.map(wallsOver).find((c) => !!c);
  return walls ? `Ends a turn in range of ${walls.name}'s walls` : null;
};

/** The selected unit's card's line for the tile under the mouse: how long it would take to get there. */
function renderArrival() {
  if (!arrival) return;
  const u = myUnit(store.selectedUnit);
  const t = store.hover;
  let text = '';
  let cls = '';
  if (u && t >= 0 && t !== u.tile && store.known[t]) {
    const route = attackable(u, t) ? undefined : previewPath(u, t);
    if (route === null) [text, cls] = [whyNot(u, t), 'no'];
    else if (route) text = [wayThere(route, u), wallsOnWay(route, u)].filter(Boolean).join(' · ');
  }
  if (arrival.textContent !== text) {
    arrival.textContent = text;
    arrival.className = `arrive${cls ? ` ${cls}` : ''}`;
  }
}

// -------------------------------------------------------------------------------------------------
// A city's screen
// -------------------------------------------------------------------------------------------------

/** Ask the server what a city could build and buy now (its answer lands in `store.cityInfo`). */
export function askCity(id: number) {
  client.send('city', { id });
}

export function openCity(id: number) {
  askedToBuild = null;
  store.selectedCity = id;
  store.selectedUnit = null;
  store.cityInfo = null;
  store.panel = null;
  play('open', 0.7);
  client.send('city', { id });
  const city = myCity(id);
  if (city && store.grid) {
    const c = centre(store.grid, city.tile);
    lookAt(window.innerWidth >= 700 ? c.x + 12 : c.x, c.z);
  }
  store.changed++;
}

export function itemName(kind: string, id: string) {
  if (kind === 'project') return isProject(id) ? PROJECTS[id].name : (SPACESHIP_PARTS.find((x) => x.id === id)?.name ?? id);
  return kind === 'unit' ? (UNITS[id]?.name ?? id) : (BUILDINGS[id]?.name ?? id);
}

/** Each yield's name, glyph and colour class, as a city's screen shows them. */
const CITY_YIELDS: [key: string, name: string, glyph: string, cls: string][] = [
  ['food', 'Food', 'food', 'y-food'],
  ['prod', 'Production', 'prod', 'y-prod'],
  ['gold', 'Gold', 'gold', 'y-gold'],
  ['science', 'Science', 'science', 'y-science'],
  ['culture', 'Culture', 'culture', 'y-culture'],
  ['faith', 'Faith', 'faith', 'y-faith'],
];

/** Specialists' names and what each makes (the rules' `SPECIALIST_YIELD`), with their great person. */
const SPECIALISTS: Record<string, { name: string; makes: string }> = {
  scientist: { name: 'Scientist', makes: '+3 science' },
  engineer: { name: 'Engineer', makes: '+2 production' },
  merchant: { name: 'Merchant', makes: '+3 gold' },
  artist: { name: 'Artist', makes: '+3 culture' },
  writer: { name: 'Writer', makes: '+3 culture' },
  musician: { name: 'Musician', makes: '+3 culture' },
};

/** A progress row: a glyph, a label, how far along (a bar) and what that means. */
function progressRow(glyph: string, colour: string, label: string, done: number, bar: string, right: string, title?: string): El {
  return h(
    'div.cv-prog',
    { title },
    icon(glyph, 15, colour),
    h('div.cv-grow', {}, h('div.l', {}, h('span', {}, label), h('small', {}, right)), h(`div.cv-bar.${bar}`, {}, h('i', { style: `width:${Math.round(Math.max(0, Math.min(1, done)) * 100)}%` }))),
  );
}

/**
 * A city's screen: its yields (each with where it comes from), growth, borders and defence, then a
 * tab each for what it builds (the queue, reordered at will, and everything it could make or buy),
 * its people (focus, specialists; its tiles are worked from the map, where their yields show) and
 * its buildings (what each does).
 */
function renderCity(): El | null {
  const city = myCity(store.selectedCity);
  if (!city) return null;
  const info = store.cityInfo?.id === city.id ? store.cityInfo : null;
  const y = city.yields!;
  const mood = store.view!.self.happiness;
  const civ = CIVS[store.view!.players[city.owner]?.civ ?? ''];
  const refresh = () => setTimeout(() => client.send('city', { id: city.id }), 150);
  const head = h(
    'div.head',
    { style: `background:linear-gradient(120deg, ${civ?.color ?? '#333333'}44, transparent 70%)` },
    h('div.pop', { style: `border-color:${civ?.color ?? '#888'}`, title: `${city.pop} citizens` }, String(city.pop)),
    h(
      'div.cv-grow',
      {},
      h('div.cv-row', { style: 'gap:6px' }, city.capital && icon('crown', 16, '#f2c14e'), h('span.cv-h.big', {}, city.name)),
      h('small.cv-muted', {}, `${city.capital ? 'Capital · ' : ''}${civ?.adjective ?? ''} city`),
    ),
  );
  // Its yields, each with where it comes from on hover.
  const yieldBox = ([key, name, glyph, cls]: (typeof CITY_YIELDS)[number]) => {
    const value = key === 'food' ? y.food : y[key as 'prod'];
    const parts = info?.breakdown[key] ?? [];
    const extra = key === 'food' ? `${y.surplus >= 0 ? '+' : ''}${y.surplus}` : undefined;
    return h(
      'div',
      {},
      h(`span.${cls}`, { html: svg(glyph, 16) }),
      String(value),
      extra && h('small', {}, extra),
      parts.length > 0 &&
        h(
          'div.bd',
          {},
          h('div.cv-label', {}, name),
          ...parts.map((p) => h('div.ln', {}, h('span', {}, p.label), h(`b${p.value < 0 ? '.neg' : ''}`, {}, sign(p.value)))),
          key === 'food' && h('div.ln.total', {}, h('span', {}, 'Toward growth'), h('b', {}, sign(y.surplus))),
        ),
    );
  };
  const garrison = unitsAt(city.tile).find((u) => u.owner === me() && UNITS[u.type]?.strength);
  const summary = h(
    'div.summary',
    {},
    h('div.cv-yields', {}, ...CITY_YIELDS.map(yieldBox)),
    progressRow(
      'food',
      '#7bd16a',
      'Growth',
      (city.food ?? 0) / Math.max(1, city.foodNeed ?? 1),
      'food',
      // (An unhappy empire's cities grow a quarter as fast; at -10 or less, not at all: said, as it's the reason.)
      `${city.food ?? 0}/${city.foodNeed ?? 0} · ${city.growth! > 0 ? `grows in ${city.growth} turn${city.growth === 1 ? '' : 's'}${mood < 0 ? ' (slowed: your empire is unhappy)' : ''}` : city.growth! < 0 ? 'starving!' : mood <= -10 ? 'not growing: your empire is too unhappy' : 'not growing'}`,
    ),
    progressRow('culture', '#d68ae8', 'Borders', (city.culture ?? 0) / Math.max(1, city.cultureNeed ?? 1), 'purple', `${city.culture ?? 0}/${city.cultureNeed ?? 0}${city.nextTile === null ? ' · every tile in reach is claimed' : city.borderTurns ? ` · a new tile in ${city.borderTurns} turn${city.borderTurns === 1 ? '' : 's'}` : ''}`, 'Culture claims the next tile (dashed on the map)'),
    progressRow('shield', '#ff8a7a', 'Defence', city.hp / city.maxHp, city.hp < city.maxHp ? 'red' : 'green', `${city.strength} strength · ${city.hp}/${city.maxHp} HP${garrison ? ` · ${UNITS[garrison.type].name}` : ''}`, garrison ? 'A garrison adds a fifth of its strength' : 'A military unit in the city adds to its strength'),
  );
  const tabs = h(
    'div.cv-tabs',
    {},
    ...(
      [
        ['build', 'Production', 'prod'],
        ['people', 'Citizens', 'people'],
        ['buildings', 'Buildings', 'city'],
      ] as [typeof store.cityTab, string, string][]
    ).map(([k, name, glyph]) => h(`button${store.cityTab === k ? '.on' : ''}`, { onclick: () => ((store.cityTab = k), store.changed++) }, icon(glyph, 14), name)),
  );
  const content = store.cityTab === 'people' ? cityPeople(city, info, refresh) : store.cityTab === 'buildings' ? cityBuildings(city, info) : cityBuild(city, info, refresh);
  return h(
    // (A cv-scroll too: on a short screen the whole panel scrolls, kept where it was across redraws.)
    'div.cv-city.cv-panel.cv-in.cv-scroll',
    {},
    h('button.cv-x', { onclick: () => ((store.selectedCity = null), store.changed++), html: svg('close', 15) }),
    head,
    summary,
    tabs,
    h('div.body.cv-scroll', {}, ...cityAlerts(city), ...content),
  );
}

/** A city's production tab: what it's building, the queue (reordered, or cleared), and all it could make or buy. */
export function cityBuild(city: CityWire, info: CityInfo | null, refresh: () => void): El[] {
  const gold = store.view!.self.gold;
  const faith = store.view!.self.faith;
  const b = city.building;
  const produce = (kind: 'unit' | 'building' | 'project', id: string, queue: boolean) => {
    send({ t: 'produce', city: city.id, item: { kind, id }, queue });
    refresh();
    // (Opened by the end-turn button for want of a build: that's done, back to the map.)
    if (askedToBuild === city.id && !b) {
      askedToBuild = null;
      store.selectedCity = null;
      store.changed++;
    }
  };
  const buy = (kind: 'unit' | 'building', id: string, withFaith = false) => {
    send({ t: 'buy', city: city.id, item: { kind, id }, with: withFaith ? 'faith' : 'gold' });
    refresh();
  };
  const queue = city.queue ?? [];
  const full = queue.length >= 6;
  // (Opened from the warning that it has no defenders: a defender advised.)
  const advice = defenceAdvice(city, info) ?? info?.advice ?? null;
  const option = (o: CityInfo['options'][number]) => {
    const wonder = o.kind === 'building' && BUILDINGS[o.id]?.kind !== 'building';
    const advised = advice && advice.kind === o.kind && advice.id === o.id ? advice : null;
    const row = h(
      `div.cv-opt${wonder ? '.wonder' : ''}${b?.id === o.id ? '.on' : ''}${advised ? '.advised' : ''}`,
      { style: 'cursor:pointer', 'data-pedia': pediaKey(o.kind, o.id), 'data-note': advised ? `The advisor recommends it: ${advised.why}` : 'Click to build it now; shift-click or + to queue it' },
      itemArt(o.kind, o.id, 38),
      h(
        'div.cv-grow',
        {},
        h('div.n', {}, itemName(o.kind, o.id), advised && ' ', advised && adviceTag(advised)),
        h('div.meta', {}, `${o.turns} turn${o.turns === 1 ? '' : 's'} · ${o.cost} production`),
        advised && h('div.adv-why', {}, advised.why),
      ),
      queue.length > 0 && h('button.cv-btn.small.icon', { onclick: () => produce(o.kind as 'unit', o.id, true), disabled: full, title: full ? 'The queue is full' : 'Add to the queue' }, icon('plus', 13)),
      o.buy !== null && h('button.cv-btn.small', { onclick: () => buy(o.kind as 'unit' | 'building', o.id), disabled: gold < o.buy!, title: `Buy it now (you have ${gold} gold)` }, icon('gold', 13, '#f6cf4a'), `${o.buy}`),
    );
    row.addEventListener('click', (e) => {
      play('click', 0.6);
      produce(o.kind as 'unit' | 'building' | 'project', o.id, e.shiftKey && queue.length > 0);
    });
    return row;
  };
  const made = info?.options.filter((o) => o.faith === undefined) ?? [];
  const sect = (name: string, list: El[]) => list.length > 0 && h('div', {}, h('div.cv-label', { style: 'margin:6px 0 2px' }, name), ...list);
  const holy = (info?.options.filter((o) => o.faith !== undefined && o.faith !== null) ?? []).map((o) =>
    h(
      'div.cv-opt',
      { 'data-pedia': pediaKey(o.kind, o.id) },
      itemArt(o.kind, o.id, 38),
      h('div.cv-grow', {}, h('div.n', {}, itemName(o.kind, o.id))),
      h('button.cv-btn.small', { onclick: () => buy(o.kind as 'unit' | 'building', o.id, true), disabled: faith < o.faith!, title: 'Buy it with faith' }, icon('faith', 13), `${o.faith}`),
    ),
  );
  const turnsOf = (id: string) => info?.options.find((o) => o.id === id)?.turns;
  const move = (from: number, to: number) => send({ t: 'reorder', city: city.id, from, to });
  const now = b
    ? h(
        'div.cv-now',
        {},
        itemArt(b.kind, b.id, 46),
        h('div.cv-grow', {}, h('div.cv-label', {}, 'Producing'), h('div', { style: 'font-weight:700;font-size:14px' }, itemName(b.kind, b.id)), h('div.cv-bar.orange', { style: 'margin-top:5px' }, h('i', { style: `width:${Math.round(b.progress * 100)}%` }))),
        h('div', { style: 'text-align:center' }, h('div', { style: 'font-weight:800;font-size:18px' }, String(b.turns)), h('small.cv-muted', {}, b.turns === 1 ? 'turn' : 'turns')),
        !city.puppet && h('button.cv-btn.small.icon', { onclick: () => send({ t: 'unqueue', city: city.id, index: 0 }), title: 'Stop building it (what was put in is kept)' }, icon('close', 12)),
      )
    : h(
        'div.cv-alert',
        {},
        icon('info', 16, '#ffb36b'),
        city.puppet ? 'It chooses its next build as the turn ends' : 'Choose something to build',
        !city.puppet && advice && h('button.cv-btn.small', { onclick: () => produce(advice.kind as 'unit' | 'building' | 'project', advice.id, false), title: advice.why }, icon('lightbulb', 13), `Advisor: ${itemName(advice.kind, advice.id)}`),
      );
  // A puppet chooses its own builds (Civ V's, as its alert says): what it's making is shown, but nothing is chosen, queued or bought.
  if (city.puppet) return [now];
  return [
    now,
    // Repeat: units finished go back to the end of the queue (so a city keeps training them).
    queue.some((q) => q.kind === 'unit') &&
      h(
        `button.cv-chip.cv-repeat${city.repeat ? '.on' : ''}`,
        { onclick: () => send({ t: 'repeat', city: city.id, on: !city.repeat }), title: city.repeat ? 'Units finished are built again: click to stop' : 'Build the queue’s units again as each is finished' },
        icon('turn', 12),
        city.repeat ? 'Repeating units' : 'Repeat units',
      ),
    queue.length > 1 &&
      h(
        'div.cv-queue',
        {},
        h('div.cv-label', {}, `Then (${queue.length - 1} of 5)`),
        ...queue.slice(1).map((q, i) =>
          h(
            'div.q',
            { 'data-pedia': pediaKey(q.kind, q.id) },
            itemArt(q.kind, q.id, 26),
            h('span.cv-grow', {}, itemName(q.kind, q.id)),
            turnsOf(q.id) !== undefined && h('small.cv-muted', {}, `${turnsOf(q.id)}t`),
            h('button.cv-btn.small.icon', { onclick: () => move(i + 1, i), title: i === 0 ? 'Build it now (what was put into the current one is kept)' : 'Earlier' }, icon('up', 13)),
            h('button.cv-btn.small.icon', { onclick: () => move(i + 1, i + 2), disabled: i + 2 >= queue.length, title: 'Later' }, icon('down', 13)),
            h('button.cv-btn.small.icon', { onclick: () => send({ t: 'unqueue', city: city.id, index: i + 1 }), title: 'Remove it' }, icon('close', 12)),
          ),
        ),
      ),
    !info && h('div.cv-muted', {}, 'Loading…'),
    sect('Units', [
      ...made.filter((o) => o.kind === 'unit').map(option),
      // What it could train but for something missing: greyed, with what.
      ...(info?.held ?? []).map((o) =>
        h('div.cv-opt.held', { 'data-pedia': pediaKey('unit', o.id), 'data-note': o.why }, itemArt('unit', o.id, 38), h('div.cv-grow', {}, h('div.n', {}, itemName('unit', o.id)), h('div.meta', {}, o.why))),
      ),
    ]),
    sect('Buildings', [
      ...made.filter((o) => o.kind === 'building' && BUILDINGS[o.id]?.kind === 'building').map(option),
      ...(info?.heldBuildings ?? []).map((o) =>
        h('div.cv-opt.held', { 'data-pedia': pediaKey('building', o.id), 'data-note': o.why }, itemArt('building', o.id, 38), h('div.cv-grow', {}, h('div.n', {}, itemName('building', o.id)), h('div.meta', {}, o.why))),
      ),
    ]),
    sect('Wonders', made.filter((o) => o.kind === 'building' && BUILDINGS[o.id]?.kind !== 'building').map(option)),
    sect('Spaceship', made.filter((o) => o.kind === 'project' && !isProject(o.id)).map(option)),
    sect('World Congress projects', made.filter((o) => o.kind === 'project' && isProject(o.id)).map(option)),
    sect('With faith', holy),
    h('small.cv-dim', {}, touchScreen() ? 'Tap to build it now; + adds it to the queue.' : 'Click to build now; + (or shift-click) adds it to the queue.'),
  ].filter((x): x is El => !!x);
}

/** Each focus's name and glyph, in the order the governor's choices show. */
const FOCUS_LOOK: Record<City['focus'], [name: string, glyph: string]> = {
  balanced: ['Balanced', 'pop'],
  food: ['Food', 'food'],
  prod: ['Production', 'prod'],
  gold: ['Gold', 'gold'],
  science: ['Science', 'science'],
  culture: ['Culture', 'culture'],
  faith: ['Faith', 'faith'],
};

/** Each kind of great person's name. */
const GREAT_NAMES: Record<string, string> = { scientist: 'Great Scientist', engineer: 'Great Engineer', merchant: 'Great Merchant', artist: 'Great Artist', writer: 'Great Writer', musician: 'Great Musician', general: 'Great General', admiral: 'Great Admiral' };

/** Turns to grow, in a word or two (-1: starving, 0: not growing). */
const growthWords = (turns: number) => (turns < 0 ? 'starving' : turns === 0 ? 'not growing' : `grows in ${turns}`);

/**
 * What the governor favours, as a table: each focus with what the city would make under it (the yields
 * that differ between them, food to spare and the turns to grow), the one in place marked; a choice
 * of row puts it in place.
 */
function focusTable(city: CityWire, info: CityInfo | null): El {
  const rows = info?.focuses ?? [];
  if (!rows.length)
    return h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, ...(Object.keys(FOCUS_LOOK) as City['focus'][]).map((f) => h(`button.cv-chip${city.focus === f ? '.on' : ''}`, { onclick: () => send({ t: 'focus', city: city.id, focus: f }) }, icon(FOCUS_LOOK[f][1], 13), FOCUS_LOOK[f][0])));
  // (Only the yields some focus changes: the rest would be the same number down the column.)
  const cols = (['prod', 'gold', 'science', 'culture', 'faith'] as const).filter((k) => rows.some((r) => r[k] !== rows[0][k]));
  return h(
    'div.cv-focus',
    { style: `--cols:${cols.length}` },
    h('div.hd', {}, h('span', {}, 'Focus'), h('span', { title: 'Food to spare a turn' }, icon('food', 13, YIELD_COLOR.food)), ...cols.map((k) => h('span', {}, icon(k, 13, YIELD_COLOR[k]))), h('span', {}, 'Growth')),
    ...rows.map((r) => {
      const [name, glyph] = FOCUS_LOOK[r.focus];
      return h(
        `button.row${city.focus === r.focus ? '.on' : ''}`,
        { onclick: () => send({ t: 'focus', city: city.id, focus: r.focus }), title: `The governor favours ${name.toLowerCase()}${r.focus === 'balanced' ? '' : ' tiles'}: ${growthWords(r.growth)}${r.growth > 0 ? ' turns' : ''}` },
        h('span.nm', {}, icon(glyph, 13), name),
        h(`b${r.surplus < 0 ? '.neg' : ''}`, {}, r.surplus ? sign(r.surplus) : '0'),
        ...cols.map((k) => h('b', {}, String(r[k]))),
        h('small', {}, growthWords(r.growth)),
      );
    }),
  );
}

/** Great people this city brings on: its points a turn of each kind, against the empire's progress toward the next. */
function greatPeopleBlock(info: CityInfo | null): El | null {
  const s = store.view!.self;
  const here = Object.entries(info?.greatPeople ?? {}).filter(([, n]) => n > 0);
  if (!here.length) return null;
  return h(
    'div.cv-gp',
    {},
    h('div.cv-label', {}, 'Great people'),
    ...here.map(([kind, n]) => {
      const have = Math.floor(s.greatPoints[kind] ?? 0);
      const need = s.greatCosts[kind] ?? 0;
      return h(
        'div.row',
        { 'data-note': `${GREAT_NAMES[kind] ?? kind}: ${have} of ${need} points across your empire; this city adds ${n} a turn` },
        tile(GREAT_GLYPH[kind] ?? 'xp', '#2a3a4c', 26, '#f2c14e'),
        h('div.cv-grow', {}, h('div.l', {}, h('b', {}, GREAT_NAMES[kind] ?? kind), h('small', {}, `+${n} a turn here · ${have}/${need}`)), h('div.cv-bar.gold', {}, h('i', { style: `width:${Math.round(Math.min(1, have / Math.max(1, need)) * 100)}%` }))),
      );
    }),
  );
}

/** A city's citizens tab: what the governor favours (and what each focus would make), its specialists (placed and taken back here), how its people are spread, and the great people it brings on. */
function cityPeople(city: CityWire, info: CityInfo | null, refresh: () => void): El[] {
  const specialists = city.specialists ?? {};
  const placed = Object.values(specialists).reduce((s, n) => s + n, 0);
  const onTiles = city.worked?.length ?? 0;
  const idle = Math.max(0, city.pop - onTiles - placed);
  const byHand = (city.locked?.length ?? 0) + Object.values(city.lockedSpecialists ?? {}).reduce((s, n) => s + n, 0);
  const slots = Object.entries(info?.slots ?? {}).filter(([, n]) => n > 0);
  const specialist = (kind: string, add: boolean) => {
    send({ t: 'specialist', city: city.id, kind: kind as never, add });
    refresh();
  };
  return [
    h('div.cv-label', {}, 'The governor favours'),
    focusTable(city, info),
    h(
      'div.cv-card.cv-citizens',
      {},
      h('div.cv-row', { style: 'gap:14px;flex-wrap:wrap' }, h('span', {}, icon('pop', 14, '#f2c14e'), h('b', {}, String(onTiles)), ' on tiles'), h('span', {}, icon('science', 14, '#6ab8ff'), h('b', {}, String(placed)), placed === 1 ? ' specialist' : ' specialists'), idle > 0 && h('span', { style: 'color:#ff9a8e' }, h('b', {}, String(idle)), ' unemployed'), byHand > 0 && h('span', {}, icon('lock', 13, '#f2c14e'), h('b', {}, String(byHand)), ' placed by hand')),
      h('small.cv-muted', {}, `On the map: ${click()} a tile to put a citizen there (a lock keeps it); ${click()} a locked one to free it. Gold tags are tiles you can buy.`),
    ),
    h('div.cv-label', { style: 'margin-top:4px' }, 'Specialists'),
    ...(slots.length
      ? slots.map(([kind, n]) => {
          const have = specialists[kind] ?? 0;
          const locked = city.lockedSpecialists?.[kind] ?? 0;
          return h(
            'div.cv-spec',
            {},
            tile(GREAT_GLYPH[kind] ?? 'pop', '#2a3a4c', 30, YIELD_COLOR[kind === 'engineer' ? 'prod' : kind === 'merchant' ? 'gold' : kind === 'scientist' ? 'science' : 'culture']),
            h('div.cv-grow', {}, h('b', {}, SPECIALISTS[kind]?.name ?? kind), h('small.cv-muted', {}, `${SPECIALISTS[kind]?.makes ?? ''} and 3 ${(GREAT_NAMES[kind] ?? kind).toLowerCase()} points a turn each`)),
            h(
              'div.slots',
              {},
              ...Array.from({ length: n }, (_, i) =>
                h(`button${i < have ? '.full' : ''}${i < Math.min(have, locked) ? '.locked' : ''}`, { onclick: () => specialist(kind, i >= have), title: i < have ? 'Take this specialist back to the tiles' : 'Make a citizen a specialist' }, icon(i < have ? 'pop' : 'plus', 14)),
              ),
            ),
          );
        })
      : [h('small.cv-muted', {}, 'No specialist slots yet: a Library, Market, Workshop and the like each add some.')]),
    greatPeopleBlock(info),
  ].filter((x): x is El => !!x);
}

/** A building's great work slots: each filled one with its work's name, each empty one waiting. */
function workSlots(city: CityWire, id: string): El | null {
  const slots = BUILDINGS[id]?.effects.greatWorks;
  if (!slots) return null;
  const works = city.works?.[id] ?? [];
  const kind = slots.kind;
  return h(
    'div.cv-works',
    {},
    ...Array.from({ length: slots.slots }, (_, i) =>
      works[i] ? h('span.work', { title: `A great work of ${kind}: culture and tourism` }, icon('frame', 12, '#d68ae8'), works[i]) : h('span.work.empty', { title: `An empty slot for a great work of ${kind}` }, icon('plus', 11), `Empty: ${kind}`),
    ),
  );
}

/** The faith of a city's people (by religion, on a bar), and the pressure on it (each religion's a turn, toward winning a citizen). */
function religionBlock(city: CityWire, info: CityInfo | null): El {
  const v = store.view!;
  const name = (r: string) => v.religions.find((x) => x.id === r)?.name ?? r;
  const followers = Object.entries(city.followers ?? {}).filter(([, n]) => n > 0);
  const counted = followers.reduce((s, [, n]) => s + n, 0);
  const none = Math.max(0, city.pop - counted);
  const press = info?.pressure.filter((x) => x.perTurn > 0 || x.gathered > 0) ?? [];
  const need = info?.conversionNeed ?? 0;
  return h(
    'div.cv-faith',
    {},
    h('div.cv-label', {}, 'Religion'),
    h('div.l', {}, icon('faith', 14, '#e8e2d0'), h('b', {}, city.religion ? `Follows ${name(city.religion)}` : 'No religion yet'), h('small.cv-muted', {}, city.religion ? `${city.followers?.[city.religion] ?? 0} of ${city.pop} citizens` : 'none of its citizens follow one')),
    followers.length > 0 &&
      h(
        'div.mix',
        { title: [...followers.map(([r, n]) => `${name(r)}: ${n}`), none ? `None: ${none}` : ''].filter(Boolean).join(' · ') },
        ...followers.map(([r, n]) => h('i', { style: `width:${(n / Math.max(1, city.pop)) * 100}%;background:${faithColor(r)}` })),
      ),
    ...press.map((x) => {
      const turns = x.perTurn > 0 ? Math.max(1, Math.ceil((need - x.gathered) / x.perTurn)) : 0;
      return h(
        'div.press',
        { title: `${name(x.religion)}: ${x.gathered} of the ${need} pressure that wins a citizen` },
        h('div.l', {}, h('i.dot', { style: `background:${faithColor(x.religion)}` }), h('span.cv-grow', {}, name(x.religion)), h('b', {}, x.perTurn > 0 ? `+${x.perTurn} a turn` : '')),
        h('div.bar', {}, h('i', { style: `width:${Math.round(Math.min(1, x.gathered / Math.max(1, need)) * 100)}%;background:${faithColor(x.religion)}` })),
        h('small.cv-muted', {}, x.perTurn > 0 ? `${x.gathered}/${need}: a citizen won in ${turns} turn${turns === 1 ? '' : 's'}` : `${x.gathered}/${need}`),
      );
    }),
    !press.length && h('small.cv-muted', {}, 'No religion presses on it: cities of a religion within ten tiles, and trade routes, carry their faith here.'),
  );
}

/** The trade routes from or to a city, and what each brings. */
function routesBlock(city: CityWire): El | null {
  const routes = store.view!.self.routes.filter((r) => r.from === city.name || r.to === city.name);
  if (!routes.length) return null;
  const amount = (n: number, glyph: string, cls: string) => n > 0 && h(`span.${cls}`, {}, icon(glyph, 12), `+${n}`);
  return h(
    'div.cv-croutes',
    {},
    h('div.cv-label', {}, `Trade routes · ${routes.length}`),
    ...routes.map((r) =>
      h(
        'div.row',
        {},
        icon('trade', 14, '#c8b07a'),
        h('span.cv-grow', {}, `${r.from} → ${r.to}`),
        amount(r.gold, 'gold', 'y-gold'),
        amount(r.science, 'science', 'y-science'),
        amount(r.food, 'food', 'y-food'),
        amount(r.prod, 'prod', 'y-prod'),
        h('small.cv-muted', {}, `${r.turns}t`),
      ),
    ),
  );
}

/** A city's buildings tab: each building and wonder in it, what it does and costs, and its great works; its religion; its trade routes. */
function cityBuildings(city: CityWire, info: CityInfo | null): El[] {
  const list = city.buildings ?? [];
  const row = (id: string) => {
    const g = buildingGlyph(id);
    const b = BUILDINGS[id];
    const text = describe('building', id).replace(/^[^:]*: ?/, '');
    return h(
      'div.cv-bld',
      { 'data-pedia': pediaKey('building', id) },
      b && b.kind !== 'building' && wonderPicture(id) ? pic(wonderPicture(id), 32) : tile(g.glyph, '#22303f', 32, g.color),
      h('div.cv-grow', {}, h('div', { style: 'display:flex;gap:6px;align-items:baseline' }, h('b', {}, b?.name ?? id), b?.upkeep ? h('small.cv-muted', {}, `${b.upkeep} gold upkeep`) : null), text && h('small.cv-muted', {}, text), workSlots(city, id)),
    );
  };
  const wonders = list.filter((id) => BUILDINGS[id] && BUILDINGS[id].kind !== 'building');
  const buildings = list.filter((id) => !wonders.includes(id));
  const upkeep = list.reduce((s, id) => s + (BUILDINGS[id]?.upkeep ?? 0), 0);
  return [
    !list.length && h('div.cv-muted', {}, 'Nothing built here yet.'),
    buildings.length > 0 && h('div.cv-label', {}, `Buildings (${buildings.length})${upkeep ? ` · ${upkeep} gold upkeep a turn` : ''}`),
    ...buildings.map(row),
    wonders.length > 0 && h('div.cv-label', { style: 'margin-top:6px' }, 'Wonders'),
    ...wonders.map(row),
    religionBlock(city, info),
    routesBlock(city),
  ].filter((x): x is El => !!x);
}

/** What a unit or building does, for its tooltip. */
function describe(kind: string, id: string): string {
  if (kind === 'unit') {
    const u = UNITS[id];
    if (!u) return id;
    return `${u.name}: strength ${u.strength}${u.ranged ? `, ranged ${u.ranged} (range ${u.range})` : ''}, ${u.moves} moves${u.resource ? `, needs ${RESOURCES[u.resource].name}` : ''}`;
  }
  const b = BUILDINGS[id];
  if (!b) return id;
  const e = b.effects;
  const NAMES: Record<string, string> = { prod: 'production' };
  const list = (y: Record<string, number | undefined>, after = '') => Object.entries(y).map(([k, v]) => `+${v}${after} ${NAMES[k] ?? k}`).join(', ');
  const bits: string[] = [];
  if (e.yields) bits.push(list(e.yields));
  if (e.perPop) bits.push(`${list(e.perPop)} per citizen`);
  if (e.percent) bits.push(list(e.percent, '%'));
  for (const tb of e.tiles ?? []) {
    const w = tb.where;
    const what = [...(w.resource ?? []), ...(w.feature ?? []), ...(w.terrain ?? []), ...(w.improvement ?? []), ...(w.elevation ?? [])].map((x) => RESOURCES[x]?.name ?? x.replace('_', ' '));
    bits.push(`${list(tb.yields)} from ${what.length ? what.join(', ') : w.river ? 'river' : w.water ? 'water' : ''} tiles`);
  }
  if (e.happiness) bits.push(`+${e.happiness} happiness`);
  if (e.defense) bits.push(`+${e.defense} defence`);
  if (e.hp) bits.push(`+${e.hp} HP`);
  if (e.foodKept) bits.push(`keeps ${e.foodKept}% food on growth`);
  for (const sp of e.specialists ?? []) bits.push(`${sp.slots} ${sp.kind} slot${sp.slots === 1 ? '' : 's'}`);
  if (e.greatWorks) bits.push(`${e.greatWorks.slots} great work slot${e.greatWorks.slots === 1 ? '' : 's'} (${e.greatWorks.kind})`);
  for (const x of e.xp ?? []) bits.push(`new ${x.domain === 'all' ? '' : `${x.domain} `}units +${x.xp} XP`);
  for (const u of e.unitProduction ?? []) bits.push(`+${u.percent}% production toward ${u.classes?.join(', ') ?? u.domain ?? ''} units`);
  if (e.wonderProduction) bits.push(`+${e.wonderProduction}% production toward wonders`);
  if (b.note) bits.push(b.note);
  return `${b.name}${b.upkeep ? ` (${b.upkeep} gold upkeep)` : ''}: ${bits.filter(Boolean).join('; ')}`;
}

// -------------------------------------------------------------------------------------------------
// The combat preview
// -------------------------------------------------------------------------------------------------

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** How an attack would likely end (Civ V's words for it), and whether that's good news. */
function verdict(d: CombatPreview): { text: string; cls: 'good' | 'bad' | 'even' } {
  const name = d.defender.unit ? (UNITS[d.defender.unit]?.name ?? 'unit') : 'city';
  // (Great people, missionaries, inquisitors and caravans can't be taken: they're killed. Settlers are taken as workers.)
  const kept = d.defender.unit && !['great', 'religious', 'trade'].includes(UNITS[d.defender.unit]?.class ?? '');
  if (d.capture) return { text: kept ? `Captures the ${name} (no fight)${d.defender.unit === 'settler' ? ': it becomes a Worker' : ''}` : `Kills the ${name} (no fight)`, cls: 'good' };
  if (d.takes !== undefined && d.takes >= 0.99) return { text: 'The city falls to this attack', cls: 'good' };
  if (d.takes) return { text: `${pct(d.takes)} chance to take the city`, cls: d.takes >= 0.5 ? 'good' : 'even' };
  if (d.defender.dies >= 0.99 && d.attacker.dies <= 0.01) return { text: `Decisive victory: the ${name} is destroyed`, cls: 'good' };
  if (d.attacker.dies >= 0.99) return { text: 'Your unit would be destroyed', cls: 'bad' };
  if (d.defender.dies > 0 || d.attacker.dies > 0)
    return { text: [d.defender.dies > 0 && `${pct(d.defender.dies)} to destroy it`, d.attacker.dies > 0 && `${pct(d.attacker.dies)} to lose yours`].filter(Boolean).join(' · '), cls: d.attacker.dies > d.defender.dies ? 'bad' : 'even' };
  if (d.air) return { text: 'Air strike: fighters or anti-aircraft guns near it may intercept first', cls: 'even' };
  if (d.ranged) return { text: 'Ranged attack: no damage back', cls: 'good' };
  const dealt = (d.defender.damage[0] + d.defender.damage[1]) / 2;
  const taken = (d.attacker.damage[0] + d.attacker.damage[1]) / 2;
  const r = dealt / Math.max(1, taken);
  if (r >= 1.6) return { text: 'Major victory', cls: 'good' };
  if (r >= 1.15) return { text: 'Minor victory', cls: 'good' };
  if (r > 0.87) return { text: 'Stalemate', cls: 'even' };
  if (r > 0.6) return { text: 'Minor defeat', cls: 'bad' };
  return { text: 'Major defeat', cls: 'bad' };
}

/** One side of a fight: who, its strength and what changes it, its health and the damage it would take. */
function previewSide(sd: PreviewSide, ranged: boolean, mine: boolean): El {
  const v = store.view!;
  const p = v.players[sd.owner];
  const name = sd.unit ? (UNITS[sd.unit]?.name ?? sd.unit) : (v.cities.find((c) => c.id === sd.city)?.name ?? 'City');
  const [lo, hi] = sd.damage;
  const seg = (n: number) => `${Math.max(0, (n / sd.maxHp) * 100)}%`;
  const left = Math.max(0, sd.hp - hi);
  return h(
    `div.side${mine ? '.mine' : ''}`,
    {},
    h('div.who', {}, p ? emblemEl(p.civ, 18, p.cityState?.kind) : null, h('b', {}, name)),
    h('div.str', {}, icon(ranged && mine ? 'ranged' : sd.city !== undefined ? 'city' : 'strength', 16, mine ? '#f0a24a' : '#ff8a7a'), h('b', {}, sd.strength ? sd.strength.toFixed(1) : '—')),
    h(
      'div.hpbar',
      { title: `${sd.hp}/${sd.maxHp} HP now` },
      h('i.keep', { style: `width:${seg(left)}` }),
      h('i.maybe', { style: `width:${seg(Math.min(sd.hp, hi) - Math.min(sd.hp, lo))}` }),
      h('i.lose', { style: `width:${seg(Math.min(sd.hp, lo))}` }),
    ),
    h('small.dmg', {}, hi > 0 ? `${sd.hp} HP · takes ${lo === hi ? lo : `${lo}–${hi}`}` : `${sd.hp} HP · no damage`),
    sd.mods.length > 0 && h('div.mods', {}, ...sd.mods.slice(0, 7).map((m) => h('div', {}, h(`b.${m.percent > 0 ? 'up' : m.percent < 0 ? 'down' : 'flat'}`, {}, m.percent ? `${m.percent > 0 ? '+' : ''}${Math.round(m.percent)}%` : '•'), m.label))),
  );
}

/** The attack under the mouse, before it's made: each side, the damage both ways, and how it would likely end. */
function renderPreview(): El | null {
  const pv = store.preview;
  if (!pv?.answered) return null;
  const d = pv.data;
  if (!d) return h('div.cv-preview.cv-panel.slim', {}, icon('info', 15, '#ff9a8e'), h('span', {}, "It can't attack that from here (out of sight, or something's in the way)."));
  const out = verdict(d);
  const cityFire = 'city' in pv.ask;
  return h(
    'div.cv-preview.cv-panel',
    {},
    h('div.cv-label', {}, cityFire ? 'City bombardment' : d.air ? 'Air strike' : d.ranged ? 'Ranged attack' : 'from' in pv.ask && pv.ask.from !== undefined ? 'Attack (it moves next to it first)' : 'Attack'),
    h('div.sides', {}, previewSide(d.attacker, d.ranged, true), h('div.vs', {}, 'vs'), previewSide(d.defender, d.ranged, false)),
    h(`div.verdict.${out.cls}`, {}, icon(out.cls === 'bad' ? 'close' : out.cls === 'good' ? 'check' : 'scales', 15), out.text),
    d.blocked && h('div.blocked', {}, icon('info', 13, '#ffb36b'), d.blocked),
  );
}

// -------------------------------------------------------------------------------------------------
// Big panels: the tech tree, policies, diplomacy
// -------------------------------------------------------------------------------------------------

function renderBig(): El | null {
  if (store.panel === 'tech') return renderTechTree();
  if (store.panel === 'policies') return renderPolicies();
  if (store.panel === 'diplomacy') return renderDiplomacy();
  if (store.panel === 'religion') return renderReligion();
  if (store.panel === 'espionage') return renderEspionage();
  if (store.panel === 'victory') return renderVictory();
  if (store.panel === 'pedia') return renderPedia();
  if (store.panel === 'notes') return renderNoteCentre();
  if (store.panel === 'overview') return renderOverview();
  if (store.panel === 'keys') return renderHotkeys();
  if (store.panel === 'menu') return renderMenu();
  if (store.panel === 'win') return renderHowToWin();
  if (store.panel === 'great') return renderGreatChoice();
  return null;
}

/** A big panel's heading: its glyph, title and a line, and the close button. */
export function bigTitle(glyph: string, bg: string, title: string, sub: string, panel: NonNullable<typeof store.panel>) {
  return [h('button.cv-x', { onclick: () => togglePanel(panel), html: svg('close', 15) }), h('div.title', {}, tile(glyph, bg, 40), h('div', {}, h('div.cv-h.big', {}, title), h('small.cv-muted', {}, sub)))];
}

export const TREE_COLOR: Record<string, string> = { tradition: '#b8892a', liberty: '#3a7ac0', honor: '#b8432f', piety: '#8a7aaa', patronage: '#3f8f6f', aesthetics: '#a85ab8', commerce: '#c8a02a', exploration: '#2a8a9a', rationalism: '#4a6ad0' };

function renderPolicies(): El {
  const s = store.view!.self;
  const have = new Set(s.policies);
  const enough = s.culture >= s.policyCost;
  return h(
    'div.cv-big.cv-panel',
    {},
    ...bigTitle('crown', '#b8892a', 'Social Policies', `Culture ${s.culture} / ${s.policyCost}. ${s.freeTenets > 0 ? `${s.freeTenets} tenet${s.freeTenets === 1 ? '' : 's'} of your new ideology free to take.` : enough ? 'Choose a policy.' : 'Not enough culture for the next one yet.'}`, 'policies'),
    h(
      'div.cv-policies.cv-scroll',
      {},
      renderIdeology(),
      ...TREES.map((tree) => {
        const open = have.has(tree.id);
        const early = ERAS.indexOf(tree.era) > s.era;
        const shut = (tree.excludes ?? []).find((x) => have.has(x));
        const locked = early || !!shut;
        const pol = (p: (typeof tree.policies)[number], can: boolean) =>
          h(`button.cv-pol${have.has(p.id) ? '.have' : can ? '.can' : ''}`, { onclick: can && enough ? () => send({ t: 'policy', id: p.id }) : undefined, disabled: !can || !enough, 'data-pedia': `policy:${p.id}` }, h('b', {}, have.has(p.id) ? '✓ ' : '', p.name), h('small', {}, p.text));
        return h(
          `div.cv-ptree${locked ? '.locked' : ''}`,
          {},
          h('div.hd', { 'data-pedia': `policy:${tree.id}` }, tile(POLICY_GLYPH[tree.id] ?? 'crown', TREE_COLOR[tree.id] ?? '#555555', 34), h('div', {}, h('div.cv-h', {}, tree.name), h('small.cv-muted', {}, early ? `From the ${ERA_NAMES[tree.era]}` : shut ? `Closed: you follow ${TREES.find((t) => t.id === shut)?.name ?? shut}` : open ? 'Adopted' : 'Not yet adopted'))),
          pol(tree.opener, !open && !locked),
          ...tree.policies.map((p) => pol(p, open && !have.has(p.id) && (p.needs ?? []).every((n) => have.has(n)))),
          h(`div.cv-pol${have.has(tree.finisher.id) ? '.have' : ''}`, { style: 'border-style:dashed' }, h('b', {}, 'Completed: '), h('small', {}, tree.finisher.text)),
        );
      }),
    ),
    s.policies.length > 0 && h('small.cv-muted', {}, `${s.policies.length} adopted: ${s.policies.map((id) => ALL_POLICIES[id]?.name ?? id).join(', ')}`),
  );
}

const IDEOLOGY_COLOR: Record<string, string> = { freedom: '#3a7ac0', order: '#b8432f', autocracy: '#4a4a5a' };
const IDEOLOGY_TEXT: Record<string, string> = {
  freedom: 'Culture, specialists and great people; friends among the free.',
  order: 'Production, science and a contented, planned society.',
  autocracy: 'Armies, conquest and the strength of the state.',
};

/**
 * An ideology: once the Industrial Era comes, the choice of one (each shown with its tenets), and
 * after it, its tenets in three levels, adopted with culture like policies (a level-two tenet needs
 * two more of level one than of level two, and so on up).
 */
function renderIdeology(): El | null {
  const s = store.view!.self;
  const have = new Set(s.policies);
  const enough = s.culture >= s.policyCost;
  const LEVEL = ['Level 1', 'Level 2', 'Level 3'];
  if (!s.ideology) {
    if (s.era < ERAS.indexOf('industrial')) return null;
    // (In the Industrial Era it takes three Factories; in the Modern, nothing more.)
    const open = s.ideologyOpen;
    return h(
      'div.cv-ideo',
      {},
      h('div.hd', {}, tile('globe', '#6a4a8a', 34), h('div', {}, h('div.cv-h', {}, open ? 'Choose an ideology' : 'Ideologies'), h('small.cv-muted', {}, open ? 'Your people are ready for an ideology: a lasting choice. Its tenets are then adopted with culture, as policies are.' : 'An ideology can be chosen once you have three Factories, or in the Modern Era: a lasting choice, its tenets adopted with culture as policies are.'))),
      h(
        'div.choices',
        {},
        ...IDEOLOGIES.map((ideo) =>
          h(
            'div.cv-ptree',
            {},
            h(
              'div.hd',
              {},
              tile(POLICY_GLYPH[ideo.id] ?? 'crown', IDEOLOGY_COLOR[ideo.id] ?? '#555555', 34),
              h('div.cv-grow', {}, h('div.cv-h', {}, ideo.name), h('small.cv-muted', {}, IDEOLOGY_TEXT[ideo.id] ?? '')),
              open && h('button.cv-btn.gold.small', { onclick: () => ask(`Adopt ${ideo.name}? An ideology can't be changed.`, `Adopt ${ideo.name}`, () => send({ t: 'ideology', id: ideo.id }), false) }, 'Adopt'),
            ),
            ...ideo.tenets.flatMap((level, i) => [h('div.cv-label', { style: 'margin-top:4px' }, LEVEL[i]), ...level.map((p) => h('div.tenet', { 'data-pedia': `policy:${p.id}` }, h('b', {}, p.name), ' ', h('small', {}, p.text)))]),
          ),
        ),
      ),
    );
  }
  const ideo = IDEOLOGIES.find((i) => i.id === s.ideology);
  if (!ideo) return null;
  const counts = ideo.tenets.map((level) => level.filter((p) => have.has(p.id)).length);
  // (Free tenets, after a revolution: taken without culture.)
  const free = s.freeTenets > 0;
  return h(
    'div.cv-ideo',
    {},
    renderRevolution(ideo.name),
    h('div.hd', {}, tile(POLICY_GLYPH[ideo.id] ?? 'crown', IDEOLOGY_COLOR[ideo.id] ?? '#555555', 34), h('div', {}, h('div.cv-h', {}, `${ideo.name}: tenets`), h('small.cv-muted', {}, `${counts.reduce((a, b) => a + b, 0)} adopted. ${free ? `${s.freeTenets} more free to take (no culture): your revolution's.` : 'A tenet costs culture as a policy does.'}`))),
    h(
      'div.levels',
      {},
      ...ideo.tenets.map((level, i) => {
        const open = i === 0 || counts[i] + 1 <= counts[i - 1] - 1;
        return h(
          'div.level',
          {},
          h('div.cv-label', {}, `${LEVEL[i]}${open ? '' : ` · needs ${counts[i] + 2 - counts[i - 1]} more of level ${i}`}`),
          ...level.map((p) => {
            const can = open && !have.has(p.id);
            const takes = can && (free || enough);
            return h(`button.cv-pol${have.has(p.id) ? '.have' : can ? '.can' : ''}`, { onclick: takes ? () => send({ t: 'policy', id: p.id }) : undefined, disabled: !takes, 'data-pedia': `policy:${p.id}` }, h('b', {}, have.has(p.id) ? '✓ ' : '', p.name, can && free ? h('span.cv-chip.good.free', {}, 'Free') : null), h('small', {}, p.text));
          }),
        );
      }),
    ),
  );
}

/**
 * A revolution, Civ V's, offered when the people's dissent from a rival ideology is high enough: what
 * it is, which ideology, how many of its tenets come free, and the two turns of anarchy it costs;
 * made after a question. Or, during the anarchy, how long it has left.
 */
function renderRevolution(now: string): El | null {
  const s = store.view!.self;
  if (s.anarchy > 0) return h('div.cv-alert.rev', {}, icon('war', 16, tone('#ff7a6a')), h('span', {}, `Anarchy: ${s.anarchy} more turn${s.anarchy === 1 ? '' : 's'} with no gold, science, culture or faith.`));
  const sw = s.ideologySwitch;
  if (!sw) return null;
  const to = IDEOLOGIES.find((i) => i.id === sw.to);
  if (!to) return null;
  const free = sw.free > 0 ? `${sw.free} of its tenets will be free to take (no culture); the rest of yours are lost` : `your ${now} tenets are lost (none come free)`;
  const what = `Your people's dissent has reached ${sw.dissent}: they lean to ${to.name}. A revolution makes ${to.name} your ideology: ${free}, and ${sw.anarchy} turns of anarchy follow, with no gold, science, culture or faith.`;
  return h(
    'div.cv-alert.rev',
    {},
    tile(POLICY_GLYPH[to.id] ?? 'crown', IDEOLOGY_COLOR[to.id] ?? '#555555', 30),
    h('div.cv-grow', {}, h('div.cv-h', {}, `Revolution: ${to.name}?`), h('small', {}, what)),
    h('button.cv-btn.danger.strong.small', { onclick: () => ask(`Revolution: make ${to.name} your ideology? ${free[0].toUpperCase()}${free.slice(1)}, and ${sw.anarchy} turns of anarchy follow.`, 'Revolution', () => send({ t: 'switchIdeology', id: to.id })) }, 'Revolution'),
  );
}

// -------------------------------------------------------------------------------------------------
// The game's end: the winner, and how everyone did over the game
// -------------------------------------------------------------------------------------------------

const HOW: Record<string, string> = { domination: 'by conquest', science: 'by reaching the stars', culture: 'through culture', diplomatic: 'by diplomacy', score: 'on score' };

function renderOver(): El {
  const v = store.view!;
  const o = v.over!;
  const winner = v.players[o.winner];
  // (A team wins together: the winner's teammates too, a fallen one among them.)
  // (The viewer: a player, or one who fell and watched the rest.)
  const self = v.fallen ?? v.you;
  const won = o.winner === self || teammate(o.winner);
  const team = typeof winner?.team === 'number' ? winner.team : null;
  const members = team === null ? [] : v.players.filter((p) => p.team === team).map((p) => p.name);
  const isHost = store.lobby?.host === store.lobby?.you;
  const way = VICTORIES.find((x) => x.id === o.how);
  // (The winners first, as the Hall of Fame ranks them: the winner and its team, then by score.)
  const winners = (p: { index: number; team?: number | null }) => p.index === o.winner || (team !== null && p.team === team);
  const majors = v.players.filter((p) => !p.cityState && p.civ !== 'barbarian').sort((a, b) => Number(winners(b)) - Number(winners(a)) || b.score - a.score);
  const rank = majors.findIndex((p) => p.index === self) + 1;
  const mine = v.history?.find((s) => s.index === self);
  const last = (k: 'score' | 'science' | 'land' | 'military') => mine?.[k][mine[k].length - 1];
  const top = Math.max(1, ...majors.map((p) => p.score));
  // What the viewer ended the game with: their place, then their numbers (from the history, where there is one).
  const facts: [string, string, string, string][] = [
    ['medal', '#f2c14e', 'Place', rank ? `${rank} of ${majors.length}` : '—'],
    // (The standings' score: a fallen civ's history ends at nothing, its score is kept.)
    ['golden', '#ffb84a', 'Score', String(v.players[self]?.score ?? last('score') ?? '—')],
    ['science', '#6ab8ff', 'Science', last('science') !== undefined ? String(last('science')) : '—'],
    ['city', '#d8b48a', 'Land', last('land') !== undefined ? `${last('land')} tiles` : '—'],
    ['strength', '#ff8a7a', 'Military', last('military') !== undefined ? String(last('military')) : '—'],
  ];
  return h(
    `div.cv-over.cv-panel.cv-scroll${won ? '.won' : v.spectator && v.fallen === undefined ? '' : '.lost'}`,
    {},
    h(
      'div.hero',
      {},
      h('div.ov-art', {}, tile(way?.glyph ?? 'golden', way?.color ?? '#5a6a7a', 84), portrait(winner?.civ ?? '', 84)),
      h(
        'div.cv-grow',
        {},
        // (Someone only watching neither won nor lost.)
        h('div.cv-label.ov-kick', {}, `${won ? 'Victory' : v.spectator && v.fallen === undefined ? 'Game over' : 'Defeat'} · ${way?.name ?? o.how}`),
        h('h2', {}, won ? (team === null ? 'Your civilization stands forever' : 'Your team stands forever') : team === null ? `${winner?.name} has won` : `Team ${team + 1} wins`),
        h('div.cv-muted', {}, `${team === null ? '' : `Team ${team + 1} (${members.join(', ')}): `}${winner?.name} of ${CIVS[winner?.civ ?? '']?.name ?? ''} won ${HOW[o.how] ?? o.how}, in ${year(v.turn)} (turn ${v.turn}).`),
      ),
    ),
    h('div.ov-facts', {}, ...facts.map(([glyph, colour, label, value]) => h('div', {}, icon(glyph, 18, colour), h('small', {}, label), h('b', {}, value)))),
    renderGraph(),
    h(
      'div.ov-standings',
      {},
      ...majors.map((p, i) =>
        h(
          `div.civrow${p.index === o.winner ? '.first' : ''}${p.index === self ? '.me' : ''}${p.alive ? '' : '.gone'}`,
          { 'data-pedia': `civ:${p.civ}` },
          h('b.place', {}, `${i + 1}`),
          emblemEl(p.civ, 26),
          h('div.who', {}, h('b', {}, p.name, typeof p.team === 'number' ? teamMark(p.team) : null), h('small', {}, `${CIVS[p.civ]?.name ?? ''}${p.alive ? ` · ${p.cities} ${p.cities === 1 ? 'city' : 'cities'}` : ' · gone'}`)),
          h('div.ov-scorebar', { style: `--civ:${CIVS[p.civ]?.color ?? '#888'}` }, h('i', { style: `width:${Math.round((p.score / top) * 100)}%` })),
          h('b.score', {}, `${p.score}`),
        ),
      ),
    ),
    h(
      'div.cv-row.ov-acts',
      {},
      h('button.cv-btn', { onclick: () => ((store.overHidden = true), store.changed++) }, icon('globe', 15), 'Look at the map'),
      isHost ? h('button.cv-btn.gold', { onclick: () => lobby({ a: 'newGame' }) }, 'New game') : h('span.cv-muted', {}, 'The host can start a new game.'),
    ),
  );
}

const GRAPHS: [Exclude<typeof store.graph, 'replay'>, string][] = [['score', 'Score'], ['science', 'Science'], ['land', 'Land'], ['military', 'Military']];

/** How each civ did over the game, as lines that step turn by turn (one tab at a time), the viewer's on top; or the game's replay (`replay.ts`). */
function renderGraph(): El | null {
  const v = store.view!;
  const hist = v.history;
  if (!hist?.length) return null;
  const replayTab = v.replay ? h(`button.cv-chip${store.graph === 'replay' ? '.on' : ''}`, { onclick: () => ((store.graph = 'replay'), store.changed++) }, icon('play', 12), 'Replay') : null;
  if (store.graph === 'replay' && v.replay) return h('div.cv-graph', {}, h('div.tabs', {}, ...GRAPHS.map(([k, name]) => h('button.cv-chip', { onclick: () => ((store.graph = k), store.changed++) }, name)), replayTab), replayPanel());
  const key = store.graph === 'replay' ? 'score' : store.graph;
  // (The viewer's line on top: theirs, or the fallen civ's they watched on with.)
  const self = v.fallen ?? v.you;
  const series = hist.map((s) => ({ p: v.players[s.index], data: s[key] })).sort((a, b) => (a.p?.index === self ? 1 : 0) - (b.p?.index === self ? 1 : 0));
  const n = Math.max(...series.map((s) => s.data.length), 2);
  const top = Math.max(1, ...series.flatMap((s) => s.data));
  const W = 700;
  const H = 180;
  const x = (i: number) => ((i / (n - 1)) * (W - 10) + 5).toFixed(1);
  const y = (d: number) => (H - 8 - (d / top) * (H - 20)).toFixed(1);
  const lines = series
    .map(({ p, data }) => {
      const colour = CIVS[p?.civ ?? '']?.color ?? '#888';
      const me = p?.index === self;
      let d = data.length ? `M${x(0)} ${y(data[0])}` : '';
      for (let i = 1; i < data.length; i++) d += `H${x(i)}V${y(data[i])}`;
      return `${me ? `<path d="${d}" fill="none" stroke="#07090c" stroke-width="6" vector-effect="non-scaling-stroke"/>` : ''}<path d="${d}" fill="none" stroke="${colour}" stroke-width="${me ? 3 : 2}" opacity="${me ? 1 : 0.8}" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="0" x2="${W}" y1="${y(f * top)}" y2="${y(f * top)}" stroke="rgba(255,255,255,.08)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`).join('');
  return h(
    'div.cv-graph',
    {},
    h('div.tabs', {}, ...GRAPHS.map(([k, name]) => h(`button.cv-chip${k === key ? '.on' : ''}`, { onclick: () => ((store.graph = k), store.changed++) }, name)), replayTab, h('span.cv-muted.peak', {}, `peak ${top}`)),
    h('div', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" shape-rendering="crispEdges">${grid}${lines}</svg>` }),
    h('div.cv-legend', {}, ...series.slice().reverse().map(({ p }) => h(`span${p?.index === self ? '.me' : ''}`, {}, h('i', { style: `background:${CIVS[p?.civ ?? '']?.color ?? '#888'}` }), p?.index === self ? `${p?.name ?? ''} (you)` : p?.name ?? ''))),
  );
}

// -------------------------------------------------------------------------------------------------
// Big moments, and the advisor
// -------------------------------------------------------------------------------------------------


// The advisor's tips: on or off, and those dismissed, kept with the player's preferences.
let tipsOff = false;
const seenTips = new Set<string>();
onPrefs(() => {
  tipsOff = !prefs.tips;
  seenTips.clear();
  for (const k of prefs.seen) seenTips.add(k);
  store.changed++;
});
function saveTips() {
  setPrefs({ tips: !tipsOff, seen: [...seenTips] });
}

/** Whether the advisor's tips are on. */
export const tipsOn = () => !tipsOff;

/** Turn the advisor's tips on (every one again) or off. */
export function setTips(on: boolean) {
  tipsOff = !on;
  if (on) seenTips.clear();
  saveTips();
  store.changed++;
}

/**
 * The advisor's tip for now, if there's one worth saying (`guide.ts`): what's happening now (a war, a
 * policy to adopt) before what's always true (the lenses, the Civilopedia); each said until it's
 * dismissed, or until the turn it came up on is over (the tip on show and its turn are kept with the
 * preferences, so a rejoin doesn't bring an old one back; a turn earlier than that is a new game's).
 */
function currentTip(): Tip | null {
  const turn = store.view?.turn ?? 0;
  const [key, since] = prefs.shown.split('@');
  if (key && turn > Number(since) && !seenTips.has(key)) {
    seenTips.add(key);
    saveTips();
  }
  const due = guideTips().filter((t) => t.when && !seenTips.has(t.key));
  const tip = due.find((t) => !t.evergreen) ?? due[0] ?? null;
  if (tip && (tip.key !== key || turn < Number(since))) setPrefs({ shown: `${tip.key}@${turn}` });
  return tip;
}

/** The tip whose card is open (on a small screen the advisor's card is one line until it's tapped). */
let advisorOpen: string | null = null;

function renderAdvisor(): El | null {
  if (tipsOff) return null;
  // A game just begun: first, how to win it.
  if (wantsHowToWin()) {
    store.panel = 'win';
    store.changed++;
    return null;
  }
  const tip = currentTip();
  if (!tip) return null;
  const toggle = (e: Event) => {
    if ((e.target as Element).closest('button')) return;
    advisorOpen = advisorOpen === tip.key ? null : tip.key;
    store.changed++;
  };
  return h(
    `div.cv-advisor.cv-panel${advisorOpen === tip.key ? '.open' : ''}`,
    { onclick: toggle },
    h('div.face', { html: svg('lightbulb', 22, '#fff') }),
    h(
      'div.cv-grow',
      {},
      h('b', {}, tip.title),
      h('div.cv-muted', {}, tip.text),
      h(
        'div.acts',
        {},
        tip.act &&
          h(
            'button.cv-btn.small.go',
            {
              onclick: () => {
                seenTips.add(tip.key);
                saveTips();
                tip.act!.run();
                store.changed++;
              },
            },
            icon('moves', 13),
            tip.act.label,
          ),
        h('button.cv-btn.small', { onclick: () => (seenTips.add(tip.key), saveTips(), store.changed++) }, icon('check', 13), 'Got it'),
        h('button.cv-btn.small', { onclick: () => ((tipsOff = true), saveTips(), store.changed++) }, 'Hide tips'),
      ),
    ),
  );
}

// -------------------------------------------------------------------------------------------------
// The tooltip under the mouse
// -------------------------------------------------------------------------------------------------

let tipAt = -2;
let tipX = 0;
let tipY = 0;
export function setTipPosition(x: number, y: number) {
  tipX = x;
  tipY = y;
}

function renderTip() {
  renderArrival();
  const t = store.hover;
  const el = parts.tip;
  if (!el) return;
  if (t < 0 || !store.known[t] || store.panel || !store.view || front() || pinMenuOpen()) {
    if (tipAt !== -1) el.replaceChildren();
    tipAt = -1;
    return;
  }
  const k = store.known[t]!;
  const s = store.terrain[t];
  const key = t * 1000 + store.changed;
  // (Not redrawn under a finger or the mouse pressing on it: a held tile's card has a button.)
  if (tipAt !== key && !pressing) {
    tipAt = key;
    const line = (glyph: string, colour: string, text: string) => h('div.ln', {}, icon(glyph, 13, colour), text);
    const nature = k.wonder ? NATURAL_WONDERS[k.wonder] : undefined;
    const bits: (El | string)[] = [
      h('b', {}, nature ? nature.name : `${s.elevation === 'mountain' ? 'Mountain' : TERRAINS[s.terrain].name}${s.elevation === 'hills' ? ' Hills' : ''}${s.feature ? ` · ${FEATURES[s.feature].name}` : ''}${s.river ? ' · River' : ''}${s.volcano ? ' · Volcano' : ''}${s.soil ? ' · Rich Soil' : ''}${s.flooded ? ' · Flooded' : ''}`),
    ];
    if (nature) bits.push(line('peak', nature.color, `Natural wonder${nature.passable ? '' : ' (impassable)'}`), ...natureEffects(nature).map((x) => line('golden', '#f2c14e', x)));
    if (k.resource) bits.push(line(resourceGlyph(k.resource), RESOURCES[k.resource].color, `${RESOURCES[k.resource].name} (${RESOURCES[k.resource].kind})`));
    if (k.improvement) bits.push(line('hammer', '#f0a24a', `${IMPROVEMENTS[k.improvement as ImprovementId]?.name ?? k.improvement}${k.pillaged ? ' (pillaged)' : ''}`));
    if (k.road) bits.push(line(k.road === 'rail' ? 'rail' : 'trade', '#c8b07a', k.road === 'rail' ? 'Railroad' : 'Road'));
    const owner = k.owner >= 0 ? store.view.players[k.owner] : null;
    // (A city here: named, with its defences: its banner floats above, so the units in it can seem to be all there is.)
    const here = cityAt(t);
    if (here) bits.push(line('city', CIVS[store.view.players[here.owner]?.civ]?.color ?? '#fff', `${here.name} · strength ${here.strength} · ${Math.round(here.hp)}/${here.maxHp} HP`));
    else if (owner) bits.push(h('div.ln', {}, emblemEl(owner.civ, 14, owner.cityState?.kind), `${owner.cityState ? owner.name : (CIVS[owner.civ]?.adjective ?? '')} land`));
    for (const u of unitsAt(t))
      if (k.visible || u.owner === me()) {
        const p = store.view.players[u.owner];
        bits.push(line(unitGlyph(u.type), CIVS[p?.civ]?.color ?? '#fff', `${CIVS[p?.civ]?.adjective ?? p?.name ?? ''} ${UNITS[u.type]?.name} · ${u.hp} HP`));
      }
    if (s.feature === 'fallout') bits.push(line('mushroom', '#b8d84a', `Fallout: yields next to nothing, ${FEATURES.fallout.hurts} damage a turn to units here; a worker scrubs it away`));
    if (k.ruin) bits.push(line('urn', '#f2c14e', 'Ancient ruins'));
    if (k.camp) bits.push(line('skull', '#ff8a7a', 'Barbarian camp (clear it for gold)'));
    const y = store.yields[t];
    if (y) bits.splice(1, 0, h('div.ln.yl', {}, ...YIELD_KEYS.filter((x) => (y[x] ?? 0) > 0).map((x) => h('span', {}, icon(x, 13, YIELD_COLOR[x]), String(y[x])))));
    // The open city's land: what a click on it does.
    const city = myCity(store.selectedCity);
    const own = city && store.cityInfo?.id === city.id ? store.cityInfo.tiles.find((x) => x.t === t) : undefined;
    if (city && own) {
      const worked = city.worked?.includes(t);
      const text =
        own.buyCost !== null
          ? `${click(true)} to buy it for ${own.buyCost} gold`
          : city.locked?.includes(t)
            ? `A citizen placed here: ${click()} to free them`
            : worked
              ? `Worked: ${click()} to keep a citizen here`
              : `${click(true)} to put a citizen here`;
      bits.push(h('div.ln.way', {}, icon(own.buyCost !== null ? 'gold' : 'pop', 13), text));
    }
    const sel = myUnit(store.selectedUnit);
    // (The selected worker's recommended work here, before the way there: `workadvice.ts`.)
    const work = workTipLines(t);
    if (store.unitAim) bits.push(h('div.ln.way', {}, icon('plane', 13), `${click(true)} to ${store.unitAim.order === 'paradrop' ? 'drop' : 'fly'} it here`));
    else {
      bits.push(...work);
      if (sel && t !== sel.tile && !attackable(sel, t)) {
        const route = previewPath(sel, t);
        bits.push(h(`div.ln.way${route ? '' : '.no'}`, {}, icon(route ? 'moves' : 'close', 13), route ? wayThere(route, sel) : whyNot(sel, t)));
        const walls = route && wallsOnWay(route, sel);
        if (walls) bits.push(h('div.ln.way.no', {}, icon('war', 13), walls));
      }
    }
    bits.push(...pinTip(t), ...lensTip(t));
    // (A finger's held tile: its card takes a tap, to pin it. With the mouse and nothing selected to move, a right-click's the tile's menu.)
    const held = touchScreen() && heldTile() === t;
    if (held && tileMenuFree(true)) bits.push(pinButtons(t, tipX, tipY));
    else if (!touchScreen()) bits.push(h('div.ln.f1', {}, sel || store.selectedCity !== null ? 'F1: its article in the Civilopedia' : 'F1: its article · Right-click: pin it'));
    el.replaceChildren(h(`div.cv-tip${held ? '.held' : ''}`, {}, ...bits));
  }
  const tip = el.firstElementChild as HTMLElement | null;
  // (In the interface's own lengths: the screen's divided by its scale.)
  const ui = store.uiScale;
  const [x, y, W, H] = [tipX / ui, tipY / ui, window.innerWidth / ui, window.innerHeight / ui];
  if (tip && touchScreen()) {
    // (A finger covers what's under it and below: the card above it, or beside it where there's no room.)
    const above = y - tip.offsetHeight - 28;
    tip.style.left = `${Math.max(8, Math.min(W - tip.offsetWidth - 8, x - tip.offsetWidth / 2))}px`;
    tip.style.top = `${above >= 52 ? above : Math.min(H - tip.offsetHeight - 8, y + 28)}px`;
  } else if (tip) {
    tip.style.left = `${Math.min(W - tip.offsetWidth - 8, x + 16)}px`;
    tip.style.top = `${Math.min(H - tip.offsetHeight - 8, y + 16)}px`;
  }
}
