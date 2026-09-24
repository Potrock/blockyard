import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Input } from './input';

export interface PlayerState {
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
}

const EYE = 1.62;
const SNEAK_EYE = 1.27;

/** First-person controller: mouse look + WASD input, physics stepped in WebAssembly. */
export class PlayerController {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  baseFov = 75;
  viewBobbing = true;
  allowFlight = true;
  state: PlayerState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, inWater: false, eyesInWater: false, inLava: false, flying: false, bob: 0 };
  private eye = EYE;
  private fov = 75;
  private lastJumpTap = -1;
  private lastForwardTap = -1;
  private sprintLatched = false;
  private time = 0;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(
    private world: VoxelWorld,
    readonly camera: THREE.PerspectiveCamera,
    private input: Input,
  ) {}

  setFlying(on: boolean) {
    this.world.set_flying(on);
  }

  update(dt: number, active: boolean) {
    this.time += dt;
    const inp = this.input;
    if (active) {
      const k = 0.0022 * this.sensitivity;
      this.yaw -= inp.mouseDX * k;
      this.pitch -= inp.mouseDY * k;
      this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
    }

    let f = 0;
    let s = 0;
    let jump = false;
    let sneak = false;
    let sprint = false;
    if (active) {
      if (inp.isDown('KeyW') || inp.isDown('ArrowUp')) f += 1;
      if (inp.isDown('KeyS') || inp.isDown('ArrowDown')) f -= 1;
      if (inp.isDown('KeyD') || inp.isDown('ArrowRight')) s += 1;
      if (inp.isDown('KeyA') || inp.isDown('ArrowLeft')) s -= 1;
      jump = inp.isDown('Space');
      sneak = inp.isDown('ShiftLeft') || inp.isDown('ShiftRight');
      if (inp.pressed('KeyW')) {
        if (this.time - this.lastForwardTap < 0.3) this.sprintLatched = true;
        this.lastForwardTap = this.time;
      }
      if (f <= 0) this.sprintLatched = false;
      sprint = (inp.isDown('ControlLeft') || inp.isDown('ControlRight') || this.sprintLatched) && f > 0 && !sneak;
      if (inp.pressed('Space') && this.allowFlight) {
        if (this.time - this.lastJumpTap < 0.3) {
          this.world.set_flying(!this.state.flying);
          this.lastJumpTap = -1;
        } else {
          this.lastJumpTap = this.time;
        }
      }
      if (inp.pressed('KeyF') && this.allowFlight) this.world.set_flying(!this.state.flying);
    }

    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    let wx = -sy * f + cy * s;
    let wz = -cy * f - sy * s;
    const len = Math.hypot(wx, wz);
    if (len > 1) {
      wx /= len;
      wz /= len;
    }
    this.world.player_step(wx, wz, jump, sneak, sprint, dt);
    const st = this.world.player_state();
    const S = this.state;
    S.x = st[0];
    S.y = st[1];
    S.z = st[2];
    S.vx = st[3];
    S.vy = st[4];
    S.vz = st[5];
    S.onGround = st[6] > 0.5;
    S.inWater = st[7] > 0.5;
    S.eyesInWater = st[8] > 0.5;
    S.inLava = st[9] > 0.5;
    S.flying = st[10] > 0.5;
    S.bob = st[11];

    const targetEye = sneak && !S.flying ? SNEAK_EYE : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-dt * 14));

    const speed = Math.hypot(S.vx, S.vz);
    const bobAmt = this.viewBobbing && S.onGround && !S.flying ? Math.min(1, speed / 4.3) : 0;
    const phase = S.bob * Math.PI * 0.9;
    const bobY = Math.abs(Math.sin(phase)) * 0.055 * bobAmt;
    const bobX = Math.cos(phase) * 0.03 * bobAmt;

    this.camera.position.set(S.x + Math.cos(this.yaw) * bobX, S.y + this.eye + bobY, S.z - Math.sin(this.yaw) * bobX);
    this.euler.set(this.pitch, this.yaw, Math.cos(phase) * 0.004 * bobAmt);
    this.camera.quaternion.setFromEuler(this.euler);

    const targetFov = this.baseFov + (sprint && speed > 4.5 ? 9 : 0) + (S.flying && speed > 12 ? 6 : 0);
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  viewDirection(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }
}
