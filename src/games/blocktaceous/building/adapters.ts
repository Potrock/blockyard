import type { Player, Vec3 } from '@platform';
import * as bag from '../survival/bag';
import { toolFromId, type Tool, type ToolKind } from './harvest';

/**
 * Everything the building part asks of the survival part that wasn't in its first contract, each
 * behind one function here. Every one looks the export up by name when it's called, so the game
 * runs before the survival part has written it, and picks it up the moment it has. If a name or a
 * signature turns out different, this file is the only place to change.
 */
const survival = bag as unknown as Record<string, unknown>;

function exported<F extends (...args: never[]) => unknown>(...names: string[]): F | null {
  for (const name of names) if (typeof survival[name] === 'function') return survival[name] as F;
  return null;
}

/** `harvestTool(heldItemId)` in `survival/bag.ts`: `{ kind, tier }` (tier 0 hands, 1 stone, 2 metal). Without it: from the id's prefix and suffix. */
export function toolOf(item: string | null): Tool {
  const ask = exported<(item: string | null) => { kind?: ToolKind; tier?: number } | null>('harvestTool');
  const told = ask?.(item);
  if (told && told.kind) return { kind: told.kind, tier: told.tier ?? (told.kind === 'hand' ? 0 : 1) };
  return toolFromId(item);
}

/** `openContainer(player, containerId, slots, title?)`. False if the survival part has none (the caller says so on screen). */
export function openContainer(player: Player, containerId: string, slots: number): boolean {
  const open = exported<(player: Player, id: string, slots: number) => void>('openContainer');
  if (!open) return false;
  open(player, containerId, slots);
  return true;
}

/**
 * A storage box was taken down: `removeContainer(containerId, spillAt)` forgets it and drops what
 * it held at `spillAt` as pickups. False if the survival part has no such thing.
 */
export function spillContainer(containerId: string, spillAt: Vec3): boolean {
  const remove = exported<(id: string, spillAt?: Vec3) => void>('removeContainer');
  if (!remove) return false;
  remove(containerId, spillAt);
  return true;
}

/** `setBedSpawn(player, pos | null)`: `pos` is the bed block's own cell (null: their bed is gone). False if it doesn't exist. */
export function setBedSpawn(player: Player, pos: Vec3 | null): boolean {
  const set = exported<(player: Player, pos: Vec3 | null) => void>('setBedSpawn');
  if (!set) return false;
  set(player, pos);
  return true;
}

/** `bedOf(player)`: the cell of a survivor's bed, or null. */
export function bedOf(player: Player): Vec3 | null {
  return exported<(player: Player) => Vec3 | null>('bedOf')?.(player) ?? null;
}

/** `registerRecipes(list)`: the building recipes into the survival part's book (in `setup`). */
export function registerRecipes(list: readonly { item: string; count?: number; needs: Record<string, number>; level: number; station?: string }[]): boolean {
  const add = exported<(list: readonly unknown[]) => void>('registerRecipes');
  if (!add) return false;
  add(list);
  return true;
}

/**
 * The crafting screen of a station (`openStation` in `survival/bag.ts`, part of the first
 * contract). It goes through `calls` so a test can listen in.
 */
export const calls = {
  openStation: (player: Player, station: string): void => bag.openStation(player, station),
};
