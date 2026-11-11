import type { Player } from '@platform';
import { levelForXp, MAX_LEVEL, sparksAt, xpForLevel } from './data';
import { weigh } from './pack';
import { survivorOf, touch } from './state';

/** Experience and levels: everything a survivor does earns a little, and each level brings sparks to learn recipes with. */

/** Experience for something done. A level gained says so, and brings its sparks. */
export function gainXp(player: Player, amount: number): void {
  if (!(amount > 0) || player.bot) return;
  const s = survivorOf(player);
  if (s.level >= MAX_LEVEL) return;
  s.xp = Math.min(xpForLevel(MAX_LEVEL), s.xp + amount);
  const level = levelForXp(s.xp);
  if (level > s.level) {
    const sparks = sparksAt(level) - sparksAt(s.level);
    s.level = level;
    player.hud.banner(`LEVEL ${level}`, `+${sparks} sparks: learn something new (Tab)`, { duration: 3, color: '#9bd45a' });
    player.audio.play('bt_levelup');
    // A stronger back with every level.
    weigh(player, s);
  }
  touch(s);
}

export function levelOfPlayer(player: Player): number {
  return survivorOf(player).level;
}
