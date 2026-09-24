import type { VoxelWorld } from '@engine/voxel_engine.js';

/** The part of a player's controls that moves them. */
export interface MoveControls {
  readonly active: boolean;
  isDown(code: string): boolean;
  pressed(code: string): boolean;
}

/** What movement remembers between steps: taps, for double-tap sprinting and flying. */
export interface MoveMemory {
  time: number;
  lastJumpTap: number;
  lastForwardTap: number;
  sprintLatched: boolean;
}

export const freshMemory = (): MoveMemory => ({ time: 0, lastJumpTap: -1, lastForwardTap: -1, sprintLatched: false });

/**
 * One step of a player walking, sprinting, sneaking, jumping, swimming or flying, facing `yaw`.
 * The server runs it for every player, and a client runs the very same step to predict its own
 * player before the server answers, so both land in the same place.
 */
export function stepMovement(world: VoxelWorld, slot: number, c: MoveControls, yaw: number, allowFlight: boolean, m: MoveMemory, dt: number): { sneak: boolean; sprint: boolean } {
  m.time += dt;
  let f = 0;
  let s = 0;
  let jump = false;
  let sneak = false;
  let sprint = false;
  if (c.active) {
    if (c.isDown('KeyW') || c.isDown('ArrowUp')) f += 1;
    if (c.isDown('KeyS') || c.isDown('ArrowDown')) f -= 1;
    if (c.isDown('KeyD') || c.isDown('ArrowRight')) s += 1;
    if (c.isDown('KeyA') || c.isDown('ArrowLeft')) s -= 1;
    jump = c.isDown('Space');
    sneak = c.isDown('ShiftLeft') || c.isDown('ShiftRight');
    if (c.pressed('KeyW')) {
      if (m.time - m.lastForwardTap < 0.3) m.sprintLatched = true;
      m.lastForwardTap = m.time;
    }
    if (f <= 0) m.sprintLatched = false;
    sprint = (c.isDown('ControlLeft') || c.isDown('ControlRight') || m.sprintLatched) && f > 0 && !sneak;
    const flying = () => world.player_state(slot)[10] > 0.5;
    if (c.pressed('Space') && allowFlight) {
      if (m.time - m.lastJumpTap < 0.3) {
        world.set_flying(slot, !flying());
        m.lastJumpTap = -1;
      } else {
        m.lastJumpTap = m.time;
      }
    }
    if (c.pressed('KeyF') && allowFlight) world.set_flying(slot, !flying());
  }
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  let wx = -sy * f + cy * s;
  let wz = -cy * f - sy * s;
  const len = Math.hypot(wx, wz);
  if (len > 1) {
    wx /= len;
    wz /= len;
  }
  world.player_step(slot, wx, wz, jump, sneak, sprint, dt);
  return { sneak, sprint };
}
