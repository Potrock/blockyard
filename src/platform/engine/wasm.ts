import init, { initSync } from '@engine/voxel_engine.js';
import * as engine from '@engine/voxel_engine.js';
import wasmUrl from '@engine/voxel_engine_bg.wasm?url';

export { engine };

let module: WebAssembly.Module | null = null;
let memory: WebAssembly.Memory | null = null;

/** Compile once, instantiate on the main thread, and keep the module for workers. */
export async function loadEngine(): Promise<WebAssembly.Module> {
  if (module) return module;
  const response = fetch(wasmUrl);
  module = await WebAssembly.compileStreaming(response).catch(async () => {
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return WebAssembly.compile(bytes);
  });
  const out = await init({ module_or_path: module });
  memory = out.memory;
  return module;
}

/** Headless (Node, tests): instantiate from the `.wasm` file's bytes, synchronously. */
export function loadEngineSync(bytes: BufferSource): WebAssembly.Module {
  if (module) return module;
  module = new WebAssembly.Module(bytes);
  memory = initSync({ module }).memory;
  return module;
}

export function wasmMemory(): WebAssembly.Memory {
  if (!memory) throw new Error('engine not loaded');
  return memory;
}
