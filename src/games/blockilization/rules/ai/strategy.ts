import { allyOf, cityStates } from '../citystates';
import { cityMaxHp, cityStrength } from '../combat';
import { friends, pacted, warWords, type WarWhy } from '../diplomacy';
import { capitalOf, citiesOf, knows, note, random } from '../core';
import { score } from '../game';
import { within } from '../hex';
import type { City, Game, Player } from '../state';
import { teamedWithPeople, teammates, teamOf } from '../teams';
import { TERRAINS } from '../terrain';
import { majors, tourismOf, unVote } from '../trade';
import { act, cityOn, coastal, dist, landRoute, makeCtx, mightOf, nearestCity, runaways, sameLand, seaRoute, unitMight, type Ctx } from './context';
import type { Aim, WarPlan } from './memory';
import { armyNear, armyReady } from './military';
import { nearVictory, opinionOf, stanceOf, WARMONGER } from './opinion';
import { armyNeed, cityCap, isSoldier, wants } from './production';
import { aimLeaning } from './personality';

/**
 * A bot's grand strategy: the victory it works toward (by its leader's character, then by how the
 * game goes: ahead in science, it reaches for the stars; rich in friends among the city-states, for
 * the United Nations), its wars (a weaker neighbour it can reach by land, an army gathered at the
 * border before war is declared, then the cities taken one by one) and its peace (when the war goes
 * badly, has gone on too long for its temper, or has won what it wanted).
 */

const AIMS: Aim[] = ['domination', 'science', 'culture', 'diplomatic'];

/**
 * The race for the original capitals (each major civ's first city): those of the others the bot (with
 * its team) holds, and those still to take. Pressing: a domination victory is on, and it holds as many
 * as are left (one fewer for a conqueror), so it carries its wars through to the rest.
 */
export function capitalsRace(ctx: Ctx): { held: number; left: City[]; pressing: boolean } {
  const { game } = ctx;
  const ours = (i: number) => i === ctx.me || teammates(game, i, ctx.me);
  const firsts = game.cities.filter((c) => c.founder !== undefined && game.players[c.founder] && !game.players[c.founder].cityState && game.players[c.founder].civ !== 'barbarian' && !ours(c.founder) && game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c);
  const held = firsts.filter((c) => ours(c.owner)).length;
  const left = firsts.filter((c) => !ours(c.owner));
  return { held, left, pressing: game.settings.victories.domination && held >= 1 && held >= left.length - (ctx.mem.aim === 'domination' ? 1 : 0) };
}

/** Pick (or keep) the victory to work toward: every 20 turns, by character and standing. */
export function chooseAim(ctx: Ctx) {
  const { game, p, mem } = ctx;
  if (mem.aimed && game.turn - mem.aimed < 20) return;
  const lean = aimLeaning(ctx.pers);
  const rivals = majors(game).filter((o) => o.alive && o !== p);
  const v = game.settings.victories;
  const avg = (f: (o: Player) => number) => rivals.reduce((s, o) => s + f(o), 0) / Math.max(1, rivals.length);
  const techLead = (p.techs.length - avg((o) => o.techs.length)) / Math.max(5, avg((o) => o.techs.length));
  const mightLead = mightOf(ctx, ctx.me) / Math.max(1, avg((o) => mightOf(ctx, o.index)));
  const cultureLead = (p.lifetimeCulture + 1) / Math.max(1, avg((o) => o.lifetimeCulture + 1));
  const allies = cityStates(game).filter((cs) => allyOf(game, cs.index) === ctx.me).length;
  const wonders = Object.values(game.wonders).filter((w) => w === ctx.me).length;
  const works = ctx.cities.reduce((n, c) => n + Object.values(c.works ?? {}).reduce((x, w) => x + w.length, 0), 0);
  const neighbours = rivals.filter((o) => citiesOf(game, o.index).some((c) => ctx.cities.some((m) => sameLand(game, c.tile, m.tile) && dist(ctx, c.tile, m.tile) <= 14))).length;
  const scores: Record<Aim, number> = {
    domination: lean.domination + (mightLead - 1) * 5 + (neighbours ? 1 : -6) + (capitalsRace(ctx).pressing ? 8 : 0) + (v.domination ? 0 : -100),
    science: lean.science + techLead * 15 + (v.science ? 0 : -100),
    culture: lean.culture + (cultureLead - 1) * 3 + wonders * 0.25 + works * 0.6 + (v.culture ? 0 : -100),
    diplomatic: lean.diplomatic + allies * 1.5 + (cityStates(game).length >= 2 ? 0 : -8) + (v.diplomatic ? 0 : -100),
  };
  // A little of each leader's own taste, so two alike don't always choose alike; and the aim it has, kept.
  AIMS.forEach((a, i) => (scores[a] += ((ctx.me * 7 + i * 3 + Math.floor(game.turn / 60)) % 5) * 0.35));
  // The aim it has is kept unless another is clearly better (and more firmly once the game's late).
  if (mem.aimed) scores[mem.aim] += game.turn > 150 ? 6 : 3;
  mem.aim = [...AIMS].sort((a, b) => scores[b] - scores[a])[0];
  mem.aimed = game.turn;
}

