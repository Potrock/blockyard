import type { GameDefinition } from '../api/types';
import { decode, encode } from '../net/codec';
import { FrameReader } from '../net/delta';
import type { ClientCommand, HostBatch, HostInit, ServerWelcome, TimedBatch, WireBatch } from '../net/protocol';
import type { SimFrame } from '../sim/sim';
import { GameHost, type GameHostOptions } from './game';

/** A client's connection to wherever its game is hosted. */
export interface SimLink {
  send(cmd: ClientCommand): void;
  /** Batches from the host, in order. */
  onBatch: ((b: HostBatch) => void) | null;
  /** The host itself when it runs in this page (development hooks and tests reach into it). */
  readonly local: GameHost | null;
  /** Done with this game: stop the host (or leave the server). */
  close(): void;
}

/** The host in this page (`?host=page`): each command runs straight away. */
export class PageLink implements SimLink {
  onBatch: ((b: HostBatch) => void) | null = null;
  readonly local: GameHost;

  constructor(def: GameDefinition, o: GameHostOptions) {
    this.local = new GameHost(def, o);
  }

  send(cmd: ClientCommand) {
    const b = this.local.handle(cmd);
    if (b) this.onBatch?.(b);
  }

  close() {
    this.onBatch = null;
    this.local.dispose();
  }
}

/** What a host worker posts back: a batch, an error it caught, or a change to `game.store`. */
export type WorkerReply = HostBatch | { error: string } | { store: [string, unknown] };

/** The host in a worker (the default): commands and batches are messages. */
export class WorkerLink implements SimLink {
  onBatch: ((b: HostBatch) => void) | null = null;
  readonly local = null;
  /** The game changed `game.store`: keep it (the page's localStorage). */
  onStore: ((key: string, value: unknown) => void) | null = null;

  constructor(
    private worker: Worker,
    init: HostInit,
  ) {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if ('error' in m) console.error(`[game host] ${m.error}`);
      else if ('store' in m) this.onStore?.(m.store[0], m.store[1]);
      else this.onBatch?.(m);
    };
    worker.onerror = (e) => console.error(`[game host] ${e.message}`);
    worker.postMessage(init);
  }

  send(cmd: ClientCommand) {
    this.worker.postMessage(cmd);
  }

  close() {
    this.onBatch = null;
    this.onStore = null;
    this.worker.terminate();
  }
}

/**
 * A game server (`?server=ws://…`): the host runs elsewhere on its own clock. The client sends
 * its controls as `input` each frame instead of ticking, and batches arrive stamped with the
 * host's time for smooth playback.
 */
export class SocketLink implements SimLink {
  readonly local = null;
  /** The connection dropped (the server stopped, the network went). */
  onClose: (() => void) | null = null;
  private handler: ((b: HostBatch) => void) | null = null;
  private waiting: TimedBatch[] = [];
  /** Frames arrive as patches on the one before. */
  private frames = new FrameReader<SimFrame>();

  private constructor(
    private ws: WebSocket,
    readonly welcome: ServerWelcome,
    /** Where it's connected (`wss://host/<game>`). */
    readonly url: string,
  ) {}

  /** Connect and wait for the welcome: which game, which world (the player comes with `start`). */
  static connect(url: string): Promise<SocketLink> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let link: SocketLink | null = null;
      ws.onmessage = (e: MessageEvent<string>) => {
        const m = decode<ServerWelcome | WireBatch>(e.data);
        if (link) link.deliver(m as WireBatch);
        else if ('t' in m && m.t === 'welcome') resolve((link = new SocketLink(ws, m, url)));
      };
      // Turned away (full, too many connections) or unreachable: the server's reason, if it gave one.
      ws.onclose = (e: CloseEvent) => {
        if (link) link.onClose?.();
        else reject(new Error(e.reason || `Can't reach the game server at ${url}.`));
      };
    });
  }

  get onBatch() {
    return this.handler;
  }

  /** Batches that came before anyone listened (the catch-up) are handed over first. */
  set onBatch(fn: ((b: HostBatch) => void) | null) {
    this.handler = fn;
    if (!fn) return;
    for (const b of this.waiting.splice(0)) fn(b);
  }

  send(cmd: ClientCommand) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode(cmd));
  }

  /** Leaving on purpose: not a lost connection. */
  close() {
    this.onClose = null;
    this.handler = null;
    this.ws.close();
  }

  private deliver(w: WireBatch) {
    const b: TimedBatch = { events: w.events, frame: w.f === undefined ? null : this.frames.read(w.f), time: w.time };
    if (this.handler) this.handler(b);
    else this.waiting.push(b);
  }
}
