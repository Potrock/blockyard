import { distance, neighbours } from '../rules/hex';
import type { UnitWire } from '../protocol';
import { placeOn, previewPath } from './path';
import { enemyAt, me, store } from './store';
import { sendFor } from './ui';

/**
 * Units sent somewhere together: a group gathered with shift-clicks on their flags (or a box
 * shift-dragged round them), sent with one click, each to a tile at the destination (the place
 * itself, then the free tiles round it). They keep the pace of the slowest: one that would get there
 * sooner waits (skips its turn) until the slowest's way is as long as its own, so they arrive on the
 * same turn (one already there waits there; the march is over when they all are; one far slower
 * than the rest goes on alone). Kept on this screen (a march is only orders given turn by turn); any
 * order given to one of them takes it out. One of them stopped on the way (enemies in sight) halts
 * it: they're gathered again, to be sent on with a click.
 */

/** A march under way: where it's bound, each unit's place there, and those sent on their way last. */
interface March {
  to: number;
  dests: Map<number, number>;
  going: Set<number>;
}

let marches: March[] = [];

/** Turns a unit's way to a tile takes now (this turn the first), or null if it can't get there. */
function turnsTo(u: UnitWire, t: number): number | null {
  if (u.tile === t) return 0;
  const route = previewPath(u, t);
  return route ? route.turns[route.turns.length - 1] + 1 : null;
}

/**
 * A unit's place at a march's destination: the destination itself or a tile up to two from it, the
 * nearer the better, as long as each step nearer costs it no more than two turns more (so it
 * gathers round the place clicked, but a place on the far side of an enemy city, which would have it
 * walk all the way round while the others wait, goes to one on this side). Never one taken (`taken`:
 * tile|place, `placeOn`) or one an enemy holds. Null if there's none it can get to.
 */
function placeFor(u: UnitWire, to: number, taken: Set<string>): { t: number; turns: number } | null {
  const g = store.grid!;
  const ring = [to, ...neighbours(g, to), ...neighbours(g, to).flatMap((n) => neighbours(g, n))].filter((t, i, a) => a.indexOf(t) === i);
  let place: { t: number; turns: number; score: number } | null = null;
  for (const t of ring) {
    if ((t !== u.tile && taken.has(`${t}|${placeOn(u, t)}`)) || enemyAt(t)) continue;
    const turns = turnsTo(u, t);
    const score = turns === null ? Infinity : turns + 2 * distance(g, t, to);
    if (turns !== null && (!place || score < place.score)) place = { t, turns, score };
  }
  return place && { t: place.t, turns: place.turns };
}

/** Send the selected unit and its group to a tile together. */
export function marchTo(ids: number[], to: number) {
  const v = store.view;
  if (!v || !store.grid) return;
  const units = ids.map((id) => v.units.find((u) => u.id === id && u.owner === me())).filter((u): u is UnitWire => !!u);
  for (const m of marches) for (const u of units) m.dests.delete(u.id);
  // One soldier and one civilian to a tile (at sea a ship and an embarked soldier too); never where another of them stands (it may wait there till the last turn, in the way).
  const taken = new Set<string>();
  for (const u of v.units) if (u.owner === me()) taken.add(`${u.tile}|${placeOn(u, u.tile)}`);
  const dests = new Map<number, number>();
  const turns = new Map<number, number>();
  for (const u of units) {
    const place = placeFor(u, to, taken);
    if (!place) continue;
    taken.add(`${place.t}|${placeOn(u, place.t)}`);
    dests.set(u.id, place.t);
    turns.set(u.id, place.turns);
  }
  // One far slower than the rest (a long way round, or far behind) goes on alone: the rest don't wait for it.
  const sorted = [...turns.values()].sort((a, b) => a - b);
  const middle = sorted[Math.floor(sorted.length / 2)] ?? 0;
  for (const [id, t] of turns)
    if (t > middle * 2 + 2) {
      sendFor({ t: 'move', unit: id, to: dests.get(id)! });
      dests.delete(id);
    }
  if (!dests.size) return;
  marches.push({ to, dests, going: new Set() });
  marchTurn();
}

