import * as THREE from 'three';
import type { AnimState } from '../render/entities';

/** The joints a figure needs for the platform to animate it as a humanoid (docs/HUMANOID.md). */
const REQUIRED = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'] as const;
type Joint = (typeof REQUIRED)[number] | 'gripL' | 'gripR';

/** A gun or sword's size in a humanoid's hands (world units per model unit): a rifle model about a metre and a half long is held about 0.9 m. */
export const HELD_SCALE = 0.52;

/** What a humanoid holds, as it holds it. */
export interface HeldInfo {
  /** `gun`: both hands on it, aimed where they look; `melee`: both hands, blade up, swung; `other`: in the right fist. */
  kind: 'gun' | 'melee' | 'other';
  /** Points on the model, in its own space (before `scale`): where each hand holds, the magazine. */
  grip: THREE.Vector3;
  grip2?: THREE.Vector3;
  mag?: THREE.Vector3;
  /** Its length along z (a pistol is short). */
  length: number;
  /** Its size in the hands (world units per model unit). */
  scale: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Scratch.
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const q3 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

/** A rotation from Euler angles (YXZ: turn, then tip, then roll). */
const rot = (out: THREE.Quaternion, x: number, y = 0, z = 0) => out.setFromEuler(e1.set(x, y, z, 'YXZ'));

/**
 * A figure on the humanoid rig, animated in code from what it's doing: a gait worked out from its
 * speed and which way it's going (feet planted and stepping, the legs bent to reach them), crouching,
 * sliding and jumping; the head and chest turned to look; a gun in both hands aimed where it looks
 * (hands put on its grips), carried low across the chest to sprint, tipped to reload and kicking as
 * it fires; a sword swung two-handed; and a fall when it dies. Parts are rigid (no skinning).
 */
export class HumanoidRig {
  private j: Record<Joint, THREE.Object3D | undefined>;
  private rest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
  /** The model's own space (the hips' parent): feet and the ground are placed in it. */
  private body: THREE.Object3D;
  /** What's held, on the chest: the rig puts it where the pose wants it each frame. */
  private holder = new THREE.Object3D();
  private held: { mesh: THREE.Object3D; info: HeldInfo } | null = null;
  private last = -1;
  private phase = 0;
  private sprint = 0;
  private reload = 0;
  private reloadT = 0;
  private deathAt = -1;
  private deathDir = 1;
  /** The body's turn in the world, and where it looks (this frame). */
  private bodyQ = new THREE.Quaternion();
  private aimQ = new THREE.Quaternion();

  /** Does this model have the rig's joints? */
  static fits(nodes: Map<string, THREE.Object3D>): boolean {
    return REQUIRED.every((n) => nodes.has(n));
  }

  constructor(nodes: Map<string, THREE.Object3D>) {
    const all = [...REQUIRED, 'gripL', 'gripR'] as Joint[];
    this.j = Object.fromEntries(all.map((n) => [n, nodes.get(n)])) as Record<Joint, THREE.Object3D | undefined>;
    for (const n of all) {
      const o = this.j[n];
      if (o) this.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
    }
    this.body = this.j.hips!.parent!;
    this.j.chest!.add(this.holder);
  }

  /** Hold something (null: empty-handed). The mesh's origin is the model's; the rig places it. */
  hold(mesh: THREE.Object3D | null, info: HeldInfo | null) {
    if (this.held) this.held.mesh.removeFromParent();
    this.held = mesh && info ? { mesh, info } : null;
    if (!mesh || !info) return;
    mesh.scale.setScalar(info.scale / this.worldScale());
    mesh.quaternion.identity();
    mesh.position.copy(info.grip).multiplyScalar(-mesh.scale.x);
    if (info.kind === 'other') {
      // In the fist, tipped up a little.
      (this.j.gripR ?? this.j.handR!).add(mesh);
      mesh.quaternion.setFromAxisAngle(X, -0.3);
      mesh.position.applyQuaternion(mesh.quaternion);
    } else {
      this.holder.add(mesh);
    }
  }

  private worldScale(): number {
    this.body.updateWorldMatrix(true, false);
    return v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
  }

