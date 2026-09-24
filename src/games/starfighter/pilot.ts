import { math, type GameContext, type LoopHandle } from '@platform';
import { Craft, aimError, type ShipType } from './craft';
import type { Target, Weapons } from './weapons';

const CRUISE = 44;
const BOOST = 82;
const BRAKE = 22;
const _v = new math.Vector3();
const _w = new math.Vector3();

/**
 * You: mouse steers (a virtual stick that re-centres), A/D bank, W / Shift boost, S brake,
 * Q / E barrel roll (deflects lasers), left mouse fires the wing cannons, right mouse fires a
 * proton torpedo at whatever you've locked.
 */
export class Pilot {
  readonly craft: Craft;
  shields = 100;
  hull = 100;
  boost = 1;
  torpedoes = 6;
  kills = 0;
  private stick = new math.Vector2();
  private roll = 0;
  private rollDir = 0;
  private gunIndex = 0;
  private gunTimer = 0;
  private sinceHit = 99;
  private bump = 0;
  private tube = 1;
  private engine: LoopHandle;
  private camPos = new math.Vector3();
  private camLook = new math.Vector3();
  private fov = 75;
  lock: Target | null = null;
  private lockCandidate: Target | null = null;
  private lockTime = 0;
  /** The target being acquired (not yet locked), for the HUD. */
  get locking(): Target | null {
    return this.lockCandidate && this.lockCandidate !== this.lock && this.lockTime > 0.1 ? this.lockCandidate : null;
  }
  /** Laser deflection window of a barrel roll. */
  get rolling(): boolean {
    return this.rollDir !== 0;
  }

  constructor(
    private game: GameContext,
    type: ShipType,
    private weapons: Weapons,
    at: math.Vector3,
    yaw: number,
  ) {
    this.craft = new Craft(game, type, 100, '#ff7a3a');
    this.craft.pos.copy(at);
    this.craft.yaw = yaw;
    this.craft.speed = CRUISE;
    this.engine = game.audio.loop('engine', { volume: 0.5, pitch: 1 });
    this.placeCamera(1, true);
  }

  get alive(): boolean {
    return this.craft.alive && this.hull > 0;
  }

  /** Damage from enemy fire: shields first, then the hull. */
  damage(amount: number) {
    if (!this.alive) return;
    this.sinceHit = 0;
    const g = this.game;
    const soak = Math.min(this.shields, amount);
    this.shields -= soak;
    this.hull = Math.max(0, this.hull - (amount - soak));
    g.fx.shake(0.12 + amount * 0.01, 0.25);
    g.fx.flash(soak >= amount ? 'rgba(80, 170, 255, 1)' : 'rgba(255, 60, 30, 1)', 0.22, 0.35);
    g.audio.play(soak >= amount ? 'hit' : 'hurt', { volume: 0.8 });
    this.craft.prop.flash(soak >= amount ? '#7fc4ff' : '#ff5030', 0.15);
    if (this.hull <= 25 && this.hull + amount > 25) g.audio.play('alarm');
  }

