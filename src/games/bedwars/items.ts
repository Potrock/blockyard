import { HeldModels, type GameContext } from '@platform';
import { Sprite } from './art';
import type { Fireballs } from './fireballs';
import { CURRENCIES, CURRENCY_NAME, SWORD, type Match } from './state';

const CURRENCY_ICON = { iron: Sprite.iron_ingot, gold: Sprite.gold_ingot, diamond: Sprite.diamond, emerald: Sprite.emerald };
const CURRENCY_PITCH = { iron: 1, gold: 1.15, diamond: 1.3, emerald: 1.45 };

/** Everything the player can carry. Currency never takes a slot: it goes straight to the wallet. */
export function defineItems(game: GameContext, m: Match, fireballs: Fireballs) {
  const it = game.items;
  for (const c of CURRENCIES) {
    it.define(c, {
      kind: 'misc',
      name: CURRENCY_NAME[c][0],
      icon: CURRENCY_ICON[c],
      onPickup(g, n) {
        m.player.wallet[c] += n;
        g.audio.play('pickup', { volume: 0.45, pitch: CURRENCY_PITCH[c] });
        return true;
      },
    });
  }
  defineSwords(game, false);
  it.define('wooden_pickaxe', { kind: 'melee', name: 'Wooden Pickaxe', icon: Sprite.wooden_pickaxe, damage: 2, cooldown: 0.7, rank: 0 });
  it.define('iron_pickaxe', { kind: 'melee', name: 'Iron Pickaxe', icon: Sprite.iron_pickaxe, damage: 3, cooldown: 0.7, rank: 0 });
  it.define('diamond_pickaxe', { kind: 'melee', name: 'Diamond Pickaxe', icon: Sprite.diamond_pickaxe, damage: 4, cooldown: 0.7, rank: 0 });
  it.define('shears', { kind: 'misc', name: 'Shears', icon: Sprite.shears, stack: 1 });
  it.define('bow', { kind: 'bow', name: 'Bow', icon: 'bow', drawIcon: 'bow_pulling', ammo: 'arrow', damage: [1.5, 7], drawTime: 1, speed: 44, rank: 0 });
  it.define('arrow', { kind: 'misc', name: 'Arrow', icon: 'arrow', stack: 64 });
  // Blocks: items that look like a block, which the building kit places.
  it.define('wool', { kind: 'misc', name: 'Wool', icon: { block: m.player.wool } });
  it.define('planks', { kind: 'misc', name: 'Oak Planks', icon: { block: 'oak_planks' } });
  it.define('end_stone', { kind: 'misc', name: 'End Stone', icon: { block: 'end_stone' } });
  it.define('obsidian', { kind: 'misc', name: 'Obsidian', icon: { block: 'obsidian' } });
  it.define('golden_apple', {
    kind: 'consumable',
    name: 'Golden Apple',
    icon: Sprite.golden_apple,
    stack: 16,
    use(g) {
      if (g.player.health >= g.player.maxHealth) return false;
      g.player.heal(8);
      g.audio.play('eat');
      g.fx.burst(g.player.eye, { color: '#ffd84a', count: 14, speed: 2, gravity: -3, glow: 1 });
      return true;
    },
  });
  it.define('fire_charge', {
    kind: 'consumable',
    name: 'Fireball',
    icon: Sprite.fire_charge,
    stack: 16,
    use(g) {
      const e = g.player.eye;
      const d = g.player.look;
      fireballs.launch({ x: e.x + d.x * 0.9, y: e.y + d.y * 0.9, z: e.z + d.z * 0.9 }, d, m.player, 'player');
      g.player.viewModel.play('swing');
      return true;
    },
  });
}

/** Swords (re-defined when the team buys Sharpened Swords). */
export function defineSwords(game: GameContext, sharp: boolean) {
  const k = sharp ? 1 : 0;
  const it = game.items;
  it.define('wooden_sword', { kind: 'melee', name: 'Wooden Sword', icon: 'wooden_sword', damage: SWORD[0] + k, cooldown: 0.5, reach: 3.2, rank: 1, hold: { model: HeldModels.woodenSword } });
  it.define('stone_sword', { kind: 'melee', name: 'Stone Sword', icon: 'stone_sword', damage: SWORD[1] + k, cooldown: 0.5, reach: 3.2, rank: 2, hold: { model: HeldModels.stoneSword } });
  it.define('iron_sword', { kind: 'melee', name: 'Iron Sword', icon: 'iron_sword', damage: SWORD[2] + k, cooldown: 0.5, reach: 3.3, rank: 3, hold: { model: HeldModels.ironSword } });
  it.define('diamond_sword', { kind: 'melee', name: 'Diamond Sword', icon: 'diamond_sword', damage: SWORD[3] + k, cooldown: 0.5, reach: 3.3, rank: 4, hold: { model: HeldModels.diamondSword } });
}
