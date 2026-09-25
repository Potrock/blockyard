import * as THREE from 'three';
import type { ItemDefinition, ItemStack, ThrowableItem, Vec3 } from '../api/types';
import type { Sfx } from '../audio/sfx';
import type { Content } from '../content';
import type { Effects } from '../fx/effects';
import type { EntityGraphics } from '../render/entities';
import { flyFor, isThrowable, newFlight, throwable, throwVelocity, type Flight, type FlightWorld, type Throwable } from '../sim/throwables';
import type { GameHud } from '../ui/hudkit';

/** A throw this screen made: for the host (`PlayerInput.throws`), and to fly here at once. */
export interface ThrowMade {
  serial: number;
  item: string;
  from: Vec3;
  v: Vec3;
  cooked: number;
}

/** The controls a throw reads this frame. */
export interface ThrowControls {
  active: boolean;
  isDown(code: string): boolean;
  /** The fire button, held (for a throwable in hand). */
  fire: boolean;
}

/**
 * This player's throwables on their own screen: hold a throwable's `key` (or, with one in hand,
 * the fire button) to pull the pin and cook it, let go to throw it: at once, here (it flies on
 * this screen from this moment, see `FlightView`), and to the host with the next controls. What
 * the hotbar shows is the host's word, less the throws it hasn't heard of yet.
 */
export class ThrowController {
  /** Throws made here so far (the host says which it has taken: `PlayerFrame.throws`). */
  serial = 0;
  /** Being cooked: which, for how long, and with which key (null: the fire button). */
  cooking: { item: string; def: ThrowableItem; t: Throwable; held: number; key: string | null } | null = null;
  /** Seconds since the last throw here (its cooldown; the hand's toss). */
  sinceThrow = 99;
  /** The throw just made, for the hand: which item (until the toss is over). */
  tossed: string | null = null;
  private keysWere = new Set<string>();

  constructor(private items: Map<string, ItemDefinition>) {}

  /** How many of `item` they have, less the throws the host hasn't taken yet. */
  count(slots: (ItemStack | null)[], item: string, taken: number): number {
    let n = 0;
    for (const s of slots) if (s?.item === item) n += s.count;
    return Math.max(0, n - Math.max(0, this.serial - taken));
  }

  /** The throwables they carry with a key of their own (the HUD shows them), in hotbar order. */
  quick(slots: (ItemStack | null)[]): string[] {
    const out: string[] = [];
    for (const s of slots) {
      const d = s ? this.items.get(s.item) : undefined;
      if (s && isThrowable(d) && d.key && !out.includes(s.item)) out.push(s.item);
    }
    return out;
  }

  /**
   * A frame: start cooking, cook, throw. `eye` is where they are now (as this screen has them),
   * `yaw` / `pitch` the view. Returns a throw made, if one was.
   */
  update(dt: number, c: ThrowControls, slots: (ItemStack | null)[], held: string | null, taken: number, eye: Vec3, yaw: number, pitch: number, sound: (name: string) => void): ThrowMade | null {
    this.sinceThrow += dt;
    // Gone from the hand as the toss follows through: the hand goes down for what's next.
    if (this.sinceThrow > 0.28) this.tossed = null;
    const down = new Set<string>();
    if (!c.active) {
      this.cooking = null;
      this.keysWere.clear();
      return null;
    }
    let made: ThrowMade | null = null;
    const k = this.cooking;
    if (k) {
      k.held += dt;
      const still = k.key ? c.isDown(k.key) : c.fire;
      if (k.key) down.add(k.key);
      // Let go, or held past its fuse (it goes off in the hand).
      if (!still || (k.t.cook && k.held >= k.t.fuse)) {
        this.cooking = null;
        made = { serial: ++this.serial, item: k.item, from: eye, v: throwVelocity(k.t, yaw, pitch), cooked: k.held };
        this.sinceThrow = 0;
        this.tossed = k.item;
        sound(k.def.sounds?.use ?? 'whoosh');
      }
    } else {
      const start = (item: string, def: ThrowableItem, key: string | null) => {
        const t = throwable(def);
        if (this.sinceThrow < t.cooldown || this.count(slots, item, taken) < 1) return false;
        this.cooking = { item, def, t, held: 0, key };
        if (def.sounds?.draw) sound(def.sounds.draw);
        return true;
      };
      for (const s of slots) {
        const d = s ? this.items.get(s.item) : undefined;
        if (!s || !isThrowable(d) || !d.key) continue;
        if (c.isDown(d.key)) {
          down.add(d.key);
          if (!this.keysWere.has(d.key) && start(s.item, d, d.key)) break;
        }
      }
      const d = held ? this.items.get(held) : undefined;
      if (!this.cooking && held && isThrowable(d) && c.fire && !this.fireWas) start(held, d, null);
    }
    this.fireWas = c.fire;
    this.keysWere = down;
    return made;
  }
  private fireWas = false;

