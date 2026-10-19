import { centre } from '../geometry';
import type { CityWire, DemographicId, UnitWire } from '../protocol';
import { CIVS } from '../rules/civs';
import { distance } from '../rules/hex';
import { ERA_NAMES, ERAS } from '../rules/techs';
import { UNITS } from '../rules/units';
import { lookAt } from './camera';
import { emblemEl, GREAT_GLYPH, icon, svg, YIELD_COLOR } from './icons';
import { me, store } from './store';
import { askCity, cityBuild, h, itemArt, itemName, openCity, pic, portrait, tell, tile, togglePanel, type El } from './ui';
import { unitModel } from './models3d';
import { renderPolitics } from './politics';

/**
 * The overviews, one panel with a tab for each: your cities side by side (size, growth, what each
 * makes and builds, its defence: sortable, a click opens one), your units by type with what each is
 * doing (a click selects it and looks there), the demographics (where you stand among every
 * civilization, and the score race), and diplomacy at a glance.
 */

type Tab = 'cities' | 'units' | 'demographics' | 'diplomacy';
const TABS: [Tab, string, string][] = [
  ['cities', 'Cities', 'city'],
  ['units', 'Units', 'sword'],
  ['demographics', 'Demographics', 'chart'],
  ['diplomacy', 'Diplomacy', 'peace'],
];

let tab: Tab = 'cities';
/** The cities' order: by which column, which way. */
let sortBy: keyof typeof CITY_COLUMNS = 'pop';
let sortDown = true;
/** The units shown: all, or those doing one thing. */
let unitFilter: string | null = null;
/** The city whose production is being chosen right in the table (its build list open under its row). */
let picking: number | null = null;
/** When the demographics were last asked for: the turn, and the game (its map). */
let asked: { turn: number; grid: unknown } | null = null;

/** Open the overview at a tab (the keys and the top bar's button). */
export function openOverview(t: Tab = tab) {
  tab = t;
  store.panel = 'overview';
  store.changed++;
}

// -------------------------------------------------------------------------------------------------
// Cities
// -------------------------------------------------------------------------------------------------

/** The cities table's sortable columns: a heading, a glyph, its colour, and each city's value. */
const CITY_COLUMNS = {
  name: ['City', '', '', (c: CityWire) => c.name],
  pop: ['Size', 'pop', '#e9eef3', (c: CityWire) => c.pop],
  growth: ['Grows', 'food', YIELD_COLOR.food, (c: CityWire) => (c.growth && c.growth > 0 ? c.growth : 999)],
  food: ['Food', 'food', YIELD_COLOR.food, (c: CityWire) => c.yields?.surplus ?? 0],
  prod: ['Prod.', 'prod', YIELD_COLOR.prod, (c: CityWire) => c.yields?.prod ?? 0],
  gold: ['Gold', 'gold', YIELD_COLOR.gold, (c: CityWire) => c.yields?.gold ?? 0],
  science: ['Science', 'science', YIELD_COLOR.science, (c: CityWire) => c.yields?.science ?? 0],
  culture: ['Culture', 'culture', YIELD_COLOR.culture, (c: CityWire) => c.yields?.culture ?? 0],
  faith: ['Faith', 'faith', YIELD_COLOR.faith, (c: CityWire) => c.yields?.faith ?? 0],
  building: ['Producing', 'hammer', YIELD_COLOR.prod, (c: CityWire) => c.building?.turns ?? 999],
  defense: ['Defence', 'shield', '#c8b07a', (c: CityWire) => c.strength],
} as const;

