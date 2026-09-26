import { defineClient } from '@platform/client';
import { standardKits } from '@platform/client/kits';
import { shared } from './shipyard.shared';

export default defineClient(shared, { kits: standardKits() });
