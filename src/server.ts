// The game server: hosts one of the app's games for players who join from the browser with
// `?server=ws://host:port`. Run with `npm run server -- <game> [--port 8787] [--seed 1234]
// [--db data/<game>.sqlite] [--new] [--cheats]`.
import { existsSync, renameSync, readFileSync } from 'node:fs';
import { games } from './games';
import { serveGame } from './platform/host/server';
import { SqliteStore } from './platform/host/sqlite';

export async function main(args: string[]) {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const valued = ['--port', '--seed', '--db'];
  const id = args.find((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1])) ?? 'sandbox';
  const def = games.find((g) => g.id === id);
  if (!def) throw new Error(`no game "${id}" (games: ${games.map((g) => g.id).join(', ')})`);
  const port = Number(flag('port') ?? 8787);
  const seed = Number(flag('seed') ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  // The database: the world and its players, and the game's own data. --new sets the old one aside.
  const db = flag('db') ?? `data/${def.id}.sqlite`;
  if (args.includes('--new') && existsSync(db)) {
    const aside = `${db}.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    for (const ext of ['', '-wal', '-shm']) if (existsSync(db + ext)) renameSync(db + ext, aside + ext);
    console.log(`[${def.id}] the old world is in ${aside}`);
  }
  const server = await serveGame(def, {
    port,
    seed,
    wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'),
    cheats: args.includes('--cheats'),
    store: SqliteStore.open(db, def.id),
    log: (line) => console.log(`[${def.id}] ${line}`),
  });
  console.log(`[${def.id}] serving on ws://localhost:${server.port} (seed ${server.host.seed}, saved in ${db})`);
  console.log(`[${def.id}] players join at http://localhost:5173/?server=ws://localhost:${server.port}&name=Ann`);
  return server;
}
