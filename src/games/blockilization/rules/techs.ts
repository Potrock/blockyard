/**
 * The technology tree, Civilization V's: each tech's column (its place left to right, which sets its
 * cost and era) and what it needs first. What a tech unlocks is said by the things it unlocks (units,
 * buildings, improvements name their `tech`), so the tree only knows the order.
 */

export type Era = 'ancient' | 'classical' | 'medieval' | 'renaissance' | 'industrial' | 'modern' | 'atomic' | 'information';
export const ERAS: Era[] = ['ancient', 'classical', 'medieval', 'renaissance', 'industrial', 'modern', 'atomic', 'information'];
export const ERA_NAMES: Record<Era, string> = {
  ancient: 'Ancient Era',
  classical: 'Classical Era',
  medieval: 'Medieval Era',
  renaissance: 'Renaissance',
  industrial: 'Industrial Era',
  modern: 'Modern Era',
  atomic: 'Atomic Era',
  information: 'Information Era',
};

export interface Tech {
  id: string;
  name: string;
  col: number;
  needs: string[];
  /** What it does besides unlocking things (shown in the tree). */
  note?: string;
}

/** A column's era. */
export const eraOfCol = (col: number): Era => (col <= 2 ? 'ancient' : col <= 4 ? 'classical' : col <= 6 ? 'medieval' : col <= 8 ? 'renaissance' : col <= 10 ? 'industrial' : col <= 12 ? 'modern' : col <= 14 ? 'atomic' : 'information');

/** Science each column's techs cost at standard speed (before the cost per city). */
const COL_COST = [20, 35, 55, 85, 175, 275, 485, 780, 1150, 1600, 2350, 3100, 4100, 5100, 5800, 6400, 7700, 8800, 9500];
export const baseTechCost = (t: Tech) => COL_COST[Math.min(t.col, COL_COST.length - 1)];

const T = (id: string, name: string, col: number, needs: string[], note?: string): Tech => ({ id, name, col, needs, note });

