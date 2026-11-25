# Ocean Explorer

Foundation for a Vue 3 + Vite + Three.js + GSAP ocean dive.

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN for phone testing)
npm run build    # production build in dist/
npm run preview  # serve the build
```

Scroll (wheel, trackpad, touch, keyboard) to dive; the chapter rail jumps between chapters.
Force a graphics tier with `?quality=low|medium|high`. Open at a chapter with `#whale` (any chapter id).

## Structure

```
src/
  App.vue                     layout, wiring, reveal animation
  components/                 ThreeScene (reusable), LoadingScreen, IntroScreen, HudControls, DepthIndicator, StoryOverlay, StoryProgress
  audio/                      engine (Web Audio: music, ambience, effects, volume), bridge (autoplay, state), synth, music, ambience, files
  composables/                useStoryScroll, useFullscreen, useAudio
  core/                       SceneManager (renderer/loop/resize/dispose), AssetLoader, GSAP setup (ScrollTrigger), story + intro timelines
  scenes/ocean/               the scene: atmosphere, sky, ocean surface, lights, environment, particles, camera rig
  scenes/ocean/shaders/       GLSL (noise, sky, Gerstner waves, ocean, sky dome)
  config/                     quality tiers, depth zones and world scale, story chapters
  state/appState.js           shared reactive state
  utils/                      device detection, dispose, math, motion, seeded random
```

## The ocean

A procedural sea in custom GLSL (`src/scenes/ocean/`):

- **Waves:** up to 12 Gerstner waves, two crossing swell systems plus a wind sea. The long waves displace a camera-centred polar grid (dense near the camera, sparse towards the horizon); the fragment shader evaluates all of them again for per-pixel normals and foam, so crests stay smooth.
- **Detail without geometry:** ripple normals from derivative value noise, scrolled along the wind. Every wave and ripple fades out before it can alias, and the detail that is filtered away turns into roughness, so the sun glitter widens towards the horizon.
- **Light:** Fresnel reflection of a procedural sky (gradient, sun, drifting clouds), GGX sun glitter, subsurface cyan on crests, aerial haze that melts into the sky at the horizon.
- **Foam:** from the Jacobian of the wave field (where the surface bunches up), broken up with noise and clustered in gusty patches.
- **Mouse:** nudges the sun a few degrees, changes the glow, and stirs the ripples while it moves.
- **Dive:** the camera starts above the water at a low cinematic angle and sinks through the surface; from below you see Snell's window onto the sky.
- **Quality:** `ocean` in `config/quality.js` sets waves, ripple octaves, cloud octaves and mesh density per tier, and switching tiers recompiles the shader.

Tuning knobs: `uWaveAmp`, `uChoppy`, `uFoam`, `uHaze` in `createOceanSurface.js`; sun position in `atmosphere.js`; wind and swell directions in `waveData.js`; colours in `shaders/ocean.js` (`deep`, `shallow`, `cyan`) and `shaders/chunks.js` (sky).

## Scroll story

Native page scrolling drives the whole expedition. The scene and interface are fixed; underneath them is an empty
spacer 9.6 screens tall (`.track` in `App.vue`), and a GSAP ScrollTrigger scrubs one timeline across it.

- **Chapters** (`src/config/story.js`): surface, descent, shallows (300 m), bioluminescence with jellyfish (1,000 m), whale (1,800 m),
  hydrothermal vents (3,000 m), abyss (Challenger Deep, 10,900 m), return to the surface. Each has a length in screens (8.6 in total),
  a depth range and its text. The timeline's time unit is one screen of scrolling.
- **Timeline** (`src/core/story.js`): eased travel to each chapter's depth, a slow drift while its text shows, camera
  moves (`appState.cam`: idle drift, heave, fov, pitch, dolly), the whale's swim (`fx.whale`), the intro fading,
  the depth gauge and the cinematic text. No two tweens touch the same property at once, so scrubbing back retraces
  the same path.
- **Scrolling** (`src/composables/useStoryScroll.js`): `scrub: 1` (0.7 on touch) smooths every wheel notch and flick
  into a camera move. No snapping, pinning or preventDefault: the page scrolls like any page. Nearby chapters are
  reached with a smooth scroll that any user scroll interrupts; far jumps and "Dive again" fade through black so the
  dive is never rewound on screen. The hash follows the chapter. Mobile address-bar resizes are ignored.
- **Camera:** the scene adds `appState.cam` (scroll) and `appState.shot` (time-based arrival) before the camera rig
  uses them, so scrolling during the arrival never fights it. During the whale pass the camera turns to follow it.
- **Surface crossings** are detected from the camera itself: going under fires the bubble burst, splash and veil of
  light; coming back up only the veil.
