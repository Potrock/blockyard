import { citiesOf, knows, nameTo, note, noteAll, techCost } from './core';
import { policyCost, scaled } from './economy';
import type { Effects } from './effects';
import type { City, Game, Player, Production } from './state';
import { TECHS } from './techs';
import { tourismOf } from './trade';

/**
 * The World Congress's international projects, Civ V's (Brave New World): a resolution that, passed,
 * opens a project every civ's cities may put production into (a choice in each city's build list, as
 * the spaceship's parts are). It can't be bought with gold; it's done when what all the civs have put
 * in reaches its cost (so much for each civ in the world when it opened), and each civ is rewarded by
 * how much it put in: the most, gold; the next, silver; the rest who put in a twentieth or more of
 * it, bronze. The World's Fair (once Industrialization is known by someone) is culture, a free social
 * policy for its gold; the International Games (Electricity) tourism and happiness; the International
 * Space Station (Rocketry: Civ V's needs Satellites, but its boost to the spaceship would come too
 * late here) science, and its parts built faster for gold and silver. Each is held once a game.
 */

export type ProjectId = 'worlds_fair' | 'international_games' | 'space_station';
export const PROJECT_IDS: ProjectId[] = ['worlds_fair', 'international_games', 'space_station'];

export type Tier = 'gold' | 'silver' | 'bronze';
export const TIERS: Tier[] = ['gold', 'silver', 'bronze'];

/**
 * A tier's reward: once, culture (in social policies' worth: a free policy is one), science (in the
 * worth of the tech being researched), tourism (in turns of the civ's own, toward every other civ, at
 * least 50); and what it keeps for good (every city's, as a policy's).
 */
export interface Reward {
  text: string;
  culture?: number;
  science?: number;
  tourism?: number;
  lasting?: Effects;
}

export interface ProjectType {
  id: ProjectId;
  name: string;
  /** Known by some civ, it may be proposed. */
  tech: string;
  /** Its cost for each civ in the world when it opens (before the game's speed). */
  perCiv: number;
  rewards: Record<Tier, Reward>;
}

/** (Civ V's costs are the same for every civ's share; here a little under a Modern wonder each, at this game's pace.) */
export const PROJECTS: Record<ProjectId, ProjectType> = {
  worlds_fair: {
    id: 'worlds_fair',
    name: "World's Fair",
    tech: 'industrialization',
    perCiv: 300,
    rewards: {
      gold: { text: 'A free social policy', culture: 1 },
      silver: { text: 'Culture: half a social policy', culture: 0.5 },
      bronze: { text: 'Culture: a quarter of a social policy', culture: 0.25 },
    },
  },
  international_games: {
    id: 'international_games',
    name: 'International Games',
    tech: 'electricity',
    perCiv: 375,
    rewards: {
      gold: { text: '+4 happiness in the capital and 25% more tourism, for good; ten turns of tourism at once', tourism: 10, lasting: { tourismPercent: 25, cities: [{ when: { capital: true }, effects: { happiness: 4 } }] } },
      silver: { text: '+2 happiness in the capital and 10% more tourism, for good; five turns of tourism at once', tourism: 5, lasting: { tourismPercent: 10, cities: [{ when: { capital: true }, effects: { happiness: 2 } }] } },
      bronze: { text: '+1 happiness in the capital, for good; five turns of tourism at once', tourism: 5, lasting: { cities: [{ when: { capital: true }, effects: { happiness: 1 } }] } },
    },
  },
  space_station: {
    id: 'space_station',
    name: 'International Space Station',
    tech: 'rocketry',
    perCiv: 450,
    rewards: {
      gold: { text: 'The tech being researched, finished; spaceship parts built 25% faster', science: 1, lasting: { spaceshipProduction: 25 } },
      silver: { text: 'Half the tech being researched; spaceship parts built 10% faster', science: 0.5, lasting: { spaceshipProduction: 10 } },
      bronze: { text: 'A quarter of the tech being researched', science: 0.25 },
    },
  },
};

/** A project opened by the World Congress: when, its cost, what each civ (by index) has put in; once done, when and each civ's tier. */
export interface WorldProject {
  id: ProjectId;
  since: number;
  cost: number;
  put: Record<number, number>;
  done?: number;
  tiers?: Record<number, Tier>;
}

export const isProject = (id: string): id is ProjectId => Object.hasOwn(PROJECTS, id);

const majors = (game: Game) => game.players.filter((p) => p.alive && !p.cityState && p.civ !== 'barbarian');

/** The project open now, by id (not done). */
export const openProject = (game: Game, id: string) => game.congress?.projects?.find((x) => x.id === id && !x.done);

/** All that's been put into a project. */
export const projectTotal = (x: WorldProject) => Object.values(x.put).reduce((s, n) => s + n, 0);

/** Production a project still wants (none open: there's nothing to build). */
export function projectLeft(game: Game, id: string): number {
  const x = openProject(game, id);
  return x ? Math.max(0, x.cost - projectTotal(x)) : Infinity;
}

