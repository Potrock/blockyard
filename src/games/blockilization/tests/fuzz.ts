import { automate, botTurn } from '../rules/ai';
import { isAircraft } from '../rules/air';
import { BUILDING_LIST, FAITH_BUILDINGS } from '../rules/buildings';
import { CIV_LIST } from '../rules/civs';
import { canStand, citiesOf, createGame, unitsOf } from '../rules/core';
import { apply, endTurn, SHAPES, type Field, type Order } from '../rules/game';
import { within } from '../rules/hex';
import { Rng } from '../rules/mapgen';
import { ALL_POLICIES, IDEOLOGIES } from '../rules/policies';
import { PROJECTS } from '../rules/projects';
import { PROMOTION_LIST } from '../rules/promotions';
import { BELIEF_LIST } from '../rules/religion';
import { MAP_SIZES, TURN_LIMITS, type Game, type MapSize, type Player, type Settings } from '../rules/state';
import { TECHS } from '../rules/techs';
import { IMPROVEMENTS, RESOURCES, TERRAINS } from '../rules/terrain';
import { stackKind, UNIT_LIST, UNITS } from '../rules/units';
import { cityInfo, statsFor, viewFor, yieldsWire } from '../views';

/**
 * The rules' fuzz test: games where a bot plays each civ, and after its turn each "person" (the
 * first civs: not bots, so the rules treat them as people) gives orders made up at random from the
 * orders' own shapes (`SHAPES`), most of them near enough to sense to get past the first checks:
 * its own units and cities, tiles beside them, real ids, and now and then nonsense. No order may
 * throw, and none may leave the world broken: numbers that aren't numbers, units stacked or on tiles
 * that don't exist, dead units left about, cities with nobody or with a tile worked twice, a
 * treasury an order took below zero. After each person's orders the views the server would send
 * them (their view, their cities' screens, the demographics) are built too, and may not throw either.
 *
 * Bundle and run from the platform's folder (it has esbuild):
 *   npx esbuild src/games/blockilization/tests/fuzz.ts --bundle --platform=node --format=esm --outfile=fuzz.mjs
 *   node fuzz.mjs [size] [seeds] [turns] [orders a turn] [people]
 * `node fuzz.mjs small 1-8 250 40 2`: eight small games of 250 turns, two civs given 40 random
 * orders each a turn. Each problem is printed once with the order that did it; the exit code says
 * whether there were any.
 */

const size = (process.argv[2] ?? 'small') as MapSize;
const seeds = parseSeeds(process.argv[3] ?? '1-4');
const turns = Number(process.argv[4] ?? 200);
const perTurn = Number(process.argv[5] ?? 30);
const people = Number(process.argv[6] ?? 2);

