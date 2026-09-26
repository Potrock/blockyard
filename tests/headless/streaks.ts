import type { Player, Vec3 } from '../../src/platform';
import { CHOPPER, chopperView, MISSILE, turn, type ChopperState, type MissileState } from '../../src/games/callofblocky/streaks/flight';
import { math } from '../../src/platform';
import { check, launch } from './_harness';

type Fighter = { player: Player; streaks: string[]; streak: number; kills: number };
type Cob = {
  match: { fighters: Map<string, Fighter>; mode: { id: string }; map: { spawns: Vec3[]; hotspots: Vec3[]; floorY: number; bounds: { min: Vec3; max: Vec3 } } };
  streaks: { earn(f: Fighter, id: string): void; shot(by: Player, weapon: string, from: Vec3, dir: Vec3): void; flying(p: Player): boolean };
};

const DT = 1 / 30;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Call of Blocky's killstreaks you steer (`streaks/`): the local player calls in a Hellstorm with
 * 4 (not their lethal), steers it down onto a bot standing in the open while their body stays put
 * and frozen, and gets the kill; then flies an attack chopper, works its gun onto another bot and
 * gets that kill; then the chopper is shot down (shots at it, as a gun reports them). Last, a bot
 * earns a Hellstorm, calls it in and flies it onto the player.
 */
