import type { BlockDefinition, BlockTexture } from '@platform';

/**
 * The builders' blocks: three and a half tiers of structure pieces (thatch, wood, stone and a metal
 * wall), pitched roofs and a pillar, the things a base needs (a door, a gate, a window, a fence, a ladder), and the stations
 * and furniture survivors use with E. Every texture is painted here in code, from one family of
 * palettes, so a hut of mixed tiers still reads as one building.
 *
 * The budget is 40 block variants (see `VARIANTS_USED` at the bottom, which the test checks).
 */

// ---- Painting helpers (pure: the same pixels on every screen) ----

/** A hash of a pixel and a seed, 0..1: the grain in every texture. */
function grain(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A colour made lighter (above 1) or darker (below 1). */
function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * by)));
  return `#${((c(n >> 16) << 16) | (c((n >> 8) & 255) << 8) | c(n & 255)).toString(16).padStart(6, '0')}`;
}

const paint = (fn: (x: number, y: number) => string | null): BlockTexture => ({ paint: fn });

const STRAW = '#c9a650';
const WOOD = '#8a5a2e';
const STONE = '#8d8f8c';
const METAL = '#6f7f8c';
const HIDE = '#a9794c';
const EMBER = '#ff9a2e';

/** Bundled straw: strands running down, tied by two darker bands. */
const thatchSide = paint((x, y) => {
  if (y === 4 || y === 11) return shade('#7a5a22', 0.9 + grain(x, y, 1) * 0.25);
  const strand = grain(x, (y / 5) | 0, 2);
  return shade(STRAW, 0.72 + strand * 0.42 + (grain(x, y, 3) - 0.5) * 0.1);
});
/** The cut ends of the bundles, seen from above. */
const thatchTop = paint((x, y) => shade(STRAW, 0.7 + grain(x >> 1, y, 4) * 0.45));

/** Upright planks with a rail across: a wall. */
const woodSide = paint((x, y) => {
  if (x % 4 === 3) return shade(WOOD, 0.55);
  if (y === 2 || y === 13) return shade(WOOD, 0.72 + grain(x, y, 5) * 0.1);
  return shade(WOOD, 0.88 + grain((x / 4) | 0, 0, 6) * 0.22 + (grain(x, y, 7) - 0.5) * 0.12);
});
/** Planks laid flat: a floor. */
const woodFloor = paint((x, y) => {
  if (y % 4 === 3) return shade(WOOD, 0.6);
  const board = (y / 4) | 0;
  if (x === (board * 7 + 3) % 16) return shade(WOOD, 0.62);
  return shade(WOOD, 0.95 + grain(0, board, 8) * 0.2 + (grain(x, y, 9) - 0.5) * 0.1);
});

/** Fitted stones in courses, mortar between them. */
const stoneSide = paint((x, y) => {
  const course = (y / 4) | 0;
  const sx = (x + course * 5) % 16;
  if (y % 4 === 3 || sx % 8 === 7) return shade(STONE, 0.58);
  return shade(STONE, 0.86 + grain((sx / 8) | 0, course, 10) * 0.28 + (grain(x, y, 11) - 0.5) * 0.1);
});
/** Big flagstones. */
const stoneFloor = paint((x, y) => {
  if (x === 7 || y === 8 || (y < 8 && x === 15) || (y > 8 && x === 2)) return shade(STONE, 0.6);
  const slab = (x > 7 ? 1 : 0) + (y > 8 ? 2 : 0);
  return shade(STONE, 0.92 + grain(slab, 0, 12) * 0.2 + (grain(x, y, 13) - 0.5) * 0.08);
});

/** Plates riveted at the corners. */
const metalSide = paint((x, y) => {
  if (x === 0 || y === 0 || x === 8 || y === 8) return shade(METAL, 0.62);
  const px = x % 8;
  const py = y % 8;
  if ((px === 2 || px === 6) && (py === 2 || py === 6)) return shade(METAL, 1.35);
  return shade(METAL, 0.95 + (grain(x, y, 14) - 0.5) * 0.12 + (py === 1 ? 0.12 : 0));
});

/** A plank door: boards, two cross straps and a pull ring. */
const doorFace = paint((x, y) => {
  if (y === 3 || y === 12) return shade('#4b4f55', 0.9 + grain(x, y, 15) * 0.2);
  if (x >= 11 && x <= 12 && y >= 7 && y <= 8) return '#c9b27a';
  if (x % 5 === 4) return shade(WOOD, 0.6);
  return shade(WOOD, 1.02 + grain((x / 5) | 0, 0, 16) * 0.18 + (grain(x, y, 17) - 0.5) * 0.1);
});

