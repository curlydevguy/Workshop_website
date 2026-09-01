// Shared across every page.
// Note: mobile nav toggle is wired in js/include.js instead, since the
// header (and its toggle button) is now injected after this script runs.

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Gentle reveal-on-scroll for .reveal sections
const revealEls = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window && revealEls.length) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealEls.forEach((el) => io.observe(el));
} else {
  revealEls.forEach((el) => el.classList.add('is-visible'));
}

// Scroll-to-top button (added to every page — floats bottom-right, fades
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
window.addEventListener('scroll', () => {
  toggleScrollTopBtn();
  updateScrollBtnPosition();
}, { passive: true });
window.addEventListener('resize', updateScrollBtnPosition);

scrollTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
// Page transition fade
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
  }, 150); // matches fade-out duration
});