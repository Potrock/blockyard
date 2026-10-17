import type { Advice, DealHelp, WorkAdvice } from './protocol';
import { danger, makeCtx, militaryAt, sameLand, type Ctx } from './rules/ai/context';
import type { Personality } from './rules/ai/personality';
import { pickProduction, roleOf, threatTo, wants } from './rules/ai/production';
import { bestSite, SITE_WORTH } from './rules/ai/settle';
import { chooseAim } from './rules/ai/strategy';
import { effectsValue } from './rules/ai/value';
import { jobFor, type Job } from './rules/ai/workers';
import { dealShortfall } from './rules/ai/diplomacy';
import { dealVerdict, diploHooks, luxuryCopies, tradeable, type Deal, type DealItem } from './rules/diplomacy';
import { BUILDINGS, SPACESHIP_PARTS } from './rules/buildings';
import { cityAt, knows, seesResource, techCost } from './rules/core';
import { cityYields, connected, isBuilding, tileYields, workable } from './rules/economy';
import { canBuild, canProduce, constructible, itemCost, trainable, type BuildWhat } from './rules/game';
import { distance, line, neighbours } from './rules/hex';
import type { City, Game, Player, Production, Tile, Unit } from './rules/state';
import { pathTo, TECH_LIST, TECHS } from './rules/techs';
import { FEATURES, IMPROVEMENTS, RESOURCES, tapsWith, TERRAINS, YIELD_KEYS, type ImprovementId, type Yields } from './rules/terrain';
import { isMilitary, UNIT_LIST, UNITS } from './rules/units';

/**
 * The advisor's recommendations for a person, Civilization V's way: what a city might build next,
 * what to research and what a worker might improve, and a bot's side of a deal being drawn up, weighed as the bots weigh such things
 * (`rules/ai`: what the empire wants, what a building would bring this city, what a tech unlocks,
 * what a tile's improvement is worth), from the person's own position (not their leader's tastes),
 * each with a few words of why. Only advice: nothing is ordered.
 */

/** A leader of no particular character: the advisor's, so a person's advice isn't their civ's leader's tastes (a gold-loving Harun's trading posts over farms). */
const NEUTRAL: Personality = { expansion: 5, wonder: 5, offense: 5, defense: 5, science: 5, culture: 5, faith: 5, gold: 5, diplomacy: 5, boldness: 5 };

/**
 * A bot's view of the game from a person's seat, without touching their player: the bots keep their
 * memory on the player (`memoryOf`), so the advisor reads through a copy of its own; with a neutral
 * character, and the victory the person's standing points to (`chooseAim`, weighed without a leader's leanings).
 */
function advisorCtx(game: Game, p: Player): Ctx {
  const ctx = makeCtx(game, { ...p, ai: undefined });
  ctx.pers = NEUTRAL;
  chooseAim(ctx);
  return ctx;
}

/** What a city might build next, and why (null: nothing it can build). */
export function adviseBuild(game: Game, p: Player, c: City): Advice | null {
  if (c.puppet) return null;
  const ctx = advisorCtx(game, p);
  const item = pickProduction(ctx, c);
  if (!item || !canProduce(game, p, c, item)) return null;
  // (Early, a second city first; and nothing that takes half an age in a weak city.)
  const settle = settlerFirst(ctx, c, item);
  if (settle) return settle;
  const quick = quicker(ctx, c, item);
  if (quick) return quick;
  return { kind: item.kind, id: item.id, why: buildWhy(ctx, c, item.kind, item.id) };
}

/** Turns a city takes to build something from scratch (at its production now). */
const turnsFor = (game: Game, c: City, item: Production) => Math.ceil(itemCost(game, item) / Math.max(1, cityYields(game, c).prod));

/** The longest build the advisor names in a city (turns): fewer while the game's young. */
const LONGEST = (game: Game) => (game.turn < 60 ? 12 : 18);

/**
 * Civ V's opening: a second city soon. While good land is free and the empire has few cities and no
 * settler on its way, a city of size 2 or more that grows (the capital; another from size 3) is
 * advised a Settler before the rest (scouting and defence aside, as the bots' own urgent builds have them).
 */
