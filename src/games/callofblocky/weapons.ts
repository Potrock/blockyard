import { HeldModels, type GameContext, type GunItem, type ItemDefinition, type MeleeItem } from '@platform';
import { GUNS } from './models';

/**
 * The arsenal. Everyone carries a primary of their choosing, the Lucky 45 and the Hattori
 * katana. Numbers are tuned for 100 health: most guns kill in three to five body shots, heads
 * take fewer, the katana and the Honey Bunny (up close) in one.
 */

const url = (id: string) => GUNS.find((g) => g.id === id)?.url ?? '';

/** How a gun sits and shows: its model, its side-on icon (kill feed), and a gun's hold. */
const looks = (id: string): Pick<GunItem, 'icon' | 'hold'> => ({
  icon: { gltf: url(id) },
  hold: { style: 'gun', model: HeldModels.gltf(url(id)) },
});

export const WEAPONS: Record<string, ItemDefinition> = {
  rifle: {
    kind: 'gun',
    name: 'Big Kahuna',
    ...looks('rifle'),
    auto: true,
    rpm: 640,
    damage: [30, 22],
    falloff: [22, 48],
    headshot: 1.5,
    magazine: 30,
    reserve: 120,
    reload: 2.1,
    spread: { hip: 2.2, aim: 0.12, move: 1.3, air: 3, bloom: 0.22 },
    recoil: { up: 0.85, side: 0.35, recover: 0.7 },
    aim: { zoom: 1.35, time: 0.22, move: 0.62, sight: 'iron' },
    mobility: 0.95,
    sounds: { use: 'shot_rifle', reload: 'reload_mag' },
  } satisfies GunItem,
  smg: {
    kind: 'gun',
    name: 'Mac-10',
    ...looks('smg'),
    auto: true,
    rpm: 950,
    damage: [24, 14],
    falloff: [10, 26],
    headshot: 1.4,
    magazine: 32,
    reserve: 160,
    reload: 1.7,
    spread: { hip: 2.6, aim: 0.55, move: 0.8, air: 2.4, bloom: 0.18 },
    recoil: { up: 0.5, side: 0.5, recover: 0.8 },
    aim: { zoom: 1.2, time: 0.15, move: 0.8, sight: 'iron' },
    mobility: 1.08,
    tracer: '#ff9ec8',
    sounds: { use: 'shot_smg', reload: 'reload_mag' },
  } satisfies GunItem,
  shotgun: {
    kind: 'gun',
    name: "Zed's Pump",
    ...looks('shotgun'),
    rpm: 72,
    pellets: 9,
    damage: [15, 4],
    falloff: [6, 18],
    headshot: 1.2,
    magazine: 6,
    reserve: 30,
    reload: 0.48,
    shells: true,
    range: 45,
    spread: { hip: 5.2, aim: 4.2, move: 0.8, air: 1, bloom: 0 },
    recoil: { up: 3.5, side: 1, recover: 0.8 },
    aim: { zoom: 1.15, time: 0.18, move: 0.75, sight: 'iron' },
    action: 'pump',
    tracer: '#ffb36b',
    sounds: { use: 'shot_shotgun', reload: 'reload_shell', cycle: 'pump' },
  } satisfies GunItem,
  sniper: {
    kind: 'gun',
    name: 'Honey Bunny',
    ...looks('sniper'),
    rpm: 46,
    damage: [110, 90],
    falloff: [60, 120],
    headshot: 2,
    magazine: 5,
    reserve: 25,
    reload: 2.6,
    range: 250,
    spread: { hip: 7, aim: 0, move: 5, air: 8, bloom: 0 },
    recoil: { up: 4.5, side: 1, recover: 0.6 },
    aim: { zoom: 4, time: 0.32, move: 0.45, sight: 'scope' },
    action: 'bolt',
    mobility: 0.9,
    tracer: '#fff1a8',
    sounds: { use: 'shot_sniper', reload: 'reload_mag', cycle: 'bolt' },
  } satisfies GunItem,
  pistol: {
    kind: 'gun',
    name: 'Lucky 45',
    ...looks('pistol'),
    rpm: 420,
    damage: [38, 26],
    falloff: [15, 35],
    headshot: 1.6,
    magazine: 8,
    reserve: 48,
    reload: 1.4,
    spread: { hip: 1.8, aim: 0.3, move: 1, air: 2.5, bloom: 0.5 },
    recoil: { up: 1.4, side: 0.4, recover: 0.85 },
    aim: { zoom: 1.2, time: 0.14, move: 0.85, sight: 'iron' },
    mobility: 1.1,
    sounds: { use: 'shot_pistol', reload: 'reload_pistol' },
  } satisfies GunItem,
  katana: {
    kind: 'melee',
    name: 'Hattori Katana',
    icon: { gltf: url('katana') },
    hold: { style: 'sword', model: HeldModels.gltf(url('katana')) },
    damage: 101,
    cooldown: 0.65,
    reach: 3.6,
    knockback: 0.4,
    sounds: { use: 'katana', hit: 'katana_hit' },
  } satisfies MeleeItem,
};

/** The primaries on offer, in the order the loadout menu lists them. */
export const PRIMARIES = ['rifle', 'smg', 'shotgun', 'sniper'] as const;
export type Primary = (typeof PRIMARIES)[number];

/** One line about each, for the loadout menu. */
export const BLURBS: Record<Primary, string> = {
  rifle: 'Assault rifle · all-rounder',
  smg: 'SMG · fast and close',
  shotgun: 'Pump shotgun · one pump, one body',
  sniper: 'Bolt sniper · one shot, long street',
};

export function defineWeapons(game: GameContext) {
  for (const [id, def] of Object.entries(WEAPONS)) game.items.define(id, def);
}

/** The icon a weapon shows in the kill feed: side on. */
export const feedIcon = (id: string) => (WEAPONS[id] && url(id) ? { gltf: url(id), view: 'side' as const } : null);
