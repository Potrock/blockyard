import * as THREE from 'three';
import type { GunStance, HeldPose, HumanoidGait, HumanoidJoint, HumanoidPoses, ItemPoses } from '../api/types';
import type { AnimState } from '../render/entities';
import { ClipLayer, type ClipPlay } from './clips';

/** The joints a figure needs for the platform to animate it as a humanoid (docs/HUMANOID.md), each after the one it hangs from. */
const REQUIRED = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'] as const;
type Bone = (typeof REQUIRED)[number];
type Joint = Bone | 'gripL' | 'gripR';

/** Which joint each hangs from on the rig. */
const PARENT: Record<Bone, Bone | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'chest',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  upperArmR: 'chest',
  lowerArmR: 'upperArmR',
  handR: 'lowerArmR',
  upperLegL: 'hips',
  lowerLegL: 'upperLegL',
  footL: 'lowerLegL',
  upperLegR: 'hips',
  lowerLegR: 'upperLegR',
  footR: 'lowerLegR',
};
const PARENT_INDEX = REQUIRED.map((b) => (PARENT[b] ? REQUIRED.indexOf(PARENT[b]!) : -1));

/** A gun or sword's size in a humanoid's hands (world units per model unit): a rifle model about a metre and a half long is held about 0.9 m. */
export const HELD_SCALE = 0.52;

type V3 = [number, number, number];
type Held = Required<HeldPose>;
type Stance = Required<Omit<GunStance, 'offHand'>> & { offHand: Held };

/** `HumanoidPoses` with everything filled in. */
export interface Poses {
  heldScale: number;
  rifle: Stance;
  pistol: Stance;
  pistolUnder: number;
  kick: { back: number; tip: number; decay: number };
  sprint: Held;
  reload: Held & { cycle: number; belt: V3 };
  lever: Held & { time: number };
  hammer: Held & { time: number };
  sword: Held & { swing: { time: number; windup: number; raise: Held; chop: Held } };
  death: { time: number; backward: number };
  gait: Required<HumanoidGait>;
}

/** The platform's own poses (Call of Blocky's fighters move by them). */
export const DEFAULT_POSES: Poses = {
  heldScale: HELD_SCALE,
  // Shouldered (a rifle) or held out in both hands (a pistol), the sights a little under the eye
  // (the face shows); up to the eye aiming down them. One-handed, the free hand hangs loose.
  rifle: { hip: [-0.13, -0.19, 0.27], ads: [-0.05, -0.05, 0.24], twist: -0.18, cheek: 0.12, offHand: { offset: [0.21, -0.56, 0.04], turn: [0, 0, 0] } },
  pistol: { hip: [-0.03, -0.15, 0.4], ads: [0, -0.04, 0.4], twist: -0.18, cheek: 0.12, offHand: { offset: [0.21, -0.56, 0.04], turn: [0, 0, 0] } },
  pistolUnder: 0.45,
  kick: { back: 0.05, tip: 0.14, decay: 22 },
  sprint: { offset: [-0.02, -0.32, 0.18], turn: [0.6, 0.75, 0.1] },
  reload: { offset: [-0.04, -0.2, 0.28], turn: [0.3, 0.35, -0.6], cycle: 1.1, belt: [0.12, -0.02, 0.12] },
  // A lever worked: the gun dips and its muzzle rocks up. A hammer cocked: tipped up, canted in.
  lever: { offset: [0, -0.035, 0.01], turn: [-0.2, 0, 0], time: 0.45 },
  hammer: { offset: [0, 0.01, 0], turn: [-0.12, 0, 0.3], time: 0.26 },
  sword: { offset: [-0.06, -0.3, 0.3], turn: [-0.95, 0.15, 0], swing: { time: 0.4, windup: 0.3, raise: { offset: [0.04, 0.35, -0.1], turn: [-1.1, 0, 0] }, chop: { offset: [0, -0.1, 0.2], turn: [1.9, 0, 0.5] } } },
  death: { time: 0.65, backward: 0.65 },
  gait: { run: [3.5, 7.5], stride: [1.15, 2.4], step: [0.22, 0.52], lift: [0.1, 0.22], bob: [0.02, 0.055], lean: [0.04, 0.18], armSwing: [0.45, 0.95], sway: 0.018, width: 0.1, crouch: 0.33 },
};

/** `d` with what `g` gives (left-out or undefined values keep `d`'s). */
function fill<T extends object>(d: T, g: Partial<T> | undefined): T {
  const out = { ...d };
  if (g) for (const k of Object.keys(g) as (keyof T)[]) if (g[k] !== undefined) out[k] = g[k] as T[keyof T];
  return out;
}