function renderCities(): El {
  const v = store.view!;
  const mine = v.cities.filter((c) => c.owner === v.you);
  if (!mine.length) return h('div.ov-empty', {}, 'You have no cities yet. Found one with a Settler (B).');
  const value = CITY_COLUMNS[sortBy][3] as (c: CityWire) => number | string;
  const sorted = [...mine].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    const d = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
    return sortDown ? -d : d;
  });
  const head = h(
    'tr',
    {},
    ...(Object.keys(CITY_COLUMNS) as (keyof typeof CITY_COLUMNS)[]).map((k) => {
      const [name, glyph, color] = CITY_COLUMNS[k];
      return h(
        `th${sortBy === k ? '.on' : ''}`,
        {
          onclick: () => {
            if (sortBy === k) sortDown = !sortDown;
            else (sortBy = k), (sortDown = k !== 'name' && k !== 'growth' && k !== 'building');
            store.changed++;
          },
          title: `Sort by ${name.toLowerCase()}`,
        },
        h('span', {}, glyph && icon(glyph, 13, color), name, sortBy === k && h('i', {}, sortDown ? '▾' : '▴')),
      );
    }),
  );
  const num = (n: number | undefined, sign = false) => h('td.n', {}, `${sign && (n ?? 0) > 0 ? '+' : ''}${n ?? 0}`);
  // (A city's production chosen here: its build list, as its own screen has it, opens under its row.)
  const pick = (c: CityWire) => (e: MouseEvent) => {
    e.stopPropagation();
    picking = picking === c.id ? null : c.id;
    if (picking !== null) askCity(c.id);
    store.changed++;
  };
  if (picking !== null && !mine.some((c) => c.id === picking && !c.puppet)) picking = null;
  const rows = sorted.flatMap((c) => {
    const y = c.yields!;
    const b = c.building;
    const row = h(
      `tr.go${picking === c.id ? '.picking' : ''}`,
      { onclick: () => openCity(c.id) },
      h(
        'td.name',
        {},
        h(
          'span',
          {},
          h('b', {}, c.name),
          c.capital && icon('crown', 13, '#f2c14e'),
          c.puppet && h('span.cv-chip', {}, 'puppet'),
          c.razing ? h('span.cv-chip.bad', {}, `razing ${c.razing}`) : null,
          c.resistance ? h('span.cv-chip.bad', {}, `resisting ${c.resistance}`) : null,
          c.occupied ? h('span.cv-chip.bad', { title: 'Unhappy at the occupation till it has a Courthouse' }, 'occupied') : null,
          c.blockaded ? h('span.cv-chip.bad', { title: 'Enemy warships blockade it: its sea tiles and sea trade routes yield nothing' }, 'blockaded') : null,
        ),
      ),
      num(c.pop),
      h('td.n', {}, c.growth! > 0 ? `${c.growth}t` : c.growth! < 0 ? h('span.bad', {}, 'starving') : '—'),
      num(y.surplus, true),
      num(y.prod),
      num(y.gold),
      num(y.science),
      num(y.culture),
      num(y.faith),
      // (A puppet's builds are its own: shown, not chosen.)
      c.puppet
        ? h('td.made', { title: 'A puppet chooses its own builds: annex it (in its city) to give it orders' }, b ? h('span', {}, itemArt(b.kind, b.id, 22), itemName(b.kind, b.id), h('small.cv-muted', {}, `${b.turns}t`)) : h('span.cv-muted', {}, '—'))
        : h(
            'td.made',
            { onclick: pick(c), title: 'Choose, queue or buy what it builds, here' },
            b ? h('span', {}, itemArt(b.kind, b.id, 22), itemName(b.kind, b.id), h('small.cv-muted', {}, `${b.turns}t`), icon(picking === c.id ? 'up' : 'down', 12)) : h('span.bad', {}, 'Choose…', icon('down', 12)),
          ),
      h('td.def', {}, h('span', { title: `${c.hp} of ${c.maxHp} hit points` }, h('b', {}, String(c.strength)), h(`div.cv-bar.${c.hp * 2 > c.maxHp ? 'green' : 'red'}`, {}, h('i', { style: `width:${Math.round((c.hp / Math.max(1, c.maxHp)) * 100)}%` })))),
    );
    if (picking !== c.id) return [row];
    const info = store.cityInfo?.id === c.id ? store.cityInfo : null;
    return [row, h('tr.ov-pick', {}, h('td', { colspan: String(Object.keys(CITY_COLUMNS).length) }, h('div.ov-picker.cv-scroll', {}, ...cityBuild(c, info, () => setTimeout(() => askCity(c.id), 150)))))];
  });
  const total = (k: 'surplus' | 'prod' | 'gold' | 'science' | 'culture' | 'faith') => mine.reduce((n, c) => n + (c.yields?.[k] ?? 0), 0);
  const foot = h(
    'tr.total',
    {},
    h('td.name', {}, `${mine.length} cit${mine.length === 1 ? 'y' : 'ies'}`),
    num(mine.reduce((n, c) => n + c.pop, 0)),
    h('td'),
    num(total('surplus'), true),
    num(total('prod')),
    num(total('gold')),
    num(total('science')),
    num(total('culture')),
    num(total('faith')),
    h('td'),
    h('td'),
  );
  return h('div.ov-scroll.cv-scroll', {}, h('table.ov-table', {}, h('thead', {}, head), h('tbody', {}, ...rows), h('tfoot', {}, foot)));
}

