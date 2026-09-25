# Platform API gaps (backlog)

These are the places the public API fell short when High Noon, a second shooter
(`src/games/highnoon`), was built using nothing but `@platform`. They're ranked by how much they
hurt. They're saved to do after the destructible micro-voxels.

1. **One-handed guns.** The `gun` hold style always draws a support hand in first person, halfway
   along the gun if it has no `grip2`. A figure's left hand is free only when the file has no
   `grip2`, and then a reload has no hand motion. The only workaround is an undocumented
   `HeldModels.gltf(url, { grip2 })`, which moves the first-person hand alone.
   *Fix:* `hold.gun.hands: 1`, and an off-hand pose for figures (`pistol.offHand`).
2. **First-person arms.**
   - Their size is multiplied by `hold.scale`, so a bigger gun gets bigger arms.
   - `firstPerson` is set per model, not per gun.
   - The arm is one straight segment (the forearm and upper arm share a direction), so aiming a
     one-handed gun lays a sleeve across the screen.
   
   *Fix:* per-gun `hold.gun.arm: { scale, reach, bend }`, an arm size independent of `hold.scale`,
   a bent elbow, and docs on iron-sight geometry (nothing above the sight line behind the `sight`
   point).
3. **Widgets can't show predicted state.** At about 130 ms round trip the platform's own ammo
   counter changed 31 ms after the click, and a widget's ammo 213 ms after. No reload state can
   be read. *Fix:* widget fields bound on the client (`{{$gun.mag}}`, `{{$gun.reloading}}`,
   `{{$ability.<name>.<field>}}`), and `player.reloading` on the host.
4. **Bug: modal widgets online.** A modal put up at `playerJoin` on a server (the browser joins
   before Play) never appeared. Its handle said `shown`, and `widget()` again with the same data
   sent nothing, even after `start()`. *Fix:* resend modals when a player enters play, add a
   `playerReady` event, and make `widget()` after a HUD clear always resend.
5. **Bots.** There's no navigation or shooter-bot kit: High Noon copied Call of Blocky's `nav.ts`
   and adapted its bot brain (about 600 lines). *Fix:* `navgrid` and `shooterBot` kits.
6. **Blocks.** Game blocks can't face a direction or be thin: no signs that face one way, no
   railings, posts, panes or ladders. *Fix:* a facing state with a `front` texture; `fence`,
   `pane`, `post` and custom box shapes; a `climbable` flag. *Done:* `facing`, `front`/`back`,
   `shape: 'fence' | 'pane' | 'post'`, `boxes`, `climbable` (PLATFORM.md, *Shapes of your own*).
7. **Gun actions.** `action` is only `'pump' | 'bolt'`: there's no lever action and no hammer cock
   for a single-action revolver. *Fix:* `action` as a view animation, or add `'lever'`.
8. **Biomes.** A natural world's biome can't be chosen: High Noon scanned 120 seeds for a desert.
   This is mostly moot now that a void world can have a `ground` (sand, say).
9. **Abilities.** A movement ability can't change the body's stance or hitbox (a dodge roll),
   tilt the camera, or play a predicted clip. *Fix:* `body.stance`, `body.camera`, and
   `trigger(name, { clip })`.
10. **Poses per item.** Humanoid poses are set per model, not per gun: `reload.cycle` and the
    reload pose are shared by every gun. *Fix:* allow a `GunStance`/`HeldPose` on each item.
11. **Block shape.** `blockInfo` has no shape, so bot pathing finds steps by the `_slab`/`_stairs`
    suffix and misses game blocks. *Fix:* `blockInfo().shape` and a collision height. *Done:*
    `blockInfo().shape`, `height`, `boxes`, `climbable`, and `world.collisionHeight(x, y, z)`.
12. **Weapon lock and state.** During a freeze, players can still switch slots and fire (damage
    is cancelled, but ammo is spent), and there's no `player.frozen` or `player.reloading`.
    *Fix:* a weapons-locked freeze and read-only getters.
13. **Bugs.**
    - Two items that share one GLB but have different `hold` specs: switching between them keeps
      the first hold (`ViewModel.setItem` returns early on the same geometry).
    - Once a player has their own copy of a widget, `game.hud.widget` silently stops reaching them.
    - `restart()` resets `clock.now` to 0, and that isn't documented.
    - Once, online after a server restart: `f.players.some is not a function` in `client/interp.ts`.
14. **Tooling.** The headless `launch()` can't find dev games, and `tools/rig.html` shows only Call
    of Blocky's guns and the `wave`/`cheer` clips.
15. **Docs.** These are wrong or missing:
    - a held model's `grip2` override affects first person only
    - first-person arms scale with `hold.scale`
    - a gun with no `grip2` has a free left hand in third person
    - how to author clips for a rigid rig (a joint's rotation is its turn, in YXZ order)
    - `restart()` and the clock
    - the `widget` copy semantics
    - dev games run on a server only when named (`npm run server -- <id>`)
