import type { Client, ClientKit } from '@platform/client';

/**
 * The survival part on each player's screen: its voices (eating, drinking, making, learning,
 * levelling up), and the weather at the edges of the view. The item sprites, the HUD's meters and
 * the journal come from the server (an atlas and two widgets), so there's nothing of them here.
 */

export const kits: ClientKit[] = [];

/** The survivor's voices, synthesised on each play. The server plays them by name. */
function defineSounds(client: Client): void {
  const a = client.audio;
  // A bite, while a meal is held to the mouth: a dull crunch.
  a.define(
    'bt_chew',
    (s) => {
      s.noise({ duration: 0.06, filter: 'bandpass', from: 1300 * s.pitch, to: 700, q: 1.6, volume: 0.32 });
      s.tone({ wave: 'sine', from: 170 * s.pitch, to: 110, duration: 0.07, volume: 0.12 });
    },
    { reverb: 0.2 },
  );
  // The meal's gone: a swallow.
  a.define(
    'bt_eat',
    (s) => {
      s.tone({ wave: 'sine', from: 240 * s.pitch, to: 420 * s.pitch, duration: 0.07, volume: 0.22 });
      s.tone({ wave: 'sine', from: 420 * s.pitch, to: 150 * s.pitch, duration: 0.12, delay: 0.07, volume: 0.24 });
    },
    { reverb: 0 },
  );
  // Water: three falling gulps over a splash.
  a.define(
    'bt_drink',
    (s) => {
      s.noise({ duration: 0.3, filter: 'bandpass', from: 2400, to: 900, q: 0.8, volume: 0.1 });
      for (let i = 0; i < 3; i++) s.tone({ wave: 'sine', from: (520 - i * 40) * s.pitch, to: (300 - i * 30) * s.pitch, duration: 0.09, delay: i * 0.13, volume: 0.22 });
    },
    { reverb: 0.1 },
  );
  // Something made: wood knocked on wood, then a bright tick.
  a.define(
    'bt_craft',
    (s) => {
      s.tone({ wave: 'triangle', from: 320 * s.pitch, to: 210, duration: 0.06, volume: 0.3 });
      s.noise({ duration: 0.04, filter: 'highpass', from: 2500, to: 1800, volume: 0.14 });
      s.tone({ wave: 'triangle', from: 480 * s.pitch, to: 330, duration: 0.07, delay: 0.09, volume: 0.28 });
      s.tone({ wave: 'sine', from: 1320 * s.pitch, duration: 0.12, delay: 0.17, volume: 0.14 });
    },
    { reverb: 0 },
  );
  // A recipe learned: two rising notes, ringing a little.
  a.define(
    'bt_learn',
    (s) => {
      s.tone({ wave: 'sine', from: 660 * s.pitch, duration: 0.16, volume: 0.24, fm: { ratio: 2, depth: 0.4, to: 0 } });
      s.tone({ wave: 'sine', from: 990 * s.pitch, duration: 0.3, delay: 0.1, volume: 0.24, fm: { ratio: 2, depth: 0.4, to: 0 } });
    },
    { reverb: 0 },
  );
  // A level gained: a rising arpeggio with a low drum under it.
  a.define(
    'bt_levelup',
    (s) => {
      s.tone({ wave: 'sine', from: 110, to: 70, duration: 0.3, volume: 0.4 });
      [392, 523, 659, 784].forEach((f, i) => s.tone({ wave: 'triangle', from: f * s.pitch, duration: i === 3 ? 0.6 : 0.16, delay: i * 0.09, volume: 0.26, lowpass: 4200 }));
      s.tone({ wave: 'sine', from: 1568 * s.pitch, duration: 0.7, delay: 0.27, volume: 0.1 });
    },
    { reverb: 0.15 },
  );
  // Clothes on or off: a rustle and a buckle.
  a.define(
    'bt_equip',
    (s) => {
      s.noise({ duration: 0.14, filter: 'bandpass', from: 900, to: 2200, q: 0.7, volume: 0.22 });
      s.tone({ wave: 'square', from: 1700 * s.pitch, duration: 0.025, delay: 0.12, volume: 0.08, lowpass: 3000 });
    },
    { reverb: 0 },
  );
  // No: a soft double thud.
  a.define(
    'bt_deny',
    (s) => {
      s.tone({ wave: 'triangle', from: 190, to: 150, duration: 0.07, volume: 0.24 });
      s.tone({ wave: 'triangle', from: 160, to: 120, duration: 0.09, delay: 0.09, volume: 0.24 });
    },
    { reverb: 0 },
  );
}

const WEATHER_CSS = `
.bt-weather { position: absolute; inset: 0; opacity: 0; transition: opacity 1.2s ease; pointer-events: none }
.bt-weather.cold { opacity: 0.45; background: radial-gradient(ellipse at center, #0000 55%, #9fd8ff55 100%) }
.bt-weather.freezing { opacity: 1; background: radial-gradient(ellipse at center, #0000 40%, #bfe6ffaa 100%) }
.bt-weather.hot { opacity: 0.45; background: radial-gradient(ellipse at center, #0000 55%, #ff9a4a44 100%) }
.bt-weather.scorching { opacity: 1; background: radial-gradient(ellipse at center, #0000 40%, #ff7a2a88 100%) }
`;

let weather: HTMLElement | null = null;

export function setup(client: Client): void {
  defineSounds(client);
  client.hud.style(WEATHER_CSS);
  weather = document.createElement('div');
  weather.className = 'bt-weather';
  client.hud.layer('bt-weather', 'lens').appendChild(weather);
  // The server says when the weather starts or stops biting ("cold", "scorching", or "ok").
  client.on('bt.weather', (data) => {
    const state = (data as { state?: unknown } | null)?.state;
    if (weather) weather.className = `bt-weather ${typeof state === 'string' && /^[a-z]+$/.test(state) ? state : ''}`;
  });
}

export function frame(_client: Client, _dt: number): void {}
