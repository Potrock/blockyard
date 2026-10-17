import type { Player } from '../state';
import type { Aim } from './memory';

/**
 * Each leader's character, in Civilization V's "flavours" (0 to 10): how wide they build, how much they
 * love wonders, war, defence, science, culture, faith, gold and city-states, and how bold they are
 * (fighting the strong, holding out for victory instead of peace). Montezuma attacks; Gandhi builds and
 * prays but holds his walls; Harun al-Rashid trades; Ramesses raises wonders; Napoleon conquers with
 * culture to show for it.
 */

export interface Personality {
  expansion: number;
  wonder: number;
  offense: number;
  defense: number;
  science: number;
  culture: number;
  faith: number;
  gold: number;
  diplomacy: number;
  boldness: number;
}

const L = (expansion: number, wonder: number, offense: number, defense: number, science: number, culture: number, faith: number, gold: number, diplomacy: number, boldness: number): Personality => ({ expansion, wonder, offense, defense, science, culture, faith, gold, diplomacy, boldness });

/** By civ: the leader's flavours. */
export const PERSONALITIES: Record<string, Personality> = {
  egypt: L(5, 10, 4, 6, 5, 8, 7, 5, 4, 4), // Ramesses II: wonders above all
  babylon: L(5, 6, 4, 7, 10, 5, 3, 5, 4, 4), // Nebuchadnezzar II: learning
  china: L(6, 6, 7, 6, 6, 5, 4, 5, 4, 6), // Wu Zetian: a strategist's armies and a scholar's cities
  india: L(3, 6, 1, 7, 6, 7, 10, 4, 7, 2), // Gandhi: few, great cities; faith; peace (but walls)
  persia: L(6, 5, 6, 5, 5, 7, 4, 8, 5, 6), // Darius I: golden ages, gold and conquest
  korea: L(4, 6, 2, 8, 10, 5, 4, 5, 5, 2), // Sejong: science behind strong walls
  arabia: L(6, 4, 4, 5, 5, 5, 8, 10, 7, 4), // Harun al-Rashid: caravans, faith, friends bought
  germany: L(6, 4, 7, 7, 6, 4, 3, 7, 6, 6), // Bismarck: iron, order, city-states
  iroquois: L(8, 4, 6, 5, 5, 5, 5, 4, 4, 5), // Hiawatha: forests filled with towns
  aztec: L(7, 3, 10, 3, 3, 5, 6, 3, 3, 10), // Montezuma: war, always
  russia: L(8, 5, 6, 6, 6, 4, 4, 5, 4, 5), // Catherine: a vast land and what's under it
  france: L(5, 7, 8, 5, 4, 8, 3, 5, 3, 8), // Napoleon: a cultured conqueror
};

/** A city-state: keeps its one city and defends it. */
const CITY_STATE = L(0, 0, 1, 9, 4, 4, 4, 4, 0, 3);
const PLAIN = L(5, 5, 5, 5, 5, 5, 5, 5, 5, 5);

export const personalityOf = (p: Player): Personality => (p.cityState ? CITY_STATE : (PERSONALITIES[p.civ] ?? PLAIN));

/** How much a leader leans toward each victory, before the game's situation is weighed. */
export function aimLeaning(pers: Personality): Record<Aim, number> {
  return {
    domination: pers.offense + pers.boldness * 0.5,
    science: pers.science * 1.15,
    culture: pers.culture + pers.wonder * 0.4,
    diplomatic: pers.diplomacy * 0.8 + pers.gold * 0.5,
  };
}
