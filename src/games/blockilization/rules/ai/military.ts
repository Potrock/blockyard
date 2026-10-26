import { sizeOf } from '../armies';
import { canFire, canPillage, cityFireStrength, cityMaxHp, cityStrength, indirectFire, rangeOf, strength } from '../combat';
import { canStand, citiesOf } from '../core';
import { weighing } from '../economy';
import { neighbours, within } from '../hex';
import { ALL, canCrossOcean, canEmbark, stepCost } from '../movement';
import type { City, Unit } from '../state';
import { teamOf } from '../teams';
import { TERRAINS } from '../terrain';
import { isGreatPerson, isMilitary, UNITS } from '../units';
import { act, civilianAt, cityOn, coastal, danger, dist, goTo, landRoute, militaryAt, nearestCity, questsAsked, regions, sameLand, unitMight, unknownEdge, type Ctx } from './context';
import { isWarship, moveNavy } from './navy';
import { armyNeed, isSoldier, roleOf, threatTo } from './production';
import { capitalsRace } from './strategy';

/**
 * The bots' soldiers. Each turn: cities fire at what's in reach; every attack within reach is weighed
 * (the damage it would do and take, Civ V's formula without the dice: a kill or a city taken counts
 * most, a likely death rules it out) and the best are made, ranged first; then each unit gets a job —
 * a city's garrison, a threatened city's defence, a settler's escort, rest when wounded, the army of a
 * war plan (gathering at its rally point, then besieging: archers and siege at range, melee to take the
 * city once it's worn down), a barbarian camp to clear, the unknown to explore — and goes to it.
 */

/** The damage a side with strength `mine` would do to one with `theirs` (the rules' formula, an average roll). */
export function expected(mine: number, theirs: number): number {
  const ratio = Math.max(mine, theirs) / Math.max(0.01, Math.min(mine, theirs));
  const factor = (Math.pow((ratio + 3) / 4, 4) + 1) / 2;
  return Math.min(100, mine >= theirs ? 30 * factor : 30 / factor);
}

/** Whether a unit fights at range (archers, siege, ranged ships). */
const fires = (u: Unit) => {
  const t = UNITS[u.type];
  return !!t.ranged && t.domain !== 'air';
};

/** Whether a unit has an attack left this turn. */
const canAttackNow = (u: Unit) => {
  const t = UNITS[u.type];
  if (!isMilitary(t) || t.abilities?.includes('no_attack') || t.domain === 'air') return false;
  const twice = u.promotions.includes('blitz') || u.promotions.includes('logistics');
  if ((u.attacks ?? 0) >= (twice ? 2 : 1)) return false;
  return u.moves > 0;
};

/** What a unit is worth (to lose, or to kill): its cost, and its health. */
const worth = (u: Unit) => (UNITS[u.type].cost || 40) * (0.5 + u.hp / 200);
const cityWorth = (c: City) => 120 + c.pop * 25 + (c.capital ? 150 : 0);

/** An enemy the bot can see on a tile: a military unit, else a civilian; or a city. */
function targetAt(ctx: Ctx, t: number): { unit?: Unit; city?: City } | null {
  if (!ctx.p.visible[t]) return null;
  const city = cityOn(ctx, t);
  if (city && ctx.enemies.has(city.owner)) return { city };
  const m = militaryAt(ctx, t);
  if (m && ctx.enemies.has(m.owner)) return { unit: m };
  const c = civilianAt(ctx, t);
  if (c && ctx.enemies.has(c.owner) && !m) return { unit: c };
  return null;
}

/** Tiles a unit can reach this turn with moves to spare (for moving in to attack), and the moves left there. */
function reach(ctx: Ctx, u: Unit): Map<number, number> {
  const out = new Map<number, number>([[u.tile, u.moves]]);
  const queue = [u.tile];
  const zoc = (t: number) => neighbours(ctx.game.grid, t).some((n) => {
    const m = militaryAt(ctx, n);
    return (m && ctx.enemies.has(m.owner)) || (cityOn(ctx, n) && ctx.enemies.has(cityOn(ctx, n)!.owner));
  });
  while (queue.length) {
    const a = queue.shift()!;
    const left = out.get(a)!;
    if (left <= 0) continue;
    for (const b of neighbours(ctx.game.grid, a)) {
      const cost = stepCost(ctx.game, u, a, b);
      if (!Number.isFinite(cost) || cost >= ALL) continue;
      if (TERRAINS[ctx.game.tiles[b].terrain].water) continue;
      const m = militaryAt(ctx, b);
      if ((m && m !== u) || (cityOn(ctx, b) && cityOn(ctx, b)!.owner !== ctx.me)) continue;
      const owner = ctx.game.tiles[b].owner;
      if (owner >= 0 && owner !== ctx.me && !ctx.enemies.has(owner) && !ctx.game.players[owner].cityState && !ctx.game.players[owner].diplomacy.openBorders[ctx.me]) continue;
      const rest = zoc(a) && zoc(b) ? 0 : Math.max(0, left - cost);
      if ((out.get(b) ?? -1) >= rest) continue;
      out.set(b, rest);
      queue.push(b);
    }
  }
  return out;
}

