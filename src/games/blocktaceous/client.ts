import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './shared';
import * as island from './client/island';
import * as creatures from './client/creatures';
import * as survival from './client/survival';
import * as building from './client/building';

const parts = [island, survival, building, creatures];

/** Each player's screen: the platform's standard kits, then each part's own. */
export default defineClient(shared, {
  kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid(), ...parts.flatMap((p) => p.kits)],
  setup(client) {
    for (const p of parts) p.setup(client);
  },
  frame(client, dt) {
    for (const p of parts) p.frame(client, dt);
  },
});
