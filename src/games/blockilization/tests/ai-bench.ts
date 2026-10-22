import { botTurn } from '../rules/ai';
import { cityHooks } from '../rules/combat';
import { CIV_LIST } from '../rules/civs';
import { createGame } from '../rules/core';
import { endTurn, eraOf, score } from '../rules/game';
import { Rng } from '../rules/mapgen';
import { DIFFICULTIES, type Difficulty } from '../rules/difficulty';
import { MAP_SIZES, MAP_TYPES, SPEED_LIST, TURN_LIMITS, type Game, type MapSize, type MapType, type Settings, type Speed } from '../rules/state';
import { spiesOf, stolen } from '../rules/trade';
import { UNITS } from '../rules/units';
import { ERAS } from '../rules/techs';
import { eraTurnLimit, SCENARIOS, withScenario } from '../rules/starts';
import { EUREKAS } from '../rules/eurekas';

/**
 * The bots' benchmark: bot-only games on several seeds and map sizes, played to the end, with what
 * tells how well the bots play (cities by turns 60 and 120, wars declared, cities taken, how and when
 * each game was won, turns spent broke, when religions were founded, how happy the civs were, how fast
 * new cities grow, what spies stole) and how fast they think (milliseconds per bot turn, of the
 * processor's time: other work on a busy machine doesn't count).
 *
 * Bundle and run from the platform's folder (it has esbuild):
 *   npx esbuild tests/ai-bench.ts --bundle --platform=node --format=esm --outfile=bench.mjs
 *   node bench.mjs small 1-8 [difficulty] [teams] [speed] [map type]
 * Sizes and seeds: `small 1-8`, `standard 1,2,3,4`, `large 1-2`. A game per line, then the totals.
 * `teams`: the civs in two teams (the first half and the second: 2v2 on a small map). `standard`,
 * `epic` or `marathon`: at that speed (turn limit 500, 750, 1500) rather than quick (330). A map type
 * (`pangaea`, `archipelago`, `fractal`, `inland_sea`, `highlands`, `earth`) instead of continents;
 * `true`: on the Earth, with true starting places. `flat`: a world with edges east and west (new
 * games wrap round). `huge` is a size too.
 * `calm`: no disasters (volcanoes, floods, storms, the rising sea: `rules/disasters.ts`), as games
 * were before them; else each game's line says how many it had.
 * `era=4`: begun in a later era (by `ERAS`: 4 is the Industrial), its turn limit shorter
 * (`rules/starts.ts`); a scenario's id (`cold_war`, `ancient_rivals`, `island_kings`, `world_war`)
 * sets the game up as that scenario does (its map's size too, unless one's given).
 */

const size = (process.argv[2] ?? 'small') as MapSize;
const seeds = parseSeeds(process.argv[3] ?? '1-4');
const difficulty = process.argv.slice(4).find((x) => x in DIFFICULTIES) as Difficulty | undefined;
const teams = process.argv.slice(4).includes('teams');
const speed = (process.argv.slice(4).find((x) => SPEED_LIST.includes(x as Speed)) as Speed | undefined) ?? 'quick';
const flat = process.argv.slice(4).includes('flat');
const calm = process.argv.slice(4).includes('calm');
const trueStarts = process.argv.slice(4).includes('true');
const mapType = (process.argv.slice(4).find((x) => MAP_TYPES.includes(x as MapType)) as MapType | undefined) ?? 'continents';
const startEra = Number(process.argv.slice(4).find((x) => /^era=\d$/.test(x))?.slice(4) ?? 0);
const scenario = SCENARIOS[process.argv.slice(4).find((x) => x in SCENARIOS) ?? ''];
if (process.argv.slice(4).some((x) => !(x in DIFFICULTIES) && !(x in SCENARIOS) && !/^era=\d$/.test(x) && x !== 'teams' && x !== 'flat' && x !== 'true' && x !== 'calm' && !SPEED_LIST.includes(x as Speed) && !MAP_TYPES.includes(x as MapType))) throw new Error(`Unknown option in ${process.argv.slice(4).join(' ')}`);

