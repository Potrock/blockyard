import type { Client } from '@platform/client';
import { centreNear } from '../geometry';
import { centreHere, toScreen } from './camera';
import { iconBitmap } from './icons';
import { tileY } from './overlay';
import { combatSpeed } from './pace';
import { mapFont } from './pixel';
import { store } from './store';

/**
 * How a fight lands, on this screen. When the blow lands (a lunge at its furthest, a volley come
 * down), the defender flinches back from it in a flash; the damage done rises over each side in big
 * pixel figures (the defender's red, the attacker's orange); the HP bars drain to what's left, the
 * part lost fading out white; a city hit sheds stones from its walls; and a kill is plainly one: a
 * burst and a ring of dust, the fallen toppling, the view jolted. Each well under a second, a third
 * of it with quick combat; with combat off, only the figures and the bars (drained at once).
 */

/** Seconds at normal combat speed: a defender's flinch, the figures on show, a bar's drain, a kill's jolt. */
const FLINCH = 0.35;
const FIGURES = 1.1;
const DRAIN = 0.6;
const JOLT = 0.3;
/** How far a defender flinches back (blocks), and how far the view jolts at a kill. */
const FLINCH_BACK = 0.6;
const JOLT_SIZE = 0.35;

type Vec3 = { x: number; y: number; z: number };
type Fight = (typeof store.fights)[number];

/** A length of time at the combat speed chosen (the figures stay long enough to read). */
const paced = (seconds: number) => seconds / Math.max(1, combatSpeed());
/** Whether fights are drawn at all (quick combat not off). */
export const fightsDrawn = () => combatSpeed() > 0;

// -------------------------------------------------------------------------------------------------
// The blow landing (`models3d.ts` calls this as each blow lands)

/** When the view last jolted at a kill. */
let jolted = -Infinity;

/**
 * A blow landed: the fight's figures start, and (fights drawn) a flash and sparks where it lands, a
 * city's stones falling, and for a kill a burst, a ring of dust and the view jolted.
 */
export function landed(client: Client, fight: Fight | undefined, at: Vec3, city: boolean) {
  if (fight && fight.lands === undefined) fight.lands = client.time;
  if (!fightsDrawn()) return;
  const fx = client.fx;
  fx.flare({ x: at.x, y: at.y + 0.6, z: at.z }, 1.1);
  fx.particles({ x: at.x, y: at.y + 0.5, z: at.z }, [1, 0.92, 0.65], { count: 10, speed: 3, size: 0.1, gravity: 6, life: 0.35, spread: 0.3, up: 1.4, glow: 2, collide: false });
  if (city) {
    // Stones off its walls, and their dust.
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.5 + Math.random() * 1.5;
      fx.particles({ x: at.x + Math.cos(a) * r, y: at.y + 2.2, z: at.z + Math.sin(a) * r }, [0.5, 0.48, 0.44], { count: 4, speed: 1.6, size: 0.28, gravity: 14, life: 0.8, spread: 0.4, up: 1, collide: true });
    }
    fx.particles({ x: at.x, y: at.y, z: at.z }, [0.62, 0.56, 0.46], { count: 14, speed: 1.2, size: 0.45, gravity: -0.4, life: 0.9, spread: 2, up: 0.3, drag: 1.5, collide: false });
  }
  if (fight?.killed) {
    fx.flare({ x: at.x, y: at.y + 1, z: at.z }, 2.2);
    fx.shockwave({ x: at.x, y: at.y - 0.6, z: at.z }, 3.5, '#d8c8a4');
    fx.particles({ x: at.x, y: at.y, z: at.z }, [0.55, 0.48, 0.38], { count: 26, speed: 2.6, size: 0.4, gravity: 2, life: 0.8, spread: 1, up: 0.8, drag: 1.4, collide: false });
    jolted = client.time;
  }
}

/** How far the view is jolted now (blocks, along the ground), after a kill. */
export function jolt(now: number): { x: number; z: number } {
  const k = (now - jolted) / paced(JOLT);
  if (k < 0 || k >= 1 || !fightsDrawn()) return { x: 0, z: 0 };
  const size = JOLT_SIZE * (1 - k) * (1 - k);
  return { x: Math.sin(k * 47) * size, z: Math.cos(k * 39) * size * 0.6 };
}

/** A defender's flinch back from a blow (blocks along the way the blow came; 0 when it's over), since it landed `since` seconds ago. */
export function flinch(since: number): number {
  const k = since / paced(FLINCH);
  if (k < 0 || k >= 1 || !fightsDrawn()) return 0;
  return FLINCH_BACK * Math.sin(Math.min(1, k * 2.5) * Math.PI * 0.5) * (1 - k);
}

// -------------------------------------------------------------------------------------------------
// The bars draining