interface Strike {
  unit: Unit;
  target: number;
  /** For a melee unit: the tile to step to first (it attacks from there). */
  from: number;
  setup: boolean;
  score: number;
}

/** The best attack a unit has now, and its worth (null: none worth making). A garrison only fires. */
function bestStrike(ctx: Ctx, u: Unit, garrison: boolean): Strike | null {
  const { game } = ctx;
  const type = UNITS[u.type];
  const ranged = fires(u);
  let best: Strike | null = null;
  const consider = (target: number, from: number, setup: boolean) => {
    const tg = targetAt(ctx, target);
    if (!tg) return;
    let score: number;
    if (tg.city) {
      const c = tg.city;
      if (ranged) {
        const dealt = expected(strength(game, u, 'ranged', c, from), cityStrength(game, c));
        score = (Math.min(dealt, c.hp - 1) / cityMaxHp(game, c)) * cityWorth(c) * 0.6;
      } else {
        if (type.abilities?.includes('penalty_vs_cities') && c.hp > 30) return;
        const a = strength(game, u, 'attack', c, from);
        const dealt = expected(a, cityStrength(game, c));
        const taken = expected(cityStrength(game, c), a);
        if (taken >= u.hp - 5) return;
        const takes = dealt >= c.hp && !type.abilities?.includes('penalty_vs_cities');
        score = takes ? cityWorth(c) * 3 : (Math.min(dealt, c.hp) / cityMaxHp(game, c)) * cityWorth(c) * 0.5 - (taken / 100) * worth(u) * 0.9;
        if (!takes && c.hp > cityMaxHp(game, c) * 0.5) score -= 30;
      }
    } else {
      const v = tg.unit!;
      const vt = UNITS[v.type];
      if (!isMilitary(vt)) {
        // A civilian: taken (or killed) by stepping on it; a shot only hurts it.
        score = ranged ? 5 : vt.class === 'great' ? 60 : (vt.cost || 50) * 1.2;
      } else if (ranged) {
        const dealt = expected(strength(game, u, 'ranged', v, from), strength(game, v, 'defend', u, target));
        score = (Math.min(dealt, v.hp) / 100) * worth(v) + (dealt >= v.hp ? worth(v) : 0);
      } else {
        const a = strength(game, u, 'attack', v, from);
        const d = strength(game, v, 'defend', u, target);
        const dealt = expected(a, d);
        const taken = expected(d, a);
        if (taken >= u.hp - 3) return;
        score = (Math.min(dealt, v.hp) / 100) * worth(v) + (dealt >= v.hp * 1.1 ? worth(v) : 0) - (taken / 100) * worth(u) * 0.8;
        if (taken > u.hp * 0.6 && dealt < v.hp) score -= worth(u) * 0.4;
      }
    }
    // Moving in to strike leaves the unit exposed: a little less for that.
    if (from !== u.tile) score -= danger(ctx)[from] * 0.2;
    if (score > 0 && (!best || score > best.score)) best = { unit: u, target, from, setup, score };
  };
  if (ranged) {
    const needsSetup = !!type.abilities?.includes('must_setup') && !u.setUp;
    if (needsSetup && u.moves < 2) return null;
    const range = rangeOf(u);
    // (A mounted archer next to its target would charge instead of shooting: only from range.)
    for (const t of within(game.grid, u.tile, range)) if (t !== u.tile && canFire(game, u.tile, t, range, indirectFire(u)) && !(type.class === 'mounted' && dist(ctx, u.tile, t) === 1)) consider(t, u.tile, needsSetup);
    return best;
  }
  if (garrison) return null;
  for (const [from, left] of type.moves > 1 ? reach(ctx, u) : new Map([[u.tile, u.moves]])) {
    if (left <= 0 && from !== u.tile) continue;
    for (const t of neighbours(game.grid, from)) consider(t, from, false);
  }
  return best;
}

