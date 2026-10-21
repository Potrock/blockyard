import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { MemoryStore } from '../../src/platform/host/store';
import type { HostBatch } from '../../src/platform/net/protocol';
import type { Game } from '../../src/games/blockilization/rules/state';
import type { LobbyView } from '../../src/games/blockilization/protocol';
import { check, games } from './_harness';
import { devGames } from '../../src/games/server';

/**
 * Blockilization's saved games belong to the people in them, not to a room: a game begun in the
 * public room is saved under an id of its own; in another room its player's lobby lists it, and it
 * carries on there; a new game begun there replaces no saved game.
 */
export default async function blockilizationSaves() {
  const def = [...games, ...(await devGames())].find((g) => g.id === 'blockilization')!;
  const engine = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const store = new MemoryStore();
  // (Set as the server's code loads: read when needed.)
  const civ = { game: () => hook().game(), phase: () => hook().phase() };
  const hook = () => (globalThis as unknown as { __civ: { game: () => Game | null; phase: () => string } }).__civ;
  const room = (name: string) => {
    const host = new GameHost(def, { engine, seed: 3, remote: true, radius: 16, budget: Infinity, cheats: true, room: name, store, player: { id: 'p1', name: 'Player' } });
    let lobby: LobbyView | null = null;
    const step = (seconds = 1 / 30) => {
      for (let t = 0; t < seconds; t += 1 / 30)
        for (const [, b] of host.step(1 / 30) as Map<string, HostBatch>) for (const e of b.events) if (e.t === 'call' && e.call.method === 'lobby') lobby = e.call.args[0] as LobbyView;
    };
    const ann = host.connect('Ann');
    host.command(ann.id, { t: 'start' });
    step(0.5);
    const send = (data: unknown) => {
      host.command(ann.id, { t: 'message', msg: { t: 'game', player: ann.id, name: 'lobby', data } });
      step(2 / 30);
    };
    const play = () => {
      for (let i = 0; i < 600 && civ.phase() !== 'playing'; i++) step(0.5);
    };
    const leave = () => {
      host.disconnect(ann.id);
      step(0.2);
    };
    return { send, play, leave, lobby: () => lobby };
  };
  const ids = () => store.data() && [...store.data().keys()].filter((k) => k.startsWith('game:'));

  // Ann begins a game in the public room: saved under an id of its own.
  const pub = room('public');
  pub.send({ a: 'settings', size: 'duel', cityStates: 0, barbarians: false });
  pub.send({ a: 'bots', count: 1 });
  pub.send({ a: 'start' });
  pub.play();
  check(civ.phase() === 'playing', `the game began (${civ.phase()})`);
  const first = ids();
  check(first.length === 1 && !store.data().has('save:public'), `saved under its own id, not the room's: ${JSON.stringify(first)}`);
  const turn = civ.game()!.turn;
  // (She leaves: the game's saved as no longer under way there.)
  pub.leave();

  // In another room, Ann's lobby lists it; a new game begun there replaces nothing.
  const other = room('k3x9f2');
  const listed = other.lobby()?.saves ?? [];
  check(listed.length === 1 && `game:${listed[0].id}` === first[0] && listed[0].turn === turn, `listed in another room: ${JSON.stringify(listed)}`);
  other.send({ a: 'settings', size: 'duel', cityStates: 0, barbarians: false });
  other.send({ a: 'start' });
  other.play();
  check(ids().length === 2 && ids().includes(first[0]), `a new game elsewhere is a second save, the first untouched: ${JSON.stringify(ids())}`);
  other.leave();

  // And in a third room, Ann carries the first one on.
  const third = room('fresh1');
  check((third.lobby()?.saves ?? []).length === 2, 'both her games listed');
  third.send({ a: 'resume', id: listed[0].id });
  third.play();
  check(civ.phase() === 'playing' && civ.game()!.turn === turn && civ.game()!.players.some((p) => p.name === 'Ann'), 'carried on: the same game, at its turn');
}
