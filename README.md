# Ocean Explorer

Foundation for a Vue 3 + Vite + Three.js + GSAP ocean dive.

```bash
npm install
npm run dev      # http://localhost:5173 (also on your LAN for phone testing)
npm run build    # production build in dist/
npm run preview  # serve the build
```

Scroll (wheel, trackpad, touch, keyboard) to dive; the chapter rail jumps between chapters.
Force a graphics tier with `?quality=low|medium|high` (a forced tier is never changed automatically).
The quality button cycles **Auto → Low → Medium → High** (remembered in `ocean-explorer.quality`). Auto, the default,
picks the tier from the device (phones medium, or low for a known weak GPU; laptops with integrated graphics
medium; others high) and steps down a tier if the frame rate stays too low even at the lowest render resolution.
A tier chosen by hand is kept as chosen.

**Loading on phones.** The noise texture is built once and shared (reef rock, megalodon skin), from the lattice
corners' hashes rather than a sine per pixel; value noise on the CPU remembers lattice corners it has already
hashed (identical results, about half the work while building the reef). The megalodon is not built while loading:
the first time night mode is on, it is built in idle time and its shaders are compiled in the background (both the
normal and the glow pass). On a phone-speed CPU (4x throttling) the longest freeze while loading went from 2.5 s
to under 1 s, and the total main-thread blocking from 5.4 s to about 2.7 s. Open at a chapter with `#whale` (any chapter id).

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
spacer 10.1 screens tall (`.track` in `App.vue`), and a GSAP ScrollTrigger scrubs one timeline across it.

- **Chapters** (`src/config/story.js`): surface, descent, shallows (300 m), bioluminescence with jellyfish (1,000 m), whale (1,800 m),
  hydrothermal vents (3,000 m), abyss (Challenger Deep, 10,900 m), return to the surface. Each has a length in screens (9.1 in total),
  a depth range and its text. The timeline's time unit is one screen of scrolling.
- **Timeline** (`src/core/story.js`): eased travel to each chapter's depth, a slow drift while its text shows, camera
  moves (`appState.cam`: idle drift, heave, fov, pitch, dolly), the whale's swim (`fx.whale`), the intro fading,
  the depth gauge and the cinematic text. No two tweens touch the same property at once, so scrubbing back retraces
  the same path.
- **Scrolling** (`src/composables/useStoryScroll.js`): `scrub: 1` (0.7 on touch) smooths every wheel notch and flick
  into a camera move. No snapping, pinning or preventDefault: the page scrolls like any page. Nearby chapters are
  reached with a smooth scroll that any user scroll interrupts; far jumps and the end screen's buttons fade through
  black so the dive is never rewound on screen. The hash follows the chapter. Mobile address-bar resizes are ignored.
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

## Megalodon encounter (night mode only)

`scenes/ocean/megalodon/` (`geometry.js`, `skin.js`, `particles.js`, `index.js`), `components/EncounterWarning.vue`,
`components/MegalodonCard.vue`. It is met in the dark around the bioluminescence chapter (~900 m), only at night.

- **Night only, in one place** (`megalodon/index.js`): an encounter can begin only while the mode is night, the
  night has fully come in, the camera is underwater and between 800 and 1,120 m (and it has stayed there 1.4 s).
  The moment that stops being true (switching to day, scrolling out of 700 to 1,300 m, surfacing) it is called
  off: every event still to come is dropped, the warning and hint go, the camera and the music ease back, the
  drone fades, and the shark dissolves into the dark water in about a second. Between encounters nothing of it is
  drawn or updated. The audio engine checks the mode again before playing any of its sounds.
- **Model:** procedural, one merged mesh per level of detail (the near one with mouth and teeth; a far one, about
  a fifth of the triangles, for the silhouette in the fog; `THREE.LOD` switches at 52 units). Drawn as a 17 m animal
  (published estimates for large adults: about 15 to 20 m). The scene has no single metric scale (the dive is
  compressed about twenty to one to fit the scroll, and the jellyfish are large), so its size is set against what
  is around it: 1.6 units per metre, about 27 units from snout to tail tip, half again the whale. It is scaled
  evenly, so the head, jaw, fins and tail keep their proportions. Short conical snout, deep body, tall first dorsal fin, long
  swept pectorals, a crescent tail with keels, five gill slits, an underslung jaw that opens on a hinge, rows of
  triangular teeth, small dark eyes. It is a reconstruction (the card says so): only teeth and vertebrae survive.
