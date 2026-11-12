import { readFileSync } from 'node:fs';
import { check } from './_harness';
import { SPECIES, type SpeciesId } from '../../src/games/blocktaceous/species';

/**
 * The two-legged animals' models (`src/games/blocktaceous/tools/bipeds/build.mjs` writes them):
 * each file read back and held to the contract the creatures' rules rely on: its size is its
 * species', it stands on the ground over the origin facing +z, it has the nodes and the clips by
 * name, and it's one small skinned mesh.
 */
const BIPEDS: SpeciesId[] = ['tyrannosaurus', 'utahraptor', 'carnotaurus', 'dilophosaurus', 'spinosaurus', 'parasaurolophus', 'compsognathus', 'dodo'];
const CLIPS: Record<string, { loop: boolean; seconds?: number }> = {
  idle: { loop: true },
  walk: { loop: true },
  run: { loop: true },
  attack: { loop: false, seconds: 0.5 },
  eat: { loop: true },
  sleep: { loop: true },
  roar: { loop: false },
};
const BONES = ['hips', 'chest', 'neck', 'head', 'jaw', 'armL', 'armR', 'tail1', 'thighL', 'shinL', 'metaL', 'footL', 'thighR', 'shinR', 'metaR', 'footR'];
const MAX_TRIANGLES = 12500;
const MAX_BYTES = 200 * 1024;

interface Gltf {
  scenes: { nodes: number[] }[];
  nodes: { name: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number; skin?: number; extras?: Record<string, number> }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number }[] }[];
  materials: unknown[];
  skins: { joints: number[]; inverseBindMatrices: number }[];
  accessors: { count: number; min?: number[]; max?: number[]; bufferView: number; byteOffset?: number }[];
  bufferViews: { byteOffset: number; byteLength: number; buffer: number }[];
  animations: { name: string; samplers: { input: number; output: number }[]; channels: { sampler: number; target: { node: number; path: string } }[] }[];
}

export default function blocktaceousBipeds() {
  for (const id of BIPEDS) {
    const buf = readFileSync(`src/games/blocktaceous/models/${id}.glb`);
    const fail = (m: string) => check(false, `${id}.glb: ${m}`);
    check(buf.readUInt32LE(0) === 0x46546c67 && buf.readUInt32LE(8) === buf.length, `${id}.glb: not a GLB`);
    const jsonLength = buf.readUInt32LE(12);
    const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8')) as Gltf;
    const bin = buf.subarray(20 + jsonLength + 8);
    const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
    const root = json.nodes[json.scenes[0].nodes[0]];
    if (root.name !== id) fail(`its root is ${root.name}`);
    if (root.scale || root.rotation || root.translation) fail('its root is moved, turned or scaled');
    for (const name of [...BONES, 'saddle']) if (!byName.has(name)) fail(`no node ${name}`);
    for (const n of json.nodes) if (n.rotation || n.scale) fail(`${n.name} rests turned or scaled`);
    if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1 || json.materials.length !== 1) fail('not one mesh of one material');
    const prim = json.meshes[0].primitives[0];
    const triangles = json.accessors[prim.indices].count / 3;
    if (triangles > MAX_TRIANGLES) fail(`${triangles} triangles`);
    if (buf.length > MAX_BYTES) fail(`${buf.length} bytes`);
    // Its size: positions are whole voxels, the voxel's size the scale of the bind matrices.
    const skin = json.skins[0];
    const ibm = json.accessors[skin.inverseBindMatrices];
    const view = json.bufferViews[ibm.bufferView];
    const voxel = bin.readFloatLE(view.byteOffset + (ibm.byteOffset ?? 0));
    const pos = json.accessors[prim.attributes.POSITION];
    const lo = pos.min!.map((v) => v * voxel);
    const hi = pos.max!.map((v) => v * voxel);
    const s = SPECIES[id];
    const length = hi[2] - lo[2];
    if (Math.abs(lo[1]) > 1e-6) fail(`its feet are at y = ${lo[1]}`);
    if (Math.abs(length - s.length) > s.length * 0.06) fail(`it is ${length.toFixed(2)} long, its species ${s.length}`);
    if (Math.abs(hi[1] - s.height) > s.height * 0.1) fail(`it is ${hi[1].toFixed(2)} tall, its species ${s.height}`);
    if (Math.abs(hi[0] + lo[0]) > 1e-6) fail('it is not centred across');
    // It faces +z: the head ahead of the hips, the tail behind; the hips over the origin.
    const at = (name: string) => {
      const p = [0, 0, 0];
      const parent = new Map<number, number>();
      json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parent.set(c, i)));
      for (let i = byName.get(name); i !== undefined; i = parent.get(i)) (json.nodes[i].translation ?? [0, 0, 0]).forEach((v, a) => (p[a] += v));
      return p;
    };
    if (at('head')[2] <= 0 || at('tail1')[2] >= 0) fail('it does not face +z');
    if (Math.abs(at('hips')[0]) > 1e-6 || Math.abs(at('hips')[2]) > s.length * 0.05) fail('its hips are not over the origin');
    const saddle = at('saddle');
    if (saddle[1] < s.height * 0.5 || saddle[1] > hi[1]) fail(`its saddle is at ${saddle}`);
    // The clips.
    for (const [name, want] of Object.entries(CLIPS)) {
      const clip = json.animations.find((c) => c.name === name);
      if (!clip) {
        fail(`no clip ${name}`);
        continue;
      }
      const seconds = Math.max(...clip.samplers.map((sm) => json.accessors[sm.input].max![0]));
      if (want.seconds !== undefined && Math.abs(seconds - want.seconds) > 0.01) fail(`${name} lasts ${seconds} s`);
      if (seconds <= 0 || seconds > 8) fail(`${name} lasts ${seconds} s`);
      if (!clip.channels.some((c) => json.nodes[c.target.node].name.startsWith('thigh')) && name !== 'attack') fail(`${name} does not move the legs`);
      // A loop ends as it began; a clip played once starts and ends at rest.
      for (const c of clip.channels) {
        const sm = clip.samplers[c.sampler];
        const out = json.accessors[sm.output];
        if (out.count < 2) continue;
        const v = json.bufferViews[out.bufferView];
        const o = v.byteOffset + (out.byteOffset ?? 0);
        const n = c.target.path === 'rotation' ? 4 : 3;
        const read = (k: number, a: number) => (n === 4 ? bin.readInt16LE(o + (k * 4 + a) * 2) / 32767 : bin.readFloatLE(o + (k * 3 + a) * 4));
        for (let a = 0; a < n; a++) if (Math.abs(read(0, a) - read(out.count - 1, a)) > 2e-3) fail(`${name} does not end where it began (${json.nodes[c.target.node].name})`);
        if (!want.loop && n === 4 && Math.abs(Math.abs(read(0, 3)) - 1) > 1e-3) fail(`${name} does not start at rest (${json.nodes[c.target.node].name})`);
      }
    }
  }
}
