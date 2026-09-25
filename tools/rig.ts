/**
 * Development: a humanoid model (docs/HUMANOID.md) in a row of poses, animated by the platform's
 * own rig code, lit simply. `/tools/rig.html?model=<glb url>&t=<seconds>&view=front|side|34`
 * `&poses=<names>` (`t` freezes time for a screenshot; guns come from Call of Blocky's models).
 * `joints=mixamo` (or a JSON joint map) for a skeleton named its own way; `style=<JSON>` for
 * `HumanoidPoses`; the poses ending in a clip's name (`wave`, `cheer`) play the model's clip.
 *
 * Any item and any clip:
 * - `item=<glb url>` puts that model in the hand wherever a pose holds a gun (High Noon's
 *   revolver: `item=/src/games/highnoon/models/revolver.glb`); `kind=melee` holds it as a blade.
 * - `clips=<names>` (or `clips=all`: every clip in the model) adds a figure playing each clip,
 *   looping, holding the item if one's given; `layer=upper` plays them over the legs' own motion.
 *   With `clips` and no `poses`, only the clips are shown.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { HumanoidJoints } from '../src/platform/api/models';
import type { ClipOptions, HumanoidJoint, HumanoidPoses } from '../src/platform/api/types';
import { HumanoidRig, type HeldInfo } from '../src/platform/client/humanoid';
import type { AnimState } from '../src/platform/render/entities';

const q = new URLSearchParams(location.search);
const MODEL = q.get('model') ?? '/src/games/gallery/models/mannequin.glb';
const FREEZE = q.has('t') ? Number(q.get('t')) : null;
const VIEW = q.get('view') ?? '34';
const GUNS = '/src/games/callofblocky/models/';
const JOINTS: Partial<Record<HumanoidJoint, string>> | undefined = q.get('joints') === 'mixamo' ? HumanoidJoints.mixamo() : q.has('joints') ? JSON.parse(q.get('joints')!) : undefined;
const STYLE: HumanoidPoses | undefined = q.has('style') ? JSON.parse(q.get('style')!) : undefined;
/** An item of any game's to hold instead of Call of Blocky's guns, and how it's held. */
const ITEM = q.get('item');
const KIND = q.get('kind') === 'melee' ? 'melee' : null;
/** The held model for a pose's gun: the item given, else Call of Blocky's. */
const gunUrl = (id: string) => ITEM ?? `${GUNS}${id}.glb`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2f3a);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a3b30, 1.4));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 6;
sun.shadow.camera.bottom = -3;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 12), new THREE.MeshStandardMaterial({ color: 0x555a63, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const base = (): AnimState => ({ walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 1, stance: 0, speed: 0, moveX: 0, moveZ: 1, ads: 0, shotT: 9 });
interface Pose { name: string; gun: string | null; state: (t: number) => Partial<AnimState>; clip?: { name: string } & ClipOptions }
const POSES: Pose[] = [
  { name: 'idle rifle', gun: 'rifle', state: () => ({}) },
  { name: 'look up', gun: 'rifle', state: () => ({ headPitch: -0.6 }) },
  { name: 'aim (ADS)', gun: 'rifle', state: () => ({ ads: 1 }) },
  { name: 'firing', gun: 'rifle', state: (t) => ({ shotT: t % 0.1 }) },
  { name: 'walk', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 4 }) },
  { name: 'run', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 6 }) },
  { name: 'strafe left', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 5, moveX: 1, moveZ: 0 }) },
  { name: 'backpedal', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 4, moveX: 0, moveZ: -1 }) },
  { name: 'sprint', gun: 'rifle', state: () => ({ walkAmount: 1, speed: 8.4, sprint: true }) },
  { name: 'crouch', gun: 'rifle', state: () => ({ stance: 1 }) },
  { name: 'crouch walk', gun: 'rifle', state: () => ({ stance: 1, walkAmount: 1, speed: 2.5 }) },
  { name: 'slide', gun: 'rifle', state: () => ({ stance: 2, walkAmount: 1, speed: 10 }) },
  { name: 'jump', gun: 'rifle', state: () => ({ air: true }) },
  { name: 'reload', gun: 'rifle', state: () => ({ reloading: true }) },
  { name: 'pistol', gun: 'pistol', state: () => ({}) },
  { name: 'pistol walk', gun: 'pistol', state: () => ({ walkAmount: 1, speed: 5 }) },
  { name: 'shotgun', gun: 'shotgun', state: () => ({}) },
  { name: 'sniper ADS', gun: 'sniper', state: () => ({ ads: 1 }) },
  { name: 'katana', gun: 'katana', state: () => ({}) },
  { name: 'katana swing', gun: 'katana', state: (t) => ({ attackT: (t % 0.8) * 0.5 }) },
  { name: 'unarmed walk', gun: null, state: () => ({ walkAmount: 1, speed: 4, aim: 0 }) },
  { name: 'dying', gun: 'rifle', state: (t) => ({ dying: 1, time: t }) },
  { name: 'wave', gun: null, state: () => ({ aim: 0 }), clip: { name: 'wave', layer: 'upper', loop: true } },
  { name: 'walk wave', gun: null, state: () => ({ walkAmount: 1, speed: 4, aim: 0 }), clip: { name: 'wave', layer: 'upper', loop: true } },
  { name: 'rifle wave', gun: 'rifle', state: () => ({}), clip: { name: 'wave', layer: ['upperArmR'], loop: true } },
  { name: 'cheer', gun: null, state: () => ({ aim: 0 }), clip: { name: 'cheer', loop: true } },
  { name: 'crouch cheer', gun: null, state: () => ({ stance: 1, aim: 0 }), clip: { name: 'cheer', layer: 'upper', loop: true } },
];

