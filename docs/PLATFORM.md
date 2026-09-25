# Building games on Blockyard

The platform is a complete voxel engine: an endless procedural world, lighting, rendering, physics, streaming, entities, items, combat, audio and UI. You write the *game*: rules, content and moments. A game is one `defineGame({...})` object in `src/games/<name>/` that imports only from `@platform` (plus the optional `@platform/kits` and `@platform/art` libraries, which are themselves built only on `@platform`).

```
src/games/
  index.ts              the list of registered games
  heart-hunt/index.ts   ~70 lines: the tutorial below
  sandbox/index.ts      ~17 lines: creative building
  arena/                waves of monsters, weapons, a boss
    index.ts            rules: waves, rewards, win/lose
    content.ts          items, monsters, boss AI
    structure.ts        the colosseum, as a Blueprint
    art/                the mob skins and weapon sprites, painted in code into the 'arena' atlas
    sounds.ts           creature voices (audio.define)
  skyship/              an airship crewed together: a solid prop the players walk on as it sails
    index.ts            the helm, sailing, beacons, overboard, the HUD
    ship.ts world.ts    the airship and the sky islands, as Blueprints
  starfighter/          a Star Fox-style dogfighter: no walking, the game flies the camera
    index.ts            waves, HUD, win/lose
    ships.ts            the fighters, as Blueprints (meshed into movable props)
    destroyer.ts        the capital ship, as a world structure
    craft.ts pilot.ts enemies.ts weapons.ts capital.ts   flight, collisions, AI, lasers, the boss
    sounds.ts           lasers, torpedoes, the TIE howl (audio.define)
    layout.ts           where the battle is
    previews/           dev-only previews of the ships and the capital ship
  bedwars/              Bed Wars against three bots: sky islands, mining, building, a shop
    index.ts            rules: generators, beds, deaths and respawns, the timeline, win/lose
    map.ts              the islands, as Blueprints in a void world
    state.ts            teams, the match, block rules and mining times (for the building kit)
    bots.ts nav.ts      bot players: route-finding that bridges and digs, fighting, raiding
    shop.ts items.ts    the shopkeeper's menu and everything it sells
    fireballs.ts        thrown fireballs that blast wool and wood
    art/ sounds.ts      team skins, item sprites, sounds
  callofblocky/         Call of Blocky: a pulp free-for-all shooter against bots and people
    index.ts            rules: the match, spawns, kills, streaks, loadouts, the HUD
    weapons.ts          the guns (kind 'gun') and the katana
    bots.ts nav.ts      bot fighters (game.bots) and the walking grid they path-find on
    map.ts              Jackrabbit Lane, a Nuketown-style street, as Blueprints
    models/             the guns as GLB files (scripts/guns/build.mjs writes them)
    art.ts sounds.ts    the pulp wardrobe (skins painted in code), gunshots and stingers
  obby/                 Sky Obby: a parkour course in the void, each player on their own clock
    index.ts            rules: checkpoints, falls, pads, blinking and crumbling blocks, cannons, times
    course.ts           the ten stages, laid out as Blueprints with every jump checked against the physics
    sounds.ts           checkpoint chime, pad boing, crumbling sand, cannons
```

## Hello, game

`src/games/heart-hunt/index.ts` is a complete game in about 70 lines. It builds a pedestal as a blueprint, flattens the land around it, scatters ten glowing hearts, counts pickups and shows a victory screen:

```ts
import { defineGame, Blueprint } from '@platform';

let found = 0;

const pedestal = new Blueprint({ x: -2, y: 70, z: -2 }, { x: 5, y: 3, z: 5 })
  .fill({ x: -2, y: 70, z: -2 }, { x: 2, y: 70, z: 2 }, 'stone_bricks')
  .set(0, 71, 0, 'glowstone');

export default defineGame({
  id: 'heart-hunt',
  title: 'Heart Hunt',
  world: {
    structures: [pedestal],
    terraform: [{ x: 0, z: 0, radius: 12, blend: 16, height: 69.5 }],
    spawn: { x: 0.5, y: 72, z: 3.5 },
  },
  player: { health: 20, hotbar: 'items' },

  setup(game) {
    game.items.define('heart', {
      kind: 'misc', name: 'Heart', icon: 'heart',
      onPickup: (g) => (found++, g.audio.play('pickup'), true), // consume on touch
    });
  },

  start(game) {
    found = 0;
    for (let i = 0; i < 10; i++) {
      const a = game.rng.range(0, Math.PI * 2), r = game.rng.range(8, 36);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      game.items.spawnPickup('heart', { x, y: game.world.surfaceY(x, z) + 1.5, z }, { beam: '#ff5a7a', despawn: 1e9 });
    }
  },

  update(game) {
    game.hud.objective(`Hearts: ${found} / 10`);
    // ... show game.hud.screen({ title: 'You win!', ... }) at 10
  },
});
```

Register it in `src/games/index.ts` and open `?game=heart-hunt`. The launcher lists every registered game.

## Lifecycle

| Hook | When | Use it to |
| --- | --- | --- |
| `setup(game)` | once, after the engine loads, before the world streams | define items and entity types, subscribe to events |
| `start(game)` | when the player first clicks play, and after `game.restart()` | reset state, give the starting kit, schedule the first beat |
| `update(game, dt)` | every frame while running (not paused) | rules, spawning, HUD |

`game.restart()` clears entities, props, pickups, timers, the inventory and HUD, puts back any blocks broken or placed this session (unless the game sets `world.persist`), revives the player at the spawn point and calls `start` again. Keep your game state in plain module variables and reset it in `start`.

Game time (`game.clock.now`, `after`, `every`) pauses with the game. Prefer it over `setTimeout`.

## World

`world` options on the definition:

- `structures: Blueprint[]`: voxel structures stamped **during generation** in the Rust workers. They are there from the first frame, cost nothing at runtime, and survive chunk reloads. Cells you never write keep the natural terrain; write `'air'` to carve.
- `terraform`: flatten terrain around a point (`radius` fully flat, `blend` back to natural). Terraformed and blueprint areas get no caves, trees or plants. The ground keeps the local biome's surface (grass, podzol, sand, snow), so if the floor matters, write it into your blueprint (the arena stamps a sand floor) or fix `seed`.
- `terrain: 'flat'` plus `flatHeight`: a flat world.
- `terrain: 'void'`: nothing but your structures, floating in an open sky (Bed Wars and SkyWars islands). The sky wraps all the way round below the horizon, so there's no floor to see.
- `spawn`, `spawnYaw`, `time` (0 = midnight, 0.5 = noon), `freezeTime`, `seed`, `persist` (save block edits and position; Sandbox uses it).
- `viewDistance`: a minimum view distance in chunks for games that see far (flight). The player's own setting wins if it's higher.

`Blueprint` helpers: `set`, `fill(a, b, block | (x, y, z) => block)`, `columns(cx, cz, radius, (x, z, dist, angle) => …)` for rings and walls, `Blueprint.centered(cx, cz, radius, y0, y1)`, `moved(offset)` and `forEach`. See `src/games/arena/structure.ts`, which builds a whole colosseum in about 120 lines.

At runtime, `game.world` exposes `getBlock`, `setBlock` (lighting and meshing update automatically), `raycast`, `lineOfSight`, `surfaceY`, `blockId`, `blockName`, `seaLevel`, and `explode(center, radius)`, which blasts a ragged hole (all the affected chunks remesh together) with debris and an explosion. `breakBlock(x, y, z, { by })` and `placeBlock(x, y, z, block, { by })` break and place with debris, sound and the `blockBreak` / `blockPlace` events, and won't place a block inside anyone; `setBlock` is the silent version. `blockInfo(block)` tells you whether a block is solid, a liquid, a plant or replaceable, and which variant it is. The building kit (below) puts these together into survival mining and placing. Block names are listed in `engine/src/blocks.rs` (`stone`, `grass_block`, `oak_planks`, `glowstone`, `water`, the wools, `end_stone`, the four beds…).

### Block shapes and states

Not every block is a cube. Torches are sticks that stand on the floor or hang on a wall; slabs are half blocks (`oak_slab`, `stone_slab`, `cobblestone_slab`, `spruce_slab`, `birch_slab`, `stone_brick_slab`, `brick_slab`, `sandstone_slab`); stairs (`oak_stairs`, `spruce_stairs`, `birch_stairs`, `cobblestone_stairs`, `stone_brick_stairs`, `brick_stairs`) climb one way; beds (`red_bed`, `blue_bed`, `green_bed`, `yellow_bed`) are two blocks long and 9/16 high; logs lie along any axis. You walk up slabs and stairs without jumping, collide with a bed's real height, and aim past a torch or over a slab to what's behind.