/** Keep the records of wars begun and ended (by the bot or against it). */
export function trackWars(ctx: Ctx) {
  const { game, mem } = ctx;
  for (const w of ctx.wars)
    if (!mem.wars[w]) mem.wars[w] = { since: game.turn, ours: mem.plan?.target === w, myCities: ctx.cities.length, theirCities: citiesOf(game, w).length, myMight: mightOf(ctx, ctx.me), theirMight: mightOf(ctx, w) };
  for (const k of Object.keys(mem.wars)) if (!ctx.wars.includes(Number(k))) delete mem.wars[Number(k)];
}

/** How a war is going for the bot (above 0: well; below: badly). */
export function warScore(ctx: Ctx, them: number): number {
  const rec = ctx.mem.wars[them];
  if (!rec) return 0;
  const lost = rec.myCities - ctx.cities.length;
  const took = rec.theirCities - citiesOf(ctx.game, them).length;
  const mine = mightOf(ctx, ctx.me) / Math.max(1, rec.myMight);
  const theirs = mightOf(ctx, them) / Math.max(1, rec.theirMight);
  const ratio = mightOf(ctx, ctx.me) / Math.max(1, mightOf(ctx, them));
  return took * 25 - lost * 35 + (mine - theirs) * 20 + Math.max(-20, Math.min(20, (ratio - 1) * 15));
}

/** Whether the bot would make peace with a player now. */
export function wantsPeace(ctx: Ctx, them: number): boolean {
  const { game, mem, pers } = ctx;
  const other = game.players[them];
  if (!other?.alive || other.civ === 'barbarian') return false;
  if (mem.passive) return true;
  if (other.cityState) return !(mem.plan?.target === them);
  // (On a team with people, they make the team's peace.)
  if (teamedWithPeople(game, ctx.me)) return false;
  const rec = mem.wars[them];
  const turns = rec ? game.turn - rec.since : 0;
  const ws = warScore(ctx, them);
  // Losing: peace.
  if (ws < -25 - pers.boldness * 2) return true;
  // Its own war: fought on while it's taking cities (or still might), given up when it stalls past
  // the leader's patience or the army can't be gathered again.
  const plan = mem.plan;
  if (plan?.target === them && plan.stage !== 'muster') {
    // A people in deep discontent can bear no more conquest: peace, to settle what's been taken (a
    // conqueror pressing for the capitals bears more, against one that holds one of them).
    const race = capitalsRace(ctx);
    const holds = race.pressing && race.left.some((c) => c.owner === them);
    if (ctx.mood <= (holds ? -12 : -8)) return true;
    // A conqueror at their capital's walls, its guns in place and the walls falling, sees it through.
    const city = game.cities.find((c) => c.id === plan.city);
    if (mem.aim === 'domination' && plan.stage === 'attack' && city?.capital && city.hp < cityMaxHp(game, city) * 0.75) {
      const guns = game.units.filter((u) => u.owner === ctx.me && isSoldier(u) && dist(ctx, u.tile, city.tile) <= 2).length;
      if (guns >= 3) return false;
    }
    // (A war across the water takes longer: the army sails, and lands in waves.)
    const patience = 18 + pers.boldness + pers.offense * 0.5 + (mem.aim === 'domination' ? 10 : 0) + (holds ? 15 : 0) + (plan.amphibious ? 12 : 0);
    if (plan.stage === 'regroup' && game.turn - (plan.changed ?? game.turn) > 20) return true;
    return game.turn - (plan.taken ?? rec?.since ?? game.turn) > patience;
  }
  // Someone else's war on it: once it's held them off for a while.
  if (rec && !rec.ours) return turns >= 8 && ws > -10 ? true : turns >= 20;
  return turns >= 6;
}

