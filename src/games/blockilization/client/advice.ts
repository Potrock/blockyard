import type { Advice, ResearchAdvice } from '../protocol';
import { TECHS } from '../rules/techs';
import { icon } from './icons';
import { store } from './store';
import { h, tell, type El } from './ui';

/**
 * The advisor's recommendations on this screen: the techs worth heading for (asked of the server
 * once a turn, `advisor.ts`), shown in the tech tree, the research box and what's to be decided; and
 * a mark for what a city's advisor would build (its city screen's own, `CityInfo.advice`).
 */

/** When the research advice was last asked for: the turn, and the game (its map). */
let asked: { turn: number; grid: unknown } | null = null;

/** This turn's research advice (asked for the first time it's wanted; empty until it comes). */
export function researchAdvice(): Advice[] {
  const v = store.view;
  if (!v || v.spectator || v.over) return [];
  const had = store.advice?.turn === v.turn ? store.advice : null;
  if (!had && (asked?.turn !== v.turn || asked.grid !== store.grid)) {
    asked = { turn: v.turn, grid: store.grid };
    tell('advice', null);
  }
  return had?.techs ?? [];
}

/** The advice the server sends. */
export function setAdvice(a: ResearchAdvice) {
  store.advice = a;
  store.changed++;
}

/** The research advice for a tech, if it's one the advisor recommends. */
export const techAdvice = (id: string) => researchAdvice().find((a) => a.id === id);

/** The advisor's mark: a small tag saying it's recommended (and why, on hover). */
export const adviceTag = (a: Advice, short = false) => h('span.adv-tag', { title: `The advisor recommends it: ${a.why}` }, icon('lightbulb', 12), short ? null : 'Advised');

/** A line naming the advisor's choice of research, for the research box and decisions. */
export function researchHint(): string | null {
  const a = researchAdvice()[0];
  return a ? `Advisor: ${TECHS[a.id]?.name ?? a.id}` : null;
}

/** The advisor's recommendations as chips that research them (the tech tree's header, with nothing chosen). */
export function adviceChips(choose: (tech: string) => void): El[] {
  return researchAdvice().map((a) =>
    h('button.cv-chip.adv-chip', { onclick: () => choose(a.id), 'data-pedia': `tech:${a.id}`, 'data-note': a.why }, icon('lightbulb', 12), TECHS[a.id]?.name ?? a.id, h('small.cv-muted', {}, a.why)),
  );
}

export const ADVICE_CSS = `
.adv-tag { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px 1px 3px; background: #24486e; color: #cfe6ff; font-size: 13px; line-height: 1.1; white-space: nowrap; box-shadow: 0 0 0 2px #07090c; }
.adv-tag .cv-i { color: #ffe48a; }
.tt-card .meta .adv-tag { margin-left: 6px; padding: 0 4px 0 2px; font-size: 12px; }
.tt-card.advised { box-shadow: 0 0 0 2px #5ab4ff, 4px 4px 0 rgba(4,6,10,.5) !important; }
.adv-chip { cursor: pointer; gap: 5px !important; }
.adv-chip small { font-size: 13px; }
.cv-opt.advised { box-shadow: inset 3px 0 0 #5ab4ff; }
.cv-opt .adv-why { color: #9fd0ff; font-size: 13px; }
.cv-tip .ln.f1 { color: var(--dim); font-size: 12px; margin-top: 2px; }
.cv-research .adv-hint { display: flex; align-items: center; gap: 4px; color: #9fd0ff; font-size: 13px; }
@media (max-width: 760px), (max-height: 520px) { .cv-research .adv-hint { display: none; } }
`;
