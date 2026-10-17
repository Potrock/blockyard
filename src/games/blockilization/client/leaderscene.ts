import type { PlayerSummary } from '../protocol';
import { CIVS } from '../rules/civs';
import { emblemEl } from './icons';
import { combatSpeed, marchSpeed } from './pace';
import { PICTURES, type PictureId } from './picturefiles';
import { store } from './store';
import { h, type El } from './ui';

/**
 * Diplomacy's leader as a small scene (Civ V's throne rooms, in pixels): their bust in the middle
 * and behind them a room of their era, a little alive (torches flicker, clouds drift, chimneys
 * smoke, a city's lights come on), their banner hung either side, in their colours with their
 * emblem, a ripple running down it; drawn on a small canvas whose pixels are two of the screen's.
 *
 * The leader lives: they breathe and now and then blink; their face and stance are how they feel
 * about you (warm and lively, neutral, guarded with a brow up, hostile and leaning in); and they
 * react, their faces a strip of voxel pictures (`tools/portraits.mjs`, the few voxels of an eye or a
 * mouth changed): to a deal as it's drawn up (a nod as they'd take it, a shake as they wouldn't, a
 * word either way), to a deal struck (a smile and a nod), to war (a fist raised, the room darkening)
 * and to a denouncement (a fist raised). Everything moves by whole pixels, so nothing blurs; with
 * quick movement or combat off, they keep still (their faces still change).
 */

/** How a leader stands toward the viewer, from their opinion: warm, neutral, guarded, hostile (at war, or denouncing them). */
type Stance = 'warm' | 'neutral' | 'guarded' | 'hostile';

function stanceOf(p: PlayerSummary): Stance {
  const r = p.relation;
  if (p.war || (r?.denouncedYou ?? 0) > 0) return 'hostile';
  const s = r?.opinion?.stance;
  if (s === 'friendly' || s === 'favorable' || (r?.friends ?? 0) > 0) return 'warm';
  return s === 'hostile' ? 'hostile' : s === 'guarded' ? 'guarded' : 'neutral';
}

/** A leader's reaction: a nod (they'd take the deal), a shake (they wouldn't), a deal struck, war, a denouncement. */
export type Reaction = 'nod' | 'shake' | 'deal' | 'war' | 'denounce';

/** The strip's frames (`SHEET` in `tools/portraits.mjs`): each stance's face (its blink the next), the fist, talking. */
const FACE: Record<Stance, number> = { neutral: 0, warm: 2, guarded: 4, hostile: 6 };
const FIST = 8;
const TALK = 9;
const FRAMES = 10;
/** How long each reaction lasts (seconds). */
const REACTS: Record<Reaction, number> = { nod: 0.9, shake: 0.9, deal: 1.6, war: 2.6, denounce: 2 };

/** The room's canvas in its own pixels (each two on the screen), and how often it's drawn (a pixel scene's pace). */
const W = 128;
const H = 76;
const CX = W / 2;
const FPS = 10;
/** Where the floor starts, and the room's lights stand (either side of the window). */
const FLOOR = 62;
const LIGHTS = [25, W - 25];

/**
 * A room of an era: its wall (colour, the lines between, and how it's laid), its window and its
 * frame, what's seen through it (`sky` its colours, top to bottom), its lights and its floor.
 */
interface Room {
  wall: [string, string];
  lay: 'blocks' | 'bricks' | 'panels' | 'damask' | 'plain';
  window: 'arch' | 'colonnade' | 'gothic' | 'tall' | 'grid' | 'wide' | 'screen';
  frame: string;
  sky: [string, string];
  view: 'dusk' | 'sea' | 'glass' | 'hills' | 'smoke' | 'city' | 'night' | 'data';
  lights: 'torch' | 'candle' | 'lamp' | 'led' | 'none';
  floor: string;
}

