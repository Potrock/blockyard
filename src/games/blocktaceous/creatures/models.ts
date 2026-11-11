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
