import type { GameContext, Vec3 } from '@platform';
import { shooterBots, type BotWeapon, type NavGrid, type ShooterBots } from '@platform/kits';

/**
 * Bot fighters: the platform's shooter bots (`shooterBots`, whose defaults are tuned to how they
 * fight here), told how each of our weapons is fought with. They hold the range their gun likes,
 * rush in with the shotgun and SMG, stay down the scope with the Honey Bunny, and go to the Lucky
 * 45 when the primary runs dry up close. With nobody in sight they go for the briefcase when it's
 * out (the better ones more often), or roam the walking grid.
 */
const WEAPONS: Record<string, BotWeapon> = {
  rifle: { range: 16 },
  smg: { range: 8, rush: true },
  shotgun: { range: 4, ads: false, rush: true },
  sniper: { range: 32, ads: true, steady: true },
  pistol: { range: 11 },
  katana: { range: 1.5, rush: true },
};

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
    }),
    { objective: null as Vec3 | null },
  );
  return bots;
}
