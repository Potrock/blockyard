import type { CityWire } from '../protocol';
import { CIVS } from '../rules/civs';
import { distance, neighbours, within } from '../rules/hex';
import { NATURAL_WONDERS } from '../rules/nature';
import { RESOURCES, TERRAINS, type Yields } from '../rules/terrain';
import { UNITS } from '../rules/units';
import { centreHere, landY, lookAt, toScreen } from './camera';
import { icon, resourceGlyph } from './icons';
import { mapFont } from './pixel';
import { myUnit, store } from './store';
import { h, type El } from './ui';

/**
 * The lenses: ways of seeing the map, one at a time, from the corner by the minimap (or Y and L).
 * Yields (every tile's, drawn by the overlay), Settler (how good each tile you know would be for a
 * new city, the best sites starred, on by itself while a Settler's selected), Resources (each kind
 * by colour, improved or not, and whose), Religion (each city's faith, its followers and the pressure
 * on it) and Borders (each civ's land in its colours, and the tile each of your cities claims next).
 */

export type Lens = 'yields' | 'settler' | 'resources' | 'religion' | 'borders';

const LENSES: { id: Lens; name: string; glyph: string; text: string }[] = [
  { id: 'yields', name: 'Yields', glyph: 'food', text: 'What every tile you know yields' },
  { id: 'settler', name: 'Settler', glyph: 'city', text: 'Where a new city would do best' },
  { id: 'resources', name: 'Resources', glyph: 'gems', text: 'Luxuries, strategic and bonus resources' },
  { id: 'religion', name: 'Religion', glyph: 'faith', text: 'Each city’s faith, and the pressure on it' },
  { id: 'borders', name: 'Borders', glyph: 'hexes', text: 'Whose land is whose, and where yours grows next' },
];

/** The lens on show: the one chosen, or the Settler lens while a Settler's selected. */
export function activeLens(): Lens | null {
  if (store.lens) return store.lens;
  const sel = myUnit(store.selectedUnit);
  return sel && UNITS[sel.type]?.abilities?.includes('found_city') ? 'settler' : null;
}

/** A lens on (or off, if it's the one on). */
export function setLens(lens: Lens) {
  store.lens = store.lens === lens ? null : lens;
  store.changed++;
}

/** The next lens along (L), and after the last, none. */
export function cycleLens() {
  const i = store.lens ? LENSES.findIndex((l) => l.id === store.lens) : -1;
  store.lens = i + 1 < LENSES.length ? LENSES[i + 1].id : null;
  store.changed++;
}

// -------------------------------------------------------------------------------------------------
// The Settler lens: what a city here would have
// -------------------------------------------------------------------------------------------------

export interface Site {
  score: number;
  /** What makes it good or poor, in a few words each. */
  good: string[];
  poor: string[];
}

/** Each known land tile's worth as a city site (null: no city can be founded there), for one view. */
let sites: { seq: number; at: Map<number, Site | null>; best: number; low: number; picks: number[] } | null = null;

/**
 * A tile's worth for a new city, as the bots weigh it (`rules/ai/settle.ts`): the food and production
 * of the land within reach (nearest counts most), fresh water, the coast, a hill to stand on,
 * luxuries (new ones most), strategic resources and natural wonders; less for land others hold or
 * yours already works, sea everywhere, the unexplored (what it holds isn't known), and little food
 * near (a city on bare hills can't grow, however rich they are). Only from what this player knows.
 */