/** The processor time this process has used, in milliseconds (unlike the clock, not slowed by other work). */
function cpuNow(): number {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

/** Seeds from `1-8` or `1,5,9`. */
function parseSeeds(s: string): number[] {
  if (s.includes('-')) {
    const [a, b] = s.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  }
  return s.split(',').map(Number);
}

interface Result {
  seed: number;
  /** Each major civ's cities at turns 60 and 120 (in seat order). */
  cities60: number[];
  cities120: number[];
  /** World wonders built by turns 40, 70 and 100. */
  wonders: number[];
  wars: number;
  captured: number;
  /** Civs destroyed. */
  eliminated: number;
  how: string;
  winner: string;
  turn: number;
  /** Turns a civ ended with no gold and less coming in (a unit disbanded for want of pay). */
  broke: number;
  /** Turns a civ ended with less gold coming in than going out. */
  negative: number;
  ms: number[];
  /** Bot turns after turn 200, for how fast they are late in the game. */
  lateMs: number[];
  endMs: number[];
  /** The turn each religion was founded on, in order. */
  religions: number[];
  /** Each major civ's happiness at the end of each turn, and how many of those turns it was below zero. */
  mood: number[];
  unhappy: number;
  /** Turns each new city (not a capital) took to reach size 5. */
  toFive: number[];
  /** Techs stolen by spies, and spies caught. */
  stolen: number;
  caught: number;
  /** City-state quests done (each civ's doing of one counted), and World Congress resolutions passed. */
  quests: number;
  passed: number;
  /** Cities liberated (and civs or city-states brought back to life by it), pledges to protect city-states made, and pledges ended (broken or lapsed). */
  liberated: number;
  revived: number;
  pledges: number;
  pledgesEnded: number;
  /** Pledges broken by their pledgers' own doing (a tribute demanded of, or war declared on, the city-state). */
  pledgesBroken: number;
  /** Eurekas had by each civ by the end (on average), and the share of the techs they learned they'd had one for. */
  eurekas: number;
  boosted: number;
  /** The turn each era was first reached by the leader, and by the median civ (by era index). */
  eraLeader: number[];
  eraMedian: number[];
  /** Nuclear weapons built (each seen once) and fired (strikes that landed, not bombs shot down); the turn of the first strike. */
  nukesBuilt: number;
  nukesFired: number;
  /** Capitulations (a civ become another's vassal), vassals that broke free, vassals set free; vassals at the end. */
  knelt: number;
  brokeFree: number;
  setFree: number;
  vassals: number;
  /** Barbarian clans (camps) there were; their bribes, warriors hired and raids paid for; and those that settled as city-states. */
  clans: number;
  bribes: number;
  hires: number;
  incites: number;
  settled: number;
  /** Corps and armies formed, and the turn of the first. */
  corps: number;
  armies: number;
  firstCorps?: number;
  firstNuke?: number;
  /** The world's disasters: eruptions, floods, storms risen, times the sea rose, and the carbon burnt by the end. */
  eruptions: number;
  floods: number;
  storms: number;
  rises: number;
  co2: number;
  errors: string[];
}

function play(seed: number): Result {
  const settings: Settings = {
    size,
    type: mapType,
    speed,
    timer: 0,
    cityStates: MAP_SIZES[size].cityStates,
    barbarians: true,
    victories: { domination: true, science: true, culture: true, diplomatic: true, score: true },
    turnLimit: TURN_LIMITS[speed],
    wrap: !flat,
    ...(trueStarts ? { trueStarts } : {}),
    disasters: !calm,
  };
  if (difficulty) settings.difficulty = difficulty;
  if (startEra) Object.assign(settings, { startEra, turnLimit: eraTurnLimit(speed, startEra) });
  if (scenario) Object.assign(settings, withScenario(settings, scenario));
  // A different set of civs each seed, so every leader gets played.
  const rng = new Rng(seed * 7919);
  const civs = CIV_LIST.map((c) => ({ c, k: rng.next() })).sort((a, b) => a.k - b.k).map((x) => x.c);
  const n = Math.min(scenario?.players ?? Infinity, MAP_SIZES[settings.size].players);
  const seats = civs.slice(0, n).map((c, i) => ({ user: null, name: c.leader, civ: c.id, bot: true, team: teams ? (i < n / 2 ? 0 : 1) : undefined }));
  const g: Game = createGame(settings, seats, seed);
  const majors = g.players.filter((p) => !p.cityState && p.civ !== 'barbarian');
  const r: Result = { seed, cities60: [], cities120: [], wonders: [], wars: 0, captured: 0, eliminated: 0, how: '', winner: '', turn: 0, broke: 0, negative: 0, ms: [], lateMs: [], endMs: [], religions: [], mood: [], unhappy: 0, toFive: [], stolen: 0, caught: 0, quests: 0, passed: 0, liberated: 0, revived: 0, pledges: 0, pledgesEnded: 0, pledgesBroken: 0, eurekas: 0, boosted: 0, eraLeader: [], eraMedian: [], eruptions: 0, floods: 0, storms: 0, rises: 0, co2: 0, nukesBuilt: 0, nukesFired: 0, knelt: 0, brokeFree: 0, setFree: 0, vassals: 0, clans: 0, bribes: 0, hires: 0, incites: 0, settled: 0, corps: 0, armies: 0, errors: [] };
  const pledgesSeen = new Set<string>();
  let living = g.players.map((p) => p.alive);
  const owners = new Map<number, number>();
  // When each city was first seen (its founding), and the spies each civ had last turn (one fewer: caught).
  const founded = new Map<number, number>();
  let spies = majors.map((p) => spiesOf(p).length);
  const questsSeen = new Set<string>();
  let lastSession = -1;
  // The turn each civ first reached each era.
  const reached = majors.map(() => [] as number[]);
  const nuked = cityHooks.nuked;
  cityHooks.nuked = (game, by, hit, at) => {
    r.nukesFired++;
    r.firstNuke ??= game.turn;
    nuked(game, by, hit, at);
  };
  const nukesSeen = new Set<number>();
  // Capitulations and the ends of them, as they happen (the world's memory of them fades).
  const vassalEvents = new Set<string>();
  // The clans' dealings, each seen once; and the city-states kept for the clans (one come to life has settled).
  const clanSeen = new Set<string>();
  const unsettled = new Set(g.players.filter((p) => p.unsettled).map((p) => p.index));
  // (Corps and armies, each seen once.)
  const formed = new Set<string>();
  const learn = stolen.learn;
  stolen.learn = (game, p, tech) => {
    r.stolen++;
    learn(game, p, tech);
  };
  const cityCount = () => majors.map((p) => g.cities.filter((c) => c.owner === p.index).length);
  let war = majors.map((p) => majors.map((o) => p.diplomacy.war[o.index]));
  // Wars declared and religions founded since last looked (after each bot's turn and the turn's end).
  const countWars = () => {
    majors.forEach((p, i) => majors.forEach((o, j) => (r.wars += j > i && !war[i][j] && p.diplomacy.war[o.index] ? 1 : 0)));
    war = majors.map((p) => majors.map((o) => p.diplomacy.war[o.index]));
    while (r.religions.length < Object.keys(g.religions).length) r.religions.push(g.turn);
  };
  while (!g.over && g.turn < Math.max(600, settings.turnLimit + 10)) {
    const alive = majors.filter((p) => p.alive).length;
    for (const p of g.players) {
      if (!p.bot || !p.alive) continue;
      const t0 = cpuNow();
      // (Its pledges before its turn: one gone after it, it broke.)
      const held = g.players.filter((cs) => cs.cityState?.pledges?.[p.index] !== undefined);
      try {
        botTurn(g, p);
      } catch (e) {
        if (r.errors.length < 5) r.errors.push(`T${g.turn} ${p.civ}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`);
      }
      const ms = cpuNow() - t0;
      r.pledgesBroken += held.filter((cs) => cs.cityState?.pledges?.[p.index] === undefined).length;
      countWars();
      if (p.cityState || p.civ === 'barbarian') continue;
      r.ms.push(ms);
      if (g.turn > 200) r.lateMs.push(ms);
    }
    const t0 = cpuNow();
    endTurn(g);
    r.endMs.push(cpuNow() - t0);
    countWars();
    for (const e of g.events ?? []) {
      if (e.kind === 'eruption') r.eruptions++;
      if (e.kind === 'flood') r.floods++;
      if (e.kind === 'storm' && e.rose) r.storms++;
    }
    r.eliminated += alive - majors.filter((p) => p.alive).length;
    for (const c of g.cities) {
      const was = owners.get(c.id);
      if (was !== undefined && was !== c.owner && !g.players[c.owner].cityState && g.players[c.owner].civ !== 'barbarian') r.captured++;
      owners.set(c.id, c.owner);
    }
    for (const p of majors) {
      if (!p.alive) continue;
      if ((p.lastIncome?.gold ?? 0) < 0) r.negative++;
      if ((p.lastIncome?.gold ?? 0) < 0 && p.gold === 0) r.broke++;
      const mood = p.lastIncome?.happiness ?? 0;
      r.mood.push(mood);
      if (mood < 0) r.unhappy++;
    }
    for (const c of g.cities) {
      if (!founded.has(c.id)) founded.set(c.id, c.capital || g.players[c.owner].cityState ? -1 : g.turn);
      const at = founded.get(c.id)!;
      if (at >= 0 && c.pop >= 5) {
        r.toFive.push(g.turn - at);
        founded.set(c.id, -1);
      }
    }
    majors.forEach((p, i) => (r.caught += Math.max(0, spies[i] - spiesOf(p).length)));
    // Quests done since last looked (a quest's civs that have done it, new ones), and a session's resolutions passed.
    for (const cs of g.players) for (const q of cs.cityState?.quests ?? []) for (const d of q.done) {
      const key = `${cs.index}:${q.kind}:${q.until}:${d}`;
      if (!questsSeen.has(key)) (questsSeen.add(key), r.quests++);
    }
    // Pledges made and ended since last looked (each by its turn), and the fallen brought back.
    for (const cs of g.players) {
      for (const [p, t] of Object.entries(cs.cityState?.pledges ?? {})) if (!pledgesSeen.has(`+${cs.index}:${p}:${t}`)) (pledgesSeen.add(`+${cs.index}:${p}:${t}`), r.pledges++);
      for (const [p, t] of Object.entries(cs.cityState?.broken ?? {})) if (!pledgesSeen.has(`-${cs.index}:${p}:${t}`)) (pledgesSeen.add(`-${cs.index}:${p}:${t}`), r.pledgesEnded++);
    }
    r.revived += g.players.filter((p, i) => p.alive && !living[i] && !unsettled.has(i)).length;
    r.settled += g.players.filter((p, i) => p.alive && !living[i] && unsettled.has(i)).length;
    for (const c of g.clans ?? []) {
      const seen = (key: string) => !clanSeen.has(key) && !!clanSeen.add(key);
      if (seen(`c${c.id}`)) r.clans++;
      for (const [p, until] of Object.entries(c.bribes ?? {})) if (seen(`b${c.id}:${p}:${until}`)) r.bribes++;
      if (c.hired !== undefined && seen(`h${c.id}:${c.hired}`)) r.hires++;
      if (c.incited && seen(`i${c.id}:${c.incited.until}`)) r.incites++;
    }
    for (const u of g.units) {
      if (!u.size || formed.has(`${u.size}:${u.id}`)) continue;
      formed.add(`${u.size}:${u.id}`);
      if (u.size === 2) r.corps++;
      else r.armies++;
      r.firstCorps ??= g.turn;
    }
    living = g.players.map((p) => p.alive);
    if (g.congress?.last && g.congress.last.turn !== lastSession) {
      lastSession = g.congress.last.turn;
      r.passed += g.congress.last.results.filter((x) => x.passed).length;
    }
    majors.forEach((p, i) => {
      if (p.alive) for (let e = 0; e <= eraOf(p); e++) reached[i][e] ??= g.turn;
    });
    spies = majors.map((p) => spiesOf(p).length);
    for (const u of g.units) if (UNITS[u.type]?.abilities?.includes('nuke') && !nukesSeen.has(u.id)) (nukesSeen.add(u.id), r.nukesBuilt++);
    for (const e of g.relations?.events ?? []) {
      const key = `${e.kind}:${e.by}:${e.to}:${e.turn}`;
      if ((e.kind === 'vassal' || e.kind === 'independence' || e.kind === 'freed') && !vassalEvents.has(key)) {
        vassalEvents.add(key);
        if (e.kind === 'vassal') r.knelt++;
        else if (e.kind === 'independence') r.brokeFree++;
        else r.setFree++;
      }
    }
    if (g.turn === 60) r.cities60 = cityCount();
    if (g.turn === 120) r.cities120 = cityCount();
    if (g.turn === 40 || g.turn === 70 || g.turn === 100) r.wonders.push(Object.keys(g.wonders).length);
  }
  stolen.learn = learn;
  cityHooks.nuked = nuked;
  for (let e = 1; e < ERAS.length; e++) {
    const turns = reached.map((x) => x[e]).filter((t): t is number => t !== undefined).sort((a, b) => a - b);
    if (turns.length) r.eraLeader[e] = turns[0];
    if (turns.length * 2 > majors.length) r.eraMedian[e] = turns[Math.floor(majors.length / 2)];
  }
  r.liberated = (g.relations?.events ?? []).filter((e) => e.kind === 'liberate').length;
  r.eurekas = avg(majors.map((p) => p.eurekas?.length ?? 0));
  r.boosted = avg(majors.map((p) => p.techs.filter((t) => p.eurekas?.includes(t)).length / Math.max(1, p.techs.filter((t) => t in EUREKAS).length)));
  r.vassals = g.players.filter((p) => p.alive && p.vassal && g.players[p.vassal.master]?.alive).length;
  r.how = g.over?.how ?? 'none';
  r.winner = g.over ? `${g.players[g.over.winner].civ}${teams ? ` (team ${(g.players[g.over.winner].team ?? 0) + 1})` : ''}` : '';
  r.turn = g.turn;
  r.rises = g.climate?.rises ?? 0;
  r.co2 = g.climate?.co2 ?? 0;
  const scores = majors.map((p) => `${p.civ}${p.alive ? '' : '†'}:${g.cities.filter((c) => c.owner === p.index).length}c/${p.techs.length}t/${score(g, p)}`).join(' ');
  console.log(`seed ${seed}: ${r.how} by ${r.winner} T${r.turn} | c60 [${r.cities60.join(',')}] c120 [${r.cities120.join(',')}] wonders [${r.wonders.join(',')}] wars ${r.wars} taken ${r.captured} dead ${r.eliminated} broke ${r.broke} neg ${r.negative} religions [${r.religions.join(',')}] mood ${avg(r.mood).toFixed(1)} unhappy ${pct(r.unhappy, r.mood.length)} size5 ${avg(r.toFive).toFixed(0)}t steals ${r.stolen} caught ${r.caught} quests ${r.quests} passed ${r.passed} freed ${r.liberated}/${r.revived} pledges ${r.pledges}/${r.pledgesEnded}/${r.pledgesBroken} nukes ${r.nukesBuilt}/${r.nukesFired}${r.firstNuke ? ` (T${r.firstNuke})` : ''} vassals ${r.knelt}/${r.brokeFree}/${r.setFree} (${r.vassals} at the end) clans ${r.clans} ${r.bribes}/${r.hires}/${r.incites} settled ${r.settled} corps ${r.corps}/${r.armies}${r.firstCorps ? ` (T${r.firstCorps})` : ''} | world ${r.eruptions} eruptions ${r.floods} floods ${r.storms} storms ${r.rises} sea rises (${r.co2} carbon) | bot ms avg ${avg(r.ms).toFixed(1)} max ${Math.max(...r.ms).toFixed(0)} late avg ${avg(r.lateMs).toFixed(1)} | ${scores}`);
  for (const e of r.errors) console.log('  ERROR', e);
  // The World Congress's projects: when each opened and was done (its cost), and who placed (g, s, b).
  const projects = (g.congress?.projects ?? []).map((x) => `${x.id} T${x.since}-${x.done ? `T${x.done}` : 'open'} (${x.cost})${x.tiers ? ` ${Object.entries(x.tiers).map(([i, t]) => `${t[0]}:${g.players[Number(i)].civ}`).join(' ')}` : ''}`);
  if (projects.length) console.log(`  projects ${projects.join('; ')}`);
  return r;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const pct = (n: number, of: number) => `${of ? Math.round((100 * n) / of) : 0}%`;
const fmt = (xs: number[]) => `${avg(xs).toFixed(1)} (${Math.min(...xs)}-${Math.max(...xs)})`;

const results = seeds.map(play);
const all = (f: (r: Result) => number[]) => results.flatMap(f);
const hows = new Map<string, number>();
for (const r of results) hows.set(r.how, (hows.get(r.how) ?? 0) + 1);
const winners = new Set(results.map((r) => r.winner));
console.log(`\n== ${size} × ${results.length} seeds${mapType !== 'continents' ? ` on ${mapType}` : ''}${difficulty ? ` (${difficulty})` : ''}${teams ? ' (two teams)' : ''}${calm ? ' (no disasters)' : ''}${speed !== 'quick' ? ` (${speed} speed)` : ''}${flat ? ' (flat)' : ' (wraps)'}`);
console.log(`cities T60   ${fmt(all((r) => r.cities60))}`);
console.log(`cities T120  ${fmt(all((r) => r.cities120))}`);
console.log(`wonders      T40 ${fmt(results.map((r) => r.wonders[0] ?? 0))}   T70 ${fmt(results.map((r) => r.wonders[1] ?? 0))}   T100 ${fmt(results.map((r) => r.wonders[2] ?? 0))}`);
console.log(`wars/game    ${avg(results.map((r) => r.wars)).toFixed(1)}   cities taken/game ${avg(results.map((r) => r.captured)).toFixed(1)}   civs destroyed/game ${avg(results.map((r) => r.eliminated)).toFixed(1)}`);
console.log(`victories    ${[...hows].map(([k, v]) => `${k} ${v}`).join(', ')}   before the limit ${results.filter((r) => r.how !== 'score' && r.how !== 'none').length}/${results.length}   end turn avg ${avg(results.map((r) => r.turn)).toFixed(0)}   ${winners.size} different winners`);
const nth = Array.from({ length: Math.max(0, ...results.map((r) => r.religions.length)) }, (_, i) => results.flatMap((r) => r.religions.slice(i, i + 1)));
console.log(`religions    ${nth.map((ts, i) => `#${i + 1} T${avg(ts).toFixed(0)} (${ts.length}/${results.length})`).join('  ')}`);
console.log(`happiness    avg ${avg(all((r) => r.mood)).toFixed(1)}   unhappy ${pct(results.reduce((s, r) => s + r.unhappy, 0), all((r) => r.mood).length)} of civ-turns   new cities reach size 5 in ${avg(all((r) => r.toFive)).toFixed(0)} turns (${all((r) => r.toFive).length} cities)`);
const era = (f: (r: Result) => number | undefined) => {
  const ts = results.map(f).filter((t): t is number => t !== undefined);
  return ts.length ? `T${avg(ts).toFixed(0)}${ts.length < results.length ? ` (${ts.length}/${results.length})` : ''}` : '-';
};
console.log(`eras (first civ / median civ)  ${ERAS.slice(1).map((name, i) => `${name} ${era((r) => r.eraLeader[i + 1])}/${era((r) => r.eraMedian[i + 1])}`).join('  ')}`);
console.log(`eurekas      ${avg(results.map((r) => r.eurekas)).toFixed(1)} a civ   ${Math.round(avg(results.map((r) => r.boosted)) * 100)}% of the techs learned had their boost first`);
console.log(`spies        ${avg(results.map((r) => r.stolen)).toFixed(1)} techs stolen/game   ${avg(results.map((r) => r.caught)).toFixed(1)} spies caught/game   quests ${avg(results.map((r) => r.quests)).toFixed(1)} done/game   resolutions ${avg(results.map((r) => r.passed)).toFixed(1)} passed/game`);
console.log(`liberation   ${avg(results.map((r) => r.liberated)).toFixed(1)} cities liberated/game (${avg(results.map((r) => r.revived)).toFixed(1)} civs brought back)   pledges ${avg(results.map((r) => r.pledges)).toFixed(1)} made/game, ${avg(results.map((r) => r.pledgesEnded)).toFixed(1)} ended, ${avg(results.map((r) => r.pledgesBroken)).toFixed(1)} broken by their pledgers`);
console.log(`vassals      ${avg(results.map((r) => r.knelt)).toFixed(1)} capitulations/game   ${avg(results.map((r) => r.brokeFree)).toFixed(1)} broke free   ${avg(results.map((r) => r.vassals)).toFixed(1)} vassals at the end   in ${results.filter((r) => r.knelt).length}/${results.length} games`);
console.log(`clans        ${avg(results.map((r) => r.clans)).toFixed(1)} camps/game   ${avg(results.map((r) => r.bribes)).toFixed(1)} bribes   ${avg(results.map((r) => r.hires)).toFixed(1)} hired   ${avg(results.map((r) => r.incites)).toFixed(1)} raids paid for   ${avg(results.map((r) => r.settled)).toFixed(1)} settled as city-states (in ${results.filter((r) => r.settled).length}/${results.length} games)`);
console.log(`formations   ${avg(results.map((r) => r.corps)).toFixed(1)} corps/game   ${avg(results.map((r) => r.armies)).toFixed(1)} armies/game   in ${results.filter((r) => r.corps + r.armies).length}/${results.length} games${results.some((r) => r.firstCorps) ? `   first T${avg(results.flatMap((r) => (r.firstCorps ? [r.firstCorps] : []))).toFixed(0)}` : ''}`);
console.log(`nukes        ${avg(results.map((r) => r.nukesBuilt)).toFixed(1)} built/game   ${avg(results.map((r) => r.nukesFired)).toFixed(1)} fired/game   in ${results.filter((r) => r.nukesFired).length}/${results.length} games${results.some((r) => r.firstNuke) ? `   first strike T${avg(results.flatMap((r) => (r.firstNuke ? [r.firstNuke] : []))).toFixed(0)}` : ''}`);
console.log(`world        ${avg(results.map((r) => r.eruptions)).toFixed(1)} eruptions/game   ${avg(results.map((r) => r.floods)).toFixed(1)} floods/game   ${avg(results.map((r) => r.storms)).toFixed(1)} storms/game   ${avg(results.map((r) => r.rises)).toFixed(1)} sea rises/game   carbon ${fmt(results.map((r) => r.co2))}`);
console.log(`broke turns  ${avg(results.map((r) => r.broke)).toFixed(1)}/game   negative-income turns ${avg(results.map((r) => r.negative)).toFixed(1)}/game`);
console.log(`bot turn ms  avg ${avg(all((r) => r.ms)).toFixed(1)}  max ${Math.max(...all((r) => r.ms)).toFixed(0)}  after T200 avg ${avg(all((r) => r.lateMs)).toFixed(1)} max ${Math.max(0, ...all((r) => r.lateMs)).toFixed(0)}   endTurn avg ${avg(all((r) => r.endMs)).toFixed(1)}`);
console.log(`exceptions   ${results.reduce((s, r) => s + r.errors.length, 0)}`);
