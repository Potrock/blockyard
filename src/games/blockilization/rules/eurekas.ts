/**
 * Eurekas, Civilization VI's: nearly every tech has a deed that brings its research a third of the
 * way (a Mine built for The Wheel, a unit killed for Archery, a religion founded for Theology). Most
 * deeds are things a civ has, seen in the game as it stands (buildings, units, improvements, great
 * people); the rest are things it has done, counted as they happen (`deed`: kills, by what killed).
 * Each boost is earned once, by a team once for all of them, whether the tech can be researched yet
 * or not (its science waits in the tech, as any put into it does). Deeds are looked at after every
 * order a person gives and as each civ's turn ends (`checkEurekas`).
 */
import { BUILDINGS } from './buildings';
import { citiesOf, note, seesResource, techCost, unitsOf } from './core';
import { coastal } from './economy';
import { xpFor } from './promotions';
import type { City, Game, Player } from './state';
import { teamOf } from './teams';
import { TECHS } from './techs';
import { isMilitary, UNITS } from './units';

/** How far a boost brings a tech: a third of its cost. */
export const EUREKA_SHARE = 1 / 3;

/** What a civ has and has done, worked out once to look at every tech's deed. */
export class Facts {
  readonly cities: City[];
  /** Improvements on its land (unpillaged), by kind, and by kind and resource (`mine:iron`). */
  private improved: Record<string, number> = {};
  /** Resources on its land (those it can see). */
  private resources = new Set<string>();
  /** Its units by type (a civ's own unit counted as the one it replaces), and by class. */
  private units: Record<string, number> = {};
  private classes: Record<string, number> = {};
  /** Its cities with each building (a civ's own building counted as the one it replaces). */
  private buildings: Record<string, number> = {};
  readonly wonders: string[];
  /** Whether any city works a Hills tile; whether any unit has the experience of two promotions. */
  readonly hills: boolean;
  readonly veteran: boolean;

  constructor(
    readonly game: Game,
    readonly p: Player,
  ) {
    this.cities = citiesOf(game, p.index);
    for (const t of game.tiles) {
      if (t.owner !== p.index) continue;
      if (t.resource && seesResource(p, t.resource)) this.resources.add(t.resource);
      if (!t.improvement || t.pillaged) continue;
      this.improved[t.improvement] = (this.improved[t.improvement] ?? 0) + 1;
      if (t.resource) this.improved[`${t.improvement}:${t.resource}`] = (this.improved[`${t.improvement}:${t.resource}`] ?? 0) + 1;
    }
    let veteran = false;
    for (const u of unitsOf(game, p.index)) {
      const type = UNITS[u.type];
      if (!type) continue;
      const base = type.replaces ?? u.type;
      this.units[base] = (this.units[base] ?? 0) + 1;
      this.classes[type.class] = (this.classes[type.class] ?? 0) + 1;
      if (isMilitary(type) && u.xp >= xpFor(1)) veteran = true;
    }
    this.veteran = veteran;
    for (const c of this.cities)
      for (const b of new Set(c.buildings.map((x) => BUILDINGS[x]?.replaces ?? x))) this.buildings[b] = (this.buildings[b] ?? 0) + 1;
    this.wonders = this.cities.flatMap((c) => c.wonders ?? []);
    this.hills = this.cities.some((c) => c.worked.some((t) => game.tiles[t].elevation === 'hills'));
  }

