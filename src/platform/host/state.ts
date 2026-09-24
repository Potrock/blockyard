import type { PresentCall } from '../net/protocol';

/**
 * Which presentation calls set something that stays on screen (an objective, a stat, a marker)
 * rather than happening once (a banner, a sound): their key, or null. Calls with the same key
 * replace each other.
 */
function keyOf(c: PresentCall): string | null {
  if (c.target === 'hud') {
    switch (c.method) {
      case 'objective':
      case 'crosshair':
      case 'radar':
      case 'progress':
      case 'highlight':
        return c.method;
      case 'bossBar':
      case 'hideBossBar':
        return 'bossBar';
      case 'stat':
      case 'meter':
      case 'marker':
        return `${c.method}:${String(c.args[0])}`;
    }
  }
  if (c.target === 'view' && (c.method === 'visible' || c.method === 'setSkin')) return `view.${c.method}`;
  return null;
}

interface Kept {
  call: PresentCall;
  json: string;
}

/**
 * What the presentation calls have put on each player's screen, kept by key. It drops a call that
 * would change nothing (games often set their objective or markers every tick), and tells a player
 * who joins late what everyone already sees.
 */
export class PresentState {
  private everyone = new Map<string, Kept>();
  private personal = new Map<string, Map<string, Kept>>();

  /** Whether the call needs sending (false: the screen already shows exactly this). */
  admit(c: PresentCall): boolean {
    if (c.target === 'client' && c.method === 'reset') {
      // A restart clears every screen.
      this.everyone.clear();
      this.personal.clear();
      return true;
    }
    const key = keyOf(c);
    if (key === null) return true;
    const json = c.method + JSON.stringify(c.args);
    if (c.to === null) {
      // After a personal call with this key, the screens differ: send the next one to everyone.
      const same = this.everyone.get(key)?.json === json && !this.personal.has(key);
      this.everyone.set(key, { call: c, json });
      this.personal.delete(key);
      return !same;
    }
    let mine = this.personal.get(key);
    if (!mine) this.personal.set(key, (mine = new Map()));
    const same = mine.get(c.to)?.json === json;
    mine.set(c.to, { call: c, json });
    return !same;
  }

  /** The calls that bring a new client's screen up to date: what everyone sees, then their own. */
  snapshot(player: string): PresentCall[] {
    const out = [...this.everyone.values()].map((k) => k.call);
    for (const mine of this.personal.values()) {
      const k = mine.get(player);
      if (k) out.push(k.call);
    }
    return out;
  }

  /** A player left for good. */
  forget(player: string) {
    for (const mine of this.personal.values()) mine.delete(player);
  }
}
