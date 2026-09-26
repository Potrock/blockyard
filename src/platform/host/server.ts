import { createServer, type IncomingMessage } from 'node:http';
import type { Worker } from 'node:worker_threads';
import { WebSocketServer, type WebSocket } from 'ws';
import type { GameDefinition } from '../api/types';
import { decode, encode } from '../net/codec';
import { ROOM_CODE, type ClientCommand, type WireBatch } from '../net/protocol';
import { sanitizeCommand } from '../net/validate';
import type { GameHost } from './game';
import { PrivateStore, RoomCore, type RoomSpec } from './room';
import type { FromRoom, RoomWorkerData, ToRoom } from './room-worker';
import type { Store } from './store';

export interface ServeOptions {
  /**
   * The games on offer. A client joins a game's public room at `/<id>` (with a single game, also
   * at `/`), and a room of their own, for a game with `instances`, at `/<id>/<code>`.
   */
  games: GameDefinition[];
  /**
   * Games hosted when a client names one (`/<id>`), but not listed (`GET /games`): development
   * games, on a development server.
   */
  hidden?: GameDefinition[];
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
   * Development mode (`npm run dev`, never a public server): clients' `dev` commands
   * (`__game.dev(js)`) run in their room, with the game's context. Without it they're refused.
   */
  dev?: boolean;
  /**
   * Start a room's worker thread: the app's room worker, which calls `serveRoomWorker`. Games keep
   * state in their modules, so two rooms of one game can only run side by side in threads of
   * their own (and one room's crash or runaway loop stays in its thread). Without it, rooms run
   * in this thread, and each game has only its public room (tests).
   */
  worker?: (data: RoomWorkerData) => Worker;
  /**
   * Where a game's world, players and data are kept: rooms in this thread use `store` (a
   * `SqliteStore` per game), and a room's worker opens `storeFile` itself. With a world in it, the
   * public room carries on that world. Saved every `saveEvery` seconds (default 30), when a room
   * stops and when the server closes. Rooms of players' own share the game's data (all-time
   * numbers) but keep no world or places.
   */
  store?: (game: string) => Store;
  storeFile?: (game: string) => string;
  saveEvery?: number;
  /** Seconds a public room runs with nobody in it before it's saved and stopped (default 300). */
  idleStop?: number;
  /** And a room of a player's own, which then goes (default 60). */
  idleStopOwn?: number;
  limits?: Partial<Limits>;
  log?: (line: string) => void;
}

export interface Limits {
  /** Players in one room; more are turned away. */
  playersPerGame: number;
  /** Open connections from one address. */
  perAddress: number;
  /** Messages a connection may send each second (a browser sends one per frame). */
  messagesPerSecond: number;
  /** Largest message, in bytes. */
  maxMessage: number;
  /** Rooms running at once (each a world of its own), public ones included. */
  rooms: number;
  /** Rooms of their own that people at one address may have running at once. */
  roomsPerAddress: number;
}

const LIMITS: Limits = { playersPerGame: 16, perAddress: 6, messagesPerSecond: 300, maxMessage: 16 * 1024, rooms: 12, roomsPerAddress: 2 };

/** Close codes a client shows as the reason it couldn't join. */
export const CLOSE_FULL = 4001;
export const CLOSE_LIMIT = 4002;
export const CLOSE_UNKNOWN = 4004;

export interface GameServer {
  readonly port: number;
  /** A game's public room's host, if it's running in this thread. */
  host(game: string): GameHost | null;
  /** Rooms running (public ones and players' own). */
  readonly rooms: number;
  close(): Promise<void>;
}

/** A running room, wherever it runs (here, or in a worker): what the server tells it. */
interface RoomLink {
  connect(client: string): void;
  command(client: string, cmd: ClientCommand): void;
  disconnect(client: string): void;
  /** Save (if it keeps anything) and stop. */
  stop(): Promise<void>;
  /** Its host, when it runs in this thread. */
  readonly host: GameHost | null;
}

/** One room on the server: a game's public one, or one a player started of their own. */
class Room {
  readonly sockets = new Map<string, WebSocket>();
  link: RoomLink | null = null;
  /** Finishing its last run (saving): the next waits for it. */
  stopping: Promise<void> | null = null;
  playing = 0;
  watching = 0;
  emptySince = 0;

  constructor(
    readonly def: GameDefinition,
    /** `public`, or its code. */
    readonly instance: string,
    /** Who started it (a room of their own): their address. */
    readonly creator: string | null,
    readonly log: (line: string) => void,
  ) {}

  get own(): boolean {
    return this.instance !== 'public';
  }

  get key(): string {
    return `${this.def.id}/${this.instance}`;
  }

  send(client: string, text: string) {
    const ws = this.sockets.get(client);
    if (ws && ws.readyState === ws.OPEN) ws.send(text);
  }
}

/**
 * The game server: hosts the given games for players who connect over WebSocket
 * (`wss://host/bedwars`). Each game has a public room; a game with `instances` also lets a player
 * start one of their own (`wss://host/bedwars/k3x9f2`: just them and the bots, or whoever they
 * share its address with). A room runs its game on its own clock (in a worker thread of its own,
 * given `worker`) while anyone's in it; each client gets a welcome (game, room, world seed), a
 * batch that catches them up, then a batch per step. Also answers `GET /health` (for the hosting
 * platform) and `GET /games` (what's on, and how many are playing).
 */
