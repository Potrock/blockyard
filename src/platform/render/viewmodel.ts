import * as THREE from 'three';
import type { BlockDef } from '../world/registry';
import { DEFAULT_TINT } from '../world/registry';
import type { HeldModelSpec, HoldSpec, HoldStyle, ViewAnimation, ViewKey, ViewModelApi } from '../api/types';
import { boxGeometry, type EntityGraphics } from './entities';

/**
 * First-person view model, built from Minecraft's own transforms: the arm is posed exactly like
 * Minecraft's bare first-person arm (`ItemInHandRenderer.renderPlayerArm`), and the item sits
 * in that hand the way it does on a player model (`ItemInHandLayer` with the item's
 * `thirdperson_righthand` display transform), which is how Bedrock shows it. A drawn bow uses
 * Java's first-person aiming pose, with the fist on the grip.
 *
 * Rig (camera space: x right, y up, z back):
 *   root    walk bob, look sway, breathing, landing dip, recoil
 *     hand  at the fist; animations move it and turn it (about a pivot)
 *       item  placed relative to the fist, turned by the animation's `wrist`
 *       arm   4x12x4 skin box
 */

const DEPTH = 'gl_Position.z = (gl_Position.z + gl_Position.w) * 0.01 - gl_Position.w;';

const blockVert = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in float face;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out float vShade;
flat out int vFace;
void main() {
  vUv = uv;
  vFace = int(face + 0.5);
  vec3 n = normalize(normalMatrix * normal);
  vShade = 0.55 + 0.45 * clamp(dot(n, normalize(vec3(0.35, 0.9, 0.45))), 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${DEPTH}
}`;

const blockFrag = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uMaterial;
uniform float uLayers[6];
uniform vec3 uTint;
uniform float uTintMode;   // 0 none, 1 alpha mask (grass block), 2 full (foliage)
uniform float uCutout;
uniform vec3 uLight;
in vec2 vUv;
in float vShade;
flat in int vFace;
layout(location = 0) out vec4 fragColor;
void main() {
  float layer = uLayers[vFace];
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 a = texture(uAlbedo, vec3(uv, layer));
  if (uCutout > 0.5 && a.a < 0.5) discard;
  vec3 base = a.rgb;
  if (uTintMode > 1.5) base *= uTint;
  else if (uTintMode > 0.5) base = mix(base, base * uTint, 1.0 - a.a);
  float emissive = texture(uMaterial, vec3(uv, layer)).a;
  vec3 c = base * uLight * vShade + base * emissive * 3.0;
  fragColor = vec4(c, 1.0);
}`;

const spriteVert = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out float vShade;
void main() {
  vUv = uv;
  vec3 n = normalize(normalMatrix * normal);
  // Key light from the upper right, soft fill from the camera.
  float key = clamp(dot(n, normalize(vec3(0.45, 0.85, 0.35))), 0.0, 1.0);
  float fill = clamp(n.z, 0.0, 1.0);
  vShade = 0.42 + 0.45 * key + 0.18 * fill;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${DEPTH}
}`;

const spriteFrag = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uEmissive;
uniform vec3 uLight;
in vec2 vUv;
in float vShade;
layout(location = 0) out vec4 fragColor;
void main() {
  vec4 a = texture(uAtlas, vUv);
  if (a.a < 0.5) discard;
  fragColor = vec4(a.rgb * uLight * vShade + a.rgb * texture(uEmissive, vUv).r * 3.0, 1.0);
}`;

const srgb = (c: number) => Math.pow(c, 2.2);
const DEG = Math.PI / 180;
type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------
// Minecraft's transforms
// ---------------------------------------------------------------------------------------------

interface StyleDef {
  /** Item orientation: Minecraft's `display.firstperson_righthand` rotation (degrees about X, Y, Z) and scale. */
  rotation: V3;
  scale: number;
  /** Sprite pixel held in the fist. */
  grip: [number, number];
  /** Extra offset in pixels (camera axes). */
  translation: V3;
  use: string;
}

// item/handheld.json and item/generated.json: upright, turned to face in, tilted 25 degrees.
const HANDHELD = { rotation: [0, -90, 25] as V3, scale: 0.68, translation: [0, 0, 0] as V3 };
const STYLES: Record<HoldStyle, StyleDef> = {
  sword: { ...HANDHELD, grip: [3, 12.5], use: 'swing' },
  axe: { ...HANDHELD, grip: [3, 13], use: 'swing' },
  // Flat items turned a little further toward the camera, which sits nearer the fist than in Java.
  item: { ...HANDHELD, rotation: [0, -60, 20], scale: 0.55, grip: [8, 13], use: 'drink' },
  // The bow uses Java's own first-person placement (see `bowRest`); only the grip matters here.
  bow: { ...HANDHELD, grip: [4.5, 4.5], use: 'release' },
  // block/block.json: a little cube turned 45 degrees, sitting on the fist.
  block: { rotation: [0, 45, 0], scale: 0.4, grip: [8, 16], translation: [0, 0, 0], use: 'swing' },
  // Two hands on the shaft, aimed at the crosshair (see `polearmRest`).
  polearm: { rotation: [0, 0, 0], scale: 0.85, grip: [8, 8], translation: [0, 0, 0], use: 'jab' },
};

/** Java's first-person item point (`applyItemArmTransform`) and bow display. */
const HAND_POINT: V3 = [0.56, -0.52, -0.72];
const BOW_FP = { rotation: [0, -90, 25] as V3, translation: [1.13, 3.2, 1.13] as V3, scale: 0.68 };
/** Forearm (fist toward elbow, right hand) holding the bow at rest and drawn. */
const BOW_FOREARM: V3 = [0.4, -0.55, 0.73];
const DRAW_FOREARM: V3 = [0.3, -0.42, 0.86];
const BOW_ARM_SCALE = 0.7;

/**
 * Two-handed hold: the rear fist, a point the tip aims at, the roll about the shaft (so the head's
 * blades catch the light), each forearm (fist toward elbow, right hand at the rear) and hand size.
 */
const POLE = {
  rear: [0.48, -0.5, -0.8] as V3,
  aim: [0.2, -0.16, -2.6] as V3,
  roll: 0.6,
  rearArm: [0.55, -0.65, 0.5] as V3,
  frontArm: [-0.6, -0.65, 0.45] as V3,
  hand: 0.75,
  /** Forearms stretched along their length so they still run off screen when the hands thrust. */
  stretch: 1.6,
};

/** A tiny Minecraft `PoseStack`: every call post-multiplies. */
class Pose {
  readonly m = new THREE.Matrix4();
  private t = new THREE.Matrix4();
  reset() {
    this.m.identity();
    return this;
  }
  copy(p: Pose) {
    this.m.copy(p.m);
    return this;
  }
  translate(x: number, y: number, z: number) {
    this.m.multiply(this.t.makeTranslation(x, y, z));
    return this;
  }
  rotX(deg: number) {
    this.m.multiply(this.t.makeRotationX(deg * DEG));
    return this;
  }
  rotY(deg: number) {
    this.m.multiply(this.t.makeRotationY(deg * DEG));
    return this;
  }
  rotZ(deg: number) {
    this.m.multiply(this.t.makeRotationZ(deg * DEG));
    return this;
  }
  scale(s: number) {
    this.m.multiply(this.t.makeScale(s, s, s));
    return this;
  }
  /** `ItemTransform.apply`, mirrored for the left hand. */
  display(d: { rotation: V3; translation: V3; scale: number }, side: number) {
    const [tx, ty, tz] = d.translation;
    const [rx, ry, rz] = d.rotation;
    return this.translate((side * tx) / 16, ty / 16, tz / 16)
      .rotX(rx)
      .rotY(side * ry)
      .rotZ(side * rz)
      .scale(d.scale);
  }
}

const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _mi = new THREE.Matrix4();

/**
 * Minecraft's first-person arm (`renderPlayerArm`) at swing progress `s`, lowered by `drop`,
 * down into the arm part's own space (`ModelPart.translateAndRotate`; model space has y down).
 */
function armChain(p: Pose, side: number, s: number, drop: number) {
  const f = side;
  const f1 = Math.sqrt(s);
  const f5 = Math.sin(s * s * Math.PI);
  const f6 = Math.sin(f1 * Math.PI);
  return p
    .reset()
    .translate(f * (-0.3 * f6 + 0.64), 0.4 * Math.sin(f1 * Math.PI * 2) - 0.6 - drop, -0.4 * Math.sin(s * Math.PI) - 0.72)
    .rotY(f * 45)
    .rotY(f * f6 * 70)
    .rotZ(f * f5 * -20)
    .translate(f * -1, 3.6, 3.5)
    .rotZ(f * 120)
    .rotX(200)
    .rotY(f * -135)
    .translate(f * 5.6, 0, 0)
    // PlayerModel arm: pivot (-5, 2, 0), idle zRot 0.1 rad.
    .translate((f * -5) / 16, 2 / 16, 0)
    .rotZ((f * 0.1) / DEG);
}

/** A resting hand: where the fist is, and the item and arm relative to it. */
interface Rest {
  grip: THREE.Vector3;
  itemRot: THREE.Quaternion;
  itemScale: number;
  /** The item-space point under the fist. */
  gripLocal: THREE.Vector3;
  /** Item offset from the fist (camera axes). */
  itemOffset: THREE.Vector3;
  armRot: THREE.Quaternion;
  armOffset: THREE.Vector3;
  armScale: number;
  /** Length multiplier for the forearm box. */
  armStretch: number;
  /** Second hand (two-handed styles), relative to the first fist. */
  twoHanded: boolean;
  arm2Rot: THREE.Quaternion;
  arm2Offset: THREE.Vector3;
  /** The front fist, relative to the first. */
  grip2: THREE.Vector3;
  /** Which way the item points (a jab thrusts along it). */
  axis: THREE.Vector3;
}

const newRest = (): Rest => ({
  twoHanded: false,
  armStretch: 1,
  grip2: new THREE.Vector3(),
  arm2Rot: new THREE.Quaternion(),
  arm2Offset: new THREE.Vector3(),
  axis: new THREE.Vector3(0, 0, -1),
  armScale: 1,
  itemOffset: new THREE.Vector3(),
  grip: new THREE.Vector3(),
  itemRot: new THREE.Quaternion(),
  itemScale: 1,
  gripLocal: new THREE.Vector3(),
  armRot: new THREE.Quaternion(),
  armOffset: new THREE.Vector3(),
});

const _arm = new Pose();
const _item = new Pose();

/** The item-space point under the fist: a sprite pixel, a model point, or a block's base. */
function gripPoint(d: StyleDef, model: HeldModelSpec | undefined, out: THREE.Vector3) {
  if (model) {
    const g = model.grip ?? [0, 0, 0];
    return out.set(g[0] / 16, g[1] / 16, g[2] / 16);
  }
  return out.set(d.grip[0] / 16 - 0.5, 0.5 - d.grip[1] / 16, 0);
}

/** Forearm box orientation for a fist: `fa` toward the elbow, thumb side facing back along `axis`. */
function forearm(fa: V3, side: number, axis: THREE.Vector3, out: THREE.Quaternion): THREE.Vector3 {
  return forearmDir(new THREE.Vector3(side * fa[0], fa[1], fa[2]).normalize(), axis, out);
}

function forearmDir(f: THREE.Vector3, axis: THREE.Vector3, out: THREE.Quaternion): THREE.Vector3 {
  const thumb = axis.clone().negate();
  thumb.addScaledVector(f, -thumb.dot(f)).normalize();
  _m.makeBasis(new THREE.Vector3().crossVectors(f, thumb), f, thumb);
  out.setFromRotationMatrix(_m);
  return f;
}

/**
 * Two-handed: rear fist low at the right, the item pointing just under the crosshair, the front
 * hand further along it (`grip2`), both forearms running down off the screen.
 */
function polearmRest(d: StyleDef, model: HeldModelSpec | undefined, side: number, drop: number, out: Rest) {
  out.grip.set(side * POLE.rear[0], POLE.rear[1] - drop, POLE.rear[2]);
  const axis = out.axis.set(side * POLE.aim[0], POLE.aim[1], POLE.aim[2]).sub(out.grip).normalize();
  const up = _s.set(0, 1, 0).addScaledVector(axis, -axis.y).normalize().applyAxisAngle(axis, side * POLE.roll);
  // Item space: +z along its length, +y up.
  _m.makeBasis(_v.crossVectors(up, axis), up, axis);
  out.itemRot.setFromRotationMatrix(_m);
  out.itemScale = d.scale;
  gripPoint(d, model, out.gripLocal);
  out.itemOffset.set(0, 0, 0);
  const f = forearm(POLE.rearArm, side, axis, out.armRot);
  out.armOffset.copy(f).multiplyScalar((4.5 / 16) * POLE.hand * POLE.stretch);
  out.armScale = POLE.hand;
  out.armStretch = POLE.stretch;
  const g1 = out.gripLocal;
  const g2 = model?.grip2 ? _v.set(model.grip2[0] / 16, model.grip2[1] / 16, model.grip2[2] / 16) : _v.copy(g1).add(_s.set(0, 0, 18 / 16));
  const front = g2.sub(g1).multiplyScalar(d.scale).applyQuaternion(out.itemRot).clone();
  const f2 = forearm(POLE.frontArm, side, axis, out.arm2Rot);
  out.grip2.copy(front);
  out.arm2Offset.copy(front).addScaledVector(f2, (4.5 / 16) * POLE.hand * POLE.stretch);
  out.twoHanded = true;
}

/** The hand in Minecraft's first-person arm pose, holding style `d` (or nothing) upright in the fist. */
function attachedRest(d: StyleDef | null, model: HeldModelSpec | undefined, side: number, drop: number, out: Rest) {
  out.twoHanded = false;
  out.axis.set(0, 0, -1);
  const c = armChain(_arm, side, 0, drop);
  // Fist: the lower 3 px of the arm cube (x -3..1, y -2..10, z -2..2 for the right arm).
  out.grip.set((side * -1) / 16, 8.5 / 16, 0).applyMatrix4(c.m);
  // Our box has the shoulder on +y and the front on +z; Minecraft's cube has them on -y and -z.
  _m.copy(c.m).multiply(_mi.makeTranslation((side * -1) / 16, 4 / 16, 0)).multiply(_mi.makeRotationX(Math.PI));
  _m.decompose(out.armOffset, out.armRot, _s);
  out.armOffset.sub(out.grip);
  out.armScale = 1;
  out.armStretch = 1;
  if (!d) return;
  const [rx, ry, rz] = d.rotation;
  _item.reset().rotX(rx).rotY(side * ry).rotZ(side * rz);
  // A model's length (+z) goes where a sprite's tool diagonal would.
  if (model) _item.rotZ(-45).rotX(-90);
  out.itemRot.setFromRotationMatrix(_item.m);
  out.itemScale = d.scale;
  gripPoint(d, model, out.gripLocal);
  out.itemOffset.set((side * d.translation[0]) / 16, d.translation[1] / 16, d.translation[2] / 16);
}

/**
 * The bow where Java puts it in first person (held at the side, or drawn: `ItemInHandRenderer`
 * case BOW), the fist on the grip and the forearm running back off the screen.
 */
function bowRest(side: number, drop: number, drawn: boolean, pull: number, out: Rest) {
  const p = _item.reset().translate(side * HAND_POINT[0], HAND_POINT[1] - drop, HAND_POINT[2]);
  if (drawn) {
    p.translate(side * -0.2785682, 0.18344387, 0.15731531).rotX(-13.935).rotY(side * 35.3).rotZ(side * -9.785);
    p.translate(0, 0, pull * 0.04).rotY(side * -45);
  }
  p.display(BOW_FP, side);
  out.twoHanded = false;
  const [gx, gy] = STYLES.bow.grip;
  out.gripLocal.set(gx / 16 - 0.5, 0.5 - gy / 16, 0);
  out.itemOffset.set(0, 0, 0);
  out.grip.copy(out.gripLocal).applyMatrix4(p.m);
  p.m.decompose(_v, out.itemRot, _s);
  out.itemScale = _s.x;
  const fa = drawn ? DRAW_FOREARM : BOW_FOREARM;
  const f = _v.set(side * fa[0], fa[1], fa[2]).normalize();
  const thumb = _s.set(0, 1, 0).addScaledVector(f, -f.y).normalize();
  _m.makeBasis(new THREE.Vector3().crossVectors(f, thumb), f, thumb);
  out.armRot.setFromRotationMatrix(_m);
  // A slighter hand here, so the fist doesn't hide the bow.
  out.armScale = BOW_ARM_SCALE;
  out.armStretch = 1;
  out.armOffset.copy(f).multiplyScalar((4.5 / 16) * BOW_ARM_SCALE);
}

function blendRest(a: Rest, b: Rest, k: number) {
  a.grip.lerp(b.grip, k);
  a.itemRot.slerp(b.itemRot, k);
  a.itemScale += (b.itemScale - a.itemScale) * k;
  a.gripLocal.lerp(b.gripLocal, k);
  a.itemOffset.lerp(b.itemOffset, k);
  a.armRot.slerp(b.armRot, k);
  a.armOffset.lerp(b.armOffset, k);
  a.armScale += (b.armScale - a.armScale) * k;
  a.armStretch += (b.armStretch - a.armStretch) * k;
  a.axis.lerp(b.axis, k).normalize();
}

// ---------------------------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------------------------

/** What an animation does this frame: turn the hand by `rot` about `pivot`, shift it, turn the item. */
interface Motion {
  pivot: THREE.Vector3;
  rot: THREE.Quaternion;
  offset: THREE.Vector3;
  wrist: THREE.Quaternion;
}

interface SampleContext {
  side: number;
  power: number;
  /** The fist, how far the hand is lowered (equip / attack recharge), and where the item points. */
  grip: THREE.Vector3;
  drop: number;
  axis: THREE.Vector3;
}

type Sampler = (t: number, m: Motion, c: SampleContext) => void;
interface Anim {
  duration: number;
  sample: Sampler;
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

/** Pitch about x, then yaw about y, then roll about z (all in the parent's axes). */
function pyr(p: number, y: number, r: number, out: THREE.Quaternion): THREE.Quaternion {
  out.setFromAxisAngle(Z, r);
  _q.setFromAxisAngle(Y, y);
  out.multiply(_q);
  _q.setFromAxisAngle(X, p);
  return out.multiply(_q);
}

function ease(k: ViewKey['ease'], x: number): number {
  switch (k) {
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - (1 - x) ** 3;
    case 'inOut':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    default:
      return x;
  }
}

type Channels = Pick<ViewKey, 'move' | 'hand' | 'wrist'>;

/** Keyframes or a `sample` function (both authored for the right hand), turning about the fist. */
function compile(anim: ViewAnimation): Anim {
  const out: Channels = {};
  const lerpKeys = (keys: ViewKey[], t: number) => {
    let i = 1;
    while (i < keys.length - 1 && keys[i].t < t) i++;
    const a = keys[i - 1] ?? keys[0];
    const b = keys[i] ?? a;
    const span = b.t - a.t;
    const x = ease(b.ease, span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 1);
    const mix = (u?: V3, v?: V3): V3 => {
      const p = u ?? [0, 0, 0];
      const q = v ?? [0, 0, 0];
      return [p[0] + (q[0] - p[0]) * x, p[1] + (q[1] - p[1]) * x, p[2] + (q[2] - p[2]) * x];
    };
    out.move = mix(a.move, b.move);
    out.hand = mix(a.hand, b.hand);
    out.wrist = mix(a.wrist, b.wrist);
    return out;
  };
  return {
    duration: anim.duration,
    sample: (t, m, c) => {
      const k = 'keys' in anim ? lerpKeys(anim.keys, t) : anim.sample(t);
      const [mx, my, mz] = k.move ?? [0, 0, 0];
      const [hp, hy, hr] = k.hand ?? [0, 0, 0];
      const [wp, wy, wr] = k.wrist ?? [0, 0, 0];
      const p = c.power;
      const l = c.side;
      m.pivot.copy(c.grip);
      m.offset.set(l * mx * p, my * p, mz * p);
      pyr(hp * p, l * hy * p, l * hr * p, m.rot);
      pyr(wp * p, l * wy * p, l * wr * p, m.wrist);
    },
  };
}

const _c0 = new Pose();
const _c1 = new Pose();

/** How Minecraft's first-person arm has moved at swing progress `s`, as a rigid motion. */
function armDelta(s: number, m: Motion, c: SampleContext) {
  armChain(_c0, c.side, 0, c.drop);
  armChain(_c1, c.side, Math.min(1, s), c.drop);
  _m.copy(_c1.m).multiply(_mi.copy(_c0.m).invert());
  _m.decompose(m.offset, m.rot, _s);
  m.pivot.set(0, 0, 0);
}

const BUILTIN: Record<string, Anim> = {
  // Minecraft's arm swing (`renderPlayerArm`), with the blade chopping forward in the fist.
  swing: {
    duration: 0.3,
    sample: (s, m, c) => {
      armDelta(s, m, c);
      m.wrist.setFromAxisAngle(X, -55 * DEG * Math.sin(Math.sqrt(s) * Math.PI) * c.power);
    },
  },
  // The bare-hand version: just the arm.
  punch: {
    duration: 0.3,
    sample: (s, m, c) => {
      armDelta(s, m, c);
      m.wrist.identity();
    },
  },
  // Minecraft's eat / drink pose (`applyEatTransform`): up to the mouth, a few gulps, back down.
  drink: {
    duration: 0.9,
    sample: (t, m, c) => {
      const l = c.side;
      const up = t < 0.12 ? ease('out', t / 0.12) : t > 0.85 ? ease('inOut', (1 - t) / 0.15) : 1;
      const bob = t > 0.15 && t < 0.85 ? Math.abs(Math.cos(t * 0.9 * 20 * 0.25 * Math.PI)) * 0.1 : 0;
      _item.reset().translate(l * 0.6 * up, -0.5 * up + bob * up, 0).rotY(l * 90 * up).rotX(10 * up).rotZ(l * 30 * up);
      m.pivot.set(0, 0, 0);
      _item.m.decompose(m.offset, m.rot, _s);
      m.wrist.identity();
    },
  },
  // Two-handed thrust along the shaft: out fast, back steady.
  jab: {
    duration: 0.34,
    sample: (t, m, c) => {
      const k = t < 0.3 ? ease('out', t / 0.3) : 1 - ease('inOut', (t - 0.3) / 0.7);
      m.pivot.copy(c.grip);
      m.rot.identity();
      m.wrist.identity();
      m.offset.copy(c.axis).multiplyScalar(0.45 * k * c.power);
      m.offset.y += 0.03 * k;
    },
  },
  // Bow recoil after a shot.
  release: compile({
    duration: 0.25,
    keys: [{ t: 0 }, { t: 0.2, hand: [0.2, 0, 0], move: [0, 0.03, 0.06], ease: 'out' }, { t: 1, ease: 'inOut' }],
  }),
  // Stylised alternatives a game can pick with `hold.use`.
  chop: compile({
    duration: 0.45,
    keys: [
      { t: 0 },
      { t: 0.4, hand: [0.5, 0.1, -0.1], wrist: [0.4, 0, 0], move: [-0.02, 0.08, 0.04], ease: 'out' },
      { t: 0.6, hand: [-0.6, 0.3, 0.2], wrist: [-0.9, 0, 0], move: [-0.12, -0.06, -0.1], ease: 'in' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  stab: compile({
    duration: 0.3,
    keys: [{ t: 0 }, { t: 0.3, wrist: [-1.1, 0, 0], move: [-0.12, 0.08, -0.3], ease: 'out' }, { t: 1, ease: 'inOut' }],
  }),
};

// ---------------------------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------------------------

/** Everything the runtime feeds in each frame. */
export interface ViewInput {
  aspect: number;
  /** Walk cycle phase (radians) and amount 0..1. */
  bobPhase: number;
  bobAmount: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  vy: number;
  /** Lower the arm out of view (death). */
  down: boolean;
  /** Melee readiness 0..1 (Minecraft's attack strength): the item dips after a hit and rises as it recovers. */
  strength: number;
}

interface HeldSprite {
  kind: 'sprite';
  geometry: THREE.BufferGeometry;
  albedo: THREE.Texture;
  emissive: THREE.Texture;
  hold: HoldSpec;
  style: HoldStyle;
}
interface HeldBlock {
  kind: 'block';
  def: BlockDef;
}
type Held = HeldSprite | HeldBlock | { kind: 'empty' };

export class ViewModel implements ViewModelApi {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.02, 10);
  /** Debug: slow motion. */
  timeScale = 1;
  /** Bow draw 0..1 (set by combat). */
  draw = 0;

  private root = new THREE.Group();
  private hand = new THREE.Group();
  private arm: THREE.Mesh;
  /** The other hand, for two-handed holds. */
  private arm2: THREE.Mesh;
  private armMaterial: THREE.RawShaderMaterial;
  private spriteMesh: THREE.Mesh;
  private spriteMaterial: THREE.RawShaderMaterial;
  private cube: THREE.Mesh;
  private cross: THREE.Mesh;
  private blockMaterial: THREE.RawShaderMaterial;
  private light = new THREE.Vector3(1, 1, 1);

  private held: Held = { kind: 'empty' };
  private pending: Held | null = null;
  private style: StyleDef | null = null;
  private styleName: HoldStyle | null = null;
  private hold: HoldSpec = {};
  private side: 1 | -1 = 1;
  private armSide: 1 | -1 = 1;
  private skin: { uv: [number, number]; atlas: string } | null = { uv: [0, 0], atlas: 'builtin' };
  private apiVisible = true;

  private anims = new Map<string, Anim>(Object.entries(BUILTIN));
  private playing: { anim: Anim; t: number; power: number; speed: number } | null = null;
  private motion: Motion = { pivot: new THREE.Vector3(), rot: new THREE.Quaternion(), offset: new THREE.Vector3(), wrist: new THREE.Quaternion() };
  private fadeFrom = { pos: new THREE.Vector3(), rot: new THREE.Quaternion(), wrist: new THREE.Quaternion() };
  private fadeT = 1;

  /** Minecraft's `mainHandHeight`: 1 = raised, 0 = fully dipped. */
  private height = 0;
  private drawBlend = 0;
  private time = 0;
  private lastYaw = NaN;
  private lastPitch = 0;
  private sway = new THREE.Vector2();
  private wasGround = true;
  private lastVy = 0;
  private dip = 0;
  private dipVel = 0;
  private kickA = 0;
  private kickVel = 0;
  private downT = 0;

  private rest = newRest();
  private restDrawn = newRest();
  private drop = 0;
  private tmpQ = new THREE.Quaternion();

  constructor(albedo: THREE.Texture, material: THREE.Texture, private graphics: EntityGraphics) {
    const blockUniforms = {
      uAlbedo: { value: albedo },
      uMaterial: { value: material },
      uLayers: { value: [0, 0, 0, 0, 0, 0] },
      uTint: { value: new THREE.Vector3(...DEFAULT_TINT.map(srgb)) },
      uTintMode: { value: 0 },
      uCutout: { value: 0 },
      uLight: { value: this.light },
    };
    const blockMaterial = (side: THREE.Side) =>
      new THREE.RawShaderMaterial({ vertexShader: blockVert, fragmentShader: blockFrag, glslVersion: THREE.GLSL3, side, uniforms: blockUniforms });
    this.blockMaterial = blockMaterial(THREE.FrontSide);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.setAttribute('face', new THREE.BufferAttribute(new Float32Array(Array.from({ length: 24 }, (_, i) => Math.floor(i / 4))), 1));
    this.cube = new THREE.Mesh(box, this.blockMaterial);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('face', new THREE.BufferAttribute(new Float32Array(4), 1));
    this.cross = new THREE.Mesh(plane, blockMaterial(THREE.DoubleSide));

    this.spriteMaterial = this.makeSpriteMaterial(THREE.DoubleSide);
    this.spriteMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.spriteMaterial);
    this.armMaterial = this.makeSpriteMaterial(THREE.FrontSide);
    this.arm = new THREE.Mesh(new THREE.BufferGeometry(), this.armMaterial);
    this.arm2 = new THREE.Mesh(new THREE.BufferGeometry(), this.armMaterial);
    this.buildArm();

    this.scene.add(this.root);
    this.root.add(this.hand);
    this.hand.add(this.arm, this.arm2, this.spriteMesh, this.cube, this.cross);
    for (const m of [this.arm, this.arm2, this.spriteMesh, this.cube, this.cross]) {
      m.frustumCulled = false;
      m.visible = false;
    }
    this.arm.visible = !!this.skin;
  }

  private makeSpriteMaterial(side: THREE.Side) {
    return new THREE.RawShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      glslVersion: THREE.GLSL3,
      side,
      uniforms: { uAtlas: { value: null }, uEmissive: { value: null }, uLight: { value: this.light } },
    });
  }

  // --- public API --------------------------------------------------------------------------

  get visible(): boolean {
    return this.apiVisible;
  }

  set visible(v: boolean) {
    this.apiVisible = v;
    this.root.visible = v;
  }

  setSkin(skin: [number, number] | null, atlas = 'builtin') {
    this.skin = skin ? { uv: skin, atlas } : null;
    this.buildArm();
  }

  define(name: string, anim: ViewAnimation) {
    this.anims.set(name, compile(anim));
  }

  play(anim: string | ViewAnimation, opts: { power?: number; speed?: number } = {}) {
    const a = typeof anim === 'string' ? this.anims.get(anim) : compile(anim);
    if (!a) throw new Error(`viewModel.play: unknown animation "${anim as string}"`);
    // Cross-fade from wherever the hand is now.
    this.fadeFrom.pos.copy(this.hand.position);
    this.fadeFrom.rot.copy(this.hand.quaternion);
    this.fadeFrom.wrist.copy(this.motion.wrist);
    this.fadeT = this.playing ? 0 : 1;
    this.playing = { anim: a, t: 0, power: opts.power ?? 1, speed: opts.speed ?? 1 };
  }

  kick(strength = 1) {
    this.kickVel += strength * 7;
  }

  // --- runtime-facing ----------------------------------------------------------------------

  /** The held item's own action: swing, drink, loose a bow, place a block, punch. */
  use(power = 1) {
    let anim: string | ViewAnimation;
    if (this.held.kind === 'sprite') anim = this.hold.use ?? STYLES[this.held.style].use;
    else if (this.held.kind === 'block') anim = 'swing';
    else anim = 'punch';
    this.play(anim, { power });
  }

  /** A plain swing (attacking with something that isn't a weapon). */
  swing(power = 1) {
    this.play(this.held.kind === 'empty' ? 'punch' : 'swing', { power });
  }

  /** Hold an extruded sprite item. */
  setItem(geometry: THREE.BufferGeometry, albedo: THREE.Texture, emissive: THREE.Texture, hold: HoldSpec, fallback: HoldStyle) {
    const target = this.pending ?? this.held;
    if (target.kind === 'sprite' && target.geometry === geometry) return;
    this.pending = { kind: 'sprite', geometry, albedo, emissive, hold, style: hold.style ?? fallback };
  }

  /** Swap the geometry immediately (bow draw frames). */
  swapItemGeometry(geometry: THREE.BufferGeometry) {
    if (this.held.kind === 'sprite') this.held.geometry = geometry;
    this.spriteMesh.geometry = geometry;
  }

  setEmpty() {
    const target = this.pending ?? this.held;
    if (target.kind !== 'empty') this.pending = { kind: 'empty' };
  }

  setBlock(def: BlockDef | undefined) {
    if (!def) return;
    const target = this.pending ?? this.held;
    if (target.kind === 'block' && target.def === def) return;
    this.pending = { kind: 'block', def };
  }

  setLight(c: THREE.Vector3) {
    this.light.lerp(c, 0.2);
  }

  /** Dev: tweak the two-handed hold live. */
  debugPole(patch: Partial<typeof POLE>) {
    Object.assign(POLE, patch);
  }

  /** Dev: tweak a style live. */
  debugStyle(style: HoldStyle, patch: Partial<StyleDef>) {
    Object.assign(STYLES[style], patch);
    if (this.styleName === style && this.held.kind !== 'empty') this.apply(this.held);
  }

  // --- internals ---------------------------------------------------------------------------

  /** Main arm (right, or mirrored for the left hand; classic skin layout) and the other one. */
  private buildArm() {
    this.arm.visible = !!this.skin;
    if (!this.skin) return;
    const a = this.graphics.atlas(this.skin.atlas);
    const [u, v] = this.skin.uv;
    const box = (mirror: boolean) =>
      boxGeometry({ name: 'arm', size: [4, 12, 4], uv: [u + 40, v + 16], pivot: [0, 0, 0], offset: [0, 0, 0], mirror }, a.width, a.height);
    this.arm.geometry.dispose();
    this.arm.geometry = box(this.armSide < 0);
    this.arm2.geometry.dispose();
    this.arm2.geometry = box(this.armSide > 0);
    this.armMaterial.uniforms.uAtlas.value = a.albedo;
    this.armMaterial.uniforms.uEmissive.value = a.emissive;
  }

  private apply(h: Held) {
    this.held = h;
    this.spriteMesh.visible = this.cube.visible = this.cross.visible = false;
    this.style = null;
    this.styleName = null;
    this.hold = {};
    if (h.kind === 'sprite') {
      this.hold = h.hold;
      this.styleName = h.style;
      this.spriteMesh.geometry = h.geometry;
      this.spriteMaterial.uniforms.uAtlas.value = h.albedo;
      this.spriteMaterial.uniforms.uEmissive.value = h.emissive;
      this.spriteMesh.visible = true;
    } else if (h.kind === 'block') {
      const def = h.def;
      const cross = def.shape === 'cross';
      const u = this.blockMaterial.uniforms;
      (u.uLayers.value as number[]).splice(0, 6, ...def.tex);
      u.uTintMode.value = def.tint ? (def.layer === 0 ? 1 : 2) : 0;
      u.uCutout.value = def.layer === 1 ? 1 : 0;
      // Plants and torches are flat items; everything else is a little cube.
      this.styleName = cross ? 'item' : 'block';
      this.cube.visible = !cross;
      this.cross.visible = cross;
    }
    if (this.styleName) {
      const base = STYLES[this.styleName];
      const hd = this.hold;
      this.style = {
        ...base,
        rotation: hd.rotation ?? base.rotation,
        translation: hd.translation ?? base.translation,
        scale: base.scale * (hd.scale ?? 1),
        grip: hd.grip ?? (this.held.kind === 'block' && this.styleName === 'item' ? [8, 15.5] : base.grip),
      };
    }
    this.side = (this.hold.hand ?? 'right') === 'left' ? -1 : 1;
    if (this.side !== this.armSide) {
      this.armSide = this.side;
      this.buildArm();
    }
    this.playing = null;
  }

  /**
   * Two hands: as an animation moves the fists, turn each forearm toward where its elbow was at
   * rest, so the arms reach rather than slide.
   */
  private reach(r: Rest) {
    const inv = this.tmpQ.copy(this.hand.quaternion).invert();
    const len = (4.5 / 16) * r.armScale * r.armStretch;
    const fit = (fist: THREE.Vector3, restOffset: THREE.Vector3, rot: THREE.Quaternion, pos: THREE.Vector3, restFist: THREE.Vector3) => {
      // Elbow at rest (root space), fist now (root space).
      const elbow = _v.copy(restOffset).normalize().multiplyScalar(0.55).add(restFist);
      const now = _s.copy(fist).applyQuaternion(this.hand.quaternion).add(this.hand.position);
      const dir = elbow.sub(now).normalize().applyQuaternion(inv);
      const axis = r.axis.clone().applyQuaternion(inv);
      forearmDir(dir.clone(), axis, rot);
      pos.copy(fist).addScaledVector(dir, len);
    };
    fit(new THREE.Vector3(), r.armOffset, this.arm.quaternion, this.arm.position, r.grip);
    const off2 = r.arm2Offset.clone().sub(r.grip2);
    fit(r.grip2.clone(), off2, this.arm2.quaternion, this.arm2.position, r.grip.clone().add(r.grip2));
  }

  update(rawDt: number, input: ViewInput) {
    const dt = rawDt * this.timeScale;
    this.time += dt;
    this.camera.aspect = input.aspect;
    this.camera.updateProjectionMatrix();
    const l = this.side;

    // Minecraft's hand height: dips to swap items, and after each hit as the attack recharges.
    const target = this.pending ? 0 : Math.max(0, Math.min(1, input.strength)) ** 3;
    this.height += THREE.MathUtils.clamp(target - this.height, -8 * dt, 8 * dt);
    if (this.pending && this.height < 0.1) {
      this.apply(this.pending);
      this.pending = null;
    }
    this.downT = THREE.MathUtils.clamp(this.downT + (input.down ? dt : -dt) / 0.4, 0, 1);
    const down = this.downT * this.downT * (3 - 2 * this.downT);
    this.drop = (1 - this.height) * 0.6 + down * 0.8;

    // Rest pose: Minecraft's arm holding the item; a bow swings into Java's aiming pose as it's drawn.
    const r = this.rest;
    const bow = this.styleName === 'bow';
    this.drawBlend = THREE.MathUtils.clamp(this.drawBlend + (this.draw > 0 && bow ? dt : -dt) / 0.12, 0, 1);
    if (bow) {
      bowRest(l, this.drop, false, 0, r);
      if (this.drawBlend > 0) {
        bowRest(l, this.drop, true, Math.min(1, this.draw), this.restDrawn);
        blendRest(r, this.restDrawn, this.drawBlend * this.drawBlend * (3 - 2 * this.drawBlend));
      }
    } else if (this.styleName === 'polearm' && this.style) {
      polearmRest(this.style, this.hold.model, l, this.drop, r);
    } else {
      attachedRest(this.style, this.hold.model, l, this.drop, r);
    }

    // Animation (turn about a pivot, shift, turn the item), cross-faded from the previous one.
    const m = this.motion;
    m.rot.identity();
    m.wrist.identity();
    m.offset.set(0, 0, 0);
    m.pivot.copy(r.grip);
    if (this.playing) {
      const p = this.playing;
      p.t += (dt * p.speed) / p.anim.duration;
      if (p.t >= 1) this.playing = null;
      else p.anim.sample(p.t, m, { side: l, power: p.power, grip: r.grip, drop: this.drop, axis: r.axis });
    }
    const hp = this.hand.position.copy(r.grip).sub(m.pivot).applyQuaternion(m.rot).add(m.pivot).add(m.offset);
    this.hand.quaternion.copy(m.rot);
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / 0.06);
      const k = 1 - this.fadeT;
      hp.lerp(this.fadeFrom.pos, k);
      this.hand.quaternion.slerp(this.fadeFrom.rot, k);
      m.wrist.slerp(this.fadeFrom.wrist, k);
    }

    // Item: its fist point on the hand, turned by the wrist.
    if (this.held.kind !== 'empty') {
      const mesh = this.held.kind === 'sprite' ? this.spriteMesh : this.cube.visible ? this.cube : this.cross;
      const q = this.tmpQ.copy(m.wrist).multiply(r.itemRot);
      mesh.quaternion.copy(q);
      mesh.scale.setScalar(r.itemScale);
      mesh.position.copy(r.gripLocal).multiplyScalar(-r.itemScale).applyQuaternion(q).add(r.itemOffset);
    }
    this.arm.quaternion.copy(r.armRot);
    this.arm.position.copy(r.armOffset);
    this.arm.scale.set(r.armScale, r.armScale * r.armStretch, r.armScale);
    this.arm2.visible = r.twoHanded && !!this.skin;
    if (r.twoHanded) {
      this.arm2.quaternion.copy(r.arm2Rot);
      this.arm2.position.copy(r.arm2Offset);
      this.arm2.scale.set(r.armScale, r.armScale * r.armStretch, r.armScale);
      if (this.playing || this.fadeT < 1) this.reach(r);
    }

    // Procedural motion: breathing, walk bob, look sway, landing dip, recoil.
    const breathe = Math.sin(this.time * 1.7);
    const bob = input.bobAmount;
    if (Number.isNaN(this.lastYaw)) {
      this.lastYaw = input.yaw;
      this.lastPitch = input.pitch;
    }
    let dyaw = input.yaw - this.lastYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dpitch = input.pitch - this.lastPitch;
    this.lastYaw = input.yaw;
    this.lastPitch = input.pitch;
    if (rawDt > 0) {
      const tx = THREE.MathUtils.clamp((-dyaw / rawDt) * 0.015, -0.07, 0.07);
      const ty = THREE.MathUtils.clamp((-dpitch / rawDt) * 0.015, -0.06, 0.06);
      const k = Math.min(1, rawDt * 12);
      this.sway.x += (tx - this.sway.x) * k;
      this.sway.y += (ty - this.sway.y) * k;
    }
    if (input.onGround && !this.wasGround && this.lastVy < -4) this.dipVel -= Math.min(1.6, -this.lastVy * 0.09);
    this.wasGround = input.onGround;
    this.lastVy = input.vy;
    this.dipVel += (-this.dip * 160 - this.dipVel * 16) * dt;
    this.dip += this.dipVel * dt;
    this.kickVel += (-this.kickA * 200 - this.kickVel * 18) * dt;
    this.kickA += this.kickVel * dt;
    const shake = this.styleName === 'bow' && this.draw >= 1 ? Math.sin(this.time * 55) * 0.003 : 0;
    this.root.position.set(
      Math.cos(input.bobPhase) * 0.024 * bob + shake,
      -Math.abs(Math.sin(input.bobPhase)) * 0.03 * bob + breathe * 0.004 + this.dip * 0.1 + this.kickA * 0.02,
      this.kickA * 0.05,
    );
    pyr(this.sway.y + this.dip * 0.2 + this.kickA * 0.15, this.sway.x, this.sway.x * 0.5 + Math.sin(input.bobPhase) * 0.02 * bob, this.root.quaternion);
  }
}
