import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** Each output chunk's modules (the page's and its workers'), for `scripts/check-bundle.mjs`. */
const chunks: { file: string; worker: boolean; modules: { id: string; length: number }[] }[] = [];

/**
 * With `BUNDLE_REPORT` set, a client build writes which modules each of its chunks carries (and
 * how much of each is left after tree-shaking) to `<outDir>/.bundle-report.json`: the bundle
 * check reads it (and deletes it). `worker`: the plugin as the workers' builds run it.
 */
function bundleReport(worker: boolean): Plugin | null {
  if (!process.env.BUNDLE_REPORT) return null;
  return {
    name: 'bundle-report',
    apply: (_, env) => !env.isSsrBuild,
    buildStart() {
      if (!worker) chunks.length = 0;
    },
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        const modules = Object.entries(out.modules).map(([id, m]) => ({ id, length: m.renderedLength }));
        chunks.push({ file: out.fileName, worker, modules });
      }
    },
    writeBundle(options) {
      if (worker) return;
      writeFileSync(join(options.dir ?? 'dist', '.bundle-report.json'), JSON.stringify({ chunks }, null, 1));
    },
  };
}

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
  plugins: [bundleReport(false)],
  server: { port: 5173, strictPort: false },
  worker: { format: 'es', plugins: () => [bundleReport(true)] },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
