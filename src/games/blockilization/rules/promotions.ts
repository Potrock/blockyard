import type { Unit } from './state';
import { UNITS, type UnitClass } from './units';

/**
 * Promotions: a unit earns experience fighting, and at each step (10, 30, 60, 100, 150, 210, then
 * more) it can take one, each class of unit from its own list, some needing another first. Civ V's,
 * the common ones: Shock and Drill (open ground, rough ground), Cover, Accuracy and Barrage for archers
 * and siege, March and Medic, Blitz, Logistics and Range, Formation against horses, Siege against
 * cities, Sentry for sight, a couple for ships, and aircraft's own (Interception, Air Siege, Bombardment,
 * Air Targeting, Evasion, Air Repair, Air Range). What each does is data (`combat`, `range`...),
 * which the combat, movement and healing rules read; a few are only given (Morale, the Heroic Epic's;
 * Altitude Training, the Cloudcrown's).
 */

/** When a promotion's combat bonus counts. */
export type PromotionWhen =
  /** Fighting where the defender stands: open ground, or rough (hills, forest, jungle, marsh). */
  | 'open'
  | 'rough'
  /** Firing at a target on open ground, or rough. */
  | 'ranged_open'
  | 'ranged_rough'
  /** Defending against a ranged attack (a unit's or a city's). */
  | 'vs_ranged'
  /** Fighting mounted units, land units, ships or aircraft; attacking a city. */
  | 'vs_mounted'
  | 'vs_land'
  | 'vs_ships'
  | 'vs_aircraft'
  | 'vs_cities'
  | 'always';

export interface Promotion {
  id: string;
  name: string;
  text: string;
  /** The classes that can take it (none: only given, never chosen). */
  classes: UnitClass[];
  needs?: string[];
  /** Combat strength percent, and when it counts. */
  combat?: { percent: number; when: PromotionWhen };
  /** More range, sight and moves; attacks a turn; less damage from interception, in percent (an aircraft's Evasion). */
  range?: number;
  sight?: number;
  moves?: number;
  attacks?: number;
  evasion?: number;
  /** Heals even after moving or fighting (March). */
  healsOnTheMove?: boolean;
  /** Units next to it heal this much more (Medic). */
  healsNear?: number;
}

const MELEE: UnitClass[] = ['melee', 'gun', 'mounted', 'armor', 'recon'];
const RANGED: UnitClass[] = ['ranged', 'siege', 'naval_ranged'];
const NAVAL: UnitClass[] = ['naval_melee', 'naval_ranged', 'submarine', 'carrier'];
const AIR: UnitClass[] = ['fighter', 'bomber'];

