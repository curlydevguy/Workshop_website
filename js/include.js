// js/include.js — High-performance header handler
// Supports pre-rendered navbars (instant 0ms paint) with fallback to cached fetch.

function setupNav(container) {
  const root = container || document;

  // Mark the current page's nav link as active
  const current = document.body.dataset.page;
  if (current) {
    const links = root.querySelectorAll('[data-nav]');
    links.forEach(link => {
      if (link.dataset.nav === current) {
        link.classList.add('active');
      } else if (link.dataset.nav !== 'register') {
        link.classList.remove('active');
      }
    });
  }

  // Re-wire the mobile menu toggle
  const navToggle = root.querySelector('#navToggle') || document.getElementById('navToggle');
  const navLinks = root.querySelector('#navLinks') || document.getElementById('navLinks');
  const navContainer = root.querySelector('#navContainer') || document.getElementById('navContainer');
  const navToggleText = navToggle ? navToggle.querySelector('.nav-toggle-text') : null;

  if (navToggle && navLinks && navContainer && !navToggle.dataset.bound) {
    navToggle.dataset.bound = 'true';

    const closeMenu = () => {
      navContainer.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
      if (navToggleText) navToggleText.textContent = 'Menu';
    };

    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = navContainer.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
      if (navToggleText) navToggleText.textContent = isOpen ? 'Close' : 'Menu';
    });

    navLinks.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') closeMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && navContainer.classList.contains('open')) closeMenu();
    });

    document.addEventListener('click', (e) => {
      if (navContainer.classList.contains('open') && !navContainer.contains(e.target)) {
        closeMenu();
      }
    });
  }
}

async function includeHeader() {
  // If navbar is already pre-rendered in HTML, initialize it immediately
  const existingNav = document.querySelector('.site-navbar');
  if (existingNav) {
    setupNav(existingNav);
    return;
  }

  const mount = document.getElementById('header-placeholder');
  if (!mount) return;

  // Check sessionStorage for instant 0ms render without network wait
  const cached = sessionStorage.getItem('workshop_header_html');
  if (cached) {
    mount.innerHTML = cached;
    setupNav(mount);
  }

  try {
    const res = await fetch('/header.html');
    if (!res.ok) throw new Error('header.html not found');
    const html = await res.text();
    if (html !== cached) {
      sessionStorage.setItem('workshop_header_html', html);
      mount.innerHTML = html;
      setupNav(mount);
    }
  } catch (err) {
    if (!cached) {
      console.error('Header fetch failed:', err);
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', includeHeader);
} else {
  includeHeader();
}