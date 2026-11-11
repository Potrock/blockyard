import { TerrainGen } from '@engine/voxel_engine.js';
import { MAP, POINTS, REGIONS, SPAWNS, biomeAt, groundAt, isLand, islandMap, nearestShore, regionAt, waterAt } from '../../src/games/blocktaceous/island';
import { Z } from '../../src/games/blocktaceous/island/map';
import { SPECIES } from '../../src/games/blocktaceous/species';
import type { BiomeId } from '../../src/games/blocktaceous/species';
import { check, launch } from './_harness';

/**
 * The island: the map builds, the engine turns it into the world the map describes (ground where
 * `groundAt` says, each biome's own surface and growth, rivers in their beds), survivors wash up
 * on a beach above the water, every river reaches the sea, and it generates about as fast as a
 * natural world.
 */
export default function blocktaceousIsland() {
  const t0 = performance.now();
  const map = islandMap();
  const built = performance.now() - t0;
  const { size: N, cell: C, minX: O } = MAP;
  check(map.heights.length === N * N && map.zones.length === N * N, 'the grids are the map\'s size');
  console.log(`  the map: ${N} x ${N} samples of ${C} blocks, built in ${built.toFixed(0)} ms`);
  // (About half a second on a quiet machine; the bound is for one busy with other tests.)
  check(built < 8000, `the map builds in a moment: ${built.toFixed(0)} ms`);

  // Land of every biome, a sensible share of each, and peaks that use the height.
  const share: Partial<Record<BiomeId, number>> = {};
  let peak = 0;
  for (let k = 0; k < N * N; k += 7) {
    const x = O + (k % N) * C;
    const z = O + Math.floor(k / N) * C;
    const b = biomeAt(x, z);
    share[b] = (share[b] ?? 0) + 1;
    peak = Math.max(peak, map.heights[k] / 256);
  }
  const all: BiomeId[] = ['ocean', 'beach', 'grassland', 'jungle', 'redwood', 'swamp', 'badlands', 'mountain', 'snow', 'volcano', 'river'];
  for (const b of all) check((share[b] ?? 0) > 150, `there is ${b}: ${share[b] ?? 0} samples`);
  check(peak > 200 && peak < 252, `peaks around 200 and more: ${peak.toFixed(0)}`);
  for (const [id, s] of Object.entries(SPECIES)) check(s.biomes.every((b) => (share[b] ?? 0) > 0), `${id} has somewhere to live`);
  // The island sits inside its sea: the map's edges are deep water.
  for (let i = 0; i < N; i += 3) for (const k of [i, (N - 1) * N + i, i * N, i * N + N - 1]) check(map.heights[k] / 256 < 40 && map.zones[k] === Z.ocean, 'sea all round the map');

  // Every stretch of river and lake runs down to the sea: following water that stands no
  // higher, from any wet sample, ends at sea level beside the sea.
  const reaches = new Uint8Array(N * N);
  const queue: number[] = [];
  const around = [-1, 1, -N, N, -N - 1, -N + 1, N - 1, N + 1];
  for (let k = N; k < N * N - N; k++) {
    if (map.water[k] && map.water[k] <= MAP.seaLevel + 1 && around.some((d) => map.zones[k + d] === Z.ocean)) {
      reaches[k] = 1;
      queue.push(k);
    }
  }
  check(queue.length > 10, 'rivers have mouths');
  // Upstream from the mouths: a wet neighbour at the same level or higher drains this way.
  while (queue.length) {
    const k = queue.pop()!;
    for (const d of around) {
      const u = k + d;
      if (map.water[u] && !reaches[u] && map.water[u] >= map.water[k]) {
        reaches[u] = 1;
        queue.push(u);
      }
    }
  }
  let wet = 0;
  let stranded = 0;
  for (let k = 0; k < N * N; k++) {
    if (!map.water[k]) continue;
    wet++;
    if (!reaches[k]) stranded++;
    // Water lies in a bed, between banks.
    check(map.heights[k] / 256 <= map.water[k] - 1, 'a wet sample has a bed below its level');
    for (const d of around) check(map.water[k + d] || map.water[k] <= MAP.seaLevel || map.heights[k + d] / 256 >= map.water[k] + 1, `banks stand above the water at ${O + (k % N) * C}, ${O + Math.floor(k / N) * C}`);
  }
  check(wet > 3000 && stranded === 0, `every river reaches the sea: ${stranded} of ${wet} wet samples don't`);

  // The rest of the game's questions.
  for (const s of SPAWNS) {
    check(biomeAt(s.x, s.z) === 'beach' && isLand(s.x, s.z) && groundAt(s.x, s.z) > MAP.seaLevel + 1.2, `${s.name} (${s.x}, ${s.z}) is a beach above the water: ${biomeAt(s.x, s.z)} at ${groundAt(s.x, s.z).toFixed(1)}`);
    check(s.z > 1500 && regionAt(s.x, s.z) === s.name, `${s.name} is on the southern shore, in its region: ${regionAt(s.x, s.z)}`);
    const shore = nearestShore(s.x, s.z);
    check(shore && Math.hypot(shore.x - s.x, shore.z - s.z) < 120, `${s.name} is by the sea`);
  }
  for (const r of REGIONS) check(regionAt(r.x, r.z) === r.name && biomeAt(r.x, r.z) === r.biome, `${r.name} is where it says: ${regionAt(r.x, r.z)}, ${biomeAt(r.x, r.z)}`);
  for (const b of all) if (b !== 'ocean' && b !== 'river') check(REGIONS.some((r) => r.biome === b), `a named region of ${b}`);
  check(regionAt(MAP.minX + 40, MAP.minZ + 40) === null && biomeAt(9000, 0) === 'ocean' && waterAt(9000, 0) === MAP.seaLevel, 'open sea has no name');
  for (const p of POINTS) check(Math.abs(p.x) < MAP.maxX && Math.abs(p.z) < MAP.maxX, `${p.name} is on the map`);

  // The real world. A survivor joins: on the beach, on sand, above the water, the sea in sight.
  const h = launch('blocktaceous', { seed: 9, radius: 3 });
  const world = h.ctx.world;
  h.run(1, { dt: 1 / 30 });
  const me = h.ctx.player.position;
  const name = (x: number, y: number, z: number) => world.blockName(world.getBlock(Math.floor(x), y, Math.floor(z)));
  const feet = world.surfaceY(Math.floor(me.x), Math.floor(me.z));
  check(biomeAt(me.x, me.z) === 'beach' && regionAt(me.x, me.z) === 'Castaway Shore', `spawned on Castaway Shore: ${biomeAt(me.x, me.z)}, ${regionAt(me.x, me.z)} at ${me.x.toFixed(0)}, ${me.z.toFixed(0)}`);
  check(feet > MAP.seaLevel && me.y > MAP.seaLevel + 1 && me.y < feet + 3, `standing on the beach above the water: y ${me.y.toFixed(1)}, ground ${feet}`);
  check(name(me.x, feet, me.z) === 'sand', `on sand: ${name(me.x, feet, me.z)}`);
  check(world.seaLevel === MAP.seaLevel, 'the map and the world agree on sea level');

  // Columns all over the island, straight from the generator the room uses: the ground is where
  // the map says, and each biome looks like itself.
  const gen = (h.world as unknown as { gen: TerrainGen }).gen;
  const HEADER = 1028;
  const chunks = new Map<string, Uint8Array>();
  let genMs = 0;
  let genCount = 0;
  const column = (x: number, z: number) => {
    const [cx, cz] = [Math.floor(x / 16), Math.floor(z / 16)];
    let data = chunks.get(`${cx},${cz}`);
    if (!data) {
      const t = performance.now();
      data = gen.generate(cx, cz);
      genMs += performance.now() - t;
      genCount++;
      chunks.set(`${cx},${cz}`, data);
    }
    const mask = data[0] | (data[1] << 8);
    const [lx, lz] = [x - cx * 16, z - cz * 16];
    return (y: number) => {
      const s = y >> 4;
      if (!(mask & (1 << s))) return 'air';
      let o = HEADER;
      for (let b = 0; b < s; b++) if (mask & (1 << b)) o += 4096;
      return world.blockName(data![o + ((y & 15) * 16 + lz) * 16 + lx]);
    };
  };
  const GROWTH = /air|log|leaves|cactus|bush|plant|reed|grass$|fern|mushroom|dandelion|poppy|cornflower/;
  const LIQUID = /^(water|lava|ice)$/;
  const seen: Record<string, Record<string, number>> = {};
  const tally = (biome: string, what: string) => ((seen[biome] ??= {})[what] = (seen[biome][what] ?? 0) + 1);
  let worst = 0;
  let sampled = 0;
  const rng = mulberry(77);
  for (let tries = 0; tries < 60000 && sampled < 900; tries++) {
    const x = Math.floor(MAP.minX + rng() * (MAP.maxX - MAP.minX));
    const z = Math.floor(MAP.minZ + rng() * (MAP.maxZ - MAP.minZ));
    const biome = biomeAt(x, z);
    // A fair spread: no more than 90 of any biome, and only well inside one (borders wander).
    if ((seen[biome]?.columns ?? 0) >= 90 || [-24, 24].some((d) => biomeAt(x + d, z) !== biome || biomeAt(x, z + d) !== biome)) continue;
    sampled++;
    tally(biome, 'columns');
    const at = column(x, z);
    let y = 255;
    let tree = false;
    while (y > 0 && GROWTH.test(at(y))) {
      tree ||= /log|leaves/.test(at(y));
      if (/berry_bush|fiber_plant|reed/.test(at(y))) tally(biome, at(y));
      y--;
    }
    if (tree) tally(biome, 'trees');
    const level = waterAt(x, z);
    // (Patches of ice lie in the snow too: those are ground.)
    if (LIQUID.test(at(y)) && !(at(y) === 'ice' && level === null)) {
      // Liquid: it stands at the map's level, over a bed.
      // Low ground (the marsh, a shore) dips under sea level between the map's samples.
      const pool = level === null && y === MAP.seaLevel && groundAt(x, z) < MAP.seaLevel + 3;
      check(level !== null || pool, `${biome} at ${x}, ${z}: ${at(y)} where the map has dry land`);
      check(pool || Math.abs(y - level!) <= 1, `${biome} at ${x}, ${z}: ${at(y)} to y ${y}, the map says ${level}`);
      tally(biome, at(y));
      while (LIQUID.test(at(y))) y--;
    } else if (level !== null && level > MAP.seaLevel && biome === 'river') {
      check(false, `${biome} at ${x}, ${z}: dry (${at(y)} at ${y}) where the map has water at ${level}`);
    }
    tally(biome, `on ${at(y)}`);
    // Mountains and peaks are rough (crags); everywhere else the ground is within a few blocks.
    const off = Math.abs(y + 1 - groundAt(x, z));
    const slack = biome === 'mountain' || biome === 'snow' ? 16 : biome === 'volcano' || biome === 'badlands' ? 9 : 5;
    check(off <= slack, `${biome} at ${x}, ${z}: ground at ${y + 1}, the map says ${groundAt(x, z).toFixed(1)}`);
    worst = Math.max(worst, off);
  }
  for (const b of all) check((seen[b]?.columns ?? 0) >= 25, `sampled ${b}: ${seen[b]?.columns ?? 0}`);
  const on = (biome: BiomeId, ...blocks: string[]) => blocks.reduce((n, b) => n + (seen[biome][`on ${b}`] ?? 0), 0) / seen[biome].columns;
  const some = (biome: BiomeId, what: string) => (seen[biome][what] ?? 0) / seen[biome].columns;
  console.log(`  ${sampled} columns in ${genCount} chunks: ground within ${worst.toFixed(1)} of the map`);
  console.log(`  ${Object.entries(seen).map(([b, s]) => `${b}: ${Object.entries(s).filter(([k]) => k !== 'columns').sort((p, q) => q[1] - p[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ')}`).join('\n  ')}`);
  check(on('beach', 'sand') > 0.9, 'beaches are sand');
  check(on('grassland', 'grass_block', 'dirt') > 0.9 && some('grassland', 'trees') < 0.2, 'grassland is open grass');
  check(on('jungle', 'grass_block', 'dirt') > 0.85 && some('jungle', 'trees') > 0.5, `the jungle is thick: ${some('jungle', 'trees').toFixed(2)} under trees`);
  check(on('redwood', 'podzol', 'dirt', 'redwood_log') > 0.85 && some('redwood', 'trees') > 0.3, `redwoods stand over podzol: ${some('redwood', 'trees').toFixed(2)} under trees`);
  check(on('swamp', 'grass_block', 'mud') > 0.9 && some('swamp', 'water') > 0.12, `the swamp is wet: ${some('swamp', 'water').toFixed(2)} under water`);
  check(on('badlands', 'red_sand', 'mesa_red', 'mesa_tan', 'sandstone', 'granite', 'metal_rock') > 0.9, 'badlands are red sand and banded rock');
  check(on('snow', 'snow_block', 'stone', 'ice', 'crystal_rock', 'gravel') > 0.9, 'the heights are snow and rock');
  check(on('volcano', 'basalt', 'ash', 'obsidian_rock') > 0.9, 'the volcano is basalt, ash and obsidian');
  check(some('river', 'water') + some('river', 'ice') > 0.9, `rivers run with water: ${some('river', 'water').toFixed(2)}`);
  check(some('ocean', 'water') === 1, 'the sea is sea');

  // The crater holds lava, and the generator scatters the resource blocks.
  const cauldron = POINTS.find((p) => p.name === 'The Cauldron')!;
  const crater = column(cauldron.x, cauldron.z);
  const lava = waterAt(cauldron.x, cauldron.z)!;
  check(lava > 120 && crater(lava) === 'lava' && crater(lava + 1) === 'air', `lava in the crater at ${lava}: ${crater(lava)}`);
  const counts: Record<string, number> = {};
  for (const data of chunks.values()) for (let i = HEADER; i < data.length; i++) counts[data[i]] = (counts[data[i]] ?? 0) + 1;
  for (const b of ['metal_rock', 'crystal_rock', 'obsidian_rock', 'berry_bush', 'fiber_plant', 'redwood_log', 'palm_log']) {
    check((counts[world.blockId(b)] ?? 0) > 20, `the world has ${b}: ${counts[world.blockId(b)] ?? 0}`);
  }

  // As quick to make as a natural world (same engine, same chunk count).
  const natural = new TerrainGen(9);
  const t1 = performance.now();
  for (let i = 0; i < 80; i++) natural.generate(i % 9, Math.floor(i / 9)).length;
  const naturalMs = (performance.now() - t1) / 80;
  natural.free();
  const mapMs = genMs / genCount;
  console.log(`  ${mapMs.toFixed(2)} ms a chunk (a natural world: ${naturalMs.toFixed(2)} ms)`);
  check(mapMs < naturalMs * 1.5 + 0.5, `the island generates about as fast as a natural world: ${mapMs.toFixed(2)} ms against ${naturalMs.toFixed(2)} ms`);
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
