import type { GameContext, Player } from '@platform';
import { ITEMS, type ItemId } from '../items';
import { take } from '../survival/bag';
import { hasIcon, iconOf, type SpriteId } from './art';
import { clubHit } from './body';

/**
 * The taming gear and the saddles, as items. The gear works from the hand, on a left click: a
 * club's blow hurts little and dazes a lot, a bola flies out to tangle a small animal's legs, a
 * blowpipe sends a sleep dart. (The bola's and the dart's hits arrive as damage with their
 * `weapon`: the rules' `damage` listener turns them into a pin and a daze.)
 */
export const GEAR: ItemId[] = ['wooden_club', 'bola', 'blowpipe', 'sleep_dart', 'saddle_small', 'saddle_medium', 'saddle_large', 'saddle_giant'];
/** What a carcass yields: defined here only if no other part has defined them by the time the creatures set up. */
const YIELDS: ItemId[] = ['raw_meat', 'prime_meat', 'raw_fish', 'hide', 'keratin', 'feather', 'egg'];

const CLUB = { damage: 2.5, reach: 3.4, every: 0.75 };
const BOLA = { speed: 24, gravity: 14, every: 1.2 };
const DART = { speed: 46, gravity: 5, every: 0.9 };

/** When each player may next use their gear (seconds on the game's clock). */
const ready = new Map<string, number>();

export function defineGear(game: GameContext) {
  for (const id of GEAR) game.items.define(id, { kind: 'misc', name: ITEMS[id].name, icon: iconOf(id as SpriteId), stack: ITEMS[id].stack, ...(id === 'wooden_club' ? { hold: { style: 'axe' as const } } : {}) });
  for (const id of YIELDS) {
    if (game.items.get(id) || !hasIcon(id)) continue;
    game.items.define(id, { kind: 'misc', name: ITEMS[id].name, icon: iconOf(id), stack: ITEMS[id].stack });
  }
}

export function resetGear() {
  ready.clear();
}

/** Every step: a left click with a club, a bola or a blowpipe in hand. */
export function useGear(game: GameContext, player: Player) {
  const held = player.inventory.held?.item;
  if (held !== 'wooden_club' && held !== 'bola' && held !== 'blowpipe') return;
  if (!player.input.button(0)) return;
  // The click is the gear's, whatever else might have wanted it.
  player.input.consume(0);
  const now = game.clock.now;
  if (now < (ready.get(player.id) ?? 0)) return;
  const eye = player.eye;
  if (held === 'wooden_club') {
    ready.set(player.id, now + CLUB.every);
    player.viewModel.play('swing');
    game.audio.play('swing', { at: eye });
    const b = clubHit(game, player, CLUB.reach, CLUB.damage);
    if (b) game.audio.play('bt_thud', { at: b.e.position, pitch: 1.3 });
    return;
  }
  const from = { x: eye.x + player.look.x * 0.5, y: eye.y - 0.15 + player.look.y * 0.5, z: eye.z + player.look.z * 0.5 };
  if (held === 'bola') {
    if (!take(player, 'bola', 1)) return;
    ready.set(player.id, now + BOLA.every);
    player.viewModel.play('swing');
    game.audio.play('whoosh', { at: eye, pitch: 1.3, volume: 0.6 });
    game.entities.projectile({ sprite: iconOf('bola'), speed: BOLA.speed, gravity: BOLA.gravity, damage: 1, knockback: 0, weapon: 'bola' }, from, player.look, player);
    return;
  }
  if (!take(player, 'sleep_dart', 1)) {
    ready.set(player.id, now + 0.5);
    return player.hud.toast('No sleep darts');
  }
  ready.set(player.id, now + DART.every);
  player.viewModel.kick(0.4);
  game.audio.play('bt_puff', { at: eye });
  game.entities.projectile({ sprite: iconOf('sleep_dart'), speed: DART.speed, gravity: DART.gravity, damage: 1, knockback: 0, sticky: true, weapon: 'sleep_dart' }, from, player.look, player);
}
