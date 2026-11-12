import type { MapZone } from '@platform';
import type { BiomeId } from '../species';
import { Z } from './map';

/** Each zone of the map as the rest of the game knows it: the biome the creatures spawn by. */
export const ZONE_BIOME: BiomeId[] = [];
ZONE_BIOME[Z.ocean] = 'ocean';
ZONE_BIOME[Z.beach] = 'beach';
ZONE_BIOME[Z.grassland] = 'grassland';
ZONE_BIOME[Z.jungle] = 'jungle';
ZONE_BIOME[Z.redwood] = 'redwood';
ZONE_BIOME[Z.swamp] = 'swamp';
ZONE_BIOME[Z.badlands] = 'badlands';
ZONE_BIOME[Z.mountain] = 'mountain';
ZONE_BIOME[Z.snow] = 'snow';
ZONE_BIOME[Z.volcano] = 'volcano';
ZONE_BIOME[Z.river] = 'river';
ZONE_BIOME[Z.lava] = 'volcano';
ZONE_BIOME[Z.frozenRiver] = 'river';

/** Each zone's colour on the map screen. */
export const ZONE_COLOR: [number, number, number][] = [];
ZONE_COLOR[Z.ocean] = [38, 96, 168];
ZONE_COLOR[Z.beach] = [232, 214, 150];
ZONE_COLOR[Z.grassland] = [134, 184, 74];
ZONE_COLOR[Z.jungle] = [40, 130, 40];
ZONE_COLOR[Z.redwood] = [70, 104, 60];
ZONE_COLOR[Z.swamp] = [84, 110, 70];
ZONE_COLOR[Z.badlands] = [200, 110, 60];
ZONE_COLOR[Z.mountain] = [132, 132, 130];
ZONE_COLOR[Z.snow] = [240, 244, 248];
ZONE_COLOR[Z.volcano] = [62, 58, 60];
ZONE_COLOR[Z.river] = [66, 138, 224];
ZONE_COLOR[Z.lava] = [255, 122, 24];
ZONE_COLOR[Z.frozenRiver] = [176, 214, 240];

/**
 * What each zone is made of and what grows there, for the generator (`world.map.palette`). The
 * island's own blocks (`def.ts`) are named here like built-in ones.
 */
export const PALETTE: MapZone[] = [];

PALETTE[Z.ocean] = { surface: { top: 'sand', fill: 'sand', bed: 'sand' }, roughness: 2 };

PALETTE[Z.beach] = {
  surface: { top: 'sand', fill: 'sand', depth: 4, bed: 'sand' },
  grass: '#8fbf4f',
  roughness: 0.7,
  trees: [{ shape: 'palm', log: 'palm_log', leaves: 'oak_leaves', height: [5, 8], density: 0.07 }],
  scatter: [
    { block: 'fiber_plant', density: 0.012 },
    { block: 'dead_bush', density: 0.004 },
    { block: 'stone', density: 0.0004, size: 5 },
  ],
};

PALETTE[Z.grassland] = {
  grass: '#86b84a',
  roughness: 0.6,
  trees: [
    { shape: 'oak', height: [4, 6], density: 0.02 },
    { shape: 'broad', height: [7, 10], density: 0.014 },
    { shape: 'bush', height: [1, 2], density: 0.02 },
  ],
  // Long grass in drifts with open turf between; flowers each in a few corners of their own;
  // here and there a patch worn to bare earth.
  scatter: [
    { block: 'dirt', where: 'in', density: 0.5, clumps: 9, cover: 0.03 },
    { block: 'berry_bush', density: 0.09, clumps: 30, cover: 0.14 },
    { block: 'fiber_plant', density: 0.14, clumps: 19, cover: 0.14 },
    { block: 'short_grass', density: 0.5, clumps: 27, cover: 0.4 },
    { block: 'dandelion', density: 0.2, clumps: 13, cover: 0.05 },
    { block: 'poppy', density: 0.2, clumps: 12, cover: 0.04 },
    { block: 'cornflower', density: 0.2, clumps: 14, cover: 0.045 },
    { block: 'short_grass', density: 0.03 },
    { block: 'stone', density: 0.0005, size: 7 },
    { block: 'metal_rock', density: 0.00012, size: 5 },
  ],
};

PALETTE[Z.jungle] = {
  surface: { bed: 'dirt' },
  grass: '#2f9a2a',
  roughness: 2.6,
  // Three storeys: emergent giants, a middle canopy of broad crowns, and a tangle underfoot.
  trees: [
    { shape: 'jungle', log: 'oak_log', leaves: 'oak_leaves', height: [14, 27], density: 0.95 },
    { shape: 'broad', height: [8, 12], density: 0.24 },
    { shape: 'oak', height: [5, 8], density: 0.28 },
    { shape: 'bush', height: [1, 3], density: 0.42 },
    { shape: 'palm', log: 'palm_log', leaves: 'oak_leaves', height: [6, 9], density: 0.04 },
  ],
  scatter: [
    { block: 'berry_bush', density: 0.08, clumps: 26, cover: 0.25 },
    { block: 'fiber_plant', density: 0.07, clumps: 18, cover: 0.25 },
    { block: 'fern', density: 0.34 },
    { block: 'short_grass', density: 0.2 },
    { block: 'mossy_cobblestone', density: 0.0009, size: 9 },
  ],
};

