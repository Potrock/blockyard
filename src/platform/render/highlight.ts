import * as THREE from 'three';

const STAGES = 10;
const SIZE = 16;

/**
 * Crack overlays for block breaking, like Minecraft's `destroy_stage_0..9`: dark cracks that
 * branch out from the middle of each face as the block gets closer to breaking.
 */
function crackStages(): THREE.DataTexture[] {
  // Random walks out from the centre; each pixel remembers when it cracked (0..1).
  const when = new Float32Array(SIZE * SIZE).fill(2);
  let seed = 1337;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const branches = 7;
  for (let b = 0; b < branches; b++) {
    let x = 7.5 + (rnd() - 0.5) * 2;
    let y = 7.5 + (rnd() - 0.5) * 2;
    let a = (b / branches) * Math.PI * 2 + rnd() * 0.6;
    const start = b < 3 ? 0 : 0.25 + rnd() * 0.35;
    const steps = 9 + Math.floor(rnd() * 6);
    for (let i = 0; i < steps; i++) {
      const t = start + (1 - start) * (i / steps);
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (ix >= 0 && iy >= 0 && ix < SIZE && iy < SIZE) when[iy * SIZE + ix] = Math.min(when[iy * SIZE + ix], t);
      a += (rnd() - 0.5) * 1.1;
      x += Math.cos(a);
      y += Math.sin(a);
      // Side twigs late in the break.
      if (rnd() < 0.2) {
        const tx = Math.floor(x + Math.cos(a + 1.6));
        const ty = Math.floor(y + Math.sin(a + 1.6));
        if (tx >= 0 && ty >= 0 && tx < SIZE && ty < SIZE) when[ty * SIZE + tx] = Math.min(when[ty * SIZE + tx], Math.min(1, t + 0.2));
      }
    }
  }
  const out: THREE.DataTexture[] = [];
  for (let s = 0; s < STAGES; s++) {
    const shown = (s + 1) / STAGES;
    const px = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const on = when[i] <= shown;
      px[i * 4 + 3] = on ? (when[i] < shown - 0.3 ? 210 : 170) : 0;
    }
    const tex = new THREE.DataTexture(px, SIZE, SIZE, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    out.push(tex);
  }
  return out;
}

/** The block the player is aiming at: a thin outline, with break cracks while it's being mined. */
export class BlockHighlight {
  readonly object = new THREE.Group();
  private crack: THREE.Mesh;
  private crackMat: THREE.MeshBasicMaterial;
  private stages = crackStages();

  constructor() {
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    edges.renderOrder = 10;
    this.crackMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: this.stages[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), this.crackMat);
    this.crack.renderOrder = 9;
    this.object.add(edges, this.crack);
    this.object.visible = false;
  }

  /** Show it on block (x, y, z) (`cross`: a plant, drawn smaller), or hide it with null. */
  set(at: { x: number; y: number; z: number } | null, cross = false, progress?: number) {
    this.object.visible = !!at;
    if (!at) return;
    const s = cross ? 0.72 : 1;
    this.object.position.set(Math.floor(at.x) + 0.5, Math.floor(at.y) + (cross ? 0.45 : 0.5), Math.floor(at.z) + 0.5);
    this.object.scale.set(s, cross ? 0.9 : 1, s);
    // The scene it lives in doesn't update matrices by itself.
    this.object.updateMatrixWorld(true);
    const cracking = progress !== undefined && progress > 0;
    this.crack.visible = cracking;
    if (cracking) this.crackMat.map = this.stages[Math.min(STAGES - 1, Math.floor(progress * STAGES))];
  }
}