/** The rooms, an era each. */
const ROOMS: Room[] = [
  // Ancient: sandstone, an arch onto the desert at dusk, torches.
  { wall: ['#c9a066', '#9c7442'], lay: 'blocks', window: 'arch', frame: '#7a5630', sky: ['#f4b867', '#e2764a'], view: 'dusk', lights: 'torch', floor: '#6e5032' },
  // Classical: a marble colonnade open to the sea.
  { wall: ['#e2dccf', '#b8b0a0'], lay: 'plain', window: 'colonnade', frame: '#a39a88', sky: ['#5eaee8', '#cbe7fa'], view: 'sea', lights: 'none', floor: '#8a8272' },
  // Medieval: a stone hall, stained glass, torches.
  { wall: ['#77726a', '#56524c'], lay: 'blocks', window: 'gothic', frame: '#3a3732', sky: ['#3a4a8a', '#c8423a'], view: 'glass', lights: 'torch', floor: '#4a3b2c' },
  // Renaissance: red damask, a tall window onto hills and a dome, candles.
  { wall: ['#8e3a2c', '#c8973c'], lay: 'damask', window: 'tall', frame: '#c8973c', sky: ['#86c0ea', '#e8f2f8'], view: 'hills', lights: 'candle', floor: '#5a3424' },
  // Industrial: brick, a factory window onto smoking chimneys, gas lamps.
  { wall: ['#8c4a35', '#5c2e21'], lay: 'bricks', window: 'grid', frame: '#2e2a26', sky: ['#9e9384', '#d6c6a6'], view: 'smoke', lights: 'lamp', floor: '#3e3028' },
  // Modern: wood panelling, a wide window onto a city at dusk.
  { wall: ['#6e4c33', '#4c3322'], lay: 'panels', window: 'wide', frame: '#2a1f17', sky: ['#3a4c84', '#f09c5a'], view: 'city', lights: 'lamp', floor: '#3a2a1e' },
  // Atomic: a plain teal room, the city by night, searchlights.
  { wall: ['#4e6c66', '#3a524d'], lay: 'plain', window: 'wide', frame: '#22302d', sky: ['#0c1530', '#2c3e6c'], view: 'night', lights: 'lamp', floor: '#2a3432' },
  // Information: dark panels, a wall of screens.
  { wall: ['#1f2833', '#2e3a4a'], lay: 'panels', window: 'screen', frame: '#0a0e14', sky: ['#0a1828', '#123a5a'], view: 'data', lights: 'led', floor: '#161c24' },
];

