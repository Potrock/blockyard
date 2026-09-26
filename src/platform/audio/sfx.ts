import type { LoopHandle, LoopName, SoundName, SynthKit, SynthVoice, Vec3 } from '../api/types';

type Voice = (ctx: AudioContext, out: AudioNode, t: number, p: number) => void;

/** The sounds the engine keeps: its world's (blocks, pickups, getting hurt) and its screens' (jingles, clicks). */
type EngineSound = 'hit' | 'hurt' | 'pickup' | 'heal' | 'wave' | 'victory' | 'defeat' | 'spawn' | 'click' | 'countdown' | 'lock' | 'alarm';

/** Procedurally synthesised sound effects (no audio assets), positional relative to the camera. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private listener = { x: 0, y: 0, z: 0, rx: 1, rz: 0 };
  private last = new Map<string, number>();
  volume = 0.7;

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  /** Done (switching games): release the audio device. */
  close() {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private held = false;

  /** Freeze all sound (pause menus): loops stop where they are and resume with the game. */
  hold(on: boolean) {
    if (on === this.held || !this.ctx) return;
    this.held = on;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  setListener(pos: Vec3, yaw: number) {
    this.listener.x = pos.x;
    this.listener.y = pos.y;
    this.listener.z = pos.z;
    this.listener.rx = Math.cos(yaw);
    this.listener.rz = -Math.sin(yaw);
  }

  /** The game's own sounds, from its server (`audio.define` there). */
  private custom = new Map<string, SynthVoice>();
  /** Sounds client code defines (kits, the game's client code): under the server's of the same name. */
  private local = new Map<string, SynthVoice>();
  private warned = new Set<string>();

  /** Add or replace a sound of the game's, from its server (games bring their own; see `SynthKit`). */
  define(name: string, voice: SynthVoice) {
    this.custom.set(name, voice);
  }

  /** Add or replace a sound client code defines (`client.audio.define`): the server's own of the same name wins. */
  defineLocal(name: string, voice: SynthVoice) {
    this.local.set(name, voice);
  }

  play(name: SoundName, opts: { at?: Vec3; volume?: number; pitch?: number } = {}) {
    // (Silent until the audio's running: the client code's sounds are defined by then.)
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running') return;
    const custom = this.custom.get(name) ?? this.local.get(name);
    const builtin = (VOICES as Record<string, Voice | undefined>)[name];
    if (!custom && !builtin) {
      if (!this.warned.has(name)) {
        this.warned.add(name);
        console.warn(`audio.play: unknown sound "${name}" (define it with audio.define)`);
      }
      return;
    }
    // Throttle identical sounds within 30 ms (large waves hitting at once).
    const now = ctx.currentTime;
    if ((this.last.get(name) ?? -1) > now - 0.03) return;
    this.last.set(name, now);
    let gain = opts.volume ?? 1;
    let pan = 0;
    if (opts.at) {
      const dx = opts.at.x - this.listener.x;
      const dy = opts.at.y - this.listener.y;
      const dz = opts.at.z - this.listener.z;
      const d = Math.hypot(dx, dy, dz);
      gain *= 1 / (1 + d * 0.09);
      if (d > 0.5) pan = Math.max(-0.85, Math.min(0.85, (dx * this.listener.rx + dz * this.listener.rz) / d));
    }
    if (gain < 0.02) return;
    const g = ctx.createGain();
    g.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    g.connect(panner).connect(this.master);
    if (custom) custom(synthKit(this, ctx, g, now + 0.005, opts.pitch ?? 1));
    else builtin!.call(this, ctx, g, now + 0.005, opts.pitch ?? 1);
    window.setTimeout(() => g.disconnect(), 3000);
  }

  /** Start a continuous sound (engine, wind). Safe to call before audio is unlocked: it's silent then. */
  loop(name: LoopName, opts: { volume?: number; pitch?: number } = {}): LoopHandle {
    const ctx = this.ctx;
    if (!ctx || !this.master) return { set() {}, stop() {} };
    const l = LOOPS[name](this, ctx, this.master);
    let volume = opts.volume ?? 1;
    let pitch = opts.pitch ?? 1;
    l.set(volume, pitch);
    let stopped = false;
    return {
      set(o) {
        if (stopped) return;
        volume = o.volume ?? volume;
        pitch = o.pitch ?? pitch;
        l.set(volume, pitch);
      },
      stop() {
        if (stopped) return;
        stopped = true;
        l.stop();
      },
    };
  }

  // ---- building blocks ----

  noiseSrc(ctx: AudioContext): AudioBufferSourceNode {
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }
}

function env(ctx: AudioContext, t: number, attack: number, decay: number, peak = 1): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function osc(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function filter(ctx: AudioContext, type: BiquadFilterType, f: number, q = 1): BiquadFilterNode {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

function noiseBurst(self: Sfx, ctx: AudioContext, out: AudioNode, t: number, dur: number, type: BiquadFilterType, f0: number, f1: number, peak: number, q = 1) {
  const n = self.noiseSrc(ctx);
  const f = filter(ctx, type, f0, q);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const e = env(ctx, t, 0.005, dur, peak);
  n.connect(f).connect(e).connect(out);
  n.start(t, Math.random() * 0.5);
  n.stop(t + dur + 0.05);
}

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, peak: number, lowpass = 0) {
  const o = osc(ctx, type, f0, f1, t, dur);
  const e = env(ctx, t, 0.008, dur, peak);
  if (lowpass > 0) o.connect(filter(ctx, 'lowpass', lowpass)).connect(e).connect(out);
  else o.connect(e).connect(out);
}

/** The toolkit handed to game-defined sounds. */
function synthKit(self: Sfx, ctx: AudioContext, out: AudioNode, t: number, pitch: number): SynthKit {
  return {
    pitch,
    tone(o) {
      const start = t + (o.delay ?? 0);
      const dur = o.duration;
      const node = osc(ctx, o.wave ?? 'sine', o.from, o.to ?? o.from, start, dur);
      if (o.vibrato) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = o.vibrato.rate;
        const lg = ctx.createGain();
        lg.gain.value = o.vibrato.depth;
        lfo.connect(lg).connect(node.frequency);
        lfo.start(start);
        lfo.stop(start + dur + 0.05);
      }
      let chain: AudioNode = node;
      if (o.lowpass) chain = chain.connect(filter(ctx, 'lowpass', o.lowpass));
      if (o.bandpass) {
        const bp = filter(ctx, 'bandpass', o.bandpass.freq, o.bandpass.q ?? 1);
        if (o.bandpass.to) {
          bp.frequency.setValueAtTime(o.bandpass.freq, start);
          bp.frequency.exponentialRampToValueAtTime(o.bandpass.to, start + dur);
        }
        chain = chain.connect(bp);
      }
      chain.connect(env(ctx, start, o.attack ?? 0.008, dur, o.volume ?? 0.5)).connect(out);
    },
    noise(o) {
      noiseBurst(self, ctx, out, t + (o.delay ?? 0), o.duration, o.filter ?? 'bandpass', o.from, o.to ?? o.from, o.volume ?? 0.3, o.q ?? 1);
    },
  };
}

/** The engine's own sounds: its world's and its screens' (the sounds kit, `sounds.standard()`, defines the rest). */
const VOICES: Record<EngineSound, Voice> = {
  hit(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'sine', 170 * p, 55, t, 0.14, 0.9);
    noiseBurst(this, ctx, out, t, 0.05, 'highpass', 2500, 1500, 0.35);
  },
  hurt(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'sawtooth', 240 * p, 120 * p, t, 0.22, 0.35, 1200);
    noiseBurst(this, ctx, out, t, 0.12, 'lowpass', 1500, 400, 0.3);
  },
  pickup(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'sine', 880 * p, 880 * p, t, 0.07, 0.3);
    tone(ctx, out, 'sine', 1320 * p, 1320 * p, t + 0.07, 0.1, 0.3);
  },
  heal(this: Sfx, ctx, out, t, p) {
    [660, 880, 1100].forEach((f, i) => tone(ctx, out, 'sine', f * p, f * p * 1.01, t + i * 0.06, 0.35, 0.18));
  },
  wave(this: Sfx, ctx, out, t, p) {
    const f = filter(ctx, 'lowpass', 300);
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
    const e = env(ctx, t, 0.15, 1.1, 0.35);
    f.connect(e).connect(out);
    for (const fr of [110, 165, 220.5]) osc(ctx, 'sawtooth', fr * p, fr * p, t, 1.3).connect(f);
  },
  victory(this: Sfx, ctx, out, t) {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(ctx, out, 'square', f, f, t + i * 0.13, i === 5 ? 0.8 : 0.16, 0.14, 3000));
    [262, 330, 392].forEach((f) => tone(ctx, out, 'triangle', f, f, t + 0.65, 1.0, 0.18));
  },
  defeat(this: Sfx, ctx, out, t) {
    [392, 370, 349, 262].forEach((f, i) => tone(ctx, out, 'sawtooth', f, f * 0.98, t + i * 0.28, i === 3 ? 1.0 : 0.3, 0.16, 1400));
  },
  spawn(this: Sfx, ctx, out, t, p) {
    noiseBurst(this, ctx, out, t, 0.5, 'bandpass', 400 * p, 2400 * p, 0.25, 2);
    tone(ctx, out, 'sine', 300 * p, 900 * p, t + 0.05, 0.4, 0.12);
  },
  click(this: Sfx, ctx, out, t) {
    tone(ctx, out, 'sine', 1200, 900, t, 0.04, 0.2);
  },
  countdown(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'square', 660 * p, 660 * p, t, 0.12, 0.18, 2500);
  },
  lock(this: Sfx, ctx, out, t, p) {
    tone(ctx, out, 'square', 1480 * p, 1480 * p, t, 0.06, 0.14, 4000);
    tone(ctx, out, 'square', 1480 * p, 1480 * p, t + 0.09, 0.06, 0.14, 4000);
  },
  alarm(this: Sfx, ctx, out, t, p) {
    for (let i = 0; i < 3; i++) tone(ctx, out, 'square', (i % 2 ? 520 : 760) * p, (i % 2 ? 520 : 760) * p, t + i * 0.16, 0.14, 0.12, 2200);
  },
};

