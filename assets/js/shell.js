/* ReLU.chat shell behaviour — theme toggle, mobile menu. Motion lives in fx.js.
   Loaded with defer on every page. Everything here is progressive
   enhancement: the site is fully readable and navigable without it. */
(function () {
  'use strict';
  var root = document.documentElement;
  var KEY = 'relu-theme';
  var COLORS = { dark: '#0d1210', light: '#f3f5f2' };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;


  // Theme colours for canvas drawing (canvases cannot use CSS variables directly).
  var colorCache = null;
  document.addEventListener('relu:theme', function () { colorCache = null; });
  window.reluColors = function () {
    if (colorCache) return colorCache;
    var cs = getComputedStyle(root);
    var g = function (n) { return cs.getPropertyValue(n).trim(); };
    colorCache = {
      bg: g('--bg'), elev: g('--bg-elevated'), surface: g('--bg-surface'),
      border: g('--border'), borderStrong: g('--border-strong'),
      text: g('--text-primary'), text2: g('--text-secondary'), muted: g('--text-muted'),
      accent: g('--accent'), accent2: g('--accent-2'),
      accentRgb: g('--accent-rgb').split(/\s+/).join(','), accent2Rgb: g('--accent-2-rgb').split(/\s+/).join(','),
      cat3: g('--cat-3'), cat4: g('--cat-4'), cat5: g('--cat-5'), cat6: g('--cat-6'),
      inkRgb: g('--ink-rgb').split(/\s+/).join(',')
    };
    return colorCache;
  };

  function current() {
    var t = root.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return mq && mq.matches ? 'light' : 'dark';
  }

  function syncChrome() {
    var theme = current();
    var chosen = root.getAttribute('data-theme');
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m, i) {
      if (chosen) {
        // An explicit choice overrides the OS-based media variants.
        if (i === 0) { m.removeAttribute('media'); m.setAttribute('content', COLORS[theme]); }
        else m.remove();
      }
    });
    document.querySelectorAll('.theme-toggle').forEach(function (b) {
      var next = theme === 'light' ? 'dark' : 'light';
      b.setAttribute('aria-label', 'Switch to ' + next + ' theme');
      b.setAttribute('title', 'Switch to ' + next + ' theme');
    });
    document.dispatchEvent(new CustomEvent('relu:theme', { detail: { theme: theme } }));
  }

  document.addEventListener('click', function (e) {
    var toggle = e.target.closest && e.target.closest('.theme-toggle');
    if (toggle) {
      var next = current() === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (err) { /* private mode */ }
      syncChrome();
      return;
    }
    var menuBtn = e.target.closest && e.target.closest('.nav-menu-btn');
    if (menuBtn) {
      var list = document.getElementById(menuBtn.getAttribute('aria-controls'));
      var open = menuBtn.getAttribute('aria-expanded') !== 'true';
      menuBtn.setAttribute('aria-expanded', String(open));
      if (list) list.classList.toggle('is-open', open);
      return;
    }
    var top = e.target.closest && e.target.closest('[data-back-to-top]');
    if (top) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var btn = document.querySelector('.nav-menu-btn[aria-expanded="true"]');
    if (!btn) return;
    btn.click();
    btn.focus();
  });

  if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (!root.getAttribute('data-theme')) syncChrome(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncChrome);
  else syncChrome();
})();
