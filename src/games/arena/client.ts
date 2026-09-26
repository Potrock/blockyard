import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { defineLooks } from './client/looks';
import { defineSounds } from './client/sounds';
import { shared } from './shared';

/**
 * The Arena on each player's screen: the platform's kits it uses, in the order they run (the
 * standard voices, the first-person view, the fighters' and monsters' figures), then its own look:
 * each weapon's icon and model (`client/looks.ts`), and the creatures' voices (`client/sounds.ts`).
 */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
