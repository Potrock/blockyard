import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/** Blocktaceous: survive on a huge island of prehistoric animals. Gather, craft, build, tame and ride. */
export default defineMeta({
  id: 'blocktaceous',
  title: 'Blocktaceous',
  tagline: 'Wash up with nothing. Tame the island.',
  accent: '#7fbf4d',
  cover,
  controls: [
    ['WASD', 'move'],
    ['Left click', 'harvest and attack'],
    ['Right click', 'place, eat, use'],
    ['E', 'interact, mount, feed'],
    ['Tab', 'inventory and crafting'],
  ],
});
