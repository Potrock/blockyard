import { HeldModels, type GameContext, type GunItem } from '@platform';
import revolverUrl from './models/revolver.glb?url';
import rifleUrl from './models/rifle.glb?url';

/**
 * Two guns, and both are slow: every shot counts.
 *
 * - The Peacemaker: six rounds, one pull a shot (no holding the trigger down), loaded a round at
 *   a time, the hammer thumbed back after each. Held in one hand (`hands: 1`): in first person the
 *   free hand comes up only to push rounds into the gate, and a figure's free hand hovers by its
 *   belt (the game's `pistol.offHand`). Heads take double.
 * - The Yellowboy: a lever-action, seven in the tube, loaded a round at a time, harder hitting and
 *   steadier aimed, slower to work.
 *
 * Each gun has its own reload on a figure (`hold.poses`): the Peacemaker tipped up to show its
 * gate, a round each 0.42 s; the Yellowboy rolled to show the gate in its side, each 0.55 s.
 *
 * No auto-reload in Dry Gulch (`guns.autoReload: false` in the game): an empty gun clicks until
 * you press R.
 */

export const REVOLVER: GunItem = {
  kind: 'gun',
  name: 'Peacemaker',
  icon: { gltf: revolverUrl },
  hold: {
    style: 'gun',
    stance: 'pistol',
    model: HeldModels.gltf(revolverUrl),
    scale: 1.2,
    gun: {
      hands: 1,
      // Out at the right, level, a little in toward the middle: a gunslinger's hip shot.
      fist: [0.2, -0.21, -0.5],
      barrel: [-0.05, 0.03, -1],
      roll: 0,
      ads: 0.46,
      // Sprinting: the gun held low by the thigh, muzzle down.
      sprint: { yaw: 0.15, pitch: -1.05, roll: 0.1, move: [0.04, -0.12, 0.1] },
      slide: { roll: 0.25, move: [0, -0.03, 0.02] },
      // One arm out from the right shoulder, bent at the elbow: the forearm drops away under the
      // gun to the screen's lower right, the elbow and upper arm below the screen.
      forearm: { hip: [0.3, -0.62, 0.72], ads: [0.22, -0.5, 0.84] },
      arm: { bend: 0.7, reach: [0.5, 0.62] },
      kick: 0.05,
      rise: 13,
    },
    poses: { reload: { offset: [-0.06, -0.16, 0.32], turn: [-0.75, 0.35, 0.9], cycle: 0.42 } },
  },
  rpm: 170,
  damage: [45, 30],
  falloff: [14, 40],
  headshot: 2,
  magazine: 6,
  reserve: 30,
  reload: 0.42,
  shells: true,
  range: 120,
  spread: { hip: 1.4, aim: 0.15, move: 1.6, air: 3.5, bloom: 0.9 },
  recoil: { up: 2.6, side: 0.6, recover: 0.8 },
  aim: { zoom: 1.25, time: 0.16, move: 0.8, sight: 'iron' },
  action: 'hammer',
  mobility: 1.05,
  tracer: '#ffe2a0',
  sounds: { use: 'shot_revolver', reload: 'load_round', empty: 'dry_fire' },
};

export const RIFLE: GunItem = {
  kind: 'gun',
  name: 'Yellowboy',
  icon: { gltf: rifleUrl },
  hold: {
    style: 'gun',
    stance: 'rifle',
    model: HeldModels.gltf(rifleUrl),
    gun: {
      fist: [0.22, -0.24, -0.5],
      barrel: [-0.08, 0.04, -1],
      roll: -0.12,
      ads: 0.62,
      kick: 0.09,
      rise: 9,
      // Aimed, both forearms drop away under the gun, bent at the elbows (straight, they'd run back
      // at the eye and fill the bottom of the screen).
      forearm: { ads: [0.3, -0.8, 0.5] },
      forearm2: { ads: [-0.35, -0.85, 0.4] },
      arm: { bend: [0.5, 0.7], scale: 0.85 },
    },
    poses: { reload: { offset: [-0.04, -0.18, 0.3], turn: [0.25, 0.3, 0.75], cycle: 0.55 } },
  },
  rpm: 70,
  damage: [62, 48],
  falloff: [30, 80],
  headshot: 1.75,
  magazine: 7,
  reserve: 21,
  reload: 0.55,
  shells: true,
  range: 200,
  spread: { hip: 2.4, aim: 0.05, move: 1.8, air: 4, bloom: 0 },
  recoil: { up: 3.6, side: 0.5, recover: 0.7 },
  aim: { zoom: 1.6, time: 0.26, move: 0.6, sight: 'iron' },
  action: 'lever',
  mobility: 0.92,
  tracer: '#fff1c4',
  sounds: { use: 'shot_rifle', reload: 'load_round', empty: 'dry_fire', cycle: 'lever' },
};

export const WEAPONS: Record<string, GunItem> = { revolver: REVOLVER, rifle: RIFLE };

export function defineWeapons(game: GameContext) {
  for (const [id, def] of Object.entries(WEAPONS)) game.items.define(id, def);
}

/** A gun's picture, side on, for the kill feed. */
export const feedIcon = (id: string) => (id === 'revolver' ? { gltf: revolverUrl, view: 'side' as const } : id === 'rifle' ? { gltf: rifleUrl, view: 'side' as const } : null);
