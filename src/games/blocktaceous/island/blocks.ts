import type { BlockDefinition } from '@platform';

/**
 * The island's own blocks: the rocks that hold its resources, its plants, the wood of its trees
 * and the ground of its stranger places. The generator scatters them zone by zone (`zones.ts`);
 * the building part turns breaking them into resources, by name.
 */

/** A small hash for speckling textures: 0..1, the same every time. */
function speck(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 974711) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const pick = (colors: string[], t: number) => colors[Math.min(colors.length - 1, Math.floor(t * colors.length))];

/** Rock with flecks of something in it: the flecks gather in a few veins across the face. */
function veined(rock: string[], vein: string[], seed: number, share: number) {
  return {
    paint: (x: number, y: number) => {
      // Veins: diagonal bands whose phase the seed sets, broken up by the speckle.
      const band = Math.abs(((x * 3 + y * 5 + seed * 7) % 16) - 8) / 8;
      const lump = speck(x >> 1, y >> 1, seed);
      if (band < share && lump > 0.35) return pick(vein, speck(x, y, seed + 1));
      return pick(rock, speck(x, y, seed + 2));
    },
  };
}

/** Bark: streaks running up the trunk. */
function bark(colors: string[], seed: number) {
  return { paint: (x: number, y: number) => pick(colors, speck(x, y >> 2, seed) * 0.7 + speck(x, y, seed + 1) * 0.3) };
}

/** A trunk's cut end: rings round the middle. */
function rings(colors: string[], rim: string) {
  return {
    paint: (x: number, y: number) => {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      return r > 7 ? rim : colors[Math.floor(r) % colors.length];
    },
  };
}

/** Layered rock: level bands, a little ragged. */
function layered(colors: string[], seed: number) {
  return { paint: (x: number, y: number) => pick(colors, (((y + (speck(x >> 2, 0, seed) > 0.6 ? 1 : 0)) >> 1) % colors.length) / colors.length + speck(x, y, seed) * 0.12) };
}

const BERRY_BUSH = [
  '................',
  '................',
  '................',
  '.....gg...gg....',
  '....gGGg.gGGg...',
  '...gGGrGgGGGGg..',
  '..gGGGGGGGrGGg..',
  '..gGrGGGGGGGGGg.',
  '.gGGGGGrGGGGrGg.',
  '.gGGGGGGGGGGGGg.',
  '.gGrGGGGGrGGGGg.',
  '..gGGGGGGGGGrg..',
  '..gGGGrGGGGGGg..',
  '...gGGGGGgGGg...',
  '....gg.bb.gg....',
  '.......bb.......',
];

const FIBER_PLANT = [
  '................',
  '....t.....t.....',
  '...tT....tT..t..',
  '...tT.t..tT.tT..',
  '....s.T...s.tT..',
  '....s.s...s..s..',
  '..t.s.s...s..s..',
  '.tT.s.s.t.s..s..',
  '.tT.s.s.T.s..s..',
  '..s.s.s.s.s..s..',
  '..s.s.s.s.s.s...',
  '..s.sss.s.s.s...',
  '...ss.s.sss.s...',
  '...ss.sss.sss...',
  '....sssssssss...',
  '.....sssssss....',
];

const REED = [
  '.....b..........',
  '.....b....b.....',
  '.....b....b.....',
  '.....b....b..b..',
  '..b..s....b..b..',
  '..b..s....s..b..',
  '..b..s.l..s..s..',
  '..s..s.l..s..s..',
  '..s..sl...s.ls..',
  '..s..sl...s.ls..',
  '..s.ls....sl.s..',
  '..s.ls....sl.s..',
  '..sl.s...ls..s..',
  '..sl.s...ls..s..',
  '..s..s...s...s..',
  '..s..s...s...s..',
];

export const blocks: Record<string, BlockDefinition> = {
  // Resources. The building part reads these names.
  metal_rock: { label: 'Metal Rock', texture: veined(['#7d7f84', '#6f7176', '#8a8c90', '#75777b'], ['#c98a4a', '#e0a35c', '#a8693a', '#d9b98a'], 3, 0.32), hardness: 2.4 },
  crystal_rock: { label: 'Crystal Rock', texture: veined(['#9aa6b2', '#8a97a5', '#a9b4be'], ['#7fe9ff', '#c9f6ff', '#4fc8ee', '#ffffff'], 11, 0.36), hardness: 2.8, light: 4, glow: 0.3 },
  obsidian_rock: { label: 'Obsidian', texture: veined(['#17131f', '#1e1929', '#120f18', '#231d30'], ['#4a3f6a', '#6b5c96', '#2f2745'], 5, 0.2), hardness: 3.6 },
  berry_bush: { label: 'Berry Bush', shape: 'cross', texture: { pixels: BERRY_BUSH, palette: { g: '#2f6b2a', G: '#3f8a35', r: '#c22a4e', b: '#5a4026' } } },
  fiber_plant: { label: 'Fiber Plant', shape: 'cross', texture: { pixels: FIBER_PLANT, palette: { s: '#7f9a48', t: '#d8cf9a', T: '#efe6b8' } } },
  reed: { label: 'Reeds', shape: 'cross', texture: { pixels: REED, palette: { s: '#6e8f45', l: '#89a85a', b: '#6b4a2c' } } },
  // The wood of the island's own trees.
  redwood_log: { label: 'Redwood Log', texture: { side: bark(['#7a3f2a', '#8a4a30', '#6a3524', '#93543a', '#5e2f20'], 21), top: rings(['#b5774f', '#a66a44'], '#7a3f2a'), bottom: rings(['#b5774f', '#a66a44'], '#7a3f2a') }, hardness: 2 },
  palm_log: { label: 'Palm Log', texture: { side: layered(['#a48a5c', '#8f774d', '#b39a6a', '#7f6943'], 31), top: rings(['#c7ae7c', '#b89e6c'], '#8f774d'), bottom: rings(['#c7ae7c', '#b89e6c'], '#8f774d') }, hardness: 1.6 },
  // The ground of the marsh, the mesas and the volcano.
  mud: { label: 'Mud', texture: { color: ['#4a3b2a', '#55432f', '#3f3324', '#4f4030'], scale: 3 }, hardness: 0.6 },
  red_sand: { label: 'Red Sand', texture: { color: ['#c2682f', '#cc7436', '#b85f2a', '#c96f33'], scale: 2 }, hardness: 0.5 },
  mesa_red: { label: 'Red Rock', texture: layered(['#a8482a', '#b85530', '#9c4024', '#b04d2c'], 41), hardness: 1.8 },
  mesa_tan: { label: 'Pale Rock', texture: layered(['#d9b98a', '#cfa977', '#e3c79a', '#c79f6c'], 43), hardness: 1.8 },
  basalt: { label: 'Basalt', texture: { side: bark(['#3a383b', '#444246', '#302e31', '#4b494d'], 51), top: { color: ['#3a383b', '#444246', '#302e31'], scale: 3 }, bottom: { color: ['#3a383b', '#444246', '#302e31'], scale: 3 } }, hardness: 2.2 },
  ash: { label: 'Ash', texture: { color: ['#6b6966', '#77746f', '#5e5c5a', '#807d78'], scale: 2 }, hardness: 0.5 },
};
