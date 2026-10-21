import type { Client } from '@platform/client';
import type { FightWire, View } from '../protocol';
import { icon } from './icons';
import { combatSpeed, marchSpeed } from './pace';
import { store } from './store';
import { h, scaledCss } from './ui';

/**
 * The turn handed over. While the bots play the turn just begun (the server says so: `View.moving`),
 * a quiet "The world moves…" shows at the foot of the screen; the fights they start that this
 * screen sees are held back meanwhile. When their moves come (all in one view), what can be seen of
 * them is played out civ by civ, in the order they played: each civ's units march together
 * (`models3d.ts` asks when each civ's turn on the screen begins), then its fights land. The whole
 * is kept short however many civs moved; anything off the screen is simply there.
 */

/** A civ's turn on the screen: its marches, then a moment between fights, then a breath before the next. */
const FIGHT_GAP = 0.35;
const CIV_GAP = 0.25;
/** The most the hand-over takes (civs overlap to fit), and the least the words stay up. */
const MOST = 6;
const LEAST = 1.2;
/** How long a unit in a held fight stays where it is after its fight is shown (its lunge, its fall). */
const LINGER = 0.6;

/** A time's share at a speed (quick movement or combat): a third at 3, none when not shown. */
const pace = (speed: number) => (speed ? 1 / speed : 0);

/** The bots are playing; their moves have just come (the next frame of the models stages them). */
let moving = false;
let staging = false;
/** Fights seen while the bots played, each with whose turn it was (the attacker's civ, or -1 unknown). */
let held: { fight: FightWire; owner: number }[] = [];
/** Held fights put on the screen's time: when each is shown. */
let timed: { fight: FightWire; at: number; shown: boolean }[] = [];
/** When the hand-over on the screen ends, and since when the words have been up (or null). */
let until = 0;
let upSince: number | null = null;
let words: HTMLElement | null = null;

/** The words, put in the interface (its root, for its look). */
export function mountHandover(client: Client, layer: HTMLElement) {
  client.hud.style(scaledCss(HANDOVER_CSS));
  words = h(
    'div.ho-moves.cv-panel',
    {},
    icon('globe', 18),
    h('b', {}, 'The world moves'),
    h('span.dots', {}, h('i', {}, '.'), h('i', {}, '.'), h('i', {}, '.')),
  );
  (layer.querySelector('.cv-root') ?? layer).append(words);
}

/** A game gone from the screen (back to the lobby, another game's map, another room): nothing is moving or waiting to be shown. */
export function resetHandover() {
  moving = staging = false;
  held = [];
  timed = [];
  until = 0;
  upSince = null;
}

/** A view came: the bots began (or are still) playing, or they're done and their moves are here. */
export function handoverView(v: View) {
  if (v.moving) moving = true;
  else if (moving) {
    moving = false;
    staging = true;
  }
}

/** Fights others started: while the bots play, held back for their civ's turn on the screen (true), else shown now. */
export function holdFights(fights: FightWire[]): boolean {
  if (!moving) return false;
  const v = store.view;
  for (const fight of fights) {
    const by = fight.attacker >= 0 ? v?.units.find((u) => u.id === fight.attacker)?.owner : v?.cities.find((c) => c.id === -fight.attacker)?.owner;
    held.push({ fight, owner: by ?? -1 });
  }
  return true;
}

/** Whether the bots' moves have just come (the models stage what they see of them this frame). */
export const handoverStaging = () => staging;

/**
 * The bots' moves seen: each moving unit's civ and how long its march takes (seconds). Each civ is
 * given its turn on the screen, in the order they played, and its fights are timed to land after
 * its marches. Returns when each civ's units set off.
 */
