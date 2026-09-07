// Shared across every page.
// Note: mobile nav toggle is wired in js/include.js instead, since the
// header (and its toggle button) is now injected after this script runs.

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// ==========================================================================
// LENIS — buttery inertia smooth scroll (script tag loaded just before this
// file on every page). Falls back silently to native scrolling if the CDN
// didn't load, and is skipped entirely for reduced-motion users.
// ==========================================================================
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let lenis = null;
if (window.Lenis && !prefersReducedMotion) {
  lenis = new Lenis({
    duration: 1.15,
    easing: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)), // expo-out
    smoothWheel: true,
    smoothTouch: false, // native touch scroll feels better on mobile
    wheelMultiplier: 1,
  });
  const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

const smoothScrollTo = (target, opts) => {
  if (lenis) {
    lenis.scrollTo(target, { duration: 1.2, easing: (t) => 1 - Math.pow(1 - t, 3), ...opts });
  } else {
    const top = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top, behavior: 'smooth' });
  }
};

// Smooth-scroll same-page anchor links (nav "Schedule", "Contact" jump
// links, etc.) through Lenis so they get the same eased feel as everything
// else instead of the browser's flat native jump.
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]');
  if (!link || link.getAttribute('href') === '#') return;
  const targetEl = document.querySelector(link.getAttribute('href'));
  if (!targetEl) return;
  e.preventDefault();
  smoothScrollTo(targetEl, { offset: -16 });
});

// ==========================================================================
// SCROLL REVEAL — sections tagged .reveal fade/slide up the first time they
// enter the viewport. Cards, table rows, and chips inside them are also
// auto-tagged so they cascade in one after another instead of the whole
// section popping in as one flat block.
// ==========================================================================
const STAGGER_SELECTOR = '.person-card, .perk-card, .info-card, .panel, .split-panel, .chip, .fee-card, .sched-table tbody tr, .fee-table tbody tr';
const revealEls = document.querySelectorAll('.reveal, .reveal-pop');

const revealWithStagger = (target) => {
  target.classList.add('is-visible');
  const children = target.matches(STAGGER_SELECTOR) ? [] : target.querySelectorAll(STAGGER_SELECTOR);
  children.forEach((child, i) => {
    child.classList.add('reveal-stagger-item');
    const delay = Math.min(i * 65, 455);
    child.style.transitionDelay = `${delay}ms`;
    // next frame, so the browser paints the 0-opacity state first
    requestAnimationFrame(() => child.classList.add('is-visible'));
    // Clear the inline delay once the fade-in has had time to finish, so it
    // doesn't linger and make later interactions (like hover) feel delayed.
    setTimeout(() => { child.style.transitionDelay = ''; }, delay + 500);
  });
};

if ('IntersectionObserver' in window && revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        revealWithStagger(entry.target);
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => {
    el.classList.add('is-visible');
    el.querySelectorAll(STAGGER_SELECTOR).forEach((child) => child.classList.add('is-visible'));
  });
}

// Scroll-to-top button (added to every page — floats bottom-right, springs
// in once you've scrolled past the header, scrolls smoothly back to top)
const scrollTopBtn = document.createElement('button');
scrollTopBtn.className = 'scroll-top-btn';
scrollTopBtn.type = 'button';
scrollTopBtn.setAttribute('aria-label', 'Scroll to top');
scrollTopBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
document.body.appendChild(scrollTopBtn);

const toggleScrollTopBtn = () => {
  scrollTopBtn.classList.toggle('is-visible', window.scrollY > 400);
};

// Keep the button pinned just above the footer instead of floating over it —
// as the footer scrolls into view, nudge the button up by however much of
// the footer is showing, so it never overlaps the map/address/directions.
const footerEl = document.querySelector('.site-footer');
const BASE_GAP = 20; // px gap kept above the footer once it's in view
const updateScrollBtnPosition = () => {
  if (!footerEl) return;
  const footerTop = footerEl.getBoundingClientRect().top;
  const overlap = window.innerHeight - footerTop;
  scrollTopBtn.style.bottom = overlap > 0 ? `${overlap + BASE_GAP}px` : '';
};

toggleScrollTopBtn();
updateScrollBtnPosition();
const onScrollTick = () => {
  toggleScrollTopBtn();
  updateScrollBtnPosition();
};
if (lenis) {
  lenis.on('scroll', onScrollTick);
} else {
  window.addEventListener('scroll', onScrollTick, { passive: true });
}
window.addEventListener('resize', updateScrollBtnPosition);

scrollTopBtn.addEventListener('click', () => smoothScrollTo(0));

// Page transition fade (matches the 0.28s page-fade-out animation in css)
document.addEventListener('click', function (e) {
  const link = e.target.closest('a');
  if (!link) return;

  const href = link.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || link.target === '_blank') {
    return; // skip anchors, external links, mailto, new-tab links
  }

  e.preventDefault();
  document.body.classList.add('is-leaving');
  setTimeout(function () {
    window.location.href = href;
  }, 280); // matches fade-out duration
});