/** A number in [0, 1) for some integers, the same each time. */
function hash(a: number, b: number, c = 0): number {
  let n = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/** Whether a pixel of the room is window (what's beyond seen through it). */
function opening(kind: Room['window'], x: number, y: number): boolean {
  const px = x + 0.5;
  const py = y + 0.5;
  const dx = Math.abs(px - CX);
  switch (kind) {
    case 'arch':
      return py < 58 && dx < 34 && (py >= 38 || Math.hypot(px - CX, py - 38) < 34);
    case 'colonnade':
      return py > 6 && py < 52;
    case 'gothic': {
      // Two arcs meeting in a point, as wide as the window and springing at 34.
      const r = 36;
      if (py >= 58 || dx >= 24) return false;
      return py >= 34 || (Math.hypot(px - (CX - 24 + r), py - 34) < r && Math.hypot(px - (CX + 24 - r), py - 34) < r);
    }
    case 'tall':
      return py < 58 && dx < 20 && (py >= 26 || Math.hypot(px - CX, py - 26) < 20);
    case 'grid':
      return py > 8 && py < 56 && dx < 38;
    case 'wide':
      return py > 8 && py < 52 && dx < 46;
    case 'screen':
      return py > 6 && py < 50 && dx < 42;
  }
}

/** The bars across a window (its frame's colour), as rectangles [x, y, w, h]. */
function bars(kind: Room['window']): [number, number, number, number][] {
  switch (kind) {
    case 'gothic':
      return [[CX - 1, 6, 2, 52], [CX - 24, 34, 48, 1]];
    case 'tall':
      return [[CX - 1, 6, 2, 52], [CX - 20, 30, 40, 2]];
    case 'grid': {
      const out: [number, number, number, number][] = [];
      for (let x = CX - 38 + 9; x < CX + 38; x += 9.5) out.push([Math.round(x), 8, 1, 48]);
      for (let y = 16; y < 56; y += 8) out.push([CX - 38, y, 76, 1]);
      return out;
    }
    case 'wide':
      return [[CX - 17, 8, 2, 44], [CX + 15, 8, 2, 44]];
    case 'screen':
      return [[CX - 15, 6, 1, 44], [CX + 14, 6, 1, 44]];
    default:
      return [];
  }
}

/** The wall, its window cut out (clear), framed, with the floor and a rug in the civ's colours: drawn once a scene. */
function wallLayer(room: Room, rug: [string, string]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const [base, line, frame] = [rgb(room.wall[0]), rgb(room.wall[1]), rgb(room.frame)];
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < FLOOR && opening(room.window, x, y);
  for (let y = 0; y < FLOOR; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (open(x, y)) continue;
      let col = base;
      let shade = 1;
      if (open(x - 1, y) || open(x + 1, y) || open(x, y - 1) || open(x, y + 1)) col = frame;
      else if (room.lay === 'blocks') {
        const row = Math.floor(y / 8);
        const bx = x + (row % 2) * 8;
        if (y % 8 === 7 || bx % 16 === 15) col = line;
        else shade = 0.94 + hash(Math.floor(bx / 16), row) * 0.1;
      } else if (room.lay === 'bricks') {
        const row = Math.floor(y / 4);
        const bx = x + (row % 2) * 4;
        if (y % 4 === 3 || bx % 8 === 7) col = line;
        else shade = 0.92 + hash(Math.floor(bx / 8), row) * 0.12;
      } else if (room.lay === 'panels') {
        if (x % 16 === 0 || y === 40) col = line;
        else if (x % 16 === 1 || y === 41) shade = 1.12;
      } else if (room.lay === 'damask') {
        const mx = Math.abs((x % 10) - 5);
        const my = Math.abs((y % 10) - 5);
        if (y === 40 || y === 41 || (mx + my === 2 && y < 40)) col = line;
      } else if (y >= 40 && y < 43) col = line;
      else shade = 1.04 - (y / FLOOR) * 0.1;
      img.data[o] = Math.min(255, col[0] * shade);
      img.data[o + 1] = Math.min(255, col[1] * shade);
      img.data[o + 2] = Math.min(255, col[2] * shade);
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = room.frame;
  for (const [x, y, w, hh] of bars(room.window)) ctx.fillRect(x, y, w, hh);
  if (room.window === 'colonnade') {
    // Columns either side of the leader (and at the edges), under a beam, over a balustrade.
    for (const x0 of [-4, 22, W - 30, W - 4]) {
      ctx.fillStyle = room.wall[0];
      ctx.fillRect(x0, 6, 8, 46);
      ctx.fillStyle = room.wall[1];
      ctx.fillRect(x0 + 2, 9, 1, 40);
      ctx.fillRect(x0 + 5, 9, 1, 40);
      ctx.fillRect(x0 - 1, 6, 10, 3);
    }
    ctx.fillStyle = room.wall[1];
    ctx.fillRect(0, 5, W, 1);
    ctx.fillRect(0, 51, W, 2);
    ctx.fillStyle = room.wall[0];
    for (let x = 1; x < W; x += 4) ctx.fillRect(x, 53, 2, 7);
    ctx.fillRect(0, 53, W, 1);
  } else if (room.window !== 'screen' && room.window !== 'wide') {
    // A sill.
    const sill = { arch: 34, gothic: 24, tall: 20, grid: 38 }[room.window];
    ctx.fillStyle = room.frame;
    ctx.fillRect(CX - sill - 2, room.window === 'grid' ? 56 : 58, sill * 2 + 4, 2);
  }
  // The floor, its near edge lit; a rug in the civ's colour, edged in the other.
  ctx.fillStyle = room.floor;
  ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, FLOOR, W, 1);
  ctx.fillStyle = rug[1];
  ctx.fillRect(CX - 30, FLOOR + 4, 60, H - FLOOR - 4);
  ctx.fillStyle = rug[0];
  ctx.fillRect(CX - 29, FLOOR + 5, 58, H - FLOOR - 5);
  return c;
}

/** What's seen through the window, at a time (seconds): drawn across the whole room, the wall over it. */
function drawView(ctx: CanvasRenderingContext2D, room: Room, sky: CanvasGradient, t: number) {
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, FLOOR);
  const px = (x: number, y: number, w: number, hh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, hh);
  };
  /** A cloud drifting across, `w` wide. */
  const cloud = (seed: number, y: number, w: number, speed: number) => {
    const x = ((hash(seed, 1) * (W + 40) + t * speed) % (W + 40)) - 20;
    px(x + 2, y, w - 4, 1, '#ffffff');
    px(x, y + 1, w, 2, '#ffffff');
    px(x + 1, y + 3, w - 2, 1, '#dbe7f0');
  };
  switch (room.view) {
    case 'dusk': {
      // A low sun, its glow breathing; dunes and a far pyramid; two birds crossing.
      const glow = 0.5 + Math.sin(t * 0.8) * 0.5;
      px(CX + 18, 36, 12, 12, `rgba(255,236,170,${0.18 + glow * 0.12})`);
      px(CX + 20, 38, 8, 8, '#ffe8a0');
      px(CX + 21, 37, 6, 10, '#ffe8a0');
      px(CX - 32, 46, 1, 1, '#b8603e');
      for (let i = 0; i < 6; i++) px(CX - 32 - i, 46 + i, 1 + i * 2, 1, '#b8603e');
      for (let x = 0; x < W; x++) px(x, 50 + Math.round(Math.sin(x * 0.09) * 2 + Math.sin(x * 0.23) * 1), 1, 10, x % 7 ? '#c8784a' : '#bf6f44');
      for (let i = 0; i < 2; i++) {
        const bx = ((t * 3 + i * 9) % (W + 20)) - 10;
        const by = 18 + i * 4 + Math.round(Math.sin(t * 2 + i) * 1);
        const flap = Math.floor(t * 4 + i) % 2;
        px(bx - 1, by - flap, 1, 1, '#5a3324');
        px(bx, by, 1, 1, '#5a3324');
        px(bx + 1, by - flap, 1, 1, '#5a3324');
      }
      break;
    }
    case 'sea': {
      // Clouds; the sea, its glints moving.
      cloud(1, 12, 16, 1.6);
      cloud(2, 22, 11, 2.4);
      cloud(3, 30, 13, 1.1);
      px(0, 42, W, 10, '#3d7fc0');
      px(0, 42, W, 1, '#7ab4e4');
      for (let i = 0; i < 14; i++) {
        const gx = (hash(i, 7) * W + t * (1 + hash(i, 8) * 2)) % W;
        if (Math.sin(t * 2 + i) > 0.3) px(gx, 44 + Math.floor(hash(i, 9) * 7), 2, 1, '#cfe6fa');
      }
      break;
    }
    case 'glass': {
      // Stained glass: panes of colour set in lead, light shimmering through.
      const glass = ['#c8423a', '#3a5ac8', '#e8b83a', '#3a9a5a', '#8a3ab0', '#3a7ac8'];
      for (let y = 0; y < FLOOR; y += 5)
        for (let x = 0; x < W; x += 5) {
          const k = hash(x / 5, y / 5);
          px(x, y, 5, 5, '#1c1a22');
          px(x + 1, y + 1, 4, 4, glass[Math.floor(k * glass.length)]);
          const shine = Math.sin(t * 0.9 + k * 12) * 0.5 + 0.5;
          px(x + 1, y + 1, 4, 4, `rgba(255,248,220,${(shine * 0.22).toFixed(3)})`);
        }
      break;
    }
    case 'hills': {
      // Clouds over green hills, a domed church on one.
      cloud(4, 10, 15, 1.4);
      cloud(5, 20, 10, 2.2);
      for (let x = 0; x < W; x++) px(x, 46 + Math.round(Math.sin(x * 0.07 + 1) * 3), 1, 14, '#7aa868');
      for (let x = 0; x < W; x++) px(x, 51 + Math.round(Math.sin(x * 0.11) * 2), 1, 9, '#5e9050');
      px(CX + 10, 38, 8, 8, '#e8dcc0');
      px(CX + 11, 35, 6, 3, '#c87a4a');
      px(CX + 13, 33, 2, 2, '#c87a4a');
      break;
    }
    case 'smoke': {
      // Chimneys, smoke rising and drifting off each.
      const stacks: [number, number][] = [[CX - 30, 22], [CX - 16, 30], [CX + 14, 26], [CX + 28, 18]];
      for (const [x, hh] of stacks) {
        for (let i = 0; i < 5; i++) {
          const k = (t * 0.22 + i / 5 + hash(x, 3)) % 1;
          const s = 2 + Math.round(k * 4);
          px(x + k * 10 - s / 2 + 1, 56 - hh - k * 34 - s / 2, s, s, `rgba(92,84,76,${(0.75 * (1 - k)).toFixed(3)})`);
        }
        px(x, 56 - hh, 3, hh, '#4a4038');
        px(x - 1, 56 - hh, 5, 1, '#3a322c');
      }
      px(0, 50, W, 6, '#6a5e52');
      break;
    }
    case 'city':
    case 'night': {
      // A skyline, its windows lit one by one (by night, stars over it and searchlights sweeping).
      const night = room.view === 'night';
      if (night) {
        for (let i = 0; i < 30; i++) if (Math.sin(t * (1 + hash(i, 2)) + i) > -0.2) px(hash(i, 3) * W, hash(i, 4) * 30, 1, 1, '#e8eeff');
        for (const [x0, phase] of [[CX - 36, 0], [CX + 36, 2]]) {
          const a = -Math.PI / 2 + Math.sin(t * 0.35 + phase) * 0.55;
          for (let d = 4; d < 56; d++) px(x0 + Math.cos(a) * d, 54 + Math.sin(a) * d, 1 + Math.floor(d / 20), 1, 'rgba(220,230,255,0.16)');
        }
      }
      for (let b = 0; b * 6 < W; b++) {
        const hh = 10 + Math.floor(hash(b, 11) * 24);
        const x = b * 6;
        px(x, 56 - hh, 6, hh, night ? '#0a1020' : '#2a2440');
        for (let wy = 58 - hh; wy < 54; wy += 3)
          for (let wx = x + 1; wx < x + 5; wx += 2) if (hash(wx, wy, Math.floor(t / 3 + hash(wx, wy) * 7)) > (night ? 0.5 : 0.62)) px(wx, wy, 1, 1, '#ffd27a');
      }
      break;
    }
    case 'data': {
      // Screens: a faint grid, bars rising and falling, lines of figures scrolling, dots blinking.
      ctx.fillStyle = 'rgba(58,160,220,0.14)';
      for (let x = 0; x < W; x += 6) ctx.fillRect(x, 0, 1, FLOOR);
      for (let y = 0; y < FLOOR; y += 6) ctx.fillRect(0, y, W, 1);
      for (let i = 0; i < 5; i++) {
        const hh = 4 + Math.round(Math.abs(Math.sin(t * 0.7 + i * 1.3)) * 14);
        px(CX - 38 + i * 4, 46 - hh, 3, hh, '#3ad0ff');
      }
      for (let k = 0; k < 10; k++) {
        const y = 46 - ((t * 5 + k * 4) % 40);
        px(CX + 18, y, 6 + Math.floor(hash(k, 5) * 16), 1, 'rgba(122,232,160,0.8)');
      }
      for (let i = 0; i < 8; i++) if (Math.sin(t * 3 + i * 2.1) > 0.4) px(CX - 14 + hash(i, 6) * 28, 8 + hash(i, 7) * 10, 1, 1, '#ff6b5e');
      px(0, 6 + ((t * 9) % 44), W, 1, 'rgba(160,220,255,0.18)');
      break;
    }
  }
}

