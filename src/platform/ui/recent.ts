import { kept } from '../client/storage';

/** A game played from this browser, and when (ms since the epoch). */
export interface Played {
  id: string;
  at: number;
}

const KEY = 'voxel.recent';
/** How many games are remembered. */
const MOST = 8;

/** The games played from this browser, the latest first. */
export function recentGames(): Played[] {
  try {
    const list = JSON.parse(kept.get(KEY) ?? '[]') as unknown;
    if (!Array.isArray(list)) return [];
    return list.filter((p): p is Played => typeof (p as Played)?.id === 'string' && typeof (p as Played)?.at === 'number').slice(0, MOST);
  } catch {
    return [];
  }
}

/** The game played last from this browser (null: none yet). */
export function lastPlayed(): string | null {
  return recentGames()[0]?.id ?? null;
}

/** A game was played just now: it's the latest. */
export function notePlayed(id: string) {
  if (!id) return;
  kept.set(KEY, JSON.stringify([{ id, at: Date.now() }, ...recentGames().filter((p) => p.id !== id)].slice(0, MOST)));
}

/** How long ago, in a few words: "just now", "12 min ago", "3 h ago", "yesterday", "5 days ago". */
export function ago(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60_000));
  if (min < 2) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 2) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return 'a while ago';
}
