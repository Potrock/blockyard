import { Blueprint, type GameContext, type Player, type PropModel } from '@platform';
import { SPECIES, SPECIES_IDS, type SpeciesId } from '../species';
import { freshMount, type MountState } from './def';
import { modelUrl } from './models';
import { gainXp, spawnTame, stow, tameDied } from './tames';
import { TUNING, levelBonus } from './tuning';
import { clock, flat, inPlay, itemName, near, ownerKey, rides, type Brain, type Ride } from './state';

/**
 * Riding. A saddled tame its owner mounts (E) becomes a vehicle (def.ts): the rider's own screen
 * predicts it, so it answers at once. While it's ridden the animal's entity is put away and a
 * model of it (a prop, kept at the vehicle's pose on every screen) carries the rider; getting
 * off (E or Shift) puts the animal back where the mount stands. What the mount's attacks hit is
 * decided here, on the server: the vehicle only counts them.
 */

const models = new Map<SpeciesId, PropModel>();
const scratch: Brain[] = [];

/**
 * A stand-in for a species whose model hasn't been built: a little block animal (legs, body,
 * neck, head and tail) facing +z, sized to the species.
 */
function blockAnimal(game: GameContext, id: SpeciesId): PropModel {
  const s = SPECIES[id];
  const hide = s.diet === 'herbivore' ? 'green_concrete' : s.diet === 'carnivore' ? 'red_concrete' : 'cyan_concrete';
  const bp = new Blueprint({ x: 0, y: 0, z: 0 }, { x: 5, y: 9, z: 12 });
  const four = s.locomotion === 'quadruped';
  for (const x of [1, 3]) {
    bp.fill({ x, y: 0, z: 4 }, { x, y: 3, z: 4 }, 'brown_concrete');
    if (four) bp.fill({ x, y: 0, z: 8 }, { x, y: 3, z: 8 }, 'brown_concrete');
  }
  bp.fill({ x: 1, y: 4, z: 3 }, { x: 3, y: 6, z: 9 }, hide);
  bp.fill({ x: 2, y: 5, z: 0 }, { x: 2, y: 5, z: 2 }, hide);
  bp.fill({ x: 2, y: 6, z: 10 }, { x: 2, y: four ? 6 : 7, z: 10 }, hide);
  bp.fill({ x: 1, y: four ? 6 : 7, z: 10 }, { x: 3, y: four ? 7 : 8, z: 11 }, hide);
  const top = four ? 8 : 9;
  return game.props.model(bp, { scale: s.height / top, pivot: { x: 2.5, y: 0, z: 6 } });
}

/** A species' model for a mount: its real one if it's been built, or the block stand-in. */
function mountModel(game: GameContext, id: SpeciesId): PropModel {
  let m = models.get(id);
  if (!m) {
    const url = modelUrl(id);
    models.set(id, (m = url ? game.props.gltf(url, { radius: SPECIES[id].length / 2, animation: 'idle' }) : blockAnimal(game, id)));
  }
  return m;
}

/** A room starts afresh: its props are gone, and so are the models made for them. */
export function resetRiding() {
  models.clear();
}

/** A player gets on their saddled tame. False (and a word on their screen) if they can't. */
export function mountUp(game: GameContext, player: Player, b: Brain): boolean {
  const rec = b.tame;
  if (!rec || rec.owner !== ownerKey(player) || player.vehicle || !inPlay(player)) return false;
  if (!b.s.rideable) return (player.hud.toast(`A ${b.s.name} can't be ridden`), false);
  if (!rec.saddled) return (player.hud.toast(`${rec.name} needs a ${itemName(game, b.t.saddle!)} first`), false);
  const p = b.e.position;
  const yaw = b.yaw;
  stow(rec);
  const prop = game.props.spawn(mountModel(game, rec.species), { position: p });
  const flyer = b.s.locomotion === 'flyer';
  player.drive<MountState>(flyer ? 'bt_wing' : 'bt_mount', freshMount(SPECIES_IDS.indexOf(rec.species), p, yaw), { prop });
  rides.set(player.id, { rec, prop, atk: 0, clip: 'idle', clipUntil: 0, ridden: 0 });
  player.hud.toast(flyer ? 'W flap · Space take off and climb · C dive · click bite · E get off (on the ground)' : 'WASD ride · Ctrl or F gallop · Space jump · click bite · E or Shift get off');
  game.audio.play('bt_saddle', { at: p });
  return true;
}

