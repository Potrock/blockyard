import { BUILDINGS } from './buildings';
import { capitalOf, cityById, knowsOf, nameTo, note, random, seesResource, speed } from './core';
import { luxuries, strategic } from './economy';
import { cityReligion } from './faith';
import { distance } from './hex';
import { NATURAL_WONDERS } from './nature';
import type { Game, Player } from './state';
import { RESOURCES } from './terrain';
import { policyMet } from './policies';
import { routesOf } from './trade';

/**
 * City-state quests, Civ V's way: each city-state asks for a thing or two at a time, of every civ
 * that has met it: clear a barbarian camp near it, bring in a resource it lacks, build a wonder,
 * find a natural wonder, spread your religion to it, open a trade route to it. Doing one wins its
 * influence (a quest anyone can do once, each who does; one only one can do, the first). A quest
 * lasts fifty turns (at speed), or until it can no longer be done.
 */

export type QuestKind = 'camp' | 'resource' | 'wonder' | 'nature' | 'religion' | 'route';

export interface Quest {
  kind: QuestKind;
  /** What it's for: the camp's tile, the resource, the wonder or natural wonder (by id). */
  target?: number | string;
  /** The turn it lapses. */
  until: number;
  /** The civs that have done it (each wins its influence once). */
  done: number[];
}

/** Influence each kind of quest wins. */
export const QUEST_REWARD: Record<QuestKind, number> = { camp: 30, resource: 30, wonder: 40, nature: 25, religion: 30, route: 25 };

/** The quests only one civ can do: there's one camp to clear, one wonder to build. */
const FIRST_ONLY: QuestKind[] = ['camp', 'wonder'];

/** The most quests a city-state asks at once. */
const MAX_QUESTS = 2;

/** A city-state's quests (none if it isn't one). */
export const questsOf = (cs: Player): Quest[] => (cs.cityState ? (cs.cityState.quests ??= []) : []);

/** A quest in words, for the one it's asked of. */
export function questText(game: Game, cs: Player, q: Quest): string {
  switch (q.kind) {
    case 'camp':
      return 'Clear the barbarian camp near us';
    case 'resource':
      return `Bring ${RESOURCES[q.target as string]?.name ?? q.target} into your empire`;
    case 'wonder':
      return `Build the ${BUILDINGS[q.target as string]?.name ?? q.target}`;
    case 'nature':
      return `Find ${NATURAL_WONDERS[q.target as string]?.name ?? q.target}`;
    case 'religion':
      return `Spread your religion to ${capitalOf(game, cs.index)?.name ?? cs.name}`;
    case 'route':
      return `Open a trade route to ${capitalOf(game, cs.index)?.name ?? cs.name}`;
  }
}

/** Whether a civ has done a quest (the camp is done when it's cleared: `campCleared`). */
function fulfils(game: Game, p: Player, cs: Player, q: Quest): boolean {
  const home = capitalOf(game, cs.index);
  switch (q.kind) {
    case 'camp':
      return false;
    case 'resource': {
      const r = q.target as string;
      return luxuries(game, p).has(r) || (strategic(game, p)[r]?.have ?? 0) > 0;
    }
    case 'wonder':
      return game.wonders[q.target as string] === p.index;
    case 'nature':
      return !!game.found?.[q.target as string]?.by.includes(p.index);
    case 'religion':
      return !!home && !!p.religion && cityReligion(home) === p.religion;
    case 'route':
      return !!home && routesOf(p).some((r) => cityById(game, r.to) === home);
  }
}

/** Whether a quest can't be done any more by anyone (the camp gone, the wonder built, the natural wonder found by all). */
function lapsed(game: Game, q: Quest): boolean {
  if (game.turn >= q.until) return true;
  if (q.kind === 'camp') return !game.tiles[q.target as number]?.camp;
  if (q.kind === 'wonder') return game.wonders[q.target as string] !== undefined;
  return false;
}

/** The influence a quest done wins, told to the civ. */
function reward(game: Game, p: Player, cs: Player, q: Quest) {
  q.done.push(p.index);
  p.influence[cs.index] = (p.influence[cs.index] ?? 0) + QUEST_REWARD[q.kind];
  note(game, p.index, { text: `${cs.name} thanks you (${inLine(questText(game, cs, q))}): +${QUEST_REWARD[q.kind]} influence.`, at: capitalOf(game, cs.index)?.tile, kind: 'citystate' });
}

/** A quest's words in the middle of a sentence: its first letter small (the names in it as they are). */
const inLine = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A barbarian camp cleared by a civ: the quests for it are done (`barbarians.ts` calls it). One a city-state clears is gone, and its quest lapses. */
export function campCleared(game: Game, p: Player, tile: number) {
  if (p.cityState) return;
  for (const cs of game.players) for (const q of questsOf(cs)) if (q.kind === 'camp' && q.target === tile && !q.done.length && knowsOf(p, cs)) reward(game, p, cs, q);
}

