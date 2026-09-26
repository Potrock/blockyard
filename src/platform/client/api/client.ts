import type { Client, ClientDefinition, ClientEvent, ClientKit, ClientServices, Me } from '../../api/client/core';
import type { ItemDefinition, SharedDefinition } from '../../api/types';

/** What the client API needs of the runtime: the services it hands out (each built by its part of the platform), items, messages. */
export interface ClientHost {
  services: ClientServices;
  item(id: string): ItemDefinition | undefined;
  send(name: string, data: unknown): void;
}

// The services are the host's, on the client object itself (`client.view`, `client.fx`, …).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ClientRuntime extends ClientServices {}

/**
 * A game's client code at work on this screen: the `Client` its kits and its own code see, the
 * kits run in order each frame, then the game's `frame`, and this frame's events (the runtime and
 * the server's calls `emit` them as they happen; they're cleared once everyone has seen them).
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ClientRuntime implements Client {
  me!: Me;
  time = 0;
  private queue: ClientEvent[] = [];
  private seen: ClientEvent[] = [];
  private listeners = new Map<string, ((data: unknown) => void)[]>();
  private kits: ClientKit[];
  private started = false;

  constructor(
    readonly shared: SharedDefinition,
    private def: ClientDefinition,
    private host: ClientHost,
  ) {
    this.kits = def.kits ?? [];
    Object.assign(this, host.services);
  }

  get events(): readonly ClientEvent[] {
    return this.seen;
  }
  item(id: string) {
    return this.host.item(id);
  }
  on(name: string, fn: (data: unknown) => void) {
    const l = this.listeners.get(name) ?? [];
    l.push(fn);
    this.listeners.set(name, l);
  }
  send(name: string, data: unknown) {
    this.host.send(name, data);
  }

  /** Something happened: the kits see it next frame (or this one, if they haven't run yet). */
  emit(e: ClientEvent) {
    this.queue.push(e);
  }

  /** A message from the game's server: to its listeners now, and to the kits as an event. */
  message(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(data);
    this.emit({ t: 'message', name, data });
  }

  /** Once the world is up. */
  setup(me: Me) {
    this.me = me;
    for (const k of this.kits) k.setup?.(this);
    this.def.setup?.(this);
    this.started = true;
  }

  /** Every frame: the kits in order, then the game's own. */
  frame(dt: number, me: Me) {
    if (!this.started) return;
    this.me = me;
    this.time += dt;
    this.seen = this.queue;
    this.queue = [];
    for (const k of this.kits) k.frame?.(this, dt);
    this.def.frame?.(this, dt);
  }

  dispose() {
    for (const k of this.kits) k.dispose?.();
    this.listeners.clear();
  }
}
