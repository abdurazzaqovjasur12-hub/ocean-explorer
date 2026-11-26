// Shared GLSL chunks. Plain strings (not ?raw imports) so the same code can be loaded by Vite,
// by tests, and composed into the final shaders in ocean.js / sky.js.

/** Hash-based value noise, with and without analytic derivatives. No textures. */
export const noiseChunk = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// x = value, yz = derivative with respect to the input coordinates
vec3 vnoised(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
              du * (vec2(k1, k2) + k4 * u.yx));
}

const mat2 ROT = mat2(0.8, 0.6, -0.6, 0.8);

float clamp01(float x) { return clamp(x, 0.0, 1.0); }
`;

/**
 * Procedural sky: gradient, warm sun glow, optional sun disc and drifting clouds.
 * Used for the sky dome, for reflections on the water and for the haze at the horizon.
 */
export const skyChunk = /* glsl */ `
uniform float uNight; // 0 day .. 1 moonlit night (eased by GSAP between the modes)

// Stars: one in ~70 cells of a grid on the sky, each its own size and twinkle. One hash per pixel.
float starField(vec3 dir, float t) {
  vec3 p = dir * 120.0;
  vec3 cell = floor(p);
  float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  if (h < 0.986) return 0.0;
  vec3 off = vec3(fract(h * 13.1), fract(h * 71.7), fract(h * 37.3)) - 0.5;
  float d = length(fract(p) - 0.5 - off * 0.6);
  float size = 0.11 + 0.12 * fract(h * 91.3);
  float twinkle = 0.6 + 0.4 * sin(t * (1.3 + 2.8 * fract(h * 7.7)) + h * 40.0);
  return smoothstep(size, 0.0, d) * twinkle * (0.7 + 3.0 * pow(fract(h * 5.3), 3.0));
}

float cloudDensity(vec3 dir, float t, vec2 wind, int octaves) {
  float h = dir.y;
  if (h <= 0.0) return 0.0;
  vec2 q = dir.xz / (h + 0.18) * 0.85 + wind * (t * 0.010);
  float n = 0.0;
  float amp = 0.55;
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    n += amp * vnoise(q);
    total += amp;
    q = ROT * q * 2.03 + 17.0;
    amp *= 0.5;
  }
  n /= total;
  float c = smoothstep(0.56, 0.80, n);
  return c * smoothstep(0.0, 0.22, h);
}

