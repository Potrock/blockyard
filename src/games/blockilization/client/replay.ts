import { BUILDINGS } from '../rules/buildings';
import { CIVS } from '../rules/civs';
import { ReplayPlayer, replayEnd, type Replay, type ReplayEvent } from '../rules/replay';
import { ERA_NAMES, ERAS } from '../rules/techs';
import { TERRAINS } from '../rules/terrain';
import { icon, svg } from './icons';
import { store } from './store';
import { h, year, type El } from './ui';

/**
 * The game's replay on the result card (Civilization's map timelapse): the whole map from the first
 * turn to the last, each civ's land in its colour with a line where it meets another's, its cities
 * (an original capital in gold), a ring where a city is founded, taken or lost or a wonder is built;
 * beside it the story so far, the latest first (cities, wars and peace, wonders, eras, the fallen,
 * the victory). It plays at a few turns a second, and can be paused, scrubbed and sped up. Drawn in
 * pixels, each tile a little hex of them, the land redrawn only when the turn changes.
 */

/** The map's width on the card (CSS pixels), and how many lines of the story show. */
const MAP_WIDTH = 468;
const LOG_LINES = 11;
/** Turns a second at each speed, and the speed it starts at. */
const SPEEDS: [string, number][] = [
  ['1×', 5],
  ['2×', 10],
  ['4×', 20],
];
const START_SPEED = 1;
/** How long a ring shows where something happened (seconds). */
const RING = 0.9;

/** The land's colours with nobody's on it (muted, so the civs' stand out). */
const LAND: Record<string, string> = { grassland: '#4c6a3c', plains: '#76714a', desert: '#a3966c', tundra: '#66705f', snow: '#b9bec4', coast: '#2c4b6b', ocean: '#1b2d45', lake: '#2c4b6b' };
const MOUNTAIN = '#6a6a6e';
const OFF_MAP = '#11141a';
const CITY = '#f4f1ea';
const CAPITAL = '#f2c14e';
const OUTLINE = '#07090c';

/** A colour as the canvas's pixels hold it (little-endian RGBA), mixed toward another by `k`. */
function rgba(hex: string, toward?: string, k = 0): number {
  const c = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const [r, g, b] = [0, 1, 2].map((i) => Math.round(c(hex, i) * (1 - k) + (toward ? c(toward, i) : 0) * k));
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

const colourOf = (owner: number) => CIVS[store.view?.players[owner]?.civ ?? '']?.color ?? '#888888';
const nameOf = (owner: number) => {
  const p = store.view?.players[owner];
  return p ? (CIVS[p.civ]?.name ?? p.name) : '?';
};

/** The map laid out in pixels: each pixel's tile (-1 off the map), the pixels on a tile's edge (and the tile across it), and each tile's middle. */
interface Layout {
  w: number;
  h: number;
  tileOf: Int16Array;
  rim: Int32Array;
  across: Int16Array;
  middle: { x: number; y: number }[];
  /** A tile's width in pixels. */
  size: number;
}

function layout(cols: number, rows: number, first = 0): Layout {
  // Pointy-topped hexes `size` across, rows three quarters of a hex apart, every other one pushed half a hex.
  // (A world that wraps is drawn from its column `first`: the tile drawn c columns in is the one c on from it.)
  const size = Math.max(6, Math.floor(MAP_WIDTH / (cols + 0.5) / 2) * 2);
  const tall = size * 1.1547;
  const step = tall * 0.75;
  const w = Math.ceil((cols + 0.5) * size);
  const h = Math.ceil((rows - 1) * step + tall);
  const at = (r: number, c: number) => r * cols + ((c + first) % cols);
  const middle: { x: number; y: number }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) middle[at(r, c)] = { x: (c + 0.5 + (r & 1) * 0.5) * size, y: r * step + tall / 2 };
  // Each pixel to the tile whose middle is nearest (the hexes tile the plane), if it's inside that hex.
  const tileOf = new Int16Array(w * h).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const r0 = Math.floor((py - tall / 2) / step);
      let best = -1;
      let bestD = Infinity;
      for (let r = r0 - 1; r <= r0 + 2; r++) {
        if (r < 0 || r >= rows) continue;
        const c0 = Math.round(px / size - 0.5 - (r & 1) * 0.5);
        for (let c = c0 - 1; c <= c0 + 1; c++) {
          if (c < 0 || c >= cols) continue;
          const m = middle[at(r, c)];
          const d = (m.x - px) ** 2 + (m.y - py) ** 2;
          if (d < bestD) {
            bestD = d;
            best = at(r, c);
          }
        }
      }
      if (best < 0) continue;
      const dx = Math.abs(middle[best].x - px);
      const dy = Math.abs(middle[best].y - py);
      if (dx <= size / 2 + 0.01 && dy <= tall / 2 - dx * 0.57735 + 0.01) tileOf[y * w + x] = best;
    }
  // The edges: pixels beside a pixel of another tile.
  const rim: number[] = [];
  const across: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = tileOf[i];
      if (a < 0) continue;
      for (const j of [x + 1 < w ? i + 1 : -1, x > 0 ? i - 1 : -1, y + 1 < h ? i + w : -1, y > 0 ? i - w : -1]) {
        if (j < 0 || tileOf[j] < 0 || tileOf[j] === a) continue;
        rim.push(i);
        across.push(tileOf[j]);
        break;
      }
    }
  return { w, h, tileOf, rim: Int32Array.from(rim), across: Int16Array.from(across), middle, size };
}

