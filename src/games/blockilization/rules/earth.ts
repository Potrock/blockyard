import { EARTH, EARTH_LAND } from './earthmask';
import { colOf, rowOf, tileAt, type Grid } from './hex';

/**
 * The Earth map's world as it is: its land (`earthmask.ts`, sampled for any size of map), its great
 * mountain ranges, deserts, rainforests and rivers (lines and boxes of longitude and latitude, drawn
 * onto the map), and where each civilization and city-state really began, for the true starting
 * places. The map runs from 82°N to 58°S (no Antarctica, as on Civ V's Earth), its seam in the
 * Pacific at the date line.
 */

/** A point: longitude (east +) and latitude (north +), in degrees. */
type LonLat = [number, number];
/** A box: west, south, east, north. */
type Box = [number, number, number, number];

/** A tile's middle in longitude and latitude (odd rows half a tile east, as the hexes are). */
export function lonLatOf(g: Grid, t: number): LonLat {
  const row = rowOf(g, t);
  const col = colOf(g, t) + (row & 1) * 0.5;
  return [-180 + ((col + 0.5) / g.width) * 360, EARTH.north - ((row + 0.5) / g.height) * (EARTH.north - EARTH.south)];
}

/** The tile a point is on (-1 off the map, north or south). */
export function tileOfLonLat(g: Grid, [lon, lat]: LonLat): number {
  const row = Math.floor(((EARTH.north - lat) / (EARTH.north - EARTH.south)) * g.height);
  const col = Math.floor(((lon + 180) / 360) * g.width - (row & 1) * 0.5);
  return tileAt(g, g.wrap ? col : Math.max(0, Math.min(g.width - 1, col)), row);
}

/** The share of a point's two-degree cell that's land (0 to 0.9). */
function landShareAt(lon: number, lat: number): number {
  const row = Math.floor((EARTH.north - lat) / EARTH.cell);
  if (row < 0 || row >= EARTH.rows) return 0;
  const col = (((Math.floor((lon + 180) / EARTH.cell) % EARTH.cols) + EARTH.cols) % EARTH.cols);
  return Number(EARTH_LAND[row][col]) / 10;
}

/** How much of each tile is land: the mask looked at in 5 by 5 points across the tile. */
export function earthLand(g: Grid): number[] {
  const dLon = 360 / g.width;
  const dLat = (EARTH.north - EARTH.south) / g.height;
  return Array.from({ length: g.width * g.height }, (_, t) => {
    const [lon, lat] = lonLatOf(g, t);
    let sum = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) sum += landShareAt(lon + ((i - 2) / 5) * dLon, lat + ((j - 2) / 5) * dLat);
    return sum / 25;
  });
}

