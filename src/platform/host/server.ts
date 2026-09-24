import { WebSocketServer, type WebSocket } from 'ws';
import type { GameDefinition } from '../api/types';
import { decode, encode } from '../net/codec';
import type { ClientCommand, ServerWelcome, TimedBatch } from '../net/protocol';
import { GameHost } from './game';
import type { Store } from './store';

export interface ServeOptions {
  port: number;
  seed: number;
  /** The engine's compiled `.wasm`. */
  wasm: BufferSource;
  /** Steps per second (default 30). */
  tickRate?: number;
  /** Chat commands like `/give` (default off on a server). */
  cheats?: boolean;
  /**
   * What's kept across restarts (a `SqliteStore`): with a world in it, the server carries on that
   * world (its seed; its builds and players' places if the game keeps its world), whatever `seed`
   * says. Saved every `saveEvery` seconds (default 30) and when the server closes.
   */
  store?: Store;
  saveEvery?: number;
  log?: (line: string) => void;
}

export interface GameServer {
  readonly host: GameHost;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Host one game for players who connect over WebSocket (`ws://host:port/?name=Ann`). The game
 * runs on the server's clock whether or not anyone is watching a given frame; each client gets a
 * welcome (game, world seed, their player), a batch that catches them up, then a batch per step.
 * Nothing runs while nobody's connected.
 */
export function serveGame(def: GameDefinition, o: ServeOptions): Promise<GameServer> {
  const log = o.log ?? (() => {});
  const rate = o.tickRate ?? 30;
  const dt = 1 / rate;
  const kept = o.store?.world();
  const host = new GameHost(def, { engine: o.wasm, seed: kept?.seed ?? o.seed, remote: true, cheats: o.cheats ?? false, player: { id: 'p1', name: 'Player' }, radius: 8, store: o.store });
  if (o.store) {
    host.persist();
    log(kept ? `carrying on the saved world (seed ${host.seed})` : `new world (seed ${host.seed})`);
  }
  const sockets = new Map<string, WebSocket>();
  let time = 0;
  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(encode(msg));
  };

  const wss = new WebSocketServer({ port: o.port });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://server');
    // Names are who you are here (a kept world remembers your place by name): one of each at a time.
    const asked = (url.searchParams.get('name') ?? '').trim().slice(0, 24) || 'Player';
    const taken = new Set(host.sim.players.filter((p) => !p.vacant).map((p) => p.name));
    let name = asked;
    for (let n = 2; taken.has(name); n++) name = `${asked} ${n}`;
    const { id, batch } = host.connect(name);
    sockets.set(id, ws);
    log(`${name} joined as ${id} (${host.connected} playing)`);
    send(ws, { t: 'welcome', game: def.id, seed: host.seed, player: id, tickRate: rate } satisfies ServerWelcome);
    send(ws, { ...batch, time } satisfies TimedBatch);
    ws.on('message', (data) => {
      let cmd: ClientCommand;
      try {
        cmd = decode<ClientCommand>(String(data));
      } catch {
        return;
      }
      // The server keeps the clock: a client's ticks mean nothing here.
      if (cmd.t !== 'tick') host.command(id, cmd);
    });
    ws.on('close', () => {
      sockets.delete(id);
      host.disconnect(id);
      log(`${name} (${id}) left (${host.connected} playing)`);
    });
  });

  const saver = o.store ? setInterval(() => host.persist(), (o.saveEvery ?? 30) * 1000) : null;
  const timer = setInterval(() => {
    if (!host.connected) return;
    time += dt;
    for (const [id, b] of host.step(dt)) {
      const ws = sockets.get(id);
      if (ws) send(ws, { ...b, time } satisfies TimedBatch);
    }
  }, 1000 / rate);

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      resolve({
        host,
        port: typeof addr === 'object' && addr ? addr.port : o.port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            if (saver) clearInterval(saver);
            for (const ws of wss.clients) ws.terminate();
            wss.close(() => {
              if (o.store) {
                host.persist();
                o.store.close();
              }
              done();
            });
          }),
      });
    });
  });
}
