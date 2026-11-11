import type { ItemKit } from '@platform';
import { bows, consumables, melee } from '@platform/kits';

/**
 * The kinds of item the game uses, in the order they run each step, for `server.ts`'s `items`:
 * eating first (a held right-click is a meal, not a draw), then bows, then melee, which is also
 * the bare fist. Every part's items take one of these kinds (`'consumable'`, `'bow'`, `'melee'`),
 * or `'misc'` for something that is only carried.
 */
export const itemKits: ItemKit[] = [consumables(), bows(), melee()];
