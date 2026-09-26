import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GunAction, HoldSpec, ItemPoses, ViewAnimation } from '../../src/platform/api/types';
import { GltfLibrary, type ItemPoint } from '../../src/platform/client/gltf';
import { gunHands, gunPoints, heldPoint, sameSpec } from '../../src/platform/client/held';
import { DEFAULT_POSES, HumanoidRig, resolvePoses, type HeldInfo } from '../../src/platform/client/humanoid';
import type { AnimState, EntityGraphics } from '../../src/platform/render/entities';
import type { SharedUniforms } from '../../src/platform/render/pipeline';
import { elbowFor, fitArms, upperFor, type ArmParts } from '../../src/platform/render/viewarms';
import { ViewModel, type GunView } from '../../src/platform/render/viewmodel';
import { check } from './_harness';

const load = (file: string): Promise<GLTF> => {
  const b = readFileSync(file);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const v3 = (a: number[]) => a.map((v) => v.toFixed(3)).join(', ');

/** What the tests read of a view model's own state. */
interface Inside {
  hold: HoldSpec;
  pending: unknown;
  gunPose: { hands: 1 | 2 };
  supportShown: number;
  rest: { grip: THREE.Vector3; grip2: THREE.Vector3; itemRot: THREE.Quaternion };
  playing: unknown;
  arm2: THREE.Mesh;
  gunHand2: THREE.Group;
  hand: THREE.Group;
  root: THREE.Group;
  humanoid: Record<'R' | 'L', ArmParts> | null;
  shoulders: THREE.Vector3[];
  cycleT: number;
}

/** A view model with no GPU: a stand-in skin atlas. */
function viewModel(): { vm: ViewModel; inside: Inside } {
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const atlas = { name: 'builtin', width: 64, height: 64, pixels: new Uint8Array(64 * 64 * 4), albedo: tex, emissive: tex };
  const vm = new ViewModel(tex, tex, { atlas: () => atlas } as unknown as EntityGraphics);
  return { vm, inside: vm as unknown as Inside };
}

/** A gun a metre long along +z, its grip at the origin, and the points its file marks. */
function gunGeometry(): { geometry: THREE.BufferGeometry; points: Partial<Record<ItemPoint, THREE.Vector3>> } {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 1).translate(0, 0.1, 0.4);
  return { geometry, points: { grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.1, 0.55), muzzle: new THREE.Vector3(0, 0.15, 0.9), sight: new THREE.Vector3(0, 0.3, 0), mag: new THREE.Vector3(0, -0.1, 0.25) } };
}

const gunView = (o: Partial<GunView> = {}): GunView => ({ aim: 0, sprint: 0, slide: 0, reload: -1, shells: 0, sight: 'iron', ...o });

/** Run the view model for `seconds` (60 steps a second). */
function run(vm: ViewModel, seconds: number, gun: GunView) {
  for (let i = 0; i < Math.round(seconds * 60); i++) vm.update(1 / 60, { aspect: 16 / 9, bobPhase: 0, bobAmount: 0, yaw: 0, pitch: 0, onGround: true, vy: 0, down: false, strength: 1, gun });
}

const still = (): AnimState => ({ walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, stance: 0, speed: 0, moveX: 0, moveZ: 1, ads: 0, shotT: 9 });

/** A figure on the rig holding a gun as `info` says, stepped through `seconds` of `state`. */
function posed(gltf: GLTF, info: Partial<HeldInfo>, seconds: number, state: Partial<AnimState>) {
  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  root.add(model);
  const rig = new HumanoidRig(model, {});
  const gun = new THREE.Group();
  gun.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.8)));
  rig.hold(gun, { kind: 'gun', grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.05, 0.5), mag: new THREE.Vector3(0, -0.1, 0.2), length: 0.8, stance: 'pistol', ...info });
  const s = still();
  for (let i = 1; i <= Math.round(seconds * 60); i++) rig.animate(Object.assign(s, state, { time: i / 60 }));
  root.updateMatrixWorld(true);
  const at = (name: Parameters<HumanoidRig['joint']>[0]) => rig.joint(name).getWorldPosition(new THREE.Vector3());
  const held = (p: THREE.Vector3) => gun.localToWorld(p.clone());
  return { rig, at, held, gunQ: gun.getWorldQuaternion(new THREE.Quaternion()) };
}

