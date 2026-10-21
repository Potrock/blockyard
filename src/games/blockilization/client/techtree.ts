import { ERA_NAMES, ERAS, eraOfCol, pathTo, TECH_LIST, TECHS } from '../rules/techs';
import { ERA_COLOR, icon, svg, techEra, techGlyph } from './icons';
import { entryArt, entryName, techUnlocks } from './pedia';
import { adviceChips, adviceTag, researchAdvice, techAdvice } from './advice';
import { ask, store } from './store';
import { h, researchChooser, send, tile, togglePanel, type El } from './ui';

/**
 * The technology tree, as Civilization V draws it: the eras across the top, each tech a card in its
 * column with what it unlocks (hover any for its card, right-click for its article), lines from each
 * tech to those it leads to, the research under way and the queue after it lit with the turns each
 * will take, and a search that lights the techs that match (by name or by what they unlock) and the
 * way to them. Clicking a later tech queues the way there. The wheel scrolls it sideways, and it
 * opens on where your research is.
 */

const CARD_W = 216;
const CARD_H = 66;
const COL_W = 276;
const ROW_H = 78;
const ERA_H = 34;
const PAD = 14;

/**
 * Where each tech's card goes: its column (the tech's own, or further right if it needs a tech in
 * the same column) and its row. The rows are chosen once, the first time the tree is drawn: each
 * column's techs are moved and swapped among the rows for as long as that makes the lines between
 * them shorter, cross less, and pass behind fewer cards.
 */
let laid: { col: Record<string, number>; row: Record<string, number>; cols: number; rows: number } | null = null;
function layout() {
  if (laid) return laid;
  const col: Record<string, number> = {};
  const colOf = (id: string): number => (col[id] ??= Math.max(TECHS[id].col, ...TECHS[id].needs.map((n) => colOf(n) + 1)));
  for (const t of TECH_LIST) colOf(t.id);
  const cols = Math.max(...Object.values(col)) + 1;
  const byCol = Array.from({ length: cols }, (_, c) => TECH_LIST.filter((t) => col[t.id] === c).map((t) => t.id));
  const rows = Math.max(...byCol.map((ids) => ids.length));
  const edges = TECH_LIST.flatMap((t) => t.needs.map((n) => [n, t.id] as const));
  const row: Record<string, number> = {};
  byCol.forEach((ids) => ids.forEach((id, i) => (row[id] = Math.floor((rows - ids.length) / 2) + i)));
  const cost = () => {
    let total = 0;
    const spans = new Map<string, (readonly [string, string])[]>();
    for (const e of edges) {
      const [a, b] = e;
      total += Math.abs(row[a] - row[b]);
      const key = `${col[a]}-${col[b]}`;
      (spans.get(key) ?? spans.set(key, []).get(key)!).push(e);
      // Behind a card in a column it passes over.
      for (let c = col[a] + 1; c < col[b]; c++) {
        const y = row[a] + ((row[b] - row[a]) * (c - col[a])) / (col[b] - col[a]);
        if (byCol[c].some((id) => Math.abs(row[id] - y) < 0.6)) total += 4;
      }
    }
    // Crossing another line between the same columns.
    for (const span of spans.values()) for (let i = 0; i < span.length; i++) for (let j = i + 1; j < span.length; j++) if ((row[span[i][0]] - row[span[j][0]]) * (row[span[i][1]] - row[span[j][1]]) < 0) total += 3;
    return total;
  };
  let best = cost();
  for (let pass = 0, better = true; better && pass < 30; pass++) {
    better = false;
    for (const ids of byCol)
      for (const id of ids)
        for (let r = 0; r < rows; r++) {
          const was = row[id];
          if (r === was) continue;
          const other = ids.find((x) => row[x] === r);
          row[id] = r;
          if (other) row[other] = was;
          const now = cost();
          if (now < best) {
            best = now;
            better = true;
          } else {
            row[id] = was;
            if (other) row[other] = r;
          }
        }
  }
  return (laid = { col, row, cols, rows });
}

