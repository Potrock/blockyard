/**
 * The battle axe as a held 3D model: a wooden haft wrapped where the hand goes, an iron socket
 * and butt cap, and two flared bits (1 px plates whose faces are cut out to the blade shape,
 * like the pike's head). Part-space z = 0 is the top end of each box.
 */
import { type Canvas, clamp, paintBox, part, px, type Px, type S } from '@platform/art';
import { iron, pLeather } from './shared';
import type { HeldModelSpec } from '@platform';

export const AXE = [0, 208] as const;
export const AXE_HAFT = part(0, 0, 2, 2, 21);
export const AXE_SOCKET = part(48, 0, 3, 3, 5);
export const AXE_BUTT = part(48, 10, 3, 3, 1);
/** One bit: 8 out from the socket (x), 1 thick (y), 11 tall (z). */
export const AXE_BIT = part(0, 24, 8, 1, 11);
export const AXE_BIT2 = part(40, 24, 8, 1, 11);

const WOOD = [0x2a1a0c, 0x3d2714, 0x52361d, 0x684727, 0x7f5932, 0x956b3d];
const STEEL = [0x1f2226, 0x535a62, 0x7b828a, 0xa3a9b0, 0xcdd2d7, 0xf4f6f8];

/** Inside the blade outline? `u` = distance out from the socket, `t` = height from the bit's middle. */
function inBit(u: number, t: number): boolean {
  const hw = Math.min(5.6, 1.3 + 0.55 * u); // flaring out from a narrow neck
  const edge = 6.6 + 1.4 * Math.sqrt(Math.max(0, 1 - (t / 5.6) ** 2)); // a convex cutting edge
  return Math.abs(t) <= hw && u <= edge;
}

/** `outward`: +1 if part-space x grows away from the socket (the +x bit), -1 otherwise. */
function bit(outward: 1 | -1) {
  return (s: S): Px => {
    const u = outward > 0 ? s.x : s.w - s.x;
    const t = s.z - s.d / 2;
    if (!inBit(u, t)) return px(STEEL, 3).clear();
    const edge = 6.6 + 1.4 * Math.sqrt(Math.max(0, 1 - (t / 5.6) ** 2));
    if (edge - u < 1.3) return px(STEEL, 5.2); // honed edge
    if (u < 1.2) return px(STEEL, 1.4).h(-0.4); // the neck, in shadow
    // A bevel line parallel to the edge, and a little hammered texture.
    const bevel = edge - u < 2.3;
    return px(STEEL, (bevel ? 3.9 : 3.0) + 0.5 * (s.rnd(801) - 0.5) + (s.f === 'top' ? 0.3 : 0)).h(bevel ? 0.4 : 0);
  };
}

/** Haft: long grain, with a leather wrap where the fist holds it (model z -1..4). */
function haft(s: S): Px {
  const modelZ = 19 - s.z;
  if (modelZ > -1.5 && modelZ < 4.5) {
    const stripe = ((Math.trunc(s.z + s.y * 0.7) % 2) + 2) % 2 === 0;
    return pLeather(s, 803, stripe ? 3.4 : 2.2).h(0.8);
  }
  const grain = s.n(0.7, 0.7, 5.0, 805);
  return px(WOOD, clamp(3.2 + 2.0 * (grain - 0.5) + 0.4 * (s.rnd(806) - 0.5), 0, 5));
}

export function axe(cv: Canvas, ox: number, oy: number) {
  paintBox(cv, ox, oy, AXE_HAFT, haft);
  paintBox(cv, ox, oy, AXE_SOCKET, (s) => iron(s, 807, 3.4).h(0.5));
  paintBox(cv, ox, oy, AXE_BUTT, (s) => iron(s, 809, 2.6).h(0.4));
  paintBox(cv, ox, oy, AXE_BIT, bit(1));
  paintBox(cv, ox, oy, AXE_BIT2, bit(-1));
}

const uv = (p: { u: number; v: number }): [number, number] => [AXE[0] + p.u, AXE[1] + p.v];

/** The battle axe, held low on the haft (`hold: { style: 'axe', model: AXE_MODEL }`). */
export const AXE_MODEL: HeldModelSpec = {
  atlas: 'arena',
  parts: [
    { size: [3, 3, 1], uv: uv(AXE_BUTT), offset: [-1.5, -1.5, -3] },
    { size: [2, 2, 21], uv: uv(AXE_HAFT), offset: [-1, -1, -2] },
    { size: [3, 3, 5], uv: uv(AXE_SOCKET), offset: [-1.5, -1.5, 14] },
    { size: [8, 1, 11], uv: uv(AXE_BIT), offset: [1.5, -0.5, 11] },
    { size: [8, 1, 11], uv: uv(AXE_BIT2), offset: [-9.5, -0.5, 11] },
  ],
  grip: [0, 0, 1.5],
};
