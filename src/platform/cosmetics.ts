import type { CosmeticDef, CosmeticSlot, GameMeta } from './api/types';

/**
 * Cosmetics across the platform: the platform's own (anyone signed in can wear them) and every
 * game's (`GameMeta.cosmetics`, given in play), by their ids everywhere: `blockyard:cap`,
 * `callofblocky:gold_fedora`. The server checks what's worn against it; every screen draws from it.
 */
export interface Cosmetic extends CosmeticDef {
  id: string;
  /** Whose it is: a game's id, or null (the platform's). */
  game: string | null;
  /** Anyone signed in has it. */
  free: boolean;
}

/** The platform's own: free for everyone signed in. */
export const PLATFORM_COSMETICS: Record<string, CosmeticDef> = {
  cap: {
    name: 'Red Cap',
    slot: 'hat',
    how: 'Yours to wear',
    model: {
      boxes: [
        // A domed crown on a band, a round bill, a button on top.
        { from: [-4.4, -1.8, -4.4], to: [4.4, 1.3, 4.4], color: '#c9352e', round: 2.1 },
        { from: [-4.4, -2.4, -4.4], to: [4.4, -1, 4.4], color: '#b32b25', round: 0.5 },
        { from: [-3.7, -2.4, 3.4], to: [3.7, -1.9, 7.6], color: '#9c231e', round: 1.8 },
        { from: [-0.6, 1.2, -0.6], to: [0.6, 1.7, 0.6], color: '#9c231e' },
      ],
    },
  },
  beanie: {
    name: 'Beanie',
    slot: 'hat',
    how: 'Yours to wear',
    model: {
      boxes: [
        // A round knit crown, a turned-up cuff, a pom-pom.
        { from: [-4.5, -2.6, -4.5], to: [4.5, 1.7, 4.5], color: '#2f5fb0', round: 2.6 },
        { from: [-4.8, -3.3, -4.8], to: [4.8, -1.7, 4.8], color: '#4b7fd6', round: 0.6 },
        { from: [-1.3, 1.4, -1.3], to: [1.3, 3.6, 1.3], color: '#f1f1ec', round: 1.1 },
      ],
    },
  },
  headphones: {
    name: 'Headphones',
    slot: 'hat',
    how: 'Yours to wear',
    model: {
      boxes: [
        // A band over the head and down each side, a padded cup on each ear, a glowing plate on each.
        { from: [-4.7, 0, -0.8], to: [4.7, 0.7, 0.8], color: '#26272c', round: 0.5 },
        { from: [-5, -3, -0.6], to: [-4.4, 0.5, 0.6], color: '#26272c' },
        { from: [4.4, -3, -0.6], to: [5, 0.5, 0.6], color: '#26272c' },
        { from: [-5.5, -5.9, -1.7], to: [-4.2, -2.6, 1.7], color: '#34363d', round: 0.8 },
        { from: [4.2, -5.9, -1.7], to: [5.5, -2.6, 1.7], color: '#34363d', round: 0.8 },
        { from: [-5.75, -5.2, -1], to: [-5.5, -3.3, 1], color: '#e04f7a', glow: true },
        { from: [5.5, -5.2, -1], to: [5.75, -3.3, 1], color: '#e04f7a', glow: true },
      ],
    },
  },
  backpack: {
    name: 'Backpack',
    slot: 'back',
    how: 'Yours to wear',
    model: {
      boxes: [
        // A rounded pack, its flap over the top, a pocket in front with a buckle, a pocket each side, the straps' tops.
        { from: [-3, -8, 0], to: [3, 0, 3.2], color: '#8a5a32', round: 1 },
        { from: [-3.6, -7, 0.5], to: [3.6, -4.6, 2.5], color: '#7a4e2b', round: 0.5 },
        { from: [-3.1, -2.8, 0], to: [3.1, 0.3, 3.5], color: '#6e4526', round: 1 },
        { from: [-2, -7.2, 2.8], to: [2, -4.2, 3.9], color: '#6e4526', round: 0.5 },
        { from: [-0.4, -3.2, 3.5], to: [0.4, -2.4, 3.75], color: '#d8b24a', round: 0 },
        { from: [-2.6, -0.6, -0.5], to: [-1.6, 0.9, 0.6], color: '#4a2f1b' },
        { from: [1.6, -0.6, -0.5], to: [2.6, 0.9, 0.6], color: '#4a2f1b' },
      ],
    },
  },
  tag_sky: { name: 'Sky Name Tag', slot: 'tag', color: '#7cc8ff', how: 'Yours to wear' },
  tag_mint: { name: 'Mint Name Tag', slot: 'tag', color: '#7ff0b8', how: 'Yours to wear' },
  tag_rose: { name: 'Rose Name Tag', slot: 'tag', color: '#ff8fb8', how: 'Yours to wear' },
  tag_sun: { name: 'Sunshine Name Tag', slot: 'tag', color: '#ffd76a', how: 'Yours to wear' },
};

/** Every cosmetic on the platform, by id: the platform's and each game's. */
export function cosmeticCatalog(games: readonly Pick<GameMeta, 'id' | 'cosmetics'>[]): Map<string, Cosmetic> {
  const out = new Map<string, Cosmetic>();
  for (const [id, def] of Object.entries(PLATFORM_COSMETICS)) out.set(`blockyard:${id}`, { ...def, id: `blockyard:${id}`, game: null, free: true });
  for (const g of games) {
    for (const [id, def] of Object.entries(g.cosmetics ?? {})) out.set(`${g.id}:${id}`, { ...def, id: `${g.id}:${id}`, game: g.id, free: false });
  }
  return out;
}

/** The slots a game shows (`GameMeta.cosmeticSlots`; all by default). */
export function shownSlots(meta: Pick<GameMeta, 'cosmeticSlots'>): Set<CosmeticSlot> {
  return new Set(meta.cosmeticSlots ?? ['hat', 'back', 'title', 'tag']);
}

/**
 * What someone may wear of `wear`: things they own (or free ones) that exist, one per slot (the
 * last of each wins).
 */
export function wearable(wear: readonly string[], owned: ReadonlySet<string>, catalog: ReadonlyMap<string, Cosmetic>): string[] {
  const bySlot = new Map<CosmeticSlot, string>();
  for (const id of wear) {
    const c = catalog.get(id);
    if (c && (c.free || owned.has(id))) bySlot.set(c.slot, id);
  }
  return [...bySlot.values()];
}