/** Lay the tree out in a quiet moment, ahead of its first opening (on a slow phone it's a moment's work: not when a finger's waiting). */
let layingOut = false;
export function layOutSoon() {
  if (laid || layingOut) return;
  layingOut = true;
  const idle = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(() => layout(), { timeout: 8000 });
  else setTimeout(() => layout(), 3000);
}

const cardX = (id: string) => PAD + layout().col[id] * COL_W;
const cardY = (id: string) => ERA_H + 12 + layout().row[id] * ROW_H;

/** What's being searched for, kept across redraws. */
let query = '';
/** The tree's scroller last drawn (still on screen: the panel was already open, so it keeps its place). */
let shown: El | null = null;

/** Turns until each tech in the research path is done (the one now, then the queue), at today's science. */
function pathTurns(): Map<string, number> {
  const s = store.view!.self;
  const out = new Map<string, number>();
  if (s.researchScience <= 0) return out;
  let left = 0;
  for (const id of [s.researching, ...s.techQueue]) {
    if (!id) continue;
    left += Math.max(0, (s.techCosts[id] ?? 0) - (s.research[id] ?? 0));
    out.set(id, Math.max(1, Math.ceil(left / s.researchScience)));
  }
  return out;
}

/** The techs a search matches: by name (those it starts first), then by the name of something they unlock. */
function matches(q: string): string[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const civ = store.view?.self.civ;
  const rank = (name: string) => (name.toLowerCase().startsWith(s) ? 0 : name.toLowerCase().includes(s) ? 1 : 2);
  return TECH_LIST.filter((t) => rank(t.name) < 2 || techUnlocks(t.id, civ).some((k) => entryName(k).toLowerCase().includes(s)))
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((t) => t.id);
}

/** Light what a search finds, and the way there, on the tree's panel as it is (no redraw: the field keeps its focus). */
function lightSearch(tree: El, q: string, scroll: boolean) {
  const found = matches(q);
  const known = new Set(store.view!.self.techs);
  const route = new Set(found.flatMap((id) => pathTo(known, id)));
  tree.classList.toggle('searching', !!q.trim());
  for (const card of tree.querySelectorAll<HTMLElement>('.tt-card')) {
    const id = card.dataset.tech!;
    card.classList.toggle('match', found.includes(id));
    card.classList.toggle('route', route.has(id) && !found.includes(id));
  }
  for (const line of tree.querySelectorAll<SVGPathElement>('path[data-to]')) {
    const from = line.dataset.from!;
    line.classList.toggle('route', route.has(line.dataset.to!) && (route.has(from) || known.has(from)));
  }
  const status = tree.querySelector('.tt-found');
  const next = found.find((id) => !known.has(id));
  if (status) status.textContent = q.trim() ? (found.length ? `${found.length} found${next ? ` · Enter researches ${TECHS[next].name}` : ', all known'}` : 'Nothing found') : '';
  if (scroll && found.length) {
    const scroller = tree.querySelector<HTMLElement>('.tt-scroll');
    scroller?.scrollTo({ left: Math.max(0, cardX(found[0]) - (scroller.clientWidth - CARD_W) / 2), behavior: 'smooth' });
  }
}

