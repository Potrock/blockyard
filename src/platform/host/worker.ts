import type { GameDefinition } from '../api/types';
import type { ClientCommand, HostInit } from '../net/protocol';
import { GameHost } from './game';
import type { WorkerReply } from './link';

/**
 * Serve a game from this worker: the page's `HostInit` first, then its commands; batches go
 * back as they're made. `find` looks the game up by id (the app knows its games; the platform
 * doesn't). A game's error is reported to the page and the host carries on with the next command.
 */
export function serveWorker(find: (id: string) => GameDefinition | undefined | Promise<GameDefinition | undefined>) {
  const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: WorkerReply): void };
  let host: GameHost | null = null;
  // Commands that arrive while the game module loads wait their turn.
  let queue: Promise<void> = Promise.resolve();
  const report = (err: unknown) => scope.postMessage({ error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });

  scope.onmessage = (e: MessageEvent<HostInit | ClientCommand>) => {
    const m = e.data;
    queue = queue.then(async () => {
      try {
        if (m.t === 'init') {
          const def = await find(m.game);
          if (!def) throw new Error(`no game "${m.game}"`);
          host = new GameHost(def, { engine: m.module, seed: m.seed, save: m.save, cheats: m.cheats, radius: m.radius, dayLength: m.dayLength });
          return;
        }
        const b = host?.handle(m);
        if (b) scope.postMessage(b);
      } catch (err) {
        report(err);
      }
    });
  };
}
