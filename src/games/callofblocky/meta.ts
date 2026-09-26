import { defineMeta } from '@platform';

/**
 * Call of Blocky: fast pulp shootouts on Jackrabbit Lane, a Nuketown-style cul-de-sac, and at Big
 * Kahuna Burger: free-for-all, Team Deathmatch, and The Briefcase (plant it or stop it).
 */
export default defineMeta({
  id: 'callofblocky',
  title: 'Call of Blocky',
  tagline: 'Free-for-all, Team Deathmatch and The Briefcase, on Jackrabbit Lane and at Big Kahuna Burger.',
  accent: '#ffcc00',
  controls: [
    ['LMB', 'fire'],
    ['RMB', 'aim'],
    ['R', 'reload'],
    ['Shift', 'sprint'],
    ['C', 'crouch · slide'],
    ['1 2 3', 'weapons'],
    ['G', 'lethal (hold to cook)'],
    ['F', 'plant · crack the case (hold)'],
    ['L', 'loadout'],
    ['M', 'mode and map (your own game)'],
    ['Tab', 'scores'],
  ],
  // Controllers: the platform's shooter layout (RT fire, LT aim, X reload, B crouch and slide,
  // L3 sprint, LB / Y switch weapons), with the lethal on RB (hold to cook), the loadout on the
  // D-pad's up, planting and cracking the case on its down, the mode and map on its right, and
  // the katana on R3.
  gamepad: {
    R3: ['Digit3', 'katana'],
    RB: ['KeyG', 'lethal'],
    Up: 'KeyL',
    Down: ['KeyF', 'plant · crack'],
    Right: ['KeyM', 'mode and map'],
  },
  instances: true,
});
