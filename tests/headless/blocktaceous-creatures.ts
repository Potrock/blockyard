import type { Entity, Player } from "../../src/platform/api/types";
import { check, launch } from "./_harness";
import type { MountState } from "../../src/games/blocktaceous/creatures/def";
import {
  LOCAL_MAX,
  WILD_MAX,
  census,
  spawnAnimal,
  wildCount,
} from "../../src/games/blocktaceous/creatures/population";
import {
  brains,
  loaded,
  newHerd,
  rides,
  tames,
  type Brain,
} from "../../src/games/blocktaceous/creatures/state";
import {
  adopt,
  saveTame,
  takeHaul,
} from "../../src/games/blocktaceous/creatures/tames";
import { haulCount } from "../../src/games/blocktaceous/creatures/gather";
import { give } from "../../src/games/blocktaceous/survival/bag";
import type { SpeciesId } from "../../src/games/blocktaceous/species";

/**
 * The creatures of Blocktaceous: they appear round a survivor within the budget; a predator
 * attacks and a nervous herbivore runs; a dodo is befriended by hand and a dilophosaur knocked
 * out and fed; both tames come back after the game restarts (through `game.store`); and a saddled
 * triceratops is mounted, ridden and got off again.
 */
export default function blocktaceousCreatures() {
  const h = launch("blocktaceous", { seed: 7, radius: 5 });
  const game = h.ctx;
  const me = (): Player => game.player;
  const flat = (a: { x: number; z: number }, b: { x: number; z: number }) =>
    Math.hypot(a.x - b.x, a.z - b.z);

  /** The controls that look at a spot from the survivor's eyes. */
  const aim = (at: { x: number; y: number; z: number }) => {
    const eye = me().eye;
    const [dx, dy, dz] = [at.x - eye.x, at.y - eye.y, at.z - eye.z];
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    };
  };
  const middle = (e: Entity, up = 0.5) => ({
    x: e.position.x,
    y: e.position.y + up,
    z: e.position.z,
  });
  /** Every wild animal gone, and no more coming: the stage for one scene. */
  const clearWild = () => {
    census.paused = true;
    for (const b of [...brains.values()]) {
      if (b.tame) continue;
      brains.delete(b.e.id);
      b.e.remove();
    }
  };
  /** One animal of a species on open ground about `d` blocks from the survivor. */
  const place = (id: SpeciesId, d: number): Brain => {
    const p = me().position;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const [x, z] = [p.x + Math.cos(a) * d, p.z + Math.sin(a) * d];
      const y = game.world.surfaceY(x, z);
      if (y < 0 || Math.abs(y + 1 - p.y) > 2.5) continue;
      const b = spawnAnimal(game, id, x, z, newHerd(x, z));
      if (b) return b;
    }
    const round = Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      const [x, z] = [p.x + Math.cos(a) * d, p.z + Math.sin(a) * d];
      const y = game.world.surfaceY(x, z);
      return `${y}:${game.world.blockName(game.world.getBlock(x, y, z))}`;
    });
    throw new Error(
      `nowhere to put a ${id} near the survivor at ${p.x.toFixed(0)}, ${p.y.toFixed(1)}, ${p.z.toFixed(0)} (round them: ${round.join(" ")})`,
    );
  };
  /** Put an item on the belt (its last slot) and in hand. */
  const hold = (item: string) => {
    me().inventory.set(8, { item, count: 1 });
    me().inventory.select(8);
  };
  let tick = 0;
  /** Walk up to an animal looking at it, pressing E twice a second (and holding the left button if `swing`). */
  const tend =
    (b: Brain, opts: { swing?: boolean; keep?: number } = {}) =>
    () => {
      tick++;
      const far =
        flat(me().position, b.e.position) >
        (opts.keep ?? 2.5) + b.s.hitbox.width / 2;
      return {
        ...aim(middle(b.e, b.s.hitbox.height * 0.5)),
        down: far ? ["KeyW"] : [],
        pressed: !opts.swing && tick % 30 === 0 ? ["KeyE"] : [],
        buttons: opts.swing ? 1 : 0,
        clicked: opts.swing && tick % 10 === 0 ? 1 : 0,
      };
    };

  // Somewhere open and fairly level to stand, wherever the island puts new survivors: dry ground with dry ground all round.
  h.run(1, { pilot: () => ({}) });
  const dry = (x: number, z: number): number | null => {
    const y = game.world.surfaceY(x, z);
    const top =
      y > game.world.seaLevel
        ? game.world.blockName(game.world.getBlock(x, y, z))
        : "water";
    return top === "water" || top.endsWith("_leaves") || top.endsWith("_log")
      ? null
      : y;
  };
  const openGround = () => {
    search: for (let r = 0; r < 60; r += 6) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const [x, z] = [
          Math.round(me().position.x + Math.cos(a) * r) + 0.5,
          Math.round(me().position.z + Math.sin(a) * r) + 0.5,
        ];
        const y = dry(x, z);
        if (y === null) continue;
        let level = 0;
        for (let k = 0; k < 8; k++) {
          const g = dry(
            x + Math.cos((k / 8) * Math.PI * 2) * 7,
            z + Math.sin((k / 8) * Math.PI * 2) * 7,
          );
          if (g !== null && Math.abs(g - y) <= 2) level++;
        }
        if (level < 7) continue;
        me().teleport({ x, y: y + 1.1, z });
        break search;
      }
    }
  };
  openGround();

  // ---- They appear round a survivor, out of reach, within the budget. ----
  h.run(14, { pilot: () => ({}) });
  check(me().alive, "the survivor died standing still among the animals");
  const wild = wildCount();
  check(wild >= 3, `only ${wild} wild animals appeared in 14 s`);
  check(
    wild <= WILD_MAX && wild <= LOCAL_MAX,
    `${wild} wild animals round one survivor is over the budget (${LOCAL_MAX})`,
  );
  for (const b of brains.values())
    check(
      game.entities.all(b.id).includes(b.e),
      "a brain without a living entity",
    );

  // ---- A predator attacks. ----
  clearWild();
  me().health = me().maxHealth;
  const raptor = place("utahraptor", 9);
  const before = me().health;
  h.run(15, {
    pilot: () => ({}),
    until: () => me().health < before || !me().alive,
  });
  check(
    me().health < before,
    `the utahraptor never bit (it is ${raptor.mode}, ${flat(raptor.e.position, me().position).toFixed(1)} blocks off)`,
  );

  // ---- A nervous herbivore runs from someone walking up to it. ----
  clearWild();
  if (!me().alive) me().revive();
  me().health = me().maxHealth;
  const para = place("parasaurolophus", 7);
  const was = flat(para.e.position, me().position);
  let fled = false;
  h.run(4, { pilot: () => ((fled ||= para.mode === "flee"), {}) });
  check(
    fled && flat(para.e.position, me().position) > was + 4,
    `the parasaurolophus didn't run (it is ${para.mode}, from ${was.toFixed(1)} to ${flat(para.e.position, me().position).toFixed(1)} blocks)`,
  );

  // ---- A dodo is befriended: berries by hand, again and again. ----
  clearWild();
  const dodo = place("dodo", 3);
  give(me(), "berries", 30);
  h.run(40, { pilot: tend(dodo), until: () => !!dodo.tame });
  check(dodo.tame, `the dodo wasn't tamed (trust ${dodo.trust.toFixed(0)}%)`);
  check(
    dodo.tame.order === "follow" &&
      tames.has(dodo.tame.id) &&
      game.store.get(`tame:${dodo.tame.id}`),
    "the tamed dodo has no kept record",
  );
  dodo.tame.order = "stay";
  saveTame(game, dodo.tame);

  // ---- A dilophosaur is clubbed until it drops, then fed while it's out. ----
  me().health = me().maxHealth;
  const dilo = place("dilophosaurus", 5);
  hold("wooden_club");
  h.run(40, {
    pilot: tend(dilo, { swing: true, keep: 1.2 }),
    until: () => dilo.ko || !me().alive,
  });
  check(me().alive, "the dilophosaur killed the survivor before it went down");
  check(
    dilo.ko,
    `the dilophosaur wasn't knocked out (daze ${dilo.daze.toFixed(0)} of ${dilo.t.dazeMax}, health ${dilo.e.health.toFixed(0)})`,
  );
  give(me(), "raw_meat", 20);
  h.run(60, { pilot: tend(dilo), until: () => !!dilo.tame || !dilo.ko });
  check(
    dilo.tame,
    `the dilophosaur wasn't tamed (trust ${dilo.trust.toFixed(0)}%, ${dilo.ko ? "still out" : "awake"})`,
  );
  dilo.tame.order = "stay";
  dilo.tame.name = "Spitfire";
  saveTame(game, dilo.tame);

  // ---- Both come back after the game restarts: their records are in the store. ----
  const kept = [...tames.values()].map((r) => ({ ...r }));
  check(kept.length === 2, `${kept.length} tames before the restart, not 2`);
  h.run(6, { pilot: () => ({}) }); // their places as they stand are written every few seconds
  game.restart();
  check(loaded.size === 0, "tames were still loaded straight after a restart");
  h.run(3, { pilot: () => ({}) });
  check(tames.size === 2, `${tames.size} tames after the restart, not 2`);
  for (const k of kept) {
    const r = tames.get(k.id);
    check(
      r &&
        r.species === k.species &&
        r.name === k.name &&
        r.owner === k.owner &&
        r.level === k.level &&
        r.order === "stay",
      `${k.name} the ${k.species} came back changed, or not at all`,
    );
    const b = loaded.get(k.id);
    check(
      b?.e.alive && b.tame === r && flat(b.e.position, k) < 6,
      `${k.name} isn't back in the world where it was left`,
    );
  }

  // ---- Riding: a saddle on a tame triceratops, on, across the ground, and off. ----
  clearWild();
  openGround(); // the restart put the survivor back where survivors start
  h.run(0.5, { pilot: () => ({}) });
  const trike = place("triceratops", 6);
  const rec = adopt(game, trike, me());
  rec.order = "stay";
  // The earlier tames wait where they are, out of the way.
  for (const [id, r] of tames) {
    if (r === rec) continue;
    r.order = "stay";
    const e = loaded.get(id)?.e;
    const [dx, dz] = [me().position.x - trike.e.position.x, me().position.z - trike.e.position.z];
    const l = Math.hypot(dx, dz) || 1;
    e?.teleport({ x: me().position.x + (dx / l) * 12, y: me().position.y + 1, z: me().position.z + (dz / l) * 12 });
  }
  hold("saddle_medium");
  h.run(10, { pilot: tend(trike, { keep: 1.5 }), until: () => !!me().vehicle });
  {
    const hit = game.entities.raycast(me().eye, me().look, 6, { margin: 0.4 });
    check(rec.saddled, `E with a saddle in hand did not saddle the triceratops (looking at ${hit ? brains.get(hit.entity.id)?.id : "nothing"}, ${flat(me().position, trike.e.position).toFixed(1)} blocks from it, holding ${me().inventory.held?.item})`);
  }
  check(
    me().vehicle && rides.has(me().id) && !loaded.has(rec.id),
    "E on the saddled triceratops did not mount it",
  );
  const from = { ...me().position };
  // Inland (toward the highest ground round about), so the ride doesn't end in the sea: E in reach of water is a drink.
  let inland = 0;
  for (let i = 0, best = -1; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const y = Math.min(
      game.world.surfaceY(from.x + Math.sin(a) * 8, from.z + Math.cos(a) * 8),
      game.world.surfaceY(from.x + Math.sin(a) * 16, from.z + Math.cos(a) * 16),
    );
    if (y > best) [best, inland] = [y, a];
  }
  (me().vehicle!.state as MountState).cam = inland;
  h.run(4, { pilot: () => ({ down: ["KeyW", "KeyF"] }) });
  const rode = flat(me().position, from);
  check(
    rode > 5,
    `riding moved the rider only ${rode.toFixed(1)} blocks in 4 s`,
  );
  check(flat(rec, me().position) < 1, "the mount's record didn't follow it");
  h.run(1, {
    pilot: () => ({ pressed: ["KeyE"] }),
    until: () => !me().vehicle,
  });
  check(!me().vehicle && !rides.has(me().id), "E did not get the rider off");
  const back = loaded.get(rec.id);
  check(
    back?.e.alive && flat(back.e.position, me().position) < 6,
    "the triceratops is not standing where its rider got off",
  );

  // ---- A swing lands on the head in front of you, though the animal's hitbox is behind it. ----
  const stego = place("stegosaurus", 5.4);
  {
    // The triceratops out of the way, on the far side from the stegosaurus.
    const [dx, dz] = [me().position.x - stego.e.position.x, me().position.z - stego.e.position.z];
    const l = Math.hypot(dx, dz) || 1;
    back?.e.teleport({ x: me().position.x + (dx / l) * 10, y: me().position.y + 1, z: me().position.z + (dz / l) * 10 });
  }
  stego.ko = true;
  stego.yaw = Math.atan2(
    me().position.x - stego.e.position.x,
    me().position.z - stego.e.position.z,
  );
  me().inventory.set(8, null);
  me().inventory.select(8);
  const head = () => ({
    x: stego.e.position.x + Math.sin(stego.yaw) * stego.s.length * 0.44,
    y: stego.e.position.y + stego.s.height * 0.3,
    z: stego.e.position.z + Math.cos(stego.yaw) * stego.s.length * 0.44,
  });
  h.run(0.2, { pilot: () => aim(head()) });
  check(
    !game.entities.raycast(me().eye, me().look, 3, { margin: 0.25 }),
    "the stegosaurus's hitbox is in fist's reach: the test wants it out of it",
  );
  const hale = stego.e.health;
  h.run(1.5, {
    pilot: () => ({ ...aim(head()), buttons: 1 }),
    until: () => stego.e.health < hale,
  });
  check(stego.e.health < hale, "a punch at the stegosaurus's head didn't land");
  brains.delete(stego.e.id);
  stego.e.remove();

  // ---- A tame told to gather fills its back, and hands it over. ----
  check(back, "no triceratops to send gathering");
  rec.order = "gather";
  back.gatherAt = 0;
  h.run(1.6, { pilot: () => ({}) });
  check(haulCount(rec) > 0, "the gathering triceratops found nothing");
  const carried = haulCount(rec);
  check(
    takeHaul(me(), rec) === carried && haulCount(rec) === 0,
    "the triceratops's haul didn't all reach its owner",
  );
  rec.order = "stay";

  // ---- A tame pterosaur keeps up with its owner on the wing. ----
  const ptera = place("pteranodon", 4);
  adopt(game, ptera, me());
  const here = me().position;
  let far = { x: here.x, y: here.y, z: here.z };
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const [x, z] = [here.x + Math.cos(a) * 22, here.z + Math.sin(a) * 22];
    const y = dry(x, z);
    if (y !== null) far = { x, y: y + 1.1, z };
  }
  me().teleport(far);
  let flew = false;
  h.run(8, {
    pilot: () => ((flew ||= !ptera.e.onGround && ptera.clip === "fly"), {}),
    until: () => flew && flat(ptera.e.position, me().position) < 6,
  });
  check(
    flew && flat(ptera.e.position, me().position) < 8,
    `the tame pteranodon didn't fly after its owner (${flew ? "flew" : "walked"}, ${flat(ptera.e.position, me().position).toFixed(1)} blocks behind)`,
  );
  census.paused = false;
}