export const TECH_LIST: Tech[] = [
  // Ancient
  T('agriculture', 'Agriculture', 0, [], 'Farms'),
  T('pottery', 'Pottery', 1, ['agriculture']),
  T('animal_husbandry', 'Animal Husbandry', 1, ['agriculture'], 'Shows Horses; Pastures'),
  T('archery', 'Archery', 1, ['agriculture']),
  T('mining', 'Mining', 1, ['agriculture'], 'Mines; workers can clear Forest'),
  T('sailing', 'Sailing', 2, ['pottery'], 'Fishing Boats; units can embark... with Optics'),
  T('calendar', 'Calendar', 2, ['pottery'], 'Plantations'),
  T('writing', 'Writing', 2, ['pottery'], 'Open borders'),
  T('trapping', 'Trapping', 2, ['animal_husbandry'], 'Camps, Trading Posts'),
  T('the_wheel', 'The Wheel', 2, ['animal_husbandry'], 'Roads'),
  T('masonry', 'Masonry', 2, ['mining'], 'Quarries; workers can clear Marsh'),
  T('bronze_working', 'Bronze Working', 2, ['mining'], 'Shows Iron; workers can clear Jungle'),
  // Classical
  T('optics', 'Optics', 3, ['sailing'], 'Land units can embark'),
  T('horseback_riding', 'Horseback Riding', 3, ['the_wheel']),
  T('mathematics', 'Mathematics', 3, ['the_wheel', 'archery']),
  T('construction', 'Construction', 3, ['masonry', 'the_wheel'], 'Lumber Mills; bridges over rivers'),
  T('philosophy', 'Philosophy', 4, ['writing', 'calendar']),
  T('drama', 'Drama and Poetry', 4, ['writing']),
  T('currency', 'Currency', 4, ['bronze_working', 'trapping']),
  T('iron_working', 'Iron Working', 4, ['bronze_working']),
  // Medieval
  T('theology', 'Theology', 5, ['philosophy', 'drama']),
  T('civil_service', 'Civil Service', 5, ['philosophy', 'currency'], 'Farms without fresh water get +1 Food'),
  T('guilds', 'Guilds', 5, ['currency']),
  T('metal_casting', 'Metal Casting', 5, ['iron_working']),
  T('compass', 'Compass', 5, ['optics'], 'Embarked units move faster'),
  T('engineering', 'Engineering', 5, ['mathematics', 'construction'], 'Forts'),
  T('education', 'Education', 6, ['theology', 'civil_service']),
  T('chivalry', 'Chivalry', 6, ['civil_service', 'horseback_riding']),
  T('machinery', 'Machinery', 6, ['guilds', 'engineering'], 'Faster movement on Roads'),
  T('physics', 'Physics', 6, ['engineering', 'metal_casting']),
  T('steel', 'Steel', 6, ['metal_casting']),
  // Renaissance
  T('astronomy', 'Astronomy', 7, ['compass', 'education'], 'Embarked units can cross Ocean'),
  T('acoustics', 'Acoustics', 7, ['education']),
  T('banking', 'Banking', 7, ['chivalry', 'guilds']),
  T('printing_press', 'Printing Press', 7, ['machinery', 'theology']),
  T('gunpowder', 'Gunpowder', 7, ['physics', 'steel']),
  T('navigation', 'Navigation', 8, ['astronomy']),
  T('architecture', 'Architecture', 8, ['banking', 'printing_press']),
  T('economics', 'Economics', 8, ['banking', 'printing_press']),
  T('metallurgy', 'Metallurgy', 8, ['gunpowder']),
  T('chemistry', 'Chemistry', 8, ['gunpowder']),
  // Industrial
  T('archaeology', 'Archaeology', 9, ['navigation', 'acoustics'], 'Shows Antiquity Sites'),
  T('scientific_theory', 'Scientific Theory', 9, ['acoustics', 'economics']),
  T('industrialization', 'Industrialization', 9, ['economics', 'metallurgy'], 'Shows Coal'),
  T('rifling', 'Rifling', 9, ['metallurgy']),
  T('military_science', 'Military Science', 9, ['economics', 'chemistry']),
  T('fertilizer', 'Fertilizer', 9, ['chemistry'], 'Farms without fresh water as good as with'),
  T('biology', 'Biology', 10, ['archaeology', 'scientific_theory'], 'Shows Oil'),
  T('electricity', 'Electricity', 10, ['scientific_theory', 'metallurgy'], 'Shows Aluminum'),
  T('steam_power', 'Steam Power', 10, ['scientific_theory', 'industrialization']),
  T('dynamite', 'Dynamite', 10, ['fertilizer', 'rifling', 'military_science']),
  // Modern
  T('refrigeration', 'Refrigeration', 11, ['biology', 'electricity'], 'Offshore Platforms'),
  T('radio', 'Radio', 11, ['electricity']),
  T('replaceable_parts', 'Replaceable Parts', 11, ['steam_power']),
  T('flight', 'Flight', 11, ['steam_power', 'electricity']),
  T('railroad', 'Railroad', 11, ['steam_power', 'dynamite'], 'Railroads'),
  T('plastics', 'Plastics', 12, ['refrigeration']),
  T('electronics', 'Electronics', 12, ['radio', 'replaceable_parts']),
  T('ballistics', 'Ballistics', 12, ['replaceable_parts', 'railroad']),
  T('combustion', 'Combustion', 12, ['railroad']),
  // Atomic
  T('penicillin', 'Penicillin', 13, ['plastics', 'electronics']),
  T('atomic_theory', 'Atomic Theory', 13, ['electronics', 'combustion'], 'Shows Uranium'),
  T('radar', 'Radar', 13, ['electronics', 'flight']),
  T('combined_arms', 'Combined Arms', 13, ['combustion', 'ballistics']),
  T('ecology', 'Ecology', 14, ['penicillin', 'plastics']),
  T('nuclear_fission', 'Nuclear Fission', 14, ['atomic_theory', 'radar']),
  T('rocketry', 'Rocketry', 14, ['radar']),
  T('computers', 'Computers', 14, ['radar', 'plastics']),
  // Information
  T('telecommunications', 'Telecommunications', 15, ['computers']),
  T('mobile_tactics', 'Mobile Tactics', 15, ['nuclear_fission', 'combined_arms']),
  T('advanced_ballistics', 'Advanced Ballistics', 15, ['nuclear_fission']),
  T('satellites', 'Satellites', 15, ['rocketry'], 'Shows the whole map'),
  T('robotics', 'Robotics', 16, ['satellites', 'telecommunications']),
  T('lasers', 'Lasers', 16, ['satellites']),
  T('the_internet', 'The Internet', 16, ['telecommunications'], 'Tourism +50%'),
  T('globalization', 'Globalization', 16, ['telecommunications', 'ecology']),
  T('particle_physics', 'Particle Physics', 17, ['robotics', 'lasers']),
  T('nuclear_fusion', 'Nuclear Fusion', 17, ['lasers', 'advanced_ballistics']),
  T('nanotechnology', 'Nanotechnology', 17, ['particle_physics']),
  T('stealth', 'Stealth', 17, ['lasers']),
  T('future_tech', 'Future Tech', 18, ['particle_physics', 'nuclear_fusion', 'nanotechnology', 'stealth', 'the_internet', 'globalization'], 'Repeatable: score'),
];

export const TECHS: Record<string, Tech> = Object.fromEntries(TECH_LIST.map((t) => [t.id, t]));

/** Whether a civ with `known` techs can research `id` now. */
export const canResearch = (known: ReadonlySet<string>, id: string) => {
  const t = TECHS[id];
  return !!t && (!known.has(id) || id === 'future_tech') && t.needs.every((n) => known.has(n));
};

/** Every tech `id` needs that `known` hasn't got, in an order they can be researched (for queuing a far tech). */
export function pathTo(known: ReadonlySet<string>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string) => {
    if (known.has(t) || seen.has(t)) return;
    seen.add(t);
    for (const n of TECHS[t].needs) visit(n);
    out.push(t);
  };
  visit(id);
  return out;
}
