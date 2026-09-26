/** The melee kit's part both sides read. */

/** How ready their swing is (`items.melee` on their screen). */
export interface MeleeOwn {
  /** Readiness 0..1 (Minecraft's attack strength): 1 swings at full strength. */
  strength: number;
}
