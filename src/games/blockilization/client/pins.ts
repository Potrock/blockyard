import { MAX_PINS, PIN_ICONS, PIN_LABEL } from '../protocol';
import { CIVS } from '../rules/civs';
import { NATURAL_WONDERS } from '../rules/nature';
import type { MapPin } from '../rules/state';
import { FEATURES, TERRAINS } from '../rules/terrain';
import { centreHere, landY, lookAt, toScreen } from './camera';
import { icon } from './icons';
import type { Pen } from './lenses';
import { openPedia, tileArticle } from './pedia';
import { mapFont } from './pixel';
import { cityAt, me, store } from './store';
import { h, tell, touchScreen, type El } from './ui';
import { pingButtons } from './chat';

/**
 * Map pins, Civilization VI's: right-click a tile with no unit selected (on a touch screen, hold a
 * finger on it: its card has Pin), then Pin, and mark it with an icon and a short label. You and your team see each
 * other's pins, on the map, on the minimap and in their list by the minimap (each goes to its tile);
 * each is its owner's to change or take up. The server keeps them with the game (`server.ts`).
 */

type PinIcon = (typeof PIN_ICONS)[number];

/** Each pin icon's name and colour. */
const LOOK: Record<PinIcon, { name: string; color: string }> = {
  golden: { name: 'Star', color: '#ffd23a' },
  city: { name: 'City site', color: '#7fd46b' },
  war: { name: 'Attack', color: '#ff6b5e' },
  shield: { name: 'Defend', color: '#5ab4ff' },
  target: { name: 'Target', color: '#ff9a4a' },
  hammer: { name: 'Build', color: '#d8b07a' },
  gems: { name: 'Resource', color: '#d68ae8' },
  peak: { name: 'Wonder', color: '#e6c88a' },
  anchor: { name: 'Harbour', color: '#4ac0e8' },
  spy: { name: 'Watch', color: '#b8c4d8' },
  skull: { name: 'Danger', color: '#ffffff' },
  info: { name: 'Note', color: '#9ad0ff' },
};
const look = (p: MapPin) => LOOK[p.icon as PinIcon] ?? LOOK.info;

/** A pin's colour (its icon's), for the minimap. */
export const pinColor = (p: MapPin) => look(p).color;

/** The tile menu a right-click (or a long press) opened: its tile, where on the screen, and, once Pin's chosen, the pin being made. */
let menu: { tile: number; x: number; y: number; edit: { icon: PinIcon; label: string } | null } | null = null;
/** The list by the minimap, open. */
let listOpen = false;
/** A pin just gone to from the list, ringed on the map for a moment. */
let flash: { tile: number; at: number } | null = null;

const mine = (p: MapPin) => p.owner === me();
const pinsAt = (t: number) => (store.view?.pins ?? []).filter((p) => p.tile === t);
const ownerName = (p: MapPin) => store.view?.players[p.owner]?.name ?? '';
const ownerColor = (p: MapPin) => CIVS[store.view?.players[p.owner]?.civ ?? '']?.color ?? '#888';
const full = () => (store.view?.pins ?? []).filter(mine).length >= MAX_PINS;

/** A tile's place, in a few words: its city, its natural wonder, or its land. */
function placeName(t: number): string {
  const city = cityAt(t);
  if (city) return city.name;
  const nature = NATURAL_WONDERS[store.known[t]?.wonder ?? ''];
  if (nature) return nature.name;
  const s = store.terrain[t];
  if (!s) return 'Unknown land';
  return `${s.elevation === 'mountain' ? 'Mountain' : TERRAINS[s.terrain].name}${s.elevation === 'hills' ? ' Hills' : ''}${s.feature ? ` · ${FEATURES[s.feature].name}` : ''}`;
}

/** The tile menu for tile `t`, opened at a point on the screen (where it was clicked). */
export function openPinMenu(t: number, x: number, y: number) {
  if (t < 0 || !store.known[t]) return;
  menu = { tile: t, x, y, edit: null };
  // (The tile's card goes: the menu's over it. With it gone, a finger on the menu has no card to put
  // away, so the menu isn't redrawn between the finger's lifting and its tap landing.)
  store.hover = -1;
  store.changed++;
}

/** The tile menu closed; false if it wasn't open. */
export function closePinMenu(): boolean {
  if (!menu) return false;
  menu = null;
  store.changed++;
  return true;
}

export const pinMenuOpen = () => !!menu;

/** The list of pins by the minimap, opened (or closed). */
export function togglePins(open = !listOpen) {
  listOpen = open;
  store.changed++;
}

