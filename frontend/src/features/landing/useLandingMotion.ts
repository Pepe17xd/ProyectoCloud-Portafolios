import { RefObject, useLayoutEffect } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/** Owns every landing timeline and ScrollTrigger so Strict Mode and unmounts revert cleanly. */
export function useLandingMotion(rootRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let removePointerTracking = () => {};

    const context = gsap.context(() => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedMotion) {
        gsap.set('[data-reveal]', { autoAlpha: 1, clearProps: 'transform' });
        return;
      }

      const intro = gsap.timeline({ defaults: { ease: 'power3.out' } });
      intro
        .fromTo('.hero-eyebrow', { autoAlpha: 0, y: 13 }, { autoAlpha: 1, y: 0, duration: 0.42 })
        .fromTo('.hero-title-line > span', { yPercent: 112 }, { yPercent: 0, duration: 0.62, stagger: 0.14 }, '-=0.12')
        .fromTo('.hero-highlight', { filter: 'drop-shadow(0 0 0 rgba(56,189,248,0))' }, { filter: 'drop-shadow(0 0 15px rgba(56,189,248,.5))', duration: 0.7 }, '-=0.34')
        .fromTo('.landing-hero-copy > p', { autoAlpha: 0, y: 13 }, { autoAlpha: 1, y: 0, duration: 0.42 }, '-=0.43')
        .fromTo('.landing-hero-actions .landing-button', { autoAlpha: 0, y: 13 }, { autoAlpha: 1, y: 0, duration: 0.38, stagger: 0.1 }, '-=0.3')
        .fromTo('.landing-trust span', { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.06 }, '-=0.23')
        .fromTo('.floating-dashboard', { autoAlpha: 0, y: 48, rotateX: 8, scale: 0.97 }, { autoAlpha: 1, y: 0, rotateX: 2, scale: 1, duration: 0.78, ease: 'power2.out' }, '-=0.12')
        .fromTo('.hero-float-chip', { autoAlpha: 0, scale: 0.92, y: 10 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.36, stagger: 0.12 }, '-=0.33');

      const dashboardWrap = root.querySelector<HTMLElement>('.hero-visual-wrap');
      const dashboard = root.querySelector<HTMLElement>('.floating-dashboard');
      if (dashboardWrap && dashboard && window.matchMedia('(pointer: fine)').matches) {
        const rotateX = gsap.quickTo(dashboard, 'rotateX', { duration: 0.55, ease: 'power3.out' });
        const rotateY = gsap.quickTo(dashboard, 'rotateY', { duration: 0.55, ease: 'power3.out' });
        const onPointerMove = (event: PointerEvent) => {
          const rect = dashboardWrap.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width - 0.5;
          const y = (event.clientY - rect.top) / rect.height - 0.5;
          rotateX(2 - y * 7);
          rotateY(x * 8);
          dashboardWrap.style.setProperty('--pointer-x', `${(x + 0.5) * 100}%`);
          dashboardWrap.style.setProperty('--pointer-y', `${(y + 0.5) * 100}%`);
        };
        const onPointerLeave = () => {
          rotateX(2);
          rotateY(0);
          dashboardWrap.style.setProperty('--pointer-x', '50%');
          dashboardWrap.style.setProperty('--pointer-y', '50%');
        };
        dashboardWrap.addEventListener('pointermove', onPointerMove, { passive: true });
        dashboardWrap.addEventListener('pointerleave', onPointerLeave, { passive: true });
        removePointerTracking = () => {
          dashboardWrap.removeEventListener('pointermove', onPointerMove);
          dashboardWrap.removeEventListener('pointerleave', onPointerLeave);
        };
      }

      gsap.to('.hero-visual-wrap', {
        y: -14,
        scale: 0.955,
        ease: 'none',
        scrollTrigger: { trigger: '.landing-hero', start: 'top top', end: 'bottom top', scrub: 0.8 },
      });
      gsap.to('.dashboard-scroll-depth', {
        rotateX: -1.5,
        scale: 0.975,
        ease: 'none',
        scrollTrigger: { trigger: '.landing-hero', start: 'top top', end: 'bottom top', scrub: 0.9 },
      });
      gsap.to('.hero-orbit.orbit-one', {
        rotation: 18,
        ease: 'none',
        scrollTrigger: { trigger: '.landing-hero', start: 'top top', end: 'bottom top', scrub: 1.2 },
      });

      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((element, index) => {
        gsap.fromTo(element, { autoAlpha: 0, y: 28, rotateX: element.matches('.landing-bento-grid li') ? 2 : 0 }, {
          autoAlpha: 1,
          y: 0,
          rotateX: 0,
          duration: 0.68,
          delay: Number.parseFloat(element.style.getPropertyValue('--reveal-delay') || '0') / 1000,
          ease: 'power3.out',
          scrollTrigger: { trigger: element, start: 'top 86%', once: true, onEnter: () => element.classList.add('is-motion-visible') },
        });
      });

      gsap.utils.toArray<HTMLElement>('.capacity-line i').forEach((bar, index) => {
        gsap.fromTo(bar, { scaleX: 0, transformOrigin: 'left center' }, {
          scaleX: 1,
          duration: 0.8,
          delay: index * 0.1,
          ease: 'power2.out',
          scrollTrigger: { trigger: '.landing-bento-grid [data-feature="capacity"]', start: 'top 82%', once: true },
        });
      });

      gsap.fromTo('.sim-bars span', { scaleY: 0, transformOrigin: 'center bottom' }, {
        scaleY: 1,
        duration: 0.75,
        stagger: 0.12,
        ease: 'power2.out',
        scrollTrigger: { trigger: '.command-deck', start: 'top 76%', once: true },
      });

      gsap.fromTo('.org-card', { autoAlpha: 0, x: -26, rotateY: 5 }, {
        autoAlpha: 1,
        x: 0,
        rotateY: 0,
        stagger: 0.14,
        duration: 0.62,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.org-visual', start: 'top 78%', once: true },
      });
      const organizationLines = gsap.timeline({ scrollTrigger: { trigger: '.org-visual', start: 'top 78%', end: 'bottom top', toggleActions: 'play pause resume pause' } });
      organizationLines
        .fromTo('.org-connections path', { strokeDashoffset: 220 }, { strokeDashoffset: 0, stagger: 0.12, duration: 1.25, ease: 'power2.inOut' })
        .to('.org-connections path', { strokeDasharray: '4 16', strokeDashoffset: -20, duration: 2.2, repeat: -1, stagger: 0.42, ease: 'none' });
      gsap.fromTo('.org-signal', { opacity: 0 }, {
        opacity: 1,
        duration: 0.45,
        repeat: -1,
        yoyo: true,
        repeatDelay: 0.5,
        ease: 'sine.inOut',
        scrollTrigger: { trigger: '.org-visual', start: 'top 75%', end: 'bottom top', toggleActions: 'play pause resume pause' },
      });

      gsap.to('.orbit-ring', { rotation: 360, duration: 72, repeat: -1, ease: 'none', transformOrigin: '50% 50%', scrollTrigger: { trigger: '.about-network', start: 'top bottom', end: 'bottom top', toggleActions: 'play pause resume pause' } });
      gsap.to('.network-node', {
        keyframes: [
          { x: 5, y: -7, duration: 1.9 },
          { x: -4, y: -2, duration: 2.1 },
          { x: 0, y: 0, duration: 2 },
        ],
        stagger: 0.22,
        repeat: -1,
        ease: 'sine.inOut',
        scrollTrigger: { trigger: '.about-network', start: 'top bottom', end: 'bottom top', toggleActions: 'play pause resume pause' },
      });
      gsap.to('.network-core', { scale: 1.045, duration: 2.6, repeat: -1, yoyo: true, ease: 'sine.inOut', scrollTrigger: { trigger: '.about-network', start: 'top bottom', end: 'bottom top', toggleActions: 'play pause resume pause' } });

      gsap.fromTo('.landing-steps', { '--timeline-progress': 0 }, {
        '--timeline-progress': 1,
        ease: 'none',
        scrollTrigger: { trigger: '.landing-steps', start: 'top 72%', end: 'bottom 55%', scrub: 0.6 },
      });
      const timelineSteps = gsap.utils.toArray<HTMLElement>('.landing-steps li');
      ScrollTrigger.create({
        trigger: '.landing-steps',
        start: 'top 80%',
        end: 'bottom 54%',
        onUpdate: self => {
          const activeIndex = Math.min(timelineSteps.length - 1, Math.floor(self.progress * timelineSteps.length));
          timelineSteps.forEach((step, index) => {
            step.classList.toggle('is-active', index === activeIndex);
            step.classList.toggle('is-complete', index < activeIndex);
          });
        },
      });
      const closing = gsap.timeline({ scrollTrigger: { trigger: '.landing-closing', start: 'top 82%', once: true } });
      closing
        .fromTo('.landing-closing-card', { autoAlpha: 0, y: 34, scale: 0.985 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.78, ease: 'power3.out' })
        .fromTo('.landing-closing-copy h2', { autoAlpha: 0, y: 14 }, { autoAlpha: 1, y: 0, duration: 0.48, ease: 'power3.out' }, '-=0.34')
        .fromTo('.landing-closing-copy > p', { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: 0.4 }, '-=0.24')
        .fromTo('.landing-closing-actions .landing-button', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, stagger: 0.1, duration: 0.38 }, '-=0.23');
    }, root);

    return () => {
      removePointerTracking();
      context.revert();
    };
  }, [rootRef]);
}
