import { canFortify, isMilitary, UNITS } from '../rules/units';
import type { PreviewAsk, UnitWire } from '../protocol';
import { cam, centreHere, pick, zoom } from './camera';
import { flagsIn, hitAt, type Hit } from './overlay';
import { ask, attackable, cityAt, enemyAt, me, myCity, myUnit, store, unitsAt } from './store';
import { closePanels, endTurnAction, explores, front, openCity, platformMenuOpen, selectNextIdle, send, setTipPosition, toggleLens, togglePanel } from './ui';
import { openPedia, tileArticle } from './pedia';
import { openOverview } from './overview';
import { cycleLens } from './lenses';
import { chargeFrom } from './path';
import { marchTo } from './march';
import { play } from './sound';
import { closePinMenu, openPinMenu } from './pins';
import { workAt, workTip } from './workadvice';

/**
 * The mouse, a finger and the keyboard on the map: a click (or tap) selects a unit or opens a city, a
 * click elsewhere with a unit selected sends it there (right-click too, and onto an enemy: an attack),
 * dragging (one finger) moves the view, the wheel (two fingers pinched, which move it too) zooms; a
 * finger held still on a tile shows what's there (as the mouse's hover does); the keys move the view,
 * end the turn and give the common orders. With a city's screen open, a click on its land works (or
 * buys) the tile. Clicks on the panels are the panels'.
 */

/**
 * Whether an event is on the map (not on the interface). The interface's layer lets the mouse
 * through except where something in it takes it (a panel, a button, a note), so anything in it that
 * an event lands on is the interface's. Nothing is, with the platform's pause menu over the game.
 */
const onMap = (e: Event) => !platformMenuOpen() && !(e.target instanceof Element && e.target.closest('.cv-root'));

