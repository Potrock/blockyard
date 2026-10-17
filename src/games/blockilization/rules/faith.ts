import { BUILDINGS } from './buildings';
import { canStand, cityById, citiesOf, civOf, has, nameTo, note, noteAll, spawnUnit, speed } from './core';
import type { Effects } from './effects';
import { distance, within } from './hex';
import { policyEffects } from './policies';
import { BELIEFS, beliefEffects, RELIGION_NAMES, takenBeliefs } from './religion';
import type { City, Game, Player, Unit } from './state';
import { isGreatPerson, UNITS } from './units';

/**
 * Religion in play: faith brings Great Prophets (after a pantheon, while there are religions left to
 * found; one born keeps its place), a prophet in one of your cities founds a religion (a founder and
 * a follower belief) or enhances yours (a second follower belief and an enhancer); every city with a
 * religion presses it on the cities around it, a citizen at a time; missionaries carry it further,
 * inquisitors drive others out; cities follow the religion most of their citizens do, and its
 * follower beliefs work there. Civ V's way, simplified in the arithmetic but not in the shape.
 */

/** Faith for the next Great Prophet (Civ V's: 200, then 100 more each, by speed; a quarter less with Messiah). */
export const prophetCost = (game: Game, p: Player) => Math.floor((200 + 100 * (p.greatCount.prophet ?? 0)) * speed(game) * (has(beliefEffects(game, p), 'prophets_faster') ? 0.75 : 1));

/** How many times a new missionary or prophet of a civ can spread its religion (one more with the Great Mosque of Djenne, and a prophet one more with Messiah). */
export function spreadsOf(game: Game, p: Player, type: string): number {
  const mosque = citiesOf(game, p.index).some((c) => c.buildings.some((b) => BUILDINGS[b]?.effects.special?.includes('missionaries_extra_spread')));
  const base = type === 'great_prophet' ? 4 + (has(beliefEffects(game, p), 'prophets_faster') ? 1 : 0) : type === 'missionary' ? 2 : 1;
  return base + (mosque && type !== 'inquisitor' ? 1 : 0);
}

/** How many religions can be founded: half the civs, and one. */
export const maxReligions = (game: Game) => Math.floor(game.players.filter((p) => !p.cityState && p.civ !== 'barbarian').length / 2) + 1;

/** A civ's first Great Prophet waiting to found its religion (it has none yet), if any: the one born first. */
const waitingProphet = (game: Game, p: Player): Unit | undefined => (p.religion ? undefined : game.units.find((u) => u.owner === p.index && u.type === 'great_prophet'));

/** Whether a civ has a Great Prophet waiting to found its religion. */
const holdsProphet = (game: Game, p: Player) => !!waitingProphet(game, p);

/**
 * How many religions a civ could still found: those not yet founded, less one for each other civ
 * whose Great Prophet waiting to found its own was born before this civ's (or at all, if it has none
 * waiting). A prophet born keeps its civ's place, so a civ that has earned one isn't beaten to the
 * last religion while it walks to a city.
 */
export function religionsLeft(game: Game, p: Player): number {
  const mine = waitingProphet(game, p);
  const held = game.players.filter((o) => {
    const theirs = o === p ? undefined : waitingProphet(game, o);
    return theirs && (!mine || theirs.id < mine.id);
  }).length;
  return Math.max(0, maxReligions(game) - Object.keys(game.religions).length - held);
}

/** The effects of all of a religion's beliefs. */
export const religionEffects = (game: Game, religion: string): Effects[] => (game.religions[religion]?.beliefs ?? []).map((b) => BELIEFS[b]?.effects).filter((e): e is Effects => !!e);

/** A city's religion: the one most of its citizens follow (none if no one does). */
export function cityReligion(c: City): string | null {
  let best: string | null = null;
  let n = 0;
  for (const [r, k] of Object.entries(c.followers ?? {}))
    if (k > n) {
      n = k;
      best = r;
    }
  return n > 0 ? best : null;
}

/** A city's second religion: the one with the most followers after its own (none if no one follows another). */
export function secondReligion(c: City): string | null {
  const first = cityReligion(c);
  let best: string | null = null;
  let n = 0;
  for (const [r, k] of Object.entries(c.followers ?? {}))
    if (r !== first && k > n) {
      n = k;
      best = r;
    }
  return best;
}