/** The pin being made in the tile menu: the one of yours there to change, or a new one. */
function startEdit() {
  if (!menu) return;
  const own = pinsAt(menu.tile).find(mine);
  menu.edit = { icon: (own?.icon as PinIcon) ?? 'golden', label: own?.label ?? '' };
  store.changed++;
  // (The label's field ready to type in; not on a touch screen, where it would bring up the keyboard over the map.)
  if (matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.pn-label')?.focus());
}

function put() {
  if (!menu?.edit) return;
  tell('pin', { tile: menu.tile, icon: menu.edit.icon, label: menu.edit.label.trim().slice(0, PIN_LABEL) });
  closePinMenu();
}

const takeUp = (t: number) => tell('pin', { tile: t, remove: true });

/** The map centred on a pin, ringed for a moment. */
function goTo(p: MapPin) {
  const g = store.grid;
  if (!g) return;
  const c = centreHere(g, p.tile);
  lookAt(c.x, c.z);
  flash = { tile: p.tile, at: performance.now() };
}

/** A pin's look in a line: its icon on a block edged in its owner's colour. */
const badge = (p: MapPin, size = 15) => h('span.pn-ico', { style: `border-color:${ownerColor(p)}` }, icon(p.icon, size, look(p).color));

/** A pin in words: its label (or its icon's name), and whose it is if not yours. */
const pinWords = (p: MapPin) => `${p.label || look(p).name}${mine(p) ? '' : ` (${ownerName(p)}’s pin)`}`;

/**
 * The tile menu, where it was opened (kept on the screen): the pins on the tile, and Pin (or Change
 * and Take up, for yours there), a ping for the others, and the tile's Civilopedia article; after
 * Pin, the icons, the label and Pin it. `free`: nothing in front of the map (else it's closed).
 */
export function renderPinMenu(free: boolean): El | null {
  const v = store.view;
  if (!menu || !free || !v || v.spectator || v.over) {
    menu = null;
    return null;
  }
  const m = menu;
  const here = pinsAt(m.tile);
  const own = here.find(mine);
  const item = (glyph: string, label: string, act: () => void, disabled = false) => h('button.pn-item', { onclick: act, disabled }, icon(glyph, 15), h('span', {}, label));
  const kids: (El | null | false)[] = [h('div.pn-head', {}, icon('pin', 15, '#f2c14e'), h('b', {}, placeName(m.tile)))];
  if (!m.edit) {
    const article = tileArticle(m.tile);
    kids.push(
      ...here.map((p) => h('div.pn-here', {}, badge(p, 13), h('span', {}, pinWords(p)))),
      own ? item('pin', 'Change your pin', startEdit) : item('pin', 'Pin', startEdit, full()),
      !own && full() && h('small.cv-muted', {}, `You have ${MAX_PINS} pins down: take one up to pin another.`),
      !!own && item('close', 'Take up your pin', () => (takeUp(m.tile), closePinMenu())),
      // (Or point at it for the others a moment: a ping, `chat.ts`.)
      pingButtons(m.tile, () => closePinMenu()),
      !!article && item('book', 'Civilopedia', () => (closePinMenu(), openPedia(article))),
    );
  } else {
    const e = m.edit;
    // (An icon chosen is shown chosen at once: with the label's field being typed in, the menu isn't redrawn.)
    const name = h('small.cv-muted', {}, LOOK[e.icon].name);
    const choices: El[] = PIN_ICONS.map((id) => {
      const choice = h(`button.pn-icon${e.icon === id ? '.on' : ''}`, {
        title: LOOK[id].name,
        onclick: () => {
          e.icon = id;
          for (const x of choices) x.classList.toggle('on', x === choice);
          name.textContent = LOOK[id].name;
        },
      }, icon(id, 18, LOOK[id].color));
      return choice;
    });
    const field = h('input.cv-input.pn-label', { value: e.label, placeholder: 'A short label (or none)', maxlength: String(PIN_LABEL), spellcheck: 'false' }) as HTMLInputElement;
    field.addEventListener('input', () => (e.label = field.value));
    field.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) put();
    });
    kids.push(
      h('div.pn-icons', {}, ...choices),
      name,
      field,
      h('div.pn-do', {}, h('button.cv-btn.gold.small', { onclick: put }, own ? 'Change it' : 'Pin it'), h('button.cv-btn.small', { onclick: () => closePinMenu() }, 'Cancel')),
    );
  }
  // (Where it opened is in the screen's lengths, its place in the interface's: those over its scale.)
  const k = store.uiScale;
  const el = h('div.pn-menu.cv-panel', { style: `left:${m.x / k}px;top:${m.y / k}px` }, ...kids);
  // (Kept on the screen: moved in from an edge once it's laid out, and opened from there next time it's drawn.)
  requestAnimationFrame(() => {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    m.x = Math.max(8, Math.min(m.x, window.innerWidth - r.width - 8));
    m.y = Math.max(8, Math.min(m.y, window.innerHeight - r.height - 8));
    el.style.left = `${m.x / k}px`;
    el.style.top = `${m.y / k}px`;
  });
  return el;
}

