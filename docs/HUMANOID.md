# The humanoid rig

A glTF figure built to this rig can be animated by the platform: it walks, runs, strafes,
crouches, slides, jumps, looks, holds guns in both hands, swings, reloads and falls, all worked
out in code from what the player does. No animation clips are needed, but a game can play the
model's own over the rig's animation (see *Clips*), and set how it all looks (see *Poses*). The
figure may be rigid parts or a skinned mesh, and its skeleton may be named and rest its own way
(see *Other skeletons*).

## Frame

- Units: 1 glTF unit = 1 block = 1 metre.
- Origin: on the ground, between the feet.
- The figure faces +z, with +y up. Its own right is -x and its own left is +x.
- It stands about 1.85 tall to the top of the head, with its eyes near 1.64.

## Joints

Nodes are named exactly as below. Each is a child of the one above it, placed by its rest
translation (in its parent's space, in metres) with identity rotation and scale. A figure may
change the numbers a little (a taller build, broader shoulders); the platform reads the joints
from the file. (A skeleton named otherwise, with other joints between these, or resting in
another pose: see *Other skeletons*.)

```
<root>                       the fighter's id; no transform
└─ hips       (0, 0.95, 0)         pelvis; the root of the body
   ├─ spine   (0, 0.10, 0)         belly
   │  └─ chest (0, 0.22, 0)        ribcage and shoulders
   │     ├─ neck (0, 0.24, 0)
   │     │  └─ head (0, 0.07, 0)   head pivot, top of the neck (world y ≈ 1.58)
   │     ├─ upperArmL (+0.19, 0.19, 0)   shoulder (world ≈ (0.19, 1.46, 0))
   │     │  └─ lowerArmL (0, -0.28, 0)   elbow
   │     │     └─ handL (0, -0.25, 0)    wrist
   │     │        └─ gripL  (empty)      the centre of the fist's hold
   │     └─ upperArmR (-0.19, 0.19, 0)   … the mirror: lowerArmR, handR, gripR
   ├─ upperLegL (+0.10, -0.04, 0)  hip joint (world ≈ (0.10, 0.91, 0))
   │  └─ lowerLegL (0, -0.43, 0)   knee
   │     └─ footL (0, -0.41, 0)    ankle (world y ≈ 0.07); the shoe reaches forward (+z) to the ground
   └─ upperLegR (-0.10, -0.04, 0)  … lowerLegR, footR
```

## The rest pose

The figure stands straight in its rest pose. Its arms hang down from the shoulders along -y,
palms toward the thighs, and its feet point +z.

Each part's geometry belongs to the joint that moves it. Meshes are children of that joint node,
or on the node itself:
- **hips:** the pelvis and belt.
- **spine:** the belly.
- **chest:** the ribcage, shoulders and the jacket's top.
- **neck:** the neck and collar.
- **head:** the head, hair, hat, face and glasses.
- **upperArm:** the upper arm and sleeve.
- **lowerArm:** the forearm and cuff.
- **hand:** the fist.
- **upperLeg:** the thigh.
- **lowerLeg:** the shin.
- **foot:** the shoe.

Bends up to about 130° at the elbows and knees, and 60° at the hips and shoulders, shouldn't
open gaps. Round the ends, or let a part overlap its neighbour.

## Hands

Both hands are modelled as fists that hold something, since a fighter always does.

- **Right hand (firing hand):** it grips a pistol grip that runs up and down through the fist.
- **Left hand (support hand):** it grips a bar that runs forward and back (a handguard or pump).

`gripR` and `gripL` are empty nodes at the centre of each fist's hold. In the rest pose their
axes line up with the world's: an item held there points forward (+z) with its up along +y. The
platform lines up a gun's `grip` point with `gripR` and its `grip2` with `gripL`, and bends the
arms to reach them.

## Materials

Materials use glTF's PBR metallic-roughness model: `baseColorFactor`, `metallicFactor` and
`roughnessFactor`, with an optional `baseColorTexture`, `metallicRoughnessTexture` (G roughness,
B metalness) and `emissiveTexture`. A figure may have several materials.

## Skinned models

Instead of a mesh on each joint, a figure may be one skinned mesh (or several, one per
material) on a skeleton whose bones are the joints, each vertex weighted to up to four bones, as
Blender and Mixamo export them. The rig turns the bones; the platform's own shading skins the
mesh, and its shadow, on the GPU (three.js's bone texture, only for skinned meshes). Bones the
rig doesn't know (fingers, toes, twist bones) ride along with the joint they hang from, or a
clip moves them.

## Other skeletons

`joints` in `Models.gltf` maps the rig's joints onto the model's own node names; joints left out
go by the rig's names. `HumanoidJoints.mixamo()` is Mixamo's (`mixamorig:Hips`, `Spine`, `Spine2`
as the chest, `Neck`, `Head`, `LeftArm`, `LeftForeArm`, `LeftHand`, `LeftUpLeg`, `LeftLeg`,
`LeftFoot` and the right's).

```ts
Models.gltf(heroUrl, { rig: 'humanoid', joints: HumanoidJoints.mixamo() })
Models.gltf(botUrl, { rig: 'humanoid', joints: { hips: 'pelvis', chest: 'spine_03', upperArmL: 'upperarm_l' /* … */ } })
```

Such a skeleton may:
- have joints of its own between the rig's (Mixamo's shoulder bones and middle spine bone):
  they keep their rest turn relative to the joint above them;
- rest in any pose (a T-pose, an A-pose), with each bone turned its own way (a Mixamo bone
  points along its own +y, with a twist), under an armature node that's turned and scaled
  (Blender's exports sit under one scaled 0.01, the bones in centimetres).

The rig works its poses out on a skeleton of its own: its joints where the model's are, but
standing straight (each arm and leg swung to hang straight down from where it rests, the hand
and foot with it; the body as it rests), unturned, each bone along its -y. Each of the model's
joints then takes the rig joint's turn, times its own turn standing straight, in its parent's
space; the hips are placed where the rig's are. So a model resting in a T-pose moves exactly as
one built to this spec.

Without `gripR` / `gripL`, each fist holds a third of a forearm below the wrist, a little
forward (the spec mannequin's grip), its axes the body's.

## Poses

`poses` in `Models.gltf` (a `HumanoidPoses`) sets how the figure holds things and moves. Every
value is optional; the default is the platform's own (the style Call of Blocky's fighters move in).
Give each model of a game the same object for a game-wide style.

Offsets are metres in the figure's own frame before its scale (x its left, y up, z ahead). A held
item's are from the middle of the shoulders (a centimetre above the shoulder joints), turned with
the aim. Turns are radians `[tip, turn, roll]`: about x (a positive tip points the muzzle down),
then y (a positive turn is to its left), then along the muzzle.

| Value | Default | What it is |
|---|---|---|
| `heldScale` | 0.52 | A gun's or sword's size in the hands (world units per model unit). In first person guns are the platform's size, so a figure's arms are drawn at `0.52 / heldScale`. |
| `rifle.hip`, `rifle.ads` | [-0.13, -0.19, 0.27], [-0.05, -0.05, 0.24] | A shouldered gun: from the hip, and aiming down the sights. |
| `pistol.hip`, `pistol.ads` | [-0.03, -0.15, 0.4], [0, -0.04, 0.4] | A pistol held out in both hands. |
| `rifle.twist`, `pistol.twist` | -0.18 | The body's twist to the gun (four tenths at the spine, the rest at the chest). |
| `rifle.cheek`, `pistol.cheek` | 0.12 | The head's tilt to the sights, aiming down them. |
| `rifle.offHand`, `pistol.offHand` | offset [0.21, -0.56, 0.04], turn [0, 0, 0] | A gun held in one hand (`hold.gun.hands: 1`): where the free hand's fist is, from the middle of the shoulders in the chest's frame (it goes with the body's lean and twist); hanging loose at the side. A reload brings it to the gun. |
| `pistolUnder` | 0.45 | A gun is held as a pistol if it's shorter than this (metres, as held), unless its item says (`hold: { stance: 'rifle' \| 'pistol' }`). |
| `kick.back`, `kick.tip`, `kick.decay` | 0.05, 0.14, 22 | Each shot: the gun back and tipped up, dying away at `decay` a second. |
| `sprint.offset`, `sprint.turn` | [-0.02, -0.32, 0.18], [0.6, 0.75, 0.1] | Sprinting: low across the chest, the muzzle down and to the left (the turn from the body's). |
| `reload.offset`, `reload.turn` | [-0.04, -0.2, 0.28], [0.3, 0.35, -0.6] | Reloading: tipped over to show the magazine. |
| `reload.cycle`, `reload.belt` | 1.1, [0.12, -0.02, 0.12] | The support hand to the magazine, to the belt (the hips' space) and back, every `cycle` seconds. |
| `lever.offset`, `lever.turn`, `lever.time` | [0, -0.035, 0.01], [-0.2, 0, 0], 0.45 | A gun's `lever` worked after each shot: the gun dips and its muzzle rocks up, in and out over `time` seconds, a beat (0.08 s) after the shot. |
| `hammer.offset`, `hammer.turn`, `hammer.time` | [0, 0.01, 0], [-0.12, 0, 0.3], 0.26 | A `hammer` cocked: tipped up and canted. |
| `sword.offset`, `sword.turn` | [-0.06, -0.3, 0.3], [-0.95, 0.15, 0] | A sword in both hands: low, the blade up and forward. |
| `sword.swing.time`, `.windup` | 0.4, 0.3 | A swing's seconds, and the part of it spent lifting the blade. |
| `sword.swing.raise`, `.chop` | offset [0.04, 0.35, -0.1], turn [-1.1, 0, 0]; offset [0, -0.1, 0.2], turn [1.9, 0, 0.5] | Where the swing lifts it to and chops through (added to the stance). |
| `death.time`, `death.backward` | 0.65, 0.65 | Seconds to fall, and how often the fall is backward. |
| `gait.run` | [3.5, 7.5] | The speeds (blocks a second) over which walking becomes running; the pairs below are `[walking, running]`. |
| `gait.stride` | [1.15, 2.4] | Ground covered in a stride (metres). |
| `gait.step`, `gait.lift` | [0.22, 0.52], [0.1, 0.22] | How far each foot reaches ahead and behind, and how high it lifts. |
| `gait.bob`, `gait.lean` | [0.02, 0.055], [0.04, 0.18] | The hips' bob, and the back's lean (radians). |
| `gait.armSwing` | [0.45, 0.95] | Empty arms swinging (radians). |
| `gait.sway`, `gait.width`, `gait.crouch` | 0.018, 0.1, 0.33 | The hips' sway walking, each foot's distance from the middle, the hips' drop to crouch. |

### Per item

An item's `hold.poses` goes over the figure's poses while it's held: the same keys as `HumanoidPoses`, the ones about holding (`rifle`, `pistol`, `kick`, `sprint`, `reload`, `lever`, `hammer`, `sword`), each part by part. So each gun can reload its own way, and at its own pace:

```ts
hold: { stance: 'pistol', gun: { hands: 1 }, poses: { reload: { turn: [-0.75, 0.35, 0.9], cycle: 0.42 }, pistol: { offHand: { offset: [0.2, -0.48, 0.1] } } } }
```

## Clips

A game plays one of the model's own animation clips over the rig's animation, on every screen:

```ts
player.animate('wave', { layer: 'upper', loop: true });   // an emote while they walk
player.animate('reload_pistol', { layer: ['upperArmR', 'upperArmL'], speed: 1.2 });
entity.animate('victory', { loop: true, fade: 0.4 });    // the whole body
player.animate(null);                                      // fade it out (an entity: 'none')
```

- `layer`: `full` (default: everything the clip moves), `upper` (the spine and all on it: the
  hips and legs keep the gait), or a list of joints (the rig's names or the model's own), each
  with all that hangs from it.
- `loop` (default once), `fade` (seconds in, and out at the end or when stopped; 0.2), `speed`.
- The clip's nodes are set part way from the rig's pose to the clip's, by its weight as it fades,
  in each node's own space; asking for another fades the last out as the new one fades in.
- What's held goes with the right hand wherever the clip takes it (a custom reload, a gun
  raised in a wave).
- The request travels in the player's (or entity's) frame with the time it began, so a screen
  that joins in the middle starts the clip part way through, and a clip played once that's over
  isn't played at all.
- Clips are bound by node name, so a clip is made for its model's skeleton (Mixamo's clips for a
  Mixamo character). `scripts/mannequin.mjs` makes its clips in the rig's terms and turns them
  into each skeleton's own.
- Figures that aren't on the rig (`clips: { idle, walk, … }`) play clips the same way, over their
  idle and walk.

### Authoring clips for a rigid rig

A figure built to this spec rests with every joint unturned (identity rotation, the arms hanging),
so a clip's rotation for a joint is simply that joint's turn from standing straight, in its
parent's space: the key sets the node's whole rotation (it isn't added to the rig's pose). Write
turns as the poses do, `[tip, turn, roll]` in radians, and make each key's quaternion in the
rig's order, YXZ: the turn about y, then the tip about x, then the roll about z
(`q = qY(turn) · qX(tip) · qZ(roll)`; three.js: `new Quaternion().setFromEuler(new Euler(tip,
turn, roll, 'YXZ'))`). On this rig:

- a negative tip on `upperArmR`/`upperArmL` raises the arm forward (-1.6 level, about -2.9
  straight up); a negative tip on `lowerArm` bends the elbow, bringing the forearm up;
- a roll on an upper arm lifts it out to the side: negative for the right arm, positive for the
  left (-2.9 on `upperArmR` is the right arm straight up past the head);
- a positive tip on `head` nods it down, a negative tip on `spine` or `chest` leans back;
- `hips` can also have a position track (metres, its rest translation plus a rise or a dip);
  joints the clip leaves out keep the rig's own pose.

High Noon's `src/games/highnoon/tools/build.mjs` writes its `tip_hat`, `victory` and `standoff`
clips this way (`CLIPS`: keys of turns per joint). A skeleton resting another way (Mixamo's) needs
clips in its own bones' rotations; `scripts/mannequin.mjs` turns rig-terms clips into those.

## First-person arms

A player whose model is a humanoid sees its own arms in first person: its upper arms, forearms
and fists, each as the rig has it standing straight (the arm hanging, the bone along -y), placed
by the view model on the gun. Rigid parts go with the joint they hang from. A skinned model's
arms are cut from the skin into rigid pieces where it rests: each triangle goes with the bone
that weighs most on its corners (a finger bone's with the hand). The pieces meet where the
skin bends, so a wrist bent hard can show a seam; in first person the view model keeps the
wrists fairly straight.

Each arm runs from the fist back to a shoulder off the screen's edge: straight by default, or,
with `firstPerson.bend` (or a gun's `hold.gun.arm.bend`), bent at the elbow, the two bones reaching
a shoulder that stays put in the view as the hand kicks and reloads. Their size is the model's
(`firstPerson.scale`), not the gun's.
