import { ATLAS, Canvas, SpriteCanvas, hash3, hexc, unit, type Col, type Ink } from '@platform/art';
import type { GameContext, ModelPart, ModelSpec, SpriteRef } from '@platform';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../species';

/**
 * The creatures' own art, painted in code into one atlas: the icons of the taming gear, the
 * saddles and what a carcass yields, and a plain hide for each species' stand-in figure (the box
 * animal shown until its real model has been built: see `standIn`).
 */
export const CREATURE_ATLAS = 'bt_creatures';

/** Each species' stand-in hide: a cell of the atlas, and its colours (hide, markings). */
const CELL = 48;
const HIDES: Record<SpeciesId, [number, number]> = {
  dodo: [0x8d8a86, 0x5d5a58],
  compsognathus: [0x7f9a4a, 0x566b2e],
  dilophosaurus: [0x6f8f5e, 0xc9a43a],
  parasaurolophus: [0xb98a4e, 0x7d4f2a],
  triceratops: [0x8a7a5c, 0x5e5140],
  stegosaurus: [0x6e7f4f, 0xb5622f],
  ankylosaurus: [0x8c6f4c, 0x5a452d],
  utahraptor: [0x9a5a34, 0x3d2a1e],
  carnotaurus: [0x9c3f30, 0x5c211b],
  pteranodon: [0xb9a27c, 0x7b4a3a],
  brachiosaurus: [0x7d8f8a, 0x55655f],
  tyrannosaurus: [0x5f5a3c, 0x38351f],
  spinosaurus: [0x4f7a78, 0xc46a2e],
  sarcosuchus: [0x4f5e3a, 0x2f3a22],
  mammoth: [0x6b4a30, 0x47301e],
  smilodon: [0xc49a55, 0x8a6430],
};
const cellOf = (id: SpeciesId): [number, number] => {
  const i = SPECIES_IDS.indexOf(id);
  return [(i % 5) * CELL, Math.floor(i / 5) * CELL];
};

/** The icons' cells: 16 by 16, in the rows under the hides. */
const SPRITES = ['bola', 'wooden_club', 'blowpipe', 'sleep_dart', 'saddle_small', 'saddle_medium', 'saddle_large', 'saddle_giant', 'raw_meat', 'prime_meat', 'raw_fish', 'hide', 'keratin', 'feather', 'egg', 'cooked_meat', 'cooked_fish'] as const;
export type SpriteId = (typeof SPRITES)[number];
export function iconOf(id: SpriteId): SpriteRef {
  const i = SPRITES.indexOf(id);
  return { atlas: CREATURE_ATLAS, x: (i % 16) * 16, y: 208 + Math.floor(i / 16) * 16 };
}
export const hasIcon = (id: string): id is SpriteId => (SPRITES as readonly string[]).includes(id);

const OL = 0x1b1410;
const INK: readonly Ink[] = [
  ['w', 0x9a6a3a, OL, 0], // wood
  ['W', 0x6f4826, OL, 0],
  ['s', 0x9b9b96, OL, 0], // stone
  ['S', 0x6e6e6a, OL, 0],
  ['r', 0xcdb98a, OL, 0], // rope and fiber
  ['R', 0x9c8758, OL, 0],
  ['p', 0xa25bd0, OL, 0], // the dart's sleeping draught
  ['f', 0xe9e2d2, OL, 0], // fletching
  ['b', 0x3a2a1c, OL, 0],
];
const ART: Partial<Record<SpriteId, string[]>> = {
  bola: ['', '   ss', '  sSSs      ss', '  sSSs     sSSs', '   ssr     sSSs', '     r     rss', '      r   r', '      Rr r', '       rR', '       r', '      rR', '      r', '    ssr', '   sSSs', '   sSSs', '    ss'],
  wooden_club: ['', '          www', '         wwwww', '        wwwWww', '        wwWwww', '        wwwwWw', '        wWwww', '       wwww', '      www', '     www', '    wWw', '   rww', '  rRw', '  wr', ' ww', ''],
  blowpipe: ['', '             rr', '            wwr', '           wWw', '          wWw', '         wWw', '        rRw', '       rRw', '      wWw', '     wWw', '    wWw', '   wWw', '  rRw', ' wrr', ' ww', ''],
  sleep_dart: ['', '', '            p', '           pp', '          pp', '         ss', '        ss', '       ww', '      ww', '     ww', '    ww', '  ffw', ' fffw', ' ff f', '  f', ''],
};

function sprite(cv: Canvas, id: SpriteId, draw: (s: SpriteCanvas) => void) {
  const s = new SpriteCanvas();
  draw(s);
  s.outline();
  const at = iconOf(id) as { x: number; y: number };
  s.blit(cv, at.x, at.y);
}

/** A filled, shaded oval: resources' blobs (a steak, a hide, an egg). */
function blob(s: SpriteCanvas, cx: number, cy: number, rx: number, ry: number, base: number, dark: number, light: number) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d > 1) continue;
      const lit = (cx - x) / rx + (cy - y) / ry;
      s.put(x, y, d > 0.62 && lit < 0 ? dark : lit > 0.75 ? light : base, OL);
    }
  }
}