  /** The item the hand shows for a throw (cooking one by its key, or just thrown), if any. */
  get inHand(): string | null {
    return this.cooking?.key ? this.cooking.item : this.tossed;
  }

  reset() {
    this.cooking = null;
    this.tossed = null;
    this.sinceThrow = 99;
  }
}

/** One throwable in the air as this screen flies it. */
interface Shown {
  key: string;
  item: string;
  t: Throwable;
  f: Flight;
  acc: { t: number };
  /** Its mesh (null until its model's here), spun about an axis. */
  mesh: THREE.Object3D | null;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  age: number;
  /** Thrown here: it starts from the hand (drawn from there to its path over a moment). */
  from: THREE.Vector3 | null;
  /** The host set it off (or turned it down): seconds since, and where. */
  over: number;
  /** Came to its fuse here before the host's word: it waits where it is. */
  waiting: number;
  lastHit: number;
}

/** A fire burning on this screen: flames on the ground round it for its while. */
interface FireShown {
  id: number;
  at: Vec3;
  radius: number;
  left: number;
  color: [number, number, number];
  /** Spots on the ground where flames rise (worked out once, from the blocks). */
  spots: Vec3[];
  crackle: number;
}

export interface FlightViewParts {
  content: Content;
  graphics: EntityGraphics;
  scene: THREE.Scene;
  fx: Effects;
  sfx: Sfx;
  hud: GameHud;
  /** The blocks, as flights meet them (the same as the host's). */
  world: FlightWorld;
}

const tmp = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

/**
 * Throwables in the air on this screen, and the fires they start: each flown step by step as the
 * host flies it (`sim/throwables`), from the throw (ours: from the moment we threw; others': from
 * the host's word), drawn spinning, knocking as it bounces, with a warning marker when one that
 * can hurt is near. It goes when the host says it went off.
 */
export class FlightView {
  private shown = new Map<string, Shown>();
  private fires = new Map<number, FireShown>();
  private materials = new Map<THREE.Texture, THREE.RawShaderMaterial>();
  private time = 0;

  constructor(private p: FlightViewParts) {}

  /** One in the air: from `from` at `v`, going off `fuse` steps on; thrown here (`hand`: where the hand is now). */
  add(key: string, item: string, from: Vec3, v: Vec3, fuse: number, hand?: THREE.Vector3) {
    const def = this.p.content.items.get(item);
    if (!isThrowable(def) || this.shown.has(key)) return;
    const axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.shown.set(key, {
      key,
      item,
      t: throwable(def),
      f: newFlight(from, v, fuse),
      acc: { t: 0 },
      mesh: null,
      axis: axis.lengthSq() > 0 ? axis : X.clone(),
      spin: 8 + Math.random() * 6,
      angle: 0,
      age: 0,
      from: hand?.clone() ?? null,
      over: -1,
      waiting: 0,
      lastHit: -1,
    });
  }

  /** The host set one off at `at` (or turned it down: null). */
  end(key: string, at: [number, number, number] | null) {
    const s = this.shown.get(key);
    if (!s) return;
    if (at) s.f.x = at[0];
    if (at) s.f.y = at[1];
    if (at) s.f.z = at[2];
    this.drop(s);
  }

  /** A fire where a molotov broke. */
  fire(id: number, at: Vec3, radius: number, duration: number, color: string) {
    const c = new THREE.Color(color);
    const spots: Vec3[] = [];
    const w = this.p.world;
    // Where the flames can stand: the ground in reach of its middle, found by looking down.
    for (let i = 0; i < 40; i++) {
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = radius * Math.sqrt((i + 0.5) / 40);
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      const top = at.y + 1.2;
      const h = w.hit(x, top, z, 0, -1, 0, 3);
      if (h && h.ny > 0.5) spots.push({ x, y: top - h.t + 0.02, z });
    }
    if (!spots.length) spots.push({ ...at });
    this.fires.set(id, { id, at, radius, left: duration, color: [c.r, c.g, c.b], spots, crackle: 0 });
  }

  /** The live ones that could hurt, near a point (their warning markers). */
  private near(s: Shown, cam: THREE.Vector3): boolean {
    const reach = (s.t.blast?.radius ?? 0) + (s.t.fire ? s.t.fire.radius : 0) + 2.5;
    return reach > 2.5 && s.over < 0 && Math.hypot(s.f.x - cam.x, s.f.y - cam.y, s.f.z - cam.z) < reach;
  }

