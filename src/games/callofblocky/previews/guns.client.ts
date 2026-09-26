import { defineClient } from '@platform/client';
import { standardKits } from '@platform/client/kits';
import { shared } from './guns.shared';

export default defineClient(shared, { kits: standardKits() });
