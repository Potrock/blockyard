import type { SynthKit } from '@platform';
import type { Client, ClientLoop } from '@platform/client';
import { prefs } from './prefs';
import { store } from './store';

/**
 * The game's music, on this screen: a calm score made as it plays (synthesised, nothing recorded),
 * low and sparse under the game, never quite the same twice, that changes its character with your
 * era. The Ancient: a drone, a frame drum, a flute over them in a five-note scale. The Classical
 * and the Medieval: a lyre's broken chords and a choir's "oo" (in the Medieval, the lyre sings a
 * tune too). The Renaissance: strings and a harpsichord. The Industrial and the Modern: a piano,
 * soft brass, a bass. The Atomic and the Information Era: synth pads, bells, a deep bass.
 *
 * Each four bars it takes one of its era's chord progressions at random, and each bar it makes up
 * its tune or its figures afresh (some bars, some phrases, it rests). A new era: it rests two bars
 * (the era's fanfare, `sound.ts`, says it) before the new music begins. It plays a beat at a time,
 * a little ahead, as the Arena's does (`client.audio` plays it exactly on time from there), at the
 * player's music volume (`client.audio.music`), silent with the game's sound off, quieter while a
 * big moment's card is on screen.
 */

/** Seconds ahead a beat is put together and handed to the sound. */
const AHEAD = 0.15;
/** The music's loudness under the rest (the player's music volume over it). */
const LEVEL = 0.9;
/** How much quieter it is under a big moment's card. */
const UNDER_CARD = 0.35;

/** A pitch: `n` semitones from the A below middle C. The music's key: D (`D3`, `D` + 12 is D4). */
const hz = (n: number) => 220 * Math.pow(2, n / 12);
const D = -7;

type Instrument = 'flute' | 'drum' | 'tek' | 'lyre' | 'choir' | 'strings' | 'harpsichord' | 'brass' | 'piano' | 'pad' | 'bell' | 'bass';

/**
 * A note: an instrument, `t` beats into its bar when composed (seconds into its beat when played),
 * how loud, its pitches (Hz; a drum's, how high it's tuned) and how long it's held (beats when
 * composed, seconds when played).
 */
interface Note {
  i: Instrument;
  t: number;
  v: number;
  f: number[];
  d: number;
}

/** The eras' music, by kind: the Ancient; the Classical and Medieval; the Renaissance; the Industrial and Modern; the Atomic and Information. */
type Style = 'ancient' | 'classical' | 'renaissance' | 'modern' | 'atomic';
const STYLE_OF_ERA: Style[] = ['ancient', 'classical', 'classical', 'renaissance', 'modern', 'modern', 'atomic', 'atomic'];

/** Each style's beats a minute, its scale (semitones from D), its chord progressions (each bar a chord: semitones from D) and how loud its drone is. */
const STYLES: Record<Style, { bpm: number; scale: number[]; progressions: number[][][]; drone: number }> = {
  ancient: { bpm: 63, scale: [0, 3, 5, 7, 10], progressions: [[[0, 7], [0, 7], [0, 7], [0, 7]]], drone: 0.07 },
  classical: {
    bpm: 66,
    scale: [0, 2, 3, 5, 7, 9, 10],
    progressions: [
      [[0, 3, 7], [-2, 2, 5], [5, 9, 12], [0, 3, 7]],
      [[0, 3, 7], [5, 9, 12], [-2, 2, 5], [0, 3, 7]],
      [[0, 3, 7], [3, 7, 10], [-2, 2, 5], [7, 10, 14]],
    ],
    drone: 0.03,
  },
  renaissance: {
    bpm: 72,
    scale: [0, 2, 4, 5, 7, 9, 11],
    progressions: [
      [[0, 4, 7], [5, 9, 12], [7, 11, 14], [0, 4, 7]],
      [[0, 4, 7], [-3, 0, 4], [5, 9, 12], [7, 11, 14]],
      [[0, 4, 7], [7, 11, 14], [-3, 0, 4], [5, 9, 12]],
    ],
    drone: 0,
  },
  modern: {
    bpm: 70,
    scale: [0, 2, 4, 5, 7, 9, 11],
    progressions: [
      [[0, 4, 7, 11], [5, 9, 12, 16], [-3, 0, 4, 7], [7, 11, 14, 17]],
      [[0, 4, 7, 11], [4, 7, 11, 14], [5, 9, 12, 16], [0, 4, 7, 11]],
      [[-3, 0, 4, 7], [5, 9, 12, 16], [0, 4, 7, 11], [7, 11, 14, 17]],
    ],
    drone: 0,
  },
  atomic: {
    bpm: 60,
    scale: [0, 2, 4, 6, 7, 9, 11],
    progressions: [
      [[0, 4, 7, 14], [2, 6, 9, 16], [0, 4, 7, 14], [-3, 0, 4, 11]],
      [[0, 4, 11, 14], [-5, -1, 2, 9], [-3, 0, 4, 11], [2, 6, 9, 16]],
    ],
    drone: 0,
  },
};

