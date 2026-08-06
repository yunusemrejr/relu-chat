/* ============================================================
   ReLU.chat — hero neural-graph backdrop
   Canvas UI-style effect (vanilla adaptation, no build step).

   Why: the hero is the brand moment of an on-device-AI product.
   A slow, low-opacity node graph evokes neural inference without
   shouting. It is decorative only:
     - plain HTML underneath stays intact and interactive
     - no canvas support / no JS / prefers-reduced-motion -> static frame
     - pauses when the tab is hidden or the hero is offscreen
     - never intercepts pointer events, aria-hidden
   The html-in-canvas origin-trial variant of this effect can replace
   this file when a trial token is available for this domain; until
   then this 2D canvas keeps the same visual intent everywhere.
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('hero-graph');
  if (!canvas) return;
  var ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;

  var hero = document.getElementById('hero');
  if (!hero) return;

  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ACCENT = [20, 184, 166]; // var(--accent)
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var nodes = [];
  var edges = [];
  var raf = 0;
  var visible = false;
  var tabActive = !document.hidden;
  var last = 0;

  function dims() {
    var r = hero.getBoundingClientRect();
    return { w: Math.max(320, Math.round(r.width)), h: Math.max(240, Math.round(r.height)) };
  }

  function resize() {
    var d = dims();
    canvas.width = Math.round(d.w * dpr);
    canvas.height = Math.round(d.h * dpr);
    canvas.style.width = d.w + 'px';
    canvas.style.height = d.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildGraph(d);
  }

  function buildGraph(d) {
    var count = d.w < 640 ? 24 : 40;
    nodes = [];
    for (var i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * d.w,
        y: Math.random() * d.h,
        vx: (Math.random() - 0.5) * 0.14,
        vy: (Math.random() - 0.5) * 0.14,
        r: 1 + Math.random() * 1.5
      });
    }
    edges = [];
    for (var a = 0; a < nodes.length; a++) {
      for (var b = a + 1; b < nodes.length; b++) {
        var dx = nodes[a].x - nodes[b].x;
        var dy = nodes[a].y - nodes[b].y;
        var d2 = dx * dx + dy * dy;
        if (d2 < 130 * 130) edges.push({ a: a, b: b });
      }
    }
  }

  function draw(now) {
    if (!visible || !tabActive) return;
    raf = requestAnimationFrame(draw);
    var d = dims();
    ctx.clearRect(0, 0, d.w, d.h);

    var i, k;
    for (i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.x += n.vx; n.y += n.vy;
      if (n.x < 0) { n.x = 0; n.vx *= -1; }
      if (n.x > d.w) { n.x = d.w; n.vx *= -1; }
      if (n.y < 0) { n.y = 0; n.vy *= -1; }
      if (n.y > d.h) { n.y = d.h; n.vy *= -1; }
    }

    for (i = 0; i < edges.length; i++) {
      var e = edges[i];
      var na = nodes[e.a], nb = nodes[e.b];
      var dx = na.x - nb.x, dy = na.y - nb.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var alpha = 0.16 * Math.max(0, 1 - dist / 170);
      ctx.strokeStyle = 'rgba(' + ACCENT[0] + ',' + ACCENT[1] + ',' + ACCENT[2] + ',' + alpha.toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.stroke();
    }

    for (k = 0; k < nodes.length; k++) {
      var nn = nodes[k];
      ctx.fillStyle = 'rgba(' + ACCENT[0] + ',' + ACCENT[1] + ',' + ACCENT[2] + ',0.30)';
      ctx.beginPath();
      ctx.arc(nn.x, nn.y, nn.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // slow signal pulses along random edges (inference metaphor).
    // Guard against an empty edge list (extreme hero aspect ratios) -
    // modulo by 0 would make the pulse index NaN and crash the draw loop.
    var t = now / 1000;
    if (!edges.length) return;
    for (var p = 0; p < 2; p++) {
      var ph = (t * 0.10 + p * 0.5) % 1;
      var eIdx = Math.floor((t * 0.7 + p * 17) % edges.length);
      var ed = edges[eIdx];
      var s = nodes[ed.a], tg = nodes[ed.b];
      var px = s.x + (tg.x - s.x) * ph;
      var py = s.y + (tg.y - s.y) * ph;
      var trail = 0.16;
      ctx.strokeStyle = 'rgba(' + ACCENT[0] + ',' + ACCENT[1] + ',' + ACCENT[2] + ',0.30)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(s.x + (tg.x - s.x) * Math.max(0, ph - trail), s.y + (tg.y - s.y) * Math.max(0, ph - trail));
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = 'rgba(' + ACCENT[0] + ',' + ACCENT[1] + ',' + ACCENT[2] + ',0.5)';
      ctx.beginPath();
      ctx.arc(px, py, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function start() {
    if (raf) return;
    raf = requestAnimationFrame(draw);
  }

  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  function onVisibility() {
    tabActive = !document.hidden;
    if (tabActive && visible && !REDUCE) start();
    else stop();
  }

  resize();
  if (REDUCE) {
    // static single frame, no animation loop
    visible = true;
    tabActive = true;
    draw(0);
    return;
  }

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
      if (visible && tabActive) start(); else stop();
    }, { rootMargin: '200px' });
    io.observe(hero);
  } else {
    visible = true;
    start();
  }
  document.addEventListener('visibilitychange', onVisibility);
  if ('ResizeObserver' in window) {
    new ResizeObserver(function () { resize(); }).observe(hero);
  }
  window.addEventListener('resize', resize);
})();