  /** Back to the rest pose, then posed. */
  animate(s: AnimState) {
    const dt = this.last < 0 ? 0 : clamp(s.time - this.last, 0, 0.1);
    this.last = s.time;
    for (const [o, r] of this.rest) {
      o.position.copy(r.p);
      o.quaternion.copy(r.q);
    }
    const j = this.j;
    const hips = j.hips!;
    const hipRest = this.rest.get(hips)!.p;
    const crouch = clamp01(s.stance);
    const slide = clamp01(s.stance - 1);
    const speed = s.speed ?? 0;
    const moving = s.walkAmount;
    const run = clamp01((speed - 3.5) / 4);
    const air = s.air ? 1 : 0;
    const look = clamp(-s.headPitch, -1.25, 1.25);
    const held = this.held?.info.kind ?? null;
    const twoHanded = held === 'gun' || held === 'melee';
    this.sprint += ((s.sprint && held === 'gun' ? 1 : 0) - this.sprint) * clamp01(dt * 10);
    this.reload += ((s.reloading && held === 'gun' ? 1 : 0) - this.reload) * clamp01(dt * 12);
    this.reloadT = s.reloading ? this.reloadT + dt : 0;
    // Strides get longer as it speeds up; the phase runs with the ground covered.
    const stride = 1.15 + 1.25 * run;
    this.phase = (this.phase + (speed * dt) / stride) % 1;
    const ph = this.phase * Math.PI * 2;

    // Dying: a fall, backward or forward, over two thirds of a second.
    if (s.dying > 0) {
      if (this.deathAt < 0) {
        this.deathAt = s.time;
        this.deathDir = Math.random() < 0.65 ? -1 : 1;
      }
      this.fall(smooth(clamp01((s.time - this.deathAt) / 0.65)));
      return;
    }
    this.deathAt = -1;

    // The hips: down to crouch and further to slide, a bob and a sway as it steps, leaning back to slide.
    const bob = moving * (0.02 + 0.035 * run) * (1 - Math.cos(ph * 2)) * 0.5;
    hips.position.set(hipRest.x + Math.sin(ph) * 0.018 * moving * (1 - run), hipRest.y - crouch * 0.33 - slide * 0.12 - bob, hipRest.z - slide * 0.05);
    rot(q1, -0.55 * slide, 0, 0);
    hips.quaternion.multiply(q1);
    // The back: leaning into a run, a crouch; a twist to shoulder a rifle; breathing.
    const lean = moving * (0.04 + 0.14 * run) + crouch * 0.16 * (1 - slide) + 0.3 * slide;
    const breathe = Math.sin(s.time * 1.9) * 0.012;
    const twist = held === 'gun' ? -0.18 * (1 - this.sprint) : 0;
    rot(q1, lean * 0.45, twist * 0.4, 0);
    j.spine!.quaternion.multiply(q1);
    // Aiming, the chest takes part of the look (the gun takes the rest, about the shoulders).
    const chestLook = twoHanded ? look * 0.35 * (1 - this.sprint) : look * 0.2;
    rot(q1, lean * 0.55 + breathe - chestLook, twist * 0.6, 0);
    j.chest!.quaternion.multiply(q1);
    this.body.updateMatrixWorld(true);

    // The body's frame in the world (it faces +z), and where it looks.
    const bodyQ = this.body.getWorldQuaternion(this.bodyQ);
    const scale = v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
    const aimQ = rot(this.aimQ, -look, s.headYaw * 0.5, 0).premultiply(bodyQ);
    this.holder.visible = true;

    if (twoHanded) this.poseHeld(s, aimQ, bodyQ, scale);
    else this.swingArms(s, ph, moving, run, air);

    this.legs(s, ph, moving, run, crouch, slide, air, bodyQ);

    // The head looks where it looks, whatever the body's doing.
    const head = j.head!;
    rot(q1, -look, s.headYaw, held === 'gun' ? 0.12 * (s.ads ?? 0) : 0).premultiply(bodyQ);
    head.parent!.getWorldQuaternion(q2);
    head.quaternion.copy(q2.invert().multiply(q1));
  }