  /** Cities of at least this size: as many as `n`. */
  size(pop: number, n = 1) {
    return this.cities.filter((c) => c.pop >= pop).length >= n;
  }
  /** An improvement, on its land: at least `n` (on a resource, `kind:resource`). */
  built(imp: string, n = 1) {
    return (this.improved[imp] ?? 0) >= n;
  }
  /** Any of these resources on its land. */
  has(...resources: string[]) {
    return resources.some((r) => this.resources.has(r));
  }
  /** At least `n` of these units (of any of the types, together). */
  own(n: number, ...types: string[]) {
    return types.reduce((s, t) => s + (this.units[t] ?? 0), 0) >= n;
  }
  ofClass(cls: string, n: number) {
    return (this.classes[cls] ?? 0) >= n;
  }
  /** A building in at least `n` cities. */
  building(id: string, n = 1) {
    return (this.buildings[id] ?? 0) >= n;
  }
  /** How many of a deed (`deed`). */
  did(what: string) {
    return this.p.deeds?.[what] ?? 0;
  }
  great(kind: keyof Player['greatCount'], n = 1) {
    return (this.p.greatCount[kind] ?? 0) >= n;
  }
  /** Civilizations met (not counting city-states), and city-states. */
  met(cityStates: boolean) {
    return (this.p.met ?? []).filter((i) => {
      const o = this.game.players[i];
      return o && o !== this.p && o.civ !== 'barbarian' && !!o.cityState === cityStates;
    }).length;
  }
}

export interface Eureka {
  /** The deed, said as a goal (the tree shows it: "Build a Mine"). */
  goal: string;
  met: (f: Facts) => boolean;
}

const E = (goal: string, met: (f: Facts) => boolean): Eureka => ({ goal, met });

