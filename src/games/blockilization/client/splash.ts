import type { Client } from '@platform/client';
import { centre } from '../geometry';
import { cam, lookAt } from './camera';
import { emblemEl } from './icons';
import { endingDone, endingScene, ENDING_CSS, frameEnding } from './ending';
import { landmarkPicture } from './landmarkart';
import { eraRoom, leaderScene } from './leaderscene';
import { revealWonder } from './naturefx';
import { combatSpeed, marchSpeed } from './pace';
import { PICTURES, type PictureId } from './picturefiles';
import { store, type Splash } from './store';
import { click, front, h, tile, type El } from './ui';
import { celebrateWonder } from './worldfx';

/**
 * The big moments on the screen, one at a time (a single queue, `store.splashes`: a wonder built, a
 * new era, a natural wonder found, first contact...). A big one is a card in the middle: a wonder's
 * turning in it as the camera goes to see it standing in its city (its beams and fireworks once
 * it's there), a new era's room behind its name, a natural wonder's camera reveal. A light one (a
 * great person born, a golden age, a faith founded, another civ's wonder) is a small card at the top
 * for a few seconds, the map left free; another civ's wonder that can be seen gets a short flyover,
 * the camera coming back after. All go at a click (or a tap), and by themselves after a while.
 *
 * Quick movement and combat (`pace.ts`) set their pace: fast, they're on show half as long; either
 * off, every moment is a small note only, the camera left where it is (`moments.ts`).
 */

/** How long a big card, a light one and the game's end are on show by themselves (seconds, at the normal pace). */
const BIG = 7;
const LIGHT = 3.5;
const ENDING = 9;
/** How far below the card the camera puts what it visits (a share of its distance: the card's over the middle). */
const UNDER_CARD = 0.3;
const OVER_BAR = 0.05;
/** Seconds after a visit begins that the camera's there (a wonder's beams wait for it). */
const ARRIVE = 0.8;

/** The pace moments go at: the slower of quick movement and quick combat (0: off, small notes only; 3: fast). */
export const momentPace = () => Math.min(marchSpeed(), combatSpeed());

/** How long a moment's on show by itself (seconds). */
export const splashSeconds = (s: Splash | undefined) => (s?.ending ? ENDING / (momentPace() > 1 ? 1.5 : 1) : (s?.light ? LIGHT : BIG) / (momentPace() > 1 ? 2 : 1));

// -------------------------------------------------------------------------------------------------
// The camera

/** The moment the camera's attending to, since when, where the camera was before it (to go back to), and whether its wonder's been celebrated. */
let current: Splash | null = null;
let since = 0;
let home: { x: number; z: number } | null = null;
let celebrated = false;

/** Each frame: a moment newly on show sends the camera to it; one gone brings it back, if it should. */
export function frameMoments(client: Client) {
  const g = store.grid;
  const s = g && front() === 'splash' ? (store.splashes[0] ?? null) : null;
  if (s !== current) {
    if (current?.ending) endingDone(client);
    if (current?.back && home) lookAt(home.x, home.z);
    home = null;
    current = s;
    since = client.time;
    celebrated = false;
    // (The game's end brings the camera in close first: where it looks is worked out from there.)
    if (s?.ending) frameEnding(client, s);
    if (s?.landmark && s.at !== undefined) revealWonder(s.at);
    else if (s?.visit !== undefined && g) {
      if (s.back) home = { x: cam.x, z: cam.z };
      const c = centre(g, s.visit);
      // (Under a card in the middle; a little over the middle in the game's end, its words in the bar below.)
      lookAt(c.x, c.z - (s.light ? 0 : s.ending ? -cam.dist * OVER_BAR : cam.dist * UNDER_CARD));
    }
  } else if (s?.ending) frameEnding(client, s);
  // A wonder's beams and fireworks once the camera's there.
  if (s?.turn && s.visit !== undefined && !celebrated && client.time - since > ARRIVE) {
    celebrated = true;
    celebrateWonder(client, s.visit);
  }
}

// -------------------------------------------------------------------------------------------------
// The card

/** The card on show, kept while it's the same moment (its turning and its room play on through redraws). */
let card: { s: Splash; el: El } | null = null;

/** Put the moment on show away (the next comes up). */
function next() {
  store.splashes.shift();
  store.splashAt = 0;
  store.changed++;
}

/** The moment at the head of the queue, as its card. */
export function splashCard(now: number): El | null {
  const s = store.splashes[0];
  if (!s) return null;
  if (!store.splashAt) store.splashAt = now;
  const more = store.splashes.length - 1;
  if (card?.s !== s) card = { s, el: s.ending ? endingScene(s, next) : s.light ? lightCard(s) : bigCard(s) };
  // (Its count of what's still to come, kept up to date.)
  const hint = card.el.querySelector('.go');
  if (hint) hint.textContent = more ? `${click(true)} to continue (${more} more)` : `${click(true)} to continue`;
  return card.el;
}

