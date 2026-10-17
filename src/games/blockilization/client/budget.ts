/**
 * How much of the world's detail this screen draws. A phone (a finger for a pointer, or a small
 * screen) has a fraction of a desk's graphics and processor, and every model on the map is a draw of
 * its own (and another in the shadows' pass): there towns put on their far look sooner, a tile's
 * resource shows one beast or crop rather than its herd or field, no birds wheel over the woods and
 * chimneys smoke half as often. (The platform's own automatic quality looks after the rest: shadows,
 * reflections, the pixels drawn.)
 */

const finger = matchMedia('(pointer: coarse)');

/** Whether this screen draws the world light. */
export const light = () => finger.matches || Math.min(window.innerWidth, window.innerHeight) < 500;
