import * as THREE from 'three';
import type { HeldModelSpec, IconRef, ItemDefinition, ModelPart, ModelSpec, SpriteRef } from '../api/types';
import { Shaders } from './shaders';
import type { SharedUniforms } from './pipeline';
import { GltfLibrary, surfaceUniforms, type ItemMesh, type Surface } from '../client/gltf';
import type { HeldInfo } from '../client/humanoid';

/** The built-in starter sprites (16x16, `builtin` atlas, row at y = 64). Games bring the rest. */
export const BUILTIN_SPRITES: Record<string, [number, number]> = {
  wooden_sword: [0, 64],
  stone_sword: [16, 64],
  iron_sword: [32, 64],
  diamond_sword: [48, 64],
  bow: [64, 64],
  bow_pulling: [80, 64],
  arrow: [96, 64],
  health_potion: [112, 64],
  heart: [128, 64],
};

export interface Atlas {
  name: string;
  width: number;
  height: number;
  /** sRGB RGBA pixels (row 0 = top) for sprite extrusion and UI icons. */
  pixels: Uint8Array;
  albedo: THREE.DataTexture;
  emissive: THREE.DataTexture;
}

export function resolveSprite(ref: SpriteRef): { atlas: string; x: number; y: number } {
  if (typeof ref === 'string') {
    const p = BUILTIN_SPRITES[ref];
    if (!p) throw new Error(`unknown sprite "${ref}"`);
    return { atlas: 'builtin', x: p[0], y: p[1] };
  }
  return ref;
}

/** Owns atlases, shared materials and cached geometry for entities, items and projectiles. */
export class EntityGraphics {
  private atlases = new Map<string, Atlas>();
  private shadowMaterials = new Map<string, THREE.RawShaderMaterial>();
  private spriteCache = new Map<string, THREE.BufferGeometry>();
  private iconCache = new Map<string, string>();
  private heldCache = new WeakMap<HeldModelSpec, THREE.BufferGeometry>();

  /** glTF and GLB model files, fetched once each. */
  readonly gltf: GltfLibrary;

  constructor(private shared: SharedUniforms) {
    this.gltf = new GltfLibrary(shared);
  }

  /** A figure for an entity's model: boxes now, or glTF once its file is here (null till then). */
  figure(spec: ModelSpec): Figure | null {
    return spec.rig === 'gltf' ? this.gltf.figure(spec) : this.buildModel(spec);
  }

  /** Free every atlas texture and cached geometry (a game is over). */
  dispose() {
    this.gltf.dispose();
    for (const a of this.atlases.values()) {
      a.albedo.dispose();
      a.emissive.dispose();
    }
    for (const m of this.shadowMaterials.values()) m.dispose();
    for (const g of this.spriteCache.values()) g.dispose();
    this.atlases.clear();
    this.shadowMaterials.clear();
    this.spriteCache.clear();
  }

  addAtlas(name: string, width: number, height: number, pixels: Uint8Array, emissive?: Uint8Array) {
    const albedo = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    albedo.colorSpace = THREE.SRGBColorSpace;
    albedo.magFilter = THREE.NearestFilter;
    albedo.minFilter = THREE.NearestMipmapLinearFilter;
    albedo.generateMipmaps = true;
    albedo.flipY = false;
    albedo.needsUpdate = true;
    const em = emissive ?? new Uint8Array(width * height);
    const emRGBA = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) emRGBA[i * 4] = em[i];
    const emTex = new THREE.DataTexture(emRGBA, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
    emTex.magFilter = THREE.NearestFilter;
    emTex.minFilter = THREE.NearestFilter;
    emTex.flipY = false;
    emTex.needsUpdate = true;
    this.atlases.set(name, { name, width, height, pixels, albedo, emissive: emTex });
    this.shadowMaterials.delete(name);
    for (const k of [...this.spriteCache.keys()]) if (k.startsWith(`${name}:`)) this.spriteCache.delete(k);
  }

  /** Register an atlas drawn on a canvas (game-provided art). */
  addCanvasAtlas(name: string, canvas: HTMLCanvasElement | OffscreenCanvas) {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    this.addAtlas(name, canvas.width, canvas.height, new Uint8Array(img.data.buffer.slice(0)));
  }

  atlas(name: string): Atlas {
    const a = this.atlases.get(name);
    if (!a) throw new Error(`unknown atlas "${name}"`);
    return a;
  }

