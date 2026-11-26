import * as THREE from 'three';
import { HINGE } from './geometry';
import { getNoiseTexture } from '../reef/noiseTexture';

/** Uniforms shared by both levels of detail (one material). */
export const skinUniforms = () => ({
  uSwim: { value: 0 }, // phase of the tail beat
  uAmp: { value: 0.45 }, // how far the tail sweeps (units)
  uTurn: { value: 0 }, // the body curving into a turn (+ bends towards +z)
  uJaw: { value: 0 }, // 0 closed .. 1 open (a moderate gape)
  uVanish: { value: 1 }, // 0 seen .. 1 dissolved into the dark water (mixed to the fog colour: no transparency)
  uViewUp: { value: new THREE.Vector3(0, 1, 0) },
  uDown: { value: new THREE.Color(0.05, 0.09, 0.14) }, // the last of the moonlight, from above
  uRim: { value: new THREE.Color(0.05, 0.11, 0.17) }, // a faint edge of light: the silhouette reads against the water
  uEyeShine: { value: 0 },
  uGlowPass: { value: 0 }, // 1 while drawn into the bloom: black, so it hides the glow behind it
  // Baked noise (the reef's 256 x 256 tiling texture): a few reads instead of dozens of hashes per pixel,
  // which matters when the shark fills the screen.
  uNoise: { value: getNoiseTexture() }, // shared with the reef
});

/*
 * Lit by the scene's own lights (the faint moonlight from above and the explorer's lamp, which is what reveals
 * the face as it comes close), plus three soft terms of its own so it reads in near-black water without adding
 * any light to the scene: downwelling light on the back, a rim, and the eyes' shine (sharks have a reflective
 * layer behind the retina). The pattern is all procedural: countershading (dark slate back, white belly, the
 * wavy line between), fine dermal denticles (a bump that fades out with distance, so it never shimmers), the
 * gill slits, a few pale scars, and darker creases (gills, under the fins, the mouth).
 */
const vertexHead = /* glsl */ `
attribute float aPart;
attribute float aJaw;
uniform float uSwim;
uniform float uAmp;
uniform float uTurn;
uniform float uJaw;
varying vec3 vObj;
varying vec3 vObjN;
varying float vPart;

// Sideways offset of the spine at x: a wave running back to the tail (nothing at the head but a little
// recoil), plus the curve of a turn.
float spine(float x) {
  float w = smoothstep(3.2, -7.8, x);
  float beat = uAmp * w * w * sin(uSwim + x * 0.42);
  float recoil = -uAmp * 0.06 * smoothstep(3.5, 8.6, x) * sin(uSwim + 1.3);
  float d = x - 0.6;
  return beat + recoil + uTurn * d * d * 0.018;
}
vec3 jawTurn(vec3 p, float k) {
  float a = -uJaw * 0.36 * k;
  vec2 r = p.xy - vec2(${HINGE.x.toFixed(3)}, ${HINGE.y.toFixed(3)});
  float c = cos(a), s = sin(a);
  return vec3(vec2(${HINGE.x.toFixed(3)}, ${HINGE.y.toFixed(3)}) + vec2(c * r.x - s * r.y, s * r.x + c * r.y), p.z);
}
`;

const fragmentHead = /* glsl */ `
uniform vec3 uViewUp;
uniform vec3 uDown;
uniform vec3 uRim;
uniform float uEyeShine;
uniform float uVanish;
uniform float uGlowPass;
uniform sampler2D uNoise;
varying vec3 vObj;
varying vec3 vObjN;
varying float vPart;

// Baked noise, looked up across the body (x along it; the cross-section folded into one coordinate).
vec4 noiseAt(float sx, float sy, float sz, vec2 offset) {
  return texture2D(uNoise, vec2(vObj.x * sx, vObj.y * sy + vObj.z * sz) + offset);
}
vec3 skinBump(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = normalize(dFdx(surfPos));
  vec3 sy = normalize(dFdy(surfPos));
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
// The five gill slits on each side: 0 outside, 1 in a slit.
float gills(vec3 p, vec3 n) {
  float side = smoothstep(0.25, 0.6, abs(n.z));
  float s = (p.x - 4.25) / 0.34;
  float k = abs(fract(s) - 0.5);
  float inRange = step(0.0, s) * step(s, 5.0);
  float lean = p.y * 0.18; // the slits lean back towards the bottom
  float s2 = (p.x - 4.25 + lean) / 0.34;
  k = abs(fract(s2) - 0.5);
  float height = 1.0 - smoothstep(0.55, 0.95, abs(p.y + 0.05) / (1.25 - 0.08 * s2));
  return side * inRange * height * (1.0 - smoothstep(0.05, 0.11, k));
}
`;

/** detail: false drops the fine skin bump (denticles, gill relief): the low tier's cheaper pixel shader. */
export function skinMaterial(uniforms, detail = true) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0 });
  material.defines = { SKIN_DETAIL: detail ? 1 : 0 };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = (vertexHead + shader.vertexShader)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
