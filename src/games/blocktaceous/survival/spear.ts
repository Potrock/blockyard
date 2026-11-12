import type { Entity, GameContext, Player, Vec3 } from '@platform';
import { STAMINA, type StaminaState } from './def';
import { iconSprite } from './icons';
import { touch, type Survivor } from './state';
import { wearDown } from './wear';

/**
 * A spear in hand can be thrown (the right mouse button): it flies where they look, falling as it
 * goes, hits hard, and lies where it lands to be picked up again. Where it will land is worked
 * out when it's thrown, the same way the platform flies it, so the spear on the ground is where
 * the one in the air came down.
 */

interface Throw {
  speed: number;
  gravity: number;
  damage: number;
  /** Breath it takes. */
  cost: number;
}

export const THROWN: Record<string, Throw> = {
  spear: { speed: 30, gravity: 16, damage: 11, cost: 10 },
  metal_spear: { speed: 34, gravity: 16, damage: 18, cost: 10 },
};

/** Seconds between throws. */
const THROW_EVERY = 0.7;

/** Spears in the air: each lands (as a pickup) at its time, unless it struck something first. */
interface Flying {
  item: string;
  by: string;
  struck: boolean;
}
const flying = new Set<Flying>();

export function forgetSpears(): void {
  flying.clear();
}

/** Where something thrown from `from` along `dir` comes down, and how long it takes (the platform's flight: gravity, a little drag). */
function landing(game: GameContext, from: Vec3, dir: Vec3, t: Throw): { at: Vec3; after: number } {
  const p = { ...from };
  const v = { x: dir.x * t.speed, y: dir.y * t.speed, z: dir.z * t.speed };
  const dt = 1 / 60;
  let time = 0;
  while (time < 5) {
    v.y -= t.gravity * dt;
    const drag = 1 - 0.05 * dt;
    v.x *= drag;
    v.y *= drag;
    v.z *= drag;
    const next = { x: p.x + v.x * dt, y: p.y + v.y * dt, z: p.z + v.z * dt };
    const id = game.world.getBlock(Math.floor(next.x), Math.floor(next.y), Math.floor(next.z));
    // Unloaded ground, or something solid: it stops short of it.
    if (id < 0 || (id > 0 && game.world.blockInfo(id)?.solid)) break;
    p.x = next.x;
    p.y = next.y;
    p.z = next.z;
    time += dt;
  }
  return { at: p, after: time };
}

/** Every step, for a living survivor: the right button throws the spear in their hand. */
export function stepSpear(game: GameContext, player: Player, s: Survivor, dt: number): void {
  s.throwIn = Math.max(0, s.throwIn - dt);
  const held = player.inventory.held;
  const t = held ? THROWN[held.item] : undefined;
  if (!held || !t || s.ui.open || player.vehicle || s.throwIn > 0 || !player.input.buttonPressed(2)) return;
  const st = player.abilities.stamina as StaminaState | undefined;
  if (st?.winded) {
    player.audio.play('bt_deny');
    return;
  }
  s.throwIn = THROW_EVERY;
  if (st) {
    st.s = Math.max(0, st.s - t.cost);
    st.rest = STAMINA.restDelay;
    if (st.s <= 0) st.winded = true;
  }
  const item = held.item;
  const dir = player.look;
  const from = { x: player.eye.x + dir.x * 0.5, y: player.eye.y - 0.1 + dir.y * 0.5, z: player.eye.z + dir.z * 0.5 };
  // A throw is hard on a spear: three uses, and one that breaks it leaves nothing to pick up.
  const whole = wearDown(player, s, item, 3);
  if (whole) player.inventory.take(item, 1);
  game.entities.projectile({ sprite: iconSprite(item), speed: t.speed, gravity: t.gravity, damage: t.damage, knockback: 1, sticky: false, weapon: `thrown:${item}` }, from, dir, player);
  player.audio.play('bt_throw');
  touch(s);
  if (!whole) return;
  const flight: Flying = { item, by: player.id, struck: false };
  flying.add(flight);
  const land = landing(game, from, dir, t);
  game.clock.after(land.after, () => {
    if (!flying.delete(flight) || flight.struck) return;
    game.items.spawnPickup(item, { x: land.at.x, y: land.at.y + 0.2, z: land.at.z }, { delay: 0.3, despawn: 600 });
  });
}

/** A thrown spear struck something (the `damage` event, by its `weapon`): it drops at the target's feet. */
export function spearStruck(game: GameContext, by: Player, weapon: string, target: Player | Entity): void {
  const item = weapon.slice('thrown:'.length);
  for (const flight of flying) {
    if (flight.by !== by.id || flight.item !== item || flight.struck) continue;
    flight.struck = true;
    flying.delete(flight);
    const p = target.position;
    game.items.spawnPickup(item, { x: p.x, y: p.y + 0.6, z: p.z }, { delay: 0.5, despawn: 600, velocity: { x: 0, y: 2.5, z: 0 } });
    return;
  }
}
