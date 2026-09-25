import type { MovementAbility } from '@platform';

/**
 * The dodge roll (Q, or LB on a controller): a quick low tumble along the way the keys push (or
 * sideways, to the right, when standing still), then up and on at a run. On the ground only, and not
 * again for a while. A pure step: the platform runs it on the host and, ahead of it, on the
 * player's own screen, so it answers the moment Q goes down, online too.
 *
 * What it can't do (see the game's notes): drop the roller's hitbox the way a crouch does, or tip
 * their first-person camera through the roll. It swallows jumps while it lasts.
 */
export const ROLL = { key: 'KeyQ', speed: 12.5, time: 0.34, exit: 7, cooldown: 2.2 };

export interface RollState {
  /** Seconds of roll left (0: not rolling), and until the next. */
  left: number;
  cool: number;
  dx: number;
  dz: number;
}

export const roll: MovementAbility<RollState> = {
  state: { left: 0, cool: 0, dx: 0, dz: 0 },
  step(s, c, body, dt) {
    s.cool = Math.max(0, s.cool - dt);
    if (c.pressed(ROLL.key) && s.cool === 0 && s.left === 0 && body.onGround && !body.inWater && !body.flying) {
      const w = Math.hypot(body.wish.x, body.wish.z);
      // No keys held: a sidestep to the right (the camera's right is (cos yaw, -sin yaw)).
      [s.dx, s.dz] = w > 0.1 ? [body.wish.x / w, body.wish.z / w] : [Math.cos(body.yaw), -Math.sin(body.yaw)];
      s.left = ROLL.time;
      s.cool = ROLL.cooldown;
      c.consume(ROLL.key);
      body.trigger('roll');
    }
    if (s.left <= 0) return;
    s.left = Math.max(0, s.left - dt);
    // Fast along the ground and steerless while it lasts; the last step lets them out at a run.
    const speed = s.left > 0 ? ROLL.speed : ROLL.exit;
    body.setVelocity({ x: s.dx * speed, z: s.dz * speed });
    body.control = 0;
    body.jump = false;
  },
};
