#!/usr/bin/env node
/**
 * A plain figure on the humanoid rig (docs/HUMANOID.md), for trying the platform's humanoid
 * animation: tapered boxes for its parts, a joint per part, fists with their grip points. Written
 * to `src/games/gallery/models/mannequin.glb`. Dependency-free: `node scripts/mannequin.mjs`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../src/games/gallery/models/mannequin.glb');

/** A box from `lo` to `hi`, narrowed at the top or bottom (`taper`: the top face's scale), flat-shaded. */
function box(lo, hi, taper = 1) {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const top = (x, z) => [cx + (x - cx) * taper, z === undefined ? 0 : cz + (z - cz) * taper];
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [top(x0, z0)[0], y1, top(x0, z0)[1]], [top(x1, z0)[0], y1, top(x1, z0)[1]], [top(x1, z1)[0], y1, top(x1, z1)[1]], [top(x0, z1)[0], y1, top(x0, z1)[1]],
  ];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const pos = [];
  const nor = [];
  for (const f of faces) {
    const [a, b, c, d] = f.map((i) => v[i]);
    const n = normal(a, b, c);
    for (const p of [a, b, c, a, c, d]) {
      pos.push(...p);
      nor.push(...n);
    }
  }
  return { pos, nor };
}

function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  // Faces wind counter-clockwise seen from outside: the normal points out.
  return n.map((x) => x / l);
}

const MATERIALS = [
  { name: 'suit', color: [0.05, 0.05, 0.06], metal: 0, rough: 0.8 },
  { name: 'skin', color: [0.75, 0.5, 0.36], metal: 0, rough: 0.6 },
  { name: 'shirt', color: [0.9, 0.88, 0.84], metal: 0, rough: 0.85 },
  { name: 'shoe', color: [0.02, 0.02, 0.02], metal: 0, rough: 0.25 },
];

// joint: [name, parent, translation]; parts: [joint, material, lo, hi, taper]
const JOINTS = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.22, 0]],
  ['neck', 'chest', [0, 0.24, 0]],
  ['head', 'neck', [0, 0.07, 0]],
  ['upperArmL', 'chest', [0.19, 0.19, 0]],
  ['lowerArmL', 'upperArmL', [0, -0.28, 0]],
  ['handL', 'lowerArmL', [0, -0.25, 0]],
  ['gripL', 'handL', [0, -0.085, 0.015]],
  ['upperArmR', 'chest', [-0.19, 0.19, 0]],
  ['lowerArmR', 'upperArmR', [0, -0.28, 0]],
  ['handR', 'lowerArmR', [0, -0.25, 0]],
  ['gripR', 'handR', [0, -0.085, 0.015]],
  ['upperLegL', 'hips', [0.1, -0.04, 0]],
  ['lowerLegL', 'upperLegL', [0, -0.43, 0]],
  ['footL', 'lowerLegL', [0, -0.41, 0]],
  ['upperLegR', 'hips', [-0.1, -0.04, 0]],
  ['lowerLegR', 'upperLegR', [0, -0.43, 0]],
  ['footR', 'lowerLegR', [0, -0.41, 0]],
];

