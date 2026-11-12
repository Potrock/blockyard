import type { Client, ClientKit } from '@platform/client';
import { MAP, POINTS, REGIONS, ZONE_BIOME, ZONE_COLOR, biomeAt, islandMap, regionAt } from '../island';

/**
 * The island on each player's screen: the name of a region across the top as a survivor walks
 * into it, and the map (M): the whole island drawn from the same grids the land is made from,
 * with its regions' names, its landmarks and where the survivor stands.
 */
export const kits: ClientKit[] = [];

const CSS = `
.bt-region { position: absolute; left: 50%; top: 16%; transform: translateX(-50%); text-align: center; pointer-events: none; opacity: 0; color: #fff8e6; text-shadow: 0 2px 0 rgba(20, 14, 8, 0.75), 0 0 18px rgba(20, 14, 8, 0.55); }
.bt-region.show { animation: bt-region 4.6s ease both; }
.bt-region b { display: block; font-size: 34px; letter-spacing: 0.08em; font-weight: 800; }
.bt-region i { display: block; margin-top: 4px; font-size: 13px; font-style: normal; letter-spacing: 0.32em; text-transform: uppercase; opacity: 0.85; }
.bt-region b::before, .bt-region b::after { content: ''; display: inline-block; width: 46px; height: 2px; margin: 0 14px; vertical-align: middle; background: currentColor; opacity: 0.6; }
@keyframes bt-region { 0% { opacity: 0; transform: translate(-50%, 8px); } 12%, 78% { opacity: 1; transform: translate(-50%, 0); } 100% { opacity: 0; transform: translate(-50%, -6px); } }
.bt-map { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(8, 14, 22, 0.62); }
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
  const placed: { x: number; y: number; w: number; h: number }[] = [];
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
  sheet.append(title, compass, marker, foot);
  screen.append(sheet);
}

export function setup(client: Client): void {
  client.hud.style(CSS);
  banner = document.createElement('div');
  banner.className = 'bt-region';
  client.hud.layer('bt-island-region').append(banner);
  // (Left over from a game before this one on the same page.)
  screen = sheet = marker = foot = null;
  region = null;
  regionClock = 0;
  mapOpen = false;
}

export function frame(client: Client, dt: number): void {
  const at = client.me.position;

  // The region's name as a survivor crosses into it (looked up twice a second: the map is cheap
  // to ask, but nobody crosses a border faster than that).
  regionClock -= dt;
  if (regionClock <= 0 && banner) {
    regionClock = 0.5;
    const now = regionAt(at.x, at.z);
    if (now !== region) {
      region = now;
      if (now) {
        banner.innerHTML = '';
        const name = document.createElement('b');
        name.textContent = now;
        const kind = document.createElement('i');
        kind.textContent = BIOME_WORDS[biomeAt(at.x, at.z)] ?? '';
        banner.append(name, kind);
        // Restart the animation for a new name.
        banner.classList.remove('show');
        void banner.offsetWidth;
        banner.classList.add('show');
      }
    }
  }

  // The map: M opens and closes it.
  const key = client.input.isDown('KeyM');
  if (key && !mapKey) {
    mapOpen = !mapOpen;
    if (mapOpen && !screen) buildMap(client);
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