/** The beat to play next (`civ_music`): filled, played, emptied. */
const score: Note[] = [];

let drone: ClientLoop | null = null;
/** The style playing, the beat it's on (below 0: resting before it starts), when the next beat is due, and the voice's turn. */
let style: Style | null = null;
let beat = 0;
let nextBeat = 0;
let alt = false;
/** This phrase's chords, and this bar's notes (`t` in beats). */
let chords: number[][] = [];
let bar: Note[] = [];

export function defineMusic(client: Client) {
  const a = client.audio;
  // A beat of it, as `playMusic` has filled `score` (two voices taking turns: two beats close together are never taken for one sound).
  for (const name of ['civ_music', 'civ_music_b'])
    a.define(name, (s) => {
      for (const n of score) INSTRUMENTS[n.i](s, n);
    }, { reverb: 0.55 });
  // The Ancient's drone (lower under the Classical's): D and its fifth, darkly.
  a.defineLoop('civ_drone', (l) => {
    l.tone({ wave: 'sine', freq: hz(D - 12), volume: 0.45 });
    l.tone({ wave: 'triangle', freq: hz(D - 5), volume: 0.16, lowpass: 420 });
    l.tone({ wave: 'sawtooth', freq: hz(D), volume: 0.05, lowpass: 320, vibrato: { rate: 0.15, depth: 0.5 } });
  });
}

/** Each frame: the music, a beat at a time, a little ahead. */
export function playMusic(client: Client) {
  const v = store.view;
  // (Only someone in a game: the lobby, a replay and the home page are quiet.)
  const now: Style | null = v && client.running && client.me.id && !client.replay.playing ? STYLE_OF_ERA[Math.max(0, Math.min(7, v.self.era))] : null;
  const vol = prefs.muted ? 0 : client.audio.music * LEVEL * (store.splashes.length ? UNDER_CARD : 1);
  if (!now || vol === 0) {
    drone?.set({ volume: 0 });
    nextBeat = client.time;
    if (!now) style = null;
    return;
  }
  if (now !== style) {
    // A new era rests two bars under its fanfare; the music's first start, one.
    beat = style ? -8 : -4;
    style = now;
  }
  const st = STYLES[style];
  drone ??= client.audio.loop('civ_drone', { volume: 0 });
  drone.set({ volume: vol * st.drone });
  const len = 60 / st.bpm;
  // Out of step (the tab was away, the music just started): from now.
  if (nextBeat < client.time - 0.25 || nextBeat > client.time + 2) nextBeat = client.time + 0.05;
  while (nextBeat - client.time < AHEAD) {
    if (beat >= 0) {
      const barBeat = beat % 4;
      if (barBeat === 0) {
        const barNo = Math.floor(beat / 4);
        if (barNo % 4 === 0) chords = pick(st.progressions);
        bar = compose(style, barNo % 4, chords[barNo % 4]);
      }
      const at = Math.max(0, nextBeat - client.time);
      score.length = 0;
      for (const n of bar) if (Math.floor(n.t) === barBeat) score.push({ ...n, t: at + (n.t - barBeat) * len, d: n.d * len });
      if (score.length) {
        client.audio.play(alt ? 'civ_music_b' : 'civ_music', { volume: vol });
        alt = !alt;
      }
      score.length = 0;
    }
    beat++;
    nextBeat += len;
  }
}

// -------------------------------------------------------------------------------------------------
// Composing

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];
const chance = (p: number) => Math.random() < p;

/** A tune of `count` notes in a scale (semitones from D, `octave` up), stepping mostly, from somewhere near the chord. */
function tune(scale: number[], octave: number, count: number, from: number): number[] {
  const steps = [...scale, ...scale.map((n) => n + 12)];
  let i = Math.max(0, steps.findIndex((n) => n >= from));
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    out.push(hz(D + octave + steps[i]));
    i = Math.max(0, Math.min(steps.length - 1, i + pick([-2, -1, -1, 1, 1, 2, 0])));
  }
  return out;
}