/** Make the attacks worth making, best first, until none are left. */
export function attacks(ctx: Ctx, garrisons: Set<number>) {
  const { game } = ctx;
  if (ctx.mem.passive) return;
  const enemies = game.units.filter((u) => ctx.enemies.has(u.owner) && ctx.p.visible[u.tile]);
  const enemyCities = game.cities.filter((c) => ctx.enemies.has(c.owner) && ctx.p.visible[c.tile]);
  if (!enemies.length && !enemyCities.length) return;
  const near = (u: Unit) => {
    const r = UNITS[u.type].moves + (fires(u) ? rangeOf(u) : 1) + 1;
    return enemies.some((e) => dist(ctx, e.tile, u.tile) <= r) || enemyCities.some((c) => dist(ctx, c.tile, u.tile) <= r);
  };
  // Units whose strike the rules turned down this turn (or that couldn't get to where they'd strike from).
  const done = new Set<number>();
  for (let round = 0; round < 30; round++) {
    // (Weighed with each civ's happiness worked out once: the fights' strengths ask for it often.)
    const best = weighing(game, () => {
      let top: Strike | null = null;
      for (const u of game.units) {
        if (u.owner !== ctx.me || done.has(u.id) || u.embarked || !canAttackNow(u) || !near(u)) continue;
        const s = bestStrike(ctx, u, garrisons.has(u.id));
        // Ranged first: they soften what melee then finishes.
        if (s && fires(u)) s.score *= 1.15;
        if (s && (!top || s.score > top.score)) top = s;
      }
      return top;
    });
    if (!best) return;
    const s: Strike = best;
    if (s.from !== s.unit.tile && (!act(ctx, { t: 'move', unit: s.unit.id, to: s.from }) || s.unit.tile !== s.from || s.unit.moves <= 0)) {
      done.add(s.unit.id);
      continue;
    }
    if (s.setup && !act(ctx, { t: 'setup', unit: s.unit.id })) {
      done.add(s.unit.id);
      continue;
    }
    if (!act(ctx, { t: 'attack', unit: s.unit.id, target: s.target })) done.add(s.unit.id);
    delete ctx.mem.orders[s.unit.id];
    ctx.cache.danger = undefined;
  }
}

/** Cities fire at the enemy in reach worth it most (the one they'd kill, else the most hurt). */
export function cityFire(ctx: Ctx) {
  const { game } = ctx;
  for (const c of ctx.cities) {
    if (c.fired) continue;
    const best = weighing(game, () => {
      let at = -1;
      let bestScore = 0;
      for (const t of within(game.grid, c.tile, 2)) {
        const tg = targetAt(ctx, t);
        if (!tg?.unit || !isMilitary(UNITS[tg.unit.type])) continue;
        const dealt = expected(cityFireStrength(game, c), strength(game, tg.unit, 'defend', c, t));
        const score = Math.min(dealt, tg.unit.hp) + (dealt >= tg.unit.hp ? 100 : 0) + (100 - tg.unit.hp) * 0.2;
        if (score > bestScore) (bestScore = score), (at = t);
      }
      return at;
    });
    if (best >= 0) act(ctx, { t: 'cityFire', city: c.id, target: best });
  }
}

/** Hold a tile: fortify (and so heal and dig in). */
function hold(ctx: Ctx, u: Unit) {
  delete ctx.mem.orders[u.id];
  if (!u.stance && u.moves > 0) act(ctx, { t: 'stance', unit: u.id, stance: 'fortify' });
}

/** A free tile for a soldier near `around` (within `radius`), the nearest to it first; or none. Across the water only for a landing (`overseas`). */
function freeSpot(ctx: Ctx, u: Unit, around: number, radius: number, claimed: Set<number>, ok: (t: number) => boolean = () => true, overseas = false): number | undefined {
  const { game } = ctx;
  let best: number | undefined;
  let bestScore = Infinity;
  for (const t of within(game.grid, around, radius)) {
    if (claimed.has(t) || !canStand(game, u.type, t) || TERRAINS[game.tiles[t].terrain].water) continue;
    const m = militaryAt(ctx, t);
    if (m && m !== u) continue;
    const city = cityOn(ctx, t);
    if (city && city.owner !== ctx.me) continue;
    const owner = game.tiles[t].owner;
    if (owner >= 0 && owner !== ctx.me && !ctx.enemies.has(owner) && !game.players[owner].cityState && !game.players[owner].diplomacy.openBorders[ctx.me]) continue;
    if (!sameLand(game, u.tile, t) && !u.embarked && !overseas) continue;
    if (!ok(t)) continue;
    const tile = game.tiles[t];
    const s = dist(ctx, around, t) * 3 + dist(ctx, u.tile, t) * 0.5 - (tile.elevation === 'hills' ? 1 : 0) - (tile.feature === 'forest' || tile.feature === 'jungle' ? 0.6 : 0) + (t === u.tile ? -0.7 : 0);
    if (s < bestScore) (bestScore = s), (best = t);
  }
  return best;
}