/** A window: a wooden frame round a lattice you can see through. */
const windowFace = paint((x, y) => {
  if (x === 0 || x === 15 || y === 0 || y === 15) return shade(WOOD, 0.78);
  if (x === 1 || x === 14 || y === 1 || y === 14) return shade(WOOD, 1.05);
  return (x + y) % 5 === 0 || (x - y + 16) % 5 === 0 ? shade(WOOD, 0.9) : null;
});

/** A ladder: two rails and four rungs, clear between. */
const ladderFace = paint((x, y) => {
  if (x === 2 || x === 3 || x === 12 || x === 13) return shade(WOOD, 0.85 + grain(x, y, 18) * 0.2);
  if (y % 4 === 1 && x > 3 && x < 12) return shade(WOOD, 1.1);
  return null;
});

/** Rough poles: fences and gates. */
const poleSide = paint((x, y) => shade(WOOD, 0.8 + grain(x, y >> 2, 19) * 0.3));
/** A squared timber, adzed along its length: pillars and stilts. */
const pillarSide = paint((x, y) => shade(WOOD, 0.7 + grain(x >> 1, 0, 54) * 0.25 + (grain(x, y, 55) - 0.5) * 0.08 - (y % 8 === 7 ? 0.2 : 0)));
/** A gate's bars are paler, with a rope tie, so it reads as the way through. */
const gateSide = paint((x, y) => (y === 6 || y === 7 ? shade('#d8c48a', 0.85 + grain(x, y, 20) * 0.2) : shade('#a9743c', 0.85 + grain(x, y >> 2, 21) * 0.3)));

/**
 * A campfire's sides, bottom to top: a ring of stones, crossed logs, and tongues of flame (clear
 * between them: the flame is two crossed sheets, so it reads as fire from every side).
 */
const campfireSide = paint((x, y) => {
  if (y >= 13) return shade(STONE, 0.7 + grain(x >> 1, y, 22) * 0.4);
  if (y >= 10) return shade('#5a3a1c', 0.8 + grain(x, y, 23) * 0.4);
  // Three tongues, the middle one tallest; each narrows to its tip.
  const tip = Math.min(1 + Math.abs(x - 8) * 1.6, 5 + Math.abs(x - 5) * 2.2, 4 + Math.abs(x - 11) * 2.4);
  if (y < tip) return null;
  const depth = y - tip;
  return depth < 1.5 ? '#e2531c' : depth < 3.5 ? EMBER : grain(x, y, 24) > 0.4 ? '#ffe27a' : '#fff3b0';
});
const campfireTop = paint((x, y) => {
  const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  if (d > 6) return shade(STONE, 0.7 + grain(x >> 1, y >> 1, 25) * 0.4);
  if (d > 3) return shade('#5a3a1c', 0.7 + grain(x, y, 26) * 0.4);
  return grain(x, y, 27) > 0.5 ? '#ffe27a' : EMBER;
});

/** A standing torch: a bound pole, pitch at the head, flame over it. */
const torchSide = paint((x, y) => {
  if (y < 4) return grain(x, y, 28) > 0.45 ? '#ffe27a' : EMBER;
  if (y < 6) return '#2c2118';
  return shade(WOOD, 0.8 + grain(x, y, 29) * 0.3);
});

/** A mortar: a hollowed stone and its pestle. */
const mortarSide = paint((x, y) => (y < 4 ? shade('#b9a88a', 0.85 + grain(x, y, 30) * 0.25) : shade(STONE, 0.7 + grain(x >> 1, y >> 1, 31) * 0.35)));
const mortarTop = paint((x, y) => {
  const d = Math.hypot(x - 7.5, y - 7.5);
  if (d < 1.6) return '#b9a88a';
  return d < 4 ? shade(STONE, 0.5) : shade(STONE, 0.8 + grain(x >> 1, y >> 1, 32) * 0.3);
});

/** A workbench: a thick top on legs, tools laid out on it. */
const benchSide = paint((x, y) => {
  if (y < 6) return shade(WOOD, 1.05 + (grain(x, y, 33) - 0.5) * 0.15 - (y === 5 ? 0.3 : 0));
  return shade(WOOD, 0.7 + grain(x >> 1, 0, 34) * 0.2);
});
const benchTop = paint((x, y) => {
  // A flint blade and a mallet, in a few pixels each.
  if (y >= 3 && y <= 4 && x >= 3 && x <= 8) return '#5d6166';
  if (x === 11 && y >= 6 && y <= 12) return shade(WOOD, 0.6);
  if (y >= 5 && y <= 7 && x >= 10 && x <= 12) return '#9a9c98';
  return shade(WOOD, 1.08 + grain(0, y >> 2, 35) * 0.15 + (grain(x, y, 36) - 0.5) * 0.1 - (y % 4 === 3 ? 0.3 : 0));
});