/** A stance given over one filled in (its free hand's pose part by part). */
const stance = (d: Stance, g: GunStance | undefined): Stance => ({ ...fill(d, g as Partial<Stance>), offHand: fill(d.offHand, g?.offHand) });

/**
 * A game's `HumanoidPoses` over the platform's own; or, with `base`, over those (an item's
 * `hold.poses` over its figure's: `resolvePoses(item, figure)`).
 */
export function resolvePoses(p: HumanoidPoses = {}, base: Poses = DEFAULT_POSES): Poses {
  const D = base;
  const swing = p.sword?.swing;
  return {
    heldScale: p.heldScale ?? D.heldScale,
    rifle: stance(D.rifle, p.rifle),
    pistol: stance(D.pistol, p.pistol),
    pistolUnder: p.pistolUnder ?? D.pistolUnder,
    kick: fill(D.kick, p.kick),
    sprint: fill(D.sprint, p.sprint),
    reload: fill(D.reload, p.reload),
    lever: fill(D.lever, p.lever),
    hammer: fill(D.hammer, p.hammer),
    sword: {
      ...fill(D.sword, { offset: p.sword?.offset, turn: p.sword?.turn }),
      swing: { ...fill(D.sword.swing, { time: swing?.time, windup: swing?.windup }), raise: fill(D.sword.swing.raise, swing?.raise), chop: fill(D.sword.swing.chop, swing?.chop) },
    },
    death: fill(D.death, p.death),
    gait: fill(D.gait, p.gait),
  };
}

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
  /** Its size in the hands (world units per model unit); default the figure's `heldScale` (0.5 in the fist). */
  scale?: number;
  /** A gun held as a rifle or a pistol (the item's `hold.stance`); default by its length. */
  stance?: 'rifle' | 'pistol';
  /** Hands on a gun (`hold.gun.hands`): with one, the free hand takes the stance's `offHand` pose, and comes to the gun to reload. Default 2. */
  hands?: 1 | 2;
  /** The item's own poses (`hold.poses`), over the figure's while it's held. */
  poses?: ItemPoses;
  /** A gun's action (`GunItem.action`): a `lever` or `hammer` is worked after each shot. */
  action?: string;
}

/**
 * A model's skeleton as the rig sees it: its node for each joint (bones or not), and where the
 * joints are standing straight (arms and legs hanging down, whatever pose the model rests in).
 */
export interface RigFrames {
  nodes: Record<Bone, THREE.Object3D>;
  /** Its fists' grip empties, if it has them. */
  grips: Record<'L' | 'R', THREE.Object3D | null>;
  /** Each joint at rest, in the model's space: where it is and how it's turned. */
  at: Record<Bone, THREE.Vector3>;
  turn: Record<Bone, THREE.Quaternion>;
  /** The swing that hangs each limb bone straight down (the body's joints: none). */
  swing: Record<Bone, THREE.Quaternion>;
  /** Standing straight: where each joint is, and how the model's own node is turned. */
  straight: Record<Bone, THREE.Vector3>;
  offset: Record<Bone, THREE.Quaternion>;
  /** Each fist's hold in its hand's space, standing straight (the hand unturned). */
  grip: Record<'L' | 'R', { p: THREE.Vector3; q: THREE.Quaternion }>;
}

/** A model's nodes by name: the first of each, as the file has them (and as three.js renames them: `mixamorig:Hips` is `mixamorigHips`). */
function named(root: THREE.Object3D): (name: string) => THREE.Object3D | undefined {
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name && !byName.has(o.name)) byName.set(o.name, o);
  });
  return (name) => byName.get(name) ?? byName.get(THREE.PropertyBinding.sanitizeNodeName(name));
}

/** The node for each of the rig's joints (`joints` maps the ones named otherwise); null if any is missing. */
export function findJoints(root: THREE.Object3D, joints?: Partial<Record<HumanoidJoint, string>>): (Record<Bone, THREE.Object3D> & Partial<Record<'gripL' | 'gripR', THREE.Object3D>>) | null {
  const find = named(root);
  const out: Partial<Record<Joint, THREE.Object3D>> = {};
  for (const j of [...REQUIRED, 'gripL', 'gripR'] as Joint[]) {
    const o = find(joints?.[j] ?? j);
    if (o) out[j] = o;
    else if (j !== 'gripL' && j !== 'gripR') return null;
  }
  return out as Record<Bone, THREE.Object3D>;
}