function parseSeeds(s: string): number[] {
  if (s.includes('-')) {
    const [a, b] = s.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return s.split(',').map(Number);
}

const WORKS = [...Object.keys(IMPROVEMENTS), 'road', 'rail', 'remove_feature', 'scrub_fallout', 'repair', 'artifact', 'landmark'];
const ITEMS: { kind: string; id: string }[] = [
  ...UNIT_LIST.map((u) => ({ kind: 'unit', id: u.id })),
  ...[...BUILDING_LIST, ...FAITH_BUILDINGS].map((b) => ({ kind: 'building', id: b.id })),
  ...Object.keys(PROJECTS).map((id) => ({ kind: 'project', id })),
  ...['gold', 'science', 'culture', 'faith', 'food'].map((id) => ({ kind: 'process', id })),
];
const POLICY_IDS = [...Object.keys(ALL_POLICIES), ...IDEOLOGIES.map((i) => i.id)];
const RESOURCE_IDS = Object.keys(RESOURCES);
const NONSENSE = [-1, 0, 999999, Number.MAX_SAFE_INTEGER, -5];

/** Orders that would end the test early or empty the board, given less often. */
const RARE: Partial<Record<Order['t'], number>> = { war: 0.03, disband: 0.05, giftUnit: 0.1, independence: 0.1, cityChoice: 0.3, release: 0.3, ready: 0.2, denounce: 0.2, embargo: 0.2 };

/** A made-up order for a civ: its type at random, each field near enough to sense to be tried. */
function makeOrder(game: Game, p: Player, rng: Rng): Order {
  const types = Object.keys(SHAPES) as Order['t'][];
  let t = rng.pick(types);
  while (rng.next() > (RARE[t] ?? 1)) t = rng.pick(types);
  const mine = unitsOf(game, p.index);
  const cities = citiesOf(game, p.index);
  const unit = mine.length && rng.next() < 0.9 ? rng.pick(mine) : game.units.length ? rng.pick(game.units) : undefined;
  const city = cities.length && rng.next() < 0.9 ? rng.pick(cities) : game.cities.length ? rng.pick(game.cities) : undefined;
  const from = t === 'cityFire' || t === 'buyTile' || t === 'work' ? city?.tile : unit?.tile;
  const tile = () => (from !== undefined && rng.next() < 0.85 ? rng.pick(within(game.grid, from, rng.int(1, 3))) : rng.int(0, game.tiles.length - 1));
  const who = () => (rng.next() < 0.95 ? rng.int(0, game.players.length - 1) : rng.pick(NONSENSE));
  const int = (key: string): number => {
    if (rng.next() < 0.04) return rng.pick(NONSENSE);
    switch (key) {
      case 'unit':
        return unit?.id ?? -1;
      case 'other':
        return (mine.length ? rng.pick(mine) : unit)?.id ?? -1;
      case 'city':
        return city?.id ?? -1;
      case 'target':
      case 'candidate':
      case 'civ':
        return who();
      case 'to':
        // (A trade route's: a city.)
        return game.cities.length ? rng.pick(game.cities).id : 0;
      case 'spy':
        return p.spies?.length ? rng.pick(p.spies).id : rng.int(0, 3);
      case 'offer':
        return game.relations?.offers.length ? rng.pick(game.relations.offers).id : rng.int(0, 5);
      case 'clan':
        return game.clans?.length ? rng.pick(game.clans).id : rng.int(0, 5);
      case 'gold':
        return rng.pick([1, 50, 250, 500, 1000, Math.floor(p.gold), Math.floor(p.gold) + 1, -100]);
      default:
        return rng.int(-1, 6);
    }
  };
  const text = (key: string): string => {
    if (rng.next() < 0.04) return rng.pick(['', 'nonsense', '__proto__', 'constructor', 'toString']);
    switch (key) {
      case 'what':
        return rng.pick(WORKS);
      case 'promotion':
        return rng.pick(PROMOTION_LIST).id;
      case 'tech':
        return rng.pick(Object.keys(TECHS));
      case 'id':
        return rng.pick(POLICY_IDS);
      case 'belief':
        return rng.pick(BELIEF_LIST).id;
      default:
        return 'Fuzzism';
    }
  };
  const dealItems = () =>
    Array.from({ length: rng.int(0, 4) }, () => {
      const giver = rng.next() < 0.5 ? p.index : who();
      return rng.pick<unknown>([
        { kind: 'gold', from: giver, amount: rng.pick([1, 30, 200, 100000, -50, NaN, 0.5]) },
        { kind: 'goldPerTurn', from: giver, amount: rng.pick([1, 3, 10, 1000, -5, NaN]) },
        { kind: 'luxury', from: giver, resource: rng.pick(RESOURCE_IDS) },
        { kind: 'strategic', from: giver, resource: rng.pick(RESOURCE_IDS), amount: rng.pick([1, 2, 50, -1, NaN]) },
        { kind: 'openBorders', from: giver },
        { kind: 'embassy', from: giver },
        { kind: 'research' },
        { kind: 'friendship' },
        { kind: 'pact' },
        { kind: 'peace' },
        { kind: 'vassal', from: giver },
        { kind: 'nonsense' },
        null,
        7,
      ]);
    });
  const o: Record<string, unknown> = { t };
  for (const [key, f] of Object.entries(SHAPES[t] as Record<string, Field>)) {
    if (Array.isArray(f)) o[key] = rng.pick(f);
    else if (f === 'int') o[key] = int(key);
    else if (f === 'tile') o[key] = tile();
    else if (f === 'int|null') o[key] = rng.next() < 0.3 ? null : int(key);
    else if (f === 'string') o[key] = text(key);
    else if (f === 'strings') o[key] = Array.from({ length: rng.int(0, 4) }, () => rng.pick(BELIEF_LIST).id);
    else if (f === 'list') o[key] = dealItems();
    else if (f === 'bool') o[key] = rng.next() < 0.5;
    else if (f === 'bool?') o[key] = rng.pick([true, false, undefined]);
    else if (f === 'item') o[key] = rng.next() < 0.03 ? { kind: 'unit', id: 'nonsense' } : rng.pick(ITEMS);
  }
  return o as unknown as Order;
}

/** What's wrong with the world, if anything (the first few things). */
function broken(game: Game, deep: boolean): string[] {
  const out: string[] = [];
  const bad = (s: string) => out.length < 6 && out.push(s);
  for (const p of game.players) {
    for (const k of ['gold', 'faith', 'culture'] as const) if (!Number.isFinite(p[k])) bad(`${p.name}'s ${k} is ${p[k]}`);
  }
  const ids = new Set<number>();
  const stacks = new Map<string, number>();
  for (const u of game.units) {
    const type = UNITS[u.type];
    if (!type) {
      bad(`unit ${u.id} is of no type (${u.type})`);
      continue;
    }
    if (ids.has(u.id)) bad(`two units have the id ${u.id}`);
    ids.add(u.id);
    if (!game.tiles[u.tile]) bad(`${type.name} ${u.id} is on no tile (${u.tile})`);
    if (!(u.hp > 0) || u.hp > 100) bad(`${type.name} ${u.id} has ${u.hp} hp`);
    if (!Number.isFinite(u.moves) || u.moves < 0) bad(`${type.name} ${u.id} has ${u.moves} moves`);
    if (!Number.isFinite(u.xp)) bad(`${type.name} ${u.id} has ${u.xp} xp`);
    if (!game.players[u.owner]) bad(`${type.name} ${u.id} is nobody's (${u.owner})`);
    if (isAircraft(u) || !game.tiles[u.tile]) continue;
    const water = !!TERRAINS[game.tiles[u.tile].terrain]?.water;
    const kind = stackKind(u.type, water);
    // (A city holds any number of civilians: what it builds, traders waiting to set off.)
    if (kind === 'civilian' && game.cities.some((c) => c.tile === u.tile)) continue;
    const key = `${u.tile}:${kind}`;
    if (stacks.has(key)) {
      const o = game.units.find((x) => x.id === stacks.get(key))!;
      const city = game.cities.find((c) => c.tile === u.tile);
      bad(`${type.name} ${u.id} (${game.players[u.owner].civ}) and ${UNITS[o.type].name} ${o.id} (${game.players[o.owner].civ}) are stacked (${kind}) on tile ${u.tile}${city ? `, in ${city.name}` : ''}`);
    }
    stacks.set(key, u.id);
    if (!water && u.embarked) bad(`${type.name} ${u.id} is embarked on land (tile ${u.tile})`);
    if (!canStand(game, u.type, u.tile) && !(water && type.domain === 'land')) bad(`${type.name} ${u.id} stands where it can't (tile ${u.tile}: ${game.tiles[u.tile].terrain}, ${game.tiles[u.tile].elevation ?? 'flat'}${game.tiles[u.tile].feature ? `, ${game.tiles[u.tile].feature}` : ''})`);
    if (water && type.domain === 'land' && !u.embarked) bad(`${type.name} ${u.id} is at sea and not embarked (tile ${u.tile})`);
  }
  const worked = new Map<number, string>();
  for (const c of game.cities) {
    if (!(c.pop >= 1) || !Number.isInteger(c.pop)) bad(`${c.name} has ${c.pop} people`);
    if (!Number.isFinite(c.hp) || !Number.isFinite(c.food)) bad(`${c.name} has hp ${c.hp}, food ${c.food}`);
    const specialists = Object.values(c.specialists ?? {}).reduce((s, n) => s + (n ?? 0), 0);
    if (c.worked.length + specialists > c.pop) bad(`${c.name} (${c.pop}) works ${c.worked.length} tiles with ${specialists} specialists`);
    for (const t of c.worked) {
      if (worked.has(t)) bad(`tile ${t} is worked by ${worked.get(t)} and ${c.name}`);
      worked.set(t, c.name);
      if (game.tiles[t]?.owner !== c.owner) bad(`${c.name} works tile ${t}, which isn't its owner's`);
    }
    if (game.tiles[c.tile]?.owner !== c.owner) bad(`${c.name}'s own tile isn't its owner's`);
  }
  // (Everything, for a number that isn't one: slow, so once a turn.)
  if (deep) {
    const seen = new Set<unknown>();
    const walk = (x: unknown, path: string) => {
      if (typeof x === 'number') {
        if (Number.isNaN(x)) bad(`${path} is NaN`);
        return;
      }
      if (!x || typeof x !== 'object' || ArrayBuffer.isView(x) || seen.has(x)) return;
      seen.add(x);
      if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${path}[${i}]`));
      else for (const [k, v] of Object.entries(x)) walk(v, `${path}.${k}`);
    };
    walk({ players: game.players, units: game.units, cities: game.cities, relations: game.relations, congress: game.congress, clans: game.clans }, 'game');
  }
  return out;
}

/** Problems found, each kind once (by its words with the numbers out), with how it came about. */
const problems = new Map<string, string>();
function report(what: string, how: string) {
  const key = what.replace(/\d+/g, '#').slice(0, 160);
  if (problems.has(key)) return;
  problems.set(key, how);
  console.log(`PROBLEM ${what}\n   ${how}`);
}

function play(seed: number): { turn: number; orders: number; ok: number } {
  const settings: Settings = {
    size,
    type: seed % 3 === 0 ? 'archipelago' : seed % 3 === 1 ? 'continents' : 'pangaea',
    speed: 'quick',
    timer: 0,
    cityStates: MAP_SIZES[size].cityStates,
    barbarians: true,
    victories: { domination: true, science: true, culture: true, diplomatic: true, score: true },
    turnLimit: TURN_LIMITS.quick,
    wrap: true,
    disasters: true,
  };
  const rng = new Rng(seed * 104729);
  const civs = CIV_LIST.map((c) => ({ c, k: rng.next() })).sort((a, b) => a.k - b.k).map((x) => x.c);
  const n = MAP_SIZES[size].players;
  const seats = civs.slice(0, n).map((c, i) => ({ user: i < people ? `person${i}` : null, name: c.leader, civ: c.id, bot: i >= people, team: undefined }));
  const game = createGame(settings, seats, seed);
  const persons = game.players.filter((p) => p.user);
  let orders = 0;
  let ok = 0;
  const at = () => `seed ${seed}, turn ${game.turn}`;
  const guard = (what: string, f: () => void) => {
    try {
      f();
    } catch (err) {
      report(`${what} threw: ${err instanceof Error ? err.message : String(err)}`, `${at()}\n${err instanceof Error ? err.stack?.split('\n').slice(1, 5).join('\n') : ''}`);
    }
  };
  while (!game.over && game.turn <= turns) {
    for (const p of game.players) {
      if (!p.alive) continue;
      // (A bot plays a person's civ first, so it has an empire for its orders to be about.)
      if (p.user) p.bot = true;
      guard(`${p.civ}'s bot turn`, () => botTurn(game, p));
      if (p.user) p.bot = false;
      for (const w of broken(game, false)) report(w, `${at()}, after ${p.civ}'s bot turn`);
    }
    for (const p of persons) {
      if (!p.alive || game.over) continue;
      for (let i = 0; i < perTurn && !game.over; i++) {
        const o = makeOrder(game, p, rng);
        const gold = p.gold;
        let done = false;
        guard(`order ${JSON.stringify(o)}`, () => {
          done = apply(game, p.index, o).ok;
        });
        orders++;
        if (done) ok++;
        const how = `${at()}, ${p.civ}: ${JSON.stringify(o)} (${done ? 'done' : 'refused'})`;
        if (gold >= 0 && p.gold < 0) report(`an order took the treasury below zero (${o.t})`, how);
        for (const w of broken(game, false)) report(w, how);
      }
      guard(`${p.civ}'s automation`, () => automate(game, p));
      // What the server would send them now: a state the rules allow must also be one the views can draw.
      guard(`${p.civ}'s view`, () => {
        viewFor(game, p, null);
        yieldsWire(game, p);
        statsFor(game, p);
        for (const c of citiesOf(game, p.index)) cityInfo(game, p, c);
      });
    }
    guard('the watcher\'s view', () => viewFor(game, null, null));
    guard('the turn\'s end', () => endTurn(game));
    for (const w of broken(game, true)) report(w, `${at()}, after the turn ended`);
  }
  return { turn: game.turn, orders, ok };
}

let total = 0;
for (const seed of seeds) {
  const t0 = Date.now();
  const r = play(seed);
  total += r.orders;
  console.log(`seed ${seed}: to turn ${r.turn}, ${r.orders} orders (${r.ok} done) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
console.log(`\n${total} orders, ${problems.size} kind${problems.size === 1 ? '' : 's'} of problem`);
process.exit(problems.size ? 1 : 0);
