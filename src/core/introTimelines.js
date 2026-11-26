import gsap from '@/core/gsap';

const all = (root, selector) => Array.from(root.querySelectorAll(selector));

/** The pieces of the intro that get animated, found once by data-part. */
function parts(root) {
  return {
    scrim: root.querySelector('[data-part="scrim"]'),
    title: root.querySelector('[data-part="title"]'),
    rule: root.querySelector('[data-part="rule"]'),
    words: all(root, '[data-part="word"]'),
    // one set of subtitle words per language (only the current one is shown); each set animates on the same beat
    wordGroups: all(root, '[data-words]').map((group) => all(group, '[data-part="word"]')),
    start: root.querySelector('[data-part="start"]'),
    facts: all(root, '[data-part="fact"]'),
    scroll: root.querySelector('[data-part="scroll"]'),
  };
}

/** Puts every intro element in its hidden starting state (called before the loading screen lifts). */
export function hideIntroUi(root) {
  const p = parts(root);
  gsap.set([p.title, ...p.words, p.start, ...p.facts, p.scroll, p.scrim], { opacity: 0 });
  gsap.set(p.rule, { opacity: 0, scaleX: 0 });
}

/**
 * Title settles in, the rule draws, subtitle words arrive one by one, then the button,
 * the expedition details and the scroll cue.
 * Letter-spacing is animated through --track so the CSS value takes over cleanly afterwards.
 */
export function buildIntroIn(root) {
  const p = parts(root);
  const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  tl.fromTo(p.scrim, { opacity: 0 }, { opacity: 1, duration: 2.5, ease: 'power1.out' }, 0)
    .fromTo(
      p.title,
      { opacity: 0, y: 26, filter: 'blur(14px)', '--track': '0.5em' },
      { opacity: 1, y: 0, filter: 'blur(0px)', '--track': '0.26em', duration: 2.6, ease: 'power2.out', clearProps: 'filter,--track' },
      0.3,
    )
    .fromTo(p.rule, { opacity: 0, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 1.4, ease: 'power2.inOut' }, 1.5)
    .fromTo(p.start, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 1.2 }, 2.7)
    .fromTo(p.facts, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 1, stagger: 0.1 }, 3.2)
    .fromTo(p.scroll, { opacity: 0 }, { opacity: 1, duration: 1.2, ease: 'power1.out' }, 3.5);
  for (const words of p.wordGroups) {
    tl.fromTo(
      words,
      { opacity: 0, y: 14, filter: 'blur(6px)' },
      { opacity: 1, y: 0, filter: 'blur(0px)', duration: 1.2, stagger: 0.18, ease: 'power2.out', clearProps: 'filter' },
      1.7,
    );
  }
  return tl;
}

/** The looping scroll cue: a dot runs down the track while the chevron breathes. */
export function buildScrollCue(root) {
  const dot = root.querySelector('[data-dot]');
  const chevron = root.querySelector('[data-chevron]');
  const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });
  tl.fromTo(dot, { y: 0, opacity: 0 }, { y: 20, opacity: 1, duration: 0.8, ease: 'power1.in' }, 0)
    .to(dot, { y: 34, opacity: 0, duration: 0.8, ease: 'power1.out' }, 0.8)
    .fromTo(chevron, { opacity: 0.25, y: -2 }, { opacity: 0.9, y: 3, duration: 0.8, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0);
  return tl;
}

