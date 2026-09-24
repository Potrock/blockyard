import type { SynthKit, SynthVoice } from '../api/types';

type Layer = ['tone' | 'noise', Record<string, unknown>];

/**
 * A synthesised sound as data, so a host can send it to its clients: the `tone` / `noise` layers
 * the voice makes, recorded at pitch 1 and at pitch 2. Played at pitch p, every number in between
 * follows the line through the two (exact for the usual `from: 440 * s.pitch`).
 */
export interface RecordedVoice {
  at1: Layer[];
  /** Null when the voice makes different layers at another pitch: it plays at pitch 1's. */
  at2: Layer[] | null;
}

/** Record a voice; null if it reaches for the Web Audio context directly (it can't be sent). */
export function recordVoice(voice: SynthVoice): RecordedVoice | null {
  try {
    const at1 = run(voice, 1);
    const at2 = run(voice, 2);
    return { at1, at2: same(at1, at2) ? at2 : null };
  } catch {
    return null;
  }
}

/** A recorded voice made playable again. */
export function playRecorded(r: RecordedVoice): SynthVoice {
  return (s) => {
    const k = s.pitch - 1;
    r.at1.forEach(([kind, o], i) => {
      const opts = r.at2 ? lerp(o, r.at2[i][1], k) : o;
      if (kind === 'tone') s.tone(opts as Parameters<SynthKit['tone']>[0]);
      else s.noise(opts as Parameters<SynthKit['noise']>[0]);
    });
  };
}

function run(voice: SynthVoice, pitch: number): Layer[] {
  const layers: Layer[] = [];
  const direct = () => {
    throw new Error('direct Web Audio');
  };
  const kit = {
    pitch,
    tone: (o: Record<string, unknown>) => layers.push(['tone', structuredClone(o)]),
    noise: (o: Record<string, unknown>) => layers.push(['noise', structuredClone(o)]),
    get ctx() {
      return direct();
    },
    get out() {
      return direct();
    },
    get t() {
      return direct();
    },
  } as unknown as SynthKit;
  voice(kit);
  return layers;
}

function same(a: Layer[], b: Layer[]): boolean {
  return a.length === b.length && a.every(([k, o], i) => b[i][0] === k && shape(o) === shape(b[i][1]));
}

const shape = (v: unknown): string => (v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${shape((v as Record<string, unknown>)[k])}`).join(',')}}` : typeof v);

function lerp(a: unknown, b: unknown, k: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * k;
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(a)) out[key] = lerp((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], k);
    return out;
  }
  return a;
}
