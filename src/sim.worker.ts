// The game host worker: runs the selected game's simulation off the main thread.
import { devGames, games } from './games';
import { serveWorker } from './platform/host/worker';

serveWorker(async (id) => [...games, ...(await devGames())].find((g) => g.id === id));
