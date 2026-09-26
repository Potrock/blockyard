import type { ConsumableItem, ItemKind, ItemKit } from '@platform';

/**
 * Consumables (`kind: 'consumable'`): the right mouse button uses the one in hand (its `use`, the
 * game's code); if that says so, one is used up. The fire button still swings (a bare fist's kit).
 * Played on the host.
 */
export function consumables(): ItemKit<ItemKind<ConsumableItem>> {
  return () => ({
    kind: 'consumable',
    step(use) {
      const held = use.held;
      if (!held || !use.controls.buttonPressed(2)) return;
      const me = use.player;
      if (held.def.use(use.game, me)) {
        me.inventory.take(held.item, 1);
        use.swing('use');
        // Its own sound, as their screen has it (none by default).
        me.audio.play(held.def.sounds?.use ?? '', { item: { id: held.item, sound: 'use' } });
      }
    },
  });
}