  update(dt: number, enemies: Target[]) {
    const g = this.game;
    const inp = g.input;
    const c = this.craft;
    this.sinceHit += dt;
    if (this.sinceHit > 3) this.shields = Math.min(100, this.shields + 9 * dt);

    // Virtual stick: mouse pushes it, it springs back to centre.
    this.stick.x = math.MathUtils.clamp(this.stick.x + inp.mouseX * 0.0045, -1, 1);
    this.stick.y = math.MathUtils.clamp(this.stick.y + inp.mouseY * 0.0045, -1, 1);
    this.stick.multiplyScalar(Math.exp(-dt * 3.2));

    // Throttle.
    const boosting = (inp.isDown('KeyW') || inp.isDown('ShiftLeft')) && this.boost > 0.02;
    const braking = inp.isDown('KeyS') || inp.isDown('ControlLeft');
    const target = boosting ? BOOST : braking ? BRAKE : CRUISE;
    c.speed += (target - c.speed) * Math.min(1, dt * (boosting ? 2.2 : 1.6));
    this.boost = math.MathUtils.clamp(this.boost + (boosting ? -0.32 : 0.14) * dt, 0, 1);

    // Barrel roll on Q / E (or a double-tap-free A/D quick roll).
    if (this.rollDir === 0 && (inp.pressed('KeyQ') || inp.pressed('KeyE'))) {
      this.rollDir = inp.pressed('KeyQ') ? 1 : -1;
      this.roll = 0;
      g.audio.play('whoosh', { volume: 0.7, pitch: 1.3 });
    }
    let strafe = 0;
    if (this.rollDir !== 0) {
      this.roll += dt * Math.PI * 2 * 1.9;
      c.spin = this.rollDir * this.roll;
      strafe = -this.rollDir * 14 * Math.sin(Math.min(this.roll, Math.PI * 2) / 2);
      this.weapons.deflect(c.pos, c.radius * 1.4, 'rebel');
      if (this.roll >= Math.PI * 2) {
        this.rollDir = 0;
        c.spin = 0;
      }
    }

    const bankKeys = (inp.isDown('KeyA') ? 1 : 0) - (inp.isDown('KeyD') ? 1 : 0);
    const yawRate = -this.stick.x * 1.5 + bankKeys * 0.55;
    const pitchRate = -this.stick.y * 1.6;
    c.steer(dt, yawRate, pitchRate, yawRate * 0.55 + bankKeys * 0.35);
    if (strafe) c.knock.addScaledVector(_v.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw)), strafe * dt * 4);
    this.bump -= dt;
    const hit = c.move(dt);
    if (hit) this.crash(hit.at, hit.force, hit.water);

    // Guns: alternate pairs of wing cannons.
    this.gunTimer -= dt;
    if (inp.button(0) && this.gunTimer <= 0) {
      this.gunTimer = 0.13;
      const guns = c.type.guns;
      const aim = c.forward(_w).clone();
      // Converge on the far reticle, or (gentle aim assist) on where a fighter near the reticle will be.
      let conv = _v.copy(aim).multiplyScalar(90).add(c.pos);
      const assist = this.assistTarget(enemies);
      if (assist) {
        const d = c.pos.distanceTo(new math.Vector3(assist.pos.x, assist.pos.y, assist.pos.z));
        const t = d / (170 + c.speed);
        const v = assist.vel ?? { x: 0, y: 0, z: 0 };
        conv = new math.Vector3(assist.pos.x + v.x * t, assist.pos.y + v.y * t, assist.pos.z + v.z * t);
      }
      // Four guns fire in diagonal pairs (like an X-wing's staggered bolts); fewer fire together.
      const pairs = guns.length >= 4 ? [[0, 3], [1, 2]] : [guns.map((_, i) => i)];
      for (const gi of pairs[this.gunIndex % pairs.length]) {
        const from = c.toWorld(guns[gi], new math.Vector3());
        const dir = conv.clone().sub(from).normalize();
        this.weapons.laser(from, dir, 'rebel', { inherit: c.forward(new math.Vector3()).multiplyScalar(c.speed) });
      }
      this.gunIndex++;
    }

    // Lock-on: keep a target near the reticle.
    let best: Target | null = null;
    let bestErr = 0.16;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = c.pos.distanceTo(_v.set(e.pos.x, e.pos.y, e.pos.z));
      if (d > 420) continue;
      const err = aimError(c, e.pos);
      if (err < bestErr) {
        bestErr = err;
        best = e;
      }
    }
    if (this.lock && !this.lock.alive) this.lock = null;
    if (best && best === this.lockCandidate) {
      this.lockTime += dt;
      if (this.lockTime > 0.55 && this.lock !== best) {
        this.lock = best;
        g.audio.play('lock', { volume: 0.6 });
      }
    } else {
      this.lockCandidate = best;
      this.lockTime = 0;
    }
    if (inp.buttonPressed(2) && this.torpedoes > 0) {
      // Alternate tubes under the nose; they kick out and down, then curve onto the target, so
      // you can watch them go instead of losing them behind your own ship.
      this.torpedoes--;
      this.tube = -this.tube;
      const q = c.orientation(new math.Quaternion());
      const from = c.toWorld(new math.Vector3(this.tube * 1.2, -0.9, -2.5), new math.Vector3());
      const dir = new math.Vector3(this.tube * 0.22, -0.16, -1).normalize().applyQuaternion(q);
      this.weapons.torpedo(from, dir, 'rebel', this.lock, c.speed);
      if (!this.lock) g.hud.toast('No lock: torpedo fired straight');
    }

    const throttle = (c.speed - BRAKE) / (BOOST - BRAKE);
    c.sync(0.3 + throttle * 0.9);
    this.engine.set({ volume: 0.35 + throttle * 0.3, pitch: 0.75 + throttle * 0.7 });
    this.fov += ((boosting ? 90 : braking ? 70 : 76) - this.fov) * Math.min(1, dt * 3);
    this.placeCamera(dt, false);
  }

  /**
   * Scraping or slamming into something: sparks (or spray), a jolt, and damage that grows with
   * how head-on it was (at most once every 0.4 s, so a scrape isn't a death sentence).
   */
  crash(at: math.Vector3, force: number, water = false) {
    const g = this.game;
    if (water) g.fx.burst(at, { color: '#d8f1ff', count: 26, speed: 6, size: 0.22, gravity: 14 });
    else g.fx.burst(at, { color: '#ffc27a', count: 14 + Math.round(force * 20), speed: 7, size: 0.12, gravity: 9 });
    g.fx.shake(0.12 + force * 0.4, 0.3);
    if (this.bump > 0) return;
    this.bump = 0.4;
    g.audio.play(force > 0.5 ? 'explosion' : 'hit', { at, volume: 0.5 + force * 0.5, pitch: force > 0.5 ? 1.6 : 0.7 });
    this.damage(4 + 36 * force * force);
  }

  /** A target within a few degrees of the reticle (closest to it), in range. */
  private assistTarget(enemies: Target[]): Target | null {
    const c = this.craft;
    let best: Target | null = null;
    let bestErr = 0.09;
    for (const e of enemies) {
      if (!e.alive || !e.vel) continue;
      if (c.pos.distanceTo(_v.set(e.pos.x, e.pos.y, e.pos.z)) > 260) continue;
      const err = aimError(c, e.pos);
      if (err < bestErr) {
        bestErr = err;
        best = e;
      }
    }
    return best;
  }

  /** Chase camera: behind and above, lagging a little, looking past the nose. */
  private placeCamera(dt: number, snap: boolean) {
    const g = this.game;
    const c = this.craft;
    const f = c.forward(_w);
    const want = _v.copy(c.pos).addScaledVector(f, -14);
    want.y += 5.4;
    // Stay above the ground.
    const ground = g.world.surfaceY(want.x, want.z);
    if (ground >= 0) want.y = Math.max(want.y, ground + 2);
    const k = snap ? 1 : 1 - Math.exp(-dt * 9);
    this.camPos.lerp(want, k);
    const look = _w.copy(c.pos).addScaledVector(c.forward(new math.Vector3()), 40);
    look.y += 0.5;
    this.camLook.lerp(look, snap ? 1 : 1 - Math.exp(-dt * 14));
    // Lean the horizon a little with the bank.
    const up = new math.Vector3(Math.sin(c.bank) * -0.25 * Math.cos(c.yaw), 1, Math.sin(c.bank) * 0.25 * Math.sin(c.yaw)).normalize();
    g.camera.set(this.camPos, this.camLook, up);
    g.camera.fov = this.fov;
  }

  /** Where the reticles sit (for the HUD). */
  reticle(distance: number) {
    return this.craft.forward(new math.Vector3()).multiplyScalar(distance).add(this.craft.pos);
  }

  explode() {
    this.game.fx.explosion(this.craft.pos, { size: 2.5 });
    this.engine.stop();
    this.craft.remove();
  }

  dispose() {
    this.engine.stop();
    if (this.craft.alive) this.craft.remove();
  }
}
