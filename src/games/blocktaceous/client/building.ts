import type { Client, ClientKit } from '@platform/client';
import { BUILD_ITEMS } from '../building/def';

/**
 * The building part on each survivor's screen: structure pieces look like the blocks they place,
 * harvesting has voices of its own (synthesised here), what a harvest gave rises beside the
 * crosshair ("+3 Wood"), a short hint under it says why something can't be done ("Not yours"), a
 * prompt says what E does to the piece aimed at and whose it is, and fires burn: flames, sparks
 * and smoke over every campfire, torch and forge in sight.
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
.bt-aim { position: absolute; left: 50%; top: calc(50% + 78px); transform: translateX(-50%); display: none; align-items: center; gap: 8px; padding: 3px 10px 3px 4px;
  border-radius: 6px; background: rgba(24, 20, 14, 0.5); color: #f6edd6; font-size: 13px; font-weight: 600; white-space: nowrap; text-shadow: 0 1px 0 rgba(0, 0, 0, 0.6); }
.bt-aim.on { display: flex; }
.bt-aim kbd { font: inherit; font-weight: 800; min-width: 20px; text-align: center; padding: 1px 5px; border-radius: 4px; background: #f6edd6; color: #2a2118; text-shadow: none; }
.bt-aim kbd:empty { display: none; }
.bt-aim i { font-style: normal; opacity: 0.75; font-weight: 500; }
.bt-aim i:empty { display: none; }
`;

let yields: HTMLElement | null = null;
let hintEl: HTMLElement | null = null;
let hintLeft = 0;

/** The fires in sight (found by looking through the blocks round the camera now and then), and when each next breathes. */
interface Fire {
  x: number;
  y: number;
  z: number;
  kind: 'campfire' | 'torch' | 'forge';
}
let fires: Fire[] = [];
let scanT = 0;
let flameT = 0;
let smokeT = 0;
const FIRE_BLOCKS: Record<string, Fire['kind']> = { bt_campfire: 'campfire', bt_torch: 'torch', bt_forge: 'forge' };
/** How far round the camera fires are looked for, across and up and down, and the most that burn at once. */
const FIRE_REACH = 14;
const FIRE_RISE = 6;
const MAX_FIRES = 24;

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
  const aimEl = document.createElement('div');
  aimEl.className = 'bt-aim';
  const aimKey = document.createElement('kbd');
  const aimVerb = document.createElement('span');
  const aimWhat = document.createElement('i');
  aimEl.append(aimKey, aimVerb, aimWhat);
  layer.append(yields, hintEl, aimEl);

  // What's aimed at: `key` is what E does to it ('' if nothing, or it's locked), `text` what and whose it is.
  client.on('bt.aim', (data) => {
    const { key, text } = data as { key?: string; text?: string };
    const on = !!(key || text);
    aimEl.classList.toggle('on', on);
    aimKey.textContent = key ? 'E' : '';
    aimVerb.textContent = key ?? '';
    aimWhat.textContent = text ?? '';
  });

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

export function frame(client: Client, dt: number): void {
  if (hintLeft > 0) {
    hintLeft -= dt;
    if (hintLeft <= 0) hintEl?.classList.remove('on');
  }
  burn(client, dt);
}

/** Fire on this screen: every fire near the camera throws flame and sparks, and a campfire or a forge smokes. */
function burn(client: Client, dt: number): void {
  scanT -= dt;
  if (scanT <= 0) {
    scanT = 1.5;
    const eye = client.camera.position;
    const cx = Math.floor(eye.x);
    const cy = Math.floor(eye.y);
    const cz = Math.floor(eye.z);
    fires = [];
    for (let y = cy - FIRE_RISE; y <= cy + FIRE_RISE && fires.length < MAX_FIRES; y++)
      for (let x = cx - FIRE_REACH; x <= cx + FIRE_REACH; x++)
        for (let z = cz - FIRE_REACH; z <= cz + FIRE_REACH; z++) {
          const kind = FIRE_BLOCKS[client.world.blockAt(x, y, z)];
          if (kind && fires.length < MAX_FIRES) fires.push({ x, y, z, kind });
        }
  }
  if (!fires.length) return;
  flameT -= dt;
  smokeT -= dt;
  const flame = flameT <= 0;
  const smoke = smokeT <= 0;
  if (flame) flameT = 0.09;
  if (smoke) smokeT = 0.3;
  if (!flame && !smoke) return;
  for (const f of fires) {
    const jx = (Math.random() - 0.5) * 0.3;
    const jz = (Math.random() - 0.5) * 0.3;
    if (f.kind === 'campfire') {
      if (flame) {
        client.fx.particles({ x: f.x + 0.5 + jx, y: f.y + 0.5, z: f.z + 0.5 + jz }, [1, 0.42, 0.08], { count: 2, speed: 0.25, up: 1.5, gravity: -1.2, size: 0.13, glow: 3, life: 0.5, spread: 0.12 });
        if (Math.random() < 0.25) client.fx.particles({ x: f.x + 0.5 + jx, y: f.y + 0.8, z: f.z + 0.5 + jz }, [1, 0.75, 0.25], { count: 1, speed: 0.8, up: 2.4, gravity: -0.5, size: 0.04, glow: 5, life: 1.1, spread: 0.1 });
      }
      if (smoke) client.fx.particles({ x: f.x + 0.5 + jx, y: f.y + 1.2, z: f.z + 0.5 + jz }, [0.16, 0.15, 0.14], { count: 1, speed: 0.12, up: 0.9, gravity: -0.25, size: 0.3, life: 3.2, spread: 0.15, drag: 0.4 });
    } else if (f.kind === 'torch') {
      if (flame && Math.random() < 0.6) client.fx.particles({ x: f.x + 0.5, y: f.y + 0.85, z: f.z + 0.5 }, [1, 0.5, 0.1], { count: 1, speed: 0.1, up: 0.7, gravity: -0.8, size: 0.07, glow: 4, life: 0.4, spread: 0.04 });
    } else {
      if (smoke) client.fx.particles({ x: f.x + 0.5 + jx * 0.5, y: f.y + 1.1, z: f.z + 0.5 + jz * 0.5 }, [0.1, 0.1, 0.1], { count: 1, speed: 0.1, up: 1.1, gravity: -0.3, size: 0.26, life: 2.6, spread: 0.1, drag: 0.4 });
      if (flame && Math.random() < 0.15) client.fx.particles({ x: f.x + 0.5 + jx, y: f.y + 1.05, z: f.z + 0.5 + jz }, [1, 0.6, 0.15], { count: 1, speed: 0.7, up: 1.8, gravity: 1, size: 0.04, glow: 5, life: 0.8, spread: 0.1 });
    }
  }
}
