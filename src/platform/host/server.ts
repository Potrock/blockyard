import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameDefinition } from '../api/types';
import { decode, encode } from '../net/codec';
import type { ServerWelcome, TimedBatch } from '../net/protocol';
import { sanitizeCommand } from '../net/validate';
import { GameHost } from './game';
import type { Store } from './store';

export interface ServeOptions {
  /** The games on offer. A client joins one at `/<id>` (with a single game, at any path). */
  games: GameDefinition[];
  port: number;
  /** The engine's compiled `.wasm`. */
  wasm: BufferSource;
  /** Seed for a game's world when it has none kept (default: random). */
  seed?: number;
  /** Steps per second (default 30). */
  tickRate?: number;
  /**
   * Developer tools: cheat commands (`/give`, `/tp`, a game's `cheat` commands), and clients may
   * restart the game or change the time of day. Off on a public server.
   */
  cheats?: boolean;
  /**
   * Where a game's world, players and data are kept (a `SqliteStore` per game). With a world in
   * it, the game carries on that world. Saved every `saveEvery` seconds (default 30), when a
   * player leaves, when the game stops for lack of players and when the server closes.
   */
  store?: (game: string) => Store;
  saveEvery?: number;
  /** Seconds a game runs with nobody in it before it's saved and stopped (default 300). */
  idleStop?: number;
  limits?: Partial<Limits>;
  log?: (line: string) => void;
}

export interface Limits {
  /** Players in one game; more are turned away. */
  playersPerGame: number;
  /** Open connections from one address. */
  perAddress: number;
  /** Messages a connection may send each second (a browser sends one per frame). */
  messagesPerSecond: number;
  /** Largest message, in bytes. */
  maxMessage: number;
}

const LIMITS: Limits = { playersPerGame: 16, perAddress: 6, messagesPerSecond: 300, maxMessage: 16 * 1024 };

/** Close codes a client shows as the reason it couldn't join. */
export const CLOSE_FULL = 4001;
export const CLOSE_LIMIT = 4002;
export const CLOSE_UNKNOWN = 4004;

export interface GameServer {
  readonly port: number;
  /** A game's host, if it's running. */
  host(game: string): GameHost | null;
  close(): Promise<void>;
}

/** One game on the server: started when the first player arrives, stopped when empty a while. */
class Room {
  host: GameHost | null = null;
  readonly sockets = new Map<string, WebSocket>();
  time = 0;
  emptySince = 0;
  private savedAt = 0;
  /** Opened the first time the game starts, kept open while the server runs. */
  private store: Store | undefined;

  constructor(
    readonly def: GameDefinition,
    private o: ServeOptions,
    readonly log: (line: string) => void,
  ) {}

  /** Connections: people playing, and people watching from the title screen. */
  get players(): number {
    return this.sockets.size;
  }

  /** People in the game (joined). */
  get playing(): number {
    return this.host?.sim.players.filter((p) => !p.vacant).length ?? 0;
  }

