import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef, Vec3 } from '../api/types';
import { Blueprint } from '../api/blueprint';
import type { Registry } from '../world/registry';
import type { SharedUniforms } from '../render/pipeline';
import type { Content } from '../content';
import type { PropFrame } from '../sim/props';
import { Shaders } from '../render/shaders';

export interface PropViewParts {
  shared: SharedUniforms;
  albedo: THREE.Texture;
  material: THREE.Texture;
  registry: Registry;
  resolve: (block: BlockRef) => number;
  scene: THREE.Scene;
  fxScene: THREE.Scene;
  world: VoxelWorld;
  content: Content;
}

// Faces in engine order (+X, -X, +Y, -Y, +Z, -Z): normal, and in-plane axes u (right) and v (up)
// with u x v = n, so corners (-u-v, +u-v, +u+v, -u+v) wind counter-clockwise from outside.
const FACES: { n: number[]; u: number[]; v: number[] }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const AO_LEVELS = [0.45, 0.64, 0.82, 1];

interface Shown {
  object: THREE.Object3D;
  /** Block builds light and flash; bolts glow on their own. */
  material: THREE.RawShaderMaterial | null;
  probeTimer: number;
}

const tmpColor = new THREE.Color();

/**
 * Draws the simulation's props: block builds meshed with the world's textures (lit, shadowed,
 * glowing blocks glow) and bolts. Also makes local block cubes (items lying on the ground).
 */
export class PropView {
  private shown = new Map<number, Shown>();
  private local = new Set<Shown>();
  private geometries = new Map<number, THREE.BufferGeometry>();
  private cubes = new Map<string, THREE.BufferGeometry>();
  private shadow: THREE.RawShaderMaterial;
  private boltGeo: THREE.BufferGeometry;

  constructor(private s: PropViewParts) {
    this.shadow = new THREE.RawShaderMaterial({
      vertexShader: Shaders.propShadow.vertex,
      fragmentShader: Shaders.propShadow.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: { uAlbedo: { value: s.albedo } },
      side: THREE.DoubleSide,
      colorWrite: false,
    });
    // Two crossed quads along -z (the direction of travel), 1 long and 1 wide.
    const a = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
    const b = a.clone().rotateZ(Math.PI / 2);
    const merged = new THREE.BufferGeometry();
    const pos = [...a.attributes.position.array, ...b.attributes.position.array];
    const uv = [...a.attributes.uv.array, ...b.attributes.uv.array];
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    merged.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
    this.boltGeo = merged;
  }

