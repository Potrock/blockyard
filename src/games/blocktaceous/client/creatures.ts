import type { Client, ClientKit } from '@platform/client';
import { SPECIES, type SpeciesId } from '../species';
import { TUNING } from '../creatures/tuning';

/**
 * The creatures part on each player's screen: the animals' voices (synthesised here, played by
 * the rules by name at each animal's own pitch), the sounds of taming and riding, and the tread
 * of the giants: a footfall you hear and, close by, feel.
 */
export const kits: ClientKit[] = [];

/** How each giant's figure was walking last frame, to hear each foot come down. */
const lastPhase = new Map<number, number>();

export function setup(client: Client): void {
  const a = client.audio;

  // ---- Voices: each species speaks one of these, at its own pitch (creatures/tuning.ts). ----

  // A dodo's flat double honk.
  a.define('bt_squawk', (s) => {
    for (const delay of [0, 0.16]) s.tone({ wave: 'sawtooth', from: 520 * s.pitch, to: 340 * s.pitch, duration: 0.13, delay, volume: 0.16, bandpass: { freq: 1100, to: 700, q: 3 } });
  });
  // A small theropod's quick chirrup.
  a.define('bt_chirp', (s) => {
    for (let i = 0; i < 3; i++) s.tone({ wave: 'triangle', from: (1500 + i * 220) * s.pitch, to: (2300 + i * 200) * s.pitch, duration: 0.06, delay: i * 0.075, volume: 0.1 });
  });
  // A rattling hiss: a dilophosaur, and (pitched right down) a crocodile.
  a.define('bt_hiss', (s) => {
    s.noise({ duration: 0.7, filter: 'bandpass', from: 3600 * s.pitch, to: 1900 * s.pitch, q: 1.2, volume: 0.2, attack: 0.08 });
    s.tone({ wave: 'square', from: 46 * s.pitch, to: 38 * s.pitch, duration: 0.7, volume: 0.07, lowpass: 900, vibrato: { rate: 26, depth: 0.25 } });
  });
  // A hadrosaur's hollow crest note (and, an octave and more down, a sauropod's far-carrying call).
  a.define('bt_honk', (s) => {
    s.tone({ wave: 'sawtooth', from: 150 * s.pitch, glide: [[0.25, 205 * s.pitch], [0.9, 170 * s.pitch]], duration: 0.9, attack: 0.08, hold: 0.25, volume: 0.2, bandpass: { freq: 420 * s.pitch, to: 300 * s.pitch, q: 2.2 } });
    s.tone({ wave: 'sine', from: 300 * s.pitch, to: 340 * s.pitch, duration: 0.8, attack: 0.1, volume: 0.07 });
  });
  // A big plant-eater's low, grumbling bellow.
  a.define('bt_bellow', (s) => {
    s.tone({ wave: 'sawtooth', from: 110 * s.pitch, glide: [[0.3, 92 * s.pitch], [0.9, 70 * s.pitch]], duration: 0.9, attack: 0.06, hold: 0.2, volume: 0.24, lowpass: { freq: 700, to: 280 }, drive: 0.35, vibrato: { rate: 9, depth: 0.05 } });
    s.noise({ duration: 0.8, filter: 'lowpass', from: 500, to: 200, volume: 0.07, attack: 0.1 });
  });
  // A raptor's or a pterosaur's rising screech.
  a.define('bt_screech', (s) => {
    s.tone({ wave: 'sawtooth', from: 900 * s.pitch, glide: [[0.12, 1700 * s.pitch], [0.5, 1200 * s.pitch]], duration: 0.5, attack: 0.02, volume: 0.13, bandpass: { freq: 2200 * s.pitch, to: 1500 * s.pitch, q: 2 }, fm: { ratio: 1.41, depth: 0.5 } });
    s.noise({ duration: 0.4, filter: 'bandpass', from: 3000, to: 2000, q: 2, volume: 0.06 });
  });
  // A great predator's roar: three rough voices a little apart, falling, over breath.
  a.define('bt_roar', (s) => {
    for (const [f, v] of [[78, 0.22], [117, 0.15], [59, 0.2]] as const) {
      s.tone({ wave: 'sawtooth', from: f * 1.25 * s.pitch, glide: [[0.2, f * 1.45 * s.pitch], [1.5, f * 0.8 * s.pitch]], duration: 1.3, attack: 0.12, hold: 0.35, volume: v, drive: 0.7, lowpass: { freq: 1500, to: 380 }, vibrato: { rate: 19, depth: 0.07 } });
    }
    s.noise({ duration: 1.5, filter: 'bandpass', from: 1300, to: 420, q: 0.8, volume: 0.17, attack: 0.15, hold: 0.3 });
  });
  // A mammoth's brassy trumpet.
  a.define('bt_trumpet', (s) => {
    s.tone({ wave: 'sawtooth', from: 310 * s.pitch, glide: [[0.15, 520 * s.pitch], [0.8, 440 * s.pitch]], duration: 0.8, attack: 0.04, hold: 0.25, volume: 0.17, fm: { ratio: 2, depth: 0.8, to: 0.3 }, bandpass: { freq: 1100, to: 800, q: 1.5 } });
  });
  // A big cat's throaty growl.
  a.define('bt_growl', (s) => {
    s.tone({ wave: 'sawtooth', from: 95 * s.pitch, to: 70 * s.pitch, duration: 0.9, attack: 0.1, hold: 0.2, volume: 0.2, drive: 0.6, lowpass: 650, vibrato: { rate: 31, depth: 0.12 } });
    s.noise({ duration: 0.8, filter: 'bandpass', from: 800, to: 500, q: 1, volume: 0.07, attack: 0.1 });
  });

  // ---- What they do. ----

  // Jaws shutting: a snap and a wet thump.
  a.define('bt_bite', (s) => {
    s.noise({ duration: 0.07, filter: 'highpass', from: 2200 * s.pitch, volume: 0.24 });
    s.tone({ wave: 'sine', from: 170 * s.pitch, to: 55 * s.pitch, duration: 0.16, volume: 0.3 });
  });
  // Something heavy meeting something else: a club landing, a body going down.
  a.define('bt_thud', (s) => {
    s.tone({ wave: 'sine', from: 120 * s.pitch, to: 38 * s.pitch, duration: 0.28, volume: 0.42 });
    s.noise({ duration: 0.12, filter: 'lowpass', from: 700 * s.pitch, to: 200, volume: 0.2 });
  });
  // Chewing.
  a.define('bt_eat', (s) => {
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.07, delay: i * 0.17, filter: 'bandpass', from: 900 * s.pitch, to: 500 * s.pitch, q: 2, volume: 0.15 });
  });
  // A tame won: four rising notes.
  a.define(
    'bt_tamed',
    (s) => {
      [392, 494, 587, 784].forEach((f, i) => s.tone({ wave: 'triangle', from: f, duration: 0.3, delay: i * 0.11, volume: 0.16, attack: 0.01 }));
    },
    { reverb: 0.3 },
  );
  // Leather and buckles.
  a.define('bt_saddle', (s) => {
    s.noise({ duration: 0.16, filter: 'bandpass', from: 1500, to: 700, q: 1.5, volume: 0.16 });
    s.tone({ wave: 'square', from: 1900, to: 1500, duration: 0.03, delay: 0.17, volume: 0.05 });
  });
  // A dart leaving a blowpipe.
  a.define('bt_puff', (s) => {
    s.noise({ duration: 0.11, filter: 'bandpass', from: 2600, to: 900, q: 1, volume: 0.22 });
  });
  // A giant's foot coming down.
  a.define('bt_step', (s) => {
    s.tone({ wave: 'sine', from: 62 * s.pitch, to: 30 * s.pitch, duration: 0.32, volume: 0.5 });
    s.noise({ duration: 0.2, filter: 'lowpass', from: 320, to: 110, volume: 0.22 });
  });
}