// -------------------------------------------------------------------------------------------------
// Units
// -------------------------------------------------------------------------------------------------

const STATUS: Record<string, [string, string]> = {
  idle: ['Needs orders', '#f2c14e'],
  promote: ['Can be promoted', '#f2c14e'],
  moving: ['On its way', '#6ab8ff'],
  working: ['Working', '#f0a24a'],
  automated: ['Automated', '#6ab8ff'],
  exploring: ['Exploring', '#6ab8ff'],
  fortified: ['Fortified', '#7bd16a'],
  sleeping: ['Asleep', '#8fa1b3'],
  alert: ['On alert', '#7bd16a'],
  skipped: ['Waiting this turn', '#8fa1b3'],
  done: ['Done this turn', '#5f7286'],
};

function statusOf(u: UnitWire): string {
  if ((u.promotionsDue ?? 0) > 0) return 'promote';
  if (u.work) return 'working';
  if (u.auto) return u.auto === 'explore' ? 'exploring' : 'automated';
  if (u.path?.length) return 'moving';
  if (u.stance === 'fortify') return 'fortified';
  if (u.stance === 'sleep') return 'sleeping';
  if (u.stance === 'alert') return 'alert';
  if (u.skip) return 'skipped';
  return (u.moves ?? 0) > 0 ? 'idle' : 'done';
}

/** Where a unit is, by your cities: in one, or near the nearest. */
function whereIs(u: UnitWire): string {
  const v = store.view!;
  const g = store.grid;
  if (!g) return '';
  let best: { name: string; d: number } | null = null;
  for (const c of v.cities)
    if (c.owner === v.you) {
      const d = distance(g, c.tile, u.tile);
      if (!best || d < best.d) best = { name: c.name, d };
    }
  if (!best) return '';
  return best.d === 0 ? `in ${best.name}` : `${best.d} from ${best.name}`;
}