// Turn the normal with the bend of the spine (its slope) and with the jaw.
float slope = (spine(position.x + 0.05) - spine(position.x - 0.05)) / 0.1;
objectNormal = normalize(vec3(objectNormal.x - slope * objectNormal.z, objectNormal.y, objectNormal.z));
if (aJaw > 0.0) {
  float ja = -uJaw * 0.36 * aJaw;
  objectNormal.xy = vec2(cos(ja) * objectNormal.x - sin(ja) * objectNormal.y, sin(ja) * objectNormal.x + cos(ja) * objectNormal.y);
}`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vObj = position;
vObjN = normal;
vPart = aPart;
if (aJaw > 0.0) transformed = jawTurn(transformed, aJaw);
transformed.z += spine(position.x);`,
      );

    shader.fragmentShader = (fragmentHead + shader.fragmentShader)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 n0 = normalize(vObjN);
// Countershading: dark slate grey above, white below, the line between wandering along the flank.
vec4 patches = noiseAt(0.045, 0.09, 0.06, vec2(0.0));
float wander = 0.16 * sin(vObj.x * 1.1 + 0.6) + 0.07 * sin(vObj.x * 3.3 + 1.9) + 0.24 * (patches.g - 0.5);
float back = smoothstep(-0.42, -0.12, vObj.y - profileLine(vObj.x) + wander);
vec3 slate = vec3(0.045, 0.052, 0.058) * (0.8 + 0.4 * patches.r);
vec3 belly = vec3(0.46, 0.46, 0.45);
vec3 skin = mix(belly, slate, back);
// Scars: a few long, pale scratches on the flanks and the head.
float sc = smoothstep(0.993, 0.9995, sin(vObj.x * 2.6 + vObj.y * 7.0 + sin(vObj.z * 3.0) * 1.5)) * smoothstep(0.66, 0.8, patches.b * 1.14);
skin = mix(skin, skin * 2.2 + 0.03, sc * 0.6);
float crease = 0.0;
if (vPart < 0.5) {
  crease = gills(vObj, n0);
  skin *= 1.0 - 0.72 * crease;
  // Darker in the crease under the pectoral fins and along the jaw line.
  skin *= 1.0 - 0.35 * smoothstep(1.1, 0.6, abs(vObj.z) - 0.6) * smoothstep(-0.5, -1.2, vObj.y) * step(3.0, vObj.x) * step(vObj.x, 5.6);
} else if (vPart < 1.5) {
  // Fins: dark above and on the outside; pale below with darker tips (as in the great white).
  float up = n0.y;
  skin = mix(vec3(0.36, 0.36, 0.35), slate * 0.9, clamp(smoothstep(-0.25, 0.15, up) + step(abs(vObj.z), 0.2), 0.0, 1.0));
  float tip = smoothstep(2.6, 3.4, length(vObj.yz - vec2(-0.9, 1.2 * sign(vObj.z))));
  skin = mix(skin, vec3(0.03, 0.035, 0.04), tip * 0.8 * step(up, 0.0));
} else if (vPart < 2.5) {
  // Lower jaw: white outside, dark inside (towards the mouth).
  skin = mix(belly * 0.9, vec3(0.05, 0.025, 0.025), smoothstep(0.1, 0.6, n0.y));
} else if (vPart < 3.5) {
  skin = vec3(0.62, 0.6, 0.52); // teeth: ivory
} else if (vPart < 4.5) {
  skin = vec3(0.035, 0.018, 0.018); // the inside of the mouth: dark
} else {
  skin = vec3(0.015, 0.016, 0.02); // eye
}
diffuseColor.rgb *= skin;
// Right in front of the lens the explorer's lamp would burn it out to white: hold the exposure back.
diffuseColor.rgb *= mix(0.3, 1.0, smoothstep(2.0, 12.0, length(vViewPosition)));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#if SKIN_DETAIL
// Dermal denticles: a fine, slightly streaked grain (they lie along the body), faded with distance.
float dist = length(vViewPosition);
float bumpFade = smoothstep(26.0, 6.0, dist) * step(vPart, 1.5);
float grain = noiseAt(0.14, 0.42, 0.3, vec2(0.37, 0.11)).a * 0.6 + noiseAt(0.05, 0.12, -0.1, vec2(0.61, 0.83)).r * 0.4; // streaked along the body
float h = grain * 0.5 + gills(vObj, normalize(vObjN)) * 0.8;
normal = skinBump(-vViewPosition, normal, vec2(dFdx(h), dFdy(h)) * 0.22 * bumpFade, faceDirection);
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
if (vPart > 2.5 && vPart < 3.5) roughnessFactor = 0.3; // teeth: glossy
if (vPart > 4.5) roughnessFactor = 0.12; // eyes: wet`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float upness = dot(normal, uViewUp);
float facing = abs(dot(normal, normalize(vViewPosition)));
totalEmissiveRadiance += diffuseColor.rgb * uDown * smoothstep(-0.2, 1.0, upness);
totalEmissiveRadiance += uRim * pow(1.0 - facing, 2.4) * (0.3 + 0.7 * smoothstep(-0.5, 1.0, upness));
if (vPart > 4.5) totalEmissiveRadiance += vec3(0.1, 0.17, 0.13) * pow(facing, 6.0) * uEyeShine; // eyeshine`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, uVanish);
#endif
gl_FragColor.rgb *= 1.0 - uGlowPass;`,
      );
    // profileLine: roughly the height of the flank's widest point along the body (where the colours meet).
    shader.fragmentShader = shader.fragmentShader.replace(
      'float gills(',
      `float profileLine(float x) { return -0.12 - 0.18 * smoothstep(2.0, 7.5, x) + 0.04 * smoothstep(-2.0, -7.0, x); }
float gills(`,
    );
  };
  material.customProgramCacheKey = () => 'megalodon-skin';
  return material;
}