let down: { x: number; y: number; button: number; moved: boolean; shift: boolean } | null = null;
/** Fingers (and the mouse) on the map, where each was last; and a pinch's start (two fingers). */
const pointers = new Map<number, { x: number; y: number }>();
let pinch: { apart: number; dist: number; x: number; y: number } | null = null;
const apart = () => {
  const [a, b] = [...pointers.values()];
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
};
/** Where two fingers are, between them. */
const between = () => {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
/** The view moved by a drag of (dx, dy) screen pixels: the map follows the finger (or the mouse). */
function drag(dx: number, dy: number) {
  const k = (cam.dist / Math.max(400, window.innerHeight)) * 1.25;
  cam.x -= dx * k;
  cam.z -= dy * k * 1.15;
  cam.goal = null;
}
/** A finger held still on the map: after a moment, what's under it shows (its tooltip), and its lifting does nothing else. */
let holding = 0;
let held = false;
const HOLD_MS = 450;

/** The tile a finger was last held on, its card still on show (with buttons to pin it), or -1. */
let cardTile = -1;
export const heldTile = () => (cardTile >= 0 && cardTile === store.hover ? cardTile : -1);
/** Whether an event is on the card of what's under the mouse or a finger (`ui.ts`): a held tile's has buttons. */
const onCard = (e: Event) => e.target instanceof Element && !!e.target.closest('.cv-tip');

/**
 * Whether the tile's menu can open (from a right-click, or the card of a tile a finger's held on): a
 * game being played, no city's screen open and nothing taking aim, and (for a right-click, which
 * moves it) no unit selected.
 */
export function tileMenuFree(touch: boolean): boolean {
  const v = store.view;
  return !!v && !v.over && !v.spectator && store.selectedCity === null && store.cityTarget === null && !store.unitAim && (touch || !myUnit(store.selectedUnit));
}

/** A click on the map (or a tap, `touch`): on a unit's flag or a city's banner (`hit`), else on the tile under it. */
function act(t: number, right: boolean, hit: Hit | null = null, touch = false, shift = false) {
  const v = store.view;
  if (!v || v.over || v.spectator) return;
  const tapped = store.tap;
  store.tap = null;
  // A unit choosing where to go by air: the click is where (a right-click, a change of mind).
  if (store.unitAim) {
    const aim = store.unitAim;
    const to = hit?.tile ?? t;
    if (!right && to >= 0) send({ t: aim.order, unit: aim.unit, to });
    store.unitAim = null;
    store.changed++;
    return;
  }
  // A city taking aim: the click is its target (or, off any enemy, a change of mind).
  if (store.cityTarget !== null) {
    const target = hit?.tile ?? t;
    if (!right && target >= 0) send({ t: 'cityFire', city: store.cityTarget, target });
    store.cityTarget = null;
    store.changed++;
    return;
  }
  if (!right && !hit && cityTile(t)) return;
  if (hit) {
    t = hit.tile;
    const city = hit.city !== undefined ? cityAt(t) : undefined;
    // A flag of yours selects that very unit (shift: adds it to the selected one's group, or takes it out); your city's banner opens it.
    if (!right && hit.unit !== undefined && myUnit(hit.unit)) {
      if (shift && store.selectedUnit !== null && store.selectedUnit !== hit.unit) {
        const id = hit.unit;
        store.group = store.group.includes(id) ? store.group.filter((x) => x !== id) : [...store.group, id];
      } else {
        store.selectedUnit = hit.unit;
        store.group = [];
      }
      store.selectedCity = null;
      store.changed++;
      return;
    }
    if (!right && city?.owner === me()) return openCity(city.id);
  }
  if (t < 0) return;
  const sel = myUnit(store.selectedUnit);
  const mineHere = unitsAt(t).filter((u) => u.owner === me());
  const city = cityAt(t);
  if (!right) {
    // Selecting: your own units here (each click the next), else your city.
    if (sel && sel.tile === t && mineHere.length > 1) {
      const i = mineHere.findIndex((u) => u.id === sel.id);
      store.selectedUnit = mineHere[(i + 1) % mineHere.length].id;
      store.group = [];
      store.changed++;
      return;
    }
    if (sel && sel.tile === t && city?.owner === me()) return openCity(city.id);
    if (!sel || sel.tile === t || (mineHere.length && !enemyAt(t))) {
      if (mineHere.length) {
        const military = mineHere.find((u) => UNITS[u.type]?.strength) ?? mineHere[0];
        // (Shift: that unit joins the selected one's group, or leaves it; else it's the one selected.)
        if (shift && sel && military.id !== sel.id) store.group = store.group.includes(military.id) ? store.group.filter((x) => x !== military.id) : [...store.group, military.id];
        else {
          store.selectedUnit = military.id;
          store.group = [];
        }
        store.selectedCity = null;
        store.changed++;
        return;
      }
      if (city?.owner === me()) return openCity(city.id);
      if (!sel) {
        store.selectedCity = null;
        store.changed++;
        return;
      }
    }
  }
  // (Shift is for gathering units: a shift-click off them gives no order.)
  if (!sel || (shift && !right)) return;
  // A finger's first tap on a tile shows the way there (or the attack); a second tap on it goes.
  if (touch && (tapped?.unit !== sel.id || tapped.tile !== t)) {
    store.tap = { unit: sel.id, tile: t };
    store.hover = t;
    store.changed++;
    return;
  }
  // A worker sent to recommended work (`workadvice.ts`): there, and it's begun on arrival.
  const tip = workTip(t);
  if (tip && !enemyAt(t)) return workAt(sel, tip);
  // An enemy it can hit from here: an attack; anywhere else (an enemy further off too), a move (an
  // aircraft's: a rebase, to one of your cities or carriers).
  // A group: all of them there together, at the pace of the slowest.
  if (store.group.length && !enemyAt(t)) {
    marchTo([sel.id, ...store.group], t);
    play('march', 0.8);
    store.group = [];
    store.changed++;
    return;
  }
  if (attackable(sel, t)) send({ t: 'attack', unit: sel.id, target: t });
  else if (UNITS[sel.type]?.domain === 'air') send({ t: 'rebase', unit: sel.id, to: t });
  else {
    // A melee unit sent at an enemy it can reach this turn charges: next to it, then the attack.
    const from = chargeFrom(sel, t);
    if (from !== null) {
      send({ t: 'move', unit: sel.id, to: from });
      send({ t: 'attack', unit: sel.id, target: t });
    } else {
      send({ t: 'move', unit: sel.id, to: t });
      // (Its answer says whether it's taken: then a footfall, the destination marked, the next unit.)
      store.ordered = { unit: sel.id, to: t, at: 0, taken: false };
    }
  }
}

/**
 * A click on the open city's land: a citizen put on the tile (a lock keeps it there), or taken off it
 * (its lock comes off); or, for a tile it could buy, the price asked. False if it isn't the city's.
 */
function cityTile(t: number): boolean {
  const city = myCity(store.selectedCity);
  const info = store.cityInfo;
  const x = city && info?.id === city.id ? info.tiles.find((o) => o.t === t) : undefined;
  if (!city || !x) return false;
  if (x.buyCost !== null) {
    const cost = x.buyCost;
    ask(`Buy this tile for ${city.name} for ${cost} gold? (You have ${store.view!.self.gold}.)`, 'Buy it', () => send({ t: 'buyTile', city: city.id, tile: t }), false);
  } else send({ t: 'work', city: city.id, tile: t });
  return true;
}

/**
 * A box dragged with shift held: the soldiers of yours in it gathered with the selected unit (or, with
 * none selected, the first of them selected and the rest gathered), to be sent together with a click.
 */
function gather(box: { x0: number; y0: number; x1: number; y1: number }) {
  const boxed = flagsIn(box)
    .map((id) => myUnit(id))
    .filter((u): u is UnitWire => !!u && !!UNITS[u.type] && isMilitary(UNITS[u.type]) && UNITS[u.type].domain !== 'air');
  if (!boxed.length) return;
  const lead = myUnit(store.selectedUnit) ?? boxed[0];
  store.selectedUnit = lead.id;
  store.group = [...new Set([...store.group, ...boxed.map((u) => u.id)])].filter((id) => id !== lead.id);
  store.selectedCity = null;
  store.changed++;
}

/** The attack the mouse is over, for its preview: the selected unit's on an enemy in reach, or a city's taking aim. */
export function previewAsk(): PreviewAsk | null {
  const t = store.hover;
  const v = store.view;
  if (t < 0 || !v || v.over || v.spectator) return null;
  if (store.cityTarget !== null) return store.known[t]?.visible && enemyAt(t) && unitsAt(t).length ? { city: store.cityTarget, target: t } : null;
  const sel = myUnit(store.selectedUnit);
  if (!sel) return null;
  if (attackable(sel, t)) return { unit: sel.id, target: t };
  // (A melee unit that would charge it this turn: the fight from where it would attack.)
  const from = enemyAt(t) && store.known[t]?.visible ? chargeFrom(sel, t) : null;
  return from !== null ? { unit: sel.id, target: t, from } : null;
}

export function bindInput() {
  window.addEventListener('contextmenu', (e) => {
    if (onMap(e)) e.preventDefault();
  });
  window.addEventListener('pointerdown', (e) => {
    // (A finger on the interface puts away what a tap on the map showed: the tile's card, the way there; not on the card itself, which has a button.)
    if (!onMap(e)) {
      if (e.pointerType === 'touch' && !onCard(e) && (store.hover >= 0 || store.tap)) {
        store.hover = -1;
        store.tap = null;
        store.changed++;
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    clearTimeout(holding);
    if (pointers.size === 2) {
      // Two fingers: a pinch (not a tap, not a drag), the view moving with them as they go.
      pinch = { apart: apart(), dist: cam.dist, ...between() };
      if (down) down.moved = true;
      return;
    }
    down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, shift: e.shiftKey && e.button === 0 && e.pointerType === 'mouse' };
    // A tile's menu open: a press elsewhere on the map puts it away (and does nothing else; a right-click opens another).
    if (closePinMenu() && e.button !== 2) down.moved = true;
    if (e.pointerType === 'touch') {
      // (What a tap shows of the tile stands by the finger.)
      setTipPosition(e.clientX, e.clientY);
      // (A new touch puts away what the last hold showed.)
      held = false;
      cardTile = -1;
      if (store.hover >= 0 && !store.tap) store.hover = -1;
      const at = { x: e.clientX, y: e.clientY };
      holding = window.setTimeout(() => {
        if (!down || down.moved || pointers.size !== 1) return;
        held = true;
        store.hover = cardTile = hitAt(at.x, at.y)?.tile ?? pick(at.x, at.y);
        setTipPosition(at.x, at.y);
        store.changed++;
      }, HOLD_MS);
    }
  });
  window.addEventListener('pointermove', (e) => {
    setTipPosition(e.clientX, e.clientY);
    const last = pointers.get(e.pointerId);
    if (last) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      zoom((pinch.dist * (pinch.apart / apart())) / cam.dist);
      const mid = between();
      drag(mid.x - pinch.x, mid.y - pinch.y);
      pinch.x = mid.x;
      pinch.y = mid.y;
      return;
    }
    if (down && last && (e.buttons & 7) !== 0) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (down.moved || Math.hypot(dx, dy) > (e.pointerType === 'touch' ? 12 : 6)) {
        down.moved = true;
        clearTimeout(holding);
        // With shift held: a box, to gather the soldiers in it.
        if (down.shift) {
          store.box = { x0: down.x, y0: down.y, x1: e.clientX, y1: e.clientY };
          store.changed++;
          return;
        }
        // Drag: the map follows the mouse (or finger: by how far it's moved, as touches have no movementX).
        drag(e.clientX - last.x, e.clientY - last.y);
      }
    }
    // (A finger shows what's under it only when held: not as it drags past.)
    if (e.pointerType === 'touch') return;
    const t = onMap(e) ? (hitAt(e.clientX, e.clientY)?.tile ?? pick(e.clientX, e.clientY)) : -1;
    if (t !== store.hover) {
      store.hover = t;
    }
  });
  const lift = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  window.addEventListener('pointercancel', (e) => {
    lift(e);
    clearTimeout(holding);
    down = null;
    store.box = null;
  });
  window.addEventListener('pointerup', (e) => {
    lift(e);
    clearTimeout(holding);
    // (A finger lifted: no tooltip left hanging where it was, unless it was held to show it.)
    if (held) {
      held = false;
      down = null;
      return;
    }
    // (Nor a tap on the held tile's card: its buttons are for the tile.)
    if (e.pointerType === 'touch' && !onCard(e)) store.hover = -1;
    const d = down;
    if (pointers.size) return;
    down = null;
    if (store.box) {
      gather(store.box);
      store.box = null;
      return;
    }
    if (!d || d.moved || !onMap(e)) return;
    const hit = hitAt(e.clientX, e.clientY);
    // A right-click with nothing selected to move: the tile's menu (to pin it).
    if (d.button === 2 && tileMenuFree(false)) return openPinMenu(hit?.tile ?? pick(e.clientX, e.clientY), e.clientX, e.clientY);
    act(pick(e.clientX, e.clientY), d.button === 2, hit, e.pointerType === 'touch', e.shiftKey);
  });
  window.addEventListener(
    'wheel',
    (e) => {
      if (!onMap(e)) return;
      zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    },
    { passive: true },
  );
  // Keys. (Escape is ours: it closes a panel, and keeps the board up.)
  window.addEventListener(
    'keydown',
    (e) => {
      // The platform's pause menu up: its keys (Escape goes back to the game).
      if (platformMenuOpen()) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        // Escape leaves the field (and stays the game's: the platform's screens don't hear it); the
        // function keys (F1 closing the Civilopedia...) are still the game's; the rest is typing.
        if (e.code === 'Escape') {
          e.target.blur();
          // (A pin's label: the tile's menu goes with it.)
          closePinMenu();
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        if (!/^F\d+$/.test(e.code)) return;
      }
      const handled = key(e);
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  // What's typed in the game's own fields is theirs alone: it goes no further than the page (the
  // platform hears keys on the window, and would take T or / for its command bar).
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) e.stopPropagation();
  });
  window.addEventListener('keyup', (e) => cam.keys.delete(e.code), true);
  window.addEventListener('blur', () => cam.keys.clear());
}