function settlerFirst(ctx: Ctx, c: City, item: Production): Advice | null {
  const { game, p } = ctx;
  if (item.kind === 'unit' && (item.id === 'settler' || UNITS[item.id]?.class === 'recon' || (isMilitary(UNITS[item.id]) && !militaryAt(ctx, c.tile)))) return null;
  if (game.turn > 120 || ctx.cities.length >= 4 || c.pop < (c.capital ? 2 : 3) || !trainable(game, p, c).includes('settler')) return null;
  if (game.units.some((u) => u.owner === p.index && u.type === 'settler') || ctx.cities.some((x) => x.queue[0]?.id === 'settler')) return null;
  // (Not from a city that's starving: one that only holds steady still can.)
  if (cityYields(game, c).surplus < 0) return null;
  const site = bestSite(ctx, c.tile);
  if (!site || site.score < SITE_WORTH) return null;
  return { kind: 'unit', id: 'settler', why: `Good land is free for a ${ordinal(ctx.cities.length + 1)} city: the sooner it's founded, the more it grows` };
}

const ordinal = (n: number) => (['', 'first', 'second', 'third', 'fourth', 'fifth'][n] ?? `${n}th`);

/**
 * Something quicker, when what the bots would build takes too long in this city (a Worker in 46
 * turns at 1 production): a garrison for a city without one, a Monument, a Worker or a Warrior, the
 * best that finishes in time (or, with nothing that does, the soonest done).
 */
function quicker(ctx: Ctx, c: City, item: Production): Advice | null {
  const { game, p } = ctx;
  const long = turnsFor(game, c, item);
  // (A Settler is worth its wait: a city grows the whole game.)
  if (long <= LONGEST(game) || (item.kind === 'unit' && item.id === 'settler')) return null;
  const can = new Set(trainable(game, p, c));
  const builds = new Set(constructible(game, p, c));
  const candidates: { item: Production; why: string }[] = [];
  // (Units of the person's own civ where it has one in place of the plain kind: the warrior first that it can train.)
  const soldier = [...can].filter((id) => isMilitary(UNITS[id]) && UNITS[id].domain === 'land' && UNITS[id].class !== 'recon' && UNITS[id].strength > 0 && roleOf(UNITS[id]) !== 'siege').sort((a, b) => itemCost(game, { kind: 'unit', id: a }) - itemCost(game, { kind: 'unit', id: b }))[0];
  if (soldier && !militaryAt(ctx, c.tile)) candidates.push({ item: { kind: 'unit', id: soldier }, why: `${c.name} has no garrison` });
  const monument = [...builds].find((id) => isBuilding(id, 'monument'));
  if (monument) candidates.push({ item: { kind: 'building', id: monument }, why: 'Culture to claim the land round the city' });
  if (can.has('worker') && wants(ctx).workers > game.units.filter((u) => u.owner === p.index && u.type === 'worker').length) candidates.push({ item: { kind: 'unit', id: 'worker' }, why: 'Your land wants improving: farms, mines, roads' });
  if (soldier) candidates.push({ item: { kind: 'unit', id: soldier }, why: 'A soldier: cheap, and always of use' });
  const fits = candidates.filter((x) => turnsFor(game, c, x.item) <= LONGEST(game));
  const pick = fits[0] ?? candidates.sort((a, b) => turnsFor(game, c, a.item) - turnsFor(game, c, b.item))[0];
  if (!pick || turnsFor(game, c, pick.item) >= long || (pick.item.kind === item.kind && pick.item.id === item.id)) return null;
  const name = item.kind === 'unit' ? UNITS[item.id]?.name : BUILDINGS[item.id]?.name;
  return { kind: pick.item.kind, id: pick.item.id, why: `${pick.why}; done in ${turnsFor(game, c, pick.item)} turns (${name ? `a ${name} would take ${long}` : `that would take ${long}`})` };
}

function buildWhy(ctx: Ctx, c: City, kind: string, id: string): string {
  if (kind === 'project') return 'The spaceship: the way to a science victory';
  if (kind === 'unit') {
    const t = UNITS[id];
    if (!t) return '';
    if (t.abilities?.includes('found_city')) return 'Good land is free for another city';
    if (t.abilities?.includes('build')) return 'Your land wants improving: farms, mines, roads';
    if (t.abilities?.includes('trade_route')) return 'A trade route would pay';
    if (t.class === 'recon') return 'To explore: ruins, neighbours, places for cities';
    if (isMilitary(t)) {
      if (threatTo(ctx, c) > 0.5) return 'Enemies are near: it needs defending';
      const role = roleOf(t);
      return wants(ctx).military > ctx.game.units.filter((u) => u.owner === ctx.me && isMilitary(UNITS[u.type])).length
        ? `Your army is small for your empire${role === 'ranged' ? ': archers hold a line' : ''}`
        : 'To keep up with your neighbours';
    }
    return '';
  }
  const b = BUILDINGS[id];
  if (!b) return '';
  if (id === 'apollo_program') return 'The way to the spaceship';
  if (id === 'united_nations') return 'The way to a diplomatic victory';
  if ((b.effects.happiness ?? 0) > 0 && ctx.mood < 3) return 'Your people are near discontent';
  if (b.kind === 'world') return 'A wonder within reach, worth its cost here';
  return 'The most this city gets for its production';
}