const PARTS = [
  ['hips', 0, [-0.17, -0.1, -0.1], [0.17, 0.1, 0.1], 1],
  ['spine', 1, [-0.15, -0.02, -0.09], [0.15, 0.24, 0.1], 1.08],
  ['chest', 0, [-0.21, -0.02, -0.12], [0.21, 0.26, 0.12], 1.05],
  ['chest', 2, [-0.05, 0.05, 0.1], [0.05, 0.24, 0.13], 1],
  ['neck', 1, [-0.05, -0.02, -0.05], [0.05, 0.1, 0.05], 1],
  ['head', 1, [-0.1, 0, -0.11], [0.1, 0.25, 0.11], 0.9],
  ['head', 0, [-0.105, 0.2, -0.12], [0.105, 0.28, 0.1], 0.9],
  ['upperArmL', 0, [-0.055, -0.3, -0.055], [0.055, 0.04, 0.055], 1.1],
  ['lowerArmL', 0, [-0.048, -0.24, -0.048], [0.048, 0.03, 0.048], 1.1],
  ['lowerArmL', 2, [-0.045, -0.26, -0.045], [0.045, -0.2, 0.045], 1],
  ['handL', 1, [-0.04, -0.13, -0.03], [0.04, 0, 0.06], 1],
  ['upperArmR', 0, [-0.055, -0.3, -0.055], [0.055, 0.04, 0.055], 1.1],
  ['lowerArmR', 0, [-0.048, -0.24, -0.048], [0.048, 0.03, 0.048], 1.1],
  ['lowerArmR', 2, [-0.045, -0.26, -0.045], [0.045, -0.2, 0.045], 1],
  ['handR', 1, [-0.04, -0.13, -0.03], [0.04, 0, 0.06], 1],
  ['upperLegL', 0, [-0.075, -0.45, -0.08], [0.075, 0.05, 0.08], 1.15],
  ['lowerLegL', 0, [-0.06, -0.41, -0.06], [0.06, 0.03, 0.07], 1.1],
  ['footL', 3, [-0.055, -0.07, -0.07], [0.055, 0.04, 0.2], 1],
  ['upperLegR', 0, [-0.075, -0.45, -0.08], [0.075, 0.05, 0.08], 1.15],
  ['lowerLegR', 0, [-0.06, -0.41, -0.06], [0.06, 0.03, 0.07], 1.1],
  ['footR', 3, [-0.055, -0.07, -0.07], [0.055, 0.04, 0.2], 1],
];

// One mesh per (joint, material): a primitive each.
const meshes = new Map();
for (const [joint, mat, lo, hi, taper] of PARTS) {
  const key = `${joint}|${mat}`;
  const m = meshes.get(key) ?? { joint, mat, pos: [], nor: [] };
  const b = box(lo, hi, taper);
  m.pos.push(...b.pos);
  m.nor.push(...b.nor);
  meshes.set(key, m);
}

const bin = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
function addFloats(data, type, minmax) {
  const f = new Float32Array(data);
  const bytes = Buffer.from(f.buffer);
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target: 34962 });
  bin.push(bytes);
  byteLength += bytes.length;
  const n = type === 'VEC3' ? 3 : 2;
  const acc = { bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / n, type };
  if (minmax) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], data[i + k]);
      max[k] = Math.max(max[k], data[i + k]);
    }
    Object.assign(acc, { min, max });
  }
  accessors.push(acc);
  return accessors.length - 1;
}

const gltfMeshes = [];
const nodes = [{ name: 'mannequin', children: [] }];
const index = new Map();
for (const [name, parent, t] of JOINTS) {
  nodes.push({ name, translation: t, children: [] });
  index.set(name, nodes.length - 1);
  (parent ? nodes[index.get(parent)] : nodes[0]).children.push(nodes.length - 1);
}
for (const m of meshes.values()) {
  const p = addFloats(m.pos, 'VEC3', true);
  const n = addFloats(m.nor, 'VEC3', false);
  gltfMeshes.push({ primitives: [{ attributes: { POSITION: p, NORMAL: n }, material: m.mat }] });
  nodes.push({ name: `${m.joint}_${MATERIALS[m.mat].name}`, mesh: gltfMeshes.length - 1 });
  nodes[index.get(m.joint)].children.push(nodes.length - 1);
}
for (const n of nodes) if (n.children && !n.children.length) delete n.children;

const json = {
  asset: { version: '2.0', generator: 'blockyard mannequin' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes,
  meshes: gltfMeshes,
  materials: MATERIALS.map((m) => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metal, roughnessFactor: m.rough } })),
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
const jsonBuf = pad(Buffer.from(JSON.stringify(json)), 0x20);
const binBuf = pad(Buffer.concat(bin), 0);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
const chunk = (buf, type) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(buf.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, buf]);
};
writeFileSync(OUT, Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]));
console.log(`wrote ${OUT} (${(12 + 16 + jsonBuf.length + binBuf.length) / 1024 | 0} KB)`);
