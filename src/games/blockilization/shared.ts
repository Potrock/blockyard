import { defineShared } from '@platform';
import { SEA_Y } from './geometry';
import meta from './meta';

/**
 * What the server and every screen agree on: a world of open sea (the map's land is built on it each
 * game, `server.ts`), blocks of the game's own for each terrain's colour and for the land's
 * improvements and roads (`improvements.ts`), no walking body (players look down on their empire,
 * `client/board.ts`), and the HUD's look.
 */

const mottled = (color: string[], scale = 3) => ({ color, noise: 0.18, scale });
const sides = (top: string[], side: string[] = ['#6e5434', '#77593a', '#684f30']) => ({ top: mottled(top), side: mottled(side), bottom: mottled(side) });
/** A pixel's own small random number (for painted textures). */
function speck(x: number, y: number, k = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(k + 1, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Ploughed earth: furrows across, dark and light. */
const furrows = (x: number, y: number) => (y % 4 < 2 ? (speck(x, y) < 0.3 ? '#4f3620' : '#5e4126') : speck(x, y) < 0.3 ? '#83603b' : '#7a5634');
/** Ripe wheat: stalks with ears at the top (crossed planes). */
const wheat = (x: number, y: number) => {
  const stalk = (x + (y >> 3)) % 3 !== 2 && y > 1;
  if (!stalk) return null;
  if (y < 6) return speck(x, y) < 0.5 ? '#e8c45a' : '#d4a83e';
  return speck(x, y) < 0.4 ? '#b8a248' : '#a8963e';
};
/** A railway seen from above: two iron rails on wooden sleepers in grey ballast, along x (else z). */
const rails = (alongX: boolean) => (x: number, y: number) => {
  const [across, along] = alongX ? [y, x] : [x, y];
  if (across === 4 || across === 11) return '#9aa1a8';
  if (across === 5 || across === 12) return '#5d6268';
  if (along % 4 < 2 && across > 1 && across < 15) return along % 4 ? '#5e4128' : '#6b4a2c';
  return speck(x, y) < 0.5 ? '#7d7a74' : '#6f6c66';
};
/** Desert sand in ripples the wind has left: pale crests and shadowed troughs running across it. */
const ripples = (x: number, y: number) => {
  const v = (x + y * 2 + Math.floor(speck(x >> 2, y >> 2, 14) * 3)) % 7;
  return v === 0 ? '#cfb27a' : v === 1 ? '#f6e6ba' : speck(x, y) < 0.5 ? '#ead6a0' : '#e2cb92';
};
/** Tundra: grey-green moss and lichen, rimed with frost. */
const rime = (x: number, y: number) => {
  const s = speck(x, y, 15);
  return s < 0.12 ? '#e4eaee' : s < 0.32 ? '#6c775c' : s < 0.66 ? '#838a70' : '#787e66';
};
/** A plant's colour from its root (the texture's bottom row) to its tips (its top), by height, a little mottled. */
const stem = (colors: string[]) => (x: number, y: number) => colors[Math.max(0, Math.min(colors.length - 1, Math.floor(((15 - y) / 16) * colors.length + (speck(x, y, 11) - 0.5) * 0.6)))];
/** Blades of grass: a thin box up from the ground at each of a few places in the block, each so tall (sixteenths). */
const blades = (spots: [number, number, number][]): [number, number, number, number, number, number][] => spots.map(([x, z, h]) => [x, 0, z, x + 1, h, z + 1]);
/** Reeds: tall stems, the tallest with a dark brown head. */
const reeds = (x: number, y: number) => (y <= 2 ? '#5a3a22' : stem(['#3a5a2a', '#4a6e30', '#5e8238', '#6e9040'])(x, y));
/** A fern: fronds out from a low crown, their ends drooping to the ground. */
const FERN: [number, number, number, number, number, number][] = [
  [7, 0, 7, 9, 4, 9],
  [1, 3, 7, 15, 4, 9],
  [7, 3, 1, 9, 4, 15],
  [0, 0, 7, 1, 3, 9],
  [15, 0, 7, 16, 3, 9],
];
/** A bush in rows: leaves, with fruit (or bolls) of a colour here and there. */
const bush = (fruit: string) => (x: number, y: number) => (speck(x, y, 3) < 0.18 ? fruit : speck(x, y) < 0.5 ? '#3f7a2e' : '#346a26');
/** A bush: rounded, its top narrower. */
const BUSH: [number, number, number, number, number, number][] = [
  [2, 0, 2, 14, 7, 14],
  [4, 7, 4, 12, 11, 12],
  [1, 2, 4, 15, 6, 12],
  [4, 2, 1, 12, 6, 15],
];
/** Mist or cloud: a veil of pixels, every other one clear (`thick`: three in four there). */
const veil = (thick: boolean) => (x: number, y: number) => ((thick ? (x + 2 * y) % 4 !== 0 : (x + y) % 2 === 0) ? (speck(x, y, 9) < 0.5 ? '#f6f9fb' : '#e4ecf2') : null);
/** Falling water: streaks down it, white and pale blue. */
const falls = (x: number) => (x % 3 === 0 ? '#ffffff' : speck(x, 0, 4) < 0.5 ? '#bfe8ff' : '#8ad0f4');
/** Red rock in the wind's bands. */
const redrock = (x: number, y: number) => (y % 6 < 2 ? '#c4502a' : y % 6 < 4 ? '#e0703a' : speck(x, y) < 0.5 ? '#d8603a' : '#ea8a4a');
/** A basalt column's side: dark, with a darker seam at its edges. */
const basalt = (x: number, y: number) => (x === 0 || x === 15 ? '#18171c' : speck(x, y) < 0.5 ? '#36353c' : '#3e3d45');
/** Stone that was wood: grey-brown, the grain running up it. */
const petrified = (x: number, y: number) => (x % 4 === 0 ? '#7a6656' : speck(x, y >> 2) < 0.5 ? '#a8927c' : '#9a8470');

export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    // The sea, as far as anyone sees: a water slab over a dark floor.
    ground: { y: SEA_Y, top: 'water', fill: 'civ_ocean_floor', depth: 4 },
    // (Far enough that zoomed out the haze only touches the top of the view: the fog beyond fades into it there.)
    viewDistance: 16,
    spawn: { x: 130, y: SEA_Y + 70, z: 120 },
    time: 0.47,
    freezeTime: true,
  },
  blocks: {
    // Each terrain its own colour, far enough apart to tell them under the veil over land out of
    // sight (darker, cooler and paler: fog.ts): grassland green, plains gold, desert pale sand in
    // ripples, tundra grey-green with frost, snow white; and their plants (terrain.ts).
    civ_grass: { texture: sides(['#4c9a30', '#56a438', '#468e2c']), label: 'Grassland' },
    civ_plains: { texture: sides(['#c4aa4e', '#ba9e46', '#ccb458']), label: 'Plains' },
    civ_desert: { texture: { top: { paint: ripples }, side: mottled(['#e8d49a', '#e0cc90', '#d8c286']), bottom: mottled(['#e0cc90']) }, label: 'Desert' },
    civ_tundra: { texture: { top: { paint: rime }, side: mottled(['#6e5434', '#77593a', '#684f30']), bottom: mottled(['#6e5434']) }, label: 'Tundra' },
    civ_snow: { texture: mottled(['#f4f8fa', '#e8eef2', '#ffffff']), label: 'Snow' },
    civ_floodplain: { texture: sides(['#9ab84a', '#a4c04e', '#90ae44']), label: 'Flood Plains' },
    civ_marsh: { texture: sides(['#52683c', '#4a5f36', '#5a7042']), label: 'Marsh' },
    civ_bank: { texture: sides(['#a89c78', '#9c8f6c', '#b2a682'], ['#5c4630', '#664e36', '#52402a']), label: 'River Bank' },
    // (Boxes, not crossed pictures: drawn with the land, not in a pass of their own.)
    civ_tuft: { texture: { paint: stem(['#2f6e22', '#3f8a2c', '#56a83a', '#74c24c']) }, boxes: blades([[4, 5, 9], [11, 3, 8], [9, 11, 11], [3, 12, 7], [12, 9, 6]]), solid: false, label: 'Grass' },
    civ_drygrass: { texture: { paint: stem(['#a08e4c', '#bca85e', '#d4c27a', '#e8d898']) }, boxes: blades([[3, 4, 8], [11, 5, 7], [6, 11, 9], [12, 12, 6]]), solid: false, label: 'Dry Grass' },
    civ_reeds: { texture: { paint: reeds }, boxes: blades([[3, 4, 14], [6, 2, 16], [11, 4, 15], [12, 9, 12], [4, 11, 15], [9, 12, 16]]), solid: false, label: 'Reeds' },
    civ_fern: { texture: { paint: stem(['#2e7a28', '#3a8a2e', '#4a9e36', '#6ac04a']) }, boxes: FERN, solid: false, label: 'Ferns' },
    civ_dirt: { texture: mottled(['#6e5434', '#77593a', '#684f30']), label: 'Earth' },
    civ_rock: { texture: mottled(['#7e7e80', '#8a8a8c', '#727274']), label: 'Rock' },
    civ_coast_floor: { texture: mottled(['#d8c890', '#e0d098', '#ccbc84']), label: 'Sandbank' },
    civ_ocean_floor: { texture: mottled(['#1e3a5a', '#22405f', '#1a3452']), label: 'Sea Floor' },
    civ_leaves: { texture: mottled(['#2a6a2c', '#317434', '#245e28']), label: 'Forest' },
    civ_jungle: { texture: mottled(['#2e9a32', '#38a83a', '#26882c', '#56bc48'], 2), label: 'Jungle' },
    civ_pine: { texture: mottled(['#2a4a3a', '#30523f', '#244234']), label: 'Pines' },
    civ_trunk: { texture: mottled(['#5a4028', '#644830', '#523a24']), label: 'Trunk' },
    // The land's improvements and roads (`improvements.ts`).
    civ_farmland: { texture: { top: { paint: furrows }, side: mottled(['#6e5434', '#77593a', '#684f30']), bottom: mottled(['#6e5434', '#77593a', '#684f30']) }, label: 'Farmland' },
    civ_wheat: { texture: { paint: wheat }, shape: 'cross', label: 'Wheat' },
    civ_road: { texture: { top: mottled(['#8b7354', '#7e6749', '#958060', '#6f5a40', '#9a9488'], 2), side: mottled(['#6e5434', '#77593a', '#684f30']), bottom: mottled(['#6e5434', '#77593a', '#684f30']) }, label: 'Road' },
    civ_rail_x: { texture: { top: { paint: rails(true) }, side: mottled(['#7d7a74', '#6f6c66', '#86837c'], 2), bottom: mottled(['#6e5434', '#77593a']) }, label: 'Railroad' },
    civ_rail_z: { texture: { top: { paint: rails(false) }, side: mottled(['#7d7a74', '#6f6c66', '#86837c'], 2), bottom: mottled(['#6e5434', '#77593a']) }, label: 'Railroad' },
    civ_ash: { texture: { top: mottled(['#2f2b28', '#3a3530', '#24201d', '#4a3a2a'], 2), side: mottled(['#6e5434', '#77593a', '#684f30']), bottom: mottled(['#6e5434', '#77593a', '#684f30']) }, label: 'Ashes' },
    civ_fence: { texture: 'oak_planks', shape: 'fence', label: 'Fence' },
    civ_bush: { texture: { paint: bush('#d8642a') }, boxes: BUSH, solid: false, label: 'Plantation' },
    civ_cotton: { texture: { paint: bush('#f6f4ee') }, boxes: BUSH, solid: false, label: 'Cotton' },
    civ_embers: { texture: mottled(['#ff8a2a', '#e8541a', '#ffb43a', '#8a2a14'], 2), boxes: [[3, 0, 3, 13, 3, 13]], solid: false, light: 10, glow: 0.9, label: 'Campfire' },
    civ_girder: { texture: mottled(['#3a3c40', '#46494e', '#2e3034']), shape: 'post', label: 'Derrick' },
    // The natural wonders' landmarks (`landmarks.ts`).
    civ_pale: { texture: mottled(['#ece4d0', '#e2d8c2', '#f4eedc']), label: 'Pale Stone' },
    civ_pale_band: { texture: mottled(['#c8bca4', '#bfb39a', '#d0c4ac']), label: 'Pale Stone' },
    civ_mist: { texture: { paint: veil(false) }, transparency: 'cutout', solid: false, label: 'Mist' },
    civ_cloud: { texture: { paint: veil(true) }, transparency: 'cutout', solid: false, label: 'Cloud' },
    civ_moss: { texture: mottled(['#2fae5f', '#36b868', '#28a056']), label: 'Moss' },
    civ_falls: { texture: { paint: falls }, solid: false, glow: 0.25, label: 'Waterfall' },
    civ_reef: { texture: mottled(['#4fd8c8', '#5ae0d0', '#46ccbc']), label: 'Reef' },
    civ_coral: { texture: mottled(['#ff6f8a', '#ff8a5a', '#e8507a', '#ffb05a'], 2), label: 'Coral' },
    civ_coral_bright: { texture: mottled(['#ffd23a', '#ff9ac8', '#b88aff', '#ffb05a'], 2), label: 'Coral' },
    civ_basalt: { texture: mottled(['#1c1b21', '#24232a', '#18171c']), label: 'Basalt' },
    civ_basalt_top: { texture: { top: mottled(['#666870', '#70727a']), side: { paint: basalt }, bottom: mottled(['#2c2b30']) }, label: 'Basalt' },
    civ_basalt_pale: { texture: { top: mottled(['#84868e', '#8e9098']), side: { paint: basalt }, bottom: mottled(['#2c2b30']) }, label: 'Basalt' },
    civ_basalt_column: { texture: { paint: basalt }, label: 'Basalt' },
    civ_magma: { texture: mottled(['#ff5a10', '#ff8a2a', '#d8301a'], 2), light: 9, glow: 0.55, label: 'Magma' },
    civ_ashrock: { texture: mottled(['#5a5654', '#64605c', '#4e4a48']), label: 'Ash' },
    civ_scorch: { texture: mottled(['#3a2e28', '#2e2420', '#46382e']), label: 'Scorched Rock' },
    civ_star: { texture: mottled(['#bff4ff', '#7ad8ff', '#e8fcff'], 2), light: 11, glow: 0.9, label: 'Star-metal' },
    civ_spring: { texture: mottled(['#6ef0e0', '#8af8ec', '#5ae0d4']), light: 10, glow: 0.7, label: 'Spring' },
    civ_path: { texture: mottled(['#9a9086', '#8a8076', '#a69c90']), label: "Pilgrims' Path" },
    civ_halo: { texture: mottled(['#ffe08a', '#fff0b8', '#ffd060']), light: 15, glow: 1, label: 'Summit Light' },
    civ_gold: { texture: mottled(['#ffc531', '#ffd860', '#e8a820']), light: 6, glow: 0.5, label: 'Gold' },
    civ_petrified: { texture: { top: mottled(['#b8a088', '#8a7462']), side: { paint: petrified }, bottom: mottled(['#8a7462']) }, label: 'Petrified Wood' },
    civ_crystal: { texture: mottled(['#9a5af0', '#aa70ff', '#8448e0']), light: 9, glow: 0.35, label: 'Crystal' },
    civ_crystal_pale: { texture: mottled(['#c8a8ff', '#b890ff', '#d8c0ff']), light: 9, glow: 0.3, label: 'Crystal' },
    civ_redrock: { texture: { paint: redrock }, label: 'Red Rock' },
    civ_redsand: { texture: mottled(['#d88a52', '#e09a5e', '#cc7c48']), label: 'Red Sand' },
    civ_bark: { texture: mottled(['#6a5a48', '#5a4a3a', '#7a6852']), label: 'Ancient Bark' },
    civ_goldleaf: { texture: mottled(['#e0a830', '#f0c040', '#c88a20', '#d8b838'], 2), label: 'Golden Leaves' },
    civ_palm: { texture: mottled(['#4aa83a', '#56b444', '#3e9a30']), label: 'Palm' },
  },
  player: { controller: 'none', health: false },
  hud: {
    health: 'bar',
    theme: {
      // Pixel type (client/pixel.ts): Jersey 10 for names, numbers and buttons, Tiny5 for short text, Chakra Petch to read at length.
      display: "'Jersey 10', 'Tiny5', monospace",
      text: "'Tiny5', 'Jersey 10', monospace",
      fonts: ['Jersey 10:400', 'Tiny5:400', 'Chakra Petch:400;600'],
      colors: { accent: '#f2c14e', ink: '#0d131b', paper: '#161f2b', text: '#eef2f4', danger: '#e8543a', good: '#6ad06a' },
      // The board (a modal widget that frees the mouse) lies over everything without dimming it or catching clicks
      // (`!important`: the platform's own `#ui .screen` rule outranks a plain one).
      css: '.widget-screen { background: none; pointer-events: none !important; backdrop-filter: none; } .gw-board { pointer-events: none !important; }',
    },
  },
});