export const PROMOTION_LIST: Promotion[] = [
  { id: 'shock_1', name: 'Shock I', text: '+15% combat strength in open terrain.', classes: MELEE, combat: { percent: 15, when: 'open' } },
  { id: 'shock_2', name: 'Shock II', text: '+15% more in open terrain.', classes: MELEE, needs: ['shock_1'], combat: { percent: 15, when: 'open' } },
  { id: 'shock_3', name: 'Shock III', text: '+15% more in open terrain.', classes: MELEE, needs: ['shock_2'], combat: { percent: 15, when: 'open' } },
  { id: 'drill_1', name: 'Drill I', text: '+15% combat strength in rough terrain.', classes: MELEE, combat: { percent: 15, when: 'rough' } },
  { id: 'drill_2', name: 'Drill II', text: '+15% more in rough terrain.', classes: MELEE, needs: ['drill_1'], combat: { percent: 15, when: 'rough' } },
  { id: 'drill_3', name: 'Drill III', text: '+15% more in rough terrain.', classes: MELEE, needs: ['drill_2'], combat: { percent: 15, when: 'rough' } },
  { id: 'cover_1', name: 'Cover I', text: '+25% defence against ranged attacks.', classes: [...MELEE, ...RANGED], combat: { percent: 25, when: 'vs_ranged' } },
  { id: 'cover_2', name: 'Cover II', text: '+25% more against ranged attacks.', classes: [...MELEE, ...RANGED], needs: ['cover_1'], combat: { percent: 25, when: 'vs_ranged' } },
  { id: 'formation_1', name: 'Formation I', text: '+33% against mounted units.', classes: ['melee', 'gun'], needs: ['shock_1'], combat: { percent: 33, when: 'vs_mounted' } },
  { id: 'formation_2', name: 'Formation II', text: '+33% more against mounted units.', classes: ['melee', 'gun'], needs: ['formation_1'], combat: { percent: 33, when: 'vs_mounted' } },
  { id: 'march', name: 'March', text: 'Heals even after moving or fighting.', classes: [...MELEE, ...RANGED], needs: ['drill_2'], healsOnTheMove: true },
  { id: 'medic_1', name: 'Medic I', text: 'Units next to it heal 5 more.', classes: [...MELEE, ...RANGED], needs: ['shock_1'], healsNear: 5 },
  { id: 'medic_2', name: 'Medic II', text: 'Units next to it heal 5 more again.', classes: [...MELEE, ...RANGED], needs: ['medic_1'], healsNear: 5 },
  { id: 'blitz', name: 'Blitz', text: 'Can attack twice a turn.', classes: MELEE, needs: ['shock_3'], attacks: 1 },
  { id: 'accuracy_1', name: 'Accuracy I', text: '+15% ranged strength in open terrain.', classes: RANGED, combat: { percent: 15, when: 'ranged_open' } },
  { id: 'accuracy_2', name: 'Accuracy II', text: '+15% more in open terrain.', classes: RANGED, needs: ['accuracy_1'], combat: { percent: 15, when: 'ranged_open' } },
  { id: 'accuracy_3', name: 'Accuracy III', text: '+15% more in open terrain.', classes: RANGED, needs: ['accuracy_2'], combat: { percent: 15, when: 'ranged_open' } },
  { id: 'barrage_1', name: 'Barrage I', text: '+15% ranged strength in rough terrain.', classes: RANGED, combat: { percent: 15, when: 'ranged_rough' } },
  { id: 'barrage_2', name: 'Barrage II', text: '+15% more in rough terrain.', classes: RANGED, needs: ['barrage_1'], combat: { percent: 15, when: 'ranged_rough' } },
  { id: 'barrage_3', name: 'Barrage III', text: '+15% more in rough terrain.', classes: RANGED, needs: ['barrage_2'], combat: { percent: 15, when: 'ranged_rough' } },
  { id: 'logistics', name: 'Logistics', text: 'Can fire twice a turn.', classes: RANGED, needs: ['accuracy_3'], attacks: 1 },
  { id: 'range', name: 'Range', text: '+1 range.', classes: RANGED, needs: ['barrage_2'], range: 1 },
  { id: 'siege', name: 'Siege', text: '+50% against cities.', classes: ['melee', 'gun', 'ranged', 'siege', 'armor'], combat: { percent: 50, when: 'vs_cities' } },
  { id: 'sentry', name: 'Sentry', text: '+1 sight.', classes: [...MELEE, ...RANGED, ...NAVAL], sight: 1 },
  { id: 'mobility', name: 'Mobility', text: '+1 move.', classes: ['mounted', 'armor', 'recon', ...NAVAL], needs: ['shock_2'], moves: 1 },
  { id: 'boarding_party', name: 'Boarding Party', text: '+15% against ships.', classes: NAVAL, combat: { percent: 15, when: 'vs_ships' } },
  { id: 'coastal_raider', name: 'Coastal Raider', text: '+20% against cities.', classes: NAVAL, combat: { percent: 20, when: 'vs_cities' } },
  // Aircraft (Civ V's, the common ones): fighters first to Interception, bombers to Air Siege.
  { id: 'interception_1', name: 'Interception I', text: '+33% strength against aircraft (intercepting them, or intercepted by them).', classes: ['fighter'], combat: { percent: 33, when: 'vs_aircraft' } },
  { id: 'interception_2', name: 'Interception II', text: '+33% more against aircraft.', classes: ['fighter'], needs: ['interception_1'], combat: { percent: 33, when: 'vs_aircraft' } },
  { id: 'interception_3', name: 'Interception III', text: '+33% more against aircraft.', classes: ['fighter'], needs: ['interception_2'], combat: { percent: 33, when: 'vs_aircraft' } },
  { id: 'air_siege_1', name: 'Air Siege I', text: '+33% strength striking cities.', classes: AIR, combat: { percent: 33, when: 'vs_cities' } },
  { id: 'air_siege_2', name: 'Air Siege II', text: '+33% more striking cities.', classes: AIR, needs: ['air_siege_1'], combat: { percent: 33, when: 'vs_cities' } },
  { id: 'air_siege_3', name: 'Air Siege III', text: '+33% more striking cities.', classes: AIR, needs: ['air_siege_2'], combat: { percent: 33, when: 'vs_cities' } },
  { id: 'bombardment_1', name: 'Bombardment I', text: '+33% strength striking land units.', classes: AIR, combat: { percent: 33, when: 'vs_land' } },
  { id: 'bombardment_2', name: 'Bombardment II', text: '+33% more striking land units.', classes: AIR, needs: ['bombardment_1'], combat: { percent: 33, when: 'vs_land' } },
  { id: 'bombardment_3', name: 'Bombardment III', text: '+33% more striking land units.', classes: AIR, needs: ['bombardment_2'], combat: { percent: 33, when: 'vs_land' } },
  { id: 'air_targeting_1', name: 'Air Targeting I', text: '+33% strength striking ships.', classes: AIR, combat: { percent: 33, when: 'vs_ships' } },
  { id: 'air_targeting_2', name: 'Air Targeting II', text: '+33% more striking ships.', classes: AIR, needs: ['air_targeting_1'], combat: { percent: 33, when: 'vs_ships' } },
  { id: 'evasion', name: 'Evasion', text: 'Takes half the damage when intercepted.', classes: ['bomber'], needs: ['air_siege_1'], evasion: 50 },
  { id: 'air_repair', name: 'Air Repair', text: 'Heals even after flying.', classes: AIR, needs: ['air_siege_1'], healsOnTheMove: true },
  { id: 'air_range', name: 'Air Range', text: '+2 range (and so +4 to rebase).', classes: AIR, range: 2 },
  { id: 'morale', name: 'Morale', text: '+15% combat strength (from the Heroic Epic).', classes: [], combat: { percent: 15, when: 'always' } },
  { id: 'altitude_training', name: 'Altitude Training', text: '+15% combat strength in rough terrain; heals even after moving or fighting (from the Cloudcrown).', classes: [], combat: { percent: 15, when: 'rough' }, healsOnTheMove: true },
];