/** Whether a bot accepts another's offer of peace (the rules ask, once a turn). */
export function acceptsPeace(game: Game, bot: Player, from: Player): boolean {
  const ctx = makeCtx(game, bot);
  trackWars(ctx);
  return wantsPeace(ctx, from.index);
}

/** Offer peace where the bot wants it (to a person, every few turns; to a bot, it's decided at once). */
export function makePeace(ctx: Ctx) {
  const { game, mem } = ctx;
  for (const w of ctx.wars) {
    if (!wantsPeace(ctx, w)) continue;
    const them = game.players[w];
    if (!them.bot && (game.turn - (mem.wars[w]?.since ?? 0)) % 6 !== 0) continue;
    if (act(ctx, { t: 'peace', target: w }) && mem.plan?.target === w && !ctx.game.players[ctx.me].diplomacy.war[w]) mem.plan = undefined;
  }
  if (mem.plan && mem.plan.stage !== 'muster' && !ctx.p.diplomacy.war[mem.plan.target]) mem.plan = undefined;
}

/**
 * A civ's city to strike first, if the bot's army can reach one: the nearest, weakest it knows of
 * (its own lost cities first), on its own land or across the water on a coast its army can sail to (a
 * harder war, though the miles go quicker at sea); how far it is, all told.
 */
function targetCity(ctx: Ctx, o: Player): { city: number; near: number; amphibious: boolean } | null {
  const { game, p, mem } = ctx;
  let city: number | undefined;
  let near = Infinity;
  let amphibious = false;
  // (A civ building its spaceship loses it with its capital: that's the city to strike.)
  const racing = game.cities.some((x) => x.owner === o.index && x.buildings.includes('apollo_program'));
  // (Pressing for the capitals: those first.)
  const race = capitalsRace(ctx);
  const wanted = (c: City) => race.pressing && race.left.includes(c);
  for (const c of citiesOf(game, o.index)) {
    if (!p.explored[c.tile]) continue;
    const home = nearestCity(ctx, c.tile);
    if (!home) continue;
    const across = !sameLand(game, home.tile, c.tile);
    if (across && !(knows(p, 'optics') && coastal(game, c.tile) && seaRoute(game, p, home.tile, c.tile))) continue;
    // (Across the water, a strong or well-guarded city is all the worse: the army lands under it.)
    const guards = across ? game.units.filter((u) => u.owner === o.index && p.visible[u.tile] && isSoldier(u) && dist(ctx, u.tile, c.tile) <= 2).length : 0;
    const d = dist(ctx, home.tile, c.tile) * (across ? 0.5 : 1) + (across ? 5 + guards : 0) + cityStrength(game, c) / 5 + (c.capital && mem.aim === 'domination' ? -1 : 0) + (c.capital && racing ? -8 : 0) + (c.founder === ctx.me ? -6 : 0) + (wanted(c) ? -10 : 0);
    // (Over land, a way there not through a third civ's closed borders; looked for only when it would do.)
    if (d < near && (across || landRoute(game, home.tile, c.tile, p, o.index))) (near = d), (city = c.id), (amphibious = across);
  }
  return city === undefined ? null : { city, near, amphibious };
}

