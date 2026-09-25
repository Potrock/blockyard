import { HeldModels, type GameContext, type GunItem } from '@platform';
import revolverUrl from './models/revolver.glb?url';
import rifleUrl from './models/rifle.glb?url';

/**
 * Two guns, and both are slow: every shot counts.
 *
 * - The Peacemaker: six rounds, one pull a shot (no holding the trigger down), loaded a round at
 *   a time. Held in one hand: its model has no `grip2`, so a figure's left hand stays free, and in
 *   first person the support hand is put out of sight (see `hold`). Heads take double.
 * - The Yellowboy: a lever-action, seven in the tube, loaded a round at a time, harder hitting and
 *   steadier aimed, slower to work.
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
    // First person only (the file has no grip2): the support hand hangs out of view below the gun,
    // and comes up into view to push rounds into the gate on a reload.
    model: HeldModels.gltf(revolverUrl, { grip2: [-6, -26, -10] }),
    scale: 1.2,
    gun: {
      // Out at the right, level, a little in toward the middle: a gunslinger's hip shot.
      fist: [0.2, -0.21, -0.5],
      barrel: [-0.05, 0.03, -1],
      roll: 0,
      ads: 0.46,
      // Sprinting: the gun held low by the thigh, muzzle down.
      sprint: { yaw: 0.15, pitch: -1.05, roll: 0.1, move: [0.04, -0.12, 0.1] },
      slide: { roll: 0.25, move: [0, -0.03, 0.02] },
      // One arm out from the right shoulder: the forearm comes in from the screen's lower right
      // (straight down under the gun, it would hide the sights).
      forearm: { hip: [0.3, -0.62, 0.72], ads: [0.38, -0.72, 0.58] },
      kick: 0.05,
      rise: 13,
    },
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
    gun: { fist: [0.22, -0.24, -0.5], barrel: [-0.08, 0.04, -1], roll: -0.12, ads: 0.55, kick: 0.09, rise: 9 },
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
  // There's no lever action to pick, so it works like a bolt (the gun rolls to work it).
  action: 'bolt',
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
