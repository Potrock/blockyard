import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';
import { prefs, setPrefs } from './prefs';

/**
 * The game's sounds, synthesised (nothing recorded), short and low under the music:
 *
 * - The interface: a soft click for buttons, a whoosh as a panel opens, chimes for a new turn and a
 *   notification, a blip for a line of chat and a sonar's ping for a tile pointed at.
 * - Units on the move (`models3d.ts`): footsteps, hooves, oars, a rumble of wheels and tracks, an
 *   aircraft's whoosh. Fights: a clash of blades, a volley of arrows, a gun's boom and its blast where
 *   it lands, stone cracking when a city's hit; a city taken: drums and a falling horn.
 * - Your empire's news: a city founded (a stamp), a building or a unit finished, a tech learned, a
 *   policy adopted, a deal made, a great person born (a choir), a unit promoted, a religion founded.
 * - The big moments: fanfares for a wonder, a new era and the game's end, a warm swell for a golden
 *   age, war drums, a bell for peace, a glassy chime for a natural wonder found.
 *
 * Mutable (kept with the player's preferences, `prefs.ts`), and at the platform's volume. The same
 * sound twice in a moment plays once (`REST`); news that comes all at once (a turn's start) is
 * spaced out a little and only the first few of it play (`soon`).
 */

let client: Client | null = null;

export type Cue =
  | 'click'
  | 'open'
  | 'turn'
  | 'yourturn'
  | 'note'
  | 'found'
  | 'wonder'
  | 'era'
  | 'bad'
  | 'victory'
  | 'step'
  | 'hoof'
  | 'oar'
  | 'roll'
  | 'fly'
  | 'clash'
  | 'volley'
  | 'boom'
  | 'blast'
  | 'cityhit'
  | 'fell'
  | 'captured'
  | 'built'
  | 'trained'
  | 'tech'
  | 'policy'
  | 'golden'
  | 'war'
  | 'peace'
  | 'deal'
  | 'great'
  | 'promote'
  | 'discover'
  | 'faith'
  | 'march'
  | 'chat'
  | 'ping';

/** Seconds before the same sound plays again (a march sound a little longer: many units moving at once are a few footsteps, not a crowd). */
const REST = 0.12;
const MARCH_REST = 0.35;
const MARCHING = new Set<Cue>(['step', 'hoof', 'oar', 'roll', 'fly']);
/** News that comes together: seconds between its sounds, and the most of it that plays. */
const SOON_GAP = 0.45;
const SOON_MOST = 4;

/** When each sound last played, and the news waiting to (in order). */
const played = new Map<Cue, number>();
const waiting: { cue: Cue; volume: number }[] = [];
let nextSoon = 0;

/** A drum: a deep thump and its skin. */
function drum(s: SynthKit, delay: number, volume: number, pitch = 1) {
  s.tone({ from: 120 * pitch, to: 45 * pitch, duration: 0.45, attack: 0.003, delay, volume });
  s.noise({ duration: 0.12, filter: 'lowpass', from: 800, to: 140, volume: volume * 0.5, delay });
}

/** A bell at `f`, ringing like metal. */
function bell(s: SynthKit, f: number, delay: number, volume: number, ring = 1.6) {
  s.tone({ wave: 'sine', from: f, duration: ring, attack: 0.002, delay, volume, fm: { ratio: 3.5, depth: 0.9, to: 0.1 } });
  s.tone({ wave: 'sine', from: f * 2.76, duration: ring * 0.35, attack: 0.002, delay, volume: volume * 0.3 });
}

/** A choir's "ah" at each of `notes`: a buzz through the vowel's formants, swelling and fading. */
function choir(s: SynthKit, notes: number[], volume: number, length: number) {
  for (const f of notes)
    for (const [formant, loud] of [
      [730, 1],
      [1090, 0.45],
      [2440, 0.1],
    ])
      s.tone({ wave: 'sawtooth', from: f, duration: length * 0.5, attack: 0.25, hold: length * 0.4, volume: volume * loud, bandpass: { freq: formant, q: 7 }, vibrato: { rate: 5, depth: f * 0.01 } });
}

