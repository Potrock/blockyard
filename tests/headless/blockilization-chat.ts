import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostBatch } from '../../src/platform/net/protocol';
import type { ChatLine, Game } from '../../src/games/blockilization/rules/state';
import { check, games } from './_harness';
import { devGames } from '../../src/games/server';

/**
 * Blockilization's chat with two people and a bot in a room: a word in the lobby goes on with the
 * game; a line for everyone reaches everyone, one for a person only them; a ping needs a tile its
 * sender knows; a bot's leader spoken to answers a moment later, to that person alone; and too many
 * lines at once are cut short.
 */
export default async function blockilizationChat() {
  const def = [...games, ...(await devGames())].find((g) => g.id === 'blockilization')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 5, remote: true, radius: 16, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Player' } });
  const civ = (globalThis as unknown as { __civ: { game: () => Game | null; phase: () => string } }).__civ;
  const heard = new Map<string, ChatLine[]>();
  const logs = new Map<string, ChatLine[]>();
  const step = (seconds = 1 / 30) => {
    for (let t = 0; t < seconds; t += 1 / 30) {
      const out: Map<string, HostBatch> = host.step(1 / 30);
      for (const [id, b] of out)
        for (const e of b.events) {
          if (e.t !== 'call') continue;
          if (e.call.method === 'chat') heard.set(id, [...(heard.get(id) ?? []), e.call.args[0] as ChatLine]);
          if (e.call.method === 'chatLog') logs.set(id, e.call.args[0] as ChatLine[]);
        }
    }
  };
  const send = (id: string, name: string, data: unknown) => {
    host.command(id, { t: 'message', msg: { t: 'game', player: id, name, data } });
    step(2 / 30);
  };
  const said = (id: string) => heard.get(id) ?? [];
  const last = (id: string) => said(id).at(-1);

  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  step(0.5);

  // In the lobby: everyone hears it.
  send(ann.id, 'chat', { text: 'good luck, have fun' });
  check(last(bob.id)?.text === 'good luck, have fun' && last(bob.id)?.name === 'Ann', `Bob hears Ann in the lobby: ${JSON.stringify(last(bob.id))}`);
  check(last(ann.id)?.text === 'good luck, have fun', 'and so does Ann');
  send(ann.id, 'chat', { text: '   \u0007  ' });
  check(said(bob.id).length === 1, 'nothing said, nothing sent');

  // A small map, one bot, no city-states or barbarians.
  send(ann.id, 'lobby', { a: 'settings', size: 'small', cityStates: 0, barbarians: false });
  send(ann.id, 'lobby', { a: 'bots', count: 1 });
  send(ann.id, 'lobby', { a: 'start' });
  for (let i = 0; i < 600 && civ.phase() !== 'playing'; i++) step(0.5);
  check(civ.phase() === 'playing', `the game began (${civ.phase()})`);
  const g = civ.game()!;
  const [a, b] = ['Ann', 'Bob'].map((n) => g.players.find((p) => p.name === n)!);
  const bot = g.players.find((p) => p.bot && !p.cityState && p.civ !== 'barbarian')!;
  check(!!bot, 'a bot leads a civ');
  check(g.chat?.some((l) => l.text === 'good luck, have fun'), 'the lobby’s words go on with the game');
  check(logs.get(bob.id)?.some((l) => l.text === 'good luck, have fun'), 'and each screen is sent them');

  // To one person: Bob hears it, the line names him; to someone not met: refused.
  const before = said(ann.id).length;
  send(ann.id, 'chat', { to: b.index, text: 'nice capital' });
  check(said(ann.id).length === before, 'not met: nothing sent');
  a.met = [b.index, bot.index];
  b.met = [a.index, bot.index];
  heard.clear();
  send(ann.id, 'chat', { to: b.index, text: 'nice capital' });
  check(last(bob.id)?.to === b.index && last(bob.id)?.from === a.index, `Bob hears Ann’s word to him: ${JSON.stringify(last(bob.id))}`);
  check(last(ann.id)?.text === 'nice capital', 'and Ann sees what she said');

  // A face for everyone: everyone sees it.
  heard.clear();
  send(bob.id, 'chat', { emote: 'laugh' });
  check(last(ann.id)?.emote === 'laugh', 'Ann sees Bob laugh');
  send(bob.id, 'chat', { emote: '<script>' });
  check(said(ann.id).length === 1, 'a face not among the faces: nothing');

  // A ping: only a tile its sender knows.
  heard.clear();
  const hidden = a.explored.findIndex((x) => !x);
  const known = a.explored.findIndex((x) => x);
  send(ann.id, 'chat', { ping: { tile: hidden, kind: 'attack' } });
  check(!said(bob.id).length, 'a tile Ann hasn’t seen: no ping');
  send(ann.id, 'chat', { ping: { tile: known, kind: 'attack' } });
  check(last(bob.id)?.ping?.tile === known && last(bob.id)?.ping?.kind === 'attack', `Bob sees Ann’s ping: ${JSON.stringify(last(bob.id))}`);

  // The bot spoken to answers Ann a moment later, and only Ann.
  heard.clear();
  send(ann.id, 'chat', { to: bot.index, text: 'hello there' });
  step(3);
  const answer = said(ann.id).find((l) => l.bot && l.from === bot.index);
  check(!!answer?.text && answer.to === a.index, `${bot.name} answers Ann: ${JSON.stringify(answer)}`);
  check(!said(bob.id).some((l) => l.bot), 'Bob doesn’t hear it');

  // Too much at once: the first few lines go, the rest wait.
  step(9);
  heard.clear();
  for (let i = 0; i < 9; i++) send(bob.id, 'chat', { text: `spam ${i}` });
  const spam = said(ann.id).filter((l) => l.text?.startsWith('spam')).length;
  check(spam === 5, `five lines in a few seconds, not nine (${spam})`);
  // (Long lines are cut.)
  step(9);
  send(bob.id, 'chat', { text: 'x'.repeat(500) });
  check(last(ann.id)?.text?.length === 200, `a long line is cut to 200 (${last(ann.id)?.text?.length})`);
  check((g.chat?.length ?? 0) <= 60, 'only the last of it kept');
}
