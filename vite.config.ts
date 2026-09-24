import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@platform': r('./src/platform/index.ts'),
      '@engine': r('./engine/pkg'),
    },
  },
  server: { port: 5173, strictPort: false },
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
