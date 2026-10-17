import type { View } from '../protocol';
import { play } from './sound';
import { store } from './store';

/**
 * "It's your turn": a bell and a banner when the turn waits on you after a wait of your own: when
 * everyone else playing has ended the turn and it's yours to end (in a game with others in it), or
 * when a turn begins after a long wait for the others (or the bots). (In a tab in the background
 * the bell is all there is: the platform has no way yet for a game to call for attention there.)
 */

/** Seconds of waiting, after ending the turn, after which the new turn calls for you. */
const LONG_WAIT = 20;
/** Seconds the banner stays. */
const SHOWN = 5;

/** When this player last ended the turn (null: they haven't, this turn). */
let readyAt: number | null = null;
/** The turn they were last told it waits on them (once a turn). */
let toldOn = -1;

function tell(text: string, now: number, turn: number) {
  toldOn = turn;
  play('yourturn');
  store.toast = { text, until: now + SHOWN, good: true, glyph: 'bell' };
  store.changed++;
}

/** Each new view: the turn ended (when), a new one begun after a long wait, or everyone else done. */
export function turnAlerts(prev: View | null, v: View, now: number) {
  if (v.spectator || v.over || !prev || prev.you !== v.you) return;
  if (v.turn > prev.turn) {
    const waited = readyAt !== null && now - readyAt > LONG_WAIT;
    readyAt = null;
    if (waited) tell('It’s your turn', now, v.turn);
    return;
  }
  // At war with another person, taking turns in order: your side's segment has begun.
  const mineNow = !!v.sequence?.sides[v.sequence.at]?.includes(v.you);
  const minePrev = !!prev.sequence?.sides[prev.sequence.at]?.includes(prev.you);
  if (mineNow && !minePrev && prev.sequence) {
    tell('Your move: those at war with you have taken theirs', now, v.turn);
    return;
  }
  if (v.self.ready) readyAt ??= now;
  else readyAt = null;
  // The last one to end the turn, with others in the game: they've all ended theirs.
  const others = v.players.filter((p) => p.index !== v.you && p.alive && !p.bot && !p.cityState && p.civ !== 'barbarian' && p.here !== false);
  const waitingOnYou = !v.self.ready && others.length > 0 && others.every((p) => p.ready);
  const wasWaiting = !prev.self.ready && others.length > 0 && others.every((p) => prev.players[p.index]?.ready);
  if (waitingOnYou && !wasWaiting && toldOn !== v.turn) tell('Everyone else has ended the turn: it waits on you', now, v.turn);
}
