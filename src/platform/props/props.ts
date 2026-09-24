import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef, Prop, PropApi, PropModel, Vec3 } from '../api/types';
import type { Blueprint } from '../api/blueprint';
import type { Registry } from '../world/registry';
import type { SharedUniforms } from '../render/pipeline';
import { Shaders } from '../render/shaders';

export interface PropServices {
  shared: SharedUniforms;
  albedo: THREE.Texture;
  material: THREE.Texture;
  registry: Registry;
  resolve: (block: BlockRef) => number;
  scene: THREE.Scene;
  fxScene: THREE.Scene;
  world: VoxelWorld;
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

class PropModelImpl implements PropModel {
  constructor(
    readonly geometry: THREE.BufferGeometry,
    readonly radius: number,
    readonly blocks: number,
  ) {}
}

class PropImpl implements Prop {
  removed = false;
  probeTimer = Math.random() * 0.2;
  flashT = 0;
  flashColor = new THREE.Color();

  constructor(
    readonly object: THREE.Object3D,
    readonly material: THREE.RawShaderMaterial | null,
    private onRemove: (p: PropImpl) => void,
  ) {}

  get position(): THREE.Vector3 {
    return this.object.position;
  }
  get quaternion(): THREE.Quaternion {
    return this.object.quaternion;
  }
  get scale(): number {
    return this.object.scale.x;
  }
  set scale(s: number) {
    this.object.scale.setScalar(s);
  }
  get visible(): boolean {
    return this.object.visible;
  }
  set visible(v: boolean) {
    this.object.visible = v;
  }

  flash(color = '#ffffff', seconds = 0.12) {
    this.flashColor.set(color);
    this.flashT = seconds;
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.onRemove(this);
  }
}

/** The scene object behind a prop (platform-internal). */
export function propObject(p: Prop): THREE.Object3D {
  return (p as PropImpl).object;
}

/** Movable objects: block builds drawn with the world's textures, and glowing bolts. */
export class PropSystem implements PropApi {
  private props: PropImpl[] = [];
  private shadow: THREE.RawShaderMaterial;
  private boltGeo: THREE.BufferGeometry;

  constructor(private s: PropServices) {
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
   * Mesh a Blueprint once: visible faces only, per-vertex ambient occlusion, block textures.
   * `pivot` (blueprint coordinates, default 0,0,0) becomes the prop's origin; `scale` is the size
   * of one block in world units.
   */
  model(bp: Blueprint, opts: { scale?: number; pivot?: Vec3 } = {}): PropModel {
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
    let r2 = 0;
    let count = 0;
    for (let y = 1; y < H - 1; y++)
      for (let z = 1; z < D - 1; z++)
        for (let x = 1; x < W - 1; x++) {
          const id = ids[at(x, y, z)];
          if (id === 0) continue;
          const def = blocks[id];
          if (!def || def.shape !== 'cube') continue;
          count++;
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
              r2 = Math.max(r2, px * px + py * py + pz * pz);
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
    return new PropModelImpl(g, Math.sqrt(r2), count);
  }

  spawn(model: PropModel, opts: { position?: Vec3; scale?: number } = {}): Prop {
    const m = model as PropModelImpl;
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
    const mesh = new THREE.Mesh(m.geometry, material);
    mesh.customDepthMaterial = this.shadow;
    if (opts.position) mesh.position.set(opts.position.x, opts.position.y, opts.position.z);
    if (opts.scale) mesh.scale.setScalar(opts.scale);
    this.s.scene.add(mesh);
    const p = new PropImpl(mesh, material, (x) => this.drop(x));
    this.props.push(p);
    return p;
  }

  bolt(opts: { color: string; length?: number; width?: number; intensity?: number }): Prop {
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
    // Scale is fixed by the bolt's shape; `prop.scale` multiplies it.
    const holder = new THREE.Group();
    holder.add(mesh);
    this.s.fxScene.add(holder);
    const p = new PropImpl(holder, null, (x) => this.drop(x));
    this.props.push(p);
    return p;
  }

  private drop(p: PropImpl) {
    p.object.removeFromParent();
    p.material?.dispose();
    if (!p.material) ((p.object.children[0] as THREE.Mesh).material as THREE.Material).dispose();
    const i = this.props.indexOf(p);
    if (i >= 0) this.props.splice(i, 1);
  }

  /** Per frame: light probes (staggered) and hit flashes. */
  update(dt: number) {
    for (const p of this.props) {
      if (!p.material) continue;
      const u = p.material.uniforms;
      p.probeTimer -= dt;
      if (p.probeTimer <= 0) {
        p.probeTimer = 0.2;
        const o = p.object.position;
        const l = this.s.world.light_probe(Math.floor(o.x), Math.floor(o.y), Math.floor(o.z));
        (u.uProbe.value as THREE.Vector2).set(l[0], l[1]);
      }
      const tint = u.uTint.value as THREE.Vector4;
      if (p.flashT > 0) {
        p.flashT -= dt;
        tint.set(p.flashColor.r * 2, p.flashColor.g * 2, p.flashColor.b * 2, Math.min(0.85, p.flashT * 8));
      } else {
        tint.w = 0;
      }
    }
  }

  clear() {
    for (const p of [...this.props]) p.remove();
  }
}
