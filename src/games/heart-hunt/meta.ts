import { defineMeta } from '@platform';

/** Tutorial game from docs/PLATFORM.md: find ten glowing hearts scattered around a pedestal. */
export default defineMeta({
  id: 'heart-hunt',
  title: 'Heart Hunt',
  tagline: 'A gentle hunt for ten hidden hearts',
  accent: '#ff5a7a',
  controls: [['Walk', 'into hearts to collect']],
});
