import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { MemoryStore } from '../../src/platform/host/store';
import type { HostBatch } from '../../src/platform/net/protocol';
import type { Game } from '../../src/games/blockilization/rules/state';
import type { LobbyView } from '../../src/games/blockilization/protocol';
import { autosaveTurns, restoreTurn, tidyGames, type Saved } from '../../src/games/blockilization/saves';
import { check, games } from './_harness';
import { devGames } from '../../src/games/server';

/**
 * Blockilization's saved games belong to the people in them, not to a room, and each is played at
 * an address of its own: the room named for it. A game begun in a room of one's own takes its code
 * for its id; the room named for a game opens it as it starts, no one needing to say so; a game
 * begun in the public room (where a screen can't go to another) is saved under an id of its own;
 * in another room its player's lobby lists it; a new game replaces no saved game; and one from
 * before games had addresses is given one when it's opened.
 *
 * And none is lost: every game keeps backups of its last turns' starts, to take it back to from the
 * list while nobody's playing it (a room still up with it, emptied, plays it as it's saved now); a
 * discarded game is listed a week to bring back, and only then goes.
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
    let goto: string | null = null;
    const step = (seconds = 1 / 30) => {
      for (let t = 0; t < seconds; t += 1 / 30)
        for (const [, b] of host.step(1 / 30) as Map<string, HostBatch>)
          for (const e of b.events) {
            if (e.t !== 'call') continue;
            if (e.call.method === 'lobby') lobby = e.call.args[0] as LobbyView;
            if (e.call.method === 'goto') goto = (e.call.args[0] as { room: string }).room;
          }
    };
    let ann = host.connect('Ann');
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
    const rejoin = () => {
      ann = host.connect('Ann');
      host.command(ann.id, { t: 'start' });
      step(0.5);
    };
    const exec = (line: string) => {
      host.command(ann.id, { t: 'exec', id: 1, line });
      step(2 / 30);
    };
    return { send, play, leave, rejoin, exec, lobby: () => lobby, goto: () => goto };
  };
  const ids = () => store.data() && [...store.data().keys()].filter((k) => k.startsWith('game:'));
  // (The game's data, as `game.store` has it: what the saves' own functions take.)
  const data = { get: <T>(k: string) => store.data().get(k) as T | undefined, set: (k: string, v: unknown) => void store.data().set(k, v), delete: (k: string) => void store.data().delete(k), keys: (prefix = '') => [...store.data().keys()].filter((k) => k.startsWith(prefix)) };
  const duel = { a: 'settings', size: 'duel', cityStates: 0, barbarians: false };

  // Ann begins a game in a room of her own: its id is the room's code, its address.
  const own = room('k3x9f2');
  own.send(duel);
  own.send({ a: 'bots', count: 1 });
  own.send({ a: 'start' });
  own.play();
  check(civ.phase() === 'playing', `the game began (${civ.phase()})`);
  check(JSON.stringify(ids()) === '["game:k3x9f2"]', `saved under the room's code: ${JSON.stringify(ids())}`);
  const turn = civ.game()!.turn;
  // (She leaves: the game's saved as no longer under way there.)
  own.leave();

  // In the public room, her lobby lists it (to go to); a game begun there (a screen that can't go
  // to a room of its own) is saved under an id of its own, replacing nothing.
  const pub = room('public');
  const listed = pub.lobby()?.saves ?? [];
  check(listed.length === 1 && listed[0].id === 'k3x9f2' && listed[0].turn === turn && !listed[0].live, `listed in the public room: ${JSON.stringify(listed)}`);
  pub.send(duel);
  pub.send({ a: 'start' });
  pub.play();
  const second = ids().find((k) => k !== 'game:k3x9f2');
  check(ids().length === 2 && !!second && !store.data().has('save:public'), `a game begun in the public room is a second save, under its own id: ${JSON.stringify(ids())}`);
  pub.leave();

  // Back at her first game's address, it opens as the room starts: nobody presses anything.
  const back = room('k3x9f2');
  back.play();
  check(civ.phase() === 'playing' && civ.game()!.turn === turn && civ.game()!.players.some((p) => p.name === 'Ann'), `the room named for her game opens it (${civ.phase()}, turn ${civ.game()?.turn})`);
  back.leave();

  // A game from before games had addresses (kept under an id that's no room's code): opened, it's
  // given one, and she's sent to it.
  store.data().set('game:room-public', structuredClone(store.data().get('game:k3x9f2')));
  store.data().set('gamenote:room-public', { ...(store.data().get('gamenote:k3x9f2') as object), room: 'public', open: false });
  const hub = room('public');
  check((hub.lobby()?.saves ?? []).length === 3, 'all three of her games listed');
  hub.send({ a: 'open', id: 'room-public' });
  const moved = hub.goto();
  check(!!moved && /^[a-z0-9]{10}$/.test(moved) && store.data().has(`game:${moved}`) && !store.data().has('game:room-public'), `the old game given an address (${moved}), and she's sent there`);
  hub.send({ a: 'open', id: 'k3x9f2' });
  check(hub.goto() === 'k3x9f2', 'a game with an address: sent straight there');
  hub.leave();

  // Every game keeps backups of its turns' starts: the latest two, and one from up to ten turns before.
  const again = room('k3x9f2');
  again.play();
  const note = store.data().get('gamenote:k3x9f2') as { here?: string[]; map?: { size: string } };
  check(JSON.stringify(note.here) === '["name:Ann"]' && note.map?.size === 'duel', `its note says who's in it now, and its map: ${JSON.stringify(note)}`);
  again.exec('civ turns 12');
  const at = civ.game()!.turn;
  const kept = autosaveTurns(data, 'k3x9f2');
  check(kept.length === 3 && kept[0] === at && kept[1] === at - 1 && kept[2] % 10 === 0 && kept[2] < at - 1, `the last two turns' backups, and one from before: ${kept} (turn ${at})`);
  again.leave();

  // From her list (nobody playing it), she takes it back to the earliest: what came after goes, and
  // everyone in it is told who did.
  const list = room('public');
  const row = list.lobby()?.saves.find((g) => g.id === 'k3x9f2');
  check(JSON.stringify(row?.backups) === JSON.stringify(kept), `listed with its backups: ${JSON.stringify(row?.backups)}`);
  list.send({ a: 'restore', id: 'k3x9f2', turn: kept[2] });
  const back2 = store.data().get('game:k3x9f2') as Saved<Game>;
  check(back2.game.turn === kept[2] && JSON.stringify(autosaveTurns(data, 'k3x9f2')) === `[${kept[2]}]`, `taken back to turn ${kept[2]} (${back2.game.turn}), the later backups gone (${autosaveTurns(data, 'k3x9f2')})`);
  check(back2.game.players.some((p) => p.notes.some((n) => n.text === `Ann took the game back to the start of turn ${kept[2]}.`)), 'its people are told');

  // Discarded: off her list, listed a week to bring back, and brought back.
  list.send({ a: 'discard', id: 'k3x9f2' });
  const off = list.lobby()?.saves.find((g) => g.id === 'k3x9f2');
  check(!!off?.discarded && store.data().has('game:k3x9f2'), `discarded, still kept: ${JSON.stringify(off)}`);
  list.send({ a: 'keep', id: 'k3x9f2' });
  check(!list.lobby()?.saves.find((g) => g.id === 'k3x9f2')?.discarded, 'brought back');
  // A game everyone in has discarded goes a week after the last of them did, not before.
  list.send({ a: 'discard', id: second!.slice('game:'.length) });
  tidyGames(data, new Date(Date.now() + 6 * 86400e3));
  check(store.data().has(second!), 'kept for the week');
  tidyGames(data, new Date(Date.now() + 8 * 86400e3));
  check(!store.data().has(second!) && ![...store.data().keys()].some((k) => k.includes(second!.slice('game:'.length))), 'then gone, its note and backups with it');
  list.leave();

  // Back at the game: taken back while its room stood empty (but still up), whoever comes back plays it as it's saved now.
  const last = room('k3x9f2');
  last.play();
  check(civ.game()!.turn === kept[2], `the room opens it at the turn it was taken back to (${civ.game()!.turn})`);
  last.exec('civ turns 2');
  last.leave();
  restoreTurn(data, 'k3x9f2', kept[2] + 1);
  last.rejoin();
  last.play();
  check(civ.game()!.turn === kept[2] + 1, `back in the room, the game as it's saved now: turn ${civ.game()!.turn}`);
}