/** A forge: stonework round a glowing mouth. */
const forgeSide = paint((x, y) => {
  const inMouth = x >= 4 && x <= 11 && y >= 7 && y <= 13 && !(y === 7 && (x === 4 || x === 11));
  if (inMouth) return y >= 11 ? (grain(x, y, 37) > 0.5 ? '#ffd257' : EMBER) : y >= 9 ? '#c8401a' : '#3a1a12';
  const course = (y / 4) | 0;
  const sx = (x + course * 4) % 16;
  if (y % 4 === 3 || sx % 8 === 7) return shade('#6a625c', 0.6);
  return shade('#6a625c', 0.9 + grain((sx / 8) | 0, course, 38) * 0.25);
});
const forgeTop = paint((x, y) => {
  const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
  if (d > 5) return shade('#6a625c', 0.8 + grain(x >> 1, y >> 1, 39) * 0.3);
  return grain(x, y, 40) > 0.7 ? EMBER : shade('#2a2422', 0.8 + grain(x, y, 41) * 0.5);
});

/** A smithy: an anvil (the upper half) on a heavy wooden block. */
const smithySide = paint((x, y) => (y < 8 ? shade('#565d66', 0.85 + grain(x, y, 42) * 0.3 + (y === 0 ? 0.25 : 0)) : shade(WOOD, 0.75 + grain(x >> 2, 0, 43) * 0.25 - (y === 8 ? 0.25 : 0))));
const smithyTop = paint((x, y) => shade('#565d66', 1 + grain(x, y, 44) * 0.25));

/** A storage box: planks strapped with hide, a clasp on each side. */
const storageSide = paint((x, y) => {
  if (x === 3 || x === 12) return shade(HIDE, 0.8 + grain(x, y, 45) * 0.2);
  if (y === 4) return shade(WOOD, 0.5);
  if (x >= 7 && x <= 8 && y >= 4 && y <= 6) return '#c9b27a';
  return shade(WOOD, 1 + grain(0, y >> 2, 46) * 0.2 + (grain(x, y, 47) - 0.5) * 0.1 - (y % 4 === 3 ? 0.25 : 0));
});
const storageTop = paint((x, y) => (x === 3 || x === 12 ? shade(HIDE, 0.8 + grain(x, y, 48) * 0.2) : shade(WOOD, 1.05 + grain(0, y >> 2, 49) * 0.2 - (y % 4 === 3 ? 0.25 : 0))));

/** A bedroll: woven fibre under a hide cover, a straw pillow at one end. */
const bedTop = paint((x, y) => {
  if (y < 5) return x > 1 && x < 14 && y > 0 ? shade('#e3d3a4', 0.9 + grain(x, y, 50) * 0.15) : shade(STRAW, 0.8);
  return shade(HIDE, 0.85 + grain(x >> 1, y >> 1, 51) * 0.3 - ((x + y) % 7 === 0 ? 0.2 : 0));
});
const bedSide = paint((x, y) => shade(y > 13 ? STRAW : HIDE, 0.75 + grain(x, y, 52) * 0.25));

// ---- The blocks ----

type Box = [number, number, number, number, number, number];
/**
 * Four shallow steps up to the north: walked up without jumping, and close enough to a slope to
 * be a ramp underfoot or a pitched roof overhead, for half the variants stairs would cost.
 */
const SLOPE: Box[] = [
  [0, 0, 0, 16, 4, 16],
  [0, 4, 0, 16, 8, 12],
  [0, 8, 0, 16, 12, 8],
  [0, 12, 0, 16, 16, 4],
];