PALETTE[Z.redwood] = {
  surface: { top: 'podzol', bed: 'gravel' },
  grass: '#447f42',
  roughness: 2.2,
  trees: [
    { shape: 'giant', log: 'redwood_log', leaves: 'spruce_leaves', height: [30, 46], density: 0.72 },
    { shape: 'giant', log: 'redwood_log', leaves: 'spruce_leaves', height: [14, 19], density: 0.2 },
    { shape: 'spruce', height: [7, 11], density: 0.1 },
    { shape: 'bush', leaves: 'spruce_leaves', log: 'spruce_log', height: [1, 2], density: 0.06 },
  ],
  scatter: [
    { block: 'fern', density: 0.26 },
    { block: 'berry_bush', density: 0.03, clumps: 30 },
    { block: 'brown_mushroom', density: 0.006 },
    { block: 'red_mushroom', density: 0.004 },
    { block: 'short_grass', density: 0.06 },
    { block: 'stone', density: 0.0006, size: 10 },
    { block: 'metal_rock', density: 0.0001, size: 5 },
  ],
};

PALETTE[Z.swamp] = {
  surface: { top: 'grass_block', fill: 'mud', depth: 3, bed: 'mud' },
  grass: '#5f7d3a',
  roughness: 0.5,
  trees: [
    { shape: 'jungle', log: 'oak_log', leaves: 'oak_leaves', height: [6, 10], density: 0.4, wet: true },
    { shape: 'oak', height: [4, 6], density: 0.1, wet: true },
    { shape: 'dead', height: [3, 6], density: 0.06, wet: true },
  ],
  scatter: [
    { block: 'mud', where: 'in', density: 0.6, clumps: 14 },
    { block: 'reed', density: 0.09 },
    { block: 'fiber_plant', density: 0.025 },
    { block: 'short_grass', density: 0.2 },
    { block: 'brown_mushroom', density: 0.01 },
    { block: 'fern', density: 0.05 },
  ],
};

PALETTE[Z.badlands] = {
  surface: { top: 'red_sand', fill: 'red_sand', depth: 2, steep: 'mesa_red', steepness: 1.5, bed: 'red_sand', strata: ['mesa_red', 'mesa_red', 'mesa_tan', 'mesa_red', 'sandstone', 'mesa_red', 'mesa_tan', 'granite'] },
  grass: '#a8a550',
  roughness: 1.2,
  crags: 2,
  trees: [
    { shape: 'column', log: 'cactus', height: [1, 3], density: 0.04 },
    { shape: 'dead', height: [2, 4], density: 0.025 },
  ],
  scatter: [
    { block: 'dead_bush', density: 0.02 },
    { block: 'fiber_plant', density: 0.004 },
    { block: 'metal_rock', density: 0.0011, size: 8 },
    { block: 'mesa_tan', density: 0.0006, size: 10 },
    { block: 'metal_rock', where: 'under', density: 0.1, size: 9 },
  ],
};

PALETTE[Z.mountain] = {
  surface: { top: 'grass_block', steep: 'stone', steepness: 1.7, bed: 'gravel' },
  grass: '#7c9c68',
  roughness: 3.5,
  crags: 6,
  trees: [{ shape: 'spruce', height: [6, 10], density: 0.14 }],
  scatter: [
    { block: 'metal_rock', density: 0.0016, size: 9 },
    { block: 'stone', density: 0.002, size: 8 },
    { block: 'gravel', where: 'in', density: 0.5, clumps: 12 },
    { block: 'short_grass', density: 0.12 },
    { block: 'fern', density: 0.03 },
    { block: 'metal_rock', where: 'under', density: 0.12, size: 9 },
    { block: 'crystal_rock', where: 'under', density: 0.04, size: 6 },
  ],
};

PALETTE[Z.snow] = {
  surface: { top: 'snow_block', fill: 'snow_block', depth: 2, steep: 'stone', steepness: 2.4, bed: 'gravel' },
  grass: '#8fb0a0',
  frozen: true,
  roughness: 3,
  crags: 9,
  trees: [{ shape: 'spruce', height: [6, 9], density: 0.035 }],
  scatter: [
    { block: 'crystal_rock', density: 0.0012, size: 7 },
    { block: 'stone', density: 0.0012, size: 9 },
    { block: 'ice', where: 'in', density: 0.25, clumps: 12 },
    { block: 'crystal_rock', where: 'under', density: 0.1, size: 7 },
    { block: 'metal_rock', where: 'under', density: 0.05, size: 8 },
  ],
};

PALETTE[Z.volcano] = {
  surface: { top: 'basalt', fill: 'basalt', depth: 5, steep: 'basalt', bed: 'basalt' },
  grass: '#6f7a4a',
  roughness: 2,
  crags: 4,
  trees: [{ shape: 'dead', height: [2, 5], density: 0.02 }],
  scatter: [
    { block: 'obsidian_rock', density: 0.003, size: 10 },
    { block: 'ash', where: 'in', density: 0.7, clumps: 20 },
    { block: 'obsidian_rock', where: 'in', density: 0.03 },
    { block: 'obsidian_rock', where: 'under', density: 0.14, size: 9 },
    { block: 'metal_rock', where: 'under', density: 0.05, size: 8 },
  ],
};

PALETTE[Z.river] = {
  surface: { top: 'sand', fill: 'sand', depth: 2, bed: 'gravel' },
  grass: '#6fae45',
  roughness: 0.6,
  scatter: [
    { block: 'reed', density: 0.12 },
    { block: 'fiber_plant', density: 0.05 },
    { block: 'gravel', where: 'in', density: 0.4, clumps: 9 },
  ],
};

PALETTE[Z.lava] = { surface: { top: 'basalt', fill: 'basalt', depth: 5, steep: 'basalt', bed: 'obsidian_rock' }, liquid: 'lava', grass: '#6f7a4a', roughness: 1 };

PALETTE[Z.frozenRiver] = { surface: { top: 'snow_block', fill: 'gravel', depth: 2, bed: 'gravel' }, frozen: true, grass: '#8fb0a0', roughness: 0.6 };