/** The follower beliefs at work in a city (its religion's; with Religious Tolerance, its second religion's too). */
export function cityBeliefEffects(game: Game, c: City): Effects[] {
  const religions = [cityReligion(c)];
  const owner = game.players[c.owner];
  if (owner && has(policyEffects(owner, game), 'second_religion_beliefs')) religions.push(secondReligion(c));
  const out: Effects[] = [];
  for (const r of religions) {
    const rel = r ? game.religions[r] : undefined;
    if (rel) for (const b of rel.beliefs) if (BELIEFS[b]?.kind === 'follower') out.push(BELIEFS[b].effects);
  }
  return out;
}

/** Faith buildings a city can buy (its religion's follower beliefs). */
export function faithBuildings(game: Game, c: City): string[] {
  const out: string[] = [];
  for (const e of cityBeliefEffects(game, c)) for (const b of e.faithBuildings ?? []) out.push(b);
  return out.filter((b) => !c.buildings.includes(b));
}

/** Faith prices (Civ V's, at standard speed); what isn't listed costs twice its production. */
const FAITH_PRICE: Record<string, number> = { missionary: 100, inquisitor: 100, great_prophet: 500, mosque: 200, pagoda: 200, cathedral: 200, monastery: 200 };
/** A great person (other than a prophet) bought with faith: 1000 at standard speed, half as much again for each one bought before. */
const GREAT_PRICE = 1000;

/** Faith to buy something (by speed; 20% less with Mandate of Heaven): missionaries, faith buildings, great people, and units or buildings at twice their production. */
export function faithCost(game: Game, what: string, p?: Player): number {
  const great = isGreatPerson(what) && !Object.hasOwn(FAITH_PRICE, what) ? GREAT_PRICE * (1 + 0.5 * (p?.faithGreat ?? 0)) : undefined;
  const base = Object.hasOwn(FAITH_PRICE, what) ? FAITH_PRICE[what] : (great ?? 2 * (Object.hasOwn(UNITS, what) ? UNITS[what].cost : Object.hasOwn(BUILDINGS, what) ? BUILDINGS[what].cost : Infinity));
  const cheaper = p && has(policyEffects(p, game), 'faith_cheaper_20') ? 0.8 : 1;
  return Math.floor(base * speed(game) * cheaper);
}

/** The pressure a city must gather from a religion to win one of its citizens to it. */
export const conversionNeed = (c: City) => 10 + c.pop * 4;

/**
 * The religious pressure on a city each turn, in the order it adds up (each religion's part as it
 * comes): each city with a religion presses it on those within ten tiles (13 with Itinerant
 * Preachers), its holy city twice as hard, more with Religious Texts and a Grand Temple; trade routes
 * carry religion both ways (twice as strongly for Arabia's); and a holy city presses its own faith on
 * itself while its founder holds it (it can win its people back).
 */
export function pressureOn(game: Game, target: City): [religion: string, amount: number][] {
  const out: [string, number][] = [];
  for (const source of game.cities) {
    if (source === target) continue;
    const r = cityReligion(source);
    const rel = r ? game.religions[r] : undefined;
    if (!r || !rel) continue;
    const beliefs = religionEffects(game, r);
    if (distance(game.grid, source.tile, target.tile) > (has(beliefs, 'religion_reaches_further') ? 13 : 10)) continue;
    const holy = rel.holyCity === source.id ? 2 : 1;
    const more = beliefs.reduce((s, e) => s + (e.pressure ?? 0), 0) + source.buildings.reduce((s, b) => s + (BUILDINGS[b]?.effects.pressure ?? 0), 0);
    out.push([r, (1 + more / 100) * holy]);
  }
  for (const owner of game.players)
    for (const route of owner.routes ?? []) {
      const ends = [cityById(game, route.from), cityById(game, route.to)];
      if (!ends.includes(target)) continue;
      const other = ends.find((x) => x !== target);
      const r = other ? cityReligion(other) : null;
      if (r) out.push([r, has([civOf(owner).ability.effects], 'trade_religion_double') ? 2 : 1]);
    }
  for (const [r, rel] of Object.entries(game.religions)) if (rel.holyCity === target.id && rel.founder === target.owner) out.push([r, 3]);
  return out;
}