export const blocks: Record<string, BlockDefinition> = {
  // Thatch: quick shelter. Soft to mine and soft to everything else.
  bt_thatch_wall: { label: 'Thatch Wall', texture: { side: thatchSide, top: thatchTop, bottom: thatchTop }, hardness: 0.6 },
  bt_thatch_slab: { label: 'Thatch Slab', texture: { side: thatchSide, top: thatchSide, bottom: thatchTop }, shape: 'slab', full: 'bt_thatch_wall', hardness: 0.5 },
  bt_thatch_roof: { label: 'Thatch Roof', texture: { side: thatchSide, top: thatchSide, bottom: thatchTop }, boxes: SLOPE, facing: true, hardness: 0.5 },

  // Wood: a proper house.
  bt_wood_wall: { label: 'Wooden Wall', texture: { side: woodSide, top: woodFloor, bottom: woodFloor }, hardness: 1.2 },
  bt_wood_floor: { label: 'Wooden Floor', texture: woodFloor, hardness: 1.2 },
  bt_wood_slab: { label: 'Wooden Slab', texture: woodFloor, shape: 'slab', full: 'bt_wood_floor', hardness: 1 },
  // A ramp underfoot, a pitched roof overhead.
  bt_wood_ramp: { label: 'Wooden Ramp', texture: woodFloor, boxes: SLOPE, facing: true, hardness: 1.2 },
  bt_pillar: { label: 'Pillar', texture: { side: pillarSide, top: woodFloor, bottom: woodFloor }, shape: 'post', hardness: 1.2 },

  // Stone: what a big animal can't push over.
  bt_stone_wall: { label: 'Stone Wall', texture: { side: stoneSide, top: stoneFloor, bottom: stoneFloor }, hardness: 2.2 },
  // (Two stone slabs make a stone wall, whose top is the same flagstones: a stone floor. Slabs are stone's steps, too.)
  bt_stone_slab: { label: 'Stone Slab', texture: stoneFloor, shape: 'slab', full: 'bt_stone_wall', hardness: 2 },

  // Metal: the last word.
  bt_metal_wall: { label: 'Metal Wall', texture: metalSide, hardness: 3.5 },

  // Ways in, out and up. A door is one thin leaf at the edge of its cell: opening it turns it a
  // quarter (the same four variants are both its states).
  bt_wood_door: { label: 'Wooden Door', texture: { front: doorFace, back: doorFace, all: woodSide }, boxes: [[0, 0, 13, 16, 16, 16]], facing: true, hardness: 1.2 },
  bt_gate: { label: 'Gate', texture: gateSide, shape: 'fence', transparency: 'cutout', hardness: 1 },
  bt_gate_open: { label: 'Gate (open)', texture: gateSide, boxes: [[6, 0, 6, 10, 16, 10]], solid: false, picker: false, hardness: 1 },
  bt_window: { label: 'Lattice Window', texture: windowFace, shape: 'pane', transparency: 'cutout', hardness: 0.8 },
  bt_fence: { label: 'Fence', texture: poleSide, shape: 'fence', hardness: 1 },
  bt_ladder: { label: 'Ladder', texture: ladderFace, boxes: [[0, 0, 14, 16, 16, 16]], facing: true, climbable: true, transparency: 'cutout', hardness: 0.6 },

  // Stations and furniture: aim and press E.
  bt_campfire: {
    label: 'Campfire',
    texture: { side: campfireSide, top: campfireTop, bottom: thatchTop },
    boxes: [
      [1, 0, 1, 15, 3, 15],
      [3, 3, 6, 13, 6, 10],
      [6, 3, 3, 10, 6, 13],
      [7, 6, 3, 9, 15, 13],
      [3, 6, 7, 13, 15, 9],
    ],
    transparency: 'cutout',
    light: 13,
    glow: 0.7,
    hardness: 0.8,
  },
  bt_torch: {
    label: 'Standing Torch',
    texture: { side: torchSide, top: paint((x, y) => (grain(x, y, 53) > 0.5 ? '#ffe27a' : EMBER)), bottom: poleSide },
    boxes: [
      [7, 0, 7, 9, 11, 9],
      [6, 10, 6, 10, 16, 10],
    ],
    solid: false,
    light: 14,
    glow: 0.8,
    hardness: 0.3,
  },
  bt_mortar: {
    label: 'Mortar',
    texture: { side: mortarSide, top: mortarTop, bottom: mortarTop },
    boxes: [
      [3, 0, 3, 13, 2, 13],
      [2, 2, 2, 14, 9, 14],
      [7, 9, 7, 9, 14, 9],
    ],
    hardness: 1,
  },
  bt_workbench: {
    label: 'Workbench',
    texture: { side: benchSide, top: benchTop, bottom: woodFloor },
    boxes: [
      [0, 10, 0, 16, 16, 16],
      [1, 0, 1, 4, 10, 4],
      [12, 0, 1, 15, 10, 4],
      [1, 0, 12, 4, 10, 15],
      [12, 0, 12, 15, 10, 15],
      [2, 3, 2, 14, 5, 14],
    ],
    hardness: 1.2,
  },
  bt_forge: { label: 'Forge', texture: { side: forgeSide, top: forgeTop, bottom: stoneFloor }, light: 11, glow: 0.45, hardness: 2.2 },
  bt_smithy: {
    label: 'Smithy',
    texture: { side: smithySide, top: smithyTop, bottom: woodFloor },
    boxes: [
      [1, 0, 1, 15, 8, 15],
      [5, 8, 5, 11, 11, 11],
      [2, 11, 4, 14, 16, 12],
    ],
    hardness: 2.2,
  },
  bt_storage: { label: 'Storage Box', texture: { side: storageSide, top: storageTop, bottom: woodFloor }, boxes: [[1, 0, 1, 15, 14, 15]], hardness: 1.2 },
  bt_bed: {
    label: 'Bedroll',
    texture: { side: bedSide, top: bedTop, bottom: thatchTop },
    boxes: [
      [0, 0, 0, 16, 3, 16],
      [2, 3, 1, 14, 5, 5],
    ],
    hardness: 0.6,
  },
};

