import { clamp, lerp, smoothstep } from '@/utils/math';

/** World scale: how deep the column goes and how metres map to scene units. */
export const MAX_DEPTH = 11000; // metres, roughly the Mariana Trench
export const DEPTH_SCALE = 0.05; // scene units per metre
export const SURFACE_OFFSET = 1; // the camera starts this far below the surface plane

export const depthToY = (depth) => -(depth * DEPTH_SCALE) - SURFACE_OFFSET;

/** Metres below the surface for a camera height (the inverse of depthToY). Zero above the water and in the surface layer. */
export const metersBelowSurface = (y) => Math.max(0, (-y - SURFACE_OFFSET) / DEPTH_SCALE);

/** The dive begins above the water; over the first SURFACE_BLEND metres the camera sinks through the surface. */
export const CAMERA_SURFACE_Y = 5.5;
export const SURFACE_BLEND = 120;
export const cameraYAtDepth = (depth) =>
  lerp(CAMERA_SURFACE_Y, depthToY(depth), smoothstep(0, SURFACE_BLEND, depth));

/** Depth zones. Their names are translations: `zones.<id>` in src/i18n/locales. */
export const ZONES = [
  { id: 'sunlight', from: 0, to: 200 },
  { id: 'twilight', from: 200, to: 1000 },
  { id: 'midnight', from: 1000, to: 4000 },
  { id: 'abyssal', from: 4000, to: 6000 },
  { id: 'hadal', from: 6000, to: MAX_DEPTH },
];

export function zoneIndexAt(depth) {
  let index = 0;
  for (let i = 0; i < ZONES.length; i++) if (depth >= ZONES[i].from) index = i;
  return index;
}

export const zoneAt = (depth) => ZONES[zoneIndexAt(depth)];

/**
 * 0..1 position on the depth gauge. Each zone gets an equal slice of the track
 * so the thin upper zones stay readable.
 */
export function gaugePosition(depth) {
  const i = zoneIndexAt(depth);
  const zone = ZONES[i];
  const t = clamp((depth - zone.from) / (zone.to - zone.from), 0, 1);
  return (i + t) / ZONES.length;
}

