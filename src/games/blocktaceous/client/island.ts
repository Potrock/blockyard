import type { Client, ClientKit, ClientLoop } from '@platform/client';
import { LANDMARKS, MAP, POINTS, REGIONS, ZONE_BIOME, ZONE_COLOR, biomeAt, groundAt, islandMap, landmarkAt, nearestShore, regionAt, waterAt, type Landmark } from '../island';

/**
 * The island on each player's screen: the name of a region across the top as a survivor walks
 * into it, and the map (M): the whole island drawn from the same grids the land is made from,
 * with its regions' names, the landmarks found so far (the rest as question marks) and where the
 * survivor stands. And the island's air: each country's own sounds (surf, wind, insects, birds,
 * frogs, the volcano's rumble: all synthesised here), a tint of its light, and its weather at the
 * edges of the day: rain over the jungle and the marsh, snow on the heights, ash round the volcano.
 * All of this is each screen's own (nothing here changes the game's rules).
 */
export const kits: ClientKit[] = [];

const CSS = `
.bt-region { position: absolute; left: 50%; top: 16%; transform: translateX(-50%); text-align: center; pointer-events: none; opacity: 0; color: #fff8e6; text-shadow: 0 2px 0 rgba(20, 14, 8, 0.75), 0 0 18px rgba(20, 14, 8, 0.55); }
.bt-region.show { animation: bt-region 4.6s ease both; }
.bt-region b { display: block; font-size: 34px; letter-spacing: 0.08em; font-weight: 800; }
.bt-region i { display: block; margin-top: 4px; font-size: 13px; font-style: normal; letter-spacing: 0.32em; text-transform: uppercase; opacity: 0.85; }
.bt-region b::before, .bt-region b::after { content: ''; display: inline-block; width: 46px; height: 2px; margin: 0 14px; vertical-align: middle; background: currentColor; opacity: 0.6; }
@keyframes bt-region { 0% { opacity: 0; transform: translate(-50%, 8px); } 12%, 78% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -6px); } }
.bt-map { position: absolute; inset: 0; z-index: 60; display: none; align-items: center; justify-content: center; background: rgba(8, 14, 22, 0.62); }
.bt-map.open { display: flex; }
.bt-map-sheet { position: relative; width: min(84vh, 92vw); height: min(84vh, 92vw); border: 6px solid #3a2a18; border-radius: 6px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 0 0 2px #c9a86a; background: #1b4f8c; overflow: hidden; }
.bt-map-sheet canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: auto; }
.bt-map-name { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; color: #fff8e6; text-shadow: 0 1px 0 #1a120a, 0 0 6px rgba(10, 8, 4, 0.9); pointer-events: none; }
.bt-map-name.small { font-size: 10px; font-weight: 600; opacity: 0.92; font-style: italic; }
.bt-map-name.sea { color: #cfe6ff; }
.bt-map-me { position: absolute; width: 0; height: 0; pointer-events: none; }
.bt-map-me::before { content: ''; position: absolute; left: -7px; top: -11px; border: 7px solid transparent; border-bottom: 16px solid #ffe14a; border-top: 0; filter: drop-shadow(0 0 2px #000) drop-shadow(0 0 5px rgba(0, 0, 0, 0.8)); }
.bt-map-me::after { content: ''; position: absolute; left: -16px; top: -16px; width: 28px; height: 28px; border: 2px solid rgba(255, 225, 74, 0.7); border-radius: 50%; animation: bt-ping 1.8s ease-out infinite; }
@keyframes bt-ping { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
.bt-map-title { position: absolute; left: 14px; top: 10px; font-size: 20px; font-weight: 800; letter-spacing: 0.1em; color: #fff8e6; text-shadow: 0 2px 0 #1a120a; }
.bt-map-foot { position: absolute; left: 14px; right: 14px; bottom: 10px; display: flex; justify-content: space-between; font-size: 12px; color: #fff8e6; text-shadow: 0 1px 0 #1a120a, 0 0 5px #000; }
.bt-map-compass { position: absolute; right: 16px; top: 12px; font-size: 13px; font-weight: 800; color: #fff8e6; text-align: center; text-shadow: 0 1px 0 #1a120a; }
@keyframes bt-found { 0% { opacity: 0; transform: translate(-50%, 8px) scale(0.96); } 10%, 82% { opacity: 1; transform: translate(-50%, 0) scale(1); } 100% { opacity: 0; transform: translate(-50%, -6px); } }
.bt-region.found.show { animation: bt-found 6s ease both; }
.bt-region.found i { color: #ffe14a; opacity: 1; }
.bt-map-mark { position: absolute; transform: translate(-50%, -50%); white-space: nowrap; font-size: 10px; font-weight: 700; color: #ffe9a8; text-shadow: 0 1px 0 #1a120a, 0 0 5px rgba(10, 8, 4, 0.95); pointer-events: none; }
.bt-map-mark.unknown { color: #fff8e6; opacity: 0.55; font-size: 11px; }
.bt-map-dot { position: absolute; width: 7px; height: 7px; background: #ffd24a; border: 1px solid #3a2a18; transform: translate(-50%, -50%) rotate(45deg); pointer-events: none; }
.bt-map-found { position: absolute; left: 14px; top: 40px; font-size: 11px; letter-spacing: 0.06em; color: #ffe9a8; text-shadow: 0 1px 0 #1a120a; }
.bt-air { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 3s ease, background 3s ease; }
.bt-map-compass::after { content: ''; display: block; margin: 2px auto 0; border: 5px solid transparent; border-top: 0; border-bottom: 12px solid #fff8e6; transform: rotate(0deg); }
`;

