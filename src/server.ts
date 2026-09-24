// The game server: hosts one of the app's games for players who join from the browser with
// `?server=ws://host:port`. Run with `npm run server -- <game> [--port 8787] [--seed 1234]`.
import { readFileSync } from 'node:fs';
import { games } from './games';
import { serveGame } from './platform/host/server';

export async function main(args: string[]) {
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const id = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? 'sandbox';
  const def = games.find((g) => g.id === id);
  if (!def) throw new Error(`no game "${id}" (games: ${games.map((g) => g.id).join(', ')})`);
  const port = Number(flag('port') ?? 8787);
  const seed = Number(flag('seed') ?? Math.floor(Math.random() * 2 ** 32)) >>> 0;
  const server = await serveGame(def, {
    port,
    seed,
    wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'),
    cheats: args.includes('--cheats'),
    log: (line) => console.log(`[${def.id}] ${line}`),
  });
  console.log(`[${def.id}] serving on ws://localhost:${server.port} (seed ${server.host.seed})`);
  console.log(`[${def.id}] players join at http://localhost:5173/?server=ws://localhost:${server.port}&name=Ann`);
  return server;
}
