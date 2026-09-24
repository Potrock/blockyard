import type { Entity, GameContext, ItemStack, RayHit, Vec3 } from '@platform';

/** Who's building: the player, or a mob building through `Building.breakBlock` / `placeBlock`. */
export type Builder = Entity | 'player';

export interface BuildingOptions {
  /** May this block be broken? Default: anything but bedrock. */
  canBreak?(at: Vec3, block: string, by: Builder): boolean;
  /** May this block be placed here? Default: yes. */
  canPlace?(at: Vec3, block: string, by: Builder): boolean;
  /**
   * Seconds for the player to mine a block with what's in hand (0 = instant, Infinity = can't).
   * Default: `defaultBreakTime`, so tools are yours to add here.
   */
  breakTime?(block: string, held: ItemStack | null): number;
  /** The block an item places, if any. Default: items whose icon is a block place that block. */
  blockOf?(item: string): string | null;
  /** How far the player reaches, in blocks. Default 4.6. */
  reach?: number;
  /** Show mining progress as a ring round the crosshair too (besides the cracks). Default true. */
  ring?: boolean;
}

export interface Building {
  /** Call every frame from your game's `update`, before anything else reads the mouse. */
  update(dt: number): void;
  /** Break a block as `by`, if your rules allow it (for bots and scripted builders). */
  breakBlock(x: number, y: number, z: number, by: Builder): boolean;
  /** Place a block as `by`, if your rules allow it. */
  placeBlock(x: number, y: number, z: number, block: string, by: Builder): boolean;
  /** Whether `by` may break this block, by your rules. */
  canBreak(at: Vec3, block: string, by: Builder): boolean;
}

/**
 * Survival building, Minecraft style: hold left-click on a block to mine it (cracks grow over it,
 * the arm swings), right-click with a block item to place it against the face you're aiming at.
 * Aiming at a mob leaves the click to your weapons. Your rules decide what may be broken or
 * placed and how long mining takes.
 *
 * Built only on the public API (`world.raycast` / `highlight` / `breakBlock` / `placeBlock`,
 * `entities.raycast`, `input.consume`), so copy it into your game and change anything.
 */
export function building(game: GameContext, opts: BuildingOptions = {}): Building {
  const reach = opts.reach ?? 4.6;
  const ring = opts.ring ?? true;
  const { world, player, input } = game;

  const canBreak = (at: Vec3, block: string, by: Builder) => {
    const info = world.blockInfo(block);
    if (!info || block === 'bedrock' || info.liquid || block === 'air') return false;
    return opts.canBreak?.(at, block, by) ?? true;
  };
  const canPlace = (at: Vec3, block: string, by: Builder) => opts.canPlace?.(at, block, by) ?? true;
  const blockOf =
    opts.blockOf ??
    ((item: string) => {
      const icon = game.items.get(item)?.icon;
      return typeof icon === 'object' && 'block' in icon ? icon.block : null;
    });

  const breakBlock = (x: number, y: number, z: number, by: Builder) =>
    canBreak({ x, y, z }, world.blockName(world.getBlock(x, y, z)), by) && world.breakBlock(x, y, z, { by });
  const placeBlock = (x: number, y: number, z: number, block: string, by: Builder) =>
    canPlace({ x, y, z }, block, by) && world.placeBlock(x, y, z, block, { by });

  // Mining state: the block being mined and how far along (0..1).
  let key = '';
  let progress = 0;
  let swingT = 0;
  let placeT = 0;
  let ringShown = false;

  const swing = () => player.viewModel.play(player.inventory.held ? 'swing' : 'punch');

  return {
    breakBlock,
    placeBlock,
    canBreak,
    update(dt: number) {
      swingT -= dt;
      placeT = Math.max(0, placeT - dt);
      let hit: RayHit | null = null;
      if (player.alive) {
        // A mob in the crosshair (the ray stops at blocks, so it's in front) is for weapons.
        if (!game.entities.raycast(player.eye, player.look, reach)) hit = world.raycast(player.eye, player.look, reach);
      }
      const held = player.inventory.held;
      const places = held ? blockOf(held.item) : null;
      const canMine = !!hit && game.items.get(held?.item ?? '')?.kind !== 'bow';

      // Mining: progress builds while left-click is held on the same block.
      let mining = false;
      if (hit && canMine && input.button(0)) {
        const name = world.blockName(hit.block);
        const time = canBreak(hit, name, 'player') ? (opts.breakTime?.(name, held) ?? defaultBreakTime(name, world.blockInfo(name)?.plant ?? false)) : Infinity;
        // Unbreakable: leave the click alone (the weapon just swings at it).
        if (Number.isFinite(time)) {
          input.consume(0);
          mining = true;
          const k = `${hit.x},${hit.y},${hit.z}`;
          if (k !== key) {
            key = k;
            progress = 0;
          }
          progress += time <= 0 ? 1 : dt / time;
          if (swingT <= 0) {
            swingT = 0.25;
            swing();
          }
          if (progress >= 1) {
            breakBlock(hit.x, hit.y, hit.z, 'player');
            mining = false;
            // A short pause before the next block, like Minecraft.
            swingT = 0.15;
          }
        }
      }
      if (!mining) {
        key = '';
        progress = 0;
      }

      // Placing against the face we're aiming at (or into a plant's cell), repeating while held.
      const first = input.buttonPressed(2);
      if (hit && places && held && (first || (input.button(2) && placeT <= 0))) {
        input.consume(2);
        placeT = first ? 0.25 : 0.18;
        const into = world.blockInfo(hit.block)?.replaceable;
        const x = into ? hit.x : hit.x + hit.normal.x;
        const y = into ? hit.y : hit.y + hit.normal.y;
        const z = into ? hit.z : hit.z + hit.normal.z;
        if (placeBlock(x, y, z, places, 'player')) {
          player.inventory.take(held.item, 1);
          swing();
        }
      }

      world.highlight(hit && (canMine || places) ? hit : null, { progress: mining ? progress : 0 });
      if (ring && (mining || ringShown)) {
        game.hud.progress(mining ? progress : null);
        ringShown = mining;
      }
    },
  };
}

/** A Minecraft-like time (seconds, bare-handed-ish) to mine a block, by material. */
export function defaultBreakTime(block: string, plant = false): number {
  if (block === 'bedrock') return Infinity;
  if (plant) return 0;
  if (block.endsWith('_bed')) return 0.35;
  if (block.endsWith('_wool') || block.endsWith('_leaves') || block === 'glass' || block === 'glowstone' || block === 'sea_lantern') return 0.4;
  if (/^(dirt|sand|gravel|grass_block|snowy_grass|podzol|clay|snow_block)$/.test(block)) return 0.7;
  if (/(planks|_log|bookshelf)$/.test(block)) return 1.5;
  if (block === 'obsidian') return 12;
  if (block === 'end_stone') return 3;
  return 2.2;
}
