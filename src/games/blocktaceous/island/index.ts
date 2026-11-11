import type { BiomeId } from '../species';

/**
 * The island, as the rest of the game asks about it. Pure functions of the map (no game context),
 * so the server's rules, the shared definition and every screen get the same answers.
 *
 * PLACEHOLDER: the island part replaces these bodies (and adds to them); the signatures stay.
 */

/** The biome at a column. */
export function biomeAt(_x: number, _z: number): BiomeId {
  return 'grassland';
}

/** The ground's height at a column, as the map has it (the world's own `surfaceY` is exact). */
export function groundAt(_x: number, _z: number): number {
  return 64;
}

/** A named region of the island for the HUD ("The Sunken Marsh"), or null out at sea. */
export function regionAt(_x: number, _z: number): string | null {
  return null;
}

/** Where new survivors wash up: beaches round the island's gentler shores. */
export const SPAWNS: { x: number; z: number; name: string }[] = [{ x: 0, z: 0, name: 'First Landing' }];