function siteOf(t: number): Site | null {
  const g = store.grid!;
  const v = store.view!;
  const s = store.terrain[t];
  const k = store.known[t];
  if (!s || !k || TERRAINS[s.terrain]?.water || s.elevation === 'mountain' || s.feature === 'ice' || s.terrain === 'snow' || k.wonder) return null;
  if (k.owner >= 0 && k.owner !== v.you) return null;
  if (v.cities.some((c) => distance(g, c.tile, t) < 3)) return null;
  const good: string[] = [];
  const poor: string[] = [];
  let score = 0;
  let water = 0;
  let unknown = 0;
  let others = 0;
  let mine = 0;
  const lux = new Set<string>();
  const strat = new Set<string>();
  const wonders = new Set<string>();
  const have = new Set(v.self.luxuries);
  for (const x of within(g, t, 3)) {
    if (x === t) continue;
    const kx = store.known[x];
    if (!kx) {
      unknown++;
      continue;
    }
    const ring = distance(g, t, x);
    const y: Yields = store.yields[x] ?? {};
    score += ((y.food ?? 0) * 1.6 + (y.prod ?? 0) * 1.2 + (y.gold ?? 0) * 0.5) * (ring === 1 ? 1.2 : ring === 2 ? 1 : 0.45);
    if (TERRAINS[store.terrain[x]?.terrain]?.water) water++;
    if (kx.owner >= 0 && kx.owner !== v.you) others++;
    else if (kx.owner === v.you && ring <= 2) mine++;
    // A natural wonder: its science, culture and faith too, and the pride of it.
    const nature = kx.wonder ? NATURAL_WONDERS[kx.wonder] : undefined;
    if (nature) {
      score += 3 + (y.science ?? 0) + (y.culture ?? 0) + (y.faith ?? 0);
      wonders.add(nature.name);
    }
    const r = kx.resource ? RESOURCES[kx.resource] : undefined;
    if (r && ring <= 3) {
      if (r.kind === 'luxury') {
        score += have.has(kx.resource) ? 3 : 6;
        lux.add(r.name);
      } else if (r.kind === 'strategic') {
        score += 2.5;
        strat.add(r.name);
      } else score += 1;
    }
  }
  const next = neighbours(g, t);
  const fresh = s.river || next.some((n) => store.terrain[n]?.terrain === 'lake' || store.known[n]?.feature === 'oasis' || !!NATURAL_WONDERS[store.known[n]?.wonder ?? '']?.freshWater);
  if (fresh) {
    score += 6;
    good.push(s.river ? 'a river' : 'fresh water');
  }
  if (next.some((n) => store.terrain[n]?.terrain === 'coast')) {
    score += 3;
    good.push('the coast');
  }
  if (s.elevation === 'hills') {
    score += 3;
    good.push('a hill to stand on');
  }
  if (wonders.size) good.push([...wonders].join(', '));
  if (lux.size) good.push(`${[...lux].join(', ')}`);
  if (strat.size) good.push(`${[...strat].join(', ')}`);
  if (water > 18) {
    score -= (water - 18) * 1.2;
    poor.push('mostly sea');
  }
  if (others) {
    score -= others * 2.5;
    poor.push('land others hold');
  }
  if (mine > 3) {
    score -= (mine - 3) * 1;
    poor.push('land your cities work');
  }
  if (unknown > 8) poor.push('much of it unexplored');
  const food = within(g, t, 2).reduce((n, x) => n + (store.yields[x]?.food ?? 0), 0);
  if (food < 14) {
    score -= (14 - food) * 2.5;
    poor.push('little food');
  } else if (food >= 24) good.push('plenty of food');
  return { score, good, poor };
}

/** The sites of the view on show (worked out once a view). */
function siteMap() {
  const seq = store.viewSeq;
  if (sites?.seq === seq) return sites;
  const at = new Map<number, Site | null>();
  const n = store.known.length;
  for (let t = 0; t < n; t++) if (store.known[t]) at.set(t, siteOf(t));
  const scores = [...at.values()].filter((x): x is Site => !!x).map((x) => x.score).sort((a, b) => a - b);
  const best = scores[scores.length - 1] ?? 1;
  const low = scores[Math.floor(scores.length * 0.25)] ?? 0;
  // The best few: each the best within two tiles, in the top fifth, three or more apart.
  const g = store.grid!;
  const top = scores[Math.floor(scores.length * 0.8)] ?? best;
  const picks: number[] = [];
  const ranked = [...at.entries()].filter((e): e is [number, Site] => !!e[1] && e[1].score >= top).sort((a, b) => b[1].score - a[1].score);
  for (const [t] of ranked) {
    if (picks.length >= 5) break;
    if (picks.every((p) => distance(g, p, t) >= 4)) picks.push(t);
  }
  return (sites = { seq, at, best, low, picks });
}

/** A site's worth on the lens's scale, 0 (poor) to 1 (the best known). */
const worth = (s: Site, m: { best: number; low: number }) => Math.max(0, Math.min(1, (s.score - m.low) / Math.max(1, m.best - m.low)));

/** The scale's colour: red, then amber, then green. */
function scaleColor(f: number, alpha: number): string {
  const stops = [
    [214, 74, 58],
    [232, 163, 58],
    [122, 210, 90],
    [70, 220, 140],
  ];
  const x = f * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const u = x - i;
  const c = stops[i].map((a, j) => Math.round(a + (stops[i + 1][j] - a) * u));
  return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}

// -------------------------------------------------------------------------------------------------
// Religion: each religion's colour, and the pressure on a city
// -------------------------------------------------------------------------------------------------

