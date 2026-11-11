#!/usr/bin/env node
/**
 * Blocktaceous: the two-legged animals, built as animated micro-voxel figures and written as
 * binary glTF to `src/games/blocktaceous/models/<id>.glb`. Dependency-free (Node 22+): `node src/games/blocktaceous/tools/bipeds/build.mjs
 * [ids...] [--out=dir]`.
 *
 * - The look is the platform's characters' (`src/platform/character/voxels.ts`, copied as
 *   `bake.mjs`): clean voxels, flat colours, every voxel its own shade of its colour, soft occlusion in
 *   the concave corners; the faces of a part in a plane are one quad, their colours its texels.
 *   Animals are coarser than people (a tyrannosaur at a person's 52 voxels a metre would be
 *   millions of faces): from 64 and 44 voxels a metre for the two little ones to 11 for the
 *   biggest, and the big ones' faces a texel each instead of the platform's two by two.
 * - A file: a root named after the animal, a bone a rigid part (rest: translations only), `saddle`
 *   an empty node on the back, one skinned mesh `body` of one material (one draw call, one more
 *   for its shadow), every vertex wholly on its part's bone; and the clips `idle`, `walk`, `run`,
 *   `attack`, `eat`, `sleep`, `roar` (`rig.mjs`).
 * - It faces +z, stands on y = 0, a metre to the unit, the hips over the origin.
 * - The root's `extras`: `stride` (the metres a walk or run loop covers), `length`, `height`.
 * - `--stride-scale`: the engine plays a figure's walk and run one loop to 1.496 blocks times its
 *   model's `scale` (`Models.gltf(url, { scale })`), whatever the animal's size. With this flag
 *   each file's root is scaled down by its stride / 1.496 (the number printed as `scale`), so that
 *   giving the model that `scale` shows it life-size again with its feet in step with the ground.
 *   Without it (the default) the files are life-size at scale 1.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bake, quadCorners, DIRS } from './bake.mjs';
import { png } from '../voxel.mjs';
import { writeGlb } from './glb.mjs';
import { buildBiped } from './biped.mjs';
import { skeleton, clips } from './rig.mjs';
import { SPECIES } from './species.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const OUT = argv.find((a) => a.startsWith('--out='))?.slice(6) ?? join(HERE, '../../models');
const ids = argv.filter((a) => !a.startsWith('--'));
const STRIDE_SCALE = argv.includes('--stride-scale');
/** Blocks a loop of a figure's walk covers at scale 1 (the engine's: 2 pi / 4.2). */
const LOOP = (2 * Math.PI) / 4.2;