- **Skin** (`skin.js`): the scene's own lights (faint moonlight, and the explorer's lamp, which is what reveals the
  face as it comes close), plus a rim and downwelling light of its own and a faint eyeshine. Countershading with a
  wandering line, dermal denticles as a fine streaked bump (faded with distance; off on the low tier), gill
  relief, a few pale scars. Its noise comes from the reef's baked noise texture (a few reads instead of dozens of
  hashes per pixel). Close to the lens its exposure is held back so the lamp never burns it out to white. It is
  drawn black into the bloom pass, so the jellyfish behind it do not glow through it.
- **Movement:** a side-to-side tail beat in the vertex shader (a wave running back to the tail, a little recoil of
  the head), the body curving into turns and banking; the beat quickens with speed; the jaw opens on its hinge.
  The normals are turned with the bend. No CPU work per vertex.
- **The first encounter** (`SCRIPTS.first`, ~20 s): a shadow far off in the fog, a slow approach, the warning
  (6.8 s), the face coming into the lamp's light, a sudden rush straight at the camera (11 s; the snout stops about
  1.7 units from the lens, the lens narrows a little, and the head fills nearly the whole frame): a shake, a push back, a
  short blur of the frame and a longer one at the edges, a darkening that lifts, sparks stirred up in the water,
  the impact sound. At the last moment it veers, its head swinging aside under the darkening (it turns about its
  centre, so nothing comes on at the lens; the nearest any vertex comes is measured in development with
  `trackClearance`); then its flank passes broadside about 9 units away, filling the width of the screen, its tail
  sweeping past in front of the lens, and it swims off into the dark. The
  path is set relative to the camera (smoothed), so a little scrolling does not spoil it; the camera turns partway
  to follow it. Later encounters are natural passes at a distance, with no rush (`SCRIPTS.passes`, 35 s apart).
- **Warning:** "XAVF ANIQLANDI / MEGALODON YAQINLASHMOQDA" (`megalodon.warning.*` in the three languages): red
  with a soft red glow, it flickers on, the interface flickers briefly, the screen edges glow faintly red; it
  fades after about 3 s. The chapter text steps back while the shark is close.
- **Less motion:** a switch under the warning and in the card (remembered; follows the system's reduced-motion
  setting until chosen): no shake, push, blur or flicker, only a gentle darkening.
- **Information card:** the hint ("tap the megalodon") shows only while some of it is really in the frame; tap or click the shark (a few spheres along its spine are hit-tested; the pointer
  becomes a hand over it on desktop). Name, scientific name, status, length, weight, period, habitat and range,
  diet, seven facts; each marked Confirmed, Estimate or Hypothesis. No lifespan or exact size is given. A panel on
  the right on wide screens, a sheet from the bottom on phones; Esc, the close button or a tap elsewhere closes it.
- **Sound** (the existing engine, no second audio manager): a low drone layer (started once, only its level
  moves, so it can never double up) that rises with the approach while the music ducks a little; a soft
  sonar-like warning, the rush, a short deep impact and the tail's sweep, each played once per cue. All of it
  follows the master and effects volumes and mute, and is silent in day mode.
- **Per tier** (`story.megalodon`): body rings and sides 56x22 / 80x30 / 110x40 (far level 26x12 / 30x14 /
  34x16), teeth per row 14 / 20 / 24, wake sparks 120 / 220 / 360, impact sparks 60 / 110 / 160, skin relief off /
  on / on; the frame blur is skipped on the low tier.
- **Cost:** two draw calls (body, wake) while it is there, three for the 2 s of the impact sparks, none at all
  otherwise. No new lights, no shadow maps. At a distance it costs next to nothing; when it fills the frame during
  the close pass, a few milliseconds on an integrated GPU.

## The reef and its vegetation

The dive goes down beside a reef (`src/scenes/ocean/reef/`): a rock face ahead and to the left of the camera that
ends just right of the middle of the view, its face receding into the haze, so the right of the frame stays open
water where the light shafts hang (rock on one side, the blue on the other, on wide screens and phones alike).
It is placed in the same metres as the depth counter (`depthToY`), so what the gauge says and what grows on screen
agree. No animals: plants above 200 m, glowing growths below.