  /**
   * What an item looks like in a hand or on the ground: its model (boxes, or glTF once its file is
   * here) or its sprite extruded, and the textures to draw it with. Null for an item that looks
   * like a block, or while its model's file is still coming (ask again: `gltf.version` counts up).
   */
  itemLook(def: ItemDefinition, drawn = false): (ItemMesh & { model?: HeldModelSpec }) | null {
    const icon = drawn && def.kind === 'bow' ? def.drawIcon ?? def.icon : def.icon;
    const model = def.hold?.model;
    if (model && !drawn) {
      if (model.gltf) {
        const m = this.gltf.item(model);
        return m && { ...m, model };
      }
      const { geometry, atlas } = this.heldModelGeometry(model);
      const a = this.atlas(atlas);
      return { geometry, albedo: a.albedo, emissive: a.emissive, model };
    }
    if (typeof icon === 'object' && 'block' in icon) return null;
    // An icon that's a model's picture: it's held as that model.
    if (typeof icon === 'object' && 'gltf' in icon) {
      const spec: HeldModelSpec = { parts: [], gltf: { url: icon.gltf } };
      const m = this.gltf.item(spec);
      return m && { ...m, model: spec };
    }
    const { geometry, atlas } = this.spriteGeometry(icon);
    const a = this.atlas(atlas);
    return { geometry, albedo: a.albedo, emissive: a.emissive };
  }

  /** An icon as a picture (data URL): a sprite, or a model's (empty until its file is here). Blocks are the caller's. */
  icon(ref: Exclude<IconRef, { block: string }>, size = 48): string {
    return typeof ref === 'object' && 'gltf' in ref ? this.gltf.icon(ref.gltf, size, ref.view) : this.spriteIcon(ref, size);
  }

  /** A per-instance lit material. Same shader source, so three.js reuses the compiled program. */
  material(atlasName: string): THREE.RawShaderMaterial {
    const a = this.atlas(atlasName);
    return this.materialFor(a.albedo, a.emissive);
  }