// ---- What each block is, for the rules and for other parts ----

/** A structure's tier: 0 thatch, 1 wood, 2 stone, 3 metal. */
export type Tier = 0 | 1 | 2 | 3;

export interface Piece {
  tier: Tier;
  /** The station it opens with E (`openStation`'s name), or what else E does on it. */
  use?: 'campfire' | 'mortar' | 'workbench' | 'forge' | 'smithy' | 'storage' | 'bed' | 'door' | 'gate';
  /** How it's turned when placed: a ramp climbs away from its builder, a door stands across their way. */
  turn?: 'away';
}

/** Every structure block (the open gate too, which no item places), by block name. */
export const PIECES: Record<string, Piece> = {
  bt_thatch_wall: { tier: 0 },
  bt_thatch_slab: { tier: 0 },
  bt_thatch_roof: { tier: 0, turn: 'away' },
  bt_wood_wall: { tier: 1 },
  bt_wood_floor: { tier: 1 },
  bt_wood_slab: { tier: 1 },
  bt_wood_ramp: { tier: 1, turn: 'away' },
  bt_pillar: { tier: 1 },
  bt_stone_wall: { tier: 2 },
  bt_stone_slab: { tier: 2 },
  bt_metal_wall: { tier: 3 },
  bt_wood_door: { tier: 1, use: 'door' },
  bt_gate: { tier: 1, use: 'gate' },
  bt_gate_open: { tier: 1, use: 'gate' },
  bt_window: { tier: 1 },
  bt_fence: { tier: 1 },
  bt_ladder: { tier: 1 },
  bt_campfire: { tier: 0, use: 'campfire' },
  bt_torch: { tier: 0 },
  bt_mortar: { tier: 2, use: 'mortar' },
  bt_workbench: { tier: 1, use: 'workbench' },
  bt_forge: { tier: 2, use: 'forge' },
  bt_smithy: { tier: 3, use: 'smithy' },
  bt_storage: { tier: 1, use: 'storage' },
  bt_bed: { tier: 0, use: 'bed' },
};

/** The items that place a structure, each named for its block (the open gate is a state, not an item). */
export const BUILD_ITEMS: string[] = Object.keys(PIECES).filter((name) => name !== 'bt_gate_open');

/** The item a structure block gives back and is crafted as (an open gate is a gate). */
export function itemOf(block: string): string | null {
  if (block === 'bt_gate_open') return 'bt_gate';
  return block in PIECES ? block : null;
}

/**
 * A structure block's tier, for whatever wants to damage it: 0 thatch (any wild creature can tear
 * it), 1 wood (big ones), 2 stone, 3 metal (nothing wild); null for a block that isn't a structure.
 * Takes a block's family name (`world.blockName(id)`); a name with a state (`bt_wood_door[facing=east]`) works too.
 */
export function structureTier(blockName: string): Tier | null {
  const cut = blockName.indexOf('[');
  return PIECES[cut < 0 ? blockName : blockName.slice(0, cut)]?.tier ?? null;
}

/** How many of the 40 block variants the definitions above use (a slab 2, a facing block 4). */
export const VARIANTS_USED = Object.values(blocks).reduce((n, b) => n + (b.shape === 'slab' ? 2 : b.shape === 'stairs' ? 8 : b.facing === true ? 4 : 1), 0);
