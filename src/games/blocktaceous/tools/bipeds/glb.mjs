/**
 * A binary glTF for an animated voxel figure: a tree of named nodes (a bone per rigid part, each
 * with a translation only), one skinned mesh of one material, and animation clips. It is the
 * fighters' layout (`tools/voxel.mjs` `writeGlb`) with what that writer leaves out: clips, 16-bit
 * positions (a big animal is more than 255 voxels long) and a nearest-neighbour sampler (the atlas
 * holds two texels a voxel face, as the platform's characters' does).
 *
 * - Vertices: KHR_mesh_quantization (positions as voxel coordinates, the voxel size in the inverse
 *   bind matrices; normals as bytes), through EXT_meshopt_compression.
 * - Clips: one sampler a channel, LINEAR; rotations as normalized 16-bit quaternions, translations
 *   as floats; channels with the same key times share one time accessor.
 */
import { encodeIndexSequence, encodeVertexBuffer } from '../meshopt.mjs';

/**
 * The indices of quads each on four new vertices in order (n, n+1, n+2, then n, n+2, n+3) in
 * meshopt's triangle codec (EXT_meshopt_compression's TRIANGLES mode, version 1): a byte a
 * triangle. The first of a quad is three new vertices (code 0xf0: the codeaux table's entry 0,
 * which is 0), the second the last edge pushed (n, n+2) and one new vertex (code 0x00); neither
 * needs any data bytes. `tools/meshopt.mjs` writes only the index-sequence codec, a byte an index.
 */
function encodeQuadIndices(idx) {
  for (let i = 0; i < idx.length; i += 6) {
    const n = (i / 6) * 4;
    if (idx[i] !== n || idx[i + 1] !== n + 1 || idx[i + 2] !== n + 2 || idx[i + 3] !== n || idx[i + 4] !== n + 2 || idx[i + 5] !== n + 3) throw new Error('not quads in order');
  }
  const out = new Uint8Array(1 + idx.length / 3 + 16);
  out[0] = 0xe1;
  for (let t = 0; t < idx.length / 3; t++) out[1 + t] = t % 2 ? 0x00 : 0xf0;
  out.set([0x00, 0x76, 0x87, 0x56, 0x67, 0x78, 0xa9, 0x86, 0x65, 0x89, 0x68, 0x98, 0x01, 0x69, 0, 0], out.length - 16);
  return out;
}

const COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAY = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

/**
 * `nodes` (node 0 the root), `attributes` ({ NAME: { values, componentType, type, normalized,
 * minmax } }), `indices`, `skin` ({ joints, skeleton, inverseBindMatrices }), `material` ({ name,
 * albedo, mr, glow }: PNG buffers), `animations` ([{ name, channels: [{ node, path, times, values
 * }] }]).
 */