/** Every soldier's job this turn, and the move toward it. */
export function moveUnits(ctx: Ctx, garrisons: Set<number>) {
  const { game, mem } = ctx;
  const mine = game.units.filter((u) => u.owner === ctx.me && isMilitary(UNITS[u.type]) && !isGreatPerson(u.type));
  const free = new Set(mine.filter((u) => isSoldier(u) || roleOf(UNITS[u.type]) === 'recon'));
  const claimed = new Set<number>();
  const take = (u: Unit) => free.delete(u);
  const d = danger(ctx);

  // At the very start, with no scout yet, the first soldier explores while the land's quiet.
  if (game.turn < 15 && !ctx.p.cityState && !mine.some((u) => roleOf(UNITS[u.type]) === 'recon') && ctx.capital && d[ctx.capital.tile] === 0) {
    const first = [...free].find((u) => isSoldier(u));
    if (first) {
      take(first);
      explore(ctx, first);
    }
  }

  // Garrisons: the best defender in each city stays; a city without one calls the nearest.
  for (const c of ctx.cities) {
    const here = militaryAt(ctx, c.tile);
    if (here && here.owner === ctx.me && isSoldier(here)) {
      take(here);
      garrisons.add(here.id);
      if (d[c.tile] === 0) hold(ctx, here);
      continue;
    }
    const near = [...free].filter((u) => isSoldier(u) && roleOf(UNITS[u.type]) !== 'siege' && dist(ctx, u.tile, c.tile) <= 6 && sameLand(game, u.tile, c.tile)).sort((a, b) => dist(ctx, a.tile, c.tile) - dist(ctx, b.tile, c.tile))[0];
    if (near) {
      take(near);
      garrisons.add(near.id);
      if (goTo(ctx, near, c.tile, 'garrison')) hold(ctx, near);
    }
  }

  // Anti-aircraft guns keep by the cities (they guard those within two tiles of them): by the nearest, and stay.
  for (const u of [...free].filter((x) => UNITS[x.type].abilities?.includes('intercept'))) {
    take(u);
    const home = nearestCity(ctx, u.tile);
    if (!home || dist(ctx, u.tile, home.tile) <= 1) {
      hold(ctx, u);
      continue;
    }
    const spot = freeSpot(ctx, u, home.tile, 1, claimed);
    if (spot === undefined) continue;
    claimed.add(spot);
    if (goTo(ctx, u, spot, 'guard')) hold(ctx, u);
  }

  // Threatened cities: the nearest free soldiers to the tiles around them (while its own army is on
  // the march, only for a city in real danger, and fewer: the best defence is the attack under way).
  const marching = mem.plan?.stage === 'attack';
  for (const c of [...ctx.cities].sort((a, b) => threatTo(ctx, b) - threatTo(ctx, a))) {
    const threat = threatTo(ctx, c);
    if (threat < (marching ? 0.9 : 0.4)) continue;
    const need = Math.min(marching ? 2 : 4, Math.ceil(threat * 2));
    const helpers = [...free].filter((u) => isSoldier(u) && dist(ctx, u.tile, c.tile) <= 8 && sameLand(game, u.tile, c.tile)).sort((a, b) => dist(ctx, a.tile, c.tile) - dist(ctx, b.tile, c.tile)).slice(0, need);
    for (const u of helpers) {
      take(u);
      const spot = freeSpot(ctx, u, c.tile, 1, claimed);
      if (spot === undefined) continue;
      claimed.add(spot);
      if (goTo(ctx, u, spot, 'defend')) hold(ctx, u);
    }
  }

  // Escorts for settlers out in danger.
  for (const s of game.units) {
    if (s.owner !== ctx.me || s.type !== 'settler' || cityOn(ctx, s.tile)) continue;
    const goal = mem.orders[s.id]?.to ?? s.tile;
    const risky = within(game.grid, s.tile, 3).some((t) => d[t] > 0) || within(game.grid, goal, 3).some((t) => d[t] > 0 || game.tiles[t].camp);
    if (!risky || militaryAt(ctx, s.tile)) continue;
    const e = [...free].filter((u) => isSoldier(u) && dist(ctx, u.tile, s.tile) <= 5).sort((a, b) => dist(ctx, a.tile, s.tile) - dist(ctx, b.tile, s.tile))[0];
    if (!e) continue;
    take(e);
    goTo(ctx, e, s.tile, 'escort');
  }

  // The badly wounded rest in their own land, out of reach.
  for (const u of [...free]) {
    if (u.hp >= 45 || !isSoldier(u)) continue;
    take(u);
    if (game.tiles[u.tile].owner === ctx.me && d[u.tile] === 0) {
      hold(ctx, u);
      continue;
    }
    const home = nearestCity(ctx, u.tile);
    const spot = home && freeSpot(ctx, u, home.tile, 2, claimed, (t) => d[t] === 0 && game.tiles[t].owner === ctx.me);
    if (spot !== undefined) {
      claimed.add(spot);
      goTo(ctx, u, spot, 'heal');
    }
  }

  // A teammate's city in danger: help from soldiers near enough, as for one of its own.
  for (const m of teamOf(game, ctx.me)) {
    if (m.index === ctx.me) continue;
    for (const c of citiesOf(game, m.index)) {
      if (d[c.tile] <= 0) continue;
      let defence = cityStrength(game, c) * 1.2;
      for (const t of within(game.grid, c.tile, 2)) {
        const x = militaryAt(ctx, t);
        if (x && (x.owner === m.index || x.owner === ctx.me)) defence += unitMight(x);
      }
      const threat = d[c.tile] / Math.max(1, defence);
      if (threat < 0.6) continue;
      const helpers = [...free].filter((u) => isSoldier(u) && dist(ctx, u.tile, c.tile) <= 10 && sameLand(game, u.tile, c.tile)).sort((a, b) => dist(ctx, a.tile, c.tile) - dist(ctx, b.tile, c.tile)).slice(0, Math.min(3, Math.ceil(threat * 2)));
      for (const u of helpers) {
        take(u);
        const spot = freeSpot(ctx, u, c.tile, 2, claimed);
        if (spot === undefined) continue;
        claimed.add(spot);
        if (goTo(ctx, u, spot, 'ally')) hold(ctx, u);
      }
    }
  }

  // The army of a war plan.
  const plan = mem.plan;
  if (plan) {
    const army = [...free].filter((u) => isSoldier(u));
    for (const u of army) take(u);
    if (plan.stage !== 'attack') {
      for (const u of army.sort((a, b) => dist(ctx, a.tile, plan.rally) - dist(ctx, b.tile, plan.rally))) {
        // Across the water, those already ashore hold the beach rather than sail home under fire.
        if (plan.amphibious && plan.landing !== undefined && !u.embarked && sameLand(game, u.tile, plan.landing)) {
          hold(ctx, u);
          continue;
        }
        const spot = freeSpot(ctx, u, plan.rally, 3, claimed);
        if (spot === undefined) continue;
        claimed.add(spot);
        if (goTo(ctx, u, spot, 'muster')) hold(ctx, u);
      }
    } else if (plan.amphibious) invade(ctx, army, claimed);
    else siege(ctx, army, claimed);
  }

  // Barbarian camps near home, and those a city-state asks to be cleared (further afield): cleared by two at a time, those asked first.
  const asked = new Set(questsAsked(ctx, 'camp').map((q) => q.at));
  const camps = game.tiles.map((tile, t) => (tile.camp && ctx.p.explored[t] && ctx.cities.some((c) => dist(ctx, c.tile, t) <= (asked.has(t) ? 14 : 8)) ? t : -1)).filter((t) => t >= 0).sort((a, b) => +asked.has(b) - +asked.has(a));
  for (const camp of camps) {
    const hunters = [...free].filter((u) => isSoldier(u) && dist(ctx, u.tile, camp) <= (asked.has(camp) ? 16 : 10) && sameLand(game, u.tile, camp) && u.hp >= 60).sort((a, b) => dist(ctx, a.tile, camp) - dist(ctx, b.tile, camp)).slice(0, 2);
    if (hunters.length < (militaryAt(ctx, camp) ? 2 : 1)) continue;
    for (const u of hunters) {
      take(u);
      const guard = militaryAt(ctx, camp);
      if (!guard) {
        goTo(ctx, u, camp, 'camp');
        continue;
      }
      const spot = freeSpot(ctx, u, camp, fires(u) ? 2 : 1, claimed, (t) => t !== camp && (!fires(u) || canFire(game, t, camp, rangeOf(u), indirectFire(u))));
      if (spot === undefined) continue;
      claimed.add(spot);
      goTo(ctx, u, spot, 'camp');
    }
  }

  // Explorers: scouts.
  const explorers = [...free].filter((u) => roleOf(UNITS[u.type]) === 'recon');
  for (const u of explorers.slice(0, 3)) {
    take(u);
    explore(ctx, u);
  }

  // Ships.
  moveNavy(ctx, mine.filter(isWarship), claimed);

  // The rest: back to their own land, near the nearest city, and dig in.
  for (const u of free) {
    if (!isSoldier(u)) {
      hold(ctx, u);
      continue;
    }
    const tile = game.tiles[u.tile];
    if (tile.owner === ctx.me && !mem.orders[u.id]) {
      hold(ctx, u);
      continue;
    }
    const home = [...ctx.cities].sort((a, b) => dist(ctx, a.tile, u.tile) - dist(ctx, b.tile, u.tile))[0];
    if (!home) continue;
    const spot = freeSpot(ctx, u, home.tile, 2, claimed, (t) => game.tiles[t].owner === ctx.me);
    if (spot === undefined) continue;
    claimed.add(spot);
    if (goTo(ctx, u, spot, 'reserve')) hold(ctx, u);
  }
}

