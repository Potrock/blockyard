import type { GameContext, Player, Vec3 } from '@platform';
import { addDaze, CLUB_DAZE } from './taming';
import { brains, clock, flat, near, type Brain } from './state';

/**
 * Where an animal visibly is. An entity's hitbox is one upright box round its middle, and these
 * animals are long: a raptor's head is three blocks ahead of its box. So a swing that misses the
 * box is tried again against the animal's body as it's drawn (a row of balls from tail to snout
 * along the way it faces), and a spear or a club connects with the head in front of you.
 */

const scratch: Brain[] = [];

/** Which way an animal faces (0 faces +z): at what it's fighting or warning, else the way it last walked. */
function facing(b: Brain): number {
  const t = b.target;
  if (t && (b.mode === 'hunt' || b.mode === 'warn')) {
    const [dx, dz] = [t.position.x - b.e.position.x, t.position.z - b.e.position.z];
    if (dx * dx + dz * dz > 0.01) return Math.atan2(dx, dz);
  }
  return b.yaw;
}

/** How far along a ray it first meets a ball; null if it doesn't. */
function raySphere(o: Vec3, d: Vec3, cx: number, cy: number, cz: number, r: number): number | null {
  const [ox, oy, oz] = [o.x - cx, o.y - cy, o.z - cz];
  const b = ox * d.x + oy * d.y + oz * d.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0 || b > 0) return null;
  return -b - Math.sqrt(disc);
}

/** The balls of one animal's body: [along its length (share of it, + is forward), height (share of its height), radius]. */
function balls(b: Brain): [number, number, number][] {
  const s = b.s;
  const r = Math.max(0.45, Math.min(s.hitbox.width * 0.5, s.height * 0.4));
  const tall = s.locomotion === 'biped' ? 0.72 : 0.6;
  return [
    [0.44, tall, r * 0.8],
    [0.32, tall * 0.95, r * 0.9],
    [0.2, 0.6, r],
    [-0.2, 0.55, r * 0.9],
    [-0.34, 0.5, r * 0.6],
  ];
}

/** The first animal whose drawn body a ray meets within `reach`, and how far along. */
export function bodyRay(eye: Vec3, dir: Vec3, reach: number): { b: Brain; distance: number } | null {
  let best: { b: Brain; distance: number } | null = null;
  for (const b of near(eye, reach + 14, scratch)) {
    if (!b.e.alive) continue;
    const p = b.e.position;
    const s = b.s;
    if (flat(p, eye) > reach + s.length * 0.5) continue;
    const yaw = facing(b);
    const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
    // Knocked out, it lies where it fell: lower.
    const h = s.height * (b.ko ? 0.5 : 1);
    for (const [along, up, r] of balls(b)) {
      const t = raySphere(eye, dir, p.x + fx * along * s.length, p.y + up * h, p.z + fz * along * s.length, r);
      if (t !== null && t <= reach && (!best || t < best.distance)) best = { b, distance: t };
    }
  }
  return best;
}

/** Each player's swing, kept in time with the melee kit's own (it swings when the button's down and its rest is over). */
const rest = new Map<string, number>();
type Swing = { kind?: string; damage?: number; cooldown?: number; reach?: number; knockback?: number };
const FIST: Swing = { damage: 1, cooldown: 0.3, reach: 3, knockback: 0.6 };

export function resetBody() {
  rest.clear();
}

/**
 * Every step, for a player on foot: when the melee kit swings and its own ray finds no hitbox,
 * the swing lands on the animal whose head, neck or tail it does pass through.
 */
export function swingAtBodies(game: GameContext, player: Player) {
  const held = player.inventory.held?.item;
  const def = held ? (game.items.get(held) as Swing | undefined) : FIST;
  if (!def || (held && def.kind !== 'melee')) return;
  if (!player.input.button(0) || clock.now < (rest.get(player.id) ?? 0)) return;
  rest.set(player.id, clock.now + (def.cooldown ?? 0.5) - 0.001);
  const reach = def.reach ?? 3.3;
  // The kit's own swing found a hitbox: it has dealt with it.
  if (game.entities.raycast(player.eye, player.look, reach, { margin: 0.25 })) return;
  const hit = bodyRay(player.eye, player.look, reach);
  if (!hit) return;
  const [e, l, d] = [player.eye, player.look, hit.distance];
  if (!game.world.lineOfSight(e, { x: e.x + l.x * d, y: e.y + l.y * d, z: e.z + l.z * d })) return;
  const crit = !player.onGround && player.velocity.y < -0.1;
  hit.b.e.damage((def.damage ?? 1) * (crit ? 1.5 : 1), { source: player, knockback: def.knockback ?? 1, crit, weapon: held ?? undefined, cause: 'melee' });
  player.audio.play(crit ? 'crit' : 'hit', { at: hit.b.e.position });
  player.fx.shake(0.025, 0.12);
}

/** The wooden club's swing: the hitbox first, then the body as it's drawn. */
export function clubHit(game: GameContext, player: Player, reach: number, damage: number): Brain | null {
  const eye = player.eye;
  const boxed = game.entities.raycast(eye, player.look, reach, { margin: 0.35 });
  const b = (boxed && brains.get(boxed.entity.id)) || bodyRay(eye, player.look, reach)?.b;
  if (!b) return null;
  if (b.e.damage(damage, { source: player, weapon: 'wooden_club', knockback: 0.3, cause: 'melee' })) addDaze(game, b, CLUB_DAZE, player);
  return b;
}
