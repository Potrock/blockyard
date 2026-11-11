// Development: the animals as entities in the real engine (the dev gallery's room), walking past a
// person for scale. `node engine.mjs <out.png> [ids…]` with a dev server on PORT (5183).
import { createRequire } from 'node:module';
const require = createRequire('/home/user/blockyard/');
const { chromium } = require('playwright');
const [out, ...ids] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1600), height: Number(process.env.H ?? 900) }, deviceScaleFactor: Number(process.env.DSF ?? 1) });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('page:', m.text().slice(0, 300)));
await page.goto(`http://localhost:${process.env.PORT ?? 5183}/?game=gallery`, { waitUntil: 'domcontentloaded' });
// The page reloads whenever anyone edits the source under it, so: keep asking, and press Play again as needed.
const info = () => page.evaluate(() => { try { return window.__game.debugInfo(); } catch { return null; } }).catch(() => null);
for (let i = 0; ; i++) {
  if (i > 200) throw new Error('timed out waiting for the room');
  const d = await info();
  if (d?.ready && d.player) break;
  if (d?.mode === 'title') await page.evaluate(() => { window.__game.debugActive = true; window.__game.debugPlay(); }).catch(() => null);
  await page.waitForTimeout(1500);
}
console.log('playing');
await page.waitForTimeout(1500);
const SIZE = { triceratops: [2.4, 2.9, 2, 7], pteranodon: [1.4, 1.6, 1.5, 12], stegosaurus: [2.4, 3.2, 1.6, 5], brachiosaurus: [4.5, 6.5, 2, 4.5], ankylosaurus: [2.4, 1.8, 1.5, 4.5], mammoth: [2.4, 3.4, 2, 6.5], smilodon: [0.9, 1.2, 2.6, 10.5], sarcosuchus: [2, 1.3, 1.6, 5] };
const gap = Number(process.env.GAP ?? 4);
for (let i = 0; i < 5; i++) {
  const t = Date.now();
  const ok = await page.evaluate(() => window.__game.dev('me ? [me.position, game.entities.all.length] : null')).catch((e) => String(e));
  console.log('dev:', JSON.stringify(ok), Date.now() - t, 'ms');
  if (typeof ok !== 'string') break;
}
const res = await page.evaluate(async ({ ids, SIZE, gap, mode, dist, fast }) => {
  const js = `
    const ids = ${JSON.stringify(ids)}, SIZE = ${JSON.stringify(SIZE)};
    const y = 64.01 > 0 ? me.position.y : 0;
    const base = { x: 0, y, z: 11 - ${dist} };
    const made = [me.position];
    game.entities.clear();
    me.teleport({ x: 0.5, y, z: 11 }, 0, 0);
    let x = -((ids.length - 1) * ${gap}) / 2;
    try { game.entities.define('bt_person', { name: 'Person', model: { rig: 'gltf', parts: [], atlas: '', scale: 1, gltf: { url: 'character:', rig: 'humanoid' } }, hitbox: { width: 0.6, height: 1.8 }, health: 20, speed: 0, invulnerable: true }); } catch (e) { made.push(String(e)); }
    game.entities.spawn('bt_person', { x: x - 2.2, y, z: base.z + 1.5 }, { yaw: 0.3 });
    for (const id of ids) {
      const [w, h, walk, run] = SIZE[id];
      const type = 'bt_' + id;
      const far = ${mode === 'walk' ? 1 : 0};
      try {
        game.entities.define(type, { name: id, model: { rig: 'gltf', parts: [], atlas: '', scale: 1, gltf: { url: '/src/games/blocktaceous/models/' + id + '.glb', clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head' } }, hitbox: { width: w, height: h }, health: 100, speed: walk, invulnerable: true,
          ai: far ? (self) => { const d = self.data; d.t = (d.t ?? 0) + 1; const to = { x: d.home + 40, y: self.position.y, z: self.position.z }; self.setSpeed(d.fast ? run / walk : 1); self.moveTo(to); } : undefined });
      } catch (e) { made.push(String(e)); }
      const e = game.entities.spawn(type, { x, y, z: base.z }, { yaw: ${mode === 'walk' ? 'Math.PI / 2' : '0.5'}, data: { home: x, fast: ${fast} } });
      made.push(type);
      x += ${gap};
    }
    return made;`;
  return await window.__game.dev(js);
}, { ids, SIZE, gap, mode: process.env.MODE ?? 'stand', dist: Number(process.env.DIST ?? 10), fast: process.env.FAST ? 1 : 0 });
console.log(JSON.stringify(res));
await page.waitForTimeout(Number(process.env.WAIT ?? 5000));
await page.evaluate(([yaw, pitch]) => window.__game.debugView(yaw, pitch), [Number(process.env.YAW ?? 0), Number(process.env.PITCH ?? 0)]);
await page.waitForTimeout(800);
await page.evaluate(() => window.__game.debugToggle('F1'));
await page.waitForTimeout(600);
await page.screenshot({ path: out });
if (process.env.SECOND) { await page.waitForTimeout(700); await page.screenshot({ path: process.env.SECOND }); }
await browser.close();
