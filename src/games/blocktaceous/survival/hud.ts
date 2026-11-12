import type { GameContext, Player } from '@platform';
import { MAX_LEVEL, xpForLevel, xpToNext } from './data';
import { sparksLeft } from './craft';
import { glyphCell, ICON_COLUMNS } from './icons';
import { theGame, type Survivor } from './state';
import { tempState, type TempState } from './vitals';
import { nameOf } from './data';
import { condition, USES } from './wear';

/**
 * The survivor's corner of the HUD: small meters for food, water and breath, the weather when it
 * bites, their level, and what they just gained. Breath is bound to their own screen's prediction
 * (`$ability.stamina`), so the meter moves the moment they run; the rest is sent as it changes.
 */

export const VITALS = 'bt-vitals';

const TEMP_TEXT: Record<TempState, string> = { ok: '', cold: 'Cold', freezing: 'Freezing', hot: 'Hot', scorching: 'Scorching' };

const glyph = (name: Parameters<typeof glyphCell>[0]) => `<i class="ic" style="--x: ${glyphCell(name).x}"></i>`;

const HTML = `
<div class="vt">
  <div class="gains"><span data-each="gains">{{.}}</span></div>
  <div class="tm {{temp}}" data-if="tempText">${glyph('cold')}${glyph('heat')}<b>{{tempText}}</b><small data-if="warm">by the fire</small></div>
  <div class="tm heavy" data-if="heavy">${glyph('load')}<b>Overloaded</b></div>
  <div class="tm worn" data-if="worn"><b>{{worn}}</b></div>
  <div class="m food {{foodC}}">${glyph('food')}<i class="bar"><i style="--p: {{food}}"></i></i></div>
  <div class="m water {{waterC}}">${glyph('water')}<i class="bar"><i style="--p: {{water}}"></i></i></div>
  <div class="m breath">${glyph('breath')}<i class="bar" style="--cap: {{$ability.stamina.cap}}"><i style="--p: {{$ability.stamina.s}}"></i></i></div>
  <div class="lv"><b>{{lvl}}</b><i class="bar"><i style="--p: {{xp}}"></i></i><span class="pip" data-if="sparks > 0">${glyph('spark')}{{sparks}}</span></div>
</div>`;

const css = (glyphsUrl: string) => `
:scope { margin: 0 0 14px 14px }
.vt { display: flex; flex-direction: column; gap: 4px; width: 168px; font: 700 12px var(--sans); color: #fff; text-shadow: 0 1px 0 #000a }
.ic { display: block; flex: none; width: 16px; height: 16px; background-image: url(${glyphsUrl}); background-repeat: no-repeat; background-size: ${16 * ICON_COLUMNS}px 16px;
  background-position: calc(var(--x) * -16px) 0; image-rendering: pixelated }
.m, .lv, .tm { display: flex; align-items: center; gap: 6px }
.bar { position: relative; display: block; flex: 1; height: 8px; border-radius: 4px; background: #0a0d0acc; box-shadow: 0 0 0 1px #0008; overflow: hidden }
.bar i { display: block; height: 100%; width: calc(var(--p) * 1%); border-radius: 4px; transition: width 0.2s linear }
.food .bar i { background: #e9a23b } .water .bar i { background: #4fb3ee }
.breath .bar { background: linear-gradient(90deg, #0a0d0acc calc(var(--cap) * 1%), #5a1f1acc calc(var(--cap) * 1%)) }
.breath .bar i { background: #d9e86a; transition: none }
.low .bar i { animation: pulse 0.8s ease-in-out infinite alternate } .low .ic { animation: pulse 0.8s ease-in-out infinite alternate }
.lv b { width: 16px; text-align: center; font-size: 13px; color: #cfe6ae }
.lv .bar { height: 5px } .lv .bar i { width: calc(var(--p) * 100%); background: #9bd45a }
.pip { display: flex; align-items: center; gap: 2px; color: #f2b84b }
.tm { padding: 2px 8px 2px 4px; align-self: flex-start; border-radius: 6px; background: #0a0d0acc }
.tm small { font-weight: 400; color: #ffd9a0 }
.tm .ic { display: none }
.tm.cold, .tm.freezing { color: #9fd8ff } .tm.cold .ic:first-child, .tm.freezing .ic:first-child { display: block }
.tm.hot, .tm.scorching { color: #ffb37a } .tm.hot .ic:nth-child(2), .tm.scorching .ic:nth-child(2) { display: block }
.tm.freezing, .tm.scorching { animation: pulse 0.8s ease-in-out infinite alternate }
.tm.heavy { color: #ff8a6b } .tm.heavy .ic { display: block }
.tm.worn { padding-left: 8px; color: #ffcf7a }
.gains { display: flex; flex-direction: column; gap: 2px; margin-bottom: 4px; color: #e6f3c8; font-size: 13px }
.gains span { animation: rise 0.25s ease-out }
@keyframes pulse { from { opacity: 1 } to { opacity: 0.45 } }
@keyframes rise { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
/* On a narrow window the belt reaches the left corner, so the bars sit above it and its hearts. */
@media (max-width: 960px) { :scope { margin-bottom: 104px } }
`;

export function defineVitals(game: GameContext, glyphsUrl: string): void {
  game.hud.define(VITALS, { at: 'bottom-left', html: HTML, css: css(glyphsUrl) });
}

/** Show a survivor their meters, if anything they show has changed. */
export function showVitals(player: Player, s: Survivor, dt: number): void {
  if (s.gains.length > 0) {
    for (const g of s.gains) g.left -= dt;
    s.gains = s.gains.filter((g) => g.left > 0);
  }
  const state = tempState(s.temp);
  if (state !== s.weather) {
    s.weather = state;
    theGame().clients.send(player, 'bt.weather', { state });
  }
  // The thing in hand, once it's down to its last quarter.
  const held = player.inventory.held?.item;
  const left = held && USES[held] ? condition(s, held) : 1;
  const data = {
    worn: held && left <= 0.25 ? `${nameOf(held)} ${Math.max(1, Math.round(left * 100))}%` : '',
    food: Math.ceil(s.hunger),
    water: Math.ceil(s.thirst),
    foodC: s.hunger < 20 ? 'low' : '',
    waterC: s.thirst < 20 ? 'low' : '',
    temp: state,
    tempText: TEMP_TEXT[state],
    warm: s.warm && state !== 'ok',
    heavy: s.weight > s.limit,
    lvl: s.level,
    xp: s.level >= MAX_LEVEL ? 1 : Math.round(Math.min(1, (s.xp - xpForLevel(s.level)) / xpToNext(s.level)) * 100) / 100,
    sparks: sparksLeft(s),
    gains: s.gains.map((g) => g.text),
  };
  const key = JSON.stringify(data);
  if (key === s.shown) return;
  s.shown = key;
  player.hud.widget(VITALS, data);
}