export function renderTechTree(): El {
  const v = store.view!;
  const s = v.self;
  const known = new Set(s.techs);
  const turns = pathTurns();
  const path = [s.researching, ...s.techQueue].filter((x): x is string => !!x);
  const { col, cols, rows } = layout();
  const W = PAD * 2 + (cols - 1) * COL_W + CARD_W;
  const H = ERA_H + 12 + rows * ROW_H;

  // The eras across the top, and a band down each behind its columns.
  const eras = ERAS.map((era, i) => {
    const at = TECH_LIST.filter((t) => eraOfCol(t.col) === era).map((t) => col[t.id]);
    return { era, i, from: Math.min(...at), to: Math.max(...at) };
  }).filter((e) => Number.isFinite(e.from));
  const bands = eras.map((e) => h(`div.tt-band${e.i % 2 ? '.odd' : ''}`, { style: `left:${e.from * COL_W}px;width:${(e.to - e.from + 1) * COL_W + (e.i === eras.length - 1 ? PAD * 2 : 0)}px;height:${H}px` }));
  const header = h(
    'div.tt-eras',
    { style: `width:${W}px` },
    ...eras.map((e) =>
      h(`div.tt-era${e.i === s.era ? '.now' : ''}`, { style: `left:${e.from * COL_W + PAD}px;width:${(e.to - e.from) * COL_W + CARD_W}px;--era:${ERA_COLOR[e.i]}` }, h('span', {}, ERA_NAMES[e.era]), e.i === s.era && h('small', {}, 'your era')),
    ),
  );

  // The lines: from each tech's right edge to the left edge of each that needs it.
  const lines: string[] = [];
  for (const t of TECH_LIST)
    for (const n of t.needs) {
      const x1 = cardX(n) + CARD_W;
      const y1 = cardY(n) + CARD_H / 2;
      const x2 = cardX(t.id);
      const y2 = cardY(t.id) + CARD_H / 2;
      const dx = Math.min(70, (x2 - x1) / 2);
      const cls = known.has(t.id) ? 'done' : path.includes(t.id) && (known.has(n) || path.includes(n)) ? 'path' : known.has(n) ? 'open' : '';
      lines.push(`<path class="${cls}" data-from="${n}" data-to="${t.id}" d="M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}"/>`);
    }
  const svgLines = h('div.tt-lines', { html: `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines.join('')}</svg>` });

  const search = h('input.cv-input.tt-search', { placeholder: 'Search techs, units, buildings…', value: query, spellcheck: 'false' }) as HTMLInputElement;
  const cards = TECH_LIST.map((t) => {
    const can = !known.has(t.id) && t.needs.every((n) => known.has(n));
    const queued = path.indexOf(t.id);
    const state = known.has(t.id) ? 'known' : s.researching === t.id ? 'now' : queued >= 0 ? 'queued' : can ? 'can' : 'later';
    const cost = s.techCosts[t.id] ?? 0;
    const have = s.research[t.id] ?? 0;
    const own = s.researchScience > 0 ? Math.max(1, Math.ceil((cost - have) / s.researchScience)) : null;
    const meta = known.has(t.id)
      ? h('span', {}, icon('check', 11, '#6fd27a'), 'Known')
      : turns.has(t.id)
        ? h('span.when', {}, `${turns.get(t.id)} turn${turns.get(t.id) === 1 ? '' : 's'}${queued > 0 ? ' from now' : ''}`)
        : h('span', {}, own === null ? `${cost} science` : `${own} turn${own === 1 ? '' : 's'} · ${cost}`);
    const unlocks = techUnlocks(t.id, s.civ);
    const shownUnlocks = unlocks.slice(0, t.note ? 6 : 7);
    const advised = known.has(t.id) ? undefined : techAdvice(t.id);
    return h(
      `button.tt-card.${state}${advised ? '.advised' : ''}`,
      {
        style: `left:${cardX(t.id)}px;top:${cardY(t.id)}px;--era:${ERA_COLOR[techEra(t.id)]}`,
        'data-tech': t.id,
        'data-pedia': `tech:${t.id}`,
        'data-note': advised ? `The advisor recommends it: ${advised.why}` : undefined,
        onclick:
          known.has(t.id) && t.id !== 'future_tech'
            ? undefined
            : () => {
                // (Out of the search field: the tree isn't redrawn while it has the focus.)
                search.blur();
                chooseResearch(t.id);
              },
      },
      tile(techGlyph(t.id), ERA_COLOR[techEra(t.id)], 40),
      h(
        'div.tt-txt',
        {},
        h('div.n', {}, t.name),
        h('div.meta', {}, meta, advised && adviceTag(advised)),
        h(
          'div.un',
          {},
          ...shownUnlocks.map((k) => h('span', { 'data-pedia': k }, entryArt(k, 20))),
          unlocks.length > shownUnlocks.length && h('span.more', {}, `+${unlocks.length - shownUnlocks.length}`),
          t.note && h('span.note', { title: t.note, html: svg('info', 13) }),
        ),
      ),
      queued >= 0 && h('span.tt-badge', {}, String(queued + 1)),
      have > 0 && !known.has(t.id) && h('div.tt-bar', {}, h('i', { style: `width:${Math.min(100, Math.round((have / Math.max(1, cost)) * 100))}%` })),
    );
  });

  const scroller = h('div.tt-scroll.cv-scroll', {}, h('div.tt-inner', { style: `width:${W}px;height:${H}px` }, ...bands, svgLines, header, ...cards));
  smoothWheel(scroller);
  dragToScroll(scroller);

  // What's under way: the research now and the queue after it.
  const queue = path.length
    ? h(
        'div.tt-queue',
        {},
        ...path.slice(0, 5).flatMap((id, i) => [
          i > 0 ? h('span.arrow', { html: svg('moves', 12) }) : null,
          h('button.cv-chip', { 'data-pedia': `tech:${id}`, onclick: () => scrollTo(scroller, id) }, h('b', {}, `${i + 1}`), TECHS[id]?.name ?? id, turns.has(id) && h('small.cv-muted', {}, `${turns.get(id)}t`)),
        ]),
        path.length > 5 && h('span.cv-muted', {}, `+${path.length - 5} more · ${turns.get(path[path.length - 1]) ?? '?'} turns in all`),
      )
    : h(
        'div.tt-queue',
        {},
        h('span.cv-muted', {}, researchAdvice().length ? 'The advisor recommends:' : 'Choose a technology: one that’s lit, or any later one to queue the way there.'),
        ...adviceChips(chooseResearch),
      );
  const panel = h(
    'div.cv-big.cv-panel.tt-panel',
    {},
    h('button.cv-x', { onclick: () => togglePanel('tech'), html: svg('close', 15), title: 'Close (Esc)' }),
    h(
      'div.tt-top',
      {},
      tile('science', '#2f6fc0', 40),
      h('div', {}, h('div.cv-h.big', {}, 'Technology'), h('small.cv-muted', {}, `${s.science > 0 ? `+${s.science} science a turn` : 'No science yet: found a city'}${s.researchScience !== s.science ? ` (your team’s together: +${s.researchScience}, researching as one${s.researchBy !== null ? `; ${researchChooser()}` : ''})` : ''} · ${s.techs.length} known`)),
      queue,
      h('div.tt-find', {}, icon('lens', 15, '#8fa1b3'), search, h('small.tt-found.cv-muted')),
    ),
    scroller,
  );
  search.addEventListener('input', () => {
    query = search.value;
    lightSearch(panel, query, true);
  });
  // (The last search is kept: coming back to the field, a new one types over it.)
  search.addEventListener('focus', () => search.select());
  search.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const first = matches(query).find((id) => !known.has(id));
    if (first) chooseResearch(first);
    search.blur();
  });
  lightSearch(panel, query, false);
  // Opened just now: on where the research is (or the first tech that can be researched). (Once
  // it's on screen: a redraw held back while a field has the focus never is.)
  const fresh = !shown?.isConnected;
  const at = path[0] ?? TECH_LIST.find((t) => !known.has(t.id) && t.needs.every((n) => known.has(n)))?.id;
  requestAnimationFrame(() => {
    if (!scroller.isConnected) return;
    if (fresh && at) {
      scroller.scrollLeft = Math.max(0, cardX(at) - scroller.clientWidth * 0.3);
      // (Down to it too, where the tree's taller than the screen: a phone's.)
      scroller.scrollTop = Math.max(0, cardY(at) + CARD_H / 2 - scroller.clientHeight / 2);
    }
    shown = scroller;
  });
  return panel;
}

