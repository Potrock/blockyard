import type { Anchor, MarkerOptions, Player } from '@platform';

/**
 * Markers over things in the world, each player's own, sent only when what they say changes:
 * tames' name tags (tames.ts) and the meters over animals being tamed.
 */
export class Tags {
  private shown = new Map<string, Map<string, string>>();
  private seen = new Set<string>();

  constructor(private prefix: string) {}

  /** Begin a pass over one player's tags. */
  begin() {
    this.seen.clear();
  }

  /** `anchor`: what `at` is (an entity's id): a tag whose anchor changes is put up afresh. */
  tag(player: Player, id: string, at: Anchor, opts: MarkerOptions, anchor: string | number = '') {
    const key = `${this.prefix}${id}`;
    this.seen.add(key);
    let mine = this.shown.get(player.id);
    if (!mine) this.shown.set(player.id, (mine = new Map()));
    const sig = `${anchor}|${JSON.stringify(opts)}`;
    if (mine.get(key) === sig) return;
    mine.set(key, sig);
    player.hud.marker(key, at, opts);
  }

  /** End the pass: whatever wasn't tagged in it goes. */
  end(player: Player) {
    const mine = this.shown.get(player.id);
    if (!mine) return;
    for (const key of [...mine.keys()]) {
      if (this.seen.has(key)) continue;
      mine.delete(key);
      player.hud.marker(key, null);
    }
  }

  reset() {
    this.shown.clear();
  }

  forget(player: Player) {
    this.shown.delete(player.id);
  }
}
