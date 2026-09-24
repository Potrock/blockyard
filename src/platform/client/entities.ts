import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Content } from '../content';
import type { AnimState, EntityGraphics, ModelInstance } from '../render/entities';
import { Shaders } from '../render/shaders';
import type { EntityFrame, ProjectileFrame } from '../sim/entities';

let boltGeo: THREE.BufferGeometry[] | null = null;

/** Two crossed quads, 0.8 long along +X and 0.22 wide, with the bolt shader's UVs (v along the length). */
function boltGeometry(): THREE.BufferGeometry[] {
  if (!boltGeo) {
    const a = new THREE.PlaneGeometry(0.22, 0.8).rotateZ(-Math.PI / 2);
    boltGeo = [a, a.clone().rotateX(Math.PI / 2)];
  }
  return boltGeo;
}

function boltMaterial(color: string): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    vertexShader: Shaders.fx.vertex,
    fragmentShader: Shaders.fx.fragment,
    glslVersion: THREE.GLSL3,
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 4 }, uTime: { value: 0 }, uMode: { value: 3 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

interface Shown {
  model: ModelInstance;
  anim: AnimState;
  yaw: number;
  attacks: number;
  probeTimer: number;
  height: number;
  scale: number;
  speed: number;
}

interface Shot {
  group: THREE.Group;
  material: THREE.RawShaderMaterial;
}

const tmpColor = new THREE.Color();
const tmpV = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Draws the simulation's entities and projectiles: box models that turn to face where they look
 * or walk, walk cycles, attack swings, hurt flashes, glows and death fades.
 */
export class EntityView {
  private shown = new Map<number, Shown>();
  private shots = new Map<number, Shot>();
  private time = 0;

  constructor(
    private graphics: EntityGraphics,
    private scene: THREE.Scene,
    private world: VoxelWorld,
    private content: Content,
  ) {}

  sync(entities: EntityFrame[], projectiles: ProjectileFrame[], dt: number, running: boolean) {
    this.time += dt;
    const seen = new Set<number>();
    for (const f of entities) {
      seen.add(f.id);
      let v = this.shown.get(f.id);
      if (!v) {
        const def = this.content.entities.get(f.type);
        if (!def) continue;
        const model = this.graphics.buildModel(def.model);
        this.scene.add(model.root);
        v = {
          model,
          anim: { walkPhase: 0, walkAmount: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0 },
          yaw: f.yaw,
          attacks: f.attacks,
          probeTimer: Math.random() * 0.2,
          height: def.hitbox.height,
          scale: def.model.scale,
          speed: def.speed,
        };
        this.shown.set(f.id, v);
      }
      this.draw(v, f, dt, running);
    }
    for (const [id, v] of this.shown) {
      if (seen.has(id)) continue;
      v.model.root.removeFromParent();
      v.model.dispose();
      this.shown.delete(id);
    }
    this.syncShots(projectiles);
  }

  private draw(v: Shown, f: EntityFrame, dt: number, running: boolean) {
    const root = v.model.root;
    root.position.set(f.x, f.y, f.z);
    const hs = Math.hypot(f.vx, f.vz);
    // Facing: where it looks, else where it walks.
    let target = v.yaw;
    if (f.look) target = Math.atan2(f.look.x - f.x, f.look.z - f.z);
    else if (hs > 0.4) target = Math.atan2(f.vx, f.vz);
    let d = target - v.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    v.yaw += d * Math.min(1, dt * 9);
    root.rotation.y = v.yaw;

    const a = v.anim;
    if (f.attacks !== v.attacks) {
      v.attacks = f.attacks;
      a.attackT = 0;
    }
    a.raised = f.raised;
    a.casting = f.casting;
    if (running) {
      a.time += dt;
      a.attackT += dt;
      a.walkPhase += hs * dt * (4.2 / Math.max(0.6, v.scale));
    }
    a.walkAmount += (Math.min(1, hs / Math.max(1.2, v.speed * 0.7)) - a.walkAmount) * Math.min(1, dt * 8);
    if (f.look) {
      const eyeY = f.y + v.height * 0.85;
      const dist = Math.hypot(f.look.x - f.x, f.look.z - f.z) || 1;
      a.headPitch = Math.max(-0.6, Math.min(0.6, -Math.atan2(f.look.y - eyeY, dist)));
    } else {
      a.headPitch *= 0.9;
    }

    // Lighting probe (staggered), hurt flash, glow and death fade.
    v.probeTimer -= dt;
    const u = v.model.material.uniforms;
    if (v.probeTimer <= 0) {
      v.probeTimer = 0.15;
      const l = this.world.light_probe(Math.floor(f.x), Math.floor(f.y + v.height * 0.6), Math.floor(f.z));
      (u.uProbe.value as THREE.Vector2).set(l[0], l[1]);
    }
    const alive = f.dying < 0;
    const tint = u.uTint.value as THREE.Vector4;
    if (f.hurt > 0 || !alive) {
      tint.set(1.0, 0.12, 0.08, alive ? f.hurt * 0.7 : 0.55);
    } else if (f.glow) {
      tmpColor.set(f.glow);
      const pulse = 0.35 + 0.2 * Math.sin(this.time * 18);
      tint.set(tmpColor.r * 3, tmpColor.g * 3, tmpColor.b * 3, pulse);
    } else {
      tint.w = 0;
    }
    if (!alive) {
      a.dying = Math.min(1, f.dying / 0.35);
      (u.uOpacity as { value: number }).value = Math.max(0, 1 - Math.max(0, f.dying - 0.7) / 0.35);
    }
    v.model.animate(a);
  }

  private syncShots(frames: ProjectileFrame[]) {
    const seen = new Set<number>();
    for (const f of frames) {
      seen.add(f.id);
      let s = this.shots.get(f.id);
      if (!s) {
        s = this.makeShot(f);
        this.shots.set(f.id, s);
      }
      s.group.position.set(f.x, f.y, f.z);
      if (!f.stuck) {
        tmpV.set(f.vx, f.vy, f.vz);
        if (tmpV.lengthSq() > 1e-6) s.group.quaternion.setFromUnitVectors(X_AXIS, tmpV.normalize());
      }
    }
    for (const [id, s] of this.shots) {
      if (seen.has(id)) continue;
      s.group.removeFromParent();
      s.material.dispose();
      this.shots.delete(id);
    }
  }

  private makeShot(f: ProjectileFrame): Shot {
    const group = new THREE.Group();
    group.position.set(f.x, f.y, f.z);
    this.scene.add(group);
    if (!f.sprite) {
      // No sprite: a glowing bolt along +X (the direction of travel).
      const material = boltMaterial(f.glow ?? '#ffffff');
      for (const g of boltGeometry()) {
        const mesh = new THREE.Mesh(g, material);
        mesh.frustumCulled = false;
        group.add(mesh);
      }
      return { group, material };
    }
    const { geometry, atlas } = this.graphics.spriteGeometry(f.sprite);
    const material = this.graphics.material(atlas);
    if (f.glow) {
      tmpColor.set(f.glow);
      (material.uniforms.uTint.value as THREE.Vector4).set(tmpColor.r * 4, tmpColor.g * 4, tmpColor.b * 4, 0.7);
    }
    const shadow = this.graphics.shadowMaterial(atlas);
    for (let k = 0; k < 2; k++) {
      const mesh = new THREE.Mesh(geometry, material);
      // Sprites are drawn diagonally (tip top-right): align the diagonal with +X.
      mesh.rotation.set(0, 0, -Math.PI / 4);
      mesh.scale.setScalar(0.85);
      mesh.customDepthMaterial = shadow;
      const pivot = new THREE.Group();
      pivot.rotation.x = k * Math.PI * 0.5;
      pivot.add(mesh);
      group.add(pivot);
    }
    return { group, material };
  }

  /** Everything goes (restart). */
  clear() {
    for (const v of this.shown.values()) {
      v.model.root.removeFromParent();
      v.model.dispose();
    }
    this.shown.clear();
    for (const s of this.shots.values()) {
      s.group.removeFromParent();
      s.material.dispose();
    }
    this.shots.clear();
  }
}