export function serve(o: ServeOptions): Promise<GameServer> {
  const log = o.log ?? (() => {});
  const limits = { ...LIMITS, ...o.limits };
  const rate = o.tickRate ?? 30;
  const defs = new Map([...(o.hidden ?? []), ...o.games].map((d) => [d.id, d]));
  const rooms = new Map<string, Room>();
  /** Stores opened in this thread: one per game, shared by its rooms here. */
  const stores = new Map<string, Store>();
  const perAddress = new Map<string, number>();
  const clock = () => performance.now() / 1000;
  let nextClient = 1;
  // Compiled once: each room's worker gets the module (no compiling per room).
  let engine: WebAssembly.Module | null = null;

  const running = () => [...rooms.values()].filter((r) => r.link).length;

  /** Start a room's game: in a worker of its own, or here. */
  function start(room: Room): RoomLink {
    const spec: RoomSpec = { game: room.def.id, instance: room.instance, tickRate: rate, cheats: o.cheats ?? false, dev: o.dev ?? false, seed: o.seed, saveEvery: o.saveEvery ?? 30 };
    if (o.worker) return inWorker(room, spec, room.stopping ?? Promise.resolve());
    let shared = stores.get(room.def.id);
    if (!shared && o.store) stores.set(room.def.id, (shared = o.store(room.def.id)));
    const core = new RoomCore(room.def, spec, o.wasm, shared && room.own ? new PrivateStore(shared, false) : shared, {
      send: (client, text) => room.send(client, text),
      counts: (playing, watching) => {
        room.playing = playing;
        room.watching = watching;
      },
      log: room.log,
    });
    return {
      host: core.host,
      connect: (c) => core.connect(c),
      command: (c, cmd) => core.command(c, cmd),
      disconnect: (c) => core.disconnect(c),
      stop: async () => core.stop(),
    };
  }

  /** A room in a worker thread, started once its last run has finished saving (`after`). */
  function inWorker(room: Room, spec: RoomSpec, after: Promise<void>): RoomLink {
    let worker: Worker | null = null;
    const queue: ToRoom[] = [];
    const post = (m: ToRoom) => (worker ? worker.postMessage(m) : queue.push(m));
    let exited = false;
    const exit = new Promise<void>((done) => {
      void after.then(() => {
        engine ??= new WebAssembly.Module(o.wasm);
        worker = o.worker!({ spec, wasm: engine, storeFile: o.storeFile?.(room.def.id) ?? null, own: room.own });
        worker.on('message', (m: FromRoom) => {
          if (m.t === 'send') room.send(m.client, m.text);
          else if (m.t === 'counts') {
            room.playing = m.playing;
            room.watching = m.watching;
          } else if (m.t === 'log') room.log(m.line);
          else if (m.t === 'failed') failed(room, link, m.text);
        });
        worker.on('error', (err: Error) => failed(room, link, err.stack ?? err.message));
        worker.on('exit', () => {
          exited = true;
          done();
        });
        for (const m of queue) worker.postMessage(m);
        queue.length = 0;
      });
    });
    const link: RoomLink = {
      host: null,
      connect: (c) => post({ t: 'connect', client: c }),
      command: (c, cmd) => post({ t: 'command', client: c, cmd }),
      disconnect: (c) => post({ t: 'disconnect', client: c }),
      stop: () => {
        if (!exited) post({ t: 'stop' });
        // It exits once saved; one that doesn't answer is stopped anyway.
        const late = setTimeout(() => void worker?.terminate(), 10_000);
        return exit.finally(() => clearTimeout(late));
      },
    };
    return link;
  }

  /** Something went wrong with a room itself (not a game's error, which it logs and carries on from): everyone in it is let go. */
  function failed(room: Room, link: RoomLink, reason: string) {
    room.log(`failed: ${reason}`);
    if (room.link !== link) return;
    void stop(room);
    for (const ws of room.sockets.values()) ws.close(1011, 'The game stopped unexpectedly');
  }

  /** Save and stop a room (nobody's in it, or the server is closing); a room of a player's own then goes. */
  async function stop(room: Room) {
    const link = room.link;
    if (!link) return room.stopping ?? undefined;
    room.link = null;
    room.playing = room.watching = 0;
    if (room.own) rooms.delete(room.key);
    const done = link.stop().then(() => {
      room.log(`stopped${o.store || o.storeFile ? ' and saved' : ''}`);
      if (room.stopping === done) room.stopping = null;
    });
    room.stopping = done;
    return done;
  }

  /** The room a connection asks for (`/<game>`, or `/<game>/<code>`), made if need be; or why not. */
  function roomFor(req: IncomingMessage, address: string): Room | { code: number; reason: string } {
    const parts = new URL(req.url ?? '/', 'http://server').pathname.split('/').filter(Boolean);
    const def = parts.length ? defs.get(parts[0]) : o.games.length === 1 ? o.games[0] : undefined;
    const code = parts[1];
    // Rooms of players' own need threads of their own (the games' module-level state).
    if (!def || parts.length > 2 || (code !== undefined && (!def.instances || !o.worker || !ROOM_CODE.test(code)))) return { code: CLOSE_UNKNOWN, reason: 'No such game on this server' };
    const key = `${def.id}/${code ?? 'public'}`;
    const room = rooms.get(key);
    if (room?.link) return room;
    if (code !== undefined && [...rooms.values()].filter((r) => r.creator === address && r.link).length >= limits.roomsPerAddress) {
      return { code: CLOSE_LIMIT, reason: 'You have too many games of your own going: leave one first' };
    }
    if (running() >= limits.rooms) return { code: CLOSE_FULL, reason: 'The server is busy (too many games going): try again soon' };
    if (room) return room;
    const made = new Room(def, code ?? 'public', code === undefined ? null : address, (line) => log(`[${key}] ${line}`));
    rooms.set(key, made);
    return made;
  }

  // Behind a proxy (Fly), the player's address is in a header.
  const addressOf = (req: IncomingMessage) => String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?');

  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://server').pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    } else if (path === '/games' || path === '/') {
      const games = o.games.map((def) => {
        const pub = rooms.get(`${def.id}/public`);
        const own = [...rooms.values()].filter((r) => r.def === def && r.own && r.link);
        return {
          id: def.id,
          title: def.title,
          players: pub?.playing ?? 0,
          watching: pub?.watching ?? 0,
          running: !!pub?.link,
          instances: !!def.instances,
          // Rooms of players' own, and how many are playing in them.
          rooms: own.length,
          playingOwn: own.reduce((n, r) => n + r.playing, 0),
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ games, rooms: running() }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });

  // Compressed (permessage-deflate, which every browser speaks): one step's patch looks much like
  // the last, so keeping the compressor's window between messages shrinks them a few times over.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: limits.maxMessage,
    perMessageDeflate: { threshold: 64, serverMaxWindowBits: 13, zlibDeflateOptions: { level: 3, memLevel: 7 } },
  });
  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    wss.handleUpgrade(req, socket, head, (ws) => join(ws, req));
  });

  function join(ws: WebSocket, req: IncomingMessage) {
    // A bad frame (too big, malformed) is an error on that socket alone: it closes, the server
    // carries on. (Unhandled, it would take the whole process down.)
    ws.on('error', (err) => log(`socket error from ${addressOf(req)}: ${err.message}`));
    const address = addressOf(req);
    if ((perAddress.get(address) ?? 0) >= limits.perAddress) return ws.close(CLOSE_LIMIT, 'Too many connections from your address');
    const found = roomFor(req, address);
    if (!(found instanceof Room)) return ws.close(found.code, found.reason);
    const room = found;
    if (room.sockets.size >= limits.playersPerGame) return ws.close(CLOSE_FULL, 'This game is full');
    perAddress.set(address, (perAddress.get(address) ?? 0) + 1);

    // They watch until their client says `start` (with a name): then they're in the game.
    const id = `c${nextClient++}`;
    room.sockets.set(id, ws);
    room.link ??= start(room);
    room.link.connect(id);
    room.log(`${id} connected from ${address} (${room.sockets.size} here)`);

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
      // Running code in the room (development tools): only on a development server. Elsewhere
      // it goes no further than here, and the client hears why.
      if (cmd.t === 'dev' && !o.dev) {
        const refused: WireBatch = { events: [{ t: 'reply', id: cmd.id, value: { ok: false, error: 'refused: this server is not in development mode (npm run dev)' } }], time: 0 };
        if (ws.readyState === ws.OPEN) ws.send(encode(refused));
        return;
      }
      room.link?.command(id, cmd);
      if (cmd.t === 'start' && cmd.name) room.log(`${id} plays as ${cmd.name}`);
    });
    ws.on('close', () => {
      clearInterval(refill);
      perAddress.set(address, (perAddress.get(address) ?? 1) - 1);
      if (!perAddress.get(address)) perAddress.delete(address);
      room.sockets.delete(id);
      room.link?.disconnect(id);
      if (!room.sockets.size) room.emptySince = clock();
      room.log(`${id} left (${room.sockets.size} here)`);
    });
  }

  // Rooms nobody's in are saved and stopped after a while (players' own sooner, and they go).
  const idle = setInterval(() => {
    const now = clock();
    for (const room of [...rooms.values()]) {
      if (room.link && !room.sockets.size && now - room.emptySince > (room.own ? (o.idleStopOwn ?? 60) : (o.idleStop ?? 300))) void stop(room);
    }
  }, 250);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(o.port, () => {
      const addr = http.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : o.port,
        host: (game) => rooms.get(`${game}/public`)?.link?.host ?? null,
        get rooms() {
          return running();
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(idle);
            for (const ws of wss.clients) ws.terminate();
            wss.close();
            http.close(async () => {
              await Promise.all([...rooms.values()].map((r) => stop(r)));
              for (const s of stores.values()) s.close();
              stores.clear();
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
