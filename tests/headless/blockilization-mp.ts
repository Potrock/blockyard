import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostBatch } from '../../src/platform/net/protocol';
import type { Game } from '../../src/games/blockilization/rules/state';
import { check, games } from './_harness';
import { devGames } from '../../src/games/server';
import { canStand } from '../../src/games/blockilization/rules/core';
import { neighbours } from '../../src/games/blockilization/rules/hex';
import { TERRAINS } from '../../src/games/blockilization/rules/terrain';

/**
 * Blockilization with two people in a room: at peace they play at once; at war with each other they
 * take their turns one side at a time (the side that declared first), the other's unit orders
 * refused while it waits; a side's clock running out, or its person gone, hands the turn on.
 */
export default async function blockilizationMultiplayer() {
  const def = [...games, ...(await devGames())].find((g) => g.id === 'blockilization')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 3, remote: true, radius: 16, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Player' } });
  const civ = (globalThis as unknown as { __civ: { game: () => Game | null; phase: () => string } }).__civ;
  const results = new Map<string, { ok: boolean; error?: string }[]>();
  const step = (seconds = 1 / 30) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      const out: Map<string, HostBatch> = host.step(1 / 30);
      for (const [id, b] of out)
        for (const e of b.events) if (e.t === 'call' && e.call.method === 'result') results.set(id, [...(results.get(id) ?? []), e.call.args[0] as { ok: boolean; error?: string }]);
    }
  };
  const send = (id: string, name: string, data: unknown) => {
    host.command(id, { t: 'message', msg: { t: 'game', player: id, name, data } });
    step(2 / 30);
  };
  const lastResult = (id: string) => results.get(id)?.at(-1);

  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  step(0.5);
  // Ann hosts: a duel map, no bots, no city-states or barbarians, a minute a turn.
  send(ann.id, 'lobby', { a: 'settings', size: 'duel', cityStates: 0, barbarians: false, timer: 60 });
  send(ann.id, 'lobby', { a: 'bots', count: 0 });
  send(ann.id, 'lobby', { a: 'start' });
  for (let i = 0; i < 600 && civ.phase() !== 'playing'; i++) step(0.5);
  check(civ.phase() === 'playing', `the game began (${civ.phase()})`);
  const g = civ.game()!;
  const [a, b] = ['Ann', 'Bob'].map((n) => g.players.find((p) => p.name === n)!);
  check(a && b && !a.bot && !b.bot, 'Ann and Bob each lead a civ');
  // (Read afresh each time: orders change it.)
  const seq = () => g.sequence;
  const unitOf = (i: number) => g.units.find((u) => u.owner === i && u.type !== 'settler')!;
  const moveOf = (i: number) => {
    const u = unitOf(i);
    // (A step to land it can stand on, not where a unit is.)
    const to = neighbours(g.grid, u.tile).find((t) => !TERRAINS[g.tiles[t].terrain].water && canStand(g, u.type, t) && !g.units.some((x) => x.tile === t))!;
    return { t: 'move', unit: u.id, to };
  };

  // At peace: both move at once.
  send(bob.id, 'order', moveOf(b.index));
  check(lastResult(bob.id)?.ok, `at peace, Bob moves when he likes: ${JSON.stringify(lastResult(bob.id))}`);
  check(!seq(), 'no order to the turns');

  // Ann declares war: she plays on, Bob waits his segment.
  send(ann.id, 'order', { t: 'war', target: b.index });
  check(JSON.stringify(seq()?.sides) === `[[${a.index}],[${b.index}]]`, `Ann first, then Bob: ${JSON.stringify(seq())}`);
  send(bob.id, 'order', moveOf(b.index));
  check(lastResult(bob.id)?.ok === false && /finish their turn/.test(lastResult(bob.id)?.error ?? ''), `Bob's move waits: ${JSON.stringify(lastResult(bob.id))}`);
  const turn = g.turn;
  send(ann.id, 'order', { t: 'ready', ready: true });
  step(0.2);
  check(seq()?.at === 1 && g.turn === turn, 'Ann done: Bob’s segment, the same turn');
  send(bob.id, 'order', moveOf(b.index));
  check(lastResult(bob.id)?.ok, `Bob moves in his segment: ${JSON.stringify(lastResult(bob.id))}`);
  send(bob.id, 'order', { t: 'ready', ready: true });
  step(0.5);
  check(g.turn === turn + 1, 'both done: the turn ends');
  check(seq()?.at === 0 && seq()!.sides.length === 2, `a new turn, a new order: ${JSON.stringify(seq())}`);

  // A side that lets its clock run out: the turn is handed on, and the next side has a whole clock.
  const first = seq()!.sides[0][0];
  step(61);
  check(seq()?.at === 1 && g.turn === turn + 1, `the first side's minute up: handed on (${JSON.stringify(seq())}, turn ${g.turn})`);
  check(g.players[first].ready, 'its turn counts as ended');

  // The side playing gone (a dropped connection): once the grace is past, handed on.
  const second = seq()!.sides[1][0];
  host.disconnect(second === a.index ? ann.id : bob.id);
  step(5);
  check(g.turn === turn + 1, 'a moment away: still waited for');
  step(20);
  check(g.turn === turn + 2, `gone past the grace: the turn ends (turn ${g.turn})`);
}
