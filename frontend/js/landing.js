'use strict';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

if ('IntersectionObserver' in window && !reducedMotion.matches) {
  const revealTargets = document.querySelectorAll([
    '.intro-section .section-heading',
    '.evidence-scene',
    '.feature-card',
    '.how-section .section-heading',
    '.game-preview',
    '.steps article',
    '.people-section .section-heading',
    '.photo-grid img',
    '.story-copy',
    '.newspaper-stack',
    '.faq-section .section-heading',
    '.faq-grid details',
    '.closing-section h2',
    '.closing-section p',
    '.closing-section .button',
    '.corporate-intro .section-heading',
    '.corporate-benefit',
    '.corporate-scene',
    '.corporate-flow .section-heading',
    '.corporate-step',
    '.corporate-format .section-heading',
    '.format-card',
    '.corporate-close h2',
    '.corporate-close p',
    '.corporate-close .button'
  ].join(', '));

  const revealObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });

  revealTargets.forEach(element => {
    // Keep the first visible screen readable while the rest of the page waits for scroll.
    if (element.getBoundingClientRect().top < window.innerHeight * 0.88) return;

    if (element.matches('.feature-card, .steps article, .photo-grid img, .faq-grid details, .corporate-benefit, .corporate-step, .format-card')) {
      const siblings = [...element.parentElement.children];
      element.style.setProperty('--reveal-delay', `${Math.min(siblings.indexOf(element) * 75, 225)}ms`);
    }

    element.classList.add('reveal');
    revealObserver.observe(element);
  });

  reducedMotion.addEventListener('change', event => {
    if (!event.matches) return;
    revealObserver.disconnect();
    revealTargets.forEach(element => element.classList.add('is-visible'));
  });
}
