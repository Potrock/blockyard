import { ITEMS, type ItemEntry } from '../items';

/**
 * The survivor's tables: what tools harvest, what food does, what armour protects from, how
 * experience turns into levels. Pure data and pure functions, so the rules, the screens and the
 * other parts all read the same numbers.
 */

// -----------------------------------------------------------------------------------------------
// Items as the bag sees them
// -----------------------------------------------------------------------------------------------

const ENTRIES: Record<string, ItemEntry> = ITEMS;

/** An item's entry in the game's vocabulary, if it has one. */
export const entryOf = (item: string): ItemEntry | undefined => ENTRIES[item];

/** What one of an item weighs (something the vocabulary doesn't list weighs a little). */
export const weightOf = (item: string): number => ENTRIES[item]?.weight ?? 0.1;

/** The name to show for an item. */
export const nameOf = (item: string): string => ENTRIES[item]?.name ?? item;

// -----------------------------------------------------------------------------------------------
// Tools
// -----------------------------------------------------------------------------------------------

export type ToolKind = 'pick' | 'hatchet' | 'sickle' | 'hand';

/** What a held item harvests as: its kind, and its tier (0 bare hands, 1 stone, 2 metal). */
export interface HarvestTool {
  kind: ToolKind;
  tier: number;
}

const TOOLS: Record<string, HarvestTool> = {
  stone_pick: { kind: 'pick', tier: 1 },
  metal_pick: { kind: 'pick', tier: 2 },
  stone_hatchet: { kind: 'hatchet', tier: 1 },
  metal_hatchet: { kind: 'hatchet', tier: 2 },
  stone_sickle: { kind: 'sickle', tier: 1 },
  metal_sickle: { kind: 'sickle', tier: 2 },
};

const HAND: HarvestTool = { kind: 'hand', tier: 0 };

/**
 * What the item in a survivor's hand harvests as (`player.inventory.held?.item`; null or anything
 * that isn't a tool is a bare hand). Picks break stone and ore, hatchets fell trees and skin
 * carcasses for hide, sickles reap fiber and thatch; a higher tier gathers more.
 */
export function harvestTool(heldItemId: string | null | undefined): HarvestTool {
  return (heldItemId && TOOLS[heldItemId]) || HAND;
}

// -----------------------------------------------------------------------------------------------
// Food and drink
// -----------------------------------------------------------------------------------------------

/** What eating or drinking one does. */
export interface Meal {
  /** Hunger and thirst given back (of 100). */
  food?: number;
  water?: number;
  /** Health given back at once, or lost (raw meat). */
  heal?: number;
  /** Health given back over this many seconds. */
  mend?: { amount: number; over: number };
  /** The chance it turns the stomach: a little damage, and thirst. */
  risk?: number;
  /** Seconds the right mouse button is held to finish it. */
  time: number;
  /** What it leaves behind in the hand (a full waterskin leaves an empty one). */
  leaves?: string;
  drink?: boolean;
}

export const MEALS: Record<string, Meal> = {
  berries: { food: 4, water: 2, time: 0.5 },
  raw_meat: { food: 10, risk: 0.5, time: 1.2 },
  raw_fish: { food: 8, risk: 0.3, time: 1.1 },
  egg: { food: 12, risk: 0.2, time: 1 },
  cooked_meat: { food: 30, time: 1.4 },
  cooked_fish: { food: 24, water: 4, time: 1.3 },
  prime_meat: { food: 45, heal: 4, time: 1.6 },
  berry_mash: { food: 16, water: 14, time: 1 },
  jerky: { food: 40, time: 1.6 },
  stew: { food: 65, water: 25, mend: { amount: 8, over: 20 }, time: 2 },
  waterskin_full: { water: 45, time: 1.3, leaves: 'waterskin', drink: true },
  bandage: { mend: { amount: 10, over: 8 }, time: 1.5 },
};

// -----------------------------------------------------------------------------------------------
// Armour
// -----------------------------------------------------------------------------------------------

export type WornSlot = 'head' | 'body' | 'feet';
export const WORN_SLOTS: readonly WornSlot[] = ['head', 'body', 'feet'];

/** What a piece of armour does while worn. */
export interface Armour {
  slot: WornSlot;
  /** Armour points (the platform's: each blocks 4% of damage). */
  armor: number;
  /** How much cold and heat it keeps off (of a scale where 100 is any weather at all); thick hide is hot in the sun. */
  cold: number;
  heat: number;
}

export const ARMOUR: Record<string, Armour> = {
  cloth_hood: { slot: 'head', armor: 1, cold: 5, heat: 12 },
  cloth_tunic: { slot: 'body', armor: 2, cold: 8, heat: 16 },
  cloth_wraps: { slot: 'feet', armor: 1, cold: 5, heat: 8 },
  hide_cap: { slot: 'head', armor: 2, cold: 16, heat: -4 },
  hide_vest: { slot: 'body', armor: 4, cold: 26, heat: -6 },
  hide_boots: { slot: 'feet', armor: 2, cold: 14, heat: -3 },
  metal_helm: { slot: 'head', armor: 3, cold: 6, heat: -6 },
  metal_plate: { slot: 'body', armor: 7, cold: 10, heat: -10 },
  metal_greaves: { slot: 'feet', armor: 4, cold: 6, heat: -5 },
};

