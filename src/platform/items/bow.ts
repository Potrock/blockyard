/** The bow kit's part both sides read. */

/** Their draw (`items.bow` on their screen). */
export interface BowOwn {
  drawing: boolean;
  /** How far drawn, 0..1. */
  charge: number;
}