/** How heavy a species treads, 0 (nothing to hear) to 1 (a sauropod). */
function tread(type: string): number {
  if (!(type in SPECIES)) return 0;
  const s = SPECIES[type as SpeciesId];
  if (!TUNING[type as SpeciesId].big || s.locomotion === 'flyer') return 0;
  return Math.min(1, s.health / 500 + 0.25);
}

export function frame(client: Client, _dt: number): void {
  // The giants' tread: each time a walking giant's foot comes down (twice a stride) it thuds
  // where it stands, and near enough the screen shakes with it.
  const eye = client.camera.position;
  const seen = new Set<number>();
  for (const f of client.figures.all) {
    const weight = tread(f.type);
    if (!weight) continue;
    seen.add(f.id);
    const phase = f.state.walkPhase;
    const before = lastPhase.get(f.id);
    lastPhase.set(f.id, phase);
    if (before === undefined || f.state.walkAmount < 0.3 || f.state.dying > 0) continue;
    if (Math.floor(phase / Math.PI) === Math.floor(before / Math.PI)) continue;
    const at = f.root.position;
    const d = Math.hypot(at.x - eye.x, at.y - eye.y, at.z - eye.z);
    if (d > 60) continue;
    client.audio.play('bt_step', { at: { x: at.x, y: at.y, z: at.z }, volume: 0.5 + weight * 0.5, pitch: 1.25 - weight * 0.5 });
    const near = Math.max(0, 1 - d / (10 + weight * 22));
    if (near > 0) client.fx.shake(near * weight * 0.22, 0.18);
  }
  if (lastPhase.size > seen.size) for (const id of [...lastPhase.keys()]) if (!seen.has(id)) lastPhase.delete(id);
}
