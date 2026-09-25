import { Blueprint, type Vec3 } from '@platform';

/**
 * Jackrabbit Lane: the Call of Blocky map (placeholder until the real one is built).
 *
 * Contract the rest of the game relies on:
 * - `MAP.floorY`: the y players stand at on the street (the top of the ground blocks is `floorY`).
 * - `MAP.bounds`: the playable box (bots scan it for their walking grid; outside it is out of bounds).
 * - `MAP.spawns`: where fighters appear (feet position, `yaw` 0 looks toward -z).
 * - `MAP.structures` / `MAP.terraform` / `MAP.seed` / `MAP.time` go straight into the game's `world`.
 * - `MAP.overview`: a camera for the home page.
 */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface MapSpec {
  name: string;
  seed: number;
  time: number;
  floorY: number;
  structures: Blueprint[];
  terraform: { x: number; z: number; radius: number; blend: number; height: number }[];
  bounds: { min: Vec3; max: Vec3 };
  spawns: SpawnPoint[];
  overview: { position: Vec3; target: Vec3 };
  /** Places worth fighting over (bots drift toward them). */
  hotspots: Vec3[];
}

const FLOOR = 64;

function placeholder(): Blueprint {
  const bp = new Blueprint({ x: -40, y: FLOOR - 4, z: -32 }, { x: 81, y: 12, z: 65 });
  bp.fill({ x: -40, y: FLOOR - 4, z: -32 }, { x: 40, y: FLOOR - 1, z: 32 }, 'gray_concrete');
  bp.fill({ x: -40, y: FLOOR, z: -32 }, { x: 40, y: FLOOR + 7, z: 32 }, 'air');
  for (const [x, z] of [[-10, -8], [10, 8], [0, 0]]) bp.fill({ x: x - 2, y: FLOOR, z: z - 2 }, { x: x + 2, y: FLOOR + 2, z: z + 2 }, 'yellow_concrete');
  return bp;
}

export const MAP: MapSpec = {
  name: 'Jackrabbit Lane',
  seed: 1,
  time: 0.62,
  floorY: FLOOR,
  structures: [placeholder()],
  terraform: [{ x: 0, z: 0, radius: 48, blend: 24, height: FLOOR - 0.5 }],
  bounds: { min: { x: -40, y: FLOOR - 6, z: -32 }, max: { x: 40, y: FLOOR + 16, z: 32 } },
  spawns: [
    { x: -30, y: FLOOR, z: -20, yaw: -Math.PI * 0.75 },
    { x: 30, y: FLOOR, z: 20, yaw: Math.PI * 0.25 },
    { x: -30, y: FLOOR, z: 20, yaw: -Math.PI * 0.25 },
    { x: 30, y: FLOOR, z: -20, yaw: Math.PI * 0.75 },
  ],
  overview: { position: { x: 0, y: FLOOR + 40, z: 50 }, target: { x: 0, y: FLOOR, z: 0 } },
  hotspots: [{ x: 0, y: FLOOR, z: 0 }],
};
