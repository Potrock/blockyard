import { HeldModels, type ItemLook } from '@platform';
import type { Client } from '@platform/client';
import { AXE_MODEL, PIKE_MODEL, Sprite } from '../art';

/**
 * How the Arena's weapons and pickups look on each screen (`client.items.look`): their icons (the
 * platform's sprites, or the game's own from its atlas), the swords', the pike's, the axe's and the
 * potion's models, and the bow's drawn sprite. The server's `content.ts` has only what they do.
 * (The atlas the sprites and the pike's and axe's textures are in is the server's content: it
 * paints the monsters' skins there too.)
 */
export const LOOKS: Record<string, ItemLook> = {
  wooden_sword: { icon: 'wooden_sword', hold: { model: HeldModels.woodenSword } },
  stone_sword: { icon: 'stone_sword', hold: { model: HeldModels.stoneSword } },
  iron_sword: { icon: 'iron_sword', hold: { model: HeldModels.ironSword } },
  // Two-handed.
  pike: { icon: Sprite.pike, hold: { style: 'polearm', model: PIKE_MODEL } },
  battle_axe: { icon: Sprite.battle_axe, hold: { style: 'axe', model: AXE_MODEL } },
  diamond_sword: { icon: 'diamond_sword', hold: { model: HeldModels.diamondSword } },
  bow: { icon: 'bow', drawIcon: 'bow_pulling' },
  arrow: { icon: 'arrow' },
  health_potion: { icon: 'health_potion', hold: { model: HeldModels.healthPotion } },
  heart: { icon: 'heart' },
  arrow_bundle: { icon: Sprite.arrow_bundle },
};

/** Each item's look on this screen (in `setup`, before anything's shown). */
export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
}
