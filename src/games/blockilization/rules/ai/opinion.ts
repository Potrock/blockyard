import { allyOf, cityStates, influenceOf } from '../citystates';
import { atWar, capitalOf, citiesOf } from '../core';
import { denounced, friends, pacted, warWords, type DiploEvent } from '../diplomacy';
import { cityReligion } from '../faith';
import { distance } from '../hex';
import type { Game, Player } from '../state';
import { teammates } from '../teams';
import { personalityOf } from './personality';

/**
 * What a bot's leader thinks of another civ, and why, Civ V's way: a friendship, a pact, trade and
 * shared faith or ideology warm it; borders pressed together, wonders and city-states fought over,
 * denouncements, wars (on it or its friends), betrayals, cities taken, broken deals and spies cool it, each
 * memory fading with time. The reasons are said as the leader would say them to that civ.
 */

export interface Opinion {
  total: number;
  reasons: { text: string; value: number }[];
}

export type Stance = 'friendly' | 'favorable' | 'neutral' | 'guarded' | 'hostile';

/** How a leader's opinion reads. */
export const stanceOf = (total: number): Stance => (total >= 20 ? 'friendly' : total >= 8 ? 'favorable' : total > -8 ? 'neutral' : total > -20 ? 'guarded' : 'hostile');

/** The reason a leader gives for thinking a civ a warmonger (a bot's war plan looks for it). */
export const WARMONGER = 'You are a warmonger';

/** A memory's weight now: full when fresh, fading to a fraction over `span` turns. */
const fade = (game: Game, e: DiploEvent, span: number, floor = 0.25) => Math.max(floor, 1 - (game.turn - e.turn) / span);