/** The techs worth heading for now (the best goal, and the next best), and why. */
export function adviseResearch(game: Game, p: Player): Advice[] {
  const ctx = advisorCtx(game, p);
  const known = new Set(p.techs);
  const frontier = Math.max(0, ...p.techs.map((t) => TECHS[t]?.col ?? 0));
  // The resources in reach of the person's cities (worked or not), as they know them.
  // (Each with the improvements that tap it where it lies: Oil at sea takes an Offshore Platform.)
  const resources = new Map<string, Set<ImprovementId>>();
  for (const tile of game.tiles) if (tile.owner === p.index && tile.resource && seesResource(p, tile.resource)) (resources.get(tile.resource) ?? resources.set(tile.resource, new Set()).get(tile.resource)!).add(tapsWith(tile)!);
  const scored: { id: string; score: number; why: string }[] = [];
  const full = landFull(ctx);
  for (const t of TECH_LIST) {
    if (known.has(t.id) || t.id === 'future_tech' || t.col > frontier + 2) continue;
    const way = pathTo(known, t.id);
    const cost = way.reduce((s, x) => s + techCost(game, p, x), 0);
    const { value, why } = techWorth(ctx, t.id, resources, full);
    scored.push({ id: t.id, score: value / Math.pow(Math.max(1, cost), 0.8), why });
  }
  scored.sort((a, b) => b.score - a.score);
  const out: Advice[] = [];
  for (const s of scored) {
    if (out.length >= 2) break;
    // (Two goals, not one and a step on the way to it.)
    if (out.some((o) => pathTo(known, o.id).includes(s.id) || pathTo(known, s.id).includes(o.id))) continue;
    out.push({ kind: 'tech', id: s.id, why: s.why });
  }
  return out;
}

/**
 * Whether there's no room left for a city on the person's own landmass, as far as they can tell:
 * they've seen all of it (no land of it they know borders land they don't), and the Settler lens
 * finds no site there worth a settler.
 */
function landFull(ctx: Ctx): boolean {
  const { game, p, capital } = ctx;
  if (!capital) return false;
  for (let t = 0; t < game.tiles.length; t++)
    if (p.explored[t] && !TERRAINS[game.tiles[t].terrain].water && sameLand(game, capital.tile, t) && neighbours(game.grid, t).some((n) => !p.explored[n])) return false;
  return ctx.cities.every((c) => {
    const site = bestSite(ctx, c.tile);
    return !site || site.score < SITE_WORTH || !sameLand(game, c.tile, site.tile);
  });
}

/**
 * What a tech is worth to the person now (as a bot would weigh it), and what it brings, in words.
 * Ordinary buildings count in every city they'd stand in (one at least); a wonder only as much as the
 * person could hope to win it (one that would take their capital an age is a long shot); the techs
 * that cross the water, when their own land is full; the units their land's strategic resources
 * would arm.
 */
