/**
 * The Earth map's land (node src/games/blockilization/tools/earth.mjs path/to/land-50m.json): Natural
 * Earth's land at 1:50m (public domain; the `world-atlas` package's TopoJSON of it), drawn as a grid of
 * two-degree cells from 82°N to 58°S, each the share of its area that's land in tenths (a digit, 0 to 9;
 * one point in each of 25 across a cell is looked at), written to `../rules/earthmask.ts` for
 * `mapgen.ts` to sample at any map size.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'rules', 'earthmask.ts');
const CELL = 2;
const NORTH = 82;
const SOUTH = -58;
const COLS = 360 / CELL;
const ROWS = (NORTH - SOUTH) / CELL;

const topo = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const [sx, sy] = topo.transform.scale;
const [tx, ty] = topo.transform.translate;
// TopoJSON's arcs: quantized, each point a step from the last.
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => [(x += dx) * sx + tx, (y += dy) * sy + ty]);
});
// A ring that crosses the date line is unwrapped (its longitudes carried on past 180° rather than
// jumping back to -180°), so it doesn't span the world; points are looked for a turn either side.
const ring = (ids) => {
  const pts = ids.flatMap((i) => (i < 0 ? [...arcs[~i]].reverse() : arcs[i]).slice(1));
  for (let k = 1; k < pts.length; k++) {
    const d = pts[k][0] - pts[k - 1][0];
    if (Math.abs(d) > 180) pts[k] = [pts[k][0] - Math.sign(d) * 360 * Math.round(Math.abs(d) / 360), pts[k][1]];
  }
  return pts;
};
const polygons = [];
for (const g of topo.objects.land.geometries) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
  for (const p of polys) polygons.push(p.map(ring));
}
// Each polygon's bounds, to skip most of them at once.
const bounds = polygons.map((rings) => {
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
});

/** Whether a point is in a ring (crossings of a ray east). */
function inRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Whether a point is on land: in a polygon's outer ring and none of its holes. */
const land = (x, y) => [0, 360, -360].some((turn) => landAt(x + turn, y));
function landAt(x, y) {
  for (let p = 0; p < polygons.length; p++) {
    const [x0, y0, x1, y1] = bounds[p];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const [outer, ...holes] = polygons[p];
    if (inRing(outer, x, y) && !holes.some((h) => inRing(h, x, y))) return true;
  }
  return false;
}

const rows = [];
for (let r = 0; r < ROWS; r++) {
  let line = '';
  for (let c = 0; c < COLS; c++) {
    let n = 0;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) if (land(-180 + (c + (i + 0.5) / 5) * CELL, NORTH - (r + (j + 0.5) / 5) * CELL)) n++;
    line += String(Math.min(9, Math.round((n / 25) * 10)));
  }
  rows.push(line);
}

writeFileSync(
  OUT,
  `/**
 * The Earth's land for the Earth map (\`mapgen.ts\`), made by \`tools/earth.mjs\` from Natural Earth's
 * 1:50m land (public domain): ${COLS} cells of ${CELL}° across from 180°W, ${ROWS} down from ${NORTH}°N to ${-SOUTH}°S, each
 * the share of it that's land in tenths (0 to 9).
 */
export const EARTH = { cell: ${CELL}, north: ${NORTH}, south: ${SOUTH}, cols: ${COLS}, rows: ${ROWS} };
export const EARTH_LAND: string[] = [
${rows.map((r) => `  '${r}',`).join('\n')}
];
`,
);
console.log(`${OUT}: ${COLS}x${ROWS}`);