/** Off the mount: the animal is back in the world where the mount stood, its rider beside it. */
export function dismount(game: GameContext, player: Player, opts: { dead?: boolean } = {}) {
  const ride = rides.get(player.id);
  if (!ride) return;
  rides.delete(player.id);
  const s = player.vehicle?.state as MountState | undefined;
  if (player.vehicle) player.leaveVehicle();
  ride.prop.remove();
  player.hud.meter('bt_stamina', 'Stamina', null);
  const rec = ride.rec;
  if (s) [rec.x, rec.y, rec.z] = [s.x, s.y, s.z];
  if (opts.dead) return tameDied(game, rec);
  spawnTame(game, rec, s?.yaw ?? 0);
  if (!s || !player.alive) return;
  // The rider steps down beside it, where there's room; on its back if there's none.
  const sp = SPECIES[rec.species];
  const side = sp.hitbox.width / 2 + 0.9;
  for (const a of [Math.PI / 2, -Math.PI / 2, Math.PI, 0]) {
    const at = { x: s.x + Math.sin(s.yaw + a) * side, y: s.y + 0.1, z: s.z + Math.cos(s.yaw + a) * side };
    if (!game.world.fits(at) && !game.world.fits({ ...at, y: at.y + 1 })) continue;
    return player.teleport(game.world.fits(at) ? at : { ...at, y: at.y + 1 }, s.yaw + Math.PI);
  }
  player.teleport({ x: s.x, y: s.y + sp.hitbox.height + 0.2, z: s.z }, s.yaw + Math.PI);
}

/** A hit meant for a rider lands on the mount instead; a mount that dies throws them. */
export function hurtMount(game: GameContext, player: Player, ride: Ride, amount: number) {
  ride.rec.hp -= amount / levelBonus(ride.rec.level);
  ride.prop.flash('#ff5a4a', 0.25);
  game.audio.play('mob_hurt', { at: player.position, pitch: 0.7 });
  if (ride.rec.hp <= 0) dismount(game, player, { dead: true });
}

/** The mount's bite: everything wild in front of its head takes the species' damage (more at a higher level), in its rider's name. */
function bite(game: GameContext, player: Player, ride: Ride, s: MountState) {
  const sp = SPECIES[ride.rec.species];
  const t = TUNING[ride.rec.species];
  const reach = t.reach * 0.5 + sp.hitbox.width / 2;
  const at = { x: s.x + Math.sin(s.yaw) * reach, z: s.z + Math.cos(s.yaw) * reach };
  const radius = t.reach * 0.45 + 0.8;
  ride.clipUntil = clock.now + 0.7;
  game.audio.play('bt_bite', { at: { x: at.x, y: s.y + 1, z: at.z }, pitch: t.big ? 0.7 : 1.15 });
  for (const o of near(at, radius + 3, scratch)) {
    if (o.tame || Math.abs(o.e.position.y - s.y) > sp.hitbox.height + 2) continue;
    if (flat(o.e.position, at) > radius + o.s.hitbox.width / 2) continue;
    o.e.damage(sp.damage * levelBonus(ride.rec.level), { source: player, from: { x: s.x, y: s.y, z: s.z }, weapon: 'bt_mount', knockback: t.big ? 1.3 : 0.7, cause: 'melee' });
  }
}

/** Every step: each rider's mount as the rules see it (its record follows it, its attacks land, its model plays what it's doing), and getting off. */
export function updateRides(game: GameContext, dt: number) {
  for (const [pid, ride] of [...rides]) {
    const player = game.players.find((p) => p.id === pid);
    if (!player) {
      // Their rider is gone: the animal waits where it was left.
      rides.delete(pid);
      ride.prop.remove();
      spawnTame(game, ride.rec);
      continue;
    }
    if (!player.vehicle || !inPlay(player)) {
      dismount(game, player);
      continue;
    }
    const s = player.vehicle.state as MountState;
    const rec = ride.rec;
    const sp = SPECIES[rec.species];
    ride.ridden += Math.hypot(s.x - rec.x, s.z - rec.z);
    [rec.x, rec.y, rec.z] = [s.x, s.y, s.z];
    if (ride.ridden > 40) {
      ride.ridden = 0;
      gainXp(game, rec, 1);
    }
    rec.hp = Math.min(sp.health, rec.hp + sp.health * 0.004 * dt);
    if (s.atk !== ride.atk) {
      ride.atk = s.atk;
      bite(game, player, ride, s);
    }
    const pace = Math.abs(s.v);
    const clip = clock.now < ride.clipUntil ? 'attack' : s.fly ? (pace > sp.run * 0.8 || s.vy > 1 ? 'fly' : 'glide') : pace > sp.walk * 1.25 ? 'run' : pace > 0.25 ? 'walk' : 'idle';
    if (clip !== ride.clip) {
      ride.clip = clip;
      ride.prop.play(clip);
    }
    player.hud.meter('bt_stamina', 'Stamina', Math.round(s.stamina * 20) / 20, { color: s.winded ? '#ff8a5a' : '#9be26b' });
    if (player.input.pressed('KeyE') || player.input.pressed('ShiftLeft')) {
      player.input.consume('KeyE');
      if (s.fly) player.hud.toast('Land before you get off');
      else dismount(game, player);
    }
  }
}
