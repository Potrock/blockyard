import { ITEMS } from '../items';

/**
 * Where each item's sprite is in the game's item atlas: a 16x16 cell, sixteen to a row. The cells
 * are handed out from the game's vocabulary (`items.ts`) in the order it lists them, so an item
 * another part adds gets a cell (and a sprite: `art.ts` paints one for everything) without anyone
 * keeping a table. Pure, so the rules and every screen agree.
 */

export const ICON_ATLAS = 'bt_items';

/** Sprites across the atlas. */
export const ICON_COLUMNS = 16;

/** The HUD's own glyphs have the first row; items start on the second. */
export const UI_GLYPHS = ['food', 'water', 'breath', 'cold', 'heat', 'load', 'spark', 'head', 'body', 'feet', 'unknown', 'star'] as const;
export type UiGlyph = (typeof UI_GLYPHS)[number];

const ITEM_IDS = Object.keys(ITEMS);
const ITEM_INDEX = new Map(ITEM_IDS.map((id, i) => [id, ICON_COLUMNS + i]));

/** Every item with a cell, in cell order. */
export const iconItems = (): readonly string[] => ITEM_IDS;

/** Rows of the atlas in use. */
export const iconRows = (): number => 1 + Math.ceil(ITEM_IDS.length / ICON_COLUMNS);

/** An item's cell (column, row); something the vocabulary doesn't list gets the question mark. */
export function iconCell(item: string): { x: number; y: number } {
  const i = ITEM_INDEX.get(item) ?? UI_GLYPHS.indexOf('unknown');
  return { x: i % ICON_COLUMNS, y: Math.floor(i / ICON_COLUMNS) };
}

export function glyphCell(glyph: UiGlyph): { x: number; y: number } {
  return { x: UI_GLYPHS.indexOf(glyph), y: 0 };
}

/** An item's sprite as the platform takes one (`icon`, a look's `icon`). */
export function iconSprite(item: string): { atlas: string; x: number; y: number } {
  const c = iconCell(item);
  return { atlas: ICON_ATLAS, x: c.x * 16, y: c.y * 16 };
}