// -----------------------------------------------------------------------------------------------
// Experience
// -----------------------------------------------------------------------------------------------

export const MAX_LEVEL = 60;

/** Experience needed to go from `level` to the next: gentle early, a real climb late. */
export function xpToNext(level: number): number {
  return Math.round(10 + 12 * level ** 1.35);
}

/** All the experience it takes to reach `level` from level 1. */
export function xpForLevel(level: number): number {
  let total = 0;
  for (let l = 1; l < Math.min(level, MAX_LEVEL); l++) total += xpToNext(l);
  return total;
}

/** The level a total of experience comes to. */
export function levelForXp(xp: number): number {
  let level = 1;
  let left = xp;
  while (level < MAX_LEVEL && left >= xpToNext(level)) {
    left -= xpToNext(level);
    level++;
  }
  return level;
}

/** Sparks (the points recipes are learned with) a survivor has earned by `level`: two a level, and two more every fifth. */
export function sparksAt(level: number): number {
  let total = 0;
  for (let l = 2; l <= level; l++) total += l % 5 === 0 ? 4 : 2;
  return total;
}

// -----------------------------------------------------------------------------------------------
// The pack
// -----------------------------------------------------------------------------------------------

export const BAG_SLOTS = 40;
export const HOTBAR_SLOTS = 9;

/** What a survivor carries before it slows them: more with every level. */
export function carryLimit(level: number): number {
  return 100 + 3 * (level - 1);
}

/** What a load does to a survivor's pace: nothing up to the limit, a trudge over it, a crawl (and no jumping) at half as much again. */
export function loadSpeed(weight: number, limit: number): { speed: number; pinned: boolean } {
  if (weight <= limit) return { speed: 1, pinned: false };
  if (weight <= limit * 1.5) return { speed: 0.6, pinned: false };
  return { speed: 0.25, pinned: true };
}

// -----------------------------------------------------------------------------------------------
// What the screens say about items
// -----------------------------------------------------------------------------------------------

/** A line about each of the survivor's own items, for the pack's detail panel. */
export const NOTES: Record<string, string> = {
  wood: 'Felled from trees. Most things start here.',
  thatch: 'Dry fronds and bark. Roofing, bedding, kindling.',
  fiber: 'Stripped from plants. Twist it into cordage.',
  stone: 'Good for tools, walls and a slingshot.',
  flint: 'Splits to a keen edge.',
  berries: 'A mouthful. Creatures like them too.',
  seeds: 'Plant them, or bait small animals.',
  metal_ore: 'Smelt it at a forge.',
  metal_ingot: 'Ready for the smithy.',
  crystal: 'Clear and hard. Found high up.',
  obsidian: 'Volcanic glass.',
  sap: 'Sticky. Binds and seals.',
  raw_meat: 'Cook it first, or take your chances.',
  cooked_meat: 'A proper meal.',
  prime_meat: 'The best cut. Carnivores love it.',
  raw_fish: 'Cook it first.',
  cooked_fish: 'Light and good.',
  hide: 'Tough skin for clothes and gear.',
  keratin: 'Horn, claw and beak.',
  feather: 'Fletching for arrows.',
  egg: 'Edible raw, with luck.',
  cordage: 'Twisted fiber rope. Binds heads to hafts.',
  charcoal: 'Burns hot enough to smelt ore.',
  stone_pick: 'Breaks stone and ore. Knocks flint loose.',
  metal_pick: 'Bites into the hardest rock.',
  stone_hatchet: 'Fells trees for wood. Skins hide.',
  metal_hatchet: 'Fells trees fast.',
  stone_sickle: 'Reaps fiber and thatch.',
  metal_sickle: 'Reaps a field in a few strokes.',
  club: 'Heavy and blunt. Knocks things back.',
  spear: 'Long reach keeps teeth away.',
  metal_spear: 'A long reach and a hard point.',
  bow: 'Shoots stone arrows. Hold to draw.',
  longbow: 'Shoots metal arrows a long way.',
  slingshot: 'Flings stones from your belt.',
  stone_arrow: 'For the bow. Keep them on your belt.',
  metal_arrow: 'For the longbow. Keep them on your belt.',
  waterskin: 'Empty. Fill it by drinking at water.',
  waterskin_full: 'Water for the road.',
  berry_mash: 'Sweet and wet.',
  jerky: 'Dried meat. Keeps you going.',
  stew: 'Fills you up and mends you slowly.',
  bandage: 'Mends wounds over a few seconds.',
  cloth_hood: 'Keeps the sun off.',
  cloth_tunic: 'Light and cool.',
  cloth_wraps: 'Better than bare feet.',
  hide_cap: 'Warm.',
  hide_vest: 'Warm and tough. Hot in the sun.',
  hide_boots: 'Warm.',
  metal_helm: 'Turns a bite.',
  metal_plate: 'Heavy protection.',
  metal_greaves: 'Heavy protection.',
  lost_pack: 'What someone carried when they fell.',
};
