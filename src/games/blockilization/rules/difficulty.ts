import type { Effects } from './effects';
import type { Game, Player, Settings } from './state';

/**
 * Difficulty, Civilization V's way: the bots play the same game by the same rules at every level, and
 * the level gives one side a head start. Easy levels help the people (more production, research and
 * growth, a calmer people); hard ones help the bots (the same, and extra units to start with). Prince
 * is the even game.
 */

export type Difficulty = 'settler' | 'chieftain' | 'prince' | 'king' | 'emperor' | 'deity';

/** A side's head start: percent more production, science and growth, percent less unhappiness, extra units at the start. */
export interface Handicap {
  production: number;
  science: number;
  growth: number;
  unhappiness: number;
  /** Percent off units' gold upkeep. */
  upkeep: number;
  start: string[];
}

const NONE: Handicap = { production: 0, science: 0, growth: 0, unhappiness: 0, upkeep: 0, start: [] };

export const DIFFICULTIES: Record<Difficulty, { name: string; text: string; people: Handicap; bots: Handicap }> = {
  settler: {
    name: 'Settler',
    text: 'For learning the game: your cities work faster and stay content; the bots are slow.',
    people: { production: 25, science: 25, growth: 25, unhappiness: 30, upkeep: 50, start: ['worker'] },
    bots: { production: -20, science: -20, growth: -20, unhappiness: 0, upkeep: 0, start: [] },
  },
  chieftain: {
    name: 'Chieftain',
    text: 'A gentle game: a little help for you, a little less for the bots.',
    people: { production: 10, science: 10, growth: 10, unhappiness: 15, upkeep: 25, start: [] },
    bots: { production: -10, science: -10, growth: -10, unhappiness: 0, upkeep: 0, start: [] },
  },
  prince: { name: 'Prince', text: 'The even game: no help for anyone.', people: NONE, bots: NONE },
  king: {
    name: 'King',
    text: 'The bots work a little faster and start with a Worker.',
    people: NONE,
    bots: { production: 10, science: 10, growth: 10, unhappiness: 10, upkeep: 20, start: ['worker'] },
  },
  emperor: {
    name: 'Emperor',
    text: 'The bots work faster, keep their people happier and start with a Worker and a Warrior more.',
    people: NONE,
    bots: { production: 20, science: 20, growth: 20, unhappiness: 20, upkeep: 35, start: ['worker', 'warrior'] },
  },
  deity: {
    name: 'Deity',
    text: 'The bots are far ahead from the start: a second Settler, more of everything.',
    people: NONE,
    bots: { production: 35, science: 30, growth: 35, unhappiness: 30, upkeep: 50, start: ['settler', 'worker', 'warrior', 'archer'] },
  },
};

export const DIFFICULTY_LIST = Object.keys(DIFFICULTIES) as Difficulty[];

/** A game's difficulty (Prince for games saved before there was a choice). */
export const difficultyOf = (settings: Settings): Difficulty => settings.difficulty ?? 'prince';

/** The head start a player gets: a civ's (a bot's or a person's); city-states and barbarians get none. */
export function handicapOf(settings: Settings, p: Pick<Player, 'bot' | 'cityState' | 'civ'>): Handicap {
  if (p.cityState || p.civ === 'barbarian') return NONE;
  const level = DIFFICULTIES[difficultyOf(settings)];
  return p.bot ? level.bots : level.people;
}

/** The head start as effects, for the empire's own (`economy.ts`). */
export function handicapEffects(game: Game, p: Player): Effects[] {
  const h = handicapOf(game.settings, p);
  if (h === NONE) return [];
  return [{ percent: { prod: h.production, science: h.science, food: h.growth }, unhappinessPercent: h.unhappiness, unitUpkeep: h.upkeep }];
}