type Loop = { set(volume: number, pitch: number): void; stop(): void };

/** Continuous sounds, built per start from oscillators and noise. */
const LOOPS: Record<LoopName, (self: Sfx, ctx: AudioContext, out: AudioNode) => Loop> = {
  // Thruster roar: detuned saws and a sub under a lowpass, plus filtered noise.
  engine(self, ctx, out) {
    const lp = filter(ctx, 'lowpass', 600, 0.7);
    const g = ctx.createGain();
    g.gain.value = 0;
    lp.connect(g).connect(out);
    const oscs = [58, 58.7, 29].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'square' : 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      return { o, f };
    });
    const n = self.noiseSrc(ctx);
    const bp = filter(ctx, 'bandpass', 900, 0.8);
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(bp).connect(ng).connect(g);
    n.start();
    return {
      set(volume, pitch) {
        const t = ctx.currentTime;
        for (const { o, f } of oscs) o.frequency.setTargetAtTime(f * pitch, t, 0.08);
        lp.frequency.setTargetAtTime(350 + 900 * pitch, t, 0.08);
        bp.frequency.setTargetAtTime(600 + 1200 * pitch, t, 0.08);
        g.gain.setTargetAtTime(volume * 0.3, t, 0.08);
      },
      stop() {
        const t = ctx.currentTime;
        g.gain.setTargetAtTime(0, t, 0.1);
        window.setTimeout(() => {
          for (const { o } of oscs) o.stop();
          n.stop();
          g.disconnect();
        }, 600);
      },
    };
  },
  wind(self, ctx, out) {
    const n = self.noiseSrc(ctx);
    const bp = filter(ctx, 'bandpass', 500, 0.5);
    const g = ctx.createGain();
    g.gain.value = 0;
    n.connect(bp).connect(g).connect(out);
    n.start();
    return {
      set(volume, pitch) {
        const t = ctx.currentTime;
        bp.frequency.setTargetAtTime(300 + 900 * pitch, t, 0.15);
        g.gain.setTargetAtTime(volume * 0.4, t, 0.15);
      },
      stop() {
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
        window.setTimeout(() => {
          n.stop();
          g.disconnect();
        }, 600);
      },
    };
  },
};
