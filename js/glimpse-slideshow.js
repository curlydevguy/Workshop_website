// Auto-advancing "Glimpses" slideshow on the homepage — Ken Burns zoom on
// the active photo, glass nav discs instead of classic arrow buttons, and
// dots that double as an autoplay progress bar. Pauses on hover/touch.
(function () {
  const SLIDE_MS = 5000;
  const container = document.getElementById('glimpseSlideshow');
  if (!container) return;

  const track = container.querySelector('.glimpse-track');
  const slides = Array.from(container.querySelectorAll('.glimpse-slide'));
  const dotsWrap = container.querySelector('.glimpse-dots');
  const prevBtn = container.querySelector('.glimpse-prev');
  const nextBtn = container.querySelector('.glimpse-next');
  if (!track || slides.length < 2) return; // nothing to slide between

  let index = 0;
  let timer = null;

  slides.forEach((slide, i) => {
    const img = slide.querySelector('.glimpse-img');
    if (img) img.style.setProperty('--kb-duration', `${SLIDE_MS + 1000}ms`);

    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'glimpse-dot';
    dot.setAttribute('role', 'tab');
    dot.setAttribute('aria-label', `Go to photo ${i + 1}`);
    dot.addEventListener('click', () => { goTo(i); restart(); });
    dotsWrap.appendChild(dot);
  });
  const dots = Array.from(dotsWrap.children);

  function goTo(i) {
    index = (i + slides.length) % slides.length;
    track.style.transform = `translateX(-${index * 100}%)`;
    slides.forEach((s, si) => s.classList.toggle('is-active', si === index));
    dots.forEach((d, di) => d.classList.toggle('is-active', di === index));
  }

  function next() { goTo(index + 1); }
  function prev() { goTo(index - 1); }

  function play() {
    stop();
    timer = setInterval(next, SLIDE_MS);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }
  function restart() { play(); }

  nextBtn.addEventListener('click', () => { next(); restart(); });
  prevBtn.addEventListener('click', () => { prev(); restart(); });

  container.addEventListener('mouseenter', stop);
  container.addEventListener('mouseleave', play);
  container.addEventListener('focusin', stop);
  container.addEventListener('focusout', play);

  // basic swipe support
  let touchStartX = null;
  track.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    stop();
  }, { passive: true });
  track.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(dx) > 40) { dx < 0 ? next() : prev(); }
    touchStartX = null;
    play();
  }, { passive: true });

  goTo(0);
  play();
})();