/** Why the World Congress can't take up a project now, if it can't: no civ knows its tech, it's open, or it's been held. */
export function cannotHold(game: Game, id: ProjectId): string | null {
  const t = PROJECTS[id];
  if (!majors(game).some((p) => knows(p, t.tech))) return `${t.name} needs ${TECHS[t.tech]?.name ?? t.tech} known by some civilization`;
  if (openProject(game, id)) return `The ${t.name} is under way already`;
  if (game.congress?.projects?.some((x) => x.id === id)) return `The ${t.name} has been held already`;
  return null;
}

/** Whether a city can put its production into a project: it's open, and the city is a major civ's, and not a puppet. */
export function canContribute(game: Game, p: Player, c: City, id: string): boolean {
  return !!openProject(game, id) && !p.cityState && p.civ !== 'barbarian' && !c.puppet;
}

/** The projects a city can put production into. */
export const projectsFor = (game: Game, p: Player, c: City): Production[] => PROJECT_IDS.filter((id) => canContribute(game, p, c, id)).map((id) => ({ kind: 'project', id }));

/** A city's production (this turn's) goes into its civ's share. */
export function contribute(game: Game, c: City, id: string, prod: number) {
  const x = openProject(game, id);
  if (x && prod > 0) x.put[c.owner] = (x.put[c.owner] ?? 0) + prod;
}

/** The resolution passed: the project opens, its cost so much for each civ in the world. */
export function startProject(game: Game, id: ProjectId) {
  const c = game.congress;
  if (!c || openProject(game, id)) return;
  const x: WorldProject = { id, since: game.turn, cost: scaled(game, PROJECTS[id].perCiv * majors(game).length), put: {} };
  (c.projects ??= []).push(x);
  noteAll(game, (r) => (r.cityState || r.civ === 'barbarian' ? null : { text: `The ${PROJECTS[id].name} is open: every city may put its production into it (${x.cost} in all), and the civs that put in most are rewarded.`, kind: 'info', topic: 'congress' }));
}

/** Each civ's tier as things stand: the most put in, gold; the next, silver; the rest with a twentieth or more, bronze. */
export function tiersOf(x: WorldProject): Record<number, Tier> {
  const out: Record<number, Tier> = {};
  const ranked = Object.entries(x.put)
    .map(([i, n]) => ({ i: Number(i), n }))
    .filter((e) => e.n > 0 && e.n >= x.cost / 20)
    .sort((a, b) => b.n - a.n || a.i - b.i);
  ranked.forEach((e, k) => (out[e.i] = TIERS[Math.min(k, 2)]));
  return out;
}

/** Each turn (after the civs' own): a project its civs have put enough into is done, and rewarded. */
export function projectsTurn(game: Game) {
  for (const x of game.congress?.projects ?? []) if (!x.done && projectTotal(x) >= x.cost) finish(game, x);
}

function finish(game: Game, x: WorldProject) {
  const t = PROJECTS[x.id];
  x.done = game.turn;
  x.tiers = tiersOf(x);
  // Its cities move on to their next build (what they'd put in is in the project).
  for (const c of game.cities) if (c.queue[0]?.kind === 'project' && c.queue[0].id === x.id) c.queue.shift();
  for (const c of game.cities) c.queue = c.queue.filter((q) => q.kind !== 'project' || q.id !== x.id);
  const gold = majors(game).find((p) => x.tiers![p.index] === 'gold');
  noteAll(game, (r) => (r.cityState || r.civ === 'barbarian' ? null : { text: `The ${t.name} is done${gold ? `: ${gold === r ? 'you' : nameTo(r, gold)} put in the most` : ''}.`, kind: 'wonder', topic: r === gold ? undefined : 'congress' }));
  for (const p of majors(game)) {
    const tier = x.tiers[p.index];
    if (tier) reward(game, p, t.rewards[tier], `${tier === 'gold' ? 'Gold' : tier === 'silver' ? 'Silver' : 'Bronze'} at the ${t.name}`);
  }
}

/** A tier's reward, once (what lasts is `projectEffects`). */
function reward(game: Game, p: Player, r: Reward, title: string) {
  if (r.culture) {
    const culture = Math.round(policyCost(game, p) * r.culture);
    p.culture += culture;
    p.lifetimeCulture += culture;
  }
  if (r.science) {
    const science = Math.round((p.researching ? techCost(game, p, p.researching) : 200) * r.science);
    if (p.researching) p.research[p.researching] = (p.research[p.researching] ?? 0) + science;
    else p.spareScience = (p.spareScience ?? 0) + science;
  }
  if (r.tourism) {
    const tourism = Math.max(50, tourismOf(game, p) * r.tourism);
    for (const o of majors(game)) if (o !== p) p.tourism[o.index] = (p.tourism[o.index] ?? 0) + tourism;
  }
  note(game, p.index, { text: `${title}: ${r.text.charAt(0).toLowerCase()}${r.text.slice(1)}.`, kind: 'good', at: citiesOf(game, p.index).find((c) => c.capital)?.tile });
}

/** What a civ keeps for good from the projects it was rewarded at (every city's). */
export function projectEffects(game: Game, p: Player): Effects[] {
  const out: Effects[] = [];
  for (const x of game.congress?.projects ?? []) {
    const tier = x.tiers?.[p.index];
    const lasting = tier && PROJECTS[x.id].rewards[tier].lasting;
    if (lasting) out.push(lasting);
  }
  return out;
}
