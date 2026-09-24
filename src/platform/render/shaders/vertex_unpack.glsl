// ---------------------------------------------------------------------------------------------
// Packed chunk vertex decoding + vertex animation (shared by terrain, water and shadow passes).
//   w0: x(5) | z(5)<<5 | y(9)<<10 | normal(3)<<19 | ao(2)<<22 | anim(2)<<24 | tint<<26
//       | xmax<<27 | zmax<<28 | cutout<<29
//   w1: layer(12) | sky*4(6)<<12 | block*4(6)<<18
// ---------------------------------------------------------------------------------------------
in uvec2 aData;

uniform float uTime;
uniform vec4 uWind; // xy: direction, z: strength, w: gust phase

struct Vtx {
  vec3 pos;      // chunk-local (animated)
  vec3 normal;   // world-space geometric normal
  vec3 tangent;  // world-space +u
  vec3 bitangent;// world-space +v (texture up)
  vec2 uv;       // unwrapped texture coordinates in block units
  uint layer;
  uint normalIdx;
  float ao;
  float sky;
  float blk;
  float tint;
  float cutout;
  float plantV;  // 0 for cross-plane plants, -1 for cube faces
};

vec3 windOffset(vec3 w, float amount) {
  float t = uTime;
  float gust = 0.65 + 0.35 * sin(t * 0.35 + w.x * 0.013 + w.z * 0.017 + uWind.w);
  vec3 o;
  o.x = sin(t * 1.9 + w.x * 0.61 + w.y * 0.37) + 0.5 * sin(t * 3.7 + w.z * 1.13);
  o.y = 0.35 * sin(t * 2.3 + w.x * 0.43 + w.z * 0.51);
  o.z = cos(t * 1.7 + w.z * 0.57 + w.y * 0.23) + 0.5 * cos(t * 3.3 + w.x * 0.97);
  o.xz += uWind.xy * 0.8;
  return o * amount * gust * uWind.z;
}

Vtx unpackVertex(vec3 chunkOrigin) {
  Vtx v;
  uint w0 = aData.x;
  uint w1 = aData.y;
  vec3 p = vec3(float(w0 & 31u), float((w0 >> 10u) & 511u), float((w0 >> 5u) & 31u));
  uint n = (w0 >> 19u) & 7u;
  uint anim = (w0 >> 24u) & 3u;
  v.normalIdx = n;
  v.ao = float((w0 >> 22u) & 3u) / 3.0;
  v.tint = float((w0 >> 26u) & 1u);
  v.cutout = float((w0 >> 29u) & 1u);
  v.layer = w1 & 4095u;
  v.sky = float((w1 >> 12u) & 63u) / 60.0;
  v.blk = float((w1 >> 18u) & 63u) / 60.0;
  v.plantV = -1.0;
  vec3 animRef = p;

  if (n == 0u) { v.normal = vec3(1, 0, 0); v.tangent = vec3(0, 0, -1); v.bitangent = vec3(0, 1, 0); v.uv = vec2(-p.z, p.y); }
  else if (n == 1u) { v.normal = vec3(-1, 0, 0); v.tangent = vec3(0, 0, 1); v.bitangent = vec3(0, 1, 0); v.uv = vec2(p.z, p.y); }
  else if (n == 2u) { v.normal = vec3(0, 1, 0); v.tangent = vec3(1, 0, 0); v.bitangent = vec3(0, 0, 1); v.uv = vec2(p.x, p.z); }
  else if (n == 3u) { v.normal = vec3(0, -1, 0); v.tangent = vec3(1, 0, 0); v.bitangent = vec3(0, 0, -1); v.uv = vec2(p.x, -p.z); }
  else if (n == 4u) { v.normal = vec3(0, 0, 1); v.tangent = vec3(1, 0, 0); v.bitangent = vec3(0, 1, 0); v.uv = vec2(p.x, p.y); }
  else if (n == 5u) { v.normal = vec3(0, 0, -1); v.tangent = vec3(-1, 0, 0); v.bitangent = vec3(0, 1, 0); v.uv = vec2(-p.x, p.y); }
  else {
    // Cross-plane plant: shrink toward the cell centre and jitter per cell.
    float xmax = float((w0 >> 27u) & 1u);
    float zmax = float((w0 >> 28u) & 1u);
    vec2 cell = p.xz - vec2(xmax, zmax);
    v.uv = vec2(n == 6u ? xmax : zmax, p.y);
    float inset = 0.14;
    p.x += xmax > 0.5 ? -inset : inset;
    p.z += zmax > 0.5 ? -inset : inset;
#ifdef TORCH_LAYER
    if (v.layer != uint(TORCH_LAYER)) {
#else
    {
#endif
      vec2 j = hash22(chunkOrigin.xz + cell + 0.37) - 0.5;
      p.xz += j * 0.36;
    }
    // Animate both top corners of a plant together.
    animRef = vec3(cell.x + 0.5, p.y, cell.y + 0.5);
    v.normal = vec3(0, 1, 0);
    v.tangent = n == 6u ? normalize(vec3(1, 0, 1)) : normalize(vec3(-1, 0, 1));
    v.bitangent = vec3(0, 1, 0);
    // The fragment shader derives the height along the plant from fract(uv.y).
    v.plantV = 0.0;
  }

  if (n < 6u) {
    // Expand cube faces by a hair along their plane to close T-junction cracks.
    const float EPS = 0.0022;
    float us = ((w0 >> 27u) & 1u) == 1u ? EPS : -EPS;
    float vs = ((w0 >> 28u) & 1u) == 1u ? EPS : -EPS;
    if (n < 2u) p += vec3(0.0, vs, us);
    else if (n < 4u) p += vec3(us, 0.0, vs);
    else p += vec3(us, vs, 0.0);
  }

  vec3 world = chunkOrigin + animRef;
  if (anim == 1u) {
    p += windOffset(world, 0.045) * smoothstep(0.3, 0.9, v.sky);
  } else if (anim == 2u) {
    p.xz += windOffset(world, 0.11).xz * smoothstep(0.3, 0.9, v.sky);
  } else if (anim == 3u) {
    p.y -= 0.125;
    p.y += (sin(world.x * 0.8 + uTime * 1.6) + sin(world.z * 0.7 + uTime * 1.3 + world.x * 0.2)) * 0.018;
  }
  v.pos = p;
  return v;
}
