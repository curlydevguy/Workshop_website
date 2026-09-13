// Ground-truth style: preserve the supplied D1 Workshop academic header and navigation behavior.
// Loads header.html into every page. Requires the page to be served
// (e.g. VS Code "Live Server") — fetch() of a local file is blocked
// when you just double-click the HTML file open.

async function includeHeader() {
  const mount = document.getElementById('header-placeholder');
  if (!mount) return;

  try {
    // The cache-buster trick is added right here on the fetch line
    const res = await fetch('header.html?v=' + new Date().getTime());
    if (!res.ok) throw new Error('header.html not found');
    mount.innerHTML = await res.text();
  } catch (err) {
    mount.innerHTML = '<p style="padding:12px;font-family:monospace;">Header failed to load — is this page open via Live Server?</p>';
    console.error(err);
    return;
  }

  // Mark the current page's nav link as active
  const current = document.body.dataset.page;
  if (current) {
    const link = mount.querySelector(`[data-nav="${current}"]`);
    if (link) link.classList.add('active');
  }

  // Re-wire the mobile menu toggle now that the header exists in the DOM.
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const navContainer = document.getElementById('navContainer');

  // The responsive CSS scopes the open state to the container that wraps the
  // brand, links, and register action. Keep the script and CSS on the same
  // element so the disclosure is visible at mobile widths.
  if (navToggle && navLinks && navContainer) {
    const closeMenu = () => {
      navContainer.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      navToggle.textContent = 'Menu';
    };

    navToggle.addEventListener('click', () => {
      const isOpen = navContainer.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      navToggle.textContent = isOpen ? 'Close' : 'Menu';
    });

    // Tapping a nav link closes the mobile menu instead of leaving it open
    // underneath the page you just navigated to.
    navLinks.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') closeMenu();
    });

    // Escape closes the menu too, for keyboard users.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navContainer.classList.contains('open')) closeMenu();
    });
  }
}

includeHeader();