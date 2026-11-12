import { check, launch } from './_harness';

/** Blocktaceous starts, and a survivor stands on the island for ten seconds without the rules throwing. */
export default function blocktaceous() {
  const h = launch('blocktaceous', { seed: 7 });
  h.run(10, { pilot: () => ({}) });
  check(h.ctx.player.alive, 'the survivor died standing still');
}
