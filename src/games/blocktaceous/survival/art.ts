import { ATLAS, Canvas, SpriteCanvas, type Ink } from '@platform/art';
import { glyphCell, ICON_COLUMNS, iconCell, iconItems, iconRows, UI_GLYPHS, type UiGlyph } from './icons';
import { pngDataUrl } from './png';

/**
 * Every item's sprite, painted in code: 16x16 pixel art from a few shapes and a few material
 * ramps (a pick is the same shape in stone and in metal). An item without a shape of its own gets
 * one from its name where that says enough (a wall, a slab, a saddle), else a tied pouch in a
 * colour of its own, so nothing another part adds to the vocabulary is ever a blank.
 *
 * Tools and weapons lie on the diagonal, handle at the bottom left, as the platform's held poses
 * expect; bows arc from the upper left.
 */

/** A material's shades: outline, dark, mid, light, highlight. */
interface Ramp {
  o: number;
  d: number;
  m: number;
  l: number;
  w: number;
}

const ramp = (o: number, d: number, m: number, l: number, w: number): Ramp => ({ o, d, m, l, w });

const WOOD = ramp(0x35220f, 0x77522d, 0x9a7140, 0xbb9257, 0xd8b67c);
const STRAW = ramp(0x4d3d0e, 0xa5862a, 0xcdab43, 0xe5cd68, 0xf7ea9f);
const LEAF = ramp(0x17330f, 0x2f6b22, 0x4a9433, 0x74bd4c, 0xa9e07a);
const STONE = ramp(0x2b2d30, 0x62666b, 0x8a8f95, 0xb3b8bd, 0xdadde0);
const FLINT = ramp(0x14161a, 0x33373f, 0x505662, 0x7a8291, 0xaab3c2);
const METAL = ramp(0x23282e, 0x5c6873, 0x8b99a6, 0xbac6d0, 0xeef3f7);
const RUST = ramp(0x4a2408, 0x9c5220, 0xc9773a, 0xe9a45c, 0xf7cf9a);
const OBSIDIAN = ramp(0x08060d, 0x1c1530, 0x33284f, 0x5a4a85, 0x9d8fd0);
const CRYSTAL = ramp(0x1c4a66, 0x3c8fb8, 0x74c4e6, 0xb5e6fa, 0xffffff);
const AMBER = ramp(0x5a2c05, 0xb5650f, 0xe0921d, 0xf7bd4a, 0xffe7a3);
const RAW = ramp(0x4a0f14, 0x9c2630, 0xcf4450, 0xea7078, 0xf7b0ae);
const COOKED = ramp(0x3a1c08, 0x7a4317, 0xa8642a, 0xcc8a45, 0xe8b676);
const PRIME = ramp(0x4a0f24, 0xa81f48, 0xd8386a, 0xf06f92, 0xffc0d0);
const BONE = ramp(0x5a5343, 0xbdb39a, 0xddd5c0, 0xf2ecdc, 0xffffff);
const FISH = ramp(0x1b3a4a, 0x3f7f96, 0x66a9bf, 0x9cd0de, 0xdaf2f7);
const HIDE = ramp(0x3a1f0e, 0x72421f, 0x93582b, 0xb3733c, 0xcf9258);
const HORN = ramp(0x3b3424, 0x7d7050, 0xa89a70, 0xcdc196, 0xeee6c4);
const PLUME = ramp(0x4a4a52, 0xa8a8b4, 0xd0d0da, 0xececf2, 0xffffff);
const CORD = ramp(0x3d3113, 0x8a7435, 0xb39a4e, 0xd3bd72, 0xeadb9c);
const CLOTH = ramp(0x4a4436, 0xa59a7c, 0xc9bf9f, 0xe3dcc2, 0xf7f3e2);
const BERRY = ramp(0x2a0f3d, 0x5e2a8a, 0x8644b8, 0xb074dc, 0xdcb4f5);
const WATER = ramp(0x12365e, 0x2a6fb0, 0x4b9be0, 0x86c4f5, 0xd6eeff);
const COAL = ramp(0x050505, 0x1a1a1c, 0x2e2e32, 0x4a4a50, 0x77777f);
const FLAME = ramp(0x7a1f05, 0xe2521a, 0xff8a2a, 0xffc24b, 0xfff0a0);
const GOLD = ramp(0x5a3a05, 0xc98a14, 0xf2b84b, 0xffd97a, 0xfff3c4);
const RED = ramp(0x4a0d0d, 0xa82a25, 0xd9483b, 0xf27a66, 0xffc0b0);

/**
 * Paint ASCII art: `w l m d` are the first material's highlight, light, mid and dark; `W L M D`
 * the second's; `1 2 3 4` the third's; `*` glows in the third's light. Everything gets a dark
 * outline of its own material.
 */
function draw(rows: readonly string[], a: Ramp, b: Ramp = a, c: Ramp = b): SpriteCanvas {
  const s = new SpriteCanvas();
  const inks: Ink[] = [
    ['w', a.w, a.o, 0],
    ['l', a.l, a.o, 0],
    ['m', a.m, a.o, 0],
    ['d', a.d, a.o, 0],
    ['W', b.w, b.o, 0],
    ['L', b.l, b.o, 0],
    ['M', b.m, b.o, 0],
    ['D', b.d, b.o, 0],
    ['1', c.w, c.o, 0],
    ['2', c.l, c.o, 0],
    ['3', c.m, c.o, 0],
    ['4', c.d, c.o, 0],
    ['*', c.l, c.o, 200],
  ];
  s.art(rows, inks);
  s.outline();
  return s;
}

