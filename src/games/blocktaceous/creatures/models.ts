import type { SpeciesId } from '../species';
import { BIPED_MODELS } from '../models/bipeds';

/**
 * Each species' model file, if it's been built (tools/ writes models/<id>.glb). A species without
 * one yet gets a stand-in from whoever asks.
 *
 * Every model: faces +z, feet on y = 0, a block to the unit, built to its species' `length` and
 * `height`. Nodes: `head` (it looks with it) and `saddle` (where a rider sits). Clips: `idle`,
 * `walk`, `run`, `attack`, `eat`, `sleep` (lying knocked out or asleep, looping), `roar`; flyers
 * also `fly` (flapping) and `glide`; swimmers also `swim`.
 */
const files = import.meta.glob('../models/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export function modelUrl(id: SpeciesId): string | null {
  return files[`../models/${id}.glb`] ?? null;
}

/**
 * The blocks one loop of each model's walk and run covers with its feet planted, for
 * `Models.gltf(url, { stride })`. The two-legged ones come from their build (models/bipeds.ts);
 * the rest are what `tools/quadrupeds/build.mjs --stride=natural` draws (0.65 of each animal's
 * own stride in its file, never under a person's 1.5).
 */
const STRIDES: Partial<Record<SpeciesId, number>> = {
  triceratops: 2.08,
  stegosaurus: 1.95,
  brachiosaurus: 4.55,
  ankylosaurus: 1.56,
  mammoth: 1.82,
};

export function strideOf(id: SpeciesId): number {
  return (BIPED_MODELS as Record<string, { stride: number }>)[id]?.stride ?? STRIDES[id] ?? 1.5;
}

/** How high each model's `saddle` node sits over its feet, blocks (read from the files). */
const SADDLES: Record<SpeciesId, number> = {
  ankylosaurus: 1.72,
  brachiosaurus: 6.75,
  carnotaurus: 2.86,
  compsognathus: 0.35,
  dilophosaurus: 1.78,
  dodo: 0.63,
  mammoth: 3.4,
  parasaurolophus: 3.42,
  pteranodon: 0.93,
  sarcosuchus: 1.3,
  smilodon: 1.08,
  spinosaurus: 3.2,
  stegosaurus: 2.8,
  triceratops: 2.8,
  tyrannosaurus: 3.95,
  utahraptor: 1.66,
};

/** Where a rider's figure goes (`player.drive`'s `seat`): astride, legs down the animal's sides. */
export function seatOf(id: SpeciesId): number {
  return Math.max(0, SADDLES[id] - 0.45);
}
