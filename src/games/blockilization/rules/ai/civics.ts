import { BUILDINGS, SPACESHIP_PARTS } from '../buildings';
import { knows, seesResource, techCost } from '../core';
import type { GreatKind } from '../effects';
import { dissent, policyCost } from '../economy';
import { canChooseIdeology, eraOf, ideologySwitch, reformationDue, SWITCH_DISSENT } from '../game';
import { adoptable, ALL_POLICIES, IDEOLOGIES, TREES, treeOpen, type Policy } from '../policies';
import { BELIEF_LIST, pantheonCost, takenBeliefs, type BeliefKind } from '../religion';
import { teamOf } from '../teams';
import { canResearch, pathTo, TECH_LIST, TECHS } from '../techs';
import { IMPROVEMENTS, RESOURCES } from '../terrain';
import { isMilitary, UNIT_LIST, UNITS } from '../units';
import { act, coastal, diplomaticRival, type Ctx } from './context';
import { cityCap, wants } from './production';
import { effectsValue, yieldWeights } from './value';

/**
 * A bot's research, policies, ideology and beliefs. Research heads for a goal: the tech whose
 * unlocks are worth most to it (buildings and wonders valued as the cities would value them, units by
 * its love of war, improvements by the resources in its land), with a pull toward what its victory
 * needs (the spaceship's techs for science, the United Nations for diplomacy). Policies fill the trees
 * its aim and character favour, finishing what it opened; beliefs are chosen for what they'd give.
 */

/** What each tech unlocks (worked out once). */
const UNLOCKS: Record<string, { buildings: string[]; units: string[]; improvements: string[]; reveals: string[] }> = {};
for (const t of TECH_LIST) UNLOCKS[t.id] = { buildings: [], units: [], improvements: [], reveals: [] };
for (const b of Object.values(BUILDINGS)) if (b.tech && UNLOCKS[b.tech] && !b.unbuildable) UNLOCKS[b.tech].buildings.push(b.id);
for (const u of UNIT_LIST) if (u.tech && UNLOCKS[u.tech] && !u.unbuildable) UNLOCKS[u.tech].units.push(u.id);
for (const [id, imp] of Object.entries(IMPROVEMENTS)) if (imp.tech && UNLOCKS[imp.tech]) UNLOCKS[imp.tech].improvements.push(id);
for (const [id, r] of Object.entries(RESOURCES)) if (r.reveal && UNLOCKS[r.reveal]) UNLOCKS[r.reveal].reveals.push(id);

/** Techs each victory leans on, and how hard. */
const AIM_TECHS: Record<string, Record<string, number>> = {
  science: { writing: 4, philosophy: 4, education: 6, astronomy: 3, scientific_theory: 6, electricity: 3, computers: 6, rocketry: 14, satellites: 12, advanced_ballistics: 12, particle_physics: 12, nanotechnology: 12, robotics: 6, plastics: 4 },
  culture: { drama: 5, philosophy: 3, theology: 3, acoustics: 6, architecture: 5, archaeology: 8, radio: 8, refrigeration: 8, flight: 6, plastics: 4, ecology: 4 },
  diplomatic: { writing: 3, currency: 4, philosophy: 3, banking: 5, printing_press: 4, economics: 4, electricity: 3, globalization: 16, telecommunications: 6, ecology: 4 },
  domination: { bronze_working: 4, archery: 2, mathematics: 5, iron_working: 5, horseback_riding: 3, construction: 3, civil_service: 3, chivalry: 4, physics: 5, steel: 5, gunpowder: 6, chemistry: 5, metallurgy: 4, rifling: 6, dynamite: 6, military_science: 4, replaceable_parts: 5, combustion: 6, plastics: 4, combined_arms: 6, robotics: 4 },
};

