/**
 * The weapon models (GLB, written by `scripts/guns/build.mjs`; see its header for the conventions:
 * blocks as units, the barrel along +z, marker nodes `grip`, `grip2`, `muzzle`, `sight`, `mag`).
 */
export interface GunModel {
  id: string;
  name: string;
  url: string;
}

export const GUNS: GunModel[] = [];