/**
 * An army across the water. While its warships can batter the city from the sea, it waits on the home
 * shore (the rally point) until the walls are down a way (or the bombardment has had its chance), so
 * as not to land against them whole, and while the enemy's warships hold the waters it would cross. Then it sets off in waves, a wave once most of those still at
 * home are gathered there, so that it lands together rather than a boat at a time; those afloat sail
 * for the landing beach (a coast near the target city, out of its walls' reach where it can be), those
 * still at home gather for the next wave, and those ashore lay siege as on land.
 */
function invade(ctx: Ctx, army: Unit[], claimed: Set<number>) {
  const { game, mem } = ctx;
  const plan = mem.plan!;
  const target = game.cities.find((c) => c.id === plan.city);
  if (!target) return;
  const ashore = (u: Unit) => !u.embarked && sameLand(game, u.tile, target.tile);
  if (plan.landing === undefined || !landingOk(ctx, plan.landing, target.tile)) plan.landing = landingFor(ctx, target.tile, plan.rally);
  const landing = plan.landing;
  if (landing === undefined) return siege(ctx, army.filter(ashore), claimed);
  // Those that have set off (afloat, or on their way down to the water) carry on.
  const sailing = (u: Unit) => u.embarked || mem.orders[u.id]?.why === 'invade';
  const home = army.filter((u) => !ashore(u) && !sailing(u));
  const gathered = home.filter((u) => dist(ctx, u.tile, plan.rally) <= 2);
  const bombarding = game.units.some((u) => u.owner === ctx.me && isWarship(u) && fires(u) && dist(ctx, u.tile, target.tile) <= rangeOf(u) + 4);
  const battered = target.hp <= cityMaxHp(game, target) * 0.6 || game.turn - (plan.changed ?? game.turn) > 12 || army.some(ashore);
  // (And one that can take the city goes with it, or there's no point landing.)
  const taker = gathered.some((u) => (roleOf(UNITS[u.type]) === 'melee' || roleOf(UNITS[u.type]) === 'mounted') && !UNITS[u.type].abilities?.includes('intercept')) || army.some((u) => ashore(u) && roleOf(UNITS[u.type]) === 'melee');
  // A wave is most of those near enough to gather (half of them after a long wait), not those far off,
  // and strong enough to take the city: more than its walls (as worn) and the soldiers seen by it.
  const waited = game.turn - (plan.changed ?? game.turn) > 6;
  const near = home.filter((u) => dist(ctx, u.tile, plan.rally) <= 8).length;
  let held = cityStrength(game, target) * 2 * (0.4 + (0.6 * target.hp) / cityMaxHp(game, target));
  for (const x of game.units) if (x.owner === target.owner && ctx.p.visible[x.tile] && isSoldier(x) && dist(ctx, x.tile, target.tile) <= 2) held += unitMight(x);
  const strong = gathered.reduce((n, u) => n + unitMight(u), 0) >= held * (game.turn - (plan.changed ?? game.turn) > 20 ? 0.9 : 1.2);
  // (Not while the enemy's warships about the shores outnumber the bot's: the boats would be sunk.)
  const about = (x: Unit) => dist(ctx, x.tile, landing) <= 6 || dist(ctx, x.tile, plan.rally) <= 6;
  const contested = game.units.filter((x) => ctx.enemies.has(x.owner) && isWarship(x) && ctx.p.visible[x.tile] && about(x)).length > game.units.filter((x) => x.owner === ctx.me && isWarship(x) && about(x)).length;
  const wave = new Set((!bombarding || battered) && taker && !contested && strong && gathered.length >= Math.max(3, Math.ceil(near * (waited ? 0.5 : 0.7))) ? gathered : []);
  for (const u of home.filter((x) => !wave.has(x)).sort((a, b) => dist(ctx, a.tile, plan.rally) - dist(ctx, b.tile, plan.rally))) {
    const spot = freeSpot(ctx, u, plan.rally, 2, claimed);
    if (spot === undefined) continue;
    claimed.add(spot);
    if (goTo(ctx, u, spot, 'muster')) hold(ctx, u);
  }
  for (const u of army.filter((x) => sailing(x) || wave.has(x)).sort((a, b) => dist(ctx, a.tile, landing) - dist(ctx, b.tile, landing))) {
    const spot = freeSpot(ctx, u, landing, 2, claimed, (t) => sameLand(game, t, target.tile) && !cityOn(ctx, t), true);
    if (spot === undefined) continue;
    claimed.add(spot);
    goTo(ctx, u, spot, 'invade');
  }
  siege(ctx, army.filter(ashore), claimed);
}

