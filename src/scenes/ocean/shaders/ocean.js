import { noiseChunk, skyChunk, wavesChunk, underwaterChunk } from './chunks';

export const oceanVertex = /* glsl */ `
varying vec2 vParam; // undisplaced position: where the waves are sampled
varying vec3 vWorld; // displaced position
uniform float uGridStep;

${noiseChunk}
${wavesChunk}

void main() {
  vec2 p0 = (modelMatrix * vec4(position, 1.0)).xz;
  float dist = length(vec3(p0.x - cameraPosition.x, cameraPosition.y, p0.y - cameraPosition.z));
  float fp = dist * uGridStep + 0.05; // roughly the vertex spacing here
  WaveResult w = evalWaves(p0, fp, 0.12, 0.30);
  vec3 pos = vec3(p0.x + w.disp.x, w.disp.y, p0.y + w.disp.z);
  vParam = p0;
  vWorld = pos;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

export const oceanFragment = /* glsl */ `
#include <common>
#include <dithering_pars_fragment>
varying vec2 vParam;
varying vec3 vWorld;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uGlow;
uniform vec3 uWaterColor; // sRGB, same as the scene fog colour
uniform float uWaterFog;  // underwater fog density
uniform vec3 uRayDir;     // direction of the light as seen from underwater
uniform float uDepthLight; // 1 near the surface, fading with depth
uniform float uMeters;    // camera depth in metres
uniform float uGust;      // pointer-driven energy, 0..1
uniform float uFoam;
uniform float uHaze;
uniform float uRadius;

${noiseChunk}
${skyChunk}
${wavesChunk}
${underwaterChunk}

// Small ripples that only exist in the normals. Each octave fades out before it can alias.
vec2 detailSlope(vec2 p, float fp, out float lost) {
  vec2 slope = vec2(0.0);
  lost = 0.0;
  float freq = 0.42;
  float amp = 0.032;
  for (int i = 0; i < DETAIL_OCTAVES; i++) {
    float fi = float(i);
    float ang = (fi - 1.0) * 0.45 + 0.35 * fi;
    float ca = cos(ang);
    float sa = sin(ang);
    mat2 R = mat2(ca, sa, -sa, ca);
    vec2 dir = R * uWind;
    float fade = 1.0 - smoothstep(0.18, 0.45, fp * freq);
    vec2 q = R * (p + dir * (uTime * (0.45 + 0.12 * fi)));
    vec3 n = vnoised(q * freq);
    slope += (transpose(R) * n.yz) * (amp * fade);
    lost += (1.0 - fade) * amp * amp * 1.2;
    freq *= 2.17;
    amp *= 0.58;
  }
  return slope;
}

