/**
 * The Arena's art: procedural pixel-art mob skins, item sprites and the pike model, painted
 * into the game's own 256x256 atlas (moved here from the engine's built-in entity atlas).
 *
 * Atlas layout (unused texels transparent):
 * - Skins (64x64 regions): (0,0) zombie, (64,0) brute, (128,0) warden (with its crown),
 *   (0,64) skeleton, (64,64) spider.
 * - Items: 16x16 sprites at y = 128, in the cells they have in the built-in atlas.
 * - (0,160): the pike, a held 3D model; (0,208): the battle axe, likewise.
 */
import type { HeldModelSpec } from '@platform';
import { ATLAS, Canvas, type Part } from './canvas';
import { ITEM_X, ITEM_Y, items } from './items';
import { brute, BRUTE, skeleton, SKELETON, spider, SPIDER, warden, WARDEN, zombie, ZOMBIE } from './mobs';
import { pike, PIKE, PIKE_BUTT, PIKE_COLLAR, PIKE_HEAD, PIKE_HEAD2, PIKE_SHAFT } from './pike';
import { axe, AXE } from './axe';

export { AXE_MODEL } from './axe';

export const ARENA_ATLAS = 'arena';

/** The Arena's texture atlas (256x256): mob skins, item sprites and the pike model. */
export function paintArenaAtlas(): { width: number; height: number; albedo: Uint8Array; emissive: Uint8Array } {
  const cv = new Canvas();
  zombie(cv, ZOMBIE[0], ZOMBIE[1]);
  brute(cv, BRUTE[0], BRUTE[1]);
  warden(cv, WARDEN[0], WARDEN[1]);
  skeleton(cv, SKELETON[0], SKELETON[1]);
  spider(cv, SPIDER[0], SPIDER[1]);
  pike(cv, PIKE[0], PIKE[1]);
  axe(cv, AXE[0], AXE[1]);
  items(cv, 0, ITEM_Y);
  const { albedo, emissive } = cv.finish();
  return { width: ATLAS, height: ATLAS, albedo, emissive };
}

/** Origins of the mob skins in the Arena atlas. */
export const Skin = {
  zombie: ZOMBIE,
  brute: BRUTE,
  warden: WARDEN,
  skeleton: SKELETON,
  spider: SPIDER,
} as const satisfies Record<string, readonly [number, number]>;

const cell = (x: number) => ({ atlas: ARENA_ATLAS, x, y: ITEM_Y });

/** Item sprites in the Arena atlas. */
export const Sprite = {
  battle_axe: cell(ITEM_X.battle_axe),
  arrow_bundle: cell(ITEM_X.arrow_bundle),
  golden_trophy: cell(ITEM_X.golden_trophy),
  soul_fireball: cell(ITEM_X.soul_fireball),
  pike: cell(ITEM_X.pike),
} satisfies Record<string, { atlas: string; x: number; y: number }>;

/** Atlas UV of a pike box (its region is at `PIKE`). */
const uv = (p: Part): [number, number] => [PIKE[0] + p.u, PIKE[1] + p.v];

/** The pike as a held 3D model: ash shaft with leather hand wraps, iron butt and collar, leaf-shaped head. */
export const PIKE_MODEL: HeldModelSpec = {
  atlas: ARENA_ATLAS,
  parts: [
    { size: [3, 3, 2], uv: uv(PIKE_BUTT), offset: [-1.5, -1.5, -2] },
    { size: [2, 2, 30], uv: uv(PIKE_SHAFT), offset: [-1, -1, 0] },
    { size: [3, 3, 3], uv: uv(PIKE_COLLAR), offset: [-1.5, -1.5, 29] },
    { size: [0, 7, 14], uv: uv(PIKE_HEAD), offset: [0, -3.5, 32] },
    { size: [7, 0, 14], uv: uv(PIKE_HEAD2), offset: [-3.5, 0, 32] },
  ],
  grip: [0, 0, 5],
  grip2: [0, 0, 19],
};
