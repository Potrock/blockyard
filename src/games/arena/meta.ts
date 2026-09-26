import { defineMeta } from '@platform';

/** Arena: survive six waves of monsters in a colosseum, collect better weapons between waves, and defeat the Warden. */
export default defineMeta({
  id: 'arena',
  title: 'Arena',
  tagline: 'Survive six waves and slay the Warden',
  accent: '#ff8a4c',
  instances: true,
  controls: [
    ['LMB', 'attack · hold to draw bow'],
    ['RMB', 'drink potion'],
    ['1-9', 'weapons'],
  ],
});
