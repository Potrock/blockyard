/**
 * How much of the world's detail this screen draws. A phone (a finger for a pointer, or a small
 * screen) has a fraction of a desk's graphics and processor, and every model on the map is a draw of
 * its own (and another in the shadows' pass): there towns put on their far look sooner, a tile's
 * resource shows one beast or crop rather than its herd or field, no birds wheel over the woods and
 * chimneys smoke half as often. (The platform's own automatic quality looks after the rest: shadows,
 * reflections, the pixels drawn.)
 */

// (Asked when first drawn, not when loaded: the module loads where there's no screen too, as the platform checks the game.)
let finger: MediaQueryList | undefined;

/** Whether this screen draws the world light. */
export const light = () => (finger ??= matchMedia('(pointer: coarse)')).matches || Math.min(window.innerWidth, window.innerHeight) < 500;