const BIOME_WORDS: Record<string, string> = {
  beach: 'Beach',
  grassland: 'Grassland',
  jungle: 'Jungle',
  redwood: 'Redwood forest',
  swamp: 'Marsh',
  badlands: 'Badlands',
  mountain: 'Mountains',
  snow: 'Snow',
  volcano: 'Volcano',
  river: 'Fresh water',
  ocean: 'Open sea',
};

let banner: HTMLElement | null = null;
let sheet: HTMLElement | null = null;
let marker: HTMLElement | null = null;
let foot: HTMLElement | null = null;
let screen: HTMLElement | null = null;
let region: string | null = null;
let regionClock = 0;
let mapOpen = false;
let mapKey = false;
let foundLine: HTMLElement | null = null;
/** Where the map's fixed names sit, in percent of the sheet: later names keep clear of them. */
const labelBoxes: { x: number; y: number; w: number; h: number }[] = [];

// ---- Landmarks found ----

/** The landmarks this player has walked up to, kept on this device. */
const FOUND_KEY = 'blocktaceous.landmarks.v1';
let found = new Set<string>();
function loadFound(): void {
  found = new Set();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FOUND_KEY) ?? '[]');
    if (Array.isArray(raw)) for (const id of raw) if (typeof id === 'string' && LANDMARKS.some((l) => l.id === id)) found.add(id);
  } catch {
    // A private window: found for this visit only.
  }
}
function saveFound(): void {
  try {
    localStorage.setItem(FOUND_KEY, JSON.stringify([...found]));
  } catch {
    // (As above.)
  }
}

