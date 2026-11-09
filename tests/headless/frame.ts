import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SourceMapGenerator } from 'source-map-js';
import { ErrorLog } from '../../src/platform/host/errors';
import { findFrameDir } from '../../src/platform/host/frame';
import { serve } from '../../src/platform/host/server';
import { check, games } from './_harness';

const SITE = 'https://blockyard.example';
const PUBLIC = 'https://players.example';

/**
 * Uploaded games' frame from the game server (host/frame.ts): its page with a content security
 * policy that sandboxes it even on its own and lets only the site frame it; its files kept for
 * good, for any origin, compressed; nothing outside its build; and its scripts' stacks put back into the
 * source from the maps beside them.
 */
export default async function frame() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-frame-'));
  const build = join(dir, 'dist-frame');
  mkdirSync(join(build, 'assets'), { recursive: true });
  writeFileSync(join(build, 'frame.html'), '<!doctype html><script type="module" crossorigin src="/assets/frame-abc.js"></script>');
  writeFileSync(join(build, 'assets', 'frame-abc.js'), 'export const x = 1;\nthrow new Error("boom");\n');
  writeFileSync(join(build, 'assets', 'voxel_engine_bg-123.wasm'), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  writeFileSync(join(dir, 'secret.txt'), 'not for the frame');
  const map = new SourceMapGenerator({ file: 'frame-abc.js' });
  map.addMapping({ generated: { line: 2, column: 0 }, original: { line: 40, column: 2 }, source: '../../src/frame.ts', name: 'start' });
  writeFileSync(join(build, 'assets', 'frame-abc.js.map'), map.toString());

  check(findFrameDir([undefined, join(dir, 'missing'), build]) === build && findFrameDir([join(dir, 'missing')]) === null, 'the first folder with a frame in it');

  const def = games.find((g) => g.id === 'heart-hunt')!;
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const srv = await serve({ games: [def], port: 0, seed: 1, wasm, sites: [SITE], frame: { dir: build, publicUrl: PUBLIC, sites: [SITE] } });
  const bare = await serve({ games: [def], port: 0, seed: 1, wasm });
  const at = (path: string, init?: RequestInit) => fetch(`http://localhost:${srv.port}${path}`, init);
  try {
    // The page: sandboxed by its own policy, framed only by the site, reaching only here and the site.
    const page = await at('/frame.html');
    const csp = page.headers.get('content-security-policy') ?? '';
    check(page.status === 200 && page.headers.get('content-type')?.startsWith('text/html') && (await page.text()).includes('frame-abc.js'), `the frame's page: ${page.status}`);
    check(/(^|; )sandbox allow-scripts allow-pointer-lock(;|$)/.test(csp), `sandboxed even on its own: ${csp}`);
    check(csp.includes(`frame-ancestors ${SITE}`) && csp.includes(`script-src ${PUBLIC} ${SITE} 'wasm-unsafe-eval'`) && csp.includes(`connect-src ${PUBLIC} ${SITE} wss://players.example`) && csp.includes("default-src 'none'"), `reaches only here and the site, framed by the site: ${csp}`);
    check(page.headers.get('cache-control') === 'no-cache', 'the page is always checked');

    // Its files: kept for good, for any origin (the frame is `null`), with their types.
    const js = await at('/assets/frame-abc.js', { headers: { Origin: 'null' } });
    check(js.status === 200 && js.headers.get('content-type')?.startsWith('text/javascript') && js.headers.get('access-control-allow-origin') === '*' && js.headers.get('cache-control')?.includes('immutable'), `a script: ${js.status} ${js.headers.get('content-type')}`);
    const engine = await at('/assets/voxel_engine_bg-123.wasm');
    check(engine.status === 200 && engine.headers.get('content-type') === 'application/wasm', `the engine, as wasm: ${engine.headers.get('content-type')}`);
    const head = await at('/assets/frame-abc.js', { method: 'HEAD' });
    check(head.status === 200 && (await head.text()) === '', 'HEAD: headers only');

    // Compressed for a browser that takes it (fetch undoes it), as is for one that doesn't.
    for (const encoding of ['br', 'gzip']) {
      const r = await at('/assets/frame-abc.js', { headers: { 'Accept-Encoding': encoding } });
      check(r.headers.get('content-encoding') === encoding && r.headers.get('vary') === 'Accept-Encoding' && (await r.text()).includes('throw new Error("boom")'), `${encoding}: ${r.headers.get('content-encoding')}`);
    }
    const plain = await new Promise<{ encoding: string | undefined; body: string }>((done, fail) =>
      get(`http://localhost:${srv.port}/assets/frame-abc.js`, { headers: { 'Accept-Encoding': 'identity' } }, (r) => {
        let body = '';
        r.on('data', (c: Buffer) => (body += String(c))).on('end', () => done({ encoding: r.headers['content-encoding'], body }));
      }).on('error', fail),
    );
    check(plain.encoding === undefined && plain.body.startsWith('export const x = 1;'), `as is, without: ${plain.encoding}`);

    // Nothing else: no folders, nothing outside the build, no writes.
    for (const path of ['/assets/missing.js', '/assets/..%2Fsecret.txt', '/assets/%2e%2e/secret.txt', '/assets/sub/frame-abc.js', '/assets/.hidden', '/secret.txt', '/assets/']) {
      const r = await at(path);
      check(r.status === 404 && !(await r.text()).includes('not for the frame'), `${path}: not served (${r.status})`);
    }
    check((await at('/frame.html', { method: 'POST' })).status === 405, 'GET only');
    // A server with no frame's build: none served (the rest goes on as before).
    check((await fetch(`http://localhost:${bare.port}/frame.html`)).status === 404 && (await fetch(`http://localhost:${bare.port}/health`)).status === 200, 'no frame without a build');

    // The frame's errors: put back into the source from the map beside its script.
    const log = ErrorLog.open(':memory:', { frame: { dir: build, origin: PUBLIC } });
    const mapped = await log.symbolicate(`Error: boom\n    at start (${PUBLIC}/assets/frame-abc.js:2:1)`);
    const elsewhere = await log.symbolicate(`Error: boom\n    at start (https://elsewhere.example/assets/frame-abc.js:2:1)`);
    log.close();
    check(/src\/frame\.ts:40:3/.test(mapped) && !mapped.includes('frame-abc.js'), `the frame's stack in its source: ${mapped.split('\n')[1]}`);
    check(elsewhere.includes('frame-abc.js:2:1'), `only this server's frame: ${elsewhere.split('\n')[1]}`);
    console.log("  frame: its page sandboxed and framed only by the site; its files for good, for any origin, compressed; nothing else; its stacks in the source");
  } finally {
    await srv.close();
    await bare.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