A block with several variants names one Minecraft style, anywhere a block goes (`setBlock`, blueprints, `placeBlock`): `'oak_stairs[facing=east,half=top]'`, `'red_bed[facing=south,part=head]'`, `'torch[facing=west]'` (on a wall, pointing west), `'oak_log[axis=x]'`, `'oak_slab[type=top]'`. States left out are the default's, and the plain name is the default variant (`'oak_stairs'` climbs north). `blockName` is the family's name (a bed's head and foot are both `red_bed`), `blockInfo(id).state` its variant (`{ facing: 'east', part: 'head' }`) and `blockInfo(id).variant` the full name, ready to pass back. A bed in a blueprint is its two halves:

```ts
bp.set(x, y, z, 'red_bed[facing=east,part=foot]');
bp.set(x + 1, y, z, 'red_bed[facing=east,part=head]');
```

`placeBlock` with a plain name turns the block the way a player's hand would: pass `against` (the `raycast` hit being aimed at) and a torch hangs on the side of the block aimed at (or stands on the floor), a slab or stairs take the upper half when aimed at a ceiling or high on a side, a slab aimed at the open side of the same kind of slab fills it in to a full block, and a log lies along the axis aimed along. Stairs climb, and a bed's head points, toward `facing` (or the way `by` is looking). A bed takes its two cells or none. Breaking a block (`breakBlock`, explosions) takes what hangs on it or stands on it with it, and either half of a bed takes the other; each gets its own `blockBreak`. The building kit and Sandbox place this way. `RayHit.point` is where exactly a ray met a block.

## Player

`player` options: `build` (creative: break and place blocks from a block hotbar; for survival building see the `building` kit), `fly`, `health` (half-hearts; `false` = invulnerable), `regen`, `fallDamage`, `hotbar: 'blocks' | 'items'`, `skin` (a Minecraft-layout skin, default `Skins.player`; it's also the first-person arm), and `controller`:
- `'walk'` (default) is the first-person player.
- `'none'` removes the walking body, hand and hotbar. The game drives the camera and reads the controls itself, which is what vehicles, flight and top-down games need (next section). `player.position` then stays wherever you last `teleport` it: that's the point mobs chase and pickups fly to, so move it with your vehicle if you use those, and ignore it if you don't.

`game.player` (one of `game.players`, see "Players and multiplayer") gives you `position`, `eye`, `look`, `velocity`, `onGround`, `health` and `maxHealth` (both writable), `armor` (0..20 points, each blocking 4% of damage, like Minecraft's), `damage(amount, { source, knockback, from })`, `heal`, `revive`, `teleport`, `impulse` and `freeze`, plus `inventory` (`give`, `take`, `count`, `select`, `clear`; nine slots) and `viewModel` (see below). Picking up a better-ranked weapon auto-equips it and replaces the weakest weapon if the hotbar is full.

**Movement.** `player: { movement }` tunes how everyone moves (speeds in blocks a second; the defaults are Minecraft's). It's data rather than code because each player's own screen runs the same movement to predict them:

```ts
player: {
  movement: {
    walk: 6, sprint: 8.4, crouch: 2.8, jump: 1.3,     // jump height in blocks
    gravity: 30, acceleration: 16, airControl: 4,
    sprintKeys: ['ShiftLeft'], crouchKeys: ['KeyC'],  // default: Ctrl sprints, Shift sneaks
    doubleTapSprint: false, edgeGuard: false,         // crouching stops at edges (Minecraft's sneak)
    slide: { speed: 11.5, time: 0.8 },                // crouch out of a sprint: a slide (jump out of it keeping the speed)
    mantle: 1.1,                                      // jump into a ledge up to this high and climb onto it
  },
},
```

`player.speed` multiplies one player's speeds (a power-up; guns have their own `mobility`), `player.crouching`, `sliding` and `aiming` say what they're doing, and `player.protect(seconds)` makes them ignore damage for a while (spawn protection). `hurtCooldown` (default 0.45, Minecraft's) is how long a player ignores further damage after a hit; shooters set it to 0.

**Changing damage.** Every hit is heard before it lands, from anything: a gun, a blade, an arrow or fireball, a fall, a mob's swing, your own `damage` call. A `damage` listener can change it (`amount`, before armour, and `knockback`) or `cancel()` it, for players and creatures alike; a cancelled hit doesn't land at all (no hurt, no knockback, no `playerDamage` or `entityDamage`, no hit marker for a gun). It says who's hit (`target`), who did it (`source`), what with (`weapon`, the item id), how (`cause`: `'gun'`, `'melee'`, `'projectile'` or `'world'`), and for bullets the `part` hit (`'head'` or `'body'`) and `headshot`:

```ts
game.events.on('damage', (hit) => {
  const by = hit.source;
  if (by !== 'world' && by?.kind === 'player' && hit.target.kind === 'player' && teamOf(by) === teamOf(hit.target)) return hit.cancel(); // no friendly fire
  if (hit.cause === 'gun' && hit.part === 'head') hit.amount *= 1.25;   // heads hurt more in this game
  if (hit.cause === 'world') hit.knockback = 0;
});
```

Listeners run in the order they were added, each seeing what the last left. Your own `damage(amount, { source, cause, part })` calls can say how they happened; without a `cause`, a hit from someone counts as `melee` and anything else as `world`. `entity.damage` answers whether it landed, like `player.damage`.

**Third person.** `player.camera.orbit(target, { offset, distance, min, max })` lets a walking player scroll out of their eyes to circle `target` with the mouse: a prop (the ship they steer) or a player (themselves).
- `offset` is the point circled: in the prop's own space, or up from the player's feet. Players default to their eyes.
- The wheel zooms between `min` and `max` blocks (default 0 and 30). Zoomed all the way in, they're in first person again, and scrolling out glides from their eyes to the target.
- It's worked out on their own screen every frame, so it's smooth online.
- Blocks stop the camera, but solid props don't, so it sees a ship from outside.
- Their figure shows while they're out of their eyes, and their first-person hand doesn't.
- While it's on, the wheel zooms rather than changing hotbar slots; the number keys still select slots.
- `orbit(null)` puts them back in first person. Skyship turns it on at the helm: `p.camera.orbit(ship, { offset: { x: 0.5, y: 8, z: -2 }, max: 70 })`.

## Players and multiplayer

Games are written so the same code works with one player or many:

- **`game.players`** lists everyone playing. A single-player game has exactly one, and **`game.player`** is that player, which is why single-player games can keep using `game.player`, `game.hud`, `game.input` and `game.camera` as they are.
- **Each player** has an `id`, a `name`, their own `inventory`, `health` and `viewModel`, and their own screen and controls: **`player.hud`** reaches only them (their wallet, their shop, their toasts), **`player.audio`** plays sounds only they hear, **`player.fx`** shakes and flashes only their screen (they were hit), `player.input` is their keyboard and mouse, `player.camera` their camera. **`game.hud`** is everyone's screen (banners, the scoreboard), `game.audio` everyone's speakers.
- **How others see them.** Each player appears to the others as a figure that walks, swings and holds what's in their hand. `player.setSkin([u, v], atlas)` dresses it (a Minecraft-layout skin in one of your atlases; their own first-person arm wears it too), and `player.color` colours their name above it (team colours).
- **Who did it.** Damage sources, killers and block events are an `Actor`: an `Entity`, a `Player`, or `'world'`. Tell them apart with `kind` (`'entity'` or `'player'`): `if (killer !== 'world' && killer?.kind === 'player') kills++`.
- **Callbacks name the player**: `use(game, player)`, `onPickup(game, count, player)`, command `run(args, game, player)`, the `pickup`, `playerDamage` and `playerDeath` events, and the kits' handlers. Use that player rather than `game.player`, and a potion heals whoever drank it.
- **Mobs pick their target**: `self.nearestPlayer()`, then `moveTo`, `lookAt`, `canSee`, `distanceTo`, `shoot` and `damage` it. The built-in `Behaviors` all hunt the nearest player.
- **Joining and leaving:** `playerJoin` and `playerLeave` events. Players already here when `start` runs are in `game.players`, and the array stays up to date as players come and go.
- **Player against player.** With `player: { pvp: true }`, players' swords and arrows hit other players too (never the shooter); without it, players can't hurt each other. Monsters' shots always hit any player. Who hit whom arrives as usual: `playerDamage` and `playerDeath` name the attacker as `source`.

**Playing together.** Any game can be hosted by the game server, and players join from their browsers:

```sh
npm run server -- sandbox --port 8787          # add --cheats for /tp, /give…, --seed to pick a new world's seed
# then each player opens:
http://localhost:5173/?server=ws://localhost:8787&game=sandbox
```

The server runs the game at 30 steps a second whether or not anyone's watching a given frame. The first to join is `game.player`; everyone else arrives at the spawn and the game hears `playerJoin`. When the first player leaves, the next to join takes their place, so `game.player` always works. Everyone sees everyone else as a figure with their name above it, wearing the game's player skin (or their own, `player.setSkin`). Your own movement is predicted: it happens the moment you press a key, and the server's word only corrects it when something you couldn't know about happened (a knockback, a teleport). A restart (from any player's pause menu or a "Play again" button) restarts the game for everyone. `game.exit()` sends back to the launcher only the player whose button or command called it.

**What a server keeps.** Each server has a SQLite database (`data/<game>.sqlite`, or `--db path`). It holds the world's seed, so restarting the server carries on the same world; for games that keep their world (`world.persist`, like Sandbox) its builds and time of day, and each player's place by name (where they stood, which way they faced, whether they were flying, their block hotbar); and your game's `game.store`. It's saved every 30 seconds, when a game stops for want of players, and when the server stops (Ctrl-C). `--new` starts a fresh world and sets the old database aside. Names aren't checked yet: whoever joins as Ann gets Ann's place, and a second Ann at the same time becomes "Ann 2".

**Games of one's own.** A match game can let players start a game of their own instead of joining the public one: set `instances: true` on the game (Bed Wars, the Arena and Starfighter do). Its home page on a server then has a second button, "Play on your own". It opens a separate copy of the game (its own world, its own match, the bots filling the empty places) at an address of its own (`?game=bedwars&room=k3x9f2`); "Copy invite link" hands that address to friends, and "Public game" goes back. Such a game keeps no world or places, but it shares the game's `game.store` with the public one, so all-time numbers count wherever they were earned. It stops a minute after the last player leaves. Each game on a server runs in a worker thread of its own, so the variables your game keeps in its module are its own in each copy; leave `instances` off for games that are one shared world (Sandbox). A server runs up to 8 games at once (`--rooms`, about 30 to 50 MB each), and one address may have 2 of its own going.

How a single-player game behaves with company depends on how it's written: a game that only talks to `game.player` gives the others a world to walk around in, while one that uses `game.players`, `player.hud` and the named player in callbacks works for everyone.

## Items

```ts
game.items.define('iron_sword', { kind: 'melee', name: 'Iron Sword', icon: 'iron_sword', damage: 6.5, cooldown: 0.42, reach: 3.5, rank: 3, hold: { model: HeldModels.ironSword } });
game.items.define('bow', { kind: 'bow', name: 'Bow', icon: 'bow', drawIcon: 'bow_pulling', ammo: 'arrow', damage: [2, 9], drawTime: 0.9, speed: 42 });
game.items.define('potion', { kind: 'consumable', name: 'Potion', icon: 'health_potion', hold: { model: HeldModels.healthPotion }, stack: 4, use: (g, player) => (player.heal(10), true) });
game.items.spawnPickup('iron_sword', pos, { beam: '#ffd36b' });
game.items.spawnPickup('iron_sword', pos, { for: player }); // only they can take it (a reward each)
```

The platform implements everything around them:
- **Melee:** swing animation, hit detection through walls, knockback, crits while falling, and sweep attacks.
- **Bows:** draw charge, ammo, and ballistic arrows that stick in walls. What flies is the ammo item's icon (or `projectile`); a bow without ammo shoots glowing bolts.
- **Consumables:** right-click to use.
- **Pickups:** physics, magnet pull, collection and toasts. `onPickup(game, count, player)` can consume the item instead (and plays its own sound).
- **Sounds:** each item can bring its own (`sounds: { use, hit, draw }`, built-in or `audio.define`d); otherwise it gets the generic swing, hit and bow sounds.
- **Held items:** a first-person arm holds the item: its 3D model if it names one (`hold.model`), otherwise an extruded 3D version of its sprite (next section).

Built-in starter sprites: `wooden_sword`, `stone_sword`, `iron_sword`, `diamond_sword`, `bow`, `bow_pulling`, `arrow`, `health_potion` and `heart`. Everything else a game brings itself (see "Your own art and sound").

**Drawing item sprites.** Sprites are 16×16 and follow Minecraft's conventions, which the held poses and projectiles are built around:
- Swords, tools and arrows lie on the diagonal: handle (or tail) at the bottom left, tip at the top right. The default sword grip is pixel `[3, 12.5]`.
- Bows arc from the upper left, with the arrow pointing up and to the left.
- Potions and trinkets stand upright.

Art drawn another way works too: set `hold.grip` (and `hold.rotation`) to match it.

## Guns

A `kind: 'gun'` item is a hitscan gun: every shot is a ray (a few for a shotgun) that hits the first player, creature, block or solid prop along it. Plants, torches and leaves don't stop bullets.

```ts
game.items.define('rifle', {
  kind: 'gun', name: 'Big Kahuna', icon: { gltf: rifleUrl }, hold: { style: 'gun', model: HeldModels.gltf(rifleUrl) },
  auto: true, rpm: 640,                       // held trigger; rounds a minute
  damage: [30, 22], falloff: [22, 48],        // close up, and from 48 blocks on
  headshot: 1.5,
  magazine: 30, reserve: 120, reload: 2.1,    // `shells: true` loads round by round (shotguns)
  spread: { hip: 2.2, aim: 0.12, move: 1.3, air: 3, bloom: 0.22 },   // degrees
  recoil: { up: 0.85, side: 0.35, recover: 0.7 },
  aim: { zoom: 1.35, time: 0.22, move: 0.62, sight: 'holo' },       // 'iron', 'dot', 'holo' or 'scope'
  mobility: 0.95, pellets: 1, action: undefined,                    // 'pump' | 'bolt'
  sounds: { use: 'shot_rifle', reload: 'reload_mag', empty: 'gun_empty', cycle: 'pump' },
});
```

The platform does the rest:
- **Fair online.** The shooter's own screen fires the moment the trigger's pulled: the flash, the kick, the tracer, the sound, the rounds. The shots go to the host with the controls. The host takes each one the gun could have fired (its rate, its rounds) and casts it where the targets were *on the shooter's screen*: it keeps a second of everyone's positions and rewinds to the moment that screen was showing, at most 0.35 s back (`guns.rewind`). Spread is seeded per shot, so the tracer you see is where the host's bullet goes.
- **Controls.** Left mouse fires (held, for `auto`). Right mouse aims down the sights: the view zooms, the gun comes up to the eye, spread and speed drop, and a `scope` fills the view. R reloads, and an empty gun reloads by itself (unless `guns.autoReload` is off). Firing and aiming stop a sprint, and coming out of a sprint the gun takes a moment to come up. On a controller the triggers fire and aim, X reloads, and there's aim assist (`aim.assist`, see Controllers).
- **Hits.** Damage falls off with distance, head hits multiply it, and the shooter gets a hit marker (red for a kill), a tick and their own damage numbers. The victim's HUD points to where the shot came from. `playerDamage`, `playerDeath`, `entityDamage` and `entityDeath` carry `weapon` (the item id) and `headshot`; `shot` fires for every shot (a gunshot is also how bots hear people). The `damage` event (see Player) can change or cancel a hit before it lands.
- **Sights.** `iron` sights are the model's own. A `dot` or `holo` sight lights its reticle (a red dot, or a holo's ring and dot; `aim.color`) at the aim point as the optic's window comes up to the eye: model the optic with its window open and its `sight` point in the window's middle. A `scope` fills the view with the scope.
- **The HUD.** An ammo counter replaces the hotbar's job, and the crosshair opens with the spread (and goes when aiming).
- **Ammo.** `player.inventory.ammo('rifle')` is `{ magazine, reserve }`, and `setAmmo` refills it. A gun given again comes full.
- **In the hand.** The `gun` hold style puts two hands on the gun: at the hip, swung across the chest to sprint, leaning into a slide, up to the eye to aim, tipped to show the magazine as the support hand fetches a new one, and working a pump. `hold.scale` multiplies its size (0.42 of the model's own), and `hold.gun` moves its poses (next). A held glTF model marks its points with empty nodes named `grip` (the firing hand, at the model's origin), `grip2` (the support hand), `muzzle`, `sight` (on the eye line when aiming) and `mag`. Others see the gun raised to their figure's shoulder, a flash at its muzzle, and its tracers. `scripts/guns/build.mjs` builds Call of Blocky's guns from boxes and writes them as GLB files that way.

**A gun's hold.** `hold.gun` places one gun differently in first person; whatever it gives goes over the default, so give only what you change. Camera space, in blocks (x right, y up, z back, so ahead is -z), written for the right hand:

```ts
hold: {
  style: 'gun', model: HeldModels.gltf(rifleUrl),
  gun: {
    fist: [0.235, -0.255, -0.62],     // the firing fist at the hip (a compact gun's default: [0.12, -0.19, -0.52])
    barrel: [-0.1, 0.045, -1],        // which way it points at the hip; roll: -0.22 cants it (radians)
    ads: 0.42,                        // the sight this far ahead of the eye aiming (by sight: iron 0.42, dot/holo 0.3, scope 0.46)
    sprint: { yaw: 0.8, pitch: -0.5, roll: -0.45, move: [-0.08, -0.06, 0.08] },
    slide: { roll: 0.35, move: [-0.04, -0.03, 0.02] },
    forearm: { hip: [0.32, -0.74, 0.6], ads: [0.22, -0.64, 0.74] },    // fist toward elbow; forearm2 is the support arm's
    kick: 0.075, rise: 7,             // a shot's kick back (blocks) and muzzle rise (degrees) per unit of recoil
  },
},
```

A humanoid player's own arms on the gun are fitted by their model (`firstPerson`, see glTF and GLB models), since that's about the model's proportions.

**A game's gun rules.** `guns` in the game definition sets how every gun plays. The host and each shooter's own screen both play by it (a screen predicts its own movement and fires its own shots), so it's data. The defaults are Call of Blocky's:

```ts
defineGame({
  guns: {
    rewind: 0.35,                          // seconds a shot may look back for where its target was
    hitboxes: {                            // players' boxes for bullets, blocks up from the feet; give what you change
      stand: { height: 2, neck: 1.5, width: 0.72, headWidth: 0.56 },    // the head is from the neck up
      crouch: { height: 1.7, neck: 1.2, width: 0.76, headWidth: 0.6 },
      slide: { height: 1.4, neck: 0.85, width: 0.9, headWidth: 0.9 },
    },
    aimSlows: true,                        // aiming slows to the gun's aim.move
    aimStopsSprint: true, fireStopsSprint: true,
    autoReload: true,                      // an empty gun reloads by itself
    rateSlack: 3,                          // shots a laggy screen may get ahead of the gun's rate (at least 1)
    assist: { strength: 0.6, cone: { radius: 1.1, angle: 1.43 }, slow: { hip: 0.45, aim: 0.6 }, follow: { hip: 0.4, aim: 0.6 } },
  },
});
```

`assist` is aim assist's shape for every gun (see Controllers); a gun's own `aim.assist` goes over it, as a strength or the same shape.

## Controllers

Every game plays with a controller as well as the keyboard and mouse, with nothing to write: a controller presses the same keys and mouse buttons, so `input.isDown('KeyR')` and `button(0)` read it too. The left stick walks, the way it points and as fast as it's pushed (it also holds WASD, for games that read those), and the right stick looks, turning faster the longer it's held all the way over and slower aiming down the sights. Play and Resume pressed with the controller give it the game (no mouse capture needed); Menu pauses. In the menus (the home page, pause, `hud.menu`, `hud.screen`, the block picker) the D-pad or stick moves a highlight, A presses, B backs out, and sliders slide with left and right. With a gun there's aim assist: over a player in sight the stick turns slower, and while the sticks move the view turns a little with them as they move. The strength is the gun's `aim.assist` (0 to 1, default 0.6). It can give the shape too, as can the game's `guns.assist` for every gun: `cone` (who's near enough the crosshair: `radius` blocks round them, 1.1, plus `angle` degrees, about 1.43), `slow` (how much the stick slows over them at full strength, from the hip and aiming: 0.45 and 0.6) and `follow` (how much of their movement the view turns with: 0.4 and 0.6). Only controllers get it, never a mouse, and each player can turn it off, along with stick sensitivity, invert look and vibration, in the pause menu. The controller rumbles as guns fire and when you're hurt.

The platform's layout is a shooter's, and it suits building too:

| Button | Does | | Button | Does |
|---|---|---|---|---|
| RT | left mouse (fire, break) | | LT | right mouse (aim, place) |
| A | jump | | B | crouch (the game's crouch key) |
| L3 | sprint, on until the stick lets go | | R3 | middle mouse |
| X | R | | Y, RB, D-pad → | next hotbar slot |
| LB, D-pad ← | previous slot | | D-pad ↑ / ↓ | E / F |
| View | Tab | | Menu | pause |

Next and previous skip empty slots in an `items` hotbar, as the mouse wheel does. A game changes buttons with `gamepad`. A button's job is a key code, `'LMB'`, `'MMB'` or `'RMB'`, one of `'jump'`, `'crouch'`, `'sprint'`, `'next'`, `'prev'`, `'pause'`, or `null` for nothing:

```ts
defineGame({
  controls: [['L', 'loadout'], /* … */],
  gamepad: { Up: 'KeyL', R3: ['Digit3', 'katana'], Down: null },
});
```

While a controller is in use, the home page and the pause menu show its hints instead of the keys. Each button is named from the game's `controls`: the entry for the key it presses, so `Up: 'KeyL'` shows "D-pad ↑ loadout". Buttons the game doesn't mention are left out, and `[job, 'label']` names one outright. Over the network a stick goes with the controls as `PlayerInput.move` ([right, forward]), and the host moves the player by it the same way the client predicts.

## Bots

`game.bots.add(name)` adds a player driven by your code: they're in `game.players` like anyone, everyone sees them (a figure, a name, what they hold), and they move, jump, slide, swing and shoot by exactly the same rules, because they do it through the same controls a person has:

```ts
const bot = game.bots.add('Lucky Lou');     // the game hears playerJoin
bot.controls.hold('KeyW');                  // held until released
bot.controls.hold('ShiftLeft');
bot.controls.lookAt(target.eye);            // or look(yaw, pitch)
bot.controls.button(0);                     // hold the trigger; click(0) for one shot
bot.controls.press('KeyR');                 // this tick only
game.bots.remove(bot);
```

Set their controls in `update`; they apply from the next tick. `player.bot` tells them from people. Call of Blocky's bots (`src/games/callofblocky/bots.ts`) look for enemies, react, swing their aim on imperfectly, fire, strafe, reload and roam the map along a walking grid built from the world's blocks (`nav.ts`).

## Kits: ready-made systems, no special access

Some gameplay systems are common enough that the platform ships them, but they aren't part of the core. A **kit** is an ordinary module under `src/platform/kits/`, written only against `@platform`, exactly like code in your game folder. `npm run check:boundaries` (part of `typecheck` and `build`) fails if a kit, or a game, imports anything else. Use a kit as is, copy it into your game and change it, or write your own: nothing a kit does needs access your game doesn't have. `Behaviors` for mobs follow the same idea.

| Kit | What it does |
| --- | --- |
| `building(game, rules)` | Survival building: hold left-click to mine a block (cracks grow over it, the arm swings), right-click with a block to place it against the face you aim at. Your rules decide what may be broken or placed, by whom, and how long mining takes. |
| `interactions(game, { type: (entity, player) => … })` | Right-click a mob to talk to it: shopkeepers, quest givers, levers. |

```ts
import { building, interactions, type Building, type Interactions } from '@platform/kits';

let build: Building;
let talk: Interactions;

setup(game) {
  game.items.define('wool', { kind: 'misc', name: 'Wool', icon: { block: 'red_wool' } }); // looks like a block: placeable
  build = building(game, {
    canBreak: (at, block, by) => placedThisMatch.has(key(at)) || block.endsWith('_bed'),
    canPlace: (at) => at.y < 110,
    breakTime: (block, held, player) => (block.endsWith('_wool') && held?.item === 'shears' ? 0.1 : 0.6),
  });
  talk = interactions(game, { shopkeeper: (keeper, player) => shop.show(player) }); // on their screen
},
update(game, dt) {
  talk.update();     // first, so talking to the shopkeeper wins over placing a block
  build.update(dt);  // before the built-in weapons, so mining a block doesn't also swing the sword
},
```

Without `breakTime`, mining takes a Minecraft-like time by material (`defaultBreakTime`: plants instantly, wool and glass fast, wood medium, stone slow, obsidian very slow). Bots build under the same rules through `build.placeBlock(x, y, z, block, bot)` and `build.breakBlock(x, y, z, bot)`; that's how the Bed Wars bots bridge and dig.

**The primitives underneath**, available to any game:
- **Items that look like blocks.** An item with `icon: { block: 'oak_planks' }` shows the block in the hotbar and menus, is held as a little cube and drops as a spinning cube of the block.
- **`input.consume(button | key)`** claims an input for the rest of the frame. Your game's `update` runs before the built-in systems, so a click you handle and consume doesn't also swing the sword or eat the apple.
- **`entities.raycast(origin, dir, reach)`** finds the mob under the crosshair (stopping at blocks); `world.raycast` finds the block.
- **`hud.highlight(block, { progress })`** outlines a block on a player's screen, with Minecraft's break cracks at `progress` 0..1. **`hud.progress(0..1)`** is a ring round the crosshair.
- **`world.breakBlock` / `placeBlock`** break and place with debris, sounds and the `blockBreak` / `blockPlace` events (`{ x, y, z, block, by }`), and won't place a block inside anyone; `placeBlock` turns torches, slabs, stairs, beds and logs the way the player's aim and look say (see *Block shapes and states*). They don't know your rules: that's the kit's job, or yours. **`world.blockInfo(block)`** says whether a block is solid, a liquid, a plant or replaceable.
- **`world.explode(center, radius, { filter, by })`**: `filter` decides which blocks an explosion takes (Bed Wars: only wool and wood placed this match).

## First-person view model

![View model](viewmodel.png)

The first-person view is built from Minecraft's own transforms:
- The arm is posed exactly like Minecraft's bare first-person arm.
- Items sit upright in the fist, turned the way Minecraft shows them (`display.firstperson_righthand`).
- The attack swing is Minecraft's arm swing, with the blade chopping forward.
- The bow uses Java's first-person pose, held at your side and swung up to aim as you draw.
- After each hit the item dips and rises again as the attack recharges, like Minecraft's attack-strength cooldown.

Walk bob, breathing, look sway, the landing dip, recoil when you're hit, and the lower-and-raise when you switch items all come for free.

| Style | Default for | Held | Use animation |
| --- | --- | --- | --- |
| `sword` | melee | Gripped at the handle, blade up | `swing` |
| `axe` | | Gripped low on the haft | `swing` |
| `bow` | bows | At your side; drawing brings it up to aim | `release` |
| `item` | everything else | Upright in the fist | `drink` |
| `block` | Sandbox blocks | A small cube on the fist | `swing` |
| `polearm` | | Two hands on the shaft, low at the right, tip just under the crosshair | `jab` |

The empty hand uses `punch`. Change a pose per item with `hold`, in the same numbers as a Minecraft model's `firstperson_righthand`. Every field is optional:

```ts
game.items.define('spear', {
  kind: 'melee', name: 'Spear', icon: { atlas: 'mine', x: 0, y: 0 }, damage: 7, cooldown: 0.6,
  hold: {
    style: 'sword',
    grip: [3, 12],          // sprite pixel that sits in the fist
    rotation: [0, -90, 25], // degrees about X, Y, Z (Minecraft's handheld default)
    translation: [0, 0, 0], // pixels
    scale: 1.3,
    hand: 'right',          // or 'left' (shields, torches, off-hand trinkets)
    use: 'stab',            // built-in, registered, or inline keyframes
  },
});
```

Built-in animations are `swing` (Minecraft's), `slash` (a diagonal cut for 3D blades), `hew` (an overhead blow for axes), `sip` (drinking from a held bottle), `punch`, `jab` (a two-handed thrust along the shaft), `drink` (Minecraft's eat pose), `release`, `chop` and `stab`. Custom animations are keyframes offset from the rest pose:
- `move` shifts the hand, in blocks.
- `hand` turns the hand, item and forearm together about the fist.
- `wrist` turns only the item.
- Rotations are `[pitch, yaw, roll]` in radians.
- `t` runs from 0 to 1, and `ease` shapes the segment that ends at that key.
- They're written for the right hand and mirrored automatically for the left.

For procedural motion, pass `sample(t)` instead of `keys`.

**3D held items.** An item can be held as a box model (`HeldModelSpec`) instead of its flat sprite: same UV layout as mobs, length along +z, the hand position marked. They look much better in the hand than extruded sprites. The starter kit includes models for the swords and the potion; an item uses one by naming it: `hold: { model: HeldModels.ironSword }`. Without a model, an item is held as its sprite, extruded. Held models get their own grip: swords rise from the fist into the scene with their flat turned to you and attack with a diagonal `slash`; axes are held low on the haft and `hew`; bottles sit on the palm and `sip`. The Arena's battle axe and pike are models of its own (`src/games/arena/art/`):

```ts
const PIKE: HeldModelSpec = {
  atlas: 'arena',
  parts: [
    { size: [2, 2, 30], uv: [0, 160], offset: [-1, -1, 0] },  // shaft
    { size: [0, 7, 14], uv: [88, 160], offset: [0, -3.5, 32] }, // blade
    // …
  ],
  grip: [0, 0, 5],   // rear hand
  grip2: [0, 0, 19], // front hand
};
game.items.define('pike', {
  kind: 'melee', name: 'Pike', icon: { atlas: 'arena', x: 208, y: 128 }, damage: 7.5, cooldown: 0.7, reach: 5,
  hold: { style: 'polearm', model: PIKE },
});
```

With two hands, the forearms pivot toward their elbows as an animation moves the fists, so a jab looks like both arms reaching.

```ts
game.player.viewModel.define('stab', {
  duration: 0.3,
  keys: [
    { t: 0 },
    { t: 0.3, wrist: [-1.1, 0, 0], move: [-0.12, 0.08, -0.3], ease: 'out' },
    { t: 1, ease: 'inOut' },
  ],
});
game.player.viewModel.play('stab', { power: 1.5 });   // e.g. a scripted finisher
game.player.viewModel.kick(1);                        // recoil
game.player.viewModel.setSkin([0, 0], 'mine');        // any skin in any atlas; null hides the arm
game.player.viewModel.visible = false;                // cutscenes
```

## Vehicles, flight and custom cameras

![Starfighter](starfighter.png)

With `player: { controller: 'none' }` there's no walking body: the game decides what the player controls and where the camera is, and the world streams around the camera.

**Vehicles.** A ship, a car or a board is a vehicle: define it in the game's `vehicles`, and put a player in one with `player.drive(name, state, { prop })`. Its `step` moves it from their controls; the platform runs it input by input on the host, and on the player's own screen ahead of the host (client-side prediction, as walking has), so it answers at once however far away the server is. `pose` places its model (`prop`) on every screen, and `camera` gives the pilot a chase camera worked out on their screen every frame.

```ts
export default defineGame({
  player: { controller: 'none' },
  vehicles: {
    ship: {
      // Pure: reads the state, the controls and the world; changes only the state.
      step(s, controls, dt, world) {
        s.yaw -= controls.mouseX * 0.004;
        s.speed = controls.isDown('KeyW') ? 60 : 30;
        s.x -= Math.sin(s.yaw) * s.speed * dt;
        s.z -= Math.cos(s.yaw) * s.speed * dt;
      },
      pose(s, position, quaternion) {
        position.set(s.x, s.y, s.z);
        quaternion.setFromEuler(new math.Euler(0, s.yaw, 0));
      },
      camera(s, cam, dt) {
        cam.position.lerp(new math.Vector3(s.x + Math.sin(s.yaw) * 12, s.y + 4, s.z + Math.cos(s.yaw) * 12), cam.snap ? 1 : 1 - Math.exp(-dt * 8));
        cam.target.set(s.x, s.y, s.z);
      },
    },
  },
  start(game) {
    for (const p of game.players) p.drive('ship', { x: 0, y: 120, z: 0, yaw: 0, speed: 30 }, { prop: game.props.spawn(shipModel) });
  },
});
```

- The state is plain data (numbers, booleans, short lists): it goes to the pilot's screen as is. Anything with consequences (shots, damage, sounds) is your `update`'s job, reading `player.vehicle.state` and `player.input`; the game may change the state too (a knock-back), and the pilot's screen catches up smoothly.
- `step` must be pure and the same everywhere: the host and the pilot's screen run it on the same inputs and the same blocks, and the pilot's screen starts again from the host's state whenever it arrives. `world` offers `raycast`, `getBlock`, `blockName`, `lineOfSight`, `surfaceY` and `seaLevel`.
- While driving, their body goes with the vehicle (so `player.position` is the vehicle's), and a walking player's figure is hidden. `player.camera.set(...)` takes the camera over (a cutscene, watching after being shot down); `player.camera.follow()` gives it back. `player.leaveVehicle()` gets out.

**Without a vehicle**, drive the camera yourself: `game.camera.set(position, lookAt, up?)` or `setPose(position, quaternion)`, plus `fov`. On a server that camera arrives a round trip late, which is why anything the player steers should be a vehicle.

- **Input:** `game.input.isDown('KeyW')`, `pressed(code)`, `button(0)`, `buttonPressed(2)`, and `mouseX` / `mouseY` / `wheel` deltas while the mouse is captured. A controller's buttons press keys and mouse buttons, and its right stick moves the mouse (see Controllers), so a vehicle steered by the mouse steers with the stick too. Everything reads as idle while paused, so games never need to check. `consume(button | key)` claims an input for the rest of the frame, so the built-in systems (which run after your `update`) ignore it.
- **Math:** `import { math } from '@platform'` gives `Vector3`, `Quaternion`, `Euler`, `Matrix4` and `MathUtils`.
- **Props** are movable objects:
  - `props.model(blueprint, { scale, pivot })` meshes a Blueprint once. The mesh uses the world's block textures, with ambient occlusion, sun shadows and glowing blocks. At `scale: 0.25`, each block is a quarter metre, which is how the Starfighter builds detailed X-wings.
  - `props.spawn(model, { solid })` places a copy; move it through its `position` and `quaternion`. `flash(color)` tints it briefly for hits. `solid: true` makes it something to stand on and ride (see *Ships, lifts and moving platforms* below).
  - `props.bolt({ color, length, width, flicker, far })` is a glowing streak along its -z, for lasers, tracers and engine flames. `flicker` makes it waver on its own; past `far` blocks from each player's camera it grows with the distance, so it stays visible.
  - `prop.attach(parent)`: it rides on another prop (engine flames on a ship, a turret on a tank), its `position` and `quaternion` now on the parent. It goes wherever the parent goes without being moved each tick, and goes when the parent is removed.
  - `prop.launch(from, velocity, { by })`: it flies in a straight line on its own on every screen, and nothing is sent while it does (moving it yourself stops that). `by` the player who fired it: on their screen it leaves their (predicted) guns when they fired.

**HUD for vehicles:**
- `hud.meter(id, label, 0..1, { color })` draws a bar (shields, boost).
- `hud.marker(id, at, { shape: 'box' | 'diamond' | 'ring' | 'reticle' | 'dot', color, size, label, edge, pulse, offset })` draws target brackets and waypoints. `at` is a spot, or something to follow: a prop, an entity or a player, placed by each screen every frame where it draws it (and sent only once). `offset` is in a prop's own space: `{ z: -30 }` is a reticle 30 blocks ahead of a ship's nose. With `edge`, off-screen targets become arrows on the screen edge; `size: { world: n }` scales the marker with distance.
- `hud.radar({ center, heading?, range, blips })` draws a round radar; `center` and each blip's `at` can follow things too, and centred on a prop it turns with it.
- `hud.crosshair(false)` hides the default crosshair.

**Effects and sound:**
- `fx.explosion(at, { size })` makes a fireball, smoke, sparks, a shockwave, sound, and a shake scaled by distance.
- Sounds include `laser`, `laser_enemy`, `explosion`, `explosion_big`, `torpedo`, `lock`, `alarm`, `whoosh` and `flyby`.
- `audio.loop('engine')` returns a handle whose `set({ volume, pitch })` follows the throttle (in steps: a steady engine sends nothing).

`src/games/starfighter/` is the reference: the X-wing is a vehicle (`flight.ts`), the TIEs fly themselves with the same physics, and every pilot has their own HUD.

## Ships, lifts and moving platforms

A block build spawned `solid` is ground you can stand on that moves. Players and creatures bump into it, stand on it, and ride along wherever the game moves and turns it. When it runs into someone, it pushes them out of the way. Shots and lines of sight stop at it, and pickups dropped on it stay on it. Move it through its `position` and `quaternion` like any prop, or with `sweep` to keep it out of the world's blocks; the platform does the rest.

```ts
const lift = game.props.spawn(game.props.model(liftPlan, { pivot: { x: 1.5, y: 1, z: 1.5 } }), { solid: true, position: { x: 0, y: 64, z: 0 } });

update(game, dt) {
  // Up and down between floors; it stops under a ceiling rather than going through it.
  const y = 64 + (Math.sin(game.clock.now * 0.5) + 1) * 8;
  lift.sweep({ position: { x: 0, y, z: 0 } });
}
```

- **Riding.** Whoever stands on it rides it: walking, jumping, standing still or `freeze`d (a helmsman at the wheel, a cutscene). After a jump you land back on the same spot, even as it sails on. Jump or fall off and you keep its speed. `player.riding` and `entity.riding` say which prop someone is on. Put it somewhere far away in one go (8 blocks or more in a tick) and whoever rides it goes along.
- **Online** it's predicted like walking: your own steps on deck answer at once, and you're drawn on the ship where your screen draws it, so the deck never slides under your feet. Your view turns as the ship turns.
- **The world's blocks.** Set `position` / `quaternion` and it goes there, blocks or no blocks. `sweep(to)` moves it the way a walker moves: all the way if that doesn't put more of it into blocks than there is now, or else as far as it can (the turn alone, then one axis at a time, sliding along whatever is in the way). It returns true if it got all the way. It can always back off or turn away from what it's touching. For motion of your own (a ship with speed and turn rates to damp when it hits something), `overlap(at?)` says how many of its blocks would be in the world's blocks at a pose: 0 is clear. Skyship moves its airship in three parts that way: sailing, turning and rising (`sail` in `src/games/skyship/index.ts`).
- **Points on it.** `prop.toWorld(local)` and `toLocal(world)` convert between its own space and the world, through any parent it rides and its scale. That's where a helm, a seat or a spawn point on deck is now.
- **Shape.** Every solid block of the model collides; plants and liquids don't. Low lips and gentle slopes (a deck rolling a few degrees) are walked up without jumping. It stays solid while hidden (`visible = false`), which gives you an invisible wall. `prop.solid = false` turns it off. Only block models can be solid; glTF models can't.
- **Parts.** Props attached to it (`attach`) ride with it too. A solid part attached to a solid ship is solid as well: a turret you can stand on, or a drawbridge that swings.
- **Queries.** `props.raycast(origin, dir, reach)` finds the first solid prop along a ray (a cannonball hitting a hull). `world.lineOfSight` stops at solid props. `world.raycast` still sees only blocks.
- **Not yet:** creatures don't path-find across decks (they walk straight at you there), and vehicles (`player.drive`) don't collide with solid props.

`src/games/skyship/` is the reference: an airship crewed together, built only on the calls above. Whoever takes the helm (E at the wheel on the cabin roof) steers it while frozen at the wheel, and can scroll out to steer from outside (`camera.orbit`, under *Player*). The rest walk the deck, go into the cabin, and jump off onto islands to light beacons, while the ship banks, climbs and bobs under them.

## Entities

```ts
game.entities.define('zombie', {
  name: 'Zombie',
  model: Models.humanoid({ skin: [0, 0], atlas: 'mine' }), // or Models.spider(...); build: 'thin' | 'large', scale, extras
  hitbox: { width: 0.6, height: 1.95 },
  health: 20,
  speed: 3.2,
  ai: Behaviors.melee({ damage: 3, reach: 1.9, cooldown: 1.1, windup: 0.25 }),
  drops: [{ item: 'heart', chance: 0.2 }],
  sounds: { ambient: 'zombie' },
});
const z = game.entities.spawn('zombie', { x: 10, y: 71, z: 0 });
```

- Physics, collision, knockback, flow-field path-finding to the player (around walls, up steps, down drops), line of sight and projectiles run in Rust/WebAssembly for all entities at once.
- Built-in behaviours: `Behaviors.melee`, `Behaviors.ranged` (kites and strafes, leads its shots), `Behaviors.leaper` (pounces) and `Behaviors.all(...)`. They are written against the public `Entity` API (`src/platform/api/behaviors.ts`), so copy one and change it.
- Custom AI is a function `(self, game, dt) => void`. It can call `self.nearestPlayer()`, `moveTo(player | point)`, `moveDirection(x, z)`, `stop`, `jump`, `lookAt(player | entity | point)`, `canSee(…)`, `distanceTo(…)`, `animate('attack' | 'raise' | 'cast')`, `glow(color)`, `shoot(projectile, player | entity | point, { lead })`, `impulse`, `setSpeed` and `damage`, and keep state in `self.data`. The Warden in `src/games/arena/content.ts` is a complete boss state machine: telegraphed slams, fireballs, summons and an enrage phase.
- `boss: true` shows a boss bar automatically. Hurt flashes, damage numbers, blood particles, death animations, drops and positional sounds are handled for you.
- Queries: `entities.all(type?)`, `count(type?)`, `near(point, radius)`, `clear()`.
- `invulnerable: true` ignores all damage (shopkeepers, scenery). `entity.armor` (0..20) reduces damage like the player's. `entities.raycast(origin, dir, reach)` finds the one under a crosshair; the `interactions` kit turns that into right-click-to-talk.
- Mobs can fight each other and build: `other.damage(n, { source: self })` hurts another entity with the right knockback and kill credit, and the building kit's `placeBlock(x, y, z, 'red_wool', self)` / `breakBlock` let them bridge and dig under the game's block rules. The Bed Wars bots (`src/games/bedwars/bots.ts`) are built that way: they fortify their bed, gather and shop, find routes across the void (bridging as they go) and through defences (digging), and fight.

Box models use the Minecraft skin UV layout, so any 64×64 humanoid skin works. The only built-in skin is `Skins.player`; mobs come from your own atlas. `extras` adds parts of your own to a humanoid (the Warden's crown is one, with `parent: 'head'`).

## glTF and GLB models

Models made in Blockbench or Blender (`.gltf` with its textures inside, or `.glb`) work as props and as figures. Import the file with `?url` so the build ships it, then use its address:

```ts
import slotUrl from './models/slot_machine.gltf?url';
import guardUrl from './models/guard.glb?url';

// A prop: spawn copies like a block build's, and loop one of its animations if it has any.
const slot = game.props.gltf(slotUrl, { animation: 'spin' });
const machine = game.props.spawn(slot, { position: { x: 4, y: 64, z: 0 } });
machine.play(null); // or another of its animations

// A figure: which of its animations play when, the node that looks and the one that holds.
game.entities.define('guard', {
  name: 'Guard',
  model: Models.gltf(guardUrl, { clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'swing' }, head: 'head', hand: 'right_arm', yaw: Math.PI }),
  hitbox: { width: 0.8, height: 1.9 },
  health: 30,
  speed: 3,
  ai: Behaviors.melee({ damage: 4 }),
});
```

- They're drawn like the platform's own models: sun and shadows, sky and torch light where they stand, fog, the hurt flash and the fade on death. The file supplies the geometry, the textures (pixel art stays sharp), an emissive texture if it has one, and the animations; other material settings are ignored.
- A figure plays `walk` as it moves, in step with the ground it covers, and `run` (if it has one) when it goes faster than its usual `speed`. It plays `idle` when it stands. Missing clips fall back: `run` to `walk`, `walk` to `idle`. `attack` plays once for each swing (`self.animate('attack')`, or a melee hit), on top of whatever else it's doing, and `cast` while it casts or winds up. A list plays several together, for models split into upper and lower body: `walk: ['walk_upper', 'walk_lower']`.
- Which way it faces: glTF models face +z, and figures walk that way. Blockbench models face -z (north), so give them `yaw: Math.PI`; turn props with their `quaternion`.
- A node named `hitbox` (a collision box some exporters add) is never drawn; `hide: ['name', …]` hides others.
- Each player's screen fetches the files itself, as soon as the game names them, and Play waits until they're here. The host never opens them, so give a prop's `radius` if your game needs one.

**Players and items.** Players can be a model too, and items can be held as one:

```ts
player: { model: Models.gltf(heroUrl, { clips: { idle: 'idle', walk: 'walk', run: 'run', attack: 'attack' }, head: 'head', hand: 'right_arm' }) },

game.items.define('cutlass', {
  kind: 'melee', name: 'Cutlass', damage: 6,
  icon: { gltf: cutlassUrl },                                          // a picture of the model
  hold: { model: HeldModels.gltf(cutlassUrl, { grip: [0, 0, 2] }) },   // held as the model
});
```

- Others see each player as the model, walking, running, swinging and holding what's in their hand at the model's `hand` node; `player.setModel(model)` gives one player their own (null: back to the game's). With a `hand` node, the player's own first-person arm is that part of the model.
- A held model should run along +z to its tip with its handle near the origin, like the built-in ones; `rotation` (degrees about X, Y, Z) and `scale` fix one that doesn't, and `grip` is the point in the fist (in pixels, a sixteenth of a block). It's drawn in first person with the item's hold style (`sword`, `axe`, …), in other players' hands, and lying on the ground.
- `icon: { gltf: url }` draws the item's icon from the model (a small picture from above and to the side, like an inventory's); an item whose icon is a model and has no `hold.model` is held as that model.
- **Humanoids.** A figure built on the platform's humanoid rig needs no animations. The rig is a joint per part named `hips`, `spine`, `chest`, `neck`, `head`, `upperArmR`, `lowerArmR`, `handR` and so on, with `gripR` and `gripL` marking where the fists hold (`docs/HUMANOID.md` has the joints and the rest pose). The platform animates it in code from what it's doing:
  - Its feet stay planted and step the way it's going, walking, running, strafing or backpedalling, and its legs bend to reach them.
  - It crouches, slides, jumps and looks.
  - It holds a gun in both hands, aimed where it looks, with its fists on the gun's `grip` and `grip2`. It carries the gun low across its chest to sprint, tips it to reload while the support hand fetches a magazine, and kicks with each shot.
  - It swings a sword two-handed and falls when it dies.
  - A player on such a model sees its own forearms and fists on the gun in first person. `firstPerson` fits them to the model: `Models.gltf(url, { rig: 'humanoid', firstPerson: { scale: 1.2, reach: [0.55, 0.72], support: [0.01, -0.012, 0] } })` (those are the defaults): `scale` times life size (a little bigger reads better round a gun), how far the firing and support arms `reach` from the fist to leave the screen (blocks), and where the `support` fist sits from the handguard's near side (the model's blocks, along the gun: out to the side we see, up, toward the muzzle). It goes with the model, so each player's (`player.setModel`) brings its own.
  - Give `rig: 'humanoid'` in `Models.gltf`, or leave out `clips` and a model with the joints is taken to be one. `tools/rig.html?model=<url>` (in development) shows a model in a row of poses, and `scripts/mannequin.mjs` builds a plain one to start from.
- **Materials.** glTF's metallic-roughness is honoured, as factors or a `metallicRoughnessTexture` (G roughness, B metalness). Metal and glossy parts catch the sun and reflect the sky, on figures, held items (only a held model's first material is used) and in the first-person hand. Fully rough non-metal materials, like Blockbench's defaults, look as they always have.
- `tests/headless/_export-models.ts` writes Blockyard's own box models out as glTF files (a node per part, the skin, and their walk, run and swing as animations). Open one in Blockbench, change it, and load it back.
- In development, `?game=gallery` shows a room of glTF props, figures, a player model and glTF items (`src/games/gallery/`); `npm run server -- gallery` hosts it for several players.

## Your own art and sound

The platform ships only generic basics. A game brings its own look and sound, and nothing about it goes into the core.

**Art.** Register an atlas, then refer to it anywhere a sprite, skin or held model is expected:
- `game.items.atlas('mine', canvas)` takes any canvas (draw with Canvas 2D, or load an image into it).
- `game.items.atlas('mine', { width, height, pixels, emissive })` takes raw sRGB RGBA pixels and an optional glow map (one byte per texel). Glow is how eyes, fire and crystals shine in the dark.
- Use `{ atlas: 'mine', x, y }` as a sprite, or `Models.humanoid({ skin: [x, y], atlas: 'mine' })` for a skin.

**Painting in code.** `@platform/art` is a small pixel-art toolkit: a 256×256 `Canvas` with `paintBox` (a Minecraft box-UV region with per-face shading), `px` / `part`, noise helpers and an emissive channel, finished into the raw pixels `items.atlas` takes:

```ts
import { Canvas, ATLAS } from '@platform/art';
const cv = new Canvas();
// … paint skins at their origins and 16×16 sprites in their cells …
const { albedo, emissive } = cv.finish();
game.items.atlas('mine', { width: ATLAS, height: ATLAS, pixels: albedo, emissive });
```

The Arena paints its whole atlas this way (`src/games/arena/art/`): five mob skins, weapon sprites and the pike's texture, with bevelled pixel-art shading, in about 50 ms at startup. Bed Wars paints four team skins, a shopkeeper and its item sprites the same way.

**Sound.** `game.audio.define(name, voice)` adds a sound; play it like any other with `audio.play(name, { at })`. Voices are synthesised on each play, on each player's machine:

```ts
game.audio.define('laser', (s) => {
  s.tone({ wave: 'square', from: 2400 * s.pitch, to: 260 * s.pitch, duration: 0.17, volume: 0.22, lowpass: 3800 });
  s.noise({ duration: 0.03, filter: 'highpass', from: 5000, to: 3000, volume: 0.15 });
});
```

- `s.tone` is an oscillator sweep with an envelope and optional lowpass, bandpass (which can sweep: `bandpass: { freq, to, q }`) or vibrato. Starfighter's TIE howl is three detuned, wavering sawtooths through a sweeping bandpass.
- `s.noise` is filtered noise with a sweeping filter.
- `s.pitch` is the play's pitch: multiply frequencies by it.
- Your game runs away from the player's speakers (in a worker, or on a server), so a voice is sent to them as the tones and noises it makes, recorded at two pitches. Build voices only from `s.tone` and `s.noise`; a little randomness in a voice is fixed at the recording.
- The built-in sounds (`BuiltinSound`) are the generic ones the platform's own systems use (swing, hit, hurt, bow, pickup, explosion, UI stingers).

## Keeping data

`game.store` keeps values across restarts: all-time stats, leaderboards, unlocks. On a game server it's in the server's database; in single-player, in the browser. Values are anything JSON can hold, and they're copies (changing an object you got doesn't change what's kept until you `set` it again). Keep per-player values under the player's name:

```ts
const key = `stats:${player.name}`;
const s = game.store.get<{ wins: number }>(key) ?? { wins: 0 };
s.wins++;
game.store.set(key, s);
game.store.keys('stats:'); // everyone's, for a leaderboard
```

Bed Wars counts each player's games, wins, kills, final kills and beds this way and shows the all-time numbers on its result screen.

## Commands

Press `/` or `T` in any game to open the command bar. Tab completes command names, item ids and entity types, Up and Down walk the history, and the game pauses while it's open.

The built-in cheats are available in development builds, or in production if the game sets `cheats: true`:

| Command | |
| --- | --- |
| `/give <item> [count]` | Put an item in your hand |
| `/spawn <entity> [count]` | Spawn creatures in front of you |
| `/tp <x> <y> <z>` | Teleport (`~` is relative, e.g. `~ ~10 ~`) |
| `/time <day\|noon\|dusk\|night\|midnight\|0..1>` | Set the time of day |
| `/heal`, `/kill`, `/fly` | Full health, kill every creature, toggle flight |
| `/help` | List commands |

Games add their own (they're always available, including in production):

```ts
game.commands.register('wave', {
  usage: '<n>',
  help: 'Skip to a wave',
  complete: () => ['1', '2', '3', '4', '5', '6'],
  run: ([n]) => {
    if (!n) throw new Error('Which wave?'); // shown in red, with the usage
    startWave(Number(n));
    return `Wave ${n}`;
  },
});
game.commands.run('/give pike'); // run one from code
```

`run(args, game, player)` gets the player who typed it; the built-in cheats act on them.

## Presentation

| API | What |
| --- | --- |
| `hud.banner(title, sub?)` | Big centred title |
| `hud.objective(text)` | Status pill at the top |
| `hud.stat(id, label, value)` | Corner chips (kills, timers) |
| `hud.bossBar(name, fraction)` | Manual boss bar |
| `hud.toast(text)` | Small toast (one at a time) |
| `hud.progress(0..1, { color })` | A ring round the crosshair (mining, charging, capturing) |
| `hud.feed(text, { color })` | A line in the message feed at the top left (kill feeds, match events); lines stack and fade |
| `hud.screen({ title, tone, stats, buttons })` | Modal victory / defeat / menu |
| `hud.menu({ title, subtitle, sections: [{ title, entries }] })` | A panel of clickable entries (shops, upgrades, level select) while the game keeps running. Entries take an `icon` (a sprite or `{ block }`), `label`, `detail` (a price), `note`, `disabled`, `active` and `onSelect`; `update()` refreshes it after a purchase. Esc or E closes it |
| `hud.meter`, `marker`, `radar`, `crosshair` | Vehicle HUD (see above); markers and radar blips can follow props, entities and players; a marker's `bar` draws a bar under its label |
| `hud.pop(text, { big, sub, color })` | A short pop-up under the crosshair ("+100", "Headshot", "Double kill") |
| `hud.scoreboard({ title, columns, rows, footer, show })` | The scoreboard players see while holding Tab (or kept up with `show`); a row naming a `player` is highlighted on their screen |
| `hud.feed([...parts])` | A feed line can be parts: text, `{ text, color }`, `{ icon }` (a gun side on: `{ gltf: url, view: 'side' }`) |
| `fx.burst`, `shake`, `flash`, `shockwave`, `damageNumber`, `fireworks`, `explosion` | Effects |
| `audio.play(name, { at })`, `audio.define(name, voice)`, `audio.loop(name)` | Synthesised, positional sound effects (built-in or your own) and continuous engine / wind loops |
| `env.time`, `env.frozen` | Time of day |
| `events.on('entityDeath' \| 'entityDamage' \| 'playerDamage' \| 'playerDeath' \| 'pickup' \| 'blockBreak' \| 'blockPlace' \| 'playerJoin' \| 'playerLeave', fn)` | Events (player events name the `player`) |
| `rng` | Seeded random numbers |

**The HUD's look.** `hud` on the game definition sets how the HUD looks on every screen:

```ts
hud: {
  health: 'bar',          // or Minecraft's 'hearts' (default), or 'none'
  healthBars: true,       // bars over other players' (and creatures') heads
  nameTags: 'sight',      // names only while nothing blocks the view ('always' by default, or 'never')
  theme: {
    display: "'Bangers', Impact, sans-serif",   // titles, banners, big numbers
    text: "'Archivo', system-ui, sans-serif",
    fonts: ['Bangers', 'Archivo'],              // fetched from Google Fonts
    colors: { accent: '#ffcc00', ink: '#111', paper: '#fdf1d6', text: '#111', danger: '#e63946', good: '#ffcc00' },
    comic: true,                                // ink outlines, hard shadows, paper panels
  },
},
```

## Testing a game headless

Your game can run in Node with no browser, no GPU and no rendering. A bot plays it at 100–200× real time, and the result is the same every run with the same seed. Tests live in `tests/headless/` and run with `npm run test:headless`:

```ts
import { check, launch, lastScreen } from './_harness';

export default function myGame() {
  const h = launch('my-game', { seed: 7 }); // set up and started, as if Play was clicked
  const game = h.ctx;                       // the same GameContext your game gets
  h.run(300, {                              // up to 5 minutes of game time
    pilot: () => ({ down: ['KeyW'], clicked: 1, yaw: 0, pitch: 0 }), // the player's controls each tick
    until: () => lastScreen(h) !== undefined,                        // stop when a result screen opens
  });
  check(lastScreen(h) === 'Victory!', 'expected a win');
  check(game.player.alive, 'the player died');
}
```

- `h.run(seconds, { pilot, until, dt })` steps the simulation at 60 ticks per second. `h.step(dt, input)` steps once.
- `pilot` returns the local player's controls as a `PlayerInput`: `down` for keys held, `pressed` for keys pressed this tick, `clicked` for the buttons clicked this tick as a bitmask (1 = left), and `yaw` / `pitch` to aim. Return `{}` to stand still.
- `h.calls` records every presentation call (banners, feeds, screens, sounds), and `h.find('hud', 'banner')` filters them. `lastScreen(h)` is the title of the last `hud.screen`.
- `h.sim` is the whole simulation, for looking at pickups (`h.sim.items.frame()`) or players (`h.me.state`).

`tests/headless/arena.ts` is a complete example: a bot beats the Arena, Warden included, in under a second.

For online play there are probes rather than tests: `tests/headless/_netprobe.ts` measures what each game sends a player each second (`GAME=starfighter PLAYERS=4`), `tests/headless/_ghost.ts` is a player with no screen that joins a server and flies circles (to watch how smoothly others move), and `scripts/lagproxy.mjs` puts a bad network between a browser and a server.

## Architecture and the road to multiplayer

```
┌──────────── games (TypeScript, only @platform) ────────────┐
│ rules · content · AI behaviours · HUD choreography          │
├──────────── kits + art toolkit (optional, only @platform) ──┤
│ survival building · interactions · pixel-art painter        │
└──────────────────────── GameContext ───────────────────────┘
┌──────────── host: GameHost (a Web Worker; Node; a server) ──┐
│ Sim: players · entities · items · combat · props · commands │
│ its own world, generated around the players                 │
└──── PlayerInput in ▲   ▼ content · calls · edits · frame ───┘
┌──────────── client (TypeScript + three.js) ────────────────┐
│ camera · entity / pickup / prop views · presenter           │
│ HUD · audio · FX · renderer (WebGL2) · chunk streaming      │
└─────────────── flat buffers / wasm-bindgen ────────────────┘
┌──────────── engine (Rust → WebAssembly) ───────────────────┐
│ worldgen + blueprints · lighting · meshing · culling        │
│ world store · player + entity physics · path-finding        │
│ projectiles · raycasts                                      │
└──────────────────────────────────────────────────────────────┘
```

Your game runs inside the **simulation**, and everything it does reaches players as plain data:

- **Input in.** Each tick the simulation gets one `PlayerInput` per player: keys held and pressed, buttons, wheel and view angles. `player.input` reads that snapshot. The client owns mouse look. When the game turns a player (`teleport`, `camera.lookAt`), the view carries a sequence number, so a client's stale angles can't override it.
- **Frames out.** After each tick the simulation produces a `SimFrame`: every player's position, pose, health, hotbar, held item, camera and vehicle, plus entities, projectiles, pickups and props. The client draws only from frames.
- **Presentation calls out.** `hud`, `fx`, `audio` and the view model are proxies. Each call becomes a `PresentCall` addressed to one player (`player.hud`) or to everyone (`game.hud`). Menu entries, buttons and other callbacks go out as ids and come back as `ClientMessage`s, which call your function inside the simulation.
- **Content by name.** Sounds, atlases, animations, entity and item definitions, and prop models go into a shared `Content` registry, so a frame only has to name them.

A `GameHost` runs the simulation on a world of its own, generated around the players (every player has a physics body in it, by slot), and answers each tick with a batch: the content your game defined since the last one, presentation calls, block edits, then the frame. In the browser the host runs in a Web Worker, so your game's logic never costs the renderer a frame. The page is only the client: it sends one tick per frame with the player's controls, draws the newest frame, and mirrors the host's block edits into its own world for meshing (and for saves). In Node, `Headless` (`src/platform/host/headless.ts`) wraps the same `GameHost` with no client at all; that's what the headless tests run on. The game server (`src/platform/host/server.ts`) hosts it too, for many clients over WebSockets, each game in a worker thread of its own (`host/room.ts`, `host/room-worker.ts`; the production bundle is also the worker): it keeps its own clock, merges each client's controls between steps, sends each client only the calls meant for everyone or for them, and catches late joiners up with the game's content, the world's edits and what's on everyone's screen. Over a socket each frame goes as a patch on the one before (`net/delta.ts`: only the fields and records that changed, numbers rounded to a tenth of a millimetre), and the sockets are compressed, so a game costs each player a few kilobytes a second. Clients play the server's frames back about two steps behind, blending positions, so movement is smooth although frames arrive unevenly. Their own player they predict instead: each input moves them at once, with the same movement step the server takes (`sim/movement.ts`), goes to the server numbered, and is moved again there input by input; frames say which input was applied last, so the client starts again from the server's state and replays the rest. Same code on the same blocks lands in the same place, so a correction only shows when the server did something the client couldn't know about. Vehicles are predicted the same way, with the game's own `step`. The server plays each client's inputs at the pace they were made, keeping a few in hand so ones that arrive late don't make the player lurch on everyone else's screen, and says how far each player's state trails the step (whole inputs rarely fill one exactly) so other screens draw them where they are. Game code that throws (a timer, `update`, an entity's AI) is reported to the players and the game carries on. Presentation calls that set something lasting (an objective, a stat, a marker, the block highlight) are only sent when they change, which is what keeps a game's traffic small. Kits only talk to `GameContext` too, so they come along unchanged; that's another reason systems like building live in kits rather than inside the runtime.

On the engine side, the simulation core (`gen.rs`, `world.rs`, `entities.rs`, `blocks.rs`) is plain Rust with no wasm-bindgen types. A native server can link the same crate and generate identical worlds from the same seed and blueprints. Entity state lives in flat `f64` buffers (layout documented in `entities.rs`) that serialise directly into snapshots. Rendering, chunk meshing, lighting and culling stay on the client.

What this means when you write a game:

- Your game runs in a worker: there is no `document` or `window`, and nothing to draw on directly. Keep state in the game module or on entities, and put things on screen only through `hud`, `fx`, `audio` and models. Paint atlases with `@platform/art` (pixels), not a canvas.
- `console.log` from your game shows in the browser's console as usual. To poke at your game from the console, open it with `?host=page`: the host runs in the page and `__game.context` is your `GameContext`.
- Use `player.hud` for things only that player should see, such as a shop, a wallet or a death screen. Use `game.hud` for match-wide banners and objectives.
- Write for any number of players: iterate `game.players`, target `entity.nearestPlayer()`, and use the `player` passed to callbacks and events. `game.player` is only a convenience for single-player games.