function techWorth(ctx: Ctx, id: string, resources: Map<string, Set<ImprovementId>>, full: boolean): { value: number; why: string } {
  const { game, p } = ctx;
  let value = 1;
  const notes: { v: number; why: string; ordinary?: boolean }[] = [];
  const note = (v: number, why: string, ordinary = false) => {
    value += v;
    if (v > 0) notes.push({ v, why, ordinary });
  };
  const capitalProd = ctx.capital ? Math.max(1, cityYields(game, ctx.capital).prod) : 1;
  // (Every other civilization still in the game may be raising a wonder too: the more there are, the longer the odds.)
  const rivals = game.players.filter((o) => o !== p && o.alive && !o.cityState && o.civ !== 'barbarian').length;
  for (const b of Object.values(BUILDINGS)) {
    // (Not a wonder someone has built already.)
    if (b.tech !== id || b.unbuildable || (b.kind === 'world' && b.id in game.wonders) || (b.civ ? b.civ !== p.civ : Object.values(BUILDINGS).some((x) => x.civ === p.civ && x.replaces === b.id))) continue;
    const per = ctx.capital ? effectsValue(ctx, b.effects, ctx.capital) : 1;
    // A wonder: worth as much as it's likely to be the person's (the turns it would take their capital).
    const turns = itemCost(game, { kind: 'building', id: b.id }) / capitalProd;
    const reach = b.kind === 'world' ? ((0.4 + ctx.pers.wonder * 0.08) * Math.min(1, 25 / Math.max(1, turns))) / (1 + rivals * 0.25) : b.kind === 'national' ? 0.6 : Math.max(1, Math.min(4, ctx.cities.length) * 0.5);
    note(Math.max(0, per - b.upkeep * 0.6) * reach, `${b.name}${b.kind === 'world' ? ', a wonder' : b.kind === 'national' ? ', a national wonder' : ''}`, b.kind === 'building');
  }
  for (const u of UNIT_LIST) {
    if (u.tech !== id || u.unbuildable || (u.civ ? u.civ !== p.civ : UNIT_LIST.some((x) => x.civ === p.civ && x.replaces === u.id))) continue;
    if (u.abilities?.includes('trade_route')) note(2, `${plural(u.name)}: trade routes`);
    if (!isMilitary(u) || u.domain !== 'land') continue;
    note((Math.max(u.strength, u.ranged ?? 0) / (6 + ctx.era * 6)) * (ctx.pers.offense + ctx.pers.defense) * 0.12 * (ctx.wars.length ? 2 : 1), `${plural(u.name)}${ctx.wars.length ? ', for your war' : ''}`);
    // (Armed by a strategic resource in their land: Iron Working with Iron, Horseback Riding with Horses.)
    if (u.resource && resources.has(u.resource)) note(4, `${plural(u.name)}, with the ${RESOURCES[u.resource]?.name ?? u.resource} in your land`);
  }
  for (const [imp, i] of Object.entries(IMPROVEMENTS))
    if (i.tech === id)
      for (const [r, taps] of resources)
        if (taps.has(imp as ImprovementId)) note(RESOURCES[r].kind === 'luxury' ? 5 : 2, `${i.name.endsWith('s') ? i.name : `${i.name}s`} for your ${RESOURCES[r].name}${RESOURCES[r].kind === 'luxury' ? ' (happiness)' : ''}`);
  for (const [r, res] of Object.entries(RESOURCES)) if (res.reveal === id && !knows(p, id)) note(2 + ctx.pers.offense * 0.2, `Shows ${RESOURCES[r].name} on the map`);
  // Their land full: the way across the water to land free for cities.
  if (full) {
    if (id === 'sailing') note(5, 'Ships and work boats: your land is full, the sea is next');
    if (id === 'optics') note(14, 'Embarking: your land is full, and other shores are free to settle');
    if (id === 'astronomy') note(6, 'Ocean crossings, for settlers and ships alike');
  }
  if (id === 'pottery' || id === 'mining' || id === 'animal_husbandry' || id === 'calendar' || id === 'bronze_working') value += 2;
  if (SPACESHIP_PARTS.some((part) => part.tech === id) && knows(p, 'rocketry')) note(20, 'A part of the spaceship');
  // In words: the best of it, the best ordinary building it brings first if it counts for much (a
  // wonder after it, as a chance), else the best and that building.
  notes.sort((a, b) => b.v - a.v);
  const top = notes[0];
  const building = notes.find((n) => n.ordinary);
  const why = !top ? '' : !building || building === top ? top.why : building.v >= top.v * 0.4 ? `The ${building.why}; and the ${top.why}` : `${top.why}; and the ${building.why}`;
  return { value, why };
}

/** A kind of unit, more than one of it ('Swordsmen', 'Chariot Archers'). */
const plural = (name: string) => (name.endsWith('man') ? `${name.slice(0, -3)}men` : name.endsWith('s') ? name : `${name}s`);

/** How far round a worker its recommendations look (tiles), and how many improvements they name at most. */
const WORK_REACH = 4;
const WORK_TIPS = 4;