/** A moment's picture: a wonder turning, an era's room, a natural wonder, a picture, an emblem, a glyph on a tile. */
function art(s: Splash, size: number): El | null {
  if (s.turn) return h('div.sp-turn', { style: `background-image:url("${PICTURES[s.turn as PictureId] ?? ''}");width:${size}px;height:${size}px` });
  if (s.room !== undefined) return eraRoom(s.room, store.view?.players[store.view.you]?.civ ?? '');
  // (A leader's scene on a big card; on a small one, their picture.)
  const leader = s.leader && store.view?.players[s.leader.player];
  if (leader && size > 64) return leaderScene(leader, { kind: s.leader!.kind });
  if (s.landmark) return h('img', { src: landmarkPicture(s.landmark), alt: '' });
  if (s.picture) return h('img', { src: PICTURES[s.picture as PictureId] ?? '', alt: '' });
  if (s.emblem) return emblemEl(s.emblem.civ, Math.round(size * 0.75), s.emblem.kind);
  if (s.glyph) return tile(s.glyph.name, s.glyph.color, Math.round(size * 0.75));
  return null;
}

function bigCard(s: Splash): El {
  const picture = art(s, 128);
  return h(
    `div.cv-splash.cv-panel${s.room !== undefined ? '.era' : ''}${s.sober ? '.sober' : ''}`,
    { onclick: next },
    h('div.kick', {}, s.kick),
    picture && h(`div.art${s.room !== undefined || s.leader ? '.room' : ''}`, {}, picture),
    h('div.words', {}, h('h2', {}, s.title), s.quote ? h('q.sp-quote', {}, s.quote) : null, h('p', {}, s.text), h('small.go', {})),
  );
}

function lightCard(s: Splash): El {
  return h('div.cv-splash.cv-panel.light', { onclick: next }, h('div.art', {}, art(s, 48)), h('div.words', {}, h('div.kick', {}, s.kick), h('b', {}, s.title), h('small', {}, s.text)));
}

export const SPLASH_CSS = `
.sp-turn { background-repeat: no-repeat; background-size: 1200% 100%; animation: spTurn 4.8s steps(12, end) infinite; }
@keyframes spTurn { from { background-position: 0 0; } to { background-position: calc(100% * 12 / 11) 0; } }
.cv-splash .art.room { width: 264px !important; height: 160px !important; padding: 0; background: none !important; box-shadow: none !important; }
.cv-splash .sp-quote { display: block; margin: 8px auto 0; max-width: 340px; font: italic 400 15px/1.4 'Chakra Petch', system-ui, sans-serif; color: #e8dcc0; quotes: '“' '”'; }
.cv-splash .sp-quote::before { content: open-quote; } .cv-splash .sp-quote::after { content: close-quote; }
.cv-splash.era { width: min(480px, 92vw); }
.cv-root .cv-splash.light { top: 78px; transform: translateX(-50%); width: min(380px, 92vw); padding: 8px 12px 8px 8px; display: flex; gap: 10px; align-items: center; text-align: left; animation: spDrop .25s steps(4, end); }
@keyframes spDrop { from { transform: translate(-50%, -12px); opacity: 0; } to { transform: translate(-50%, 0); opacity: 1; } }
.cv-splash.light .art { width: 56px !important; height: 56px !important; margin: 0 !important; flex: none; }
.cv-splash.light .art img { width: 52px !important; height: 52px !important; }
.cv-splash.light .sp-turn { width: 52px !important; height: 52px !important; }
.cv-splash.light .words { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cv-splash.light .kick { font-size: 14px !important; }
.cv-splash.light b { font: 400 22px/1 'Jersey 10', monospace; color: #fff; text-shadow: 2px 2px 0 #0b0d12; }
.cv-splash.light small { margin: 0 !important; font: 400 13px/1.3 'Chakra Petch', system-ui, sans-serif !important; color: var(--muted) !important; }
/* A short screen (a phone on its side): the big card's picture beside its words. */
@media (max-height: 520px) {
  .cv-root .cv-splash:not(.light) { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto 1fr; column-gap: 14px; text-align: left; width: min(560px, 94vw); padding: 12px 14px; top: 50%; }
  .cv-root .cv-splash:not(.light) .kick { grid-column: 2; }
  .cv-root .cv-splash:not(.light) .art { grid-row: 1 / span 2; grid-column: 1; margin: 0 !important; width: 104px !important; height: 104px !important; }
  .cv-root .cv-splash:not(.light) .art img, .cv-root .cv-splash:not(.light) .sp-turn { width: 100px !important; height: 100px !important; }
  .cv-root .cv-splash .art.room { width: 200px !important; height: 122px !important; }
  .cv-root .cv-splash:not(.light) .words { grid-column: 2; min-width: 0; }
  .cv-root .cv-splash:not(.light) h2 { font-size: 28px !important; }
  .cv-root .cv-splash .sp-quote { margin-left: 0; font-size: 13.5px; }
  .cv-root .cv-splash.light { top: 52px; }
}
@media (prefers-reduced-motion: reduce) { .sp-turn { animation: none; } }
${ENDING_CSS}`;
