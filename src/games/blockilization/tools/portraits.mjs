/**
 * Pictures-only shapes: each leader's bust (head and shoulders, in what they're known for) and the
 * wonders, a few kinds of great building (each wonder is drawn as its kind: `client/art.ts`). Drawn
 * by `pictures.mjs` with the units; never models in the world.
 */
import { Model, person } from './shapes.mjs';
import { cellOf } from './voxel.mjs';

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
  bust('l_rome', {
    robe: 'white',
    skin: 'skin',
    hair: 'hair',
    extra: (m) => {
      // A laurel wreath round short hair; a toga, its purple border across the chest.
      m.box([-6, 17, -6], [6, 18, 6], 'cypress');
      for (const x of [-6, -4, 3, 5]) m.set(x, 18, 4, 'green');
      m.box([-6, 18, -5], [-5, 19, 2], 'green').box([5, 18, -5], [6, 19, 2], 'green');
      for (let y = 0; y < 7; y++) m.box([-8 + y * 2, y, 4], [-6 + y * 2, y + 1, 5], 'purple');
    },
  }),
  bust('l_greece', {
    robe: 'bronze',
    skin: 'skin',
    hair: 'hair',
    extra: (m) => {
      // Young and beardless, his hair swept up from the brow under a gold diadem; a bronze cuirass, a red cloak at the shoulders.
      m.box([-2, 19, 4], [2, 21, 6], 'hair').box([-1, 21, 3], [1, 22, 5], 'hair');
      m.box([-6, 17, -6], [6, 18, 6], 'gold');
      m.box([-10, 3, -5], [-7, 8, 2], 'red').box([7, 3, -5], [10, 8, 2], 'red').box([-9, 0, -5], [9, 6, -4], 'red');
      m.box([-3, 2, 4], [3, 5, 5], 'gold').set(0, 3, 5, 'redDark');
    },
  }),
  bust('l_japan', {
    robe: 'black',
    skin: 'skin3',
    hair: 'black',
    extra: (m) => {
      // The crown shaved, a topknot laid along it; a thin moustache; a kamishimo's stiff shoulders and a white crest on the chest.
      m.box([-3, 19, -3], [3, 20, 5], 'skin3');
      m.box([-1, 20, -4], [1, 21, 3], 'black');
      m.box([-3, 11, 5], [3, 12, 6], 'black');
      m.box([-13, 6, -3], [-9, 8, 3], 'black').box([9, 6, -3], [13, 8, 3], 'black');
      m.box([-9, 7, -3], [-7, 8, 3], 'black').box([7, 7, -3], [9, 8, 3], 'black');
      m.box([-1, 2, 4], [1, 4, 5], 'white');
      m.box([-3, 0, 4], [3, 1, 5], 'greyDark');
    },
  }),
  bust('l_england', {
    robe: 'crimson',
    skin: 'skin3',
    hair: 'orange',
    extra: (m) => {
      // Red hair curled high under a small jewelled crown; a great white ruff; pearls down the gown.
      m.box([-5, 20, -4], [5, 22, 4], 'orange');
      m.box([-3, 22, -2], [3, 24, 2], 'gold').set(-1, 24, 0, 'white').set(1, 24, 0, 'white');
      m.box([-1, 22, 2], [1, 23, 3], 'red');
      m.box([-9, 7, -4], [9, 9, 5], 'white').box([-8, 9, -4], [-5, 12, 0], 'white').box([5, 9, -4], [8, 12, 0], 'white');
      for (let y = 0; y < 7; y += 2) m.set(-1, y, 4, 'white').set(1, y, 4, 'white');
      m.box([-3, 1, 4], [3, 6, 5], 'gold').box([-2, 2, 4], [2, 5, 5], 'crimson');
    },
  }),
  bust('l_mongolia', {
    robe: 'blueDark',
    skin: 'skin3',
    hair: 'black',
    brow: 'black',
    extra: (m) => {
      // A fur-brimmed hat rising to a gold point; a long moustache falling past the chin and a thin beard; a deel tied with a gold sash.
      m.box([-6, 18, -6], [6, 20, 6], 'leatherDark');
      m.box([-4, 20, -4], [4, 23, 4], 'redDark').box([-2, 23, -2], [2, 25, 2], 'gold').box([-1, 25, -1], [1, 26, 1], 'gold');
      m.box([-3, 11, 5], [3, 12, 6], 'black').box([-4, 8, 5], [-3, 11, 6], 'black').box([3, 8, 5], [4, 11, 6], 'black');
      m.box([-1, 7, 5], [1, 9, 6], 'black');
      m.box([-9, 2, -4], [9, 3, 5], 'sash');
      for (let y = 3; y < 7; y++) m.box([2 - y, y, 4], [4 - y, y + 1, 5], 'blue');
    },
  }),
  bust('l_ottomans', {
    robe: 'teal',
    skin: 'skin',
    beard: 'black',
    hair: 'black',
    extra: (m) => {
      // A great tall turban round a red cap, a jewel and a plume at its front; a kaftan with a fur collar.
      m.box([-7, 17, -7], [7, 22, 7], 'white').box([-6, 22, -6], [6, 27, 6], 'white').box([-4, 27, -4], [4, 29, 4], 'white');
      m.box([-2, 29, -2], [2, 30, 2], 'red');
      m.box([-1, 21, 7], [1, 23, 8], 'jade').box([0, 23, 6], [1, 30, 7], 'feather3');
      m.box([-9, 5, -4], [-4, 8, 5], 'leather').box([4, 5, -4], [9, 8, 5], 'leather');
      for (let y = 0; y < 5; y++) m.set(0, y, 4, 'gold');
    },
  }),
  bust('l_zulu', {
    robe: 'skin4',
    skin: 'skin4',
    nose: 'horseDark',
    hair: 'black',
    extra: (m) => {
      // A leopard-skin headband with a crane's feather upright; ear plugs; a leopard pelt over the shoulders.
      m.box([-6, 16, -6], [6, 18, 6], 'sand');
      for (const [x, z] of [[-6, 2], [-4, 5], [-1, 5], [2, 5], [5, 3], [5, -2], [-6, -3]]) m.set(x, 16 + (x & 1), z, 'black');
      m.box([-1, 18, -5], [1, 27, -4], 'white').box([-1, 27, -5], [1, 28, -4], 'black');
      m.box([-7, 11, -1], [-6, 13, 1], 'white').box([6, 11, -1], [7, 13, 1], 'white');
      m.box([-9, 4, -4], [9, 8, 5], 'sand');
      for (const [x, y] of [[-8, 5], [-5, 7], [-2, 5], [1, 6], [4, 4], [7, 6], [-6, 4], [6, 7]]) m.set(x, y, 4, 'black');
    },
  }),
  bust('l_inca', {
    robe: 'ochre',
    skin: 'skin2',
    nose: 'skin4',
    hair: 'black',
    extra: (m) => {
      // The royal fringe of red wool hanging on the brow from a woven band, feathers above; gold ear spools; a tunic of squares.
      m.box([-6, 17, -6], [6, 19, 6], 'gold').box([-6, 18, -6], [6, 19, 6], 'redDark');
      m.box([-3, 15, 5], [3, 17, 6], 'red');
      m.box([-2, 19, -2], [-1, 25, -1], 'feather').box([1, 19, -2], [2, 25, -1], 'feather').box([-1, 19, -2], [1, 23, -1], 'white');
      m.box([-7, 11, -1], [-6, 14, 2], 'gold').box([6, 11, -1], [7, 14, 2], 'gold');
      for (let y = 0; y < 6; y += 2) for (let x = -8; x < 8; x += 2) m.box([x, y, 4], [x + 1, y + 1, 5], (x + y) % 4 ? 'gold' : 'redDark');
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

/** Clear the cells [lo, hi): a doorway, a courtyard, a recess. */
const cut = (m, lo, hi) => m.vox.paint('m', lo, hi, () => false);

/** A hipped roof over [x0, x1) × [z0, z1) from y: up to `n` layers, each a voxel in from the last. */
function hip(m, x0, x1, z0, z1, y, n, c) {
  for (let j = 0; j < n && x0 + j < x1 - j && z0 + j < z1 - j; j++) m.box([x0 + j, y + j, z0 + j], [x1 - j, y + j + 1, z1 - j], c);
}

/** An Eastern roof over [x0, x1) × [z0, z1) at y: eaves two voxels out, their corners turned up, hipped in `n` layers. */
function eaves(m, x0, x1, z0, z1, y, n, c) {
  m.box([x0 - 2, y, z0 - 2], [x1 + 2, y + 1, z1 + 2], c);
  for (const x of [x0 - 2, x1 + 1]) for (const z of [z0 - 2, z1 + 1]) m.set(x, y + 1, z, c);
  hip(m, x0 - 1, x1 + 1, z0 - 1, z1 + 1, y + 1, n, c);
}

/** A ring of `n` columns of radius r round (x, z), from y0 to y1. */
function ring(m, x, z, r, n, y0, y1, c) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const [cx, cz] = [Math.floor(x + Math.cos(a) * r), Math.floor(z + Math.sin(a) * r)];
    m.box([cx, y0, cz], [cx + 1, y1, cz + 1], c);
  }
}

/** An onion dome at (x, z) from y, r across and h tall: swelling out, then drawn in to a point; striped round in c2 if given. */
function onion(m, x, z, y, r, h, c, c2) {
  for (let j = 0; j < h; j++) {
    const t = j / h;
    const rr = t < 0.35 ? r * (0.75 + 0.25 * Math.sin((t / 0.35) * (Math.PI / 2))) : r * Math.cos(((t - 0.35) / 0.65) * (Math.PI / 2)) ** 1.2 + 0.5;
    for (let k = Math.floor(z - rr); k <= Math.ceil(z + rr); k++)
      for (let i = Math.floor(x - rr); i <= Math.ceil(x + rr); i++) {
        const [dx, dz] = [i + 0.5 - x, k + 0.5 - z];
        if (dx * dx + dz * dz > rr * rr) continue;
        const band = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (Math.PI * 2)) * 8 + j * 0.5);
        m.set(i, y + j, k, c2 && band % 2 ? c2 : c);
      }
  }
  m.disc(x, z, 0.75, y + h, y + h + 2, 'gold');
}

