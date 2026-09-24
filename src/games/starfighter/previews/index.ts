import shipyard from './shipyard';
import drydock from './drydock';

/** Dev-only previews for the art (`?game=shipyard`, `?game=drydock`); never in production builds. */
export const previews = [shipyard, drydock];