/** A war worth planning: the neighbour, its city to strike first, how much the bot wants it, and why. */
function bestTarget(ctx: Ctx): { target: number; city: number; desire: number; amphibious: boolean; why: WarWhy } | null {
  const { game, p, pers, mem } = ctx;
  const mine = mightOf(ctx, ctx.me);
  const leader = majors(game).filter((o) => o.alive).sort((a, b) => score(game, b) - score(game, a))[0];
  const close = runaways(ctx);
  const allies = teamOf(game, ctx.me).filter((m) => m !== p).reduce((s, m) => s + mightOf(ctx, m.index) * 0.7, 0);
  const race = capitalsRace(ctx);
  let best: { target: number; city: number; desire: number; amphibious: boolean; why: WarWhy } | null = null;
  // (On a team with people, they choose the team's wars: the bot fights them.)
  if (teamedWithPeople(game, ctx.me)) return null;
  for (const o of game.players) {
    if (o === p || !o.alive || o.civ === 'barbarian' || p.diplomacy.peaceTurns[o.index] > 0) continue;
    if (o.cityState && pers.offense < 8) continue;
    // Friends and pact partners are not attacked.
    if (friends(game, ctx.me, o.index) || pacted(game, ctx.me, o.index) || teammates(game, ctx.me, o.index)) continue;
    // (Pressing for the capitals: only those that hold one, however far, unless another's close to winning.)
    const holds = race.pressing && race.left.some((c) => c.owner === o.index);
    if (race.pressing && !holds && !close.has(o.index)) continue;
    const aim = targetCity(ctx, o);
    if (!aim || aim.near > (holds ? 30 : 18)) continue;
    const { city, near, amphibious } = aim;
    // Their pact partners would join them (and the bot's teammates it).
    const partners = game.players.filter((x) => x !== p && x !== o && (pacted(game, x.index, o.index) || teammates(game, x.index, o.index))).reduce((s, x) => s + mightOf(ctx, x.index), 0);
    const ratio = (mine + allies) / Math.max(1, mightOf(ctx, o.index) + partners * 0.7);
    let desire = pers.offense * 0.9 + pers.boldness * 0.3 + (mem.aim === 'domination' ? 6 : 0) + (ratio - 1.3) * 8 - near * 0.4;
    if (o.cityState) desire -= 6;
    // What the leader thinks of them.
    const thought = o.cityState ? null : opinionOf(game, p, o);
    if (thought) desire += Math.max(-6, Math.min(6, -thought.total / 4));
    // Late on, a bot reaching for another victory has better things to build than an army; one
    // pressing for the capitals goes after those that hold the rest.
    if (mem.aim !== 'domination' && ctx.era >= 4 && !close.has(o.index) && !holds) desire -= 5;
    if (holds) desire += 10;
    if (o === leader && !o.cityState) desire += 2;
    // A civ close to winning is everyone's business (all the more so late on).
    if (close.has(o.index)) desire += game.turn > 220 ? 12 : 7;
    if (game.cities.some((c) => c.founder === ctx.me && c.owner === o.index)) desire += 6;
    if (best && desire <= best.desire) continue;
    best = { target: o.index, city, desire, amphibious, why: warWhy(ctx, o, ratio) };
  }
  return best;
}

/**
 * Why the bot would make war on a civ, as it would say it: a city of its own they hold, their lead,
 * their wars, their weakness (`ratio`: its might, with its allies', to theirs), else their land.
 */
function warWhy(ctx: Ctx, o: Player, ratio = mightOf(ctx, ctx.me) / Math.max(1, mightOf(ctx, o.index))): WarWhy {
  const { game, p } = ctx;
  if (game.cities.some((c) => c.founder === ctx.me && c.owner === o.index)) return 'reclaim';
  if (runaways(ctx).has(o.index)) return 'winning';
  if ((opinionOf(game, p, o).reasons.find((r) => r.text === WARMONGER)?.value ?? 0) <= -5) return 'warmonger';
  return ratio >= 2 ? 'weak' : 'land';
}