/** A lotus-bud tower (Angkor's): square layers of half-width r, then drawn in to a point over h, ribbed in two colours. */
function bud(m, x, z, y, r, h, c, c2) {
  for (let j = 0; j < h; j++) {
    const t = j / h;
    const half = Math.max(1, Math.round(r * (t < 0.3 ? 1 : Math.cos(((t - 0.3) / 0.7) * (Math.PI / 2)) + 0.15)));
    m.box([x - half, y + j, z - half], [x + half, y + j + 1, z + half], j % 2 ? c2 : c);
  }
}

/** Djenné's wooden spikes (torons): a voxel out from the walls' sides, at every cell that `at(i, j, k)` picks. */
function spikes(m, c, at) {
  for (const key of [...m.vox.parts.get('m').keys()]) {
    const [i, j, k] = cellOf(key);
    if (!at(i, j, k)) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!m.vox.get('m', i + dx, j, k + dz) && !m.vox.get('m', i + dx, j - 1, k + dz)) m.set(i + dx, j, k + dz, c);
  }
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
  // The Great Wall: crenellated, climbing up over a hill and down again, watchtowers along it.
  make('w_wall', (m) => {
    // Its way runs corner to corner (front left to back right, across the picture), swinging as it goes, along the crest
    // of a ridge that rises to a peak and a lesser one; its walk four voxels up.
    const way = (x) => -0.8 * x + 7 * Math.sin(x / 5);
    const slope = (x) => -0.8 + 1.4 * Math.cos(x / 5);
    const crest = (x) => 1 + 15 * Math.exp(-((x + 4) ** 2) / 50) + 8 * Math.exp(-((x - 10) ** 2) / 20);
    const off = (x, z) => Math.abs(z - way(x)) / Math.hypot(1, slope(x));
    const hill = (x, z) => Math.round(1 + (crest(x) - 1) * Math.exp(-(off(x, z) ** 2) / 90));
    const walk = (x) => Math.round(crest(x)) + 4;
    for (let x = -16; x < 16; x++)
      for (let z = -16; z < 16; z++) {
        const h = hill(x + 0.5, z + 0.5);
        m.box([x, 0, z], [x + 1, h - 1, z + 1], 'mud').set(x, h - 1, z, h % 4 === 0 ? 'olive' : 'green');
        const d = off(x + 0.5, z + 0.5);
        if (d >= 6 && (x * 7 + z * 13) % 17 === 0) m.box([x, h, z], [x + 1, h + 2, z + 1], 'cypress');
        if (d >= 1.8) continue;
        const y = walk(x + 0.5);
        m.box([x, h - 1, z], [x + 1, y, z + 1], 'stone');
        if (d < 0.9) m.set(x, y - 1, z, 'stoneDark');
        else if ((x + z) % 2 === 0) m.set(x, y, z, 'stone');
      }
    for (const x of [-12, -3, 10]) {
      const [z, y] = [Math.round(way(x)), walk(x) + 4];
      m.box([x - 2, 1, z - 2], [x + 3, y, z + 3], 'stone').box([x - 1, y - 1, z - 1], [x + 2, y, z + 2], 'stoneDark');
      for (let i = -2; i < 3; i += 2) for (const [a, b] of [[x + i, z - 2], [x + i, z + 2], [x - 2, z + i], [x + 2, z + i]]) m.set(a, y, b, 'stone');
      // An arched window on each side.
      for (const [a, b] of [[x, z + 2], [x, z - 2], [x + 2, z], [x - 2, z]]) m.box([a, y - 4, b], [a + 1, y - 2, b + 1], 'black');
      if (x === -3) hip(m, x - 1, x + 2, z - 1, z + 2, y, 2, 'roofDark');
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
  // The Mausoleum at Halicarnassus: a tall podium, a colonnade round the tomb, a stepped pyramid, a chariot of four horses on top.
  make('w_mausoleum', (m) => {
    m.box([-13, 0, -13], [13, 2, 13], 'stoneDark');
    m.box([-11, 2, -11], [11, 15, 11], 'marbleWhite').box([-11, 12, -11], [11, 14, 11], 'sandDark');
    m.box([-10, 15, -10], [11, 16, 11], 'marbleWhite');
    columns(m, 9, 9, 9, 16, 'marbleWhite');
    m.box([-7, 16, -7], [8, 25, 8], 'stoneDark');
    m.box([-10, 25, -10], [11, 27, 11], 'marbleWhite');
    for (let j = 0; j < 7; j++) m.box([-9 + j, 27 + j, -9 + j], [10 - j, 28 + j, 10 - j], j % 2 ? 'stone' : 'marbleWhite');
    // The quadriga: four horses abreast before the chariot and its driver.
    for (const x of [-3, -1, 1, 3]) {
      m.box([x, 34, 0], [x + 1, 36, 1], 'bronze').box([x, 34, 3], [x + 1, 36, 4], 'bronze');
      m.box([x, 36, 0], [x + 1, 38, 4], 'bronze').box([x, 38, 3], [x + 1, 40, 5], 'bronze');
    }
    m.box([-3, 34, -3], [4, 37, -1], 'bronze').box([0, 37, -3], [1, 41, -2], 'bronze');
  }),
  // The Oracle at Delphi: the round tholos on a terrace of the mountain, a tripod's fire before it, the ruined columns of Apollo's temple above.
  make('w_oracle', (m) => {
    m.box([-15, 0, -15], [15, 3, 15], 'stoneDark').box([-15, 3, -15], [15, 8, -7], 'stoneDark').box([-15, 8, -15], [15, 9, -7], 'green');
    m.box([-15, 3, -7], [15, 4, 15], 'green');
    [12, 7, 12, 4, 12, 9, 12].forEach((h, i) => m.box([-13 + i * 4, 9, -12], [-11 + i * 4, 9 + h, -10], 'marbleWhite'));
    m.box([-13, 21, -12], [-7, 23, -10], 'marbleWhite').box([3, 21, -12], [11, 23, -10], 'marbleWhite');
    m.disc(0, 4, 9.5, 4, 6, 'marbleWhite');
    m.disc(0, 4, 5.5, 6, 16, 'stone');
    ring(m, 0, 4, 8, 20, 6, 17, 'marbleWhite');
    m.disc(0, 4, 9, 17, 19, 'marbleWhite');
    for (const [r, y] of [[7.5, 19], [5.5, 20], [3.5, 21], [1.5, 22]]) m.disc(0, 4, r, y, y + 1, 'roof');
    // The tripod, its bowl on fire.
    for (const [x, z] of [[-2, 13], [1, 13], [-1, 11]]) m.box([x, 4, z], [x + 1, 8, z + 1], 'bronze');
    m.box([-2, 8, 11], [2, 9, 14], 'bronze').box([-1, 9, 12], [1, 11, 13], 'fire');
  }),
  // The Parthenon: eight columns across its end, its gable's sculpted pediment to the front, on the rock of the Acropolis.
  make('w_parthenon', (m) => {
    // The rock: a plateau, its cliffs falling unevenly round it.
    for (let x = -16; x < 16; x++)
      for (let z = -15; z < 15; z++) {
        const edge = Math.min(15.5 - Math.abs(x + 0.5), 14.5 - Math.abs(z + 0.5));
        const h = Math.max(1, Math.min(6, Math.floor(1 + edge * 1.5 + Math.sin(x * 0.9) + Math.cos(z * 0.7))));
        m.box([x, 0, z], [x + 1, h - 1, z + 1], 'stoneDark').set(x, h - 1, z, h < 6 ? 'stoneDark' : 'sandDark');
      }
    m.box([-9, 6, -13], [10, 7, 14], 'stone').box([-8, 7, -12], [9, 8, 13], 'marbleWhite');
    columns(m, 7, 11, 11, 8, 'marbleWhite', 2);
    // Roofless now: the cella's walls broken off, the entablature round the top, a pediment at either end.
    for (let x = -5; x < 6; x++) m.box([x, 8, -9], [x + 1, 11 + ((x * 7) % 4 + 4) % 4, -8], 'stone').box([x, 8, 8], [x + 1, 10 + ((x * 5) % 3 + 3) % 3, 9], 'stone');
    m.box([-5, 8, -9], [-4, 12, 9], 'stone').box([5, 8, -9], [6, 13, 9], 'stone');
    m.box([-8, 19, -12], [9, 21, 13], 'marbleWhite');
    cut(m, [-6, 19, -10], [7, 21, 11]);
    for (let j = 0; j < 5; j++) for (const z of [11, -12]) m.box([-8 + j * 2, 21 + j, z], [9 - j * 2, 22 + j, z + 2], 'marbleWhite');
    // Its pediment's figures.
    for (const x of [-5, -2, 1, 3, 6]) m.set(x, 21, 12, 'sand');
    m.set(0, 22, 12, 'sand').set(1, 22, 12, 'sand').set(0, 23, 12, 'sand');
    m.box([10, 6, 4], [13, 8, 6], 'marbleWhite').box([12, 6, -8], [14, 7, -6], 'marbleWhite');
  }),
  // The Great Mosque of Djenné: mud walls, three towers on its front, buttresses and pinnacles, its wooden spikes sticking out all over.
  make('w_great_mosque', (m) => {
    m.box([-15, 0, -13], [15, 3, 13], 'adobeDark');
    m.box([-14, 3, -11], [14, 14, 10], 'adobe');
    for (let x = -14; x < 14; x += 4) m.box([x, 3, -12], [x + 2, 17, -11], 'adobe').box([x, 17, -12], [x + 1, 19, -11], 'adobe');
    for (let z = -11; z < 9; z += 4) for (const x of [-15, 14]) m.box([x, 3, z], [x + 1, 17, z + 2], 'adobe').box([x, 17, z], [x + 1, 19, z + 1], 'adobe');
    for (const [x, h] of [[-9, 23], [0, 27], [9, 23]]) {
      m.box([x - 3, 3, 9], [x + 3, h, 13], 'adobe').box([x - 2, h, 10], [x + 2, h + 2, 12], 'adobe').box([x - 1, h + 2, 10], [x + 1, h + 4, 12], 'adobe');
      m.box([x - 1, h + 4, 10], [x + 1, h + 5, 12], 'white');
      for (const dx of [-3, 2]) m.box([x + dx, h, 9], [x + dx + 1, h + 2, 10], 'adobe').box([x + dx, h, 12], [x + dx + 1, h + 2, 13], 'adobe');
    }
    m.box([-1, 3, 12], [1, 8, 13], 'woodDark');
    spikes(m, 'wood', (i, j, k) => j > 5 && j % 4 === 1 && (i + k) % 3 === 0);
  }),
  // The Alhambra: red fort walls and square towers on a green hill, the tall Comares tower, a court with a long pool and arcades.
  make('w_alhambra', (m) => {
    m.box([-16, 0, -14], [16, 3, 14], 'green');
    m.box([-14, 3, -12], [14, 12, 12], 'ochre');
    cut(m, [-12, 4, -10], [12, 12, 10]);
    m.box([-12, 3, -10], [12, 4, 10], 'sand');
    for (let x = -14; x < 14; x += 2) for (const z of [-12, 11]) m.set(x, 12, z, 'ochre');
    for (let z = -12; z < 12; z += 2) for (const x of [-14, 13]) m.set(x, 12, z, 'ochre');
    for (const [x, z] of [[-15, -13], [11, -13], [-15, 9], [11, 9], [-2, 9]]) m.box([x, 3, z], [x + 4, 15, z + 4], 'ochre').box([x + 1, 15, z], [x + 3, 16, z + 4], 'ochre');
    m.box([-4, 3, -12], [4, 22, -5], 'ochre').box([-4, 22, -12], [4, 23, -5], 'roofDark');
    for (const x of [-3, 0, 2]) m.box([x, 16, -5], [x + 1, 19, -4], 'black');
    // The Court of the Myrtles: its pool between hedges, an arcade of white columns at its end.
    m.box([-2, 3, -4], [2, 4, 8], 'water');
    for (const x of [-4, 3]) m.box([x, 4, -4], [x + 1, 5, 8], 'cypress');
    for (let x = -8; x < 9; x += 2) m.box([x, 4, -5], [x + 1, 9, -4], 'marbleWhite');
    m.box([-9, 9, -6], [10, 10, -4], 'marbleWhite');
    for (const [x, z] of [[-9, 2], [7, 2], [-9, -2], [7, -2]]) m.box([x, 4, z], [x + 2, 11, z + 2], 'cypress');
  }),
  // The Taj Mahal: on its white plinth, the tomb with a tall arch on each face, its onion dome and little cupolas, a minaret at each corner.
  make('w_taj_mahal', (m) => {
    m.box([-15, 0, -15], [15, 3, 15], 'marbleWhite').box([-15, 2, -15], [15, 3, 15], 'stone');
    m.box([-9, 3, -9], [9, 17, 9], 'marbleWhite');
    m.box([-4, 3, -10], [4, 20, 10], 'marbleWhite').box([-10, 3, -4], [10, 20, 4], 'marbleWhite');
    m.vox.paint('m', [-10, 3, -10], [10, 20, 10], (i, j, k) => (Math.abs(i + 0.5) + Math.abs(k + 0.5) > 15 ? false : undefined));
    // The pointed arches, a voxel deep into each face (shadowed inside).
    const arch = (u, y) => y >= 4 && (Math.abs(u) < 1 ? y < 18 : Math.abs(u) < 2 ? y < 17 : Math.abs(u) < 3 && y < 15);
    m.vox.paint('m', [-10, 3, -10], [10, 20, 10], (i, j, k) => {
      for (const [u, d] of [[i + 0.5, 9.5 - k - 0.5], [i + 0.5, k + 0.5 + 9.5], [k + 0.5, 9.5 - i - 0.5], [k + 0.5, i + 0.5 + 9.5]]) {
        if (!arch(u, j)) continue;
        if (d < 1) return false;
        if (d < 2) return 'sandDark';
      }
    });
    m.disc(0, 0, 5.5, 17, 21, 'marbleWhite');
    onion(m, 0, 0, 21, 7.5, 15, 'marbleWhite');
    for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) m.disc(x, z, 1.5, 17, 20, 'marbleWhite'), dome(m, x, z, 20, 2, 'marbleWhite');
    for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) {
      m.disc(x, z, 1.5, 3, 30, 'marbleWhite');
      for (const y of [12, 20, 27]) m.disc(x, z, 2.2, y, y + 1, 'stone');
      dome(m, x, z, 30, 1.8, 'marbleWhite');
      m.disc(x, z, 0.75, 32, 34, 'gold');
    }
  }),
  // Borobudur: square terraces (their corners stepped in), round terraces ringed with little bell stupas, the great stupa on top.
  make('w_borobudur', (m) => {
    let y = 0;
    for (const h of [15, 13, 11, 9]) {
      m.box([-h + 2, y, -h], [h - 2, y + 3, h], 'stoneDark').box([-h, y, -h + 2], [h, y + 3, h - 2], 'stoneDark');
      m.box([-h + 2, y + 2, -h], [h - 2, y + 3, h], 'greyDark').box([-h, y + 2, -h + 2], [h, y + 3, h - 2], 'greyDark');
      // Stairs up the middle of each side.
      m.box([-1, 0, -h - 1], [1, y + 3, h + 1], 'stone').box([-h - 1, 0, -1], [h + 1, y + 3, 1], 'stone');
      y += 3;
    }
    for (const [r, rr, n] of [[8, 7, 16], [6.5, 5.5, 12], [5, 4, 8]]) {
      m.disc(0, 0, r, y, y + 2, 'stoneDark');
      y += 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + 0.2;
        const [x, z] = [Math.round(Math.cos(a) * rr), Math.round(Math.sin(a) * rr)];
        m.box([x - 1, y, z - 1], [x + 1, y + 2, z + 1], 'stone').set(x, y + 2, z, 'stone');
      }
    }
    dome(m, 0, 0, y, 3.5, 'stone');
    m.disc(0, 0, 1, y + 3, y + 7, 'stone');
  }),
  // Angkor Wat: across its moat on a causeway, three galleried terraces and five lotus-bud towers, the middle one the tallest.
  make('w_angkor_wat', (m) => {
    m.box([-16, 0, -16], [16, 1, 16], 'water');
    m.box([-13, 0, -13], [13, 4, 13], 'stoneDark').box([-13, 4, -13], [13, 5, 13], 'greyDark');
    m.box([-2, 0, 13], [2, 2, 16], 'stone').box([-3, 4, 11], [3, 8, 13], 'stoneDark');
    hip(m, -3, 3, 11, 14, 8, 2, 'greyDark');
    m.box([-10, 5, -10], [10, 9, 10], 'stone').box([-10, 9, -10], [10, 10, 10], 'stoneDark');
    m.box([-7, 10, -7], [7, 14, 7], 'stone');
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) bud(m, x, z, 14, 2, 12, 'stone', 'stoneDark');
    bud(m, 0, 0, 14, 3, 20, 'stone', 'stoneDark');
    for (let x = -12; x < 13; x += 3) m.box([x, 4, 12], [x + 1, 5, 13], 'black');
  }),
  // Machu Picchu: grass terraces stepping down the ridge, little stone houses thatched on top, the peak of Huayna Picchu behind.
  make('w_machu_picchu', (m) => {
    for (let t = 0; t < 6; t++) {
      const [x0, x1, z1, y1] = [-15 + t, 15 - t, 15 - t * 3, 2 + t * 2];
      m.box([x0, 0, -15], [x1, y1, z1], 'green');
      m.box([x0, 0, z1 - 1], [x1, y1 - 1, z1], 'stone').box([x0, 0, -15], [x0 + 1, y1 - 1, z1], 'stone').box([x1 - 1, 0, -15], [x1, y1 - 1, z1], 'stone');
    }
    for (let j = 0; j < 26; j++) {
      const r = 6 * (1 - j / 26) ** 0.7 + 0.5;
      for (let k = Math.floor(-9 - r); k <= Math.ceil(-9 + r); k++)
        for (let i = Math.floor(-6 - r); i <= Math.ceil(-6 + r); i++)
          if ((i + 6.5) ** 2 + (k + 9.5) ** 2 <= r * r) m.set(i, 12 + j, k, j > 18 || (i * 3 + j * 5 + k * 7) % 3 === 0 ? 'stoneDark' : 'green');
    }
    for (const [x, z] of [[3, -3], [8, -3], [3, -10], [8, -10], [-3, -1]]) {
      m.box([x - 2, 12, z - 2], [x + 2, 15, z + 2], 'stone').box([x - 1, 12, z + 2], [x, 14, z + 3], 'black');
      for (let j = 0; j < 3; j++) m.box([x - 3 + j, 15 + j, z - 2], [x + 3 - j, 16 + j, z + 2], 'straw');
    }
  }),
  // The Great Library of Alexandria: a sandstone hall, its wall of scrolls in their pigeonholes behind a portico, an obelisk either side.
  make('w_great_library', (m) => {
    m.box([-15, 0, -11], [15, 2, 13], 'sandDark').box([-14, 2, -10], [14, 4, 11], 'sand');
    m.box([-13, 4, -10], [13, 18, 6], 'sand');
    m.vox.paint('m', [-12, 5, 5], [12, 17, 6], (i, j) => (j % 3 === 1 || i % 3 === 0 ? 'woodDark' : (i + j) % 2 ? 'cloth' : 'leather'));
    for (const x of [-13, -8, 6, 11]) m.box([x, 4, 9], [x + 2, 18, 11], 'sand');
    m.box([-14, 18, -11], [14, 20, 11], 'sand').box([-14, 19, 10], [14, 20, 11], 'sandDark');
    for (let j = 0; j < 7; j++) m.box([-14 + j * 2, 20 + j, -11], [14 - j * 2, 21 + j, 11], 'sandDark');
    for (const x of [-16, 14]) m.box([x, 0, 13], [x + 2, 14, 15], 'sandDark').box([x, 14, 13], [x + 2, 15, 15], 'gold');
  }),
  // The Forbidden Palace: the Hall of Supreme Harmony, red under a double golden roof, its corners turned up, on three white terraces.
  make('w_forbidden_palace', (m) => {
    [[15, 12], [13, 10], [11, 8]].forEach(([x, z], t) => m.box([-x, t * 2, -z], [x, t * 2 + 2, z], 'marbleWhite').box([-x, t * 2 + 1, -z], [x, t * 2 + 2, z], 'stone'));
    for (let s = 0; s < 6; s++) m.box([-3, 0, 8], [3, s + 1, 14 - s], 'stone');
    m.box([-9, 6, -6], [9, 14, 5], 'red');
    m.vox.paint('m', [-8, 7, 4], [8, 13, 5], (i, j) => ((i + j) % 2 ? 'gold' : 'redDark'));
    for (let x = -9; x < 10; x += 3) m.box([x, 6, 5], [x + 1, 14, 6], 'red');
    m.box([-9, 13, -6], [9, 14, 6], 'teal');
    eaves(m, -9, 9, -6, 6, 14, 1, 'gold');
    m.box([-7, 16, -4], [7, 19, 4], 'red').box([-7, 18, -4], [7, 19, 4], 'teal');
    eaves(m, -8, 8, -5, 5, 19, 6, 'gold');
    for (const x of [-4, 3]) m.box([x, 26, -1], [x + 1, 28, 1], 'roofDark');
  }),
  // The Uffizi: two long arcaded wings round a narrow court, joined at the river end, the battlemented tower of the Palazzo Vecchio behind.
  make('w_uffizi', (m) => {
    m.box([-16, 0, -16], [16, 1, 16], 'stoneDark');
    m.box([-14, 1, -12], [-6, 15, 14], 'sand').box([6, 1, -12], [14, 15, 14], 'sand').box([-14, 1, -12], [14, 15, -6], 'sand');
    // The loggia along the court: hollowed under the wings, columns along its front.
    cut(m, [-8, 1, -8], [-6, 5, 14]);
    cut(m, [6, 1, -8], [8, 5, 14]);
    cut(m, [-6, 1, -8], [6, 5, -6]);
    for (let z = -8; z < 14; z += 3) m.box([-7, 1, z], [-6, 5, z + 1], 'stone').box([6, 1, z], [7, 5, z + 1], 'stone');
    for (let x = -5; x < 6; x += 3) m.box([x, 1, -7], [x + 1, 5, -6], 'stone');
    m.vox.paint('m', [-14, 6, -12], [14, 14, 14], (i, j, k) => {
      if (j % 4 > 1) return;
      const face = i === -14 || i === 13 || i === -7 || i === 6 || k === 13 || k === -7;
      return face && (i + k) % 2 === 0 && m.vox.get('m', i, j, k) ? 'woodDark' : undefined;
    });
    hip(m, -15, -5, -13, 15, 15, 2, 'roof');
    hip(m, 5, 15, -13, 15, 15, 2, 'roof');
    hip(m, -15, 15, -13, -5, 15, 2, 'roof');
    m.box([-16, 1, -16], [-11, 28, -11], 'sand').box([-17, 28, -17], [-10, 30, -10], 'sand');
    for (let i = 0; i < 7; i += 2) for (const [x, z] of [[-17 + i, -17], [-17 + i, -11], [-17, -17 + i], [-11, -17 + i]]) m.set(x, 30, z, 'sand');
    m.box([-15, 30, -15], [-12, 36, -12], 'sand').box([-15, 32, -12], [-12, 34, -11], 'black');
    m.box([-15, 22, -11], [-12, 25, -10], 'white');
    m.disc(-13.5, -13.5, 2, 36, 37, 'roof');
    m.box([-14, 37, -14], [-13, 41, -13], 'bronze');
  }),
  // The Louvre: palace wings round a court under slate mansard roofs, the glass pyramid in the middle with pools beside it.
  make('w_louvre', (m) => {
    m.box([-16, 0, -16], [16, 1, 16], 'stone');
    for (const [lo, hi] of [[[-15, -15], [15, -9]], [[-15, -15], [-9, 8]], [[9, -15], [15, 8]]]) {
      m.box([lo[0], 1, lo[1]], [hi[0], 11, hi[1]], 'sand');
      m.box([lo[0], 11, lo[1]], [hi[0], 12, hi[1]], 'slate');
      hip(m, lo[0] + 1, hi[0] - 1, lo[1] + 1, hi[1] - 1, 12, 2, 'slate');
    }
    m.vox.paint('m', [-15, 3, -15], [15, 10, 8], (i, j, k) => ((j === 4 || j === 5 || j === 8) && (i + k) % 3 === 0 && m.vox.get('m', i, j, k) === 'sand' ? 'slate' : undefined));
    for (const [x, z] of [[-3, -15], [-15, 3], [9, 3]]) m.box([x, 1, z], [x + 6, 14, z + 6], 'sand'), hip(m, x, x + 6, z, z + 6, 14, 3, 'slate');
    // The pyramid: glass, its four edges of steel.
    for (let j = 0; j < 8; j++) {
      const h = 8 - j;
      m.box([-h, 1 + j, 2 - h], [h, 2 + j, 2 + h], 'glass');
      for (const [x, z] of [[-h, 2 - h], [h - 1, 2 - h], [-h, 1 + h], [h - 1, 1 + h]]) m.set(x, 1 + j, z, 'steel');
    }
    for (const x of [-8, 4]) m.box([x, 1, 11], [x + 4, 2, 15], 'water');
  }),
  // The Sistine Chapel: a tall plain brick hall, high arched windows, battlements and a low roof, the conclave's chimney sending up white smoke.
  make('w_sistine_chapel', (m) => {
    m.box([-8, 0, -15], [8, 1, 14], 'stone');
    m.box([-7, 1, -14], [7, 22, 13], 'mud').box([-8, 21, -15], [8, 22, 14], 'stone');
    for (let z = -12; z < 12; z += 4) for (const x of [-7, 6]) m.box([x, 13, z], [x + 1, 19, z + 2], 'slate');
    for (let x = -5; x < 5; x += 4) m.box([x, 13, 12], [x + 2, 19, 13], 'slate');
    for (let z = -15; z < 14; z += 2) for (const x of [-8, 7]) m.set(x, 22, z, 'mud');
    for (let x = -8; x < 8; x += 2) for (const z of [-15, 13]) m.set(x, 22, z, 'mud');
    hip(m, -6, 6, -13, 12, 22, 3, 'roof');
    m.box([2, 22, -6], [3, 30, -5], 'greyDark');
    for (const [x, z, r, y] of [[2.5, -5.5, 1.2, 31], [3.5, -6.5, 1.8, 33], [5, -7.5, 2.2, 36]]) m.disc(x, z, r, y, y + 2, 'white');
  }),
  // The Leaning Tower of Pisa: a round white tower of six arcaded galleries and its bell chamber, leaning over on its lawn.
  make('w_leaning_tower', (m) => {
    m.disc(0, 0, 9, 0, 1, 'green');
    for (let y = 1; y < 46; y++) {
      const x = Math.round((y - 1) * 0.14);
      if (y < 9) m.disc(x, 0, 5, y, y + 1, y % 4 === 0 ? 'stone' : 'marbleWhite');
      else if (y < 39 && (y - 9) % 5 === 0) m.disc(x, 0, 5.5, y, y + 1, 'marbleWhite');
      else if (y < 39) m.disc(x, 0, 3.6, y, y + 1, 'stoneDark'), ring(m, x, 0, 5, 12, y, y + 1, 'marbleWhite');
      else if (y < 45) m.disc(x, 0, 2.6, y, y + 1, 'stoneDark'), ring(m, x, 0, 3.5, 8, y, y + 1, 'marbleWhite');
      else m.disc(x, 0, 3.8, y, y + 1, 'marbleWhite');
    }
  }),
  // Himeji Castle, the White Heron: on its sloping stone base, a white keep of tier on tier of grey roofs and gables, a lesser keep beside it.
  make('w_himeji_castle', (m) => {
    [0, 0, 1, 1, 2, 3, 4].forEach((d, j) => m.box([-14 + d, j, -10 + d], [14 - d, j + 1, 10 - d], j % 2 ? 'stoneDark' : 'stone'));
    const keep = (cx, cz, tiers, y) => {
      tiers.forEach(([hx, hz, h], t) => {
        m.box([cx - hx, y, cz - hz], [cx + hx, y + h, cz + hz], 'marbleWhite');
        for (let x = cx - hx + 1; x < cx + hx; x += 3) m.set(x, y + h - 2, cz + hz - 1, 'black');
        const last = t === tiers.length - 1;
        eaves(m, cx - hx, cx + hx, cz - hz, cz + hz, y + h, last ? 4 : 1, 'slate');
        // A gable on the front of every other roof.
        if (t % 2 === 0 && !last)
          for (let j = 0; j < 4; j++) {
            m.box([cx - 3 + j, y + h + 1 + j, cz + hz], [cx + 3 - j, y + h + 2 + j, cz + hz + 2], j === 3 ? 'slate' : 'marbleWhite');
            m.box([cx - 4 + j, y + h + 1 + j, cz + hz], [cx - 3 + j, y + h + 2 + j, cz + hz + 2], 'slate').box([cx + 3 - j, y + h + 1 + j, cz + hz], [cx + 4 - j, y + h + 2 + j, cz + hz + 2], 'slate');
          }
        y += h + 2;
      });
      return y;
    };
    keep(-4, 1, [[8, 6, 6], [7, 5, 5], [6, 4, 5], [5, 3, 4], [4, 2, 4]], 7);
    keep(9, -4, [[3, 3, 5], [2, 2, 4]], 7);
    // The golden fish (shachi) at the ends of the topmost ridge.
    const cells = [...m.vox.parts.get('m').keys()].map(cellOf);
    const top = Math.max(...cells.map(([, j]) => j));
    const ridge = cells.filter(([, j]) => j === top);
    for (const [i, j, k] of ridge) if (!m.vox.get('m', i - 1, j, k) || !m.vox.get('m', i + 1, j, k)) m.set(i, j + 1, k, 'gold');
  }),
  // Broadway: a theatre's marquee in lights under its tall sign, billboards on the buildings round it, a yellow cab in the street.
  make('w_broadway', (m) => {
    m.box([-15, 0, -12], [15, 1, 12], 'greyDark').box([-15, 1, 9], [15, 2, 12], 'concrete');
    for (const [x0, x1, h, c] of [[-15, -6, 30, 'brick'], [-6, 5, 22, 'stone'], [5, 15, 38, 'concrete']]) {
      m.box([x0, 1, -12], [x1, h, -3], c);
      m.vox.paint('m', [x0, 2, -12], [x1, h - 1, -2], (i, j, k) => ((i - x0) % 2 === 1 && j % 3 === 1 && (k === -4 || i === x1 - 1) && m.vox.get('m', i, j, k) ? 'glass' : undefined));
    }
    m.box([-14, 17, -3], [-7, 26, -2], 'feather3').box([-13, 19, -2], [-8, 24, -1], 'white');
    m.box([-5, 14, -3], [4, 20, -2], 'gold').box([6, 26, -3], [14, 34, -2], 'feather2').box([15, 8, -11], [16, 20, -4], 'jade');
    m.box([-10, 1, -3], [10, 12, 5], 'redDark').box([-10, 12, -3], [10, 13, 5], 'gold');
    for (const x of [-7, -4, 2, 5]) m.box([x, 1, 5], [x + 2, 6, 6], 'gold');
    // The marquee, bulbs round its edges.
    m.box([-11, 7, 5], [11, 10, 9], 'black').box([-10, 8, 9], [10, 9, 10], 'white');
    for (let x = -11; x < 11; x++) if (x % 2 === 0) m.set(x, 9, 9, 'fire').set(x, 7, 9, 'fire');
    m.box([-1, 10, 5], [1, 28, 7], 'neon');
    for (let y = 11; y < 28; y += 2) m.set(-1, y, 7, 'fire').set(0, y, 7, 'fire');
    m.box([4, 2, 9], [12, 4, 12], 'gold').box([6, 4, 9], [10, 6, 12], 'gold').box([6, 4, 11], [10, 5, 12], 'glass');
    for (const x of [5, 10]) m.box([x, 1, 8], [x + 2, 2, 9], 'black').box([x, 1, 12], [x + 2, 2, 13], 'black');
  }),
  // The CN Tower: a slender concrete shaft on three fins, the round pod with its glass band, the SkyPod and the mast to its red tip.
  make('w_cn_tower', (m) => {
    m.box([-11, 0, -11], [11, 2, 11], 'concrete');
    m.disc(0, 0, 2.6, 2, 40, 'concrete');
    for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6])
      for (let d = 2; d < 10; d++) {
        const [x, z] = [Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)];
        m.box([x - 1, 2, z - 1], [x + 1, 2 + Math.round(24 * (1 - d / 10) ** 1.5), z + 1], 'concrete');
      }
    m.disc(0, 0, 4.5, 26, 27, 'concrete').disc(0, 0, 6.5, 27, 29, 'concrete').disc(0, 0, 6.5, 29, 31, 'glass').disc(0, 0, 5.5, 31, 32, 'concrete').disc(0, 0, 3.5, 32, 33, 'white');
    m.disc(0, 0, 3.5, 38, 40, 'glass').disc(0, 0, 3, 40, 41, 'concrete');
    m.disc(0, 0, 1, 41, 53, 'grey').disc(0, 0, 1, 53, 55, 'red');
  }),
  // Petra: the Treasury carved out of rose-red rock: two storeys of columns, a pediment and a round tholos between broken pediments.
  make('w_petra', (m) => {
    for (let x = -16; x < 16; x++) {
      const h = 34 + ((x * 7) % 5 + 5) % 5 + (Math.abs(x) > 11 ? 4 : 0);
      m.box([x, 0, -6], [x + 1, h, 2], 'roseDark');
      if (Math.abs(x) > 11) m.box([x, 0, 2], [x + 1, h - 2 - (Math.abs(x) % 3), 6 + (x & 1)], 'roseDark');
    }
    m.box([-16, 0, 2], [16, 1, 14], 'sand');
    m.box([-11, 0, 2], [11, 32, 3], 'rose');
    m.box([-1, 2, 2], [1, 8, 3], 'black');
    for (const x of [-10, -7, -4, 2, 5, 8]) m.box([x, 1, 3], [x + 2, 14, 5], 'roseLight');
    m.box([-11, 1, 3], [11, 2, 6], 'roseLight').box([-11, 14, 3], [11, 16, 5], 'roseLight');
    for (let j = 0; j < 3; j++) m.box([-5 + j * 2, 16 + j, 3], [5 - j * 2, 17 + j, 5], 'roseLight');
    // Upstairs: the tholos between two half pediments, each on its columns.
    for (const x of [-10, -7, 5, 8]) m.box([x, 19, 3], [x + 2, 28, 5], 'roseLight');
    m.box([-10, 28, 3], [-5, 29, 5], 'roseLight').box([5, 28, 3], [10, 29, 5], 'roseLight');
    m.box([-10, 29, 3], [-7, 30, 5], 'roseLight').box([7, 29, 3], [10, 30, 5], 'roseLight');
    m.disc(0, 4, 3, 19, 29, 'roseLight');
    m.disc(0, 4, 3.5, 29, 30, 'roseLight').disc(0, 4, 2.5, 30, 31, 'roseLight').disc(0, 4, 1, 31, 34, 'roseLight');
  }),
  // The United Nations: the Secretariat's tall slab, glass on its broad faces, beside the low General Assembly with its dome, a row of flags before them.
  make('w_united_nations', (m) => {
    m.box([-16, 0, -12], [16, 1, 13], 'concrete');
    m.box([-11, 1, -8], [1, 46, -2], 'marbleWhite');
    m.vox.paint('m', [-10, 1, -8], [0, 46, -2], (i, j, k) => (k === -8 || k === -3 ? (j % 3 === 0 ? 'greyDark' : 'copper') : undefined));
    m.box([-11, 46, -8], [1, 47, -2], 'concrete');
    m.box([3, 1, -9], [15, 7, 5], 'marbleWhite').box([5, 7, -9], [13, 8, 5], 'marbleWhite').box([3, 7, -9], [5, 10, 5], 'marbleWhite').box([13, 7, -9], [15, 10, 5], 'marbleWhite');
    m.box([4, 2, 5], [14, 6, 6], 'glass');
    dome(m, 9, -2, 8, 3, 'concrete');
    const flags = ['red', 'blue', 'green', 'gold', 'white', 'feather2', 'jade', 'orange', 'purple', 'feather3', 'crimson'];
    for (let i = 0; i < 11; i++) {
      const x = -16 + i * 3;
      m.box([x, 1, 10], [x + 1, 10, 11], 'grey').box([x + 1, 7, 10], [x + 3, 10, 11], flags[i]);
    }
  }),
  // The Pentagon: five rings of offices round a five-sided court, light wells between them, a single flat face toward the front.
  make('w_pentagon', (m) => {
    // How far a cell is out from the middle, measured square to the nearest of the five sides.
    const out = (x, z) => {
      const s = (Math.PI * 2) / 5;
      const a = ((((Math.atan2(x, z) + s / 2) % s) + s) % s) - s / 2;
      return Math.hypot(x, z) * Math.cos(a);
    };
    m.vox.paint('m', [-16, 0, -16], [16, 8, 16], (i, j, k) => {
      const d = out(i + 0.5, k + 0.5);
      if (d > 15) return;
      if (j === 0) return d < 4.5 ? 'green' : 'concrete';
      const h = d < 4.5 ? 0 : d < 6.5 ? 6 : d < 7.5 ? 2 : d < 9.5 ? 6 : d < 10.5 ? 2 : d < 14.5 ? 7 : 1;
      if (j < h) return j < h - 1 ? 'concrete' : h > 2 ? 'grey' : 'slate';
    });
    m.disc(0, 0, 1.5, 1, 3, 'woodDark');
  }),
  // The Great Firewall: a server farm behind a great wall of glowing grid, battlemented like the old
  // Great Wall: rows of dark racks stepping up toward it, their lights blinking green, blue and amber,
  // cables trunking across their tops to the wall, and satellite dishes on masts to the right.
  make('w_great_firewall', (m) => {
    m.box([-16, 0, -14], [16, 1, 14], 'concrete');
    // The wall, along the back and the left: dark panels ruled in glowing grid, merlons on top.
    const wall = (lo, hi, along) => {
      m.vox.paint('m', lo, hi, (i, j, k) => {
        const u = along === 'x' ? i : k;
        if (j >= 21) return ((u + 16) >> 1) % 2 === 0 ? 'greyDark' : undefined;
        if (j === 20 || j === 1) return 'greyDark';
        return (u + 16) % 4 === 0 || j % 4 === 0 ? 'grid' : 'rack';
      });
    };
    wall([-16, 1, -14], [16, 23, -12], 'x');
    wall([-16, 1, -12], [-14, 23, 10], 'z');
    for (const x of [-16, 14]) m.box([x, 1, -14], [x + 2, 25, -12], 'greyDark');
    m.box([-16, 1, 8], [-14, 25, 10], 'greyDark');
    // Three rows of racks, taller toward the wall, each cabinet's face dotted with lights.
    const lights = ['led', 'led', 'ledBlue', 'led', 'ledAmber', 'ledBlue'];
    for (const [z0, h] of [[-10, 17], [-3, 13], [4, 9]]) {
      m.box([-12, 1, z0], [8, h, z0 + 3], 'rack');
      m.box([-12, h, z0], [8, h + 1, z0 + 3], 'greyDark');
      m.vox.paint('m', [-12, 2, z0 + 3], [8, h - 1, z0 + 4], (i, j) => {
        const c = (i + 12) % 4;
        if (c === 3) return 'black';
        if (j % 2 === 1 && c !== 0) {
          const n = ((i * 73856093) ^ (j * 19349663) ^ (z0 * 83492791)) >>> 0;
          return n % 5 < 3 ? lights[n % lights.length] : undefined;
        }
      });
      // A cable tray on top, its bundle running back to the wall.
      m.box([-9, h + 1, z0 + 1], [-7, h + 2, z0 + 2], 'black').box([3, h + 1, z0 + 1], [5, h + 2, z0 + 2], 'ledBlue');
    }
    for (const [x, c] of [[-8, 'black'], [4, 'sash']]) {
      m.box([x, 14, -7], [x + 1, 15, -3], c).box([x, 18, -12], [x + 1, 19, -7], c);
      m.box([x, 10, 0], [x + 1, 11, 4], c);
    }
    // The dishes on their masts: bowls tipped up toward the viewer, a feed on an arm at each focus.
    const dish = (x, z, y, r) => {
      m.box([Math.floor(x), 1, Math.floor(z)], [Math.floor(x) + 1, y, Math.floor(z) + 1], 'grey');
      const n = [0.62, 0.55, 0.56];
      const f = r * 0.9;
      const R = Math.ceil(r) + 1;
      m.vox.paint('m', [Math.floor(x) - R, y - R, Math.floor(z) - R], [Math.floor(x) + R + 1, y + R + 1, Math.floor(z) + R + 1], (i, j, k) => {
        const p = [i + 0.5 - x, j + 0.5 - y, k + 0.5 - z];
        const t = p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
        const d = Math.hypot(p[0] - t * n[0], p[1] - t * n[1], p[2] - t * n[2]);
        if (d > r) return;
        const s = (d * d) / (4 * f);
        if (t >= s - 0.6 && t <= s + 0.6) return d > r - 1 ? 'grey' : 'white';
      });
      for (let q = 1; q <= Math.round(f); q++) m.set(Math.floor(x + n[0] * q), Math.floor(y + n[1] * q), Math.floor(z + n[2] * q), q === Math.round(f) ? 'red' : 'grey');
    };
    dish(11.5, -8.5, 13, 5.5);
    dish(12.5, 6.5, 6, 3.6);
    m.box([8, 1, -9], [11, 2, -8], 'black').box([8, 1, 5], [12, 2, 6], 'black').box([9, 1, -8], [10, 2, 5], 'sash');
    // A mast on the wall's corner, its light red.
    m.box([-16, 25, -14], [-15, 30, -13], 'grey').set(-16, 30, -14, 'neon');
  }),
  // The Kremlin: red battlemented walls and towers under green spires, a white cathedral of golden domes and the tall bell tower inside; St Basil's bright domes on Red Square in front.
  make('w_kremlin', (m) => {
    m.box([-16, 0, -15], [16, 1, 2], 'green').box([-16, 0, 2], [16, 1, 15], 'greyDark');
    for (const [lo, hi] of [[[-15, -14], [15, -12]], [[-15, 0], [15, 2]], [[-15, -14], [-13, 2]], [[13, -14], [15, 2]]]) {
      m.box([lo[0], 1, lo[1]], [hi[0], 8, hi[1]], 'red');
      for (let x = lo[0]; x < hi[0]; x++) for (let z = lo[1]; z < hi[1]; z++) if ((x + z) % 2 === 0) m.set(x, 8, z, 'red');
    }
    for (const [x, z] of [[-14, -13], [14, -13], [-14, 1], [14, 1]]) {
      m.box([x - 2, 1, z - 2], [x + 2, 12, z + 2], 'red');
      hip(m, x - 2, x + 2, z - 2, z + 2, 12, 2, 'green');
      m.box([x, 14, z], [x + 1, 17, z + 1], 'green');
    }
    // The Spasskaya tower over the gate, its clock, its spire with a red star.
    m.box([-7, 1, -1], [-1, 16, 4], 'red').box([-7, 10, -1], [-1, 11, 4], 'white');
    m.box([-6, 11, 4], [-2, 15, 5], 'white').box([-4, 12, 5], [-3, 14, 6], 'black');
    m.box([-6, 16, 0], [-2, 21, 3], 'red').box([-6, 20, 0], [-2, 21, 3], 'white');
    hip(m, -6, -2, 0, 3, 21, 2, 'green');
    m.box([-5, 23, 1], [-3, 28, 2], 'green').box([-5, 28, 1], [-3, 31, 2], 'red').box([-6, 29, 1], [-2, 30, 2], 'red');
    m.box([-5, 1, 3], [-3, 7, 4], 'black');
    // The cathedral, the bell tower of Ivan the Great, the yellow palace.
    m.box([-12, 1, -10], [-3, 10, -4], 'marbleWhite');
    onion(m, -7.5, -7, 10, 2.6, 6, 'gold');
    for (const [x, z] of [[-10.5, -9], [-4.5, -9], [-10.5, -5], [-4.5, -5]]) m.disc(x, z, 1.2, 10, 12, 'marbleWhite'), onion(m, x, z, 12, 1.6, 4, 'gold');
    for (const [r, y0, y1] of [[2.6, 1, 14], [2.1, 14, 23], [1.6, 23, 29]]) m.disc(0, -8, r, y0, y1, 'marbleWhite');
    onion(m, 0, -8, 29, 2.2, 6, 'gold');
    m.box([3, 1, -12], [12, 9, -4], 'sand').box([3, 4, -4], [12, 5, -3], 'white');
    hip(m, 3, 12, -12, -4, 9, 2, 'green');
    // St Basil's: its red walls, its central tent spire and four striped onion domes.
    m.box([5, 1, 4], [15, 6, 13], 'red').box([5, 5, 4], [15, 6, 13], 'white');
    m.disc(10, 8.5, 2.5, 6, 16, 'red');
    for (let j = 0; j < 7; j++) m.disc(10, 8.5, 2.5 - j * 0.33, 16 + j, 17 + j, j % 2 ? 'gold' : 'green');
    onion(m, 10, 8.5, 23, 1.2, 3, 'gold');
    for (const [x, z, c, c2] of [[6.5, 5, 'red', 'green'], [13.5, 5, 'feather3', 'white'], [6.5, 12, 'gold', 'green'], [13.5, 12, 'jade', 'gold']]) {
      m.disc(x, z, 1.4, 6, 10, 'red');
      onion(m, x, z, 10, 2.2, 6, c, c2);
    }
  }),
];
