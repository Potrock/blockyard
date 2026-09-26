import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Content } from '../content';
import type { ClientFigures, HeldPoint } from '../api/client/figures';
import type { AnimState, EntityGraphics, Figure } from '../render/entities';
import { Shaders } from '../render/shaders';
import type { EntityFrame, ProjectileFrame } from '../sim/entities';
import { heldView, partsOf, ShownFigure } from './figures';

/**
 * An entity's frame; or another player's figure's, made on this screen from their frame: whose it
 * is, and what they're doing.
 */
export type FigureFrame = EntityFrame & {
  player?: string;
  /** Crouching (1) or sliding (2). */
  posture?: number;
  /** Their held item's mechanics aim it where they look (a gun), 0 or 1; how far down its sights they look, 0..1. */
  aim?: number;
  sights?: number;
  /** Off the ground; sprinting; their held item's mechanics reloading it. */
  air?: boolean;
  sprint?: boolean;
  reloading?: boolean;
};

let streakGeo: THREE.BufferGeometry[] | null = null;

/** Two crossed quads, 0.8 long along +X and 0.22 wide, with the streak shader's UVs (v along the length). */
function streakGeometry(): THREE.BufferGeometry[] {
  if (!streakGeo) {
    const a = new THREE.PlaneGeometry(0.22, 0.8).rotateZ(-Math.PI / 2);
    streakGeo = [a, a.clone().rotateX(Math.PI / 2)];
  }
  return streakGeo;
}

function streakMaterial(color: string): THREE.RawShaderMaterial {
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
  /** What the mesh hangs from: on the figure's hand until client code puts it elsewhere. */
  mount: THREE.Object3D | null;
  /** The clip it was last told to play (`ClipFrame.seq`; 0: none). */
  clip: number;
  /** This frame's (its clip is started or stopped once it's animated). */
  frame: FigureFrame;
  /** The figure as client code sees it. */
  figure: ShownFigure;
}

interface Shot {
  group: THREE.Group;
  material: THREE.RawShaderMaterial;
}

const tmpColor = new THREE.Color();
const tmpV = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Draws the simulation's entities and projectiles: figures that turn to face where they look or
 * walk, with what they're doing kept for their animation (walking, attacking, looking, falling),
 * what's in their hands, hurt flashes, glows and death fades.
 *
 * Each frame: `sync` places the figures and keeps their state; client code poses them
 * (`client.figures`: the figures kit poses the humanoid rig's); then `finish` animates them (a
 * figure on the rig: its pose onto its model, its clips over that; others: their own animation,
 * unless client code posed them).
 */
export class EntityView {
  private shown = new Map<number, Shown>();
  private shots = new Map<number, Shot>();
  private time = 0;
  /** This frame's figures, in the frame's order, and its host time. */
  private drawn: Shown[] = [];
  private list: ShownFigure[] = [];
  private t = 0;
  /** The figures, for client code. */
  readonly figures: ClientFigures;

  constructor(
    private graphics: EntityGraphics,
    private scene: THREE.Scene,
    private world: VoxelWorld,
    private content: Content,
  ) {
    const view = this;
    this.figures = {
      get all() {
        return view.list;
      },
    };
  }

