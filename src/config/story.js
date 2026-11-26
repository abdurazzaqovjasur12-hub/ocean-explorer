/**
 * The scroll story. Scrolling moves one GSAP timeline (src/core/story.js) whose time is measured in
 * screens: a chapter with `length: 1` takes one viewport height of scrolling. The whole story is
 * 9.1 screens, so the page stays short and every chapter is a flick or two away on a phone.
 *
 * The words (label, kicker, title, text) are translations: `chapters.<id>.*` in src/i18n/locales.
 *
 * `depth: [arrive, leave]` is the dive parameter (metres): the camera travels to `arrive` as the chapter
 * begins, then drifts slowly to `leave` while its text is on screen. `textAt: [in, out]` (fractions of the
 * chapter) overrides when its text shows.
 */
export const CHAPTERS = [
  {
    id: 'surface',
    length: 0.7,
    depth: [0, 0],
    // The intro screen is this chapter's text.
  },
  {
    id: 'descent',
    length: 1,
    depth: [150, 150],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
    nightText: true, // its text speaks of sunlight: chapters.descent.textNight at night
  },
  {
    id: 'shallows',
    length: 0.9,
    depth: [220, 320],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
    nightText: true, // its text speaks of sunlight: chapters.shallows.textNight at night
  },
  {
    id: 'glow',
    length: 1.1,
    depth: [850, 1000],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
  },
  {
    id: 'whale',
    length: 1.4,
    depth: [1700, 1850],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
  },
  {
    id: 'vents',
    length: 1.2,
    depth: [2950, 3050],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
  },
  {
    id: 'abyss',
    length: 1.2,
    depth: [9800, 10900],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
  },
  {
    id: 'return',
    length: 1.6,
    depth: [0, 0],
    beat: true, // has a block of text: chapters.<id>.kicker / title / text
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
