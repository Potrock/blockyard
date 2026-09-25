import pistol from './pistol.glb?url';
import smg from './smg.glb?url';
import rifle from './rifle.glb?url';
import shotgun from './shotgun.glb?url';
import sniper from './sniper.glb?url';
import katana from './katana.glb?url';

/**
 * The weapon models (GLB, written by `scripts/guns/build.mjs`; see its header for the conventions:
 * blocks as units, the barrel along +z, marker nodes `grip`, `grip2`, `muzzle`, `sight`, `mag`).
 */
export interface GunModel {
  id: string;
  name: string;
  url: string;
}

export const GUNS: GunModel[] = [
  { id: 'pistol', name: 'Lucky 45', url: pistol },
  { id: 'smg', name: 'Mac-10', url: smg },
  { id: 'rifle', name: 'Big Kahuna', url: rifle },
  { id: 'shotgun', name: 'Pump Shotgun', url: shotgun },
  { id: 'sniper', name: 'Sniper', url: sniper },
  { id: 'katana', name: 'Katana', url: katana },
];
