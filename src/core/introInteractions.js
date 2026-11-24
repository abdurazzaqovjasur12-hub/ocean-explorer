import gsap from '@/core/gsap';

const PARALLAX_PX = 14; // movement of the front-most layer at the screen edge
const MAGNET_RADIUS = 150; // px around the button where it leans towards the pointer
const MAGNET_MAX = 10;

/**
 * Pointer and touch behaviour of the intro, with no framework in it:
 *  - layers (data-depth) drift against the pointer at different speeds, eased with quickTo
 *  - the start button leans towards a nearby pointer and lights up under it
 * Scrolling, swiping and the keyboard need nothing here: they scroll the page, and the scroll story
 * (useStoryScroll) takes it from there. Returns { dispose }.
 */
export function createIntroInteractions({ root, isActive }) {
  const layers = Array.from(root.querySelectorAll('[data-depth]')).map((el) => ({
    el,
    depth: parseFloat(el.dataset.depth) || 0,
    magnetic: el.hasAttribute('data-magnetic'),
    x: gsap.quickTo(el, 'x', { duration: 0.9, ease: 'power3.out' }),
    y: gsap.quickTo(el, 'y', { duration: 0.9, ease: 'power3.out' }),
  }));
  const button = root.querySelector('[data-part="start"]');

  function move(clientX, clientY) {
    const nx = (clientX / window.innerWidth - 0.5) * 2; // -1..1
    const ny = (clientY / window.innerHeight - 0.5) * 2;
    for (const layer of layers) {
      let x = -nx * PARALLAX_PX * layer.depth;
      let y = -ny * PARALLAX_PX * layer.depth * 0.6;
      if (layer.magnetic && button) {
        const r = button.getBoundingClientRect();
        const dx = clientX - (r.left + r.width / 2);
        const dy = clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy);
        if (dist < MAGNET_RADIUS) {
          const pull = 1 - dist / MAGNET_RADIUS;
          x += Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, dx * 0.22 * pull));
          y += Math.max(-MAGNET_MAX, Math.min(MAGNET_MAX, dy * 0.22 * pull));
        }
      }
      layer.x(x);
      layer.y(y);
    }
    if (button) {
      const r = button.getBoundingClientRect();
      button.style.setProperty('--mx', `${clientX - r.left}px`);
      button.style.setProperty('--my', `${clientY - r.top}px`);
    }
  }

  const rest = () => layers.forEach((l) => { l.x(0); l.y(0); });

  // ---- pointer (mouse, pen and touch share the same handler) ----
  const onPointerMove = (e) => {
    if (isActive()) move(e.clientX, e.clientY);
  };
  const onPointerDown = (e) => {
    if (!isActive()) return;
    move(e.clientX, e.clientY);
  };
  const onPointerUp = (e) => {
    if (e.pointerType !== 'mouse') rest(); // touch has no hover: settle back when the finger lifts
  };
  const onPointerCancel = () => rest();
  const onLeave = () => rest();

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerCancel, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeave);

  return {
    dispose() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      layers.forEach((l) => gsap.killTweensOf(l.el));
    },
  };
}
