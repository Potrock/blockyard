// A room's worker thread for the development server (scripts/server.mjs) and tests: Vite's SSR
// loader compiles the game here too, so the thread has its own copy of the game's modules.
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { findGame } = await vite.ssrLoadModule('/src/server.ts');
const { serveRoomWorker } = await vite.ssrLoadModule('/src/platform/host/room-worker.ts');
await serveRoomWorker(findGame);
await vite.close();
