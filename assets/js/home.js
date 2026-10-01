/* Home page: the live ReLU plot and the PWA install prompt. Progressive: the
   page works with this script absent (the plot simply stays at its default). */
(function () {
  'use strict';

  // ---- ReLU plot ------------------------------------------------------
  var svg = document.getElementById('relu-plot');
  var input = document.getElementById('plot-x');
  if (svg && input) {
    var dot = document.getElementById('plot-dot');
    var drop = document.getElementById('plot-drop');
    var across = document.getElementById('plot-across');
    var read = document.getElementById('plot-read');
    var X0 = 240, Y0 = 280, U = 50; // origin in SVG units, 50 units per 1.0

    function render(x) {
      var y = Math.max(0, x);
      var px = X0 + x * U, py = Y0 - y * U;
      dot.setAttribute('cx', px); dot.setAttribute('cy', py);
      drop.setAttribute('d', 'M' + px + ' ' + py + 'V' + Y0);
      across.setAttribute('d', 'M' + px + ' ' + py + 'H' + X0);
      svg.classList.toggle('is-zero', y === 0);
      var fx = x.toFixed(1).replace('-0.0', '0.0');
      read.textContent = 'x = ' + fx + ' → max(0, x) = ' + y.toFixed(1) + (y === 0 ? '  (inactive)' : '');
      input.value = x;
    }

    var touched = false;
    function fromPointer(e) {
      var r = svg.getBoundingClientRect();
      var sx = (e.clientX - r.left) / r.width * 480;
      render(Math.min(4, Math.max(-4, Math.round((sx - X0) / U * 10) / 10)));
    }
    var dragging = false;
    svg.addEventListener('pointerdown', function (e) { touched = true; dragging = true; svg.setPointerCapture(e.pointerId); fromPointer(e); });
    svg.addEventListener('pointermove', function (e) { if (dragging) fromPointer(e); });
    svg.addEventListener('pointerup', function () { dragging = false; });
    svg.addEventListener('pointercancel', function () { dragging = false; });
    input.addEventListener('input', function () { touched = true; render(parseFloat(input.value)); });

    render(parseFloat(input.value));

    // One gentle sweep on load so the hinge reads at a glance; never under reduced motion.
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!calm) {
      var from = -3.2, to = parseFloat(input.value), dur = 2200, t0 = null;
      render(from);
      setTimeout(function () {
        requestAnimationFrame(function step(t) {
          if (touched) return;
          if (t0 === null) t0 = t;
          var k = Math.min(1, (t - t0) / dur);
          var e = 1 - Math.pow(1 - k, 3);
          render(Math.round((from + (to - from) * e) * 10) / 10);
          if (k < 1) requestAnimationFrame(step);
        });
      }, 500);
    }
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