/** The room's lights over it all: flames that flicker (torches, candles), lamps hung from above, strips of light. */
function drawLights(ctx: CanvasRenderingContext2D, room: Room, t: number) {
  const px = (x: number, y: number, w: number, hh: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x), Math.round(y), w, hh);
  };
  const glow = (x: number, y: number, r: number, c: string) => {
    for (let k = r; k > 0; k -= 2) px(x - k, y - k, k * 2 + 1, k * 2 + 1, c);
  };
  const tick = Math.floor(t * FPS);
  for (const [i, x] of LIGHTS.entries()) {
    const flick = hash(tick, i);
    if (room.lights === 'torch') {
      glow(x, 30, 9 + Math.round(flick * 2), 'rgba(255,170,70,0.06)');
      px(x - 1, 33, 3, 6, '#2a2420');
      px(x - 2, 32, 5, 1, '#3a3028');
      const tall = 3 + Math.round(flick * 2);
      px(x - 1, 32 - tall, 3, tall, '#ff9a3a');
      px(x, 31 - tall - Math.round(hash(tick, i + 5)), 1, 2, '#ffd27a');
      px(x, 30, 1, 2, '#fff2b0');
    } else if (room.lights === 'candle') {
      glow(x, 31, 6 + Math.round(flick), 'rgba(255,214,140,0.06)');
      px(x - 3, 38, 7, 1, '#c8973c');
      px(x, 38, 1, 4, '#c8973c');
      for (const cx of [x - 2, x + 2]) {
        px(cx, 34, 1, 4, '#f4ecd8');
        px(cx, 32 - Math.round(hash(tick, cx)), 1, 2, '#ffcf6a');
      }
    } else if (room.lights === 'lamp') {
      glow(x, 10, 7, 'rgba(255,226,160,0.05)');
      px(x, 0, 1, 6, '#1a1612');
      px(x - 3, 6, 7, 2, '#3a3028');
      px(x - 2, 8, 5, 1, room.view === 'night' ? '#dfe8ff' : '#fff0c0');
    }
  }
  if (room.lights === 'led') {
    const a = (0.55 + Math.sin(t * 1.4) * 0.2).toFixed(3);
    px(0, 2, W, 1, `rgba(90,220,255,${a})`);
    px(0, FLOOR - 2, W, 1, `rgba(90,220,255,${a})`);
  }
}

