import type { BlockDefinition } from '@platform';

/**
 * Call of Blocky's own blocks, for Big Kahuna Burger's Hawaiian kitsch: thatch (and its slabs and
 * stairs, for roofs), bamboo (walls, and poles lying any way), carved tiki heads, chain-link, and
 * the drive-thru's menu board. Painted in code; every screen and the server know them (shared.ts).
 */

const STRAW = ['#caa14c', '#b78c3c', '#d9b560', '#a67c30', '#c09545'];
/** Straw laid in overlapping courses, the strands running down and a little across. */
const thatch = { paint: (x: number, y: number) => STRAW[(x * 3 + ((y >> 2) & 1) * 2 + ((x * 7 + y) % 3 === 0 ? 1 : 0)) % STRAW.length] };

const CANE = ['#7c6a2a', '#a8923e', '#c8b25a', '#d6c26c', '#c8b25a', '#a8923e', '#7c6a2a'];
/** Bamboo canes side by side, a knot every eight pixels. */
const bambooSide = {
  paint: (x: number, y: number) => {
    const knot = y % 8 === 0;
    const across = x % 4;
    if (knot) return across === 0 ? '#5d4f1c' : '#8f7b33';
    return CANE[across === 0 ? 0 : across === 1 ? 2 : across === 2 ? 3 : 5];
  },
};
const bambooEnd = { paint: (x: number, y: number) => ((x % 4 === 0 || y % 4 === 0) ? '#6e5e24' : (x + y) % 4 < 2 ? '#d6c26c' : '#c1ab55') };

const WOOD = { color: ['#6e4222', '#7a4a24', '#86542b', '#734524'], noise: 0.35, scale: 2 };

/** A carved tiki face: heavy brows, round eyes, a big grin of teeth. */
const TIKI_FACE = {
  pixels: [
    'BBBBBBBBBBBBBBBB',
    'BddddddddddddddB',
    'BdBBBBBddBBBBBdB',
    'BdBYYYBddBYYYBdB',
    'BdBYKYBddBYKYBdB',
    'BdBYYYBddBYYYBdB',
    'BdBBBBBddBBBBBdB',
    'BddddddBBddddddB',
    'BdddddBddBdddddB',
    'BddddBBddBBddddB',
    'BdBBBBBBBBBBBBdB',
    'BdBWKWKWKWKWKBdB',
    'BdBKWKWKWKWKWBdB',
    'BdBBBBBBBBBBBBdB',
    'BddddddddddddddB',
    'BBBBBBBBBBBBBBBB',
  ],
  palette: { B: '#3b2412', d: '#7a4a24', Y: '#f2c418', K: '#111111', W: '#f4efe2' },
};

/** The drive-thru menu: a black board, BIG KAHUNA across the top, burgers and prices. */
const MENU = {
  pixels: [
    'iiiiiiiiiiiiiiii',
    'iYYYYYYYYYYYYYYi',
    'iYRRRYRRYRRRRRYi',
    'iYYYYYYYYYYYYYYi',
    'ikkkkkkkkkkkkkki',
    'ikOOkwwwwwwkggki',
    'ikBBkkkkkkkkkkki',
    'ikOOkwwwwkkkggki',
    'ikkkkkkkkkkkkkki',
    'ikOOkwwwwwkkggki',
    'ikBBkkkkkkkkkkki',
    'ikOOkwwwkkkkggki',
    'ikkkkkkkkkkkkkki',
    'ikpkwwwwwwwwkkki',
    'ikkkkkkkkkkkkkki',
    'iiiiiiiiiiiiiiii',
  ],
  palette: { i: '#9aa0a6', Y: '#ffcc00', R: '#e63946', k: '#141414', O: '#f08a24', B: '#6b3a1f', w: '#f4efe2', g: '#7bd389', p: '#ff5c8a' },
};

export const BLOCKS: Record<string, BlockDefinition> = {
  thatch: { texture: thatch, hardness: 0.6 },
  thatch_slab: { label: 'Thatch Slab', texture: thatch, shape: 'slab', full: 'thatch', hardness: 0.6 },
  thatch_stairs: { label: 'Thatch Stairs', texture: thatch, shape: 'stairs', hardness: 0.6 },
  bamboo: { texture: { top: bambooEnd, bottom: bambooEnd, side: bambooSide }, hardness: 1 },
  bamboo_pole: { texture: { top: bambooEnd, bottom: bambooEnd, side: bambooSide }, shape: 'post', facing: 'axis', hardness: 1 },
  tiki: { texture: { front: TIKI_FACE, all: WOOD }, facing: true, hardness: 1.5 },
  chain_link: { texture: { paint: (x: number, y: number) => ((x + y) % 5 === 0 || (x - y + 20) % 5 === 0 ? '#a3a9b0' : null) }, shape: 'pane', transparency: 'cutout', hardness: 1 },
  menu_board: { texture: { front: MENU, all: { color: '#2b2b2e', noise: 0.1 } }, boxes: [[0, 0, 7, 16, 16, 9]], facing: true, hardness: 1 },
};
