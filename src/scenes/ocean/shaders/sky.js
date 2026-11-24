import { noiseChunk, skyChunk, underwaterChunk } from './chunks';

export const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // the dome is centred on the camera, so its local position is the view direction
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`;

export const skyFragment = /* glsl */ `
#include <common>
#include <dithering_pars_fragment>
varying vec3 vDir;
uniform float uTime;
uniform vec2 uWind;
uniform vec3 uSunDir;
uniform float uGlow;
uniform vec3 uWaterColor; // sRGB, same as the scene fog colour
uniform float uUnder;     // 0 above water, 1 fully underwater
uniform vec3 uRayDir;     // direction of the light as seen from underwater
uniform float uDepthLight; // 1 near the surface, fading with depth

${noiseChunk}
${skyChunk}
${underwaterChunk}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir, normalize(uSunDir), uTime, uWind, SKY_CLOUD_OCT, 1.0, uGlow);
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // A camera at or below the waves that looks below the horizon is looking into the water, not at sky.
  float lowCamera = 1.0 - smoothstep(0.6, 2.5, cameraPosition.y);
  float belowHorizon = 1.0 - smoothstep(-0.12, 0.0, dir.y);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, underwaterColor(dir), max(uUnder, belowHorizon * lowCamera));
  #include <dithering_fragment>
}
`;
