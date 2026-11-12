import { math, type VehicleControls, type VehicleDefinition, type VehicleWorld } from '@platform';
import { SPECIES, SPECIES_IDS, type Species } from '../species';
import { TUNING, type Tuning } from './tuning';

/**
 * Mounts, as vehicles: a rider's own screen predicts them, so a tame answers the moment its rider
 * presses a key however far away the server is. `bt_mount` walks, gallops, jumps and swims;
 * `bt_wing` does the same on the ground and flies once it has taken off. Both are pure: they read
 * the state, the controls and the world's blocks, and change only the state. What an attack hits
 * is the server's business (creatures/riding.ts reads `atk`).
 *
 * Headings here are the models' own: 0 faces +z, and forward is (sin h, cos h).
 */
export interface MountState {
  /** Which species (its place in `SPECIES_IDS`). */
  k: number;
  x: number;
  y: number;
  z: number;
  /** Where it faces. */
  yaw: number;
  /** Speed along its heading (negative backing up), and its vertical speed. */
  v: number;
  vy: number;
  ground: boolean;
  swim: boolean;
  /** 0..1; galloping, jumping and climbing spend it, and a winded mount walks until it has some back. */
  stamina: number;
  winded: boolean;
  /** The rider's camera: its heading about the mount, and how far it's tipped over it. */
  cam: number;
  tip: number;
  /** Attacks made so far (the server strikes when it changes), and seconds until the next may start. */
  atk: number;
  cd: number;
  /** Flyers: in the air, nose up or down, banked. */
  fly: boolean;
  pitch: number;
  roll: number;
}

export function freshMount(k: number, at: { x: number; y: number; z: number }, yaw: number): MountState {
  return { k, x: at.x, y: at.y, z: at.z, yaw, v: 0, vy: 0, ground: true, swim: false, stamina: 1, winded: false, cam: yaw, tip: 0.3, atk: 0, cd: 0.5, fly: false, pitch: 0, roll: 0 };
}

const GRAVITY = 28;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** The shortest way round from one heading to another. */
const turnTo = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from));

/**
 * Whether a body stops at a block. The world a vehicle sees only names its blocks, so plants and
 * the like are told by name; leaves count as open too, so a big animal pushes through a canopy
 * rather than walking over the treetops. Answers are remembered by block id (the names never change).
 */
const OPEN = /^(air|water|lava|weed|torch|wall_torch|short_grass|fern|dead_bush|poppy|dandelion|cornflower|snowy_grass)$|leaves|mushroom|flower|bush|sapling|plant|reed|vine|berry|sprout|tuft|frond/;
const solidById = new Map<number, boolean>();
function solid(world: VehicleWorld, x: number, y: number, z: number): boolean {
  const id = world.getBlock(x, y, z);
  if (id < 0) return true;
  let s = solidById.get(id);
  if (s === undefined) solidById.set(id, (s = !OPEN.test(world.blockName(id))));
  return s;
}
const wet = (world: VehicleWorld, x: number, y: number, z: number): boolean => world.blockName(world.getBlock(x, y, z)) === 'water';

/** The top of the first solid block at or under `from` in a column, looking `down` blocks; far below if there's none. */
function groundUnder(world: VehicleWorld, x: number, z: number, from: number, down: number): number {
  for (let y = Math.floor(from), n = 0; n <= down; y--, n++) if (solid(world, x, y, z)) return y + 1;
  return -1e3;
}

function look(s: MountState, c: VehicleControls) {
  s.cam -= c.mouseX * 0.0035;
  s.tip = clamp(s.tip + c.mouseY * 0.003, -0.35, 1.2);
  if (c.buttonPressed(0) && s.cd <= 0) {
    s.atk++;
    s.cd = TUNING[SPECIES_IDS[s.k]].cooldown * 0.8;
  }
}

const gallopKey = (c: VehicleControls): boolean => c.isDown('ControlLeft') || c.isDown('KeyF');

