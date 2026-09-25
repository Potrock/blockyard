import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GltfSpec, HeldModelSpec, ModelSpec } from '../api/types';
import type { SharedUniforms } from '../render/pipeline';
import { Shaders } from '../render/shaders';
import type { AnimState, Figure } from '../render/entities';
import { HumanoidRig, type HeldInfo } from './humanoid';

/** A model without an emissive map glows nowhere. */
const BLACK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

/** A model without a metallic-roughness map: its factors alone. */
const WHITE = (() => {
  const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

/** How a model's surface shines: glTF's metallic-roughness (map G roughness, B metalness, times the factors). */
export interface Surface {
  map: THREE.Texture | null;
  metal: number;
  rough: number;
}

/** The platform's own look: matte, not metal. */
export const MATTE: Surface = { map: null, metal: 0, rough: 1 };

/** A glTF material's surface. */
export function surfaceOf(m: THREE.MeshStandardMaterial | undefined): Surface {
  if (!m || !('metalness' in m)) return MATTE;
  return { map: m.roughnessMap ?? m.metalnessMap ?? null, metal: m.metalness ?? 0, rough: m.roughness ?? 1 };
}

/** Change a material's surface (its uniforms from `surfaceUniforms`, changed in place). */
export function setSurface(uniforms: Record<string, THREE.IUniform>, s: Surface = MATTE) {
  uniforms.uMaterialMap.value = s.map ?? WHITE;
  (uniforms.uMaterial.value as THREE.Vector2).set(s.metal, s.rough);
}

/** The entity shader's uniforms for a surface. */
export function surfaceUniforms(s: Surface = MATTE): Record<string, THREE.IUniform> {
  return { uMaterialMap: { value: s.map ?? WHITE }, uMaterial: { value: new THREE.Vector2(s.metal, s.rough) } };
}

interface File {
  gltf: GLTF | null;
  failed: boolean;
}

/** An item as one mesh: in the hand, on the ground, in its icon. */
export interface ItemMesh {
  geometry: THREE.BufferGeometry;
  albedo: THREE.Texture;
  emissive: THREE.Texture;
  /** How it shines (a glTF model's first material). */
  surface?: Surface;
  /** Points the model marks with empty nodes (`grip`, `grip2`, `muzzle`, `sight`, `mag`), in its own space as held. */
  points?: Partial<Record<ItemPoint, THREE.Vector3>>;
}

export type ItemPoint = 'grip' | 'grip2' | 'muzzle' | 'sight' | 'mag';

/** One side of a humanoid's arms, for its first-person view (see `GltfLibrary.humanoidArms`). */
export interface HumanoidArm {
  /** The upper arm (the shoulder's space), the forearm (the elbow's) and the fist (the wrist's): a mesh per material. */
  upper: ItemMesh[];
  forearm: ItemMesh[];
  fist: ItemMesh[];
  /** Where the elbow is below the shoulder and the wrist below the elbow; where (and how) the fist holds, in the wrist's space. */
  elbow: THREE.Vector3;
  wrist: THREE.Vector3;
  grip: THREE.Vector3;
  gripQ: THREE.Quaternion;
}
export interface HumanoidArms {
  R: HumanoidArm;
  L: HumanoidArm;
}
const POINTS: ItemPoint[] = ['grip', 'grip2', 'muzzle', 'sight', 'mag'];

const DEG = Math.PI / 180;

/**
 * glTF and GLB model files (Blockbench and Blender exports): fetched once each and kept, then
 * turned into figures (entities) and props on demand. They're drawn with the platform's own
 * shading, like box models: sun and shadow, sky and torch light at where they stand, fog, a hurt
 * flash and a fade on death. Their textures, geometry and animations come from the file.
 */
export class GltfLibrary {
  private files = new Map<string, File>();
  private loader = new GLTFLoader();
  private shadows = new Map<THREE.Texture, THREE.RawShaderMaterial>();
  private swatches = new Map<string, THREE.Texture>();
  private items = new Map<string, ItemMesh>();
  private arms = new Map<string, HumanoidArms | null>();
  private icons = new Map<string, string>();
  /** Counts up as files arrive (what shows models can redraw). */
  version = 0;
  /** Draws item icons (set by the client). */
  renderer: THREE.WebGLRenderer | null = null;

  constructor(private shared: SharedUniforms) {}

  /** Start fetching a file (once). */
  load(url: string) {
    if (this.files.has(url)) return;
    const file: File = { gltf: null, failed: false };
    this.files.set(url, file);
    this.loader
      .loadAsync(url)
      .then((g) => {
        file.gltf = g;
        this.version++;
      })
      .catch((err: unknown) => {
        file.failed = true;
        console.error(`Couldn't load the model ${url}: ${err instanceof Error ? err.message : String(err)}`);
      });
  }

  /** A model already in hand under an address (one made in code, a test's): as if fetched. */
  adopt(url: string, gltf: GLTF) {
    this.files.set(url, { gltf, failed: false });
    this.version++;
  }

  /** Files still on their way. */
  get pending(): number {
    let n = 0;
    for (const f of this.files.values()) if (!f.gltf && !f.failed) n++;
    return n;
  }

  /** A figure for an entity's model; null while its file is still coming (or if it failed). */
  figure(spec: ModelSpec): GltfFigure | null {
    const g = spec.gltf && this.get(spec.gltf.url);
    return g ? new GltfFigure(g, spec.gltf!, spec.scale, this) : null;
  }

  /** A prop's model; null while its file is still coming. */
  prop(url: string, opts: { scale?: number }): GltfFigure | null {
    const g = this.get(url);
    return g ? new GltfFigure(g, { url }, opts.scale ?? 1, this) : null;
  }

  /**
   * A model as one mesh for holding (its parts merged, in the model's rest pose), turned and
   * scaled as the spec says; null while the file is still coming. Its first texture is its look.
   */
  item(spec: HeldModelSpec): ItemMesh | null {
    const src = spec.gltf;
    const g = src && this.get(src.url);
    if (!g || !src) return null;
    const key = `${src.url}|${src.rotation?.join(',') ?? ''}|${src.scale ?? 1}`;
    let hit = this.items.get(key);
    if (hit) return hit;
    g.scene.updateMatrixWorld(true);
    const parts: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null;
    let emissive: THREE.Texture | null = null;
    let color: THREE.Color | null = null;
    let surface: Surface | null = null;
    const points: Partial<Record<ItemPoint, THREE.Vector3>> = {};
    const visit = (o: THREE.Object3D) => {
      if (o.name.toLowerCase() === 'hitbox') return;
      const marker = POINTS.find((n) => n === o.name.toLowerCase());
      if (marker && !(o as THREE.Mesh).isMesh) points[marker] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
        map ??= mat.map;
        emissive ??= mat.emissiveMap;
        color ??= mat.color ?? null;
        surface ??= surfaceOf(mat);
        const geo = new THREE.BufferGeometry();
        const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        geo.setAttribute('position', src.getAttribute('position').clone());
        if (src.getAttribute('normal')) geo.setAttribute('normal', src.getAttribute('normal').clone());
        else geo.computeVertexNormals();
        const uv = src.getAttribute('uv');
        geo.setAttribute('uv', uv ? uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
        geo.applyMatrix4(mesh.matrixWorld);
        parts.push(geo);
      }
      for (const c of o.children) visit(c);
    };
    visit(g.scene);
    const merged = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
    for (const p of parts) p.dispose();
    const turn = new THREE.Matrix4();
    if (src.rotation) turn.makeRotationFromEuler(new THREE.Euler(src.rotation[0] * DEG, src.rotation[1] * DEG, src.rotation[2] * DEG));
    if (src.scale) turn.premultiply(new THREE.Matrix4().makeScale(src.scale, src.scale, src.scale));
    merged.applyMatrix4(turn);
    for (const v of Object.values(points)) v.applyMatrix4(turn);
    merged.computeBoundingSphere();
    hit = { geometry: merged, albedo: map ?? this.swatch(color ?? new THREE.Color(1, 1, 1)), emissive: emissive ?? BLACK, surface: surface ?? MATTE, points };
    this.items.set(key, hit);
    return hit;
  }

  /**
   * One part of a model (a node and everything on it) as one mesh, standing on its own: centred,
   * and scaled so its longest side is `length` (a player model's arm, for their first-person view).
   */
  limb(url: string, node: string, length: number): ItemMesh | null {
    const g = this.get(url);
    if (!g) return null;
    const key = `limb|${url}|${node}|${length}`;
    let hit = this.items.get(key);
    if (hit) return hit;
    let part: THREE.Object3D | undefined;
    g.scene.traverse((o) => {
      if (!part && o.name === node) part = o;
    });
    if (!part) return null;
    // In the part's own space (its place in the model left out).
    part.updateMatrixWorld(true);
    const inverse = part.matrixWorld.clone().invert();
    const parts: THREE.BufferGeometry[] = [];
    let map: THREE.Texture | null = null;
    part.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      map ??= mat.map;
      const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', src.getAttribute('position').clone());
      geo.setAttribute('normal', src.getAttribute('normal')?.clone() ?? new THREE.Float32BufferAttribute(new Float32Array(src.getAttribute('position').count * 3), 3));
      geo.setAttribute('uv', src.getAttribute('uv')?.clone() ?? new THREE.Float32BufferAttribute(new Float32Array(src.getAttribute('position').count * 2), 2));
      geo.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
      parts.push(geo);
    });
    if (!parts.length) return null;
    const merged = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    merged.computeBoundingBox();
    const box = merged.boundingBox!;
    const size = box.getSize(new THREE.Vector3());
    merged.translate(...box.getCenter(new THREE.Vector3()).negate().toArray());
    merged.scale(length / Math.max(size.x, size.y, size.z), length / Math.max(size.x, size.y, size.z), length / Math.max(size.x, size.y, size.z));
    merged.computeBoundingSphere();
    hit = { geometry: merged, albedo: map ?? this.swatch(new THREE.Color(1, 1, 1)), emissive: BLACK };
    this.items.set(key, hit);
    return hit;
  }

  /**
   * A humanoid model's forearms and fists (docs/HUMANOID.md), for its player's first-person view:
   * each side's forearm (in its elbow joint's space, without the hand) and fist (in its wrist's
   * space), a mesh per material, with where the fist holds and how long the forearm is. Null while
   * the file is coming, or if the model isn't a humanoid.
   */
  humanoidArms(url: string): HumanoidArms | null {
    const g = this.get(url);
    if (!g) return null;
    const key = `arms|${url}`;
    const hit = this.arms.get(key);
    if (hit !== undefined) return hit;
    const node = (n: string) => g.scene.getObjectByName(n) ?? null;
    const side = (s: 'L' | 'R'): HumanoidArm | null => {
      const upper = node(`upperArm${s}`);
      const lower = node(`lowerArm${s}`);
      const hand = node(`hand${s}`);
      if (!upper || !lower || !hand) return null;
      const grip = node(`grip${s}`);
      g.scene.updateMatrixWorld(true);
      return {
        upper: this.meshesIn(upper, lower),
        forearm: this.meshesIn(lower, hand),
        fist: this.meshesIn(hand, null),
        elbow: lower.position.clone(),
        wrist: hand.position.clone(),
        grip: grip ? grip.position.clone() : new THREE.Vector3(0, -0.085, 0.015),
        gripQ: grip ? grip.quaternion.clone() : new THREE.Quaternion(),
      };
    };
    const R = side('R');
    const L = side('L');
    const out = R && L ? { R, L } : null;
    this.arms.set(key, out);
    return out;
  }

  /** A node's meshes (leaving out one of its children, and all under it) in the node's own space, a geometry per material. */
  private meshesIn(root: THREE.Object3D, skip: THREE.Object3D | null): ItemMesh[] {
    const inverse = root.matrixWorld.clone().invert();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const visit = (o: THREE.Object3D) => {
      if (o === skip) return;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
        const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
        const geo = new THREE.BufferGeometry();
        const n = src.getAttribute('position').count;
        geo.setAttribute('position', src.getAttribute('position').clone());
        geo.setAttribute('normal', src.getAttribute('normal')?.clone() ?? new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('uv', src.getAttribute('uv')?.clone() ?? new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
        geo.applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
        if (!src.getAttribute('normal')) geo.computeVertexNormals();
        const list = byMat.get(mat) ?? [];
        list.push(geo);
        byMat.set(mat, list);
      }
      for (const c of o.children) visit(c);
    };
    visit(root);
    const out: ItemMesh[] = [];
    for (const [mat, parts] of byMat) {
      const m = mat as THREE.MeshStandardMaterial;
      const geometry = mergeGeometries(parts);
      for (const p of parts) p.dispose();
      geometry.computeBoundingSphere();
      out.push({ geometry, albedo: m.map ?? this.swatch(m.color ?? new THREE.Color(1, 1, 1)), emissive: m.emissiveMap ?? BLACK, surface: surfaceOf(m) });
    }
    return out;
  }

  /**
   * A picture of a model (an item's icon): drawn once, from above and to the side like an
   * inventory's, as a data URL; empty until its file is here (and on a client that can't draw).
   */
  icon(url: string, size: number, view: 'iso' | 'side' = 'iso'): string {
    const key = `${url}|${size}|${view}`;
    const hit = this.icons.get(key);
    if (hit !== undefined) return hit;
    const look = this.item({ parts: [], gltf: { url } });
    const r = this.renderer;
    if (!look || !r) return '';
    const scene = new THREE.Scene();
    const material = new THREE.MeshLambertMaterial({ map: look.albedo, alphaTest: 0.5, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(look.geometry, material);
    scene.add(mesh, new THREE.AmbientLight(0xffffff, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-1, 2, 1.5);
    scene.add(sun);
    look.geometry.computeBoundingBox();
    const box = look.geometry.boundingBox!;
    const centre = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    // From above and to the side (an inventory's view), or square on from the side, muzzle right (a kill feed's).
    const side = view === 'side';
    const extent = box.getSize(new THREE.Vector3());
    const aspect = side ? 2 : 1;
    const half = side ? Math.max(extent.z / 2, extent.y) * 1.08 : radius;
    const cam = new THREE.OrthographicCamera(-half, half, half / aspect, -half / aspect, 0.01, radius * 20);
    cam.position.copy(centre).add(side ? new THREE.Vector3(-1, 0, 0).multiplyScalar(radius * 6) : new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(radius * 6));
    cam.lookAt(centre);
    const px = size * 2;
    const py = Math.round(px / aspect);
    const target = new THREE.WebGLRenderTarget(px, py, { colorSpace: THREE.SRGBColorSpace });
    const was = { target: r.getRenderTarget(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), autoClear: r.autoClear };
    r.setRenderTarget(target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, cam);
    const pixels = new Uint8Array(px * py * 4);
    r.readRenderTargetPixels(target, 0, 0, px, py, pixels);
    r.setRenderTarget(was.target);
    r.setClearColor(was.color, was.alpha);
    r.autoClear = was.autoClear;
    target.dispose();
    material.dispose();
    // Rows come bottom-up.
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = py;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(px, py);
    for (let y = 0; y < py; y++) img.data.set(pixels.subarray((py - 1 - y) * px * 4, (py - y) * px * 4), y * px * 4);
    ctx.putImageData(img, 0, 0);
    const out = canvas.toDataURL();
    this.icons.set(key, out);
    return out;
  }

  private get(url: string): GLTF | null {
    this.load(url);
    return this.files.get(url)!.gltf;
  }

  /** The platform's lit material for one of a model's textures (each figure has its own: its tint and fade). */
  material(map: THREE.Texture, emissive: THREE.Texture | null, side: THREE.Side, own: Record<string, THREE.IUniform>, surface: Surface = MATTE): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      vertexShader: Shaders.entity.vertex,
      fragmentShader: Shaders.entity.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.shared, uAtlas: { value: map }, uEmissiveMap: { value: emissive ?? BLACK }, ...surfaceUniforms(surface), ...own },
      side,
    });
  }

  /** Shadows keep the texture's cut-outs (shared by every figure using the texture). */
  shadow(map: THREE.Texture): THREE.RawShaderMaterial {
    let m = this.shadows.get(map);
    if (!m) {
      m = new THREE.RawShaderMaterial({
        vertexShader: Shaders.entityShadow.vertex,
        fragmentShader: Shaders.entityShadow.fragment,
        glslVersion: THREE.GLSL3,
        uniforms: { uAtlas: { value: map } },
        side: THREE.DoubleSide,
        colorWrite: false,
      });
      this.shadows.set(map, m);
    }
    return m;
  }

  /** A one-pixel texture of a colour (a material with no texture, only a colour). */
  swatch(color: THREE.Color): THREE.Texture {
    const key = color.getHexString();
    let t = this.swatches.get(key);
    if (!t) {
      const c = color.clone().convertLinearToSRGB();
      t = new THREE.DataTexture(new Uint8Array([c.r * 255, c.g * 255, c.b * 255, 255]), 1, 1, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this.swatches.set(key, t);
    }
    return t;
  }

  /** The game is over: free every file's geometry and textures. */
  dispose() {
    for (const f of this.files.values()) {
      f.gltf?.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
          for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
          mat.dispose();
        }
      });
    }
    for (const m of this.shadows.values()) m.dispose();
    for (const t of this.swatches.values()) t.dispose();
    for (const i of this.items.values()) i.geometry.dispose();
    for (const a of this.arms.values()) for (const side of a ? [a.R, a.L] : []) for (const m of [...side.upper, ...side.forearm, ...side.fist]) m.geometry.dispose();
    this.arms.clear();
    this.items.clear();
    this.icons.clear();
    this.files.clear();
    this.shadows.clear();
    this.swatches.clear();
  }
}