export function defineSounds(c: Client) {
  client = c;
  const a = c.audio;
  // ---------- The interface ----------
  a.define('civ_click', (s) => s.tone({ wave: 'triangle', from: 1400 * s.pitch, to: 900 * s.pitch, duration: 0.05, volume: 0.18 }), { reverb: 0 });
  a.define('civ_open', (s) => s.noise({ duration: 0.16, from: 900, to: 2800, filter: 'bandpass', q: 1.2, volume: 0.12 }), { reverb: 0 });
  // A move ordered: two footfalls.
  a.define(
    'civ_march',
    (s) => {
      s.noise({ duration: 0.09, from: 500, to: 160, filter: 'lowpass', volume: 0.3 });
      s.noise({ duration: 0.09, from: 460, to: 140, filter: 'lowpass', volume: 0.24, delay: 0.13 });
    },
    { reverb: 0 },
  );
  // (It's your turn, after a wait: a bell, two clear strikes, to be heard from another window.)
  a.define(
    'civ_yourturn',
    (s) => {
      for (const [delay, f] of [[0, 988], [0.3, 1318]] as const) {
        s.tone({ wave: 'sine', from: f, duration: 1.2, volume: 0.22, delay });
        s.tone({ wave: 'sine', from: f * 2.76, duration: 0.5, volume: 0.05, delay });
      }
    },
    { reverb: 0.5 },
  );
  a.define(
    'civ_turn',
    (s) => {
      s.tone({ wave: 'sine', from: 523, duration: 0.5, volume: 0.16, hold: 0.05 });
      s.tone({ wave: 'sine', from: 784, duration: 0.6, volume: 0.13, delay: 0.09, hold: 0.05 });
      s.tone({ wave: 'sine', from: 1046, duration: 0.7, volume: 0.09, delay: 0.18 });
    },
    { reverb: 0.4 },
  );
  // A line of chat: a soft blip; a tile pointed at: a sonar's two pings, the second fainter.
  a.define(
    'civ_chat',
    (s) => {
      s.tone({ wave: 'sine', from: 660, to: 990, duration: 0.09, volume: 0.09 });
      s.tone({ wave: 'sine', from: 1320, duration: 0.12, volume: 0.05, delay: 0.06 });
    },
    { reverb: 0.1 },
  );
  a.define(
    'civ_ping',
    (s) => {
      s.tone({ wave: 'sine', from: 1568, to: 1480, duration: 0.5, volume: 0.16, fm: { ratio: 2, depth: 0.15, to: 0 } });
      s.tone({ wave: 'sine', from: 1568, to: 1480, duration: 0.45, volume: 0.06, delay: 0.32 });
    },
    { reverb: 0.5 },
  );
  a.define(
    'civ_note',
    (s) => {
      s.tone({ wave: 'sine', from: 880, duration: 0.18, volume: 0.1 });
      s.tone({ wave: 'sine', from: 1318, duration: 0.25, volume: 0.08, delay: 0.07 });
    },
    { reverb: 0.2 },
  );

  // ---------- Units on the move ----------
  // Footsteps: a squad's four soft treads.
  a.define(
    'civ_step',
    (s) => {
      for (let i = 0; i < 4; i++) {
        s.noise({ duration: 0.07, filter: 'lowpass', from: 420, to: 140, volume: 0.05 * (i % 2 ? 0.8 : 1), delay: i * 0.14 });
        s.noise({ duration: 0.03, filter: 'bandpass', from: 1800, q: 2, volume: 0.012, delay: i * 0.14 + 0.01 });
      }
    },
    { reverb: 0.2 },
  );
  // Hooves: a trot's clip-clop on the ground.
  a.define(
    'civ_hoof',
    (s) => {
      for (const [t, v] of [
        [0, 1],
        [0.09, 0.7],
        [0.26, 1],
        [0.35, 0.7],
      ]) {
        s.tone({ wave: 'triangle', from: 620 * (1 + t * 0.2), to: 380, duration: 0.05, attack: 0.002, delay: t, volume: 0.045 * v });
        s.noise({ duration: 0.04, filter: 'bandpass', from: 1400, q: 3, volume: 0.03 * v, delay: t });
      }
    },
    { reverb: 0.2 },
  );
  // Oars: two strokes through the water.
  a.define(
    'civ_oar',
    (s) => {
      for (const t of [0, 0.42]) s.noise({ duration: 0.28, attack: 0.06, filter: 'bandpass', from: 1300, to: 380, q: 1.4, volume: 0.05, delay: t });
    },
    { reverb: 0.3 },
  );
  // Wheels and tracks: a low rumble and a creak.
  a.define(
    'civ_roll',
    (s) => {
      s.noise({ duration: 0.45, attack: 0.1, filter: 'lowpass', from: 260, to: 120, volume: 0.07 });
      s.tone({ wave: 'sawtooth', from: 70, to: 62, duration: 0.4, attack: 0.08, volume: 0.025, lowpass: 240 });
      s.tone({ wave: 'triangle', from: 540, to: 470, duration: 0.12, delay: 0.18, volume: 0.012 });
    },
    { reverb: 0.2 },
  );
  // An aircraft passing over.
  a.define('civ_fly', (s) => s.noise({ duration: 0.5, attack: 0.25, filter: 'bandpass', from: 380, to: 1600, q: 0.9, volume: 0.06 }), { reverb: 0.4 });

  // ---------- Fights ----------
  // Blades meeting: a ring of metal and a shove, twice.
  a.define(
    'civ_clash',
    (s) => {
      for (const [t, v] of [
        [0, 1],
        [0.11, 0.6],
      ]) {
        s.tone({ wave: 'triangle', from: 2300 + t * 900, to: 1800, duration: 0.25, attack: 0.002, delay: t, volume: 0.05 * v, fm: { ratio: 2.76, depth: 1.1 } });
        s.noise({ duration: 0.09, filter: 'bandpass', from: 3200, to: 1400, q: 0.9, volume: 0.1 * v, delay: t });
      }
      s.noise({ duration: 0.16, filter: 'lowpass', from: 500, to: 150, volume: 0.07 });
    },
    { reverb: 0.3 },
  );
  // A volley loosed: bowstrings, and the arrows' hiss going away.
  a.define(
    'civ_volley',
    (s) => {
      for (const t of [0, 0.03, 0.07]) s.tone({ wave: 'triangle', from: 300 - t * 400, to: 170, duration: 0.08, attack: 0.002, delay: t, volume: 0.04 });
      s.noise({ duration: 0.45, attack: 0.05, filter: 'highpass', from: 5000, to: 2500, volume: 0.035, delay: 0.05 });
    },
    { reverb: 0.3 },
  );
  // A siege engine's or a gun's boom.
  a.define(
    'civ_boom',
    (s) => {
      s.tone({ from: 90, to: 32, duration: 0.6, attack: 0.003, volume: 0.13, drive: 0.3 });
      s.noise({ duration: 0.35, filter: 'lowpass', from: 1200, to: 120, volume: 0.1 });
    },
    { reverb: 0.5 },
  );
  // Where a shell or a stone lands.
  a.define(
    'civ_blast',
    (s) => {
      s.noise({ duration: 0.5, filter: 'lowpass', from: 900, to: 90, volume: 0.1 });
      s.tone({ from: 60, to: 28, duration: 0.45, attack: 0.004, volume: 0.08 });
      s.noise({ duration: 0.3, filter: 'highpass', from: 3000, volume: 0.015, delay: 0.12 });
    },
    { reverb: 0.5 },
  );
  // A unit falling: a heavy thud, its gear clattering down.
  a.define(
    'civ_fell',
    (s) => {
      s.tone({ from: 110, to: 38, duration: 0.5, attack: 0.004, delay: 0.06, volume: 0.11, drive: 0.25 });
      s.noise({ duration: 0.3, filter: 'lowpass', from: 700, to: 140, volume: 0.08, delay: 0.06 });
      for (const t of [0.16, 0.24, 0.3]) s.noise({ duration: 0.05, filter: 'bandpass', from: 2600, q: 2, volume: 0.025, delay: t });
    },
    { reverb: 0.45 },
  );
  // A city's walls hit: stone cracking, rubble.
  a.define(
    'civ_cityhit',
    (s) => {
      s.noise({ duration: 0.22, filter: 'bandpass', from: 700, to: 300, q: 1.6, volume: 0.1 });
      s.tone({ wave: 'square', from: 140, to: 60, duration: 0.2, attack: 0.002, volume: 0.04, drive: 0.5, lowpass: 600 });
      for (const t of [0.12, 0.2, 0.31]) s.noise({ duration: 0.04, filter: 'highpass', from: 2400, volume: 0.02, delay: t });
    },
    { reverb: 0.4 },
  );
  // A city taken: drums, and a horn falling.
  a.define(
    'civ_captured',
    (s) => {
      drum(s, 0, 0.12);
      drum(s, 0.22, 0.1, 1.1);
      drum(s, 0.44, 0.14, 0.9);
      for (const d of [1, 1.006]) s.tone({ wave: 'sawtooth', from: 196 * d, to: 147 * d, duration: 0.6, attack: 0.08, hold: 0.4, delay: 0.5, volume: 0.035, lowpass: { freq: 700, to: 1300, time: 0.4 }, fm: { ratio: 1, depth: 0.3 } });
    },
    { reverb: 0.6 },
  );

  // ---------- Your empire's news ----------
  a.define(
    'civ_found',
    (s) => {
      s.noise({ duration: 0.2, from: 300, to: 120, filter: 'lowpass', volume: 0.35 });
      s.tone({ wave: 'sine', from: 392, duration: 0.5, volume: 0.14, delay: 0.08 });
      s.tone({ wave: 'sine', from: 587, duration: 0.6, volume: 0.12, delay: 0.16 });
    },
    { reverb: 0.4 },
  );
  // A building finished: two taps of a hammer, and a warm fifth.
  a.define(
    'civ_built',
    (s) => {
      for (const t of [0, 0.13]) {
        s.tone({ wave: 'triangle', from: 1900, to: 1500, duration: 0.07, attack: 0.002, delay: t, volume: 0.04, fm: { ratio: 2.76, depth: 0.6 } });
        s.noise({ duration: 0.03, filter: 'bandpass', from: 2600, q: 2, volume: 0.03, delay: t });
      }
      s.tone({ wave: 'sine', from: 392, duration: 0.6, attack: 0.01, delay: 0.26, volume: 0.06 });
      s.tone({ wave: 'sine', from: 587, duration: 0.6, attack: 0.01, delay: 0.26, volume: 0.045 });
    },
    { reverb: 0.4 },
  );
  // A unit trained: a snare's flam and a short call.
  a.define(
    'civ_trained',
    (s) => {
      for (const t of [0, 0.04]) s.noise({ duration: 0.09, filter: 'bandpass', from: 1800, q: 1, volume: 0.05, delay: t });
      s.tone({ wave: 'sawtooth', from: 392, duration: 0.18, attack: 0.02, delay: 0.1, volume: 0.04, lowpass: 1600 });
      s.tone({ wave: 'sawtooth', from: 523, duration: 0.35, attack: 0.02, delay: 0.24, volume: 0.045, lowpass: 1600 });
    },
    { reverb: 0.4 },
  );
  // A tech learned: a quick rising glimmer.
  a.define(
    'civ_tech',
    (s) => {
      [523, 659, 784, 1046, 1318].forEach((f, i) => s.tone({ wave: 'sine', from: f, duration: 0.35, attack: 0.004, delay: i * 0.05, volume: 0.045 - i * 0.004, fm: { ratio: 2, depth: 0.2 } }));
    },
    { reverb: 0.5 },
  );
  // A policy adopted: a seal pressed, and a settled chord.
  a.define(
    'civ_policy',
    (s) => {
      s.noise({ duration: 0.12, filter: 'lowpass', from: 500, to: 180, volume: 0.12 });
      for (const f of [294, 370, 440]) s.tone({ wave: 'triangle', from: f, duration: 0.7, attack: 0.02, delay: 0.1, volume: 0.035, lowpass: 1800 });
    },
    { reverb: 0.5 },
  );
  // A deal made: coins, and two bright notes.
  a.define(
    'civ_deal',
    (s) => {
      for (const t of [0, 0.06, 0.13]) s.tone({ wave: 'sine', from: 2600 + t * 2000, duration: 0.12, attack: 0.002, delay: t, volume: 0.025, fm: { ratio: 3.1, depth: 0.5 } });
      bell(s, 784, 0.22, 0.04, 0.8);
      bell(s, 1046, 0.34, 0.035, 0.9);
    },
    { reverb: 0.4 },
  );
  // A great person born: a choir's chord.
  a.define('civ_great', (s) => choir(s, [220, 277, 330, 440], 0.02, 1.4), { reverb: 0.6 });
  // A unit promoted: a sparkle.
  a.define(
    'civ_promote',
    (s) => {
      for (const [i, f] of [1568, 2093, 2637].entries()) s.tone({ wave: 'sine', from: f, duration: 0.25, attack: 0.003, delay: i * 0.05, volume: 0.025, fm: { ratio: 4, depth: 0.3 } });
    },
    { reverb: 0.5 },
  );
  // A religion founded: a choir under a bell.
  a.define(
    'civ_faith',
    (s) => {
      choir(s, [196, 247, 294], 0.022, 1.8);
      bell(s, 587, 0.15, 0.05, 2);
    },
    { reverb: 0.7 },
  );

  // ---------- The big moments ----------
  const fanfare = (notes: number[], step: number) => (s: SynthKit) => {
    notes.forEach((f, i) => {
      s.tone({ wave: 'sawtooth', from: f * s.pitch, duration: i === notes.length - 1 ? 1.2 : step * 1.4, volume: 0.07, delay: i * step, lowpass: 2200, fm: { ratio: 1, depth: 0.3 }, attack: 0.02 });
      s.tone({ wave: 'sine', from: f * 2 * s.pitch, duration: i === notes.length - 1 ? 1 : step * 1.2, volume: 0.04, delay: i * step });
    });
  };
  a.define('civ_wonder', fanfare([392, 523, 659, 784], 0.16), { reverb: 0.6 });
  a.define('civ_era', fanfare([349, 440, 523, 698], 0.2), { reverb: 0.6 });
  a.define('civ_victory', fanfare([523, 659, 784, 1046, 784, 1046], 0.18), { reverb: 0.6 });
  a.define(
    'civ_bad',
    (s) => {
      s.tone({ wave: 'sawtooth', from: 220, to: 160, duration: 0.5, volume: 0.09, lowpass: 900 });
      s.tone({ wave: 'sawtooth', from: 233, to: 170, duration: 0.5, volume: 0.07, lowpass: 900, delay: 0.05 });
    },
    { reverb: 0.4 },
  );
  // A golden age: a warm chord swelling, glinting on top.
  a.define(
    'civ_golden',
    (s) => {
      for (const f of [294, 370, 440, 587]) s.tone({ wave: 'triangle', from: f, duration: 1.1, attack: 0.5, hold: 0.3, volume: 0.04, lowpass: 2400, vibrato: { rate: 4.5, depth: f * 0.004 } });
      for (let i = 0; i < 6; i++) s.tone({ wave: 'sine', from: [1760, 2217, 2637][i % 3], duration: 0.3, attack: 0.003, delay: 0.35 + i * 0.09, volume: 0.015, fm: { ratio: 4, depth: 0.3 } });
    },
    { reverb: 0.6 },
  );
  // War: three drums and a low horn.
  a.define(
    'civ_war',
    (s) => {
      drum(s, 0, 0.16, 0.9);
      drum(s, 0.3, 0.14, 0.9);
      drum(s, 0.45, 0.18, 0.8);
      for (const d of [1, 1.005]) s.tone({ wave: 'sawtooth', from: 110 * d, duration: 0.7, attack: 0.12, hold: 0.35, delay: 0.5, volume: 0.04, lowpass: { freq: 500, to: 1100, time: 0.4 }, fm: { ratio: 1, depth: 0.4 } });
    },
    { reverb: 0.6 },
  );
  // Peace: a bell, and its fifth.
  a.define(
    'civ_peace',
    (s) => {
      bell(s, 587, 0, 0.07, 2.4);
      bell(s, 880, 0.35, 0.045, 2.2);
    },
    { reverb: 0.7 },
  );
  // A natural wonder found: glassy chimes rising through a breath of air.
  a.define(
    'civ_discover',
    (s) => {
      s.noise({ duration: 0.9, attack: 0.5, filter: 'highpass', from: 2500, to: 6000, volume: 0.02 });
      [1046, 1318, 1568, 2093, 2637].forEach((f, i) => bell(s, f, 0.1 + i * 0.1, 0.03, 1.4));
    },
    { reverb: 0.7 },
  );
}

/** A sound now (unless the game's sound is off, or it just played). */
export function play(cue: Cue, volume = 1) {
  if (prefs.muted || !client) return;
  const last = played.get(cue) ?? -Infinity;
  if (client.time - last < (MARCHING.has(cue) ? MARCH_REST : REST)) return;
  played.set(cue, client.time);
  client.audio.play(`civ_${cue}` as never, { volume });
}

/** News, played a little apart from the rest that comes with it (once each, and only the first few). */
export function soon(cue: Cue, volume = 1) {
  if (waiting.some((w) => w.cue === cue) || waiting.length >= SOON_MOST) return;
  waiting.push({ cue, volume });
}

/** Each frame: the next of the news waiting, when it's due. */
export function frameSounds(now: number) {
  if (!waiting.length || now < nextSoon) return;
  const next = waiting.shift()!;
  play(next.cue, next.volume);
  nextSoon = now + SOON_GAP;
}

export const isMuted = () => prefs.muted;
export function toggleMute() {
  setPrefs({ muted: !prefs.muted });
}
