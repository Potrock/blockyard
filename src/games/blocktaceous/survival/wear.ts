import type { Player } from '@platform';
import { recipes, type BookRecipe } from './craft';
import { nameOf } from './data';
import { countItems, removeItems } from './pack';
import { touch, type Survivor } from './state';

/**
 * Tools and weapons wear out. The platform's stacks carry no state of their own, so wear is kept
 * for each *kind* of thing a survivor carries: the uses spent of the stone pick in hand, say. When
 * they run out one of that kind breaks (a spare, if there is one, starts fresh), and before that
 * it can be mended in the journal for a share of what it's made from.
 */

/** Uses in each tool and weapon: a harvest, a blow landed, an arrow that hits, a spear thrown (three). */
export const USES: Record<string, number> = {
  stone_pick: 150,
  stone_hatchet: 150,
  stone_sickle: 200,
  metal_pick: 600,
  metal_hatchet: 600,
  metal_sickle: 700,
  club: 100,
  wooden_club: 70,
  spear: 90,
  metal_spear: 300,
  slingshot: 120,
  bow: 200,
  longbow: 500,
};

/** How much of its life a kind of thing has left, 0..1 (1 for what never wears). */
export function condition(s: Survivor, item: string): number {
  const uses = USES[item];
  return uses ? Math.max(0, 1 - (s.wear[item] ?? 0) / uses) : 1;
}

/**
 * Spend uses of the thing in a survivor's hands. False if that broke it: one is gone from what
 * they carry, and the next of its kind is new.
 */
export function wearDown(player: Player, s: Survivor, item: string, uses = 1): boolean {
  const life = USES[item];
  if (!life || countItems(player, item) === 0) return true;
  const before = s.wear[item] ?? 0;
  const after = before + uses;
  s.dirty = true;
  if (after >= life) {
    delete s.wear[item];
    removeItems(player, item, 1);
    player.audio.play('bt_break');
    player.hud.toast(`Your ${nameOf(item)} broke`);
    touch(s);
    return false;
  }
  s.wear[item] = after;
  // One warning, as it crosses its last fifth.
  if (before < life * 0.8 && after >= life * 0.8) player.hud.toast(`Your ${nameOf(item)} is nearly worn out · mend it in the journal (Tab)`);
  if (s.ui.open) s.ui.stale = true;
  return true;
}

/** The recipe a thing is mended by: the one that makes it. */
function recipeFor(item: string): BookRecipe | undefined {
  return recipes().find((r) => r.item === item);
}

/** What mending a worn thing takes: half of what it's made from, by how worn it is (never nothing). */
export function repairCost(s: Survivor, item: string): [string, number][] {
  const worn = 1 - condition(s, item);
  const r = recipeFor(item);
  if (!r || worn <= 0) return [];
  const cost = r.needs.map(([need, n]) => [need, Math.round(n * 0.5 * worn)] as [string, number]).filter(([, n]) => n > 0);
  return cost.length > 0 ? cost : [[r.needs[0][0], 1]];
}

/** Mend the kind of thing a survivor carries, if it's worn and they have what it takes. */
export function repair(player: Player, s: Survivor, item: string): boolean {
  const cost = repairCost(s, item);
  if (cost.length === 0 || countItems(player, item) === 0) return false;
  if (!cost.every(([need, n]) => countItems(player, need) >= n)) return false;
  for (const [need, n] of cost) removeItems(player, need, n);
  delete s.wear[item];
  player.audio.play('bt_craft');
  touch(s);
  return true;
}
