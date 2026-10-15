import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { ChunkMesher, TerrainGen } from '@engine/voxel_engine.js';
import { loadEngineSync } from '../../src/platform/engine/wasm';
import type { Renderer } from '../../src/platform/render/pipeline';
import type { BiomeMap } from '../../src/platform/render/textures';
import { applyWorldConfig } from '../../src/platform/workers/config';
import type { WorkerPool } from '../../src/platform/workers/pool';
import type { WorkerResponse, WorldGenConfig } from '../../src/platform/workers/protocol';
import { ChunkManager, nearestCopy, wrapColumn } from '../../src/platform/world/chunks';
import { blockIdOf, loadRegistry } from '../../src/platform/world/registry';
import { check } from './_harness';

const R = 4;
const SEA = 60;

/** The engine's workers, here: each job done when `run` says (the generator and mesher the workers use). */
class Jobs {
  meshes: [number, number][] = [];
  genMs = 0;
  meshMs = 0;
  genCount = 0;
  meshCount = 0;
  private queue: (() => void)[] = [];
  private terrain = new TerrainGen(1);
  private mesher = new ChunkMesher();

  constructor(cfg: WorldGenConfig) {
    applyWorldConfig(this.terrain, cfg);
  }
  get waiting() {
    return this.queue.length;
  }
  capacity() {
    return Math.max(0, 64 - this.queue.length);
  }
  gen(cx: number, cz: number, h: (res: WorkerResponse) => void) {
    this.queue.push(() => h({ type: 'gen', id: 0, cx, cz, data: this.terrain.generate(cx, cz), ms: 0 }));
  }
  mesh(cx: number, cz: number, region: Uint8Array, h: (res: WorkerResponse) => void) {
    this.meshes.push([cx, cz]);
    this.queue.push(() => h({ type: 'mesh', id: 0, cx, cz, data: this.mesher.mesh(region), ms: 0 }));
  }
  run() {
    const q = this.queue;
    this.queue = [];
    for (const f of q) f();
  }
}

/** A screen's chunks with no GPU: the scenes are plain, the biome map takes note of where tints went. */
function screen(cfg: WorldGenConfig) {
  const jobs = new Jobs(cfg);
  const renderer = {
    materials: { opaque: new THREE.MeshBasicMaterial(), cutout: new THREE.MeshBasicMaterial(), water: new THREE.MeshBasicMaterial() },
    opaqueScene: new THREE.Scene(),
    waterScene: new THREE.Scene(),
  };
  const tints = new Map<string, Uint8Array>();
  const biome = { upload: (cx: number, cz: number, rgb: Uint8Array) => tints.set(`${cx},${cz}`, rgb) };
  const chunks = new ChunkManager(jobs as unknown as WorkerPool, renderer as unknown as Renderer, biome as unknown as BiomeMap, R);
  /** Frames until nothing's left to load, mesh or show around (x, z). */
  const settle = (x: number, z: number) => {
    for (let i = 0; i < 1000; i++) {
      chunks.update(x, z, 0, -1);
      const s = chunks.stats();
      if (!jobs.waiting && !s.pending && !s.generating && !s.meshing) return;
      jobs.run();
    }
    throw new Error('chunks never settled');
  };
  /** What's drawn: each place's opaque mesh, by "cx,cz" (one each). */
  const drawn = () => {
    const out = new Map<string, THREE.Mesh>();
    for (const o of renderer.opaqueScene.children) {
      const m = o as THREE.Mesh;
      const at = `${m.position.x / 16},${m.position.z / 16}`;
      check(!out.has(at), `two meshes drawn at ${at}`);
      out.set(at, m);
    }
    return out;
  };
  return { jobs, chunks, renderer, tints, settle, drawn };
}

/** The places a column is meshed round (x, z): within the view distance. */
function places(x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= (R + 0.5) * (R + 0.5)) out.push([cx + dx, cz + dz]);
  return out;
}

