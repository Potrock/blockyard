import type { MovementAbility, MovementOptions } from '@platform';

/**
 * How survivors move. Walking is unhurried and sprinting is a real burst, paid for in stamina: the
 * `stamina` ability below runs inside every movement step on the server and, ahead of it, on the
 * survivor's own screen, so running out of breath is felt the moment it happens online too.
 */

/** Stamina's numbers (points and points a second, of a bar that starts at 100). */
export const STAMINA = {
  max: 100,
  /** What moving costs: a sprint and a swim per second, a jump at once. */
  sprint: 8,
  swim: 2.5,
  jump: 5,
  /** Breath comes back this fast standing still, and this fast on the move, after a short rest. */
  regenStill: 16,
  regenMoving: 9,
  restDelay: 0.9,
  /** Winded at empty, until this much is back: no sprinting meanwhile. */
  recover: 22,
} as const;

export interface StaminaState {
  /** Breath left, 0 to `cap`. */
  s: number;
  /** The most they can have now: the server lowers it while they starve or thirst. */
  cap: number;
  /** Seconds until it starts coming back. */
  rest: number;
  /** Out of breath: walking pace only until some comes back. */
  winded: boolean;
  /** What their load does to their speed (1 unburdened), and whether it's too much to jump: the server sets both from what they carry. */
  load: number;
  pinned: boolean;
}

const WALK = 4.4;
const SPRINT = 6.5;

/**
 * Stamina, and the weight on a survivor's back. Sprinting, swimming and jumping spend breath;
 * rest brings it back. The server takes more for swings (`player.abilities.stamina.s`) and sets
 * `cap`, `load` and `pinned`; their screen follows, so the HUD's meter (`$ability.stamina.s`) and
 * their pace never wait on the network.
 */
export const stamina: MovementAbility<StaminaState> = {
  state: { s: STAMINA.max, cap: STAMINA.max, rest: 0, winded: false, load: 1, pinned: false },
  step(st, _controls, body, dt) {
    if (body.flying) return;
    const moving = Math.hypot(body.wish.x, body.wish.z) > 0.1;
    let spent = 0;
    if (body.inWater) {
      if (moving) spent += STAMINA.swim * dt;
    } else {
      if (body.sprinting && moving && !st.winded) spent += STAMINA.sprint * dt;
      if (body.jump && body.onGround) {
        // Too heavy, or too tired, to get off the ground.
        if (st.pinned || st.s < STAMINA.jump) body.jump = false;
        else spent += STAMINA.jump;
      }
    }
    if (spent > 0) {
      st.s = Math.max(0, st.s - spent);
      st.rest = STAMINA.restDelay;
      if (st.s <= 0) st.winded = true;
    } else {
      st.rest = Math.max(0, st.rest - dt);
      if (st.rest <= 0) st.s = Math.min(st.cap, st.s + (moving ? STAMINA.regenMoving : STAMINA.regenStill) * dt);
    }
    if (st.s > st.cap) st.s = st.cap;
    if (st.winded && st.s >= Math.min(STAMINA.recover, st.cap)) st.winded = false;
    // Out of breath, a sprint is only a walk; a heavy pack slows everything.
    let speed = st.load;
    if (st.winded && body.sprinting) speed *= WALK / SPRINT;
    body.speed *= speed;
  },
};

export const movement: MovementOptions = {
  walk: WALK,
  sprint: SPRINT,
  crouch: 1.7,
  jump: 1.25,
  // Shift runs and C (or Ctrl) crouches, as survival games have it; W twice runs too.
  sprintKeys: ['ShiftLeft', 'ShiftRight'],
  crouchKeys: ['KeyC', 'ControlLeft'],
  doubleTapSprint: true,
  // A ledge a block up is climbed rather than bumped into: the island is all slopes and rocks.
  mantle: 1,
  abilities: { stamina },
};