/** Each turn: faith brings prophets, pressure spreads religions, founder beliefs pay. */
export function faithTurn(game: Game) {
  // Prophets: from faith once a civ has a pantheon (Civ V's), while it could still found a religion
  // (and hasn't a prophet waiting to), or enhance its own.
  for (const p of game.players) {
    if (!p.alive || p.cityState || p.civ === 'barbarian' || !p.pantheon) continue;
    const wanted = (!p.religion && !holdsProphet(game, p) && religionsLeft(game, p) > 0) || (p.religion && game.religions[p.religion].beliefs.length < 4);
    if (!wanted || p.faith < prophetCost(game, p)) continue;
    const capital = citiesOf(game, p.index).find((c) => c.capital) ?? citiesOf(game, p.index)[0];
    if (!capital) continue;
    p.faith -= prophetCost(game, p);
    p.greatCount.prophet = (p.greatCount.prophet ?? 0) + 1;
    spawnUnit(game, 'great_prophet', p.index, capital.tile, { spreads: spreadsOf(game, p, 'great_prophet') });
    note(game, p.index, { text: 'A Great Prophet has been born! Take it to a city to found (or enhance) a religion.', at: capital.tile, kind: 'religion' });
  }
  // Pressure: each city's, from those near it, its trade routes and its holy city (`pressureOn`).
  for (const target of game.cities) {
    if (!target.pop) continue;
    const pressure = (target.pressure ??= {});
    for (const [r, v] of pressureOn(game, target)) pressure[r] = (pressure[r] ?? 0) + v;
    // Enough pressure converts a citizen (the city's change of faith told once, as the turn leaves it).
    const was = cityReligion(target);
    for (const [r, v] of Object.entries(pressure)) {
      const need = conversionNeed(target);
      if (v < need) continue;
      pressure[r] = v - need;
      convert(game, target, r, 1, true);
    }
    const now = cityReligion(target);
    if (now && now !== was) note(game, target.owner, { text: `${target.name} now follows ${game.religions[now]?.name}.`, at: target.tile, kind: 'religion', topic: 'religion' });
  }
  // Founder beliefs.
  for (const [id, rel] of Object.entries(game.religions)) {
    const founder = game.players[rel.founder];
    if (!founder?.alive) continue;
    const following = game.cities.filter((c) => cityReligion(c) === id);
    const followers = following.reduce((s, c) => s + (c.followers?.[id] ?? 0), 0);
    const beliefs = religionEffects(game, id);
    if (has(beliefs, 'tithe')) founder.gold += Math.floor(followers / 4);
    if (has(beliefs, 'church_property')) founder.gold += 2 * following.length;
    if (has(beliefs, 'pilgrimage')) founder.faith += 2 * following.filter((c) => c.owner !== rel.founder).length;
    if (has(beliefs, 'world_church')) founder.culture += Math.floor(following.filter((c) => c.owner !== rel.founder).reduce((s, c) => s + (c.followers?.[id] ?? 0), 0) / 5);
  }
}

/** A city that's shrunk (starved, taken, settled from, bombed) keeps no more followers than citizens: the biggest faiths lose them first. */
export function capFollowers(c: City) {
  const f = c.followers;
  if (!f) return;
  let over = Object.values(f).reduce((s, k) => s + k, 0) - c.pop;
  while (over-- > 0) {
    const most = Object.entries(f).sort((a, b) => b[1] - a[1])[0];
    if (!most || most[1] <= 0) break;
    f[most[0]]--;
  }
}

/** Convert `n` citizens of a city to a religion (from the others, the biggest first); a change of the city's faith is told unless `quiet`. */
export function convert(game: Game, c: City, religion: string, n: number, quiet = false) {
  const f = (c.followers ??= {});
  capFollowers(c);
  const before = cityReligion(c);
  for (let i = 0; i < n; i++) {
    const total = Object.values(f).reduce((s, k) => s + k, 0);
    if (total < c.pop) f[religion] = (f[religion] ?? 0) + 1;
    else {
      const other = Object.entries(f)
        .filter(([r, k]) => r !== religion && k > 0)
        .sort((a, b) => b[1] - a[1])[0];
      if (!other) break;
      f[other[0]]--;
      f[religion] = (f[religion] ?? 0) + 1;
    }
  }
  const after = cityReligion(c);
  if (after !== before && after) {
    if (!quiet) note(game, c.owner, { text: `${c.name} now follows ${game.religions[after]?.name}.`, at: c.tile, kind: 'religion', topic: 'religion' });
    const rel = game.religions[after];
    if (rel && has(religionEffects(game, after), 'initiation_rites') && before === null) game.players[rel.founder].gold += 100;
  }
}

