import type { Client } from '@platform/client';
import type { View } from '../protocol';
import { extent, SEA_Y } from '../geometry';
import { seasonAt, SEASON_NAMES, type Season } from '../rules/disasters';
import { SPEEDS } from '../rules/state';
import { cam, centreHere, toScreen } from './camera';
import { tileY } from './overlay';
import { store } from './store';

/**
 * The living world on this screen (`rules/disasters.ts`, `rules/climate.ts`; the land itself changes
 * on the server, `seasons.ts`): the season's looks on the blocks that turn with it, storm clouds over
 * the sea with rain and lightning under them, a thread of smoke over each volcano known, snow falling
 * in winter and leaves drifting in autumn; and, as a turn begins, what the world did at its end where
 * this player knows the land: an eruption's fire and ash, a river's flood, the sea rising over the coast.
 */

type Rgb = [number, number, number];
type At = { x: number; y: number; z: number };

/** The season of the turn on this screen (at the game's speed). */
export function seasonHere(v: View | null): Season {
  return seasonAt(v?.turn ?? 1, SPEEDS[store.lobby?.settings.speed ?? 'standard'] ?? 1);
}

/** The season each screen's world shows (`client.world.looks`). */
const looking = new WeakMap<Client, Season>();

/** The season, as the top bar says it. */
export const seasonName = (v: View | null) => SEASON_NAMES[seasonHere(v)];

/** A tile's middle over its ground, at its copy nearest the camera, if it's on the screen (with a margin). */
function onScreen(t: number, margin = 120): At | null {
  const g = store.grid;
  if (!g || t < 0) return null;
  const c = centreHere(g, t);
  const y = tileY(t);
  const s = toScreen(c.x, y, c.z);
  if (!s || s.x < -margin || s.y < -margin || s.x > window.innerWidth + margin || s.y > window.innerHeight + margin) return null;
  return { x: c.x, y, z: c.z };
}

/** Moments under way: a few particles every so often until they end. */
let lasting: { until: number; every: number; next: number; run: () => void }[] = [];
/** Particles owed by each steady effect (fractions carried from frame to frame). */
const owed = new Map<string, number>();
/** The volcanoes this player knows, worked out again when what they know changes. */
let volcanoes: number[] = [];
let volcanoesFor: object | null = null;

/** From one view to the next: a new turn's disasters, where they're on the screen. */
export function disasterMoments(client: Client, prev: View | null, v: View) {
  if (!prev || prev.you !== v.you || prev.turn === v.turn) return;
  const fx = client.fx;
  const now = client.time;
  for (const e of v.events ?? []) {
    if (e.kind === 'eruption') {
      const at = onScreen(e.tile);
      if (!at) continue;
      const crater = { x: at.x, y: SEA_Y + 9, z: at.z };
      fx.flare(crater, 6);
      fx.shockwave({ ...at, y: at.y - 2 }, 9, '#ff6a2a');
      fx.particles(crater, [1, 0.35, 0.05], { count: 90, speed: 7, size: 0.35, gravity: 9, glow: 6, life: 2.2, spread: 1.5, up: 7, collide: false });
      lasting.push({ until: now + 7, every: 0.08, next: now, run: () => {
        fx.particles(crater, [0.08, 0.075, 0.07], { count: 3, speed: 0.6, size: 1.6, gravity: -1.2, life: 6, spread: 1.2, up: 1.4, drag: 0.3, velocity: { x: 0.6, y: 0, z: -0.3 }, collide: false });
        fx.particles(crater, [1, 0.3, 0.04], { count: 2, speed: 3.5, size: 0.22, gravity: 8, glow: 6, life: 1.4, spread: 1, up: 5, collide: false });
      } });
    } else if (e.kind === 'flood' || e.kind === 'sea') {
      for (const t of e.tiles ?? [e.tile]) {
        const at = onScreen(t);
        if (!at) continue;
        fx.shockwave(at, e.kind === 'sea' ? 5 : 4, '#4aa8e8');
        lasting.push({ until: now + 3, every: 0.1, next: now + Math.random() * 0.3, run: () =>
          fx.particles({ x: at.x + (Math.random() - 0.5) * 5, y: at.y + 0.4, z: at.z + (Math.random() - 0.5) * 5 }, [0.55, 0.78, 0.95], { count: 4, speed: 1.2, size: 0.22, gravity: 7, life: 0.9, spread: 0.6, up: 2.2, collide: false }) });
      }
    }
  }
}

