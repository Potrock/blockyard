import { neighbours, within, type Grid } from './hex';

/**
 * Where a path keeps away from in a war: the reach of an enemy city's fire, and the tiles beside
 * enemy soldiers. Shared by the rules' paths (`movement.ts`) and the screen's preview of them
 * (`client/path.ts`), each from what the mover's owner knows: the enemy cities it has seen, the
 * enemy soldiers in sight.
 */
export interface Danger {
  /** Tiles an enemy city can fire on (two out: `cityFire`). */
  fire: Set<number>;
  /** Tiles beside an enemy soldier (its zone of control, and its reach). */
  beside: Set<number>;
}

/** The danger round enemy cities and soldiers, from their tiles. */
export function dangerZones(grid: Grid, cities: number[], soldiers: number[]): Danger {
  const fire = new Set<number>();
  for (const c of cities) for (const t of within(grid, c, 2)) fire.add(t);
  const beside = new Set<number>();
  for (const s of soldiers) for (const t of neighbours(grid, s)) beside.add(t);
  return { fire, beside };
}

/**
 * What stepping onto a tile costs a path on top of its moves for the danger there: three turns'
 * moves embarked under a city's fire (a boat there rarely lives, so a way round by land is taken
 * whenever there is one), a move under its fire on land, a move beside enemy soldiers.
 */
export function dangerCost(d: Danger, t: number, moves: number, embarked: boolean): number {
  let extra = 0;
  if (d.fire.has(t)) extra += embarked ? moves * 3 : 1;
  if (d.beside.has(t)) extra += 1;
  return extra;
}