const vertices = (m: THREE.Mesh | undefined) => (m?.geometry.getAttribute('aData') as THREE.BufferAttribute | undefined)?.array as Uint32Array | undefined;
const same = (a: Uint32Array | undefined, b: Uint32Array | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * A world drawn repeated along x (`client.world.wrap`): every place shows its base column, from
 * one mesh of it (copies share its buffers and are culled each on its own), a camera moved by a
 * whole period sees it all at once with nothing meshed, an edit shows in every copy, the seam is
 * drawn exactly as if the other end's blocks stood there, and unwrapped it's the world as it is.
 */
export default function wrap() {
  loadEngineSync(readFileSync('engine/pkg/voxel_engine_bg.wasm'));

  // The mapping: both ways, any distance.
  const w = { cx0: -2, n: 5 };
  for (const [cx, base] of [[-2, -2], [2, 2], [3, -2], [-3, 2], [-7, -2], [13, -2], [14, -1], [-12, -2], [-13, 2]]) check(wrapColumn(cx, w) === base, `column ${cx} repeats ${base} (got ${wrapColumn(cx, w)})`);
  check(nearestCopy(0, 11, w) === 10 && nearestCopy(0, -11, w) === -10 && nearestCopy(2, 2, w) === 2, 'the copy nearest a place');

  // Blockilization's sea (void with a water slab at 60), three columns repeated (48 blocks, the
  // view sees each two or three times), a stone at each end facing the other across the seam.
  const reg = loadRegistry();
  const stone = blockIdOf(reg, 'stone');
  const cfg: WorldGenConfig = { void: true, ground: { y: SEA, top: blockIdOf(reg, 'water'), fill: blockIdOf(reg, 'sand'), depth: 4 }, terraforms: [], blueprints: [] };
  const P = 48;
  const ends: [number, number, number, number][] = [];
  for (let z = -20; z < 20; z += 3) ends.push([0, SEA + 1, z, stone], [P - 1, SEA + 1, z, stone], [P - 1, SEA + 2, z + 1, stone]);

  const a = screen(cfg);
  a.chunks.mirrorEdits(ends);
  a.chunks.setWrap({ cx0: 0, n: 3 });
  a.settle(8, 8);
  let shown = a.drawn();
  for (const [cx, cz] of places(8, 8)) {
    const m = shown.get(`${cx},${cz}`);
    check(m, `nothing drawn at ${cx},${cz}`);
    // Every copy of a base column holds its one buffer.
    check(m.geometry.getAttribute('aData') === shown.get(`${wrapColumn(cx, { cx0: 0, n: 3 })},${cz}`)?.geometry.getAttribute('aData'), `${cx},${cz} isn't its base column's mesh`);
  }
  check(a.jobs.meshes.every(([cx]) => cx >= 0 && cx < 3), 'only base columns are meshed');
  check(a.tints.get('4,0') === a.tints.get('1,0') && a.tints.get('4,0') !== undefined, "a copy's tint is its base column's");

  // The seam: drawn exactly as a world (not wrapped) where the copies' blocks really stood next to the ends.
  const b = screen(cfg);
  b.chunks.mirrorEdits(ends.flatMap(([x, y, z, id]) => [[x, y, z, id] as [number, number, number, number], [x - P, y, z, id], [x + P, y, z, id]]));
  b.settle(8, 8);
  const plain = screen(cfg);
  plain.chunks.mirrorEdits(ends);
  plain.settle(8, 8);
  const real = b.drawn();
  const unwrapped = plain.drawn();
  for (const cx of [0, 1, 2]) {
    for (let cz = -2; cz <= 2; cz++) {
      check(same(vertices(shown.get(`${cx},${cz}`)), vertices(real.get(`${cx},${cz}`))), `base column ${cx},${cz} isn't meshed as if its neighbours across the seam stood there`);
      // (Not wrapped, the ends' stones see the sea past them; the middle column sees the same either way.)
      const own = same(vertices(shown.get(`${cx},${cz}`)), vertices(unwrapped.get(`${cx},${cz}`)));
      if (cx === 1) check(own, `the middle column ${cx},${cz} changed`);
      else if (cz >= -1 && cz <= 1) check(!own, `${cx},${cz} doesn't see across the seam`);
    }
  }

  // A camera moved by a whole period: drawn at once (no pop-in), nothing meshed.
  const meshedBefore = a.jobs.meshes.length;
  a.chunks.update(8 + P, 8, 0, -1);
  shown = a.drawn();
  for (const [cx, cz] of places(8 + P, 8)) check(shown.has(`${cx},${cz}`), `nothing drawn at ${cx},${cz} the moment the camera moved a period`);
  a.settle(8 + P, 8);
  check(a.jobs.meshes.length === meshedBefore, `moving a period meshed ${a.jobs.meshes.length - meshedBefore} columns`);
  // ... and many periods west, moved after this frame's update (as client code moves the camera):
  // drawn there before the next, and still only the base columns, never meshed again.
  a.chunks.follow(8 - 7 * P, 8);
  shown = a.drawn();
  for (const [cx, cz] of places(8 - 7 * P, 8)) check(shown.has(`${cx},${cz}`), `nothing drawn at ${cx},${cz} once followed`);
  a.settle(8 - 7 * P, 8);
  check(a.jobs.meshes.length === meshedBefore, `moving seven periods west meshed ${a.jobs.meshes.length - meshedBefore} columns`);
  // Each frame the runtime streams round the camera as the server has it, then follows the one
  // client code took: the copies stay round the one drawn from, nothing remade frame after frame.
  a.chunks.follow(8 - 7 * P, 8);
  const steady = a.drawn();
  for (let i = 0; i < 5; i++) {
    a.chunks.update(8 + 40, 8 + 40, 0, -1);
    a.chunks.follow(8 - 7 * P, 8);
  }
  const kept = a.drawn();
  check(kept.size === steady.size && [...steady].every(([k, m]) => kept.get(k) === m), 'the copies stay round where the screen draws from');

  // An edit at the seam: in every copy at once, its neighbour across the seam remeshed with it.
  const at = 8 - 7 * P;
  const old = a.drawn();
  a.chunks.mirrorEdits([[0, SEA + 1, 40, stone]]);
  const asked = new Set(a.jobs.meshes.slice(meshedBefore).map(([cx, cz]) => `${cx},${cz}`));
  check(asked.has('0,2') && asked.has('2,2') && asked.size <= 9 && [...asked].every((c) => Number(c.split(',')[0]) < 3), `remeshed for the edit: ${[...asked].join(' ')}`);
  a.settle(at, 8);
  shown = a.drawn();
  for (const [cx, cz] of places(at, 8)) {
    const was = old.get(`${cx},${cz}`)?.geometry.getAttribute('aData');
    const now = shown.get(`${cx},${cz}`)?.geometry.getAttribute('aData');
    const edited = asked.has(`${wrapColumn(cx, { cx0: 0, n: 3 })},${cz}`);
    check(edited ? now !== was : now === was, `${cx},${cz} ${edited ? "doesn't show" : 'remeshed for'} the edit`);
  }
  // Only drawn: the blocks here are the world's own (a copy's place has the sea's, not the stone).
  check(a.chunks.getBlock(0, SEA + 1, 40) === stone && a.chunks.getBlock(-7 * P, SEA + 1, 40) === 0, 'blocks past the base columns are their own');

  // Culled each on its own: two copies of one column, one in view, one behind the camera.
  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 400);
  camera.position.set(at + 8, SEA + 60, 8 + 40);
  camera.lookAt(at + 8, SEA, 8);
  camera.updateMatrixWorld();
  a.chunks.applyMainVisibility(camera);
  const cxAt = Math.floor(at / 16);
  const ahead = shown.get(`${cxAt},0`);
  const aside = shown.get(`${cxAt + 3},0`);
  check(ahead?.visible && ahead.geometry.drawRange.count > 0, 'a copy in view is drawn');
  check(aside && !aside.visible && ahead.geometry.getAttribute('aData') === aside.geometry.getAttribute('aData'), 'a copy of the same column out of view is not');

  // Unwrapped: no copies, every column drawn as itself (the base columns' meshes shown again at once).
  a.chunks.setWrap(null);
  a.settle(8, 8);
  shown = a.drawn();
  // (All a screen never wrapped draws: at the view's edge, a column whose neighbours aren't loaded isn't meshed. Base
  // columns meshed while wrapped stay drawn, as a column meshed while nearer does.)
  const extra = [...shown.keys()].filter((k) => !unwrapped.has(k));
  check([...unwrapped.keys()].every((k) => shown.has(k)) && extra.every((k) => Number(k.split(',')[0]) < 3), `unwrapped, drawn: ${[...shown.keys()].join(' ')}`);
  check(shown.get('3,0')?.geometry.getAttribute('aData') !== shown.get('0,0')?.geometry.getAttribute('aData'), 'unwrapped, a column is its own');
  for (const cx of [-1, 3, 4]) check(same(vertices(shown.get(`${cx},-1`)), vertices(unwrapped.get(`${cx},-1`))), `column ${cx},-1 unwrapped isn't the world's own`);
  a.chunks.dispose();
  b.chunks.dispose();
  plain.chunks.dispose();
}
