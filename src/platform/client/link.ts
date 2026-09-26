import { decode, encode } from '../net/codec';
import { FrameReader } from '../net/delta';
import type { ClientCommand, HostBatch, ServerWelcome, TimedBatch, WireBatch } from '../net/protocol';
import type { SimFrame } from '../sim/sim';

/**
 * A client's connection to its game server (`wss://host/<game>`): the host runs there on its own
 * clock. The client sends its controls as `input` each frame, and batches arrive stamped with the
 * host's time for smooth playback.
 */
export class SocketLink {
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

  /** Batches from the host, in order. */
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