  /** The game, started if it isn't. */
  start(): GameHost {
    if (this.host) return this.host;
    const store = (this.store ??= this.o.store?.(this.def.id));
    const kept = store?.world();
    const seed = kept?.seed ?? this.o.seed ?? Math.floor(Math.random() * 2 ** 32);
    this.host = new GameHost(this.def, {
      engine: this.o.wasm,
      seed,
      remote: true,
      cheats: this.o.cheats ?? false,
      player: { id: 'p1', name: 'Player' },
      radius: 8,
      store,
      onError: (err) => this.log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`),
    });
    if (store) this.host.persist();
    this.time = 0;
    this.savedAt = 0;
    this.log(kept ? `started, carrying on the kept world (seed ${this.host.seed})` : `started a new world (seed ${this.host.seed})`);
    return this.host;
  }

  /** Save and stop (nobody's here). */
  stop() {
    if (!this.host) return;
    if (this.store) this.host.persist();
    this.host.dispose();
    this.host = null;
    this.log(`stopped${this.store ? ' and saved' : ''}`);
  }

  /** The server is closing: stop, and close the store. */
  close() {
    this.stop();
    this.store?.close();
    this.store = undefined;
  }

  /** One step for everyone in it, plus saving now and then. */
  step(dt: number, now: number) {
    const host = this.host;
    if (!host || !this.sockets.size) return;
    this.time += dt;
    for (const [id, b] of host.step(dt)) {
      const ws = this.sockets.get(id);
      if (ws?.readyState === ws?.OPEN) ws!.send(encode({ ...b, time: this.time } satisfies TimedBatch));
    }
    if (this.store && now - this.savedAt > (this.o.saveEvery ?? 30)) {
      this.savedAt = now;
      host.persist();
    }
  }
}

/**
 * The game server: hosts the given games for players who connect over WebSocket
 * (`wss://host/bedwars?name=Ann`). Each game runs on the server's clock while anyone's in it;
 * each client gets a welcome (game, world seed, their player), a batch that catches them up, then
 * a batch per step. Also answers `GET /health` (for the hosting platform) and `GET /games` (what's
 * on, and how many are playing).
 */
export function serve(o: ServeOptions): Promise<GameServer> {
  const log = o.log ?? (() => {});
  const limits = { ...LIMITS, ...o.limits };
  const rate = o.tickRate ?? 30;
  const dt = 1 / rate;
  const rooms = new Map(o.games.map((def) => [def.id, new Room(def, o, (line) => log(`[${def.id}] ${line}`))]));
  const perAddress = new Map<string, number>();
  const clock = () => performance.now() / 1000;

  const roomFor = (req: IncomingMessage): Room | null => {
    const path = new URL(req.url ?? '/', 'http://server').pathname.replace(/^\/+|\/+$/g, '');
    if (rooms.size === 1 && (path === '' || rooms.has(path))) return [...rooms.values()][0];
    return rooms.get(path) ?? null;
  };
  // Behind a proxy (Fly), the player's address is in a header.
  const addressOf = (req: IncomingMessage) => String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?');

  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://server').pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else if (path === '/games' || path === '/') {
      const games = [...rooms.values()].map((r) => ({ id: r.def.id, title: r.def.title, players: r.playing, watching: r.players - r.playing, running: !!r.host }));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ games }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxMessage });
  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, req));
  });

  function join(ws: WebSocket, req: IncomingMessage) {
    // A bad frame (too big, malformed) is an error on that socket alone: it closes, the server
    // carries on. (Unhandled, it would take the whole process down.)
    ws.on('error', (err) => log(`socket error from ${addressOf(req)}: ${err.message}`));
    const room = roomFor(req);
    if (!room) return ws.close(CLOSE_UNKNOWN, 'No such game on this server');
    if (room.players >= limits.playersPerGame) return ws.close(CLOSE_FULL, 'This game is full');
    const address = addressOf(req);
    if ((perAddress.get(address) ?? 0) >= limits.perAddress) return ws.close(CLOSE_LIMIT, 'Too many connections from your address');
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);

    // They watch until their client says `start` (with a name): then they're in the game.
    const host = room.start();
    const { id, batch } = host.connect();
    room.sockets.set(id, ws);
    room.log(`${id} connected from ${address} (${room.players} here)`);
    const sp = host.sim.spawn;
    ws.send(encode({ t: 'welcome', game: room.def.id, seed: host.seed, player: null, spawn: { x: sp.x, y: sp.y, z: sp.z, yaw: sp.yaw }, tickRate: rate } satisfies ServerWelcome));
    ws.send(encode({ ...batch, time: room.time } satisfies TimedBatch));

    // A bucket of messages, refilled each second; a client far over it is disconnected.
    let allowance = limits.messagesPerSecond;
    let over = 0;
    const refill = setInterval(() => {
      allowance = limits.messagesPerSecond;
      over = Math.max(0, over - limits.messagesPerSecond);
    }, 1000);
    ws.on('message', (data, binary) => {
      if (binary) return;
      if (--allowance < 0) {
        if (++over > limits.messagesPerSecond * 3) ws.close(CLOSE_LIMIT, 'Too many messages');
        return;
      }
      let cmd;
      try {
        cmd = sanitizeCommand(decode(String(data)));
      } catch {
        return;
      }
      // The server keeps the clock (a client's ticks mean nothing here); restarting everyone's
      // game and changing their time of day are for development servers.
      if (!cmd || cmd.t === 'tick' || (!o.cheats && (cmd.t === 'restart' || cmd.t === 'env'))) return;
      room.host?.command(id, cmd);
      if (cmd.t === 'start' && cmd.name) room.log(`${id} plays as ${cmd.name}`);
    });
    ws.on('close', () => {
      clearInterval(refill);
      perAddress.set(address, (perAddress.get(address) ?? 1) - 1);
      if (!perAddress.get(address)) perAddress.delete(address);
      room.sockets.delete(id);
      room.host?.disconnect(id);
      if (!room.players) room.emptySince = clock();
      room.log(`${id} left (${room.players} here)`);
    });
  }

  const timer = setInterval(() => {
    const now = clock();
    for (const room of rooms.values()) {
      room.step(dt, now);
      if (room.host && !room.players && now - room.emptySince > (o.idleStop ?? 300)) room.stop();
    }
  }, 1000 / rate);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(o.port, () => {
      const addr = http.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : o.port,
        host: (game) => rooms.get(game)?.host ?? null,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(timer);
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            http.close(() => {
              for (const room of rooms.values()) room.close();
              done();
            });
          }),
      });
    });
  });
}

/** One game on its own server (tests, a single-game deployment). */
export function serveGame(def: GameDefinition, o: Omit<ServeOptions, 'games'>): Promise<GameServer> {
  return serve({ ...o, games: [def] });
}
