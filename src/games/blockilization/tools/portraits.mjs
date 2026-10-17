/**
 * Pictures-only shapes: each leader's bust (head and shoulders, in what they're known for) and the
 * wonders, a few kinds of great building (each wonder is drawn as its kind: `client/art.ts`). Drawn
 * by `pictures.mjs` with the units; never models in the world.
 */
import { Model, person } from './shapes.mjs';

// ---------------------------------------------------------------------------------------------
// The leaders

/**
 * How a leader looks at you: as they usually do, glad (a smile), wary (one brow up, the mouth
 * drawn to one side) or cross (brows down at the middle, a frown). Each bust is drawn as a picture
 * in three (`l_egypt`, `l_egypt_glad`, `l_egypt_cross`), and for diplomacy's scene as a strip of
 * frames: each mood with its eyes open and shut (a blink), a fist raised in anger (war, a
 * denouncement), and talking (`SHEET`, `l_egypt_sheet`).
 */
const MOODS = ['plain', 'glad', 'cross'];
export const SHEET = [
  { mood: 'plain' },
  { mood: 'plain', blink: true },
  { mood: 'glad' },
  { mood: 'glad', blink: true },
  { mood: 'wary' },
  { mood: 'wary', blink: true },
  { mood: 'cross' },
  { mood: 'cross', blink: true },
  { mood: 'cross', fist: true },
  { mood: 'plain', talk: true },
];

/** A bust: shoulders in `robe`, a 10-voxel head (`skin`), eyes, brows and mouth on its face (+z), `hair` (or none: bald), a `beard`, and `extra(m)` for headwear and the rest. */
const bust = (id, o) => ({ id, o });

/** The brows' voxels (x, y), left then right, in a mood: wary, one up; cross, their inner ends down. */
const BROWS = {
  plain: [[-3, 14], [-2, 14], [1, 14], [2, 14]],
  glad: [[-3, 14], [-2, 14], [1, 14], [2, 14]],
  wary: [[-3, 15], [-2, 15], [1, 14], [2, 14]],
  cross: [[-3, 15], [-2, 14], [1, 14], [2, 15]],
};
/** The mouth's voxels (x, y) in a mood: a line, a smile (its ends up), drawn to one side, a frown (its ends down); under any moustache. */
const MOUTHS = {
  plain: [[-2, 10], [-1, 10], [0, 10], [1, 10]],
  glad: [[-2, 10], [-1, 9], [0, 9], [1, 10]],
  wary: [[-1, 10], [0, 10], [1, 10], [2, 11]],
  cross: [[-2, 9], [-1, 10], [0, 10], [1, 9]],
};
/** Talking: the mouth open. */
const OPEN = [[-2, 10], [-1, 10], [0, 10], [1, 10], [-1, 9], [0, 9]];

/** One bust in a mood (and blinking, talking, or with a fist raised). */
function face(id, o, { mood, blink = false, talk = false, fist = false }) {
  const m = new Model(id);
  const skin = o.skin ?? 'skin';
  m.box([-9, 0, -4], [9, 7, 4], o.robe);
  m.box([-7, 7, -3], [7, 8, 3], o.robe);
  m.box([-2, 7, -2], [2, 9, 2], skin);
  m.box([-5, 9, -5], [5, 19, 5], skin);
  // Ears, nose, eyes, brows, mouth.
  m.box([-6, 12, -1], [-5, 14, 1], skin).box([5, 12, -1], [6, 14, 1], skin);
  m.box([-1, 12, 5], [1, 14, 6], o.nose ?? 'skin2');
  // (Shut: the eyes the skin's shade, as the nose is.)
  if (blink) for (const x of [-3, -2, 1, 2]) m.set(x, 13, 4, o.nose ?? 'skin2');
  else m.set(-3, 13, 4, 'white').set(-2, 13, 4, 'black').set(1, 13, 4, 'black').set(2, 13, 4, 'white');
  const brow = o.brow ?? o.hair ?? 'hair';
  for (const [x, y] of BROWS[mood]) m.set(x, y, 4, brow);
  const mouth = talk ? OPEN : MOUTHS[mood];
  for (const [x, y] of mouth) m.set(x, y, 4, y === 9 && talk ? 'black' : 'redDark');
  if (o.hair) {
    m.box([-5, 18, -5], [5, 20, 5], o.hair);
    m.box([-5, 10, -6], [5, 19, -5], o.hair);
    m.box([-6, 14, -5], [-5, 19, 3], o.hair).box([5, 14, -5], [6, 19, 3], o.hair);
  }
  if (o.beard) {
    m.box([-4, 7, 3], [4, 11, 6], o.beard);
    m.box([-3, 11, 5], [3, 12, 6], o.beard);
    // (A mouth shows in the beard only when it smiles, frowns or talks.)
    if (mood !== 'plain' || talk) for (const [x, y] of mouth) m.set(x, y, 5, y === 9 && talk ? 'black' : 'redDark');
  }
  o.extra?.(m);
  // A fist raised: the right arm up beside the head, in the robe's sleeve.
  if (fist) m.box([9, 4, -1], [12, 15, 2], o.robe).box([9, 15, -1], [12, 18, 2], o.skin ?? 'skin').box([8, 17, 0], [9, 18, 2], o.skin ?? 'skin');
  return m;
}