/** Each bar as drawn (by its unit's id, a city's as -1 - id): the HP it shows, what it had, and when the drain from that began (Infinity: its blow's yet to land; -Infinity: no drain). */
const bars = new Map<number, { hp: number; from: number; at: number }>();
/** What `bar` gives back (the same each call: read at once). */
const drawn = { hp: 0, ghost: 0 };

/** When a fight that a unit (or city) is in lands: now if it's in none of the last two seconds, Infinity while its blow is in the air. */
function landingFor(tile: number, attacker: number, now: number): number {
  const fight = store.fights.filter((f) => (f.at === tile || f.attacker === attacker) && now - f.t < 2).pop();
  if (!fight) return now;
  return fight.lands ?? Infinity;
}

/**
 * A bar as drawn now: its fill (HP left), and the part lost still draining away (from the fill to
 * `ghost`). A loss waits for its blow to land, then drains; a gain shows at once. (The overlay asks
 * for every unit's, each frame: a bar with nothing draining is a lookup, and nothing's made.)
 */
export function bar(key: number, hp: number, tile: number, attacker: number, now: number): { hp: number; ghost: number } {
  let b = bars.get(key);
  if (!b) {
    b = { hp, from: hp, at: -Infinity };
    bars.set(key, b);
  }
  if (hp !== b.hp) {
    b.from = hp < b.hp ? b.hp : hp;
    b.hp = hp;
    b.at = hp < b.from ? landingFor(tile, attacker, now) : -Infinity;
  }
  drawn.hp = drawn.ghost = hp;
  if (b.at === -Infinity) return drawn;
  if (b.at === Infinity) b.at = landingFor(tile, attacker, now);
  if (now < b.at) {
    drawn.hp = drawn.ghost = b.from;
    return drawn;
  }
  const k = fightsDrawn() ? Math.min(1, (now - b.at) / paced(DRAIN)) : 1;
  if (k >= 1) b.at = -Infinity;
  drawn.ghost = b.from + (b.hp - b.from) * k;
  return drawn;
}

// -------------------------------------------------------------------------------------------------
// The figures

/** Fights whose figures are still on show (the overlay keeps `store.fights` while they are). */
export const figuresShowing = (f: Fight, now: number) => f.lands === undefined ? now - f.t < 3 : now - f.lands < FIGURES;

/**
 * The damage done, over each side, from when the blow lands: popping up big, rising, fading. The
 * defender's in red (a kill bigger, with a skull), the attacker's in orange.
 */
export function drawFigures(ctx: CanvasRenderingContext2D, now: number, size: number) {
  const g = store.grid;
  if (!g) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of store.fights) {
    if (f.lands === undefined || now < f.lands) continue;
    const k = (now - f.lands) / FIGURES;
    if (k >= 1) continue;
    const rise = 1 - (1 - k) * (1 - k);
    const pop = k < 0.12 ? 1.5 - (k / 0.12) * 0.5 : 1;
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    const c = centreHere(g, f.at);
    const s = toScreen(c.x, tileY(f.at) + 3 + rise * 2.2, c.z);
    if (s) figure(ctx, `-${f.dealt}`, s.x, s.y, size * (f.killed ? 1.35 : 1) * pop, f.killed ? '#ff3b2e' : '#ff5a4a', !!f.killed);
    // The attacker's own loss, over where it struck from (under the defender's, if they'd meet on the screen).
    const from = f.from;
    if (f.taken > 0 && from !== undefined && from !== f.at) {
      const a = centreNear(g, from, c.x);
      const p = toScreen(a.x, tileY(from) + 3 + rise * 1.8, a.z);
      if (p && s && Math.abs(p.x - s.x) < size * 3 && Math.abs(p.y - s.y) < size * 1.4) p.y = s.y + size * 1.5;
      if (p) figure(ctx, `-${f.taken}`, p.x, p.y, size * 0.8 * pop, '#ffb36b', false);
    }
  }
  ctx.globalAlpha = 1;
}

/** A figure in the map's pixel type: a hard shadow, a thick dark edge, its colour; a skull before it for a kill. */
function figure(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, colour: string, kill: boolean) {
  ctx.font = mapFont(size);
  const w = ctx.measureText(text).width;
  const skull = kill ? iconBitmap('skull', Math.round(size * 1.1), '#ffffff', Math.min(2, devicePixelRatio)) : null;
  const left = skull ? x + (size * 0.6) : x;
  if (skull) ctx.drawImage(skull, left - w / 2 - size * 1.25, y - size * 0.55, size * 1.1, size * 1.1);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.22);
  ctx.strokeStyle = '#07090c';
  ctx.fillStyle = '#07090c';
  ctx.fillText(text, left + 2, y + 2);
  ctx.strokeText(text, left, y);
  ctx.fillStyle = colour;
  ctx.fillText(text, left, y);
}
