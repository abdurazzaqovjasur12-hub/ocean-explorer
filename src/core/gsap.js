import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

gsap.defaults({ ease: 'power2.out', duration: 0.8 });
gsap.config({ nullTargetWarn: false });

// Mobile browsers resize the viewport as their address bar slides in and out while scrolling. Recalculating
// every trigger then would make the story jump, so those resizes are ignored (real ones still refresh).
ScrollTrigger.config({ ignoreMobileResize: true });

export { ScrollTrigger };
export default gsap;
