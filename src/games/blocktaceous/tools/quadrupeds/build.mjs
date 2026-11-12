#!/usr/bin/env node
/**
 * Blocktaceous: the four-legged animals and the pterosaur, built as micro-voxel figures with their
 * animation clips and written to `src/games/blocktaceous/models/<id>.glb`. Dependency-free (Node
 * 22+): `node src/games/blocktaceous/tools/quadrupeds/build.mjs [ids…] [--stride=<k>|natural]`.
 *
 * Every model: faces +z, feet on y = 0, a block to the unit, its body's middle over the origin,
 * built to its species' `length` and `height` (`species.ts`). One skinned mesh (node `skin`) on a
 * skeleton of joints, each voxel part wholly on its joint; nodes `head` (it looks with it) and
 * `saddle` (an empty where a rider sits). Clips: `idle`, `walk`, `run`, `attack`, `eat`, `sleep`,
 * `roar`; the pteranodon also `fly` and `glide`, the sarcosuchus `swim`.
 *
 * The gaits are drawn for the ground the engine gives a cycle of `walk` or `run` (about 1.5 blocks
 * at a model scale of 1), so feet don't slide; `--stride=natural` draws each animal's own longer
 * stride instead, which only fits if the engine is told the stride.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, validate } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models');
const IDS = ['triceratops', 'pteranodon', 'stegosaurus', 'brachiosaurus', 'ankylosaurus', 'mammoth', 'smilodon', 'sarcosuchus'];
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const id of want.length ? want : IDS) {
  const { make } = await import(`./${id}.mjs`);
  const model = make();
  const { bytes, stats } = build(model, { generator: 'Blocktaceous src/games/blocktaceous/tools/quadrupeds/build.mjs' });
  // On a copy: the tools' decoder works in place on the buffer it's given.
  validate(Buffer.from(bytes), model);
  writeFileSync(join(OUT, `${id}.glb`), bytes);
  const f = (v) => v.map((x) => x.toFixed(2)).join(', ');
  console.log(`${id}: ${stats.triangles} triangles, ${(stats.bytes / 1024).toFixed(1)} KB, ${stats.voxels} voxels at ${model.S}/m, ${stats.tiles} tiles; from (${f(stats.lo)}) to (${f(stats.hi)}); length ${(stats.hi[2] - stats.lo[2]).toFixed(2)}, height ${stats.hi[1].toFixed(2)}, width ${(stats.hi[0] - stats.lo[0]).toFixed(2)}`);
  if (process.argv.includes('--list')) console.log(`  nodes: ${stats.nodes.join(' ')}\n  clips: ${stats.clips.join(' ')}`);
}