export default function streaks() {
  const h = launch('callofblocky', { seed: 11, radius: 5 });
  const g = h.ctx;
  const cob = (globalThis as unknown as { __cob: Cob }).__cob;
  const me = h.me.api;
  // (Read afresh each time: it comes and goes.)
  const vehicle = () => me.vehicle;
  check(cob.match.mode.id === 'ffa', `a free-for-all to start with, got ${cob.match.mode.id}`);
  h.run(1, { pilot: () => ({}) });
  // Everyone else stands still, weapons down (they're the targets), unless they're flying a streak.
  const hold = () => {
    for (const b of g.bots.all) if (b.alive && !cob.streaks.flying(b)) b.freeze(true, { weapons: true });
  };
  hold();
  const deaths: { victim: Player; by: unknown; weapon?: string }[] = [];
  g.events.on('playerDeath', (e) => deaths.push({ victim: e.player, by: e.source, weapon: e.weapon }));
  const mine = cob.match.fighters.get(me.id)!;

  // Somewhere in the open (sky overhead, and in plain sight of `sky`), well away from `from`.
  const open = (from: Vec3, sky?: Vec3) =>
    [...cob.match.map.hotspots, ...cob.match.map.spawns].find(
      (p) => Math.hypot(p.x - from.x, p.z - from.z) > 14 && !g.world.raycast({ x: p.x, y: p.y + 1.5, z: p.z }, { x: 0, y: 1, z: 0 }, 50) && (!sky || g.world.lineOfSight(sky, { x: p.x, y: p.y + 1, z: p.z })),
    )!;
  // Where a Hellstorm called in by someone at `p` comes from (`Streaks.callIn`): high over their side of the map.
  const missileFrom = (p: Vec3) => {
    const b = cob.match.map.bounds;
    const cx = (b.min.x + b.max.x) / 2;
    const cz = (b.min.z + b.max.z) / 2;
    const l = Math.hypot(p.x - cx, p.z - cz) || 1;
    return { x: cx + ((p.x - cx) / l) * 40, y: cob.match.map.floorY + 74, z: cz + ((p.z - cz) / l) * 40 };
  };
  const chest = (p: Player) => ({ x: p.position.x, y: p.position.y + 0.9, z: p.position.z });

  // ---- The Hellstorm ----
  const target = g.bots.all[0];
  const spot = open(me.position, missileFrom(me.position));
  check(spot, 'somewhere in the open for the target');
  target.teleport({ x: spot.x, y: spot.y + 0.05, z: spot.z });
  h.step(DT, {});
  cob.streaks.earn(mine, 'hellstorm');
  const slot = me.inventory.selected;
  h.step(DT, { pressed: ['Digit4'] });
  check(vehicle()?.name === 'hellstorm' && vehicle()!.remote, `4 calls in the Hellstorm, steered from afar (vehicle ${vehicle()?.name})`);
  check(me.inventory.selected === slot, `4 didn't also pick the lethal (slot ${me.inventory.selected})`);
  check(mine.streaks.length === 0, 'the streak is used');
  const body = { ...me.position };
  let t = 0;
  let boosted = false;
  while (vehicle() && t < 16) {
    const s = vehicle()!.state as MissileState;
    const c = chest(target);
    const to = { x: c.x - s.x, y: c.y - s.y, z: c.z - s.z };
    const dy = turn(s.yaw, Math.atan2(-to.x, -to.z));
    const dp = Math.atan2(to.y, Math.hypot(to.x, to.z)) - s.pitch;
    const k = s.boost ? MISSILE.steerBoosted : MISSILE.steer;
    const boost = !s.boost && t > 1 && Math.abs(dy) < 0.04 && Math.abs(dp) < 0.04;
    boosted ||= boost;
    h.step(DT, { mouseX: clamp(-dy / k, -80, 80), mouseY: clamp(-dp / k, -80, 80), clicked: boost ? 1 : 0, buttons: boost ? 1 : 0 });
    t += DT;
    hold();
  }
  const moved = Math.hypot(me.position.x - body.x, me.position.y - body.y, me.position.z - body.z);
  check(!vehicle(), `the Hellstorm went off (still flying after ${t.toFixed(1)} s)`);
  check(moved < 0.05, `the pilot's body stayed where it stood (moved ${moved.toFixed(2)})`);
  check(boosted, 'the Hellstorm boosted');
  const hs = deaths.find((d) => d.weapon === 'hellstorm');
  check(hs && hs.by === me && hs.victim === target, `the Hellstorm killed the target, the pilot's kill (${deaths.map((d) => `${d.victim.name} by ${d.weapon}`).join(', ')})`);
  check(!me.frozen, 'the pilot is back on their feet');
  const hsTime = t;

  // ---- The attack chopper ----
  h.run(0.5, { pilot: () => ({}) });
  hold();
  const prey = g.bots.all.find((b) => b.alive && b !== target)!;
  const spot2 = open(me.position);
  prey.teleport({ x: spot2.x, y: spot2.y + 0.05, z: spot2.z });
  cob.streaks.earn(mine, 'chopper');
  h.step(DT, { pressed: ['Digit4'] });
  check(vehicle()?.name === 'chopper' && vehicle()!.remote, `4 calls in the chopper (vehicle ${vehicle()?.name})`);
  const c0 = { ...(vehicle()!.state as ChopperState) };
  h.run(1, { pilot: () => ({ down: ['KeyW'] }) });
  const c1 = vehicle()!.state as ChopperState;
  const flew = Math.hypot(c1.x - c0.x, c1.z - c0.z);
  check(flew > 4, `W flies the chopper (${flew.toFixed(1)} blocks in a second)`);
  const view = { at: new math.Vector3(), dir: new math.Vector3() };
  t = 0;
  let fired = 0;
  while (vehicle() && prey.alive && t < 14) {
    const s = vehicle()!.state as ChopperState;
    chopperView(s, view);
    const c = chest(prey);
    const to = { x: c.x - view.at.x, y: c.y - view.at.y, z: c.z - view.at.z };
    const dy = turn(s.yaw, Math.atan2(-to.x, -to.z));
    const dp = Math.atan2(to.y, Math.hypot(to.x, to.z)) - s.pitch;
    const on = Math.abs(dy) < 0.02 && Math.abs(dp) < 0.02;
    fired = s.shots;
    // (Toward it while it's far, holding off once near.)
    const far = Math.hypot(c.x - s.x, c.z - s.z) > 24;
    h.step(DT, { mouseX: clamp(-dy / CHOPPER.aim, -60, 60), mouseY: clamp(-dp / CHOPPER.aim, -60, 60), buttons: on ? 1 : 0, down: far ? ['KeyW'] : [] });
    t += DT;
    hold();
  }
  const ch = deaths.find((d) => d.weapon === 'chopper');
  check(ch && ch.by === me && ch.victim === prey, `the chopper's gun killed the bot (${fired} rounds; deaths ${deaths.map((d) => `${d.victim.name} by ${d.weapon}`).join(', ')})`);
  check(vehicle()?.name === 'chopper', 'the chopper is still up');
  const chTime = t;

  // Shot down: hits from below, as a gun reports them.
  const shooter = g.bots.all.find((b) => b.alive && b !== prey)!;
  let hits = 0;
  while (vehicle() && hits < 60) {
    const s = vehicle()!.state as ChopperState;
    const from = { x: s.x + 3, y: s.y - 12, z: s.z + 5 };
    const d = new math.Vector3(s.x - from.x, s.y - from.y, s.z - from.z).normalize();
    cob.streaks.shot(shooter, 'sniper', from, { x: d.x, y: d.y, z: d.z });
    hits++;
    h.step(DT, {});
  }
  check(!vehicle(), `the chopper went down (after ${hits} sniper hits)`);
  const downs = h.find('hud', 'feed').filter((c) => JSON.stringify(c.args).includes(' shot down '));
  check(downs.length === 1, 'the feed says who shot it down');
  check(!me.frozen, 'the pilot is back on their feet after the chopper');

  // ---- A bot's Hellstorm ----
  const pilotBotAt = () => g.bots.all.find((b) => b.alive)!.position;
  const spot3 = open(target.position, missileFrom(pilotBotAt()));
  const pilotBot = g.bots.all.find((b) => b.alive)!;
  me.teleport({ x: spot3.x, y: spot3.y + 0.05, z: spot3.z });
  cob.streaks.earn(cob.match.fighters.get(pilotBot.id)!, 'hellstorm');
  let calledIn = false;
  const botRun = h.run(24, {
    pilot: () => ({}),
    until: () => {
      calledIn ||= cob.streaks.flying(pilotBot);
      hold();
      return deaths.some((d) => d.weapon === 'hellstorm' && d.by === pilotBot);
    },
  });
  const bk = deaths.find((d) => d.weapon === 'hellstorm' && d.by === pilotBot);
  check(calledIn, `the bot called its Hellstorm in`);
  check(bk, `the bot's Hellstorm got someone (${deaths.map((d) => `${d.victim.name} by ${d.weapon}`).join(', ')})`);
  console.log(`  Hellstorm onto ${target.name} in ${hsTime.toFixed(1)} s · chopper on ${prey.name} in ${chTime.toFixed(1)} s (${fired} rounds) · shot down in ${hits} sniper hits · ${pilotBot.name}'s Hellstorm got ${bk.victim.name} ${botRun.toFixed(1)} s after it was earned`);
}
