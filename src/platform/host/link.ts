import type { GameDefinition } from '../api/types';
import { decode, encode } from '../net/codec';
import type { ClientCommand, HostBatch, HostInit, ServerWelcome, TimedBatch } from '../net/protocol';
import { GameHost, type GameHostOptions } from './game';

/** A client's connection to wherever its game is hosted. */
export interface SimLink {
  send(cmd: ClientCommand): void;
  /** Batches from the host, in order. */
  onBatch: ((b: HostBatch) => void) | null;
  /** The host itself when it runs in this page (development hooks and tests reach into it). */
  readonly local: GameHost | null;
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

  private constructor(
    private ws: WebSocket,
    readonly welcome: ServerWelcome,
  ) {}

  /** Connect and wait for the welcome: which game, which world, which player. */
  static connect(url: string, name: string): Promise<SocketLink> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${url}${url.includes('?') ? '&' : '?'}name=${encodeURIComponent(name)}`);
      let link: SocketLink | null = null;
      ws.onmessage = (e: MessageEvent<string>) => {
        const m = decode<ServerWelcome | TimedBatch>(e.data);
        if (link) link.deliver(m as TimedBatch);
        else if ('t' in m && m.t === 'welcome') resolve((link = new SocketLink(ws, m)));
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

  close() {
    this.ws.close();
  }

  private deliver(b: TimedBatch) {
    if (this.handler) this.handler(b);
    else this.waiting.push(b);
  }
}