| Depth | What grows | How |
| --- | --- | --- |
| 0 - 20 m | seagrass meadows on the crest | instanced tufts of arching blades |
| 12 - 32 m | green and brown leafy algae | instanced clumps |
| 20 - 70 m | the kelp forest: holdfasts on the slope, crown at 16 - 26 m | instanced, two levels of detail |
| 70 - 200 m | sparse red algae on the ledges, pink coralline crusts on the rock | instanced (two LODs), crusts in the rock shader |
| 200 - 1,300 m | glowing threads with a bead of light at the tip, mats of light, glowing films on the wall | instanced ribbons, points, rock shader |

- **Shape** (`shape.js`): one cross-section (reef flat, crest just below the waves, the kelp slope coming towards the
  camera so upright stipes stand clear of the rock, the drop-off, a wall leaning back into the deep), bent across
  the view, cut into buttresses, rubble and ledges. Pure functions: the rock mesh, the plants and the glow all sit on it.
- **Motion:** all in the vertex shaders: a slow surge along the current that runs up each stem, a crosswise roll,
  and a quicker flutter at the tips; the camera's own travel and the pointer stir the water (plants sway harder).
- **Light:** the scene's existing lights (daylight that loses its colours with depth, moonlight at night, the
  explorer's lamp), read into uniforms each frame and evaluated **per vertex** (`lighting.js`): no light is added.
  Leaves glow through against the light; their undersides get the light scattered in the water.
- **Day and night:** follows the scene's night level like everything else: a moonlit, lamp-lit reef at night, and the
  glow shows higher up (it brightens as the water around the camera darkens).
- **Deep glow:** additive, on the bloom layer; the rock is drawn into the bloom as black (only its glowing films), so
  it hides the glow behind it. Gone below the band; the rock itself fades into the water from 560 m and is not
  drawn below 850 m (it would cover the frame there and could no longer be seen).

**Performance:** ten draw calls at most (rock plus nine instanced layers), each hidden outside the camera depths it can be seen from
(`bands.js`); the kelp and red algae have a detailed and a light mesh, chosen by distance from the dive; plants are
only placed where the camera can see them; the rock's noise is baked once into a 256 x 256 texture (four reads instead of
some twenty hashes per pixel); no per-plant work on the CPU. Densities per tier (`story.reef` in
`config/quality.js`; phones get the medium or low tier: about half or a quarter of the plants). Measured on an
integrated laptop GPU at 720p: about 2.5 - 3 ms per frame where the reef fills the view, nothing below 850 m.

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

## Return to the surface and the end screen

The last chapter (1.6 screens, `core/story.js`):

- **The climb:** a fast climb out of the deep (10,900 to 300 m) with the camera looking up. Bubbles rise
  alongside: `createAscentBubbles` in `bubbles.js` keeps them relative to the camera, so they overtake the lens
  however fast it climbs (`fx.ascent`; 50 / 110 / 180 per tier, `underwater.ascent`). The marine snow streams
  past. Sunlight, colour, light shafts and the thinning fog come back on their own as the depth drops.
- **The approach:** from 300 m it slows down. The camera gazes up at the bright window of the surface and rises
  towards it, gathering speed. It breaks through (the veil of light), bobs up, levels with the horizon and
  settles on the swell, and the idle drift returns. The ascent text shows only during the climb.
- **End screen** (`components/EndScreen.vue`, revealed by the same scrubbed timeline): "THE OCEAN IS STILL
  UNEXPLORED" comes in letter by letter, then a short line and the buttons. Only the buttons take input, so
  scrolling or swiping anywhere else still works; on phones they stack full width.
  - **REPLAY EXPEDITION:** the whole experience again without reloading. Through a fade to black the page goes
    back to the top (the timeline rewinds everything it drives), the camera returns to its raised arrival pose and
    the intro to its hidden state. As the fade lifts, the arrival and the title sequence play again.
  - **EXPLORE AGAIN:** back to the surface through the same fade, then straight down into the dive (as START
    EXPEDITION does), without the intro.
  - Both go through `useStoryScroll().restart({ atBlack, then })`; a second tap during the fade is ignored.

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

## Performance and devices

Tested on desktop (1440 x 900), laptop (1280 x 720 at 1.25x), Android and iPhone portrait, phone landscape and a
320 px phone, in development and in the production build.

