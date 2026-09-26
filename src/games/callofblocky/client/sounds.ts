import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';

/**
 * Call of Blocky's sounds, all synthesised on each screen (`client.audio.define`: nothing is
 * recorded or sent): each gun its own voice (a punch, a blast of noise, a crack, a tail), the
 * reloads, the katana, the lethals, and the stingers: a surf-rock riff to start a match, brass for
 * a streak. The weapons play theirs through their looks (`./looks`); the server plays the rest by
 * name (`audio.play('streak')`).
 */

/** A gunshot: a low punch, a blast of filtered noise, a supersonic crack and an echoing tail. */
function shot(s: SynthKit, o: { punch: number; body: number; bright: number; crack: number; tail: number; loud?: number }) {
  const p = s.pitch;
  const v = o.loud ?? 1;
  s.tone({ wave: 'sine', from: o.punch * p, to: 38, duration: o.body * 0.7, volume: 0.9 * v });
  s.tone({ wave: 'square', from: o.punch * 1.6 * p, to: 60, duration: 0.05, volume: 0.18 * v, lowpass: 900 });
  s.noise({ duration: o.body, filter: 'lowpass', from: o.bright * p, to: 400, volume: 0.75 * v });
  s.noise({ duration: 0.03, filter: 'highpass', from: 5200, to: 3000, volume: o.crack * v });
  if (o.tail > 0) {
    s.noise({ duration: o.tail, delay: 0.04, filter: 'lowpass', from: 1400 * p, to: 160, volume: 0.16 * v });
    s.noise({ duration: o.tail * 0.8, delay: 0.16, filter: 'lowpass', from: 900 * p, to: 120, volume: 0.07 * v });
  }
}

function click(s: SynthKit, delay: number, f: number, v = 0.3) {
  s.tone({ wave: 'square', from: f * s.pitch, to: f * 0.6 * s.pitch, duration: 0.035, volume: v * 0.5, delay, lowpass: 3200 });
  s.noise({ duration: 0.04, delay, filter: 'bandpass', from: f * 2.6, to: f * 1.8, q: 3, volume: v });
}

/** Misirlou-ish surf tremolo: fast picked notes up a Phrygian dominant run and back. */
function surf(s: SynthKit, notes: number[], step: number, picks: number) {
  notes.forEach((n, i) => {
    const f = 164.81 * 2 ** (n / 12);
    for (let k = 0; k < picks; k++) {
      const delay = i * step + (k * step) / picks;
      s.tone({ wave: 'sawtooth', from: f, to: f * 0.995, duration: (step / picks) * 0.9, volume: 0.16, delay, lowpass: 2600, attack: 0.004 });
      s.tone({ wave: 'square', from: f / 2, to: f / 2, duration: (step / picks) * 0.9, volume: 0.05, delay, lowpass: 900, attack: 0.004 });
    }
  });
}

