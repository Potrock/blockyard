# Blockilization: the roadmap

Goal: the clean, elegant depth of Civilization V, in Blockyard's voxel style, with the quality of life
of a modern 4X. Every choice should be readable (you can see why a tile, a tech or an attack is good),
every system should matter (no rules that are defined but never felt), and the bots should be real
rivals. Taken over from BigBallz's upload (version 03dca89bd177, 2026-10-12) with his blessing.

How we work: the rules stay pure (`rules/`, no platform imports) so they can be simulated headlessly;
the server only routes orders through `apply()`; each screen draws its own view. Each milestone is
uploaded once it's verified (bot-only simulations for the rules, the game played in Chrome for the rest).

## Status (2026-10-13, morning)

Live on blockyard.gg: version 4d183d4d7bdf (main 787b720). Main now holds the overnight work, waiting
for the owner's go-ahead to upload:

- Balance: happiness at 2 per city; siege that takes walled cities; danger-aware paths; a waiting
  prophet keeps its religion's place; faith buys great people from the Industrial Era; bots that keep
  their strategics, stay content, play as teams, finish their wars, find faith early, and don't nag;
  France, Babylon and Egypt in line; culture from the Industrial Era; spaceship parts 2500, Apollo
  2000, a taken capital loses its spaceship; no victory type above about a third of games.
- Multiplayer: watchers kept up to date, rosters, the clock waits for people, deals put off kept,
  conquest ends the game, the fallen watch on, a full lobby seats arrivals; teams (presets, shared
  vision, war and peace as a side, team victories, shared research); a dynamic turn timer.
- Quality of life: path orders drawn apart from the preview (flags, turn markers, next unit), the
  cities overview builds and buys, queue repeat, workers' why-nots, enemy walls' reach, group moves,
  religion countdown, the leader ribbon down the right, the phone layout fitted, advisor tips once,
  a charge's odds before you click, shift-drag to gather soldiers, buildings held back by a missing
  resource listed with the reason, caravans offered only routes they can run.
- Look and feel: resources seen on their tiles, terrain that reads (rivers, hills, deserts, jungle),
  sounds for what happens, moments in the world, leaders in their era's room, the world's moves
  played out after your turn, a pixel loading card, a result card with an end-of-game replay, a new
  cover.

Open questions for the owner: watchers' full map in multiplayer; guest identity on reconnect;
orders after ready; the team tech-cost multiplier (+50% a member); connection gold for roads.

From the second full playtest (Prince, standard Pangaea, to turn 331): bots declare war with no
warning or reason; a person's automated workers walk into enemies; spies steal every 5-8 turns and
are never caught; medieval siege can't keep up with a city's healing past size 4 or so; happiness
sits below zero for most of the game; a player with no Iron, Coal, Oil or Horses falls far behind;
Caravans can be built with every route slot full (the city screen now holds them back; the rules
don't). From the third (a war of conquest): puppets still take production orders and purchases, as
the bots' do; a unit on a long order stops every turn while enemies are in sight, halting its group.

## Milestone 1: solid ground

Correctness and feel. Nothing here is new design; it's making what exists work.

- Combat: `damage()` callers are swapped (attacker takes the damage meant for the defender): fix every
  call site (melee, ranged, city attack, city fire). Failed attacks don't spend the attack.
- Rules audit findings (see the audit notes in the commit log).
- Input: picking uses the land's real height; a unit's flag and a city's banner are clickable; clicks
  on any panel or button never reach the map (End Turn used to move the selected unit); mounted
  ranged units and the Range promotion fire at their real range.
- The interface keeps its state: scroll positions, focus and open selects survive a redraw; a press
  isn't lost to a redraw; panels redraw only when their own data changes.
- In-game confirm dialogs (the sandboxed frame blocks `confirm()`: war, disband, raze never worked).
- The turn timer counts down on each screen (the server stopped resending everyone's view each second).
- The city screen refreshes when its city changes; Skip is shown and respected; the controls list is
  right (Z sleeps); the game-over panel can be put away to look at the map; spectators see the world
  without someone else's empire; a new game clears the old one's drawing.
- Preferences (sound, tips) are kept per player on the server (no storage in the frame).
- Human access to what only bots could do: city bombard, ideologies.
- Lobby: bots fill the free seats by default; the lobby keeps its scroll.
- Performance: path previews cached; overlay drawn in batches; bot turns spread over ticks.

## Milestone 2: real depth

- Bots: expansion that keeps pace, city specialisation, worker automation, armies that gather and
  besiege, defence that holds, a victory they're working toward, and a personality per leader
  (Montezuma attacks, Gandhi builds, Harun trades...). Difficulty levels (handicaps, not cheats first).
- Tactical combat as Civ V has it: zones of control, flanking, terrain and river crossings, embarked
  weakness, healing, pillage, promotions that matter, great generals, siege and city defence.
- Cities: work tiles and specialists by hand, buy tiles, see each tile's yields, focus that works.
- Diplomacy: leaders who remember (opinion with reasons), a trade screen (gold, gold per turn,
  luxuries, strategics, open borders, embassies, research agreements, friendship, pacts), denouncing,
  city-state quests and alliances, the World Congress.
- Happiness from luxuries is the brake on going wide; strategic resources limit armies.
- Every victory reachable and shown with progress; setup options (difficulty, victory types, speed).

## Milestone 3: modern quality of life

- Lenses: yields on every tile, settler (good city sites), resources, religion, borders.
- Combat preview with predicted damage both ways before you commit; damage numbers in the world.
- Path preview with turn markers; multi-turn moves that resume; auto-explore; automated workers.
- Overviews: cities (yields, growth, production), units, demographics, the score race.
- Notification centre: required decisions first, every note jumps to its place, dismissable.
- Tech tree with prerequisite lines, search and what each tech unlocks; production queue with
  reorder and repeat; recommended choices from the advisor.
- An in-game encyclopedia (every unit, building, wonder, policy, belief, terrain), linked from tooltips.
- Hotkeys overlay; touch play that works.

## Milestone 4: our style

- The voxel world shows the game: farms, mines, plantations, roads and railways built in blocks;
  cities that grow outward in districts; wonders standing in their cities; pillage and ruin.
- Fog as clouds in the world (not a flat overlay the trees poke through).
- Units that animate: march, attack (lunge, arrows, cannon fire), die, embark.
- A cover for the shelf; leader scenes for diplomacy; music by era.