/**
 * Research chosen: with nothing being researched before (what the turn was waiting on), the tree
 * closes and it's back to the map; choosing another later, it stays open. On a team, a teammate's
 * choice is the whole team's: it's replaced only on a yes, and the order says what was seen (one
 * a teammate made meanwhile isn't undone unseen, `research` in `rules/game.ts`).
 */
function chooseResearch(tech: string) {
  const v = store.view!;
  const was = v.self.researching;
  const go = () => {
    send({ t: 'research', tech, was });
    if (!was && store.panel === 'tech') togglePanel('tech');
  };
  const by = v.self.researchBy;
  const mate = by !== null && by !== v.you ? v.players[by] : undefined;
  if (was && was !== tech && mate && !mate.bot) ask(`${mate.name} chose ${TECHS[was].name} for the team. Research ${TECHS[tech].name} instead?`, 'Change research', go, false);
  else go();
}

function scrollTo(scroller: El, id: string) {
  scroller.scrollTo({ left: Math.max(0, cardX(id) - (scroller.clientWidth - CARD_W) / 2), behavior: 'smooth' });
}

/** The wheel scrolls the tree sideways, eased. */
function smoothWheel(el: El) {
  let goal = 0;
  let easing = 0;
  const step = () => {
    const d = goal - el.scrollLeft;
    if (!el.isConnected || Math.abs(d) < 1) {
      if (el.isConnected) el.scrollLeft = goal;
      easing = 0;
      return;
    }
    el.scrollLeft += d * 0.22;
    easing = requestAnimationFrame(step);
  };
  el.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) return;
      e.preventDefault();
      if (!easing) goal = el.scrollLeft;
      goal = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, goal + e.deltaY * (e.deltaMode === 1 ? 32 : 1.4)));
      if (!easing) easing = requestAnimationFrame(step);
    },
    { passive: false },
  );
}