/** The quests a city-state could ask now, of each kind it has none of yet. */
function candidates(game: Game, cs: Player): Quest[] {
  const home = capitalOf(game, cs.index);
  if (!home) return [];
  const asked = new Set(questsOf(cs).map((q) => q.kind));
  const until = game.turn + Math.round(50 * speed(game));
  const majors = game.players.filter((p) => p.alive && !p.cityState && p.civ !== 'barbarian' && knowsOf(p, cs));
  const out: Quest[] = [];
  if (!majors.length) return out;
  const quest = (kind: QuestKind, target?: number | string) => !asked.has(kind) && out.push({ kind, target, until, done: [] });
  // A camp within eight tiles.
  const camp = game.tiles.findIndex((t, i) => t.camp && distance(game.grid, i, home.tile) <= 8);
  if (camp >= 0) quest('camp', camp);
  // A luxury or strategic resource somewhere in the world that a civ who knows it doesn't have, and
  // that every civ asked can see (no Uranium of those without the tech to find it).
  const resources = [...new Set(game.tiles.flatMap((t) => (t.resource && RESOURCES[t.resource].kind !== 'bonus' ? [t.resource] : [])))].filter(
    (r) => majors.every((p) => seesResource(p, r)) && majors.some((p) => !luxuries(game, p).has(r) && !(strategic(game, p)[r]?.have ?? 0)),
  );
  if (resources.length) quest('resource', resources[Math.floor(random(game) * resources.length)]);
  // A world wonder not yet built that a civ who knows it can build (its tech known, its policy tree open).
  const wonders = Object.values(BUILDINGS).filter((b) => b.kind === 'world' && game.wonders[b.id] === undefined && majors.some((p) => (!b.tech || p.techs.includes(b.tech)) && (!b.policy || policyMet(p, b.policy))));
  if (wonders.length) quest('wonder', wonders[Math.floor(random(game) * wonders.length)].id);
  // A natural wonder some civ who knows it hasn't found.
  const nature = [...new Set(game.tiles.flatMap((t) => (t.wonder ? [t.wonder] : [])))].filter((w) => majors.some((p) => !game.found?.[w]?.by.includes(p.index)));
  if (nature.length) quest('nature', nature[Math.floor(random(game) * nature.length)]);
  // A religion, if one has been founded and isn't theirs yet.
  if (Object.keys(game.religions).length && majors.some((p) => p.religion && cityReligion(home) !== p.religion)) quest('religion');
  // A trade route, once a civ who knows it can send one.
  if (majors.some((p) => p.techs.includes('animal_husbandry'))) quest('route');
  return out;
}

/**
 * Each turn: quests done are rewarded, quests that can't be done any more lapse, and a city-state
 * with room for another may ask one (one turn in ten, about).
 */
export function questsTurn(game: Game) {
  for (const cs of game.players) {
    if (!cs.cityState || !cs.alive) continue;
    const quests = questsOf(cs);
    for (const q of [...quests]) {
      for (const p of game.players) {
        if (!p.alive || p.cityState || p.civ === 'barbarian' || !knowsOf(p, cs) || q.done.includes(p.index)) continue;
        if (FIRST_ONLY.includes(q.kind) && q.done.length) break;
        if (fulfils(game, p, cs, q)) reward(game, p, cs, q);
      }
      const over = FIRST_ONLY.includes(q.kind) && q.done.length;
      if (!over && !lapsed(game, q)) continue;
      quests.splice(quests.indexOf(q), 1);
      // Those who were asked and didn't do it are told it's over (and who did it first, if someone did).
      const by = over ? game.players[q.done[0]] : undefined;
      for (const p of game.players)
        if (p.alive && !p.cityState && p.civ !== 'barbarian' && knowsOf(p, cs) && !q.done.includes(p.index))
          note(game, p.index, { text: by ? `${cs.name}'s request (${inLine(questText(game, cs, q))}) was met first by ${nameTo(p, by)}.` : `${cs.name} no longer asks: ${inLine(questText(game, cs, q))}.`, at: capitalOf(game, cs.index)?.tile, kind: 'citystate', topic: 'quests' });
    }
    if (quests.length >= MAX_QUESTS || random(game) >= 0.1) continue;
    const options = candidates(game, cs);
    if (!options.length) continue;
    const q = options[Math.floor(random(game) * options.length)];
    quests.push(q);
    for (const p of game.players) if (p.alive && !p.cityState && p.civ !== 'barbarian' && knowsOf(p, cs)) note(game, p.index, { text: `${cs.name} asks: ${inLine(questText(game, cs, q))} (+${QUEST_REWARD[q.kind]} influence).`, at: capitalOf(game, cs.index)?.tile, kind: 'citystate', topic: 'quests' });
  }
}

/**
 * The quests a city-state asks of a civ now: each one's kind, its words, where it is (the camp, the
 * natural wonder if the civ has seen its tile, else the city-state), its reward, the turns left,
 * whether only the first to do it wins it, and whether the civ has done it.
 */
export function questsFor(game: Game, p: Player, cs: Player): { kind: QuestKind; text: string; at: number | null; reward: number; turns: number; firstOnly: boolean; done: boolean }[] {
  if (!knowsOf(p, cs)) return [];
  const home = capitalOf(game, cs.index)?.tile ?? null;
  const where = (q: Quest): number | null => {
    if (q.kind === 'camp') return q.target as number;
    if (q.kind === 'nature') {
      const t = game.tiles.findIndex((x) => x.wonder === q.target);
      return t >= 0 && p.explored[t] ? t : null;
    }
    return home;
  };
  return questsOf(cs).map((q) => ({ kind: q.kind, text: questText(game, cs, q), at: where(q), reward: QUEST_REWARD[q.kind], turns: Math.max(0, q.until - game.turn), firstOnly: FIRST_ONLY.includes(q.kind), done: q.done.includes(p.index) }));
}
