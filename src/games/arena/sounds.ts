import type { GameContext } from '@platform';

/** The Arena's creature voices, synthesised on each play. */
export function defineSounds(game: GameContext) {
  const a = game.audio;
  // A wet, wobbling groan.
  a.define('zombie', (s) => {
    s.tone({ wave: 'sawtooth', from: 95 * s.pitch, to: 70 * s.pitch, duration: 0.8, attack: 0.12, volume: 0.55, bandpass: { freq: 520, q: 3 }, vibrato: { rate: 7, depth: 6 } });
  });
  // Rattling bones.
  a.define('skeleton', (s) => {
    for (let i = 0; i < 5; i++) s.noise({ duration: 0.03, filter: 'highpass', from: 3200 * s.pitch, to: 2400, volume: 0.3, delay: i * 0.045 + Math.random() * 0.02 });
  });
  // Hiss and clicking.
  a.define('spider', (s) => {
    s.noise({ duration: 0.45, from: 4500 * s.pitch, to: 3000 * s.pitch, q: 3, volume: 0.25 });
    for (let i = 0; i < 4; i++) s.tone({ wave: 'square', from: 900 * s.pitch, to: 700, duration: 0.03, volume: 0.08, delay: 0.08 * i });
  });
  // A low grunt.
  a.define('brute', (s) => {
    s.tone({ wave: 'sawtooth', from: 70 * s.pitch, to: 48 * s.pitch, duration: 0.8, volume: 0.5, lowpass: 500 });
    s.tone({ from: 45 * s.pitch, to: 35, duration: 0.8, volume: 0.5 });
  });
  // The Warden's roar.
  a.define('boss', (s) => {
    s.tone({ wave: 'sawtooth', from: 52 * s.pitch, to: 38 * s.pitch, duration: 1.5, volume: 0.45, lowpass: 700 });
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, to: 40 * s.pitch, duration: 1.5, volume: 0.45, lowpass: 700 });
    s.noise({ duration: 1.2, filter: 'lowpass', from: 900, to: 150, volume: 0.35 });
  });
}