  /** `t`: the frame's host time (`SimFrame.t`), which clips are timed by. Then client code poses them, then `finish`. */
  sync(entities: FigureFrame[], projectiles: ProjectileFrame[], dt: number, running: boolean, t = 0) {
    this.time += dt;
    this.t = t;
    this.drawn = [];
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
        const anim: AnimState = { walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, posture: 0, speed: 0, moveX: 0, moveZ: 1, sights: 0, shotT: 9 };
        v = {
          model,
          anim,
          yaw: f.yaw,
          attacks: f.attacks,
          probeTimer: Math.random() * 0.2,
          height: def.hitbox.height,
          scale: def.model.scale,
          speed: def.speed,
          held: null,
          heldMesh: null,
          mount: null,
          clip: 0,
          frame: f,
          figure: new ShownFigure(f.id, f.player ?? null, f.type, def.model, partsOf(model), anim, (name) => this.point(f.id, name)),
        };
        this.shown.set(f.id, v);
      }
      v.frame = f;
      this.draw(v, f, dt, running);
      this.drawn.push(v);
    }
    for (const [id, v] of this.shown) {
      if (seen.has(id)) continue;
      this.hold(v, null);
      v.model.root.removeFromParent();
      v.model.dispose();
      this.shown.delete(id);
    }
    this.list = this.drawn.map((v) => v.figure);
    this.syncShots(projectiles);
  }

  /**
   * The frame's figures animated, once client code has posed them: a figure on the rig gets its
   * pose onto its model (what it holds going with its hand through a clip); others animate
   * themselves unless client code posed them. Then the clips the frame asks for start or stop.
   */
  finish() {
    for (const v of this.drawn) {
      if (v.model.rig || !v.figure.posed) v.model.animate(v.anim, v.heldMesh && v.mount);
      v.figure.posed = false;
      // A clip to play (on a screen that sees it late, part way through), or to stop.
      const clip = v.frame.clip;
      if ((clip?.seq ?? 0) !== v.clip) {
        v.clip = clip?.seq ?? 0;
        v.model.play?.(clip ? { name: clip.name, loop: clip.loop, fade: clip.fade, layer: clip.layer, speed: clip.speed, elapsed: this.t - clip.at } : null);
      }
    }
  }

  /** A point the item in a figure's hand marks (its `muzzle`), where it's drawn now; null if it holds none, or its model marks none. */
  point(id: number, name: HeldPoint): THREE.Vector3 | null {
    const v = this.shown.get(id);
    const m = v?.heldMesh;
    const p = name === 'muzzle' ? (m?.userData.muzzle as THREE.Vector3 | undefined) : v?.figure.held?.points[name];
    if (!m || !p || !m.parent) return null;
    m.updateWorldMatrix(true, false);
    return p.clone().applyMatrix4(m.matrixWorld);
  }

  /** Where an entity is drawn now (its feet), plus `offset`; false if it isn't drawn. */
  locate(id: number, offset: { x: number; y: number; z: number } | undefined, out: THREE.Vector3): boolean {
    const root = this.shown.get(id)?.model.root;
    if (!root || !root.visible) return false;
    out.copy(root.position);
    if (offset) out.set(out.x + offset.x, out.y + offset.y, out.z + offset.z);
    return true;
  }

  private draw(v: Shown, f: FigureFrame, dt: number, running: boolean) {
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
    a.posture += ((f.posture ?? 0) - a.posture) * k;
    if (running) {
      a.time += dt;
      a.attackT += dt;
      a.shotT = (a.shotT ?? 9) + dt;
      a.walkPhase += hs * dt * (4.2 / Math.max(0.6, v.scale));
    }
    // Its speed and which way it's going, in its own space (it faces +z): a humanoid steps that way.
    a.speed = hs;
    if (hs > 0.3) {
      const c = Math.cos(v.yaw);
      const sn = Math.sin(v.yaw);
      a.moveX = f.vx * c - f.vz * sn;
      a.moveZ = f.vx * sn + f.vz * c;
    }
    a.air = f.air ?? false;
    a.sprint = f.sprint ?? false;
    a.reloading = f.reloading ?? false;
    a.sights = (a.sights ?? 0) + ((f.sights ?? 0) - (a.sights ?? 0)) * k;
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
  }

  /**
   * Put an item in a figure's right hand (its model, or its sprite extruded), or empty it: it
   * hangs from the hand as its model has it until client code places it (`client.figures`: the
   * figures kit puts a humanoid's gun in both its hands, anything else in its fist).
   */
  private hold(v: Shown, item: string | null) {
    v.held = item;
    if (v.heldMesh) {
      v.heldMesh.removeFromParent();
      (v.heldMesh.material as THREE.Material).dispose();
      v.heldMesh = null;
      v.figure.held = null;
    }
    const def = item ? this.content.items.get(item) : undefined;
    const hand = v.model.pivots.get('armR');
    if (!item || !def || !hand) return;
    const look = this.graphics.itemLook(def);
    if (!look) {
      // A model whose file is still coming: try again next frame (a block-like item has none).
      if (def.hold?.model?.gltf || (typeof def.icon === 'object' && 'gltf' in def.icon)) v.held = null;
      return;
    }
    const { geometry, model } = look;
    const mesh = new THREE.Mesh(geometry, this.graphics.materialFor(look.albedo, look.emissive, look.surface));
    if (look.points?.muzzle) mesh.userData.muzzle = look.points.muzzle.clone();
    else if (model?.muzzle) mesh.userData.muzzle = new THREE.Vector3(...model.muzzle).divideScalar(16);
    // What it hangs from: the hand, until client code moves it (it stays where it's put).
    if (!v.mount) hand.add((v.mount = new THREE.Object3D()));
    v.mount.add(mesh);
    v.heldMesh = mesh;
    v.figure.held = heldView(item, def, mesh, v.mount, look);
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
      const material = streakMaterial(f.glow ?? '#ffffff');
      for (const g of streakGeometry()) {
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
    this.drawn = [];
    this.list = [];
    for (const s of this.shots.values()) {
      s.group.removeFromParent();
      s.material.dispose();
    }
    this.shots.clear();
  }
}
