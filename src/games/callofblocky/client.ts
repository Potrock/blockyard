import { defineClient } from '@platform/client';
import { effects, figures, firstPerson, hud, sounds } from '@platform/client/kits';
import { killcam } from './client/killcam';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { shared } from './shared';

/**
 * Call of Blocky on each player's screen: the platform's kits it uses, in the order they run (the
 * standard voices, the first-person view, the fighters' figures, the gun's and the lethals' HUD,
 * gunfire and the lethals in the world, and its kill cam on screen: `client/killcam.ts`), then its
 * own look: each weapon's model, icon, hold, tracer and trail (`client/looks.ts`), and its voices
 * (`client/sounds.ts`).
 */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), hud.gunner(), hud.throwables(), effects.gunfire(), effects.throwables(), killcam()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