- **Interface:** brand plus current chapter label (top left), depth gauge (left; shown once underwater), chapter rail
  with progress (right; a bar along the bottom on narrow screens), chapter text in the lower third.
- **Scenery** for the story, all quality-scaled via `story` in `config/quality.js` and hidden outside its depth range:
  `bioluminescence.js` (GPU-animated sparks that flare when the camera moves fast), `whale.js` and `vents.js` (see below).

## Whale encounter

`scenes/ocean/whale.js`, three draw calls (body, flukes, wake), hidden outside 1,100 to 2,700 m.

- **Model:** procedural sperm whale. The body is one smooth surface from a profile of superellipse cross-sections
  (round body, boxy head, deep narrow tail stock), with a dorsal hump, knuckles, lower jaw and flippers. The flukes
  are a separate bevelled mesh. Skin: countershading, procedural wrinkles (a bump computed in the shader and faded
  with distance so it never shimmers), pale scars on the head and lips.
- **Movement:** an up-and-down stroke in the vertex shader (nothing at the head, strongest at the tail stock, a
  small counter-bob of the head, a slow sideways sway). The flukes ride on the end of the bending tail stock, angled
  with it and pitching a beat behind. The stroke quickens and deepens when the whale moves faster; it also glides
  and rolls slowly.
- **The pass** (`PATH`): tied to the scroll (`fx.whale`). It emerges from the fog about 45 units ahead, comes
  towards the camera, passes side-on at about 14 units, then swims on to the right and dissolves into the fog. The
  scene fog does all the fading, so there is no pop. It is about 15.5 units long, so at its closest it fills more
  than half the frame (the whole width on a phone).
- **Camera:** turns to follow it (yaw and pitch, eased), part of the way so the whale leads the frame (more closely
  on portrait screens), and settles straight ahead as it leaves, ready for the drop to the vents. The lens
  lengthens a little while it is close (`cam.fov` in the timeline). The chapter is 1.4 screens long.
- **Particles:** glowing plankton and drifting matter stirred up along the body and trailing in the wake; they
  stream faster when it swims faster (`story.whale.dust` per tier: 240 / 480 / 900).
- **Lighting:** three soft lights in the skin shader, so no scene light is added (that would recompile every
  material): cool light from above on the back, a rim strongest along the top, and the glowing wake lighting the
  belly from below. The explorer's lamp lights it too.

## Hydrothermal vents

`scenes/ocean/vents.js`, nine draw calls, all animated on the GPU, hidden outside 2,300 to 3,250 m. Everything is
procedural; there is no background image.

- **Floor:** a ridge running across the view, built from fBm relief, rubble and fissures. It falls away steeply
  towards the camera and stops short of the camera's path, so the drop to the abyss never passes through rock.
  The shader adds rock colour and bump detail, sediment on the flats, rust and bacterial mats round each vent,
  and glowing orange cracks near them.
- **Rocks:** boulders and pillow-lava lumps (one dented rock, instanced at many sizes, kept off the chimneys).
- **Chimneys:** each has a mound at the foot, a knobbly leaning column with flanges and a crater at the top,
  with one or two smaller spires. Their tops and cracks glow with the heat inside, and the glow flickers.
- **Smoke:** black-smoker plumes made of camera-facing quads with procedural billowing smoke (warped fBm). Each
  puff is born hot and orange, cools to black, swells, turns, churns and bends in the current, lit from below by
  the glow. It uses three.js's own fog, so it fades exactly as the rock does.
- **Particles:** embers shot out of the mouths that cool as they rise, sediment drifting over the whole field
  (warm-lit near the vents), a bright glow at each mouth and a warm haze at each foot. A warm point light flickers
  on the rock.
- **Atmosphere:** the dark navy water and the depth fog come from the scene (`depthPalette.js`).
- **Camera** (`core/story.js`): while it is still descending from the whale, the glow below draws its gaze
  down. It slides sideways as it arrives, then glides across and in over the ridge, turning to keep the chimneys
  in frame (an orbit, using `cam.x`, `cam.yaw`, `cam.push`, `cam.pitch`). Everything is back to neutral before the
  drop to the abyss. The chapter is 1.2 screens long.
- **Per tier** (`story.vents`):

  | Tier | Floor grid | Rocks | Worms | Smoke puffs | Smoke noise octaves | Embers | Sediment |
  |---|---|---|---|---|---|---|---|
  | Low | 40 | 18 | 40 | 70 | 2 | 80 | 260 |
  | Medium | 64 | 30 | 80 | 140 | 3 | 160 | 520 |
  | High | 96 | 50 | 120 | 300 | 4 | 300 | 1000 |

  Chimney mesh detail also scales with the tier.