/** Each turn (and as a march is ordered): the slowest sets the pace; the others wait or go. */
export function marchTurn() {
  const v = store.view;
  if (!v) return;
  marches = marches.filter((m) => {
    const legs: { u: UnitWire; to: number; turns: number }[] = [];
    for (const [id, to] of m.dests) {
      const u = v.units.find((x) => x.id === id && x.owner === me());
      let leg = u ? { t: to, turns: turnsTo(u, to) } : null;
      // (Its place with one of the march on it, on its way or waiting: it's kept, the way there counted to the tile before it.)
      const fellow = (t: number) => [...m.dests.keys()].some((other) => other !== id && v.units.find((x) => x.id === other)?.tile === t);
      if (u && leg?.turns === null && fellow(to)) {
        const near = neighbours(store.grid!, to)
          .map((n) => (n === u.tile ? 0 : turnsTo(u, n)))
          .filter((x): x is number => x !== null);
        if (near.length) leg = { t: to, turns: Math.min(...near) + 1 };
      }
      // (Its place since taken, as by one of its own stopping there on the way: the nearest free one now.)
      if (u && leg?.turns === null) {
        const taken = new Set(v.units.filter((x) => x.owner === me() && x.id !== id).map((x) => `${x.tile}|${placeOn(x, x.tile)}`));
        for (const [other, t] of m.dests) {
          const o = v.units.find((x) => x.id === other);
          if (other !== id && o) taken.add(`${t}|${placeOn(o, t)}`);
        }
        leg = placeFor(u, m.to, taken);
        if (leg) m.dests.set(id, leg.t);
      }
      if (!u || !leg || leg.turns === null) m.dests.delete(id);
      else legs.push({ u, to: leg.t, turns: leg.turns });
    }
    // (All there: the march is over, and they're free for their orders.)
    if (legs.every((x) => x.turns === 0)) return false;
    // (One sent on that's lost its way short of its place was stopped: enemies in sight. The march halts, its units gathered for their orders.)
    if (legs.some(({ u, turns }) => turns > 0 && m.going.has(u.id) && !u.path?.length)) {
      store.selectedUnit = legs[0].u.id;
      store.group = legs.slice(1).map(({ u }) => u.id);
      store.changed++;
      return false;
    }
    const slowest = Math.max(...legs.map((x) => x.turns));
    // (The last of them gets there this turn: the march is over, and those there already are free for their orders now.)
    if (slowest <= 1) {
      for (const { u, to, turns } of legs) if (turns > 0) sendFor({ t: 'move', unit: u.id, to });
      return false;
    }
    m.going = new Set(legs.filter((x) => x.turns >= slowest).map(({ u }) => u.id));
    for (const { u, to, turns } of legs) {
      // (One that's used its moves is given its way for next turn; one that waits is stopped from going wherever it was before.)
      const spent = (u.moves ?? 0) <= 0;
      if (turns >= slowest) {
        sendFor({ t: 'move', unit: u.id, to });
        continue;
      }
      // (One waiting on another's place goes on to its own, out of the way; one already at its place waits there with the rest.)
      if (turns > 0 && [...m.dests].some(([other, t]) => other !== u.id && t === u.tile)) {
        sendFor({ t: 'move', unit: u.id, to });
        continue;
      }
      if (u.path?.length) sendFor({ t: 'stance', unit: u.id, stance: 'wake' });
      if (!spent && !u.skip) sendFor({ t: 'skip', unit: u.id });
    }
    return true;
  });
}

/** A unit given some other order leaves its march. */
export function leaveMarch(id: number) {
  for (const m of marches) m.dests.delete(id);
}

/** Whether a unit is marching with others. */
export const marching = (id: number) => marches.some((m) => m.dests.has(id) && m.dests.size > 1);

/** Where a marching unit is bound, and how many march with it (null if it isn't marching with others). */
export function marchOf(id: number): { to: number; others: number } | null {
  const m = marches.find((x) => x.dests.has(id) && x.dests.size > 1);
  return m ? { to: m.dests.get(id)!, others: m.dests.size - 1 } : null;
}
