import type { GameContext } from '@platform';

/** Starfighter's weapons and engines, synthesised on each play. */
export function defineSounds(game: GameContext) {
  const a = game.audio;
  // Blaster "pew": a fast falling zap with a bright click.
  a.define('laser', (s) => {
    s.tone({ wave: 'square', from: 2400 * s.pitch, to: 260 * s.pitch, duration: 0.17, volume: 0.22, lowpass: 3800 });
    s.tone({ wave: 'sawtooth', from: 1200 * s.pitch, to: 180 * s.pitch, duration: 0.14, volume: 0.12, lowpass: 2400 });
    s.noise({ duration: 0.03, filter: 'highpass', from: 5000, to: 3000, volume: 0.15 });
  });
  // The Empire's: harsher and lower, with a growl.
  a.define('laser_enemy', (s) => {
    s.tone({ wave: 'sawtooth', from: 1300 * s.pitch, to: 150 * s.pitch, duration: 0.22, volume: 0.24, lowpass: 2600 });
    s.tone({ wave: 'square', from: 660 * s.pitch, to: 110 * s.pitch, duration: 0.2, volume: 0.12, lowpass: 1400 });
    s.noise({ duration: 0.08, from: 1400, to: 600, q: 2, volume: 0.12 });
  });
  a.define('torpedo', (s) => {
    s.noise({ duration: 0.7, from: 400 * s.pitch, to: 2600 * s.pitch, q: 3, volume: 0.35 });
    s.tone({ wave: 'triangle', from: 260 * s.pitch, to: 820 * s.pitch, duration: 0.6, volume: 0.25 });
  });
  // The capital ship's alarm horn for the boss wave.
  a.define('capital_horn', (s) => {
    for (const f of [58, 87, 116]) s.tone({ wave: 'sawtooth', from: f * s.pitch, to: f * 0.94 * s.pitch, duration: 1.8, attack: 0.25, volume: 0.28, lowpass: 900 });
    s.noise({ duration: 1.4, filter: 'lowpass', from: 600, to: 120, volume: 0.2 });
  });
  // The TIE howl: detuned saws with a fast wobble through a bandpass sweeping down as it passes.
  // (Raw WebAudio: the helpers don't do filter sweeps shared by several oscillators.)
  a.define('flyby', (s) => {
    const { ctx, out, t, pitch: p } = s;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(1900 * p, t);
    bp.frequency.exponentialRampToValueAtTime(500 * p, t + 0.9);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5, t + 0.12);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.97);
    bp.connect(env).connect(out);
    for (const f of [170, 176, 340]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * p, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.55 * p, t + 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 23;
      const depth = ctx.createGain();
      depth.gain.value = f * 0.06;
      lfo.connect(depth).connect(o.frequency);
      o.connect(bp);
      for (const n of [o, lfo]) {
        n.start(t);
        n.stop(t + 1.05);
      }
    }
    s.noise({ duration: 0.9, from: 2400 * p, to: 700 * p, q: 1.2, volume: 0.35 });
  });
}
