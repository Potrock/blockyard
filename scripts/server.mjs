#!/usr/bin/env node
// Runs the game server (src/server.ts) in Node. Vite's SSR loader compiles the TypeScript and
// resolves @platform / @engine the same way the dev server does.
//
//   npm run server -- sandbox --port 8787
import { createServer } from 'vite';

const vite = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { main } = await vite.ssrLoadModule('/src/server.ts');
const server = await main(process.argv.slice(2));
const stop = async () => {
  await server.close();
  await vite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
