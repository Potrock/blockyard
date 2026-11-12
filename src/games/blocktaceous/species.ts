/**
 * The island's animals: real prehistoric species, each with the numbers every part reads. The
 * models (tools/, models/<id>.glb) are built to `length` and `height`; the rules (creatures/) read
 * the rest. Sizes are in blocks (a block is a metre) and close to the fossils'.
 */
export type Diet = 'herbivore' | 'carnivore' | 'piscivore' | 'scavenger';
export type Temper = 'skittish' | 'docile' | 'territorial' | 'aggressive';
export type Locomotion = 'biped' | 'quadruped' | 'flyer' | 'swimmer';
export type BiomeId = 'ocean' | 'beach' | 'grassland' | 'jungle' | 'redwood' | 'swamp' | 'badlands' | 'mountain' | 'snow' | 'volcano' | 'river';

export interface Species {
  name: string;
  /** Nose to tail, and to the top of the back or head at rest. */
  length: number;
  height: number;
  /** What bodies and shots collide with. */
  hitbox: { width: number; height: number };
  diet: Diet;
  temper: Temper;
  locomotion: Locomotion;
  health: number;
  /** A bite, a gore or a tail swing, in health. */
  damage: number;
  /** Walking and running, in blocks a second. */
  walk: number;
  run: number;
  /** Where it lives. */
  biomes: BiomeId[];
  /** Whether it can be ridden once tamed (and needs a saddle). */
  rideable: boolean;
  /** How hard it is to tame, 1 (a dodo) to 10 (a tyrannosaur). */
  tameTier: number;
  /** What it likes best while being tamed (an item id). */
  favorite: string;
  /** Lives in groups of about this many. */
  herd: number;
}

