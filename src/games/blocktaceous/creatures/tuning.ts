import { SPECIES, SPECIES_IDS, type Species, type SpeciesId } from '../species';

/**
 * What the creatures' rules derive from the species table: reach and timing of attacks, senses,
 * what a carcass yields, how hard a tame is. Pure data, so the mounts' shared physics (def.ts) and
 * the screens can read it too.
 */

export type SaddleId = 'saddle_small' | 'saddle_medium' | 'saddle_large' | 'saddle_giant';
/** How a species is won over: fed by hand while it's calm, or knocked out first and fed while it's down. */
export type TameMethod = 'hand' | 'knockout';

export interface Tuning {
  /** A giant: its attacks are slow and telegraphed, its steps shake the ground. */
  big: boolean;
  /** One of the island's rare top predators or giants. */
  apex: boolean;
  /** How far its bite or gore reaches from its middle, and the wind-up and rest of each attack (seconds). */
  reach: number;
  windup: number;
  cooldown: number;
  /** How far it notices threats or prey (blocks). */
  sense: number;
  /** What its carcass yields. */
  drops: [item: string, count: number][];
  /** Experience for killing it (and a share of it for taming it). */
  xp: number;
  method: TameMethod;
  /** Daze it takes to knock it out, and trust a single feeding earns (of 100). */
  dazeMax: number;
  trustPerFeed: number;
  /** Seconds between feedings it will accept. */
  feedEvery: number;
  /** Whether a bola can bring it down. */
  bolaable: boolean;
  /** The saddle it wears, if it can be ridden. */
  saddle: SaddleId | null;
  /** How often it turns up, relative to the rest of its biome. */
  weight: number;
  /** Mounts: how quickly it turns (radians a second) and gathers speed (blocks a second squared), and how high it jumps. */
  turn: number;
  accel: number;
  jump: number;
  /** Its voice (a sound the client defines) and the pitch it speaks at. */
  voice: string;
  pitch: number;
}

const KERATIN: Partial<Record<SpeciesId, number>> = { triceratops: 8, stegosaurus: 8, ankylosaurus: 12, carnotaurus: 4, sarcosuchus: 6, mammoth: 10, smilodon: 3, tyrannosaurus: 6, spinosaurus: 6, utahraptor: 2 };
const FEATHERS: Partial<Record<SpeciesId, number>> = { dodo: 4, compsognathus: 2, utahraptor: 6 };
const VOICES: Partial<Record<SpeciesId, [string, number]>> = {
  dodo: ['bt_squawk', 1],
  compsognathus: ['bt_chirp', 1.3],
  dilophosaurus: ['bt_hiss', 1.1],
  parasaurolophus: ['bt_honk', 1],
  triceratops: ['bt_bellow', 1],
  stegosaurus: ['bt_bellow', 0.8],
  ankylosaurus: ['bt_bellow', 0.9],
  utahraptor: ['bt_screech', 0.8],
  carnotaurus: ['bt_roar', 1.25],
  pteranodon: ['bt_screech', 1.25],
  brachiosaurus: ['bt_honk', 0.45],
  tyrannosaurus: ['bt_roar', 0.8],
  spinosaurus: ['bt_roar', 0.95],
  sarcosuchus: ['bt_hiss', 0.6],
  mammoth: ['bt_trumpet', 1],
  smilodon: ['bt_growl', 1],
};

function saddleFor(s: Species): SaddleId | null {
  if (!s.rideable) return null;
  if (s.health < 100) return 'saddle_small';
  if (s.health < 200) return 'saddle_medium';
  if (s.health < 450) return 'saddle_large';
  return 'saddle_giant';
}

function tune(id: SpeciesId): Tuning {
  const s: Species = SPECIES[id];
  const big = s.length >= 7;
  const drops: [string, number][] = [];
  const fishy = s.diet === 'piscivore';
  drops.push([fishy && s.health < 100 ? 'raw_fish' : 'raw_meat', Math.max(1, Math.ceil(s.health / 22))]);
  if (s.health >= 140) drops.push(['prime_meat', Math.ceil(s.health / 140)]);
  if (id !== 'dodo' && id !== 'compsognathus') drops.push(['hide', Math.max(1, Math.ceil(s.length * 1.5))]);
  if (KERATIN[id]) drops.push(['keratin', KERATIN[id]!]);
  if (FEATHERS[id]) drops.push(['feather', FEATHERS[id]!]);
  if (fishy && s.health >= 100) drops.push(['raw_fish', 4]);
  if (id === 'dodo') drops.push(['egg', 1]);
  const [voice, pitch] = VOICES[id] ?? ['bt_bellow', 1];
  return {
    big,
    apex: s.tameTier >= 8,
    reach: s.hitbox.width / 2 + 1.1 + s.length * 0.14,
    windup: big ? 0.45 + s.length * 0.03 : 0.25,
    cooldown: 1.1 + s.length * 0.07,
    sense: s.temper === 'aggressive' ? 18 + s.length * 0.8 : 9 + s.hitbox.width * 1.5,
    drops,
    xp: Math.round(4 + s.health / 6 + s.damage),
    method: s.temper === 'docile' || s.temper === 'skittish' ? 'hand' : 'knockout',
    dazeMax: Math.round(20 + s.health * 0.5),
    trustPerFeed: 100 / (2 + s.tameTier * 1.2),
    feedEvery: 1.5 + s.tameTier * 0.5,
    bolaable: s.hitbox.width <= 1.8 && s.health <= 120,
    saddle: saddleFor(s),
    weight: (s.herd >= 3 ? 3 : 2) / (1 + s.tameTier * 0.45),
    turn: 3.4 / (1 + s.length / 7),
    accel: 14 / (1 + s.length / 6),
    jump: s.locomotion === 'quadruped' && big ? 0.9 : 1.6,
    voice,
    pitch,
  };
}

export const TUNING = Object.fromEntries(SPECIES_IDS.map((id) => [id, tune(id)])) as Record<SpeciesId, Tuning>;

/** A tame's strength at a level: each level past the first adds this share to its bite and its toughness. */
export const LEVEL_GAIN = 0.08;
export const levelBonus = (level: number): number => 1 + (level - 1) * LEVEL_GAIN;
/** Experience a tame needs to go from `level` to the next. */
export const xpForLevel = (level: number): number => Math.round(20 * level ** 1.5);
export const MAX_TAME_LEVEL = 30;
