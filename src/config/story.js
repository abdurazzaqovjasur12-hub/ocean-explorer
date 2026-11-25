/**
 * The scroll story. Scrolling moves one GSAP timeline (src/core/story.js) whose time is measured in
 * screens: a chapter with `length: 1` takes one viewport height of scrolling. The whole story is
 * 9.1 screens, so the page stays short and every chapter is a flick or two away on a phone.
 *
 * `depth: [arrive, leave]` is the dive parameter (metres): the camera travels to `arrive` as the chapter
 * begins, then drifts slowly to `leave` while its text is on screen. `textAt: [in, out]` (fractions of the
 * chapter) overrides when its text shows.
 */
export const CHAPTERS = [
  {
    id: 'surface',
    label: 'Ocean surface',
    length: 0.7,
    depth: [0, 0],
    // The intro screen is this chapter's text.
  },
  {
    id: 'descent',
    label: 'The descent',
    length: 1,
    depth: [150, 150],
    kicker: '0 – 150 m',
    title: 'Breaking the surface',
    text: 'The sky folds into a ripple of light overhead. With every metre, the sea takes a little more of the sun.',
  },
  {
    id: 'shallows',
    label: 'Shallow water',
    length: 0.9,
    depth: [220, 320],
    kicker: 'Sunlight zone · 300 m',
    title: 'Cathedral light',
    text: 'Shafts of sun lean through the blue. Red light is long gone; below 200 metres only blue still reaches you.',
  },
  {
    id: 'glow',
    label: 'Bioluminescence',
    length: 1.1,
    depth: [850, 1000],
    kicker: 'Twilight zone · 900 m',
    title: 'Living light',
    text: 'Out of the dark, jellyfish pulse with their own light. Most animals down here make it: to hunt, to hide, to find each other.',
  },
  {
    id: 'whale',
    label: 'Whale encounter',
    length: 1.4,
    depth: [1700, 1850],
    kicker: 'Midnight zone · 1,800 m',
    title: 'A passing giant',
    text: 'A sperm whale hunts in total darkness, finding squid by sound alone. One breath at the surface lasts it over an hour.',
  },
  {
    id: 'vents',
    label: 'Hydrothermal vents',
    length: 1.2,
    depth: [2950, 3050],
    kicker: 'Mid-ocean ridge · 3,000 m',
    title: 'Black smokers',
    text: 'Water hotter than 350 °C pours out of the seafloor, thick with minerals. Life thrives here without any sunlight at all.',
  },
  {
    id: 'abyss',
    label: 'The abyss',
    length: 1.2,
    depth: [9800, 10900],
    kicker: 'Challenger Deep · 10,900 m',
    title: 'The abyss',
    text: 'The deepest water on Earth, under more than a thousand times the pressure of the air above. Something vast moves at the edge of the light, and is gone.',
  },
  {
    id: 'return',
    label: 'Return to surface',
    length: 1.6,
    depth: [0, 0],
    kicker: 'The ascent',
    title: 'Back into the light',
    text: 'Eleven kilometres of water above you, and every metre a little brighter than the last.',
    textAt: [0.05, 0.42], // shown during the climb, gone before the surface comes into view (then the end screen)
  },
];

/** Where each chapter starts on the timeline, and the story's total length (both in screens). */
export const CHAPTER_STARTS = CHAPTERS.reduce((starts, c, i) => {
  starts.push(i === 0 ? 0 : starts[i - 1] + CHAPTERS[i - 1].length);
  return starts;
}, []);
export const STORY_LENGTH = CHAPTERS.reduce((sum, c) => sum + c.length, 0);

/** Lead time: travel to the next chapter begins this far (screens) before its start. */
export const LEAD = 0.12;

/** The chapter playing at a timeline time (it becomes current as its travel gets under way). */
export function chapterIndexAt(time) {
  let index = 0;
  for (let i = 0; i < CHAPTERS.length; i++) if (time >= CHAPTER_STARTS[i] - LEAD * 0.5) index = i;
  return index;
}

/** The moment a chapter is "settled": its text fully on screen (or the very start / end of the story). */
export function chapterRestTime(index) {
  if (index <= 0) return 0;
  if (index >= CHAPTERS.length - 1) return STORY_LENGTH;
  return CHAPTER_STARTS[index] + CHAPTERS[index].length * 0.62;
}

export const chapterIndexById = (id) => CHAPTERS.findIndex((c) => c.id === id);
