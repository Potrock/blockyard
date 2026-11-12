import type { GameContext, Player } from '@platform';
import { tamesOf } from '../creatures/tames';
import { glyphCell, ICON_COLUMNS } from './icons';
import { countItems } from './pack';
import { gainXp } from './progress';
import { touch, type Survivor } from './state';

/**
 * A castaway's first steps: a short chain of goals in the corner of the screen, one at a time,
 * each saying what to do and how, and each worth a little experience. They never stand in the
 * way: a goal that's already true when its turn comes is ticked off at once, and the whole card
 * can be hidden (and brought back) from the journal. How far along a survivor is, is kept with
 * them.
 */

export const GOAL_CARD = 'bt-goal';

/** One count a goal asks for: how much of it they have now, and how much it takes. */
interface Part {
  label: string;
  have: number;
  need: number;
}

export interface Goal {
  id: string;
  title: string;
  /** How it's done, in the keys and clicks it takes. */
  hint: string;
  xp: number;
  /** What it counts (it's done when every count is met). */
  parts(player: Player, s: Survivor): Part[];
}

const carried = (player: Player, item: string, need: number, label: string): Part => ({ label, have: Math.min(need, countItems(player, item)), need });
const once = (done: boolean): Part[] => [{ label: '', have: done ? 1 : 0, need: 1 }];

/**
 * The goals, in order. The numbers follow the recipes: ten thatch and two wood are a pick and a
 * hatchet's worth, two stone and two flint their heads.
 */
export const GOALS: readonly Goal[] = [
  {
    id: 'forage',
    title: 'Gather thatch and wood',
    hint: 'Hold the left mouse button on a tree trunk. Bare hands are slow, but they work.',
    xp: 10,
    parts: (p) => [carried(p, 'thatch', 10, 'thatch'), carried(p, 'wood', 2, 'wood')],
  },
  {
    id: 'stones',
    title: 'Find stone and flint',
    hint: 'Hold the left mouse button on sand or soil. A patch gives one find, then try the next.',
    xp: 10,
    parts: (p) => [carried(p, 'stone', 2, 'stone'), carried(p, 'flint', 2, 'flint')],
  },
  {
    id: 'pick',
    title: 'Make a stone pick',
    hint: 'Press Tab, open Handcraft and press Make. A pick breaks rock for stone and flint.',
    xp: 15,
    parts: (p, s) => once(s.deeds.has('made:stone_pick') || countItems(p, 'stone_pick') > 0),
  },
  {
    id: 'hatchet',
    title: 'Make a stone hatchet',
    hint: 'Tab, Handcraft. A hatchet fells trees for wood, many times faster than hands.',
    xp: 15,
    parts: (p, s) => once(s.deeds.has('made:stone_hatchet') || countItems(p, 'stone_hatchet') > 0),
  },
  {
    id: 'drink',
    title: 'Drink',
    hint: 'Walk to the sea or a pool, look at the water and press E.',
    xp: 10,
    parts: (_p, s) => once(s.deeds.has('drank')),
  },
  {
    id: 'berries',
    title: 'Pick berries',
    hint: 'Berry bushes grow inland. Eat with the right mouse button; animals like them too.',
    xp: 10,
    parts: (p) => [carried(p, 'berries', 10, 'berries')],
  },
  {
    id: 'campfire',
    title: 'Light a campfire',
    hint: 'Make one in Handcraft, hold it and place it with the right mouse button, then press E on it.',
    xp: 25,
    parts: (_p, s) => once(s.deeds.has('campfire')),
  },
  {
    id: 'cook',
    title: 'Cook a meal',
    hint: 'Hunt for raw meat, then cook it at the campfire (E). Cooked food fills you far better.',
    xp: 20,
    parts: (_p, s) => once(s.deeds.has('cooked')),
  },
  {
    id: 'learn',
    title: 'Learn something new',
    hint: 'Every level brings sparks. Spend one in the journal under Know-how (Tab).',
    xp: 10,
    parts: (_p, s) => once(s.learned.size > 0),
  },
  {
    id: 'tame',
    title: 'Tame a dodo',
    hint: 'Hold berries, walk up slowly and press E to feed it, again and again, until it trusts you.',
    xp: 40,
    parts: (p, s) => once(s.deeds.has('tamed') || tamesOf(p).length > 0),
  },
  {
    id: 'bed',
    title: 'Make a bedroll',
    hint: 'Learn it under Know-how, make it, place it and press E on it. You wake there if you die.',
    xp: 30,
    parts: (_p, s) => once(s.bed !== null),
  },
];

/** Note something done once that a goal asks about. */
export function deed(s: Survivor, name: string): void {
  if (s.deeds.has(name)) return;
  s.deeds.add(name);
  s.dirty = true;
}