float foamPattern(vec2 p, float fp) {
  vec2 q = p * 0.9 + uWind * (uTime * 0.22);
  float n1 = vnoise(q * 2.4);
  float n2 = vnoise(ROT * q * 6.3 - uWind * (uTime * 0.12) + 5.2);
  float fine = 1.0 - smoothstep(0.2, 0.5, fp * 17.0);
  float n3 = mix(0.5, vnoise(q * 17.0 + 3.1), fine);
  return n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 L = normalize(uSunDir);

  // Footprint of one pixel on the water, used to fade detail that would alias.
  float fp = max(length(dFdx(vParam)), length(dFdy(vParam)));

  WaveResult w = evalWaves(vParam, fp, 0.15, 0.40);
  float detailLost;
  vec2 dslope = detailSlope(vParam, fp, detailLost);
  float energy = 0.6 + 0.8 * w.gust + 0.6 * uGust;
  vec2 slope = w.slope + dslope * energy;

  vec3 N = normalize(vec3(-slope.x, 1.0 - w.sq, -slope.y));
  float distant = smoothstep(1200.0, 3800.0, dist);
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), distant * 0.8));

  // Detail that was filtered out becomes roughness, so the sun glitter widens with distance.
  float rough = sqrt(0.0009 + 2.0 * (w.lost + detailLost)) + distant * 0.05;

  vec3 col;
  float waterMix = 0.0;

  if (gl_FrontFacing) {
    // ---- seen from above ----
    N = normalize(N + V * max(0.0, 0.05 - dot(N, V))); // never face away from the viewer
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = skyColor(R, L, uTime, uWind, REFLECT_CLOUD_OCT, 0.0, uGlow);

    float cosV = clamp01(dot(N, V));
    float F = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);

    // Body colour: deep blue, lighter and greener on crests and when looking across the surface.
    float hN = clamp01(w.disp.y / (uWaveAmp * 1.1) * 0.5 + 0.5);
    float dayBody = 1.0 - 0.8 * uNight; // the moonlit sea keeps only a trace of its daytime colour
    vec3 deep    = vec3(0.002, 0.020, 0.062) * dayBody;
    vec3 shallow = vec3(0.005, 0.088, 0.175) * dayBody;
    vec3 cyan    = vec3(0.012, 0.260, 0.300) * mix(1.0, 0.2, uNight);
    float tilt = 1.0 - cosV;
    vec3 body = mix(deep, shallow, clamp01(smoothstep(0.25, 1.0, hN) * 0.75 + tilt * 0.35));
    float sss = pow(clamp01(dot(V, -normalize(L + N * 0.4))), 3.0) * smoothstep(0.4, 0.95, hN);
    body += cyan * sss * (0.8 + 0.8 * w.gust);

    // Sun glitter: GGX lobe whose width comes from the (filtered) wave slopes.
    vec3 H = normalize(L + V);
    float NdotH = clamp01(dot(N, H));
    float a = max(rough, 0.03);
    float a2 = a * a;
    float dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float D = a2 / (3.14159265 * dd * dd);
    float Fs = 0.02 + 0.98 * pow(1.0 - clamp01(dot(V, H)), 5.0);
    float spec = D * Fs / (4.0 * max(cosV, 0.08));

    col = mix(body, sky, F) + uSunColor * (spec * 0.55);

    // Foam where the surface bunches up at the crests, broken up with noise.
    // (With these moderate waves the Jacobian only dips to about 0.75, so the thresholds sit high.)
    float crest = smoothstep(0.925, 0.83, w.jac);
    float film = smoothstep(0.96, 0.90, w.jac) * 0.4; // thin lacy film around the crests
    float windy = smoothstep(0.22, 0.65, w.gust + 0.35 * uGust); // whitecaps cluster in gusty patches
    float foamMask = max(crest, film) * windy * uFoam * (1.0 - smoothstep(500.0, 2500.0, dist));
    if (foamMask > 0.002) { // the noise is only worth computing where foam can exist
      float pat = foamPattern(vParam, fp);
      float foam = foamMask * smoothstep(0.46, 0.74, pat + crest * 0.25);
      vec3 foamCol = vec3(0.70, 0.80, 0.88) * (0.45 + 0.50 * clamp01(dot(N, L) * 0.7 + 0.5)) * mix(1.0, 0.18, uNight);
      foamCol += uSunColor * 0.12 * clamp01(dot(N, L));
      col = mix(col, foamCol, clamp01(foam) * 0.85);
    }

    // Aerial perspective: everything melts into the horizon colour, fully at the edge of the mesh.
    vec3 hd = vec3(-V.x, 0.0, -V.z);
    hd = dot(hd, hd) > 1e-6 ? normalize(hd) : vec3(0.0, 0.0, -1.0);
    vec3 hazeCol = skyColor(hd, L, uTime, uWind, 0, 0.0, uGlow);
    float fogF = 1.0 - exp(-dist * uHaze);
    float edge = length(vParam - cameraPosition.xz) / uRadius;
    fogF = max(fogF, smoothstep(0.78, 1.0, edge));
    col = mix(col, hazeCol, clamp01(fogF));
  } else {
    // ---- seen from below: Snell's window onto the sky, mirror-like water outside it ----
    vec3 Nd = -N; // points down, towards the camera
    Nd = normalize(Nd + V * max(0.0, 0.05 - dot(Nd, V)));
    vec3 refr = refract(-V, Nd, 1.33); // zero vector when totally internally reflected
    float cosI = clamp01(dot(Nd, V));
    float Fu = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
    float window = smoothstep(0.0, 0.22, refr.y);
    vec3 rd = dot(refr, refr) > 0.0 ? normalize(refr) : vec3(0.0, 1.0, 0.0);
    vec3 skyT = skyColor(rd, L, uTime, uWind, 2, 1.0, uGlow);
    float shimmer = clamp01(0.5 + 2.5 * (slope.x + slope.y) * 0.5);
    vec3 waterLin = pow(uWaterColor, vec3(2.2)); // the water colour in linear light
    vec3 mirror = waterLin * mix(0.14, 0.42, shimmer) * (0.3 + 0.7 * uDepthLight);
    // The sky seen through the window has crossed uMeters metres of water: red goes first, then green, blue lasts.
    float slant = 1.0 / max(rd.y, 0.4);
    vec3 absorb = vec3(exp(-uMeters * slant / 30.0), exp(-uMeters * slant / 160.0), exp(-uMeters * slant / 700.0));
    col = mix(mirror, skyT * (1.0 - Fu) * absorb * 0.8 * mix(1.0, 0.45, uNight) + waterLin * 0.3, window); // sky through the window, softened by in-scattered water light
    col += vec3(0.02, 0.22, 0.26) * absorb * window * (1.0 - window) * 3.0 * mix(1.0, 0.1, uNight); // bright rim at the window edge (daylight)
    waterMix = 1.0 - exp(-pow(dist * uWaterFog, 2.0));
  }

  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // Far surface fades into the same underwater gradient as the sky dome behind it (no seam at the horizon).
  gl_FragColor.rgb = mix(gl_FragColor.rgb, underwaterColor(normalize(vWorld - cameraPosition)), waterMix);
  if (!gl_FrontFacing) { // light scattered in the water between you and the surface, strongest towards the sun
    vec3 toPixel = normalize(vWorld - cameraPosition);
    float scatter = pow(max(dot(toPixel, normalize(uRayDir)), 0.0), 4.0) * rayStreaks(toPixel);
    gl_FragColor.rgb += vec3(0.10, 0.30, 0.38) * scatter * uDepthLight * 0.6;
  }
  #include <dithering_fragment>
}
`;