const stripes = (y) => (y % 2 ? 'gold' : 'nemes');

const BUSTS = [
  bust('l_egypt', {
    robe: 'white',
    skin: 'skin2',
    nose: 'skin4',
    extra: (m) => {
      // The nemes: striped cloth over the head, falling to the shoulders; a gold collar; the cobra.
      for (let y = 15; y < 21; y++) m.box([-6, y, -6], [6, y + 1, 4], stripes(y));
      for (let y = 6; y < 15; y++) m.box([-7, y, -2], [-5, y + 1, 3], stripes(y)).box([5, y, -2], [7, y + 1, 3], stripes(y));
      m.box([-6, 10, -6], [6, 15, -5], 'nemes');
      m.box([-9, 5, -4], [9, 7, 5], 'gold').box([-7, 4, 4], [7, 5, 5], 'nemes');
      m.box([-1, 19, 4], [1, 23, 6], 'gold');
      m.box([-1, 7, 4], [1, 10, 6], 'nemes');
    },
  }),
  bust('l_babylon', {
    robe: 'crimson',
    skin: 'skin2',
    beard: 'black',
    hair: 'black',
    extra: (m) => {
      // A tall crown, and a long curled beard.
      m.box([-5, 19, -5], [5, 26, 5], 'gold');
      m.box([-5, 21, -5], [5, 22, 5], 'nemes').box([-5, 24, -5], [5, 25, 5], 'nemes');
      for (let y = 3; y < 10; y++) m.box([-4, y, 4], [4, y + 1, 6], y % 2 ? 'black' : 'hair');
      m.box([-9, 6, -4], [9, 7, 4], 'gold');
    },
  }),
  bust('l_china', {
    robe: 'red',
    skin: 'skin3',
    hair: 'black',
    extra: (m) => {
      // Hair up in a crown of buns, gold pins through it; gold trim on the robe.
      m.box([-4, 20, -4], [4, 24, 3], 'black');
      m.box([-6, 22, -1], [6, 23, 0], 'gold').box([-2, 24, -2], [2, 26, 2], 'black');
      m.box([-1, 20, 3], [1, 22, 4], 'gold');
      m.box([-3, 0, 4], [3, 7, 5], 'gold').box([-2, 0, 4], [2, 6, 5], 'red');
    },
  }),
  bust('l_india', {
    robe: 'white',
    skin: 'skin2',
    nose: 'skin4',
    brow: 'hairWhite',
    extra: (m) => {
      // Bald, a little white hair at the sides; round glasses; a shawl.
      m.box([-6, 12, -5], [-5, 15, 1], 'hairWhite').box([5, 12, -5], [6, 15, 1], 'hairWhite');
      for (const x of [-4, 1]) {
        m.box([x, 12, 5], [x + 3, 13, 6], 'black').box([x, 14, 5], [x + 3, 15, 6], 'black');
        m.set(x, 13, 5, 'black').set(x + 2, 13, 5, 'black');
      }
      m.box([-1, 13, 5], [1, 14, 6], 'black');
      m.box([-9, 3, -4], [-3, 8, 5], 'cloth').box([3, 0, 4], [9, 5, 5], 'cloth');
    },
  }),
  bust('l_persia', {
    robe: 'purple',
    skin: 'skin2',
    beard: 'black',
    hair: 'black',
    extra: (m) => {
      // A crenellated gold crown; a squared beard; a purple robe edged in gold.
      m.box([-5, 19, -5], [5, 22, 5], 'gold');
      for (const [x, z] of [[-5, -5], [-1, -5], [3, -5], [-5, 3], [-1, 3], [3, 3], [-5, -1], [3, -1]]) m.box([x, 22, z], [x + 2, 24, z + 2], 'gold');
      m.box([-4, 5, 4], [4, 8, 6], 'black');
      m.box([-9, 6, -4], [9, 7, 4], 'gold');
    },
  }),
  bust('l_korea', {
    robe: 'red',
    skin: 'skin3',
    hair: 'black',
    beard: 'black',
    extra: (m) => {
      // The winged court hat; a gold dragon roundel on the chest.
      m.box([-5, 18, -5], [5, 22, 4], 'black').box([-4, 22, -4], [4, 24, 1], 'black');
      m.box([-8, 21, -5], [-5, 23, -4], 'black').box([5, 21, -5], [8, 23, -4], 'black');
      m.box([-3, 1, 4], [3, 6, 5], 'gold').box([-2, 2, 4], [2, 5, 5], 'redDark');
    },
  }),
  bust('l_arabia', {
    robe: 'green',
    skin: 'skin2',
    beard: 'black',
    hair: 'black',
    extra: (m) => {
      // A great white turban with a jewel; a robe trimmed in gold.
      m.box([-6, 17, -6], [6, 23, 6], 'white').box([-5, 23, -5], [5, 25, 5], 'white');
      m.box([-1, 19, 6], [1, 21, 7], 'jade');
      m.box([-1, 0, 4], [1, 7, 5], 'gold');
    },
  }),
  bust('l_germany', {
    robe: 'navy',
    skin: 'skin3',
    hair: 'hairGrey',
    brow: 'hairWhite',
    extra: (m) => {
      // The spiked helmet; a great moustache; a uniform with a gold-buttoned front.
      m.box([-6, 18, -6], [6, 21, 6], 'black').box([-6, 17, 4], [6, 18, 7], 'black');
      m.box([-1, 21, -1], [1, 25, 1], 'gold').box([-2, 19, 5], [2, 21, 7], 'gold');
      m.box([-5, 11, 5], [5, 12, 6], 'hairWhite').box([-6, 10, 5], [-4, 11, 6], 'hairWhite').box([4, 10, 5], [6, 11, 6], 'hairWhite');
      for (let y = 1; y < 7; y += 2) m.set(0, y, 4, 'gold');
      m.box([-3, 6, 4], [3, 8, 5], 'redDark');
    },
  }),
  bust('l_iroquois', {
    robe: 'leather',
    skin: 'skin2',
    nose: 'skin4',
    hair: 'black',
    extra: (m) => {
      // Long hair; feathers rising at the back; a beaded collar.
      m.box([-6, 5, -5], [-5, 15, 2], 'black').box([5, 5, -5], [6, 15, 2], 'black');
      m.box([-1, 20, -5], [0, 27, -4], 'white').box([0, 20, -5], [1, 25, -4], 'leatherDark');
      m.box([-1, 26, -5], [0, 27, -4], 'black');
      for (let x = -8; x < 8; x += 2) m.set(x, 6, 4, x % 4 ? 'feather3' : 'white');
    },
  }),
  bust('l_aztec', {
    robe: 'feather2',
    skin: 'skin2',
    nose: 'skin4',
    hair: 'black',
    extra: (m) => {
      // A great fan of feathers behind the head, a gold band, jade earrings and collar.
      for (let y = 14; y < 30; y++) {
        const half = Math.round(Math.sqrt(Math.max(0, 1 - ((y - 22) / 8) ** 2)) * 11);
        if (half) m.box([-half, y, -7], [half, y + 1, -6], y > 25 ? 'feather3' : y > 19 ? 'feather' : 'feather2');
      }
      m.box([-6, 17, -6], [6, 19, 6], 'gold');
      m.box([-1, 18, 6], [1, 20, 7], 'jade');
      m.box([-7, 10, -1], [-6, 12, 1], 'jade').box([6, 10, -1], [7, 12, 1], 'jade');
      m.box([-8, 6, -4], [8, 8, 5], 'jade');
    },
  }),
  bust('l_russia', {
    robe: 'nemes',
    skin: 'skin3',
    hair: 'hairWhite',
    extra: (m) => {
      // Powdered hair up; a small jewelled crown; an ermine collar; a sash.
      m.box([-4, 20, -4], [4, 22, 3], 'hairWhite');
      m.box([-3, 22, -2], [3, 25, 2], 'gold').set(-1, 25, 0, 'red').set(0, 25, 0, 'red');
      m.box([-1, 23, 2], [1, 24, 3], 'jade');
      m.box([-9, 5, -4], [9, 8, 5], 'ermine');
      for (const x of [-7, -3, 2, 6]) m.set(x, 6, 4, 'black');
      for (let y = 0; y < 5; y++) m.box([-6 + y * 2, y, 4], [-4 + y * 2, y + 1, 5], 'red');
    },
  }),
  bust('l_france', {
    robe: 'nemes',
    skin: 'skin3',
    hair: 'hair',
    extra: (m) => {
      // The bicorne, sideways; a high collar and gold epaulettes.
      m.box([-10, 19, -2], [10, 21, 2], 'black').box([-7, 21, -2], [7, 24, 2], 'black').box([-4, 24, -1], [4, 25, 1], 'black');
      m.box([-1, 21, 2], [1, 23, 3], 'red');
      m.box([-11, 6, -3], [-8, 8, 3], 'gold').box([8, 6, -3], [11, 8, 3], 'gold');
      m.box([-3, 6, 3], [3, 9, 5], 'white');
      for (let y = 1; y < 6; y += 2) m.set(0, y, 4, 'gold');
    },
  }),
];

