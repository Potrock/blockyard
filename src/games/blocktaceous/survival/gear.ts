import type { GameContext, ItemDefinition, Player } from '@platform';
import type { BowItem, ConsumableItem, MeleeItem } from '@platform/items';
import { ITEMS } from '../items';
import { entryOf, MEALS } from './data';
import { DRAWN_BOW } from './art';
import { ICON_ATLAS, iconSprite } from './icons';
import { addItems, spill } from './pack';
import { canEat, eat } from './vitals';

/**
 * What the survivor's items do: tools and weapons swing (the melee kit), bows and the slingshot
 * shoot (the bow kit), food and drink are held to the mouth (the consumable kit). Every item of
 * the game's vocabulary gets its sprite here too, and goes into the pack when it's picked up.
 */

type Swing = Pick<MeleeItem, 'damage' | 'cooldown' | 'reach' | 'knockback' | 'sweep' | 'rank'>;

/** Tools are poor weapons; weapons are what the name says. */
const MELEE: Record<string, Swing> = {
  stone_pick: { damage: 3, cooldown: 0.5, rank: 1 },
  metal_pick: { damage: 5, cooldown: 0.45, rank: 3 },
  stone_hatchet: { damage: 4, cooldown: 0.5, rank: 2 },
  metal_hatchet: { damage: 6.5, cooldown: 0.45, rank: 4 },
  stone_sickle: { damage: 2.5, cooldown: 0.4, rank: 1 },
  metal_sickle: { damage: 4, cooldown: 0.35, rank: 2 },
  club: { damage: 5, cooldown: 0.7, knockback: 1.5, rank: 3 },
  spear: { damage: 6.5, cooldown: 0.62, reach: 4.6, knockback: 0.8, rank: 5 },
  metal_spear: { damage: 11, cooldown: 0.58, reach: 4.9, knockback: 0.9, rank: 7 },
};

type Shot = Pick<BowItem, 'ammo' | 'damage' | 'drawTime' | 'speed' | 'rank'>;

const BOWS: Record<string, Shot> = {
  slingshot: { ammo: 'stone', damage: [2, 5.5], drawTime: 0.45, speed: 30, rank: 1 },
  bow: { ammo: 'stone_arrow', damage: [3, 11], drawTime: 0.9, speed: 42, rank: 2 },
  longbow: { ammo: 'metal_arrow', damage: [5, 19], drawTime: 1.15, speed: 54, rank: 3 },
};

/** Everything picked up off the ground goes through the pack: onto the belt or into the backpack, whichever has room. */
function onPickup(item: string) {
  return (_game: GameContext, count: number, player: Player): boolean => {
    const kept = addItems(player, item, count, false);
    // No room at all: it stays on the ground (the platform's own try finds the belt just as full).
    if (kept === 0) return false;
    if (kept < count) spill(player, item, count - kept);
    player.audio.play('pickup');
    return true;
  };
}

function definition(id: string): ItemDefinition {
  const entry = entryOf(id)!;
  const base = { name: entry.name, stack: entry.stack, icon: iconSprite(id), onPickup: onPickup(id) };
  const swing = MELEE[id];
  if (swing) {
    const tool: MeleeItem = { ...base, kind: 'melee', ...swing };
    return tool;
  }
  const shot = BOWS[id];
  if (shot) {
    const bow: BowItem = { ...base, kind: 'bow', ...shot, ...(id === 'slingshot' ? {} : { drawIcon: { atlas: ICON_ATLAS, ...DRAWN_BOW } }) };
    return bow;
  }
  const meal = MEALS[id];
  if (meal) {
    const food: ConsumableItem = {
      ...base,
      kind: 'consumable',
      useTime: meal.time,
      sounds: { use: 'bt_chew' },
      canUse: (_game, player) => canEat(player, meal),
      use: (_game, player) => eat(player, id, meal),
    };
    return food;
  }
  return { ...base, kind: 'misc' };
}

/** The survivor's own items, and the island's resources (in `setup`): what each does, and its sprite. */
export function defineGear(game: GameContext, ids: readonly string[]): void {
  for (const id of ids) game.items.define(id, definition(id));
}

/**
 * Once every part has set up (at `start`): anything in the vocabulary nobody defined is something
 * to carry; every item shows the sprite painted for it (unless it's pictured as a block or a
 * model); everything goes into the pack when picked up; and food is food whoever defined it.
 */
export function completeItems(game: GameContext): void {
  for (const id of Object.keys(ITEMS)) {
    const def = game.items.get(id);
    if (!def || (MEALS[id] && def.kind !== 'consumable')) {
      game.items.define(id, definition(id));
      continue;
    }
    // A block's or a model's picture stays (a structure piece looks like the block it places); any
    // other item shows the sprite painted for it here, so the hotbar and the journal agree.
    const pictured = typeof def.icon === 'object' && ('block' in def.icon || 'gltf' in def.icon);
    game.items.define(id, { ...def, icon: pictured ? def.icon : iconSprite(id), onPickup: def.onPickup ?? onPickup(id) });
  }
}
