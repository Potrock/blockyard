import type { GameContext } from '@platform';
import { clock, flat, itemName, near, ownerOf, type Brain, type TameRecord } from './state';

/**
 * Tames that earn their keep. Told to gather, a tame works the ground round where it was left:
 * plant-eaters browse up berries, fibre and thatch (the big ones bring down wood, the armoured one
 * cracks stone), fish-eaters fish where there's water, meat-eaters hunt the small game near them
 * (what they kill goes on their back, not to the wild). What it gathers it carries, as much as an
 * animal its size can, until its owner takes it.
 */

type Find = [item: string, share: number];

const FINDS: Record<string, Find[]> = {
  dodo: [['berries', 3], ['fiber', 2]],
  compsognathus: [['fiber', 2], ['feather', 1], ['berries', 1]],
  parasaurolophus: [['berries', 4], ['fiber', 3], ['thatch', 2]],
  triceratops: [['wood', 3], ['thatch', 3], ['berries', 2]],
  stegosaurus: [['berries', 4], ['thatch', 3], ['fiber', 2]],
  ankylosaurus: [['stone', 5], ['fiber', 1]],
  brachiosaurus: [['wood', 5], ['thatch', 3]],
  mammoth: [['wood', 4], ['thatch', 2], ['fiber', 2]],
};
const FISHERS = new Set(['pteranodon', 'spinosaurus', 'sarcosuchus']);
const scratch: Brain[] = [];

/** How many things a tame can carry. */
export const haulRoom = (b: Brain): number => Math.max(12, Math.round(b.s.health * 0.6));
export const haulCount = (rec: TameRecord): number => Object.values(rec.haul ?? {}).reduce((a, n) => a + n, 0);

/** Put something on a tame's back; what doesn't fit is left. Returns how many went on. */
export function addHaul(b: Brain, item: string, n: number): number {
  const rec = b.tame!;
  const fits = Math.max(0, Math.min(n, haulRoom(b) - haulCount(rec)));
  if (fits > 0) (rec.haul ??= {})[item] = (rec.haul[item] ?? 0) + fits;
  return fits;
}

/** What a tame carries, in words. */
export function haulText(game: GameContext, rec: TameRecord): string {
  const list = Object.entries(rec.haul ?? {}).filter(([, n]) => n > 0);
  return list.length ? list.map(([item, n]) => `${n} ${itemName(game, item)}`).join(', ') : 'nothing yet';
}

function waterNear(game: GameContext, x: number, z: number): boolean {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    for (const d of [6, 14]) {
      const [wx, wz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
      const y = game.world.surfaceY(wx, wz);
      if (y >= 0 && game.world.blockName(game.world.getBlock(wx, y, wz)) === 'water') return true;
    }
  }
  return false;
}

/**
 * Once a second for a loaded tame told to gather. Returns true if its haul changed. A meat-eater
 * is given small game to hunt instead (the rules put its kills on its back).
 */
export function gatherTick(game: GameContext, b: Brain): boolean {
  const rec = b.tame!;
  if (b.ko || b.target || clock.now < b.gatherAt) return false;
  const rng = game.rng;
  b.gatherAt = clock.now + rng.range(9, 15);
  if (haulCount(rec) >= haulRoom(b)) return false;
  const p = b.e.position;
  const size = 1 + b.s.health / 80;
  let got = 0;
  const finds = FINDS[b.id];
  if (finds) {
    const total = finds.reduce((a, [, w]) => a + w, 0);
    let r = rng.range(0, total);
    const [item] = finds.find(([, w]) => (r -= w) < 0) ?? finds[0]!;
    got = addHaul(b, item, Math.max(1, Math.round(size * rng.range(0.7, 1.4))));
    b.e.animate('eat');
  } else if (FISHERS.has(b.id) && waterNear(game, p.x, p.z) && rng.chance(0.6)) {
    got = addHaul(b, 'raw_fish', Math.max(1, Math.round(size * 0.6)));
    b.e.animate('eat');
  } else if (b.s.diet === 'carnivore' || b.s.diet === 'piscivore') {
    // Small game within its range: anything wild it can take that isn't a hunter itself.
    let prey: Brain | null = null;
    let best = 34;
    for (const o of near(p, 34, scratch)) {
      if (o.tame || o.ko || o.mode === 'air' || o.s.temper === 'aggressive' || o.s.health > b.s.health * 1.3) continue;
      const d = flat(o.e.position, p);
      if (d < best) [best, prey] = [d, o];
    }
    if (prey) {
      b.target = prey.e;
      b.thinkAt = 0;
    }
  }
  if (got > 0 && haulCount(rec) >= haulRoom(b)) ownerOf(game, rec)?.hud.feed(`${rec.name} is carrying all it can`, { color: '#e8d9a8' });
  return got > 0;
}
