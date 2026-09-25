// The game server's production entry: `npm run build:server` bundles it (and the games) into
// dist-server/serve.js, which runs with plain Node (`npm start`), no Vite. Each room's worker
// thread runs this same file.
import { isMainThread, Worker } from 'node:worker_threads';
import { serveRoomWorker } from './platform/host/room-worker';
import { findGame, main } from './server';

if (isMainThread) {
  // A room's thread: a small young generation (a room allocates little, and each spare megabyte
  // is paid per room), and a ceiling, so a runaway room fails alone.
  const resourceLimits = { maxYoungGenerationSizeMb: 8, maxOldGenerationSizeMb: 256 };
  const server = await main(process.argv.slice(2), (workerData) => new Worker(new URL(import.meta.url), { workerData, resourceLimits }));
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  await serveRoomWorker(findGame);
}