/** A tech's worth to the bot now: what it unlocks, and what its victory needs. */
function techValue(ctx: Ctx, id: string, resources: Set<string>): number {
  const { pers, mem, p } = ctx;
  const u = UNLOCKS[id];
  let v = 1;
  for (const b of u.buildings) {
    const bd = BUILDINGS[b];
    if (bd.civ && bd.civ !== p.civ) continue;
    const per = ctx.capital ? effectsValue(ctx, bd.effects, ctx.capital) : 1;
    v += Math.max(0, per - bd.upkeep * 0.6) * (bd.kind === 'world' ? 0.4 + pers.wonder * 0.08 : bd.kind === 'national' ? 0.6 : Math.min(4, ctx.cities.length) * 0.5);
  }
  for (const uid of u.units) {
    const t = UNITS[uid];
    if (t.civ && t.civ !== p.civ) continue;
    if (!isMilitary(t) || t.domain !== 'land') continue;
    v += (Math.max(t.strength, t.ranged ?? 0) / (6 + ctx.era * 6)) * (pers.offense + pers.defense) * 0.12 * (ctx.wars.length || mem.plan ? 2 : 1);
  }
  for (const imp of u.improvements) for (const r of resources) if (RESOURCES[r].improvement === imp) v += RESOURCES[r].kind === 'luxury' ? 5 : 2;
  v += u.reveals.length * (2 + pers.offense * 0.2);
  if (id === 'pottery' || id === 'mining' || id === 'animal_husbandry' || id === 'calendar' || id === 'bronze_working') v += 2;
  v += (AIM_TECHS[mem.aim]?.[id] ?? 0) * (ctx.era >= 5 ? 2.5 : 1);
  if (id === 'globalization' && ctx.game.settings.victories.diplomatic) v += diplomaticRival(ctx) !== null ? 25 : 3;
  return v;
}

/** Research: toward the goal with the best worth for its cost; a new goal when that's reached. */
export function research(ctx: Ctx) {
  const { game, p, mem } = ctx;
  // A team researches together: a person's choice stands; on a team of bots, the first of them chooses.
  const team = teamOf(game, ctx.me);
  if (team.length > 1 && p.researching && (team.some((m) => !m.bot) || team.find((m) => m.bot) !== p)) return;
  const known = new Set(p.techs);
  if (p.researching && mem.techGoal && !known.has(mem.techGoal) && (p.techQueue.length || p.researching === mem.techGoal)) return;
  const resources = new Set<string>();
  for (const c of ctx.cities) for (const t of c.worked) if (game.tiles[t].resource && seesResource(p, game.tiles[t].resource)) resources.add(game.tiles[t].resource!);
  for (const tile of game.tiles) if (tile.owner === ctx.me && tile.resource) resources.add(tile.resource);
  // The space race's parts' techs, for a bot going to the stars once it's close.
  const space = mem.aim === 'science' && knows(p, 'rocketry');
  let best: string | null = null;
  let bestScore = -Infinity;
  const frontier = Math.max(0, ...p.techs.map((t) => TECHS[t].col));
  const hemmed = !knows(p, 'optics') && game.turn < 150 && ctx.cities.length > 0 && ctx.cities.length < cityCap(ctx) && wants(ctx).settlers === 0 && ctx.cities.some((c) => coastal(game, c.tile));
  for (const t of TECH_LIST) {
    if (known.has(t.id) || t.id === 'future_tech' || t.col > frontier + 2) continue;
    const way = pathTo(known, t.id);
    const cost = way.reduce((s, x) => s + techCost(game, p, x), 0);
    let value = techValue(ctx, t.id, resources);
    if (space && SPACESHIP_PARTS.some((part) => part.tech === t.id)) value += 30;
    // (A faithful leader wants its shrine, and a pantheon, early.)
    if (t.id === 'pottery' && ctx.pers.faith >= 6 && !p.pantheon) value += 12;
    // (Hemmed in on its land, with room for more cities: Optics, to settle over the water.)
    if (t.id === 'optics' && hemmed) value += 15;
    const score = value / Math.pow(cost, 0.8);
    if (score > bestScore) (bestScore = score), (best = t.id);
  }
  if (!best) {
    if (canResearch(known, 'future_tech') && p.researching !== 'future_tech') act(ctx, { t: 'research', tech: 'future_tech' });
    return;
  }
  mem.techGoal = best;
  act(ctx, { t: 'research', tech: best });
}