/** An event as a line of the story: its glyph, the civ whose colour marks it, its words. */
function line(e: ReplayEvent, cityName: (id: number) => string): { glyph: string; owner: number; text: string } {
  switch (e[1]) {
    case 'found':
      return { glyph: 'city', owner: e[3], text: `${e[5]} founded${e[6] ? `, ${nameOf(e[3])}'s capital` : store.view?.players[e[3]]?.cityState ? ', a city-state' : ` by ${nameOf(e[3])}`}` };
    case 'taken':
      return { glyph: 'war', owner: e[3], text: `${cityName(e[2])} taken by ${nameOf(e[3])} from ${nameOf(e[4])}` };
    case 'lost':
      return { glyph: 'skull', owner: e[3], text: `${cityName(e[2])} is no more` };
    case 'war':
      return { glyph: 'war', owner: e[2], text: `War: ${nameOf(e[2])} and ${nameOf(e[3])}` };
    case 'peace':
      return { glyph: 'peace', owner: e[2], text: `Peace: ${nameOf(e[2])} and ${nameOf(e[3])}` };
    case 'wonder':
      return { glyph: 'golden', owner: e[3], text: `${BUILDINGS[e[2]]?.name ?? e[2]} built by ${nameOf(e[3])}` };
    case 'era':
      return { glyph: 'science', owner: e[2], text: `${nameOf(e[2])} enters the ${ERA_NAMES[ERAS[e[3]]] ?? 'next era'}` };
    case 'out':
      return { glyph: 'skull', owner: e[2], text: `${nameOf(e[2])} has fallen` };
    case 'won':
      return { glyph: 'crown', owner: e[2], text: `${nameOf(e[2])} wins: ${e[3]} victory` };
  }
}

/** A replay on show: its story, its element, the map's width it was laid out for, and its frame (drawn each one). */
interface Shown {
  replay: Replay;
  el: El;
  cols: number;
  draw: (now: number) => void;
}

/** The replay on show (kept across the card's redraws, so it plays on where it was), and whether it's being drawn. */
let shown: Shown | null = null;
let running = false;

/** The replay of the game that's over: its map, its story, its controls. */
export function replayPanel(): El | null {
  const replay = store.view?.replay;
  const g = store.grid;
  if (!replay || !g) return null;
  // (A view sent again brings the same story: what's on show plays on.)
  const same = shown && shown.cols === g.width && shown.replay.events.length === replay.events.length && shown.replay.borders.length === replay.borders.length;
  if (!same) shown = build(replay, g.width, g.height, firstColumn());
  run();
  return shown!.el;
}

/** On a world that wraps, the column the map is drawn from: the one with the least land, so as little as can be is cut at its edges. */
function firstColumn(): number {
  const g = store.grid;
  if (!g?.wrap) return 0;
  let best = 0;
  let least = Infinity;
  for (let c = 0; c < g.width; c++) {
    let land = 0;
    for (let r = 0; r < g.height; r++) if (!TERRAINS[store.terrain[r * g.width + c]?.terrain ?? 'ocean']?.water) land++;
    if (land < least) [best, least] = [c, land];
  }
  return best;
}

function build(replay: Replay, cols: number, rows: number, first: number): Shown {
  const map = layout(cols, rows, first);
  const canvas = h('canvas.rp-canvas', { width: String(map.w), height: String(map.h) }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(map.w, map.h);
  const pixels = new Uint32Array(image.data.buffer);
  const tiles = cols * rows;
  const player = new ReplayPlayer(replay, tiles);
  const end = replayEnd(replay);
  // Every city the game has seen: where it stood and its name (one lost is gone from how things stand).
  const cities = new Map<number, { tile: number; name: string }>();
  for (const e of replay.events) if (e[1] === 'found') cities.set(e[2], { tile: e[4], name: e[5] });
  // Each tile's land, and how it looks in each civ's hands (water tinted less).
  const water = Array.from({ length: tiles }, (_, t) => !!TERRAINS[store.terrain[t]?.terrain ?? 'ocean']?.water);
  const land = Array.from({ length: tiles }, (_, t) => {
    const s = store.terrain[t];
    return s?.elevation === 'mountain' ? MOUNTAIN : (LAND[s?.terrain ?? 'ocean'] ?? LAND.ocean);
  });
  const bare = land.map((c) => rgba(c));
  const held = new Map<number, Uint32Array>();
  const heldBy = (owner: number) => {
    let row = held.get(owner);
    if (!row) {
      row = Uint32Array.from(land, (c, t) => rgba(c, colourOf(owner), water[t] ? 0.35 : 0.55));
      held.set(owner, row);
    }
    return row;
  };
  const edge = (owner: number) => rgba(colourOf(owner), '#ffffff', 0.15);
  const off = rgba(OFF_MAP);

  // The controls and the story.
  const turnLabel = h('div.rp-turn');
  const log = h('div.rp-log');
  const scrub = h('input.rp-scrub', { type: 'range', min: '0', max: String(end), step: '1', value: '0' }) as HTMLInputElement;
  const playButton = h('button.cv-btn.small.icon.rp-play', { title: 'Play or pause' });
  const speedChips = SPEEDS.map(([label], i) => h(`button.cv-chip${i === START_SPEED ? '.on' : ''}`, {}, label));
  let at = 0;
  let speed = SPEEDS[START_SPEED][1];
  let playing = true;
  let drawnTurn = -1;
  let last = 0;
  /** Rings where something happened, and when each began. */
  let rings: { tile: number; colour: string; t: number }[] = [];
  const setPlaying = (on: boolean) => {
    playing = on;
    playButton.innerHTML = svg(on ? 'pause' : 'play', 14);
  };
  setPlaying(true);
  playButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!playing && at >= end) at = 0;
    setPlaying(!playing);
  });
  scrub.addEventListener('input', () => (at = Number(scrub.value)));
  scrub.addEventListener('click', (e) => e.stopPropagation());
  speedChips.forEach((chip, i) =>
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      speed = SPEEDS[i][1];
      speedChips.forEach((c, j) => c.classList.toggle('on', j === i));
    }),
  );

  /** The land as it stood at the turn: each tile in its owner's colour, a line where two civs' land meets. */
  const drawLand = () => {
    const owners = player.state.owners;
    for (let i = 0; i < pixels.length; i++) {
      const t = map.tileOf[i];
      pixels[i] = t < 0 ? off : owners[t] < 0 ? bare[t] : heldBy(owners[t])[t];
    }
    for (let k = 0; k < map.rim.length; k++) {
      const i = map.rim[k];
      const o = owners[map.tileOf[i]];
      if (o >= 0 && owners[map.across[k]] !== o) pixels[i] = edge(o);
    }
  };

  /** The story up to the turn, the latest first. */
  const drawLog = (turn: number) => {
    const cityName = (id: number) => cities.get(id)?.name ?? 'A city';
    const upTo = replay.events.filter((e) => e[0] <= turn);
    const lines = upTo.slice(-LOG_LINES).reverse();
    log.replaceChildren(
      ...lines.map((e) => {
        const l = line(e, cityName);
        return h(`div.rp-ev${e[0] === turn ? '.now' : ''}`, {}, h('b', {}, String(e[0])), h('span', { html: svg(l.glyph, 13, colourOf(l.owner)) }), h('span.t', {}, l.text));
      }),
    );
    if (!lines.length) log.append(h('div.cv-dim', {}, 'The world before its first city.'));
  };

  /** Where something happened on the map: a city's tile (founded, taken, lost, a wonder built in it). */
  const placeOf = (e: ReplayEvent): number | undefined => {
    switch (e[1]) {
      case 'found':
        return e[4];
      case 'taken':
      case 'lost':
        return cities.get(e[2])?.tile;
      case 'wonder':
        return cities.get(e[4])?.tile;
      default:
        return undefined;
    }
  };
  const RING_COLOUR: Partial<Record<ReplayEvent[1], string>> = { found: CITY, taken: '#ff6b5e', lost: '#9aa4b5', wonder: CAPITAL };
  const draw = (now: number) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (playing) {
      at = Math.min(end, at + dt * speed);
      if (at >= end) setPlaying(false);
    }
    const turn = Math.floor(at);
    const changed = turn !== drawnTurn;
    if (changed) {
      const from = drawnTurn;
      player.seek(turn);
      drawLand();
      drawLog(turn);
      scrub.value = String(turn);
      const era = Math.max(0, ...[...player.state.eras.values()]);
      turnLabel.textContent = `Turn ${turn} · ${year(turn)} · ${ERA_NAMES[ERAS[era]] ?? ''}`;
      // (Played forward a turn or a few: rings where things happened.)
      if (turn > from && turn - from <= 3)
        for (const e of replay.events) {
          const tile = e[0] > from && e[0] <= turn ? placeOf(e) : undefined;
          if (tile !== undefined) rings.push({ tile, colour: RING_COLOUR[e[1]] ?? CITY, t: now / 1000 });
        }
      else rings = [];
      drawnTurn = turn;
    }
    // (Drawn again while rings fade, and once more as the last goes.)
    const fading = rings.length > 0;
    rings = rings.filter((r) => now / 1000 - r.t < RING);
    if (!changed && !fading) return;
    ctx.putImageData(image, 0, 0);
    // The cities: a dot each, an original capital bigger and in gold.
    const dot = map.size >= 12 ? 2 : 1;
    for (const c of player.state.cities.values()) {
      const m = map.middle[c.tile];
      const r = c.capital ? dot + 1 : dot;
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(Math.round(m.x) - r - 1, Math.round(m.y) - r - 1, r * 2 + 3, r * 2 + 3);
      ctx.fillStyle = c.capital ? CAPITAL : CITY;
      ctx.fillRect(Math.round(m.x) - r, Math.round(m.y) - r, r * 2 + 1, r * 2 + 1);
    }
    for (const r of rings) {
      const k = (now / 1000 - r.t) / RING;
      const m = map.middle[r.tile];
      const s = Math.round(3 + k * map.size * 1.4);
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = r.colour;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(m.x) - s + 0.5, Math.round(m.y) - s + 0.5, s * 2, s * 2);
      ctx.globalAlpha = 1;
    }
  };

  const el = h(
    'div.rp',
    {},
    h('div.rp-stage', {}, h('div.rp-map.cv-pic', { style: `width:${map.w + 8}px` }, canvas), log),
    h('div.rp-bar', {}, playButton, turnLabel, scrub, h('div.rp-speed', {}, icon('moves', 13), ...speedChips)),
  );
  return { replay, el, cols, draw };
}

