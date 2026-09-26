import { HeldModels, type GunHold, type ItemLook } from '@platform';
import type { Client } from '@platform/client';
import { GUNS } from '../models';
import { FIGHTERS } from '../models/fighters';

/**
 * How Call of Blocky's weapons look and sound on each screen (`client.items.look`): their models
 * and icons, how each is held (where the guns sit in first person), the guns' tracers, the
 * molotov's trail, and which of the game's voices (`./sounds`) each plays. The server's
 * `weapons.ts` has only what they do; it names them (`{ item }` icons in the kill feed and the
 * loadout menu) and each screen shows them as it has them here.
 */

const url = (id: string) => GUNS.find((g) => g.id === id)?.url ?? '';

/**
 * How the guns sit in first person, as modern shooters frame them: close and low at the right,
 * big in the view, the barrel run in toward the crosshair; the forearms dropping away under the
 * gun so they leave the screen soon. Compact guns (the pistol, the SMG) nearer the middle.
 */
const FP: GunHold = {
  fist: [0.22, -0.31, -0.44],
  barrel: [-0.3, 0.04, -1],
  roll: -0.12,
  forearm: { hip: [0.35, -0.8, 0.45] },
  forearm2: { hip: [-0.35, -0.85, 0.35] },
};
const FP_COMPACT: GunHold = { ...FP, fist: [0.12, -0.27, -0.4] };
/** Aimed, a red dot or holo a little further out than the platform's, so it frames the target rather than filling the view. */
const ADS = 0.4;
const FP_HOLDS: Record<string, GunHold> = { pistol: { ...FP_COMPACT, ads: ADS }, smg: { ...FP_COMPACT, ads: ADS }, rifle: { ...FP, ads: ADS }, shotgun: { ...FP, ads: ADS } };

/** A gun: its model, its icon (the kill feed shows it side on), how it sits in first person, and the rest of its look. */
const gun = (id: string, look: ItemLook): ItemLook => ({
  icon: { gltf: url(id) },
  hold: { style: 'gun', model: HeldModels.gltf(url(id)), gun: FP_HOLDS[id] ?? FP },
  ...look,
});

/**
 * A lethal, thrown with G. Their models stand up along +y; held, they're turned to stand up in
 * the fist (+z) with their fronts (the frag's ring, the bottle's label) toward you.
 */
const lethal = (id: string, grip: [number, number, number], look: ItemLook): ItemLook => ({
  icon: { gltf: url(id) },
  hold: { style: 'throw', model: HeldModels.gltf(url(id), { rotation: [90, 180, 0], grip }) },
  ...look,
});

export const LOOKS: Record<string, ItemLook> = {
  rifle: gun('rifle', { sounds: { use: 'shot_rifle', reload: 'reload_mag' } }),
  smg: gun('smg', { tracer: '#ff9ec8', sounds: { use: 'shot_smg', reload: 'reload_mag' } }),
  shotgun: gun('shotgun', { tracer: '#ffb36b', sounds: { use: 'shot_shotgun', reload: 'reload_shell', cycle: 'pump' } }),
  sniper: gun('sniper', { tracer: '#fff1a8', sounds: { use: 'shot_sniper', reload: 'reload_mag', cycle: 'bolt' } }),
  pistol: gun('pistol', { sounds: { use: 'shot_pistol', reload: 'reload_pistol' } }),
  katana: {
    icon: { gltf: url('katana') },
    // Rolled onto its side: in the hand the flat of the blade (and its hamon) shows, not the edge.
    hold: { style: 'sword', model: HeldModels.gltf(url('katana'), { rotation: [0, 0, 90] }) },
    sounds: { use: 'katana', hit: 'katana_hit' },
  },
  frag: lethal('frag', [0, 0, -2], { sounds: { draw: 'pin', use: 'toss', hit: 'clink' } }),
  molotov: lethal('molotov', [0, 0, -1.5], { trail: '#ffb347', sounds: { draw: 'lighter', use: 'toss', hit: 'glass' } }),
  // Every so often on the street, glowing: nobody knows what's inside.
  briefcase: { icon: { gltf: url('briefcase') } },
};

/**
 * The outfits, which the server names like items (`outfit_bowler`: in the loadout, on a level-up;
 * see `progression.ts`): each its fighter's picture.
 */
export const OUTFIT_LOOKS: Record<string, ItemLook> = Object.fromEntries(FIGHTERS.map((f) => [`outfit_${f.id}`, { icon: { gltf: f.url } }]));

/** Each weapon's look on this screen, and each outfit's (in `setup`, before anything's shown). */
export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
  for (const [id, look] of Object.entries(OUTFIT_LOOKS)) client.items.look(id, look);
}