export const SPECIES = {
  dodo: { name: 'Dodo', length: 1, height: 0.9, hitbox: { width: 0.7, height: 0.9 }, diet: 'herbivore', temper: 'docile', locomotion: 'biped', health: 12, damage: 1, walk: 1.2, run: 3, biomes: ['beach', 'grassland'], rideable: false, tameTier: 1, favorite: 'berries', herd: 4 },
  compsognathus: { name: 'Compsognathus', length: 1.1, height: 0.5, hitbox: { width: 0.5, height: 0.6 }, diet: 'scavenger', temper: 'skittish', locomotion: 'biped', health: 8, damage: 1.5, walk: 2, run: 6.5, biomes: ['beach', 'jungle', 'grassland'], rideable: false, tameTier: 1, favorite: 'raw_meat', herd: 5 },
  dilophosaurus: { name: 'Dilophosaurus', length: 6, height: 2.2, hitbox: { width: 1.1, height: 2.2 }, diet: 'carnivore', temper: 'aggressive', locomotion: 'biped', health: 40, damage: 4, walk: 2.4, run: 7, biomes: ['jungle', 'swamp', 'beach'], rideable: false, tameTier: 2, favorite: 'raw_meat', herd: 2 },
  parasaurolophus: { name: 'Parasaurolophus', length: 9.5, height: 3.8, hitbox: { width: 1.8, height: 3.4 }, diet: 'herbivore', temper: 'skittish', locomotion: 'biped', health: 70, damage: 3, walk: 2.6, run: 9, biomes: ['beach', 'grassland', 'jungle'], rideable: true, tameTier: 2, favorite: 'berries', herd: 4 },
  triceratops: { name: 'Triceratops', length: 8.5, height: 3, hitbox: { width: 2.4, height: 2.9 }, diet: 'herbivore', temper: 'territorial', locomotion: 'quadruped', health: 140, damage: 9, walk: 2, run: 7, biomes: ['grassland', 'beach', 'redwood'], rideable: true, tameTier: 4, favorite: 'berries', herd: 3 },
  stegosaurus: { name: 'Stegosaurus', length: 9, height: 4, hitbox: { width: 2.4, height: 3.2 }, diet: 'herbivore', temper: 'territorial', locomotion: 'quadruped', health: 160, damage: 10, walk: 1.6, run: 5, biomes: ['grassland', 'jungle', 'redwood'], rideable: true, tameTier: 4, favorite: 'berries', herd: 2 },
  ankylosaurus: { name: 'Ankylosaurus', length: 7, height: 1.8, hitbox: { width: 2.4, height: 1.8 }, diet: 'herbivore', temper: 'territorial', locomotion: 'quadruped', health: 170, damage: 9, walk: 1.5, run: 4.5, biomes: ['badlands', 'mountain', 'grassland'], rideable: true, tameTier: 5, favorite: 'berries', herd: 1 },
  utahraptor: { name: 'Utahraptor', length: 6, height: 1.9, hitbox: { width: 1, height: 1.9 }, diet: 'carnivore', temper: 'aggressive', locomotion: 'biped', health: 55, damage: 6, walk: 3, run: 11, biomes: ['jungle', 'grassland', 'redwood', 'badlands'], rideable: true, tameTier: 4, favorite: 'raw_meat', herd: 3 },
  carnotaurus: { name: 'Carnotaurus', length: 8, height: 3, hitbox: { width: 1.6, height: 2.9 }, diet: 'carnivore', temper: 'aggressive', locomotion: 'biped', health: 110, damage: 11, walk: 3, run: 10, biomes: ['badlands', 'grassland', 'jungle'], rideable: true, tameTier: 6, favorite: 'raw_meat', herd: 1 },
  pteranodon: { name: 'Pteranodon', length: 2.6, height: 1.8, hitbox: { width: 1.4, height: 1.6 }, diet: 'piscivore', temper: 'skittish', locomotion: 'flyer', health: 45, damage: 4, walk: 1.5, run: 12, biomes: ['beach', 'mountain', 'grassland'], rideable: true, tameTier: 4, favorite: 'raw_fish', herd: 2 },
  brachiosaurus: { name: 'Brachiosaurus', length: 24, height: 12, hitbox: { width: 4.5, height: 6.5 }, diet: 'herbivore', temper: 'docile', locomotion: 'quadruped', health: 600, damage: 22, walk: 2, run: 4.5, biomes: ['redwood', 'grassland', 'jungle'], rideable: true, tameTier: 8, favorite: 'berries', herd: 2 },
  tyrannosaurus: { name: 'Tyrannosaurus', length: 12.5, height: 4.2, hitbox: { width: 2.6, height: 4.4 }, diet: 'carnivore', temper: 'aggressive', locomotion: 'biped', health: 420, damage: 26, walk: 2.8, run: 8.5, biomes: ['redwood', 'mountain', 'badlands', 'volcano'], rideable: true, tameTier: 10, favorite: 'prime_meat', herd: 1 },
  spinosaurus: { name: 'Spinosaurus', length: 14, height: 5.2, hitbox: { width: 2.6, height: 4.6 }, diet: 'piscivore', temper: 'aggressive', locomotion: 'biped', health: 380, damage: 22, walk: 2.6, run: 8, biomes: ['swamp', 'river'], rideable: true, tameTier: 9, favorite: 'raw_fish', herd: 1 },
  sarcosuchus: { name: 'Sarcosuchus', length: 10, height: 1.4, hitbox: { width: 2, height: 1.3 }, diet: 'carnivore', temper: 'aggressive', locomotion: 'quadruped', health: 150, damage: 13, walk: 1.6, run: 5, biomes: ['swamp', 'river', 'beach'], rideable: true, tameTier: 6, favorite: 'raw_meat', herd: 1 },
  mammoth: { name: 'Woolly Mammoth', length: 5.5, height: 3.6, hitbox: { width: 2.4, height: 3.4 }, diet: 'herbivore', temper: 'territorial', locomotion: 'quadruped', health: 260, damage: 15, walk: 2, run: 6.5, biomes: ['snow', 'mountain'], rideable: true, tameTier: 7, favorite: 'berries', herd: 4 },
  smilodon: { name: 'Smilodon', length: 2.2, height: 1.2, hitbox: { width: 0.9, height: 1.2 }, diet: 'carnivore', temper: 'aggressive', locomotion: 'quadruped', health: 70, damage: 8, walk: 2.6, run: 10.5, biomes: ['snow', 'mountain', 'redwood'], rideable: true, tameTier: 5, favorite: 'raw_meat', herd: 2 },
} satisfies Record<string, Species>;

export type SpeciesId = keyof typeof SPECIES;
export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