/** The landmarks on the map: found ones by name, the rest as question marks to go and see. */
function markLandmarks(): void {
  if (!sheet) return;
  for (const old of sheet.querySelectorAll('.bt-map-mark, .bt-map-dot')) old.remove();
  const span = MAP.size * MAP.cell;
  // Found names keep clear of the regions' names and of each other (the dot marks the spot itself).
  const boxes = [...labelBoxes];
  for (const l of LANDMARKS) {
    const known = found.has(l.id);
    const [px, py] = [((l.x - MAP.minX) / span) * 100, ((l.z - MAP.minZ) / span) * 100];
    const el = document.createElement('div');
    el.className = `bt-map-mark${known ? '' : ' unknown'}`;
    el.textContent = known ? l.name : '?';
    let [cx, cy] = [px, py];
    if (known) {
      const dot = document.createElement('div');
      dot.className = 'bt-map-dot';
      dot.style.left = `${px.toFixed(2)}%`;
      dot.style.top = `${py.toFixed(2)}%`;
      sheet.append(dot);
      const [w, h] = [l.name.length * 1.3 + 1, 3];
      // To the right of its dot, or to the left; level with it, or a line or two up or down.
      let free = false;
      for (const step of [0, 1, -1, 2, -2, 3, -3]) {
        for (const side of [1, -1]) {
          cx = Math.max(w / 2 + 1, Math.min(99 - w / 2, px + side * (w / 2 + 1.4)));
          cy = py + step * h;
          free = !boxes.some((o) => Math.abs(o.x - cx) < (o.w + w) / 2 && Math.abs(o.y - cy) < (o.h + h) / 2);
          if (free) break;
        }
        if (free) break;
      }
      boxes.push({ x: cx, y: cy, w, h });
    }
    el.style.left = `${cx.toFixed(2)}%`;
    el.style.top = `${cy.toFixed(2)}%`;
    sheet.append(el);
  }
  if (foundLine) foundLine.textContent = `Landmarks found: ${found.size} of ${LANDMARKS.length}`;
}

/** The banner across the top: a region's name on walking into it, a landmark's on finding it. */
function announce(title: string, under: string, discovery = false): void {
  if (!banner) return;
  banner.innerHTML = '';
  const name = document.createElement('b');
  name.textContent = title;
  const kind = document.createElement('i');
  kind.textContent = under;
  banner.append(name, kind);
  // Restart the animation for a new name.
  banner.classList.remove('show');
  banner.classList.toggle('found', discovery);
  void banner.offsetWidth;
  banner.classList.add('show');
  bannerBusy = discovery ? 6 : 0;
}
let bannerBusy = 0;

// ---- The island's air ----

type Bed = 'surf' | 'wind' | 'insects' | 'rumble' | 'rain' | 'rush';
const beds: Partial<Record<Bed, ClientLoop>> = {};
const level: Record<Bed, number> = { surf: 0, wind: 0, insects: 0, rumble: 0, rain: 0, rush: 0 };
let air: HTMLElement | null = null;
let airClock = 0;
let callClock = 3;
let gust = 0.3;
let gustAim = 0.3;
let gustTurn = 0;
/** What the air is doing where the player stands, looked up a few times a second. */
const here = { biome: 'ocean', shore: 999, crater: 9999, high: 0, rain: 0, snow: 0, ash: 0, rush: 0, steam: null as Landmark | null, falls: null as Landmark | null };
let drops = 0;
let flakes = 0;
let cinders = 0;
let wisps = 0;

/** Each country's tint of the light: a colour and how strong (the top of the view takes more of it). */
const TINT: Record<string, [string, number]> = {
  jungle: ['70, 150, 80', 0.1],
  swamp: ['96, 112, 62', 0.15],
  redwood: ['52, 92, 70', 0.09],
  badlands: ['232, 150, 78', 0.08],
  snow: ['196, 222, 255', 0.09],
  mountain: ['186, 204, 226', 0.05],
  volcano: ['70, 44, 40', 0.1],
};