function renderUnits(): El {
  const v = store.view!;
  const mine = v.units.filter((u) => u.owner === v.you);
  if (!mine.length) return h('div.ov-empty', {}, 'You have no units.');
  const counts = new Map<string, number>();
  for (const u of mine) counts.set(statusOf(u), (counts.get(statusOf(u)) ?? 0) + 1);
  const shown = mine.filter((u) => !unitFilter || statusOf(u) === unitFilter);
  const types = [...new Set(shown.map((u) => u.type))].sort((a, b) => (UNITS[b]?.strength ?? 0) - (UNITS[a]?.strength ?? 0) || (UNITS[a]?.name ?? a).localeCompare(UNITS[b]?.name ?? b));
  const select = (u: UnitWire, e?: MouseEvent) => {
    // Shift: it joins the selected unit's group (or leaves it), to be sent together; the list stays open.
    if (e?.shiftKey && store.selectedUnit !== null && store.selectedUnit !== u.id) {
      store.group = store.group.includes(u.id) ? store.group.filter((x) => x !== u.id) : [...store.group, u.id];
      store.changed++;
      return;
    }
    store.selectedUnit = u.id;
    store.group = [];
    store.selectedCity = null;
    store.panel = null;
    if (store.grid) {
      const c = centre(store.grid, u.tile);
      lookAt(c.x, c.z);
    }
    store.changed++;
  };
  return h(
    'div.ov-units',
    {},
    h(
      'div.ov-filters',
      {},
      h(`button.cv-chip${unitFilter === null ? '.on' : ''}`, { onclick: () => ((unitFilter = null), store.changed++) }, `All ${mine.length}`),
      ...Object.keys(STATUS)
        .filter((k) => counts.has(k))
        .map((k) => h(`button.cv-chip${unitFilter === k ? '.on' : ''}`, { onclick: () => ((unitFilter = unitFilter === k ? null : k), store.changed++) }, h('i.dot', { style: `background:${STATUS[k][1]}` }), `${STATUS[k][0]} ${counts.get(k)}`)),
    ),
    h(
      'div.ov-scroll.cv-scroll',
      {},
      ...types.map((type) => {
        const t = UNITS[type];
        const of = shown.filter((u) => u.type === type);
        return h(
          'div.ov-group',
          {},
          h('div.ov-ghead', { 'data-pedia': `unit:${type}` }, pic(unitModel(type), 34), h('b', {}, t?.name ?? type), h('span.cv-muted', {}, `×${of.length}`), t?.strength ? h('span.cv-muted.stat', {}, icon('strength', 12, '#f0a24a'), String(t.strength)) : null, t?.ranged ? h('span.cv-muted.stat', {}, icon('ranged', 12, '#6ab8ff'), String(t.ranged)) : null),
          ...of.map((u) => {
            const st = statusOf(u);
            const chosen = u.id === store.selectedUnit || store.group.includes(u.id);
            return h(
              `div.ov-unit${chosen ? '.chosen' : ''}`,
              { onclick: (e: MouseEvent) => select(u, e), title: 'Click to select it; shift-click to add it to the selected unit’s group' },
              h('span.st', { style: `color:${STATUS[st][1]}` }, h('i.dot', { style: `background:${STATUS[st][1]}` }), st === 'working' && u.work ? `${STATUS[st][0]} (${u.work.turns}t)` : st === 'moving' ? `${STATUS[st][0]} (${u.path!.length} tile${u.path!.length === 1 ? '' : 's'})` : STATUS[st][0]),
              u.embarked && h('span.cv-chip', {}, 'at sea'),
              h('span.cv-grow.cv-muted', {}, whereIs(u)),
              h('span.hp', {}, h(`div.cv-bar.${u.hp > 50 ? 'green' : u.hp > 25 ? 'gold' : 'red'}`, {}, h('i', { style: `width:${u.hp}%` }))),
              h('span.mv', {}, icon('moves', 12, '#7bd16a'), `${Math.round((u.moves ?? 0) * 10) / 10}/${u.maxMoves ?? t?.moves ?? 0}`),
            );
          }),
        );
      }),
    ),
  );
}

// -------------------------------------------------------------------------------------------------
// Demographics and the score race
// -------------------------------------------------------------------------------------------------

const MEASURES: Record<DemographicId, [string, string, string, string]> = {
  population: ['Population', 'pop', '#e9eef3', 'citizens'],
  land: ['Land', 'hexes', '#7bd16a', 'tiles'],
  military: ['Military might', 'strength', '#f0a24a', 'strength'],
  food: ['Crop yield', 'food', YIELD_COLOR.food, 'food a turn'],
  production: ['Manufactured goods', 'prod', YIELD_COLOR.prod, 'production a turn'],
  gold: ['Gross national product', 'gold', YIELD_COLOR.gold, 'gold a turn'],
  science: ['Science', 'science', YIELD_COLOR.science, 'science a turn'],
  culture: ['Culture', 'culture', YIELD_COLOR.culture, 'culture a turn'],
};