/** The leaders' pictures, each in three moods. */
export const LEADERS = BUSTS.flatMap(({ id, o }) => MOODS.map((mood) => face(mood === 'plain' ? id : `${id}_${mood}`, o, { mood })));
/** Each leader's strip of frames for diplomacy's scene (`SHEET`). */
export const LEADER_SHEETS = BUSTS.map(({ id, o }) => ({ id: `${id}_sheet`, frames: SHEET.map((f) => face(id, o, f)) }));

// ---------------------------------------------------------------------------------------------
// The wonders

/** Stacked layers, each [half-width, height], in alternating colours. */
function steps(m, layers, c, c2) {
  let y = 0;
  layers.forEach(([half, h], i) => {
    m.box([-half, y, -half], [half, y + h, half], i % 2 ? (c2 ?? c) : c);
    y += h;
  });
}

/** A statue on a plinth: a robed figure, an arm raised (a torch; or a cross's arms), in `c`. */
function statue(id, c, o = {}) {
  const m = new Model(id);
  m.box([-8, 0, -8], [8, 6, 8], 'stone').box([-6, 6, -6], [6, 10, 6], 'stoneDark');
  m.box([-4, 10, -3], [4, 26, 3], c);
  m.box([-3, 26, -3], [3, 32, 3], c);
  if (o.cross) m.box([-14, 21, -2], [14, 25, 2], c);
  else m.box([4, 20, -1], [7, 36, 2], c).box([3, 36, -2], [8, 38, 3], o.torch ?? 'gold').box([4, 38, -1], [7, 41, 2], 'fire');
  if (o.crown) for (let x = -4; x < 5; x += 2) m.box([x, 32, -1], [x + 1, 35, 0], c);
  if (o.seated) m.box([-7, 10, -6], [7, 16, 6], 'gold').box([-7, 16, -6], [7, 26, -4], 'gold');
  return m;
}