type Clip = 'idle' | 'walk' | 'run' | 'attack' | 'cast';

/**
 * One copy of a glTF model: its node tree (named nodes are its pivots), the platform's materials,
 * and its animations. As an entity it plays `idle`, `walk` or `run` by how fast it goes (walking
 * in step with the ground it covers), `attack` once per swing, and turns its `head` to look; as a
 * prop it loops whichever animation it's told to.
 */
export class GltfFigure implements Figure {
  readonly root = new THREE.Group();
  readonly pivots = new Map<string, THREE.Object3D>();
  /** Its tint, fade and light (shared by every material of this copy). */
  readonly material: THREE.RawShaderMaterial;
  private materials: THREE.RawShaderMaterial[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<Clip, THREE.AnimationAction[]>();
  private looping: THREE.AnimationAction | null = null;
  private loopName: string | null = null;
  private head: THREE.Object3D | null = null;
  private headRest = new THREE.Quaternion();
  private last = -1;
  private attackT = Infinity;
  private duration = new Map<THREE.AnimationAction, number>();
  /** Built on the humanoid rig: animated in code. */
  private rig: HumanoidRig | null = null;

  constructor(gltf: GLTF, spec: GltfSpec, scale: number, lib: GltfLibrary) {
    const inner = new THREE.Group();
    inner.scale.setScalar(scale);
    inner.rotation.y = spec.yaw ?? 0;
    const scene = gltf.scene.clone(true);
    inner.add(scene);
    this.root.add(inner);
    const own: Record<string, THREE.IUniform> = {
      uProbe: { value: new THREE.Vector2(1, 0) },
      uTint: { value: new THREE.Vector4(1, 0, 0, 0) },
      uOpacity: { value: 1 },
    };
    const byMap = new Map<string, THREE.RawShaderMaterial>();
    const hidden = new Set(['hitbox', ...(spec.hide ?? []).map((n) => n.toLowerCase())]);
    scene.traverse((o) => {
      if (o.name && !this.pivots.has(o.name)) this.pivots.set(o.name, o);
      if (hidden.has(o.name.toLowerCase())) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const map = src.map ?? lib.swatch(src.color ?? new THREE.Color(1, 1, 1));
      const surface = surfaceOf(src);
      const key = `${map.uuid}|${src.emissiveMap?.uuid ?? ''}|${surface.map?.uuid ?? ''}|${surface.metal}|${surface.rough}|${src.side ?? 0}`;
      let m = byMap.get(key);
      if (!m) {
        m = lib.material(map, src.emissiveMap ?? null, src.side ?? THREE.FrontSide, own, surface);
        byMap.set(key, m);
        this.materials.push(m);
      }
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      mesh.material = m;
      mesh.customDepthMaterial = lib.shadow(map);
    });
    this.material = this.materials[0] ?? lib.material(lib.swatch(new THREE.Color(1, 1, 1)), null, THREE.FrontSide, own);
    if (!this.materials.length) this.materials.push(this.material);
    if ((spec.rig === 'humanoid' || !spec.clips) && HumanoidRig.fits(this.pivots)) {
      this.rig = new HumanoidRig(this.pivots);
      this.pivots.set('armR', this.pivots.get('handR')!);
    }
    if (spec.hand) {
      const hand = this.pivots.get(spec.hand);
      if (hand) this.pivots.set('armR', hand);
    }
    if (spec.head) {
      this.head = this.pivots.get(spec.head) ?? null;
      if (this.head) this.headRest.copy(this.head.quaternion);
    }
    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(scene);
      const byName = new Map(gltf.animations.map((c) => [c.name, c]));
      // A swing or a cast goes on top of whatever the figure is doing (it can swing mid-stride):
      // played additively, as the difference from its first frame.
      const actions = (names: string | string[] | undefined, over: boolean) =>
        (typeof names === 'string' ? [names] : names ?? []).flatMap((n) => {
          let c = byName.get(n);
          if (!c) return [];
          if (over) c = THREE.AnimationUtils.makeClipAdditive(c.clone());
          const a = this.mixer!.clipAction(c, undefined, over ? THREE.AdditiveAnimationBlendMode : THREE.NormalAnimationBlendMode);
          this.duration.set(a, c.duration);
          return [a];
        });
      const c = spec.clips ?? {};
      for (const k of ['idle', 'walk', 'run', 'attack', 'cast'] as const) {
        const list = actions(c[k], k === 'attack' || k === 'cast');
        if (list.length) this.clips.set(k, list);
      }
      // Loops play all the time, weighted (walking and running follow the stride, not the clock);
      // the swing plays once.
      for (const k of ['idle', 'walk', 'run', 'cast'] as const) for (const a of this.clips.get(k) ?? []) a.setEffectiveWeight(0).play();
      for (const k of ['walk', 'run'] as const) for (const a of this.clips.get(k) ?? []) a.timeScale = 0;
      for (const a of this.clips.get('attack') ?? []) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = false;
      }
    }
  }

  /** An entity's frame: which animations, how much of each, the look, and the fall on death. */
  animate(s: AnimState) {
    if (this.rig) return this.rig.animate(s);
    const dt = this.last < 0 ? 0 : Math.max(0, Math.min(0.25, s.time - this.last));
    this.last = s.time;
    if (this.head) this.head.quaternion.copy(this.headRest);
    if (this.mixer) {
      const moving = s.walkAmount;
      const running = this.clips.has('run') && s.pace > 1.3;
      const gait = running ? this.clips.get('run') : this.clips.get('walk') ?? this.clips.get('run');
      const idle = this.clips.get('idle');
      const casting = s.casting || s.raised ? this.clips.get('cast') : undefined;
      const weights = new Map<THREE.AnimationAction, number>();
      for (const a of idle ?? []) weights.set(a, gait ? 1 - moving : 1);
      for (const a of gait ?? []) {
        weights.set(a, moving);
        // In step with the ground covered: one cycle of the clip per stride.
        a.time = ((s.walkPhase / (Math.PI * 2)) % 1) * (this.duration.get(a) ?? 1);
      }
      for (const a of casting ?? []) weights.set(a, 1);
      for (const k of ['idle', 'walk', 'run', 'cast'] as const) for (const a of this.clips.get(k) ?? []) a.setEffectiveWeight(weights.get(a) ?? 0);
      // A new swing (its timer went back to zero): the attack plays once over the rest.
      if (s.attackT < this.attackT) for (const a of this.clips.get('attack') ?? []) a.reset().setEffectiveWeight(1).play();
      this.attackT = s.attackT;
      this.mixer.update(dt);
    }
    if (this.head && (s.headYaw || s.headPitch)) this.head.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(s.headPitch, s.headYaw, 0, 'YXZ')));
    this.root.rotation.z = s.dying * (Math.PI / 2) * 0.95;
  }

  /** A humanoid holds things its own way. */
  hold(mesh: THREE.Object3D | null, info: HeldInfo | null): boolean {
    if (!this.rig) return false;
    this.rig.hold(mesh, info);
    return true;
  }

  /** A prop's animation: loop this one (by name), or none. */
  loop(name: string | null) {
    if (name === this.loopName || !this.mixer) return;
    this.loopName = name;
    this.looping?.fadeOut(0.2);
    const clip = name ? this.mixer.clipAction(name) : null;
    this.looping = clip ? clip.reset().fadeIn(0.2).play() : null;
  }

  /** A prop's frame. */
  update(dt: number) {
    this.mixer?.update(dt);
  }

  dispose() {
    this.mixer?.stopAllAction();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }
}