const DOWN = new THREE.Vector3(0, -1, 0);

/** A humanoid model's skeleton as the rig sees it (null if it isn't one). */
export function rigFrames(root: THREE.Object3D, joints?: Partial<Record<HumanoidJoint, string>>): RigFrames | null {
  const found = findJoints(root, joints);
  if (!found) return null;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const place = (o: THREE.Object3D) => {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.multiplyMatrices(toRoot, o.matrixWorld).decompose(p, q, new THREE.Vector3());
    return { p, q };
  };
  const nodes = {} as Record<Bone, THREE.Object3D>;
  const at = {} as Record<Bone, THREE.Vector3>;
  const turn = {} as Record<Bone, THREE.Quaternion>;
  for (const b of REQUIRED) {
    nodes[b] = found[b];
    const r = place(found[b]);
    at[b] = r.p;
    turn[b] = r.q;
  }
  // Arms and legs hang straight down standing straight: each bone swung there from however it
  // rests (a T-pose's arms out to the sides), the hands and feet with the bones they end.
  const swing = {} as Record<Bone, THREE.Quaternion>;
  const hang = (from: Bone, to: Bone) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().subVectors(at[to], at[from]).normalize(), DOWN);
  for (const b of REQUIRED) swing[b] = new THREE.Quaternion();
  for (const s of ['L', 'R'] as const) {
    swing[`upperArm${s}`] = hang(`upperArm${s}`, `lowerArm${s}`);
    swing[`lowerArm${s}`] = hang(`lowerArm${s}`, `hand${s}`);
    swing[`hand${s}`] = swing[`lowerArm${s}`].clone();
    swing[`upperLeg${s}`] = hang(`upperLeg${s}`, `lowerLeg${s}`);
    swing[`lowerLeg${s}`] = hang(`lowerLeg${s}`, `foot${s}`);
    swing[`foot${s}`] = swing[`lowerLeg${s}`].clone();
  }
  const straight = {} as Record<Bone, THREE.Vector3>;
  const offset = {} as Record<Bone, THREE.Quaternion>;
  for (const b of REQUIRED) {
    const p = PARENT[b];
    straight[b] = p ? new THREE.Vector3().subVectors(at[b], at[p]).applyQuaternion(swing[p]).add(straight[p]) : at[b].clone();
    offset[b] = swing[b].clone().multiply(turn[b]);
  }
  // The fists' holds: the model's grip empties, or a point in the fist a third of a forearm on from the wrist.
  const grip = {} as RigFrames['grip'];
  for (const s of ['L', 'R'] as const) {
    const g = found[`grip${s}`];
    const hand = `hand${s}` as const;
    if (g) {
      const r = place(g);
      grip[s] = { p: r.p.sub(at[hand]).applyQuaternion(swing[hand]), q: swing[hand].clone().multiply(r.q) };
    } else {
      const f = straight[hand].distanceTo(straight[`lowerArm${s}`]);
      grip[s] = { p: new THREE.Vector3(0, -0.34 * f, 0.06 * f), q: new THREE.Quaternion() };
    }
  }
  return { nodes, grips: { L: found.gripL ?? null, R: found.gripR ?? null }, at, turn, swing, straight, offset, grip };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** From a pair `[walking, running]`, `run` of the way. */
const pace = (p: [number, number], run: number) => p[0] + (p[1] - p[0]) * run;
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
const m2 = new THREE.Matrix4();
// Scratch for the free hand (apart from what `limb` works with).
const h1 = new THREE.Vector3();
const h2 = new THREE.Vector3();
const h3 = new THREE.Vector3();
const hq = new THREE.Quaternion();
const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

/** A rotation from Euler angles (YXZ: turn, then tip, then roll). */
const rot = (out: THREE.Quaternion, x: number, y = 0, z = 0) => out.setFromEuler(e1.set(x, y, z, 'YXZ'));
const turnOf = (out: THREE.Quaternion, t: V3) => rot(out, t[0], t[1], t[2]);

export interface RigOptions {
  /** The model's names for the rig's joints (`GltfSpec.joints`). */
  joints?: Partial<Record<HumanoidJoint, string>>;
  poses?: HumanoidPoses;
  /** The model's animation clips, for `play`. */
  clips?: THREE.AnimationClip[];
}