/** Played on while it's on the card. */
function run() {
  if (running) return;
  running = true;
  const tick = (now: number) => {
    if (!shown?.el.isConnected) {
      running = false;
      return;
    }
    shown.draw(now);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export const REPLAY_CSS = `
.rp { display: flex; flex-direction: column; gap: 8px; }
/* (The graph's own rule sizes every picture in it as the graph: the glyphs here keep theirs.) */
.cv-over .cv-graph .tabs .cv-i svg { width: 12px !important; height: 12px !important; }
.cv-over .cv-graph .rp-ev svg { width: 13px !important; height: 13px !important; }
.cv-over .cv-graph .rp-bar svg { width: 14px !important; height: 14px !important; }
.rp-stage { display: flex; gap: 10px; align-items: stretch; }
.cv-root .rp-map { flex: none; display: block; padding: 0; max-width: 100%; }
.rp-canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
.rp-log { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; overflow: hidden; }
.rp-ev { display: flex; gap: 6px; align-items: center; font: 400 13px/1.25 'Chakra Petch', system-ui, sans-serif; color: var(--muted); padding: 2px 4px; }
.rp-ev b { font: 400 16px/1 'Jersey 10', monospace; color: var(--dim); min-width: 26px; text-align: right; }
.rp-ev .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-ev.now { color: var(--text); background: rgba(242,193,78,.1); }
.rp-ev.now b { color: var(--gold); }
.rp-bar { display: flex; gap: 8px; align-items: center; }
.rp-turn { font: 400 18px/1 'Jersey 10', monospace; color: #fff; text-shadow: 2px 2px 0 #0b0d12; white-space: nowrap; min-width: 210px; }
.rp input.rp-scrub { flex: 1; min-width: 60px; height: 14px; appearance: none; -webkit-appearance: none; background: #0f1218; box-shadow: inset 0 0 0 2px #07090c, inset 2px 2px 0 #0b0d12, inset -2px -2px 0 #465066; cursor: pointer; }
.rp input.rp-scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 18px; background: linear-gradient(180deg, #ffe48a 0 50%, #e8bc48 50%); box-shadow: inset 0 0 0 2px #07090c; }
.rp input.rp-scrub::-moz-range-thumb { width: 12px; height: 18px; border: 0; border-radius: 0; background: linear-gradient(180deg, #ffe48a 0 50%, #e8bc48 50%); box-shadow: inset 0 0 0 2px #07090c; }
.rp-speed { display: flex; gap: 4px; align-items: center; color: var(--muted); }
.rp-speed .cv-chip { font-size: 16px !important; padding: 1px 6px 2px !important; }
@media (max-width: 760px), (max-height: 520px) {
  .rp-stage { flex-direction: column; }
  .rp-log { max-height: 120px; }
  .rp-turn { min-width: 0; font-size: 15px; }
}
`;
