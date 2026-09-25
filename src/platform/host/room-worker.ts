import { parentPort, workerData } from 'node:worker_threads';
import type { GameDefinition } from '../api/types';
import type { ClientCommand } from '../net/protocol';
import { PrivateStore, RoomCore, type RoomSpec } from './room';
import { SqliteStore } from './sqlite';
import type { Store } from './store';

/** What a room's worker is started with. */
export interface RoomWorkerData {
  spec: RoomSpec;
  /** The engine: compiled (the server's, shared) or its `.wasm` bytes. */
  wasm: WebAssembly.Module | Uint8Array;
  /** The game's database (the worker opens its own connection), or none. */
  storeFile: string | null;
  /** A room of a player's own: shares the game's data, keeps no world or places. */
  own: boolean;
}

/** The server to a room's worker. */
export type ToRoom = { t: 'connect'; client: string } | { t: 'command'; client: string; cmd: ClientCommand } | { t: 'disconnect'; client: string } | { t: 'stop' };

/** A room's worker to the server. */
export type FromRoom =
  | { t: 'send'; client: string; text: string }
  | { t: 'counts'; playing: number; watching: number }
  | { t: 'log'; line: string }
  | { t: 'failed'; text: string };

/**
 * Run one room in this worker thread (the app's room worker calls this; `find` looks its game
 * up). The server says who connected, what they sent and when they left; the room says what to
 * send each of them. Its game's module-level state, and any crash or runaway loop, stay here.
 * Told to stop, it saves, closes its store and ends: the promise settles then.
 */
export async function serveRoomWorker(find: (id: string) => GameDefinition | undefined | Promise<GameDefinition | undefined>): Promise<void> {
  const port = parentPort;
  if (!port) throw new Error('serveRoomWorker: not in a worker thread');
  const data = workerData as RoomWorkerData;
  const post = (m: FromRoom) => port.postMessage(m);
  let core: RoomCore;
  let store: Store | undefined;
  try {
    const def = await find(data.spec.game);
    if (!def) throw new Error(`no game "${data.spec.game}"`);
    const own = data.storeFile ? SqliteStore.open(data.storeFile, data.spec.game) : undefined;
    store = own && data.own ? new PrivateStore(own, true) : own;
    core = new RoomCore(def, data.spec, data.wasm, store, {
      send: (client, text) => post({ t: 'send', client, text }),
      counts: (playing, watching) => post({ t: 'counts', playing, watching }),
      log: (line) => post({ t: 'log', line }),
    });
  } catch (err) {
    post({ t: 'failed', text: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    port.close();
    return;
  }
  const ended = new Promise<void>((done) => port.on('close', done));
  port.on('message', (m: ToRoom) => {
    try {
      if (m.t === 'connect') core.connect(m.client);
      else if (m.t === 'command') core.command(m.client, m.cmd);
      else if (m.t === 'disconnect') core.disconnect(m.client);
      else if (m.t === 'stop') {
        // Saved and closed: the thread ends (the server waits for that).
        core.stop();
        store?.close();
        port.close();
      }
    } catch (err) {
      post({ t: 'log', line: `error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}` });
    }
  });
  return ended;
}
