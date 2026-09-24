import * as THREE from 'three';
import type { Input } from '../player/input';
import type { PlayerFrame } from '../sim/player';

const EYE = 1.62;
const SNEAK_EYE = 1.27;

/**
 * The first-person camera: mouse look (the client owns it, so it feels immediate; the view goes
 * to the simulation with the controls), then following the simulation's player with smooth eye
 * height, view bobbing and the sprint / flight FOV kick.
 */
export class PlayerCamera {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  baseFov = 75;
  viewBobbing = true;
  private eye = EYE;
  private fov = 75;
  /** The last view the simulation set that we've taken on. */
  viewSeq = -1;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  look(input: Input, active: boolean) {
    if (!active) return;
    const k = 0.0022 * this.sensitivity;
    this.yaw -= input.mouseDX * k;
    this.pitch -= input.mouseDY * k;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
  }

  /** Where the simulation put the player; it turns us when it says so (teleports, spawning). */
  follow(dt: number, f: PlayerFrame) {
    if (f.view.seq !== this.viewSeq) {
      this.viewSeq = f.view.seq;
      this.yaw = f.view.yaw;
      this.pitch = f.view.pitch;
    }
    const targetEye = f.sneaking && !f.flying ? SNEAK_EYE : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-dt * 14));

    const speed = Math.hypot(f.vx, f.vz);
    const bobAmt = this.viewBobbing && f.onGround && !f.flying ? Math.min(1, speed / 4.3) : 0;
    const phase = f.bob * Math.PI * 0.9;
    const bobY = Math.abs(Math.sin(phase)) * 0.055 * bobAmt;
    const bobX = Math.cos(phase) * 0.03 * bobAmt;

    this.camera.position.set(f.x + Math.cos(this.yaw) * bobX, f.y + this.eye + bobY, f.z - Math.sin(this.yaw) * bobX);
    this.euler.set(this.pitch, this.yaw, Math.cos(phase) * 0.004 * bobAmt);
    this.camera.quaternion.setFromEuler(this.euler);

    const targetFov = this.baseFov + (f.sprinting ? 9 : 0) + (f.flying && speed > 12 ? 6 : 0);
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
