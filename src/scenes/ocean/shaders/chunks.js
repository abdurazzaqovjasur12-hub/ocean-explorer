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

/** Drifting clouds (density 0..1 in a direction), and the night level they depend on. Needs noiseChunk. */
export const cloudChunk = /* glsl */ `
uniform float uNight; // 0 day .. 1 moonlit night (eased by GSAP between the modes)

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
  // At night the sky clears: fewer, thinner clouds, so the stars and the aurora show.
  float c = smoothstep(0.56 + 0.12 * uNight, 0.80 + 0.08 * uNight, n);
  return c * smoothstep(0.0, 0.22, h);
}
`;

/** The aurora, on its own: used by the sky (skyChunk) and, per vertex, for its reflection on the sea. */
export const auroraChunk = /* glsl */ `
#ifndef AURORA_LAYERS
#define AURORA_LAYERS 3
#endif
#ifndef AURORA_RAY_LAYERS
#define AURORA_RAY_LAYERS AURORA_LAYERS
#endif
/**
 * The aurora: enormous curtains far off to the north (the right of the view and ahead), as a function of the
 * direction only, so it also appears, softened, in the reflections on the sea. Each layer has a sharp, bright
 * lower edge that wanders slowly, fades upwards from green through teal to violet, folds where the curtain turns,
 * and (in full detail) is combed into fine vertical rays that shimmer. AURORA_LAYERS layers at different heights;
 * the first AURORA_RAY_LAYERS of them get the rays. With full = false (reflections: the ocean evaluates it per vertex)
 * uses no noise at all. Only needs noiseChunk, so it can run in a vertex shader too.
 */
vec3 aurora(vec3 dir, float t, bool full) {
  float el = dir.y;
  if (el <= 0.0) return vec3(0.0);
  float az = atan(dir.x, -dir.z); // 0 straight ahead, positive to the right
  vec3 col = vec3(0.0);
  for (int i = 0; i < AURORA_LAYERS; i++) {
    float fi = float(i);
    float x = az - (0.55 + 0.22 * fi) - 0.08 * sin(t * 0.011 + fi * 2.0);
    float env = smoothstep(1.3, 0.45, abs(x)) * (0.75 + 0.25 * sin(x * 2.3 + fi + t * 0.02));
    if (env <= 0.0) continue;
    // The lower edge: a long, slow sweep plus tighter meanders and folds, all drifting.
    // Seen in perspective a curtain arcs: lowest where it is nearest, rising towards its far ends.
    float base = 0.08 + 0.1 * fi + 0.1 * x * x + 0.06 * sin(x * 1.4 + t * 0.035 + fi * 2.1) + 0.03 * sin(x * 4.2 - t * 0.05 + fi)
               + (full ? 0.05 * (vnoise(vec2(x * 2.6 + t * 0.02, fi * 7.0)) - 0.5) : 0.0);
    float v = el - base;
    float h = 0.12 + 0.07 * fi;
    if (v < -0.03 || v > h * 5.0) continue; // below the curtain, or so far above it that nothing is left
    float prof = smoothstep(-0.02, 0.012, v) * exp(-max(v, 0.0) / h);
    // Reflections (full = false) skip every noise lookup: the waves break the image up anyway, and the sea
    // is the most-drawn surface on screen.
    float wander = full ? 3.0 * vnoise(vec2(x * 1.2 - t * 0.025, fi * 3.1)) : 1.5 * sin(x * 1.1 - t * 0.025 + fi * 3.1);
    float fold = 0.25 + 0.75 * smoothstep(-0.5, 0.95, sin(x * 3.4 + wander + t * 0.05));
    float rays = 1.0;
    if (full && i < AURORA_RAY_LAYERS) {
      float warp = vnoise(vec2(x * 3.5 + fi * 4.0, t * 0.05));
      float bundle = smoothstep(0.25, 0.8, vnoise(vec2(x * 9.0 + warp * 2.0, t * 0.07 + fi * 5.0)));
      rays = 0.35 + (0.5 + 0.9 * bundle) * vnoise(vec2(x * 52.0 + warp * 8.0, t * 0.2 + fi * 11.0));
    }
    float k = clamp(max(v, 0.0) / (h * 2.4), 0.0, 1.0);
    vec3 green = mix(vec3(0.16, 1.0, 0.52), vec3(0.1, 0.85, 0.8), fi * 0.45);
    vec3 c = mix(green, vec3(0.12, 0.62, 1.0), smoothstep(0.15, 0.6, k));
    c = mix(c, vec3(0.62, 0.28, 0.95), smoothstep(0.5, 1.0, k));
    float strength = (fi == 0.0 ? 0.34 : (fi == 1.0 ? 0.2 : 0.12));
    float airglow = exp(-abs(v) / 0.06) * 0.22; // a soft glow in the air around the bright lower edge
    col += (c * prof * fold * rays + green * airglow * (0.5 + 0.5 * fold)) * env * strength;
  }
  // The whole display slowly brightens and dims over minutes.
  return col * (0.8 + 0.2 * sin(t * 0.045) * sin(t * 0.017 + 1.3)) * smoothstep(0.0, 0.05, el);
}
`;