export function writeGlb({ generator, nodes, sceneName, meshName, meshNode, attributes, indices, skin, material, animations = [], extras, quadIndices = false }) {
  const bin = [];
  let offset = 0;
  const views = [];
  const accessors = [];
  const put = (buf) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) bin.push(Buffer.alloc(pad)), (offset += pad);
    bin.push(buf);
    offset += buf.length;
    return offset - buf.length;
  };
  let fallback = 0;
  const count = Object.values(attributes)[0].values.length / TYPE_SIZE[Object.values(attributes)[0].type];
  const attrOut = {};
  for (const [name, a] of Object.entries(attributes)) {
    const n = TYPE_SIZE[a.type];
    const cs = COMPONENT[a.componentType];
    const stride = Math.ceil((n * cs) / 4) * 4;
    const raw = Buffer.alloc(count * stride);
    const Arr = ARRAY[a.componentType];
    for (let i = 0; i < count; i++) {
      const el = new Arr(raw.buffer, raw.byteOffset + i * stride, n);
      for (let c = 0; c < n; c++) el[c] = a.values[i * n + c];
    }
    const enc = encodeVertexBuffer(raw, count, stride);
    const at = put(Buffer.from(enc));
    views.push({ buffer: 1, byteOffset: fallback, byteLength: raw.length, byteStride: stride, target: 34962, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: at, byteLength: enc.length, byteStride: stride, mode: 'ATTRIBUTES', count } } });
    fallback += Math.ceil(raw.length / 4) * 4;
    const acc = { bufferView: views.length - 1, componentType: a.componentType, count, type: a.type, ...(a.normalized ? { normalized: true } : {}) };
    if (a.minmax) {
      acc.min = [];
      acc.max = [];
      for (let c = 0; c < n; c++) {
        let lo = Infinity, hi = -Infinity;
        for (let i = c; i < a.values.length; i += n) (lo = Math.min(lo, a.values[i])), (hi = Math.max(hi, a.values[i]));
        acc.min.push(lo);
        acc.max.push(hi);
      }
    }
    accessors.push(acc);
    attrOut[name] = accessors.length - 1;
  }
  const big = count > 65535;
  const idx = big ? new Uint32Array(indices) : new Uint16Array(indices);
  {
    const enc = quadIndices ? encodeQuadIndices(idx) : encodeIndexSequence(idx);
    const at = put(Buffer.from(enc));
    views.push({ buffer: 1, byteOffset: fallback, byteLength: idx.byteLength, target: 34963, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: at, byteLength: enc.length, byteStride: big ? 4 : 2, mode: quadIndices ? 'TRIANGLES' : 'INDICES', count: idx.length } } });
    fallback += Math.ceil(idx.byteLength / 4) * 4;
    accessors.push({ bufferView: views.length - 1, componentType: big ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
  }
  const indicesAcc = accessors.length - 1;
  /** Plain (uncompressed) data as an accessor. */
  const plain = (typed, componentType, type, more = {}) => {
    views.push({ buffer: 0, byteOffset: put(Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength)), byteLength: typed.byteLength });
    accessors.push({ bufferView: views.length - 1, componentType, count: typed.length / TYPE_SIZE[type], type, ...more });
    return accessors.length - 1;
  };
  const skins = [{ name: skin.name, inverseBindMatrices: plain(skin.inverseBindMatrices, 5126, 'MAT4'), joints: skin.joints, skeleton: skin.skeleton }];
  // Clips: all their keys in one buffer view, an accessor each (the same data written once).
  const animData = [];
  let animLen = 0;
  const animView = views.length;
  views.push({ buffer: 0, byteOffset: 0, byteLength: 0 });
  const made = new Map();
  const animAcc = (typed, componentType, type, more = {}) => {
    const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const key = `${componentType}|${type}|${buf.toString('base64')}`;
    let acc = made.get(key);
    if (acc === undefined) {
      accessors.push({ bufferView: animView, byteOffset: animLen, componentType, count: typed.length / TYPE_SIZE[type], type, ...more });
      acc = accessors.length - 1;
      made.set(key, acc);
      animData.push(buf);
      animLen += buf.length;
      const pad = (4 - (animLen % 4)) % 4;
      if (pad) animData.push(Buffer.alloc(pad)), (animLen += pad);
    }
    return acc;
  };
  const anims = animations.map((clip) => {
    const samplers = [];
    const channels = [];
    for (const ch of clip.channels) {
      const input = animAcc(Float32Array.from(ch.times), 5126, 'SCALAR', { min: [Math.fround(ch.times[0])], max: [Math.fround(ch.times[ch.times.length - 1])] });
      const output =
        ch.path === 'rotation'
          ? animAcc(Int16Array.from(ch.values, (v) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)))), 5122, 'VEC4', { normalized: true })
          : animAcc(Float32Array.from(ch.values), 5126, 'VEC3');
      samplers.push({ input, output });
      channels.push({ sampler: samplers.length - 1, target: { node: ch.node, path: ch.path } });
    }
    return { name: clip.name, samplers, channels };
  });
  if (animLen) {
    views[animView].byteOffset = put(Buffer.concat(animData));
    views[animView].byteLength = animLen;
  } else views[animView] = { buffer: 0, byteOffset: put(Buffer.alloc(4)), byteLength: 4 };
  const images = [];
  const addImage = (name, pngBuf) => {
    views.push({ buffer: 0, byteOffset: put(pngBuf), byteLength: pngBuf.length });
    images.push({ name, bufferView: views.length - 1, mimeType: 'image/png' });
    return images.length - 1;
  };
  addImage(`${material.name}_albedo`, material.albedo);
  // An animal is matt all over: no metallic-roughness or emissive image unless one is given.
  const mr = material.mr ? addImage(`${material.name}_metal_rough`, material.mr) : -1;
  const glow = material.glow ? addImage(`${material.name}_glow`, material.glow) : -1;
  const exts = ['EXT_meshopt_compression', 'KHR_mesh_quantization'];
  nodes[meshNode].mesh = 0;
  nodes[meshNode].skin = 0;
  const json = {
    asset: { version: '2.0', generator },
    extensionsUsed: exts,
    extensionsRequired: exts,
    scene: 0,
    scenes: [{ name: sceneName, nodes: [0] }],
    nodes,
    meshes: [{ name: meshName, primitives: [{ attributes: attrOut, indices: indicesAcc, material: 0 }] }],
    skins,
    ...(anims.length ? { animations: anims } : {}),
    materials: [
      {
        name: material.name,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: mr >= 0 ? 1 : 0, roughnessFactor: 1, ...(mr >= 0 ? { metallicRoughnessTexture: { index: mr } } : {}) },
        ...(glow >= 0 ? { emissiveTexture: { index: glow }, emissiveFactor: [1, 1, 1] } : {}),
      },
    ],
    textures: images.map((_, i) => ({ sampler: 0, source: i })),
    // Nearest when magnified: the voxels stay crisp up close.
    samplers: [{ magFilter: 9728, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: 0 }, { byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }],
    ...(extras ? { extras } : {}),
  };
  const tail = (4 - (offset % 4)) % 4;
  if (tail) bin.push(Buffer.alloc(tail));
  const binBuf = Buffer.concat(bin);
  json.buffers[0].byteLength = binBuf.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
}