/**
 * What a worker might build near it, Civilization V's recommended improvements: the work a bot would
 * see on the person's land (`rules/ai/workers.ts`: a resource to hook up, a new luxury above all,
 * then the tiles their cities work, then the rest), on land, the nearer the better, out of enemies'
 * reach, not where one of their workers is busy already; and a road toward the capital for a city
 * not linked to it yet. Each with what it adds to the tile, and why.
 */
export function adviseWork(game: Game, p: Player, worker: Unit): Omit<WorkAdvice, 'unit'> {
  const ctx = advisorCtx(game, p);
  const far = (t: number) => distance(game.grid, worker.tile, t);
  const worked = new Set<number>();
  const land = new Set<number>();
  for (const c of ctx.cities) {
    for (const t of c.worked) worked.add(t);
    for (const t of workable(game, c)) land.add(t);
  }
  // The luxuries they have none of yet (a new one is happiness), as the bots reckon them.
  const owned = new Set<string>();
  for (const t of land) {
    const tile = game.tiles[t];
    if (tile.resource && tile.improvement === RESOURCES[tile.resource].improvement && !tile.pillaged) owned.add(tile.resource);
  }
  for (const c of ctx.cities) {
    const r = game.tiles[c.tile].resource;
    if (r) owned.add(r);
  }
  const luxNeeded = new Set<string>();
  for (const t of land) {
    const r = game.tiles[t].resource;
    if (r && RESOURCES[r].kind === 'luxury' && !owned.has(r)) luxNeeded.add(r);
  }
  // (Not its own work under way, nor another's; nor the sea, which work boats see to.)
  const busy = new Set(game.units.filter((u) => u.owner === p.index && u.work).map((u) => u.tile));
  const d = danger(ctx);
  const jobs: { job: Job; score: number }[] = [];
  // (Work there would be, but in enemies' reach.)
  let unsafe = false;
  for (const t of land) {
    if (far(t) > WORK_REACH || busy.has(t) || TERRAINS[game.tiles[t].terrain].water) continue;
    const found = jobFor(ctx, worker, t, worked, luxNeeded);
    if (!found || found.value <= 0) continue;
    // (A trading post where a farm could stand, for a city short of food: the farm. Gold's dear to a
    // treasury running low, but a city that can't grow is worse off.)
    const city = game.tiles[t].city !== undefined ? game.cities.find((c) => c.id === game.tiles[t].city) : undefined;
    const hungry = !!city && cityYields(game, city).surplus < 2;
    const job = found.what === 'trading_post' && hungry && canBuild(game, { ...worker, tile: t }, 'farm') ? { ...found, what: 'farm' as const } : found;
    if (d[t] > 0) unsafe = true;
    else jobs.push({ job, score: job.value - far(t) * 0.7 });
  }
  jobs.sort((a, b) => b.score - a.score);
  const tips: WorkAdvice['tips'] = jobs.slice(0, WORK_TIPS).map(({ job }) => ({ tile: job.tile, what: job.what, gain: gainOf(game, p, job.tile, job.what), why: workWhy(game, p, job, worked, luxNeeded) }));
  const road = linkRoad(ctx, worker, d);
  if (road && !tips.some((x) => x.tile === road.tile)) tips.push(road);
  if (tips.length) return { tips };
  return { tips, quiet: unsafe ? "Enemies could reach the land near it: no work advised there until it's safe" : `Nothing near it to improve (${WORK_REACH} tiles round): send it toward land your cities work` };
}

/** What building something on a tile would change in its yields (as they'd be, less as they are). */
function gainOf(game: Game, p: Player, t: number, what: BuildWhat): Yields {
  const tile = game.tiles[t];
  if (what === 'road' || what === 'rail') return {};
  const after: Tile = what === 'remove_feature' ? { ...tile, feature: undefined } : what === 'repair' ? { ...tile, pillaged: false } : { ...tile, improvement: what as ImprovementId };
  const tiles = game.tiles.slice();
  tiles[t] = after;
  const was = tileYields(game, t, p);
  const will = tileYields({ ...game, tiles }, t, p);
  const out: Yields = {};
  for (const k of YIELD_KEYS) if ((will[k] ?? 0) !== (was[k] ?? 0)) out[k] = (will[k] ?? 0) - (was[k] ?? 0);
  return out;
}