/**
 * Procedural sky: gradient, sun or moon glow, the sun's disc or a detailed moon, drifting clouds and, at night,
 * the Milky Way, the aurora, faint background stars and shooting stars. Used for the sky dome, for reflections on
 * the water and for the haze at the horizon (simplified there: see skyColor).
 */
export const skyChunk = /* glsl */ `
${cloudChunk}
${auroraChunk}
uniform vec4 uMeteorA[2]; // shooting stars: start direction (xyz), progress 0..1 (w, < 0 when idle)
uniform vec4 uMeteorB[2]; // direction of travel (xyz, unit, tangent to the sky), arc length in radians (w)

// Quality (set per material from config/quality.js; these are the fallbacks).
#ifndef MILKY_OCT
#define MILKY_OCT 3
#endif

// The Milky Way: a great circle across the sky (the galactic plane, normal GAL_N), brightest towards the
// galactic centre GAL_C. The star points (nightSky.js) crowd along the same band.
// It rises from the horizon ahead-left (where its bright core sits, low) and arches up over the right.
const vec3 GAL_N = vec3(-0.5794, 0.5990, 0.5527);
const vec3 GAL_C = vec3(-0.6178, 0.1196, -0.7772);
const vec3 GAL_B = vec3(-0.5316, -0.7918, 0.3007);

// Faint background stars: one in ~70 cells of a grid on the sky, too small and dim to count, the dust behind
// the real star field. One hash per pixel.
float starField(vec3 dir, float t) {
  vec3 p = dir * 160.0;
  vec3 cell = floor(p);
  float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  if (h < 0.982) return 0.0;
  vec3 off = vec3(fract(h * 13.1), fract(h * 71.7), fract(h * 37.3)) - 0.5;
  float d = length(fract(p) - 0.5 - off * 0.6);
  float twinkle = 0.7 + 0.3 * sin(t * (1.1 + 2.4 * fract(h * 7.7)) + h * 40.0);
  return smoothstep(0.13, 0.0, d) * twinkle * (0.25 + 0.5 * fract(h * 5.3));
}

/** The Milky Way's glow: soft star clouds along the band, darker dust lanes down its middle, a warmer core. */
vec3 milkyWay(vec3 dir) {
  float d = dot(dir, GAL_N);
  float band = exp(-d * d / 0.022);
  if (band < 0.02) return vec3(0.0);
  vec2 q = vec2(dot(dir, GAL_C), dot(dir, GAL_B)) * 3.2 + d * 2.0;
  float clouds = 0.0;
  float amp = 0.55;
  vec2 p = q;
  for (int i = 0; i < MILKY_OCT; i++) {
    clouds += amp * vnoise(p);
    p = ROT * p * 2.17 + 5.3;
    amp *= 0.5;
  }
  float dust = smoothstep(0.42, 0.72, vnoise(q * 1.7 + 9.0) * 0.6 + vnoise(q * 4.3 - 3.0) * 0.4) * exp(-d * d / 0.004);
  float core = pow(max(dot(dir, GAL_C), 0.0), 5.0);
  vec3 col = mix(vec3(0.42, 0.5, 0.78), vec3(0.85, 0.72, 0.58), core * 0.7);
  return col * band * smoothstep(0.25, 0.85, clouds) * (1.0 - 0.75 * dust) * (0.55 + 1.6 * core);
}

/**
 * The moon, seen up close: a sphere lit from the side (a waxing gibbous phase), with dark maria, brighter
 * highlands, a bright young crater and limb darkening; the unlit edge keeps a trace of earthshine.
 * Returns colour in rgb and coverage in a.
 */
vec4 moonDisc(vec3 dir, vec3 md) {
  const float R = 0.021; // angular radius: larger than life, as the eye remembers it, but not cartoonish
  float cosA = dot(dir, md);
  if (cosA < 0.999) return vec4(0.0);
  vec3 T = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
  vec3 B = cross(T, md);
  vec2 uv = vec2(dot(dir, T), dot(dir, B)) / R;
  float rr = dot(uv, uv);
  float aa = fwidth(rr) + 0.01;
  float cover = smoothstep(1.0 + aa, 1.0 - aa, rr);
  if (cover <= 0.0) return vec4(0.0);
  vec3 nrm = vec3(uv, sqrt(max(0.0, 1.0 - rr)));
  vec2 s = uv * 1.1 + 0.3;
  float maria = smoothstep(0.4, 0.62, vnoise(s * 2.0 + 3.0) * 0.6 + vnoise(s * 4.4 + 11.0) * 0.4);
  float highland = 0.82 + 0.3 * vnoise(s * 9.0 + 5.0) + 0.12 * vnoise(s * 21.0 + 1.0);
  float crater = smoothstep(0.62, 0.8, vnoise(s * 13.0 + 7.0)) * 0.18; // small bright rims
  vec2 tycho = uv - vec2(-0.18, -0.58);
  float young = exp(-dot(tycho, tycho) * 220.0) * 0.6 + exp(-dot(tycho, tycho) * 18.0) * 0.08; // a bright crater with a soft splash
  float albedo = mix(highland, 0.42, maria) + crater + young;
  vec3 sunOnMoon = normalize(vec3(-0.62, 0.18, 0.76)); // light from the left: waxing gibbous
  float lit = smoothstep(-0.06, 0.14, dot(nrm, sunOnMoon));
  float limb = 0.6 + 0.4 * pow(nrm.z, 0.6);
  vec3 col = vec3(0.93, 0.95, 1.0) * albedo * limb * (lit * 1.35 + 0.025);
  return vec4(col, cover);
}

/** Shooting stars: up to two at once, each a short bright head with a fading tail along its path. */
vec3 meteors(vec3 dir) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec4 a = uMeteorA[i];
    if (a.w < 0.0) continue;
    vec4 b = uMeteorB[i];
    float ang = b.w * a.w;
    vec3 head = a.xyz * cos(ang) + b.xyz * sin(ang);
    vec3 tang = normalize(b.xyz * cos(ang) - a.xyz * sin(ang));
    vec3 rel = dir - head;
    float along = -dot(rel, tang); // distance back along the tail
    float tail = 0.05 + 0.1 * smoothstep(0.0, 0.4, a.w);
    if (along < -0.004 || along > tail) continue;
    float across = length(rel + tang * along);
    float fade = smoothstep(0.0, 0.12, a.w) * (1.0 - smoothstep(0.7, 1.0, a.w));
    float w = 0.0011 + 0.0009 * (1.0 - along / tail);
    float line = smoothstep(w, 0.0, across) * pow(1.0 - clamp(along / tail, 0.0, 1.0), 1.6);
    float headGlow = exp(-dot(rel, rel) / 0.000004);
    col += vec3(0.85, 0.92, 1.0) * (line * 2.2 + headGlow * 3.0) * fade;
  }
  return col;
}

// Day: golden-hour sky with a low sun. Night (uNight): deep blue-black, the Milky Way, the aurora, a detailed
// moon with a soft glow, thin moonlit clouds, faint background stars and the odd shooting star (the bright
// stars are points drawn over the dome: nightSky.js). The palettes are blended before use, so the day sky is
// one evaluation, and the night layers are skipped entirely in daytime. sunDisc > 0.5 means the sky itself
// (the dome, Snell's window): full detail and the discs; otherwise a reflection or the haze: the aurora is
// simplified and the Milky Way, stars, meteors and discs are left out.
vec3 skyColor(vec3 dir, vec3 sunDir, float t, vec2 wind, int cloudOct, float sunDisc, float glow) {
  float n = uNight;
  float h = max(dir.y, 0.0);
  float sd = max(dot(dir, sunDir), 0.0);
  float a = pow(h, 0.45);

  vec3 horizon = mix(vec3(0.36, 0.48, 0.62), vec3(0.022, 0.036, 0.072), n);
  vec3 mid     = mix(vec3(0.06, 0.17, 0.46), vec3(0.006, 0.014, 0.040), n);
  vec3 top     = mix(vec3(0.012, 0.055, 0.28), vec3(0.0015, 0.0035, 0.016), n);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.55, a));
  col = mix(col, top, smoothstep(0.45, 1.0, a));

  float lowBand = 1.0 - smoothstep(0.0, 0.6, a);
  float haloWide = pow(sd, 4.0);
  float haloTight = pow(sd, 24.0);
  vec3 warm = mix(vec3(1.0, 0.45, 0.16), vec3(0.30, 0.36, 0.50), n); // warm sun -> cool moon
  col += warm * (pow(sd, 6.0) * 0.45 * (0.12 + 0.88 * lowBand * lowBand) * mix(1.0, 0.3, n) + haloTight * mix(1.3, 0.55, n)) * glow;
  col = mix(col, mix(vec3(0.92, 0.56, 0.30), vec3(0.10, 0.12, 0.19), n), haloWide * lowBand * mix(0.5, 0.22, n));
  // The moon's own glow: a soft aureole close around it.
  col += vec3(0.55, 0.62, 0.78) * (pow(sd, 900.0) * 0.6 + pow(sd, 160.0) * 0.12) * n * glow;

  float c = 0.0;
  if (cloudOct > 0) c = cloudDensity(dir, t, wind, cloudOct);

  if (n > 0.001) {
#ifdef SKY_NO_REFLECTED_AURORA
    vec3 night = sunDisc > 0.5 ? aurora(dir, t, true) * (1.0 - 0.75 * pow(sd, 12.0)) : vec3(0.0); // the sea adds its own, per vertex
#else
    vec3 night = aurora(dir, t, sunDisc > 0.5) * (1.0 - 0.75 * pow(sd, 12.0)) * (sunDisc > 0.5 ? 1.0 : 0.45);
#endif
    if (sunDisc > 0.5) {
      night += milkyWay(dir) * 0.14 * smoothstep(0.02, 0.3, h) * (1.0 - smoothstep(0.9, 0.995, sd));
      night += vec3(0.8, 0.86, 1.0) * starField(dir, t) * smoothstep(0.03, 0.3, h) * (1.0 - smoothstep(0.85, 0.99, sd)) * 0.5;
      night += meteors(dir);
    }
    col += night * n * (1.0 - c * 0.85); // behind the clouds
  }

  vec3 cloudDay = mix(vec3(0.60, 0.68, 0.80), vec3(1.0, 0.66, 0.42), clamp01(pow(sd, 3.0) * 1.2));
  vec3 cloudNight = mix(vec3(0.016, 0.022, 0.040), vec3(0.30, 0.34, 0.44), clamp01(pow(sd, 5.0) * 1.4));
  vec3 cloudCol = mix(cloudDay, cloudNight, n) * (0.60 + 1.3 * pow(sd, 8.0) * glow);
  col = mix(col, cloudCol, c * mix(0.6, 0.5, n));

  if (sunDisc > 0.5) {
    // The sun's disc by day; the moon by night (cross-fading with the mode).
    float disc = smoothstep(0.99978, 0.99993, sd);
    col += vec3(1.0, 0.75, 0.45) * 40.0 * disc * (1.0 - n) * (1.0 - c * 0.9);
    if (n > 0.001) {
      vec4 moon = moonDisc(dir, sunDir);
      col = mix(col, moon.rgb + col * 0.15, moon.a * n * (1.0 - c * 0.7));
    }
  }
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
