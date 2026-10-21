import type { Game, Player } from './state';

/**
 * Teams, Civilization V's: the civs on a team (`Player.team`, by number; none for a civ playing for
 * itself) are at peace with each other for good, their borders open to each other, have met from
 * the start, see what any of them sees, go to war and make peace together, and win together. A
 * side is a team with its civs' vassals (`vassals.ts`), who go to war and make peace with it too.
 */

/** Whether two players are on one team (two different players). */
export function teammates(game: Game, a: number, b: number): boolean {
  const t = game.players[a]?.team;
  return a !== b && t !== undefined && game.players[b]?.team === t;
}

/** A player and their teammates still in the game (just the player, with no team). */
export function teamOf(game: Game, i: number): Player[] {
  const p = game.players[i];
  return p.team === undefined ? [p] : game.players.filter((o) => o === p || (o.team === p.team && o.alive));
}

/** The civ a vassal serves (`vassals.ts`), while the two are in the game. */
export function masterOf(game: Game, i: number): Player | undefined {
  const p = game.players[i];
  const m = p?.vassal ? game.players[p.vassal.master] : undefined;
  return p?.alive && m?.alive ? m : undefined;
}

/** A civ's vassals still in the game. */
export const vassalsOf = (game: Game, i: number): Player[] => game.players.filter((v) => v.vassal?.master === i && masterOf(game, v.index));

/**
 * A side, as it goes to war and makes peace: a team (or a civ alone) and the vassals of each of its
 * civs (a vassal's side is its master's).
 */
export function sideOf(game: Game, i: number): Player[] {
  const team = teamOf(game, masterOf(game, i)?.index ?? i);
  return [...team, ...game.players.filter((v) => !team.includes(v) && team.some((m) => masterOf(game, v.index) === m))];
}

/** Whether two civs are on one side (teammates, or a vassal and its master's side). */
export const sameSide = (game: Game, a: number, b: number) => a !== b && sideOf(game, a).some((p) => p.index === b);

/** Each of one side's civs with each of the other's: those who go to war (or make peace) when two of them do. */
export function sides(game: Game, a: number, b: number): [number, number][] {
  return sideOf(game, a).flatMap((x) => sideOf(game, b).map((y): [number, number] => [x.index, y.index]));
}

/** Whether a bot's on a team with people (who choose the team's wars and peace; the bot fights them). */
export const teamedWithPeople = (game: Game, i: number) => teamOf(game, i).some((m) => !m.bot);

/** How a side is named: its team ("Team 2"), or the civ's leader. */
export const sideName = (p: Player) => (p.team === undefined ? p.name : `Team ${p.team + 1}`);

/** Open borders between teammates: for good (an agreement's turns are counted down each turn). */
export const FOR_GOOD = 1e9;

/** A new game's teams: teammates have met, and their borders are open to each other. */
export function bindTeams(game: Game) {
  for (const p of game.players)
    for (const o of game.players) {
      if (!teammates(game, p.index, o.index)) continue;
      if (!(p.met ??= []).includes(o.index)) p.met.push(o.index);
      p.diplomacy.openBorders[o.index] = FOR_GOOD;
    }
}
