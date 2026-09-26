import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ItemPoses } from '../../src/platform/api/types';
import type { ItemPoint } from '../../src/platform/client/gltf';
import { gunHands, gunPoints, heldPoint, sameSpec } from '../../src/platform/client/held';
import { DEFAULT_POSES, HumanoidRig, resolvePoses, type HeldInfo } from '../../src/platform/client/humanoid';
import type { AnimState } from '../../src/platform/render/entities';
import { check } from './_harness';

const load = (file: string): Promise<GLTF> => {
  const b = readFileSync(file);
  return new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const v3 = (a: number[]) => a.map((v) => v.toFixed(3)).join(', ');

/** A gun a metre long along +z, its grip at the origin, and the points its file marks. */
function gunGeometry(): { geometry: THREE.BufferGeometry; points: Partial<Record<ItemPoint, THREE.Vector3>> } {
  const geometry = new THREE.BoxGeometry(0.2, 0.3, 1).translate(0, 0.1, 0.4);
  return { geometry, points: { grip: new THREE.Vector3(), grip2: new THREE.Vector3(0, 0.1, 0.55), muzzle: new THREE.Vector3(0, 0.15, 0.9), sight: new THREE.Vector3(0, 0.3, 0), mag: new THREE.Vector3(0, -0.1, 0.25) } };
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
 * How guns are held on figures, per item: an item's poses over its figure's (a reload's pose and
 * cycle of its own); a gun's points from its spec over its file's; one hand or two (a figure's
 * free hand in its stance's `offHand`); a gun's action (a lever, a hammer) worked after each
 * shot; and a figure's throw. (First person: tests/headless/firstperson.ts.)
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

  console.log('  item poses over the figure\'s · points from a spec over a file\'s · a figure\'s free hand, its reload cycle, its action, its throw');
}