  update(dt: number, running: boolean, camera: THREE.Camera) {
    this.time += dt;
    const cam = camera.position;
    for (const s of [...this.shown.values()]) {
      s.age += dt;
      if (running && s.waiting === 0) {
        const done = flyFor(s.f, s.t, this.p.world, s.acc, dt, (speed) => {
          // A knock as it bounces (not a clatter of them as it rolls).
          if (speed < 1.5 || this.time - s.lastHit < 0.12) return;
          s.lastHit = this.time;
          this.p.sfx.play(s.t.def.sounds?.hit ?? 'bounce', { at: { x: s.f.x, y: s.f.y, z: s.f.z }, volume: Math.min(1, 0.25 + speed / 10) });
        });
        // Its time's up here: it waits where it is for the host's word (which is coming).
        if (done) s.waiting = 0.0001;
      }
      if (s.waiting > 0) {
        s.waiting += dt;
        if (s.waiting > 1.5) {
          this.drop(s);
          continue;
        }
      }
      this.draw(s, dt);
      // A trail (a lit rag's flame).
      if (s.t.def.trail && running) this.p.fx.burst({ x: s.f.x, y: s.f.y, z: s.f.z }, { color: s.t.def.trail, count: 2, speed: 0.4, size: 0.1, glow: 2, life: 0.35, gravity: -2 });
      const id = `$throw:${s.key}`;
      if (this.near(s, cam)) this.p.hud.marker(id, { x: s.f.x, y: s.f.y + 0.15, z: s.f.z }, { shape: 'ring', color: '#ff3b30', label: '⚠', pulse: true, edge: true, size: 30 });
      else this.p.hud.marker(id, null);
    }
    for (const f of [...this.fires.values()]) {
      if (running) f.left -= dt;
      if (f.left <= 0) {
        this.fires.delete(f.id);
        continue;
      }
      this.burn(f, dt);
    }
  }

  /** Flames and smoke rising from its spots; fewer as it dies down. */
  private burn(f: FireShown, dt: number) {
    const fade = Math.min(1, f.left / 1.5);
    const n = Math.max(1, Math.round(f.spots.length * 0.2 * fade * Math.min(2, dt * 60)));
    for (let i = 0; i < n; i++) {
      const s = f.spots[Math.floor(Math.random() * f.spots.length)];
      const at = { x: s.x + (Math.random() - 0.5) * 0.3, y: s.y + 0.1, z: s.z + (Math.random() - 0.5) * 0.3 };
      const [r, g, b] = f.color;
      // Tongues of flame, yellower at the root; now and then a wisp of smoke off the top.
      this.p.fx.burst(at, { color: `rgb(${Math.round(Math.min(1, r * 1.1) * 255)}, ${Math.round(g * (0.8 + Math.random() * 0.5) * 255)}, ${Math.round(b * 255)})`, count: 2, speed: 0.45, size: 0.1 + Math.random() * 0.12, glow: 2.2, life: 0.4 + Math.random() * 0.35, gravity: -5, drag: 1.5 });
      if (Math.random() < 0.08) this.p.fx.burst({ x: at.x, y: at.y + 1, z: at.z }, { color: '#5a534d', count: 1, speed: 0.3, size: 0.26, life: 1.2, gravity: -2.5, drag: 1 });
    }
    f.crackle -= dt;
    if (f.crackle <= 0) {
      f.crackle = 0.35 + Math.random() * 0.4;
      this.p.sfx.play('fire', { at: f.at, volume: 0.35 * fade });
    }
  }

  private draw(s: Shown, dt: number) {
    if (!s.mesh) s.mesh = this.make(s.item);
    const o = s.mesh;
    if (!o) return;
    if (!s.f.rest) s.angle += s.spin * dt * (s.f.ground ? 0.5 : 1);
    o.quaternion.setFromAxisAngle(s.axis, s.angle);
    o.position.set(s.f.x, s.f.y, s.f.z);
    // Ours leaves the hand: drawn from it onto its path over the first moment.
    if (s.from && s.age < 0.15) o.position.lerp(tmp.copy(s.from), 1 - s.age / 0.15);
  }

  private make(item: string): THREE.Object3D | null {
    const def = this.p.content.items.get(item);
    if (!def) return null;
    const look = this.p.graphics.itemLook(def);
    if (!look) return null;
    let m = this.materials.get(look.albedo);
    if (!m) {
      m = this.p.graphics.materialFor(look.albedo, look.emissive, look.surface);
      this.materials.set(look.albedo, m);
    }
    const mesh = new THREE.Mesh(look.geometry, m);
    mesh.customDepthMaterial = this.p.graphics.gltf.shadow(look.albedo);
    look.geometry.computeBoundingSphere();
    const sphere = look.geometry.boundingSphere!;
    // A model at about three fifths of its own size (they're made big, for the hand); a sprite smaller.
    const k = look.model ? 0.6 : 0.35;
    mesh.scale.setScalar(k);
    // Spun about its middle.
    mesh.position.copy(sphere.center).multiplyScalar(-k);
    if (!look.model) mesh.position.set(-0.5 * k, -0.5 * k, 0);
    const group = new THREE.Group();
    group.add(mesh);
    this.p.scene.add(group);
    return group;
  }

  private drop(s: Shown) {
    s.mesh?.removeFromParent();
    this.p.hud.marker(`$throw:${s.key}`, null);
    this.shown.delete(s.key);
  }

  clear() {
    for (const s of [...this.shown.values()]) this.drop(s);
    this.fires.clear();
  }
}