  /** The same, for any texture (a glTF item's). */
  materialFor(albedo: THREE.Texture, emissive: THREE.Texture, surface?: Surface): THREE.RawShaderMaterial {
    return new THREE.RawShaderMaterial({
      vertexShader: Shaders.entity.vertex,
      fragmentShader: Shaders.entity.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...this.shared,
        uAtlas: { value: albedo },
        uEmissiveMap: { value: emissive },
        ...surfaceUniforms(surface),
        uProbe: { value: new THREE.Vector2(1, 0) },
        uTint: { value: new THREE.Vector4(1, 0, 0, 0) },
        uOpacity: { value: 1 },
      },
      side: THREE.FrontSide,
    });
  }

  shadowMaterial(atlasName: string): THREE.RawShaderMaterial {
    let m = this.shadowMaterials.get(atlasName);
    if (!m) {
      m = new THREE.RawShaderMaterial({
        vertexShader: Shaders.entityShadow.vertex,
        fragmentShader: Shaders.entityShadow.fragment,
        glslVersion: THREE.GLSL3,
        uniforms: { uAtlas: { value: this.atlas(atlasName).albedo } },
        side: THREE.DoubleSide,
        colorWrite: false,
      });
      this.shadowMaterials.set(atlasName, m);
    }
    return m;
  }

  /** Box model instance with a pivot object per part. */
  buildModel(spec: ModelSpec): ModelInstance {
    const atlas = this.atlas(spec.atlas);
    const material = this.material(spec.atlas);
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(spec.scale);
    root.add(inner);
    const pivots = new Map<string, THREE.Object3D>();
    const rest = new Map<string, THREE.Euler>();
    const shadow = this.shadowMaterial(spec.atlas);
    // Parents first.
    const ordered = [...spec.parts].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));
    for (const p of ordered) {
      const pivot = new THREE.Object3D();
      pivot.position.set(p.pivot[0] / 16, p.pivot[1] / 16, p.pivot[2] / 16);
      const r = p.rotation ?? [0, 0, 0];
      pivot.rotation.set(r[0], r[1], r[2]);
      rest.set(p.name, pivot.rotation.clone());
      const geo = boxGeometry(p, atlas.width, atlas.height);
      const mesh = new THREE.Mesh(geo, material);
      mesh.customDepthMaterial = shadow;
      mesh.position.set((p.offset[0] + p.size[0] / 2) / 16, (p.offset[1] + p.size[1] / 2) / 16, (p.offset[2] + p.size[2] / 2) / 16);
      pivot.add(mesh);
      (p.parent ? pivots.get(p.parent) ?? inner : inner).add(pivot);
      pivots.set(p.name, pivot);
    }
    return new ModelInstance(root, pivots, rest, material, spec);
  }

  /** Extruded 3D geometry for a 16x16 sprite (front/back quads plus pixel edges), 1 block wide. */
  spriteGeometry(ref: SpriteRef): { geometry: THREE.BufferGeometry; atlas: string } {
    const s = resolveSprite(ref);
    const key = `${s.atlas}:${s.x},${s.y}`;
    let g = this.spriteCache.get(key);
    if (!g) {
      g = extrudeSprite(this.atlas(s.atlas), s.x, s.y);
      this.spriteCache.set(key, g);
    }
    return { geometry: g, atlas: s.atlas };
  }

  /** One merged geometry for a held box model (cached per spec). Units are blocks (16 px). */
  heldModelGeometry(spec: HeldModelSpec): { geometry: THREE.BufferGeometry; atlas: string } {
    const atlas = spec.atlas ?? 'builtin';
    let g = this.heldCache.get(spec);
    if (!g) {
      const a = this.atlas(atlas);
      const pos: number[] = [];
      const nrm: number[] = [];
      const uvs: number[] = [];
      const m = new THREE.Matrix4();
      const r = new THREE.Matrix4();
      for (const part of spec.parts) {
        const box = boxGeometry({ name: '', size: part.size, uv: part.uv, pivot: [0, 0, 0], offset: [0, 0, 0] }, a.width, a.height).toNonIndexed();
        const [ox, oy, oz] = part.offset;
        const [sx, sy, sz] = part.size;
        m.makeTranslation((ox + sx / 2) / 16, (oy + sy / 2) / 16, (oz + sz / 2) / 16);
        if (part.rotation) m.multiply(r.makeRotationFromEuler(new THREE.Euler(...part.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number])));
        box.applyMatrix4(m);
        pos.push(...box.attributes.position.array);
        nrm.push(...box.attributes.normal.array);
        uvs.push(...box.attributes.uv.array);
        box.dispose();
      }
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.computeBoundingSphere();
      this.heldCache.set(spec, g);
    }
    return { geometry: g, atlas };
  }

  /** Data URL of a sprite scaled up for the HUD. */
  spriteIcon(ref: SpriteRef, size = 48): string {
    const s = resolveSprite(ref);
    const key = `${s.atlas}:${s.x},${s.y}:${size}`;
    const hit = this.iconCache.get(key);
    if (hit) return hit;
    const a = this.atlas(s.atlas);
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const si = ((s.y + y) * a.width + s.x + x) * 4;
        img.data.set(a.pixels.subarray(si, si + 4), (y * 16 + x) * 4);
      }
    ctx.putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    const o = out.getContext('2d')!;
    o.imageSmoothingEnabled = false;
    o.drawImage(c, 0, 0, size, size);
    const url = out.toDataURL();
    this.iconCache.set(key, url);
    return url;
  }
}

/** Minecraft box-UV unwrapping onto a BoxGeometry (model faces +Z). */
export function boxGeometry(p: ModelPart, aw: number, ah: number): THREE.BufferGeometry {
  const [w, h, d] = p.size;
  const g = new THREE.BoxGeometry(w / 16, h / 16, d / 16);
  const [u, v] = p.uv;
  const right: [number, number, number, number] = [u, v + d, d, h];
  const front: [number, number, number, number] = [u + d, v + d, w, h];
  const left: [number, number, number, number] = [u + d + w, v + d, d, h];
  const back: [number, number, number, number] = [u + 2 * d + w, v + d, w, h];
  const top: [number, number, number, number] = [u + d, v, w, d];
  const bottom: [number, number, number, number] = [u + d + w, v, w, d];
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z. The model's left side is +X.
  const faces = p.mirror ? [right, left, top, bottom, front, back] : [left, right, top, bottom, front, back];
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Inset by a hair so nearest sampling never bleeds across face borders.
  const e = 0.02;
  for (let f = 0; f < 6; f++) {
    const [x0, y0, fw, fh] = faces[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let su = uv.getX(i);
      let sv = uv.getY(i);
      if (p.mirror) su = 1 - su;
      // Minecraft convention: the bottom face's image is flipped vertically.
      const row = f === 3 ? sv : 1 - sv;
      const px = x0 + e + su * (fw - 2 * e);
      const py = y0 + e + row * (fh - 2 * e);
      uv.setXY(i, px / aw, py / ah);
    }
  }
  uv.needsUpdate = true;
  return g;
}