/**
 * A figure on the humanoid rig, animated in code from what it's doing: a gait worked out from its
 * speed and which way it's going (feet planted and stepping, the legs bent to reach them), crouching,
 * sliding and jumping; the head and chest turned to look; a gun in both hands aimed where it looks
 * (hands put on its grips), carried low across the chest to sprint, tipped to reload and kicking as
 * it fires; a sword swung two-handed; and a fall when it dies; with the model's own clips played
 * over it (`play`).
 *
 * The poses are worked out on the rig's own skeleton: its joints where the model's are standing
 * straight, unturned, each bone along its -y. The model's joints (rigid parts' nodes, or a skin's
 * bones) then follow them, each keeping its own turn from standing straight, so a skeleton resting
 * in a T-pose with its bones turned every which way moves as the rig's does.
 */
export class HumanoidRig {
  /** The rig's own skeleton (the poses are worked out on it), under the model's root. */
  private j: Record<Joint, THREE.Object3D>;
  private rest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private skeleton = new THREE.Group();
  /** The model's own space (the rig's skeleton is in it): feet and the ground are placed in it. */
  private body: THREE.Object3D;
  private frames: RigFrames;
  /**
   * How each of the model's joints follows the rig's: the nearest of its joints it hangs from
   * (-1: none, the model's root), and how its parent is turned from that one's at rest.
   */
  private follow: { node: THREE.Object3D; from: number; rel: THREE.Quaternion }[] = [];
  /** From the model's space into its hips' parent's (where the hips are placed). */
  private hipsFrom = new THREE.Matrix4();
  /** Each joint's turn this frame in the model's space: the rig's, and the model's own. */
  private turned = REQUIRED.map(() => new THREE.Quaternion());
  private placed = REQUIRED.map(() => new THREE.Quaternion());
  /** The middle of the shoulders (the chest's space), which the aim turns about; the ankles' height. */
  private pivot: THREE.Vector3;
  private ankle: number;
  readonly poses: Poses;
  private clips: ClipLayer | null = null;
  /** What's held, on the chest: the rig puts it where the pose wants it each frame. */
  private holder = new THREE.Object3D();
  private held: { mesh: THREE.Object3D; info: HeldInfo; stance: 'rifle' | 'pistol' } | null = null;
  /** The poses for what's held: its own (`hold.poses`) over the figure's. */
  private heldPoses: Poses;
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

  /** Does this model have the rig's joints (named as `joints` says)? */
  static fits(root: THREE.Object3D, joints?: Partial<Record<HumanoidJoint, string>>): boolean {
    return findJoints(root, joints) !== null;
  }

