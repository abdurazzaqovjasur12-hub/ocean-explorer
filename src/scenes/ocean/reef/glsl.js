/** Metres below the surface for a world height (config/zones: depthToY), for the reef's shaders. */
export const reefMeters = /* glsl */ `
float reefMetersAt(float y) { return max(0.0, (-y - 1.0) / 0.05); }
`;