## The abyss

`scenes/ocean/abyss.js`, five draw calls, shown below about 8,200 m. The chapter goes down to 10,900 m (the
bottom of the Challenger Deep, the expedition's target in the intro), so the depth counter ends on the deepest
water on Earth. Atmosphere comes first; there are few objects.

- **Water:** the palette keeps a trace of deep blue down to 11,000 m instead of going black, and the fog
  thickens further below 5,000 m (`depthPalette.js`). Marine snow thins out to a third and bioluminescence is
  rare here. The placeholder landmark rocks stop at 8,000 m.
- **Floodlight:** a lamp up on the right of the hull, sweeping slowly. It is a cone whose brightness comes from
  how close each view ray passes to the beam's axis (soft and round, no hard edges), fading near the lens and
  along its length, with drifting particulate.
- **Motes:** sparse specks around the camera, visible mostly where the beam catches them or close to the lamp.
  **Debris:** a few flakes of sinking matter tumbling slowly, lit by the explorer's lamp.
- **The distant light:** far ahead and below, a cold glow of unknown origin: a tight core, a soft halo and rays
  turning very slowly, fading to nothing at the edges. It also lights the trench floor's horizon from behind.
- **The giant:** a vast manta-like ray (about 32 units across, around 85 units away), always darker than the
  water. It glides across in front of the light, banked so its wings show, with a slow wingbeat travelling out
  along them. It is tied to the scroll (`fx.abyss`). It is distant, slow and only ever a silhouette, never a
  jump scare.
- **Camera:** a longer lens, a very slow creep forward and a pan after the giant, then back to neutral for the
  climb home. The chapter is 1.2 screens long.
- **Per tier** (`story.abyss`): motes 140 / 280 / 520, debris 10 / 18 / 30, ray noise octaves 1 / 2 / 3, and
  the giant's mesh detail.

## Jellyfish and bloom

- **Jellyfish** (`scenes/ocean/jellyfish.js`): procedural and instanced, so all bells are one draw call and all
  tentacles another. The bell (a lathe) squeezes and relaxes on its own swim clock, and each stroke pushes it
  upwards; light sweeps from crown to rim, radial canals and a ring of gonads give it structure, and the rim
  stays glassy (fresnel). Tentacles and oral arms are camera-facing ribbons whose whole shape is computed in the
  vertex shader (stroke rippling down, currents, curling arms); beads of light run down them. Cyan, violet and
  blue, at many distances, placed as a fraction of the visible frame so portrait phones get a full view.
  Additive light fades to black in the depth fog.
- **Cursor and touch:** a ray from the camera through the pointer; a jellyfish it passes near drifts away, flares
  and strokes faster for a while. Listeners are passive (touch scrolling is never blocked); a touch keeps
  pointing for a moment after the finger lifts.
- **Camera:** the chapter is a slow push in among them with a gentle pan (`cam.push`, `cam.yaw`).
- **Bloom** (`scenes/ocean/bloom.js`): the scene still renders straight to the screen, unchanged. What glows
  (sparks, jellyfish, the whale's wake, the vents' cracks, mouths and embers) is also on `GLOW_LAYER`. Those
  objects alone are rendered again at low resolution into an off-screen target, with no background and no scene
  lights, so lit materials contribute only what they emit. Their bright parts are blurred with UnrealBloomPass's
  filters, and only that glow is added onto the screen. Nothing is read back from the screen: an earlier version
  copied the frame, and with MSAA (the high tier) that sometimes showed an empty frame. Bloom fades in below
  250 m and costs nothing above that. Per tier (`bloom` in `config/quality.js`): off on
  low, a third-resolution softer pass on medium (the usual phone tier), half resolution on high.
- **Per tier** (`story` in `config/quality.js`): jellyfish 5 / 8 / 14, tentacles 8 / 12 / 16 (plus 4 oral arms),
  segments 14 / 20 / 28, bioluminescent sparks 300 / 520 / 900.
- `SceneManager` lets a scene take over rendering (`setRenderFunction`) and follow resizes (`addResizer`);
  `ThreeScene` wires a scene's `render`, `resize` and `warm` (compile post-processing during loading).

## The intro

The first screen is a cinematic intro over the live ocean (`IntroScreen.vue`, `ScrollIndicator.vue`), driven by GSAP timelines in `src/core/`:

- **Arrival** (`createArrivalTimeline`, `buildIntroIn`): the camera eases down into its idle frame while the title settles in from blur, the rule draws, the subtitle words arrive one by one, then the button, expedition details and scroll cue.
- **Idle:** slow, unrelated sine drifts (sideways, heave, push-in, yaw, pitch, roll) in `cameraRig.js`, weighted by `appState.shot.idle`.
- **Mouse and touch** (`introInteractions.js`): layers drift against the pointer at different depths, the button leans towards a nearby pointer and lights up under it. Hover effects only exist where hover does, so touch screens never get a stuck hover.
- **Starting:** scrolling simply begins the descent; the button and the scroll cue glide the page down into it.
- **Dive** (the descent chapter of the story timeline): the interface lifts away, the camera tilts to the water, lowers and dollies forward, then one continuous eased descent carries it through the surface with a burst of bubbles and a brief veil of light. It tilts up to watch the surface recede, levels out at 150 m, and the underwater snow fades in. All of it is scrubbed by the scroll.
- **Skip it** while developing with `?intro=0` (opens at the end of the descent). With reduced motion the idle drift is off and the timelines run faster.

## Underwater descent

The descent chapter of the scroll story: the camera stops drifting, tilts to the water and
sinks in a single eased descent (on the way down it never rises, so the depth counter never ticks backwards). It breaks the surface
with a burst of bubbles and a veil of light, tilts up to watch the light and the surface recede, and settles at 150 m.

- **Depth counter:** reads the camera's real height every frame (`metersBelowSurface` in `config/zones.js`, set as
  `appState.meters`), so it starts at 0 m the moment the camera goes under and follows it from then on. It fades in just
  after the plunge. Fog, light, colour, particles, zones and audio all use the same value.