/** Why a worker's job is worth doing, in a few words. */
function workWhy(game: Game, p: Player, job: Job, worked: Set<number>, luxNeeded: Set<string>): string {
  const tile = game.tiles[job.tile];
  const city = tile.city !== undefined ? game.cities.find((c) => c.id === tile.city) : undefined;
  const r = tile.resource && seesResource(p, tile.resource) ? RESOURCES[tile.resource] : undefined;
  if (job.what === 'repair') return 'Mends what was pillaged: its yields come back';
  if (r && tapsWith(tile) === job.what) {
    if (r.kind === 'luxury') return luxNeeded.has(tile.resource!) ? `Your first ${r.name}: happiness in every city` : `More ${r.name}, to trade`;
    return r.kind === 'strategic' ? `${r.name} for your units and buildings` : `Makes the most of the ${r.name}`;
  }
  if (job.what === 'remove_feature' && tile.feature) return `Clears the ${FEATURES[tile.feature].name}, for a farm after`;
  if (job.what === 'farm' && city && cityYields(game, city).surplus < 2) return `${city.name} has little food to grow on`;
  if (city && worked.has(job.tile)) return `${city.name} works this tile`;
  return city ? `For ${city.name}, as it grows` : 'For your land';
}

/**
 * A road toward the capital for one of the person's cities not linked to it (Civ V's city
 * connections): on the straight way from that city to the nearest linked one, over land that's
 * theirs or no one's, the tile of it near the worker, out of enemies' reach, nearest it (null: none).
 */
function linkRoad(ctx: Ctx, worker: Unit, d: Float32Array): WorkAdvice['tips'][number] | null {
  const { game, p } = ctx;
  if (!knows(p, 'the_wheel') || !ctx.capital) return null;
  const linked = connected(game, p);
  let best: { tile: number; far: number; city: City } | null = null;
  for (const c of ctx.cities) {
    if (linked.has(c.id)) continue;
    const to = ctx.cities.filter((x) => linked.has(x.id)).sort((a, b) => distance(game.grid, a.tile, c.tile) - distance(game.grid, b.tile, c.tile))[0];
    if (!to) continue;
    const way = line(game.grid, c.tile, to.tile);
    if (!way.every((t) => !TERRAINS[game.tiles[t].terrain].water && game.tiles[t].elevation !== 'mountain' && (game.tiles[t].owner === p.index || game.tiles[t].owner < 0))) continue;
    for (const t of way) {
      const far = distance(game.grid, worker.tile, t);
      if (far > WORK_REACH || d[t] > 0 || cityAt(game, t) || !canBuild(game, { ...worker, tile: t }, 'road')) continue;
      if (!best || far < best.far) best = { tile: t, far, city: c };
    }
  }
  return best && { tile: best.tile, what: 'road', gain: {}, why: `A road to link ${best.city.name} to your capital` };
}

// -------------------------------------------------------------------------------------------------
// Deals: what would make one work, what a bot would give for one (Civ V's buttons at the table)
// -------------------------------------------------------------------------------------------------

/** Whether two items are the same thing (amounts aside). */
const sameItem = (a: DealItem, b: DealItem) => a.kind === b.kind && ('from' in a ? 'from' in b && a.from === b.from : true) && ('resource' in a ? 'resource' in b && a.resource === b.resource : true);

/** What one civ could put into a deal with another (beyond gold): spare luxuries the other lacks, strategic resources, open borders, an embassy. */
function couldGive(game: Game, from: Player, to: Player): DealItem[] {
  const out: DealItem[] = [];
  const t = tradeable(game, from);
  for (const [r, n] of t.luxuries) if (n >= 2 && !luxuryCopies(game, to).get(r)) out.push({ kind: 'luxury', from: from.index, resource: r });
  for (const [r, n] of Object.entries(t.strategic)) out.push({ kind: 'strategic', from: from.index, resource: r, amount: Math.min(n, 2) });
  out.push({ kind: 'openBorders', from: from.index }, { kind: 'embassy', from: from.index });
  return out;
}

/**
 * The fewest (`least`) or the most of an amount from 1 to `most` for which `ok` holds (null: none),
 * `ok` holding from some amount up (`least`) or up to some amount (not).
 */
function search(most: number, ok: (n: number) => boolean, least: boolean): number | null {
  if (most < 1 || !(least ? ok(most) : ok(1))) return null;
  let lo = 1;
  let hi = most;
  while (lo < hi) {
    if (least) {
      const mid = Math.floor((lo + hi) / 2);
      if (ok(mid)) hi = mid;
      else lo = mid + 1;
    } else {
      const mid = Math.ceil((lo + hi) / 2);
      if (ok(mid)) lo = mid;
      else hi = mid - 1;
    }
  }
  return lo;
}

