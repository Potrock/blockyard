import { Runtime } from './platform/runtime';
import { devGames, games } from './games';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

devGames()
  .then((previews) => Runtime.start(canvas, ui, games, previews))
  .then((rt) => {
    if (import.meta.env.DEV) (window as unknown as { __game: Runtime }).__game = rt;
  })
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
