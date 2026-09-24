// The game server's production entry: `npm run build:server` bundles it (and the games) into
// dist-server/serve.js, which runs with plain Node (`npm start`), no Vite.
import { main } from './server';

const server = await main(process.argv.slice(2));
const stop = async () => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
