import { Blueprint } from '@platform';

/** Arena floor surface height (players stand at FLOOR + 1). */
export const FLOOR = 70;
/** Inner radius of the fighting pit. */
export const PIT = 21;
/** Angles of the four monster gates (east, south, west, north). */
export const GATES = [0, Math.PI / 2, Math.PI, (Math.PI * 3) / 2];
/** Where monsters appear inside each gate tunnel. */
export const GATE_SPAWN_RADIUS = 27;

const WALL_IN = PIT;
const WALL_OUT = PIT + 2;
const STANDS_OUT = PIT + 10;
const RIM_OUT = PIT + 12;
const TOP = FLOOR + 22;

/** Small deterministic hash for material variation. */
const hash = (x: number, z: number, k = 0) => {
  let h = (x * 374761393 + z * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Inside a gate corridor (5 wide) at this angle band? */
function inGate(x: number, z: number): boolean {
  return (Math.abs(x) <= 2 && Math.abs(z) >= WALL_IN - 1) || (Math.abs(z) <= 2 && Math.abs(x) >= WALL_IN - 1);
}

/**
 * A colosseum: sand pit with stone-brick spokes and a lantern dais, cover pillars, a
 * crenellated inner wall with four gates, tiered stands, and an outer rim with beacons.
 */
export function buildArena(): Blueprint {
  const bp = Blueprint.centered(0, 0, RIM_OUT + 1, FLOOR - 10, TOP);

  bp.columns(0, 0, RIM_OUT + 0.5, (x, z, d, a) => {
    // Foundation and clear sky above everything.
    for (let y = FLOOR - 10; y < FLOOR; y++) bp.set(x, y, z, 'stone');
    for (let y = FLOOR + 1; y <= TOP; y++) bp.set(x, y, z, 'air');

    const gate = inGate(x, z);
    if (d < WALL_IN) {
      // Pit floor: sand with gravel scuffs, stone-brick spokes and an edge ring.
      const spoke = Math.abs(Math.sin(a * 4)) < 0.9 / Math.max(d, 1) && d > 4;
      let floor = hash(x, z) < 0.12 ? 'gravel' : 'sand';
      if (spoke || d > WALL_IN - 1.6) floor = hash(x, z, 1) < 0.2 ? 'mossy_cobblestone' : 'stone_bricks';
      if (d < 4.5) floor = d < 3.2 ? 'stone_bricks' : 'andesite';
      bp.set(x, FLOOR, z, floor);
      // Raised dais with a sea lantern in the middle.
      if (d < 3.2) bp.set(x, FLOOR + 1, z, d < 0.8 ? 'sea_lantern' : 'stone_bricks');
    } else if (d < WALL_OUT) {
      bp.set(x, FLOOR, z, 'stone_bricks');
      for (let y = FLOOR + 1; y <= FLOOR + 7; y++) {
        const v = hash(x, z, y);
        bp.set(x, y, z, v < 0.15 ? 'mossy_cobblestone' : v < 0.22 ? 'cobblestone' : 'stone_bricks');
      }
      // Crenellations with torches, glowstone lamps set into the wall.
      const merlon = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 48) % 2 === 0;
      if (merlon && d > WALL_OUT - 1) {
        bp.set(x, FLOOR + 8, z, 'stone_bricks');
        bp.set(x, FLOOR + 9, z, 'torch');
      }
      if (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0 && d < WALL_IN + 1 && Math.abs(Math.sin(a * 8)) < 0.12) {
        bp.set(x, FLOOR + 4, z, 'glowstone');
      }
    } else if (d < STANDS_OUT) {
      // Tiered seating rising away from the pit.
      const tier = Math.floor((d - WALL_OUT) * 0.9);
      const top = FLOOR + 7 + tier;
      for (let y = FLOOR; y <= top; y++) bp.set(x, y, z, 'stone_bricks');
      bp.set(x, top, z, tier % 2 === 0 ? 'sandstone' : 'stone_bricks');
      // Banners: coloured wool seat cushions in blocks around the ring.
      const sector = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 12);
      if (tier % 2 === 1 && hash(x, z, 5) < 0.5) bp.set(x, top, z, ['red_wool', 'yellow_wool', 'blue_wool'][sector % 3]);
    } else {
      // Outer rim wall with beacon lamps.
      const tier = Math.floor((STANDS_OUT - WALL_OUT) * 0.9);
      const top = FLOOR + 7 + tier + 3;
      for (let y = FLOOR; y <= top; y++) bp.set(x, y, z, hash(x, z, y) < 0.1 ? 'mossy_cobblestone' : 'stone_bricks');
      const slot = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 32);
      if (slot % 2 === 0) bp.set(x, top + 1, z, 'stone_bricks');
      if (slot % 8 === 0) bp.set(x, top + 2, z, 'glowstone');
    }

    // Gate corridors cut through the wall and stands (dead ends at the rim: monster pens).
    if (gate && d >= WALL_IN - 0.5 && d < STANDS_OUT) {
      for (let y = FLOOR + 1; y <= FLOOR + 5; y++) bp.set(x, y, z, 'air');
      bp.set(x, FLOOR, z, 'stone_bricks');
      bp.set(x, FLOOR + 6, z, 'stone_bricks');
      const side = Math.abs(x) <= 2 ? Math.abs(x) : Math.abs(z);
      if (side === 2 && Math.round(d) % 4 === 0) bp.set(x, FLOOR + 5, z, 'glowstone');
    }
  });

  // Gate arches: dark obsidian frames facing the pit.
  for (const a of GATES) {
    const cx = Math.round(Math.cos(a));
    const cz = Math.round(Math.sin(a));
    for (let s = -3; s <= 3; s++) {
      for (let y = FLOOR + 1; y <= FLOOR + 6; y++) {
        const edge = Math.abs(s) === 3 || y === FLOOR + 6;
        if (!edge) continue;
        const r = WALL_IN;
        const x = cx !== 0 ? cx * r : s;
        const z = cz !== 0 ? cz * r : s;
        bp.set(x, y, z, 'obsidian');
      }
    }
  }

  // Cover pillars between the gates, topped with lanterns.
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const px = Math.round(Math.cos(a) * 13);
    const pz = Math.round(Math.sin(a) * 13);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (Math.abs(dx) + Math.abs(dz) === 2) continue;
        for (let y = FLOOR + 1; y <= FLOOR + 4; y++) bp.set(px + dx, y, pz + dz, y === FLOOR + 1 ? 'mossy_cobblestone' : 'stone_bricks');
      }
    bp.set(px, FLOOR + 5, pz, 'glowstone');
  }
  return bp;
}
