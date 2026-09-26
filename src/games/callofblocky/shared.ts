import { defineShared, Models } from '@platform';
import { ATLAS, skinOrigin } from './art';
import hudCss from './hud.css?raw';
import { MAP } from './map';
import meta from './meta';
import { FIGHTERS as FIGHTER_MODELS } from './models/fighters';
import { FIGHTER_STYLE } from './style';

export const COLORS = { gold: '#ffcc00', red: '#e63946', ink: '#111111', cream: '#fdf1d6', pink: '#ff5c8a', teal: '#1fa3a0' };

/** Each outfit's fighter (in the same order as `OUTFITS`): a model on the platform's humanoid rig, animated by it. */
export const fighterModel = (outfit: number) => Models.gltf(FIGHTER_MODELS[outfit % FIGHTER_MODELS.length].url, { rig: 'humanoid', ...FIGHTER_STYLE });

/**
 * Jackrabbit Lane (every screen builds it, and shoots into it), how fighters move (each screen
 * predicts its own: sprint, slide, mantle), and the comic-book HUD.
 */
export const shared = defineShared({
  ...meta,
  world: {
    seed: MAP.seed,
    // No landscape to make: the lane and its backdrop stand on a plain ground over the void,
    // deep enough for the storm drain, and nothing past the haze is loaded.
    terrain: 'void',
    ground: { y: MAP.floorY - 1, top: 'grass_block', fill: 'dirt', depth: 10 },
    maxViewDistance: 10,
    structures: MAP.structures,
    terraform: MAP.terraform,
    // The home page looks down the street from the west end, toward the diner (fighters spawn at the map's spawns).
    spawn: { x: -30.5, y: MAP.floorY + 0.05, z: 0.5 },
    spawnYaw: -Math.PI / 2,
    time: MAP.time,
    freezeTime: true,
    // Walls, roofs, the truck, the diner: shot into, pixel by pixel (each gun's `carve`). The
    // ground layer under the street and everything below it (the storm drain) stay whole, so
    // nobody shoots their way out of the map. A restart puts it all back.
    destructible: { above: MAP.floorY - 1 },
  },
  player: {
    health: 100,
    regen: { delay: 4.5, perSecond: 35 },
    hurtCooldown: 0,
    pvp: true,
    fallDamage: false,
    hotbar: 'items',
    skin: skinOrigin(0),
    skinAtlas: ATLAS,
    model: fighterModel(0),
    movement: {
      walk: 6,
      sprint: 8.4,
      crouch: 2.8,
      jump: 1.3,
      gravity: 30,
      acceleration: 16,
      airControl: 4,
      sprintKeys: ['ShiftLeft', 'ShiftRight'],
      crouchKeys: ['KeyC'],
      doubleTapSprint: false,
      edgeGuard: false,
      slide: { speed: 11.5, time: 0.8, friction: 1.3, cooldown: 0.6 },
      mantle: 1.1,
    },
  },
  hud: {
    health: 'bar',
    healthBars: true,
    nameTags: 'sight',
    theme: {
      display: "'Bangers', 'Impact', 'Arial Black', sans-serif",
      text: "'Archivo', 'Helvetica Neue', system-ui, sans-serif",
      fonts: ['Bangers', 'Archivo'],
      colors: { accent: COLORS.gold, ink: COLORS.ink, paper: COLORS.cream, text: COLORS.ink, danger: COLORS.red, good: COLORS.gold },
      // The comic-book look: ink outlines, hard shadows, paper panels.
      css: hudCss,
    },
  },
});
