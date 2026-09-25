import * as THREE from 'three';
import type { BlockRef, Player, Prop, PropApi, PropModel, Vec3 } from '../api/types';
import type { Blueprint } from '../api/blueprint';
import type { Content } from '../content';
import type { Registry } from '../world/registry';

/** A bolt's look (a glowing streak along -z). */
export interface BoltSpec {
  color: string;
  length?: number;
  width?: number;
  intensity?: number;
  /** Wavers in length by up to this fraction, on its own (flames). */
  flicker?: number;
  /** Past this many blocks from the camera it grows with the distance (stays visible). */
  far?: number;
}

/** What props need of the simulation: its clock, and a player's last applied input. */
export interface PropHooks {
  clock(): number;
  ack(p: Player): { id: string; seq: number } | null;
}

/** One prop as the client draws it. */
export interface PropFrame {
  id: number;
  /** A block model (`props.model`), or a bolt. */
  model?: number;
  bolt?: BoltSpec;
  /** The prop it rides on (`attach`): `p` and `q` are on that one. */
  parent?: number;
  /** The glTF animation it loops (`play`), if any. */
  anim?: string;
  /** Flying on its own (`launch`): from `p` at `v` since game clock `t`; fired `by` a player, at their input `seq`. */
  v?: [number, number, number];
  t?: number;
  by?: string;
  seq?: number;
  p: [number, number, number];
  q: [number, number, number, number];
  scale: number;
  visible: boolean;
  /** A hit flash: colour and seconds left. */
  flash: [string, number] | null;
}

class PropModelImpl implements PropModel {
  constructor(
    readonly id: number,
    readonly radius: number,
    readonly blocks: number,
  ) {}
}

export class PropState implements Prop {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  scale = 1;
  visible = true;
  flashColor = '#ffffff';
  flashT = 0;
  removed = false;
  parent: PropState | null = null;
  /** What rides on it (they go when it goes). */
  readonly riders = new Set<PropState>();
  /** Flying on its own (`launch`): from `origin` at `velocity` since game clock `since`. */
  velocity: THREE.Vector3 | null = null;
  readonly origin = new THREE.Vector3();
  since = 0;
  by: { id: string; seq: number } | null = null;
  /** Where it was put last (moved since: the game took over). */
  readonly placed = new THREE.Vector3();
  /** The glTF animation it loops (`play`). */
  anim: string | null = null;

  constructor(
    readonly id: number,
    readonly model: number | undefined,
    readonly bolt: BoltSpec | undefined,
    private onRemove: (p: PropState) => void,
    private hooks: PropHooks,
  ) {}

  launch(from: Vec3, velocity: Vec3, opts: { by?: Player } = {}) {
    this.origin.set(from.x, from.y, from.z);
    this.position.copy(this.origin);
    this.placed.copy(this.origin);
    this.velocity = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    this.since = this.hooks.clock();
    this.by = opts.by ? this.hooks.ack(opts.by) : null;
  }

  play(animation: string | null) {
    this.anim = animation;
  }

  /** Flying: on to where it is now (unless the game moved it, which stops the flight). */
  fly() {
    if (!this.velocity) return;
    if (!this.position.equals(this.placed)) {
      this.velocity = null;
      return;
    }
    this.position.copy(this.origin).addScaledVector(this.velocity, this.hooks.clock() - this.since);
    this.placed.copy(this.position);
  }

  flash(color = '#ffffff', seconds = 0.12) {
    this.flashColor = color;
    this.flashT = seconds;
  }

  attach(parent: Prop | null) {
    const to = parent as PropState | null;
    if (to === this.parent) return;
    // Never onto itself or something riding on it.
    for (let p = to; p; p = p.parent) if (p === this) throw new Error('prop.attach: a prop can\'t ride on itself');
    this.parent?.riders.delete(this);
    this.parent = to && !to.removed ? to : null;
    this.parent?.riders.add(this);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    for (const r of [...this.riders]) r.remove();
    this.parent?.riders.delete(this);
    this.onRemove(this);
  }
}

/**
 * Props on the simulation side: where each block build and bolt is, how big, whether it's
 * showing and flashing. The client meshes the blueprints and draws them from `frame()`.
 */
