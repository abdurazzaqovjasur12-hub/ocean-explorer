/**
 * Where things grow on the reef, in metres below the surface (the same metres as the depth counter: the reef is
 * placed with depthToY, so what the gauge says and what is on screen agree).
 *
 *   seagrass    0 - 20 m    meadows on the crest of the reef, short and quick in the swell
 *   shallow     8 - 30 m    green and brown leafy algae on the crest and the top of the slope
 *   kelp       20 - 70 m    the forest: holdfasts on the slope, stipes rising to a canopy just below the waves
 *   deepAlgae  70 - 200 m   sparse red algae fans on the ledges (the last plants: below 200 m there is too little light)
 *   luminous  200 - 1300 m  no plants, but glowing threads and mats of light on the wall, brighter the darker it gets
 *
 * `show` is the range of *camera* depths over which each layer is drawn at all: outside it, it is either out of
 * frame or lost in the fog, so it costs nothing.
 */
export const BANDS = {
  seagrass: { from: 12, to: 22, show: [0, 460] },
  shallow: { from: 12, to: 32, show: [0, 520] },
  kelp: { from: 30, to: 72, top: [16, 26], show: [0, 560] },
  deepAlgae: { from: 70, to: 200, show: [0, 760] },
  luminous: { from: 200, to: 1300, show: [120, 1500] },
};

/** The reef as a whole is drawn while the camera is above this depth (below ~850 m only its glow). */
export const REEF_SHOW = 1500;
/** The rock itself fades into the water as the camera goes below 560 m, and is gone by this depth. */
export const ROCK_SHOW = 850;