  /** The rig on a model (its root: the model's own space, +y up, facing +z). */
  constructor(root: THREE.Object3D, opts: RigOptions = {}) {
    const f = rigFrames(root, opts.joints);
    if (!f) throw new Error('not a humanoid: the model is missing some of the rig\'s joints');
    this.frames = f;
    this.body = root;
    this.poses = resolvePoses(opts.poses);
    this.heldPoses = this.poses;
    // The rig's skeleton: each joint where the model's is standing straight, unturned.
    const j = {} as Record<Joint, THREE.Object3D>;
    for (const b of REQUIRED) {
      const o = (j[b] = new THREE.Object3D());
      const p = PARENT[b];
      o.position.copy(f.straight[b]);
      if (p) o.position.sub(f.straight[p]);
      (p ? j[p] : this.skeleton).add(o);
    }
    for (const s of ['L', 'R'] as const) {
      const g = (j[`grip${s}`] = new THREE.Object3D());
      g.position.copy(f.grip[s].p);
      g.quaternion.copy(f.grip[s].q);
      j[`hand${s}`].add(g);
    }
    this.j = j;
    for (const o of Object.values(j)) this.rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() });
    root.add(this.skeleton);
    this.skeleton.updateMatrixWorld(true);
    // How the model's joints follow.
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const restTurn = (o: THREE.Object3D) => {
      const q = new THREE.Quaternion();
      m1.multiplyMatrices(toRoot, o.matrixWorld).decompose(v1, q, v2);
      return q;
    };
    const index = new Map<THREE.Object3D, number>();
    REQUIRED.forEach((b, i) => index.set(f.nodes[b], i));
    for (const b of REQUIRED) {
      const node = f.nodes[b];
      let a = node.parent;
      while (a && a !== root && !index.has(a)) a = a.parent;
      const from = a && a !== root ? index.get(a)! : -1;
      const ancestor = from < 0 ? new THREE.Quaternion() : f.turn[REQUIRED[from]];
      this.follow.push({ node, from, rel: ancestor.clone().invert().multiply(node.parent ? restTurn(node.parent) : new THREE.Quaternion()) });
    }
    const hipsParent = f.nodes.hips.parent;
    if (hipsParent && hipsParent !== root) this.hipsFrom.multiplyMatrices(toRoot, hipsParent.matrixWorld).invert();
    // The pivot: a centimetre above the middle of the shoulder joints.
    this.pivot = new THREE.Vector3().addVectors(f.straight.upperArmL, f.straight.upperArmR).multiplyScalar(0.5).sub(f.straight.chest);
    this.pivot.y += 0.01;
    this.ankle = f.straight.footL.y;
    j.chest.add(this.holder);
    if (opts.clips?.length) {
      const find = named(root);
      this.clips = new ClipLayer(root, opts.clips, (n) => (f.nodes as Record<string, THREE.Object3D>)[n] ?? (n === 'gripL' || n === 'gripR' ? f.grips[n === 'gripL' ? 'L' : 'R'] : null) ?? find(n) ?? null);
    }
  }

  /** The model's own node for a joint. */
  joint(name: Bone): THREE.Object3D {
    return this.frames.nodes[name];
  }

  /** Play one of the model's clips over the rig's animation (null: fade out what's playing). */
  play(clip: ClipPlay | null) {
    this.clips?.play(clip);
  }

  /** Hold something (null: empty-handed). The mesh's origin is the model's; the rig places it. */
  hold(mesh: THREE.Object3D | null, info: HeldInfo | null) {
    if (this.held) this.held.mesh.removeFromParent();
    this.held = null;
    this.heldPoses = info?.poses ? resolvePoses(info.poses, this.poses) : this.poses;
    if (!mesh || !info) return;
    const scale = info.scale ?? (info.kind === 'other' ? 0.5 : this.poses.heldScale);
    const stance = info.stance ?? (info.length * scale < this.poses.pistolUnder ? 'pistol' : 'rifle');
    this.held = { mesh, info, stance };
    mesh.scale.setScalar(scale / this.worldScale());
    mesh.quaternion.identity();
    mesh.position.copy(info.grip).multiplyScalar(-mesh.scale.x);
    // In the fist, tipped up a little.
    if (info.kind === 'other') {
      mesh.quaternion.setFromAxisAngle(X, -0.3);
      mesh.position.applyQuaternion(mesh.quaternion);
    }
    this.holder.add(mesh);
  }

  private worldScale(): number {
    this.body.updateWorldMatrix(true, false);
    return v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
  }

  /** Back to the rest pose, then posed; the model's joints follow; then its clips over that. */
  animate(s: AnimState) {
    const dt = this.last < 0 ? 0 : clamp(s.time - this.last, 0, 0.1);
    this.last = s.time;
    this.clips?.reset();
    this.pose(s, dt);
    this.retarget();
    if (this.clips?.active) {
      // What's held goes with the right hand wherever a clip takes it.
      const hand = this.frames.nodes.handR;
      hand.updateWorldMatrix(true, false);
      const inHand = m1.copy(hand.matrixWorld).invert().multiply(this.holder.matrixWorld);
      this.clips.apply(dt);
      if (this.held) {
        hand.updateWorldMatrix(true, false);
        this.j.chest.updateWorldMatrix(true, false);
        m2.copy(this.j.chest.matrixWorld).invert().multiply(hand.matrixWorld).multiply(inHand).decompose(this.holder.position, this.holder.quaternion, v5);
      }
    }
  }

  private pose(s: AnimState, dt: number) {
    for (const [o, r] of this.rest) {
      o.position.copy(r.p);
      o.quaternion.copy(r.q);
    }
    const P = this.poses;
    const G = P.gait;
    const j = this.j;
    const hips = j.hips;
    const hipRest = this.rest.get(hips)!.p;
    const crouch = clamp01(s.stance);
    const slide = clamp01(s.stance - 1);
    const speed = s.speed ?? 0;
    const moving = s.walkAmount;
    const run = clamp01((speed - G.run[0]) / (G.run[1] - G.run[0]));
    const air = s.air ? 1 : 0;
    const look = clamp(-s.headPitch, -1.25, 1.25);
    const held = this.held?.info.kind ?? null;
    const twoHanded = held === 'gun' || held === 'melee';
    const stance = this.held?.stance === 'pistol' ? this.heldPoses.pistol : this.heldPoses.rifle;
    this.sprint += ((s.sprint && held === 'gun' ? 1 : 0) - this.sprint) * clamp01(dt * 10);
    this.reload += ((s.reloading && held === 'gun' ? 1 : 0) - this.reload) * clamp01(dt * 12);
    this.reloadT = s.reloading ? this.reloadT + dt : 0;
    // Strides get longer as it speeds up; the phase runs with the ground covered.
    const stride = pace(G.stride, run);
    this.phase = (this.phase + (speed * dt) / stride) % 1;
    const ph = this.phase * Math.PI * 2;
    this.holder.visible = true;

    // Dying: a fall, backward or forward.
    if (s.dying > 0) {
      if (this.deathAt < 0) {
        this.deathAt = s.time;
        this.deathDir = Math.random() < P.death.backward ? -1 : 1;
      }
      this.fall(smooth(clamp01((s.time - this.deathAt) / P.death.time)));
      if (held === 'other') this.inFist();
      return;
    }
    this.deathAt = -1;

    // The hips: down to crouch and further to slide, a bob and a sway as it steps, leaning back to slide.
    const bob = moving * pace(G.bob, run) * (1 - Math.cos(ph * 2)) * 0.5;
    hips.position.set(hipRest.x + Math.sin(ph) * G.sway * moving * (1 - run), hipRest.y - crouch * G.crouch - slide * 0.12 - bob, hipRest.z - slide * 0.05);
    rot(q1, -0.55 * slide, 0, 0);
    hips.quaternion.multiply(q1);
    // The back: leaning into a run, a crouch; a twist to shoulder a gun; breathing.
    const lean = moving * pace(G.lean, run) + crouch * 0.16 * (1 - slide) + 0.3 * slide;
    const breathe = Math.sin(s.time * 1.9) * 0.012;
    const twist = held === 'gun' ? stance.twist * (1 - this.sprint) : 0;
    rot(q1, lean * 0.45, twist * 0.4, 0);
    j.spine.quaternion.multiply(q1);
    // Aiming, the chest takes part of the look (the gun takes the rest, about the shoulders).
    const chestLook = twoHanded ? look * 0.35 * (1 - this.sprint) : look * 0.2;
    rot(q1, lean * 0.55 + breathe - chestLook, twist * 0.6, 0);
    j.chest.quaternion.multiply(q1);
    this.body.updateWorldMatrix(true, false);
    this.skeleton.updateMatrixWorld(true);

    // The body's frame in the world (it faces +z), and where it looks.
    const bodyQ = this.body.getWorldQuaternion(this.bodyQ);
    const scale = v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
    const aimQ = rot(this.aimQ, -look, s.headYaw * 0.5, 0).premultiply(bodyQ);

    if (twoHanded) this.poseHeld(s, aimQ, bodyQ, scale);
    else this.swingArms(s, ph, moving, run, air);

    this.legs(s, ph, moving, run, crouch, slide, air, bodyQ);

    // The head looks where it looks, whatever the body's doing.
    const head = j.head;
    rot(q1, -look, s.headYaw, held === 'gun' ? stance.cheek * (s.ads ?? 0) : 0).premultiply(bodyQ);
    head.parent!.getWorldQuaternion(q2);
    head.quaternion.copy(q2.invert().multiply(q1));
    if (held === 'other') this.inFist();
  }

  /** Something held in the right fist: the holder on its grip. */
  private inFist() {
    const grip = this.j.gripR;
    grip.updateWorldMatrix(true, false);
    this.j.chest.updateWorldMatrix(true, false);
    m1.copy(this.j.chest.matrixWorld).invert().multiply(grip.matrixWorld).decompose(this.holder.position, this.holder.quaternion, v5);
    this.holder.updateMatrixWorld(true);
  }

  /**
   * The model's joints to where the rig's are: each turned as the rig's is (in the model's
   * space), times its own turn standing straight; the hips placed where the rig's are.
   */
  private retarget() {
    const f = this.frames;
    for (let i = 0; i < REQUIRED.length; i++) {
      const b = REQUIRED[i];
      const p = PARENT_INDEX[i];
      const turned = this.turned[i];
      if (p < 0) turned.copy(this.j[b].quaternion);
      else turned.multiplyQuaternions(this.turned[p], this.j[b].quaternion);
      const placed = this.placed[i].multiplyQuaternions(turned, f.offset[b]);
      const w = this.follow[i];
      const parent = w.from < 0 ? q1.copy(w.rel) : q1.multiplyQuaternions(this.placed[w.from], w.rel);
      w.node.quaternion.copy(parent.invert().multiply(placed));
    }
    f.nodes.hips.position.copy(this.j.hips.position).applyMatrix4(this.hipsFrom);
  }

  /**
   * Both hands on a gun or a sword: where it's held (aimed, carried low, reloaded, swung, its
   * action worked), then the arms to it. A gun held in one hand: the free hand in its own pose.
   */
  private poseHeld(s: AnimState, aimQ: THREE.Quaternion, bodyQ: THREE.Quaternion, scale: number) {
    const info = this.held!.info;
    const P = this.heldPoses;
    const j = this.j;
    const chest = j.chest;
    // The shoulders' middle, the pivot the aim turns about.
    const pivot = chest.localToWorld(v1.copy(this.pivot));
    const offset = v2;
    const gunQ = q1.copy(aimQ);
    if (info.kind === 'gun') {
      const stance = this.held!.stance === 'pistol' ? P.pistol : P.rifle;
      const ads = s.ads ?? 0;
      offset.fromArray(stance.hip).lerp(v3.fromArray(stance.ads), ads);
      // Kick: back and up, for a moment after each shot.
      const k = P.kick;
      const kick = s.shotT !== undefined && s.shotT < 5.5 / k.decay ? Math.exp(-s.shotT * k.decay) : 0;
      offset.z -= k.back * kick;
      gunQ.multiply(rot(q2, -k.tip * kick, 0, 0));
      // Working the action, a beat after the shot: a lever rocked, a hammer cocked.
      const act = info.action === 'lever' ? P.lever : info.action === 'hammer' ? P.hammer : null;
      const t = act && s.shotT !== undefined ? (s.shotT - 0.08) / act.time : -1;
      if (act && t > 0 && t < 1) {
        const w = Math.sin(t * Math.PI);
        offset.addScaledVector(v3.fromArray(act.offset), w);
        gunQ.multiply(rot(q2, act.turn[0] * w, act.turn[1] * w, act.turn[2] * w));
      }
      // Sprinting: low across the chest, muzzle down and to the left.
      if (this.sprint > 0.001) {
        offset.lerp(v3.fromArray(P.sprint.offset), this.sprint);
        gunQ.slerp(q2.copy(bodyQ).multiply(turnOf(q3, P.sprint.turn)), this.sprint);
      }
      // Reloading: tipped over to show the magazine.
      if (this.reload > 0.001) {
        offset.lerp(v3.fromArray(P.reload.offset), this.reload);
        gunQ.slerp(q2.copy(bodyQ).multiply(turnOf(q3, P.reload.turn)), this.reload);
      }
    } else {
      // A sword: two hands low on the handle, the blade up and forward; a chop when it attacks.
      const sw = P.sword;
      offset.fromArray(sw.offset);
      gunQ.copy(bodyQ).multiply(turnOf(q2, sw.turn));
      const { time, windup, raise, chop } = sw.swing;
      if (s.attackT < time) {
        const a = s.attackT / time;
        const up = a < windup ? smooth(a / windup) : 1 - smooth((a - windup) / (1 - windup));
        const down = a < windup ? 0 : smooth((a - windup) / (1 - windup));
        offset.add(v3.fromArray(raise.offset).multiplyScalar(up).addScaledVector(v4.fromArray(chop.offset), down));
        const r = raise.turn;
        const c = chop.turn;
        gunQ.multiply(rot(q2, r[0] * up + c[0] * down, r[1] * up + c[1] * down, r[2] * up + c[2] * down));
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
    if (info.kind === 'gun' && info.hands === 1) return this.offHand(info, mesh, handQ, bodyQ, P);
    const support = info.grip2 ? mesh.localToWorld(v2.copy(info.grip2)) : null;
    if (support) {
      if (info.kind === 'gun' && this.reload > 0.001 && info.mag) support.lerp(this.reloading(mesh, info.mag, P, v3), this.reload);
      this.limb('L', support, handQ, v1.set(0.45, -0.9, 0.05).applyQuaternion(bodyQ), false);
    }
  }

  /** Where a reloading hand is (the world's space): to the magazine and away (a fresh one from the belt), and back, each `cycle`. */
  private reloading(mesh: THREE.Object3D, mag: THREE.Vector3, P: Poses, out: THREE.Vector3): THREE.Vector3 {
    const t = (this.reloadT % P.reload.cycle) / P.reload.cycle;
    const away = t < 0.25 ? 0 : t < 0.6 ? smooth((t - 0.25) / 0.35) : 1 - smooth((t - 0.6) / 0.4);
    return mesh.localToWorld(out.copy(mag)).lerp(this.j.hips.localToWorld(v4.fromArray(P.reload.belt)), away);
  }

  /**
   * The free hand of a gun held in one hand: in the stance's `offHand` pose (from the middle of
   * the shoulders, in the chest's frame), and to the gun's magazine and the belt to reload.
   */
  private offHand(info: HeldInfo, mesh: THREE.Object3D, gunQ: THREE.Quaternion, bodyQ: THREE.Quaternion, P: Poses) {
    const chest = this.j.chest;
    const pose = (this.held!.stance === 'pistol' ? P.pistol : P.rifle).offHand;
    const at = chest.localToWorld(h1.copy(this.pivot).add(h2.fromArray(pose.offset)));
    const handQ = chest.getWorldQuaternion(hq).multiply(turnOf(q2, pose.turn));
    // Loose: the elbow back and out. To the gun: out and down, like a support hand's.
    const pole = h3.set(0.4, -0.2, -1).normalize();
    if (this.reload > 0.001 && info.mag) {
      at.lerp(this.reloading(mesh, info.mag, P, h2), this.reload);
      handQ.slerp(gunQ, this.reload);
      pole.lerp(v4.set(0.45, -0.9, 0.05), this.reload).normalize();
    }
    this.limb('L', at, handQ, pole.applyQuaternion(bodyQ), false);
  }

  /** Empty-handed (or one thing in the fist): the arms swing as it walks. */
  private swingArms(s: AnimState, ph: number, moving: number, run: number, air: number) {
    const j = this.j;
    const swing = Math.sin(ph) * moving * pace(this.poses.gait.armSwing, run);
    const attack = s.attackT < 0.35 ? Math.sin((s.attackT / 0.35) * Math.PI) : 0;
    const raised = s.raised ? 1 : s.casting ? 0.6 : 0;
    const bend = 0.25 + 0.9 * run;
    rot(q1, -swing - 1.6 * attack - 2.4 * raised - 0.5 * air, 0, -0.08 - 0.3 * air);
    j.upperArmR.quaternion.multiply(q1);
    rot(q1, -bend - 0.6 * attack, 0, 0);
    j.lowerArmR.quaternion.multiply(q1);
    rot(q1, swing - 2.4 * raised - 0.5 * air, 0, 0.08 + 0.3 * air);
    j.upperArmL.quaternion.multiply(q1);
    rot(q1, -bend, 0, 0);
    j.lowerArmL.quaternion.multiply(q1);
  }

  /** The feet: planted and stepping along the way it goes, tucked in the air, out ahead in a slide; the legs bend to them. */
  private legs(s: AnimState, ph: number, moving: number, run: number, crouch: number, slide: number, air: number, bodyQ: THREE.Quaternion) {
    const G = this.poses.gait;
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
    const step = moving * pace(G.step, run) * (1 - crouch * 0.4);
    const lift = moving * pace(G.lift, run) * (1 - slide);
    const ankle = this.ankle;
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
      const x = sign * (G.width + 0.05 * crouch) + dx * along;
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

  /**
   * Two-bone IK: bend `side`'s arm (or leg) so its end joint puts its grip (or itself) at `target`,
   * turned to `endQ`, the elbow (knee) toward `pole`. Arms bend forward at the elbow, legs back.
   */
  private limb(side: 'L' | 'R', target: THREE.Vector3, endQ: THREE.Quaternion, pole: THREE.Vector3, leg: boolean) {
    const j = this.j;
    const upper = leg ? j[`upperLeg${side}`] : j[`upperArm${side}`];
    const lower = leg ? j[`lowerLeg${side}`] : j[`lowerArm${side}`];
    const end = leg ? j[`foot${side}`] : j[`hand${side}`];
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
    const hips = j.hips;
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
      j[`upperLeg${side}`].quaternion.multiply(q1);
      rot(q1, knees, 0, 0);
      j[`lowerLeg${side}`].quaternion.multiply(q1);
      rot(q1, -1.3 * t, 0, sign * 1.1 * t);
      j[`upperArm${side}`].quaternion.multiply(q1);
      rot(q1, -0.5 * t, 0, 0);
      j[`lowerArm${side}`].quaternion.multiply(q1);
    }
    rot(q1, -dir * 0.35 * t, 0.4 * t, 0);
    j.head.quaternion.multiply(q1);
    // A gun or a sword drops from the hands (a thing in the fist stays in it).
    this.holder.visible = t < 0.3 || this.held?.info.kind === 'other';
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