const loader = new GLTFLoader();
const load = (url: string) => loader.loadAsync(url);
const figures: { rig: HumanoidRig; root: THREE.Object3D; pose: Pose; state: AnimState; label: HTMLElement }[] = [];

async function main() {
  const model = await load(MODEL);
  // A figure for each clip asked for (`clips=all`: every one the model has), looping.
  const asked = q.get('clips');
  const clipNames = asked === 'all' ? model.animations.map((a) => a.name) : (asked?.split(',').map((n) => n.trim()).filter(Boolean) ?? []);
  const layer = q.get('layer') === 'upper' ? 'upper' : 'full';
  const clipPoses: Pose[] = clipNames.map((name) => ({ name, gun: ITEM ? 'item' : null, state: () => ({ aim: ITEM ? 1 : 0 }), clip: { name, loop: true, layer } }));
  const all = [...POSES, ...clipPoses];
  const pick = q.get('poses')?.split(',').map((n) => n.trim().toLowerCase());
  const shown = pick ? all.filter((p) => pick.includes(p.name.toLowerCase())) : clipPoses.length ? clipPoses : POSES.slice(0, 8);
  const guns = new Map<string, THREE.Object3D>();
  for (const id of new Set(shown.map((p) => p.gun).filter((g): g is string => !!g))) guns.set(id, (await load(gunUrl(id))).scene);
  const cols = shown.length;
  frameCamera(cols);
  shown.forEach((pose, i) => {
    const root = new THREE.Group();
    const copy = cloneSkinned(model.scene);
    copy.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        m.material = mat.clone();
        // Rigid parts faceted; a skin smooth.
        (m.material as THREE.MeshStandardMaterial).flatShading = !(m as THREE.SkinnedMesh).isSkinnedMesh;
      }
    });
    root.add(copy);
    root.position.set((i - (cols - 1) / 2) * 1.35, 0, 0);
    // Turned to show the side (its right, the gun side), or three-quarters.
    root.rotation.y = VIEW === 'side' ? -Math.PI / 2 : VIEW === 'back' ? Math.PI : VIEW === '34' ? -0.6 : 0;
    scene.add(root);
    const rig = new HumanoidRig(copy, { joints: JOINTS, poses: STYLE, clips: model.animations });
    if (pose.clip) rig.play({ loop: false, fade: 0.2, layer: 'full', speed: 1, ...pose.clip, elapsed: 0 });
    if (pose.gun) {
      const g = guns.get(pose.gun)!.clone(true);
      g.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));
      const point = (n: string) => g.getObjectByName(n)?.position.clone();
      const box = new THREE.Box3().setFromObject(g);
      const info: HeldInfo = { kind: KIND ?? (pose.gun === 'katana' && !ITEM ? 'melee' : 'gun'), grip: point('grip') ?? new THREE.Vector3(), grip2: point('grip2'), mag: point('mag'), length: box.max.z - box.min.z };
      rig.hold(g, info);
    }
    const label = document.createElement('span');
    label.textContent = pose.name;
    document.getElementById('labels')!.append(label);
    figures.push({ rig, root, pose, state: base(), label });
  });
  requestAnimationFrame(frame);
}

const camera = new THREE.PerspectiveCamera(24, innerWidth / innerHeight, 0.1, 100);
function frameCamera(cols: number) {
  const width = cols * 1.35 + 0.6;
  const dist = Math.max(4.5, width / 2 / Math.tan(((24 / 2) * Math.PI) / 180) / camera.aspect) * 1.05;
  camera.position.set(0, 1.35, dist);
  camera.lookAt(0, 0.95, 0);
}
const start = performance.now();
let time = 0;
function frame() {
  const t = FREEZE ?? (performance.now() - start) / 1000;
  // Step up to `t` in small steps (the rig integrates its stride with the time between frames).
  while (time < t) {
    time = Math.min(t, time + 1 / 60);
    for (const f of figures) {
      Object.assign(f.state, base(), f.pose.state(time), { time });
      if (f.state.dying) f.state.time = time;
      f.rig.animate(f.state);
    }
  }
  renderer.render(scene, camera);
  for (const f of figures) {
    const p = f.root.getWorldPosition(new THREE.Vector3()).setY(2.1).project(camera);
    f.label.style.left = `${((p.x + 1) / 2) * innerWidth}px`;
    f.label.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  }
  if (FREEZE === null) requestAnimationFrame(frame);
}
main();
