import type { FameEntry } from '../protocol';
import { CIVS, CIV_LIST } from '../rules/civs';
import { DIFFICULTIES } from '../rules/difficulty';
import { MAP_SIZES } from '../rules/state';
import { emblemEl, icon } from './icons';
import { store } from './store';
import { h, type El } from './ui';

/**
 * The Hall of Fame, Civilization V's, on the lobby: the games a person has finished (kept in their
 * store by the server as each ends for them, the newest 50; a guest's for the visit), their best
 * scores, and their wins by kind of victory and by civilization; every game, newest first, on asking.
 */

let fame: FameEntry[] = [];
/** Every game shown (not just the best). */
let all = false;

export function setFame(list: FameEntry[]) {
  fame = Array.isArray(list) ? list : [];
  store.changed++;
}

const HOW: Record<string, string> = { domination: 'Domination', science: 'Science', culture: 'Culture', diplomatic: 'Diplomatic', score: 'Score', time: 'Time' };
const MAP: Record<string, string> = { continents: 'Continents', pangaea: 'Pangaea', archipelago: 'Archipelago', fractal: 'Fractal' };

/** How a game ended for them, in a few words. */
function result(e: FameEntry): El {
  if (e.won) return h('span.hf-res.won', {}, icon('golden', 12), `Victory · ${HOW[e.how ?? ''] ?? ''}`);
  if (e.fell) return h('span.hf-res.lost', {}, icon('skull', 12), `Fell on turn ${e.turn}`);
  const winner = CIVS[e.winner ?? ''];
  return h('span.hf-res.lost', {}, icon('close', 12), winner ? `${winner.name} won · ${HOW[e.how ?? ''] ?? ''}` : 'Defeat');
}

/** A game in a row: their civ, how it ended, their score, place and the game's settings. */
function row(e: FameEntry, rank?: number): El {
  const civ = CIVS[e.civ];
  return h(
    'div.hf-row',
    {},
    rank !== undefined && h('b.hf-rank', {}, `${rank}.`),
    emblemEl(e.civ, 22),
    h('div.hf-who', {}, h('b', {}, civ?.leader ?? e.civ), h('small.cv-muted', {}, civ?.name ?? '')),
    result(e),
    h('b.hf-score', { title: `Score ${e.score}, ${ordinal(e.place)} of ${e.of}` }, String(e.score)),
    h('small.cv-muted.hf-game', {}, `${ordinal(e.place)} of ${e.of} · turn ${e.turn} · ${DIFFICULTIES[e.difficulty]?.name ?? ''} · ${MAP_SIZES[e.size]?.name ?? ''} ${MAP[e.map] ?? ''}${e.people > 1 ? ` · ${e.people} people` : ''} · ${e.date}`),
  );
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/** The Hall of Fame for the lobby: what's been won (by kind and by civ), the best scores, and every game on asking. */
export function renderFame(): El {
  const L = store.lobby;
  const guest = !!L && !L.you.startsWith('acct:');
  const head = (extra: El | null) => h('div.hf-head', {}, icon('golden', 15, '#f2c14e'), h('b', {}, 'Hall of Fame'), extra);
  if (!fame.length)
    return h('div.hf', {}, head(null), h('small.cv-muted', {}, `Each game you finish is kept here: your best scores, and your wins by kind and by civilization${guest ? ' (as a guest, for this visit: sign in to keep them)' : ''}.`));
  const wins = fame.filter((e) => e.won);
  const byHow = Object.entries(HOW)
    .map(([k, name]) => [name, wins.filter((e) => e.how === k).length] as const)
    .filter(([, n]) => n > 0);
  const byCiv = CIV_LIST.map((c) => [c, wins.filter((e) => e.civ === c.id).length] as const).filter(([, n]) => n > 0);
  const best = [...fame].sort((a, b) => b.score - a.score).slice(0, 3);
  return h(
    'div.hf',
    {},
    head(h('button.cv-btn.small.hf-all', { onclick: () => ((all = !all), store.changed++) }, all ? 'Best only' : `All ${fame.length}`)),
    h(
      'div.hf-sum',
      {},
      h('span', {}, `${fame.length} game${fame.length === 1 ? '' : 's'} · ${wins.length} victor${wins.length === 1 ? 'y' : 'ies'}`),
      byHow.length > 0 && h('span.cv-muted', {}, byHow.map(([name, n]) => `${name} ${n}`).join(' · ')),
      byCiv.length > 0 && h('span.hf-civs', {}, ...byCiv.map(([c, n]) => h('span', { title: `${n} win${n === 1 ? '' : 's'} as ${c.name}`, 'data-pedia': `civ:${c.id}` }, emblemEl(c.id, 16), `×${n}`))),
    ),
    h('div.hf-rows.cv-scroll', {}, ...(all ? fame.map((e) => row(e)) : best.map((e, i) => row(e, i + 1)))),
    guest && h('small.cv-muted', {}, 'As a guest, kept for this visit: sign in to keep them.'),
  );
}

export const FAME_CSS = `
.hf { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; background: #1d222b; border: 2px solid #07090c; }
.hf-head { display: flex; align-items: center; gap: 6px; }
.hf-head .hf-all { margin-left: auto; }
.hf-sum { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 13px; }
.hf-civs { display: inline-flex; flex-wrap: wrap; gap: 8px; }
.hf-civs span { display: inline-flex; align-items: center; gap: 2px; }
.hf-rows { display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; }
.hf-row { display: grid; grid-template-columns: auto auto minmax(90px, 1fr) auto auto; grid-template-rows: auto auto; align-items: center; column-gap: 8px; padding: 4px 6px; background: #252b35; }
.hf-row:not(:has(.hf-rank)) { grid-template-columns: auto minmax(90px, 1fr) auto auto; }
.hf-rank { font-size: 18px; color: #f2c14e; }
.hf-who { display: flex; flex-direction: column; min-width: 0; }
.hf-who b, .hf-who small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hf-res { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap; }
.hf-res.won { color: #ffe3a1; }
.hf-res.lost { color: #ff9a8e; }
.hf-score { font-size: 20px; color: #fff; text-align: right; }
.hf-game { grid-column: 1 / -1; font-size: 12px; }
`;