// -----------------------------------------------------------------------------------------------
// Shapes
// -----------------------------------------------------------------------------------------------

const LOG = [
  '................',
  '................',
  '..........mmm...',
  '........mmlwlm..',
  '......mmlllMWLm.',
  '....mmlllllMLMm.',
  '..mmlllllmmMMDm.',
  '.mlllllmmmddDd..',
  '.mlllmmmddd.....',
  '.mmmmmddd.......',
  '..dddd..........',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const BUNDLE = [
  '................',
  '..l..w..l.w.....',
  '..lm.wl.lmw.l...',
  '..lm.wl.lmwlm...',
  '...lmwllmwlm....',
  '...lmwlmmwlm....',
  '....MLLLLLM.....',
  '....DMMMMMD.....',
  '...lmwlmmwlm....',
  '...lmwllmwlm....',
  '..lm.wl.lmwlm...',
  '..lm.wl.lm.lm...',
  '..l..w..l...m...',
  '................',
  '................',
  '................',
];

const TUFT = [
  '................',
  '................',
  '.......w........',
  '...w...wl...l...',
  '...wl..wl..lm...',
  '....wl.wl.lm....',
  '..l.wl.wllm..m..',
  '..lm.wlwlm..md..',
  '...lmwlwlmmmd...',
  '....lmwlmmdd....',
  '.....mlmdd......',
  '.....MLMD.......',
  '.....dmmd.......',
  '................',
  '................',
  '................',
];

const LUMP = [
  '................',
  '................',
  '................',
  '......wwll......',
  '....wwllllmm....',
  '...wlllllmmmm...',
  '..wllllWmmmmdd..',
  '..lllllmmMmmdd..',
  '..llmmmmmmmddd..',
  '..lmmmMmmmdddd..',
  '...mmmmmddDdd...',
  '....mdddddd.....',
  '................',
  '................',
  '................',
  '................',
];

const SHARD = [
  '................',
  '................',
  '..........ww....',
  '........wwlm....',
  '.......wllmm....',
  '......wllmmd....',
  '.....wllmmdd....',
  '....wllmmmd.....',
  '...wllmmmdd.....',
  '...llmmmdd......',
  '..llmmddd.......',
  '..mmddd.........',
  '..ddd...........',
  '................',
  '................',
  '................',
];

const BERRIES = [
  '................',
  '........LL......',
  '.......LMMD.....',
  '......LMD.......',
  '.....wlD........',
  '....wllm..wl....',
  '....llmm.wllm...',
  '....lmmd.llmm...',
  '.....md..lmmd...',
  '...wl.....md....',
  '..wllm..........',
  '..llmm..........',
  '..lmmd..........',
  '...md...........',
  '................',
  '................',
];

const SEEDS = [
  '................',
  '................',
  '................',
  '.....wl.........',
  '....wlmd...wl...',
  '....lmd...wlmd..',
  '.....d....lmd...',
  '...........d....',
  '..wl............',
  '.wlmd...wl......',
  '.lmd...wlmd.....',
  '..d....lmd......',
  '........d.......',
  '................',
  '................',
  '................',
];

const INGOT = [
  '................',
  '................',
  '................',
  '................',
  '.........wwll...',
  '.......wwllllll.',
  '.....wwlllllllm.',
  '...wwllllllmmdd.',
  '.wwllllllmmdd...',
  '.mmllllmmdd.....',
  '.mmmmmddd.......',
  '...mmdd.........',
  '................',
  '................',
  '................',
  '................',
];

const CRYSTALS = [
  '................',
  '.......w........',
  '......wlm.......',
  '......wlm.......',
  '.....wllmd......',
  '.....wllmd..w...',
  '..w..wllmd.wlm..',
  '.wlm.wllmd.wlm..',
  '.wlm.wllmdwllmd.',
  '.wllmwllmdwllmd.',
  '.wllmllmmdllmmd.',
  '..lmmmmmddmmdd..',
  '...ddddddddd....',
  '................',
  '................',
  '................',
];

const DROP = [
  '................',
  '................',
  '.......w........',
  '.......l........',
  '......wlm.......',
  '......llm.......',
  '.....wllmm......',
  '....wlllmmd.....',
  '....llllmmd.....',
  '...wlllmmmdd....',
  '...llllmmmdd....',
  '...lllmmmddd....',
  '....mmmmddd.....',
  '.....mdddd......',
  '................',
  '................',
];

const MEAT = [
  '................',
  '................',
  '.....wwlll......',
  '....wlllllmm....',
  '...wllllllmmm...',
  '...lllwllmmmmd..',
  '...lllllmmmmdd..',
  '...llllmmmmddd..',
  '....lmmmmmddd...',
  '....Lmmmdddd....',
  '...WLMdddd......',
  '..WLMD..........',
  '.WLLD...........',
  '.LMD............',
  '................',
  '................',
];

const FISH_SHAPE = [
  '................',
  '................',
  '................',
  '.......wwll.....',
  '.d...wwlllllm...',
  '.md.wlllllllWm..',
  '.mmdlllllllmmmd.',
  '.mmmllllmmmmmmd.',
  '.mmdmmmmmmmmmd..',
  '.md.mmmmmmddd...',
  '.d...ddddd......',
  '................',
  '................',
  '................',
  '................',
  '................',
];

const PELT = [
  '................',
  '..ll......ll....',
  '..lmm....lmm....',
  '...lmlllllmd....',
  '...wllllllmd....',
  '...wlllwllmd....',
  '..wllllllmmmd...',
  '..lllwlllmmmd...',
  '..llllllmmmdd...',
  '...llllmmmmd....',
  '...lmmmmmmdd....',
  '..lmd....mmd....',
  '..md......dd....',
  '................',
  '................',
  '................',
];

const CLAW = [
  '................',
  '................',
  '...........ww...',
  '.........wwlm...',
  '.......wwllmd...',
  '......wlllmd....',
  '.....wlllmmd....',
  '....wlllmmd.....',
  '....lllmmdd.....',
  '...lllmmdd......',
  '...llmmdd.......',
  '..lmmmdd........',
  '..mmddd.........',
  '..ddd...........',
  '................',
  '................',
];

const QUILL = [
  '................',
  '...........ww...',
  '.........wwwlm..',
  '........wwllmm..',
  '.......wwllmmd..',
  '......wwllmmd...',
  '.....wwllmmd....',
  '.....wllmmd.....',
  '....wllmmd......',
  '....llmdd.......',
  '...Dmdd.........',
  '..D.............',
  '.D..............',
  '................',
  '................',
  '................',
];

const EGG = [
  '................',
  '................',
  '.......wl.......',
  '......wwllm.....',
  '.....wwlllmm....',
  '.....wllllmm....',
  '....wlllllmmd...',
  '....llllDlmmd...',
  '....llllllmmd...',
  '....llDllmmmd...',
  '....lllllmmdd...',
  '.....lmmmmdd....',
  '......mmddd.....',
  '................',
  '................',
  '................',
];

const COIL = [
  '................',
  '................',
  '.....wwlll......',
  '...wwllmmmlm....',
  '..wlmm....mlm...',
  '..lm.wwll..mm...',
  '..lmwlmmml.mmd..',
  '..lmlm...m.lmd..',
  '..mmlm...m.lmd..',
  '..mmmlmmmd.mmd..',
  '...mmmdddd.md...',
  '...dmmm...mmd...',
  '....ddmmmmdd....',
  '......dddd..l...',
  '............ml..',
  '................',
];

const PICK = [
  '................',
  '......wwwww.....',
  '....wwllllllm...',
  '...wl.....llmm..',
  '...........llmd.',
  '..........12lmd.',
  '.........12..md.',
  '........12...md.',
  '.......12....md.',
  '......12......d.',
  '.....12.........',
  '....12..........',
  '...12...........',
  '..12............',
  '.12.............',
  '................',
];

const HATCHET = [
  '................',
  '..........ww....',
  '.........wllm...',
  '........wlllmd..',
  '.......wllllmd..',
  '.......wlllmmd..',
  '........llmmmd..',
  '........12mdd...',
  '.......12.d.....',
  '......12........',
  '.....12.........',
  '....12..........',
  '...12...........',
  '..12............',
  '.12.............',
  '................',
];

const SICKLE = [
  '................',
  '.....wwwww......',
  '...wwllllllm....',
  '..wl......lmm...',
  '..l........lmd..',
  '............md..',
  '............md..',
  '...........lmd..',
  '..........lmd...',
  '.........12.....',
  '........12......',
  '.......12.......',
  '......12........',
  '.....12.........',
  '....12..........',
  '................',
];

const CLUB = [
  '................',
  '..........www...',
  '.........wlllm..',
  '........wllWlmd.',
  '........lllmmmd.',
  '.......lWlmmmd..',
  '......lllmmWd...',
  '.....wlmmmdd....',
  '....wlmmdd......',
  '...wlmdd........',
  '..12md..........',
  '.1234...........',
  '.234............',
  '..4.............',
  '................',
  '................',
];

const SPEAR = [
  '................',
  '............www.',
  '...........wllm.',
  '..........wllmd.',
  '..........llmd..',
  '.........DMd....',
  '........12......',
  '.......12.......',
  '......12........',
  '.....12.........',
  '....12..........',
  '...12...........',
  '..12............',
  '.12.............',
  '12..............',
  '................',
];

const BOW = [
  '................',
  '......mllllllD..',
  '....mlww....D...',
  '...mlw.....D....',
  '..mlw.....D.....',
  '..lw.....D......',
  '.ml.....D.......',
  '.lw....D........',
  '.l....D.........',
  '.l...D..........',
  '.l..D...........',
  '.l.D............',
  '.lD.............',
  '.D..............',
  '................',
  '................',
];

const BOW_DRAWN = [
  '................',
  '......mllllllD..',
  '....mlww.....D..',
  '...mlw.......D..',
  '..mlw..w.....D..',
  '..lw....1...D...',
  '.ml......1..D...',
  '.lw.......1D....',
  '.l.........D....',
  '.l........D.2...',
  '.l......DD......',
  '.l....DD........',
  '.l.DDD..........',
  '.DD.............',
  '................',
  '................',
];

const SLING = [
  '................',
  '..ww......ww....',
  '..wlm....wlm....',
  '..llmDDDDllm....',
  '...lmdMMdlm.....',
  '...llmDDllm.....',
  '....lmm.lmm.....',
  '....llmllmd.....',
  '.....lllmd......',
  '.....llmmd......',
  '.....llmd.......',
  '.....llmd.......',
  '.....lmmd.......',
  '.....lmdd.......',
  '......dd........',
  '................',
];

const ARROW = [
  '................',
  '...........www..',
  '..........wllm..',
  '..........llmd..',
  '.........1mdd...',
  '........12......',
  '.......12.......',
  '......12........',
  '.....12.........',
  '..W.12..........',
  '..LW2...........',
  '.WLLM...........',
  '..MMLW..........',
  '...M............',
  '................',
  '................',
];

const SKIN = [
  '................',
  '.......DD.......',
  '......1MD1......',
  '......wlm.......',
  '.....wllmm......',
  '....wlllmmm.....',
  '...wlllllmmm....',
  '...lllWlllmmd...',
  '..wlllWWllmmd...',
  '..llllLLlmmmd...',
  '..lllllllmmmd...',
  '..llllmmmmmdd...',
  '...lmmmmmmdd....',
  '....mmmdddd.....',
  '................',
  '................',
];

const BOWL = [
  '................',
  '................',
  '................',
  '................',
  '....WWLLLLMM....',
  '..WWLLLWLLMMMM..',
  '.wLLLLLLMMMMMMd.',
  '.wlLLMMMMMMMmdd.',
  '.wlllmmmmmmmmdd.',
  '..lllmmmmmmmdd..',
  '..llmmmmmmmddd..',
  '...lmmmmmmddd...',
  '....mmmmdddd....',
  '.....dddddd.....',
  '................',
  '................',
];

const STRIP = [
  '................',
  '................',
  '...........wl...',
  '.........wwllm..',
  '.......wwllmmd..',
  '......wllDmmd...',
  '.....wllmmmd....',
  '....wllmmDd.....',
  '...wllDmmd......',
  '..wllmmmd.......',
  '..llmmDd........',
  '..lmmdd.........',
  '...ddd..........',
  '................',
  '................',
  '................',
];

const ROLL = [
  '................',
  '................',
  '................',
  '................',
  '....wwwwwlll....',
  '...wllllllllm...',
  '..wlllWWlllmmm..',
  '..lllWWWWllmmd..',
  '..llllWWlllmmd..',
  '..lllllllmmmmd..',
  '...lmmmmmmmdd...',
  '....mmmmmddd....',
  '................',
  '................',
  '................',
  '................',
];

const HOOD = [
  '................',
  '................',
  '.....wwwlll.....',
  '....wlllllmm....',
  '...wllllllmmm...',
  '..wlllllllmmmd..',
  '..llllllllmmmd..',
  '..lllmmmmmmmmd..',
  '..llmDDDDDDmmd..',
  '..llmD....Dmmd..',
  '..lmmD....Dmdd..',
  '..lmmd....dmdd..',
  '..mmd......ddd..',
  '................',
  '................',
  '................',
];

const HELM = [
  '................',
  '................',
  '.....wwwlll.....',
  '....wwllllmm....',
  '...wwlllllmmm...',
  '...wllllllmmd...',
  '..wllllllmmmd...',
  '..llllWWWWmmd...',
  '..lllmDDDDmmd...',
  '..llmmD..Dmdd...',
  '..lmmd.ll.mdd...',
  '..lmd..lm..dd...',
  '..md...md...d...',
  '................',
  '................',
  '................',
];

const TUNIC = [
  '................',
  '................',
  '...wll....llm...',
  '..wllllDDlllmm..',
  '.wllllllllllmmd.',
  '.lllllllllmmmmd.',
  '.lld.lllmmm.dmd.',
  '.dd..lllmmm..dd.',
  '.....llWmmm.....',
  '.....lllmmd.....',
  '.....llWmmd.....',
  '.....llmmmd.....',
  '.....lmmmdd.....',
  '.....mmdddd.....',
  '................',
  '................',
];

const BOOTS = [
  '................',
  '................',
  '..wll...wll.....',
  '..llm...llm.....',
  '..llm...llm.....',
  '..llm...llm.....',
  '..lmm...lmm.....',
  '..lmmW..lmmW....',
  '..lmmmm.lmmmm...',
  '..lmmmmmlmmmmm..',
  '..mmmmmdmmmmmd..',
  '..DDDDDDDDDDDD..',
  '................',
  '................',
  '................',
  '................',
];

const PACK = [
  '................',
  '......1221......',
  '.....1....1.....',
  '....wwllllmm....',
  '...wllllllmmm...',
  '..wlllllllmmmd..',
  '..lDDDDDDDDDDd..',
  '..llllWWllmmmd..',
  '..llllWLllmmmd..',
  '..lllllllmmmmd..',
  '..llmDDDDDDmmd..',
  '..lmmDmmmmDmdd..',
  '..mmmDDDDDDddd..',
  '...dddddddddd...',
  '................',
  '................',
];

const CAMPFIRE = [
  '................',
  '................',
  '.......*........',
  '......**1.......',
  '......*11*......',
  '.....*1WW1*.....',
  '.....*1WW1*.....',
  '....**1WW1**....',
  '....*211112*....',
  '..ll.*2222*.mm..',
  '..wllm****mmmd..',
  '...wllmmmmmdd...',
  '..wwlllmmmmddd..',
  '.wllmm....mmmdd.',
  '.lmd........mdd.',
  '................',
];

const TORCH = [
  '................',
  '.......*........',
  '......*1*.......',
  '......1W1.......',
  '.....*1W1*......',
  '.....*211*......',
  '......D22D......',
  '......DMMD......',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '.......lm.......',
  '.......md.......',
  '.......dd.......',
  '................',
];

const MORTAR = [
  '................',
  '...........WL...',
  '..........WLM...',
  '.........WLM....',
  '........WLM.....',
  '..wwlllWLMmmm...',
  '.wlllllLMmmmmd..',
  '.wlllddddddmmd..',
  '.lllmmmmmmmmmd..',
  '.llmmmmmmmmmdd..',
  '..lmmmmmmmmdd...',
  '..lmmmmmmmddd...',
  '...mmmmmmddd....',
  '....dddddd......',
  '................',
  '................',
];

const BENCH = [
  '................',
  '................',
  '.....1..........',
  '....123...WL....',
  '...1.2...WLM....',
  '.....2....M.....',
  '.wwwwllllllllmm.',
  '.wllllllllllmmd.',
  '.lmmmmmmmmmmmdd.',
  '..lm.......lmd..',
  '..lm.......lmd..',
  '..lmmmmmmmmmmd..',
  '..lm.......lmd..',
  '..md.......mdd..',
  '................',
  '................',
];

const FORGE = [
  '................',
  '......wll.......',
  '......lmd.......',
  '......lmd.......',
  '...wwwlmmmmm....',
  '..wlllllmmmmmd..',
  '..llllmmmmmmmd..',
  '..llD******Dmd..',
  '..lmD*1WW1*Dmd..',
  '..lmD*1111*Dmd..',
  '..lmD******Dmd..',
  '..lmmDDDDDDmdd..',
  '..mmmmmmmmdddd..',
  '..dddddddddddd..',
  '................',
  '................',
];

const ANVIL = [
  '................',
  '................',
  '................',
  '.wwwwwwlllllll..',
  '.wllllllllmmmmd.',
  '..llllllmmmmdd..',
  '....llmmmmdd....',
  '.....lmmmd......',
  '.....lmmmd......',
  '....llmmmdd.....',
  '...lllmmmmdd....',
  '..wllmmmmmmdd...',
  '..lmmmmmddddd...',
  '................',
  '................',
  '................',
];

const CHEST = [
  '................',
  '................',
  '...wwwwllllll...',
  '..wllllllllmmm..',
  '..llllllllmmmd..',
  '..DDDDDWWDDDDD..',
  '..lllllWLmmmmd..',
  '..lllllLMmmmmd..',
  '..llllllmmmmmd..',
  '..lllllmmmmmdd..',
  '..llllmmmmmddd..',
  '..DDDDDDDDDDDD..',
  '..mmmmmmdddddd..',
  '................',
  '................',
  '................',
];

const BEDROLL = [
  '................',
  '................',
  '................',
  '................',
  '..WWLL..........',
  '.WLLLMwwwwlllll.',
  '.WLLMMllllllmmm.',
  '.LLMMDlllllmmmd.',
  '.LMMDDlDllDmmdd.',
  '.MMDDDllllmmmdd.',
  '..DDDmmmmmmddd..',
  '....dddddddd....',
  '................',
  '................',
  '................',
  '................',
];

const SADDLE = [
  '................',
  '................',
  '................',
  '...ww......ll...',
  '..wllm....lmmd..',
  '..lllmmmmmmmmd..',
  '.WlllllmmmmmddM.',
  '.WLllllmmmmddMD.',
  '.WLMlmmmmdddMDD.',
  '..LM.dddddd.MD..',
  '..lm........md..',
  '..lm........md..',
  '.121.......121..',
  '.1.1.......1.1..',
  '.121.......121..',
  '................',
];

const BOLA = [
  '................',
  '................',
  '...wl......wl...',
  '..wllm....wllm..',
  '..llmd....llmd..',
  '...md1....1md...',
  '......1..1......',
  '.......12.......',
  '.......21.......',
  '.......1........',
  '.......1........',
  '......wl........',
  '.....wllm.......',
  '.....llmd.......',
  '......md........',
  '................',
];

const PIPE = [
  '................',
  '.............wl.',
  '............wlm.',
  '...........wlm..',
  '..........wlm...',
  '.........DMm....',
  '........wlm.....',
  '.......wlm......',
  '......wlm.......',
  '.....wlm........',
  '....DMm.........',
  '...wlm..........',
  '..wlm...........',
  '.wlm............',
  '.lm.............',
  '................',
];

const DART = [
  '................',
  '................',
  '................',
  '...........ww...',
  '..........wlm...',
  '.........1ld....',
  '........12......',
  '.......12.......',
  '......12........',
  '...W.12.........',
  '...LW2..........',
  '..WLLM..........',
  '...MML..........',
  '....M...........',
  '................',
  '................',
];

const POUCH = [
  '................',
  '................',
  '......D..D......',
  '.....DlDDmD.....',
  '......lmmm......',
  '.....WLLLLM.....',
  '....wllllmmm....',
  '...wllllllmmm...',
  '...lllllllmmd...',
  '..wllllllmmmd...',
  '..lllllllmmmd...',
  '..llllllmmmdd...',
  '...lllmmmmdd....',
  '....mmmmddd.....',
  '................',
  '................',
];

// ---- The HUD's glyphs ----

const G_FOOD = [
  '................',
  '................',
  '.......wwll.....',
  '......wllllm....',
  '.....wlllllmm...',
  '.....lllllmmd...',
  '.....llllmmmd...',
  '......lmmmmd....',
  '.....Lmmmdd.....',
  '....WLM.........',
  '..WWLM..........',
  '..WLLD..........',
  '...MD...........',
  '................',
  '................',
  '................',
];

const G_BREATH = [
  '................',
  '.........www....',
  '........wlm.....',
  '.......wlm......',
  '......wlm.......',
  '.....wllm.......',
  '....wlllllm.....',
  '....mmmllmd.....',
  '.......lmd......',
  '......lmd.......',
  '.....lmd........',
  '....lmd.........',
  '....md..........',
  '................',
  '................',
  '................',
];

const G_COLD = [
  '................',
  '.......l........',
  '.....l.w.l......',
  '......lwl.......',
  '..l....w....l...',
  '...l...w...l....',
  '.llwwwwwwwwwll..',
  '...l...w...l....',
  '..l....w....l...',
  '......lwl.......',
  '.....l.w.l......',
  '.......l........',
  '................',
  '................',
  '................',
  '................',
];

const G_HEAT = [
  '................',
  '.......l........',
  '..l....l....l...',
  '...l.......l....',
  '.....wwwll......',
  '....wwwlllm.....',
  '.ll.wwllllm.ll..',
  '....wllllmm.....',
  '....lllllmm.....',
  '.....lmmmm......',
  '...l.......l....',
  '..l....l....l...',
  '.......l........',
  '................',
  '................',
  '................',
];

const G_LOAD = [
  '................',
  '................',
  '......wll.......',
  '.....wl.lm......',
  '.....l...m......',
  '....wwllllm.....',
  '...wllllllmm....',
  '...lllllllmm....',
  '..wlllDDllmmd...',
  '..lllDllDlmmd...',
  '..lllDDDDmmmd...',
  '..llmmmmmmmdd...',
  '..mmmmmmmdddd...',
  '................',
  '................',
  '................',
];

const G_SPARK = [
  '................',
  '.......w........',
  '.......w........',
  '.......l........',
  '......wlm.......',
  '.....wwlmm......',
  '.wwlllwlmmmmdd..',
  '.....llmmm......',
  '......lmd.......',
  '.......m........',
  '.......m........',
  '.......d........',
  '................',
  '................',
  '................',
  '................',
];

const G_UNKNOWN = [
  '................',
  '................',
  '.....wwlll......',
  '....wl...lm.....',
  '....l.....m.....',
  '..........m.....',
  '.........lm.....',
  '........lm......',
  '.......lm.......',
  '.......lm.......',
  '................',
  '.......lm.......',
  '.......md.......',
  '................',
  '................',
  '................',
];

const G_STAR = [
  '................',
  '.......w........',
  '.......w........',
  '......wlm.......',
  '......wlm.......',
  '.wwwwwllmmmmmd..',
  '..wlllllmmmmd...',
  '...wllllmmmd....',
  '....lllmmmd.....',
  '....llmmmmd.....',
  '...wlmm.mmmd....',
  '...lmd...mdd....',
  '..lm.......dd...',
  '................',
  '................',
  '................',
];

// -----------------------------------------------------------------------------------------------
// Building pieces, from their names
// -----------------------------------------------------------------------------------------------

const SURFACES: Record<string, Ramp> = { thatch: STRAW, wood: WOOD, stone: STONE, metal: METAL };

/** A texel of a building piece's face: its material's grain. */
function grain(material: string, r: Ramp, x: number, y: number): number {
  if (material === 'thatch') return (x + y * 2) % 4 === 0 ? r.d : (x * 3 + y) % 5 === 0 ? r.w : r.m;
  if (material === 'wood') return y % 4 === 3 ? r.d : (x + Math.floor(y / 4) * 5) % 7 === 0 ? r.d : y % 4 === 0 ? r.l : r.m;
  if (material === 'stone') return y % 4 === 3 || (x + (Math.floor(y / 4) % 2) * 3) % 6 === 5 ? r.d : y % 4 === 0 ? r.l : r.m;
  return (x % 6 === 1 && y % 6 === 1) || (x % 6 === 4 && y % 6 === 4) ? r.w : y % 6 === 5 ? r.d : r.m;
}

/** A building piece: its material's face, cut to the piece's outline. */
function piece(material: string, shape: string): SpriteCanvas {
  const r = SURFACES[material] ?? WOOD;
  const s = new SpriteCanvas();
  const inside = (x: number, y: number): boolean => {
    if (x < 2 || x > 13 || y < 2 || y > 13) return false;
    switch (shape) {
      case 'floor':
        // A slab seen from above and in front: a wide, shallow tile.
        return y >= 6 && y <= 11 && x - 2 >= 11 - y - 3 && 13 - x >= y - 9;
      case 'slab':
        return y >= 8;
      case 'ramp':
        return x - 2 >= 13 - y;
      case 'door':
        return x >= 4 && x <= 11;
      case 'gate':
        return y >= 4 && (y <= 5 || y >= 12 || x <= 3 || x >= 12 || x % 3 === 1);
      case 'window':
        return x <= 3 || x >= 12 || y <= 3 || y >= 12 || (x + y) % 4 === 0 || (x - y + 16) % 4 === 0;
      case 'fence':
        return y >= 4 && (x === 3 || x === 4 || x === 11 || x === 12 || y === 6 || y === 7 || y === 10 || y === 11);
      case 'ladder':
        return x === 4 || x === 5 || x === 10 || x === 11 || ((y === 4 || y === 7 || y === 10 || y === 13) && x >= 4 && x <= 11);
      default:
        return true;
    }
  };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (!inside(x, y)) continue;
      // Lit from the top left: the first row and column catch the light.
      const edge = !inside(x - 1, y) || !inside(x, y - 1);
      s.put(x, y, edge ? r.l : grain(material, r, x, y), r.o);
    }
  }
  if (shape === 'door') {
    s.put(10, 8, GOLD.l, r.o);
    s.put(10, 9, GOLD.d, r.o);
  }
  s.outline();
  return s;
}

