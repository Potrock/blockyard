import type { Client, ClientKit } from '@platform/client';
import { BUILD_ITEMS } from '../building/def';

/**
 * The building part on each survivor's screen: structure pieces look like the blocks they place,
 * harvesting has voices of its own (synthesised here), what a harvest gave rises beside the
 * crosshair ("+3 Wood"), and a short hint under it says why something can't be done ("Not yours").
 */
export const kits: ClientKit[] = [];

const CSS = `
.bt-build { position: absolute; inset: 0; pointer-events: none; font-family: inherit; }
.bt-yields { position: absolute; left: calc(50% + 46px); top: calc(50% - 14px); display: flex; flex-direction: column; gap: 3px; }
.bt-yield { display: flex; align-items: center; gap: 6px; padding: 2px 9px 2px 4px; border-radius: 999px; background: rgba(24, 20, 14, 0.62);
  color: #f6edd6; font-size: 14px; font-weight: 700; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6); white-space: nowrap; animation: bt-yield 1.9s ease-out forwards; }
.bt-yield img { width: 20px; height: 20px; image-rendering: pixelated; }
.bt-yield b { color: #b9e07a; }
@keyframes bt-yield { 0% { opacity: 0; transform: translate(-8px, 6px); } 10% { opacity: 1; transform: none; } 70% { opacity: 1; } 100% { opacity: 0; transform: translateY(-14px); } }
.bt-hint { position: absolute; left: 50%; top: calc(50% + 44px); transform: translateX(-50%); padding: 4px 12px; border-radius: 6px; background: rgba(24, 20, 14, 0.66);
  color: #ffd9a0; font-size: 14px; font-weight: 600; white-space: nowrap; opacity: 0; transition: opacity 0.18s; }
.bt-hint.on { opacity: 1; }
`;

let yields: HTMLElement | null = null;
let hintEl: HTMLElement | null = null;
let hintLeft = 0;

export function setup(client: Client): void {
  // Each piece is shown as its block: in the hotbar, in the hand, and spinning on the ground.
  for (const id of BUILD_ITEMS) client.items.look(id, { icon: { block: id } });

  const a = client.audio;
  // An edge biting into green wood: a knock with a short woody ring.
  a.define('bt_chop', (s) => {
    s.noise({ duration: 0.05, filter: 'bandpass', from: 1900 * s.pitch, to: 700, q: 1.4, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 210 * s.pitch, to: 120 * s.pitch, duration: 0.11, volume: 0.42, lowpass: 900 });
  });
  // Stone on stone: a bright click and a ring that isn't quite a note.
  a.define('bt_pick', (s) => {
    s.noise({ duration: 0.03, filter: 'highpass', from: 3800, to: 2400, volume: 0.4 });
    s.tone({ wave: 'sine', from: 1480 * s.pitch, to: 1320 * s.pitch, duration: 0.16, volume: 0.22, fm: { ratio: 2.76, depth: 0.8, to: 0.1 } });
  });
  // Leaves and stems pulled through a hand.
  a.define('bt_rustle', (s) => {
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.07, filter: 'bandpass', from: (3200 + i * 500) * s.pitch, to: 1800, q: 0.8, volume: 0.22, delay: i * 0.045 });
  });
  // Fingers in grit.
  a.define('bt_dig', (s) => {
    s.noise({ duration: 0.12, filter: 'lowpass', from: 1400 * s.pitch, to: 380, volume: 0.45 });
    s.noise({ duration: 0.04, filter: 'bandpass', from: 2600, to: 1500, q: 2, volume: 0.18, delay: 0.05 });
  });
  // A tree coming down: a long creak, then the crown landing.
  a.define('bt_timber', (s) => {
    s.tone({ wave: 'sawtooth', from: 190 * s.pitch, to: 70 * s.pitch, duration: 0.7, volume: 0.22, lowpass: { freq: 900, to: 300 }, vibrato: { rate: 17, depth: 14 } });
    s.noise({ duration: 0.6, filter: 'lowpass', from: 2400, to: 300, volume: 0.5, delay: 0.62 });
    s.tone({ wave: 'sine', from: 70, to: 38, duration: 0.4, volume: 0.5, delay: 0.64 });
  });
  // A plank door on hide hinges.
  a.define('bt_door', (s) => {
    s.tone({ wave: 'sawtooth', from: 320 * s.pitch, to: 240 * s.pitch, duration: 0.14, volume: 0.1, lowpass: 1200, vibrato: { rate: 30, depth: 20 } });
    s.tone({ wave: 'triangle', from: 150 * s.pitch, to: 90 * s.pitch, duration: 0.09, volume: 0.4, delay: 0.13 });
  });

  client.hud.style(CSS);
  const layer = client.hud.layer('bt-build', 'middle');
  layer.classList.add('bt-build');
  yields = document.createElement('div');
  yields.className = 'bt-yields';
  hintEl = document.createElement('div');
  hintEl.className = 'bt-hint';
  layer.append(yields, hintEl);

  // What a harvest (or a piece taken down) gave: [item, count, name] each.
  client.on('bt.yield', (data) => {
    const items = (data as { items?: [string, number, string][] }).items;
    if (!yields || !Array.isArray(items)) return;
    for (const [item, count, name] of items.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'bt-yield';
      const amount = document.createElement('b');
      amount.textContent = `+${count}`;
      row.append(client.hud.icon({ item }), amount, document.createTextNode(String(name)));
      yields.append(row);
      row.addEventListener('animationend', () => row.remove());
    }
    // A long felling shouldn't run off the screen: the oldest lines make way.
    while (yields.childElementCount > 7) yields.firstElementChild?.remove();
  });
  client.on('bt.hint', (data) => {
    const text = (data as { text?: string }).text;
    if (!hintEl || typeof text !== 'string') return;
    hintEl.textContent = text;
    hintEl.classList.add('on');
    hintLeft = 1.8;
  });
}

export function frame(_client: Client, dt: number): void {
  if (hintLeft <= 0) return;
  hintLeft -= dt;
  if (hintLeft <= 0) hintEl?.classList.remove('on');
}