/**
 * The bot's tile closest to a target city to gather its army on: in its own land, on the same land; or,
 * for a war across the water, on its own coast nearest the city (where the army will embark).
 */
function rallyFor(ctx: Ctx, cityTile: number, amphibious: boolean): number {
  const { game } = ctx;
  let best = nearestCity(ctx, cityTile)?.tile ?? cityTile;
  let bestScore = Infinity;
  for (const t of amphibious ? game.tiles.keys() : within(game.grid, cityTile, 9)) {
    const tile = game.tiles[t];
    if (tile.owner !== ctx.me || TERRAINS[tile.terrain].water || tile.elevation === 'mountain' || cityOn(ctx, t)) continue;
    if (amphibious ? !coastal(game, t) : !sameLand(game, t, cityTile)) continue;
    // (Out of the city's fire: across the water, so too the boats the army embarks into.)
    const d = dist(ctx, t, cityTile);
    if (d < (amphibious ? 4 : 3)) continue;
    const s = d - (tile.elevation === 'hills' ? 0.5 : 0);
    if (s < bestScore) (bestScore = s), (best = t);
  }
  return best;
}

/** Make, carry forward or give up the bot's war plan; declare war once the army has gathered. */
export function planWar(ctx: Ctx) {
  const { game, p, mem } = ctx;
  if (p.cityState) return;
  if (mem.passive) return void (mem.plan = undefined);
  const plan = mem.plan;
  if (plan) {
    const them = game.players[plan.target];
    const city = game.cities.find((c) => c.id === plan.city);
    if (!them?.alive) return void (mem.plan = undefined);
    // The city's fallen (to us or anyone): on to their next.
    if (!city || city.owner !== plan.target) {
      if (city?.owner === ctx.me) plan.taken = game.turn;
      const reach = (c: (typeof ctx.cities)[number]) => ctx.cities.some((m) => sameLand(game, m.tile, c.tile)) || (knows(p, 'optics') && coastal(game, c.tile));
      // (Pressing for the capitals: theirs next, if it can be reached.)
      const race = capitalsRace(ctx);
      const open = citiesOf(game, plan.target).filter((c) => p.explored[c.tile] && reach(c));
      const next = (race.pressing ? open.find((c) => race.left.includes(c)) : undefined) ?? open.sort((a, b) => dist(ctx, a.tile, city?.tile ?? a.tile) - dist(ctx, b.tile, city?.tile ?? b.tile))[0];
      if (!next) return void (mem.plan = undefined);
      plan.city = next.id;
      plan.amphibious = !ctx.cities.some((m) => sameLand(game, m.tile, next.tile));
      plan.landing = undefined;
      plan.rally = rallyFor(ctx, next.tile, plan.amphibious);
    }
    const stage = (s: WarPlan['stage']) => {
      plan.stage = s;
      plan.changed = game.turn;
      plan.step = 0;
    };
    if (plan.stage === 'muster') {
      if (p.diplomacy.war[plan.target]) stage('attack');
      else if (p.diplomacy.peaceTurns[plan.target] > 0 || game.turn - plan.since > 60 || ctx.wars.length) mem.plan = undefined;
      else if (warned(ctx, plan) && armyReady(ctx) && strongEnough(ctx, game.turn - plan.since > (capitalsRace(ctx).pressing ? 12 : 40) ? 0.8 : 1) && act(ctx, { t: 'war', target: plan.target, why: plan.why })) {
        stage('attack');
        ctx.wars.push(plan.target);
        ctx.enemies.add(plan.target);
        mem.wars[plan.target] = { since: game.turn, ours: true, myCities: ctx.cities.length, theirCities: citiesOf(game, plan.target).length, myMight: mightOf(ctx, ctx.me), theirMight: mightOf(ctx, plan.target) };
      }
    } else if (plan.stage === 'attack') {
      // Worn down: back to the rally point to gather again.
      if (game.turn - (plan.changed ?? 0) > 3 && fieldArmy(ctx) < Math.max(2, armyNeed(ctx) * 0.4)) stage('regroup');
    } else if (armyReady(ctx)) stage('attack');
    return;
  }
  // No plan, but a war of the team's (a teammate's plan, or a war the team is in, a person's
  // included): the bot's army goes to it, against the same civ.
  const joint = teamWar(ctx);
  if (joint !== undefined) {
    const aim = targetCity(ctx, game.players[joint]);
    if (aim) {
      const city = game.cities.find((c) => c.id === aim.city)!;
      mem.plan = { target: joint, city: aim.city, stage: p.diplomacy.war[joint] ? 'attack' : 'muster', since: game.turn, rally: rallyFor(ctx, city.tile, aim.amphibious), amphibious: aim.amphibious || undefined, why: 'ally' };
    }
    return;
  }
  // No plan: now and then, look for a war worth making (not while fighting one, broke, unhappy or
  // still settling the land).
  if (game.turn < 35 || ctx.wars.length || (game.turn + ctx.me) % 5 !== 0 || !ctx.cities.length) return;
  if (game.turn < 100 && wants(ctx).settlers > 0 && ctx.cities.length < cityCap(ctx) - 1) return;
  if (ctx.mood < -2 || (ctx.income < 0 && p.gold < 100)) return;
  const best = bestTarget(ctx);
  if (!best || best.desire < 9.5) return;
  const city = game.cities.find((c) => c.id === best.city)!;
  // (On a person, a warlike leader's war comes now and then without the warning: a surprise.)
  const surprise = person(game.players[best.target]) && ctx.pers.offense >= 8 && random(game) < 0.25;
  mem.plan = { target: best.target, city: best.city, stage: 'muster', since: game.turn, rally: rallyFor(ctx, city.tile, best.amphibious), amphibious: best.amphibious || undefined, why: best.why, surprise: surprise || undefined };
}