/**
 * On a touch screen, the buttons on the card of a tile a finger's held on (`x`, `y`: where): Pin,
 * straight to the icons and the label (with no pins left to put down, a word why); or, for your pin
 * there, Change and Take up; and the tile's Civilopedia article.
 */
export function pinButtons(t: number, x: number, y: number): El {
  const own = pinsAt(t).some(mine);
  const edit = () => {
    openPinMenu(t, x, y);
    startEdit();
  };
  const article = tileArticle(t);
  const pin = own
    ? [h('button.cv-btn.small', { onclick: edit }, icon('pin', 14), 'Change'), h('button.cv-btn.small.danger', { onclick: () => takeUp(t) }, icon('close', 14), 'Take up')]
    : [full() ? h('small.cv-muted', {}, `${MAX_PINS} pins down: take one up to pin here`) : h('button.cv-btn.small', { onclick: edit }, icon('pin', 14), 'Pin')];
  return h('div.pn-card', {}, ...pin, !!article && h('button.cv-btn.small.icon', { onclick: () => openPedia(article), title: 'Civilopedia' }, icon('book', 14)), pingButtons(t));
}

/** The pins button over the minimap: the list, open or shut, and how many pins there are. */
export function pinsButton(): El {
  const n = store.view?.pins.length ?? 0;
  return h(
    `button.pn-toggle${listOpen ? '.on' : ''}`,
    { onclick: () => togglePins(), title: 'Map pins, yours and your team’s: right-click a tile with no unit selected to pin it' },
    icon('pin', 13),
    n > 0 && h('span', {}, String(n)),
  );
}

/** The list of pins, over the minimap: yours, then your team's; each goes to its tile, and yours can be taken up. */
export function renderPinList(): El | null {
  const v = store.view;
  if (!listOpen || !v || v.spectator) return null;
  const pins = [...v.pins].sort((a, b) => Number(!mine(a)) - Number(!mine(b)) || a.id - b.id);
  const row = (p: MapPin) =>
    h(
      'div.pn-row',
      {},
      h('button.pn-go', { onclick: () => goTo(p), title: `Go to it: ${placeName(p.tile)}` }, badge(p), h('span.cv-grow', {}, h('b', {}, p.label || look(p).name), h('small.cv-muted', {}, mine(p) ? placeName(p.tile) : `${placeName(p.tile)} · ${ownerName(p)}`))),
      mine(p) && h('button.pn-del', { onclick: () => takeUp(p.tile), title: 'Take it up' }, icon('close', 12)),
    );
  return h(
    'div.pn-list.cv-panel',
    {},
    h('div.pn-head', {}, icon('pin', 15, '#f2c14e'), h('b.cv-grow', {}, 'Map pins'), h('small.cv-muted', {}, `${pins.filter(mine).length}/${MAX_PINS}`), h('button.pn-del', { onclick: () => togglePins(false), title: 'Close' }, icon('close', 12))),
    pins.length ? h('div.pn-rows.cv-scroll', {}, ...pins.map(row)) : h('small.cv-muted', {}, touchScreen() ? 'Hold a finger on a tile, then Pin on its card.' : 'Right-click a tile with no unit selected to pin it.'),
  );
}

/** What the tooltip says of a tile's pins (and, with nothing selected to move, how to pin it). */
export function pinTip(t: number): El[] {
  return pinsAt(t).map((p) => h('div.ln', {}, icon(p.icon, 13, look(p).color), pinWords(p)));
}

/** A box on the screen (pixels). */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * The pins drawn on the map, each a flag on a short pole at the front of its tile: its icon on a
 * block edged in its owner's colour, its label beside it where there's room (not over another pin,
 * or a unit's flag or a city's banner, the boxes in `taken`: the tooltip and the list have it all).
 * Over the rest of the map, the cloud too. A pin just gone to from the list is ringed for a moment.
 */
