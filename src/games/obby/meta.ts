import { defineMeta } from '@platform';

/**
 * Sky Obby: a parkour course of ten stages floating in the sky, from stepping stones to lava,
 * crumbling sand, launch pads, blinking platforms, a spiral tower and a cannon-swept walkway.
 */
export default defineMeta({
  id: 'obby',
  title: 'Sky Obby',
  tagline: 'Ten stages of parkour in the sky. Race the clock, or your friends.',
  accent: '#ffd36b',
  controls: [
    ['Ctrl', 'sprint'],
    ['Shift', 'sneak: don’t fall off edges'],
    ['R', 'back to your checkpoint'],
  ],
});
