import { colOf, roundCube, rowOf, fromCube, type Grid } from './rules/hex';

/**
 * Where the hex map lies in the voxel world, for the server (which builds it out of blocks) and each
 * screen (which draws over it and picks tiles from the mouse). Pointy-topped hexes, every other row
 * half a hex to the right; a hex is `HEX` blocks from its middle to a corner.
 *
 * A world that wraps round east to west (`hex.ts`) is built once, from x 0 to its period (a whole
 * number of chunks), and each screen draws it again and again either side: its tiles are spaced a
 * hair wider or narrower than `HEX_W` (by under 1.5%) so that a row of them makes the period. What a
 * screen draws at a tile it draws at the copy nearest its camera (`nearX`).
 */

export const HEX = 3.5;
export const HEX_W = Math.sqrt(3) * HEX;
export const HEX_ROW = 1.5 * HEX;
/** The sea's surface: the ground slab's water. Land stands a block above it, hills and mountains higher. */
export const SEA_Y = 60;
/**
 * Where a tile's units stand, from its middle (blocks): one alone in the middle, two side by side
 * (`client/models3d.ts`). Kept clear: nothing an improvement builds stands up there, and a river's
 * channel keeps off them (`improvements.ts`, `terrain.ts`).
 */
export const UNIT_SPOTS: readonly [number, number][] = [[0, 0], [-1.3, 0.6], [1.3, -0.6]];
/** The map's corner in the world. */
export const ORIGIN = { x: 4, z: 4 };
/** A world that wraps begins at x 0 (it has no west edge to keep a margin from). */
const WRAP_ORIGIN = { x: 0, z: ORIGIN.z };

/** How far the world repeats across on a grid that wraps (blocks: a whole number of chunks); 0 on a flat one. */
export const period = (g: Grid) => (g.wrap ? 16 * Math.round((g.width * HEX_W) / 16) : 0);

/** The tiles' spacing across (blocks): `HEX_W`, or on a world that wraps its period over its width. */
export const hexW = (g: Grid) => (g.wrap ? period(g) / g.width : HEX_W);

/** The copy of an x (blocks) round a world that wraps nearest another (`near`); on a flat one, the same x. */
export function nearX(g: Grid, x: number, near: number): number {
  if (!g.wrap) return x;
  const p = period(g);
  return x + p * Math.round((near - x) / p);
}

/** An x (blocks) brought into the world as it's built, [0, period), on a world that wraps; on a flat one, the same x. */
export function baseX(g: Grid, x: number): number {
  if (!g.wrap) return x;
  const p = period(g);
  return x - p * Math.floor(x / p);
}

/** The middle of a tile, in blocks. */
export function centre(g: Grid, t: number): { x: number; z: number } {
  const col = colOf(g, t);
  const row = rowOf(g, t);
  if (g.wrap) {
    const w = hexW(g);
    return { x: WRAP_ORIGIN.x + w * (col + 0.5 * (row & 1)) + w / 2, z: WRAP_ORIGIN.z + HEX_ROW * row + HEX };
  }
  return { x: ORIGIN.x + HEX_W * (col + 0.5 * (row & 1)) + HEX_W / 2, z: ORIGIN.z + HEX_ROW * row + HEX };
}

/** The middle of a tile at its copy nearest x = `near` (a world that wraps; on a flat one, `centre`). */
export function centreNear(g: Grid, t: number, near: number): { x: number; z: number } {
  const c = centre(g, t);
  c.x = nearX(g, c.x, near);
  return c;
}

/** The tile under a point (blocks), or -1: on a world that wraps, at any copy of it. */
export function tileAt(g: Grid, x: number, z: number): number {
  // (A world that wraps is drawn a hair wider or narrower across: the point's brought back to HEX_W's spacing.)
  const px = g.wrap ? (x - WRAP_ORIGIN.x - hexW(g) / 2) * (HEX_W / hexW(g)) : x - ORIGIN.x - HEX_W / 2;
  const pz = z - ORIGIN.z - HEX;
  const q = ((Math.sqrt(3) / 3) * px - (1 / 3) * pz) / HEX;
  const r = ((2 / 3) * pz) / HEX;
  const [rq, rr] = roundCube(q, r, -q - r);
  return fromCube(g, rq, rr);
}

/** The world's size in blocks for a grid (one that wraps: its period across). */
export const extent = (g: Grid) => ({ w: g.wrap ? period(g) : ORIGIN.x * 2 + HEX_W * (g.width + 0.5), d: ORIGIN.z * 2 + HEX_ROW * g.height + HEX });

/** The six corners of a tile (blocks), clockwise from the top (as wide as the tiles are spaced). */
export function corners(g: Grid, t: number): { x: number; z: number }[] {
  const c = centre(g, t);
  const sx = g.wrap ? hexW(g) / HEX_W : 1;
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return { x: c.x + HEX * Math.cos(a) * sx, z: c.z + HEX * Math.sin(a) };
  });
}