/** How the room's lit by how its leader feels: hostile, darker and toward red (at war, more); warm, warmer. */
const tintOf = (stance: Stance, war: boolean) => (stance === 'hostile' ? (war ? 'rgba(120,20,12,0.32)' : 'rgba(90,24,16,0.22)') : stance === 'warm' ? 'rgba(255,214,140,0.10)' : null);

/** A room drawn at a time (seconds): its view, its wall, its lights, and a tint over it all. */
function painter(canvas: HTMLCanvasElement, room: Room, rug: [string, string], tint: string | null): (t: number) => void {
  const ctx = canvas.getContext('2d')!;
  const wall = wallLayer(room, rug);
  const sky = ctx.createLinearGradient(0, 0, 0, FLOOR);
  sky.addColorStop(0, room.sky[0]);
  sky.addColorStop(1, room.sky[1]);
  return (t) => {
    drawView(ctx, room, sky, t);
    ctx.drawImage(wall, 0, 0);
    drawLights(ctx, room, t);
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, W, H);
    }
  };
}

/** A scene on the screen: its element, and its drawing at a time (seconds). */
interface Scene {
  el: El;
  paint: (t: number) => void;
}
/** The leader's scene on show (kept across redraws, so it carries on where it was): whose, and how they stood when it was made. */
let shown: (Scene & { key: string }) | null = null;
/** The scenes on the screen (a leader's, an era's card), drawn at the room's pace; and whether they're being drawn. */
const live = new Set<Scene>();
let running = false;