/** A bar's notes (`t` in beats, `d` in beats), for a style, its place in the phrase (0..3) and its chord. */
function compose(style: Style, place: number, chord: number[]): Note[] {
  const st = STYLES[style];
  const out: Note[] = [];
  const add = (i: Instrument, t: number, v: number, f: number[], d: number) => out.push({ i, t, v, f, d });
  const at = (octave: number) => chord.map((n) => hz(D + octave + n));
  // Now and then a bar (more rarely a phrase's first) is left to the drone and the pads.
  const rest = chance(place === 0 ? 0.1 : 0.25);

  if (style === 'ancient') {
    add('drum', 0, 0.15, [1], 1);
    if (chance(0.6)) add('drum', 2, 0.09, [1.1], 1);
    if (chance(0.3)) add('tek', 2.5, 0.05, [1], 0.2);
    if (chance(0.25)) add('tek', 3.5, 0.04, [1], 0.2);
    if (!rest && chance(0.6)) {
      const notes = tune(st.scale, 12, 2 + Math.floor(Math.random() * 3), pick(st.scale));
      let t = pick([0.5, 1, 1]);
      notes.forEach((f, k) => {
        const d = k === notes.length - 1 ? 4 - t + 1 : pick([0.5, 1, 1, 1.5]);
        if (t < 4) add('flute', t, 0.05, [f], Math.min(d, 2.5));
        t += d;
      });
    }
    return out;
  }

  if (style === 'classical') {
    if (place % 2 === 0) add('choir', 0, 0.022, at(0), 8);
    if (place === 0) add('drum', 0, 0.07, [1], 1);
    if (rest) return out;
    // The lyre: the chord broken upward, now and then a neighbour note.
    const arp = at(12);
    const beats = chance(0.5) ? [0, 1, 2, 3] : [0, 1.5, 3];
    beats.forEach((t, k) => add('lyre', t, 0.045, [arp[k % arp.length] * (k === 3 && chance(0.4) ? 2 : 1)], 1.6));
    // The Medieval (and sometimes the Classical): a tune over it.
    if (chance(0.35)) tune(st.scale, 12, 3, chord[1] + 12).forEach((f, k) => add('lyre', 0.5 + k * 1.25, 0.035, [f * 2], 1.2));
    return out;
  }

  if (style === 'renaissance') {
    add('strings', 0, 0.018, at(0), 4);
    add('strings', 0, 0.014, [hz(D - 12 + chord[0])], 4);
    if (rest) return out;
    if (chance(0.55)) {
      // The harpsichord's broken chord, in eighths.
      const arp = at(12);
      const order = [0, 2, 1, 2, 0, 2, 1, 2];
      order.forEach((k, j) => add('harpsichord', j * 0.5, j % 2 ? 0.026 : 0.034, [arp[k]], 0.5));
    } else {
      const notes = tune(st.scale, 12, 4 + Math.floor(Math.random() * 3), chord[2]);
      notes.forEach((f, k) => add('harpsichord', k * (4 / notes.length), 0.034, [f], 0.6));
    }
    return out;
  }

  if (style === 'modern') {
    // The piano's chord low on the bar, a few notes of a tune over it; soft brass swelling every other bar.
    add('piano', 0, 0.035, at(0), 3);
    add('bass', 0, 0.045, [hz(D - 12 + chord[0])], 2);
    if (place % 2 === 0 && chance(0.6)) add('brass', 0, 0.014, at(0), 7);
    if (rest) return out;
    const times = pick([
      [0.5, 1.5, 2],
      [1, 2, 3],
      [0.5, 1, 2.5, 3],
      [2, 2.5, 3],
    ]);
    tune(st.scale, 12, times.length, chord[1] + 12).forEach((f, k) => add('piano', times[k], 0.03, [f], 2));
    return out;
  }

  // The Atomic and the Information Era: a pad over two bars, a deep bass, bells now and then.
  if (place % 2 === 0) add('pad', 0, 0.016, at(0), 8);
  add('bass', 0, 0.05, [hz(D - 12 + chord[0])], 4);
  if (rest || !chance(0.6)) return out;
  const notes = tune(st.scale, 24, 3 + Math.floor(Math.random() * 4), chord[0]);
  const start = pick([0, 1, 2]);
  notes.forEach((f, k) => {
    if (start + k * 0.5 < 4) add('bell', start + k * 0.5, 0.016, [f], 2);
  });
  return out;
}

// -------------------------------------------------------------------------------------------------
// The instruments

/** A voice singing "oo" at `f`: a buzz through the vowel's formants, swelling and wavering. */
function choir(s: SynthKit, f: number, n: Note) {
  for (const [formant, loud] of [
    [300, 1],
    [870, 0.3],
    [2240, 0.05],
  ])
    for (const detune of [1, 1.007])
      s.tone({ wave: 'sawtooth', from: f * detune, duration: 1.2, attack: 0.9, hold: Math.max(0, n.d - 1.5), delay: n.t, volume: n.v * loud, bandpass: { freq: formant, q: 6 }, vibrato: { rate: 4.6, depth: f * 0.008 } });
}

