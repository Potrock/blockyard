import type { GameContext, Vec3 } from '@platform';
import { brains } from '../creatures/state';
import { PIECES } from './def';

/**
 * Wild animals against walls. A hunting animal whose prey is behind a structure bites at what's
 * in its way, and what gives depends on what it's made of: thatch keeps out the small things and
 * nothing else, wood stands until something big leans on it, stone and metal stand.
 *
 * This reads the creatures' minds (`creatures/state`), and changes nothing in them: an animal
 * that's hunting a survivor, with a piece between it and them, wears that piece down.
 */

/** How much biting each tier takes before a piece gives (in the animals' `damage`), and the least bite that marks it. */
const TOUGH: { strength: number; bite: number }[] = [
  { strength: 20, bite: 4 },
  { strength: 90, bite: 11 },
];
/** Seconds between one animal's bites at a wall, and how long a piece's damage lasts unbitten. */
const BITE_EVERY = 1.1;
const MENDS_AFTER = 45;
const MAX_WORN = 600;

/** Pieces being worn down: cell to the damage taken and when it was last bitten. */
const worn = new Map<string, { taken: number; at: number }>();
/** Animal (entity id) to when it may next bite a wall. */
const nextBite = new Map<number, number>();
const warned = new Map<string, number>();
let thinkT = 0;

export function resetSiege(): void {
  worn.clear();
  nextBite.clear();
  warned.clear();
  thinkT = 0;
}

/**
 * Run the siege for this step. `wreck` takes a piece down for good (it spills a box, frees the
 * cell); `warn` tells the piece's owner, if they're about.
 */
export function updateSiege(game: GameContext, dt: number, wreck: (x: number, y: number, z: number, block: string) => void, warn: (x: number, y: number, z: number, text: string) => void): void {
  thinkT += dt;
  if (thinkT < 0.3) return;
  thinkT = 0;
  const now = game.clock.total;
  const { world } = game;

  for (const b of brains.values()) {
    if (b.mode !== 'hunt' || b.tame || b.ko || !b.target || !b.e.alive) continue;
    if (!('inventory' in b.target)) continue;
    if ((nextBite.get(b.e.id) ?? 0) > now) continue;
    const from = b.e.position;
    const to = b.target.position;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const far = Math.hypot(dx, dz);
    if (far < 0.5 || far > 14) continue;
    // As far as its bite goes (it stops to strike once its prey is inside that, wall or no wall).
    const reach = Math.min(far, b.t.reach + 0.5);
    const dir = { x: dx / far, y: 0, z: dz / far };
    let cell: (Vec3 & { block: string }) | null = null;
    for (const up of [0.5, Math.min(b.s.hitbox.height * 0.6, 2.5)]) {
      const hit = world.raycast({ x: from.x, y: from.y + up, z: from.z }, dir, reach);
      if (!hit) continue;
      const block = world.blockName(hit.block);
      if (block in PIECES) {
        cell = { x: hit.x, y: hit.y, z: hit.z, block };
        break;
      }
    }
    if (!cell) continue;
    nextBite.set(b.e.id, now + BITE_EVERY);
    const tough = TOUGH[PIECES[cell.block].tier];
    const mid = { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 };
    if (!tough || b.s.damage < tough.bite) {
      // Teeth on stone (or small teeth on wood): a knock, and nothing gives.
      game.audio.play('bt_pick', { at: mid, volume: 0.5, pitch: 0.6 });
      continue;
    }
    const key = `${cell.x},${cell.y},${cell.z}`;
    let w = worn.get(key);
    if (!w || now - w.at > MENDS_AFTER) {
      if (worn.size >= MAX_WORN) for (const [k, v] of worn) if (now - v.at > MENDS_AFTER || worn.size >= MAX_WORN) worn.delete(k);
      worn.set(key, (w = { taken: 0, at: now }));
    }
    w.taken += b.s.damage;
    w.at = now;
    game.audio.play('bt_chop', { at: mid, volume: 0.9, pitch: 0.55 });
    game.fx.burst(mid, { color: PIECES[cell.block].tier === 0 ? '#c9a653' : '#8a6238', count: 10, speed: 3, size: 0.1, life: 0.6 });
    // One warning for a stretch of wall, not one a bite.
    const stretch = `${cell.x >> 4},${cell.y >> 4},${cell.z >> 4}`;
    const last = warned.get(stretch);
    if (last === undefined || now - last > 20) {
      warned.set(stretch, now);
      if (warned.size > 200) warned.clear();
      warn(cell.x, cell.y, cell.z, `A ${b.s.name} is breaking in!`);
    }
    if (w.taken >= tough.strength) {
      worn.delete(key);
      wreck(cell.x, cell.y, cell.z, cell.block);
    }
  }
  if (nextBite.size > 400) for (const [id, t] of nextBite) if (t < now) nextBite.delete(id);
}
