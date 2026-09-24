import { readFileSync } from 'node:fs';
import { games } from '../../src/games';
import { Headless, type HeadlessOptions } from '../../src/platform/host/headless';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * Start a registered game headless, as if the player had just clicked Play. `Math.random` is
 * seeded too (some games use it rather than `game.rng`), so a run with the same seed and the same
 * pilot plays out identically: a failure reproduces.
 */
export function launch(id: string, o: Partial<HeadlessOptions> = {}): Headless {
  const def = games.find((g) => g.id === id);
  if (!def) throw new Error(`no game "${id}"`);
  Math.random = mulberry32((o.seed ?? 1) ^ 0x5bd1e995);
  const h = new Headless(def, { wasm, ...o });
  h.start();
  return h;
}

export { games };

/** The title of the last `hud.screen` the game opened (victory, defeat), if any. */
export function lastScreen(h: Headless): string | undefined {
  const c = h.find('hud', 'screen').at(-1);
  return (c?.args[1] as { title?: string } | undefined)?.title;
}

export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
