import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GltfSpec, ModelSpec } from '../api/types';
import type { SharedUniforms } from '../render/pipeline';
import { Shaders } from '../render/shaders';
import type { AnimState, Figure } from '../render/entities';

/** A model without an emissive map glows nowhere. */
const BLACK = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

interface File {
  gltf: GLTF | null;
  failed: boolean;
}

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
      })
      .catch((err: unknown) => {
        file.failed = true;
        console.error(`Couldn't load the model ${url}: ${err instanceof Error ? err.message : String(err)}`);
      });
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

  private get(url: string): GLTF | null {
    this.load(url);
    return this.files.get(url)!.gltf;
  }

  /** The platform's lit material for one of a model's textures (each figure has its own: its tint and fade). */
  material(map: THREE.Texture, emissive: THREE.Texture | null, side: THREE.Side, own: Record<string, THREE.IUniform>): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      vertexShader: Shaders.entity.vertex,
      fragmentShader: Shaders.entity.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: { ...this.shared, uAtlas: { value: map }, uEmissiveMap: { value: emissive ?? BLACK }, ...own },
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
    const byMap = new Map<THREE.Texture, THREE.RawShaderMaterial>();
    const hidden = new Set(['hitbox', ...(spec.hide ?? []).map((n) => n.toLowerCase())]);
    scene.traverse((o) => {
      if (o.name && !this.pivots.has(o.name)) this.pivots.set(o.name, o);
      if (hidden.has(o.name.toLowerCase())) o.visible = false;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      const map = src.map ?? lib.swatch(src.color ?? new THREE.Color(1, 1, 1));
      let m = byMap.get(map);
      if (!m) {
        m = lib.material(map, src.emissiveMap ?? null, src.side ?? THREE.FrontSide, own);
        byMap.set(map, m);
        this.materials.push(m);
      }
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      mesh.material = m;
      mesh.customDepthMaterial = lib.shadow(map);
    });
    this.material = this.materials[0] ?? lib.material(lib.swatch(new THREE.Color(1, 1, 1)), null, THREE.FrontSide, own);
    if (!this.materials.length) this.materials.push(this.material);
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