  /** Both hands on a gun or a sword: where it's held (aimed, carried low, reloaded, swung), then the arms to it. */
  private poseHeld(s: AnimState, aimQ: THREE.Quaternion, bodyQ: THREE.Quaternion, scale: number) {
    const info = this.held!.info;
    const j = this.j;
    const chest = j.chest!;
    // The shoulders' middle, the pivot the aim turns about.
    const pivot = chest.localToWorld(v1.set(0, 0.2, 0));
    const offset = v2;
    const gunQ = q1.copy(aimQ);
    if (info.kind === 'gun') {
      const pistol = info.length * info.scale < 0.45;
      const ads = s.ads ?? 0;
      // Shouldered (a rifle) or held out in both hands (a pistol), the sights a little under the
      // eye (the face shows); up to the eye aiming down them.
      if (pistol) offset.set(-0.03, -0.15, 0.4).lerp(v3.set(0, -0.04, 0.4), ads);
      else offset.set(-0.13, -0.19, 0.27).lerp(v3.set(-0.05, -0.05, 0.24), ads);
      // Kick: back and up, for a moment after each shot.
      const kick = s.shotT !== undefined && s.shotT < 0.25 ? Math.exp(-s.shotT * 22) : 0;
      offset.z -= 0.05 * kick;
      gunQ.multiply(rot(q2, -0.14 * kick, 0, 0));
      // Sprinting: low across the chest, muzzle down and to the left.
      if (this.sprint > 0.001) {
        offset.lerp(v3.set(-0.02, -0.32, 0.18), this.sprint);
        gunQ.slerp(q2.copy(bodyQ).multiply(rot(q3, 0.6, 0.75, 0.1)), this.sprint);
      }
      // Reloading: tipped over to show the magazine.
      if (this.reload > 0.001) {
        offset.lerp(v3.set(-0.04, -0.2, 0.28), this.reload);
        gunQ.slerp(q2.copy(bodyQ).multiply(rot(q3, 0.3, 0.35, -0.6)), this.reload);
      }
    } else {
      // A sword: two hands low on the handle, the blade up and forward; a chop when it attacks.
      offset.set(-0.06, -0.3, 0.3);
      gunQ.copy(bodyQ).multiply(rot(q2, -0.95, 0.15, 0));
      if (s.attackT < 0.4) {
        const a = s.attackT / 0.4;
        const up = a < 0.3 ? smooth(a / 0.3) : 1 - smooth((a - 0.3) / 0.7);
        const down = a < 0.3 ? 0 : smooth((a - 0.3) / 0.7);
        offset.add(v3.set(0.04 * up, 0.35 * up - 0.1 * down, -0.1 * up + 0.2 * down));
        gunQ.multiply(rot(q2, -1.1 * up + 1.9 * down, 0, 0.5 * down));
      }
    }
    // The holder is the chest's: from the world into it.
    const at = v3.copy(offset).multiplyScalar(scale).applyQuaternion(aimQ).add(pivot);
    this.holder.position.copy(chest.worldToLocal(at));
    this.holder.quaternion.copy(chest.getWorldQuaternion(q2).invert().multiply(gunQ));
    this.holder.updateMatrixWorld(true);

    // Hands on it: the right on the grip, the left on the handguard (or the magazine, reloading).
    const mesh = this.held!.mesh;
    const handQ = this.holder.getWorldQuaternion(new THREE.Quaternion());
    const grip = this.holder.getWorldPosition(v4);
    this.limb('R', grip, handQ, v1.set(-0.8, -0.55, -0.35).applyQuaternion(bodyQ), false);
    const support = info.grip2 ? mesh.localToWorld(v2.copy(info.grip2)) : null;
    if (support) {
      if (info.kind === 'gun' && this.reload > 0.001 && info.mag) {
        // To the magazine and away (a fresh one from the belt), and back.
        const t = (this.reloadT % 1.1) / 1.1;
        const away = t < 0.25 ? 0 : t < 0.6 ? smooth((t - 0.25) / 0.35) : 1 - smooth((t - 0.6) / 0.4);
        const mag = mesh.localToWorld(v3.copy(info.mag));
        const belt = this.j.hips!.localToWorld(v4.set(0.12, -0.02, 0.12));
        mag.lerp(belt, away);
        support.lerp(mag, this.reload);
      }
      this.limb('L', support, handQ, v1.set(0.45, -0.9, 0.05).applyQuaternion(bodyQ), false);
    }
  }

