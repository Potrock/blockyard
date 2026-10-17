import type { WarWhy } from '../diplomacy';
import type { Player } from '../state';

/**
 * What a bot remembers from one turn to the next: the victory it's working toward, the war it's
 * planning or fighting, how its wars began, and what each of its units was sent to do. Plain data on
 * the player, so a saved game's bots carry on with the same plans.
 */

export type Aim = 'domination' | 'science' | 'culture' | 'diplomatic';

/**
 * A war a bot is getting ready for (`muster`), fighting (`attack`), or gathering itself for again after
 * its army was worn down (`regroup`): whom, which city, where the army gathers.
 */
export interface WarPlan {
  target: number;
  city: number;
  stage: 'muster' | 'attack' | 'regroup';
  /** The turn the stage last changed, and the turn a city was last taken. */
  changed?: number;
  taken?: number;
  /** The turn the plan was made, and the tile the army gathers on. */
  since: number;
  rally: number;
  /** The way over land from the rally point to the city, and how far along it the army has marched. */
  route?: number[];
  step?: number;
  /** Across the water: the army sails from a coastal rally point to a landing beach near the city. */
  amphibious?: boolean;
  landing?: number;
  /** Why it wants the war: said to a person it means to fight, before it's declared and as it is. */
  why?: WarWhy;
  /**
   * A person it means to fight: the turn they were told its army is massing at their border (war
   * comes no sooner than five turns on), or that it will come as a surprise (a warlike leader's, now and then).
   */
  warned?: number;
  surprise?: boolean;
}

/** How a war stood when it began, to judge how it's going (cities and military strength on each side). */
export interface WarRecord {
  since: number;
  /** Who declared it (the bot or the other side). */
  ours: boolean;
  myCities: number;
  theirCities: number;
  myMight: number;
  theirMight: number;
}

export interface BotMemory {
  aim: Aim;
  /** The turn the aim was last chosen. */
  aimed: number;
  plan?: WarPlan;
  /** Wars going on, by the other player's index. */
  wars: Record<number, WarRecord>;
  /** Where each unit is headed (by unit id): a tile, and why. */
  orders: Record<number, { to: number; why: string }>;
  /** A tech to research toward, and when it was chosen. */
  techGoal?: string;
  /** The turn a city-state was last given gold (to space gifts out). */
  gifted?: number;
  /** The turn each city (by id) last had its production chosen by the bot. */
  chosen?: Record<number, number>;
  /** The turn the bot last put a deal to each person (by player index), so as not to pester them. */
  offered?: Record<number, number>;
  /** Its workers at the end of its last turn (by unit id, the tile each was on), to tell when one is taken. */
  crew?: Record<number, number>;
  /** Where its workers were taken lately (often by an enemy no one saw), kept away from for a while. */
  lost?: { tile: number; turn: number }[];
  /** A stand-in for a peaceful person (the difficulty benchmark's): it plays as a bot but never makes war nor attacks. */
  passive?: boolean;
}

/** A bot's memory, made on first use. */
export function memoryOf(p: Player, aim: Aim): BotMemory {
  return (p.ai ??= { aim, aimed: 0, wars: {}, orders: {} });
}