/** Whether a tile will do as a landing beach for a city: on its land, on the coast, near it, not held by an enemy. */
function landingOk(ctx: Ctx, t: number, cityTile: number): boolean {
  const { game } = ctx;
  const m = militaryAt(ctx, t);
  return sameLand(game, t, cityTile) && coastal(game, t) && !cityOn(ctx, t) && dist(ctx, t, cityTile) <= 4 && (!m || m.owner === ctx.me);
}

/** The best beach to land on near a city: two or three tiles off (beyond its melee, if not its fire), on high or wooded ground, nearest home. */
function landingFor(ctx: Ctx, cityTile: number, from: number): number | undefined {
  const { game } = ctx;
  let best: number | undefined;
  let bestScore = Infinity;
  for (const t of within(game.grid, cityTile, 4)) {
    if (TERRAINS[game.tiles[t].terrain].water || game.tiles[t].elevation === 'mountain' || !landingOk(ctx, t, cityTile)) continue;
    const d = dist(ctx, t, cityTile);
    const tile = game.tiles[t];
    const s = Math.abs(d - 2.5) * 3 + dist(ctx, t, from) * 0.3 - (tile.elevation === 'hills' ? 1.5 : 0) - (tile.feature === 'forest' || tile.feature === 'jungle' ? 1 : 0);
    if (s < bestScore) (bestScore = s), (best = t);
  }
  return best;
}