  /** Empty-handed (or one thing in the fist): the arms swing as it walks. */
  private swingArms(s: AnimState, ph: number, moving: number, run: number, air: number) {
    const j = this.j;
    const swing = Math.sin(ph) * moving * (0.45 + 0.5 * run);
    const attack = s.attackT < 0.35 ? Math.sin((s.attackT / 0.35) * Math.PI) : 0;
    const raised = s.raised ? 1 : s.casting ? 0.6 : 0;
    const bend = 0.25 + 0.9 * run;
    rot(q1, -swing - 1.6 * attack - 2.4 * raised - 0.5 * air, 0, -0.08 - 0.3 * air);
    j.upperArmR!.quaternion.multiply(q1);
    rot(q1, -bend - 0.6 * attack, 0, 0);
    j.lowerArmR!.quaternion.multiply(q1);
    rot(q1, swing - 2.4 * raised - 0.5 * air, 0, 0.08 + 0.3 * air);
    j.upperArmL!.quaternion.multiply(q1);
    rot(q1, -bend, 0, 0);
    j.lowerArmL!.quaternion.multiply(q1);
  }

  /** The feet: planted and stepping along the way it goes, tucked in the air, out ahead in a slide; the legs bend to them. */
  private legs(s: AnimState, ph: number, moving: number, run: number, crouch: number, slide: number, air: number, bodyQ: THREE.Quaternion) {
    // Which way it's going, in its own space (+z ahead).
    let dx = s.moveX ?? 0;
    let dz = s.moveZ ?? 1;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-3) {
      dx = 0;
      dz = 1;
    } else {
      dx /= dl;
      dz /= dl;
    }
    const step = moving * (0.22 + 0.3 * run) * (1 - crouch * 0.4);
    const lift = moving * (0.1 + 0.12 * run) * (1 - slide);
    const ankle = this.ankleHeight();
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      // Stance for half the cycle (the foot slides back under the body), then a swing forward, lifted.
      const t = ((ph / (Math.PI * 2) + (side === 'L' ? 0 : 0.5)) % 1 + 1) % 1;
      let along: number;
      let up = 0;
      if (t < 0.5) along = step * (0.5 - t * 2);
      else {
        const u = (t - 0.5) * 2;
        along = step * (smooth(u) - 0.5);
        up = Math.sin(u * Math.PI) * lift;
      }
      const x = sign * (0.1 + 0.05 * crouch) + dx * along;
      let z = dz * along;
      let y = ankle + up;
      // A crouch: one foot a little ahead of the other. A slide: the left leg out ahead, the right
      // tucked under. In the air: tucked up.
      z += crouch * (1 - slide) * (side === 'L' ? 0.12 : -0.08);
      if (slide > 0) {
        z = z * (1 - slide) + slide * (side === 'L' ? 0.72 : 0.05);
        y = y * (1 - slide) + slide * (side === 'L' ? ankle : ankle + 0.12);
      }
      if (air > 0) {
        y += 0.2 * air;
        z += (side === 'L' ? 0.12 : -0.1) * air;
      }
      const target = this.body.localToWorld(v1.set(x, y, z));
      // Level feet, toes up a little as they swing through.
      const footQ = q1.copy(bodyQ).multiply(rot(q2, -up * 1.2, 0, 0));
      this.limb(side, target, footQ, v2.set(sign * 0.12, 0, 1).applyQuaternion(bodyQ), true);
    }
  }

  private ankleHeight(): number {
    // The ankle's height in the rest pose: the hips' height less the leg's joints.
    const r = (o: THREE.Object3D | undefined) => this.rest.get(o!)!.p;
    return r(this.j.hips).y + r(this.j.upperLegL).y + r(this.j.lowerLegL).y + r(this.j.footL).y;
  }

  /**
   * Two-bone IK: bend `side`'s arm (or leg) so its end joint puts its grip (or itself) at `target`,
   * turned to `endQ`, the elbow (knee) toward `pole`. Arms bend forward at the elbow, legs back.
   */
  private limb(side: 'L' | 'R', target: THREE.Vector3, endQ: THREE.Quaternion, pole: THREE.Vector3, leg: boolean) {
    const j = this.j;
    const upper = (leg ? j[`upperLeg${side}`] : j[`upperArm${side}`])!;
    const lower = (leg ? j[`lowerLeg${side}`] : j[`lowerArm${side}`])!;
    const end = (leg ? j[`foot${side}`] : j[`hand${side}`])!;
    const grip = leg ? undefined : j[`grip${side}`];
    upper.parent!.updateWorldMatrix(true, false);
    const scale = v5.setFromMatrixScale(upper.parent!.matrixWorld).x || 1;
    const a = this.rest.get(lower)!.p.length() * scale;
    const b = this.rest.get(end)!.p.length() * scale;
    // Where the wrist goes for the grip to be at the target.
    const endWorldQ = q2.copy(endQ);
    if (grip) endWorldQ.multiply(q3.copy(this.rest.get(grip)!.q).invert());
    const wrist = v3.copy(target);
    if (grip) wrist.sub(v4.copy(this.rest.get(grip)!.p).multiplyScalar(scale).applyQuaternion(endWorldQ));
    const S = upper.getWorldPosition(v4);
    const toW = wrist.sub(S);
    const d = clamp(toW.length(), Math.abs(a - b) + 1e-3, a + b - 1e-4);
    const dir = toW.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const perp = v5.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.copy(Math.abs(dir.y) < 0.9 ? Y : Z).addScaledVector(dir, -(Math.abs(dir.y) < 0.9 ? dir.y : dir.z));
    perp.normalize();
    // The elbow, and the wrist it can reach.
    const E = new THREE.Vector3().copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    const W = new THREE.Vector3().copy(S).addScaledVector(dir, d);
    // Each bone points down its own -y; they share a hinge axis.
    const yU = new THREE.Vector3().subVectors(S, E).normalize();
    const u = new THREE.Vector3().subVectors(W, E).normalize();
    const hinge = new THREE.Vector3().crossVectors(yU.clone().negate(), u);
    if (hinge.lengthSq() < 1e-6) hinge.crossVectors(perp, dir);
    hinge.normalize();
    if (!leg) hinge.negate();
    const upperQ = basisQ(hinge, yU, new THREE.Quaternion());
    const yL = new THREE.Vector3().subVectors(E, W).normalize();
    const lowerQ = basisQ(hinge, yL, new THREE.Quaternion());
    const parentQ = upper.parent!.getWorldQuaternion(new THREE.Quaternion());
    upper.quaternion.copy(parentQ.invert().multiply(upperQ));
    lower.quaternion.copy(upperQ.clone().invert().multiply(lowerQ));
    end.quaternion.copy(lowerQ.invert().multiply(endWorldQ));
  }

  /** Dead: the knees go, it falls (back, mostly), the arms fly out. `t` 0..1. */
  private fall(t: number) {
    const j = this.j;
    const hips = j.hips!;
    const r = this.rest.get(hips)!.p;
    const dir = this.deathDir;
    const drop = smooth(clamp01(t * 1.3));
    hips.position.set(r.x, r.y - (r.y - 0.18) * drop, r.z + dir * 0.55 * t);
    rot(q1, dir * 1.45 * t, 0, 0.15 * t);
    hips.quaternion.multiply(q1);
    const knees = Math.sin(clamp01(t * 1.6) * Math.PI) * 1.1;
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      rot(q1, -knees * 0.6 - (dir > 0 ? 0.2 : -0.1) * t, 0, sign * 0.12 * t);
      j[`upperLeg${side}`]!.quaternion.multiply(q1);
      rot(q1, knees, 0, 0);
      j[`lowerLeg${side}`]!.quaternion.multiply(q1);
      rot(q1, -1.3 * t, 0, sign * 1.1 * t);
      j[`upperArm${side}`]!.quaternion.multiply(q1);
      rot(q1, -0.5 * t, 0, 0);
      j[`lowerArm${side}`]!.quaternion.multiply(q1);
    }
    rot(q1, -dir * 0.35 * t, 0.4 * t, 0);
    j.head!.quaternion.multiply(q1);
    this.holder.visible = t < 0.3;
    if (this.held && this.held.info.kind === 'gun' && t >= 0.3) this.holder.visible = false;
  }

  /** Where a held gun's muzzle is drawn (it's under the holder). */
  get holding(): THREE.Object3D | null {
    return this.held?.mesh ?? null;
  }
}

/** The rotation whose x and y axes are these (z completes them). */
function basisQ(x: THREE.Vector3, y: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const xx = v1.copy(x).addScaledVector(y, -x.dot(y)).normalize();
  const zz = v2.crossVectors(xx, y);
  m1.makeBasis(xx, y, zz);
  return out.setFromRotationMatrix(m1);
}
