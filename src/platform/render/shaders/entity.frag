uniform sampler2D uAtlas;
uniform sampler2D uEmissiveMap;
uniform vec2 uProbe;     // sky, block light at the entity (0..1)
uniform vec4 uTint;      // rgb + strength: hurt flash / wind-up glow
uniform float uOpacity;  // dithered fade-out on death

in vec3 vViewPos;
in vec3 vRelPos;
in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;

layout(location = 0) out vec4 fragColor;

void main() {
  vec4 albedo = texture(uAtlas, vUv);
  if (albedo.a < 0.5) discard;
  if (uOpacity < 0.999 && ign(gl_FragCoord.xy) > uOpacity) discard;
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float sky = uProbe.x;
  float blk = uProbe.y;
  float ndl = saturate(dot(N, uLightDir));
  float vis = 0.0;
  if (ndl > 0.0 && uLightDir.y > -0.05) vis = shadowFactor(vRelPos, ndl) * smoothstep(0.25, 0.8, sky) * cloudShadow(vWorldPos);
  vec3 direct = uLightColor * ndl * vis;
  vec3 amb = mix(uAmbientGround, uAmbientSky, N.y * 0.5 + 0.5) * max(sky * sky, 0.04);
  vec3 torch = uBlockLight * (pow(blk, 3.2) * 1.8 + blk * 0.06);
  // Gentle wrap light so shaded sides keep their shape.
  float wrap = saturate(dot(N, uLightDir) * 0.5 + 0.5) * 0.12;
  vec3 color = albedo.rgb * (direct + amb * (0.85 + wrap) + torch + uMinLight);
  color += albedo.rgb * texture(uEmissiveMap, vUv).r * 4.0;
  color = mix(color, uTint.rgb * (0.35 + luma(color) * 0.8), uTint.a);
  color = applyFog(color, vRelPos, vWorldPos.y, sky);
  fragColor = vec4(color, 1.0);
}
