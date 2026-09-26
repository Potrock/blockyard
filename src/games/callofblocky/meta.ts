import { defineMeta } from '@platform';

/**
 * Call of Blocky: a fast free-for-all on Jackrabbit Lane, a Nuketown-style cul-de-sac painted
 * pulp-pop. First to 25 kills (or the most when the clock runs out) takes it.
 */
export default defineMeta({
  id: 'callofblocky',
  title: 'Call of Blocky',
  tagline: 'Free-for-all on Jackrabbit Lane. First to 25.',
  accent: '#ffcc00',
  controls: [
    ['LMB', 'fire'],
    ['RMB', 'aim'],
    ['R', 'reload'],
    ['Shift', 'sprint'],
    ['C', 'crouch · slide'],
    ['1 2 3', 'weapons'],
    ['G', 'lethal (hold to cook)'],
    ['L', 'loadout'],
    ['Tab', 'scores'],
  ],
  // Controllers: the platform's shooter layout (RT fire, LT aim, X reload, B crouch and slide,
  // L3 sprint, LB / Y switch weapons), with the lethal on RB (hold to cook), the loadout on the
  // D-pad and the katana on R3.
  gamepad: {
    R3: ['Digit3', 'katana'],
    RB: ['KeyG', 'lethal'],
    Up: 'KeyL',
    Down: null,
  },
  instances: true,
});
