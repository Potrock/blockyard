import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { PlayerInput } from '../net/protocol';
import { freshMemory, stepMovement, type MoveControls, type MoveMemory } from '../sim/movement';
import type { PlayerFrame } from '../sim/player';

/** A `PlayerInput` read the way movement reads controls. */
class Controls implements MoveControls {
  constructor(private i: PlayerInput) {}
  get active() {
    return this.i.active;
  }
  isDown(code: string) {
    return this.i.down.includes(code);
  }
  pressed(code: string) {
    return this.i.pressed.includes(code);
  }
}

/** Where this client shows its own player: predicted, with any correction easing away. */
export interface Predicted {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  inWater: boolean;
  eyesInWater: boolean;
  inLava: boolean;
  flying: boolean;
  bob: number;
  sneaking: boolean;
  sprinting: boolean;
}

/**
 * Client-side prediction of this client's own player on a game server. Each frame's controls
 * move a body in this client's copy of the world at once, with the same step the server will
 * take (`stepMovement`), and go to the server numbered. When the server's frame says which input
 * it applied last, the body starts again from the server's state and replays the rest: the
 * same code on the same blocks, so it lands where it was, and any difference (a knockback, a
 * teleport, a block someone placed) is eased in over a few frames.
 */
export class Predictor {
  private slot: number;
  private seq = 0;
  private pending: { seq: number; input: PlayerInput; dt: number }[] = [];
  private memory: MoveMemory = freshMemory();
  private ready = false;
  private allowFlight = false;
  private sneak = false;
  private sprint = false;
  /** Shown minus predicted, fading: corrections ease in instead of snapping. */
  private error = [0, 0, 0];
  /** How far the last server frame moved the prediction (blocks): ~0 when prediction holds. */
  lastCorrection = 0;

  constructor(private world: VoxelWorld) {
    this.slot = world.player_add(0, 300, 0);
    world.set_frozen(this.slot, true);
  }

  /** This frame's controls: move now, and number them for the server. */
  step(input: PlayerInput, dt: number): number {
    const seq = ++this.seq;
    const d = Math.max(0, Math.min(0.1, dt));
    this.pending.push({ seq, input, dt: d });
    if (this.pending.length > 120) this.pending.shift();
    if (this.ready) this.run(input, d);
    const k = Math.exp(-dt * 12);
    for (let i = 0; i < 3; i++) this.error[i] *= k;
    return seq;
  }

  /** The server's newest word on this player: start from it and replay what it hasn't applied. */
  reconcile(me: PlayerFrame) {
    // Where the player is shown now, to keep showing them there while the difference fades.
    const p = this.raw();
    const shown = this.ready ? [p[0] + this.error[0], p[1] + this.error[1], p[2] + this.error[2]] : null;
    this.world.player_restore(this.slot, new Float64Array([me.x, me.y, me.z, me.vx, me.vy, me.vz, +me.onGround, +me.inWater, +me.eyesInWater, +me.inLava, +me.flying, me.bob, +me.frozen]));
    this.memory = { ...me.move };
    this.allowFlight = me.canFly;
    this.sneak = me.sneaking;
    this.sprint = me.sprinting;
    while (this.pending.length && this.pending[0].seq <= me.ack) this.pending.shift();
    for (const m of this.pending) this.run(m.input, m.dt);
    this.ready = true;
    if (!shown) return;
    const q = this.raw();
    this.lastCorrection = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const e = [shown[0] - q[0], shown[1] - q[1], shown[2] - q[2]];
    // A small miss eases in; a jump (teleport, respawn) is taken at once.
    this.error = Math.hypot(e[0], e[1], e[2]) < 2 ? e : [0, 0, 0];
  }

  /** The player as this client should show them now; null until the server has spoken. */
  shown(): Predicted | null {
    if (!this.ready) return null;
    const s = this.world.player_state(this.slot);
    return {
      x: s[0] + this.error[0],
      y: s[1] + this.error[1],
      z: s[2] + this.error[2],
      vx: s[3],
      vy: s[4],
      vz: s[5],
      onGround: s[6] > 0.5,
      inWater: s[7] > 0.5,
      eyesInWater: s[8] > 0.5,
      inLava: s[9] > 0.5,
      flying: s[10] > 0.5,
      bob: s[11],
      sneaking: this.sneak,
      sprinting: this.sprint,
    };
  }

  private raw(): [number, number, number] {
    const s = this.world.player_state(this.slot);
    return [s[0], s[1], s[2]];
  }

  private run(input: PlayerInput, dt: number) {
    const r = stepMovement(this.world, this.slot, new Controls(input), input.yaw, this.allowFlight, this.memory, dt);
    this.sneak = r.sneak;
    const s = this.world.player_state(this.slot);
    this.sprint = r.sprint && Math.hypot(s[3], s[5]) > 4.5;
  }
}