const PIECE_SHAPES = ['wall', 'floor', 'slab', 'ramp', 'door', 'gate', 'window', 'fence', 'ladder'];

// -----------------------------------------------------------------------------------------------
// Which sprite an item gets
// -----------------------------------------------------------------------------------------------

const SPRITES: Record<string, () => SpriteCanvas> = {
  wood: () => draw(LOG, WOOD, ramp(WOOD.o, 0x9a7140, 0xc7a468, 0xe0c38c, 0xf0dcae)),
  thatch: () => draw(BUNDLE, STRAW, CORD),
  fiber: () => draw(TUFT, LEAF, CORD),
  stone: () => draw(LUMP, STONE),
  flint: () => draw(SHARD, FLINT),
  berries: () => draw(BERRIES, BERRY, LEAF),
  seeds: () => draw(SEEDS, HORN),
  metal_ore: () => draw(LUMP, STONE, RUST),
  metal_ingot: () => draw(INGOT, METAL),
  crystal: () => draw(CRYSTALS, CRYSTAL),
  obsidian: () => draw(SHARD, OBSIDIAN),
  sap: () => draw(DROP, AMBER),
  raw_meat: () => draw(MEAT, RAW, BONE),
  cooked_meat: () => draw(MEAT, COOKED, BONE),
  prime_meat: () => draw(MEAT, PRIME, BONE),
  raw_fish: () => draw(FISH_SHAPE, FISH, COAL),
  cooked_fish: () => draw(FISH_SHAPE, COOKED, COAL),
  hide: () => draw(PELT, HIDE),
  keratin: () => draw(CLAW, HORN),
  feather: () => draw(QUILL, PLUME, HORN),
  egg: () => draw(EGG, BONE, HORN),
  cordage: () => draw(COIL, CORD),
  charcoal: () => draw(LUMP, COAL, ramp(COAL.o, FLAME.d, FLAME.d, FLAME.m, FLAME.l)),
  stone_pick: () => draw(PICK, STONE, STONE, WOOD),
  metal_pick: () => draw(PICK, METAL, METAL, WOOD),
  stone_hatchet: () => draw(HATCHET, FLINT, FLINT, WOOD),
  metal_hatchet: () => draw(HATCHET, METAL, METAL, WOOD),
  stone_sickle: () => draw(SICKLE, FLINT, FLINT, WOOD),
  metal_sickle: () => draw(SICKLE, METAL, METAL, WOOD),
  club: () => draw(CLUB, WOOD, STONE, CORD),
  spear: () => draw(SPEAR, FLINT, CORD, WOOD),
  metal_spear: () => draw(SPEAR, METAL, HIDE, WOOD),
  bow: () => draw(BOW, WOOD, CLOTH),
  longbow: () => draw(BOW, ramp(0x1f1408, 0x4f3418, 0x6e4b25, 0x8d6535, 0xb38a55), METAL),
  slingshot: () => draw(SLING, WOOD, HIDE),
  stone_arrow: () => draw(ARROW, FLINT, PLUME, WOOD),
  metal_arrow: () => draw(ARROW, METAL, RED, WOOD),
  waterskin: () => draw(SKIN, HIDE, ramp(HIDE.o, HIDE.d, HIDE.d, HIDE.m, HIDE.m), CORD),
  waterskin_full: () => draw(SKIN, HIDE, WATER, CORD),
  berry_mash: () => draw(BOWL, WOOD, BERRY),
  stew: () => draw(BOWL, WOOD, ramp(COOKED.o, COOKED.d, COOKED.m, AMBER.m, AMBER.l)),
  jerky: () => draw(STRIP, ramp(0x2a0d08, 0x5e2216, 0x853523, 0xa84c33, 0xc97355), COAL),
  bandage: () => draw(ROLL, CLOTH, RED),
  cloth_hood: () => draw(HOOD, CLOTH, COAL),
  cloth_tunic: () => draw(TUNIC, CLOTH, CORD),
  cloth_wraps: () => draw(BOOTS, CLOTH, CORD),
  hide_cap: () => draw(HOOD, HIDE, COAL),
  hide_vest: () => draw(TUNIC, HIDE, HORN),
  hide_boots: () => draw(BOOTS, HIDE, COAL),
  metal_helm: () => draw(HELM, METAL, COAL),
  metal_plate: () => draw(TUNIC, METAL, GOLD),
  metal_greaves: () => draw(BOOTS, METAL, COAL),
  lost_pack: () => draw(PACK, HIDE, GOLD, CORD),
  wooden_club: () => draw(CLUB, WOOD, WOOD, HIDE),
  bola: () => draw(BOLA, STONE, STONE, CORD),
  blowpipe: () => draw(PIPE, LEAF, CORD),
  sleep_dart: () => draw(DART, BERRY, RED, WOOD),
  bt_campfire: () => draw(CAMPFIRE, WOOD, FLAME, FLAME),
  bt_torch: () => draw(TORCH, WOOD, CORD, FLAME),
  bt_mortar: () => draw(MORTAR, STONE, WOOD),
  bt_workbench: () => draw(BENCH, WOOD, STONE, METAL),
  bt_forge: () => draw(FORGE, STONE, COAL, FLAME),
  bt_smithy: () => draw(ANVIL, METAL),
  bt_storage: () => draw(CHEST, WOOD, METAL),
  bt_bed: () => draw(BEDROLL, HIDE, CLOTH),
};