/**
 * How guns are held, per item: an item's poses over its figure's (a reload's pose and cycle of
 * its own); a gun's points from its spec over its file's (the same in first person and on a
 * figure); one hand or two (the view model's support hand out of sight but to reload, a figure's
 * free hand in its stance's `offHand`); first-person arms fitted per gun and bent at the elbow to
 * reach a shoulder that stays put; a gun's action (a lever, a hammer, one of the game's own)
 * worked after each shot; two items sharing a model each keeping its own hold; and a figure's
 * throw.
 */
export default async function gunhold() {
  // Poses per item: what the item gives over the figure's, part by part.
  const figure = resolvePoses({ reload: { cycle: 0.8 }, pistol: { twist: -0.4 } });
  const itemPoses: ItemPoses = { reload: { cycle: 0.42, turn: [-0.75, 0.35, 0.9] }, pistol: { offHand: { offset: [0.2, -0.48, 0.1] } }, lever: { time: 0.6 } };
  const item = resolvePoses(itemPoses, figure);
  check(item.reload.cycle === 0.42 && item.reload.turn.join() === '-0.75,0.35,0.9' && item.reload.offset.join() === DEFAULT_POSES.reload.offset.join() && item.reload.belt.join() === DEFAULT_POSES.reload.belt.join(), `an item's reload over its figure's, the rest kept: ${JSON.stringify(item.reload)}`);
  check(item.pistol.twist === -0.4 && item.pistol.hip.join() === DEFAULT_POSES.pistol.hip.join(), 'the figure\'s own stance kept where the item says nothing');
  check(item.pistol.offHand.offset.join() === '0.2,-0.48,0.1' && item.pistol.offHand.turn.join() === '0,0,0', `the free hand's pose merges part by part: ${JSON.stringify(item.pistol.offHand)}`);
  check(item.lever.time === 0.6 && item.lever.turn.join() === DEFAULT_POSES.lever.turn.join() && item.hammer.time === DEFAULT_POSES.hammer.time, 'an action\'s pose over the default');
  check(figure.reload.cycle === 0.8 && JSON.stringify(resolvePoses(undefined, figure)) === JSON.stringify(figure), 'the figure\'s own untouched, and no item poses are the figure\'s');

  // A gun's points: its spec's (pixels) over its file's, else guessed from its size; hands.
  const { geometry, points } = gunGeometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const spec = { parts: [], grip2: [0, -16, 8] as [number, number, number] };
  const pts = gunPoints(spec, points, box);
  check(near(pts.grip2.y, -1) && near(pts.grip2.z, 0.5) && pts.muzzle.equals(points.muzzle!), `a spec's grip2 goes over the file's (${v3(pts.grip2.toArray())}), the file's muzzle kept`);
  const guessed = gunPoints(undefined, { grip: new THREE.Vector3() }, box);
  check(near(guessed.grip2.z, (0 + box.max.z) / 2) && near(guessed.muzzle.z, box.max.z) && near(guessed.mag.y, box.min.y + 1 / 16), `no grip2 anywhere: halfway along (${v3(guessed.grip2.toArray())})`);
  check(heldPoint(spec, points, 'grip2')!.y === -1 && heldPoint(undefined, points, 'mag')!.equals(points.mag!) && heldPoint(undefined, {}, 'grip2') === undefined, 'one point at a time: the spec\'s, the file\'s, or none');
  check(gunHands(undefined) === 2 && gunHands({}) === 2 && gunHands({ gun: { hands: 2 } }) === 2 && gunHands({ gun: { hands: 1 } }) === 1, 'a gun is two-handed unless its hold says one');
  check(sameSpec({ a: [1, 2], b: { c: 1 } }, { b: { c: 1 }, a: [1, 2], d: undefined }) && !sameSpec({ a: [1, 2] }, { a: [1, 3] }) && !sameSpec({ gun: { hands: 1 } }, {}), 'holds compared value for value');

  // Two items sharing a model, held their own ways (the view model used to keep the first hold).
  const { vm, inside } = viewModel();
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  vm.setItem(geometry, tex, tex, { style: 'gun' }, 'gun', points);
  run(vm, 1, gunView());
  const shown = (): number => inside.supportShown;
  check(inside.pending === null && inside.gunPose.hands === 2 && shown() === 1 && inside.arm2.visible, 'a two-handed gun: the support arm on it');
  vm.setItem(geometry, tex, tex, { style: 'gun', gun: { hands: 1 } }, 'gun', points);
  check(inside.pending !== null, 'the same model with another hold is taken up');
  run(vm, 1, gunView());
  const hands = (): number => inside.gunPose.hands;
  check(inside.pending === null && inside.hold.gun?.hands === 1 && hands() === 1, 'switching to it, its own hold');
  vm.setItem(geometry, tex, tex, { style: 'gun', gun: { hands: 1 } }, 'gun', points);
  check(inside.pending === null, 'the same hold again (a new object, the same values): nothing to change');

  // One hand: the support hand out of sight, and in to reload.
  run(vm, 0.2, gunView());
  check(shown() === 0 && !inside.arm2.visible && !inside.gunHand2.visible, 'one-handed: the support hand and arm hidden');
  run(vm, 0.1, gunView({ reload: 0.4 }));
  check(shown() === 1 && inside.arm2.visible && inside.gunHand2.visible, 'one-handed, reloading: the support hand comes in');
  const inHand = inside.gunHand2.position.clone();
  run(vm, 0.1, gunView({ reload: 0.02 }));
  check(inside.gunHand2.position.distanceTo(inHand) > 0.2, `it comes from out of sight (${v3(inside.gunHand2.position.toArray())} from ${v3(inHand.toArray())})`);

  // Actions: a lever rocks the gun on the support hand; a hammer cants it; the game's own plays.
  const action = (a: GunAction | undefined, after: number) => {
    const { vm: m, inside: i } = viewModel();
    m.setItem(geometry, tex, tex, { style: 'gun' }, 'gun', points);
    run(m, 1, gunView({ action: a }));
    const grip = i.rest.grip.clone();
    const support = i.rest.grip.clone().add(i.rest.grip2);
    const rot = i.rest.itemRot.clone();
    m.fire();
    // The recoil springs moved the hand, not the rest pose the action moves.
    run(m, after, gunView({ action: a }));
    return { grip, support, rot, i };
  };
  const lever = action('lever', 0.25);
  check(lever.i.rest.grip.y < lever.grip.y - 0.02, `a lever: the grip and the hand on it drop (${lever.grip.y.toFixed(3)} to ${lever.i.rest.grip.y.toFixed(3)})`);
  check(lever.i.rest.grip.clone().add(lever.i.rest.grip2).distanceTo(lever.support) < 1e-6, 'a lever: the support hand stays put');
  const hammer = action('hammer', 0.2);
  check(hammer.i.rest.itemRot.angleTo(hammer.rot) > 0.15 && hammer.i.rest.grip.distanceTo(hammer.grip) < 1e-6, 'a hammer: the gun cants in the fist');
  const none = action(undefined, 0.25);
  check(none.i.rest.itemRot.angleTo(none.rot) < 1e-6 && none.i.cycleT === -1, 'no action: nothing worked');
  check(action('lever', 1).i.rest.itemRot.angleTo(lever.rot) < 1e-6, 'a lever: back where it was after');
  const custom: ViewAnimation = { duration: 0.3, keys: [{ t: 0 }, { t: 0.5, move: [0, 0.1, 0] }, { t: 1 }] };
  const own = action(custom, 0.12);
  check(own.i.playing !== null, 'an action of the game\'s own plays on the hand a beat after the shot');

  // First-person arms: fitted per gun over the model's, and bent.
  const fit = fitArms({ scale: 0.9, bend: 0.6 }, { reach: [0.5, 0.6], bend: [0.5, 0.7] });
  check(fit.scale === 0.9 && fit.reach.join() === '0.5,0.6' && fit.bend.join() === '0.5,0.7' && fit.support.join() === '0.01,-0.012,0', `a gun's arm over the model's over the platform's: ${JSON.stringify(fit)}`);
  check(fitArms().bend.join() === '0,0' && fitArms({ bend: 0.4 }).bend.join() === '0.4,0.4', 'straight by default; one bend for both arms');
  check(fitArms().hands === 1 && fitArms({ hands: 0.7 }, { scale: 0.8 }).hands === 0.7, 'fists the arms\' size by default; `hands` over it');
  check(near(upperFor(0.55, 0.25, 0.2, 0), 0.3) && near(upperFor(0.55, 0.25, 0.4, 0), 0.4), 'straight: the upper arm drawn out to the reach (never shorter than its own)');
  const b = upperFor(0.5, 0.25, 0.1, 0.8);
  const w = new THREE.Vector3(0, 0, 0);
  const sh = new THREE.Vector3(0, 0, 0.5);
  const e = elbowFor(sh, w, b, 0.25, new THREE.Vector3(0, -1, 0), new THREE.Vector3());
  const bend = Math.PI - e.clone().sub(w).angleTo(sh.clone().sub(e));
  check(near(e.distanceTo(w), 0.25, 1e-6) && near(e.distanceTo(sh), b, 1e-6) && near(Math.PI - bend, 0.8, 1e-6) && e.y < 0, `bent: the bones their lengths, the elbow bent as asked, toward the pole (${(Math.PI - bend).toFixed(3)} rad)`);
  const far = elbowFor(sh, new THREE.Vector3(0, 0, -1), b, 0.25, new THREE.Vector3(0, -1, 0), new THREE.Vector3());
  check(near(far.x, 0) && near(far.y, 0) && near(far.z, -0.75), 'out of reach: straight at the shoulder');

  // A humanoid's own arms in the view model: bent at the elbow, the shoulder staying put.
  const lib = new GltfLibrary({} as SharedUniforms);
  lib.adopt('/m.glb', await load('src/games/gallery/models/mannequin.glb'));
  const arms = lib.humanoidArms('/m.glb')!;
  const arm = (bendBy: number, hands?: number) => {
    const { vm: m, inside: i } = viewModel();
    m.setHumanoidArms(arms, { bend: bendBy, hands });
    m.setItem(geometry, tex, tex, { style: 'gun' }, 'gun', points);
    run(m, 1, gunView());
    const R = i.humanoid!.R;
    const elbow = R.forearm.position;
    const angle = R.fist.position.clone().sub(elbow).angleTo(R.upper.position.clone().sub(elbow));
    return { m, i, angle };
  };
  const straight = arm(0);
  check(near(straight.angle, Math.PI, 1e-4), `bend 0: one straight line from the wrist (${straight.angle.toFixed(4)} rad at the elbow)`);
  const bent = arm(0.6);
  check(near(Math.PI - bent.angle, 0.6, 0.01), `bend 0.6: the elbow bent that much at rest (${(Math.PI - bent.angle).toFixed(3)})`);
  // Smaller fists (`hands`): the fist that much smaller than the forearm, still closed on the grip.
  const small = arm(0, 0.6);
  const Rs = small.i.humanoid!.R;
  const Rn = straight.i.humanoid!.R;
  const grip = (R: typeof Rs) => arms.R.grip.clone().multiplyScalar(R.fist.scale.x).applyQuaternion(R.fist.quaternion).add(R.fist.position);
  check(near(Rs.fist.scale.x / Rs.forearm.scale.x, 0.6, 1e-6) && near(Rn.fist.scale.x, Rn.forearm.scale.x, 1e-9), `hands 0.6: the fist 0.6 of the arm (${(Rs.fist.scale.x / Rs.forearm.scale.x).toFixed(3)})`);
  check(grip(Rs).distanceTo(grip(Rn)) < 1e-6, 'and still holding the same grip');
  const shoulder = () => bent.i.humanoid!.R.upper.position.clone().applyQuaternion(bent.i.hand.quaternion).add(bent.i.hand.position);
  const before = shoulder();
  bent.m.fire(2);
  run(bent.m, 0.03, gunView());
  const kicked = Math.PI - bent.i.humanoid!.R.forearm.position.clone().sub(bent.i.humanoid!.R.fist.position).angleTo(bent.i.humanoid!.R.upper.position.clone().sub(bent.i.humanoid!.R.forearm.position));
  check(shoulder().distanceTo(before) < 1e-6 && Math.abs(kicked - 0.6) > 0.01, `kicked, the shoulder stays put and the elbow gives (${kicked.toFixed(3)} rad)`);
  lib.dispose();

  // A figure: one hand free in its stance's pose, the reload's cycle the item's, the action worked.
  const model = await load('src/games/gallery/models/mannequin.glb');
  const two = posed(model, {}, 0.5, {});
  check(two.at('handL').distanceTo(two.held(new THREE.Vector3(0, 0.05, 0.5))) < 0.2, 'two hands: the left on the gun\'s grip2');
  const one = posed(model, { hands: 1 }, 0.5, {});
  const hl = one.at('handL');
  check(hl.distanceTo(one.held(new THREE.Vector3(0, 0.05, 0.5))) > 0.3 && hl.y > 0.85 && hl.y < 1.2 && hl.x > 0.12, `one hand: the left hangs at its side (${v3(hl.toArray())})`);
  const up = posed(model, { hands: 1, poses: { pistol: { offHand: { offset: [0.15, -0.25, 0.25] } } } }, 0.5, {});
  check(up.at('handL').y > hl.y + 0.15, 'the item\'s own free-hand pose');
  const reloading = posed(model, { hands: 1 }, 1, { reloading: true });
  check(reloading.at('handL').distanceTo(hl) > 0.15, 'one hand, reloading: the free hand comes to the gun');
  const cycle = (poses?: ItemPoses) => posed(model, { poses }, 0.8, { reloading: true }).at('handL');
  check(cycle({ reload: { cycle: 0.5 } }).distanceTo(cycle()) > 0.05 && cycle({ reload: { cycle: 1.1 } }).distanceTo(cycle()) < 1e-6, 'the reload\'s cycle is the item\'s (the figure\'s when it doesn\'t say)');
  const worked = (a?: string, shotT = 0.3) => posed(model, { action: a }, 0.2, { shotT }).gunQ;
  check(worked('lever').angleTo(worked('lever', 9)) > 0.1 && worked('hammer').angleTo(worked('hammer', 9)) > 0.1, 'a lever and a hammer worked a beat after the shot');
  check(worked(undefined).angleTo(worked(undefined, 9)) < 1e-6 && worked('pump').angleTo(worked('pump', 9)) < 1e-6, 'no action, or a pump: the figure\'s gun as it was');

  // A throwable is thrown overarm: cocked back over the shoulder, then whipped forward.
  const thrown = (throws: boolean, attackT: number) => posed(model, { kind: 'other', throws, grip2: undefined }, 0.2, { attackT });
  const cocked = thrown(true, 0.12);
  const whipped = thrown(true, 0.3);
  const swung = thrown(false, 0.12);
  check(cocked.at('handR').y > cocked.at('head').y && cocked.at('handR').z < cocked.at('head').z + 0.05, `cocked: the hand up behind the head (${v3(cocked.at('handR').toArray())})`);
  check(whipped.at('handR').z > cocked.at('handR').z + 0.3, 'whipped: the hand out ahead');
  check(swung.at('handR').y < swung.at('head').y && thrown(true, 9).at('handR').distanceTo(thrown(false, 9).at('handR')) < 1e-6, 'anything else swings as before, and at rest a throwable hangs the same');

  console.log('  item poses over the figure\'s · points from a spec over a file\'s · two items on one model held their own ways · one hand (hidden, in to reload) · lever, hammer, the game\'s own action · arms fitted per gun, bent to a shoulder that stays put, fists sized on their own · a figure\'s free hand, its reload cycle, its action');
}