/** Each tech's deed (Agriculture, known from the start, and Future Tech have none). */
export const EUREKAS: Record<string, Eureka> = {
  // Ancient
  pottery: E('Grow a city to size 3', (f) => f.size(3)),
  animal_husbandry: E('Have Cattle or Sheep in your land', (f) => f.has('cattle', 'sheep')),
  archery: E('Kill a unit', (f) => f.did('kill') >= 1),
  mining: E('Work a Hills tile', (f) => f.hills),
  sailing: E('Found a city on the coast', (f) => f.cities.some((c) => coastal(f.game, c))),
  calendar: E('Found a pantheon', (f) => !!f.p.pantheon),
  writing: E('Meet another civilization', (f) => f.met(false) >= 1),
  trapping: E('Have Deer, Furs or Ivory in your land', (f) => f.has('deer', 'furs', 'ivory')),
  the_wheel: E('Build a Mine', (f) => f.built('mine')),
  masonry: E('Build a Monument', (f) => f.building('monument')),
  bronze_working: E('Kill 3 barbarian units', (f) => f.did('barbarian') >= 3),
  // Classical
  optics: E('Build 2 Fishing Boats', (f) => f.built('fishing_boats', 2)),
  horseback_riding: E('Build a Pasture', (f) => f.built('pasture')),
  mathematics: E('Build a Library', (f) => f.building('library')),
  construction: E('Build a Water Mill', (f) => f.building('water_mill')),
  philosophy: E('Meet 2 city-states', (f) => f.met(true) >= 2),
  drama: E('Build a World Wonder', (f) => f.wonders.length >= 1),
  currency: E('Run a trade route', (f) => (f.p.routes?.length ?? 0) >= 1),
  iron_working: E('Mine Iron', (f) => f.built('mine:iron')),
  // Medieval
  theology: E('Found a religion', (f) => !!f.p.religion),
  civil_service: E('Grow a city to size 6', (f) => f.size(6)),
  guilds: E('Build a Market', (f) => f.building('market')),
  metal_casting: E('Train a unit up to 2 promotions', (f) => f.veteran),
  compass: E('Own 2 Triremes', (f) => f.own(2, 'trireme')),
  engineering: E('Build Walls', (f) => f.building('walls')),
  education: E('Earn a Great Scientist', (f) => f.great('scientist')),
  chivalry: E('Own 3 mounted units', (f) => f.ofClass('mounted', 3)),
  machinery: E('Own 3 Archers', (f) => f.own(3, 'archer')),
  physics: E('Build a Workshop', (f) => f.building('workshop')),
  steel: E('Kill a unit with a Swordsman', (f) => f.did('kill:swordsman') >= 1),
  // Renaissance
  astronomy: E('Build a University', (f) => f.building('university')),
  acoustics: E('Build an Amphitheater', (f) => f.building('amphitheater')),
  banking: E('Save up 300 gold', (f) => f.p.gold >= 300),
  printing_press: E('Earn a Great Writer', (f) => f.great('writer')),
  gunpowder: E('Build an Armory', (f) => f.building('armory')),
  navigation: E('Build 2 Harbors', (f) => f.building('harbor', 2)),
  architecture: E('Build 2 World Wonders', (f) => f.wonders.length >= 2),
  economics: E('Build 2 Banks', (f) => f.building('bank', 2)),
  metallurgy: E('Build 2 Forges', (f) => f.building('forge', 2)),
  chemistry: E('Build 2 Universities', (f) => f.building('university', 2)),
  // Industrial
  archaeology: E('Hold 3 great works', (f) => f.cities.reduce((n, c) => n + Object.values(c.works ?? {}).flat().length, 0) >= 3),
  scientific_theory: E('Earn 2 Great Scientists', (f) => f.great('scientist', 2)),
  industrialization: E('Build 3 Workshops', (f) => f.building('workshop', 3)),
  rifling: E('Own 3 Musketmen', (f) => f.own(3, 'musketman')),
  military_science: E('Kill a unit with a Knight or a Lancer', (f) => f.did('kill:knight') + f.did('kill:lancer') >= 1),
  fertilizer: E('Build 8 Farms', (f) => f.built('farm', 8)),
  biology: E('Grow a city to size 12', (f) => f.size(12)),
  electricity: E('Own 3 Frigates or Privateers', (f) => f.own(3, 'frigate', 'privateer')),
  steam_power: E('Build 2 Seaports', (f) => f.building('seaport', 2)),
  dynamite: E('Own 3 Cannons', (f) => f.own(3, 'cannon')),
  // Modern
  refrigeration: E('Grow 3 cities to size 10', (f) => f.size(10, 3)),
  radio: E('Earn a Great Musician', (f) => f.great('musician')),
  replaceable_parts: E('Own 3 Riflemen', (f) => f.own(3, 'rifleman')),
  flight: E('Build a World Wonder of the Industrial Era or later', (f) => f.wonders.some((w) => (TECHS[BUILDINGS[w]?.tech ?? '']?.col ?? 0) >= 9)),
  railroad: E('Mine Coal', (f) => f.built('mine:coal')),
  plastics: E('Build an Oil Well', (f) => f.built('oil_well') || f.built('offshore_platform')),
  electronics: E('Build a Stock Exchange', (f) => f.building('stock_exchange')),
  ballistics: E('Own 2 Artillery', (f) => f.own(2, 'artillery')),
  combustion: E('Own 2 Ironclads', (f) => f.own(2, 'ironclad')),
  // Atomic
  penicillin: E('Build 2 Hospitals', (f) => f.building('hospital', 2)),
  atomic_theory: E('Earn 3 Great Scientists', (f) => f.great('scientist', 3)),
  radar: E('Own 2 Triplanes', (f) => f.own(2, 'triplane')),
  combined_arms: E('Own 2 Landships', (f) => f.own(2, 'landship')),
  ecology: E('Find 3 natural wonders', (f) => Object.values(f.game.found ?? {}).filter((x) => x.by.includes(f.p.index)).length >= 3),
  nuclear_fission: E('Have Uranium in your land', (f) => f.has('uranium')),
  rocketry: E('Build an Airport', (f) => f.building('airport')),
  computers: E('Build a Broadcast Tower', (f) => f.building('broadcast_tower')),
  // Information
  telecommunications: E('Build 2 Research Labs', (f) => f.building('research_lab', 2)),
  mobile_tactics: E('Kill a unit with a Tank', (f) => f.did('kill:tank') >= 1),
  advanced_ballistics: E('Build a Nuclear Plant', (f) => f.building('nuclear_plant')),
  satellites: E('Own 3 Bombers', (f) => f.own(3, 'bomber')),
  robotics: E('Build 5 Factories', (f) => f.building('factory', 5)),
  lasers: E('Own 2 Mobile SAMs', (f) => f.own(2, 'mobile_sam')),
  the_internet: E('Build 3 Broadcast Towers', (f) => f.building('broadcast_tower', 3)),
  globalization: E('Run 4 trade routes', (f) => (f.p.routes?.length ?? 0) >= 4),
  particle_physics: E('Earn 5 Great Scientists', (f) => f.great('scientist', 5)),
  nuclear_fusion: E('Build 2 Nuclear Plants', (f) => f.building('nuclear_plant', 2)),
  nanotechnology: E('Build a Spaceship Factory', (f) => f.building('spaceship_factory')),
  stealth: E('Own 3 Jet Fighters', (f) => f.own(3, 'jet_fighter')),
};

