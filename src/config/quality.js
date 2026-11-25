/**
 * Graphics quality tiers. Anything the renderer or scene needs to scale
 * lives here so there is one place to tune performance.
 * `underwater` sets the number of light shafts, rising-bubble particles and the size of the far plankton
 * layer (a fraction of the snow count).
 * `ocean` scales the water shader: wave count, ripple octaves, cloud octaves (sky / reflections)
 * and the density of the mesh that carries the large waves.
 * `story` sizes the scenery of the scroll story: bioluminescent sparks, the vent field (floor grid, boulders,
 * tube worms, smoke puffs and their noise octaves, embers, sediment, chimney mesh detail), the abyss (motes in the
 * floodlight, debris flakes, noise octaves of the distant light's rays, the giant's mesh), and the jellyfish (count, tentacles each, segments per
 * tentacle), and the whale (body mesh rings and sides, wake particles).
 * `bloom` is the post-processing glow in the deep (see scenes/ocean/bloom.js): off on the low tier, a
 * lower-resolution, gentler pass on medium (the usual mobile tier).
 * Note: `antialias` is read once at renderer creation; the rest can change live.
 */
export const QUALITY_LEVELS = {
  low:    { label: 'Low',    maxPixelRatio: 1,   antialias: false, particleCount: 900,  seabedSegments: 24, targetFps: 30,
            ocean: { waves: 6,  detail: 2, skyClouds: 2, reflectClouds: 0, rings: 70,  segments: 128 },
            underwater: { shafts: 8,  streams: 36,  plankton: 0.25 },
            story: { glow: 300, jellies: 5,  tentacles: 8,  segments: 14,
                     whale: { rings: 30, sides: 18, dust: 240 },
                     vents: { floor: 40, rocks: 18, worms: 40,  smoke: 70,  octaves: 2, embers: 80,  sediment: 260, chimney: { rings: 18, sides: 10 } },
                     abyss: { motes: 140, debris: 10, rays: 1, manta: [24, 8] } },
            bloom: { enabled: false } },
  medium: { label: 'Medium', maxPixelRatio: 1.5, antialias: false, particleCount: 2200, seabedSegments: 48, targetFps: 45,
            ocean: { waves: 9,  detail: 3, skyClouds: 3, reflectClouds: 2, rings: 110, segments: 192 },
            underwater: { shafts: 16, streams: 80,  plankton: 0.35 },
            story: { glow: 520, jellies: 8,  tentacles: 12, segments: 20,
                     whale: { rings: 40, sides: 26, dust: 480 },
                     vents: { floor: 64, rocks: 30, worms: 80,  smoke: 140, octaves: 3, embers: 160, sediment: 520, chimney: { rings: 26, sides: 14 } },
                     abyss: { motes: 280, debris: 18, rays: 2, manta: [36, 12] } },
            bloom: { enabled: true, scale: 0.3, strength: 0.7, radius: 0.5, threshold: 0.2 } },
  high:   { label: 'High',   maxPixelRatio: 2,   antialias: true,  particleCount: 4500, seabedSegments: 96, targetFps: 55,
            ocean: { waves: 12, detail: 4, skyClouds: 4, reflectClouds: 3, rings: 150, segments: 288 },
            underwater: { shafts: 26, streams: 150, plankton: 0.45 },
            story: { glow: 900, jellies: 14, tentacles: 16, segments: 28,
                     whale: { rings: 60, sides: 36, dust: 900 },
                     vents: { floor: 96, rocks: 50, worms: 120, smoke: 300, octaves: 4, embers: 300, sediment: 1000, chimney: { rings: 36, sides: 18 } },
                     abyss: { motes: 520, debris: 30, rays: 3, manta: [56, 16] } },
            bloom: { enabled: true, scale: 0.5, strength: 0.85, radius: 0.6, threshold: 0.18 } },
};

export const QUALITY_ORDER = ['low', 'medium', 'high'];