/** Each frame: the weather, the volcanoes' smoke and the season's snow and leaves on the screen, and the moments under way. */
export function drawWeather(client: Client, dt: number) {
  const v = store.view;
  const g = store.grid;
  if (!v || !g) return;
  const fx = client.fx;
  const now = client.time;
  // The season's looks on the world's blocks that turn with it (`shared.ts`): all at once, nothing in the world changed.
  const season = seasonHere(v);
  if (looking.get(client) !== season) {
    looking.set(client, season);
    client.world.looks?.(season);
  }
  lasting = lasting.filter((l) => {
    while (l.next <= now && l.next < l.until) {
      l.run();
      l.next += l.every;
    }
    return l.next < l.until;
  });
  // Far off, they're too small to be worth it.
  if (cam.dist > 140) return;
  /** `rate` a second of `emit` (fractions carried to the next frame). */
  const steady = (key: string, rate: number, emit: () => void) => {
    let n = (owed.get(key) ?? Math.random()) + rate * dt;
    for (; n >= 1; n--) emit();
    owed.set(key, n);
  };
  const near = (at: At, r: number, y: number): At => {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * r;
    return { x: at.x + Math.cos(a) * d, y, z: at.z + Math.sin(a) * d };
  };
  // Storms: dark cloud low over the water, rain under it, now and then a flash of lightning.
  for (const t of v.storms ?? []) {
    const at = onScreen(t);
    if (!at) continue;
    steady(`cloud${t}`, 14, () => fx.particles(near(at, 7, SEA_Y + 9 + Math.random() * 2), [0.16, 0.17, 0.2], { count: 1, speed: 0.2, size: 2.4, gravity: 0, life: 2.6, spread: 0.5, up: 0, velocity: { x: 1.4, y: 0, z: 0.4 }, collide: false }));
    steady(`rain${t}`, 60, () => fx.particles(near(at, 6, SEA_Y + 8), [0.6, 0.7, 0.85], { count: 1, speed: 0, size: 0.08, gravity: 0, life: 0.6, spread: 0, up: 0, velocity: { x: 1.5, y: -13, z: 0.5 }, collide: false }));
    if (Math.random() < dt * 0.4) fx.flare(near(at, 5, SEA_Y + 7), 4);
  }
  // Volcanoes known: a thread of smoke and a glow in the crater.
  if (volcanoesFor !== store.known) {
    volcanoesFor = store.known;
    volcanoes = store.terrain.flatMap((s, t) => (s?.volcano && store.known[t] ? [t] : []));
  }
  for (const t of volcanoes) {
    const at = onScreen(t);
    if (!at) continue;
    const crater = { x: at.x, y: SEA_Y + 8.5, z: at.z };
    steady(`smoke${t}`, 3, () => fx.particles(crater, [0.18, 0.17, 0.17], { count: 1, speed: 0.2, size: 0.9, gravity: -0.6, life: 4, spread: 0.6, up: 0.6, drag: 0.4, velocity: { x: 0.4, y: 0, z: -0.2 }, collide: false }));
    fx.particles({ ...crater, y: crater.y - 0.6 }, [1, 0.3, 0.05], { count: 1, speed: 0, size: 1.6 + Math.sin(now * 2) * 0.4, gravity: 0, glow: 2.5, life: 0.05, spread: 0, up: 0, collide: false });
  }
  // The season: snow falling round where the camera looks in winter (none over the tropics), leaves drifting off the woods in autumn.
  const middle = { x: cam.x, y: SEA_Y, z: cam.z };
  const lat = Math.abs((cam.z / extent(g).d) * 2 - 1);
  if (season === 'winter' && lat > 0.25) steady('snow', 40, () => fx.particles(near(middle, cam.dist * 0.7, SEA_Y + 14 + Math.random() * 6), [0.95, 0.97, 1], { count: 1, speed: 0.2, size: 0.14, gravity: 0.6, life: 6, spread: 0.3, up: 0, drag: 1.4, velocity: { x: 0.6, y: -1.2, z: 0.2 } }));
  if (season === 'autumn')
    steady('leaves', 80, () => {
      const t = Math.floor(Math.random() * store.terrain.length);
      if (store.known[t]?.feature !== 'forest') return;
      const at = onScreen(t, 0);
      if (at) fx.particles(near(at, 3, at.y + 4), Math.random() < 0.5 ? ([0.85, 0.32, 0.08] as Rgb) : ([0.95, 0.65, 0.12] as Rgb), { count: 1, speed: 0.3, size: 0.18, gravity: 0.5, life: 4, spread: 0.2, up: 0, drag: 1.5, velocity: { x: 0.5, y: 0, z: 0.2 } });
    });
}
