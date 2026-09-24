/**
 * The pike: a held 3D model (`PIKE_*` boxes; the head is a zero-width blade whose two broad
 * faces are cut out to a leaf shape) and its hotbar icon. Ported from the engine's
 * `entitytex.rs`.
 */
import { type Canvas, clamp, paintBox, part, px, type Px, type S, SpriteCanvas, remEuclid, within } from '@platform/art';
import { iron, IRON, LEATHER, pLeather } from './shared';

/**
 * The pike model (region `PIKE`): a 2x2x30 shaft, iron butt cap and collar, and a flat
 * leaf-shaped head, all along z. Part-space z = 0 is the tip end.
 */
export const PIKE = [0, 160] as const;
export const PIKE_SHAFT = part(0, 0, 2, 2, 30);
export const PIKE_HEAD = part(88, 0, 0, 7, 14);
/** The same blade lying flat (crossed with the upright one), zero height. */
export const PIKE_HEAD2 = part(88, 24, 7, 0, 14);
export const PIKE_COLLAR = part(112, 0, 3, 3, 3);
export const PIKE_BUTT = part(128, 0, 3, 3, 2);

const PIKE_WOOD = [0x2a1a0c, 0x3d2714, 0x52361d, 0x684727, 0x7f5932, 0x956b3d, 0xab7f4b];
const BLADE = [0x2a2e33, 0x474d55, 0x6a717a, 0x8f969e, 0xb2b8bf, 0xd3d8dd, 0xf0f3f5];

export function pike(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, PIKE_SHAFT, pikeShaft);
  paintBox(cv, ox, oy, PIKE_HEAD, pikeHead);
  paintBox(cv, ox, oy, PIKE_HEAD2, pikeHead);
  paintBox(cv, ox, oy, PIKE_COLLAR, (s) => iron(s, 171, 3.6).h(0.4));
  paintBox(cv, ox, oy, PIKE_BUTT, (s) => iron(s, 173, 2.4).h(0.4));
}

/** Ash shaft with long grain, and leather wraps where the hands go. */
function pikeShaft(s: S): Px {
  if (s.f === 'front' || s.f === 'back') {
    return px(PIKE_WOOD, 2.2 + 0.8 * (s.rnd(161) - 0.5));
  }
  // Hands at model z 5 (rear) and 19 (front): part z 25 and 11.
  const wrap = (c: number) => Math.abs(s.z - c) < 2.6;
  if (wrap(25.0) || wrap(11.0)) {
    const stripe = remEuclid(Math.trunc(s.z + s.y * 0.7), 2) === 0;
    return pLeather(s, 163, stripe ? 3.2 : 2.2).h(0.8);
  }
  const grain = s.n(0.7, 0.7, 6.0, 165);
  return px(PIKE_WOOD, 3.6 + 2.2 * (grain - 0.5) + 0.5 * (s.rnd(166) - 0.5));
}

/** A leaf-shaped blade: bright edges, a raised central ridge, cut out around the leaf. */
function pikeHead(s: S): Px {
  const t = clamp(s.z / s.d, 0.0, 1.0); // 0 at the tip, 1 at the socket
  // Across the blade: y on the upright blade, x on the flat one.
  const [across, width] = s.w === 0 ? [s.y, s.h] : [s.x, s.w];
  const half = width * 0.5;
  const hw = half * Math.max(Math.sin(Math.PI * t ** 0.8), 0.0) ** 0.7 + (t > 0.8 ? 0.6 : 0.0);
  const u = Math.abs(across - half);
  const p = px(BLADE, 3.0);
  if (u > hw) {
    return p.clear();
  }
  if (u < 0.7) {
    return px(BLADE, 5.0).h(0.8); // ridge
  }
  if (hw - u < 0.9) {
    return px(BLADE, 5.6); // honed edge
  }
  return px(BLADE, 3.2 + 0.6 * (s.rnd(167) - 0.5) + (1.0 - u / Math.max(hw, 0.1)) * 0.8);
}

/** Hotbar icon: the pike on the tool diagonal, head at the top right. */
export function pikeIcon(): SpriteCanvas {
  const s = new SpriteCanvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const a = x - y; // along, toward the top right
      const u = Math.abs(x + y - 15.5); // across
      if (a >= 5) {
        const t = (13.5 - a) / 8.5; // 0 at the tip
        const hw = 2.6 * Math.max(Math.sin(Math.PI * clamp(t, 0.0, 1.0) ** 0.8), 0.0) ** 0.7;
        if (t >= 0.0 && u <= hw + 0.2) {
          const c = u < 0.6 ? BLADE[5] : u > hw - 0.8 ? BLADE[6] : BLADE[3];
          s.put(x, y, c, BLADE[0]);
        }
      } else if (u <= 0.6 && a >= -14) {
        const c =
          a > 3 || a < -12
            ? IRON[4]
            : within(a, -10, -8) || within(a, -3, -1)
              ? LEATHER[4]
              : x + y === 15
                ? PIKE_WOOD[5]
                : PIKE_WOOD[3];
        s.put(x, y, c, PIKE_WOOD[0]);
      }
    }
  }
  s.outline();
  return s;
}
