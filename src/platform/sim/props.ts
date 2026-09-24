import * as THREE from 'three';
import type { BlockRef, Prop, PropApi, PropModel, Vec3 } from '../api/types';
import type { Blueprint } from '../api/blueprint';
import type { Content } from '../content';
import type { Registry } from '../world/registry';

/** A bolt's look (a glowing streak along -z). */
export interface BoltSpec {
  color: string;
  length?: number;
  width?: number;
  intensity?: number;
}

/** One prop as the client draws it. */
export interface PropFrame {
  id: number;
  /** A block model (`props.model`), or a bolt. */
  model?: number;
  bolt?: BoltSpec;
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

class PropState implements Prop {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  scale = 1;
  visible = true;
  flashColor = '#ffffff';
  flashT = 0;
  removed = false;

  constructor(
    readonly id: number,
    readonly model: number | undefined,
    readonly bolt: BoltSpec | undefined,
    private onRemove: (p: PropState) => void,
  ) {}

  flash(color = '#ffffff', seconds = 0.12) {
    this.flashColor = color;
    this.flashT = seconds;
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.onRemove(this);
  }
}

/**
 * Props on the simulation side: where each block build and bolt is, how big, whether it's
 * showing and flashing. The client meshes the blueprints and draws them from `frame()`.
 */
export class PropSim implements PropApi {
  private props: PropState[] = [];
  private nextModel = 1;
  private nextProp = 1;

  constructor(
    private registry: Registry,
    private resolve: (block: BlockRef) => number,
    private content: Content,
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
    const p = new PropState(this.nextProp++, model, bolt, (x) => {
      const i = this.props.indexOf(x);
      if (i >= 0) this.props.splice(i, 1);
    });
    this.props.push(p);
    return p;
  }

  spawn(model: PropModel, opts: { position?: Vec3; scale?: number } = {}): Prop {
    const p = this.add((model as PropModelImpl).id, undefined);
    if (opts.position) p.position.set(opts.position.x, opts.position.y, opts.position.z);
    if (opts.scale) p.scale = opts.scale;
    return p;
  }

  bolt(opts: BoltSpec): Prop {
    return this.add(undefined, { ...opts });
  }

  /** Hit flashes fade. */
  update(dt: number) {
    for (const p of this.props) if (p.flashT > 0) p.flashT = Math.max(0, p.flashT - dt);
  }

  clear() {
    for (const p of [...this.props]) p.remove();
  }

  frame(): PropFrame[] {
    return this.props.map((p) => ({
      id: p.id,
      model: p.model,
      bolt: p.bolt,
      p: [p.position.x, p.position.y, p.position.z],
      q: [p.quaternion.x, p.quaternion.y, p.quaternion.z, p.quaternion.w],
      scale: p.scale,
      visible: p.visible,
      flash: p.flashT > 0 ? [p.flashColor, p.flashT] : null,
    }));
  }
}