/** How much the bot likes each policy tree (by its aim and character). */
function treeLiking(ctx: Ctx, tree: string): number {
  const { pers, mem } = ctx;
  const wide = pers.expansion >= 6;
  switch (tree) {
    case 'tradition':
      return (wide ? 3 : 7) + (mem.aim === 'culture' ? 2 : 0);
    case 'liberty':
      return (wide ? 7 : 3) + (mem.aim === 'diplomatic' ? 1 : 0);
    case 'honor':
      return pers.offense * 0.7 + (mem.aim === 'domination' ? 3 : 0) - 2;
    case 'piety':
      return pers.faith * 0.8 - (mem.aim === 'science' ? 4 : 0) - 1;
    case 'patronage':
      return pers.diplomacy * 0.5 + (mem.aim === 'diplomatic' ? 6 : 0);
    case 'aesthetics':
      return pers.culture * 0.5 + (mem.aim === 'culture' ? 6 : 0);
    case 'commerce':
      return pers.gold * 0.6 + (mem.aim === 'diplomatic' ? 2 : 0);
    case 'exploration':
      return 1;
    case 'rationalism':
      return pers.science * 0.6 + (mem.aim === 'science' ? 6 : 0) + 2;
    default:
      return 3;
  }
}

/** Social policies, while culture allows: the best of those open, finishing a tree before opening another. */
export function policies(ctx: Ctx) {
  const { game, p } = ctx;
  ideology(ctx);
  // (Tenets of an ideology newly taken by revolution may come free.)
  const free = () => (p.freeTenets ?? 0) > 0 && p.culture < policyCost(game, p);
  for (let i = 0; i < 3 && (p.culture >= policyCost(game, p) || free()); i++) {
    const options = adoptable(p, eraOf(p)).filter((x) => !free() || ALL_POLICIES[x.id]?.tree === p.ideology);
    if (!options.length) return;
    const score = (x: Policy) => {
      const tree = TREES.find((t) => t.id === x.tree);
      const liking = tree ? treeLiking(ctx, tree.id) : 6;
      const open = tree && treeOpen(p, tree.id) ? 4 : 0;
      return liking + open + effectsValue(ctx, x.effects, null) * 0.25;
    };
    const pick = options.sort((a, b) => score(b) - score(a))[0];
    if (!act(ctx, { t: 'policy', id: pick.id })) return;
  }
}

/**
 * An ideology as soon as one can be chosen: Autocracy for a conqueror, Order for a builder of many
 * cities, Freedom for the rest; and later, a revolution its people call for, when it's worth it.
 */
export function ideology(ctx: Ctx) {
  const { game, pers, mem, p } = ctx;
  // A people that would overthrow its ideology for another (Civ V's revolution): the bot lets them,
  // once their discontent outweighs the tenets it would lose (or the empire's unhappy).
  const to = ideologySwitch(game, p);
  if (to) {
    const tenets = p.policies.filter((x) => ALL_POLICIES[x]?.tree === p.ideology).length;
    if (dissent(game, p) >= SWITCH_DISSENT + Math.max(0, tenets - 2) || ctx.mood < 0) act(ctx, { t: 'switchIdeology', id: to });
    return;
  }
  if (!canChooseIdeology(game, p)) return;
  const scores: Record<string, number> = {
    freedom: pers.culture * 0.6 + pers.diplomacy * 0.4 + (mem.aim === 'culture' || mem.aim === 'diplomatic' ? 5 : 0),
    order: pers.expansion * 0.5 + pers.science * 0.4 + (mem.aim === 'science' ? 4 : 0) + (ctx.cities.length >= 6 ? 2 : 0),
    autocracy: pers.offense * 0.7 + pers.boldness * 0.3 + (mem.aim === 'domination' ? 6 : 0),
  };
  const pick = IDEOLOGIES.map((i) => i.id).sort((a, b) => scores[b] - scores[a])[0];
  act(ctx, { t: 'ideology', id: pick });
}

