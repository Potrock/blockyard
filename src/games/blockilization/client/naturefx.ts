import type { Client } from '@platform/client';
import { baseX, centreNear, HEX, SEA_Y } from '../geometry';
import { TERRAINS } from '../rules/terrain';
import { cam, centreHere, homeShift, lookAt, toScreen } from './camera';
import { store } from './store';

/**
 * The natural wonders' life, on this screen (their blocks are `landmarks.ts`'s): mist drifting from
 * Emerald Falls, sparks, smoke and a pulsing glow at the Ember Throne's crater, a shimmer over the
 * Heartstone, motes rising from the Ageless Spring and the Starfall Crater, a light beating at Mount
 * Solace's summit, gold glinting on the Gilded Peak, birds wheeling round the Worldroot and its
 * leaves falling, cloud drifting past the Sky Pillar and the Cloudcrown, light on the Sunken Crown's
 * lagoon, fireflies in the Stone Grove, dust blowing through the Sun Arch, spray where the Titan's
 * Steps meet the sea. Only for wonders this player knows, on the screen and not too far off, a few
 * particles at a time. And the moment one is found: the camera eases to it and it flares up.
 */

/** A natural wonder this player knows: where it stands (its first tile's middle, and the middle of both for a pair), and its effects' timers. */
interface Spot {
  id: string;
  x: number;
  z: number;
  /** The middle of its tiles, and (for a pair) the middle of the edge between them and the other tile's middle. */
  mx: number;
  mz: number;
  px: number;
  pz: number;
  /** Each effect's particles owed (fractions carry over), and when its next beat is due. */
  owed: Record<string, number>;
  next: Record<string, number>;
}

/** Wonders known, worked out again when what's known changes. */
let spots: Spot[] = [];
let spotsFor: object | null = null;
/** Wonders found just now, to flare up (their tiles). */
let reveals: number[] = [];
/** Linear colours. */
const WHITE: [number, number, number] = [0.85, 0.9, 0.95];

/** How far north of a wonder the camera looks, as it's revealed (a share of its distance): so the wonder shows under the card announcing it. */
const UNDER_CARD = 0.3;

/** The camera eases to a natural wonder just found (to show it under the card announcing it), and it flares up. */
export function revealWonder(t: number) {
  const id = store.known[t]?.wonder;
  if (!store.grid || !id) return;
  const spot = spotFor(id);
  if (spot) lookAt(spot.mx, spot.mz - cam.dist * UNDER_CARD);
  reveals.push(t);
}

/** A known wonder's spot (its tiles, as this player knows them). */
function spotFor(id: string): Spot | null {
  const g = store.grid!;
  const tiles = store.known.flatMap((k, t) => (k?.wonder === id ? [t] : []));
  if (!tiles.length) return null;
  // (A pair's first is its land tile, or else its northern one: as the world was built.)
  const water = (t: number) => (TERRAINS[store.terrain[t]?.terrain]?.water ? 1 : 0);
  tiles.sort((a, b) => water(a) - water(b) || a - b);
  const a = centreHere(g, tiles[0]);
  const b = tiles[1] !== undefined ? centreNear(g, tiles[1], a.x) : a;
  return { id, x: a.x, z: a.z, mx: (a.x + b.x) / 2, mz: (a.z + b.z) / 2, px: b.x, pz: b.z, owed: {}, next: {} };
}

/** Each frame: the effects of the wonders on screen. */
export function drawNatureFx(client: Client, dt: number) {
  if (!store.grid || !store.view) return;
  if (spotsFor !== store.known) {
    spotsFor = store.known;
    const ids = [...new Set(store.known.flatMap((k) => (k?.wonder ? [k.wonder] : [])))];
    const was = new Map(spots.map((s) => [s.id, s]));
    spots = ids.flatMap((id) => {
      const s = spotFor(id);
      return s ? [Object.assign(s, { owed: was.get(id)?.owed ?? {}, next: was.get(id)?.next ?? {} })] : [];
    });
  }
  // Round a world that wraps, each at its copy nearest the camera.
  for (const s of spots) {
    const k = homeShift(s.x);
    s.x += k;
    s.mx += k;
    s.px += k;
  }
  const fx = client.fx;
  const now = client.time;
  for (const t of reveals.splice(0)) {
    const spot = spots.find((s) => s.id === store.known[t]?.wonder);
    if (!spot) continue;
    const at = { x: spot.mx, y: SEA_Y + 6, z: spot.mz };
    fx.particles(at, [1, 0.75, 0.25], { count: 70, speed: 5, size: 0.14, gravity: -0.5, glow: 3, life: 2.4, spread: 3, up: 1.5, drag: 1.2, collide: false });
    fx.flare(at, 6);
  }
  // Far off, they're too small to be worth it.
  if (cam.dist > 125) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const s of spots) {
    const on = toScreen(s.mx, SEA_Y + 4, s.mz);
    if (!on || on.x < -150 || on.x > w + 150 || on.y < -150 || on.y > h + 200) continue;
    /** `rate` a second of `emit` (fractions carried to the next frame). */
    const steady = (key: string, rate: number, emit: () => void) => {
      let n = (s.owed[key] ?? Math.random()) + rate * dt;
      for (; n >= 1; n--) emit();
      s.owed[key] = n;
    };
    /** `emit` every `gap` seconds or so. */
    const beat = (key: string, gap: number, emit: () => void) => {
      if (now < (s.next[key] ?? 0)) return;
      s.next[key] = now + gap * (0.6 + Math.random() * 0.8);
      emit();
    };
    /** A point round the wonder's middle within `r` blocks, `y` over the sea. */
    const round = (r: number, y: number) => {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      return { x: s.x + Math.cos(a) * d, y: SEA_Y + y, z: s.z + Math.sin(a) * d };
    };
    effects(client, s, now, steady, beat, round);
  }
}

