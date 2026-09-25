# Blockyard

A voxel game platform that runs in the browser. The engine gives you a Minecraft-style world that is already built: an endless procedural world, lighting, a shader pipeline, physics, entities, items, combat, audio and UI. A game on top of it is a single TypeScript module that only describes rules and content.

The compute-heavy work (terrain generation, lighting, meshing, physics, path-finding, projectiles, raycasting, visibility culling and shadow-camera math) is Rust compiled to WebAssembly. three.js on WebGL2 does the rendering, through a custom shader pipeline.

![Arena: the Warden](docs/arena-fight.png)

| The colosseum | Sandbox at sunset |
| --- | --- |
| ![Arena overview](docs/arena-overview.png) | ![Sunset](docs/sunset.png) |

![Starfighter: the opening shot, a dogfight by the Star Destroyer, a strafing run on a shield generator, the break-up](docs/starfighter.png)

![Bed Wars: the sky-island map, and the view from the red base with a full hotbar](docs/bedwars.png)

![Skyship: the airship moored off Home Isle](docs/skyship.png)

![First-person view: diamond sword mid-slash, battle axe, two-handed pike, health potion](docs/viewmodel.png)

## Games

| Game | URL | What it is |
| --- | --- | --- |
| **Arena** | `?game=arena` | Six waves of zombies, skeleton archers, spiders and brutes in a colosseum, then the Warden boss. Weapons drop on the dais between waves: bow, stone/iron/diamond swords, a two-handed pike, battle axe and potions. Online it's co-op: more fighters bring more monsters, each gets their own reward, and anyone who falls sits the wave out. About 640 lines, including the colosseum and the boss AI. |
| **Starfighter** | `?game=starfighter` | A Star Fox-style dogfighter with block-built X-wing, TIE fighter and TIE interceptor. Fight two waves of TIEs over the sea, then take on a 200-block Star Destroyer built into the world: knock out its two shield generators and blow up the bridge. Mouse to fly, W/S boost and brake, Q/E barrel roll (deflects lasers), right-click proton torpedoes. Online it's a squadron: an X-wing each (Red Five, Red Two…), more TIEs for more pilots, and anyone shot down is back in a new ship after 12 seconds. The X-wing is a vehicle (`player.drive`), so it flies at once on your own screen however far away the server is. |
| **Skyship** | `?game=skyship` | Crew an airship across the sky islands and light the five beacons. The airship is a solid prop that sails, turns, banks and bobs, and everyone walks its decks while it does: up to the roof, into the cabin, off onto an island and back aboard. Whoever takes the helm (E at the wheel) steers with W/S, A/D and Space/Shift, and can scroll out to steer from outside. Online, the whole party is the crew. |
| **Bed Wars** | `?game=bedwars` | Hypixel-style Bed Wars on sky islands, against bots or up to three friends (`npm run server -- bedwars`): each player gets their own team, bots play the rest, and someone joining mid-match takes over a bot's team. Collect iron and gold from your generator (diamonds and emeralds on the outer and middle islands), buy blocks, swords, armour, tools, fireballs and team upgrades from the shopkeeper, bridge across the void and break the other beds. You respawn only while your bed stands. The bots fortify, shop, bridge, dig through defences and fight each other as well as you. |
| **Sandbox** | `?game=sandbox` | Creative building in an endless world. Edits are saved per seed. 17 lines. |
| **Heart Hunt** | `?game=heart-hunt` | A gentle hunt for ten hidden hearts, and the tutorial game (about 70 lines; see docs/PLATFORM.md). |

The title screen lists every registered game. The pause menu offers restart and exit.

**To write your own game, read [docs/PLATFORM.md](docs/PLATFORM.md).** In short:

```ts
import { defineGame, Blueprint, HeldModels, Models, Skins, Behaviors } from '@platform';

// A ring wall, stamped into the world during generation.
const ring = new Blueprint({ x: -12, y: 70, z: -12 }, { x: 25, y: 4, z: 25 });
ring.columns(0, 0, 12, (x, z, d) => d > 11 && ring.fill({ x, y: 70, z }, { x, y: 73, z }, 'stone_bricks'));
let won = false;

export default defineGame({
  id: 'my-game',
  title: 'My Game',
  world: {
    structures: [ring],
    terraform: [{ x: 0, z: 0, radius: 14, blend: 16, height: 69.5 }],
    spawn: { x: -6, y: 71, z: 0.5 },
    spawnYaw: -Math.PI / 2, // face +x
  },
  player: { health: 20, hotbar: 'items' },
  setup(game) {
    game.items.define('iron_sword', {
      kind: 'melee', name: 'Iron Sword', icon: 'iron_sword', damage: 6.5, cooldown: 0.42, hold: { model: HeldModels.ironSword },
    });
    // Built-in skins are just the player's; bring your own with game.items.atlas (see the docs).
    game.entities.define('rogue', {
      name: 'Rogue', model: Models.humanoid({ skin: Skins.player }), hitbox: { width: 0.6, height: 1.95 },
      health: 20, speed: 3.2, ai: Behaviors.melee({ damage: 3 }),
    });
  },
  start(game) {
    won = false;
    game.player.inventory.give('iron_sword');
    for (let i = 0; i < 3; i++) game.entities.spawn('rogue', { x: 8, y: 71, z: i * 2 - 2 });
  },
  update(game) {
    if (!won && game.entities.count('rogue') === 0) {
      won = true;
      game.hud.screen({ title: 'You win!', tone: 'victory', buttons: [{ label: 'Again', primary: true, onClick: () => game.restart() }] });
    }
  },
});
```

