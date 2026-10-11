/* Static-first learning instruments. One finite, inspectable timeline per
   figure, played only in view. No animation loop, timers or geometry per frame.
   The same policy controls SVG tracks, replay, page visibility and reduced motion. */
(function () {
  'use strict';
  document.documentElement.classList.add('figures-ready');
  var media = window.matchMedia('(prefers-reduced-motion: reduce)');
  var reduced = media.matches;
  var paused = false;
  var figures = [];
  var toggles = Array.prototype.slice.call(document.querySelectorAll('[data-motion-toggle]'));
  try { paused = localStorage.getItem('relu-motion-paused') === '1'; } catch (_) {}

  function track(state, el, frames, duration, delay) {
    if (!el || !el.animate) return;
    var animation = el.animate(frames, { duration: duration, delay: delay || 0, easing: 'ease-in-out', fill: 'both' });
    animation.pause();
    state.animations.push(animation);
    return animation;
  }
  function route(state, el, duration) {
    if (!el) return;
    var positions = (el.getAttribute('data-route') || '').split(';').map(function (s) { return s.split(',').map(Number); });
    if (positions.length < 2) return;
    var frames = [{ transform: 'translate(0px, 0px)', offset: 0 }, { transform: 'translate(0px, 0px)', offset: .1 }];
    // Each segment is linear. Ease the whole sequence with explicit resting beats,
    // rather than curving a route across a grid obstacle.
    positions.slice(1).forEach(function (p, i) { frames.push({ transform: 'translate(' + p[0] + 'px,' + p[1] + 'px)', offset: .1 + .75 * (i + 1) / (positions.length - 1), easing: 'linear' }); });
    var last = positions[positions.length - 1];
    frames.push({ transform: 'translate(' + last[0] + 'px,' + last[1] + 'px)', offset: 1 });
    var animation = track(state, el, frames, duration);
    // Segment timing is linear so a pawn only traverses neighbouring grid cells.
    if (animation) animation.effect.updateTiming({ easing: 'linear' });
  }
  function build(state) {
    var svg = state.el;
    route(state, svg.querySelector('.i-agent'), 7600);
    route(state, svg.querySelector('.i-message'), 4800);
    track(state, svg.querySelector('.i-astrolabe-rule'), [
      { transform: 'rotate(-20deg)', offset: 0 }, { transform: 'rotate(-20deg)', offset: .12 },
      { transform: 'rotate(12deg)', offset: .65 }, { transform: 'rotate(0deg)', offset: 1 }
    ], 5400);
    var plotter = svg.querySelector('.i-plotter');
    if (plotter) track(state, plotter, [{ transform: 'translate(0px,0px)' },
      { transform: 'translate(' + plotter.style.getPropertyValue('--travel-x') + ',' + plotter.style.getPropertyValue('--travel-y') + ')', offset: .65 },
      { transform: 'translate(0px,0px)' }], 5400);
    var tip = svg.querySelector('.i-shear-tip');
    if (tip) track(state, tip, [{ transform: 'translate(0px,0px)', offset: 0 }, { transform: 'translate(0px,0px)', offset: .15 },
      { transform: 'translate(' + tip.style.getPropertyValue('--shear-x') + ',' + tip.style.getPropertyValue('--shear-y') + ')', offset: .8 },
      { transform: 'translate(' + tip.style.getPropertyValue('--shear-x') + ',' + tip.style.getPropertyValue('--shear-y') + ')', offset: 1 }], 4000);
    track(state, svg.querySelector('.i-equilibrium'), [{ opacity: .15 }, { opacity: 1, offset: .65 }, { opacity: 1 }], 2600);
    Array.prototype.forEach.call(svg.querySelectorAll('.process-stage'), function (stage, i) {
      track(state, stage.querySelector('.p-selection'), [{ opacity: .25 }, { opacity: 1, offset: .3 }, { opacity: 1 }], 1600, i * 650);
      track(state, stage.querySelector('.process-signal'), [{ transform: 'translateX(0px)', opacity: 0 }, { transform: 'translateX(0px)', opacity: 1, offset: .1 }, { transform: 'translateX(70px)', opacity: 1, offset: .85 }, { transform: 'translateX(70px)', opacity: 0 }], 1000, i * 650 + 500);
    });
    Array.prototype.forEach.call(svg.querySelectorAll('.tool-track'), function (el) {
      // Native path length; never overwrite existing dashes or hide a control.
      if (!el.getTotalLength) return;
      var len = el.getTotalLength();
      track(state, el, [{ strokeDasharray: len + ' ' + len, strokeDashoffset: len }, { strokeDasharray: len + ' ' + len, strokeDashoffset: 0 }], 1200, parseInt(el.style.getPropertyValue('--track') || '0', 10) * 180);
    });
  }
  function sync(state) {
    var play = state.visible && !document.hidden && !reduced && !paused;
    if (play && !state.built) { state.built = true; build(state); }
    state.animations.forEach(function (animation) {
      if (play) { if (animation.playState === 'paused') animation.play(); }
      else if (animation.playState === 'running') animation.pause();
    });
  }
  function controls() {
    toggles.forEach(function (button) {
      var stopped = paused || reduced;
      button.setAttribute('aria-pressed', String(stopped));
      button.setAttribute('aria-label', reduced ? 'Illustration motion disabled by your reduced-motion preference' : paused ? 'Resume illustration motion' : 'Pause illustration motion');
      button.title = button.getAttribute('aria-label');
      button.disabled = reduced;
    });
    document.querySelectorAll('[data-motion-replay]').forEach(function (button) { button.disabled = reduced || paused; });
  }
  var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) { var state = figures.find(function (s) { return s.el === entry.target; }); if (state) { state.visible = entry.isIntersecting && entry.intersectionRatio >= .15; sync(state); } });
  }, { threshold: .15 }) : null;
  document.querySelectorAll('[data-motion-figure]').forEach(function (el) {
    var state = { el: el, visible: !observer, animations: [], built: false };
    figures.push(state);
    if (observer) observer.observe(el); else sync(state);
  });
  document.querySelectorAll('[data-motion-replay]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (reduced || paused) return;
      var scope = button.closest('[data-subject-figure], [data-motion-figure]');
      var state = figures.find(function (s) { return s.el === scope || (scope && scope.contains(s.el)); });
      if (!state) return;
      state.animations.forEach(function (a) { a.cancel(); }); state.animations = []; state.built = false; sync(state);
    });
  });
  toggles.forEach(function (button) {
    button.addEventListener('click', function () {
      paused = !paused;
      try { localStorage.setItem('relu-motion-paused', paused ? '1' : '0'); } catch (_) {}
      controls(); figures.forEach(sync);
      document.dispatchEvent(new CustomEvent('relu:motion', { detail: { paused: paused } }));
    });
  });
  function preference() {
    reduced = media.matches;
    if (reduced) figures.forEach(function (state) { state.animations.forEach(function (a) { a.cancel(); }); state.animations = []; state.built = false; });
    controls(); figures.forEach(sync);
  }
  if (media.addEventListener) media.addEventListener('change', preference); else media.addListener(preference);
  document.addEventListener('visibilitychange', function () { figures.forEach(sync); });
  window.addEventListener('pagehide', function () { figures.forEach(function (s) { s.animations.forEach(function (a) { a.pause(); }); }); });
  window.addEventListener('pageshow', function () { figures.forEach(sync); });
  controls();
})();