export function defineSounds(client: Client) {
  const a = client.audio;
  a.define('shot_rifle', (s) => shot(s, { punch: 140, body: 0.2, bright: 5200, crack: 0.45, tail: 0.35 }));
  a.define('shot_smg', (s) => shot(s, { punch: 190, body: 0.11, bright: 7000, crack: 0.35, tail: 0.18, loud: 0.8 }));
  a.define('shot_shotgun', (s) => shot(s, { punch: 95, body: 0.42, bright: 3000, crack: 0.3, tail: 0.6, loud: 1.2 }));
  a.define('shot_sniper', (s) => {
    shot(s, { punch: 120, body: 0.28, bright: 4200, crack: 0.8, tail: 0.9, loud: 1.2 });
    // The echo off the far end of the street.
    s.noise({ duration: 0.5, delay: 0.32, filter: 'lowpass', from: 1100, to: 140, volume: 0.1 });
  });
  a.define('shot_pistol', (s) => shot(s, { punch: 210, body: 0.12, bright: 4200, crack: 0.5, tail: 0.25, loud: 0.85 }));
  a.define('reload_mag', (s) => {
    click(s, 0.05, 900, 0.35); // magazine out
    click(s, 0.55, 700, 0.45); // magazine in
    click(s, 0.9, 1200, 0.35); // charging handle back…
    click(s, 1.0, 1000, 0.4); // …and home
  });
  a.define('reload_pistol', (s) => {
    click(s, 0.05, 1100, 0.3);
    click(s, 0.6, 850, 0.4);
    click(s, 0.95, 1400, 0.4);
  });
  a.define('reload_shell', (s) => {
    s.noise({ duration: 0.08, filter: 'bandpass', from: 1500, to: 900, q: 2, volume: 0.22 });
    click(s, 0.1, 800, 0.3);
  });
  a.define('pump', (s) => {
    s.noise({ duration: 0.09, delay: 0.1, filter: 'bandpass', from: 1300, to: 700, q: 2, volume: 0.35 });
    click(s, 0.16, 520, 0.4);
    s.noise({ duration: 0.08, delay: 0.3, filter: 'bandpass', from: 1700, to: 1100, q: 2, volume: 0.35 });
    click(s, 0.36, 660, 0.45);
  });
  a.define('bolt', (s) => {
    click(s, 0.2, 900, 0.35);
    s.noise({ duration: 0.12, delay: 0.26, filter: 'bandpass', from: 1800, to: 900, q: 2, volume: 0.25 });
    s.noise({ duration: 0.1, delay: 0.46, filter: 'bandpass', from: 1200, to: 1900, q: 2, volume: 0.25 });
    click(s, 0.58, 1100, 0.4);
  });
  a.define('katana', (s) => {
    s.noise({ duration: 0.22, filter: 'bandpass', from: 1800 * s.pitch, to: 5200 * s.pitch, q: 1.5, volume: 0.45 });
    s.tone({ wave: 'sine', from: 2900 * s.pitch, to: 2700 * s.pitch, duration: 0.3, volume: 0.05, delay: 0.05 });
  });
  a.define('katana_hit', (s) => {
    s.noise({ duration: 0.12, filter: 'highpass', from: 3500, to: 1800, volume: 0.5 });
    s.tone({ wave: 'sine', from: 160, to: 50, duration: 0.18, volume: 0.8 });
    s.tone({ wave: 'triangle', from: 1900, to: 1700, duration: 0.4, volume: 0.08, delay: 0.03 });
  });
  // A streak: a brass stab, up a fourth.
  a.define('streak', (s) => {
    for (const [f, d] of [
      [233, 0],
      [311, 0],
      [370, 0],
      [311, 0.14],
      [415, 0.14],
      [466, 0.14],
    ] as const) {
      s.tone({ wave: 'sawtooth', from: f, to: f * 1.005, duration: d ? 0.5 : 0.12, volume: 0.1, delay: d, lowpass: 2200, attack: 0.01, vibrato: { rate: 6, depth: 4 } });
    }
  });
  // The match is on: a surf-guitar run.
  // The lethals: a pin pulled and the spoon flying, a lighter struck on the rag, a throw, a knock on the ground.
  a.define('pin', (s) => {
    s.tone({ wave: 'triangle', from: 2800 * s.pitch, to: 2500 * s.pitch, duration: 0.08, volume: 0.18 });
    s.noise({ duration: 0.04, filter: 'highpass', from: 4200, to: 3000, volume: 0.25 });
    click(s, 0.12, 1600, 0.35);
    s.tone({ wave: 'sine', from: 3400 * s.pitch, to: 3100 * s.pitch, duration: 0.18, volume: 0.08, delay: 0.14 });
  });
  a.define('lighter', (s) => {
    click(s, 0, 1900, 0.4);
    s.noise({ duration: 0.08, delay: 0.05, filter: 'highpass', from: 6000, to: 4000, volume: 0.2 });
    s.noise({ duration: 0.5, delay: 0.1, filter: 'lowpass', from: 1400 * s.pitch, to: 500, volume: 0.28 });
  });
  a.define('toss', (s) => {
    s.noise({ duration: 0.22, filter: 'bandpass', from: 600 * s.pitch, to: 1500 * s.pitch, q: 1.4, volume: 0.35 });
  });
  a.define('clink', (s) => {
    s.tone({ wave: 'triangle', from: 1250 * s.pitch, to: 900 * s.pitch, duration: 0.07, volume: 0.28, lowpass: 4000 });
    s.tone({ wave: 'sine', from: 210 * s.pitch, to: 110 * s.pitch, duration: 0.08, volume: 0.35 });
    s.noise({ duration: 0.03, filter: 'bandpass', from: 3000, to: 2200, q: 3, volume: 0.18 });
  });
  a.define('match_start', (s) => surf(s, [0, 1, 4, 5, 7, 8, 7, 5, 4, 1, 0], 0.11, 3));
  a.define('match_end', (s) => surf(s, [12, 11, 8, 7, 5, 4, 1, 0], 0.16, 4));
  // A spawn: a quick rising whoosh.
  a.define('respawn', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 400, to: 2600, q: 1.2, volume: 0.25 });
    s.tone({ wave: 'triangle', from: 330, to: 660, duration: 0.25, volume: 0.1, delay: 0.1 });
  });
  // Low health: a heartbeat.
  a.define('heartbeat', (s) => {
    s.tone({ wave: 'sine', from: 70, to: 45, duration: 0.12, volume: 0.6 });
    s.tone({ wave: 'sine', from: 64, to: 40, duration: 0.12, volume: 0.45, delay: 0.2 });
  });
}
