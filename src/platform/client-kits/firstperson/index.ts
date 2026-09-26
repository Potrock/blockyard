import type { ClientKit } from '@platform/client';
import { FirstPersonKit } from './kit';

/**
 * The first-person view as the platform's games have it: what's in hand and the player's own
 * arms, placed in `client.view` each frame. Swords, items, blocks and bows held the way Minecraft
 * holds them; two hands on a polearm; guns at the hip, aimed down the sights, sprinting, sliding,
 * reloading and working their action, with a kick and a muzzle flash; throwables wound up and
 * tossed; a humanoid player's own arms fitted to what they hold. It reads the item's `hold` (its
 * style, grips, a gun's `hold.gun` poses) and the gun's local state (`client.me.held.state`), and
 * reacts to `client.events` (shots, uses, swings, throws, landings, the server's `viewModel`).
 *
 * To change it, copy this folder into the game's own (`src/games/<id>/client/firstperson/`), list
 * the copy in the game's `client.ts` in place of this one, and edit it.
 */
export function standard(): ClientKit[] {
  return [new FirstPersonKit()];
}

export { FirstPersonKit } from './kit';
