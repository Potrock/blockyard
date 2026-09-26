import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@platform\/art$/, replacement: r('./src/platform/art/index.ts') },
      { find: /^@platform\/kits$/, replacement: r('./src/platform/kits/index.ts') },
      { find: /^@platform\/client$/, replacement: r('./src/platform/api/client.ts') },
      { find: /^@platform$/, replacement: r('./src/platform/index.ts') },
      { find: /^@engine\//, replacement: r('./engine/pkg/') },
    ],
  },
  server: { port: 5173, strictPort: false },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