/** A saddle seen from the side: a seat on a blanket, a girth below; bigger animals' have more to them. */
function saddle(s: SpriteCanvas, size: number, leather: number, dark: number, trim: number) {
  const w = 5 + size * 1.5;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = x - 7.5;
      const seat = y >= 5 && y <= 8 && Math.abs(dx) <= w && y >= 5 + Math.round((1 - Math.abs(dx) / w) * 1.5);
      const horn = y >= 3 && y <= 5 && Math.abs(Math.abs(dx) - w + 0.5) <= 1;
      const blanket = y >= 9 && y <= 10 && Math.abs(dx) <= w + 0.5;
      const flap = y >= 11 && y <= 12 + (size > 1 ? 1 : 0) && Math.abs(dx) <= w - 2;
      const girth = y >= 11 && y <= 14 && Math.abs(Math.abs(dx) - 1) < 1 && !flap;
      if (seat || horn) s.put(x, y, y === 5 || horn ? dark : leather, OL);
      else if (blanket) s.put(x, y, trim, OL);
      else if (flap) s.put(x, y, dark, OL);
      else if (girth) s.put(x, y, 0x8c8478, OL);
    }
  }
  if (size >= 2) for (let x = 3; x <= 12; x += 3) s.put(x, 7, 0xd8c48a, OL);
  if (size >= 3) for (let x = 2; x <= 13; x++) s.put(x, 2, x % 3 === 0 ? 0x6f4826 : 0x9a6a3a, OL);
}

let painted: { albedo: Uint8Array; emissive: Uint8Array } | null = null;

function paint(): { albedo: Uint8Array; emissive: Uint8Array } {
  const cv = new Canvas();
  for (const id of SPECIES_IDS) {
    const [ox, oy] = cellOf(id);
    const [hide, mark] = HIDES[id];
    const a = hexc(hide);
    const b = hexc(mark);
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        // Mottled hide with darker bands: every part of the box animal wears the same cell.
        const n = unit(hash3(x, y, 0, 17 + ox + oy));
        const band = (x + Math.floor(y / 3)) % 9 < 2;
        const k = band ? 0.75 : n < 0.18 ? 0.35 : 0;
        const shade = 0.9 + n * 0.2;
        const c: Col = [0, 1, 2].map((i) => Math.min(255, (a[i] * (1 - k) + b[i] * k) * shade)) as Col;
        cv.set(ox + x, oy + y, c, 0);
      }
    }
  }
  for (const [id, rows] of Object.entries(ART)) sprite(cv, id as SpriteId, (s) => s.art(rows, INK));
  sprite(cv, 'saddle_small', (s) => saddle(s, 0, 0x8a5a34, 0x5f3a20, 0xb7a06a));
  sprite(cv, 'saddle_medium', (s) => saddle(s, 1, 0x8a5a34, 0x5f3a20, 0x9c4a3a));
  sprite(cv, 'saddle_large', (s) => saddle(s, 2, 0x6a4630, 0x432a1c, 0x3f6f8a));
  sprite(cv, 'saddle_giant', (s) => saddle(s, 3, 0x6a4630, 0x432a1c, 0x7a4f9a));
  sprite(cv, 'raw_meat', (s) => (blob(s, 7.5, 8, 5.5, 4.5, 0xc4453f, 0x8f2a2a, 0xe57a6e), s.put(11, 6, 0xf0e6d2, OL), s.put(12, 5, 0xf0e6d2, OL)));
  sprite(cv, 'prime_meat', (s) => (blob(s, 7.5, 8, 6.5, 5.5, 0xb02f45, 0x7a1c30, 0xe0637a), blob(s, 7, 8, 2, 1.5, 0xf3d9cf, 0xf3d9cf, 0xffffff)));
  sprite(cv, 'cooked_meat', (s) => (blob(s, 7.5, 8, 5.5, 4.5, 0x8a5230, 0x5a3320, 0xb97a48), s.put(11, 6, 0xf0e6d2, OL), s.put(12, 5, 0xf0e6d2, OL)));
  sprite(cv, 'raw_fish', (s) => (blob(s, 7, 8, 5.5, 3, 0x7fa6b8, 0x4f7186, 0xc4dde6), s.put(13, 6, 0x4f7186, OL), s.put(13, 10, 0x4f7186, OL), s.put(14, 5, 0x4f7186, OL), s.put(14, 11, 0x4f7186, OL), s.put(4, 7, 0x10202a, 0)));
  sprite(cv, 'cooked_fish', (s) => (blob(s, 7, 8, 5.5, 3, 0xc08a4a, 0x8a5a2a, 0xe6bf7a), s.put(13, 6, 0x8a5a2a, OL), s.put(13, 10, 0x8a5a2a, OL), s.put(14, 5, 0x8a5a2a, OL), s.put(14, 11, 0x8a5a2a, OL)));
  sprite(cv, 'hide', (s) => (blob(s, 7.5, 8, 6.5, 5, 0x9a7044, 0x6c4c2c, 0xbd9462), s.put(2, 3, 0x9a7044, OL), s.put(13, 3, 0x9a7044, OL), s.put(2, 13, 0x6c4c2c, OL), s.put(13, 13, 0x6c4c2c, OL)));
  sprite(cv, 'keratin', (s) => {
    // A horn: a curve tapering to its tip at the top right.
    for (let i = 0; i < 12; i++) {
      const w = Math.round(3 - i / 4.5);
      for (let k = 0; k <= w; k++) s.put(3 + i, 13 - i + Math.round((i * i) / 30) + k - 1, k === 0 ? 0xe9dfc4 : 0xb9a886, OL);
    }
  });
  sprite(cv, 'feather', (s) => {
    for (let i = 0; i < 12; i++) {
      const w = i < 3 ? 0 : Math.round(2.2 * Math.sin(((i - 2) / 10) * Math.PI));
      for (let k = -w; k <= w; k++) s.put(2 + i + k, 13 - i + k * -1 + (k > 0 ? 1 : 0), k === 0 ? 0x8f8a7a : 0xe6e0cf, OL);
    }
  });
  sprite(cv, 'egg', (s) => (blob(s, 7.5, 8.5, 4.5, 5.5, 0xe9e0c8, 0xbdb294, 0xfffbee), s.put(6, 6, 0xa8997a, 0), s.put(9, 9, 0xa8997a, 0), s.put(7, 11, 0xa8997a, 0)));
  return cv.finish();
}