function key(e: KeyboardEvent): boolean {
  const code = e.code;
  // Chords are the browser's (Cmd+R, Ctrl+F...).
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  // A question on screen: Enter says yes, Escape no, and nothing happens behind it.
  if (store.confirm) {
    if (code === 'Enter' || code === 'NumpadEnter') {
      const q = store.confirm;
      store.confirm = null;
      store.changed++;
      q.then();
    } else if (code === 'Escape') closePanels();
    return true;
  }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(code)) {
    cam.keys.add(code);
    cam.goal = null;
    return true;
  }
  // A big moment in front: Enter or Space goes on past it. A deal in front waits for its answer (Esc: later); nothing happens behind either.
  const shown = front();
  if (shown === 'splash' || shown === 'offer') {
    if (code === 'Escape' || (shown === 'splash' && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space'))) closePanels();
    return true;
  }
  if (!store.view || store.view.spectator) {
    // The lobby, or watching: only the Civilopedia (F1, and Escape to close it).
    if (code === 'F1' || (code === 'Escape' && store.panel)) {
      store.panel = code === 'F1' && store.panel !== 'pedia' ? 'pedia' : null;
      store.changed++;
    }
    return code === 'Escape' || code === 'F1';
  }
  // The shortcuts overlay: ? (wherever the layout puts it; / alone stays the platform's command bar).
  if (e.key === '?') {
    togglePanel('keys');
    return true;
  }
  // Orders for the selected unit only with nothing in front of the map.
  const orders = !store.panel;
  const sel = orders ? myUnit(store.selectedUnit) : undefined;
  switch (code) {
    case 'Escape':
      if (store.cityTarget !== null || store.unitAim) {
        store.cityTarget = null;
        store.unitAim = null;
        store.changed++;
      } else closePanels();
      return true;
    case 'Enter':
    case 'NumpadEnter':
      endTurnAction();
      return true;
    case 'Space':
      if (orders) selectNextIdle();
      return true;
    case 'KeyF':
      // (Mounted units, armour and ships can't fortify: they sleep, Civ V's way of holding a place.)
      if (sel) send({ t: 'stance', unit: sel.id, stance: UNITS[sel.type] && canFortify(UNITS[sel.type]) ? 'fortify' : 'sleep' });
      return true;
    case 'KeyZ':
      if (sel) send({ t: 'stance', unit: sel.id, stance: 'sleep' });
      return true;
    case 'KeyB':
      if (sel) send({ t: 'found', unit: sel.id });
      return true;
    case 'KeyT':
      store.panel = store.panel === 'tech' ? null : 'tech';
      store.changed++;
      return true;
    case 'KeyR':
      store.panel = store.panel === 'religion' ? null : 'religion';
      store.changed++;
      return true;
    case 'KeyP':
      store.panel = store.panel === 'policies' ? null : 'policies';
      store.changed++;
      return true;
    case 'F1': {
      // Over the map: the article for what's there.
      const there = store.hover >= 0 && !store.panel ? tileArticle(store.hover) : null;
      if (store.panel === 'pedia') togglePanel('pedia');
      else openPedia(there ?? undefined);
      return true;
    }
    case 'Comma':
    case 'Period':
      if (orders) selectNextIdle(code === 'Comma' ? -1 : 1);
      return true;
    case 'KeyO':
    case 'F2':
      if (store.panel === 'overview') togglePanel('overview');
      else openOverview('cities');
      return true;
    case 'F3':
      openOverview('units');
      return true;
    case 'F9':
      openOverview('demographics');
      return true;
    case 'F4':
      togglePanel('diplomacy');
      return true;
    case 'F6':
      togglePanel('tech');
      return true;
    case 'KeyN':
    case 'F7':
      togglePanel('notes');
      return true;
    case 'KeyV':
    case 'F8':
      togglePanel('victory');
      return true;
    case 'KeyX':
      if (sel) send({ t: 'skip', unit: sel.id });
      return true;
    case 'KeyE': {
      // Automate: a worker improves the land, a soldier or a warship explores (the unit card's buttons); again, it stops.
      const type = sel && UNITS[sel.type];
      if (!sel || !type) return true;
      const work = type.abilities?.includes('build') || type.abilities?.includes('build_sea');
      if (sel.auto) send({ t: 'automate', unit: sel.id, mode: null });
      else if (work || explores(sel)) send({ t: 'automate', unit: sel.id, mode: work ? 'work' : 'explore' });
      return true;
    }
    case 'KeyU':
      if (sel) send({ t: 'upgrade', unit: sel.id });
      return true;
    case 'Delete':
    case 'Backspace':
      if (sel) ask(`Disband this ${UNITS[sel.type]?.name ?? 'unit'}? It's gone for good.`, 'Disband', () => send({ t: 'disband', unit: sel.id }));
      return true;
    case 'Equal':
    case 'NumpadAdd':
      zoom(1 / 1.25);
      return true;
    case 'Minus':
    case 'NumpadSubtract':
      zoom(1.25);
      return true;
    case 'KeyH':
      store.interfaceHidden = !store.interfaceHidden;
      store.changed++;
      return true;
    case 'KeyY':
      toggleLens();
      return true;
    case 'KeyL':
      cycleLens();
      return true;
    case 'KeyC': {
      // Centre on the selected unit (or the capital).
      if (!orders) return true;
      const target = sel?.tile ?? store.view.cities.find((c) => c.owner === me() && c.capital)?.tile;
      if (target !== undefined && store.grid) {
        const c = centreHere(store.grid, target);
        cam.goal = { x: c.x, z: c.z };
      }
      return true;
    }
  }
  return false;
}