export function drawPins(pen: Pen, taken: Box[]) {
  const v = store.view;
  const g = store.grid;
  if (!v || !g) return;
  const { ctx, zoomed, ui } = pen;
  const size = Math.round(Math.max(14, Math.min(24, zoomed * 0.62)) * ui);
  const fs = Math.round(Math.min(13, Math.max(10, zoomed * 0.36)) * ui);
  const flags: (Box & { pin: MapPin })[] = [];
  /** Pins drawn so far on each tile (a teammate's beside yours). */
  const onTile = new Map<number, number>();
  for (const p of v.pins) {
    const c = centreHere(g, p.tile);
    const nth = onTile.get(p.tile) ?? 0;
    onTile.set(p.tile, nth + 1);
    // (Low at its tile's front: a city's banner and a unit's flag float over the middle.)
    const foot = toScreen(c.x, landY(p.tile), c.z + 2);
    const top = toScreen(c.x, landY(p.tile) + 1.4, c.z + 2);
    if (!foot || !top || top.x < -60 || top.x > window.innerWidth + 200 || foot.y < -60 || top.y > window.innerHeight + 60) continue;
    const px = Math.round(top.x + nth * (size + 6));
    const x0 = Math.round(px - size / 2);
    const y0 = Math.round(top.y - size);
    ctx.fillStyle = '#07090c';
    ctx.fillRect(px - 1, y0, 3, Math.max(0, Math.round(foot.y) - y0));
    ctx.fillRect(px - 3, Math.round(foot.y) - 2, 7, 3);
    ctx.fillRect(x0 - 2, y0 - 2, size + 4, size + 4);
    ctx.fillStyle = ownerColor(p);
    ctx.fillRect(x0, y0, size, size);
    ctx.fillStyle = '#151922';
    ctx.fillRect(x0 + 2, y0 + 2, size - 4, size - 4);
    pen.glyph(p.icon, x0 + size / 2, y0 + size / 2, size * 0.7, look(p).color);
    flags.push({ x0: x0 - 2, y0: y0 - 2, x1: x0 + size + 2, y1: y0 + size + 2, pin: p });
  }
  // The labels, where there's room for them (yours first).
  ctx.font = mapFont(fs);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labels: Box[] = [];
  for (const f of [...flags].sort((a, b) => Number(!mine(a.pin)) - Number(!mine(b.pin)))) {
    if (!f.pin.label || zoomed < 11) continue;
    const tw = ctx.measureText(f.pin.label).width;
    const mid = Math.round((f.y0 + f.y1) / 2);
    const box = { x0: f.x1 + 2, y0: Math.round(mid - fs * 0.8), x1: Math.round(f.x1 + 2 + tw + fs), y1: Math.round(mid + fs * 0.8) };
    if ([...taken, ...labels].some((b) => overlaps(box, b)) || flags.some((o) => o !== f && overlaps(box, o))) continue;
    labels.push(box);
    ctx.fillStyle = 'rgba(13,19,27,0.86)';
    ctx.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(f.pin.label, box.x0 + fs / 2, mid + 0.5);
  }
  if (!flash) return;
  const age = (performance.now() - flash.at) / 1000;
  if (age > 1.8) {
    flash = null;
    return;
  }
  const ring = new Path2D();
  if (!pen.hex(ring, flash.tile, landY(flash.tile), 0.9 + 0.08 * Math.sin(age * 9))) return;
  ctx.lineWidth = 3;
  ctx.strokeStyle = `rgba(242,193,78,${(1 - age / 1.8).toFixed(2)})`;
  ctx.stroke(ring);
}

export const PINS_CSS = `
.cv-tip.held { pointer-events: auto; }
.pn-card { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 4px; }
.pn-menu { position: absolute; z-index: 6; width: 236px; padding: 8px; display: flex; flex-direction: column; gap: 5px; pointer-events: auto; }
.pn-head { display: flex; align-items: center; gap: 6px; }
.pn-head b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-here { display: flex; align-items: center; gap: 6px; font-size: 13px; }
.pn-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px; text-align: left; background: #2e3542 !important; border: 2px solid #07090c !important; }
.pn-item:hover:not(:disabled) { background: #3a4252 !important; }
.pn-item:disabled { opacity: .45; }
.pn-icons { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
.pn-icon { height: 32px; display: flex; align-items: center; justify-content: center; background: #1a1f28 !important; border: 2px solid #07090c !important; }
.pn-icon:hover { background: #2e3542 !important; }
.pn-icon.on { border-color: #f2c14e !important; background: #4a4430 !important; }
.pn-do { display: flex; gap: 6px; }
.pn-ico { width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; background: #151922; border: 2px solid #888; box-shadow: 0 0 0 1px #07090c; }
.pn-toggle { position: absolute; right: 9px; bottom: 9px; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px; background: #222731 !important; border: 2px solid #07090c !important; color: var(--muted) !important; font-size: 15px; }
.pn-toggle:hover { color: var(--text) !important; }
.pn-toggle.on { border-color: #f2c14e !important; background: #4a4430 !important; color: #ffe3a1 !important; }
.pn-list { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.pn-rows { display: flex; flex-direction: column; gap: 3px; max-height: 230px; overflow-y: auto; }
.pn-row { display: flex; align-items: center; gap: 3px; }
.pn-go { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; padding: 4px 6px; text-align: left; background: #1a1f28 !important; border: 2px solid transparent !important; }
.pn-go:hover { border-color: #3a4252 !important; }
.pn-go .cv-grow { min-width: 0; display: flex; flex-direction: column; }
.pn-go b, .pn-go small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pn-del { width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; color: var(--muted) !important; }
.pn-del:hover { color: #ff9a8e !important; }
`;