/** The best belief of a kind still open (by what it would give the bot). */
export function bestBelief(ctx: Ctx, kind: BeliefKind, taken = takenBeliefs(ctx.game)): string | undefined {
  const w = yieldWeights(ctx);
  const special: Record<string, number> = {
    tithe: 3 * w.gold,
    church_property: 2.5 * w.gold,
    pilgrimage: 3 * w.faith,
    world_church: 2 * w.culture,
    ceremonial_burial: 2 * w.happiness,
    initiation_rites: 2,
    papal_primacy: ctx.mem.aim === 'diplomatic' ? 5 : 1,
    peace_loving: 1.5 * w.happiness,
    interfaith_dialogue: 1.5,
    building_pagoda: 2 * w.happiness + 2 * w.culture,
    building_cathedral: 3 * w.happiness,
    building_mosque: w.happiness + 2 * w.culture + 2 * w.faith,
    building_monastery: 2 * w.culture + 2 * w.faith,
    feed_the_world: ctx.cities.length * 0.8 * w.food,
    guruship: 1.5 * w.prod,
    religious_community: 2 * w.prod,
    plowshares: ctx.pers.offense < 5 ? 3 : 1,
    asceticism: ctx.cities.length * 0.5 * w.happiness,
    choral_music: ctx.cities.length * 0.6 * w.culture,
    liturgical_drama: ctx.cities.length * 0.4 * w.happiness,
    missionary_zeal: ctx.pers.faith * 0.3,
    holy_warriors: ctx.pers.offense * 0.2,
    just_war: ctx.pers.offense * 0.3,
    messiah: ctx.pers.faith * 0.2,
    reliquary: 1,
    god_king: 4,
    love: 2,
    craftsmen: ctx.cities.length * 0.6,
    river_happy: 2,
    faith_from_kills: ctx.pers.offense * 0.15,
    natural_wonder_faith: 0.5,
    shrine_culture: ctx.cities.length * 0.5 * w.culture,
    charitable_missions: ctx.mem.aim === 'diplomatic' ? 5 : ctx.pers.diplomacy * 0.3,
    buy_science_buildings: ctx.mem.aim === 'science' ? 4 : ctx.pers.science * 0.3,
  };
  let best: string | undefined;
  let bestScore = -Infinity;
  for (const b of BELIEF_LIST) {
    if (b.kind !== kind || taken.has(b.id)) continue;
    const e = { ...b.effects, special: undefined };
    let s = effectsValue(ctx, e, null) + (b.effects.special ?? []).reduce((x, id) => x + (special[id] ?? 1), 0);
    s += ((b.id.length * 7 + ctx.me * 3) % 5) * 0.05;
    if (s > bestScore) (bestScore = s), (best = b.id);
  }
  return best;
}

/** A pantheon as soon as there's faith for one; a Reformation belief when one's due. */
export function pantheon(ctx: Ctx) {
  const { game, p } = ctx;
  if (reformationDue(game, p)) {
    const belief = bestBelief(ctx, 'reformation');
    if (belief) act(ctx, { t: 'reformation', belief });
  }
  if (p.pantheon || p.cityState || p.faith < pantheonCost(game)) return;
  const pick = bestBelief(ctx, 'pantheon');
  if (pick) act(ctx, { t: 'pantheon', belief: pick });
}

/**
 * A free great person of the bot's choosing: what its victory wants (a scientist for the spaceship, a
 * writer, artist or musician for culture as there are slots for their works, a merchant for the
 * city-states, a general in a war of its own), else an engineer for the wonders.
 */
export function greatChoice(ctx: Ctx) {
  const { p, mem } = ctx;
  if (!p.greatChoices) return;
  const slots = (kind: 'art' | 'writing' | 'music') => ctx.cities.reduce((n, c) => n + c.buildings.reduce((x, b) => x + (BUILDINGS[b]?.effects.greatWorks?.kind === kind ? BUILDINGS[b].effects.greatWorks!.slots - (c.works?.[b]?.length ?? 0) : 0), 0), 0);
  let kind: GreatKind = 'engineer';
  if (mem.aim === 'science') kind = 'scientist';
  else if (mem.aim === 'culture') kind = slots('art') > 0 ? 'artist' : slots('music') > 0 ? 'musician' : 'writer';
  else if (mem.aim === 'diplomatic') kind = 'merchant';
  else if (mem.plan || ctx.wars.length) kind = 'general';
  for (let i = p.greatChoices; i > 0; i--) if (!act(ctx, { t: 'greatChoice', kind })) return;
}