type Steady = (key: string, rate: number, emit: () => void) => void;
type Beat = (key: string, gap: number, emit: () => void) => void;
type Round = (r: number, y: number) => { x: number; y: number; z: number };

/** One wonder's effects this frame. */
function effects(client: Client, s: Spot, now: number, steady: Steady, beat: Beat, round: Round) {
  const fx = client.fx;
  /** A glow that stays (one short-lived glowing particle a frame), `size` blocks across. */
  const glow = (at: { x: number; y: number; z: number }, color: [number, number, number], size: number, strength: number) =>
    fx.particles(at, color, { count: 1, speed: 0, size, gravity: 0, glow: strength, life: 0.05, spread: 0, up: 0, collide: false });
  switch (s.id) {
    case 'emerald_falls': {
      // Mist rolling up from where the falls land (in the second tile, by the edge it shares with the first), and spray off the lip.
      const fall = { x: s.mx + (s.px - s.mx) * 0.35, z: s.mz + (s.pz - s.mz) * 0.35 };
      steady('mist', 26, () => fx.particles({ x: fall.x, y: SEA_Y + 2, z: fall.z }, WHITE, { count: 1, speed: 0.8, size: 0.9, gravity: -0.35, life: 2.4, spread: 3.5, up: 0.6, drag: 0.9, collide: false }));
      steady('spray', 16, () => fx.particles({ x: s.mx, y: SEA_Y + 11, z: s.mz }, WHITE, { count: 1, speed: 1.2, size: 0.16, gravity: 9, life: 0.8, spread: 3, up: 0.5, collide: false }));
      break;
    }
    case 'ember_throne': {
      const crater = { x: s.x, y: SEA_Y + 10, z: s.z };
      glow({ ...crater, y: crater.y + 0.4 }, [1, 0.3, 0.05], 2.2 + Math.sin(now * 2.4) * 0.8, 3);
      steady('sparks', 16, () => fx.particles(crater, [1, 0.32, 0.04], { count: 1, speed: 2.5, size: 0.15, gravity: 7, glow: 6, life: 1.3, spread: 1.2, up: 5, collide: false }));
      steady('smoke', 7, () => fx.particles({ ...crater, y: crater.y + 1.2 }, [0.07, 0.065, 0.065], { count: 1, speed: 0.3, size: 1.1, gravity: -0.8, life: 4.5, spread: 1, up: 0.8, drag: 0.35, velocity: { x: 0.5, y: 0, z: -0.25 }, collide: false }));
      break;
    }
    case 'heartstone':
      glow({ x: s.x, y: SEA_Y + 8, z: s.z }, [0.5, 0.2, 1], 3 + Math.sin(now * 1.7) * 0.6, 1.2);
      steady('shimmer', 30, () => fx.particles(round(2.8, 3 + Math.random() * 8), [0.6, 0.3, 1], { count: 1, speed: 0.3, size: 0.2, gravity: -0.3, glow: 5, life: 1.8, spread: 0.2, up: 0.4, collide: false }));
      break;
    case 'ageless_spring':
      glow({ x: s.x, y: SEA_Y + 2.2, z: s.z - 0.3 }, [0.3, 1, 0.85], 3.2 + Math.sin(now * 1.3) * 0.4, 1.2);
      steady('motes', 18, () => fx.particles(round(2, 2.1), [0.35, 1, 0.85], { count: 1, speed: 0.2, size: 0.18, gravity: -0.35, glow: 4, life: 2.6, spread: 0.2, up: 0.5, collide: false }));
      break;
    case 'starfall_crater':
      glow({ x: s.x, y: SEA_Y + 2.5, z: s.z }, [0.4, 0.8, 1], 2.4 + Math.sin(now * 2.1) * 0.5, 1.5);
      steady('motes', 18, () => fx.particles(round(1.3, 2), [0.45, 0.85, 1], { count: 1, speed: 0.4, size: 0.18, gravity: -0.6, glow: 5, life: 2.2, spread: 0.3, up: 1, collide: false }));
      break;
    case 'mount_solace': {
      const summit = { x: s.x, y: SEA_Y + 13.8, z: s.z };
      glow(summit, [1, 0.8, 0.35], 1.4 + Math.max(0, Math.sin(now * 2)) * 1.2, 6);
      steady('motes', 6, () => fx.particles(summit, [1, 0.75, 0.3], { count: 1, speed: 0.5, size: 0.12, gravity: -0.4, glow: 4, life: 2.5, spread: 0.8, up: 0.6, collide: false }));
      break;
    }
    case 'gilded_peak':
      // Glints on the gold: a column at random, its top found from above; a sparkle if it's gold.
      steady('glint', 9, () => {
        const p = round(HEX * 0.9, 14);
        // (Round a world that wraps, its blocks read where they're built.)
        const bx = store.grid ? baseX(store.grid, p.x) : p.x;
        const hit = client.world.raycast({ ...p, x: bx }, { x: 0, y: -1, z: 0 }, 14);
        if (!hit) return;
        const y = p.y - hit.distance;
        if (client.world.blockAt(Math.floor(bx), Math.floor(y - 0.5), Math.floor(p.z)) === 'civ_gold') fx.particles({ x: p.x, y: y + 0.3, z: p.z }, [1, 0.85, 0.4], { count: 1, speed: 0, size: 0.35, gravity: 0, glow: 8, life: 0.45, spread: 0, up: 0, collide: false });
      });
      break;
    case 'worldroot': {
      // Birds wheeling round its crown: each a dark speck drawn afresh every frame where it's got to.
      for (let i = 0; i < 7; i++) {
        const a = now * (0.45 + i * 0.04) + i * 1.9;
        const r = 4.4 + (i % 3) * 0.8;
        const flap = Math.sin(now * 9 + i) > 0 ? 0.5 : 0.36;
        fx.particles({ x: s.x + Math.cos(a) * r, y: SEA_Y + 13 + Math.sin(now * 1.3 + i) * 0.6, z: s.z + Math.sin(a) * r }, [0.03, 0.025, 0.02], { count: 1, speed: 0, size: flap, gravity: 0, life: 0.05, spread: 0, up: 0, collide: false });
      }
      steady('leaves', 6, () => fx.particles(round(3.6, 9), [0.95, 0.6, 0.1], { count: 1, speed: 0.4, size: 0.2, gravity: 0.6, life: 4, spread: 0.3, up: 0, drag: 1.5, velocity: { x: 0.5, y: 0, z: 0.2 } }));
      break;
    }
    case 'sky_pillar':
      steady('cloud', 7, () => fx.particles(round(3.2, 9.5), WHITE, { count: 1, speed: 0.1, size: 1.1, gravity: 0, life: 3.5, spread: 0.5, up: 0, velocity: { x: 0.7, y: 0, z: 0.15 }, collide: false }));
      break;
    case 'cloudcrown':
      steady('cloud', 10, () => fx.particles(round(3.4, 7.5), WHITE, { count: 1, speed: 0.1, size: 1.1, gravity: 0, life: 3.5, spread: 0.5, up: 0, velocity: { x: 0.6, y: 0, z: 0.2 }, collide: false }));
      break;
    case 'sunken_crown':
      // Light on the lagoon, over both its tiles.
      steady('glitter', 30, () => fx.particles({ x: s.mx + (Math.random() - 0.5) * 8, y: SEA_Y + 0.8, z: s.mz + (Math.random() - 0.5) * 7 }, [1, 1, 0.9], { count: 1, speed: 0, size: 0.22, gravity: 0, glow: 5, life: 0.4, spread: 0.5, up: 0, collide: false }));
      break;
    case 'stone_grove':
      steady('fireflies', 12, () => fx.particles(round(3, 3.5 + Math.random() * 3), [1, 0.62, 0.15], { count: 1, speed: 0.35, size: 0.18, gravity: 0, glow: 5, life: 3, spread: 0.2, up: 0, drag: 0.3, collide: false }));
      break;
    case 'sun_arch':
      steady('dust', 8, () => fx.particles(round(3.2, 2.5), [0.75, 0.38, 0.18], { count: 1, speed: 0.2, size: 0.2, gravity: 0.05, life: 3, spread: 0.5, up: 0.2, velocity: { x: 1.3, y: 0.1, z: 0.1 }, collide: false }));
      break;
    case 'titans_steps':
      // Spray bursting where the causeway meets the sea, now and then.
      beat('spray', 1.5, () => fx.particles({ x: s.px + (Math.random() - 0.5) * 3, y: SEA_Y + 1, z: s.pz + (Math.random() - 0.5) * 3 }, WHITE, { count: 20, speed: 1.8, size: 0.2, gravity: 9, life: 0.9, spread: 1, up: 3.5, collide: false }));
      break;
  }
}
