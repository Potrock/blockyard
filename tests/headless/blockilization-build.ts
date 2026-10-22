import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { Game } from '../../src/games/blockilization/rules/state';
import { extent } from '../../src/games/blockilization/geometry';
import { check, games } from './_harness';
import { devGames } from '../../src/games/server';

/**
 * Blockilization builds every map, the widest too: the server loads the world 12 chunks round its
 * people at most (as far as a screen asks), and the large Earth reaches 14 from its middle, so the
 * build takes them to its far parts first. (It waited at 0% for them, for good, before.)
 */
export default async function blockilizationBuild() {
  const def = [...games, ...(await devGames())].find((g) => g.id === 'blockilization')!;
  for (const size of ['large', 'huge'] as const) {
    // (As in a room: 8 columns round each person, raised to what their screens ask, a few columns a tick.)
    const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 3, remote: true, radius: 8, cheats: true, player: { id: 'p1', name: 'Player' } });
    const civ = (globalThis as unknown as { __civ: { game: () => Game | null; phase: () => string } }).__civ;
    const step = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 30) host.step(1 / 30);
    };
    const send = (id: string, name: string, data: unknown) => {
      host.command(id, { t: 'message', msg: { t: 'game', player: id, name, data } });
      step(2 / 30);
    };
    const ann = host.connect('Ann');
    host.command(ann.id, { t: 'start' });
    host.command(ann.id, { t: 'radius', columns: 12 });
    step(0.5);
    send(ann.id, 'lobby', { a: 'settings', type: 'earth', size, cityStates: 4 });
    send(ann.id, 'lobby', { a: 'bots', count: 7 });
    send(ann.id, 'lobby', { a: 'start' });
    for (let i = 0; i < 240 && civ.phase() !== 'playing'; i++) step(0.5);
    const across = extent(civ.game()!.grid).w / 32;
    check(across > 12, `the ${size} Earth is wider than the server loads round one place (${across} chunks from its middle)`);
    check(civ.phase() === 'playing', `the ${size} Earth is built and the game begins (${civ.phase()})`);
  }
}
