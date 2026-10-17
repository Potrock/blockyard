import type { UnitWire, WorkAdvice } from '../protocol';
import type { BuildWhat } from '../rules/game';
import { FEATURES, IMPROVEMENTS, type ImprovementId } from '../rules/terrain';
import { UNITS } from '../rules/units';
import { centreHere, landY, toScreen } from './camera';
import { icon } from './icons';
import type { Pen } from './lenses';
import { yieldWords } from './pedia';
import { play } from './sound';
import { myUnit, store } from './store';
import { BUILD_GLYPH, click, h, send, type El } from './ui';

/**
 * Recommended work, Civilization V's: with a worker of yours selected, the advisor's best builds on
 * the land near it (`advisor.ts`, weighed as the bots weigh them) are marked on their tiles, each
 * tile's card saying what the build adds and why; a click on one sends the worker there to build it,
 * at once if it's there this turn, else on arrival (kept on this screen, as a march is).
 */

type Tip = WorkAdvice['tips'][number];

/** The advice for the selected worker, and what it was asked for (the worker and the view). */
let advice: WorkAdvice | null = null;
let asked = '';

/** Workers on their way to recommended work: where, what to build there, where they set out from and when. */
const plans = new Map<number, { tile: number; what: BuildWhat; from: number; turn: number }>();

/** The worker of yours selected (one that improves the land), if one is. */
function selectedWorker(): UnitWire | undefined {
  const u = myUnit(store.selectedUnit);
  return u && UNITS[u.type]?.abilities?.includes('build') ? u : undefined;
}

/** The advice asked for while a worker's selected: again whenever the view changes (`client.ts`, each frame). */
export function askWorkAdvice(ask: (unit: number) => void) {
  const u = selectedWorker();
  const key = u && store.view && !store.view.over ? `${u.id}|${store.viewSeq}` : '';
  if (key === asked) return;
  asked = key;
  if (u) ask(u.id);
}

export function setWorkAdvice(d: WorkAdvice) {
  advice = d;
  store.changed++;
}

/** The recommended work on a tile for the selected worker, if there is some. */
export function workTip(t: number): Tip | undefined {
  const u = selectedWorker();
  return u && advice?.unit === u.id ? advice.tips.find((x) => x.tile === t) : undefined;
}

/** Why the selected worker has no recommended work, if it has none (enemies in reach, nothing near). */
export function workQuiet(): string | undefined {
  const u = selectedWorker();
  return u && advice?.unit === u.id && !advice.tips.length ? advice.quiet : undefined;
}

/** A build's name, on a tile ('Farm', 'Road', 'Clear the Marsh'). */
export function buildName(what: BuildWhat, t: number): string {
  if (what === 'road') return 'Road';
  if (what === 'rail') return 'Railroad';
  if (what === 'repair') return 'Repair';
  if (what === 'remove_feature') {
    const f = store.terrain[t]?.feature;
    return f ? `Clear the ${FEATURES[f].name}` : 'Clear the land';
  }
  return IMPROVEMENTS[what as ImprovementId]?.name ?? what;
}

/** A worker sent to recommended work: building it now if it's there, else going (and building it on arrival). */
export function workAt(u: UnitWire, tip: Tip) {
  if (u.tile === tip.tile) return send({ t: 'build', unit: u.id, what: tip.what });
  send({ t: 'move', unit: u.id, to: tip.tile });
  plans.set(u.id, { tile: tip.tile, what: tip.what, from: u.tile, turn: store.view!.turn });
  play('march', 0.8);
}

/**
 * Each new view: a worker that's reached its recommended work starts it; one sent elsewhere since,
 * or stopped short (an enemy in sight, the way blocked), drops it. (One still where it set out from,
 * with no way yet, on the same turn: its order isn't through yet.)
 */
export function followWorkPlans() {
  const v = store.view;
  if (!v) return;
  for (const [id, plan] of plans) {
    const u = myUnit(id);
    if (!u) {
      plans.delete(id);
      continue;
    }
    if (u.tile === plan.tile) {
      plans.delete(id);
      if (!u.work) send({ t: 'build', unit: id, what: plan.what });
      continue;
    }
    const bound = u.path?.length ? u.path[u.path.length - 1] : null;
    if (bound !== null ? bound !== plan.tile : u.tile !== plan.from || v.turn !== plan.turn) plans.delete(id);
  }
}

/**
 * The recommended work drawn on its tiles: each lit and outlined, the build's glyph on a gold block
 * low in its middle, or nearer its front where a city's banner or a unit's flag is in the way (the
 * boxes in `taken`).
 */
export function drawWorkTips(pen: Pen, taken: { x0: number; y0: number; x1: number; y1: number }[]) {
  const u = selectedWorker();
  const g = store.grid;
  if (!u || !g || advice?.unit !== u.id) return;
  const { ctx, zoomed, ui } = pen;
  const size = Math.round(Math.max(16, Math.min(26, zoomed * 0.66)) * ui);
  const rings = new Path2D();
  for (const tip of advice.tips) pen.hex(rings, tip.tile, landY(tip.tile), 0.9);
  // (Lit in white, dashed: a civ's borders may be gold themselves.)
  ctx.fillStyle = 'rgba(255,240,200,0.16)';
  ctx.fill(rings);
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke(rings);
  ctx.setLineDash([]);
  const clear = (x: number, y: number) => !taken.some((b) => x + size / 2 + 2 > b.x0 && x - size / 2 - 2 < b.x1 && y + size / 2 + 2 > b.y0 && y - size / 2 - 2 < b.y1);
  for (const tip of advice.tips) {
    const c = centreHere(g, tip.tile);
    const spots = [0, 1, 2].map((k) => toScreen(c.x, landY(tip.tile) + 0.3, c.z + k * 0.9)).filter((x): x is NonNullable<typeof x> => !!x);
    const s = spots.find((x) => clear(x.x, x.y)) ?? spots[spots.length - 1];
    if (!s) continue;
    const x0 = Math.round(s.x - size / 2);
    const y0 = Math.round(s.y - size / 2);
    ctx.fillStyle = '#07090c';
    ctx.fillRect(x0 - 2, y0 - 2, size + 4, size + 4);
    ctx.fillStyle = '#f2c14e';
    ctx.fillRect(x0, y0, size, size);
    ctx.fillStyle = '#2a2414';
    ctx.fillRect(x0 + 2, y0 + 2, size - 4, size - 4);
    pen.glyph(BUILD_GLYPH[tip.what] ?? 'hammer', s.x, s.y, size * 0.68, '#ffe3a1');
  }
}

/** What a tile's card says of its recommended work: the build, what it adds and why, and what a click does. */
export function workTipLines(t: number): El[] {
  const tip = workTip(t);
  if (!tip) return [];
  const sel = selectedWorker()!;
  const gain = yieldWords(tip.gain);
  return [
    h('div.ln.way', {}, icon(BUILD_GLYPH[tip.what] ?? 'hammer', 13, '#f2c14e'), `Advised: ${buildName(tip.what, t)}${gain ? ` (${gain})` : ''}`),
    h('div.ln', {}, icon('lightbulb', 13, '#f2c14e'), tip.why),
    h('div.ln.way', {}, icon('moves', 13), sel.tile === t ? 'Here: the gold button on its card builds it' : `${click(true)} to go and build it`),
  ];
}
