/**
 * Graphics quality tiers. Anything the renderer or scene needs to scale
 * lives here so there is one place to tune performance.
 * `underwater` sets the number of light shafts, rising-bubble particles and the size of the far plankton
 * layer (a fraction of the snow count).
 * `ocean` scales the water shader: wave count, ripple octaves, cloud octaves (sky / reflections)
 * and the density of the mesh that carries the large waves.
 * `story` sizes the scenery of the scroll story: bioluminescent sparks, vent smoke particles, tube worms
 * around the vents, the vent field's grid resolution, and the jellyfish (count, tentacles each, segments per
 * tentacle).
 * `bloom` is the post-processing glow in the deep (see scenes/ocean/bloom.js): off on the low tier, a
 * lower-resolution, gentler pass on medium (the usual mobile tier).
 * Note: `antialias` is read once at renderer creation; the rest can change live.
 */
export const QUALITY_LEVELS = {
  low:    { label: 'Low',    maxPixelRatio: 1,   antialias: false, particleCount: 900,  seabedSegments: 24, targetFps: 30,
            ocean: { waves: 6,  detail: 2, skyClouds: 2, reflectClouds: 0, rings: 70,  segments: 128 },
            underwater: { shafts: 8,  streams: 36,  plankton: 0.25 },
            story: { glow: 300, smoke: 160, worms: 40,  floor: 28, jellies: 5,  tentacles: 8,  segments: 14 },
            bloom: { enabled: false } },
  medium: { label: 'Medium', maxPixelRatio: 1.5, antialias: false, particleCount: 2200, seabedSegments: 48, targetFps: 45,
            ocean: { waves: 9,  detail: 3, skyClouds: 3, reflectClouds: 2, rings: 110, segments: 192 },
            underwater: { shafts: 16, streams: 80,  plankton: 0.35 },
            story: { glow: 520, smoke: 320, worms: 80,  floor: 40, jellies: 8,  tentacles: 12, segments: 20 },
            bloom: { enabled: true, scale: 0.3, strength: 0.6, radius: 0.5, threshold: 0.5 } },
  high:   { label: 'High',   maxPixelRatio: 2,   antialias: true,  particleCount: 4500, seabedSegments: 96, targetFps: 55,
            ocean: { waves: 12, detail: 4, skyClouds: 4, reflectClouds: 3, rings: 150, segments: 288 },
            underwater: { shafts: 26, streams: 150, plankton: 0.45 },
            story: { glow: 900, smoke: 520, worms: 120, floor: 56, jellies: 14, tentacles: 16, segments: 28 },
            bloom: { enabled: true, scale: 0.5, strength: 0.75, radius: 0.6, threshold: 0.45 } },
};

export const QUALITY_ORDER = ['low', 'medium', 'high'];
