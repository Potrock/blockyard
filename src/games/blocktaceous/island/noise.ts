/**
 * Seeded gradient noise for shaping the island. It is the island's own (not the engine's), so the
 * map is the same wherever it is built: the server, every screen, a test.
 */
export class Noise {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let a = seed >>> 0;
    for (let i = 255; i > 0; i--) {
      // mulberry32: a small generator that is the same everywhere.
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const j = ((t ^ (t >>> 14)) >>> 0) % (i + 1);
      const s = p[i];
      p[i] = p[j];
      p[j] = s;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Smooth noise in about -1..1, one feature per unit. */
  at(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const p = this.perm;
    const X = xi & 255;
    const Y = yi & 255;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const x1 = grad(aa, xf, yf) + u * (grad(ba, xf - 1, yf) - grad(aa, xf, yf));
    const x2 = grad(ab, xf, yf - 1) + u * (grad(bb, xf - 1, yf - 1) - grad(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 1.5;
  }

  /** Several octaves of it, each half the size and strength of the last, still about -1..1. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.at(x + o * 17.13, y - o * 9.71);
      norm += amp;
      amp *= 0.5;
      x *= 2;
      y *= 2;
    }
    return sum / norm;
  }

  /** Ridges: 1 along the noise's zero lines, falling away either side (0..1). */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const r = 1 - Math.min(1, Math.abs(this.at(x + o * 31.7, y + o * 13.3)) * 1.6);
      sum += amp * r * r;
      norm += amp;
      amp *= 0.5;
      x *= 2.1;
      y *= 2.1;
    }
    return sum / norm;
  }
}

function grad(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return x - y;
    case 2: return -x + y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 at `a`, 1 at `b`, smooth between (works falling too, `a > b`). */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
