import { HeldModels, type GameContext } from '@platform';
import { Sprite } from './art';
import type { Fireballs } from './fireballs';
import { CURRENCIES, CURRENCY_NAME, SWORD, TEAM_STYLE, type Match } from './state';

const CURRENCY_ICON = { iron: Sprite.iron_ingot, gold: Sprite.gold_ingot, diamond: Sprite.diamond, emerald: Sprite.emerald };
const CURRENCY_PITCH = { iron: 1, gold: 1.15, diamond: 1.3, emerald: 1.45 };

/** Everything players carry. Currency never takes a slot: it goes straight to their team's wallet. */
export function defineItems(game: GameContext, m: Match, fireballs: Fireballs) {
  const it = game.items;
  for (const c of CURRENCIES) {
    it.define(c, {
      kind: 'misc',
      name: CURRENCY_NAME[c][0],
      icon: CURRENCY_ICON[c],
      onPickup(_g, n, player) {
        const t = m.seatOf(player);
        // Someone watching can't collect it.
        if (!t) return false;
        t.wallet[c] += n;
        player.audio.play('pickup', { volume: 0.45, pitch: CURRENCY_PITCH[c] });
        return true;
      },
    });
  }
  defineSwords(game);
  it.define('wooden_pickaxe', { kind: 'melee', name: 'Wooden Pickaxe', icon: Sprite.wooden_pickaxe, damage: 2, cooldown: 0.7, rank: 0 });
  it.define('iron_pickaxe', { kind: 'melee', name: 'Iron Pickaxe', icon: Sprite.iron_pickaxe, damage: 3, cooldown: 0.7, rank: 0 });
  it.define('diamond_pickaxe', { kind: 'melee', name: 'Diamond Pickaxe', icon: Sprite.diamond_pickaxe, damage: 4, cooldown: 0.7, rank: 0 });
  it.define('shears', { kind: 'misc', name: 'Shears', icon: Sprite.shears, stack: 1 });
  it.define('bow', { kind: 'bow', name: 'Bow', icon: 'bow', drawIcon: 'bow_pulling', ammo: 'arrow', damage: [1.5, 7], drawTime: 1, speed: 44, rank: 0 });
  it.define('arrow', { kind: 'misc', name: 'Arrow', icon: 'arrow', stack: 64 });
  // Blocks: items that look like a block, which the building kit places. Each team has its wool.
  for (const [color, style] of Object.entries(TEAM_STYLE)) it.define(`wool_${color}`, { kind: 'misc', name: 'Wool', icon: { block: style.wool } });
  it.define('planks', { kind: 'misc', name: 'Oak Planks', icon: { block: 'oak_planks' } });
  it.define('end_stone', { kind: 'misc', name: 'End Stone', icon: { block: 'end_stone' } });
  it.define('obsidian', { kind: 'misc', name: 'Obsidian', icon: { block: 'obsidian' } });
  it.define('golden_apple', {
    kind: 'consumable',
    name: 'Golden Apple',
    icon: Sprite.golden_apple,
    stack: 16,
    use(g, player) {
      if (player.health >= player.maxHealth) return false;
      player.heal(8);
      g.audio.play('eat', { at: player.position });
      g.fx.burst(player.eye, { color: '#ffd84a', count: 14, speed: 2, gravity: -3, glow: 1 });
      return true;
    },
  });
  it.define('fire_charge', {
    kind: 'consumable',
    name: 'Fireball',
    icon: Sprite.fire_charge,
    stack: 16,
    use(_g, player) {
      const t = m.seatOf(player);
      if (!t) return false;
      const e = player.eye;
      const d = player.look;
      fireballs.launch({ x: e.x + d.x * 0.9, y: e.y + d.y * 0.9, z: e.z + d.z * 0.9 }, d, t, player);
      player.viewModel.play('swing');
      return true;
    },
  });
}

/** Swords, plain and sharpened (a team with Sharpened Swords gets the `_sharp` kind: +1 damage). */
export function defineSwords(game: GameContext) {
  const it = game.items;
  const kinds = [
    ['wooden_sword', 'Wooden Sword', 3.2, HeldModels.woodenSword],
    ['stone_sword', 'Stone Sword', 3.2, HeldModels.stoneSword],
    ['iron_sword', 'Iron Sword', 3.3, HeldModels.ironSword],
    ['diamond_sword', 'Diamond Sword', 3.3, HeldModels.diamondSword],
  ] as const;
  kinds.forEach(([id, name, reach, model], tier) => {
    it.define(id, { kind: 'melee', name, icon: id, damage: SWORD[tier], cooldown: 0.5, reach, rank: tier + 1, hold: { model } });
    it.define(`${id}_sharp`, { kind: 'melee', name: `Sharpened ${name}`, icon: id, damage: SWORD[tier] + 1, cooldown: 0.5, reach, rank: tier + 1, hold: { model } });
  });
}