/** Turns between a person's warning that a bot's army is massing at their border and its war. */
const WARNING_TURNS = 5;

const person = (o: Player) => !o.bot && !o.cityState && o.civ !== 'barbarian';

/**
 * Whether the bot may declare its planned war yet. On a person, not without a warning (but for a
 * warlike leader's surprise): once its army is half gathered (or the muster's gone on a while) they're
 * told it's massing at their border, and why; the war comes no sooner than five turns on.
 */
function warned(ctx: Ctx, plan: WarPlan): boolean {
  const { game, p } = ctx;
  const them = game.players[plan.target];
  if (!person(them) || plan.surprise) return true;
  // (A plan made before reasons were given, as in an old save, is given one now.)
  plan.why ??= warWhy(ctx, them);
  if (plan.warned === undefined && (armyNear(ctx, plan.rally, 4) >= Math.max(2, armyNeed(ctx) * 0.5) || game.turn - plan.since >= 15)) {
    plan.warned = game.turn;
    const city = game.cities.find((c) => c.id === plan.city);
    const where = !city ? 'near your border' : plan.amphibious ? `on its coast, across the water from ${city.name}` : `near your border, by ${city.name}`;
    const words = plan.why ? ` ${p.name}: “${warWords(game, plan.why, ctx.me, plan.target)}.”` : '';
    note(game, plan.target, { text: `${p.name}’s army is massing ${where}.${words}`, at: city?.tile, kind: 'war' });
  }
  return plan.warned !== undefined && game.turn - plan.warned >= WARNING_TURNS;
}

/** The civ a bot's team means to fight, if any: a bot teammate's war plan's target, else a major civ the team is at war with. */
function teamWar(ctx: Ctx): number | undefined {
  const { game, p } = ctx;
  if (p.team === undefined) return undefined;
  const mates = teamOf(game, ctx.me).filter((m) => m !== p);
  const planned = mates.map((m) => m.ai?.plan?.target).find((t) => t !== undefined && game.players[t]?.alive);
  if (planned !== undefined) return planned;
  return ctx.wars.find((w) => !game.players[w].cityState && mates.some((m) => game.players[m.index].diplomacy.war[w]));
}

