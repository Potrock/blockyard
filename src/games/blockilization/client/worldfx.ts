import type { Client } from '@platform/client';
import type { View } from '../protocol';
import { CIVS } from '../rules/civs';
import { isGreatPerson } from '../rules/units';
import { centreHere, homeShift, toScreen } from './camera';
import { tileY } from './overlay';
import { play } from './sound';
import { momentPace } from './splash';
import { store } from './store';

/**
 * The world's moments, on this screen, seen in what changed from one view to the next: where they
 * happen, if they're on the screen, a moment of particles (`client.fx`), and some a sound.
 *
 * - A city founded: dust thrown up, and a banner of its civ's colour rising over it.
 * - A world wonder completed: beams of light rising over its city, and fireworks.
 * - A golden age begun: a warm shimmer of gold over your cities.
 * - A city captured: smoke rising, and a burst of its new owner's colour (drums and a horn).
 * - A unit of yours promoted: a sparkle (a glint of sound).
 * - A great person born: a column of light where they stand (a choir).
 *
 * And while it lasts: a city being razed burns (flames among its houses, smoke rising over it).
 */

type Rgb = [number, number, number];

/** A moment that goes on a while: a few particles every `every` seconds until `until` (round a world that wraps, its places kept at their copies nearest the camera). */
interface Lasting {
  until: number;
  every: number;
  next: number;
  run: () => void;
  at: { x: number }[];
}

let lasting: Lasting[] = [];
/** When the burning cities next throw up flames and smoke (a few times a second). */
let burnNext = 0;
const BURN_EVERY = 0.12;
/** The map the moments under way are for (a new one ends them). */
let lastingFor: object | null = null;

/** A colour as the particles take it (linear), from a hex one. */
function linear(hex: string): Rgb {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.pow(c / 255, 2.2)) as Rgb;
}

const civColour = (v: View, owner: number) => CIVS[v.players[owner]?.civ ?? '']?.color ?? '#cccccc';

/** A tile's middle just over the ground (its height is the overlay's, roughly the land's top: a little over it, so nothing starts inside), if it's on the screen (with a margin). */
function onScreen(t: number): { x: number; y: number; z: number } | null {
  const g = store.grid;
  if (!g || t < 0) return null;
  const c = centreHere(g, t);
  const y = tileY(t) + 0.8;
  const s = toScreen(c.x, y, c.z);
  if (!s || s.x < -80 || s.y < -80 || s.x > window.innerWidth + 80 || s.y > window.innerHeight + 80) return null;
  return { x: c.x, y, z: c.z };
}

/** A moment that goes on a while, from now, at a place (or places). */
function last(now: number, seconds: number, every: number, at: { x: number }[], run: () => void) {
  lasting.push({ until: now + seconds, every, next: now, run, at });
}

/** From one view to the next: the world's moments, where they're on the screen. */
export function worldMoments(client: Client, prev: View | null, v: View) {
  // (The first view after joining: nothing's new, it's just here.)
  if (!prev || prev.you !== v.you) return;
  const fx = client.fx;
  const now = client.time;
  const before = new Map(prev.cities.map((c) => [c.id, c]));
  for (const city of v.cities) {
    const was = before.get(city.id);
    const at = onScreen(city.tile);
    if (!was && at) founded(client, at, linear(civColour(v, city.owner)));
    else if (was && was.owner !== city.owner) {
      if (at) captured(client, at, civColour(v, city.owner));
      if (at || city.owner === v.you || was.owner === v.you) play('captured');
    }
  }
  // Wonders: over the city that built each (with moments on show, when the camera's gone to see it: `splash.ts`).
  if (!momentPace())
    for (const id of Object.keys(v.wonders)) {
      if (prev.wonders[id] !== undefined) continue;
      const city = v.cities.find((c) => c.wonders?.includes(id));
      if (city) celebrateWonder(client, city.tile);
    }
  // A golden age: shimmering over your cities on the screen.
  if (v.self.goldenTurns > 0 && prev.self.goldenTurns === 0)
    for (const city of v.cities) {
      const at = city.owner === v.you ? onScreen(city.tile) : null;
      if (!at) continue;
      fx.flare({ x: at.x, y: at.y + 3, z: at.z }, 3);
      fx.shockwave(at, 5, '#ffc95a');
      last(now, 2.6, 0.05, [at], () => fx.particles({ x: at.x, y: at.y + 0.5, z: at.z }, [1, 0.62, 0.18], { count: 6, speed: 0.4, size: 0.34, gravity: -1.2, life: 1.6, spread: 3.2, up: 0.8, glow: 3, collide: false }));
    }
  // Your units: promoted, and great people born.
  const units = new Map(prev.units.map((u) => [u.id, u]));
  for (const u of v.units) {
    if (u.owner !== v.you) continue;
    const was = units.get(u.id);
    if (was && (u.promotions?.length ?? 0) > (was.promotions?.length ?? 0)) {
      const at = onScreen(u.tile);
      if (at) {
        fx.particles({ x: at.x, y: at.y + 2, z: at.z }, [1, 0.8, 0.3], { count: 34, speed: 2, size: 0.18, gravity: 1.2, life: 1, spread: 0.9, up: 2.6, glow: 2.5, collide: false });
        fx.flare({ x: at.x, y: at.y + 2.6, z: at.z }, 2);
        fx.shockwave(at, 2.5, '#ffd76a');
      }
      play('promote');
    }
    if (!was && isGreatPerson(u.type)) {
      const at = onScreen(u.tile);
      if (at) {
        last(now, 1.6, 0.05, [at], () => fx.particles({ x: at.x, y: at.y + 0.5, z: at.z }, [1, 0.92, 0.7], { count: 3, speed: 0.1, size: 0.2, gravity: 0, life: 1, spread: 0.7, up: 0, velocity: { x: 0, y: 7, z: 0 }, glow: 2.5, collide: false }));
        fx.particles({ x: at.x, y: at.y + 1, z: at.z }, [1, 0.85, 0.5], { count: 30, speed: 2.2, size: 0.12, gravity: 0.5, life: 1.2, spread: 0.5, up: 0.6, glow: 2, collide: false });
      }
      play('great');
    }
  }
}

