import * as THREE from 'three';
import type { CosmeticModel } from '../api/types';
import { Palette, Voxels, bake, quadMesh } from '../character/voxels';

/** A cosmetic's look, built once: its voxels as one geometry, coloured from a small atlas. */
export interface CosmeticLook {
  geometry: THREE.BufferGeometry;
  albedo: THREE.Texture;
  /** Where it glows (its red channel: the albedo's colour, lit of itself). */
  emissive: THREE.Texture;
}

/** Voxels a texel, each way: about the size of the voxels of the character wearing it. */
const GRID = 4;
/** How far a box's edges are rounded when it doesn't say (texels): a voxel's bevel. */
const BEVEL = 0.3;

/**
 * A cosmetic's model (`CosmeticModel`: coloured boxes in texels) as a mesh's geometry and
 * textures, made of micro-voxels as the platform's characters are (`character/voxels.ts`): each
 * box filled with voxels a quarter of a texel across (its edges rounded by its `round`), later
 * boxes over earlier ones; the visible faces baked onto a small atlas, shaded a little voxel by
 * voxel and darkened in the corners, so what's worn looks made of what its wearer is. It draws
 * with the entities' shader, lit like the figure wearing it.
 */
export function cosmeticLook(model: CosmeticModel): CosmeticLook {
  const vox = new Voxels();
  const palette = new Palette();
  vox.part('model');
  for (const b of model.boxes) {
    const name = `${b.color}${b.glow ? '|glow' : ''}`;
    if (!palette.colours.has(name)) palette.add(name, new THREE.Color(b.color).getHex(), { rough: 0.8, glow: b.glow ? 1 : 0, vary: b.glow ? 0 : 0.04 });
    const lo = b.from.map((v, a) => Math.min(v, b.to[a]));
    const hi = b.from.map((v, a) => Math.max(v, b.to[a]));
    // At least a voxel thick, on the grid.
    const c0 = lo.map((v) => Math.round(v * GRID));
    const c1 = hi.map((v, a) => Math.max(c0[a] + 1, Math.round(v * GRID)));
    const r = lo.map((_, a) => Math.min(b.round ?? BEVEL, (c1[a] - c0[a]) / GRID / 2));
    for (let k = c0[2]; k < c1[2]; k++)
      for (let j = c0[1]; j < c1[1]; j++)
        for (let i = c0[0]; i < c1[0]; i++) {
          // Inside the box with its edges rounded: within the radius of its inner box.
          let d2 = 0;
          for (const [a, cell] of [i, j, k].entries()) {
            if (r[a] * GRID < 1) continue;
            const p = (cell + 0.5) / GRID;
            const q = Math.max(c0[a] / GRID + r[a] - p, 0, p - (c1[a] / GRID - r[a]));
            d2 += (q / r[a]) ** 2;
          }
          if (d2 <= 1.0001) vox.set('model', i, j, k, name);
        }
  }
  const A = bake(vox, palette);
  const { position, normal, uv, index } = quadMesh(A.quads, 1 / GRID / 16);
  const n = A.quads.length;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(n * 4 < 65536 ? new Uint16Array(index) : index, 1));
  geometry.computeBoundingSphere();
  // Where it glows: the atlas's glowing texels, as a mask.
  const mask = new Uint8Array(A.glow.length);
  for (let i = 0; i < mask.length; i += 4) if (A.glow[i] || A.glow[i + 1] || A.glow[i + 2]) mask[i] = 255;
  const texture = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, A.width, A.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    // (Crisp voxels up close; the mask is read texel for texel.)
    t.magFilter = THREE.NearestFilter;
    t.minFilter = srgb ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
    t.generateMipmaps = srgb;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.flipY = false;
    t.needsUpdate = true;
    return t;
  };
  return { geometry, albedo: texture(A.albedo, true), emissive: texture(mask, false) };
}