/** `a`'s opinion of `b` (both civs), with its reasons. */
export function opinionOf(game: Game, a: Player, b: Player): Opinion {
  const pers = personalityOf(a);
  const reasons: Opinion['reasons'] = [];
  const add = (text: string, value: number) => {
    const v = Math.round(value);
    if (v) reasons.push({ text, value: v });
  };
  const events = game.relations?.events ?? [];
  const sum = (filter: (e: DiploEvent) => boolean, span: number, each: number, cap: number, floor = 0.25) =>
    Math.max(-Math.abs(cap), Math.min(Math.abs(cap), events.filter(filter).reduce((s, e) => s + each * fade(game, e, span, floor), 0)));
  const ai = a.index;
  const bi = b.index;
  const myFriends = game.players.filter((o) => o !== a && o !== b && friends(game, ai, o.index));

  // Ties.
  if (teammates(game, ai, bi)) add('We are on the same team', 20);
  if (friends(game, ai, bi)) add('We have declared our friendship', 10);
  if (pacted(game, ai, bi)) add('We have a defensive pact', 5);
  if (a.diplomacy.embassy[bi] && b.diplomacy.embassy[ai]) add('We have embassies with each other', 2);
  if (a.diplomacy.openBorders[bi] > 0 && b.diplomacy.openBorders[ai] > 0) add('Our borders are open to each other', 2);
  add('We trade with each other', sum((e) => e.kind === 'deal' && ((e.by === ai && e.to === bi) || (e.by === bi && e.to === ai)), 40, 2.5, 8, 0));
  const common = game.players.filter((o) => o !== a && o !== b && o.alive && o.civ !== 'barbarian' && !o.cityState && atWar(game, ai, o.index) && atWar(game, bi, o.index));
  if (common.length) add(`We fight a common enemy (${common[0].name})`, 6);
  const shunned = game.players.filter((o) => o !== a && o !== b && denounced(game, ai, o.index) && denounced(game, bi, o.index));
  if (shunned.length) add(`We both have denounced ${shunned[0].name}`, 4);
  if (!events.some((e) => (e.kind === 'war' || e.kind === 'denounce') && ((e.by === ai && e.to === bi) || (e.by === bi && e.to === ai)))) add('We have always been at peace', Math.min(5, game.turn / 40));

  // Words.
  if (denounced(game, bi, ai)) add('You denounced us', -12);
  else add('You denounced us once', sum((e) => e.kind === 'denounce' && e.by === bi && e.to === ai, 80, -6, 6, 0));
  if (denounced(game, ai, bi)) add('We have denounced you', -6);
  const friendDenounced = myFriends.filter((o) => denounced(game, bi, o.index));
  if (friendDenounced.length) add(`You denounced our friend ${friendDenounced[0].name}`, -4);

  // Deeds.
  if (atWar(game, ai, bi)) add('We are at war', -10);
  else add('You declared war on us', sum((e) => e.kind === 'war' && e.by === bi && e.to === ai, 80, -12, 15));
  add('You betrayed us', sum((e) => e.kind === 'backstab' && e.by === bi && e.to === ai, 150, -20, 30, 0.4));
  add('You betrayed a friend', sum((e) => e.kind === 'backstab' && e.by === bi && e.to !== ai, 120, -6, 10));
  add('You broke a deal with us', sum((e) => e.kind === 'brokeDeal' && e.by === bi && e.to === ai, 80, -8, 12));
  add('Your spies have worked against us', sum((e) => e.kind === 'spy' && e.by === bi && e.to === ai, 80, -6, 12));
  add('You took our land', sum((e) => e.kind === 'land' && e.by === bi && e.to === ai, 100, -8, 16));
  add('You took our cities', sum((e) => e.kind === 'capture' && e.by === bi && e.to === ai, 150, -6, 24, 0.4));
  // (A city given back is remembered for good, Civ V's liberation: more than any deal.)
  add('You liberated our people', sum((e) => e.kind === 'liberate' && e.by === bi && e.to === ai, 200, 25, 40, 0.6));
  add('You threatened a city-state under our protection', sum((e) => e.kind === 'pledge' && e.by === bi && e.to === ai, 60, -6, 12));
  // (Cities given back weigh against cities taken, as liberating does in Civ V's warmonger count.)
  const freed = sum((e) => e.kind === 'liberate' && e.by === bi && e.to !== ai, 100, 2, 10);
  const warmonger = Math.min(0, sum((e) => e.kind === 'capture' && e.by === bi && e.to !== ai && game.players[e.to] && !game.players[e.to].cityState, 100, -2, 10) + freed) + sum((e) => e.kind === 'war' && e.by === bi && e.to !== ai, 60, -1, 5);
  add(WARMONGER, warmonger * (0.6 + pers.defense / 12));
  const friendsAtWar = myFriends.filter((o) => atWar(game, bi, o.index));
  if (friendsAtWar.length) add(`You are at war with our friend ${friendsAtWar[0].name}`, -6);

  // Rivalry.
  let touching = 0;
  for (const c of citiesOf(game, ai)) for (const o of citiesOf(game, bi)) if (distance(game.grid, c.tile, o.tile) <= 6) touching++;
  if (touching) add('Our borders press against each other', -Math.min(8, 1.5 + touching * (0.8 + pers.expansion / 10)));
  else if (!citiesOf(game, ai).some((c) => citiesOf(game, bi).some((o) => distance(game.grid, c.tile, o.tile) <= 10))) add('We are far apart: no quarrel over land', 3);
  const wonders = Object.values(game.wonders).filter((w) => w === bi).length;
  if (pers.wonder >= 7 && wonders >= 2) add('You take the wonders we would build', -Math.min(6, wonders * (pers.wonder - 5) * 0.3));
  const contested = cityStates(game).filter((cs) => allyOf(game, cs.index) === bi && (influenceOf(a, cs.index) >= 30 || pers.diplomacy >= 7)).length;
  if (contested) add('You court the city-states we court', -Math.min(6, contested * 2));

  // Faith and creed.
  const capital = capitalOf(game, ai);
  if (b.religion && capital && cityReligion(capital) === b.religion) add('Our people share your faith', 4);
  else if (a.religion && b.religion && citiesOf(game, ai).some((c) => cityReligion(c) === b.religion)) add('Your missionaries preach to our people', -4);
  if (a.ideology && b.ideology) add(a.ideology === b.ideology ? `We share ${cap(a.ideology)}` : `Your ${cap(b.ideology)} offends our ${cap(a.ideology)}`, a.ideology === b.ideology ? 5 : -6);

  if (nearVictory(game, b)) add('You are close to winning', -4 - pers.boldness * 0.4);
  // A war it means to make on a person, said before it comes (its reason).
  const plan = a.ai?.plan;
  if (plan?.target === bi && plan.stage === 'muster' && plan.why && !b.bot && !plan.surprise) add(warWords(game, plan.why, ai, bi), -6);

  // Character.
  if (pers.offense >= 8) add('We trust no one', -3);
  else if (pers.offense <= 2) add('We wish everyone well', 2);
  const total = reasons.reduce((s, r) => s + r.value, 0);
  reasons.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  return { total, reasons };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/**
 * Whether a civ is close to winning: with the United Nations' votes in reach (half the city-states its
 * allies, from turn 80), its spaceship under way (the Apollo Program built, or five techs ahead of
 * everyone late on), or influential over most of the others' culture.
 */
export function nearVictory(game: Game, o: Player): boolean {
  const v = game.settings.victories;
  const all = cityStates(game);
  if (v.diplomatic && game.turn >= 80 && all.length >= 2 && all.filter((cs) => allyOf(game, cs.index) === o.index).length >= Math.ceil(all.length / 2)) return true;
  if (v.science && game.cities.some((c) => c.owner === o.index && c.buildings.includes('apollo_program'))) return true;
  // Far ahead in learning late on (the spaceship within its reach before anyone's).
  const rivals = game.players.filter((t) => t !== o && t.alive && !t.cityState && t.civ !== 'barbarian');
  if (v.science && game.turn >= 180 && rivals.length && rivals.every((t) => o.techs.length >= t.techs.length + 5)) return true;
  const living = game.players.filter((t) => t.alive && !t.cityState && t.civ !== 'barbarian');
  const sway = living.filter((t) => t !== o && t.lifetimeCulture > 0 && (o.tourism[t.index] ?? 0) / t.lifetimeCulture >= 0.6).length;
  return v.culture && living.length > 2 && sway >= living.length - 2;
}
