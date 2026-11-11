import type { SpeciesId } from '../species';

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
