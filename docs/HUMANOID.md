# The humanoid rig

A glTF figure built to this rig can be animated by the platform: it walks, runs, strafes,
crouches, slides, jumps, looks, holds guns in both hands, swings, reloads and falls, all worked
out in code from what the player does. No animation clips are needed.

## Frame

- Units: 1 glTF unit = 1 block = 1 metre.
- Origin: on the ground, between the feet.
- The figure faces +z, with +y up. Its own right is -x and its own left is +x.
- It stands about 1.85 tall to the top of the head, with its eyes near 1.64.

## Joints

Nodes are named exactly as below. Each is a child of the one above it, placed by its rest
translation (in its parent's space, in metres) with identity rotation and scale. A figure may
change the numbers a little (a taller build, broader shoulders); the platform reads the joints
from the file.

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
