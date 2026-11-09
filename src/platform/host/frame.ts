// An uploaded game's frame (frame.html and its scripts, the site's src/frame.ts: see
// ui/frame-host.ts), served by the game server rather than the site. The frame is a sandboxed,
// opaque origin, so its requests carry no cookie: a host in front of the site that challenges
// browsers (Vercel's DDoS protection sets a cookie once a browser passes) turns every one of the
// frame's scripts away, and the game hangs on its loading screen. The game server has no such
// check, and its builds of the frame and of the platform an uploaded game is checked against are
// one and the same (the image builds both: `npm run build:frame`).
//
//   GET /frame.html         the frame's page, with a content security policy (its own sandbox too)
//   GET /assets/<file>      its scripts, styles, the engine and pictures (hashed names, kept for good)
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface FrameFiles {
  /** The frame's build: `frame.html` and `assets/` (`dist-frame`, or the site's whole `dist`). */
  dir: string;
  /** This server's address as players reach it (`https://play.blockyard.gg`). */
  publicUrl: string;
  /** The site's addresses: the only pages that may show the frame (none: any, in development). */
  sites: string[];
}

/** The first of `dirs` with a frame's build in it, if any. */
export function findFrameDir(dirs: (string | undefined)[]): string | null {
  return dirs.find((d): d is string => !!d && existsSync(join(d, 'frame.html'))) ?? null;
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

/** An asset's name: one file in `assets/`, no folders, nothing hidden. */
const ASSET = /^\/assets\/([\w-][\w.-]*)$/;

/** Files sent compressed (to a browser that takes it): code, styles, the engine. Pictures and models are already. */
const PACKED = new Set(['.js', '.mjs', '.css', '.map', '.json', '.wasm', '.svg', '.gltf', '.txt']);
const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);
/** Each file's compressed copies, made once: a build's files never change while it's served. */
const packs = new Map<string, Promise<Buffer>>();

function pack(file: string, body: Buffer, encoding: 'br' | 'gzip'): Promise<Buffer> {
  const key = `${encoding}\0${file}`;
  let p = packs.get(key);
  if (!p) {
    p = encoding === 'br' ? brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } }) : gzipped(body, { level: 9 });
    packs.set(key, p);
    p.catch(() => packs.delete(key));
  }
  return p;
}

/**
 * Answer a request for the frame or one of its files; false if it's for neither (or there's no
 * frame's build to serve).
 */
export function frameRoute(req: IncomingMessage, res: ServerResponse, path: string, files: FrameFiles | null): boolean {
  if (!files || (path !== '/frame.html' && !path.startsWith('/assets/'))) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain' }).end('GET only');
    return true;
  }
  const name = path === '/frame.html' ? 'frame.html' : ASSET.exec(path)?.[1];
  const file = name && join(files.dir, path === '/frame.html' ? '' : 'assets', name);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return true;
  }
  void send(req, res, files, file, name).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end();
  });
  return true;
}

async function send(req: IncomingMessage, res: ServerResponse, files: FrameFiles, file: string, name: string) {
  const ext = extname(name).toLowerCase();
  const headers: Record<string, string> =
    name === 'frame.html'
      ? { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': framePolicy(files) }
      : // Hashed names never change: kept for good. (Any origin may load them: the frame is `null`.)
        { 'Content-Type': TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' };
  headers['X-Content-Type-Options'] = 'nosniff';
  let body: Buffer = await readFile(file);
  if (PACKED.has(ext)) {
    headers['Vary'] = 'Accept-Encoding';
    const takes = String(req.headers['accept-encoding'] ?? '');
    const encoding = /\bbr\b/.test(takes) ? 'br' : /\bgzip\b/.test(takes) ? 'gzip' : null;
    if (encoding) {
      body = await pack(file, body, encoding);
      headers['Content-Encoding'] = encoding;
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': String(body.length) });
  res.end(req.method === 'HEAD' ? undefined : body);
}

/**
 * The frame's content security policy: it reaches only this server (and the site, and Google's
 * fonts), only the site may frame it, and it's sandboxed even when opened on its own, so an
 * uploaded game never runs as this server's origin (where the sign-in cookie is).
 */
export function framePolicy(files: FrameFiles): string {
  const self = new URL(files.publicUrl).origin;
  const socket = self.replace(/^http/, 'ws');
  const sites = files.sites.join(' ');
  const from = (...more: string[]) => [self, sites, ...more].filter(Boolean).join(' ');
  return [
    'sandbox allow-scripts allow-pointer-lock',
    "default-src 'none'",
    `script-src ${from("'wasm-unsafe-eval'")}`,
    `worker-src ${from('data:', 'blob:')}`,
    `connect-src ${from(socket, 'data:', 'blob:')}`,
    `img-src ${from('data:', 'blob:')}`,
    `media-src ${from('data:', 'blob:')}`,
    `style-src ${from("'unsafe-inline'", 'https://fonts.googleapis.com')}`,
    `font-src ${from('https://fonts.gstatic.com', 'data:')}`,
    "base-uri 'none'",
    "form-action 'none'",
    ...(files.sites.length ? [`frame-ancestors ${sites}`] : []),
  ].join('; ');
}
