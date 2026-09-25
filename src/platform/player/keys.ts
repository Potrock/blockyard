/**
 * Rebindable controls. The platform and every game read keys by their default codes ('KeyW',
 * 'ShiftLeft', 'ControlLeft'…), so a binding works by translation at the source: `Input` turns
 * the key the player pressed into the code its action is read by. Games, the simulation and
 * online prediction all go on seeing the default codes and need no changes.
 */

export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sneak' | 'sprint';

/** The actions that can be rebound, with their default keys (the codes the game reads). */
export const ACTIONS: readonly { id: Action; label: string; key: string }[] = [
  { id: 'forward', label: 'Forward', key: 'KeyW' },
  { id: 'back', label: 'Back', key: 'KeyS' },
  { id: 'left', label: 'Left', key: 'KeyA' },
  { id: 'right', label: 'Right', key: 'KeyD' },
  { id: 'jump', label: 'Jump', key: 'Space' },
  { id: 'sneak', label: 'Sneak', key: 'ShiftLeft' },
  { id: 'sprint', label: 'Sprint', key: 'ControlLeft' },
];

/** The player's changes from the defaults: action -> key code. Actions left out keep their default. */
export type KeyBindings = Partial<Record<Action, string>>;

/**
 * Keys that can't be bound: Escape (pause, and cancelling a rebind), F1 and F3 (HUD and debug),
 * and Cmd / the Windows key, whose browser and system shortcuts (Cmd+W closes the tab) a page
 * can't stop.
 */
const RESERVED = new Set(['Escape', 'F1', 'F3', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

/** Left and right modifiers count as one key: binding either binds both. */
const PAIRS = ['Shift', 'Control', 'Alt'];

export function normalize(code: string): string {
  for (const p of PAIRS) if (code === `${p}Right`) return `${p}Left`;
  return code;
}

function sides(code: string): string[] {
  for (const p of PAIRS) if (code === `${p}Left`) return [code, `${p}Right`];
  return [code];
}

export function canBind(code: string): boolean {
  return code !== '' && code !== 'Unidentified' && !RESERVED.has(code);
}

export function keyFor(b: KeyBindings, action: Action): string {
  return b[action] ?? ACTIONS.find((a) => a.id === action)!.key;
}

/**
 * Bind `action` to `code`. Whichever action had that key takes this one's old key instead (a
 * swap), so two actions never share a key: Sprint on Shift puts Sneak on Ctrl.
 */
export function rebind(b: KeyBindings, action: Action, code: string): KeyBindings {
  const key = normalize(code);
  const old = keyFor(b, action);
  const next: KeyBindings = {};
  for (const a of ACTIONS) {
    let k = keyFor(b, a.id);
    if (a.id === action) k = key;
    else if (k === key) k = old;
    if (k !== a.key) next[a.id] = k;
  }
  return next;
}

/** Only known actions bound to plain key codes (settings come from storage). */
export function sanitize(raw: unknown): KeyBindings {
  const out: KeyBindings = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const a of ACTIONS) {
    const k = (raw as Record<string, unknown>)[a.id];
    if (typeof k === 'string' && canBind(k)) out[a.id] = normalize(k);
  }
  // Rebuilding through `rebind` settles any two actions left on the same key.
  let b: KeyBindings = {};
  for (const a of ACTIONS) if (out[a.id]) b = rebind(b, a.id, out[a.id]!);
  return b;
}

/**
 * What each physical key reads as under `b`: the default code of the action bound to it, or null
 * for a default key whose action has moved elsewhere. Keys not in the map read as themselves.
 */
export function translation(b: KeyBindings): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const a of ACTIONS) if (keyFor(b, a.id) !== a.key) for (const c of sides(a.key)) m.set(c, null);
  for (const a of ACTIONS) {
    const k = keyFor(b, a.id);
    if (k !== a.key) for (const c of sides(k)) m.set(c, a.key);
  }
  return m;
}

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

const NAMES: Record<string, string> = {
  ShiftLeft: 'Shift',
  ControlLeft: 'Ctrl',
  AltLeft: mac ? 'Option' : 'Alt',
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  CapsLock: 'Caps Lock',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/** A key code as a player would name it: 'KeyW' -> 'W', 'ShiftLeft' -> 'Shift'. */
export function keyLabel(code: string): string {
  const c = normalize(code);
  if (NAMES[c]) return NAMES[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  if (c.startsWith('Numpad')) return `Num ${c.slice(6)}`;
  return c;
}

/** The bound key's name for an action. */
export function actionLabel(b: KeyBindings, action: Action): string {
  return keyLabel(keyFor(b, action));
}

/** 'WASD', or whatever the four movement keys are now ('ESDF', or '↑←↓→'). */
export function moveLabel(b: KeyBindings): string {
  const keys = (['forward', 'left', 'back', 'right'] as const).map((a) => actionLabel(b, a));
  return keys.every((k) => [...k].length === 1) ? keys.join('') : keys.join(' ');
}

/**
 * A control hint written for the default keys ('Ctrl', 'W / S', 'Space / Shift'), with the keys
 * the player has bound instead. Words that aren't a default action key ('LMB', 'Wheel', 'E') stay.
 */
export function relabel(b: KeyBindings, hint: string): string {
  return hint.replace(/[A-Za-z]+/g, (word) => {
    const a = ACTIONS.find((x) => keyLabel(x.key) === word);
    return a ? actionLabel(b, a.id) : word;
  });
}
