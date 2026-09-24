// The game server: hosts the app's games for players who join from the browser ("Play online" on
// the title screen, or `?server=ws://host:port/<game>`).
//
//   npm run server -- [games…] [--port 8787] [--data data] [--seed 1234] [--new] [--cheats]
//
// Games default to all of them; each keeps its world, players and data in <data>/<game>.sqlite
// (--db path for a single game). --new sets the kept worlds aside and starts fresh.
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { games } from './games';
import { serve } from './platform/host/server';
import { SqliteStore } from './platform/host/sqlite';

export async function main(args: string[]) {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const valued = ['--port', '--seed', '--db', '--data'];
  const named = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1])).flatMap((a) => a.split(','));
  const defs = named.length ? named.map((id) => games.find((g) => g.id === id) ?? fail(`no game "${id}" (games: ${games.map((g) => g.id).join(', ')})`)) : games;
  const port = Number(flag('port') ?? process.env.PORT ?? 8787);
  const seed = flag('seed') === undefined ? undefined : Number(flag('seed')) >>> 0;
  const data = flag('data') ?? process.env.DATA_DIR ?? 'data';
  const dbOf = (game: string) => (defs.length === 1 && flag('db')) || join(data, `${game}.sqlite`);
  if (args.includes('--new')) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    for (const d of defs) {
      const db = dbOf(d.id);
      if (!existsSync(db)) continue;
      for (const ext of ['', '-wal', '-shm']) if (existsSync(db + ext)) renameSync(db + ext, `${db}.${stamp}${ext}`);
      console.log(`[${d.id}] the old world is in ${db}.${stamp}`);
    }
  }
  const server = await serve({
    games: defs,
    port,
    seed,
    wasm: readFileSync(flag('wasm') ?? 'engine/pkg/voxel_engine_bg.wasm'),
    cheats: args.includes('--cheats'),
    store: (game) => SqliteStore.open(dbOf(game), game),
    log: (line) => console.log(line),
  });
  console.log(`serving ${defs.map((d) => d.id).join(', ')} on port ${server.port}${args.includes('--cheats') ? ' (cheats on)' : ''}; kept in ${defs.length === 1 && flag('db') ? flag('db') : `${data}/`}`);
  for (const d of defs) console.log(`  ${d.id.padEnd(12)} http://localhost:5173/?server=ws://localhost:${server.port}/${d.id}&name=Ann`);
  return server;
}

function fail(message: string): never {
  throw new Error(message);
}
