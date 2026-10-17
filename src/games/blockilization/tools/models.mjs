/**
 * Blockilization's voxel models (node src/games/blockilization/tools/models.mjs): the shapes of
 * `shapes.mjs`, the wonders of `portraits.mjs` (standing by their cities) and the resources of
 * `resources.mjs` (on their tiles), each written as a GLB
 * to `../models/`, standing on its origin and facing +z, a voxel a sixteenth of a block (each screen
 * scales them to the hex); and `../modelids.ts` (the ids, and each model's size in voxels) and
 * `../client/modelfiles.ts` (the files, for the screens).
 *
 * It uses a copy of Call of Blocky's voxel mesher (`./voxel.mjs`): visible faces only,
 * flat colours on a small palette atlas, soft occlusion in the corners.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { faces, atlas, quadCorners, png, writeGlb, DIRS } from './voxel.mjs';
import { WONDERS } from './portraits.mjs';
import { MODELS, P } from './shapes.mjs';
import { RESOURCE_MODELS } from './resources.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'models');


// ---------------------------------------------------------------------------------------------
// Writing

function glb(m) {
  const { faces: list } = faces(m.vox, P, { merge: true });
  const A = atlas(list, P);
  const pos = [];
  const nor = [];
  const uv = [];
  const idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...c.map((v) => v / 16));
      nor.push(...n);
      uv.push(Math.round(A.uvs[fi][ci][0] * 65535), Math.round(A.uvs[fi][ci][1] * 65535));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const glows = [...P.colours.values()].some((c) => c.glow > 0);
  return writeGlb({
    generator: 'Blockilization src/games/blockilization/tools/models.mjs',
    nodes: [{ name: m.id, children: [1] }, { name: `${m.id}_body` }],
    sceneName: m.id,
    meshName: `${m.id}_body`,
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: `${m.id}_atlas`, albedo: png(A.albedo), mr: png(A.mr), glow: glows ? png(A.glow, { grey: true }) : null },
    // Floats, not quantized: the platform bakes an item's node transforms into its positions,
    // which bytes can't hold.
    compress: true,
  });
}

mkdirSync(OUT, { recursive: true });
const ALL = [...MODELS, ...WONDERS, ...RESOURCE_MODELS];
const manifest = {};
let total = 0;
for (const m of ALL) {
  const bytes = glb(m);
  writeFileSync(join(OUT, `${m.id}.glb`), bytes);
  total += bytes.length;
  // The model's extent in voxels.
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const p of m.vox.parts.values())
    for (const key of p.keys()) {
      const c = [(key % 1024) - 512, (Math.floor(key / 1024) % 1024) - 512, Math.floor(key / 1048576) - 512];
      lo = lo.map((v, a) => Math.min(v, c[a]));
      hi = hi.map((v, a) => Math.max(v, c[a] + 1));
    }
  manifest[m.id] = { lo, hi };
}
// The ids and sizes (for the server's items and the screens' placing), and each screen's file list
// (Vite ships the files it imports).
const ids = ALL.map((m) => m.id);
writeFileSync(
  join(OUT, '..', 'modelids.ts'),
  [
    "/** The voxel models (written by tools/models.mjs; don't edit). Each is an item, `civm_<id>`, that only screens draw. */",
    `export const MODEL_IDS = ${JSON.stringify(ids)} as const;`,
    'export type ModelId = (typeof MODEL_IDS)[number];',
    '',
    '/** Each model\'s extent in voxels (a sixteenth of a block): [lo, hi) on x, y, z. */',
    `export const MODEL_SIZE: Record<ModelId, { lo: number[]; hi: number[] }> = ${JSON.stringify(manifest)};`,
    '',
  ].join('\n'),
);
writeFileSync(
  join(OUT, '..', 'client', 'modelfiles.ts'),
  [
    "// The voxel models' files (written by tools/models.mjs; don't edit).",
    "import type { ModelId } from '../modelids';",
    ...ids.map((id) => `import ${id} from '../models/${id}.glb?url';`),
    '',
    `export const MODEL_FILES: Record<ModelId, string> = { ${ids.join(', ')} };`,
    '',
  ].join('\n'),
);
console.log(`${ALL.length} models, ${Math.round(total / 1024)} KB, in ${OUT}`);
