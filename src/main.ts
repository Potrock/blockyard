import { Runtime } from './platform/runtime';
import { devGames, games } from './games';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

// In development, `__game` is the running game (tests reach in); switching games replaces it.
if (import.meta.env.DEV) Runtime.onStart = (rt) => ((window as unknown as { __game: Runtime }).__game = rt);

devGames()
  .then((previews) => Runtime.start(canvas, ui, games, previews, () => new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' })))
  .catch((err: unknown) => {
    console.error(err);
    const box = document.createElement('div');
    box.className = 'screen';
    const msg = document.createElement('div');
    msg.className = 'error-box';
    msg.textContent = `Failed to start the engine.\n\n${err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)}\n\nThis game needs a browser with WebGL2 and WebAssembly SIMD (recent Chrome, Edge, Firefox or Safari).`;
    box.append(msg);
    ui.replaceChildren(box);
  });