const INSTRUMENTS: Record<Instrument, (s: SynthKit, n: Note) => void> = {
  flute: (s, n) => {
    for (const f of n.f) {
      const hold = Math.max(0, n.d - 0.25);
      s.tone({ wave: 'sine', from: f, duration: 0.5, attack: 0.14, hold, delay: n.t, volume: n.v, vibrato: { rate: 4.8, depth: f * 0.005 } });
      s.tone({ wave: 'triangle', from: f * 2, duration: 0.4, attack: 0.2, hold, delay: n.t, volume: n.v * 0.1 });
      s.noise({ duration: 0.3, attack: 0.08, hold, from: f * 2, filter: 'bandpass', q: 6, volume: n.v * 0.18, delay: n.t });
    }
  },
  drum: (s, n) => {
    s.tone({ from: 150 * n.f[0], to: 70 * n.f[0], duration: 0.4, attack: 0.004, delay: n.t, volume: n.v });
    s.noise({ duration: 0.12, filter: 'lowpass', from: 700, to: 150, volume: n.v * 0.45, delay: n.t });
  },
  tek: (s, n) => {
    s.noise({ duration: 0.05, filter: 'bandpass', from: 2800, q: 3, volume: n.v, delay: n.t });
    s.tone({ from: 520, to: 300, duration: 0.06, attack: 0.002, delay: n.t, volume: n.v * 0.3 });
  },
  lyre: (s, n) => {
    for (const f of n.f) {
      s.tone({ wave: 'triangle', from: f, duration: n.d, attack: 0.004, delay: n.t, volume: n.v, lowpass: { freq: 2600, to: 600, time: 0.6 } });
      s.tone({ wave: 'sine', from: f * 2, duration: 0.25, attack: 0.003, delay: n.t, volume: n.v * 0.2 });
    }
  },
  choir: (s, n) => {
    for (const f of n.f) choir(s, f, n);
  },
  strings: (s, n) => {
    for (const f of n.f)
      for (const detune of [1, 1.004, 0.996])
        s.tone({ wave: 'sawtooth', from: f * detune, duration: 0.9, attack: 0.5, hold: Math.max(0, n.d - 0.8), delay: n.t, volume: n.v, lowpass: 1400, vibrato: { rate: 5.2, depth: f * 0.004 } });
  },
  harpsichord: (s, n) => {
    for (const f of n.f) {
      s.tone({ wave: 'sawtooth', from: f, duration: 0.7, attack: 0.002, delay: n.t, volume: n.v, highpass: 250, lowpass: { freq: 4200, to: 1500, time: 0.4 } });
      s.tone({ wave: 'square', from: f * 2, duration: 0.25, attack: 0.002, delay: n.t, volume: n.v * 0.2, lowpass: 3000 });
    }
  },
  brass: (s, n) => {
    for (const f of n.f)
      for (const detune of [1, 1.005])
        s.tone({ wave: 'sawtooth', from: f * detune, duration: 0.8, attack: 0.6, hold: Math.max(0, n.d - 1.2), delay: n.t, volume: n.v, lowpass: { freq: 500, to: 1300, time: 1 }, fm: { ratio: 1, depth: 0.3 } });
  },
  piano: (s, n) => {
    for (const f of n.f) {
      s.tone({ wave: 'sine', from: f, duration: n.d, attack: 0.003, delay: n.t, volume: n.v });
      s.tone({ wave: 'triangle', from: f * 2, duration: n.d * 0.4, attack: 0.003, delay: n.t, volume: n.v * 0.22, lowpass: 2500 });
      s.tone({ wave: 'sine', from: f * 3, duration: 0.3, attack: 0.002, delay: n.t, volume: n.v * 0.07 });
    }
  },
  pad: (s, n) => {
    for (const f of n.f)
      for (const detune of [1, 1.006, 0.994])
        s.tone({ wave: 'sawtooth', from: f * detune, duration: 1.4, attack: 1.4, hold: Math.max(0, n.d - 2.2), delay: n.t, volume: n.v, lowpass: { freq: 500, to: 1100, time: n.d } });
  },
  bell: (s, n) => {
    for (const f of n.f) {
      s.tone({ wave: 'sine', from: f, duration: n.d, attack: 0.002, delay: n.t, volume: n.v, fm: { ratio: 3.5, depth: 0.9, to: 0.1 } });
      s.tone({ wave: 'sine', from: f * 2.76, duration: 0.5, attack: 0.002, delay: n.t, volume: n.v * 0.3 });
    }
  },
  bass: (s, n) => {
    for (const f of n.f) {
      s.tone({ wave: 'sine', from: f, duration: n.d * 0.6, attack: 0.03, hold: n.d * 0.4, delay: n.t, volume: n.v });
      s.tone({ wave: 'triangle', from: f, duration: n.d * 0.5, attack: 0.03, delay: n.t, volume: n.v * 0.3, lowpass: 400 });
    }
  },
};
