/**
 * The killstreaks you call in (free-for-all and Team Deathmatch): what each is called and how many
 * kills in a row earn it. Earned ones wait until called in (4), latest first, and last until the
 * match ends. (The UAV at three and the Adrenaline Shot at five come at once: `server.ts`.)
 */
export type StreakId = 'hellstorm' | 'chopper';

export interface StreakInfo {
  name: string;
  kills: number;
  /** What it does, in a line. */
  blurb: string;
}

export const STREAKS: Record<StreakId, StreakInfo> = {
  hellstorm: { name: 'Hellstorm', kills: 7, blurb: 'Steer a missile down onto them from the sky' },
  chopper: { name: 'Attack Chopper', kills: 10, blurb: 'Fly a gunship over the map and work its cannon' },
};

export const STREAK_IDS = Object.keys(STREAKS) as StreakId[];

export const isStreak = (id: string | undefined): id is StreakId => !!id && id in STREAKS;