/** A deed done, counted (a kill, and a kill by that kind of unit; a barbarian killed). */
export function deed(p: Player, what: string, n = 1) {
  (p.deeds ??= {})[what] = (p.deeds[what] ?? 0) + n;
}

/** A unit killed: the deeds it's a kill for. */
export function killDeeds(game: Game, winner: Player, by: string, killed: number) {
  deed(winner, 'kill');
  deed(winner, `kill:${UNITS[by]?.replaces ?? by}`);
  if (game.players[killed]?.civ === 'barbarian') deed(winner, 'barbarian');
}

/** Whether a civ (or its team) has had the boost for a tech. */
export const boosted = (game: Game, p: Player, id: string) => teamOf(game, p.index).some((m) => m.eurekas?.includes(id));

/** The goal said as done, by a civ or (`who`) its teammate: "You built a Mine", "Ana owns 3 Archers". */
const VERBS: Record<string, [string, string]> = { Have: ['have', 'has'], Own: ['own', 'owns'], Work: ['work', 'works'], Hold: ['hold', 'holds'], Run: ['run', 'runs'], Grow: ['grew', 'grew'], Kill: ['killed', 'killed'], Found: ['founded', 'founded'], Meet: ['met', 'met'], Build: ['built', 'built'], Mine: ['mined', 'mined'], Earn: ['earned', 'earned'], Save: ['saved', 'saved'], Find: ['found', 'found'], Train: ['trained', 'trained'] };
export function eurekaDone(goal: string, who?: string) {
  const [verb, ...rest] = goal.split(' ');
  const said = VERBS[verb]?.[who ? 1 : 0] ?? verb.toLowerCase();
  const tail = rest.join(' ');
  return `${who ?? 'You'} ${said} ${who ? tail.replace(/\byour\b/g, 'their') : tail}`;
}

/** Every deed a civ has done that it (or its team) hasn't had the boost for yet: boosted now. */
export function checkEurekas(game: Game, p: Player) {
  if (!p.alive || p.cityState || p.civ === 'barbarian') return;
  let facts: Facts | null = null;
  for (const [id, e] of Object.entries(EUREKAS)) {
    if (p.techs.includes(id) || !TECHS[id] || boosted(game, p, id)) continue;
    facts ??= new Facts(game, p);
    if (e.met(facts)) boost(game, p, id);
  }
}

/** A boost earned: a third of the tech's cost into its research (a team's, pooled: `shareResearch`). */
export function boost(game: Game, p: Player, id: string) {
  const team = teamOf(game, p.index);
  for (const m of team) (m.eurekas ??= []).push(id);
  p.research[id] = (p.research[id] ?? 0) + Math.round(techCost(game, p, id) * EUREKA_SHARE);
  const goal = EUREKAS[id].goal;
  for (const m of team) note(game, m.index, { text: `Eureka! ${eurekaDone(goal, m === p ? undefined : p.name)}: ${TECHS[id].name} is a third of the way researched.`, kind: 'tech' });
}