/** A city founded: dust, and its banner rising. */
function founded(client: Client, at: { x: number; y: number; z: number }, colour: Rgb) {
  const fx = client.fx;
  fx.particles({ x: at.x, y: at.y + 0.3, z: at.z }, [0.42, 0.33, 0.22], { count: 90, speed: 3.5, size: 0.5, gravity: 1.5, life: 1.4, spread: 2.5, up: 1.4, drag: 1.8, collide: false });
  fx.shockwave(at, 5, '#e8d2a0');
  last(client.time, 1.2, 0.05, [at], () => fx.particles({ x: at.x, y: at.y + 0.6, z: at.z }, colour, { count: 4, speed: 0.1, size: 0.42, gravity: 0, life: 1.1, spread: 0.3, up: 0, velocity: { x: 0, y: 5, z: 0 }, glow: 1.5, collide: false }));
}

/** A wonder completed: beams of light rising over its city, and fireworks (if it's on the screen). */
export function celebrateWonder(client: Client, tile: number) {
  const at = onScreen(tile);
  if (!at) return;
  const fx = client.fx;
  const over = { x: at.x, y: at.y + 4, z: at.z };
  fx.flare(over, 4);
  fx.fireworks(over, 5);
  last(client.time + 1.4, 0.1, 1, [over], () => fx.fireworks(over, 4));
  last(client.time, 3, 0.05, [at], () => fx.particles({ x: at.x, y: at.y + 0.5, z: at.z }, [1, 0.88, 0.55], { count: 4, speed: 0.15, size: 0.24, gravity: 0, life: 1.5, spread: 2.2, up: 0, velocity: { x: 0, y: 11, z: 0 }, glow: 2.5, collide: false }));
}

/** A city captured: smoke rising, and its new owner's colour bursting over it. */
function captured(client: Client, at: { x: number; y: number; z: number }, colour: string) {
  const fx = client.fx;
  last(client.time, 2.2, 0.06, [at], () => fx.particles({ x: at.x, y: at.y + 1, z: at.z }, [0.12, 0.12, 0.13], { count: 6, speed: 0.4, size: 0.9, gravity: -2, life: 2.2, spread: 2.2, up: 0.6, drag: 0.6, collide: false }));
  fx.particles({ x: at.x, y: at.y + 5, z: at.z }, linear(colour), { count: 40, speed: 4, size: 0.18, gravity: 2, life: 1.3, spread: 0.5, up: 1, glow: 1.2, collide: false });
  fx.shockwave({ x: at.x, y: at.y, z: at.z }, 6, colour);
}

/** A city being razed, a moment of its burning: flames among its houses, smoke over it. */
function burn(client: Client, t: number) {
  const at = onScreen(t);
  if (!at) return;
  const fx = client.fx;
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 2.6;
    const x = at.x + Math.cos(a) * r;
    const z = at.z + Math.sin(a) * r;
    fx.particles({ x, y: at.y + 0.6, z }, Math.random() < 0.5 ? [1, 0.36, 0.05] : [1, 0.62, 0.15], { count: 8, speed: 0.7, size: 0.45, gravity: -3.5, life: 0.8, spread: 0.5, up: 1.2, glow: 2.4, collide: false });
    fx.particles({ x, y: at.y + 2.4, z }, [0.06, 0.06, 0.07], { count: 3, speed: 0.3, size: 1.3, gravity: -1.6, life: 3.5, spread: 0.7, up: 0.6, drag: 0.5, collide: false });
  }
}

/** Each frame: the moments that go on a while (a new map ends them), and the cities burning. */
export function frameWorld(client: Client) {
  const now = client.time;
  if (lastingFor !== store.grid) {
    lastingFor = store.grid;
    lasting = [];
  }
  if (now >= burnNext) {
    burnNext = now + BURN_EVERY;
    for (const city of store.view?.cities ?? []) if (city.razing && store.known[city.tile]?.visible) burn(client, city.tile);
  }
  lasting = lasting.filter((l) => {
    for (const p of l.at) p.x += homeShift(p.x);
    while (l.next <= now && l.next < l.until) {
      l.run();
      l.next += l.every;
    }
    return l.next < l.until;
  });
}