/** Register the atlas with the game (once, in `setup`). */
export function registerArt(game: GameContext) {
  painted ??= paint();
  game.items.atlas(CREATURE_ATLAS, { width: ATLAS, height: ATLAS, pixels: painted.albedo, emissive: painted.emissive });
}

const box = (name: string, size: [number, number, number], pivot: [number, number, number], offset: [number, number, number], mirror = false): ModelPart => ({ name, size, uv: [0, 0], pivot, offset, mirror });

/**
 * A species' stand-in figure, for as long as its real model hasn't been built: a box animal on
 * the box-humanoid rig (so it walks: the "arms" of a quadruped are its forelegs, of a flyer its
 * wings), in the species' hide, scaled to its height.
 */
export function standIn(id: SpeciesId): ModelSpec {
  const s = SPECIES[id];
  let parts: ModelPart[];
  let tall: number;
  if (s.locomotion === 'flyer') {
    tall = 13;
    parts = [
      box('legR', [1, 5, 1], [-1.5, 5, -1], [-0.5, -5, -0.5]),
      box('legL', [1, 5, 1], [1.5, 5, -1], [-0.5, -5, -0.5], true),
      box('body', [4, 4, 9], [0, 5, 0], [-2, 0, -5]),
      box('head', [3, 4, 10], [0, 9, 3], [-1.5, 0, -2]),
      box('armR', [14, 1, 7], [-2, 8, 0], [-14, -0.5, -4]),
      box('armL', [14, 1, 7], [2, 8, 0], [0, -0.5, -4], true),
    ];
  } else if (s.locomotion === 'quadruped') {
    tall = 16;
    parts = [
      box('legR', [4, 8, 4], [-3.5, 8, -6], [-2, -8, -2]),
      box('legL', [4, 8, 4], [3.5, 8, -6], [-2, -8, -2], true),
      box('armR', [4, 8, 4], [-3.5, 8, 6], [-2, -8, -2]),
      box('armL', [4, 8, 4], [3.5, 8, 6], [-2, -8, -2], true),
      box('body', [10, 8, 17], [0, 7, 0], [-5, 0, -9]),
      box('tail', [4, 4, 10], [0, 12, -9], [-2, -2, -10]),
      box('head', [6, 6, 8], [0, 9, 8], [-3, 0, 0]),
    ];
  } else {
    tall = 21;
    parts = [
      box('legR', [3, 10, 4], [-3, 10, 0], [-1.5, -10, -2]),
      box('legL', [3, 10, 4], [3, 10, 0], [-1.5, -10, -2], true),
      box('body', [7, 7, 14], [0, 9, 0], [-3.5, 0, -8]),
      box('tail', [4, 4, 12], [0, 13, -8], [-2, -2, -12]),
      box('head', [5, 5, 9], [0, 16, 5], [-2.5, 0, 0]),
      box('armR', [2, 4, 2], [-3.5, 12, 5], [-1, -4, -1]),
      box('armL', [2, 4, 2], [3.5, 12, 5], [-1, -4, -1], true),
    ];
  }
  const [u, v] = cellOf(id);
  for (const p of parts) p.uv = [u, v];
  return { rig: 'humanoid', parts, atlas: CREATURE_ATLAS, scale: (s.height * 16) / tall };
}
