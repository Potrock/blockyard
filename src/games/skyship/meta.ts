import { defineMeta } from '@platform';

/** Skyship: crew an airship across the sky islands and light the five beacons. */
export default defineMeta({
  id: 'skyship',
  title: 'Skyship',
  tagline: 'Crew an airship across the sky islands and light the five beacons.',
  accent: '#e0663a',
  instances: true,
  controls: [
    ['E', 'take or leave the helm'],
    ['W / S', 'ahead / astern'],
    ['A / D', 'turn'],
    ['Space / Shift', 'climb / sink'],
    ['Wheel', 'zoom out from the helm'],
  ],
});