function defineSounds(client: Client): void {
  const a = client.audio;
  a.defineLoop('bt_surf', (l) => {
    l.noise({ freq: 420, filter: 'lowpass', q: 0.6, volume: 0.5 });
    l.noise({ freq: 1500, filter: 'bandpass', q: 0.7, volume: 0.22 });
  });
  a.defineLoop('bt_wind', (l) => {
    l.noise({ freq: 300, filter: 'lowpass', q: 0.7, volume: 0.4 });
    l.noise({ freq: 950, filter: 'bandpass', q: 1.1, volume: 0.3 });
    l.noise({ freq: 620, filter: 'bandpass', q: 8, volume: 0.08 });
  });
  a.defineLoop('bt_insects', (l) => {
    l.noise({ freq: 5600, filter: 'bandpass', q: 14, volume: 0.3 });
    l.noise({ freq: 7400, filter: 'bandpass', q: 18, volume: 0.2 });
    l.tone({ wave: 'sine', freq: 4300, volume: 0.035, vibrato: { rate: 23, depth: 90 } });
  });
  a.defineLoop('bt_rumble', (l) => {
    l.tone({ wave: 'sine', freq: 41, volume: 0.5, vibrato: { rate: 0.7, depth: 5 } });
    l.noise({ freq: 110, filter: 'lowpass', q: 0.8, volume: 0.6 });
  });
  a.defineLoop('bt_rain', (l) => {
    l.noise({ freq: 2600, filter: 'bandpass', q: 0.5, volume: 0.36 });
    l.noise({ freq: 7000, filter: 'highpass', q: 0.6, volume: 0.1 });
    l.noise({ freq: 500, filter: 'lowpass', q: 0.6, volume: 0.22 });
  });
  a.defineLoop('bt_rush', (l) => {
    l.noise({ freq: 800, filter: 'bandpass', q: 0.6, volume: 0.5 });
    l.noise({ freq: 240, filter: 'lowpass', q: 0.7, volume: 0.4 });
  });
  // Calls: a songbird's two notes, a parrot's squawk, a frog, a gull, an owl, a raven; and the chime of a find.
  a.define('bt_bird', (s) => {
    s.tone({ wave: 'sine', from: 2900 * s.pitch, to: 3700 * s.pitch, duration: 0.09, volume: 0.1 });
    s.tone({ wave: 'sine', from: 3500 * s.pitch, to: 2700 * s.pitch, duration: 0.12, delay: 0.13, volume: 0.1 });
    s.tone({ wave: 'sine', from: 3100 * s.pitch, to: 3900 * s.pitch, duration: 0.08, delay: 0.3, volume: 0.08 });
  });
  a.define('bt_parrot', (s) => {
    s.tone({ wave: 'sawtooth', from: 1500 * s.pitch, to: 950 * s.pitch, duration: 0.2, volume: 0.07, bandpass: { freq: 2200, q: 2 }, vibrato: { rate: 38, depth: 160 } });
    s.tone({ wave: 'sawtooth', from: 1700 * s.pitch, to: 1100 * s.pitch, duration: 0.16, delay: 0.26, volume: 0.06, bandpass: { freq: 2200, q: 2 }, vibrato: { rate: 38, depth: 160 } });
  });
  a.define('bt_frog', (s) => {
    for (let k = 0; k < 3; k++) s.tone({ wave: 'square', from: 190 * s.pitch, to: 150 * s.pitch, duration: 0.07, delay: k * 0.11, volume: 0.07, lowpass: 900, vibrato: { rate: 60, depth: 30 } });
  });
  a.define('bt_gull', (s) => {
    for (let k = 0; k < 3; k++) s.tone({ wave: 'triangle', from: 1900 * s.pitch, to: 1300 * s.pitch, duration: 0.2, delay: k * 0.27, volume: 0.07, vibrato: { rate: 9, depth: 70 } });
  });
  a.define('bt_owl', (s) => {
    s.tone({ wave: 'sine', from: 420 * s.pitch, to: 380 * s.pitch, duration: 0.22, volume: 0.1 });
    s.tone({ wave: 'sine', from: 400 * s.pitch, to: 350 * s.pitch, duration: 0.4, delay: 0.34, volume: 0.1 });
  });
  a.define('bt_raven', (s) => {
    for (let k = 0; k < 2; k++) s.tone({ wave: 'sawtooth', from: 700 * s.pitch, to: 520 * s.pitch, duration: 0.18, delay: k * 0.3, volume: 0.06, bandpass: { freq: 1100, q: 3 }, vibrato: { rate: 45, depth: 90 } });
  });
  a.define('bt_found', (s) => {
    [523, 659, 784, 1047].forEach((f, k) => s.tone({ wave: 'triangle', from: f, to: f, duration: 0.5, delay: k * 0.12, volume: 0.12 }));
  }, { reverb: 0 });
}

/** A bed's loop, started when it's first heard and stopped once it has faded right out. */
function bed(client: Client, name: Bed, aim: number, dt: number, pitch = 1): void {
  level[name] += (aim - level[name]) * Math.min(1, dt * 0.7);
  const v = level[name];
  if (v < 0.002) {
    beds[name]?.stop();
    delete beds[name];
    return;
  }
  beds[name] ??= client.audio.loop(`bt_${name}`, { volume: 0 });
  beds[name]?.set({ volume: v, pitch });
}

