/* Home page: the live ReLU plot and the PWA install prompt. Progressive: the
   page works with this script absent (the plot simply stays at its default).
   The ramp is cut into six coloured segments, one per subject. Dragging x
   pushes the lit part of the ramp right and switches subjects on as it passes
   them, the same way a ReLU unit switches on once its input is positive. */
(function () {
  'use strict';

  // ---- ReLU plot ------------------------------------------------------
  var svg = document.getElementById('relu-plot');
  var input = document.getElementById('plot-x');
  if (svg && input) {
    var NS = 'http://www.w3.org/2000/svg';
    var X0 = 260, Y0 = 316, U = 54, N = 6, SPAN = 4;
    var dot = document.getElementById('plot-dot');
    var drop = document.getElementById('plot-drop');
    var across = document.getElementById('plot-across');
    var read = document.getElementById('plot-read');
    var clip = document.getElementById('plot-clip');
    var segsG = document.getElementById('plot-segs');
    var nodesG = document.getElementById('plot-nodes');
    var keys = Array.prototype.slice.call(document.querySelectorAll('.plot-key li'));

    function mk(name, attrs) {
      var el = document.createElementNS(NS, name);
      for (var k in attrs) el.setAttribute(k, attrs[k]);
      return el;
    }
    var core = document.getElementById('plot-core');
    var staticNodes = Array.prototype.slice.call(nodesG.querySelectorAll('.node'));
    var staticSegments = Array.prototype.slice.call(segsG.querySelectorAll('.seg'));
    var nodes = [];
    for (var i = 0; i < N; i++) {
      var slug = keys[i] ? keys[i].getAttribute('data-subject') : '';
      var a = X0 + (i * SPAN / N) * U, b = X0 + ((i + 1) * SPAN / N) * U;
      var ya = Y0 - (i * SPAN / N) * U, yb = Y0 - ((i + 1) * SPAN / N) * U;
      var gap = 3; // keep a hairline between segments
      if (!staticSegments[i]) segsG.appendChild(mk('path', { 'class': 'seg', 'data-subject': slug, d: 'M' + (a + gap * 0.7071) + ' ' + (ya - gap * 0.7071) + 'L' + (b - gap * 0.7071) + ' ' + (yb + gap * 0.7071) }));
      var mx = (a + b) / 2, my = (ya + yb) / 2;
      var n = staticNodes[i] || mk('circle', { 'class': 'node', 'data-subject': slug, cx: mx, cy: my, r: 5.5 });
      if (!staticNodes[i]) nodesG.appendChild(n);
      nodes.push({ el: n, at: keys[i] ? parseFloat(keys[i].getAttribute('data-at')) : (i * SPAN / N + 0.15), key: keys[i] });
    }

    function render(x) {
      var y = Math.max(0, x);
      var px = X0 + x * U, py = Y0 - y * U;
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      if (core) { core.setAttribute('cx', px); core.setAttribute('cy', py); }
      drop.setAttribute('d', 'M' + px + ' ' + py + 'V' + Y0);
      across.setAttribute('d', 'M' + px + ' ' + py + 'H' + X0);
      clip.setAttribute('width', Math.max(X0, px));
      svg.classList.toggle('is-zero', y === 0);
      nodes.forEach(function (nd) {
        var on = x >= nd.at;
        nd.el.classList.toggle('on', on);
        if (nd.key) nd.key.classList.toggle('on', on);
      });
      var fx = x.toFixed(1).replace('-0.0', '0.0');
      read.textContent = 'x = ' + fx + ' → max(0, x) = ' + y.toFixed(1) + (y === 0 ? '  (inactive)' : '');
      input.value = x;
    }

    var touched = false;
    var raf = 0;
    function takeOver() { touched = true; cancelAnimationFrame(raf); }
    function fromPointer(e) {
      var r = svg.getBoundingClientRect();
      var sx = (e.clientX - r.left) / r.width * 520;
      render(Math.min(4, Math.max(-4, Math.round((sx - X0) / U * 10) / 10)));
    }
    var dragging = false;
    svg.addEventListener('pointerdown', function (e) { takeOver(); dragging = true; svg.setPointerCapture(e.pointerId); fromPointer(e); });
    svg.addEventListener('pointermove', function (e) { if (dragging) fromPointer(e); });
    svg.addEventListener('pointerup', function () { dragging = false; });
    svg.addEventListener('pointercancel', function () { dragging = false; });
    input.addEventListener('input', function () { takeOver(); render(parseFloat(input.value)); });

    var rest = parseFloat(input.value);
    render(rest);

    // One finite tour, suspended offscreen/hidden/paused. An interaction takes
    // over immediately. Preference changes are observed during the tour too.
    var preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    var paused = false, inView = false, finished = false;
    var from = -3.4, dur = 3000, elapsed = 0, started = null;
    try { paused = localStorage.getItem('relu-motion-paused') === '1'; } catch (_) {}
    function step(t) {
      if (started === null) started = t - elapsed;
      elapsed = Math.min(dur, t - started);
      var k = elapsed / dur;
      var eased = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      render(Math.round((from + (rest - from) * eased) * 10) / 10);
      if (k < 1) raf = requestAnimationFrame(step); else { finished = true; raf = 0; }
    }
    function tour() {
      cancelAnimationFrame(raf); raf = 0; started = null;
      if (preference.matches) { if (!touched) render(rest); finished = true; return; }
      if (!touched && !finished && !paused && !document.hidden && inView) raf = requestAnimationFrame(step);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) { inView = entries[0].isIntersecting; tour(); }, { threshold: .3 }).observe(svg);
    } else { inView = true; tour(); }
    document.addEventListener('visibilitychange', tour);
    document.addEventListener('relu:motion', function (e) { paused = e.detail.paused; tour(); });
    if (preference.addEventListener) preference.addEventListener('change', tour); else preference.addListener(tour);
    window.addEventListener('pagehide', function () { cancelAnimationFrame(raf); });
    window.addEventListener('pageshow', tour);
  }

  // ---- Service worker + install prompt ---------------------------------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  var banner = document.getElementById('install-banner');
  var installBtn = document.getElementById('install-btn');
  var dismissBtn = document.getElementById('install-dismiss');
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    var dismissed = false;
    try { dismissed = !!localStorage.getItem('install-dismissed'); } catch (err) { /* private mode */ }
    if (banner && !dismissed) banner.classList.add('visible');
  });
  if (installBtn) installBtn.addEventListener('click', function () {
    banner.classList.remove('visible');
    if (deferred) { deferred.prompt(); deferred.userChoice.then(function () { deferred = null; }); }
  });
  if (dismissBtn) dismissBtn.addEventListener('click', function () {
    banner.classList.remove('visible');
    try { localStorage.setItem('install-dismissed', '1'); } catch (err) { /* private mode */ }
  });
})();