/** Draw a scene at the room's pace while it's on the screen (still, under reduced motion). */
function run(scene: Scene) {
  live.add(scene);
  if (running || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  running = true;
  let last = 0;
  const tick = (now: number) => {
    for (const s of live) if (!s.el.isConnected) live.delete(s);
    if (!live.size) {
      running = false;
      return;
    }
    if (now - last >= 1000 / FPS) {
      last = now;
      for (const s of live) s.paint(now / 1000);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// -------------------------------------------------------------------------------------------------
// The leader living

/** The reaction under way (whose, what, since when: the page's seconds). */
let reacting: { player: number; kind: Reaction; at: number } | null = null;
/** How things stood between each leader and the viewer when last looked (to see a reaction's cause come). */
const seen = new Map<number, { war: boolean; denounced: number; ties: number; check: object | null; refused: object | null }>();

/** A leader reacts (unless already reacting so). */
export function react(player: number, kind: Reaction) {
  const now = performance.now() / 1000;
  if (reacting?.player === player && reacting.kind === kind && now - reacting.at < REACTS[kind]) return;
  reacting = { player, kind, at: now };
}

/** Whether leaders keep still (quick movement or combat off). */
const still = () => !Math.min(marchSpeed(), combatSpeed());

/** What's between a leader and the viewer, counted: a deal struck adds to it. */
function ties(p: PlayerSummary): number {
  const r = p.relation;
  if (!r) return 0;
  return r.deals.length + Number(r.friends > 0) + Number(r.pact > 0) + Number(r.research > 0) + Number(r.embassyThere) + Number(r.embassyHere) + Number(p.openBorders) + Number(p.opensBorders);
}

/**
 * What's changed between a leader and the viewer since last looked, and their reaction to it: war
 * declared, a denouncement, a deal struck, a deal put to them refused, the deal being drawn up with
 * them weighed again.
 */
function lookAgain(i: number) {
  const p = store.view?.players[i];
  if (!p) return;
  const table = store.diplo.with === i && !!store.diplo.deal;
  const refused = table && store.toast && !store.toast.good ? store.toast : null;
  const now = { war: p.war, denounced: (p.relation?.denouncedYou ?? 0) + (p.relation?.youDenounced ?? 0), ties: ties(p), check: store.diplo.with === i ? store.diplo.check : null, refused };
  const was = seen.get(i);
  seen.set(i, now);
  if (!was) return;
  if (now.war && !was.war) react(i, 'war');
  else if (now.denounced > was.denounced) react(i, 'denounce');
  else if (now.ties > was.ties) react(i, 'deal');
  else if (now.refused && now.refused !== was.refused) react(i, 'shake');
  else if (now.check && now.check !== was.check && store.diplo.deal?.length) react(i, store.diplo.check!.ok ? 'nod' : 'shake');
}

/** The leader at a time: their face (a frame of the strip) and how they stand (pixels across, down, and how much bigger: leaning in). */
function pose(i: number, stance: Stance, t: number): { frame: number; x: number; y: number; scale: number; shade: number } {
  const calm = still();
  const r = reacting?.player === i ? reacting : null;
  const k = r ? t - r.at : Infinity;
  // (Warm, a little up; hostile, leaning in.)
  const base = { frame: FACE[stance], x: 0, y: stance === 'warm' ? -2 : stance === 'hostile' ? 6 : 0, scale: stance === 'hostile' ? 1.08 : 1, shade: 0 };
  if (r && k < REACTS[r.kind]) {
    const step = Math.floor(k * FPS);
    switch (r.kind) {
      case 'nod':
        return { ...base, frame: k < 0.4 ? TALK : FACE[stance], y: base.y + (calm ? 0 : step % 4 < 2 ? 2 : 0) };
      case 'shake':
        return { ...base, frame: k < 0.3 ? TALK : FACE.guarded, x: calm || step > 7 ? 0 : step % 2 ? 2 : -2 };
      case 'deal':
        return { ...base, frame: k > 1.1 ? TALK : FACE.warm, y: base.y + (calm ? 0 : step % 4 < 2 && step < 10 ? 2 : 0) };
      case 'war':
      case 'denounce': {
        const dark = r.kind === 'war' ? 0.55 : 0.3;
        const shade = calm ? dark : dark * Math.min(1, k / 0.5) * Math.min(1, (REACTS[r.kind] - k) / 0.4);
        return { frame: FIST, x: calm || k > 0.6 ? 0 : step % 2 ? 1 : -1, y: 6, scale: 1.1, shade };
      }
    }
  }
  if (calm) return base;
  // Breathing (warm, a lively bob), and a blink every few seconds.
  const breath = stance === 'warm' ? (Math.floor(t / 0.7) % 2 ? 2 : 0) : Math.floor(t / 1.6) % 2 ? 1 : 0;
  const blink = (t + i * 1.7) % 4.3 < 0.15;
  return { ...base, frame: base.frame + (blink ? 1 : 0), y: base.y - breath };
}

/**
 * A leader in their room: their face and stance as they feel about the viewer, their banners, their
 * era's room; smaller at the trade table. `kind`: a reaction to begin now (a war declared on a card).
 */
export function leaderScene(p: PlayerSummary, opts: { small?: boolean; kind?: Reaction } = {}): El {
  const stance = stanceOf(p);
  const era = Math.max(0, Math.min(ROOMS.length - 1, p.era));
  const key = `${p.index}|${p.civ}|${era}|${stance}|${p.war}`;
  if (opts.kind) react(p.index, opts.kind);
  if (shown?.key !== key) {
    const civ = CIVS[p.civ];
    const colours: [string, string] = [civ?.color ?? '#5a6274', civ?.accent ?? '#e8e2d0'];
    const canvas = h('canvas.dp-room', { width: String(W), height: String(H) }) as HTMLCanvasElement;
    const banner = (side: string) => h(`div.dp-banner.${side}`, { style: `--c:${colours[0]};--a:${colours[1]}` }, h('div.cloth', {}, emblemEl(p.civ, 22)));
    const url = PICTURES[`l_${p.civ}_sheet` as PictureId];
    const leader = url ? h('div.dp-leader', { style: `background-image:url("${url}")` }) : h('div.dp-leader.emblem', {}, emblemEl(p.civ, 60));
    const shade = h('div.dp-shade');
    const room = painter(canvas, ROOMS[era], colours, tintOf(stance, p.war));
    const i = p.index;
    const paint = (t: number) => {
      room(t);
      lookAgain(i);
      const q = pose(i, stance, t);
      leader.style.backgroundPositionX = `${(q.frame / (FRAMES - 1)) * 100}%`;
      leader.style.transform = `translate(${q.x}px, ${q.y}px) scale(${q.scale})`;
      shade.style.opacity = String(q.shade);
    };
    paint(performance.now() / 1000);
    shown = { key, el: h('div.dp-scene.cv-pic', {}, canvas, banner('l'), banner('r'), shade, leader), paint };
  }
  shown.el.classList.toggle('small', !!opts.small);
  run(shown);
  return shown.el;
}

/** An era's room, empty (for the card when a civ enters it): its view, its lights, a rug and banners in the viewer's colours. */
export function eraRoom(era: number, civ: string): El {
  const c = CIVS[civ];
  const colours: [string, string] = [c?.color ?? '#5a6274', c?.accent ?? '#e8e2d0'];
  const canvas = h('canvas.dp-room', { width: String(W), height: String(H) }) as HTMLCanvasElement;
  const banner = (side: string) => h(`div.dp-banner.${side}`, { style: `--c:${colours[0]};--a:${colours[1]}` }, h('div.cloth', {}, emblemEl(civ, 22)));
  const paint = painter(canvas, ROOMS[Math.max(0, Math.min(ROOMS.length - 1, era))], colours, tintOf('warm', false));
  paint(performance.now() / 1000);
  const scene = { el: h('div.dp-scene.era', {}, canvas, banner('l'), banner('r')), paint };
  run(scene);
  return scene.el;
}

export const SCENE_CSS = `
.cv-root .dp-scene { position: relative; width: 264px; height: 160px; flex: none; display: block; overflow: hidden; }
.dp-scene .dp-room { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
.dp-banner { position: absolute; top: 0; width: 12.5%; height: 66%; }
.dp-banner.l { left: 4%; } .dp-banner.r { right: 4%; }
.dp-banner.r .cloth { animation-delay: -2.1s; }
.dp-banner .cv-em img { width: auto; height: auto; }
.dp-banner::before { content: ''; position: absolute; left: -12%; right: -12%; top: 3px; height: 4px; background: #2a2018; box-shadow: 0 2px 0 rgba(0,0,0,.35); }
.dp-banner .cloth { position: absolute; left: 0; right: 0; top: 5px; bottom: 0; background: linear-gradient(180deg, transparent 0 45%, rgba(255,255,255,.14) 45% 49%, transparent 49% 51%, rgba(0,0,0,.12) 51% 55%, transparent 55%) 0 0 / 100% 200%, var(--c); box-shadow: inset 0 0 0 2px #07090c, inset 0 0 0 4px var(--a), inset 0 6px 0 rgba(255,255,255,.12); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 82%, 0 100%); display: flex; justify-content: center; padding-top: 12px; animation: dpRipple 4.2s steps(14, end) infinite; }
.dp-scene .dp-leader { position: absolute; left: 50%; bottom: -12px; width: 50%; aspect-ratio: 1; margin-left: -25%; background-repeat: no-repeat; background-size: ${FRAMES * 100}% 100%; image-rendering: pixelated; transform-origin: 50% 100%; filter: drop-shadow(3px 3px 0 rgba(4,6,10,.45)); }
.dp-scene .dp-leader.emblem { display: flex; justify-content: center; align-items: flex-end; bottom: 12px; aspect-ratio: auto; }
.dp-scene .dp-shade { position: absolute; inset: 0; background: #2a0604; opacity: 0; pointer-events: none; }
@keyframes dpRipple { from { background-position: 0 100%, 0 0; } to { background-position: 0 -100%, 0 0; } }
.cv-root .dp-scene.small { width: 160px; height: 97px; }
@media (max-width: 760px), (max-height: 520px) { .cv-root .dp-scene { width: 200px; height: 122px; } .cv-root .dp-scene.small { width: 128px; height: 78px; } }
@media (prefers-reduced-motion: reduce) { .dp-scene * { animation: none !important; } }
`;