function glb(d) {
  const { sc, joints, points } = buildBiped(d);
  const sk = skeleton(joints, points);
  const anim = clips(sk, d.gait);
  const baked = bake(sc.vox, sc.palette, { texels: d.texels ?? 2 });
  // The nodes: the root, the bones (each from its parent), the saddle, the mesh.
  const r = (v) => Math.round(v * 1e5) / 1e5;
  const [lo, hi] = sc.bounds();
  const k = Math.max(0.6, anim.cycle / LOOP);
  const nodes = [{ name: d.id, ...(STRIDE_SCALE ? { scale: [1 / k, 1 / k, 1 / k].map((v) => Math.round(v * 1e6) / 1e6) } : {}), children: [], extras: { title: d.name, stride: r(anim.cycle), length: r(hi[2] - lo[2]), height: r(hi[1]) } }];
  const nodeOf = {};
  for (const b of sk.order) {
    const p = sk.parent[b];
    nodeOf[b] = nodes.length;
    nodes.push({ name: b, translation: (p ? joints[b].map((v, a) => v - joints[p][a]) : joints[b]).map(r), children: [] });
    nodes[p ? nodeOf[p] : 0].children.push(nodeOf[b]);
  }
  nodes[nodeOf.hips].children.push(nodes.length);
  nodes.push({ name: 'saddle', translation: points.saddle.map((v, a) => r(v - joints.hips[a])) });
  const bodyNode = nodes.length;
  nodes.push({ name: 'body' });
  nodes[0].children.push(bodyNode);
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  // The mesh, bone by bone.
  const boneOf = Object.fromEntries(sk.order.map((b, i) => [b, i]));
  for (const part of sc.vox.parts.keys()) if (!(part in boneOf)) throw new Error(`${d.id}: part ${part} has no bone`);
  const quads = baked.quads;
  const pos = [], nor = [], uv = [], jo = [], we = [], idx = [];
  for (const f of quads) {
    const base = pos.length / 3;
    const corners = quadCorners(f);
    const n = DIRS[f.dir].n;
    const [u0, v0, u1, v1] = f.uv;
    const uvs = [u0, v0, u1, v0, u1, v1, u0, v1];
    for (let c = 0; c < 4; c++) {
      pos.push(...corners[c]);
      nor.push(n[0] * 127, n[1] * 127, n[2] * 127);
      // (Texel corners as whole steps of 65536 / the atlas's size: the low bytes repeat, and pack small.)
      uv.push(Math.min(65535, Math.round(uvs[c * 2] * 65536)), Math.min(65535, Math.round(uvs[c * 2 + 1] * 65536)));
      jo.push(boneOf[f.part], 0, 0, 0);
      we.push(255, 0, 0, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // Positions as bytes where the animal is small enough in voxels, else shorts.
  const small = pos.every((v) => v >= -128 && v <= 127);
  // Each bone's inverse bind matrix: from voxel coordinates into its joint's space at rest.
  const ibm = new Float32Array(sk.order.length * 16);
  sk.order.forEach((b, n) => {
    for (let k = 0; k < 3; k++) ibm[n * 16 + k * 5] = 1 / d.vpm;
    ibm[n * 16 + 15] = 1;
    for (let k = 0; k < 3; k++) ibm[n * 16 + 12 + k] = -joints[b][k];
  });
  const bytes = writeGlb({
    generator: 'Blocktaceous src/games/blocktaceous/tools/bipeds/build.mjs',
    nodes,
    sceneName: d.id,
    meshName: 'body',
    meshNode: bodyNode,
    attributes: {
      POSITION: { values: pos, componentType: small ? 5120 : 5122, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5120, type: 'VEC3', normalized: true },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
      JOINTS_0: { values: jo, componentType: 5121, type: 'VEC4' },
      WEIGHTS_0: { values: we, componentType: 5121, type: 'VEC4', normalized: true },
    },
    indices: idx,
    quadIndices: true,
    skin: { name: `${d.id}_skeleton`, joints: sk.order.map((b) => nodeOf[b]), skeleton: nodeOf.hips, inverseBindMatrices: ibm },
    material: { name: d.id, albedo: png({ w: baked.width, h: baked.height, px: baked.albedo }) },
    animations: anim.clips.map((c) => ({ name: c.name, channels: c.channels.map((ch) => ({ node: nodeOf[ch.bone], path: ch.path, times: ch.times, values: ch.values })) })),
  });
  return {
    bytes,
    stats: {
      voxels: sc.vox.count,
      triangles: quads.length * 2,
      atlas: `${baked.width}x${baked.height}`,
      kb: Math.round(bytes.length / 102.4) / 10,
      length: r(hi[2] - lo[2]),
      height: r(hi[1]),
      width: r(hi[0] - lo[0]),
      nose: r(hi[2]),
      stride: r(anim.cycle),
      scale: Math.round(k * 1000) / 1000,
    },
  };
}

mkdirSync(OUT, { recursive: true });
const table = [];
for (const d of SPECIES) {
  if (ids.length && !ids.includes(d.id)) continue;
  const { bytes, stats } = glb(d);
  writeFileSync(join(OUT, `${d.id}.glb`), bytes);
  console.log(d.id.padEnd(16), JSON.stringify(stats));
  table.push(`  ${d.id}: { scale: ${STRIDE_SCALE ? stats.scale : 1}, stride: ${stats.stride}, steps: { walk: ${2 * (d.gait?.walkCycles ?? 2)}, run: ${2 * (d.gait?.runCycles ?? 1)} } },`);
}
// What the files are, for whoever shows them (only when all of them were built).
if (!ids.length) {
  writeFileSync(
    join(OUT, 'bipeds.ts'),
    `/**
 * The two-legged animals' models as \`tools/bipeds/build.mjs\` last wrote them (it writes this file too).
 * - \`scale\`: what to give \`Models.gltf(url, { scale })\` (or a prop) to show the file life-size: 1,
 *   unless the files were built with \`--stride-scale\` (see the build script), which makes the
 *   engine play the walk and the run in step with the ground.
 * - \`stride\`: the blocks a loop of the walk or the run covers with its feet not sliding.
 * - \`steps\`: the footfalls in a loop of each.
 */
export const BIPED_MODELS = {
${table.join('\n')}
} as const;
`,
  );
}
