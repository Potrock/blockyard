import * as THREE from 'three';
import type { BlockDef } from '../world/registry';
import { DEFAULT_TINT } from '../world/registry';
import type { FirstPersonArms, GltfSpec, GunAction, GunHold, HeldModelSpec, HoldSpec, HoldStyle, ViewAnimation, ViewKey, ViewModelApi } from '../api/types';
import { boxGeometry, type EntityGraphics } from './entities';
import { itemFaces } from './blockmodel';
import { HELD_SCALE } from '../client/humanoid';
import { setSurface, surfaceUniforms, type HumanoidArms, type ItemMesh, type ItemPoint, type Surface } from '../client/gltf';
import { gunPoints, sameSpec, type GunPoints } from '../client/held';
import { ARM_FIT, fitArms, placeBent, placeStraight, upperFor, wristFor, type ArmFit, type ArmParts } from './viewarms';

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
in float layer;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out float vShade;
flat out int vFace;
flat out float vLayer;
void main() {
  vUv = uv;
  vFace = int(face + 0.5);
  vLayer = layer;
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
flat in float vLayer;
layout(location = 0) out vec4 fragColor;
void main() {
  // A block model's faces carry their own texture; a cube's come from uLayers by face.
  float layer = vLayer >= 0.0 ? vLayer : uLayers[vFace];
  // A model's faces show part of one tile, which needn't tile: keep off its far edge.
  vec2 uv = vLayer >= 0.0 ? clamp(vec2(vUv.x, 1.0 - vUv.y), 1.0 / 64.0, 1.0 - 1.0 / 64.0) : vec2(vUv.x, 1.0 - vUv.y);
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
out vec3 vView;
out vec3 vN;
void main() {
  vUv = uv;
  vec3 n = normalize(normalMatrix * normal);
  // Key light from the upper right, soft fill from the camera.
  float key = clamp(dot(n, normalize(vec3(0.45, 0.85, 0.35))), 0.0, 1.0);
  float fill = clamp(n.z, 0.0, 1.0);
  vShade = 0.42 + 0.45 * key + 0.18 * fill;
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  vView = viewPos.xyz;
  vN = n;
  gl_Position = projectionMatrix * viewPos;
  ${DEPTH}
}`;

const spriteFrag = /* glsl */ `
precision highp float;
uniform sampler2D uAtlas;
uniform sampler2D uEmissive;
uniform sampler2D uMaterialMap; // glTF metallic-roughness: G roughness, B metalness
uniform vec2 uMaterial;         // metalness and roughness factors
uniform vec3 uLight;
in vec2 vUv;
in float vShade;
in vec3 vView;
in vec3 vN;
layout(location = 0) out vec4 fragColor;
const float PI = 3.14159265;
void main() {
  vec4 a = texture(uAtlas, vUv);
  if (a.a < 0.5) discard;
  vec4 mr = texture(uMaterialMap, vUv);
  float metal = clamp(uMaterial.x * mr.b, 0.0, 1.0);
  float rough = clamp(uMaterial.y * mr.g, 0.06, 1.0);
  vec3 c = a.rgb * (1.0 - metal) * uLight * vShade;
  if (metal > 0.001 || rough < 0.97) {
    // The same key light shining off it, and a studio's bright top and dark floor in it.
    vec3 N = normalize(gl_FrontFacing ? vN : -vN);
    vec3 V = normalize(-vView);
    vec3 L = normalize(vec3(0.45, 0.85, 0.35));
    vec3 H = normalize(L + V);
    float NoV = max(dot(N, V), 1e-3);
    float NoL = max(dot(N, L), 0.0);
    float NoH = max(dot(N, H), 0.0);
    float al = rough * rough;
    float a2 = al * al;
    float d = (NoH * a2 - NoH) * NoH + 1.0;
    float D = a2 / (PI * d * d + 1e-7);
    float Vis = 0.5 / (NoL * sqrt(NoV * NoV * (1.0 - a2) + a2) + NoV * sqrt(NoL * NoL * (1.0 - a2) + a2) + 1e-5);
    vec3 F0 = mix(vec3(0.04), a.rgb, metal);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    c += uLight * 1.4 * D * Vis * F * NoL;
    vec3 R = reflect(-V, N);
    float up = smoothstep(-0.35, 0.65, R.y);
    vec3 env = uLight * mix(mix(0.12, 1.25, up), 0.55, rough);
    vec3 Fv = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NoV, 5.0);
    c += env * Fv * mix(1.0, 0.4, rough);
  }
  fragColor = vec4(c + a.rgb * texture(uEmissive, vUv).r * 3.0, 1.0);
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
  // Two hands on a gun: at the hip, up to the eye, across the chest (see `gunRest`).
  gun: { rotation: [0, 0, 0], scale: 0.42, grip: [8, 8], translation: [0, 0, 0], use: 'fire' },
  // A throwable up by the shoulder, ready to go (a sprite: raised and turned toward you).
  throw: { rotation: [-15, -60, 20], scale: 0.5, grip: [8, 11], translation: [-1.5, 3, 1.5], use: 'toss' },
};

/**
 * A gun's poses (camera space, right hand): at the hip (the fist low at the right, the barrel
 * converging on the crosshair far ahead, canted a little), compact guns (pistols) nearer the
 * middle, sprinting (swung down and across the chest) and aiming down the sights (the sight on
 * the eye line, `ads` blocks ahead). Forearms run from each fist toward its elbow. A gun's own
 * `hold.gun` goes over these (see `GunHold`).
 */
interface GunPose {
  fist: V3;
  /** Which way the barrel points at the hip: nearly straight ahead, a touch inward. */
  barrel: V3;
  roll: number;
  sprint: { yaw: number; pitch: number; roll: number; move: V3 };
  slide: { roll: number; move: V3 };
  /** How far ahead of the eye the sight sits when aiming; null: by the sight (`GUN_ADS`). */
  ads: number | null;
  forearm: { hip: V3; ads: V3 };
  forearm2: { hip: V3; ads: V3 };
  /** Blocks of camera-space kick back and degrees of rise per unit of recoil. */
  kick: number;
  rise: number;
  /** Hands on it (one: the support hand out of sight but to reload), and a humanoid's arms on it (over their model's). */
  hands: 1 | 2;
  arm?: FirstPersonArms;
}

const GUN: GunPose = {
  fist: [0.235, -0.255, -0.62],
  barrel: [-0.1, 0.045, -1],
  roll: -0.22,
  sprint: { yaw: 0.8, pitch: -0.5, roll: -0.45, move: [-0.08, -0.06, 0.08] },
  slide: { roll: 0.35, move: [-0.04, -0.03, 0.02] },
  ads: null,
  forearm: { hip: [0.32, -0.74, 0.6], ads: [0.22, -0.64, 0.74] },
  forearm2: { hip: [-0.52, -0.72, 0.48], ads: [-0.4, -0.72, 0.56] },
  kick: 0.075,
  rise: 7,
  hands: 2,
};
const COMPACT_FIST: V3 = [0.12, -0.19, -0.52];
/** How far ahead of the eye the sight sits when aiming: iron sights, an optic's window (nearer, so it frames more), a scope. */
const GUN_ADS = { iron: 0.42, optic: 0.3, scope: 0.46 };

/** A gun's poses: its own `hold.gun` over the defaults (a compact gun's fist nearer the middle). */
function gunPose(o: GunHold | undefined, compact: boolean): GunPose {
  const d = GUN;
  return {
    fist: o?.fist ?? (compact ? COMPACT_FIST : d.fist),
    barrel: o?.barrel ?? d.barrel,
    roll: o?.roll ?? d.roll,
    sprint: { yaw: o?.sprint?.yaw ?? d.sprint.yaw, pitch: o?.sprint?.pitch ?? d.sprint.pitch, roll: o?.sprint?.roll ?? d.sprint.roll, move: o?.sprint?.move ?? d.sprint.move },
    slide: { roll: o?.slide?.roll ?? d.slide.roll, move: o?.slide?.move ?? d.slide.move },
    ads: o?.ads ?? null,
    forearm: { hip: o?.forearm?.hip ?? d.forearm.hip, ads: o?.forearm?.ads ?? d.forearm.ads },
    forearm2: { hip: o?.forearm2?.hip ?? d.forearm2.hip, ads: o?.forearm2?.ads ?? d.forearm2.ads },
    kick: o?.kick ?? d.kick,
    rise: o?.rise ?? d.rise,
    hands: o?.hands === 1 ? 1 : 2,
    arm: o?.arm,
  };
}

/** What the runtime tells the view model about the gun in hand, each frame. */
export interface GunView {
  /** Aimed down the sights 0..1, sprinting 0..1, sliding 0..1. */
  aim: number;
  sprint: number;
  slide: number;
  /** Reload progress 0..1, or -1; a shotgun's rounds go in one at a time (`shells`, how many are going in). */
  reload: number;
  shells: number;
  /** What aiming looks through: a scope hides the gun once it's up. */
  sight: 'iron' | 'dot' | 'holo' | 'scope';
  /** Worked after each shot. */
  action?: GunAction;
}

/** Working a gun's action: how long after the shot it starts, and how long each built-in one takes (seconds). */
const CYCLE = { delay: 0.08, pump: 0.42, bolt: 0.42, lever: 0.45, hammer: 0.26 };

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

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _fa = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _fc = new THREE.Vector3();

/** An item turned to point along `axis` (its +z), upright (its +y as near up as it goes), then rolled about the axis. */
function aimBasis(axis: THREE.Vector3, roll: number, out: THREE.Quaternion): THREE.Quaternion {
  const up = _s.set(0, 1, 0).addScaledVector(axis, -axis.y).normalize().applyAxisAngle(axis, roll);
  _m.makeBasis(_v.crossVectors(up, axis), up, axis);
  return out.setFromRotationMatrix(_m);
}

/** A gun has the whole of a pistol's length or less ahead of the hand: held nearer the middle. */
const isCompact = (pts: GunPoints) => pts.muzzle.z - pts.grip.z < 11 / 16;

/**
 * Two hands on a gun, blending its poses: at the hip, swung across the chest to sprint, leaning
 * into a slide, and up to the eye with the sight on the eye line to aim down the sights.
 */
function gunRest(pts: GunPoints, pose: GunPose, hold: HoldSpec, side: number, drop: number, gv: GunView, out: Rest) {
  const S = STYLES.gun.scale * (hold.scale ?? 1);
  const f0 = pose.fist;
  // At the hip.
  const fistH = _fa.set(side * f0[0], f0[1], f0[2]);
  const axis = _fb.set(side * pose.barrel[0], pose.barrel[1], pose.barrel[2]).normalize();
  const qH = aimBasis(axis, side * pose.roll, _qa);
  // Sprinting: swung down and across.
  const sp = pose.sprint;
  const qS = _qb.setFromEuler(new THREE.Euler(sp.pitch, side * sp.yaw, side * sp.roll, 'YXZ')).multiply(qH);
  // Aiming down the sights: dead ahead, the sight on the eye line.
  const qA = aimBasis(_fc.set(0, 0, -1), 0, _qc);
  const k = gv.sprint * (1 - gv.aim);
  const a = gv.aim * gv.aim * (3 - 2 * gv.aim);
  out.itemRot.copy(qH).slerp(qS, k);
  const sl = gv.slide * (1 - gv.aim);
  if (sl > 0) out.itemRot.premultiply(new THREE.Quaternion().setFromAxisAngle(Z, side * pose.slide.roll * sl));
  out.itemRot.slerp(qA, a);
  const sightCam = new THREE.Vector3().subVectors(pts.sight, pts.grip).multiplyScalar(S).applyQuaternion(qA);
  const dist = pose.ads ?? (gv.sight === 'scope' ? GUN_ADS.scope : gv.sight === 'dot' || gv.sight === 'holo' ? GUN_ADS.optic : GUN_ADS.iron);
  const fistA = new THREE.Vector3(0, 0, -dist).sub(sightCam);
  out.grip
    .copy(fistH)
    .add(_v.set(side * sp.move[0], sp.move[1], sp.move[2]).multiplyScalar(k))
    .add(_v.set(side * pose.slide.move[0], pose.slide.move[1], pose.slide.move[2]).multiplyScalar(sl))
    .lerp(fistA, a);
  out.grip.y -= drop;
  out.itemScale = S;
  out.gripLocal.copy(pts.grip);
  out.itemOffset.set(0, 0, 0);
  out.axis.set(0, 0, 1).applyQuaternion(out.itemRot);
  // Forearms: the firing hand's from the grip, the other's from the handguard (or the pistol's grip).
  const [fh, fa] = [pose.forearm.hip, pose.forearm.ads];
  const fr = _v.set(side * fh[0], fh[1], fh[2]).lerp(_s.set(side * fa[0], fa[1], fa[2]), a).normalize();
  forearmDir(fr.clone(), out.axis, out.armRot);
  out.armScale = S;
  out.armStretch = 1;
  out.armOffset.copy(fr).multiplyScalar(((4.5 + 1.8) / 16) * S);
  out.twoHanded = true;
  out.grip2.subVectors(pts.grip2, pts.grip).multiplyScalar(S).applyQuaternion(out.itemRot);
  const [f2h, f2a] = [pose.forearm2.hip, pose.forearm2.ads];
  const fl = _v.set(side * f2h[0], f2h[1], f2h[2]).lerp(_s.set(side * f2a[0], f2a[1], f2a[2]), a).normalize();
  forearmDir(fl.clone(), out.axis, out.arm2Rot);
  out.arm2Offset.copy(out.grip2).addScaledVector(fl, ((4.5 + 1.8) / 16) * S);
}

/** Default actions for 3D models (sprites use Minecraft's swing). */
const MODEL_USE: Partial<Record<HoldStyle, string>> = { sword: 'slash', axe: 'hew', item: 'sip' };

/**
 * One hand around a 3D model, in camera space: where the fist is, which way the item points
 * (its +z) and which way its face turns (its +y), the forearm (fist toward elbow, right hand),
 * the hand's size and the item's scale.
 */
interface ModelGrip {
  fist: V3;
  axis: V3;
  face: V3;
  forearm: V3;
  hand: number;
  scale: number;
}

const MODEL_GRIPS: Partial<Record<HoldStyle, ModelGrip>> = {
  // Blade up and into the scene toward the top of the screen, its flat turned to you.
  sword: { fist: [0.36, -0.44, -0.78], axis: [-0.28, 0.8, -0.53], face: [-0.62, 0.05, 0.78], forearm: [0.4, -0.7, 0.6], hand: 0.8, scale: 0.62 },
  // Held low on the haft, head up, the edge facing forward.
  axe: { fist: [0.38, -0.5, -0.78], axis: [-0.2, 0.85, -0.48], face: [-0.94, 0, 0.33], forearm: [0.4, -0.7, 0.6], hand: 0.8, scale: 0.55 },
  // Upright in the fist, leaning back a little, label side to you.
  item: { fist: [0.34, -0.42, -0.7], axis: [-0.1, 0.99, 0.06], face: [-0.4, 0, 0.92], forearm: [0.35, -0.75, 0.55], hand: 0.8, scale: 0.5 },
  // Wound up to throw: the fist up at the right, level with the eyes and a little back, the
  // throwable standing in it, the forearm down toward the elbow below.
  throw: { fist: [0.36, -0.12, -0.52], axis: [-0.15, 0.97, 0.18], face: [-0.5, 0, 0.87], forearm: [0.2, -0.9, 0.4], hand: 0.8, scale: 0.42 },
};

/** Holding a 3D model in one hand (see `MODEL_GRIPS`). */
function modelRest(g: ModelGrip, hold: HoldSpec, model: HeldModelSpec, side: number, drop: number, out: Rest) {
  out.twoHanded = false;
  out.grip.set(side * g.fist[0], g.fist[1] - drop, g.fist[2]);
  const axis = out.axis.set(side * g.axis[0], g.axis[1], g.axis[2]).normalize();
  const face = _s.set(side * g.face[0], g.face[1], g.face[2]);
  face.addScaledVector(axis, -face.dot(axis)).normalize();
  _m.makeBasis(_v.crossVectors(face, axis), face, axis);
  out.itemRot.setFromRotationMatrix(_m);
  // The item's own tweaks (degrees and pixels, camera axes) on top.
  const [rx, ry, rz] = hold.rotation ?? [0, 0, 0];
  if (rx || ry || rz) out.itemRot.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * DEG, side * ry * DEG, side * rz * DEG)));
  out.itemScale = g.scale * (hold.scale ?? 1);
  const gp = model.grip ?? [0, 0, 0];
  out.gripLocal.set(gp[0] / 16, gp[1] / 16, gp[2] / 16);
  const [tx, ty, tz] = hold.translation ?? [0, 0, 0];
  out.itemOffset.set((side * tx) / 16, ty / 16, tz / 16);
  const f = forearm(g.forearm, side, axis, out.armRot);
  out.armOffset.copy(f).multiplyScalar((4.5 / 16) * g.hand);
  out.armScale = g.hand;
  out.armStretch = 1;
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
  // A diagonal cut for 3D blades: cock it back over the right shoulder, sweep it across the
  // middle of the screen to the left (mostly a roll, so the blade stays in view), recover.
  slash: compile({
    duration: 0.34,
    keys: [
      { t: 0 },
      { t: 0.2, hand: [0.25, -0.1, -0.6], move: [0.06, 0.1, 0.05], ease: 'out' },
      { t: 0.45, hand: [-0.1, 0.25, 0.85], move: [-0.18, 0.12, -0.12], ease: 'in' },
      { t: 0.62, hand: [-0.25, 0.3, 1.3], move: [-0.28, -0.02, -0.08], ease: 'out' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  // Drinking from a held bottle: up toward your mouth, neck tipped to you, a few gulps.
  sip: compile({
    duration: 0.9,
    keys: [
      { t: 0 },
      { t: 0.18, hand: [0.75, 0.15, 0.3], move: [-0.22, 0.17, 0.08], ease: 'out' },
      { t: 0.34, hand: [0.9, 0.15, 0.3], move: [-0.22, 0.2, 0.09], ease: 'inOut' },
      { t: 0.5, hand: [0.75, 0.15, 0.3], move: [-0.22, 0.17, 0.08], ease: 'inOut' },
      { t: 0.66, hand: [0.9, 0.15, 0.3], move: [-0.22, 0.2, 0.09], ease: 'inOut' },
      { t: 0.8, hand: [0.75, 0.15, 0.3], move: [-0.22, 0.17, 0.08], ease: 'inOut' },
      { t: 1, ease: 'inOut' },
    ],
  }),
  // An overhead hew for axes and hammers: heave it back, bring it down in front of you.
  hew: compile({
    duration: 0.44,
    keys: [
      { t: 0 },
      { t: 0.36, hand: [0.4, -0.05, -0.15], move: [0.02, 0.1, 0.05], ease: 'out' },
      { t: 0.56, hand: [-0.85, 0.15, 0.2], move: [-0.06, -0.06, -0.16], ease: 'in' },
      { t: 1, ease: 'inOut' },
    ],
  }),
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
  // A throw from the `throw` pose: a last cock back, then the arm whips forward and across and
  // follows through down out of sight (the throwable's gone from the hand by then).
  toss: compile({
    duration: 0.34,
    keys: [
      { t: 0 },
      { t: 0.14, hand: [-0.35, 0.1, 0.1], move: [0.03, 0.05, 0.08], ease: 'out' },
      { t: 0.38, hand: [1.1, 0.25, -0.2], move: [-0.2, -0.02, -0.42], ease: 'in' },
      { t: 1, hand: [1.5, 0.3, -0.3], move: [-0.22, -0.75, -0.25], ease: 'out' },
    ],
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
  /** The gun in hand (the `gun` hold style). */
  gun?: GunView;
}

interface HeldSprite {
  kind: 'sprite';
  geometry: THREE.BufferGeometry;
  albedo: THREE.Texture;
  emissive: THREE.Texture;
  surface?: Surface;
  hold: HoldSpec;
  style: HoldStyle;
  /** Points the model marks (guns: grip2, muzzle, sight, mag), in its own space. */
  points?: Partial<Record<ItemPoint, THREE.Vector3>>;
}
interface HeldBlock {
  kind: 'block';
  def: BlockDef;
  /** A bed's head half, to show it whole. */
  partner?: BlockDef;
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
  private cubeGeometry: THREE.BufferGeometry;
  /** Block models' geometry (slabs, stairs, beds), by block id. */
  private models = new Map<number, THREE.BufferGeometry>();
  private cross: THREE.Mesh;
  private blockMaterial: THREE.RawShaderMaterial;
  private light = new THREE.Vector3(1, 1, 1);

  private held: Held = { kind: 'empty' };
  private pending: Held | null = null;
  /** An animation to play once the item coming up is in hand (a throw made as it rose). */
  private queued: string | null = null;
  private style: StyleDef | null = null;
  private styleName: HoldStyle | null = null;
  private hold: HoldSpec = {};
  private side: 1 | -1 = 1;
  private armSide: 1 | -1 = 1;
  private skin: { uv: [number, number]; atlas: string } | null = { uv: [0, 0], atlas: 'builtin' };
  /** An arm of another shape than the skin's box (a player model's own arm). */
  private armLook: { geometry: THREE.BufferGeometry; albedo: THREE.Texture; emissive: THREE.Texture } | null = null;
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

  // --- guns ---
  /** The held gun's points (its own space, blocks). */
  private gunPts: GunPoints | null = null;
  /** The held gun's poses (its `hold.gun` over the defaults). */
  private gunPose: GunPose = GUN;
  /**
   * A humanoid player's own arms: how big, how far they reach, how the elbows bend, where the
   * support fist sits (their model's `firstPerson`, and the held gun's `hold.gun.arm` over it).
   */
  private modelFit: GltfSpec['firstPerson'];
  private fit: ArmFit = ARM_FIT;
  /** A humanoid player's own forearms and fists (their model's), in place of the skin's arms. */
  private humanoid: Record<'R' | 'L', ArmParts> | null = null;
  /** Bent arms: where each shoulder is (the view's space) and how long each upper arm is drawn, from the gun's pose at rest. */
  private shoulders = [new THREE.Vector3(), new THREE.Vector3()];
  private uppers = [0, 0];
  /** The support hand on show (a one-handed gun's only to reload), and where it waits out of sight then (the gun's space). */
  private supportShown = 1;
  private away = new THREE.Vector3();
  /** Actions of a game's own (`GunItem.action` as a `ViewAnimation`), compiled once each. */
  private actions = new WeakMap<ViewAnimation, Anim>();
  /** The hands on a gun (palms and fingers, in the gun's own space, so they move with it). */
  private gunHands = new THREE.Group();
  private gunHand2 = new THREE.Group();
  /** Springs: the kick back and the muzzle rise after a shot. */
  private recoil = { z: 0, vz: 0, r: 0, vr: 0, roll: 0, vroll: 0 };
  /** Working a pump or bolt after a shot: seconds in, or -1. */
  private cycleT = -1;
  private flash: THREE.Mesh;
  private flashT = 0;
  private lastGun: GunView | null = null;

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
    const box = (this.cubeGeometry = new THREE.BoxGeometry(1, 1, 1));
    box.setAttribute('face', new THREE.BufferAttribute(new Float32Array(Array.from({ length: 24 }, (_, i) => Math.floor(i / 4))), 1));
    box.setAttribute('layer', new THREE.BufferAttribute(new Float32Array(24).fill(-1), 1));
    this.cube = new THREE.Mesh(box, this.blockMaterial);
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('face', new THREE.BufferAttribute(new Float32Array(4), 1));
    plane.setAttribute('layer', new THREE.BufferAttribute(new Float32Array(4).fill(-1), 1));
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
    this.flash = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: flashTexture(), color: new THREE.Color(7, 5, 2.4), blending: THREE.AdditiveBlending, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.flash.visible = false;
    this.flash.frustumCulled = false;
    this.flash.renderOrder = 10;
    this.spriteMesh.add(this.gunHands);
    this.gunHands.visible = false;
    this.gunHands.add(this.gunHand2);
    this.spriteMesh.add(this.flash);
  }

  private makeSpriteMaterial(side: THREE.Side) {
    return new THREE.RawShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      glslVersion: THREE.GLSL3,
      side,
      uniforms: { uAtlas: { value: null }, uEmissive: { value: null }, ...surfaceUniforms(), uLight: { value: this.light } },
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

  /** The arm as another shape and texture (a player model's own arm, standing along y), or null for the skin's. */
  setArm(look: { geometry: THREE.BufferGeometry; albedo: THREE.Texture; emissive: THREE.Texture } | null) {
    this.armLook = look;
    this.buildArm();
  }

  /** A humanoid player's arms (their model's forearms and fists, fitted by its `firstPerson`), or null for the skin's. */
  setHumanoidArms(arms: HumanoidArms | null, fit?: GltfSpec['firstPerson']) {
    this.modelFit = fit;
    this.refit();
    if (this.humanoid) {
      for (const side of Object.values(this.humanoid)) {
        for (const g of [side.upper, side.forearm, side.fist]) {
          g.removeFromParent();
          for (const c of g.children) ((c as THREE.Mesh).material as THREE.Material).dispose();
        }
      }
      this.humanoid = null;
    }
    if (arms) {
      const group = (parts: ItemMesh[]) => {
        const g = new THREE.Group();
        for (const part of parts) {
          const mat = this.makeSpriteMaterial(THREE.FrontSide);
          mat.uniforms.uAtlas.value = part.albedo;
          mat.uniforms.uEmissive.value = part.emissive;
          setSurface(mat.uniforms, part.surface);
          const m = new THREE.Mesh(part.geometry, mat);
          m.frustumCulled = false;
          g.add(m);
        }
        this.hand.add(g);
        return g;
      };
      const side = (arm: HumanoidArms['R']): ArmParts => ({ arm, upper: group(arm.upper), forearm: group(arm.forearm), fist: group(arm.fist) });
      this.humanoid = { R: side(arms.R), L: side(arms.L) };
    }
    this.buildArm();
  }

  /** The humanoid arms' fit for what's held: the model's, and a gun's own over it. */
  private refit() {
    this.fit = fitArms(this.modelFit, this.styleName === 'gun' ? this.gunPose.arm : undefined);
  }

  /** The size things are held at, less the item's own `hold.scale`: a humanoid's arms don't grow with the gun. */
  private heldBase(r: Rest): number {
    if (this.held.kind !== 'sprite') return STYLES.gun.scale;
    return this.styleName === 'bow' ? r.itemScale : r.itemScale / (this.hold.scale || 1);
  }

  /** Where the support fist holds, from the firing fist (hand space): round the handguard's near side (its left, the side we see), a little under it (a one-handed gun's: where its hand is). */
  private supportGrip(r: Rest, itemQ: THREE.Quaternion, k: number, out: THREE.Vector3): THREE.Vector3 {
    const fit = this.fit;
    const side = this.gunPts && this.gunPose.hands === 2 ? this.halfWidthAt(this.gunPts.grip2.z) * r.itemScale : 0;
    return out.set(side + fit.support[0] * k, fit.support[1] * k, fit.support[2] * k).applyQuaternion(itemQ).add(r.grip2);
  }

  /**
   * Bent arms on a gun: each shoulder (the view's space) where the arm at rest ends, `reach` from
   * its wrist along the pose's forearm line, and each upper arm drawn out so the elbow bends
   * `bend` at rest. From the pose before a reload or an action moves the hands, so they stay put.
   */
  private restShoulders(r: Rest) {
    const fit = this.fit;
    const hum = this.humanoid!;
    if (!(fit.bend[0] > 0 || fit.bend[1] > 0)) return;
    const k = (this.heldBase(r) / HELD_SCALE) * fit.scale;
    const dir = _fb.copy(r.armOffset).normalize().add(_fc.set(0.25 * this.side, 0.05, 0)).normalize();
    this.shoulders[0].copy(wristFor(hum.R, r.grip, r.itemRot, k, _v, fit.hands)).addScaledVector(dir, fit.reach[0]);
    this.uppers[0] = upperFor(fit.reach[0], hum.R.arm.wrist.length() * k, hum.R.arm.elbow.length() * k, fit.bend[0]);
    const at = this.supportGrip(r, r.itemRot, k, _fa).add(r.grip);
    this.shoulders[1].copy(wristFor(hum.L, at, r.itemRot, k, _v, fit.hands)).addScaledVector(_fb.subVectors(r.arm2Offset, r.grip2).normalize(), fit.reach[1]);
    this.uppers[1] = upperFor(fit.reach[1], hum.L.arm.wrist.length() * k, hum.L.arm.elbow.length() * k, fit.bend[1]);
  }

  /** A point of the view's space in the hand's (where the arms are). */
  private inHand(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(p).sub(this.hand.position).applyQuaternion(_qa.copy(this.hand.quaternion).invert());
  }

  /** Which way a bent elbow goes, in the hand's space: down, and out to its own side (`sign` 1 the firing arm's, -1 the support arm's). */
  private elbowPole(sign: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(0.45 * this.side * sign, -1, 0.1).normalize().applyQuaternion(_qa.copy(this.hand.quaternion).invert());
  }

  /**
   * A humanoid player's own arms on what's held: their fists on the grips (the item's turn), each
   * arm back from its wrist to a shoulder off the screen, straight or (on a gun, with `bend`) bent
   * at the elbow to reach a shoulder that stays put as the hand kicks and moves.
   */
  private placeHumanoid(r: Rest, m: Motion) {
    const hum = this.humanoid!;
    const itemQ = this.held.kind !== 'empty' ? this.tmpQ.copy(m.wrist).multiply(r.itemRot) : this.tmpQ.copy(r.armRot);
    const fit = this.fit;
    // A little bigger than life, as shooters draw them (the hands read around the gun), whatever the gun's size.
    const k = (this.heldBase(r) / HELD_SCALE) * fit.scale;
    const gun = this.styleName === 'gun' && !!this.gunPts;
    if (gun && fit.bend[0] > 0) placeBent(hum.R, _fa.set(0, 0, 0), itemQ, this.inHand(this.shoulders[0], _fb), this.elbowPole(1, _fc), k, this.uppers[0], fit.hands);
    else {
      // The firing arm out to the right of the stock, not behind it.
      const out = _fb.copy(r.armOffset).normalize().add(_fc.set(0.25, 0.05, 0)).normalize().clone();
      placeStraight(hum.R, _fa.set(0, 0, 0).clone(), itemQ, out, k, fit.reach[0], fit.hands);
    }
    const two = r.twoHanded && this.supportShown > 0;
    const L = hum.L;
    L.fist.visible = L.forearm.visible = L.upper.visible = two;
    if (!two) return;
    const at = this.supportGrip(r, itemQ, k, _fc).clone();
    if (gun && fit.bend[1] > 0) placeBent(hum.L, at, itemQ, this.inHand(this.shoulders[1], _fb), this.elbowPole(-1, _fa), k, this.uppers[1], fit.hands);
    else placeStraight(hum.L, at, itemQ, _fb.subVectors(r.arm2Offset, r.grip2).clone(), k, fit.reach[1], fit.hands);
  }

  define(name: string, anim: ViewAnimation) {
    this.anims.set(name, compile(anim));
  }

  play(anim: string | ViewAnimation, opts: { power?: number; speed?: number } = {}) {
    const a = typeof anim === 'string' ? this.anims.get(anim) : compile(anim);
    if (!a) throw new Error(`viewModel.play: unknown animation "${anim as string}"`);
    this.start(a, opts.power ?? 1, opts.speed ?? 1);
  }

  /** Start an animation, cross-faded from wherever the hand is now. */
  private start(anim: Anim, power: number, speed: number) {
    this.fadeFrom.pos.copy(this.hand.position);
    this.fadeFrom.rot.copy(this.hand.quaternion);
    this.fadeFrom.wrist.copy(this.motion.wrist);
    this.fadeT = this.playing ? 0 : 1;
    this.playing = { anim, t: 0, power, speed };
  }

  kick(strength = 1) {
    this.kickVel += strength * 7;
  }

  // --- runtime-facing ----------------------------------------------------------------------

  /** The held item's own action: swing, drink, loose a bow, place a block, punch, fire. */
  use(power = 1) {
    if (this.holdingGun) return this.fire(power);
    let anim: string | ViewAnimation;
    if (this.held.kind === 'sprite') anim = this.hold.use ?? ((this.hold.model && MODEL_USE[this.held.style]) || STYLES[this.held.style].use);
    else if (this.held.kind === 'block') anim = 'swing';
    else anim = 'punch';
    this.play(anim, { power });
  }

  /** Throw what's in hand (the `toss`), as soon as it's in hand if it's still coming up. */
  toss() {
    if (this.pending) this.queued = 'toss';
    else this.play('toss');
  }

  /** A plain swing (attacking with something that isn't a weapon). */
  swing(power = 1) {
    this.play(this.held.kind === 'empty' ? 'punch' : 'swing', { power });
  }

  /** Hold an extruded sprite item, or a model (with the points it marks: a gun's muzzle and sight). */
  setItem(geometry: THREE.BufferGeometry, albedo: THREE.Texture, emissive: THREE.Texture, hold: HoldSpec, fallback: HoldStyle, points?: Partial<Record<ItemPoint, THREE.Vector3>>, surface?: Surface) {
    const target = this.pending ?? this.held;
    // Already held so: nothing to do. (Two items can share a model and hold it their own ways.)
    if (target.kind === 'sprite' && target.geometry === geometry && target.style === (hold.style ?? fallback) && sameSpec(target.hold, hold)) return;
    this.pending = { kind: 'sprite', geometry, albedo, emissive, surface, hold, style: hold.style ?? fallback, points };
  }

  /** A gun went off: the kick, the rise, the flash (and then its pump or bolt, if it has one). */
  fire(power = 1) {
    if (this.styleName !== 'gun') return;
    const aim = this.lastGun?.aim ?? 0;
    const k = power * (1 - 0.55 * aim);
    this.recoil.vz += 7 * k;
    this.recoil.vr += 9 * k;
    this.recoil.vroll += (Math.random() - 0.5) * 6 * k;
    this.flashT = 0.055;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    if (this.lastGun?.action) this.cycleT = 0;
  }

  /** The held gun's muzzle, in the view's own (camera) space, as drawn this frame; false without a gun. */
  muzzle(out: THREE.Vector3): boolean {
    if (this.styleName !== 'gun' || !this.gunPts || this.held.kind !== 'sprite') return false;
    this.spriteMesh.updateWorldMatrix(true, false);
    out.copy(this.gunPts.muzzle).applyMatrix4(this.spriteMesh.matrixWorld);
    return true;
  }

  /** A gun is in hand (posed as one). */
  get holdingGun(): boolean {
    return this.styleName === 'gun' && this.held.kind === 'sprite';
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

  /** Hold a block (`partner`: a bed's head half, to show the bed whole). */
  setBlock(def: BlockDef | undefined, partner?: BlockDef) {
    if (!def) return;
    const target = this.pending ?? this.held;
    if (target.kind === 'block' && target.def === def) return;
    this.pending = { kind: 'block', def, partner };
  }

  /** A block model (slab, stairs, a whole bed) as geometry the size a held cube is, centred like it. */
  private modelGeometry(def: BlockDef, partner?: BlockDef): THREE.BufferGeometry {
    const cached = this.models.get(def.id);
    if (cached) return cached;
    const faces = itemFaces(def, partner);
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const layer: number[] = [];
    const index: number[] = [];
    // A bed is two blocks long: shrink it to a block's length.
    const zs = faces.flatMap((f) => f.corners.map((c) => c[2]));
    const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
    const k = 1 / Math.max(1, z1 - z0);
    const zc = (z0 + z1) / 2;
    for (const f of faces) {
      const base = pos.length / 3;
      f.corners.forEach((c, i) => {
        pos.push((c[0] - 0.5) * k, (c[1] - 0.5) * k, (c[2] - zc) * k);
        nrm.push(...f.normal);
        uv.push(...f.uv[i]);
        layer.push(f.layer);
      });
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('face', new THREE.Float32BufferAttribute(new Float32Array(layer.length), 1));
    g.setAttribute('layer', new THREE.Float32BufferAttribute(layer, 1));
    g.setIndex(index);
    this.models.set(def.id, g);
    return g;
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
    if (this.humanoid) {
      this.arm.visible = this.arm2.visible = false;
      this.gunHands.visible = false;
      return;
    }
    const look = this.armLook;
    if (look) {
      // The model's own arm (shared: never ours to free).
      for (const m of [this.arm, this.arm2]) {
        if (m.geometry !== look.geometry && !m.geometry.userData.shared) m.geometry.dispose();
        m.geometry = look.geometry;
      }
      look.geometry.userData.shared = true;
      this.armMaterial.uniforms.uAtlas.value = look.albedo;
      this.armMaterial.uniforms.uEmissive.value = look.emissive;
      this.arm.visible = true;
      return;
    }
    this.arm.visible = !!this.skin;
    if (!this.skin) return;
    const a = this.graphics.atlas(this.skin.atlas);
    const [u, v] = this.skin.uv;
    // Holding a gun: just the sleeve (the hands are on the gun, see `buildGunHands`).
    const sleeve = this.styleName === 'gun';
    const box = (mirror: boolean) =>
      boxGeometry({ name: 'arm', size: [4, sleeve ? 9 : 12, 4], uv: [u + 40, v + 16], pivot: [0, 0, 0], offset: [0, 0, 0], mirror }, a.width, a.height);
    if (!this.arm.geometry.userData.shared) this.arm.geometry.dispose();
    this.arm.geometry = box(this.armSide < 0);
    if (!this.arm2.geometry.userData.shared) this.arm2.geometry.dispose();
    this.arm2.geometry = box(this.armSide > 0);
    this.armMaterial.uniforms.uAtlas.value = a.albedo;
    this.armMaterial.uniforms.uEmissive.value = a.emissive;
    this.buildGunHands();
  }

  /**
   * The hands around a gun, in its own space (so they go wherever it goes): a palm on the grip
   * with a finger on the trigger and a thumb along the side, and the other palm under the
   * handguard with its fingers wrapped round (a pistol's cups the grip). Made of the skin's hand.
   */
  private buildGunHands() {
    for (const c of [...this.gunHands.children, ...this.gunHand2.children]) {
      if (c === this.gunHand2) continue;
      c.removeFromParent();
      (c as THREE.Mesh).geometry?.dispose();
    }
    const pts = this.gunPts;
    this.gunHands.visible = !!pts && this.styleName === 'gun' && !!this.skin && !this.armLook;
    if (!pts || !this.skin || this.armLook) return;
    const a = this.graphics.atlas(this.skin.atlas);
    const [u, v] = this.skin.uv;
    // One texel of the hand (the right arm's front, near the bottom): skin-coloured boxes.
    const tu = (u + 45.5) / a.width;
    const tv = (v + 30.5) / a.height;
    const px = 1 / 16;
    const box = (parent: THREE.Object3D, size: V3, at: THREE.Vector3, rx = 0, ry = 0) => {
      const g = new THREE.BoxGeometry(size[0] * px, size[1] * px, size[2] * px);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, tu, tv);
      const m = new THREE.Mesh(g, this.armMaterial);
      m.position.copy(at);
      m.rotation.set(rx, ry, 0);
      m.frustumCulled = false;
      parent.add(m);
    };
    const g = pts.grip;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(g.x + x * px, g.y + y * px, g.z + z * px);
    // Firing hand: palm round the raked grip, trigger finger, thumb up the near side.
    box(this.gunHands, [3.4, 4.4, 3.6], P(0, -0.4, -0.3), 0.26);
    box(this.gunHands, [1.1, 1.1, 2.4], P(0.2, 1.5, 2.1));
    box(this.gunHands, [1.1, 3.4, 1.4], P(0, -0.6, 2.0), 0.26);
    box(this.gunHands, [1.1, 1.1, 2.8], P(1.9, 1.6, 0.7));
    // Support hand, placed at grip2 (moved there each frame: a reload takes it away).
    const hw = this.halfWidthAt(pts.grip2.z);
    if (isCompact(pts)) {
      box(this.gunHand2, [3.6, 3.6, 3.6], new THREE.Vector3(0, -0.2 * px, 0));
      box(this.gunHand2, [1.1, 1.1, 3.0], new THREE.Vector3(2.0 * px, 1.3 * px, 0.6 * px));
    } else {
      box(this.gunHand2, [3.6, 2.4, 4.2], new THREE.Vector3(0, -1.0 * px, 0));
      box(this.gunHand2, [1.1, 2.6, 4.0], new THREE.Vector3(hw + 0.6 * px, 0.6 * px, 0));
      box(this.gunHand2, [1.1, 1.2, 3.0], new THREE.Vector3(-hw - 0.6 * px, 0.8 * px, 0.3 * px));
    }
  }

  /** How far the held gun's sides are from its middle at a point along it (for fingers wrapped round the handguard). */
  private halfWidthAt(z: number): number {
    const pos = this.spriteMesh.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    let w = 0;
    if (pos) for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - z) < 1.5 / 16) w = Math.max(w, Math.abs(pos.getX(i)));
    return w > 0 ? w : 1.2 / 16;
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
      setSurface(this.spriteMaterial.uniforms, h.surface);
      this.spriteMesh.visible = true;
    } else if (h.kind === 'block') {
      const def = h.def;
      const cross = def.small;
      this.cube.geometry = def.parts && !cross ? this.modelGeometry(def, h.partner) : this.cubeGeometry;
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
    // A gun's points: marked on its model, else from its spec (pixels), else guessed from its size.
    const wasGun = this.gunPts !== null;
    this.gunPts = null;
    if (this.styleName === 'gun' && h.kind === 'sprite') {
      const box = new THREE.Box3().setFromBufferAttribute(h.geometry.getAttribute('position') as THREE.BufferAttribute);
      this.gunPts = gunPoints(h.hold.model, h.points, box);
      this.flash.position.copy(this.gunPts.muzzle);
      this.gunPose = gunPose(h.hold.gun, isCompact(this.gunPts));
    }
    this.refit();
    this.flash.visible = false;
    this.cycleT = -1;
    if (this.side !== this.armSide || wasGun !== (this.gunPts !== null) || this.gunPts) {
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
    if (!r.twoHanded) return;
    const off2 = r.arm2Offset.clone().sub(r.grip2);
    fit(r.grip2.clone(), off2, this.arm2.quaternion, this.arm2.position, r.grip.clone().add(r.grip2));
  }

  /**
   * A gun's own motion on top of its pose: the support hand leaving for the magazine on a reload
   * (or feeding shells one by one), working the action, the gun tipped to show its magazine side.
   * A one-handed gun's support hand waits out of sight below it, and comes up only to reload.
   */
  private gunMotion(dt: number, gv: GunView, r: Rest) {
    const pts = this.gunPts!;
    const S = r.itemScale;
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const one = this.gunPose.hands === 1;
    // Where the support hand rests, in the gun's space: on the handguard, or (one-handed) low and
    // to the left of the firing fist, off the bottom of the screen.
    const rest = one ? this.away.set(-0.1 * this.side, -0.42, 0.1).applyQuaternion(_qa.copy(r.itemRot).invert()).divideScalar(S).add(pts.grip) : pts.grip2;
    this.supportShown = !one || (gv.reload > 0 && gv.reload < 1) ? 1 : 0;
    // Where the support hand is, in the gun's space.
    const hand = _fa.copy(rest);
    let tip = 0;
    let jolt = 0;
    if (gv.reload >= 0) {
      const p = gv.reload;
      tip = smooth(p / 0.14) * smooth((1 - p) / 0.16);
      const mag = pts.mag;
      const below = _fb.copy(mag).add(_fc.set(0.02, -0.7, -0.15));
      if (gv.shells > 0) {
        // Round by round: to the loading port, push, back. A port underneath (a shotgun's tube) is
        // fed from below it; one in the side (a revolver's gate), from that side.
        const n = Math.max(1, gv.shells);
        const q = Math.min(0.999, Math.max(0, (p - 0.1) / 0.8)) * n;
        const f = q - Math.floor(q);
        const push = f < 0.5 ? smooth(f / 0.5) : 1 - smooth((f - 0.5) / 0.5);
        const out = mag.x - pts.grip.x;
        const at = Math.abs(out) > 1 / 32 ? _v.copy(mag).add(_s.set(Math.sign(out) * (0.26 - push * 0.2), -0.1, -0.05)) : _v.copy(mag).add(_s.set(0, -0.28 + push * 0.22, -0.05));
        hand.lerp(at, smooth(p / 0.1) * smooth((1 - p) / 0.1));
        jolt = f > 0.45 && f < 0.6 ? 1 : 0;
      } else {
        const keys: [number, THREE.Vector3][] = [
          [0, rest],
          [0.15, mag],
          [0.3, below],
          [0.48, below],
          [0.64, mag],
          [0.8, rest],
          [1, rest],
        ];
        let i = 1;
        while (i < keys.length - 1 && keys[i][0] < p) i++;
        const [t0, a] = keys[i - 1];
        const [t1, b] = keys[i];
        hand.copy(a).lerp(b, smooth((p - t0) / Math.max(1e-3, t1 - t0)));
        jolt = p > 0.62 && p < 0.7 ? 1 : 0;
      }
    }
    // A pump: back and forward along the gun; a bolt: the gun rolls over to work it; a lever: it
    // rocks on the support hand; a hammer: it cants in under the thumb; the game's own: played.
    let roll = 0;
    let lever = 0;
    let cock = 0;
    if (this.cycleT >= 0) {
      this.cycleT += dt;
      const a = gv.action;
      if (a && typeof a === 'object') {
        if (this.cycleT >= CYCLE.delay) {
          this.cycleT = -1;
          this.playAction(a);
        }
      } else {
        const t = (this.cycleT - CYCLE.delay) / (a ? CYCLE[a] : CYCLE.bolt);
        if (t >= 1) this.cycleT = -1;
        else if (t > 0) {
          const k = Math.sin(t * Math.PI);
          if (a === 'pump') hand.z -= (3 / 16) * k;
          else if (a === 'lever') lever = k;
          else if (a === 'hammer') cock = k;
          else roll = 0.5 * k;
        }
      }
    }
    this.gunHand2.position.copy(hand);
    // The support forearm follows its hand.
    const moved = _fb.subVectors(hand, pts.grip2).multiplyScalar(S).applyQuaternion(r.itemRot);
    r.grip2.add(moved);
    r.arm2Offset.add(moved);
    // Tipped to the side to show the magazine going in (less when aiming).
    const k = tip * (1 - 0.5 * gv.aim);
    if (k > 0 || roll > 0) {
      const q = new THREE.Quaternion().setFromAxisAngle(r.axis, (0.55 * k + roll) * this.side);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.28 * k + jolt * 0.05));
      r.itemRot.premultiply(q);
      r.grip2.applyQuaternion(q);
      r.arm2Offset.applyQuaternion(q);
      r.grip.add(_fc.set(-0.02 * this.side, -0.05, 0.03).multiplyScalar(k));
    }
    if (lever > 0) {
      // The lever swung down and back: the gun rocks muzzle up (about its own right, its -x) on
      // the support hand, which stays put, the grip and the firing hand round it dropping.
      const q = _qa.setFromAxisAngle(_v.set(-1, 0, 0).applyQuaternion(r.itemRot), 0.2 * lever);
      const shift = _fc.copy(r.grip2).sub(_s.copy(r.grip2).applyQuaternion(q));
      r.grip.add(shift);
      r.grip2.sub(shift);
      r.arm2Offset.sub(shift);
      r.itemRot.premultiply(q);
      r.axis.applyQuaternion(q);
    }
    if (cock > 0) {
      // The thumb back to the hammer: the gun canted in (its top toward the middle) and tipped up a little.
      const q = _qa.setFromAxisAngle(r.axis, -0.32 * cock * this.side).multiply(_qb.setFromAxisAngle(X, 0.1 * cock));
      r.itemRot.premultiply(q);
      r.grip2.applyQuaternion(q);
      r.arm2Offset.applyQuaternion(q);
      r.axis.applyQuaternion(q);
    }
  }

  /** A gun's action of the game's own: the hand's animation, played (compiled once). */
  private playAction(a: ViewAnimation) {
    let anim = this.actions.get(a);
    if (!anim) this.actions.set(a, (anim = compile(a)));
    this.start(anim, 1, 1);
  }

  /** After the hand is placed: recoil springs, the muzzle flash, hiding it all behind a scope. */
  private gunAfter(dt: number, input: ViewInput) {
    const gv = input.gun;
    const rc = this.recoil;
    rc.vz += (-rc.z * 420 - rc.vz * 26) * dt;
    rc.z += rc.vz * dt;
    rc.vr += (-rc.r * 300 - rc.vr * 22) * dt;
    rc.r += rc.vr * dt;
    rc.vroll += (-rc.roll * 300 - rc.vroll * 22) * dt;
    rc.roll += rc.vroll * dt;
    this.hand.position.z += rc.z * this.gunPose.kick;
    this.hand.position.y += rc.r * 0.01;
    this.hand.quaternion.premultiply(_qa.setFromEuler(new THREE.Euler(rc.r * this.gunPose.rise * DEG, 0, rc.roll * DEG * 4)));
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.scale.setScalar((0.34 + Math.random() * 0.12) / Math.max(0.1, this.rest.itemScale));
    // Through a scope, the gun is out of the way.
    this.root.visible = this.apiVisible && !(gv?.sight === 'scope' && gv.aim > 0.9);
    this.gunHands.visible = !!this.skin && !this.armLook;
    this.gunHand2.visible = this.supportShown > 0;
    // The view model's own lens narrows a little when aiming, so the sights fill more of it.
    const fov = 70 - 4 * (gv?.aim ?? 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  update(rawDt: number, input: ViewInput) {
    const dt = rawDt * this.timeScale;
    this.time += dt;
    if (this.styleName !== 'gun') {
      this.root.visible = this.apiVisible;
      if (this.camera.fov !== 70) {
        this.camera.fov = 70;
        this.camera.updateProjectionMatrix();
      }
    }
    this.camera.aspect = input.aspect;
    this.camera.updateProjectionMatrix();
    const l = this.side;

    // Minecraft's hand height: dips to swap items, and after each hit as the attack recharges.
    const target = this.pending ? 0 : Math.max(0, Math.min(1, input.strength)) ** 3;
    this.height += THREE.MathUtils.clamp(target - this.height, -8 * dt, 8 * dt);
    if (this.pending && this.height < 0.1) {
      this.apply(this.pending);
      this.pending = null;
      if (this.queued) this.play(this.queued);
      this.queued = null;
    }
    this.downT = THREE.MathUtils.clamp(this.downT + (input.down ? dt : -dt) / 0.4, 0, 1);
    const down = this.downT * this.downT * (3 - 2 * this.downT);
    this.drop = (1 - this.height) * 0.6 + down * 0.8;

    // Rest pose: Minecraft's arm holding the item; a bow swings into Java's aiming pose as it's drawn.
    const r = this.rest;
    this.supportShown = 1;
    const bow = this.styleName === 'bow';
    this.drawBlend = THREE.MathUtils.clamp(this.drawBlend + (this.draw > 0 && bow ? dt : -dt) / 0.12, 0, 1);
    if (bow) {
      bowRest(l, this.drop, false, 0, r);
      if (this.drawBlend > 0) {
        bowRest(l, this.drop, true, Math.min(1, this.draw), this.restDrawn);
        blendRest(r, this.restDrawn, this.drawBlend * this.drawBlend * (3 - 2 * this.drawBlend));
      }
    } else if (this.styleName === 'gun' && this.gunPts && input.gun) {
      this.lastGun = input.gun;
      gunRest(this.gunPts, this.gunPose, this.hold, l, this.drop, input.gun, r);
      if (this.humanoid) this.restShoulders(r);
      this.gunMotion(dt, input.gun, r);
    } else if (this.styleName === 'polearm' && this.style) {
      polearmRest(this.style, this.hold.model, l, this.drop, r);
    } else if (this.hold.model && this.style && this.styleName && MODEL_GRIPS[this.styleName]) {
      modelRest(MODEL_GRIPS[this.styleName]!, this.hold, this.hold.model, l, this.drop, r);
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
    this.arm2.visible = r.twoHanded && !!this.skin && !this.humanoid && this.supportShown > 0;
    if (r.twoHanded) {
      this.arm2.quaternion.copy(r.arm2Rot);
      this.arm2.position.copy(r.arm2Offset);
      this.arm2.scale.set(r.armScale, r.armScale * r.armStretch, r.armScale);
    }
    // During an animation, forearms turn toward where their elbows were at rest (3D models).
    if (this.hold.model && (this.playing || this.fadeT < 1) && this.held.kind !== 'empty' && this.styleName !== 'gun') this.reach(r);
    if (this.styleName === 'gun' && this.gunPts) this.gunAfter(dt, input);
    // A humanoid's own arms, last: a bent arm reaches from where the hand now is to its shoulder.
    if (this.humanoid) this.placeHumanoid(r, m);

    // Procedural motion: breathing, walk bob, look sway, landing dip, recoil.
    const steady = this.styleName === 'gun' ? 1 - 0.85 * (input.gun?.aim ?? 0) : 1;
    const breathe = Math.sin(this.time * 1.7) * steady;
    const bob = input.bobAmount * steady * (this.styleName === 'gun' ? 1.25 : 1);
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
      const tx = THREE.MathUtils.clamp((-dyaw / rawDt) * 0.015 * steady, -0.07, 0.07);
      const ty = THREE.MathUtils.clamp((-dpitch / rawDt) * 0.015 * steady, -0.06, 0.06);
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

let flashTex: THREE.Texture | null = null;

/** A muzzle flash: a hot core with spikes, white to orange (drawn additively). */
function flashTexture(): THREE.Texture {
  if (flashTex) return flashTex;
  const n = 64;
  const px = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const a = Math.atan2(dy, dx);
      const spikes = Math.pow(Math.max(0, Math.cos(a * 4)), 18) * Math.max(0, 1 - r) * 1.2 + Math.pow(Math.max(0, Math.cos(a * 4 + Math.PI / 4)), 30) * Math.max(0, 1 - r * 1.3);
      const core = Math.pow(Math.max(0, 1 - r * 1.9), 1.6);
      const v = Math.min(1, core + spikes);
      const i = (y * n + x) * 4;
      px[i] = 255 * Math.min(1, v * 1.2);
      px[i + 1] = 255 * Math.min(1, v * (0.55 + core * 0.45));
      px[i + 2] = 255 * Math.min(1, v * core * 0.9);
      px[i + 3] = 255 * v;
    }
  const t = new THREE.DataTexture(px, n, n, THREE.RGBAFormat);
  t.needsUpdate = true;
  flashTex = t;
  return t;
}
