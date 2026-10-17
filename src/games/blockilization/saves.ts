/**
 * When the game's save is written (`server.ts`). A late game's save is a few hundred kilobytes,
 * and an uploaded game's room sends every write on to the server's database: written at every
 * order, a busy minute came to tens of megabytes. So what matters is saved at once (a turn's end,
 * the game begun, the last person gone), and the orders in between at most once every `every`
 * seconds: the first at once, the rest together a little later. A restart then carries on from
 * the latest turn's start at worst (and in practice from a few seconds before it stopped).
 */
export class SaveThrottle {
  /** When the last save was written (game seconds), and whether a change waits for the next. */
  private last = -Infinity;
  private waiting = false;

  constructor(private readonly every: number) {}

  /** Something changed: whether to save now (it's been long enough since the last); else it waits for `tick`. */
  changed(now: number): boolean {
    if (now - this.last >= this.every) return true;
    this.waiting = true;
    return false;
  }

  /** Each tick: whether a change that waited is due now. */
  tick(now: number): boolean {
    return this.waiting && now - this.last >= this.every;
  }

  /** Saved now, whatever the reason: nothing waits. */
  saved(now: number) {
    this.last = now;
    this.waiting = false;
  }

  /** Whether a change waits to be saved. */
  get pending(): boolean {
    return this.waiting;
  }

  /** A new match (the game's clock starts again): nothing saved yet, nothing waiting. */
  reset() {
    this.last = -Infinity;
    this.waiting = false;
  }
}
