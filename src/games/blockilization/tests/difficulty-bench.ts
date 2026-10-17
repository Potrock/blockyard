import { botTurn } from '../rules/ai';
import { CIV_LIST } from '../rules/civs';
import { createGame } from '../rules/core';
import { DIFFICULTIES, type Difficulty } from '../rules/difficulty';
import { diploHooks, relationsOf } from '../rules/diplomacy';
import { apply, endTurn, score } from '../rules/game';
import { Rng } from '../rules/mapgen';
import { MAP_SIZES, type Game, type MapSize, type Settings } from '../rules/state';

/**
 * The difficulty benchmark: a peaceful person against the bots. The first seat is a person played by
 * a stand-in (the bots' own logic, building sensibly, but never making war nor attacking: a passive
 * player), the rest are bots, at a difficulty; each game is played to the end, and the stand-in's
 * fate told: alive or not, its cities, its place by score, and who won how.
 *
 * Bundle and run from the platform's folder (it has esbuild):
 *   npx esbuild tests/difficulty-bench.ts --bundle --platform=node --format=esm --outfile=difficulty.mjs
 *   node difficulty.mjs small 1-6 settler
 */

const size = (process.argv[2] ?? 'small') as MapSize;
const [first, last] = (process.argv[3] ?? '1-4').split('-').map(Number);
const difficulty = (process.argv[4] ?? 'prince') as Difficulty;
if (!(difficulty in DIFFICULTIES)) throw new Error(`No difficulty ${difficulty}`);

interface Outcome {
  alive: boolean;
  cities: number;
  /** The stand-in's place by score among the civs (1: first). */
  place: number;
  won: boolean;
  how: string;
  turn: number;
}

function play(seed: number): Outcome {
  const settings: Settings = {
    size,
    type: 'continents',
    speed: 'quick',
    timer: 0,
    cityStates: MAP_SIZES[size].cityStates,
    barbarians: true,
    victories: { domination: true, science: true, culture: true, diplomatic: true, score: true },
    turnLimit: 330,
    difficulty,
  };
  const rng = new Rng(seed * 7919);
  const civs = CIV_LIST.map((c) => ({ c, k: rng.next() })).sort((a, b) => a.k - b.k).map((x) => x.c);
  const seats = civs.slice(0, MAP_SIZES[size].players).map((c, i) => ({ user: i === 0 ? 'stand-in' : null, name: c.leader, civ: c.id, bot: i !== 0 }));
  const g: Game = createGame(settings, seats, seed);
  const me = g.players[0];
  me.ai = { aim: 'science', aimed: 0, wars: {}, orders: {}, passive: true };
  while (!g.over && g.turn < 600) {
    for (const p of g.players) if (p.alive && (p.bot || p === me)) botTurn(g, p);
    // The deals put to it: answered as a bot would.
    for (const o of relationsOf(g).offers.filter((x) => x.to === me.index)) apply(g, me.index, { t: 'answer', offer: o.id, accept: diploHooks.evaluate(g, me, o).accept });
    endTurn(g);
  }
  const majors = g.players.filter((p) => !p.cityState && p.civ !== 'barbarian');
  const place = 1 + majors.filter((p) => p !== me && score(g, p) > score(g, me)).length;
  const out: Outcome = { alive: me.alive, cities: g.cities.filter((c) => c.owner === me.index).length, place, won: g.over?.winner === me.index, how: g.over?.how ?? 'none', turn: g.turn };
  console.log(`seed ${seed}: ${me.civ} ${out.alive ? 'alive' : 'dead'}, ${out.cities} cities, place ${place} of ${majors.length} | ${out.how} by ${g.over ? g.players[g.over.winner].civ : '-'} T${g.turn}`);
  return out;
}

const results: Outcome[] = [];
for (let seed = first; seed <= last; seed++) results.push(play(seed));
const n = results.length;
console.log(`\n== ${size} × ${n} (${difficulty}): the stand-in alive ${results.filter((r) => r.alive).length}/${n}, won ${results.filter((r) => r.won).length}/${n} (${results.filter((r) => r.won).map((r) => r.how).join(', ') || '-'}), first by score ${results.filter((r) => r.place === 1).length}/${n}, average place ${(results.reduce((s, r) => s + r.place, 0) / n).toFixed(1)}, average cities ${(results.reduce((s, r) => s + r.cities, 0) / n).toFixed(1)}`);
