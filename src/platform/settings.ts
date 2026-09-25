import type { RenderSettings } from './render/pipeline';

export type ShadowQuality = 'off' | 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  renderDistance: number;
  shadows: ShadowQuality;
  msaa: boolean;
  bloom: boolean;
  godrays: boolean;
  ssr: boolean;
  clouds: boolean;
  renderScale: number;
  fov: number;
  sensitivity: number;
  /** Controllers: how fast the right stick turns (1 = the platform's), pulling it down looks down (false) or up, rumble, aim assist with guns. */
  stickSensitivity: number;
  invertY: boolean;
  vibration: boolean;
  aimAssist: boolean;
  viewBobbing: boolean;
  dayMinutes: number;
  occlusion: boolean;
  /** Graphics lowered a notch at a time while frames are slow (these settings are the most it shows). */
  autoQuality: boolean;
}

const KEY = 'voxel.settings.v1';

export function defaultSettings(): Settings {
  const dpr = window.devicePixelRatio || 1;
  return {
    renderDistance: 12,
    shadows: 'high',
    msaa: true,
    bloom: true,
    godrays: true,
    ssr: true,
    clouds: true,
    renderScale: dpr > 1.5 ? 0.75 : 1,
    fov: 75,
    sensitivity: 1,
    stickSensitivity: 1,
    invertY: false,
    vibration: true,
    aimAssist: true,
    viewBobbing: true,
    dayMinutes: 20,
    occlusion: true,
    autoQuality: true,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...d, ...JSON.parse(raw) };
  } catch {
    // Storage unavailable: use defaults.
  }
  return d;
}

/** The settings auto quality works within: a change to any of them starts it again from the top. */
export const GRAPHICS: (keyof Settings)[] = ['shadows', 'msaa', 'bloom', 'godrays', 'ssr', 'clouds', 'renderScale', 'autoQuality'];

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Ignore quota / privacy errors.
  }
}

const SHADOW: Record<ShadowQuality, [number, number]> = {
  off: [0, 64],
  low: [1024, 48],
  medium: [2048, 72],
  high: [3072, 96],
  ultra: [4096, 128],
};

export function toRenderSettings(s: Settings): RenderSettings {
  const [res, dist] = SHADOW[s.shadows];
  return {
    msaa: s.msaa ? 4 : 0,
    shadowRes: res,
    shadowDistance: dist,
    bloom: s.bloom,
    godrays: s.godrays,
    ssr: s.ssr,
    renderScale: s.renderScale,
    clouds: s.clouds,
  };
}