export function stageHandover(marches: { owner: number; time: number }[], now: number): Map<number, number> {
  staging = false;
  const owners = [...new Set([...marches.map((m) => m.owner), ...held.map((x) => x.owner)])].sort((a, b) => a - b);
  // (Quick movement and combat: the gaps shrink with them, or go.)
  const fightGap = FIGHT_GAP * pace(combatSpeed());
  const civGap = CIV_GAP * Math.min(pace(marchSpeed()), pace(combatSpeed()));
  const turns = owners.map((owner) => {
    const time = Math.max(0, ...marches.filter((m) => m.owner === owner).map((m) => m.time));
    const fights = held.filter((x) => x.owner === owner).map((x) => x.fight);
    return { owner, time, fights, length: time + fights.length * fightGap + civGap };
  });
  const total = turns.reduce((sum, t) => sum + t.length, 0);
  const squeeze = total > MOST ? MOST / total : 1;
  const starts = new Map<number, number>();
  let at = now;
  until = now;
  for (const t of turns) {
    starts.set(t.owner, at);
    t.fights.forEach((fight, i) => timed.push({ fight, at: at + t.time + i * fightGap, shown: false }));
    until = Math.max(until, at + t.length);
    at += t.length * squeeze;
  }
  held = [];
  return starts;
}

/**
 * Whether a unit gone from the view stays on the screen a while: one in a fight still to be shown
 * (the attacker, or a defender that falls), until just after it is.
 */
export function lingers(id: number, tile: number, now: number): boolean {
  const inIt = (f: FightWire) => f.attacker === id || (f.killed && f.at === tile);
  return held.some((x) => inIt(x.fight)) || timed.some((x) => inIt(x.fight) && now < x.at + LINGER * pace(combatSpeed()));
}

/** Each frame: held fights shown when their time comes (`show`), and the words up while the world moves. */
export function frameHandover(now: number, show: (fights: FightWire[], now: number) => void) {
  const due = timed.filter((x) => !x.shown && x.at <= now);
  for (const x of due) x.shown = true;
  if (due.length) show(due.map((x) => x.fight), now);
  timed = timed.filter((x) => now < x.at + LINGER * pace(combatSpeed()));
  const busy = moving || staging || now < until;
  if (busy && upSince === null) upSince = now;
  if (!busy && upSince !== null && now - upSince >= LEAST) upSince = null;
  const on = upSince !== null && !!store.view && !store.view.over;
  words?.classList.toggle('on', on);
  // (Over the advisor's tip or an attack's preview, when one's at the foot of the screen too.)
  if (on && words) {
    const below = words.parentElement?.querySelector('.cv-advisor, .cv-preview');
    words.style.bottom = below ? `${Math.round((window.innerHeight - below.getBoundingClientRect().top) / store.uiScale + 6)}px` : '';
  }
}

export const HANDOVER_CSS = `
.ho-moves { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 4px 12px 5px !important; opacity: 0; visibility: hidden; transition: opacity .3s steps(3, end), visibility 0s .3s; pointer-events: none; }
.ho-moves.on { opacity: 1; visibility: visible; transition: opacity .3s steps(3, end); }
.ho-moves b { font: 400 20px/1 'Jersey 10', 'Tiny5', monospace; letter-spacing: .03em; color: #eef1f5; text-shadow: 2px 2px 0 #0b0d12; }
.ho-moves .cv-i { color: #9fd0ff; }
.ho-moves .dots { display: flex; width: 18px; margin-left: -6px; }
.ho-moves .dots i { width: 6px; font: 400 20px/1 'Jersey 10', monospace; font-style: normal; color: #eef1f5; text-shadow: 2px 2px 0 #0b0d12; visibility: hidden; animation: hoDot 1.6s steps(1, end) infinite; }
.ho-moves .dots i:nth-child(2) { animation-name: hoDot2; } .ho-moves .dots i:nth-child(3) { animation-name: hoDot3; }
@keyframes hoDot { 25% { visibility: visible; } }
@keyframes hoDot2 { 50% { visibility: visible; } }
@keyframes hoDot3 { 75% { visibility: visible; } }
@media (max-width: 760px), (max-height: 520px) { .ho-moves { bottom: auto !important; top: 58px; } }
`;