/** The tiles a line runs over (each segment looked at every half degree). */
function tilesAlong(g: Grid, line: LonLat[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2));
    for (let s = 0; s <= steps; s++) {
      const t = tileOfLonLat(g, [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
      if (t >= 0 && out[out.length - 1] !== t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

const inBox = ([lon, lat]: LonLat, boxes: Box[]) => boxes.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);

/** The great ranges, each along its crest. */
const RANGES: LonLat[][] = [
  [[-150, 62], [-135, 59], [-125, 52], [-116, 47], [-111, 42], [-107, 38], [-106, 33]], // the Rockies
  [[-106, 28], [-104, 23], [-99, 18], [-94, 16]], // the Sierra Madre
  [[-78, 8], [-77, 2], [-79, -3], [-76, -12], [-70, -18], [-68, -24], [-70, -33], [-71, -40], [-72, -48], [-72, -53]], // the Andes
  [[-84, 34], [-80, 37], [-77, 40], [-74, 42]], // the Appalachians
  [[6, 44], [8, 46], [11, 47], [14, 47]], // the Alps
  [[-1, 43], [2, 42.5]], // the Pyrenees
  [[19, 49], [24, 48], [26, 46], [23, 45]], // the Carpathians
  [[6, 60], [9, 62], [14, 65], [18, 68]], // the Scandinavian mountains
  [[-8, 31], [-3, 33], [3, 35], [8, 36]], // the Atlas
  [[32, 37], [36, 38], [40, 39]], // the Taurus
  [[40, 43.5], [45, 42.5], [48, 41]], // the Caucasus
  [[45, 36], [48, 33], [52, 30], [56, 28]], // the Zagros
  [[60, 68], [60, 62], [58, 56], [58, 52]], // the Urals
  [[66, 35], [70, 36], [74, 38]], // the Hindu Kush and the Pamirs
  [[72, 36], [76, 34], [80, 30], [85, 28], [90, 28], [95, 29]], // the Himalaya
  [[70, 42], [78, 42], [86, 43]], // the Tian Shan
  [[86, 49], [92, 48]], // the Altai
  [[136, 35], [138, 36.5]], // the Japanese Alps
  [[38, 12], [39, 8], [37, 3], [36, -3], [34, -9]], // the Ethiopian Highlands and the Rift
  [[29, -29], [30, -27], [31, -24]], // the Drakensberg
  [[146, -16], [148, -23], [151, -29], [149, -35], [147, -37]], // the Great Dividing Range
  [[170, -44], [172, -42]], // the Southern Alps
];

/** Where it's dry: the great deserts. */
const DESERTS: Box[] = [
  [-16, 16, 32, 30], // the Sahara
  [36, 14, 58, 31], // Arabia
  [52, 27, 62, 35], // the Iranian deserts
  [55, 37, 63, 43], // the Karakum
  [69, 24, 74, 29], // the Thar
  [78, 37, 90, 41], // the Taklamakan
  [95, 40, 112, 45], // the Gobi
  [42, 2, 51, 11], // the Horn of Africa
  [13, -28, 24, -18], // the Kalahari and the Namib
  [118, -31, 140, -19], // the Australian outback
  [-71, -27, -69, -17], // the Atacama
  [-117, 27, -109, 36], // the Sonoran and the Mojave
];

/** Where it's wettest: the rainforests. */
const RAINFORESTS: Box[] = [
  [-75, -12, -48, 4], // the Amazon
  [-92, 7, -77, 18], // Central America
  [-12, 4, 8, 9], // West Africa's coast
  [10, -6, 30, 5], // the Congo
  [88, 20, 95, 27], // Bengal
  [95, -8, 125, 15], // South-East Asia
  [131, -9, 150, -1], // New Guinea
];

/** The great rivers, from their springs to the sea. */
const RIVERS: LonLat[][] = [
  [[32, 1], [31, 5], [32, 10], [33, 15], [31, 18], [33, 22], [32, 26], [31, 30], [31, 31]], // the Nile
  [[39, 38], [40, 36], [43, 33], [46, 31], [48, 30]], // the Euphrates
  [[80, 32], [75, 34], [72, 31], [70, 27], [68, 24]], // the Indus
  [[79, 31], [80, 26], [85, 25], [88, 24], [90, 22]], // the Ganges
  [[91, 34], [98, 30], [104, 29], [110, 30], [114, 30], [118, 31], [121, 31]], // the Yangtze
  [[96, 35], [103, 36], [106, 39], [110, 40], [111, 36], [114, 35], [118, 37]], // the Yellow River
  [[98, 30], [100, 22], [102, 18], [105, 15], [106, 10]], // the Mekong
  [[-95, 47], [-92, 44], [-91, 40], [-90, 35], [-91, 31], [-89, 29]], // the Mississippi
  [[-79, 44], [-75, 45], [-71, 47], [-68, 49]], // the St. Lawrence
  [[-77, -5], [-70, -4], [-62, -3], [-56, -2], [-50, 0]], // the Amazon
  [[-50, -20], [-55, -27], [-59, -33]], // the Paraná
  [[9, 48], [16, 48], [19, 47], [21, 45], [25, 44], [29, 45]], // the Danube
  [[9, 47], [8, 49], [7, 51], [5, 52]], // the Rhine
  [[33, 57], [38, 57], [44, 56], [49, 55], [47, 50], [48, 46]], // the Volga
  [[86, 52], [82, 56], [76, 61], [68, 64], [66, 67]], // the Ob
  [[27, -8], [25, 0], [20, 2], [16, -2], [12, -6]], // the Congo
  [[-10, 10], [-4, 16], [0, 16], [4, 12], [6, 6]], // the Niger
  [[23, -12], [25, -17], [30, -16], [35, -18]], // the Zambezi
];

/** Each tile's rise from the ranges: their crests, and a little the land beside them. */
export function earthRidges(g: Grid, neighbours: (t: number) => number[]): number[] {
  const out = new Array<number>(g.width * g.height).fill(0);
  for (const range of RANGES)
    for (const t of tilesAlong(g, range)) {
      out[t] = 0.6;
      for (const n of neighbours(t)) out[n] = Math.max(out[n], 0.25);
    }
  return out;
}

/** Whether a tile is in one of the great deserts, or the rainforests. */
export const earthDry = (g: Grid, t: number) => inBox(lonLatOf(g, t), DESERTS);
export const earthWet = (g: Grid, t: number) => inBox(lonLatOf(g, t), RAINFORESTS);

/** The tiles each great river runs over, in its course. */
export const earthRivers = (g: Grid): number[][] => RIVERS.map((r) => tilesAlong(g, r));

/** How far a tile is from the equator, 0 there and 1 at 85° (the map's climate runs on it). */
export const earthLatitude = (g: Grid, t: number) => Math.min(1, Math.abs(lonLatOf(g, t)[1]) / 85);

/** Where each civilization and city-state began (its first city, or its heart), for the true starting places. */
export const TRUE_STARTS: Record<string, LonLat> = {
  egypt: [32.6, 25.7],
  babylon: [44.4, 32.5],
  china: [116.4, 39.9],
  india: [77.2, 28.6],
  persia: [52.9, 29.9],
  korea: [127, 37.5],
  arabia: [39.8, 21.4],
  germany: [13.4, 52.5],
  iroquois: [-76.1, 43],
  aztec: [-99.1, 19.4],
  russia: [37.6, 55.7],
  france: [2.3, 48.9],
  rome: [12.5, 41.9],
  greece: [23.7, 37.9],
  japan: [139.7, 35.7],
  england: [-0.1, 51.5],
  mongolia: [106.9, 47.9],
  ottomans: [29, 41],
  zulu: [31.5, -28.5],
  inca: [-72, -13.5],
  cs_venice: [12.3, 45.4],
  cs_lisbon: [-9.1, 38.7],
  cs_kyoto: [135.8, 35],
  cs_florence: [11.3, 43.8],
  cs_sparta: [22.4, 37.1],
  cs_almaty: [76.9, 43.2],
  cs_zanzibar: [39.2, -6.2],
  cs_samarkand: [67, 39.6],
  cs_jerusalem: [35.2, 31.8],
  cs_lhasa: [91.1, 29.6],
  cs_geneva: [6.1, 46.2],
  cs_hanoi: [105.8, 21],
};