/** A drag on the tree's background moves it, as a drag moves the map. */
function dragToScroll(el: El) {
  let from: { x: number; y: number; left: number; top: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('.tt-card')) return;
    from = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!from) return;
    el.scrollLeft = from.left - (e.clientX - from.x) / store.uiScale;
    el.scrollTop = from.top - (e.clientY - from.y) / store.uiScale;
  });
  const end = () => (from = null);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

export const TECH_CSS = `
.tt-panel { padding: 14px 0 0; gap: 10px; }
.tt-top { display: flex; align-items: center; gap: 12px; padding: 0 56px 0 18px; flex-wrap: wrap; }
.tt-queue { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.tt-queue .cv-chip { cursor: pointer; background: rgba(255,255,255,.06) !important; border: 1px solid var(--line) !important; }
.tt-queue .cv-chip:hover { background: rgba(255,255,255,.12) !important; } .tt-queue .cv-chip b { color: var(--gold); }
.tt-queue .arrow { color: var(--dim); display: inline-flex; }
.tt-find { display: flex; align-items: center; gap: 7px; position: relative; }
.tt-search { width: 260px; }
.tt-found { position: absolute; top: 100%; right: 0; margin-top: 3px; white-space: nowrap; font-size: 11px; }
.tt-scroll { flex: 1; overflow: auto; position: relative; cursor: grab; border-top: 1px solid var(--line); border-radius: 0 0 var(--r) var(--r); }
.tt-scroll:active { cursor: grabbing; }
.tt-inner { position: relative; }
.tt-band { position: absolute; top: 0; background: rgba(255,255,255,.012); }
.tt-band.odd { background: rgba(255,255,255,.035); }
.tt-eras { position: sticky; top: 0; height: ${ERA_H}px; z-index: 3; background: linear-gradient(180deg, rgba(13,19,27,.92), rgba(13,19,27,.75)); backdrop-filter: blur(6px); border-bottom: 1px solid var(--line); }
.tt-era { position: absolute; top: 0; height: 100%; display: flex; align-items: center; gap: 8px; border-bottom: 2px solid var(--era); }
.tt-era span { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: color-mix(in srgb, var(--era) 55%, #fff); }
.tt-era small { font-size: 10.5px; font-weight: 700; color: var(--gold); padding: 1px 7px; border-radius: 99px; background: rgba(242,193,78,.14); }
.tt-era.now { background: linear-gradient(0deg, color-mix(in srgb, var(--era) 30%, transparent), transparent); }
.tt-lines { position: absolute; left: 0; top: 0; pointer-events: none; }
.tt-lines svg { display: block; overflow: visible; }
.tt-lines path { fill: none; stroke: rgba(255,255,255,.13); stroke-width: 2; transition: stroke .15s, opacity .15s; }
.tt-lines path.open { stroke: rgba(106,184,255,.38); }
.tt-lines path.done { stroke: rgba(111,210,122,.3); }
.tt-lines path.path { stroke: rgba(242,193,78,.85); stroke-width: 3; }
.tt-lines path.route { stroke: #7fc4ff; stroke-width: 3; }
.searching .tt-lines path:not(.route) { opacity: .35; }
.tt-card { position: absolute; width: ${CARD_W}px; height: ${CARD_H}px; padding: 8px 9px; display: flex; gap: 9px; align-items: center; text-align: left; border-radius: 12px; background: #182230 !important; border: 1px solid rgba(255,255,255,.1) !important; box-shadow: 0 3px 10px rgba(0,0,0,.35); transition: transform .12s, border-color .12s, box-shadow .12s, opacity .15s; z-index: 1; }
.tt-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,.28) !important; z-index: 2; }
.tt-txt { min-width: 0; flex: 1; }
.tt-card .n { font-weight: 700; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tt-card .meta { font-size: 11px; color: var(--muted); display: flex; } .tt-card .meta span { display: inline-flex; align-items: center; gap: 3px; }
.tt-card .meta .when { color: #ffe3a1; font-weight: 700; }
.tt-card .un { display: flex; gap: 3px; margin-top: 4px; height: 20px; align-items: center; }
.tt-card .un > span { display: inline-flex; border-radius: 5px; }
.tt-card .un .cv-tile, .tt-card .un .cv-pic { border-radius: 5px; }
.tt-card .un .more { font-size: 10.5px; font-weight: 700; color: var(--muted); padding: 0 2px; }
.tt-card .un .note { color: #9fd0ff; }
.tt-card.known { background: #15231c !important; border-color: rgba(111,210,122,.3) !important; }
.tt-card.known .cv-tile { filter: saturate(.55) brightness(.85); }
.tt-card.can { border-color: rgba(106,184,255,.6) !important; box-shadow: 0 3px 10px rgba(0,0,0,.35), 0 0 0 1px rgba(106,184,255,.2); }
.tt-card.later { background: #141c27 !important; }
.tt-card.later .n { color: #c3ccd6; }
.tt-card.now { background: #2a2416 !important; border-color: var(--gold) !important; box-shadow: 0 0 0 3px rgba(242,193,78,.2), 0 6px 18px rgba(0,0,0,.4); }
.tt-card.queued { background: #221f17 !important; border-color: rgba(242,193,78,.55) !important; }
.tt-badge { position: absolute; top: -7px; right: -7px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 99px; background: linear-gradient(180deg, #f6cf62, #dca23a); color: #1b1407; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
.tt-bar { position: absolute; left: 10px; right: 10px; bottom: 4px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.08); overflow: hidden; }
.tt-bar i { display: block; height: 100%; background: linear-gradient(90deg, #4a9ae8, #7fc4ff); }
.searching .tt-card:not(.match):not(.route) { opacity: .32; }
.tt-card.match { border-color: #7fc4ff !important; box-shadow: 0 0 0 3px rgba(127,196,255,.3), 0 6px 18px rgba(0,0,0,.4); }
.tt-card.route { border-color: rgba(127,196,255,.6) !important; }
@media (max-width: 760px), (max-height: 520px) {
  .tt-panel { padding-top: 8px; }
  .tt-top { padding: 0 40px 0 10px; gap: 8px; }
  .tt-top > .cv-tile { display: none; }
  .tt-queue { order: 5; flex-basis: 100%; min-width: 0; flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
  .tt-queue > .cv-muted:first-child, .tt-queue small { display: none; }
  .tt-search { width: 150px; }
}
`;