  /**
   * Mesh a Blueprint: visible faces only, per-vertex ambient occlusion, block textures. `pivot`
   * (blueprint coordinates) becomes the origin; `scale` is the size of one block in world units.
   */
  mesh(bp: Blueprint, opts: { scale?: number; pivot?: Vec3 } = {}): THREE.BufferGeometry {
    const scale = opts.scale ?? 1;
    const pv = opts.pivot ?? { x: 0, y: 0, z: 0 };
    const { origin: o, size } = bp;
    const W = size.x + 2;
    const H = size.y + 2;
    const D = size.z + 2;
    const ids = new Uint8Array(W * H * D);
    const at = (x: number, y: number, z: number) => (y * D + z) * W + x;
    bp.forEach((x, y, z, block) => {
      ids[at(x - o.x + 1, y - o.y + 1, z - o.z + 1)] = this.s.resolve(block);
    });
    const blocks = this.s.registry.blocks;
    const opaque = (id: number) => id !== 0 && blocks[id]?.shape === 'cube' && blocks[id].layer === 0;

    const pos: number[] = [];
    const nrm: number[] = [];
    const uvs: number[] = [];
    const lay: number[] = [];
    const aos: number[] = [];
    const idx: number[] = [];
    for (let y = 1; y < H - 1; y++)
      for (let z = 1; z < D - 1; z++)
        for (let x = 1; x < W - 1; x++) {
          const id = ids[at(x, y, z)];
          if (id === 0) continue;
          const def = blocks[id];
          if (!def || def.shape !== 'cube') continue;
          for (let f = 0; f < 6; f++) {
            const { n, u, v } = FACES[f];
            const nb = ids[at(x + n[0], y + n[1], z + n[2])];
            if (opaque(nb) || nb === id) continue;
            const base = pos.length / 3;
            const ao: number[] = [];
            for (const [su, sv] of CORNERS) {
              // Corner position (cell centre + half-steps), relative to the pivot.
              const cx = x - 1 + o.x + 0.5 + 0.5 * (n[0] + su * u[0] + sv * v[0]);
              const cy = y - 1 + o.y + 0.5 + 0.5 * (n[1] + su * u[1] + sv * v[1]);
              const cz = z - 1 + o.z + 0.5 + 0.5 * (n[2] + su * u[2] + sv * v[2]);
              const px = (cx - pv.x) * scale;
              const py = (cy - pv.y) * scale;
              const pz = (cz - pv.z) * scale;
              pos.push(px, py, pz);
              nrm.push(n[0], n[1], n[2]);
              uvs.push((su + 1) / 2, (sv + 1) / 2);
              lay.push(def.tex[f]);
              // Minecraft-style corner occlusion from the three blocks in front of the corner.
              const fx = x + n[0];
              const fy = y + n[1];
              const fz = z + n[2];
              const s1 = opaque(ids[at(fx + su * u[0], fy + su * u[1], fz + su * u[2])]) ? 1 : 0;
              const s2 = opaque(ids[at(fx + sv * v[0], fy + sv * v[1], fz + sv * v[2])]) ? 1 : 0;
              const c = opaque(ids[at(fx + su * u[0] + sv * v[0], fy + su * u[1] + sv * v[1], fz + su * u[2] + sv * v[2])]) ? 1 : 0;
              const level = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
              ao.push(level);
              aos.push(AO_LEVELS[level]);
            }
            // Split along the brighter diagonal to avoid AO streaks.
            if (ao[0] + ao[2] >= ao[1] + ao[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('layer', new THREE.Float32BufferAttribute(lay, 1));
    g.setAttribute('ao', new THREE.Float32BufferAttribute(aos, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  private blockMesh(geometry: THREE.BufferGeometry): Shown {
    const material = new THREE.RawShaderMaterial({
      vertexShader: Shaders.prop.vertex,
      fragmentShader: Shaders.prop.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...this.s.shared,
        uAlbedo: { value: this.s.albedo },
        uMaterial: { value: this.s.material },
        uProbe: { value: new THREE.Vector2(1, 0) },
        uTint: { value: new THREE.Vector4(1, 1, 1, 0) },
      },
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.customDepthMaterial = this.shadow;
    this.s.scene.add(mesh);
    return { object: mesh, material, probeTimer: Math.random() * 0.2 };
  }

  private boltMesh(opts: { color: string; length?: number; width?: number; intensity?: number }): Shown {
    const mat = new THREE.RawShaderMaterial({
      vertexShader: Shaders.fx.vertex,
      fragmentShader: Shaders.fx.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uColor: { value: new THREE.Color(opts.color) },
        uIntensity: { value: opts.intensity ?? 4 },
        uTime: { value: 0 },
        uMode: { value: 3 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.boltGeo, mat);
    mesh.scale.set(opts.width ?? 0.18, opts.width ?? 0.18, opts.length ?? 3);
    mesh.frustumCulled = false;
    // Scale is fixed by the bolt's shape; the prop's scale multiplies it.
    const holder = new THREE.Group();
    holder.add(mesh);
    this.s.fxScene.add(holder);
    return { object: holder, material: null, probeTimer: 0 };
  }

  private drop(v: Shown) {
    v.object.removeFromParent();
    if (v.material) v.material.dispose();
    else ((v.object.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  }

  private geometry(model: number): THREE.BufferGeometry | null {
    let g = this.geometries.get(model);
    if (!g) {
      const m = this.s.content.models.get(model);
      if (!m) return null;
      g = this.mesh(m.blueprint, m.opts);
      this.geometries.set(model, g);
    }
    return g;
  }

  /** A little cube of a block, drawn until `remove` (items lying on the ground). */
  localCube(block: string, size: number): { object: THREE.Object3D; remove(): void } {
    let g = this.cubes.get(block);
    if (!g) {
      g = this.mesh(new Blueprint({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }).set(0, 0, 0, block), { pivot: { x: 0.5, y: 0.5, z: 0.5 } });
      this.cubes.set(block, g);
    }
    const v = this.blockMesh(g);
    v.object.scale.setScalar(size);
    this.local.add(v);
    return {
      object: v.object,
      remove: () => {
        if (!this.local.delete(v)) return;
        this.drop(v);
      },
    };
  }

  sync(frames: PropFrame[], dt: number) {
    const seen = new Set<number>();
    for (const f of frames) {
      seen.add(f.id);
      let v = this.shown.get(f.id);
      if (!v) {
        if (f.bolt) v = this.boltMesh(f.bolt);
        else {
          const g = f.model !== undefined ? this.geometry(f.model) : null;
          if (!g) continue;
          v = this.blockMesh(g);
        }
        this.shown.set(f.id, v);
      }
      const o = v.object;
      o.position.set(f.p[0], f.p[1], f.p[2]);
      o.quaternion.set(f.q[0], f.q[1], f.q[2], f.q[3]);
      o.scale.setScalar(f.scale);
      o.visible = f.visible;
      if (v.material) {
        const tint = v.material.uniforms.uTint.value as THREE.Vector4;
        if (f.flash) {
          tmpColor.set(f.flash[0]);
          tint.set(tmpColor.r * 2, tmpColor.g * 2, tmpColor.b * 2, Math.min(0.85, f.flash[1] * 8));
        } else tint.w = 0;
      }
    }
    for (const [id, v] of this.shown) {
      if (seen.has(id)) continue;
      this.drop(v);
      this.shown.delete(id);
    }
    for (const v of this.shown.values()) this.probe(v, dt);
    for (const v of this.local) this.probe(v, dt);
  }

  /** Light probes, staggered. */
  private probe(v: Shown, dt: number) {
    if (!v.material) return;
    v.probeTimer -= dt;
    if (v.probeTimer > 0) return;
    v.probeTimer = 0.2;
    const o = v.object.position;
    const l = this.s.world.light_probe(Math.floor(o.x), Math.floor(o.y), Math.floor(o.z));
    (v.material.uniforms.uProbe.value as THREE.Vector2).set(l[0], l[1]);
  }

  clear() {
    for (const v of this.shown.values()) this.drop(v);
    this.shown.clear();
  }
}