const GLYPHS: Record<UiGlyph, () => SpriteCanvas> = {
  food: () => draw(G_FOOD, AMBER, BONE),
  water: () => draw(DROP, WATER),
  breath: () => draw(G_BREATH, ramp(0x3a4208, 0xa9b83a, 0xd9e86a, 0xeef59a, 0xffffff)),
  cold: () => draw(G_COLD, CRYSTAL),
  heat: () => draw(G_HEAT, FLAME),
  load: () => draw(G_LOAD, STONE),
  spark: () => draw(G_SPARK, GOLD),
  head: () => draw(HOOD, STONE, COAL),
  body: () => draw(TUNIC, STONE, STONE),
  feet: () => draw(BOOTS, STONE, COAL),
  unknown: () => draw(G_UNKNOWN, STONE),
  star: () => draw(G_STAR, GOLD),
};

/** A colour of an item's own, from its name: what tells two pouches apart. */
function tint(id: string): Ramp {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const hue = ((h >>> 0) % 360) / 360;
  const shade = (l: number) => {
    // A soft hue wheel: enough to tell apart, never garish.
    const f = (n: number) => {
      const k = (n + hue * 12) % 12;
      return Math.round(255 * (l - 0.32 * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return (f(0) << 16) | (f(8) << 8) | f(4);
  };
  return ramp(shade(0.14), shade(0.34), shade(0.48), shade(0.62), shade(0.8));
}

/** The sprite for an item: its own, one read from its name, or a pouch of its own colour. */
function spriteFor(id: string): SpriteCanvas {
  const own = SPRITES[id];
  if (own) return own();
  const words = id.replace(/^bt_/, '').split('_');
  const shape = PIECE_SHAPES.find((p) => words.includes(p));
  if (shape) return piece(words.find((w) => w in SURFACES) ?? 'wood', shape);
  if (words.includes('saddle')) return draw(SADDLE, HIDE, tint(id), METAL);
  return draw(POUCH, tint(id), CORD);
}

// -----------------------------------------------------------------------------------------------
// The atlas
// -----------------------------------------------------------------------------------------------

export interface IconArt {
  width: number;
  height: number;
  /** The whole atlas, as the platform takes it (`game.items.atlas`). */
  pixels: Uint8Array;
  emissive: Uint8Array;
  /** The rows in use as a PNG `data:` URL (the journal's CSS cuts its icons from it), and the first row alone (the HUD's glyphs). */
  /** One `data:` picture per row of the sheet: a widget's CSS takes no value over 4000 characters, so the whole sheet can't be one. */
  rowUrls: string[];
  glyphsUrl: string;
}

/** Paint every item's sprite and the HUD's glyphs into the game's item atlas. */
export function paintIcons(): IconArt {
  const cv = new Canvas();
  for (const g of UI_GLYPHS) GLYPHS[g]().blit(cv, glyphCell(g).x * 16, 0);
  for (const id of iconItems()) {
    const cell = iconCell(id);
    spriteFor(id).blit(cv, cell.x * 16, cell.y * 16);
  }
  // The drawn bow has the last cell of the glyph row.
  draw(BOW_DRAWN, WOOD, CLOTH, FLINT).blit(cv, DRAWN_BOW.x, DRAWN_BOW.y);
  const { albedo, emissive } = cv.finish();
  const rows = iconRows();
  const width = ICON_COLUMNS * 16;
  // The data: pictures show only what's painted: the atlas keeps colour in its transparent
  // texels (for filtering), which a PNG would only spend bytes on.
  const sheet = albedo.slice(0, width * rows * 16 * 4);
  for (let i = 0; i < sheet.length; i += 4) if (sheet[i + 3] === 0) sheet[i] = sheet[i + 1] = sheet[i + 2] = 0;
  return {
    width: ATLAS,
    height: ATLAS,
    pixels: albedo,
    emissive,
    rowUrls: Array.from({ length: rows }, (_, r) => pngDataUrl(width, 16, sheet.subarray(r * width * 16 * 4, (r + 1) * width * 16 * 4))),
    glyphsUrl: pngDataUrl(width, 16, sheet.subarray(0, width * 16 * 4)),
  };
}

/** Where the bow's drawn sprite is in the atlas. */
export const DRAWN_BOW = { x: 15 * 16, y: 0 };
