import type { GameContext, ItemBase, Player } from '@platform';

/** The consumable kit's part both sides read. */

export interface ConsumableItem extends ItemBase {
  kind: 'consumable';
  /** Right-click to use. Return true to consume one. */
  use(game: GameContext, player: Player): boolean;
}

export const isConsumable = (d: { kind: string } | undefined): d is ConsumableItem => d?.kind === 'consumable';