/** The army besieging its target: ranged and siege units at range, melee next to the walls once they're down a way. */
function siege(ctx: Ctx, army: Unit[], claimed: Set<number>) {
  const { game, mem } = ctx;
  const plan = mem.plan!;
  const target = game.cities.find((c) => c.id === plan.city);
  if (!target) return;
  // The march: camp by camp along the route, the camp moving on once most of the army has caught up
  // (a new way when the next camp lies in land since closed to it).
  const closed = (t: number) => {
    const owner = game.tiles[t].owner;
    return owner >= 0 && owner !== ctx.me && !ctx.enemies.has(owner) && !game.players[owner].cityState && !game.players[owner].diplomacy.openBorders[ctx.me];
  };
  if (!plan.route || plan.route[plan.route.length - 1] !== target.tile || closed(plan.route[Math.min(plan.step ?? 0, plan.route.length - 1)])) {
    // (Across the water, from the landing beach.)
    const from = plan.amphibious && plan.landing !== undefined ? plan.landing : plan.rally;
    const way = landRoute(game, from, target.tile, ctx.p, target.owner);
    // No way there but through a third civ's closed land: the war goes on elsewhere, or not at all.
    if (!way && !plan.amphibious) return void (mem.plan = undefined);
    plan.route = [from, ...(way ?? [target.tile])];
    plan.step = 0;
  }
  const route = plan.route;
  const last = Math.max(0, route.length - 4);
  let step = Math.min(plan.step ?? 0, last);
  // (A big army needs room to camp in: one soldier to a tile, so the camp spreads wider as it grows;
  // and those far behind, wounded or held up, aren't waited for.)
  const room = army.length > 6 ? 3 : 2;
  if (step < last) {
    const camp = route[step];
    const gathered = army.filter((u) => dist(ctx, u.tile, camp) <= room).length;
    const following = army.filter((u) => dist(ctx, u.tile, camp) <= 10).length;
    if (gathered >= Math.max(1, Math.ceil(following * 0.6))) plan.step = step = Math.min(last, step + 3);
  }
  if (step < last) {
    const camp = route[step];
    let placed = 0;
    for (const u of [...army].sort((a, b) => dist(ctx, a.tile, camp) - dist(ctx, b.tile, camp))) {
      const spot = freeSpot(ctx, u, camp, room, claimed);
      if (spot === undefined) continue;
      claimed.add(spot);
      placed++;
      goTo(ctx, u, spot, 'march');
    }
    // Room at the camp for few (borders closed since, or the ground taken): another way next turn.
    if (placed < army.length / 2) plan.route = undefined;
    return;
  }
  const worn = target.hp <= cityMaxHp(game, target) * 0.55;
  const inPlace = army.filter((u) => fires(u) && dist(ctx, u.tile, target.tile) <= rangeOf(u)).length;
  const order = [...army].sort((a, b) => dist(ctx, a.tile, target.tile) - dist(ctx, b.tile, target.tile));
  for (const u of order) {
    const type = UNITS[u.type];
    const far = dist(ctx, u.tile, target.tile);
    // (One on other land, ashore, would only swim for it, embarked and defenceless: a landing takes it over.)
    if (!u.embarked && !sameLand(game, u.tile, target.tile)) continue;
    if (fires(u)) {
      const r = rangeOf(u);
      const spot = freeSpot(ctx, u, target.tile, r, claimed, (t) => dist(ctx, t, target.tile) >= (type.class === 'mounted' ? 2 : Math.min(2, r)) && canFire(game, t, target.tile, r, indirectFire(u)));
      if (spot === undefined) {
        if (far > r + 1) goTo(ctx, u, target.tile, 'siege');
        continue;
      }
      claimed.add(spot);
      if (goTo(ctx, u, spot, 'siege') && type.abilities?.includes('must_setup') && !u.setUp && u.moves > 0) act(ctx, { t: 'setup', unit: u.id });
      continue;
    }
    // Melee: close in when the walls are worn or the archers are in place; else wait two out.
    const close = worn || inPlace >= 2 || army.every((x) => !fires(x));
    const spot = freeSpot(ctx, u, target.tile, close ? 1 : 2, claimed, (t) => t !== target.tile && (close || dist(ctx, t, target.tile) === 2));
    if (spot === undefined) {
      if (far > 3) goTo(ctx, u, target.tile, 'siege');
      continue;
    }
    claimed.add(spot);
    if (goTo(ctx, u, spot, 'siege') && u.hp < 70) hold(ctx, u);
  }
}

/** A scout's turn: exploring while there's anything to see, else home to be useful there. */
function explore(ctx: Ctx, u: Unit) {
  if (exploreStep(ctx, u, 12) || exploreAbroad(ctx, u)) return;
  const home = nearestCity(ctx, u.tile);
  if (home && dist(ctx, home.tile, u.tile) > 2) goTo(ctx, u, home.tile, 'reserve');
  else hold(ctx, u);
}

/**
 * With Optics, a scout that has seen all its own land sets out over the water: to the nearest edge of
 * the unknown beyond it (land glimpsed on another shore, or the sea), so a bot on an island finds where
 * to settle. False if there's nowhere to go.
 */