export const PROMOTIONS: Record<string, Promotion> = Object.fromEntries(PROMOTION_LIST.map((p) => [p.id, p]));

/** Experience needed for each promotion: 10, 30, 60, 100, 150, 210... (Civ V's). */
export const xpFor = (n: number) => (n <= 0 ? 10 : 10 + 5 * n * (n + 3));

/** How many promotions a unit can take now (the ones it was given don't count against its experience). */
export function promotionsDue(u: Unit): number {
  let n = 0;
  while (u.xp >= xpFor(n)) n++;
  return Math.max(0, n - u.promotions.filter((id) => PROMOTIONS[id]?.classes.length).length);
}

/** The promotions a unit can take next. */
export function promotionsFor(u: Unit): Promotion[] {
  const cls = UNITS[u.type]?.class;
  if (!cls) return [];
  return PROMOTION_LIST.filter((p) => p.classes.includes(cls) && !u.promotions.includes(p.id) && (p.needs ?? []).every((n) => u.promotions.includes(n)));
}

/** The sum of a number its promotions add (range, sight, moves, attacks, evasion). */
export const fromPromotions = (u: Unit, key: 'range' | 'sight' | 'moves' | 'attacks' | 'evasion') => u.promotions.reduce((s, id) => s + (PROMOTIONS[id]?.[key] ?? 0), 0);