const FAITH_COLORS = ['#f2c14e', '#6ab8ff', '#e86a9a', '#7bd16a', '#b88aff', '#ff9a4a', '#4ad8d0', '#e8e2d0'];
export const faithColor = (id: string) => FAITH_COLORS[Math.max(0, store.view?.religions.findIndex((r) => r.id === id) ?? 0) % FAITH_COLORS.length];
const faithName = (id: string) => store.view?.religions.find((r) => r.id === id)?.name ?? id;

/** The pressure each religion puts on a city each turn, from the cities this player knows of (the rules': ten tiles, holy cities twice). */
function pressureOn(city: CityWire): [string, number][] {
  const v = store.view!;
  const g = store.grid!;
  const out = new Map<string, number>();
  for (const c of v.cities) {
    if (c === city || !c.religion || distance(g, c.tile, city.tile) > 10) continue;
    const holy = v.religions.some((r) => r.id === c.religion && r.holyCity === c.name) ? 2 : 1;
    out.set(c.religion, (out.get(c.religion) ?? 0) + holy);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

// -------------------------------------------------------------------------------------------------
// Drawing
// -------------------------------------------------------------------------------------------------

/** What the overlay lends a lens to draw with. */
export interface Pen {
  ctx: CanvasRenderingContext2D;
  /** A tile's hexagon added to a path (shrunk toward its middle); false if it's off the screen. */
  hex: (p: CanvasPath, t: number, y: number, shrink?: number) => boolean;
  /** A glyph centred at a point. */
  glyph: (name: string, x: number, y: number, size: number, color: string) => boolean;
  /** How big a tile is on the screen, over the screen's own fit (`store.uiFit`: a big screen's as a smaller one's). */
  zoomed: number;
  /** The interface's scale (`store.uiScale`): a mark sized in its lengths is this many times that on the screen. */
  ui: number;
}

/** The lens on show, over the tiles on the screen (the Yields lens is the overlay's own). */
export function drawLens(pen: Pen, shown: number[]) {
  const lens = activeLens();
  if (lens === 'settler') drawSettler(pen, shown);
  else if (lens === 'resources') drawResources(pen, shown);
  else if (lens === 'religion') drawReligion(pen, shown);
  else if (lens === 'borders') drawBorders(pen, shown);
}

/** Every tile in `tiles` filled in one colour. */
function fill(pen: Pen, tiles: number[], color: string, shrink = 1) {
  if (!tiles.length) return;
  const p = new Path2D();
  for (const t of tiles) pen.hex(p, t, landY(t) + 0.32, shrink);
  pen.ctx.fillStyle = color;
  pen.ctx.fill(p);
}

/** A soft dark veil over the known tiles a lens says nothing about, so what it shows stands out. */
const veil = (pen: Pen, tiles: number[]) => fill(pen, tiles, 'rgba(8,12,18,0.42)');

function drawSettler(pen: Pen, shown: number[]) {
  const m = siteMap();
  const out: number[] = [];
  const by = new Map<string, number[]>();
  for (const t of shown) {
    if (!store.known[t]) continue;
    const s = m.at.get(t);
    if (!s) {
      if (!TERRAINS[store.terrain[t]?.terrain]?.water) out.push(t);
      continue;
    }
    // (Colours in a dozen steps, each filled at once.)
    const c = scaleColor(Math.round(worth(s, m) * 12) / 12, 0.4);
    const list = by.get(c);
    if (list) list.push(t);
    else by.set(c, [t]);
  }
  veil(pen, out);
  for (const [c, list] of by) fill(pen, list, c, 0.94);
  // The best sites: a pin with their place.
  const { ctx } = pen;
  m.picks.forEach((t, i) => {
    if (!shown.includes(t)) return;
    const c = centreHere(store.grid!, t);
    // (Low in its hex: clear of any unit's flag over it.)
    const s = toScreen(c.x, landY(t) + 0.6, c.z + 1.7);
    if (!s) return;
    // A block with its place: gold for the best, green for the rest.
    const r = Math.round(Math.max(9, pen.zoomed * 0.36) * pen.ui);
    const [x0, y0] = [Math.round(s.x - r), Math.round(s.y - r)];
    ctx.fillStyle = '#07090c';
    ctx.fillRect(x0 - 2, y0 - 2, r * 2 + 4, r * 2 + 4);
    ctx.fillStyle = i === 0 ? '#f2c14e' : '#7ad88a';
    ctx.fillRect(x0, y0, r * 2, r * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x0, y0, r * 2, 2);
    ctx.font = mapFont(Math.round(r * 1.1));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#10161e';
    ctx.fillText(String(i + 1), s.x, s.y + r * 0.06);
  });
}

const KIND_COLOR: Record<string, string> = { luxury: '#f2c14e', strategic: '#ff6b5e', bonus: '#7bd16a' };

function drawResources(pen: Pen, shown: number[]) {
  const { ctx } = pen;
  const plain: number[] = [];
  const kinds = new Map<string, number[]>();
  for (const t of shown) {
    const k = store.known[t];
    if (!k) continue;
    const r = k.resource ? RESOURCES[k.resource] : undefined;
    if (!r) {
      plain.push(t);
      continue;
    }
    const list = kinds.get(r.kind) ?? [];
    list.push(t);
    kinds.set(r.kind, list);
  }
  veil(pen, plain);
  for (const [kind, list] of kinds) fill(pen, list, `${KIND_COLOR[kind]}55`, 0.92);
  for (const list of kinds.values())
    for (const t of list) {
      const k = store.known[t]!;
      const r = RESOURCES[k.resource];
      const c = centreHere(store.grid!, t);
      const s = toScreen(c.x, landY(t) + 1.2, c.z);
      if (!s) continue;
      const rad = Math.round(Math.max(9, pen.zoomed * 0.42) * pen.ui);
      // Its owner's colour round it; inside, the resource; a tick once it's improved.
      const [x0, y0] = [Math.round(s.x - rad), Math.round(s.y - rad)];
      ctx.fillStyle = k.owner >= 0 ? (CIVS[store.view!.players[k.owner]?.civ ?? '']?.color ?? '#888') : KIND_COLOR[r.kind];
      ctx.fillRect(x0 - 3, y0 - 3, rad * 2 + 6, rad * 2 + 6);
      ctx.fillStyle = 'rgba(13,19,27,0.92)';
      ctx.fillRect(x0, y0, rad * 2, rad * 2);
      pen.glyph(resourceGlyph(k.resource), s.x, s.y, rad * 1.25, r.color);
      if (k.improvement && k.improvement === r.improvement) {
        const t = Math.round(rad * 0.42);
        ctx.fillStyle = '#07090c';
        ctx.fillRect(Math.round(s.x + rad * 0.8) - t - 2, Math.round(s.y - rad * 0.8) - t - 2, t * 2 + 4, t * 2 + 4);
        ctx.fillStyle = '#3f8f4f';
        ctx.fillRect(Math.round(s.x + rad * 0.8) - t, Math.round(s.y - rad * 0.8) - t, t * 2, t * 2);
        pen.glyph('check', s.x + rad * 0.8, s.y - rad * 0.8, rad * 0.6, '#ffffff');
      }
    }
}

function drawReligion(pen: Pen, shown: number[]) {
  const v = store.view!;
  const { ctx } = pen;
  const byCity = new Map(v.cities.map((c) => [c.id, c]));
  const plain: number[] = [];
  const tint = new Map<string, number[]>();
  for (const t of shown) {
    const k = store.known[t];
    if (!k) continue;
    const r = k.city >= 0 ? byCity.get(k.city)?.religion : null;
    if (!r) {
      plain.push(t);
      continue;
    }
    const list = tint.get(r) ?? [];
    list.push(t);
    tint.set(r, list);
  }
  veil(pen, plain);
  for (const [r, list] of tint) fill(pen, list, `${faithColor(r)}55`, 0.97);
  // Each city's believers: a bar of its citizens by faith under its banner.
  for (const c of v.cities) {
    if (!shown.includes(c.tile) || !c.followers || !Object.keys(c.followers).length) continue;
    const at = centreHere(store.grid!, c.tile);
    const s = toScreen(at.x, landY(c.tile) + 3.4, at.z);
    if (!s) continue;
    const w = Math.max(40, pen.zoomed * 2.2) * pen.ui;
    const hgt = Math.max(5, pen.zoomed * 0.22) * pen.ui;
    const total = Math.max(c.pop, Object.values(c.followers).reduce((a, b) => a + b, 0));
    ctx.fillStyle = 'rgba(13,19,27,0.9)';
    ctx.fillRect(s.x - w / 2 - 2, s.y - 2, w + 4, hgt + 4);
    let x = s.x - w / 2;
    for (const [r, n] of Object.entries(c.followers).sort((a, b) => b[1] - a[1])) {
      const part = (w * n) / total;
      ctx.fillStyle = faithColor(r);
      ctx.fillRect(x, s.y, part, hgt);
      x += part;
    }
  }
}

function drawBorders(pen: Pen, shown: number[]) {
  const v = store.view!;
  const { ctx } = pen;
  const owners = new Map<number, number[]>();
  const none: number[] = [];
  for (const t of shown) {
    const k = store.known[t];
    if (!k) continue;
    if (k.owner < 0) {
      none.push(t);
      continue;
    }
    const list = owners.get(k.owner) ?? [];
    list.push(t);
    owners.set(k.owner, list);
  }
  veil(pen, none);
  for (const [owner, list] of owners) fill(pen, list, `${CIVS[v.players[owner]?.civ ?? '']?.color ?? '#888888'}66`);
  // Where each of your cities' borders grow next, and when.
  for (const c of v.cities) {
    if (c.owner !== v.you || c.nextTile === undefined || c.nextTile === null || !shown.includes(c.nextTile)) continue;
    const t = c.nextTile;
    const p = new Path2D();
    if (!pen.hex(p, t, landY(t) + 0.35, 0.86)) continue;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#d68ae8';
    ctx.stroke(p);
    ctx.restore();
    const at = centreHere(store.grid!, t);
    const s = toScreen(at.x, landY(t) + 1, at.z);
    if (!s) continue;
    const label = c.borderTurns ? `${c.borderTurns}t` : '—';
    ctx.font = mapFont(Math.round(Math.max(10, pen.zoomed * 0.42) * pen.ui));
    const tw = ctx.measureText(label).width + 22 * pen.ui;
    const hh = Math.max(16, pen.zoomed * 0.7) * pen.ui;
    ctx.fillStyle = 'rgba(13,19,27,0.9)';
    ctx.fillRect(Math.round(s.x - tw / 2), Math.round(s.y - hh / 2), Math.round(tw), Math.round(hh));
    pen.glyph('culture', s.x - tw / 2 + 9 * pen.ui, s.y, hh * 0.6, '#d68ae8');
    ctx.fillStyle = '#f0d8ff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, s.x - tw / 2 + 17 * pen.ui, s.y + 0.5);
  }
}

// -------------------------------------------------------------------------------------------------
// The switcher, its key, and what a lens adds to a tile's tooltip
// -------------------------------------------------------------------------------------------------

/** The lens buttons, over the minimap. */
export function lensBar(): El {
  const on = activeLens();
  return h(
    'div.cv-lenses',
    {},
    ...LENSES.map((l) =>
      h(`button${on === l.id ? '.on' : ''}`, { onclick: () => setLens(l.id), title: `${l.name} lens${l.id === 'yields' ? ' (Y)' : ''}: ${l.text.toLowerCase()}${l.id === 'settler' ? ' (on by itself with a Settler selected)' : ''}. L goes through them.` }, icon(l.glyph, 13), on === l.id && h('span', {}, l.name)),
    ),
  );
}

/** What the lens on show means: its colours, above the minimap. */
export function lensKey(): El | null {
  const on = activeLens();
  const lens = LENSES.find((l) => l.id === on);
  if (!lens || on === 'yields') return null;
  const swatch = (color: string, text: string) => h('span.lk-item', {}, h('i', { style: `background:${color}` }), text);
  const rows: El[] = [];
  if (on === 'settler') {
    rows.push(h('div.lk-scale', {}, h('i', { style: `background:linear-gradient(90deg, ${scaleColor(0, 1)}, ${scaleColor(0.5, 1)}, ${scaleColor(1, 1)})` })), h('div.lk-ends', {}, h('span', {}, 'Poor'), h('span', {}, 'Best')));
    rows.push(h('small.cv-muted', {}, 'Numbered: the best sites you know. Dark: no city can stand there.'));
    // (Each of the best sites a click away: on islands they're mostly off the screen.)
    const picks = siteMap().picks;
    if (picks.length)
      rows.push(
        h(
          'div.lk-picks',
          {},
          h('span.cv-muted', {}, 'Look at:'),
          ...picks.map((t, i) =>
            h(
              `button.cv-btn.small${i === 0 ? '.gold' : ''}`,
              {
                onclick: () => {
                  const c = centreHere(store.grid!, t);
                  lookAt(c.x, c.z);
                },
                title: `The ${i === 0 ? 'best' : `${i + 1}${['', 'nd', 'rd', 'th', 'th'][i]} best`} site you know`,
              },
              String(i + 1),
            ),
          ),
        ),
      );
  } else if (on === 'resources') rows.push(h('div.lk-items', {}, swatch(KIND_COLOR.luxury, 'Luxury'), swatch(KIND_COLOR.strategic, 'Strategic'), swatch(KIND_COLOR.bonus, 'Bonus')), h('small.cv-muted', {}, 'Ringed in its owner’s colour; ticked once improved.'));
  else if (on === 'religion') {
    const rels = store.view!.religions;
    rows.push(rels.length ? h('div.lk-items', {}, ...rels.map((r) => swatch(faithColor(r.id), `${r.name} · ${r.cities}`))) : h('small.cv-muted', {}, 'No religion has been founded yet.'));
    rows.push(h('small.cv-muted', {}, 'Each city’s land in its faith; the bar: its believers.'));
  } else if (on === 'borders') rows.push(h('small.cv-muted', {}, 'Each civilization’s land in its colours; dashed: the tile each of your cities claims next, and when.'));
  return h('div.cv-lenskey.cv-panel', {}, h('div.lk-head', {}, icon(lens.glyph, 14, '#f2c14e'), h('b', {}, `${lens.name} lens`), h('button.cv-x.lk-x', { onclick: () => ((store.lens = null), (store.changed++)), title: 'Off' }, icon('close', 12))), ...rows);
}

/** What the lens on show says of a tile, for its tooltip. */
export function lensTip(t: number): El[] {
  const lens = activeLens();
  if (lens === 'settler') {
    const s = siteMap().at.get(t);
    if (s === undefined) return [];
    if (!s) return [h('div.ln.way.no', {}, icon('close', 13), 'No city can be founded here')];
    const m = siteMap();
    const f = worth(s, m);
    const out = [h('div.ln.way', { style: `color:${scaleColor(f, 1)}` }, icon('city', 13), `${f > 0.8 ? 'An excellent' : f > 0.55 ? 'A good' : f > 0.3 ? 'A fair' : 'A poor'} city site`)];
    if (s.good.length) out.push(h('div.ln', {}, icon('check', 13, '#7bd16a'), s.good.join(' · ')));
    if (s.poor.length) out.push(h('div.ln', {}, icon('info', 13, '#ff8a7a'), s.poor.join(' · ')));
    return out;
  }
  if (lens === 'religion') {
    const k = store.known[t];
    const city = store.view!.cities.find((c) => c.tile === t);
    if (!k || !city) return [];
    const out: El[] = [];
    const followers = Object.entries(city.followers ?? {}).sort((a, b) => b[1] - a[1]);
    out.push(h('div.ln', {}, icon('faith', 13, '#e8e2d0'), followers.length ? followers.map(([r, n]) => `${faithName(r)} ${n}`).join(' · ') + ` of ${city.pop}` : 'No believers yet'));
    const press = pressureOn(city);
    if (press.length) out.push(h('div.ln', {}, icon('moves', 13, '#b88aff'), `Pressure a turn: ${press.map(([r, n]) => `${faithName(r)} +${n}`).join(' · ')}`));
    return out;
  }
  return [];
}

export const LENS_CSS = `
.cv-lenses { position: absolute; left: 9px; top: 9px; display: flex; gap: 3px; }
.cv-lenses button { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 7px; border-radius: 99px; background: rgba(10,14,20,.82) !important; border: 1px solid var(--line2) !important; font-size: 11px; font-weight: 700; color: var(--muted) !important; }
.cv-lenses button:hover { color: var(--text) !important; }
.cv-lenses button.on { background: rgba(242,193,78,.2) !important; border-color: rgba(242,193,78,.7) !important; color: #ffe3a1 !important; padding-right: 9px; }
.cv-lenskey { padding: 9px 10px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; position: relative; }
.lk-head { display: flex; align-items: center; gap: 6px; padding-right: 22px; }
.cv-lenskey .lk-x { top: 6px; right: 6px; width: 20px; height: 20px; }
.lk-scale i { display: block; height: 8px; border-radius: 4px; }
.lk-ends { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: -3px; }
.lk-items { display: flex; flex-wrap: wrap; gap: 4px 10px; }
.lk-item { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; }
.lk-item i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.lk-picks { display: flex; align-items: center; gap: 4px; }
.lk-picks .cv-btn { min-width: 24px; justify-content: center; }
@media (max-width: 760px), (max-height: 520px) {
  .cv-lenses button { height: 20px; padding: 0 5px; }
  .cv-lenskey { display: none; }
}
`;