/** Whether it's raining over the wet lowlands now: showers that come and go every few minutes. */
function showers(t: number): number {
  const s = Math.sin(t / 97) + 0.6 * Math.sin(t / 41 + 1.3) + 0.3 * Math.sin(t / 17 + 4);
  return Math.max(0, Math.min(1, (s - 0.35) * 2.2));
}

function lookAtAir(client: Client): void {
  const p = client.camera.position;
  const biome = biomeAt(p.x, p.z);
  here.biome = biome;
  const shore = nearestShore(p.x, p.z, 160);
  here.shore = shore ? Math.hypot(shore.x - p.x, shore.z - p.z) : 999;
  const cone = POINTS[0];
  here.crater = Math.hypot(p.x - cone.x, p.z - cone.z);
  here.high = Math.max(0, Math.min(1, (p.y - 120) / 70));
  const wet = biome === 'jungle' || biome === 'swamp' ? 1 : 0;
  here.rain = wet * showers(client.time);
  here.snow = biome === 'snow' ? 0.5 + 0.5 * here.high : p.y > 168 ? here.high : 0;
  here.ash = Math.max(0, Math.min(1, (620 - here.crater) / 380));
  // Running water near: a river, more at a waterfall.
  let rush = 0;
  for (const [dx, dz] of [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14]]) if (waterAt(p.x + dx, p.z + dz) !== null && Math.abs(groundAt(p.x + dx, p.z + dz) - p.y) < 14) rush = Math.max(rush, dx || dz ? 0.3 : 0.5);
  here.falls = null;
  here.steam = null;
  for (const l of LANDMARKS) {
    const d = Math.hypot(l.x - p.x, l.z - p.z);
    if (l.kind === 'falls' && d < 90) {
      here.falls = l;
      rush = Math.max(rush, 1 - d / 90);
    }
    if (l.kind === 'springs' && d < 70) here.steam = l;
  }
  here.rush = rush;
  // The light's tint.
  if (air) {
    const [rgb, strength] = TINT[here.ash > 0.15 ? 'volcano' : biome] ?? ['0, 0, 0', 0];
    const k = strength * (here.ash > 0.15 ? 0.4 + 0.6 * here.ash : 1) + 0.1 * here.rain;
    air.style.background = `linear-gradient(to bottom, rgba(${here.rain > 0.3 ? '96, 110, 122' : rgb}, ${Math.min(0.5, k * 2.2).toFixed(3)}) 0%, rgba(${rgb}, ${k.toFixed(3)}) 55%, rgba(${rgb}, ${(k * 0.6).toFixed(3)}) 100%)`;
    air.style.opacity = k > 0.001 ? '1' : '0';
  }
}