function renderDemographics(): El {
  const v = store.view!;
  // This turn's, asked for once (a new game's map is a new game).
  const st = store.stats?.turn === v.turn ? store.stats : null;
  if (!st && (asked?.turn !== v.turn || asked.grid !== store.grid)) {
    asked = { turn: v.turn, grid: store.grid };
    tell('stats', null);
  }
  const majors = v.players.filter((p) => !p.cityState && p.civ !== 'barbarian' && p.alive);
  const ranked = [...majors].sort((a, b) => b.score - a.score);
  const place = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
  const table = st
    ? h(
        'table.ov-table.ov-demo',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Measure'), h('th', {}, 'You'), h('th', {}, 'Place'), h('th', {}, 'Best'), h('th', {}, 'Average'), h('th', {}, 'Worst'))),
        h(
          'tbody',
          {},
          ...st.rows.map((r) => {
            const [name, glyph, color, unit] = MEASURES[r.id];
            const by = v.players[r.bestBy];
            return h(
              'tr',
              {},
              h('td.name', {}, h('span', {}, icon(glyph, 15, color), h('span', {}, name), h('small.cv-dim', {}, unit))),
              h('td.n', {}, h('b', {}, String(r.you))),
              h('td.n', {}, h(`span.place${r.rank === 1 ? '.first' : r.rank === st.civs ? '.last' : ''}`, {}, place(r.rank))),
              h('td.n', {}, h('span.by', { title: by?.name }, by && emblemEl(by.civ, 16), String(r.best))),
              h('td.n', {}, String(r.average)),
              h('td.n', {}, String(r.worst)),
            );
          }),
        ),
      )
    : h('div.cv-muted', {}, 'Counting…');
  return h(
    'div.ov-scroll.cv-scroll.ov-demo-wrap',
    {},
    h('div.ov-split', {}, h('div', {}, h('div.cv-label', {}, st ? (st.civs > 1 ? `Among the ${st.civs} civilizations you know` : 'Only you, until you meet another civilization') : ''), table), h('div', {}, h('div.cv-label', {}, 'Score'), h('div.ov-ranks', {}, ...ranked.map((p, i) => {
      const known = p.met || p.index === v.you;
      return h(`div.ov-rank${p.index === v.you ? '.me' : ''}`, {}, h('b.i', {}, `${i + 1}`), known ? emblemEl(p.civ, 20) : h('span.unmet', {}, '?'), h('span.cv-grow', {}, known ? (p.index === v.you ? `${p.name} (you)` : p.name) : 'A civilization you haven’t met'), h('b', {}, String(p.score)));
    })), greatProgress())),
    st && scoreChart(st.scores),
  );
}

/**
 * How near each kind of great person is: the points toward the next one, of what it costs (the kinds
 * under way, nearest first). Great Generals come from fights on land, Admirals at sea; the rest from
 * specialists, buildings and wonders.
 */
function greatProgress(): El | null {
  const s = store.view!.self;
  const share = (k: string) => (s.greatPoints[k] ?? 0) / Math.max(1, s.greatCosts[k] ?? 1);
  const kinds = Object.keys(s.greatCosts)
    .filter((k) => (s.greatPoints[k] ?? 0) >= 1)
    .sort((a, b) => share(b) - share(a));
  return h(
    'div.ov-great',
    {},
    h('div.cv-label', {}, 'Great people on the way'),
    ...(kinds.length
      ? kinds.map((k) =>
          h(
            'div.ov-gp',
            { 'data-pedia': `unit:great_${k}` },
            icon(GREAT_GLYPH[k] ?? 'xp', 15, '#f2c14e'),
            h('span', {}, UNITS[`great_${k}`]?.name ?? k),
            h('div.cv-bar.gold', {}, h('i', { style: `width:${Math.min(100, Math.round(share(k) * 100))}%` })),
            h('small.cv-muted', {}, `${Math.floor(s.greatPoints[k] ?? 0)}/${s.greatCosts[k]}`),
          ),
        )
      : [h('div.cv-muted', {}, 'None yet: specialists, some buildings and wonders bring great people; fights on land bring Great Generals.')]),
  );
}