## Run it

Prerequisites: Rust (stable) with the `wasm32-unknown-unknown` target, and Node 20 or newer. `wasm-pack` is installed as a dev dependency.

```sh
rustup target add wasm32-unknown-unknown
npm install
npm run dev        # builds the wasm engine, then starts Vite on http://localhost:5173
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Release wasm build, type-check, and a production bundle in `dist/` |
| `npm run preview` | Serve the production bundle |
| `npm run wasm` | Rebuild only the Rust engine (`engine/pkg`) |
| `npm run typecheck` | TypeScript only |
| `npm run test:engine` | Rust unit tests: generation, blueprints, meshing, lighting, culling, physics, entities, path-finding, textures |
| `npm run test:headless` | Games in Node, no browser (`tests/headless`): every game runs 30 s, a bot beats the Arena, bots play out a Bed Wars match, several players share a host and a real server. About 8 s in total |
| `npm run server -- [games…] --port 8787` | Host games for several players (all of them by default, each at `ws://localhost:8787/<game>`); they open `/?server=ws://localhost:8787&game=sandbox`. Match games (Bed Wars, Arena, Starfighter) also offer a game of your own (`&room=<code>`), each game running in a worker thread of its own (`--rooms 8` at once). Each game's world, players' places and data are kept in `data/<game>.sqlite` (`--data dir`, `--new` for fresh worlds, `--cheats` for developer commands) |
| `npm run build:server` / `npm start` | Bundle the game server (games included) into `dist-server/` / run it with plain Node |
| `npm run deploy:server` | Deploy the game server to Fly.io (`fly.toml`, `Dockerfile`) |
| `npm run deploy:site` | Build the site pointed at the game server (`GAME_SERVER`, default the Fly app) and deploy it to Vercel |

URL parameters: `?game=<id>` picks a game, and `?seed=1234` picks a world for games that don't fix their own seed. `?server=ws://host:port` joins a game server instead (`&room=<code>`: a game of one's own on it). `?host=page` runs the game in the page rather than a worker (for debugging).

## Online

The site is at **https://blockyard.potrock.xyz** (also https://blockyard-games.vercel.app) and the game server at **https://voxel-games.fly.dev** (`/games` lists what's on and who's playing). The site is online-only: the home page shows the game live, and **Play** joins it under the name you type.

