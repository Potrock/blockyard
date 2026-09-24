import type { BlockDef } from '../world/registry';
import { DEFAULT_TINT } from '../world/registry';

const SIZE = 64;

function faceCanvas(albedo: Uint8Array, layer: number, tint: [number, number, number] | null, shade: number, tintMask: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  const src = albedo.subarray(layer * 1024, layer * 1024 + 1024);
  for (let i = 0; i < 256; i++) {
    let r = src[i * 4];
    let g = src[i * 4 + 1];
    let b = src[i * 4 + 2];
    let a = src[i * 4 + 3];
    if (tint) {
      // Opaque textures use alpha as the tint mask; cutout textures are tinted everywhere.
      const amount = tintMask ? 1 - a / 255 : 1;
      r = r * (1 - amount + amount * tint[0]);
      g = g * (1 - amount + amount * tint[1]);
      b = b * (1 - amount + amount * tint[2]);
      if (tintMask) a = 255;
    }
    img.data[i * 4] = r * shade;
    img.data[i * 4 + 1] = g * shade;
    img.data[i * 4 + 2] = b * shade;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Isometric icon of a block, drawn from its generated textures. Returns a data URL. */
export function blockIcon(def: BlockDef, albedo: Uint8Array): string {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const tint = def.tint ? DEFAULT_TINT : null;
  const opaqueMask = def.layer === 0;
  if (def.shape === 'cross') {
    const f = faceCanvas(albedo, def.tex[0], tint, 1, false);
    ctx.drawImage(f, 8, 8, 48, 48);
    return c.toDataURL();
  }
  const top = faceCanvas(albedo, def.tex[2], tint, 1.0, opaqueMask);
  const left = faceCanvas(albedo, def.tex[4], tint, 0.78, opaqueMask);
  const right = faceCanvas(albedo, def.tex[0], tint, 0.6, opaqueMask);
  const k = 1 / 16;
  // Top rhombus: (4,18) -> (32,4) -> (60,18) -> (32,32)
  ctx.setTransform(28 * k, -14 * k, 28 * k, 14 * k, 4, 18);
  ctx.drawImage(top, 0, 0);
  // Left face: (4,18) -> (32,32) down to (32,60), (4,46)
  ctx.setTransform(28 * k, 14 * k, 0, 28 * k, 4, 18);
  ctx.drawImage(left, 0, 0);
  // Right face: (32,32) -> (60,18) down to (60,46), (32,60)
  ctx.setTransform(28 * k, -14 * k, 0, 28 * k, 32, 32);
  ctx.drawImage(right, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c.toDataURL();
}