- **Light shafts** (`shaders/shafts.js`): soft camera-facing beams that hang from the surface along the refracted sun
  direction, shimmer as the waves move above them, lose red then green with depth, and are skipped below 900 m.
- **Atmosphere:** the open water and the far surface seen from below share one gradient (`underwaterChunk` in
  `shaders/chunks.js`): lighter towards the surface, a scattered glow and drifting rays around the light.
- **Surface from beneath:** Snell's window onto the sky, with the sky colour absorbed by the water above you.
- **Colour absorption:** water goes from clear blue to dark navy (`depthPalette.js`); sunlight on objects, particles and
  bubbles loses red first, then green (`absorptionColor`).
- **Particles:** two layers of marine snow (a near one and a wider, finer, slower one) for depth and parallax.
- **Bubbles** (`shaders/bubbles.js`): glassy rings in loose rising columns around the camera, growing as they rise,
  plus the burst at the plunge. One draw call each.
- **Camera:** slow underwater drift, mouse parallax that moves the camera itself, calmer bob below the surface.
  Reduced motion switches the drift off.
- **Mobile:** `underwater` in `config/quality.js` sets shafts / rising bubbles / far plankton per tier
  (low 8 / 36 / 25 %, medium 16 / 80 / 35 %, high 26 / 150 / 45 %). Every tier stays at 8 draw calls underwater, plus the story scenery near its chapter (1 for the bioluminescence, 3 for the whale, 9 for the vent field, 5 for the abyss).

In development, `__ocean` in the console exposes the scene, camera, renderer, state and layers.

## Sound

All sound is generated in the browser with the Web Audio API (`src/audio/`), so there are no audio files to load, host or lose.

- **Music:** a slow generative ambient piece in D (four overlapping chords plus sparse bell notes) that never repeats exactly.
- **Above the waves:** surf with a hiss that swells and falls, deep water, a little wind.
- **Underwater:** everything is muffled by a low-pass filter that closes with depth, with a deep rumble and drone, random bubbles, faint creaks and, below 500 m, a distant whale-like song.
- **Moments:** a click on START EXPEDITION, a rush of air as the descent begins, a splash plus a cluster of bubbles as the camera breaks the surface.
- **Autoplay:** browsers refuse to play audio before a user gesture, so nothing is created until the first click, tap or key press (`bridge.js`). That gesture starts the music unless the visitor turned sound off earlier (the choice and volume are remembered). The sound button always shows the real state: lit only while sound is actually coming out, with a warning icon if audio cannot start.
- **Controls:** the speaker button, the slider next to it (opens when sound is switched on, on hover, or from its own button; arrow keys work), and the `M` key. At 0 volume the button shows "off", and turning sound on from there restores a sensible volume.
- **Background tabs** are silenced and the audio context suspended; iOS call interruptions resume on the next tap.
- **Your own music:** drop `public/audio/music.mp3`. It fades in over the generated music. A missing file, a wrong path, a server that answers with an HTML page, a corrupt file or a timeout are each reported in the console as `[audio] ...` and the generated music keeps playing (`src/audio/files.js`).
- **Debugging:** in development, `__oceanAudio.snapshot()` and `__oceanAudio.fileReport` in the console show the state and the file results.

`<ThreeScene>` takes a `scene-factory` function, so a new scene is a new module under `scenes/`.
