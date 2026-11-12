import type { GameContext, Player } from '@platform';
import { recipes as buildingRecipes } from '../building/recipes';
import { recipes as creatureRecipes } from '../creatures/recipes';
import { ITEMS } from '../items';
import type { Part } from '../part';
import { paintIcons } from './art';
import * as bag from './bag';
import { clearRecipes, registerRecipes, workQueue, type Recipe } from './craft';
import type { StaminaState } from './def';
import { completeItems, defineGear } from './gear';
import { defineGoals, resetGoalCard, stepGoals } from './goals';
import { defineVitals, showVitals } from './hud';
import { ICON_ATLAS } from './icons';
import { applyArmour, forgetContainers, weigh } from './pack';
import { gainXp } from './progress';
import { SURVIVAL_RECIPES } from './recipes';
import { forgetSpears, spearStruck, stepSpear } from './spear';
import { USES, wearDown } from './wear';
import { defineJournal, openJournal, stepJournal } from './screen';
import { forget, forgetAll, save, setGame, survivorOf } from './state';
import { expirePacks, forgetPacks, markPack, onDeath, packContainer, restorePacks, stepDead, stepVitals } from './vitals';

/**
 * The survival part's rules: each survivor's body, pack, journal and progress, kept for their
 * account and stepped for everyone playing.
 */

/** The ids this part gives their behaviour: the island's resources (some are food) and the survivor's own gear. */
const OWN_ITEMS = (() => {
  const ids = Object.keys(ITEMS);
  // Up to the building part's first item: the vocabulary lists resources, then survival's.
  const end = ids.indexOf('lost_pack');
  return ids.slice(0, end + 1);
})();

function welcome(game: GameContext, player: Player): void {
  if (player.bot) return;
  const s = survivorOf(player);
  s.shown = '';
  s.weather = '';
  s.ui.open = false;
  resetGoalCard(s);
  applyArmour(player, s);
  weigh(player, s);
  markPack(player, s);
  void game;
}

let sinceExpiry = 0;

export const survival: Part = {
  setup(game) {
    setGame(game);
    forgetAll();
    forgetContainers();
    forgetPacks();
    clearRecipes();
    forgetSpears();

    // The item sprites: one atlas for the world (hands, pickups, the hotbar), and the same picture
    // as `data:` images for the journal and the HUD, whose CSS can use nothing else.
    const art = paintIcons();
    game.items.atlas(ICON_ATLAS, { width: art.width, height: art.height, pixels: art.pixels, emissive: art.emissive });
    defineJournal(game, art.rowUrls);
    defineVitals(game, art.glyphsUrl);
    defineGoals(game, art.glyphsUrl);

    defineGear(game, OWN_ITEMS);
    registerRecipes(SURVIVAL_RECIPES);
    // The other parts' recipes are plain lists in their own folders: structures and stations, saddles and taming gear.
    registerRecipes(buildingRecipes);
    registerRecipes(creatureRecipes as readonly Recipe[]);

    // For the development console (`await __game.dev('__btSurvival.give(me, "wood", 50)')`): a
    // room's own global, which no player's screen can reach.
    (globalThis as { __btSurvival?: unknown }).__btSurvival = { ...bag, survivorOf };

    game.events.on('playerJoin', ({ player }) => welcome(game, player));
    game.events.on('playerLeave', ({ player }) => forget(player));
    game.events.on('playerDeath', ({ player }) => {
      if (!player.bot) onDeath(game, player);
    });
    // Out of breath, a blow has little behind it.
    game.events.on('damage', (hit) => {
      const by = hit.source;
      if (by === 'world' || by?.kind !== 'player' || by.bot) return;
      if (hit.cause === 'melee' && (by.abilities.stamina as StaminaState | undefined)?.winded) hit.amount *= 0.6;
      if (hit.cause === 'projectile' && hit.weapon?.startsWith('thrown:')) return spearStruck(game, by, hit.weapon, hit.target);
      // Every blow landed and every arrow that finds its mark wears what dealt it.
      const held = by.inventory.held?.item;
      if (held && USES[held] && (hit.cause === 'melee' || hit.cause === 'projectile')) wearDown(by, survivorOf(by), held);
    });
  },

  start(game) {
    completeItems(game);
    restorePacks(game);
    for (const player of game.players) welcome(game, player);
  },

  update(game, dt) {
    for (const player of game.players) {
      if (player.bot) continue;
      const s = survivorOf(player);
      if (!player.alive) {
        stepDead(game, player, s, dt);
      } else if (!player.spectating) {
        stepVitals(game, player, s, dt, (id) => {
          packContainer(id);
          openJournal(player, 'pack', { container: `pack-${id}` });
        });
        stepSpear(game, player, s, dt);
        const xp = workQueue(player, s, dt);
        if (xp > 0) gainXp(player, xp);
      }
      stepJournal(player, s);
      stepGoals(player, s, dt);
      showVitals(player, s, dt);
      s.saveIn -= dt;
      if (s.dirty && s.saveIn <= 0) save(player, s);
    }
    sinceExpiry += dt;
    if (sinceExpiry > 30) {
      sinceExpiry = 0;
      expirePacks();
    }
  },
};
