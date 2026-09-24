import * as THREE from 'three';
import type { FxApi, Vec3 } from '../api/types';
import type { Particles } from '../render/particles';
import type { GameHud } from '../ui/hudkit';
import type { Sfx } from '../audio/sfx';
import { Shaders } from '../render/shaders';

/** Parse a CSS colour into linear RGB. */
export function linearColor(css: string): [number, number, number] {
  const c = new THREE.Color(css);
  return [c.r, c.g, c.b];
}

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  radius: number;
}

interface Rocket {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  fuse: number;
  color: [number, number, number];
}

/** Screen and world effects. The camera shake offset is read by the runtime each frame. */
export class Effects implements FxApi {
  readonly shakeOffset = new THREE.Vector3();
  private shakeStrength = 0;
  private shakeTime = 0;
  private shakeDuration = 1;
  private rings: Ring[] = [];
  private rockets: Rocket[] = [];
  private time = 0;
  private ringGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);

  constructor(
    private particles: Particles,
    private hud: GameHud,
    private fxScene: THREE.Scene,
    private sfx?: Sfx,
    private cameraPos?: () => Vec3,
  ) {}

  explosion(at: Vec3, opts: { size?: number; color?: string } = {}) {
    const k = Math.max(0.2, opts.size ?? 1);
    const fire = linearColor(opts.color ?? '#ff9a3c');
    const p = this.particles;
    // White-hot core, a fireball, rising smoke and flying sparks.
    p.burstColor(at.x, at.y, at.z, [1, 0.95, 0.8], { count: Math.round(10 * k), speed: 2.5 * k, size: 0.5 * k, glow: 2, life: 0.25, drag: 4, gravity: 0, spread: 0.4 * k, up: 0, collide: false });
    p.burstColor(at.x, at.y, at.z, fire, { count: Math.round(28 * k), speed: 6 * k, size: 0.35 * k, glow: 1.4, life: 0.55, drag: 3.5, gravity: -1, spread: 0.8 * k, up: 0.5, collide: false });
    p.burstColor(at.x, at.y, at.z, [0.05, 0.045, 0.04], { count: Math.round(18 * k), speed: 2.6 * k, size: 0.55 * k, glow: 0, life: 1.8, drag: 1.8, gravity: -1.5, spread: 1.2 * k, up: 1, collide: false });
    p.burstColor(at.x, at.y, at.z, [1, 0.7, 0.3], { count: Math.round(14 * k), speed: 14 * k, size: 0.07, glow: 1.5, life: 1.1, drag: 0.6, gravity: 12, spread: 0.5, up: 2, collide: true });
    if (k >= 2) this.shockwave(at, 2.5 * k, opts.color ?? '#ffb347');
    const cam = this.cameraPos?.();
    const d = cam ? Math.hypot(cam.x - at.x, cam.y - at.y, cam.z - at.z) : 20;
    const shake = (0.35 * k) / (1 + d * 0.06);
    if (shake > 0.015) this.shake(Math.min(0.9, shake), 0.3 + 0.08 * k);
    this.sfx?.play(k >= 2.5 ? 'explosion_big' : 'explosion', { at, volume: Math.min(1.2, 0.55 + 0.25 * k), pitch: 1.15 - Math.min(0.5, 0.08 * k) });
  }

  burst(at: Vec3, opts: { color?: string; count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; drag?: number } = {}) {
    this.particles.burstColor(at.x, at.y, at.z, linearColor(opts.color ?? '#ffffff'), {
      count: opts.count ?? 18,
      speed: opts.speed ?? 3,
      size: opts.size ?? 0.09,
      gravity: opts.gravity ?? 18,
      glow: opts.glow,
      life: opts.life,
      drag: opts.drag,
      collide: opts.glow ? false : undefined,
    });
  }

  shake(strength: number, duration = 0.35) {
    if (strength >= this.shakeStrength * Math.max(0, 1 - this.shakeTime / this.shakeDuration)) {
      this.shakeStrength = strength;
      this.shakeDuration = duration;
      this.shakeTime = 0;
    }
  }

  flash(color: string, strength = 0.35, duration = 0.4) {
    this.hud.flash(color, strength, duration);
  }

  shockwave(at: Vec3, radius: number, color = '#ffb347') {
    const mat = new THREE.RawShaderMaterial({
      vertexShader: Shaders.fx.vertex,
      fragmentShader: Shaders.fx.fragment,
      glslVersion: THREE.GLSL3,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uIntensity: { value: 3 },
        uTime: { value: 0 },
        uMode: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.set(at.x, at.y + 0.15, at.z);
    mesh.frustumCulled = false;
    this.fxScene.add(mesh);
    this.rings.push({ mesh, age: 0, life: 0.55, radius });
    const c = linearColor(color);
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      this.particles.burstColor(at.x + Math.cos(a) * 0.8, at.y + 0.2, at.z + Math.sin(a) * 0.8, c, { count: 1, speed: 0.5, up: 3, size: 0.12, gravity: 10 });
    }
  }

  damageNumber(at: Vec3, amount: number, opts: { crit?: boolean; color?: string } = {}) {
    this.hud.damageNumber(new THREE.Vector3(at.x, at.y, at.z), amount, opts.crit ?? false, opts.color);
  }

  fireworks(at: Vec3, count = 5) {
    const palette: [number, number, number][] = [
      [1, 0.3, 0.2],
      [0.3, 0.8, 1],
      [1, 0.85, 0.2],
      [0.5, 1, 0.4],
      [1, 0.4, 0.9],
    ];
    for (let i = 0; i < count; i++) {
      this.rockets.push({
        pos: new THREE.Vector3(at.x + (Math.random() - 0.5) * 6, at.y, at.z + (Math.random() - 0.5) * 6),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 16 + Math.random() * 6, (Math.random() - 0.5) * 3),
        fuse: 0.9 + Math.random() * 0.6 + i * 0.25,
        color: palette[i % palette.length],
      });
    }
  }

  update(dt: number) {
    this.time += dt;
    // Shake: decaying noise offset.
    this.shakeTime += dt;
    const k = Math.max(0, 1 - this.shakeTime / this.shakeDuration);
    const s = this.shakeStrength * k * k;
    this.shakeOffset.set(Math.sin(this.time * 71) * s, Math.sin(this.time * 83 + 1.3) * s, Math.sin(this.time * 67 + 2.1) * s * 0.6);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        this.fxScene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      r.mesh.scale.setScalar(Math.max(0.1, e * r.radius));
      ((r.mesh.material as THREE.RawShaderMaterial).uniforms.uIntensity as { value: number }).value = 3 * (1 - t);
    }

    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.fuse -= dt;
      r.vel.y -= 9 * dt;
      r.pos.addScaledVector(r.vel, dt);
      this.particles.burstColor(r.pos.x, r.pos.y, r.pos.z, [1, 0.7, 0.4], { count: 1, speed: 0.3, up: 0, size: 0.06, glow: 1, life: 0.4, gravity: 2, collide: false });
      if (r.fuse <= 0) {
        this.particles.burstColor(r.pos.x, r.pos.y, r.pos.z, r.color, { count: 90, speed: 9, up: 0, size: 0.13, glow: 1.2, life: 1.3, gravity: 4, drag: 1.6, collide: false, spread: 0 });
        this.rockets.splice(i, 1);
      }
    }
  }

  clear() {
    for (const r of this.rings) this.fxScene.remove(r.mesh);
    this.rings = [];
    this.rockets = [];
    this.shakeStrength = 0;
  }
}