- **Starting tier** (`utils/device.js`): phones start on medium and computers on high. A known weak device starts one
  lower: two cores, a reported memory of 2 GB or less, an older phone GPU, or integrated graphics on a computer
  (detected from the GPU's name where the browser shares it). Unknown memory (Safari, Firefox) doesn't count as low,
  so iPhones aren't stuck on the lowest tier.
- **Frame-rate adaptation** (`SceneManager`): frame time is sampled every ~1.5 s. Too slow: the render resolution
  drops a step (down to 60 %). Comfortable for ~4.5 s: it climbs back, so one heavy scene doesn't leave the rest
  blurry. Still too slow at the lowest resolution: the app steps down a quality tier, unless the visitor chose one
  in the HUD or the URL.
- **Per tier:** pixel ratio, antialiasing, wave count and shader detail, particles, bubbles, light shafts, bloom
  (off on low, a third resolution on medium), jellyfish and tentacles, vent smoke puffs and noise octaves (the
  smoke's domain warp only on high), abyss motes and rays. See `config/quality.js`.
- **Saving energy:** nothing renders in a hidden tab or with a lost WebGL context. After 8 s without input it
  renders every other frame (the ambient motion continues at 30 fps); any scroll, touch, pointer or key brings it
  back. Audio is suspended in the background.
- **Memory:** every scene object, material, geometry and texture is disposed with the scene, including textures
  held in shader uniforms. Replaying the expedition and switching quality don't grow GPU or JS memory (checked:
  geometries, textures and heap stay flat).
- **Touch:** vertical drags scroll the story; a sideways drag looks around a little and eases back on release
  (mouse: the pointer's position). The jellyfish react to taps. Buttons have 44 px targets (about 37 px on 320 px
  phones) and no double-tap zoom. A long press on the scene opens no menu, and the page never pans sideways.
- **Layout:** safe-area insets everywhere, fluid type, compact HUD and wrapping chapter label on narrow phones,
  chapter text kept clear of the depth gauge in landscape, and no horizontal overflow at any tested size.
- **Rotation and resizing:** when the width changes, the scroll trigger is frozen while the layout settles, then the
  page is put back at the same point of the story (the browser would otherwise keep the old pixel offset and jump
  chapters). Height-only changes from mobile toolbars are ignored.
- **Fullscreen:** the HUD button where the Fullscreen API exists (not on iPhone, where the button is hidden).
- **Loading:** the arrival starts as the loading screen begins to fade, rather than after it has gone. Shaders for
  every chapter are compiled during loading, so no chapter stutters the first time it appears.
- **Bloom** needs half-float render targets; on GPUs that can't draw into them it is simply off.

## Day and night

The sun or moon button in the HUD switches between the golden-hour day and a moonlit night. It is one scene
for both: no scene, shader set or timeline is duplicated.

- **One number:** `appState.env.night` (0 day .. 1 night), eased by GSAP over 2.6 s when the mode changes
  (`composables/useDayNight.js`). Each frame the scene hands it to `depthPalette.js` (`setNightLevel`), and
  everything that depends on daylight reads it from there: water colour and fog, sunlight (moonlight is about a
  seventh of it), the lights, the beams, the particles. `nightAt(meters)` fades the night out with depth: below
  ~2,500 m day and night are the same, as they are in the real ocean. Shaders get it as `uNight` through the
  shared atmosphere uniforms.
- **Night sky** (`skyChunk` in `shaders/chunks.js`, shared by the sky dome, the sea's reflections, the
  horizon haze and Snell's window from below; `nightSky.js`):
  - *Stars:* one `Points` draw call of thousands of stars (1,200 / 3,200 / 6,500 by tier): most faint, a few
    bright, white, blue-white, warm and the odd orange; a share crowd along the Milky Way. Each twinkles at its own
    pace, more strongly near the horizon; they fade into the haze, behind clouds and in the moon's glare. Under them,
    a faint hashed star dust. The layer is switched off by day and underwater.
  - *Milky Way:* a soft band of star clouds with dark dust lanes, rising from a low, warmer core ahead-left and
    arching over to the right.
  - *Aurora:* enormous curtains to the north (right of the view): a bright, wandering lower edge that arcs in
    perspective, green fading through teal to violet upwards, folds, fine shimmering rays and a soft airglow; it
    brightens and dims over minutes, and the moon washes out the part near it. Its reflection on the sea is worked
    out per vertex of the sea (soft, and cheap) and added through the Fresnel term.
  - *Moon:* a sphere in a waxing gibbous phase with maria, highlands, a bright young crater, limb darkening and
    earthshine, a soft aureole, and its silver path on the waves (the existing glitter).
  - *Shooting stars:* now and then (every 6 - 20 s, sometimes two close together; never constant) a short bright
    streak with a fading tail, only at night above the water (`uMeteorA` / `uMeteorB`).
  - At night the clouds thin out and darken so the sky shows. Everything is multiplied by the eased night level,
    so it fades in and out with the mode, and the day sky is exactly as before. Day and night palettes are blended
    before use, so the sky is evaluated once either way, and the night layers are skipped entirely by day.
  - *Cost* (720p, integrated laptop GPU): about +5 ms per frame at the surface at night on every tier (it was +8 to
    +11 ms before the aurora's reflection moved to the vertices and its fine rays were limited per tier: `night` in
    `config/quality.js`); nothing underwater, nothing by day.
- **Night sea:** darker water body, dimmer foam, silver glitter instead of gold; from below, a faint Snell's
  window with no daylight rim; faint cool moonbeams; the dive lamp takes over closer to the surface; plankton
  sparkles just under the surface as well as in the deep. Two chapter texts that speak of sunlight have night
  versions (`chapters.descent.textNight`, `chapters.shallows.textNight`), and the intro's conditions read
  "moonlit night". The edges of the frame close in a little more.
- **Switching** changes nothing else: the scroll position, the story timeline and any glide in progress, the
  camera, sound, quality and language all carry on. The choice is remembered (`ocean-explorer.mode`); day is
  the default.
- **Phones:** up to 400 px wide, the fullscreen button gives way so that day / night and the language fit beside
  the brand (phone browsers hide their own bars while scrolling; iPhones never offer fullscreen).

## Languages (UZ / EN / RU)

Uzbek is the default; English and Russian are one tap away in the HUD (the flag button, top right).

- **One system** (`src/i18n/index.js`): every piece of interface text is a key in `src/i18n/locales/uz.json`,
  `en.json` and `ru.json` (same keys in all three), read with `t('chapters.whale.title')`, with `{name}`
  placeholders (`t('progress.chapter', { n, label })`). The current language is a Vue ref, so everything on screen
  re-renders the moment it changes. Missing keys fall back to English and warn in development.
- **What it covers:** the intro (title, subtitle, button, expedition details, scroll cue), every chapter's label,
  kicker, title and text, the chapter rail and label, the depth gauge (zone names, unit, numbers grouped the local
  way: 10,900 / 10 900), the HUD (quality names, fullscreen, sound and volume labels), the loading screen's steps and
  error messages, the end screen and its buttons, all accessible labels, the page title, description and
  `<html lang>`. Config files hold no words: chapters (`config/story.js`), zones (`config/zones.js`) and
  quality tiers (`config/quality.js`) are referenced by id. Scientific names (Challenger Deep in English, its
  usual Uzbek and Russian names elsewhere) are localised as people say them; units and numbers follow each language.
- **Switching** changes words only: no reload, no new 3D scene, and the scroll position, chapter, camera,
  animations, quality and sound all carry on. Text that animates letter by letter or word by word (the intro
  subtitle, the end title) keeps one set of elements per language, all animated together, and shows the current
  one, so a switch never produces letters that missed their animation.
- **Remembered** in localStorage (`ocean-explorer.locale`); a first visit gets Uzbek.
- **Selector** (`components/LanguageSwitcher.vue`): glass pill with a CSS-drawn flag (emoji flags don't render on
  Windows) and the code; a menu of the three languages in their own names. Touch-sized (44 px rows), works by
  keyboard (Enter or arrows to open, arrows to move, Enter to choose, Escape to close), closes on an outside tap.
  On phones it shows just the flag, and the separate volume button gives way to it (the volume slider still
  opens when sound is switched on).
- **Long translations:** the intro and end titles scale to the longest word, the brand name wraps on narrow
  phones, and the chapter label wraps. Checked at 320 px, 390 px, phone landscape and desktop in all three
  languages: no overflow and no overlap.
- **Adding a language:** add `xx.json` with the same keys, list it in `LOCALES` and `NUMBER_LOCALE` in
  `src/i18n/index.js`, and add its flag to `LanguageSwitcher.vue`.

## Sound

All sound is generated in the browser with the Web Audio API (`src/audio/`): original, synthesised, nothing
licensed and no audio files to load, host or lose (recordings can still be added, see below).

**Mixer** (`engine.js`): master volume (with the compressor and a limiter, so nothing clips) over three parts: the
music, the world (ambience and effects, through an underwater low-pass that closes with depth) and the interface
sounds. One shared reverb is fed after the volume controls, so a silenced part leaves no tail behind. The music is
not muffled underwater (it is the score, not a sound in the water); it only darkens a little.

**Music** (`music.js`, instruments in `instruments.js`): two generative pieces, composed rules rather than loops.
- *Day:* D major, warm and open. Slow pad chords drift between related harmonies; a felt piano plays short
  singing phrases (mostly stepwise, landing on the harmony, resting between them, sometimes answering the last
  phrase); now and then a quiet harp arpeggio or a high string swell.
- *Night:* D minor / Phrygian, deep and still. A low drone that never stops, dark slow chords, distant glassy notes
  that echo away, and now and then something resonating far off in the dark.
- *Depth:* both grow sparser, lower and darker as the camera goes deeper (a "mood" from 0 at the surface to 1 in
  the hadal deep); at night the drone rises and the echoes lengthen.
- *Day / night:* follows the HUD's mode (`appState.mode`). An equal-power crossfade of about 3 s: the two pieces
  are never both at full level (at the midpoint each is at ~71%), a switch back mid-fade continues from where it
  is, and only the audible piece schedules notes (the other stops once faded out). Nothing reloads or restarts.

**Ambience** (`ambience.js`): above the waves, surf, the weight of the water and a little wind; underwater, one
layer per depth zone, crossfaded slowly with wide overlaps:

| Zone | Sound |
| --- | --- |
| sunlight, 0 - 200 m | water moving: soft, close swells |
| twilight, 200 - 1,000 m | currents: a faint, slowly wandering band of sound, a low hum |
| midnight, 1,000 - 4,000 m | a warm low hum and a dark, slow rumble |
| abyssal, 4,000 - 6,000 m | isolation: a thin, very low draught of sound |
| hadal, 6,000 m + | a still, low resonance under a slow, distant swell |

The deep is quieter and emptier, not louder. At night the shallows are quieter and the twilight layer reaches up
nearer the surface. Sparse events: a few soft bubbles (fewer in the deep and at night), a distant whale around the
whale's depths, low pressure groans below 800 m, far-off booms below 4,000 m. **Moments:** a click on the buttons,
a rush as the descent begins, a splash and bubbles as the camera breaks the surface.

**Controls:** the speaker button mutes and unmutes (also the `M` key); the sound panel (its own button, hover, or
opening by itself when sound is switched on; on narrow phones the speaker button opens it while sound is on) has
master, music and effects sliders and a mute button. All of it is remembered (`ocean-explorer.sound.v2`; the old
single volume is read once as the master). Sliders move the sound smoothly and are saved once they settle.

**Autoplay and devices:** nothing is created until the first click, tap or key press (`bridge.js`); that gesture
starts the sound unless the visitor had muted it. The speaker button shows the real state (lit only while sound
is coming out, a warning icon if audio cannot start). Hidden tabs are silenced and the audio context suspended;
it comes back when the tab is shown again, also after the back-forward cache; iOS interruptions resume on the
next tap. Every note builds its own few nodes and disconnects them when it ends; after a stall the schedulers
skip what was missed instead of playing a backlog at once; an error in one scheduled sound is reported once and
never silences the rest.

**Your own recordings:** put original or properly licensed files in `public/audio/` (e.g. `music-day.mp3`,
`music-night.mp3`; MP3 or AAC at 96 - 128 kbps is plenty) and list them in `src/audio/files.js`. A recording
replaces the generated piece of its mode and takes its place in the crossfade. By default nothing is requested
(no 404s); a missing, wrong or undecodable file is reported in the console as `[audio] ...` and the generated
music keeps playing.

**Debugging:** in development, `__oceanAudio.snapshot()` and `__oceanAudio.fileReport` in the console show the
state and the file results.

`<ThreeScene>` takes a `scene-factory` function, so a new scene is a new module under `scenes/`.
