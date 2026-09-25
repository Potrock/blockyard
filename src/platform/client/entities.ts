import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Content } from '../content';
import type { AnimState, EntityGraphics, Figure } from '../render/entities';
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
  model: Figure;
  anim: AnimState;
  yaw: number;
  attacks: number;
  probeTimer: number;
  height: number;
  scale: number;
  speed: number;
  /** The item in its hand, and the mesh showing it. */
  held: string | null;
  heldMesh: THREE.Mesh | null;
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
        // A glTF model whose file hasn't arrived yet: drawn once it has.
        const model = this.graphics.figure(def.model);
        if (!model) continue;
        this.scene.add(model.root);
        v = {
          model,
          anim: { walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, stance: 0 },
          yaw: f.yaw,
          attacks: f.attacks,
          probeTimer: Math.random() * 0.2,
          height: def.hitbox.height,
          scale: def.model.scale,
          speed: def.speed,
          held: null,
          heldMesh: null,
        };
        this.shown.set(f.id, v);
      }
      this.draw(v, f, dt, running);
    }
    for (const [id, v] of this.shown) {
      if (seen.has(id)) continue;
      this.hold(v, null);
      v.model.root.removeFromParent();
      v.model.dispose();
      this.shown.delete(id);
    }
    this.syncShots(projectiles);
  }

  /** The muzzle of the gun in a figure's hand, where it's drawn now; false if it holds none. */
  muzzle(id: number, out: THREE.Vector3): boolean {
    const m = this.shown.get(id)?.heldMesh;
    const p = m?.userData.muzzle as THREE.Vector3 | undefined;
    if (!m || !p || !m.parent) return false;
    m.updateWorldMatrix(true, false);
    out.copy(p).applyMatrix4(m.matrixWorld);
    return true;
  }

  /** Where an entity is drawn now (its feet), plus `offset`; false if it isn't drawn. */
  locate(id: number, offset: { x: number; y: number; z: number } | undefined, out: THREE.Vector3): boolean {
    const root = this.shown.get(id)?.model.root;
    if (!root || !root.visible) return false;
    out.copy(root.position);
    if (offset) out.set(out.x + offset.x, out.y + offset.y, out.z + offset.z);
    return true;
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
    const k = Math.min(1, dt * 12);
    a.aim += ((f.aim ?? 0) - a.aim) * k;
    a.stance += ((f.stance ?? 0) - a.stance) * k;
    if (running) {
      a.time += dt;
      a.attackT += dt;
      a.walkPhase += hs * dt * (4.2 / Math.max(0.6, v.scale));
    }
    a.walkAmount += (Math.min(1, hs / Math.max(1.2, v.speed * 0.7)) - a.walkAmount) * Math.min(1, dt * 8);
    a.pace = hs / Math.max(0.1, v.speed);
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
    } else if (a.dying > 0) {
      // Back from the dead (a player revived): standing, and seen, again.
      a.dying = 0;
      (u.uOpacity as { value: number }).value = 1;
    }
    if ((f.held ?? null) !== v.held) this.hold(v, f.held ?? null);
    if (v.heldMesh) {
      // Lit like the body.
      const hu = (v.heldMesh.material as THREE.RawShaderMaterial).uniforms;
      (hu.uProbe.value as THREE.Vector2).copy(u.uProbe.value as THREE.Vector2);
      (hu.uOpacity as { value: number }).value = (u.uOpacity as { value: number }).value;
    }
    v.model.animate(a);
  }

  /** Put an item in a figure's right hand (its model, or its sprite extruded), or empty it. */
  private hold(v: Shown, item: string | null) {
    v.held = item;
    if (v.heldMesh) {
      v.heldMesh.removeFromParent();
      (v.heldMesh.material as THREE.Material).dispose();
      v.heldMesh = null;
    }
    const def = item ? this.content.items.get(item) : undefined;
    const arm = v.model.pivots.get('armR');
    if (!def || !arm) return;
    const look = this.graphics.itemLook(def);
    if (!look) {
      // A model whose file is still coming: try again next frame (a block-like item has none).
      if (def.hold?.model?.gltf || (typeof def.icon === 'object' && 'gltf' in def.icon)) v.held = null;
      return;
    }
    const { geometry, model } = look;
    const mesh = new THREE.Mesh(geometry, this.graphics.materialFor(look.albedo, look.emissive));
    // In the fist at the end of the hanging arm (the figure faces +z). A held model runs along
    // +z already: tilt it up a little, its grip in the fist. A sprite stands on edge, turned so
    // its handle-to-tip diagonal points forward and up, the handle (lower left) in the fist. A
    // gun runs along the arm (raised to aim, it points where the figure looks).
    const isGun = def.kind === 'gun';
    const scale = isGun ? 0.7 : model ? 0.5 : 0.62;
    mesh.scale.setScalar(scale);
    if (isGun) mesh.rotation.set(Math.PI / 2, 0, 0);
    else if (model) mesh.rotation.set(-0.3, 0, 0);
    else mesh.rotation.set(0, -Math.PI / 2, 0);
    if (look.points?.muzzle) mesh.userData.muzzle = look.points.muzzle.clone();
    else if (model?.muzzle) mesh.userData.muzzle = new THREE.Vector3(...model.muzzle).divideScalar(16);
    const gripPx = model?.grip ?? (look.points?.grip ? (look.points.grip.toArray().map((v) => v * 16) as [number, number, number]) : undefined);
    const grip = model ? new THREE.Vector3(...(gripPx ?? [0, 0, 0])).divideScalar(16) : new THREE.Vector3(-0.28, -0.28, 0);
    grip.multiplyScalar(scale).applyEuler(mesh.rotation);
    mesh.position.set(0, -0.66, 0).sub(grip);
    arm.add(mesh);
    v.heldMesh = mesh;
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
