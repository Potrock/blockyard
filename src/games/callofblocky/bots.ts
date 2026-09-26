import type { Bot, GameContext, Player, Vec3 } from '@platform';
import { shooterBots, type BotMind, type BotWeapon, type NavGrid, type ShooterBots } from '@platform/kits';
import { LETHALS } from './weapons';

/**
 * Bot fighters: the platform's shooter bots (`shooterBots`, whose defaults are tuned to how they
 * fight here), told how each of our weapons is fought with. They hold the range their gun likes,
 * rush in with the shotgun and SMG, stay down the scope with the Honey Bunny, and go to the Lucky
 * 45 when the primary runs dry up close. When someone they were fighting ducks out of sight, they
 * lob their lethal after them (the better ones cook a frag first).
 *
 * What they're after is the mode's (`rules`, set by the server for each match): who's fair game
 * (everyone in a free-for-all, the other side in a team mode), and where to go when nobody's in
 * sight (the briefcase when it's out on the street, the better ones more often; in The Briefcase,
 * the sites, the case and its carrier). Otherwise they roam the map's walking grid (`nav`, the map
 * being played) toward its hotspots.
 */
const WEAPONS: Record<string, BotWeapon> = {
  rifle: { range: 16 },
  smg: { range: 8, rush: true },
  shotgun: { range: 4, ads: false, rush: true },
  sniper: { range: 32, ads: true, steady: true },
  pistol: { range: 11 },
  katana: { range: 1.5, rush: true },
};

/** A lethal's lob (as `player.throw({ at })` makes it), and how far along it must be clear to throw. */
const LOB = (40 * Math.PI) / 180;
const CLEAR = 5;

/** The match's say in what bots do. */
export interface BotRules {
  /** Whether `other` is fair game. */
  hostile(bot: Bot, other: Player): boolean;
  /** Somewhere to go when nobody's in sight (null: their own ideas). */
  goal(bot: Bot, mind: BotMind): Vec3 | null;
}

export interface Bots extends ShooterBots {
  /** Something everyone's after (the briefcase on the street): bots head for it when there's no one to shoot. */
  objective: Vec3 | null;
  /** The mode's rules (null: everyone's fair game, and the objective). */
  rules: BotRules | null;
}

/**
 * The bots, walking the grid `nav()` gives (the map being played; null while it's still loading)
 * and drifting toward `hotspots` (the array is read as it is at each plan: the map's).
 */
export function makeBots(game: GameContext, nav: () => NavGrid | null, hotspots: Vec3[]): Bots {
  const bots: Bots = Object.assign(
    shooterBots(game, {
      nav,
      hotspots,
      weapons: WEAPONS,
      hostile: (bot, other) => bots.rules?.hostile(bot, other) ?? true,
      goal: (bot, mind) => {
        if (bots.rules) {
          const g = bots.rules.goal(bot, mind);
          if (g) return g;
        }
        return bots.objective && mind.skill > 0.5 !== Math.random() < 0.3 ? bots.objective : null;
      },
      throw: (bot, at, mind) => {
        const item = Object.keys(LETHALS).find((id) => bot.inventory.count(id) > 0);
        if (!item) return false;
        // Only a high lob (up at 40 degrees toward the spot, as `throw({ at })` makes it when it
        // reaches: further, it throws flat into the cover they're behind), with its first few
        // blocks clear and nobody at their elbow (a molotov breaks on the first thing it meets).
        const eye = bot.eye;
        const dx = at.x - eye.x;
        const dz = at.z - eye.z;
        const flat = Math.hypot(dx, dz) || 1;
        const rise = flat * Math.tan(LOB) - (at.y - eye.y);
        const speed = LETHALS[item].speed ?? 20;
        if (!(rise > 0) || (LETHALS[item].physics?.gravity ?? 24) * flat * flat > 2 * Math.cos(LOB) ** 2 * rise * speed * speed) return false;
        const dir = { x: (dx / flat) * Math.cos(LOB), y: Math.sin(LOB), z: (dz / flat) * Math.cos(LOB) };
        if (game.world.raycast(eye, dir, CLEAR)) return false;
        if (game.players.some((p) => p !== bot && p.alive && Math.hypot(p.position.x - bot.position.x, p.position.z - bot.position.z) < 2)) return false;
        return bot.throw(item, { at, cook: item === 'frag' ? mind.skill * 1.4 : 0 });
      },
    }),
    { objective: null as Vec3 | null, rules: null as BotRules | null },
  );
  return bots;
}