/** The score race: each known civilization's score over the game, as lines. */
function scoreChart(scores: { index: number; score: number[] }[]): El | null {
  const v = store.view!;
  const n = Math.max(2, ...scores.map((s) => s.score.length));
  if (n < 3) return null;
  const top = Math.max(1, ...scores.flatMap((s) => s.score));
  const W = 800;
  const H = 180;
  const lines = scores
    .map((s) => {
      const p = v.players[s.index];
      const colour = CIVS[p?.civ ?? '']?.color ?? '#888';
      const pts = s.score.map((d, i) => `${((i / (n - 1)) * (W - 10) + 5).toFixed(1)},${(H - 6 - (d / top) * (H - 16)).toFixed(1)}`).join(' ');
      const mine = s.index === v.you;
      return `<polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="${mine ? 3 : 2}" stroke-linejoin="round" stroke-linecap="round" opacity="${mine ? 1 : 0.8}" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="0" x2="${W}" y1="${H - 6 - f * (H - 16)}" y2="${H - 6 - f * (H - 16)}" stroke="rgba(255,255,255,.07)"/>`).join('');
  return h(
    'div.cv-graph',
    {},
    h('div.tabs', {}, h('span.cv-label', {}, 'The score race'), h('span.cv-muted', { style: 'margin-left:auto;font-size:11.5px' }, `turns 1–${n} · top ${top}`)),
    h('div', { html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${grid}${lines}</svg>` }),
    h('div.cv-legend', {}, ...scores.map((s) => h('span', {}, h('i', { style: `background:${CIVS[v.players[s.index]?.civ ?? '']?.color ?? '#888'}` }), v.players[s.index]?.name ?? ''))),
  );
}

// -------------------------------------------------------------------------------------------------
// Diplomacy at a glance
// -------------------------------------------------------------------------------------------------

function renderDiplomacy(): El {
  const v = store.view!;
  const civs = v.players.filter((p) => p.index !== v.you && p.met && !p.cityState && p.civ !== 'barbarian');
  const unmet = v.players.filter((p) => !p.met && !p.cityState && p.civ !== 'barbarian' && p.alive && p.index !== v.you).length;
  const states = v.players.filter((p) => p.cityState && p.met && p.alive);
  const religion = (id: string | null | undefined) => (id ? (v.religions.find((r) => r.id === id)?.name ?? '') : '');
  return h(
    'div.ov-scroll.cv-scroll',
    {},
    h('div.cv-label', { style: 'margin-bottom:6px' }, `Civilizations · ${civs.length} met${unmet ? `, ${unmet} not yet` : ''}`),
    civs.length
      ? h(
          'div.ov-civs',
          {},
          ...civs.map((p) =>
            h(
              `div.ov-civ${p.alive ? '' : '.gone'}`,
              {},
              h('div.top', {}, portrait(p.civ, 46), h('div.cv-grow', {}, h('div.cv-row', { style: 'gap:6px' }, emblemEl(p.civ, 16), h('b', {}, p.name)), h('small.cv-muted', {}, `${CIVS[p.civ]?.name ?? ''} · ${ERA_NAMES[ERAS[p.era]] ?? ''}`)), !p.alive ? h('span.cv-chip', {}, 'Fallen') : p.war ? h('span.cv-chip.bad', {}, icon('war', 12), 'War') : h('span.cv-chip.good', {}, icon('peace', 12), p.peace ? `Peace ${p.peace}t` : 'Peace')),
              h(
                'div.facts',
                {},
                h('span', { title: 'Score' }, icon('chart', 12, '#8fa1b3'), String(p.score)),
                h('span', { title: 'Cities' }, icon('city', 12, '#c8b07a'), String(p.cities)),
                p.openBorders && h('span', { title: 'Your borders are open to them' }, icon('trade', 12, '#7bd16a'), 'Open borders'),
                p.religion && h('span', { title: 'Their religion' }, icon('faith', 12, YIELD_COLOR.faith), religion(p.religion)),
                p.influence !== undefined && h('span', { title: 'Your cultural influence over them (100%: influential)' }, icon('tourism', 12, YIELD_COLOR.tourism), `${Math.round(p.influence * 100)}%`),
              ),
            ),
          ),
        )
      : h('div.ov-empty', {}, 'You haven’t met another civilization yet.'),
    civs.length > 0 && h('div.cv-label', { style: 'margin:14px 0 6px' }, 'World politics'),
    civs.length > 0 && h('div.gp-wrap', {}, ...renderPolitics(false)),
    states.length > 0 && h('div.cv-label', { style: 'margin:14px 0 6px' }, `City-states · ${states.length} met`),
    states.length > 0 &&
      h(
        'div.ov-states',
        {},
        ...states.map((p) => {
          const cs = p.cityState!;
          const ally = cs.ally >= 0 ? v.players[cs.ally] : null;
          return h(
            'div.ov-state',
            {},
            emblemEl(p.civ, 22, cs.kind),
            h('b', { 'data-pedia': `citystate:${cs.kind}` }, p.name),
            h('small.cv-muted', { style: 'text-transform:capitalize' }, cs.kind),
            h('span.cv-grow'),
            h(`span.cv-chip${cs.standing === 'ally' ? '.good' : cs.standing === 'friend' ? '.on' : cs.standing === 'war' ? '.bad' : ''}`, { style: 'text-transform:capitalize' }, `${cs.standing} · ${cs.influence}`),
            h('small.cv-muted', { style: 'width:120px;text-align:right' }, ally ? `ally: ${ally.index === me() ? 'you' : ally.met ? ally.name : 'someone'}` : 'no ally'),
          );
        }),
      ),
    h('div', { style: 'margin-top:14px' }, h('button.cv-btn.small', { onclick: () => togglePanel('diplomacy') }, icon('peace', 13), 'War, peace and gifts')),
  );
}

// -------------------------------------------------------------------------------------------------
// The panel
// -------------------------------------------------------------------------------------------------

export function renderOverview(): El {
  const body = tab === 'cities' ? renderCities() : tab === 'units' ? renderUnits() : tab === 'demographics' ? renderDemographics() : renderDiplomacy();
  return h(
    `div.cv-big.cv-panel.ov-panel.ov-${tab}`,
    {},
    h('button.cv-x', { onclick: () => togglePanel('overview'), html: svg('close', 15), title: 'Close (Esc)' }),
    h(
      'div.title',
      {},
      tile('chart', '#3a5a7a', 40),
      h('div', {}, h('div.cv-h.big', {}, 'Overview'), h('small.cv-muted', {}, 'Your empire at a glance')),
      h('div.ov-tabs', {}, ...TABS.map(([t, name, glyph]) => h(`button${tab === t ? '.on' : ''}`, { onclick: () => ((tab = t), store.changed++) }, icon(glyph, 15), name))),
    ),
    body,
  );
}

export const OVERVIEW_CSS = `
.ov-panel > .title { flex-wrap: wrap; }
.ov-tabs { display: flex; gap: 3px; margin-left: 18px; padding: 3px; border-radius: 11px; background: rgba(0,0,0,.22); border: 1px solid var(--line); }
.ov-tabs button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px; font-weight: 650; color: var(--muted) !important; }
.ov-tabs button:hover { color: var(--text) !important; background: rgba(255,255,255,.06) !important; }
.ov-tabs button.on { background: rgba(242,193,78,.15) !important; color: #ffe3a1 !important; }
.ov-scroll { flex: 1; min-height: 0; }
.ov-unit.chosen { box-shadow: inset 2px 0 0 #f2c14e; background: rgba(242,193,78,.08); }
.ov-table td.made { cursor: pointer; } .ov-table td.made:hover { background: rgba(255,255,255,.06); }
.ov-table td.made > span { display: inline-flex; align-items: center; gap: 6px; }
.ov-table tr.picking td { background: rgba(242,193,78,.08); }
.ov-pick > td { padding: 0 10px 10px !important; background: rgba(0,0,0,.18); }
.ov-picker { max-height: 340px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding: 8px 4px; }
.ov-empty { padding: 30px; text-align: center; color: var(--muted); }
.ov-table { width: 100%; border-collapse: separate; border-spacing: 0; font-variant-numeric: tabular-nums; }
.ov-table th { position: sticky; top: 0; z-index: 1; background: #141c27; text-align: right; padding: 8px 10px; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); border-bottom: 1px solid var(--line2); cursor: pointer; white-space: nowrap; user-select: none; }
.ov-table th:first-child { text-align: left; border-radius: 8px 0 0 0; } .ov-table th:last-child { border-radius: 0 8px 0 0; }
.ov-table th span { display: inline-flex; align-items: center; gap: 4px; }
.ov-table th:hover { color: var(--text); } .ov-table th.on { color: #ffe3a1; }
.ov-table th i { font-style: normal; }
.ov-table td { padding: 7px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.ov-table td.n { text-align: right; font-weight: 600; }
.ov-table td.name { font-size: 13.5px; } .ov-table td.name > span { display: inline-flex; align-items: center; gap: 6px; }
.ov-table td.made { text-align: right; } .ov-table td.made > span { display: inline-flex; align-items: center; gap: 7px; font-weight: 600; }
.ov-table td.made .cv-tile, .ov-table td.made .cv-pic { border-radius: 6px; }
.ov-table td.def > span { display: inline-flex; align-items: center; gap: 7px; justify-content: flex-end; width: 100%; } .ov-table td.def .cv-bar { width: 54px; }
.ov-table tr.go { cursor: pointer; } .ov-table tr.go:hover td { background: rgba(255,255,255,.05); }
.ov-table tfoot td { border-bottom: 0; color: var(--muted); font-weight: 700; }
.ov-table .bad { color: #ff8a7a; font-weight: 700; }
.ov-filters { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
.ov-filters .cv-chip, .nt-filters .cv-chip { cursor: pointer; }
.cv-chip .dot, .ov-unit .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
.ov-units { flex: 1; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.ov-units .ov-scroll { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 10px; align-content: start; }
.ov-group { padding: 8px; border-radius: 12px; background: rgba(255,255,255,.035); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 2px; }
.ov-ghead { display: flex; align-items: center; gap: 8px; padding: 0 4px 4px; font-size: 13.5px; }
.ov-ghead .stat { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 700; }
.ov-unit { display: flex; align-items: center; gap: 10px; padding: 5px 6px; border-radius: 8px; cursor: pointer; font-size: 12.5px; }
.ov-unit:hover { background: rgba(255,255,255,.06); }
.ov-unit .st { display: inline-flex; align-items: center; gap: 6px; width: 150px; font-weight: 650; }
.ov-unit .hp .cv-bar { width: 50px; }
.ov-unit .mv { display: inline-flex; align-items: center; gap: 3px; width: 46px; justify-content: flex-end; color: var(--muted); font-weight: 600; }
.ov-split { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 18px; margin-bottom: 14px; }
.ov-split .cv-label { margin-bottom: 6px; }
.ov-great { margin-top: 14px; }
.ov-gp { display: grid; grid-template-columns: 18px minmax(110px, auto) 1fr auto; align-items: center; gap: 8px; padding: 3px 0; }
.ov-demo th { cursor: default; } .ov-demo td.name { font-weight: 650; } .ov-demo td.name small { font-weight: 500; }
.ov-demo .place { padding: 2px 8px; border-radius: 99px; background: rgba(255,255,255,.07); }
.ov-demo .place.first { background: rgba(111,210,122,.18); color: #b9f0c0; } .ov-demo .place.last { background: rgba(255,107,94,.16); color: #ffc2bb; }
.ov-demo .by { display: inline-flex; align-items: center; gap: 5px; }
.ov-ranks { display: flex; flex-direction: column; gap: 3px; }
.ov-rank { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: 9px; background: rgba(255,255,255,.035); }
.ov-rank.me { background: rgba(242,193,78,.1); box-shadow: inset 0 0 0 1px rgba(242,193,78,.35); }
.ov-rank .i { width: 16px; color: var(--muted); }
.ov-rank .unmet { width: 20px; height: 20px; border-radius: 50%; background: rgba(255,255,255,.08); display: inline-flex; align-items: center; justify-content: center; font-weight: 800; color: var(--muted); font-size: 11px; }
.ov-civs { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 8px; }
.ov-civ { padding: 10px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.ov-civ.gone { opacity: .5; }
.ov-civ .top { display: flex; align-items: center; gap: 10px; }
.ov-civ .facts { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; font-weight: 600; color: #c3ccd6; }
.ov-civ .facts span { display: inline-flex; align-items: center; gap: 4px; }
.ov-states { display: flex; flex-direction: column; gap: 4px; }
.ov-state { display: flex; align-items: center; gap: 9px; padding: 6px 10px; border-radius: 10px; background: rgba(255,255,255,.035); }
@media (max-width: 900px) {
  .ov-tabs { margin-left: 0; width: 100%; } .ov-tabs button { flex: 1; justify-content: center; padding: 6px 4px; }
  .ov-split { grid-template-columns: 1fr; }
  .ov-units .ov-scroll { grid-template-columns: 1fr; }
  .ov-unit .st { width: 120px; }
  /* The table wider than the screen: each city's name stays at the left as its numbers and build scroll by. */
  .ov-table th:first-child, .ov-table td:first-child { position: sticky; left: 0; z-index: 2; background: #1d232e; }
}
`;