/** A Great Prophet in its owner's city founds a religion, or enhances theirs. */
export function foundReligion(game: Game, p: Player, u: Unit, name: string, beliefs: string[]): string | null {
  const city = game.cities.find((c) => c.tile === u.tile && c.owner === p.index);
  if (!city) return 'Take the prophet to one of your cities';
  const taken = takenBeliefs(game);
  if (beliefs.some((b) => taken.has(b) || !BELIEFS[b])) return 'One of those beliefs is taken';
  if (!p.religion) {
    if (religionsLeft(game, p) <= 0) return 'No more religions can be founded';
    const founder = beliefs.find((b) => BELIEFS[b].kind === 'founder');
    const follower = beliefs.find((b) => BELIEFS[b].kind === 'follower');
    if (!founder || !follower || beliefs.length !== 2) return 'Choose a founder belief and a follower belief';
    const id = `r${Object.keys(game.religions).length + 1}`;
    const nameIt = name.trim().slice(0, 30) || RELIGION_NAMES[Object.keys(game.religions).length % RELIGION_NAMES.length];
    game.religions[id] = { founder: p.index, holyCity: city.id, name: nameIt, beliefs: [founder, follower] };
    p.religion = id;
    city.followers = { [id]: city.pop };
    noteAll(game, (r) => (r === p ? null : { text: `${nameTo(r, p, true)} has founded ${nameIt}.`, at: r.explored[city.tile] ? city.tile : undefined, kind: 'religion', topic: 'religion' }));
  } else {
    const rel = game.religions[p.religion];
    if (rel.beliefs.length >= 4) return 'Your religion is already enhanced';
    const follower = beliefs.find((b) => BELIEFS[b].kind === 'follower');
    const enhancer = beliefs.find((b) => BELIEFS[b].kind === 'enhancer');
    if (!follower || !enhancer || beliefs.length !== 2) return 'Choose a follower belief and an enhancer belief';
    rel.beliefs.push(follower, enhancer);
    noteAll(game, (r) => (r === p ? null : { text: `${nameTo(r, p, true)} has enhanced ${rel.name}.`, kind: 'religion', topic: 'religion' }));
  }
  game.units.splice(game.units.indexOf(u), 1);
  return null;
}

/** A missionary (or prophet) spreads its religion into the city it's in or next to: a big push (a quarter more with Missionary Zeal). */
export function spread(game: Game, p: Player, u: Unit): string | null {
  const religion = u.religion ?? p.religion;
  if (!religion) return 'You have no religion to spread';
  const city = game.cities.find((c) => distance(game.grid, c.tile, u.tile) <= 1);
  if (!city) return 'Stand it in or next to a city';
  const rel = game.religions[religion];
  const beliefs = religionEffects(game, religion);
  const others = Object.entries(city.followers ?? {}).reduce((s, [r, k]) => s + (r !== religion ? k : 0), 0);
  convert(game, city, religion, Math.max(1, Math.ceil(city.pop * (u.type === 'great_prophet' ? 1 : 0.6 * (has(beliefs, 'missionary_zeal') ? 1.25 : 1)))));
  // Interfaith Dialogue: science for the founder, for each follower of another religion won over.
  const won = others - Object.entries(city.followers ?? {}).reduce((s, [r, k]) => s + (r !== religion ? k : 0), 0);
  const founder = rel ? game.players[rel.founder] : undefined;
  if (founder && won > 0 && has(beliefs, 'interfaith') && founder.researching) founder.research[founder.researching] = (founder.research[founder.researching] ?? 0) + 5 * won;
  u.spreads = (u.spreads ?? (u.type === 'great_prophet' ? 4 : 2)) - 1;
  if (u.spreads <= 0) game.units.splice(game.units.indexOf(u), 1);
  return null;
}

/** An inquisitor clears other religions out of one of its owner's cities. */
export function inquisition(game: Game, p: Player, u: Unit): string | null {
  const city = game.cities.find((c) => c.owner === p.index && distance(game.grid, c.tile, u.tile) <= 1);
  if (!city || !p.religion) return 'Stand it in or next to one of your cities';
  const mine = city.followers?.[p.religion] ?? 0;
  city.followers = mine ? { [p.religion]: mine } : {};
  city.pressure = {};
  game.units.splice(game.units.indexOf(u), 1);
  return null;
}

/** Whether a player can buy missionaries and inquisitors in a city of theirs: its religion has followers there, or it's the religion's holy city. */
export function canBuyReligious(game: Game, p: Player, c: City): boolean {
  if (!p.religion || c.owner !== p.index) return false;
  return (c.followers?.[p.religion] ?? 0) > 0 || game.religions[p.religion]?.holyCity === c.id;
}

/** Faith-bought units appear with the buyer's religion. */
export function faithUnit(game: Game, p: Player, c: City, type: string): Unit | null {
  if (!UNITS[type]) return null;
  // (On land it can stand on, with no civilian there and no one else's unit: not out at sea, nor on an enemy.)
  const at = within(game.grid, c.tile, 1).find((t) => canStand(game, type, t) && !game.units.some((u) => u.tile === t && (u.owner !== p.index || !UNITS[u.type].strength))) ?? c.tile;
  return spawnUnit(game, type, p.index, at, { religion: p.religion, spreads: spreadsOf(game, p, type) });
}
