/** Generator configuration shared by every worker (game structures, terraforming). */
export interface WorldGenConfig {
  flat?: number;
  terraforms: { x: number; z: number; radius: number; blend: number; height: number }[];
  blueprints: { origin: { x: number; y: number; z: number }; size: { x: number; y: number; z: number }; data: Uint8Array }[];
}

export type WorkerRequest =
  | { type: 'init'; module: WebAssembly.Module; seed: number; world: WorldGenConfig }
  | { type: 'gen'; id: number; cx: number; cz: number }
  | { type: 'mesh'; id: number; cx: number; cz: number; region: Uint8Array };

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'gen'; id: number; cx: number; cz: number; data: Uint8Array; ms: number }
  | { type: 'mesh'; id: number; cx: number; cz: number; data: Uint32Array; ms: number }
  | { type: 'error'; id: number; message: string };
