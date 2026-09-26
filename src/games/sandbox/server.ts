import { defineServer } from '@platform';
import { shared } from './shared';

/** No rules of its own: the world, its blocks and building are all shared. */
export default defineServer(shared, {});
