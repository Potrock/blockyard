import { defineServer } from '@platform';
import { shared } from './shared';
import type { Part } from './part';
import { survival } from './survival/rules';
import { building } from './building/rules';
import { creatures } from './creatures/rules';

/**
 * The rules, part by part, in this order every step: survival first (stats, the inventory, the
 * crafting screens: what claims a key or a click), then building (harvesting and placing), then
 * the creatures.
 */
const parts: Part[] = [survival, building, creatures];

export default defineServer(shared, {
  setup(game) {
    for (const p of parts) p.setup?.(game);
  },
  start(game) {
    for (const p of parts) p.start?.(game);
  },
  update(game, dt) {
    for (const p of parts) p.update?.(game, dt);
  },
});
