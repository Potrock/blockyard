import { engine } from '../engine/wasm';

export interface BlockDef {
  id: number;
  name: string;
  label: string;
  shape: 'air' | 'cube' | 'cross' | 'liquid';
  layer: number;
  /** Texture layer per face: +X -X +Y -Y +Z -Z. */
  tex: number[];
  tint: boolean;
  emit: number;
  solid: boolean;
  replaceable: boolean;
  placeable: boolean;
}

export interface Registry {
  blocks: BlockDef[];
  textures: string[];
  byName: Map<string, BlockDef>;
}

export function loadRegistry(): Registry {
  const json = JSON.parse(engine.block_registry_json()) as { blocks: BlockDef[]; textures: string[] };
  const byName = new Map(json.blocks.map((b) => [b.name, b]));
  return { blocks: json.blocks, textures: json.textures, byName };
}

/** Default biome tint used for icons and particles (sRGB 0..1). */
export const DEFAULT_TINT: [number, number, number] = [0.52, 0.76, 0.33];