- **Game server:** Fly.io app `voxel-games` in `iad`, one machine (shared CPU, 512 MB) that sleeps when nobody's connected and wakes on the next visit, with a 1 GB volume at `/data` for the SQLite worlds (snapshotted daily). `fly logs -a voxel-games` shows joins, leaves and game errors. Public servers run without cheats: developer commands (`cheat: true`) don't exist, and players can't restart the game for everyone or change the time. Each game starts when its first player arrives and is saved and stopped five minutes after its last leaves. Limits: 16 players per game, 6 connections per address, 300 messages a second per connection, 16 KB per message; every message is checked before the game sees it.
- **Website:** Vercel project `voxel-platform` (Pat's projects), a static build made locally (Vercel's builders don't have Rust) with `VITE_GAME_SERVER` baked in, which is what makes the site connect to the server.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move |
| Space | Jump. In Sandbox, double-tap to toggle flight and hold to rise while flying |
| Shift | Sneak (won't walk off edges). Descend while flying |
| Ctrl or double-tap W | Sprint |
| Left mouse | Attack; hold to draw a bow (Arena, Bed Wars). Break a block (Sandbox); hold to mine one (Bed Wars) |
| Right mouse | Use: drink a potion (Arena), eat, throw a fireball (Bed Wars). Place a block (Sandbox, Bed Wars). Open the shop by right-clicking the shopkeeper (Bed Wars) |
| Middle mouse | Pick block (Sandbox) |
| 1-9, mouse wheel | Select hotbar slot. At Skyship's helm, the wheel zooms out to third person |
| E | Block picker (Sandbox) |
| F | Toggle flight (Sandbox) |
| Mouse, W/S, Q/E, A/D, RMB | Starfighter: steer, boost/brake, barrel roll, bank, torpedo |
| `/` or T | Command bar: `/give pike`, `/spawn zombie 3`, `/tp ~ ~10 ~`, `/time noon`, `/heal`, `/kill`, `/fly`, `/help` (Tab completes) |
| Esc | Pause, settings, restart, exit |
| F1 / F3 | Hide HUD / debug overlay |
| `[` / `]` | Shift time by one hour (Sandbox) |

## Architecture

```
┌──────────── games (TypeScript, import only @platform) ─────┐
│ src/games/arena · starfighter · bedwars · sandbox · …       │
├──────────── kits (optional, also only @platform) ──────────┤
│ src/platform/kits   survival building, interactions         │
│ src/platform/art    pixel-art painter for game atlases      │
└──────────────────────── GameContext ───────────────────────┘
┌──────────── platform simulation (TypeScript, headless) ────┐
│ src/platform/api        public API: types, Blueprint,       │
│                         Models, Behaviors                   │
│ src/platform/sim        Sim: players, entities, items,      │
│                         combat, props, commands, rules      │
│ src/platform/net        protocol: inputs, frames, calls     │
│ src/platform/host       GameHost; in a worker, the page,    │
│                         or Node (headless tests)            │
├──────────── platform client (TypeScript + three.js) ───────┤
│ src/platform/runtime.ts the client: game loop, host link    │
│ client/                   camera, entity/pickup/prop views, │
│                           presenter (HUD/FX/audio calls)    │
│ render/                   WebGL2 pipeline, first-person arm │
│ audio/ fx/ ui/            synth SFX, effects, HUD           │
│ world/ workers/           chunk streaming, worker pool      │
└─────────────── flat buffers / wasm-bindgen ────────────────┘
┌──────────── engine (Rust → WebAssembly) ────────────────────┐
│ gen.rs      terrain, biomes, caves, blueprints, terraform   │
│ mesher.rs   lighting + greedy meshing                       │
│ world.rs    block store, edits, raycasts, AABB physics      │
│ entities.rs entity bodies, flow-field path-finding,         │
│             projectiles                                     │
│ cull.rs     frustum + cave culling, shadow camera           │
│ texgen.rs / entitytex.rs  procedural block + mob textures   │
└──────────────────────────────────────────────────────────────┘
```

**Simulation and client are separate.** The `Sim` (`src/platform/sim`) runs the game: the game's own code, players, entities, items, combat and block edits. It touches no DOM and no WebGL, and talks to the client only in plain data. Each tick it takes a `PlayerInput` snapshot per player and produces a `SimFrame` (positions, poses, health, hotbars, pickups, props). HUD, effects and sound calls become `PresentCall` messages addressed to one player or to everyone. Menu and button callbacks become ids that come back as `ClientMessage`s. A `GameHost` (`src/platform/host`) runs the `Sim` on its own copy of the world, generated around the players, and answers each tick with a batch: content definitions, presentation calls, block edits, then the frame. In the browser it runs in a Web Worker (`src/sim.worker.ts`), so game logic, physics and path-finding never compete with rendering; the page is only the client (camera, views, presenter, rendering), and its world mirrors the host's edits. `?host=page` runs the host in the page instead, for debugging. In Node the same `GameHost` runs headless for tests, and the game server (`npm run server`) hosts it for several players over WebSockets. On the engine side, the simulation core (`gen.rs`, `world.rs`, `entities.rs`, `blocks.rs`) is plain Rust with no wasm-bindgen types, so a native build generates identical worlds from the same seed and blueprints. See [docs/PLATFORM.md](docs/PLATFORM.md#architecture-and-the-road-to-multiplayer).

**Threads.** Terrain generation and meshing run in a pool of Web Workers (hardware threads minus two). They share one `WebAssembly.Module` that is compiled once on the main thread. The main thread keeps its own wasm instance holding the authoritative block data and entity state. Physics, raycasts, edits, entity simulation and per-frame culling all use it synchronously.

**Chunks.** Columns are 16×16×256 and stored sparsely as 16³ sections. Generation is stateless: `(seed, cx, cz)` plus the game's blueprints fully determines a chunk. Trees that cross chunk borders are placed from a margin, so both chunks agree without talking to each other. Game structures (`Blueprint`s) are stamped by the workers during generation, so they cost nothing at runtime and survive chunk reloads.

**Lighting.** Sky light and block light are computed per mesh job with a BFS over the 3×3 column neighbourhood. Light 15 dies out within 15 steps, so that neighbourhood contains every source that can reach the centre column. The result is exact and seamless without any global light storage. An edit only remeshes the columns within light range, and all of them swap in the same frame.

**Meshing.** Opaque faces are greedy-merged when their smooth lighting and ambient occlusion are uniform. Other faces keep per-vertex AO and light, with the quad diagonal flipped to avoid AO anisotropy. There are three layers: opaque, cutout (leaves, plants, glass) and translucent (water). Each vertex packs into 8 bytes (`uvec2`), and texture coordinates are derived in the shader. One shared index buffer serves every mesh.

**Culling.** Meshes are stored section by section, so the visible part of a column is always one contiguous draw range. Each frame, wasm runs frustum culling per section plus a Minecraft-style cave-culling BFS through section connectivity graphs (computed by the mesher). The result drives three.js `drawRange` and `visible` directly. The shadow pass gets its own caster selection.

**Entities.** Up to 160 bodies and 320 projectiles live in flat buffers in wasm memory. Each frame Rust steps all of them at once: substepped AABB physics against the voxel world, auto-step, knockback, separation, line of sight, and ballistic projectiles with hit detection. A 97×28×97 flow field toward the player is rebuilt four times a second. It handles walls, steps and drops, and every chasing mob steers down it. TypeScript runs the behaviours (state machines on the public `Entity` API) and drives box models that use the Minecraft skin UV layout.

**Rendering (WebGL2 via three.js):**
- Physically based sky: Rayleigh, Mie and ozone single scattering with a multiple-scattering term, rendered into a small LUT that the sky, fog and reflections all sample.
- Sun and moon, rotating stars, a Milky Way band, and procedural clouds that cast moving shadows.
- Cascade-free stable shadow map (texel-snapped, rotated Poisson PCF) with normal-offset bias. Mobs, items and arrows cast shadows too.
- Smooth lighting and AO, normal maps and specular from generated material textures, and emissive blocks. Entities sample the voxel light field through a Rust light probe, so a zombie in a tunnel is dark and one next to a torch is lit.
- Waving leaves and grass. Foliage lets light through, and alpha-to-coverage keeps it sharp.
- Water: screen-space reflections, refraction with Beer-Lambert absorption, a sun glint, shoreline foam, a Snell's-window view from below, and caustics plus softened shadows on underwater floors.
- A first-person view built from Minecraft's own transforms: a skinned arm, the bow's draw pose and the post-attack dip. Swords, axes, potions and polearms are real 3D block models gripped in the hand, with a diagonal slash, an overhead hew, a sip and a two-handed jab; other items are extruded sprites. Walk bob, look sway, a landing dip and recoil on top. Games can add their own held models, grips and keyframe animations.
- Movable block builds ("props", like the Starfighter ships): a Blueprint meshed once with the world's block textures, AO, shadows and glowing blocks, then moved freely every frame. glTF and GLB models (Blockbench, Blender) as props, animated figures (idle, walk in step, run, attack, a head that looks), player models and held items with drawn icons, lit and shadowed like everything else. Glowing laser bolts, explosions (fireball, smoke, sparks, shockwave) and `world.explode` craters.
- Additive FX (pickup beams, shockwaves, glows), a particle system, floating damage numbers and screen shake.
- HDR with MSAA, bloom (13-tap down / tent up), screen-space god rays, ACES tone mapping and underwater fog.

**Assets.** None. All the block textures, the player skin, the starter item sprites and the sound effects are generated procedurally: textures in Rust, sounds with WebAudio. Games bring their own art and sounds the same way: the Arena paints its mobs and weapons in TypeScript (`src/games/arena/art/`) and synthesises its creature voices (`sounds.ts`); Starfighter builds its ships from blocks and synthesises its lasers.

| Coast at noon | Night |
| --- | --- |
| ![Coast at noon](docs/coast-noon.png) | ![Moonlit coast](docs/night-coast.png) |

## Performance notes

Measurements are on an Apple M2 Max at 1600×900 with the default settings (12 chunks, 4× MSAA, 3072² shadows).

- **Sandbox:** the main thread spends about 2 ms per frame, rendering about 600 draw calls and 0.7 M triangles. A worker job takes about 1.4 ms to generate a chunk and about 1.1 ms to light and mesh one. At 20 chunks (about 1,300 columns) the world streams in within about 5 s and stays at 60 fps.
- **Arena:** a full six-wave run holds 60 fps with 12+ mobs, arrows and fireballs in flight, at about 1–2 ms of CPU per frame.

The settings menu has shadow quality, resolution scale, MSAA and per-effect toggles for slower GPUs.