/** Columns round a rectangle, `step` apart. */
function columns(m, w, d, h, y0, c, step = 3) {
  for (let x = -w; x <= w; x += step) for (const z of [-d, d]) m.box([x, y0, z], [x + 1, y0 + h, z + 1], c);
  for (let z = -d; z <= d; z += step) for (const x of [-w, w]) m.box([x, y0, z], [x + 1, y0 + h, z + 1], c);
}

/** A dome: a half sphere of radius r, its base at height y. */
function dome(m, x, z, y, r, c) {
  for (let j = 0; j <= r; j++) m.disc(x, z, Math.sqrt(Math.max(0, r * r - j * j)), y + j, y + j + 1, c);
}

const make = (id, fn) => {
  const m = new Model(id);
  fn(m);
  return m;
};

export const WONDERS = [
  make('w_pyramid', (m) => {
    for (let j = 0; j < 14; j++) m.box([-14 + j, j * 2, -14 + j], [14 - j, j * 2 + 2, 14 - j], j % 3 === 2 ? 'sandDark' : 'sand');
    m.box([-1, 28, -1], [1, 30, 1], 'gold');
  }),
  make('w_henge', (m) => {
    m.disc(0, 0, 15, 0, 1, 'green');
    const at = (i) => [Math.round(Math.cos((i / 10) * Math.PI * 2) * 11), Math.round(Math.sin((i / 10) * Math.PI * 2) * 11)];
    for (let i = 0; i < 10; i++) {
      const [x, z] = at(i);
      m.box([x - 1, 1, z - 1], [x + 2, 13, z + 2], 'stone');
      if (i % 2 === 0) {
        const [x2, z2] = at(i + 1);
        m.box([Math.min(x, x2) - 1, 13, Math.min(z, z2) - 1], [Math.max(x, x2) + 2, 15, Math.max(z, z2) + 2], 'stoneDark');
      }
    }
    m.box([-1, 1, -2], [2, 4, 2], 'stoneDark');
  }),
  statue('w_colossus', 'bronze', { crown: true }),
  statue('w_liberty', 'copper', { crown: true }),
  statue('w_cristo', 'marbleWhite', { cross: true }),
  statue('w_zeus', 'marbleWhite', { seated: true }),
  make('w_lighthouse', (m) => {
    m.box([-8, 0, -8], [8, 4, 8], 'stone');
    for (let j = 0; j < 9; j++) {
      const k = Math.floor(j / 3);
      m.box([-5 + k, 4 + j * 3, -5 + k], [5 - k, 7 + j * 3, 5 - k], j % 2 ? 'marbleWhite' : 'stone');
    }
    m.box([-3, 31, -3], [3, 35, 3], 'fire').box([-3, 35, -3], [3, 37, 3], 'bronze');
  }),
  make('w_gardens', (m) => {
    steps(m, [[14, 6], [10, 6], [6, 6]], 'sandDark', 'sand');
    for (const [half, y] of [[14, 6], [10, 12], [6, 18]]) for (let x = -half; x < half; x += 2) for (const z of [-half, half - 1]) m.box([x, y, z], [x + 1, y + 2, z + 1], 'green');
    for (const [half, y] of [[14, 3], [10, 9]]) for (let x = -half; x < half; x += 3) m.box([x, y - 3, half], [x + 1, y + 1, half + 1], 'green');
    m.box([-2, 18, -2], [2, 24, 2], 'green');
  }),
  make('w_temple', (m) => {
    m.box([-14, 0, -9], [14, 3, 9], 'marbleWhite');
    columns(m, 12, 7, 14, 3, 'marbleWhite');
    m.box([-13, 17, -8], [14, 19, 9], 'marbleWhite');
    for (let j = 0; j < 5; j++) m.box([-13 + j * 2, 19 + j, -8], [14 - j * 2, 20 + j, 9], j % 2 ? 'stone' : 'marbleWhite');
    m.box([-10, 3, -5], [10, 15, 5], 'stoneDark');
  }),
  make('w_palace', (m) => {
    m.box([-16, 0, -10], [16, 3, 10], 'stoneDark');
    m.box([-15, 3, -9], [15, 14, 9], 'marbleWhite');
    for (let x = -13; x < 14; x += 4) m.box([x, 6, 9], [x + 2, 11, 10], 'glass');
    m.box([-16, 14, -10], [16, 16, 10], 'roofDark');
    for (let j = 0; j < 4; j++) m.box([-15 + j * 3, 16 + j * 2, -9 + j * 2], [15 - j * 3, 18 + j * 2, 9 - j * 2], 'roof');
    m.box([-3, 3, 9], [3, 9, 11], 'gold');
  }),
  make('w_wall', (m) => {
    for (let z = -16; z < 16; z++) {
      const x = Math.round(Math.sin(z / 5) * 5);
      m.box([x - 2, 0, z], [x + 3, 9, z + 1], 'stone');
      if (z % 2 === 0) m.box([x - 2, 9, z], [x - 1, 11, z + 1], 'stone').box([x + 2, 9, z], [x + 3, 11, z + 1], 'stone');
      if ((z + 16) % 10 === 0) m.box([x - 4, 0, z - 2], [x + 5, 15, z + 3], 'stoneDark').box([x - 4, 15, z - 2], [x + 5, 18, z + 3], 'roofDark');
    }
  }),
  make('w_arena', (m) => {
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * 14);
      const z = Math.round(Math.sin(a) * 10);
      m.box([x - 1, 0, z - 1], [x + 2, i % 2 ? 16 : 18, z + 2], i % 4 === 0 ? 'stoneDark' : 'sand');
    }
    m.disc(0, 0, 8, 0, 1, 'sandDark');
  }),
  make('w_dome', (m) => {
    m.box([-12, 0, -12], [12, 12, 12], 'marbleWhite');
    for (let x = -10; x < 11; x += 5) m.box([x, 3, 12], [x + 2, 9, 13], 'nemes');
    dome(m, 0, 0, 12, 10, 'teal');
    m.box([-1, 22, -1], [1, 26, 1], 'gold');
    for (const [x, z] of [[-14, -14], [12, -14], [-14, 12], [12, 12]]) m.box([x, 0, z], [x + 2, 26, z + 2], 'marbleWhite').box([x, 26, z], [x + 2, 28, z + 2], 'gold');
  }),
  make('w_steps', (m) => {
    steps(m, [[14, 4], [12, 4], [10, 4], [8, 4], [6, 4]], 'stone', 'stoneDark');
    m.box([-4, 20, -4], [4, 27, 4], 'stoneDark').box([-2, 22, 4], [2, 25, 5], 'black');
    m.box([-2, 0, 14], [2, 20, 15], 'stoneDark');
  }),
  make('w_cathedral', (m) => {
    m.box([-8, 0, -14], [8, 16, 12], 'stone');
    for (let j = 0; j < 7; j++) m.box([-8 + j, 16 + j, -14], [8 - j, 17 + j, 12], 'slate');
    for (const x of [-8, 4]) m.box([x, 0, 12], [x + 4, 30, 16], 'stone').box([x, 30, 12], [x + 4, 32, 16], 'stoneDark');
    m.disc(0, 14, 3, 16, 19, 'feather3');
    m.box([-2, 0, 12], [2, 7, 13], 'woodDark');
  }),
  make('w_castle', (m) => {
    m.box([-10, 0, -10], [10, 14, 10], 'marbleWhite');
    for (const [x, z] of [[-12, -12], [8, -12], [-12, 8], [8, 8]]) {
      m.box([x, 0, z], [x + 4, 22, z + 4], 'marbleWhite');
      m.box([x - 1, 22, z - 1], [x + 5, 24, z + 5], 'slate').box([x, 24, z], [x + 4, 26, z + 4], 'slate').box([x + 1, 26, z + 1], [x + 3, 30, z + 3], 'slate');
    }
    for (let j = 0; j < 5; j++) m.box([-10 + j * 2, 14 + j * 2, -10 + j * 2], [10 - j * 2, 16 + j * 2, 10 - j * 2], 'slate');
    m.box([-2, 0, 10], [2, 6, 11], 'woodDark');
  }),
  make('w_pagoda', (m) => {
    for (let j = 0; j < 7; j++) {
      const k = Math.floor(j / 2);
      m.box([-6 + k, j * 6, -6 + k], [6 - k, j * 6 + 4, 6 - k], 'marbleWhite');
      m.box([-8 + k, j * 6 + 4, -8 + k], [8 - k, j * 6 + 6, 8 - k], 'roofDark');
    }
    m.box([-1, 42, -1], [1, 47, 1], 'gold');
  }),
  make('w_clock', (m) => {
    m.box([-5, 0, -5], [5, 32, 5], 'sand');
    for (let y = 4; y < 28; y += 4) m.box([-5, y, 5], [5, y + 1, 6], 'sandDark');
    m.box([-6, 32, -6], [6, 40, 6], 'sandDark');
    m.box([-4, 33, 6], [4, 39, 7], 'white');
    m.box([0, 36, 7], [1, 39, 8], 'black').box([0, 36, 7], [3, 37, 8], 'black');
    for (let j = 0; j < 6; j++) m.box([-5 + j, 40 + j * 2, -5 + j], [5 - j, 42 + j * 2, 5 - j], 'slate');
    m.box([-1, 52, -1], [1, 56, 1], 'gold');
  }),
  make('w_spire', (m) => {
    for (let j = 0; j < 48; j++) {
      const half = Math.max(1, Math.round(13 * Math.pow(1 - j / 48, 2)));
      m.box([-half, j, -half], [-half + 1, j + 1, half], 'lattice').box([half - 1, j, -half], [half, j + 1, half], 'lattice');
      m.box([-half, j, -half], [half, j + 1, -half + 1], 'lattice').box([-half, j, half - 1], [half, j + 1, half], 'lattice');
      if (j === 14 || j === 30) m.box([-half, j, -half], [half, j + 1, half], 'lattice');
    }
    m.box([-1, 48, -1], [1, 52, 1], 'red');
  }),
  make('w_gate', (m) => {
    m.box([-16, 0, -4], [16, 3, 4], 'stone');
    for (let x = -14; x <= 12; x += 6) m.box([x, 3, -3], [x + 3, 20, 3], 'sand');
    m.box([-16, 20, -4], [16, 25, 4], 'sand');
    m.box([-4, 25, -2], [4, 28, 2], 'sandDark');
    m.box([-3, 28, -1], [3, 32, 1], 'copper');
  }),
  make('w_theatre', (m) => {
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * 12);
      const z = Math.round(Math.sin(a) * 12);
      m.box([x - 1, 0, z - 1], [x + 2, 14, z + 2], i % 3 === 0 ? 'woodDark' : 'white');
    }
    m.disc(0, 0, 13, 14, 16, 'straw');
    m.box([-3, 14, -1], [3, 20, 1], 'woodDark').box([-1, 20, -1], [1, 24, 1], 'woodDark').box([1, 21, 0], [6, 24, 1], 'red');
  }),
  make('w_opera', (m) => {
    m.box([-16, 0, -10], [16, 4, 10], 'sand');
    for (const [x, h, z] of [[-10, 18, -2], [-2, 24, 2], [7, 16, -1]])
      for (let j = 0; j < h; j++) {
        const half = Math.round((h - j) * 0.45);
        const back = Math.round(j * 0.35);
        m.box([x - half, 4 + j, z - back], [x + half, 5 + j, z - back + 3], 'white');
      }
  }),
  make('w_modern', (m) => {
    m.box([-14, 0, -14], [14, 4, 14], 'concrete');
    m.box([-5, 4, -5], [5, 44, 5], 'glass');
    for (let y = 6; y < 44; y += 3) m.box([-5, y, -5], [5, y + 1, 5], 'concrete');
    m.box([-12, 4, -10], [-6, 12, 10], 'concrete').box([6, 4, -10], [12, 12, 10], 'concrete');
    m.box([-1, 44, -1], [1, 50, 1], 'grey');
  }),
  make('w_dish', (m) => {
    m.box([-12, 0, -12], [12, 2, 12], 'concrete');
    m.box([-3, 2, -3], [3, 12, 3], 'grey');
    for (let j = 0; j < 8; j++) {
      const r = 5 + j * 1.6;
      m.disc(0, 0, r, 12 + j, 13 + j, j === 7 ? 'grey' : 'white');
    }
    m.box([-1, 13, -1], [1, 26, 1], 'grey').box([-2, 26, -2], [2, 28, 2], 'red');
  }),
  make('w_army', (m) => {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) person(m, -15 + c * 10, -10 + r * 10, { tunic: 'mud', legs: 'mud', skin: 'mud', helmet: 'hair', hairColour: 'sandDark', weapon: 'spear', belt: 'sandDark' });
  }),
  make('w_rocket', (m) => {
    m.box([-12, 0, -12], [12, 2, 12], 'concrete');
    m.box([-3, 2, -3], [3, 40, 3], 'white');
    for (let y = 8; y < 40; y += 10) m.box([-3, y, -3], [3, y + 1, 3], 'black');
    for (let j = 0; j < 6; j++) {
      const k = Math.floor(j / 2);
      m.box([-3 + k, 40 + j, -3 + k], [3 - k, 41 + j, 3 - k], 'white');
    }
    for (const [x, z] of [[-6, 0], [4, 0], [0, -6], [0, 4]]) m.box([x, 2, z], [x + 2, 12, z + 2], 'red');
    m.box([6, 2, -2], [8, 44, 0], 'orange');
  }),
  make('w_atom', (m) => {
    m.box([-10, 0, -10], [10, 2, 10], 'concrete');
    m.disc(0, 0, 3, 14, 20, 'feather3');
    for (const [a, b] of [[1, 0], [0.5, 0.87], [-0.5, 0.87]])
      for (let i = 0; i < 80; i++) {
        const t = (i / 80) * Math.PI * 2;
        m.set(Math.round(Math.cos(t) * 13 * a), Math.round(17 + Math.sin(t) * 13), Math.round(Math.cos(t) * 13 * b), 'orange');
      }
  }),
];