export class PropSim implements PropApi {
  private props: PropState[] = [];
  /** glTF models' default animations (`props.gltf`'s `animation`). */
  private gltfAnims = new Map<number, string | null>();
  private nextModel = 1;
  private nextProp = 1;

  constructor(
    private registry: Registry,
    private resolve: (block: BlockRef) => number,
    private content: Content,
    private hooks: PropHooks,
  ) {}

  model(bp: Blueprint, opts: { scale?: number; pivot?: Vec3 } = {}): PropModel {
    const scale = opts.scale ?? 1;
    const pv = opts.pivot ?? { x: 0, y: 0, z: 0 };
    // Size from the blocks themselves: the farthest cube corner from the pivot.
    let r2 = 0;
    let count = 0;
    bp.forEach((x, y, z, block) => {
      const def = this.registry.blocks[this.resolve(block)];
      if (!def || def.shape !== 'cube') return;
      count++;
      for (const cx of [x, x + 1])
        for (const cy of [y, y + 1])
          for (const cz of [z, z + 1]) r2 = Math.max(r2, ((cx - pv.x) * scale) ** 2 + ((cy - pv.y) * scale) ** 2 + ((cz - pv.z) * scale) ** 2);
    });
    const m = new PropModelImpl(this.nextModel++, Math.sqrt(r2), count);
    this.content.defineModel(m.id, bp, opts);
    return m;
  }

  private add(model: number | undefined, bolt: BoltSpec | undefined): PropState {
    const p = new PropState(
      this.nextProp++,
      model,
      bolt,
      (x) => {
        const i = this.props.indexOf(x);
        if (i >= 0) this.props.splice(i, 1);
      },
      this.hooks,
    );
    this.props.push(p);
    return p;
  }

  spawn(model: PropModel, opts: { position?: Vec3; scale?: number } = {}): Prop {
    const p = this.add((model as PropModelImpl).id, undefined);
    p.anim = this.gltfAnims.get((model as PropModelImpl).id) ?? null;
    if (opts.position) p.position.set(opts.position.x, opts.position.y, opts.position.z);
    if (opts.scale) p.scale = opts.scale;
    return p;
  }

  gltf(url: string, opts: { scale?: number; radius?: number; animation?: string } = {}): PropModel {
    const m = new PropModelImpl(this.nextModel++, opts.radius ?? 1, 0);
    this.gltfAnims.set(m.id, opts.animation ?? null);
    this.content.defineGltfModel(m.id, url, { scale: opts.scale, animation: opts.animation });
    return m;
  }

  bolt(opts: BoltSpec): Prop {
    return this.add(undefined, { ...opts });
  }

  /** Hit flashes fade; launched props fly on. */
  update(dt: number) {
    for (const p of this.props) {
      if (p.flashT > 0) p.flashT = Math.max(0, p.flashT - dt);
      p.fly();
    }
  }

  clear() {
    for (const p of [...this.props]) p.remove();
  }

  private ordered(): PropState[] {
    if (!this.props.some((p) => p.parent)) return this.props;
    const out: PropState[] = [];
    const done = new Set<PropState>();
    const visit = (p: PropState) => {
      if (done.has(p)) return;
      if (p.parent) visit(p.parent);
      done.add(p);
      out.push(p);
    };
    for (const p of this.props) visit(p);
    return out;
  }

  frame(): PropFrame[] {
    // Parents before what rides on them (a client places riders on their parents).
    return this.ordered().map((p) => ({
      id: p.id,
      model: p.model,
      bolt: p.bolt,
      parent: p.parent?.id,
      anim: p.anim ?? undefined,
      // Flying: where it started, and how (the same every tick, so nothing is sent while it flies).
      ...(p.velocity ? { v: [p.velocity.x, p.velocity.y, p.velocity.z] as [number, number, number], t: p.since, by: p.by?.id, seq: p.by?.seq } : {}),
      p: p.velocity ? [p.origin.x, p.origin.y, p.origin.z] : [p.position.x, p.position.y, p.position.z],
      q: [p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w],
      scale: p.scale,
      visible: p.visible,
      flash: p.flashT > 0 ? [p.flashColor, p.flashT] : null,
    }));
  }
}
