import type { GameContext, Vec3 } from '@platform';
import { shooterBots, type BotWeapon, type NavGrid, type ShooterBots } from '@platform/kits';
import { LETHALS } from './weapons';

/**
 * Bot fighters: the platform's shooter bots (`shooterBots`, whose defaults are tuned to how they
 * fight here), told how each of our weapons is fought with. They hold the range their gun likes,
 * rush in with the shotgun and SMG, stay down the scope with the Honey Bunny, and go to the Lucky
 * 45 when the primary runs dry up close. With nobody in sight they go for the briefcase when it's
 * out (the better ones more often), or roam the walking grid. When someone they were fighting
 * ducks out of sight, they lob their lethal after them (the better ones cook a frag first).
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

export interface Bots extends ShooterBots {
  /** Something everyone's after (the briefcase): bots head for it when there's no one to shoot. */
  objective: Vec3 | null;
}

export function makeBots(game: GameContext, nav: NavGrid, hotspots: Vec3[]): Bots {
  const bots: Bots = Object.assign(
    shooterBots(game, {
      nav,
      hotspots,
      weapons: WEAPONS,
      goal: (_bot, mind) => (bots.objective && mind.skill > 0.5 !== Math.random() < 0.3 ? bots.objective : null),
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
    { objective: null as Vec3 | null },
  );
  return bots;
}