/**
 * "What would make this deal work?": a bot asked to add what it would want from the person's side
 * until it would take the deal: the things it values most first (a luxury it lacks, a strategic
 * resource it's short of, open borders, an embassy), then the least gold that settles it (a sum, or
 * so much a turn). Or, if nothing the person has would do (a leader who hates them won't deal at
 * all), why not.
 */
export function balanceDeal(game: Game, person: Player, bot: Player, items: DealItem[]): DealHelp {
  const deal = (list: DealItem[]): Deal => ({ from: person.index, to: bot.index, items: list });
  const valid = (list: DealItem[]) => dealVerdict(game, deal(list)).valid;
  const takes = (list: DealItem[]) => valid(list) && diploHooks.evaluate(game, bot, deal(list)).accept;
  const first = diploHooks.evaluate(game, bot, deal(items));
  if (first.accept) return { items, text: `${bot.name} would take it as it stands` };
  const list = [...items];
  let short = dealShortfall(game, bot, deal(list));
  for (let added = 0; short > 0 && added < 4; added++) {
    let best: { item: DealItem; short: number } | null = null;
    for (const item of couldGive(game, person, bot)) {
      if (list.some((x) => sameItem(x, item)) || !valid([...list, item])) continue;
      const after = dealShortfall(game, bot, deal([...list, item]));
      if (after < short && (!best || after < best.short)) best = { item, short: after };
    }
    if (!best) break;
    list.push(best.item);
    short = best.short;
  }
  if (takes(list)) return { items: list, text: `${bot.name} would take it with what it asks for` };
  // The rest in gold: the least sum that settles it, or the least a turn.
  const without = list.filter((x) => !((x.kind === 'gold' || x.kind === 'goldPerTurn') && x.from === person.index));
  const sum = search(Math.floor(person.gold), (n) => takes([...without, { kind: 'gold', from: person.index, amount: n }]), true);
  if (sum !== null) return { items: [...without, { kind: 'gold', from: person.index, amount: sum }], text: `${bot.name} would take it with what it asks for` };
  const perTurn = search(Math.floor(person.lastIncome?.gold ?? 0), (n) => takes([...without, { kind: 'goldPerTurn', from: person.index, amount: n }]), true);
  if (perTurn !== null) return { items: [...without, { kind: 'goldPerTurn', from: person.index, amount: perTurn }], text: `${bot.name} would take it with what it asks for` };
  return { items: null, text: `Nothing you have would do. ${bot.name}: “${first.why ?? 'we want more'}”` };
}

/**
 * "What will you give me for this?": a bot asked to fill its side of the deal with what it would
 * give for what the person offers, as much as it would still call a fair trade: a luxury the person
 * lacks, then gold (a sum, or so much a turn). Or, if it doesn't want what's offered, why not.
 */
export function counterOffer(game: Game, person: Player, bot: Player, items: DealItem[]): DealHelp {
  const deal = (list: DealItem[]): Deal => ({ from: person.index, to: bot.index, items: list });
  const takes = (list: DealItem[]) => dealVerdict(game, deal(list)).valid && diploHooks.evaluate(game, bot, deal(list)).accept;
  const first = diploHooks.evaluate(game, bot, deal(items));
  if (!first.accept) return { items: null, text: `${bot.name} doesn't want that${first.why ? `: ${first.why}` : ''}` };
  const list = [...items];
  // A luxury the person lacks, if the bot would still take the deal with it given.
  for (const item of couldGive(game, bot, person)) {
    if (item.kind !== 'luxury' || list.some((x) => sameItem(x, item))) continue;
    if (takes([...list, item])) {
      list.push(item);
      break;
    }
  }
  const sum = search(Math.floor(bot.gold), (n) => takes([...list, { kind: 'gold', from: bot.index, amount: n }]), false);
  if (sum !== null) list.push({ kind: 'gold', from: bot.index, amount: sum });
  else {
    const perTurn = search(Math.floor(bot.lastIncome?.gold ?? 0), (n) => takes([...list, { kind: 'goldPerTurn', from: bot.index, amount: n }]), false);
    if (perTurn !== null) list.push({ kind: 'goldPerTurn', from: bot.index, amount: perTurn });
  }
  return list.length > items.length ? { items: list, text: `${bot.name} would give this for it` } : { items: null, text: `${bot.name} would take it, but give nothing for it` };
}