// Day: golden-hour sky with a low sun. Night (uNight): deep blue-black, a cool moon with a soft halo,
// moonlit clouds and twinkling stars. The palettes are blended before use, so it is one evaluation either way.
vec3 skyColor(vec3 dir, vec3 sunDir, float t, vec2 wind, int cloudOct, float sunDisc, float glow) {
  float n = uNight;
  float h = max(dir.y, 0.0);
  float sd = max(dot(dir, sunDir), 0.0);
  float a = pow(h, 0.45);

  vec3 horizon = mix(vec3(0.36, 0.48, 0.62), vec3(0.030, 0.046, 0.088), n);
  vec3 mid     = mix(vec3(0.06, 0.17, 0.46), vec3(0.008, 0.019, 0.052), n);
  vec3 top     = mix(vec3(0.012, 0.055, 0.28), vec3(0.002, 0.005, 0.021), n);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.55, a));
  col = mix(col, top, smoothstep(0.45, 1.0, a));

  float lowBand = 1.0 - smoothstep(0.0, 0.6, a);
  float haloWide = pow(sd, 4.0);
  float haloTight = pow(sd, 24.0);
  vec3 warm = mix(vec3(1.0, 0.45, 0.16), vec3(0.32, 0.38, 0.52), n); // warm sun -> cool moon
  col += warm * (pow(sd, 6.0) * 0.45 * (0.12 + 0.88 * lowBand * lowBand) * mix(1.0, 0.45, n) + haloTight * mix(1.3, 0.9, n)) * glow;
  col = mix(col, mix(vec3(0.92, 0.56, 0.30), vec3(0.10, 0.12, 0.19), n), haloWide * lowBand * mix(0.5, 0.35, n));

  float c = 0.0;
  if (cloudOct > 0) c = cloudDensity(dir, t, wind, cloudOct);
  vec3 cloudDay = mix(vec3(0.60, 0.68, 0.80), vec3(1.0, 0.66, 0.42), clamp01(pow(sd, 3.0) * 1.2));
  vec3 cloudNight = mix(vec3(0.030, 0.040, 0.066), vec3(0.40, 0.45, 0.56), clamp01(pow(sd, 3.0) * 1.4));
  vec3 cloudCol = mix(cloudDay, cloudNight, n) * (0.60 + 1.3 * pow(sd, 8.0) * glow);
  col = mix(col, cloudCol, c * 0.6);

  // Stars where there is open sky: not behind clouds, not in the moon's glare, not in the horizon haze.
  if (sunDisc > 0.5 && n > 0.001) {
    float stars = starField(dir, t) * smoothstep(0.03, 0.3, h) * (1.0 - c) * (1.0 - smoothstep(0.85, 0.99, sd));
    col += vec3(0.82, 0.88, 1.0) * stars * n;
  }

  // The sun's disc, or the moon's: a little larger, much less bright, cool white.
  float disc = smoothstep(mix(0.99978, 0.99962, n), mix(0.99993, 0.99980, n), sd) * sunDisc;
  col += mix(vec3(1.0, 0.75, 0.45) * 40.0, vec3(0.88, 0.92, 1.0) * 9.0, n) * disc * (1.0 - c * 0.9);
  return col;
}
`;

/**
 * Gerstner wave sum with analytic slope and Jacobian. Used by the vertex shader (large waves,
 * as geometry) and by the fragment shader (all waves, as normals and foam).
 * Each wave fades out once it gets close to the sampling footprint `fp` (vertex spacing or
 * pixel size), which removes shimmering and aliasing at a distance.
 */
export const wavesChunk = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform vec4 uWaveA[WAVE_COUNT]; // dirX, dirZ, k, amplitude
uniform vec4 uWaveB[WAVE_COUNT]; // omega, phase, 1/(k*amplitude), wavelength
uniform float uWaveAmp;
uniform float uChoppy;

struct WaveResult {
  vec3 disp;   // x/z horizontal displacement, y height
  vec2 slope;  // d height / d (x, z)
  float sq;    // sum of Q*k*A*sin: pinches normals at crests
  float jac;   // Jacobian determinant: small where the surface bunches up (foam)
  float lost;  // slope variance removed by fading (turned into roughness)
  float gust;  // 0..1 low-frequency wind patchiness
};

WaveResult evalWaves(vec2 p0, float fp, float fadeLo, float fadeHi) {
  WaveResult r;
  r.disp = vec3(0.0);
  r.slope = vec2(0.0);
  r.sq = 0.0;
  r.lost = 0.0;

  // Domain warp and patchy amplitude keep the sea from looking like a tiled pattern.
  vec2 wq = p0 * 0.012 + uWind * (uTime * 0.02);
  vec2 warp = vec2(vnoise(wq), vnoise(wq + 31.7)) - 0.5;
  vec2 p = p0 + warp * 9.0;
  r.gust = vnoise(p0 * 0.016 - uWind * (uTime * 0.06) + 7.0);
  float ampMod = uWaveAmp * (0.75 + 0.55 * r.gust);

  float jxx = 0.0;
  float jzz = 0.0;
  float jxz = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec4 wa = uWaveA[i];
    vec4 wb = uWaveB[i];
    vec2 d = wa.xy;
    float k = wa.z;
    float fade = 1.0 - smoothstep(fadeLo, fadeHi, fp * k * 0.15915494); // fp / wavelength
    float a = wa.w * ampMod * fade;
    float th = k * dot(d, p) - wb.x * uTime + wb.y;
    float s = sin(th);
    float c = cos(th);
    float q = uChoppy * wb.z / max(float(WAVE_COUNT), 9.0); // low tiers stay as gentle as the rest
    float ka = k * a;

    r.disp.y += a * s;
    r.disp.xz += d * (q * a * c);
    r.slope += d * (ka * c);
    r.sq += q * ka * s;
    jxx += q * ka * d.x * d.x * s;
    jzz += q * ka * d.y * d.y * s;
    jxz += q * ka * d.x * d.y * s;

    float full = k * wa.w * ampMod;
    r.lost += (1.0 - fade) * full * full * 0.5;
  }
  r.jac = (1.0 - jxx) * (1.0 - jzz) - jxz * jxz;
  return r;
}
`;

/**
 * What open water looks like underwater, in output colour space: lighter towards the surface, darker below,
 * with a soft scattered glow and slowly drifting rays around the direction the light comes from. Needs
 * uWaterColor, uRayDir, uDepthLight and uTime. Shared by the sky dome and by the far surface seen from
 * below, so the two meet without a seam.
 */
export const underwaterChunk = /* glsl */ `
// Rays fanning out from the light: bright and dim spokes that drift. Sampled on a circle (not with atan),
// so there is no seam; even right at the source so the spokes never pinch into a star.
float rayStreaks(vec3 dir) {
  vec3 r = normalize(uRayDir);
  vec3 a = normalize(cross(r, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 b = cross(r, a);
  vec3 q = dir - r * dot(dir, r);
  vec2 c = vec2(dot(q, a), dot(q, b)) / max(length(q), 1e-4);
  float n1 = vnoise(c * 2.6 + vec2(uTime * 0.03, 3.1));
  float n2 = vnoise(c * 6.5 - vec2(5.7, uTime * 0.05));
  float spokes = 0.3 + 1.2 * smoothstep(0.25, 0.85, n1 * 0.65 + n2 * 0.35);
  float away = 1.0 - clamp(dot(dir, r), 0.0, 1.0);
  return mix(0.85, spokes, smoothstep(0.015, 0.22, away));
}

vec3 underwaterColor(vec3 dir) {
  float toward = smoothstep(-0.3, 0.9, dir.y);
  vec3 col = uWaterColor * mix(0.78, 1.0 + 0.45 * uDepthLight, toward);
  float glow = pow(max(dot(dir, normalize(uRayDir)), 0.0), 4.0);
  col += vec3(0.16, 0.42, 0.50) * glow * rayStreaks(dir) * uDepthLight * 0.55;
  col += vec3(0.05, 0.15, 0.2) * smoothstep(0.2, 1.0, dir.y) * uDepthLight;
  return col;
}
`;