function atmosphere(client: Client, dt: number): void {
  const t = client.time;
  airClock -= dt;
  if (airClock <= 0) {
    airClock = 0.4;
    lookAtAir(client);
  }
  const p = client.camera.position;
  const rand = (a: number, b: number) => a + Math.random() * (b - a);
  // (The platform doesn't tell a screen the hour, so the island's voices are its daytime ones, a night call among them now and then.)

  // The beds. Surf swells and falls back; the wind gusts.
  if (t >= gustTurn) {
    gustTurn = t + rand(2, 6);
    gustAim = Math.random() < 0.25 ? rand(0.7, 1) : rand(0.1, 0.5);
  }
  gust += (gustAim - gust) * Math.min(1, dt * 0.6);
  const b = here.biome;
  const open = b === 'snow' || b === 'mountain' ? 0.1 : b === 'badlands' ? 0.07 : b === 'grassland' || b === 'beach' || b === 'ocean' ? 0.035 : b === 'volcano' ? 0.05 : 0.012;
  bed(client, 'surf', Math.max(0, 1 - here.shore / 150) ** 1.5 * (0.075 + 0.05 * Math.sin(t * 0.55)), dt, 0.9 + 0.1 * Math.sin(t * 0.55 + 1));
  bed(client, 'wind', (open + 0.1 * here.high) * (0.5 + gust), dt, 0.8 + gust * 0.45);
  bed(client, 'insects', (b === 'jungle' ? 0.05 : b === 'swamp' ? 0.04 : b === 'redwood' || b === 'grassland' ? 0.012 : 0) * (1 - 0.6 * here.rain), dt);
  bed(client, 'rumble', Math.max(0, 1 - here.crater / 700) ** 2 * 0.22, dt, 0.9 + 0.2 * gust);
  bed(client, 'rain', here.rain * 0.13, dt);
  bed(client, 'rush', here.rush * 0.11, dt, here.falls ? 0.85 : 1.1);

  // Calls, from somewhere round about: each country's own, some only by day or by night.
  callClock -= dt;
  if (callClock <= 0) {
    callClock = rand(2.5, 9);
    const voices: Record<string, string[]> = Math.random() < 0.85
      ? { jungle: ['bt_parrot', 'bt_bird', 'bt_bird'], grassland: ['bt_bird'], redwood: ['bt_bird', 'bt_raven'], swamp: ['bt_frog', 'bt_frog', 'bt_bird'], beach: ['bt_gull'], badlands: ['bt_raven'], mountain: ['bt_raven'] }
      : { jungle: ['bt_frog', 'bt_owl'], grassland: ['bt_owl'], redwood: ['bt_owl'], swamp: ['bt_frog'], beach: [], badlands: [], mountain: ['bt_owl'] };
    const list = here.rain > 0.5 ? [] : (voices[b] ?? []);
    if (list.length) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(12, 34);
      client.audio.play(list[Math.floor(Math.random() * list.length)], { at: { x: p.x + Math.cos(a) * d, y: p.y + rand(2, 12), z: p.z + Math.sin(a) * d }, pitch: rand(0.85, 1.2), volume: rand(0.5, 1) });
    }
  }

  // Weather, a few motes at a time round the view. Rain falls hard; snow and ash drift on the gusts.
  const around = (r: number, up: number) => ({ x: p.x + rand(-r, r), y: p.y + up, z: p.z + rand(-r, r) });
  drops += dt * here.rain * 190;
  for (; drops >= 1; drops -= 1) client.fx.particles(around(11, rand(5, 9)), [0.72, 0.8, 0.9], { count: 1, speed: 0.1, size: rand(0.025, 0.04), gravity: 0, life: 0.75, spread: 0, up: 0, velocity: { x: 1.2 * gust, y: -19, z: 0.6 }, collide: true });
  flakes += dt * here.snow * 70;
  for (; flakes >= 1; flakes -= 1) client.fx.particles(around(12, rand(2, 8)), [0.96, 0.98, 1], { count: 1, speed: 0.25, size: rand(0.04, 0.07), gravity: 0.3, life: rand(3, 5), spread: 0, up: 0, velocity: { x: 1 + 3.5 * gust, y: -1.1, z: 0.8 * gust }, collide: true });
  cinders += dt * here.ash * 46;
  for (; cinders >= 1; cinders -= 1) {
    const ember = Math.random() < 0.18 * here.ash;
    client.fx.particles(around(12, rand(-1, 7)), ember ? [1, 0.45, 0.1] : [0.32, 0.3, 0.3], { count: 1, speed: 0.2, size: rand(0.04, 0.08), gravity: ember ? -0.5 : 0.15, glow: ember ? 1.4 : 0, life: rand(3, 6), spread: 0, up: 0, velocity: { x: 0.6 + 1.5 * gust, y: ember ? 0.9 : -0.5, z: -0.4 } });
  }
  // Steam off the hot springs, and spray where a river goes over its drop.
  wisps += dt * 26;
  for (; wisps >= 1; wisps -= 1) {
    if (here.steam) {
      const l = here.steam;
      client.fx.particles({ x: l.x + rand(-10, 10), y: l.y + 1.1, z: l.z + rand(-10, 8) }, [0.93, 0.95, 0.96], { count: 1, speed: 0.15, size: rand(0.12, 0.26), gravity: -0.5, life: rand(2.5, 4.5), spread: 0.2, up: 0.3, velocity: { x: 0.3 * gust, y: 0.5, z: 0 } });
    }
    if (here.falls) {
      const l = here.falls;
      client.fx.particles({ x: l.x + rand(-9, 9), y: l.y - rand(2, 12), z: l.z + rand(-9, 9) }, [0.88, 0.94, 1], { count: 2, speed: 0.6, size: rand(0.08, 0.16), gravity: 0.4, life: rand(1.2, 2.4), spread: 0.8, up: 0.5 });
    }
  }
}

