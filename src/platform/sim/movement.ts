import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { MovementOptions } from '../api/types';

/** The part of a player's controls that moves them. */
export interface MoveControls {
  readonly active: boolean;
  isDown(code: string): boolean;
  pressed(code: string): boolean;
  /** A controller's stick ([right, forward]): it walks that way, as fast as it's pushed. */
  readonly move?: [number, number] | null;
}

/** What movement remembers between steps: taps (double-tap sprinting and flying) and a slide. */
export interface MoveMemory {
  time: number;
  lastJumpTap: number;
  lastForwardTap: number;
  sprintLatched: boolean;
  /** Sprinting last step (a crouch then starts a slide). */
  sprinting: boolean;
  /** Seconds of slide left (0: not sliding), and until the next may start. */
  slide: number;
  slideCool: number;
}

export const freshMemory = (): MoveMemory => ({ time: 0, lastJumpTap: -1, lastForwardTap: -1, sprintLatched: false, sprinting: false, slide: 0, slideCool: 0 });

/** A game's `player.movement`, resolved: the engine's numbers, the keys, the slide. */
export interface MoveTune {
  /** For `player_tune`: walk, sprint, sneak, jump speed, gravity, ground and air acceleration, edge guard, mantle, slide friction. */
  params: number[];
  sprintKeys: string[];
  crouchKeys: string[];
  doubleTapSprint: boolean;
  sprint: number;
  slide: { speed: number; time: number; cooldown: number } | null;
}

const MC = { walk: 4.317, sprint: 5.61, sneak: 1.31, gravity: 32, jumpSpeed: 9 };

export function resolveMovement(o: MovementOptions = {}): MoveTune {
  const gravity = o.gravity ?? MC.gravity;
  const jump = o.jump === undefined ? MC.jumpSpeed : Math.sqrt(2 * gravity * Math.max(0, o.jump));
  const sprint = o.sprint ?? MC.sprint;
  const slide = o.slide === true ? {} : o.slide || null;
  const mantle = o.mantle === true ? 1 : o.mantle || 0;
  return {
    params: [o.walk ?? MC.walk, sprint, o.crouch ?? MC.sneak, jump, gravity, o.acceleration ?? 14, o.airControl ?? 3, (o.edgeGuard ?? true) ? 1 : 0, mantle, slide?.friction ?? 1.4],
    sprintKeys: o.sprintKeys ?? ['ControlLeft', 'ControlRight'],
    crouchKeys: o.crouchKeys ?? ['ShiftLeft', 'ShiftRight'],
    doubleTapSprint: o.doubleTapSprint ?? true,
    sprint,
    slide: slide && { speed: slide.speed ?? sprint * 1.45, time: slide.time ?? 0.75, cooldown: slide.cooldown ?? 0.5 },
  };
}

export const DEFAULT_TUNE = resolveMovement();

/** What the player holds and does that changes their movement this step (see `guns.moveMods`). */
export interface MoveMods {
  /** Speed multiplier (a heavy weapon, aiming down the sights). */
  speed: number;
  /** Can't sprint (aiming, firing). */
  noSprint: boolean;
}

export const NO_MODS: MoveMods = { speed: 1, noSprint: false };

const any = (keys: string[], f: (k: string) => boolean) => keys.some(f);

/**
 * One step of a player walking, sprinting, crouching, sliding, jumping, swimming or flying,
 * facing `yaw`. The server runs it for every player, and a client runs the very same step to
 * predict its own player before the server answers, so both land in the same place.
 */
export function stepMovement(
  world: VoxelWorld,
  slot: number,
  c: MoveControls,
  yaw: number,
  allowFlight: boolean,
  m: MoveMemory,
  dt: number,
  tune: MoveTune = DEFAULT_TUNE,
  mods: MoveMods = NO_MODS,
): { sneak: boolean; sprint: boolean; slide: boolean } {
  m.time += dt;
  let f = 0;
  let s = 0;
  let jump = false;
  let crouch = false;
  let sprint = false;
  let crouchPressed = false;
  if (c.active) {
    if (c.isDown('KeyW') || c.isDown('ArrowUp')) f += 1;
    if (c.isDown('KeyS') || c.isDown('ArrowDown')) f -= 1;
    if (c.isDown('KeyD') || c.isDown('ArrowRight')) s += 1;
    if (c.isDown('KeyA') || c.isDown('ArrowLeft')) s -= 1;
    // A stick: its direction and how far it's pushed (over the keys, which it also presses).
    const stick = c.move;
    if (stick && (stick[0] !== 0 || stick[1] !== 0)) {
      s = stick[0];
      f = stick[1];
    }
    jump = c.isDown('Space');
    crouch = any(tune.crouchKeys, (k) => c.isDown(k));
    crouchPressed = any(tune.crouchKeys, (k) => c.pressed(k));
    if (c.pressed('KeyW') && tune.doubleTapSprint) {
      if (m.time - m.lastForwardTap < 0.3) m.sprintLatched = true;
      m.lastForwardTap = m.time;
    }
    if (f <= 0) m.sprintLatched = false;
    // Sprinting runs forward (a stick has to be mostly forward), at full speed.
    sprint = (any(tune.sprintKeys, (k) => c.isDown(k)) || m.sprintLatched) && f > 0.3 && f >= Math.abs(s) * 0.6 && !crouch && !mods.noSprint;
    if (sprint && stick) {
      const len = Math.hypot(f, s);
      f /= len;
      s /= len;
    }
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

  // A slide: crouching out of a sprint on the ground, a burst of speed that bleeds away. It runs
  // its time whether or not crouch stays held; jumping ends it (keeping the speed), and so does
  // slowing to a crawl.
  const sl = tune.slide;
  if (sl) {
    m.slideCool = Math.max(0, m.slideCool - dt);
    const st = world.player_state(slot);
    const speed = Math.hypot(st[3], st[5]);
    const grounded = st[6] > 0.5 && st[10] < 0.5 && st[7] < 0.5;
    if (m.slide > 0) {
      m.slide = Math.max(0, m.slide - dt);
      if (jump || speed < tune.params[2] * 1.5 || m.slide <= 0) {
        m.slide = 0;
        m.slideCool = sl.cooldown;
      }
    } else if (crouchPressed && m.sprinting && grounded && m.slideCool <= 0 && speed > tune.sprint * 0.6 * mods.speed) {
      m.slide = sl.time;
      // Along the way they were running, up to the slide's speed.
      const dx = st[3] / speed;
      const dz = st[5] / speed;
      const boost = Math.max(0, sl.speed * Math.max(0.6, mods.speed) - speed);
      world.player_impulse(slot, dx * boost, 0, dz * boost);
    }
  }
  const sliding = m.slide > 0;
  m.sprinting = sprint;
  world.player_step(slot, wx, wz, jump, crouch || sliding, sprint && !sliding, sliding, mods.speed, dt);
  return { sneak: crouch || sliding, sprint: sprint && !sliding, slide: sliding };
}
