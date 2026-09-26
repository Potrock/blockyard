import { defineClient } from '@platform/client';
import { standardKits } from '@platform/client/kits';
import { shared } from './art.shared';

export default defineClient(shared, { kits: standardKits() });