function quietAir(): void {
  for (const name of Object.keys(beds) as Bed[]) {
    beds[name]?.stop();
    delete beds[name];
    level[name] = 0;
  }
}

/** The island as a picture: each sample its zone's colour, lit from the north-west, the sea darker with depth. */
function drawIsland(canvas: HTMLCanvasElement): void {
  const { heights, zones } = islandMap();
  const n = MAP.size;
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.createImageData(n, n);
  const px = image.data;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h = heights[k] / 256;
      const zone = zones[k];
      let [r, g, b] = ZONE_COLOR[zone];
      let shade = 1;
      if (ZONE_BIOME[zone] === 'ocean') {
        // Shallows pale, the deep dark.
        const d = Math.min(1, (MAP.seaLevel - h) / 30);
        r = 74 - 52 * d;
        g = 142 - 84 * d;
        b = 200 - 82 * d;
      } else {
        const west = heights[j * n + Math.max(0, i - 1)] / 256;
        const north = heights[Math.max(0, j - 1) * n + i] / 256;
        shade = Math.max(0.62, Math.min(1.32, 1 + (h - west + h - north) * 0.06)) * (0.88 + 0.26 * Math.min(1, Math.max(0, (h - MAP.seaLevel) / 170)));
      }
      px[k * 4] = Math.min(255, r * shade);
      px[k * 4 + 1] = Math.min(255, g * shade);
      px[k * 4 + 2] = Math.min(255, b * shade);
      px[k * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** A world position as a place on the sheet, in percent. */
const onSheet = (v: number, min: number) => `${(((v - min) / (MAP.size * MAP.cell)) * 100).toFixed(2)}%`;

function buildMap(client: Client): void {
  screen = client.hud.layer('bt-island-map');
  screen.classList.add('bt-map');
  sheet = document.createElement('div');
  sheet.className = 'bt-map-sheet';
  const canvas = document.createElement('canvas');
  drawIsland(canvas);
  sheet.append(canvas);
  // Names are laid out so none sits on another: the big regions first, each later name shifted up or down
  // until it is clear, and all of them kept on the sheet.
  const span = MAP.size * MAP.cell;
  const placed = labelBoxes;
  placed.length = 0;
  const seen = new Set<string>();
  const label = (text: string, x: number, z: number, cls = '') => {
    if (seen.has(text)) return;
    seen.add(text);
    const small = cls.includes('small');
    // Sizes in percent of a sheet about 450 px across (the smallest it is likely to be shown).
    const w = text.length * (small ? 1.3 : 1.75) + 1;
    const h = small ? 3 : 3.6;
    const cx = Math.max(w / 2 + 1, Math.min(99 - w / 2, ((x - MAP.minX) / span) * 100));
    const y0 = Math.max(9, Math.min(92, ((z - MAP.minZ) / span) * 100));
    let cy = y0;
    for (const step of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      cy = y0 + step * h;
      if (!placed.some((o) => Math.abs(o.x - cx) < (o.w + w) / 2 && Math.abs(o.y - cy) < (o.h + h) / 2)) break;
    }
    placed.push({ x: cx, y: cy, w, h });
    const el = document.createElement('div');
    el.className = `bt-map-name ${cls}`;
    el.textContent = text;
    el.style.left = `${cx.toFixed(2)}%`;
    el.style.top = `${cy.toFixed(2)}%`;
    sheet!.append(el);
  };
  // The big regions by name; shores, lakes, rivers and islets smaller.
  const minor = (r: (typeof REGIONS)[number]) => r.biome === 'beach' || POINTS.some((p) => p.name === r.name);
  for (const r of REGIONS) if (r.biome !== 'river' && !minor(r)) label(r.name, r.x, r.z);
  for (const r of REGIONS) if (r.biome !== 'river' && minor(r)) label(r.name, r.x, r.z, 'small');
  for (const p of POINTS) if (p.kind === 'lake' || p.kind === 'river' || p.kind === 'lava') label(p.name, p.x, p.z + (p.kind === 'lake' ? 0 : 60), 'small sea');
  const title = document.createElement('div');
  title.className = 'bt-map-title';
  title.textContent = 'THE ISLAND';
  const compass = document.createElement('div');
  compass.className = 'bt-map-compass';
  compass.textContent = 'N';
  marker = document.createElement('div');
  marker.className = 'bt-map-me';
  foot = document.createElement('div');
  foot.className = 'bt-map-foot';
  foundLine = document.createElement('div');
  foundLine.className = 'bt-map-found';
  sheet.append(title, foundLine, compass, marker, foot);
  screen.append(sheet);
}

export function setup(client: Client): void {
  client.hud.style(CSS);
  banner = document.createElement('div');
  banner.className = 'bt-region';
  client.hud.layer('bt-island-region').append(banner);
  air = document.createElement('div');
  air.className = 'bt-air';
  client.hud.layer('bt-island-air', 'lens').append(air);
  defineSounds(client);
  quietAir();
  loadFound();
  // (Left over from a game before this one on the same page.)
  screen = sheet = marker = foot = null;
  region = null;
  regionClock = 0;
  mapOpen = false;
  foundLine = null;
  bannerBusy = 0;
}

export function frame(client: Client, dt: number): void {
  const at = client.me.position;

  // The region's name as a survivor crosses into it (looked up twice a second: the map is cheap
  // to ask, but nobody crosses a border faster than that).
  regionClock -= dt;
  if (regionClock <= 0 && banner) {
    regionClock = 0.5;
    const now = regionAt(at.x, at.z);
    // (A discovery's banner is left its time before a border's name takes it over.)
    if (now !== region && bannerBusy <= 0) {
      region = now;
      if (now) announce(now, BIOME_WORDS[biomeAt(at.x, at.z)] ?? '');
    }
    // A landmark, walked up to for the first time.
    const l = landmarkAt(at.x, at.z);
    if (l && !found.has(l.id) && Math.abs(at.y - l.y) < 40) {
      found.add(l.id);
      saveFound();
      announce(l.name, `Landmark found  ·  ${found.size} of ${LANDMARKS.length}`, true);
      client.audio.play('bt_found', { volume: 0.8 });
      if (mapOpen) markLandmarks();
    }
  }
  bannerBusy -= dt;
  if (client.running) atmosphere(client, dt);
  else quietAir();

  // The map: M opens and closes it.
  const key = client.input.isDown('KeyM');
  if (key && !mapKey) {
    mapOpen = !mapOpen;
    if (mapOpen && !screen) buildMap(client);
    if (mapOpen) markLandmarks();
    screen?.classList.toggle('open', mapOpen);
  }
  mapKey = key;
  if (mapOpen && marker && foot) {
    marker.style.left = onSheet(at.x, MAP.minX);
    marker.style.top = onSheet(at.z, MAP.minZ);
    // Yaw 0 looks north (up the sheet) and grows turning left.
    marker.style.transform = `rotate(${-client.me.look.yaw}rad)`;
    const where = regionAt(at.x, at.z) ?? 'Open sea';
    const ns = at.z < 0 ? 'N' : 'S';
    const ew = at.x < 0 ? 'W' : 'E';
    foot.textContent = '';
    const left = document.createElement('span');
    left.textContent = `${where}  ·  ${Math.abs(Math.round(at.z))} ${ns}, ${Math.abs(Math.round(at.x))} ${ew}`;
    const right = document.createElement('span');
    right.textContent = 'M  close';
    foot.append(left, right);
  }
}
