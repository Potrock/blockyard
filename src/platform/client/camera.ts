import * as THREE from 'three';
import type { Input } from '../player/input';
import type { PlayerFrame } from '../sim/player';

const EYE = 1.62;
const SNEAK_EYE = 1.27;
const SLIDE_EYE = 0.95;

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The first-person camera: mouse look (the client owns it, so it feels immediate; the view goes
 * to the simulation with the controls), then following the simulation's player with smooth eye
 * height, view bobbing and the sprint / flight FOV kick. With the game's `camera.orbit`, the
 * wheel pulls it back to circle a target (third person), turned by the same mouse look.
 */
export class PlayerCamera {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  baseFov = 75;
  viewBobbing = true;
  /** Aiming down the sights: the field of view is divided by this (the runtime eases it). */
  aimZoom = 1;
  private eye = EYE;
  private fov = 75;
  /** The last view the simulation set that we've taken on. */
  viewSeq = -1;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  /** Third person: how far the camera is from the point it circles (0: first person), and where the wheel is taking it. */
  distance = 0;
  private zoomTo = 0;
  /** The game's orbit (`camera.orbit`): how close and far the wheel goes; null for first person only. */
  private range: { min: number; max: number } | null = null;
  private orbitSeq = -1;
  /** The point circled last (kept while zooming back in after the orbit ends). */
  private circled = new THREE.Vector3();
  /** How far the camera can go from a point along a direction before a block stops it. */
  clearance: (from: THREE.Vector3, dir: THREE.Vector3, max: number) => number = (_from, _dir, max) => max;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  look(input: Input, active: boolean) {
    if (!active) return;
    const k = 0.0022 * this.sensitivity;
    this.yaw -= input.mouseDX * k;
    this.pitch -= input.mouseDY * k;
    this.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, this.pitch));
  }

  /** The game's orbit, as the newest frame has it: a new one starts from its distance. */
  setOrbit(o: PlayerFrame['orbit']) {
    if (!o) {
      this.range = null;
      this.zoomTo = 0;
      return;
    }
    this.range = { min: o.min, max: o.max };
    if (o.seq !== this.orbitSeq) {
      this.orbitSeq = o.seq;
      this.zoomTo = o.distance;
    }
    this.zoomTo = Math.max(o.min, Math.min(o.max, this.zoomTo));
  }

  /** The wheel zooms (the game has an orbit on). */
  get zooms(): boolean {
    return this.range !== null;
  }

  /** Out of the player's eyes: their figure shows, their first-person hand doesn't. */
  get thirdPerson(): boolean {
    return this.distance > 1.2;
  }

  /** The wheel: notches out (positive) or in, each a bigger step further out; all the way in is first person. */
  zoom(notches: number) {
    const r = this.range;
    if (!r || !notches) return;
    let d = this.zoomTo;
    for (let i = 0; i < Math.abs(notches); i++) d = notches > 0 ? Math.max(2, d * 1.3) : d < 2.6 ? 0 : d / 1.3;
    this.zoomTo = Math.max(r.min, Math.min(r.max, d));
  }

  /**
   * Where the simulation put the player; it turns us when it says so (teleports, spawning).
   * `circle` is the point an orbit goes round (the ship), if the game set one.
   */
  follow(dt: number, f: PlayerFrame, circle: THREE.Vector3 | null = null) {
    // Newer only: frames can come out of order (a server's, played back smoothly).
    if (f.view.seq > this.viewSeq) {
      this.viewSeq = f.view.seq;
      this.yaw = f.view.yaw;
      this.pitch = f.view.pitch;
    }
    const targetEye = f.sliding ? SLIDE_EYE : f.sneaking && !f.flying ? SNEAK_EYE : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-dt * (f.sliding ? 18 : 14)));

    const speed = Math.hypot(f.vx, f.vz);
    const bobAmt = this.viewBobbing && f.onGround && !f.flying ? Math.min(1, speed / 4.3) : 0;
    const phase = f.bob * Math.PI * 0.9;
    const bobY = Math.abs(Math.sin(phase)) * 0.055 * bobAmt;
    const bobX = Math.cos(phase) * 0.03 * bobAmt;

    this.camera.position.set(f.x + Math.cos(this.yaw) * bobX, f.y + this.eye + bobY, f.z - Math.sin(this.yaw) * bobX);
    this.euler.set(this.pitch, this.yaw, Math.cos(phase) * 0.004 * bobAmt);
    this.camera.quaternion.setFromEuler(this.euler);

    // Third person: back from the eyes, round the point the game's orbit circles (reached over the
    // first few blocks of zoom, so scrolling out glides from the eyes to the ship).
    this.distance += (this.zoomTo - this.distance) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.zoomTo - this.distance) < 0.01) this.distance = this.zoomTo;
    if (circle) this.circled.copy(circle);
    if (this.distance > 0) {
      const eye = new THREE.Vector3(f.x, f.y + this.eye, f.z);
      const pivot = eye.lerp(this.circled, smoothstep(this.distance / 6));
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
      this.camera.position.copy(pivot).addScaledVector(back, Math.min(this.distance, this.clearance(pivot, back, this.distance)));
    }

    const aiming = this.aimZoom > 1.01;
    const targetFov = (this.baseFov + (f.sprinting && !aiming ? 9 : 0) + (f.sliding ? 6 : 0) + (f.flying && speed > 12 ? 6 : 0)) / this.aimZoom;
    // Aiming snaps in quicker than the sprint kick eases.
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * (aiming ? 22 : 8)));
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
