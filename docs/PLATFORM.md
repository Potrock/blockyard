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

At runtime, `game.world` exposes `getBlock`, `setBlock` (lighting and meshing update automatically), `raycast`, `lineOfSight`, `surfaceY`, `blockId`, `blockName`, `seaLevel`, and `explode(center, radius)`, which blasts a ragged hole (all the affected chunks remesh together) with debris and an explosion. `breakBlock(x, y, z, { by })` and `placeBlock(x, y, z, block, { by })` break and place with debris, sound and the `blockBreak` / `blockPlace` events, and won't place a block inside anyone; `setBlock` is the silent version. `blockInfo(block)` tells you whether a block is solid, a liquid, a plant or replaceable. The building kit (below) puts these together into survival mining and placing. Block names are listed in `engine/src/blocks.rs` (`stone`, `grass_block`, `oak_planks`, `glowstone`, `water`, the wools, `end_stone`, the four team beds…).

## Player

`player` options: `build` (creative: break and place blocks from a block hotbar; for survival building see the `building` kit), `fly`, `health` (half-hearts; `false` = invulnerable), `regen`, `fallDamage`, `hotbar: 'blocks' | 'items'`, `skin` (a Minecraft-layout skin, default `Skins.player`; it's also the first-person arm), and `controller`:
- `'walk'` (default) is the first-person player.
- `'none'` removes the walking body, hand and hotbar. The game drives the camera and reads the controls itself, which is what vehicles, flight and top-down games need (next section). `player.position` then stays wherever you last `teleport` it: that's the point mobs chase and pickups fly to, so move it with your vehicle if you use those, and ignore it if you don't.

`game.player` (one of `game.players`, see "Players and multiplayer") gives you `position`, `eye`, `look`, `velocity`, `onGround`, `health` and `maxHealth` (both writable), `armor` (0..20 points, each blocking 4% of damage, like Minecraft's), `damage(amount, { source, knockback, from })`, `heal`, `revive`, `teleport`, `impulse` and `freeze`, plus `inventory` (`give`, `take`, `count`, `select`, `clear`; nine slots) and `viewModel` (see below). Picking up a better-ranked weapon auto-equips it and replaces the weakest weapon if the hotbar is full.

## Players and multiplayer

Games are written so the same code works with one player or many:

- **`game.players`** lists everyone playing. A single-player game has exactly one, and **`game.player`** is that player, which is why single-player games can keep using `game.player`, `game.hud`, `game.input` and `game.camera` as they are.
- **Each player** has an `id`, a `name`, their own `inventory`, `health` and `viewModel`, and their own screen and controls: **`player.hud`** reaches only them (their wallet, their shop, their toasts), **`player.audio`** plays sounds only they hear, `player.input` is their keyboard and mouse, `player.camera` their camera. **`game.hud`** is everyone's screen (banners, the scoreboard), `game.audio` everyone's speakers.
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
http://localhost:5173/?server=ws://localhost:8787&name=Ann
```

The server runs the game at 30 steps a second whether or not anyone's watching a given frame. The first to join is `game.player`; everyone else arrives at the spawn and the game hears `playerJoin`. When the first player leaves, the next to join takes their place, so `game.player` always works. Everyone sees everyone else as a figure with their name above it, wearing the game's player skin (or their own, `player.setSkin`). Your own movement is predicted: it happens the moment you press a key, and the server's word only corrects it when something you couldn't know about happened (a knockback, a teleport). A restart (from any player's pause menu or a "Play again" button) restarts the game for everyone. `game.exit()` sends back to the launcher only the player whose button or command called it.

**What a server keeps.** Each server has a SQLite database (`data/<game>.sqlite`, or `--db path`). It holds the world's seed, so restarting the server carries on the same world; for games that keep their world (`world.persist`, like Sandbox) its builds and time of day, and each player's place by name (where they stood, which way they faced, whether they were flying, their block hotbar); and your game's `game.store`. It's saved every 30 seconds, when a player leaves, and when the server stops (Ctrl-C). `--new` starts a fresh world and sets the old database aside. Names aren't checked yet: whoever joins as Ann gets Ann's place, and a second Ann at the same time becomes "Ann 2".

How a single-player game behaves with company depends on how it's written: a game that only talks to `game.player` gives the others a world to walk around in, while one that uses `game.players`, `player.hud` and the named player in callbacks works for everyone.

## Items

```ts
game.items.define('iron_sword', { kind: 'melee', name: 'Iron Sword', icon: 'iron_sword', damage: 6.5, cooldown: 0.42, reach: 3.5, rank: 3, hold: { model: HeldModels.ironSword } });
game.items.define('bow', { kind: 'bow', name: 'Bow', icon: 'bow', drawIcon: 'bow_pulling', ammo: 'arrow', damage: [2, 9], drawTime: 0.9, speed: 42 });
game.items.define('potion', { kind: 'consumable', name: 'Potion', icon: 'health_potion', hold: { model: HeldModels.healthPotion }, stack: 4, use: (g, player) => (player.heal(10), true) });
game.items.spawnPickup('iron_sword', pos, { beam: '#ffd36b' });
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
- **`world.breakBlock` / `placeBlock`** break and place with debris, sounds and the `blockBreak` / `blockPlace` events (`{ x, y, z, block, by }`), and won't place a block inside anyone. They don't know your rules: that's the kit's job, or yours. **`world.blockInfo(block)`** says whether a block is solid, a liquid, a plant or replaceable.
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

With `player: { controller: 'none' }`, the world streams around wherever the camera is.

- **Camera:** `game.camera.set(position, lookAt, up?)`, or `setPose(position, quaternion)`, plus `fov`. Read `position` and `forward`. Set it in `update` and it's used that same frame.
- **Input:** `game.input.isDown('KeyW')`, `pressed(code)`, `button(0)`, `buttonPressed(2)`, and `mouseX` / `mouseY` / `wheel` deltas while the mouse is captured. Everything reads as idle while paused, so games never need to check. `consume(button | key)` claims an input for the rest of the frame, so the built-in systems (which run after your `update`) ignore it.
- **Math:** `import { math } from '@platform'` gives `Vector3`, `Quaternion`, `Euler`, `Matrix4` and `MathUtils`.
- **Props** are movable objects:
  - `props.model(blueprint, { scale, pivot })` meshes a Blueprint once. The mesh uses the world's block textures, with ambient occlusion, sun shadows and glowing blocks. At `scale: 0.25`, each block is a quarter metre, which is how the Starfighter builds detailed X-wings.
  - `props.spawn(model)` places a copy. Move it through its `position` and `quaternion` every frame; `flash(color)` tints it briefly for hits.
  - `props.bolt({ color, length, width })` is a glowing streak along its -z, for lasers, tracers and engine flames.

```ts
const tie = game.props.model(tieBlueprint, { scale: 0.25 });
const ship = game.props.spawn(tie, { position: { x: 0, y: 120, z: 0 } });
// every frame:
ship.position.addScaledVector(forward, speed * dt);
ship.quaternion.setFromEuler(new math.Euler(pitch, yaw, roll, 'YXZ'));
game.camera.set(behind, ship.position);
```

**HUD for vehicles:**
- `hud.meter(id, label, 0..1, { color })` draws a bar (shields, boost).
- `hud.marker(id, worldPos, { shape: 'box' | 'diamond' | 'ring' | 'reticle' | 'dot', color, size, label, edge, pulse })` draws target brackets and waypoints. With `edge`, off-screen targets become arrows on the screen edge; `size: { world: n }` scales the marker with distance.
- `hud.radar({ center, heading, range, blips })` draws a round radar.
- `hud.crosshair(false)` hides the default crosshair.

**Effects and sound:**
- `fx.explosion(at, { size })` makes a fireball, smoke, sparks, a shockwave, sound, and a shake scaled by distance.
- Sounds include `laser`, `laser_enemy`, `explosion`, `explosion_big`, `torpedo`, `lock`, `alarm`, `whoosh` and `flyby`.
- `audio.loop('engine')` returns a handle whose `set({ volume, pitch })` follows the throttle.

`src/games/starfighter/` is the reference.

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
| `hud.meter`, `marker`, `radar`, `crosshair` | Vehicle HUD (see above) |
| `fx.burst`, `shake`, `flash`, `shockwave`, `damageNumber`, `fireworks`, `explosion` | Effects |
| `audio.play(name, { at })`, `audio.define(name, voice)`, `audio.loop(name)` | Synthesised, positional sound effects (built-in or your own) and continuous engine / wind loops |
| `env.time`, `env.frozen` | Time of day |
| `events.on('entityDeath' \| 'entityDamage' \| 'playerDamage' \| 'playerDeath' \| 'pickup' \| 'blockBreak' \| 'blockPlace' \| 'playerJoin' \| 'playerLeave', fn)` | Events (player events name the `player`) |
| `rng` | Seeded random numbers |

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
- **Frames out.** After each tick the simulation produces a `SimFrame`: every player's position, pose, health, hotbar, held item and camera, plus entities, projectiles, pickups and props. The client draws only from frames.
- **Presentation calls out.** `hud`, `fx`, `audio` and the view model are proxies. Each call becomes a `PresentCall` addressed to one player (`player.hud`) or to everyone (`game.hud`). Menu entries, buttons and other callbacks go out as ids and come back as `ClientMessage`s, which call your function inside the simulation.
- **Content by name.** Sounds, atlases, animations, entity and item definitions, and prop models go into a shared `Content` registry, so a frame only has to name them.

A `GameHost` runs the simulation on a world of its own, generated around the players (every player has a physics body in it, by slot), and answers each tick with a batch: the content your game defined since the last one, presentation calls, block edits, then the frame. In the browser the host runs in a Web Worker, so your game's logic never costs the renderer a frame. The page is only the client: it sends one tick per frame with the player's controls, draws the newest frame, and mirrors the host's block edits into its own world for meshing (and for saves). In Node, `Headless` (`src/platform/host/headless.ts`) wraps the same `GameHost` with no client at all; that's what the headless tests run on. The game server (`src/platform/host/server.ts`) hosts it too, for many clients over WebSockets: it keeps its own clock, merges each client's controls between steps, sends each client only the calls meant for everyone or for them, and catches late joiners up with the game's content, the world's edits and what's on everyone's screen. Clients play the server's frames back about two steps behind, blending positions, so movement is smooth although frames arrive unevenly. Their own player they predict instead: each input moves them at once, with the same movement step the server takes (`sim/movement.ts`), goes to the server numbered, and is moved again there input by input; frames say which input was applied last, so the client starts again from the server's state and replays the rest. Same code on the same blocks lands in the same place, so a correction only shows when the server did something the client couldn't know about. Game code that throws (a timer, `update`, an entity's AI) is reported to the players and the game carries on. Presentation calls that set something lasting (an objective, a stat, a marker, the block highlight) are only sent when they change, which is what keeps a game's traffic small. Kits only talk to `GameContext` too, so they come along unchanged; that's another reason systems like building live in kits rather than inside the runtime.

On the engine side, the simulation core (`gen.rs`, `world.rs`, `entities.rs`, `blocks.rs`) is plain Rust with no wasm-bindgen types. A native server can link the same crate and generate identical worlds from the same seed and blueprints. Entity state lives in flat `f64` buffers (layout documented in `entities.rs`) that serialise directly into snapshots. Rendering, chunk meshing, lighting and culling stay on the client.

What this means when you write a game:

- Your game runs in a worker: there is no `document` or `window`, and nothing to draw on directly. Keep state in the game module or on entities, and put things on screen only through `hud`, `fx`, `audio` and models. Paint atlases with `@platform/art` (pixels), not a canvas.
- `console.log` from your game shows in the browser's console as usual. To poke at your game from the console, open it with `?host=page`: the host runs in the page and `__game.context` is your `GameContext`.
- Use `player.hud` for things only that player should see, such as a shop, a wallet or a death screen. Use `game.hud` for match-wide banners and objectives.
- Write for any number of players: iterate `game.players`, target `entity.nearestPlayer()`, and use the `player` passed to callbacks and events. `game.player` is only a convenience for single-player games.
