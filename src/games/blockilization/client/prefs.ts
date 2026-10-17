import type { Client } from '@platform/client';
import { NOTE_TOPICS, type NoteTopic } from '../rules/state';

/**
 * A player's preferences (sound, the advisor's tips, selecting the next unit after a move, quick movement and combat, the interface's size and colours): kept for them on the server (`player.store`,
 * so they follow a signed-in player anywhere), as the game's frame has no storage of its own. The
 * server sends them as the player joins; each change goes back.
 */

export interface Prefs {
  muted?: boolean;
  tips?: boolean;
  /** Tips dismissed for good. */
  seen?: string[];
  /** After a move that uses up a unit's moves, select the next unit waiting for orders (Civ V's way). */
  autoNext?: boolean;
  /** The advisor's tip on show, and the turn it came up on ('key@turn'): kept, so it counts as read once that turn's over, however often the player comes and goes. */
  shown?: string;
  /** Civ V's quick movement and quick combat: units' marches and fights as they are, faster, or not shown (`pace.ts`). */
  moves?: Pace;
  combat?: Pace;
  /** How big the interface is, against what suits the screen: smaller, as it is, larger, larger still. */
  uiSize?: UiSize;
  /** Good and bad in green and red, or (for colour blindness) in blue and orange. */
  palette?: Palette;
  /** The kinds of news quietened: kept in the notifications, not shown as they come. */
  quiet?: NoteTopic[];
}

export type UiSize = 'small' | 'normal' | 'large' | 'larger';
export const UI_SIZES: UiSize[] = ['small', 'normal', 'large', 'larger'];
export type Palette = 'standard' | 'colourblind';

/** The kinds of news a player may quieten, and what each is called. */
export const TOPIC_NAMES: [NoteTopic, string][] = [
  ['wonders', 'Others’ wonders'],
  ['quests', 'City-state quests'],
  ['congress', 'The World Congress'],
  ['religion', 'Religion news'],
  ['wars', 'Others’ wars'],
];

/** How a kind of animation plays: as it is, faster, or not at all (what it shows simply is). */
export type Pace = 'normal' | 'fast' | 'skip';
const PACES: Pace[] = ['normal', 'fast', 'skip'];

let client: Client | null = null;
export const prefs: Required<Prefs> = { muted: false, tips: true, seen: [], autoNext: true, shown: '', moves: 'normal', combat: 'normal', uiSize: 'normal', palette: 'standard', quiet: [] };
const listeners: (() => void)[] = [];

export function bindPrefs(c: Client) {
  client = c;
}

/** When the server's copy arrives. */
export function loadPrefs(p: Prefs) {
  if (typeof p?.muted === 'boolean') prefs.muted = p.muted;
  if (typeof p?.tips === 'boolean') prefs.tips = p.tips;
  if (Array.isArray(p?.seen)) prefs.seen = p.seen.filter((x) => typeof x === 'string').slice(0, 100);
  if (typeof p?.autoNext === 'boolean') prefs.autoNext = p.autoNext;
  if (typeof p?.shown === 'string') prefs.shown = p.shown;
  if (PACES.includes(p?.moves as Pace)) prefs.moves = p.moves!;
  if (PACES.includes(p?.combat as Pace)) prefs.combat = p.combat!;
  if (UI_SIZES.includes(p?.uiSize as UiSize)) prefs.uiSize = p.uiSize!;
  if (p?.palette === 'standard' || p?.palette === 'colourblind') prefs.palette = p.palette;
  if (Array.isArray(p?.quiet)) prefs.quiet = NOTE_TOPICS.filter((t) => p.quiet!.includes(t));
  for (const f of listeners) f();
}

export function onPrefs(f: () => void) {
  listeners.push(f);
}

/** Change some and keep them. */
export function setPrefs(p: Prefs) {
  Object.assign(prefs, p);
  client?.send('prefs', prefs);
}