/** Walking, galloping, jumping and swimming. `hop`: Space jumps (a flyer takes off instead). */
function walk(s: MountState, c: VehicleControls, dt: number, world: VehicleWorld, sp: Species, t: Tuning, hop: boolean) {
  const fwd = (c.isDown('KeyW') ? 1 : 0) - (c.isDown('KeyS') ? 1 : 0);
  const side = (c.isDown('KeyD') ? 1 : 0) - (c.isDown('KeyA') ? 1 : 0);
  const backing = fwd < 0 && side === 0;
  const moving = fwd !== 0 || side !== 0;
  const gallop = gallopKey(c) && fwd > 0 && !s.winded && !s.swim;

  // It turns toward where the keys point, about the camera: quicker at a walk than at a gallop.
  let target = 0;
  if (moving && !backing) {
    const dx = Math.sin(s.cam) * fwd - Math.cos(s.cam) * side;
    const dz = Math.cos(s.cam) * fwd + Math.sin(s.cam) * side;
    const err = turnTo(s.yaw, Math.atan2(dx, dz));
    const rate = t.turn * (Math.abs(s.v) > sp.walk * 1.3 ? 0.7 : 1) * dt;
    s.yaw += clamp(err, -rate, rate);
    target = (gallop ? sp.run : sp.walk) * Math.max(0.15, Math.cos(err));
  } else if (backing) {
    const err = turnTo(s.yaw, s.cam);
    s.yaw += clamp(err, -t.turn * 0.5 * dt, t.turn * 0.5 * dt);
    target = -sp.walk * 0.5;
  }
  if (s.swim) target *= 0.55;
  const dv = target - s.v;
  s.v += clamp(dv, -t.accel * 1.8 * dt, t.accel * dt);

  // Stamina: a gallop spends it, anything else earns it back.
  if (gallop && s.v > sp.walk * 1.1) s.stamina = Math.max(0, s.stamina - dt / 14);
  else s.stamina = Math.min(1, s.stamina + dt / 9);
  if (s.stamina <= 0) s.winded = true;
  else if (s.stamina > 0.3) s.winded = false;

  if (hop && c.pressed('Space') && (s.ground || s.swim) && s.stamina > 0.1) {
    s.vy = Math.sqrt(2 * GRAVITY * t.jump);
    s.ground = false;
    s.stamina -= 0.08;
  }

  // Forward, unless what's ahead is taller than it can step up; then one axis at a time, sliding along it.
  const step = t.big ? 1.6 : 1.1;
  const nose = sp.hitbox.width / 2 + 0.3;
  const dir = Math.sign(s.v) || 1;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const barred = (x: number, z: number): boolean => solid(world, x + fx * nose * dir, s.y + step + 0.2, z + fz * nose * dir) || solid(world, x, s.y + step + 0.2, z);
  const nx = s.x + fx * s.v * dt;
  const nz = s.z + fz * s.v * dt;
  if (!barred(nx, nz)) [s.x, s.z] = [nx, nz];
  else if (!barred(nx, s.z)) s.x = nx;
  else if (!barred(s.x, nz)) s.z = nz;
  else s.v *= 0.5;

  // The ground under its middle and its nose (so it rises onto a step as it meets it), or the water's top.
  const ground = Math.max(groundUnder(world, s.x, s.z, s.y + step, 48), groundUnder(world, s.x + fx * nose * dir, s.z + fz * nose * dir, s.y + step, 48));
  const afloat = world.seaLevel + 1 - sp.hitbox.height * 0.55;
  if (ground < afloat && wet(world, s.x, afloat, s.z)) {
    s.swim = true;
    s.ground = false;
    s.vy = Math.max(s.vy - GRAVITY * 0.3 * dt, 0);
    s.y += (afloat - s.y) * Math.min(1, dt * 5) + s.vy * dt;
    return;
  }
  s.swim = false;
  if (s.ground && s.vy <= 0 && ground >= s.y - 0.7) {
    s.y += (ground - s.y) * Math.min(1, dt * 16);
    s.vy = 0;
    return;
  }
  s.vy -= GRAVITY * dt;
  s.y += s.vy * dt;
  s.ground = s.y <= ground && s.vy <= 0;
  if (s.ground) {
    s.y = ground;
    s.vy = 0;
  }
}

