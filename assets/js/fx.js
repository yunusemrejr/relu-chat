/* ReLU.chat motion layer. Everything here is progressive enhancement: with this
   script absent the pages are complete (hidden start states exist only under
   html.js, and a watchdog in the shell head restores them if this file fails).

   What it drives
   - --scroll on <html>          page progress, drawn as the nav edge line
   - .reveal / .reveal-pop       rise-in on scroll, staggered by sibling index
   - svg[data-anim]       subject illustrations draw themselves in view
   - .split-words                headline words rise out of a clip
   - [data-scroll]               --p 0..1 while the element crosses the viewport
   - [data-steps]                same, plus .is-on on each <li> as progress passes it
   - .stack > .panel             --p = how far the next panel has covered this one
   - [data-parallax="n"]         vertical drift against scroll
   - [data-tilt]                 pointer-following tilt
   - [data-count]                number counts up when seen
*/
(function () {
  'use strict';
  window.__fx = 1;
  var root = document.documentElement;
  var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  // ---- word split ------------------------------------------------------
  function splitWords() {
    $$('.split-words').forEach(function (el) {
      if (el.dataset.split) return;
      el.dataset.split = '1';
      var i = 0;
      (function walk(node) {
        Array.prototype.slice.call(node.childNodes).forEach(function (n) {
          if (n.nodeType === 3) {
            var frag = document.createDocumentFragment();
            n.textContent.split(/(\s+)/).forEach(function (part) {
              if (!part) return;
              if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
              var w = document.createElement('span'); w.className = 'w';
              var s = document.createElement('span'); s.textContent = part; s.style.setProperty('--i', i++);
              w.appendChild(s); frag.appendChild(w);
            });
            node.replaceChild(frag, n);
          } else if (n.nodeType === 1 && !/^(SVG|BR)$/i.test(n.tagName)) walk(n);
        });
      })(el);
    });
  }

  // ---- reveal ----------------------------------------------------------
  function initReveal() {
    var els = $$('.reveal, .reveal-pop');
    if (!els.length) return;
    // stagger: index among reveal siblings, capped so long lists don't crawl
    var seen = new Map();
    els.forEach(function (el) {
      var p = el.parentNode, n = seen.get(p) || 0;
      if (!el.style.getPropertyValue('--i')) el.style.setProperty('--i', Math.min(n, 6));
      seen.set(p, n + 1);
    });
    if (!('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('visible'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('visible'); io.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  // ---- plates + counters ----------------------------------------------
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count') || el.textContent);
    if (!isFinite(target) || calm) return;
    var t0 = null, dur = 1100;
    el.textContent = '0';
    requestAnimationFrame(function step(t) {
      if (t0 === null) t0 = t;
      var k = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 4);
      el.textContent = Math.round(target * e);
      if (k < 1) requestAnimationFrame(step);
    });
  }
  function initInView() {
    var plates = $$('svg[data-anim]'), counts = $$('[data-count]');
    if (!('IntersectionObserver' in window)) { plates.forEach(function (p) { p.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        if (en.target.matches('svg')) en.target.classList.add('is-in');
        else countUp(en.target);
        io.unobserve(en.target);
      });
    }, { threshold: 0.3 });
    plates.concat(counts).forEach(function (el) { io.observe(el); });
  }

  // ---- scroll-linked values ---------------------------------------------
  var scrollEls = [], stepEls = [], panels = [], parallax = [], ticking = false;
  function collect() {
    scrollEls = $$('[data-scroll]');
    stepEls = $$('[data-steps]');
    panels = $$('.stack > .panel');
    parallax = calm ? [] : $$('[data-parallax]');
  }
  function frame() {
    ticking = false;
    var vh = window.innerHeight || 1, y = window.scrollY || window.pageYOffset;
    var max = Math.max(1, root.scrollHeight - vh);
    root.style.setProperty('--scroll', clamp(y / max, 0, 1).toFixed(4));

    scrollEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -vh * 0.5 || r.top > vh * 1.5) return;
      el.style.setProperty('--p', clamp((vh - r.top) / (vh + r.height), 0, 1).toFixed(4));
    });

    stepEls.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      // 0 when the block's top reaches 85% of the viewport, 1 when its bottom reaches 55%
      var p = clamp((vh * 0.85 - r.top) / (r.height + vh * 0.3), 0, 1);
      el.style.setProperty('--p', p.toFixed(4));
      var items = $$(':scope > li', el);
      items.forEach(function (li, i) { li.classList.toggle('is-on', p * (items.length + 0.35) > i + 0.15); });
    });

    panels.forEach(function (panel, i) {
      var next = panels[i + 1];
      if (!next) return;
      var a = panel.getBoundingClientRect(), b = next.getBoundingClientRect();
      var p = clamp(1 - (b.top - a.top) / Math.max(1, a.height), 0, 1);
      panel.style.setProperty('--p', p.toFixed(3));
    });

    parallax.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      var k = parseFloat(el.getAttribute('data-parallax')) || 0.1;
      el.style.setProperty('--py', (((r.top + r.height / 2) - vh / 2) * k * -1).toFixed(1) + 'px');
    });
  }
  function request() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }

  // ---- pointer tilt ---------------------------------------------------------
  function initTilt() {
    if (calm || !window.matchMedia('(hover: hover)').matches) return;
    $$('[data-tilt]').forEach(function (el) {
      var max = parseFloat(el.getAttribute('data-tilt')) || 6;
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--rx', (-y * max).toFixed(2) + 'deg');
        el.style.setProperty('--ry', (x * max).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', function () { el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg'); });
    });
  }

  function init() {
    if (!calm) splitWords();
    else $$('.split-words').forEach(function (el) { el.dataset.split = '1'; });
    initReveal();
    initInView();
    initTilt();
    collect();
    frame();
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    window.addEventListener('load', function () { collect(); request(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
