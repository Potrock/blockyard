import type { GameDefinition } from '../api/types';
import type { ClientCommand, HostBatch, HostInit } from '../net/protocol';
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

/** What a host worker posts back: a batch, or an error it caught. */
export type WorkerReply = HostBatch | { error: string };

/** The host in a worker (the default): commands and batches are messages. */
export class WorkerLink implements SimLink {
  onBatch: ((b: HostBatch) => void) | null = null;
  readonly local = null;

  constructor(
    private worker: Worker,
    init: HostInit,
  ) {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      if ('error' in e.data) console.error(`[game host] ${e.data.error}`);
      else this.onBatch?.(e.data);
    };
    worker.onerror = (e) => console.error(`[game host] ${e.message}`);
    worker.postMessage(init);
  }

  send(cmd: ClientCommand) {
    this.worker.postMessage(cmd);
  }
}