export function exploreAbroad(ctx: Ctx, u: Unit): boolean {
  const { game, p } = ctx;
  if (!canEmbark(game, p.index)) return false;
  const ocean = canCrossOcean(game, p.index);
  const edge = unknownEdge(ctx);
  let best = -1;
  let bestScore = Infinity;
  for (let t = 0; t < game.tiles.length; t++) {
    if (!edge[t]) continue;
    const tile = game.tiles[t];
    if (!p.explored[t] || (!u.embarked && sameLand(game, u.tile, t)) || tile.elevation === 'mountain' || (tile.terrain === 'ocean' && !ocean)) continue;
    const m = militaryAt(ctx, t);
    if ((m && m !== u) || cityOn(ctx, t)) continue;
    const owner = tile.owner;
    if (owner >= 0 && owner !== ctx.me && !game.players[owner].cityState && !game.players[owner].diplomacy.openBorders[ctx.me]) continue;
    const s = dist(ctx, u.tile, t) + (danger(ctx)[t] > 0 ? 6 : 0);
    if (s < bestScore) (bestScore = s), (best = t);
  }
  if (best < 0) return false;
  goTo(ctx, u, best, 'explore', danger(ctx));
  return true;
}

/**
 * An explorer's step: to a ruin it knows of within `radius`, else the nearest edge of the unknown no
 * other explorer's headed for. False when there's nothing left to see.
 */
export function exploreStep(ctx: Ctx, u: Unit, radius: number): boolean {
  const { game, p, mem } = ctx;
  const unknownNear = (t: number) => neighbours(game.grid, t).filter((n) => !p.explored[n]).length;
  const taken = new Set(Object.entries(mem.orders).filter(([id, x]) => x.why === 'explore' && Number(id) !== u.id).map(([, x]) => x.to));
  const region = regions(game);
  const edge = unknownEdge(ctx);
  let best = -1;
  let bestScore = -Infinity;
  for (const t of within(game.grid, u.tile, radius)) {
    // (Only a ruin or the edge of the unknown is worth going to: the rest passed over at once.)
    if ((!edge[t] && !game.tiles[t].ruin) || !p.explored[t] || taken.has(t) || TERRAINS[game.tiles[t].terrain].water || region[t] !== region[u.tile]) continue;
    const owner = game.tiles[t].owner;
    if (owner >= 0 && owner !== ctx.me && !game.players[owner].cityState && !game.players[owner].diplomacy.openBorders[ctx.me]) continue;
    const ruin = game.tiles[t].ruin;
    const unknown = unknownNear(t);
    if (!ruin && !unknown) continue;
    if (militaryAt(ctx, t) && militaryAt(ctx, t) !== u) continue;
    const s = (ruin ? 12 : 0) + unknown * 1.5 - dist(ctx, u.tile, t) - (danger(ctx)[t] > 0 ? 6 : 0);
    if (s > bestScore) (bestScore = s), (best = t);
  }
  if (best < 0) return false;
  goTo(ctx, u, best, 'explore', danger(ctx));
  return true;
}

/**
 * Soldiers with moves left standing on an enemy's improvement or road pillage it (gold for the bot,
 * a loss for the enemy, and 25 hp back for the soldier), unless the enemy's massing there.
 */
export function pillageAll(ctx: Ctx) {
  const { game } = ctx;
  if (!ctx.wars.length) return;
  const d = danger(ctx);
  for (const u of game.units) {
    if (u.owner !== ctx.me || !isSoldier(u) || !canPillage(game, u)) continue;
    const owner = game.tiles[u.tile].owner;
    if (owner < 0 || !ctx.enemies.has(owner) || d[u.tile] > unitMight(u) * 2) continue;
    act(ctx, { t: 'pillage', unit: u.id });
  }
}

/** How many of the bot's soldiers stand within `radius` of a tile, out in the field (the garrisons in its cities stay home; a corps counts as two, an army as three). */
export function armyNear(ctx: Ctx, t: number, radius: number): number {
  let n = 0;
  for (const u of ctx.game.units) if (u.owner === ctx.me && isSoldier(u) && dist(ctx, u.tile, t) <= radius && cityOn(ctx, u.tile)?.owner !== ctx.me) n += sizeOf(u);
  return n;
}

/** Whether the bot's army is ready for its war: enough soldiers gathered at the rally point. */
export function armyReady(ctx: Ctx): boolean {
  const plan = ctx.mem.plan;
  if (!plan) return false;
  const need = armyNeed(ctx);
  const gathered = armyNear(ctx, plan.rally, 4);
  // (A conqueror pressing for the last capitals waits less long for the full army: the game won't.)
  const pressing = capitalsRace(ctx).pressing;
  const late = ctx.game.turn - plan.since > (pressing ? 12 : 30);
  return gathered >= need * 0.85 || (late && gathered >= need * (pressing ? 0.6 : 0.7));
}