/** Hide the goals, or bring them back. */
export function toggleGoals(s: Survivor): void {
  s.goalsOff = !s.goalsOff;
  touch(s);
}

export const goalsDone = (s: Survivor): boolean => s.goal >= GOALS.length;

/** Seconds a finished goal's tick stays up before the next goal shows. */
const TICK_SHOWS = 3;

/**
 * Every step: tick off the goal in hand if it's met (its experience, a sound, a moment to read
 * it), and show the card as it stands. Hidden goals still count, so bringing them back shows the
 * right one.
 */
export function stepGoals(player: Player, s: Survivor, dt: number): void {
  if (s.goalDone) {
    s.goalDone.left -= dt;
    if (s.goalDone.left <= 0) s.goalDone = null;
  }
  const goal = GOALS[s.goal];
  let parts: Part[] = [];
  if (goal && !s.goalDone) {
    parts = goal.parts(player, s);
    if (parts.every((part) => part.have >= part.need)) {
      s.goal++;
      s.goalDone = { title: goal.title, xp: goal.xp, left: TICK_SHOWS };
      gainXp(player, goal.xp);
      player.audio.play('bt_goal');
      touch(s);
    }
  }
  show(player, s, goal, parts);
}

function show(player: Player, s: Survivor, goal: Goal | undefined, parts: Part[]): void {
  const up = !s.goalsOff && player.alive && (!!s.goalDone || !!goal);
  if (!up) {
    if (s.goalShown !== '') {
      s.goalShown = '';
      player.hud.widget(GOAL_CARD).remove();
    }
    return;
  }
  const done = s.goalDone;
  const data = done
    ? { n: s.goal, of: GOALS.length, done: true, c: 'done', title: done.title, hint: s.goal >= GOALS.length ? 'That is the start of it. The island is yours to work out.' : '', xp: done.xp, parts: [] }
    : {
        n: s.goal + 1,
        of: GOALS.length,
        done: false,
        c: '',
        title: goal!.title,
        hint: goal!.hint,
        xp: goal!.xp,
        parts: parts.filter((part) => part.label).map((part) => ({ t: `${part.have}/${part.need} ${part.label}`, c: part.have >= part.need ? 'ok' : '' })),
      };
  const key = JSON.stringify(data);
  if (key === s.goalShown) return;
  s.goalShown = key;
  player.hud.widget(GOAL_CARD, data);
}

/** They left or the game began again: their card is sent afresh next time. */
export function resetGoalCard(s: Survivor): void {
  s.goalShown = '';
  s.goalDone = null;
}

const HTML = `
<div class="gc {{c}}">
  <div class="hd"><span>First steps</span><b>{{n}} / {{of}}</b></div>
  <div class="tt"><i class="ic" data-if="done"></i><b>{{title}}</b><em>+{{xp}} xp</em></div>
  <p data-if="hint">{{hint}}</p>
  <div class="pp" data-if="!done"><span data-each="parts" class="{{c}}">{{t}}</span></div>
</div>`;

const css = (glyphsUrl: string) => `
:scope { margin: 14px 0 0 14px }
.gc { width: 250px; padding: 8px 10px 9px; color: #efe9da; font: 13px/1.35 var(--sans); background: #141811d9; border: 2px solid #3f4a37; border-left: 4px solid #f2b84b; border-radius: 8px;
  animation: in 0.35s ease-out }
.gc.done { border-color: #7fbf4d }
.hd { display: flex; justify-content: space-between; font: 700 10px var(--sans); letter-spacing: 0.14em; text-transform: uppercase; color: #a9b593 }
.hd b { color: #d8e3bd }
.tt { display: flex; align-items: center; gap: 6px; margin-top: 2px; font-size: 15px }
.tt em { margin-left: auto; font: 700 11px var(--sans); color: #9bd45a; white-space: nowrap }
.gc.done .tt b { color: #b9e88a }
.ic { display: block; flex: none; width: 16px; height: 16px; background: url(${glyphsUrl}) no-repeat; background-size: ${16 * ICON_COLUMNS}px 16px;
  background-position: ${-16 * glyphCell('star').x}px 0; image-rendering: pixelated }
p { margin: 4px 0 0; color: #c3cbb2 }
.pp { display: flex; gap: 6px; margin-top: 6px }
.pp span { padding: 1px 7px; border-radius: 9px; background: #2c3526; font: 700 12px var(--sans); color: #ffd9a0 }
.pp span.ok { background: #35502a; color: #b9e88a }
@keyframes in { from { opacity: 0; transform: translateX(-10px) } to { opacity: 1; transform: none } }
@media (max-width: 760px) { .gc { width: 200px; font-size: 12px } }
`;

export function defineGoals(game: GameContext, glyphsUrl: string): void {
  game.hud.define(GOAL_CARD, { at: 'top-left', html: HTML, css: css(glyphsUrl) });
}
