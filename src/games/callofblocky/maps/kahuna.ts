import { Blueprint } from '@platform';
import { spawnAt, type MapSpec } from './kit';

const FLOOR = 64;
const OX = 512;
const bp = new Blueprint({ x: OX - 50, y: 50, z: -45 }, { x: 101, y: 46, z: 91 });
bp.fill({ x: OX - 44, y: FLOOR, z: -36 }, { x: OX + 44, y: 95, z: 36 }, 'air');
bp.fill({ x: OX - 44, y: FLOOR - 1, z: -36 }, { x: OX + 44, y: FLOOR - 1, z: 36 }, 'gray_concrete');
for (let i = 0; i < 12; i++) bp.fill({ x: OX - 30 + i * 5, y: FLOOR, z: -10 + (i % 3) * 8 }, { x: OX - 28 + i * 5, y: FLOOR + 2, z: -9 + (i % 3) * 8 }, 'orange_concrete');

const s = (x: number, z: number, tx = 0, tz = 0) => spawnAt(OX + x, FLOOR, z, OX + tx, tz);

export const KAHUNA: MapSpec = {
  id: 'kahuna',
  name: 'Big Kahuna Burger',
  blurb: 'The cornerstone of any nutritious breakfast',
  floorY: FLOOR,
  structures: [bp],
  terraform: [],
  bounds: { min: { x: OX - 44, y: FLOOR - 5, z: -36 }, max: { x: OX + 44, y: 95, z: 36 } },
  spawns: [s(-40, -30), s(-40, 30), s(40, -30), s(40, 30), s(0, -32), s(0, 32), s(-20, 0), s(20, 0)],
  teams: [
    [s(-40, -20), s(-40, -10), s(-40, 0), s(-40, 10), s(-40, 20), s(-36, 0)],
    [s(40, -20), s(40, -10), s(40, 0), s(40, 10), s(40, 20), s(36, 0)],
  ],
  bomb: {
    attack: [s(-20, 32), s(-10, 32), s(0, 32), s(10, 32), s(20, 32), s(0, 28)],
    defend: [s(-20, -32), s(-10, -32), s(0, -32), s(10, -32), s(20, -32), s(0, -28)],
    sites: [
      { name: 'A', label: 'the kitchen', at: { x: OX - 15.5, y: FLOOR, z: -14.5 }, radius: 3 },
      { name: 'B', label: 'the pool', at: { x: OX + 16.5, y: FLOOR, z: -14.5 }, radius: 3 },
    ],
  },
  overview: { position: { x: OX, y: FLOOR + 40, z: 60 }, target: { x: OX, y: FLOOR, z: 0 } },
  hotspots: [
    { x: OX, y: FLOOR, z: 0 },
    { x: OX - 20, y: FLOOR, z: -15 },
    { x: OX + 20, y: FLOOR, z: 15 },
  ],
};