function extrudeSprite(a: Atlas, sx: number, sy: number): THREE.BufferGeometry {
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && a.pixels[((sy + y) * a.width + sx + x) * 4 + 3] > 127;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const t = 1 / 32; // half thickness (1 texel)
  const quad = (p: number[][], n: number[], uvq: number[][]) => {
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      pos.push(...p[k]);
      nrm.push(...n);
      uvs.push(...uvq[k]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const U = (x: number) => (sx + x) / a.width;
  const V = (y: number) => (sy + y) / a.height;
  // Sprite space: x right, y up; texel (tx, ty) row 0 at the top.
  const X = (tx: number) => tx / 16 - 0.5;
  const Y = (ty: number) => 0.5 - ty / 16;
  quad(
    [[X(0), Y(16), t], [X(16), Y(16), t], [X(16), Y(0), t], [X(0), Y(0), t]],
    [0, 0, 1],
    [[U(0), V(16)], [U(16), V(16)], [U(16), V(0)], [U(0), V(0)]],
  );
  quad(
    [[X(16), Y(16), -t], [X(0), Y(16), -t], [X(0), Y(0), -t], [X(16), Y(0), -t]],
    [0, 0, -1],
    [[U(16), V(16)], [U(0), V(16)], [U(0), V(0)], [U(16), V(0)]],
  );
  for (let ty = 0; ty < 16; ty++) {
    for (let tx = 0; tx < 16; tx++) {
      if (!opaque(tx, ty)) continue;
      const cu = U(tx + 0.5);
      const cv = V(ty + 0.5);
      const c = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
      const x0 = X(tx), x1 = X(tx + 1), y0 = Y(ty + 1), y1 = Y(ty);
      if (!opaque(tx - 1, ty)) quad([[x0, y0, -t], [x0, y0, t], [x0, y1, t], [x0, y1, -t]], [-1, 0, 0], c);
      if (!opaque(tx + 1, ty)) quad([[x1, y0, t], [x1, y0, -t], [x1, y1, -t], [x1, y1, t]], [1, 0, 0], c);
      if (!opaque(tx, ty - 1)) quad([[x0, y1, t], [x1, y1, t], [x1, y1, -t], [x0, y1, -t]], [0, 1, 0], c);
      if (!opaque(tx, ty + 1)) quad([[x0, y0, -t], [x1, y0, -t], [x1, y0, t], [x0, y0, t]], [0, -1, 0], c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export interface AnimState {
  /** Walk cycle phase (radians) and amount (0..1). */
  walkPhase: number;
  walkAmount: number;
  /** Speed over its usual walking speed (above ~1.3 it's running). */
  pace: number;
  /** Seconds since the last `attack` animation started (large = none). */
  attackT: number;
  /** Arms raised for a wind-up. */
  raised: boolean;
  casting: boolean;
  /** Head look relative to body (radians). */
  headYaw: number;
  headPitch: number;
  /** Death tilt 0..1. */
  dying: number;
  time: number;
  /** Holding a gun up to aim where it looks, 0..1 (both arms forward). */
  aim: number;
  /** Standing 0, crouching 1, sliding 2 (blended). */
  stance: number;
  /** Ground speed (blocks a second), and which way it's going in its own space (+z ahead, +x its left). */
  speed?: number;
  moveX?: number;
  moveZ?: number;
  /** Off the ground; sprinting; reloading; aiming down the sights 0..1; seconds since its gun last fired. */
  air?: boolean;
  sprint?: boolean;
  reloading?: boolean;
  ads?: number;
  shotT?: number;
}

/** A drawn figure: box model (`ModelInstance`) or glTF (`GltfFigure`). */
export interface Figure {
  readonly root: THREE.Group;
  /** Its parts by name (`armR` holds items). */
  readonly pivots: Map<string, THREE.Object3D>;
  /** Its light, tint and fade uniforms (`uProbe`, `uTint`, `uOpacity`). */
  readonly material: THREE.RawShaderMaterial;
  animate(s: AnimState): void;
  /** Hold an item its own way (a humanoid: both hands on a gun); false to hang it from `armR`. */
  hold?(mesh: THREE.Object3D | null, info: HeldInfo | null): boolean;
  dispose(): void;
}

export class ModelInstance implements Figure {
  constructor(
    readonly root: THREE.Group,
    readonly pivots: Map<string, THREE.Object3D>,
    private rest: Map<string, THREE.Euler>,
    readonly material: THREE.RawShaderMaterial,
    readonly spec: ModelSpec,
  ) {}

  private pose(name: string, x: number, y = 0, z = 0) {
    const p = this.pivots.get(name);
    const r = this.rest.get(name);
    if (p && r) p.rotation.set(r.x + x, r.y + y, r.z + z);
  }

  animate(s: AnimState) {
    const w = Math.sin(s.walkPhase) * s.walkAmount;
    if (this.spec.rig === 'humanoid') {
      const legSwing = w * 0.9;
      this.pose('legR', legSwing);
      this.pose('legL', -legSwing);
      const a = Math.min(1, s.attackT / 0.35);
      const attack = s.attackT < 0.35 ? Math.sin(a * Math.PI) : 0;
      let armR = -legSwing * 0.8;
      let armL = legSwing * 0.8;
      if (s.raised) {
        armR = armL = -2.6 + Math.sin(s.time * 20) * 0.08;
      } else if (s.casting) {
        armR = armL = -1.6;
      } else if (attack > 0) {
        armR = -1.9 * attack + armR * (1 - attack);
        armL = -1.4 * attack + armL * (1 - attack);
      }
      const sway = Math.sin(s.time * 1.7) * 0.05;
      // Crouching: down, legs apart front and back. Sliding: leaning back from the hips, legs out ahead.
      const crouch = Math.min(1, s.stance);
      const slide = Math.max(0, s.stance - 1);
      const lean = 0.6 * slide;
      const inner = this.root.children[0];
      if (inner) {
        const hip = 0.75 * this.spec.scale;
        inner.rotation.x = -lean;
        inner.position.set(0, hip - hip * Math.cos(lean) - 0.3 * crouch - 0.15 * slide, hip * Math.sin(lean));
      }
      // A gun: both arms forward along the look (whatever the lean), the left reaching across for the handguard.
      const aim = s.aim;
      const aimX = -Math.PI / 2 + s.headPitch + lean;
      const rx = armR + (aimX - armR) * aim;
      const lx = armL + (aimX + 0.05 - armL) * aim;
      this.pose('armR', rx, -0.12 * aim, (sway + 0.05) * (1 - aim));
      this.pose('armL', lx, 0.62 * aim, (-sway - 0.05) * (1 - aim));
      this.pose('head', s.headPitch + lean, s.headYaw);
      this.pose('body', 0.3 * crouch * (1 - slide));
      if (crouch > 0) {
        const lr = -0.7 + (-0.9 + 0.7) * slide;
        const ll = 0.5 + (-0.75 - 0.5) * slide;
        this.pose('legR', legSwing * (1 - crouch) + lr * crouch, 0, 0.08 * crouch);
        this.pose('legL', -legSwing * (1 - crouch) + ll * crouch, 0, -0.08 * crouch);
      }
    } else if (this.spec.rig === 'spider') {
      for (let i = 0; i < 4; i++) {
        const ph = s.walkPhase * 1.6 + (i % 2) * Math.PI;
        const sw = Math.sin(ph) * 0.4 * s.walkAmount;
        const lift = Math.max(0, Math.cos(ph)) * 0.35 * s.walkAmount;
        this.pose(`legR${i}`, 0, sw, -lift);
        this.pose(`legL${i}`, 0, -sw, lift);
      }
      const attack = s.attackT < 0.3 ? Math.sin((s.attackT / 0.3) * Math.PI) : 0;
      this.pose('head', s.headPitch - attack * 0.4, s.headYaw);
      this.pose('abdomen', Math.sin(s.time * 3) * 0.05);
    }
    this.root.rotation.z = s.dying * (Math.PI / 2) * 0.95;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.material.dispose();
  }
}