/** The bot's soldiers out in the field (not standing in its own cities). */
function fieldArmy(ctx: Ctx): number {
  return ctx.game.units.filter((u) => u.owner === ctx.me && isSoldier(u) && cityOn(ctx, u.tile)?.owner !== ctx.me).length;
}

/** Whether the army at the rally point outweighs the target city and the soldiers seen around it (by a margin the bold need less of; less still after a long muster). */
function strongEnough(ctx: Ctx, margin: number): boolean {
  const { game, mem } = ctx;
  const plan = mem.plan!;
  const city = game.cities.find((c) => c.id === plan.city);
  if (!city) return false;
  let mine = 0;
  for (const u of game.units) if (u.owner === ctx.me && isSoldier(u) && dist(ctx, u.tile, plan.rally) <= 4 && cityOn(ctx, u.tile)?.owner !== ctx.me) mine += unitMight(u);
  let theirs = cityStrength(game, city) * 2;
  for (const u of game.units) if (u.owner === city.owner && ctx.p.visible[u.tile] && dist(ctx, u.tile, city.tile) <= 3) theirs += unitMight(u);
  return mine >= theirs * (1.35 - ctx.pers.boldness * 0.05) * margin;
}

/** Captured cities: kept as puppets, but a small one burned when the people can't bear more. */
export function conquests(ctx: Ctx) {
  for (const c of ctx.cities) {
    if (!c.puppet || c.razing !== undefined || c.founder === ctx.me) continue;
    const original = ctx.game.cities.filter((x) => x.founder === c.founder).sort((a, b) => a.id - b.id)[0] === c;
    if (!original && c.pop <= 2 && ctx.mood < -4) act(ctx, { t: 'cityChoice', city: c.id, choice: 'raze' });
  }
}

/** Diplomacy: a culture-minded bot opens its borders to those at peace (tourism flows both ways); votes for itself. */
export function diplomacy(ctx: Ctx) {
  const { game, p, mem } = ctx;
  if (p.cityState) return;
  if (mem.aim === 'culture' && tourismOf(game, p) > 0)
    for (const o of majors(game)) if (o !== p && o.alive && !p.diplomacy.war[o.index] && !p.diplomacy.openBorders[o.index] && capitalOf(game, o.index) && p.explored[capitalOf(game, o.index)!.tile]) act(ctx, { t: 'openBorders', target: o.index });
  // The World Leader vote: for itself, unless it can't win and a friend it's friendly with is ahead;
  // but not the vote that would make that friend World Leader, nor for one running away with it,
  // unless another civ is close to winning (rather a friend than a rival) or, late on, no civ could
  // win without a friend's votes.
  if (game.wonders['united_nations'] !== undefined) {
    const { votes, needed } = unVote(game, allyOf);
    const own = 2 + (game.wonders['united_nations'] === ctx.me ? 2 : 0);
    // The tally without this bot's own delegates.
    const others = (i: number) => (votes.get(i) ?? 0) - ((p.vote ?? ctx.me) === i ? own : 0);
    const mine = others(ctx.me) + own;
    const friendly = (i: number) => i !== ctx.me && friends(game, ctx.me, i) && stanceOf(opinionOf(game, p, game.players[i]).total) === 'friendly';
    const rival = majors(game).some((o) => o.alive && o !== p && !friendly(o.index) && nearVictory(game, o));
    // (And late on a world too big for any civ to carry the vote alone, with its own delegates, the
    // UN's and every city-state's, a friend ahead of it is backed all the way, as Civ V's leaders do.)
    const backing = game.turn > 250 && needed > 4 + cityStates(game).length;
    const friend = [...votes.keys()]
      .filter((i) => friendly(i) && others(i) > mine && (rival || backing || (others(i) + own < needed && !nearVictory(game, game.players[i]))))
      .sort((a, b) => others(b) - others(a))[0];
    const candidate = friend !== undefined && mine + 2 < needed ? friend : ctx.me;
    if ((p.vote ?? ctx.me) !== candidate) act(ctx, { t: 'vote', candidate });
  }
}