/** In the air: the heading follows the camera, banking; W flaps, Space climbs, C dives, and letting go glides. */
function soar(s: MountState, c: VehicleControls, dt: number, world: VehicleWorld, sp: Species, t: Tuning) {
  const err = turnTo(s.yaw, s.cam);
  const rate = t.turn * 1.3 * dt;
  s.yaw += clamp(err, -rate, rate);
  s.roll += (clamp(-err * 1.4, -0.7, 0.7) - s.roll) * Math.min(1, dt * 5);

  const flap = c.isDown('KeyW');
  const brake = c.isDown('KeyS');
  const climb = c.isDown('Space') && !s.winded;
  const dive = c.isDown('KeyC') || gallopKey(c);
  const speed = flap ? sp.run : brake ? 2.5 : sp.run * 0.62;
  s.v += clamp(speed + (dive ? 4 : 0) - s.v, -t.accel * dt, t.accel * 0.8 * dt);
  const rise = climb ? 6 : dive ? -10 : flap ? 0 : brake ? -2.5 : -1.3;
  s.vy += (rise - s.vy) * Math.min(1, dt * 3);
  s.pitch += (Math.atan2(s.vy, Math.max(3, s.v)) - s.pitch) * Math.min(1, dt * 6);

  if (climb) s.stamina = Math.max(0, s.stamina - dt / 10);
  else if (flap) s.stamina = Math.max(0, s.stamina - dt / 45);
  else s.stamina = Math.min(1, s.stamina + dt / 12);
  if (s.stamina <= 0) s.winded = true;
  else if (s.stamina > 0.3) s.winded = false;

  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const nose = sp.length / 2;
  if (solid(world, s.x + fx * nose, s.y + 0.6, s.z + fz * nose)) s.v = Math.min(s.v, 0.5);
  s.x += fx * s.v * dt;
  s.z += fz * s.v * dt;
  if (s.vy > 0 && solid(world, s.x, s.y + sp.hitbox.height + 0.3, s.z)) s.vy = 0;
  s.y = Math.min(250, s.y + s.vy * dt);
  const ground = groundUnder(world, s.x, s.z, s.y + 1, 6);
  const water = world.seaLevel + 1;
  if (s.y <= ground || (s.y < water - 0.4 && wet(world, s.x, s.y, s.z))) {
    // Down: it lands and folds its wings.
    s.y = Math.max(ground, s.y);
    s.fly = false;
    s.ground = true;
    s.vy = 0;
    s.pitch = 0;
    s.roll = 0;
    s.v = Math.min(s.v, sp.walk);
  }
}

const _e = new math.Euler(0, 0, 0, 'YXZ');
const _want = new math.Vector3();
const _focus = new math.Vector3();

function pose(s: MountState, position: math.Vector3, quaternion: math.Quaternion) {
  position.set(s.x, s.y, s.z);
  quaternion.setFromEuler(_e.set(-s.pitch, s.yaw, s.roll, 'YXZ'));
}

/** A chase camera the mouse swings about the mount, further back the bigger the animal, pulled in where blocks are in the way. */
function camera(s: MountState, cam: Parameters<NonNullable<VehicleDefinition['camera']>>[1], dt: number, world: VehicleWorld) {
  const sp: Species = SPECIES[SPECIES_IDS[s.k]];
  const back = 3.4 + sp.length * 0.72;
  const up = sp.height * 0.8 + 0.9;
  const ct = Math.cos(s.tip);
  _focus.set(s.x, s.y + up, s.z);
  _want.set(s.x - Math.sin(s.cam) * back * ct, s.y + up + Math.sin(s.tip) * back, s.z - Math.cos(s.cam) * back * ct);
  if (!world.lineOfSight(_focus, _want)) {
    const d = _want.clone().sub(_focus);
    const len = d.length();
    const hit = world.raycast(_focus, d.multiplyScalar(1 / len), len);
    if (hit) _want.copy(_focus).addScaledVector(d, Math.max(1.2, Math.hypot(hit.point.x - _focus.x, hit.point.y - _focus.y, hit.point.z - _focus.z) - 0.5));
  }
  cam.position.lerp(_want, cam.snap ? 1 : 1 - Math.exp(-dt * 16));
  cam.target.lerp(_focus, cam.snap ? 1 : 1 - Math.exp(-dt * 20));
  cam.fov = 70 + Math.min(12, Math.abs(s.v) * 0.7);
}

const mount: VehicleDefinition<MountState> = {
  step(s, c, dt, world) {
    const id = SPECIES_IDS[s.k];
    s.cd = Math.max(0, s.cd - dt);
    look(s, c);
    walk(s, c, dt, world, SPECIES[id], TUNING[id], true);
  },
  pose,
  camera,
};

const wing: VehicleDefinition<MountState> = {
  step(s, c, dt, world) {
    const id = SPECIES_IDS[s.k];
    const sp: Species = SPECIES[id];
    s.cd = Math.max(0, s.cd - dt);
    look(s, c);
    if (s.fly) return soar(s, c, dt, world, sp, TUNING[id]);
    walk(s, c, dt, world, sp, TUNING[id], false);
    if (c.pressed('Space') && s.stamina > 0.15) {
      // A run and a leap into the air.
      s.fly = true;
      s.ground = false;
      s.swim = false;
      s.vy = 7;
      s.v = Math.max(s.v, sp.run * 0.5);
      s.stamina -= 0.1;
    }
  },
  pose,
  camera,
};

export const vehicles: Record<string, VehicleDefinition> = { bt_mount: mount, bt_wing: wing };
