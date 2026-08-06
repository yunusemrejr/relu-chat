(() => {
  'use strict';

  const canvas = document.getElementById('km-canvas');
  const ctx = canvas.getContext('2d');
  const runBtn = document.getElementById('km-run');
  const stepBtn = document.getElementById('km-step');
  const resetBtn = document.getElementById('km-reset');
  const dataBtn = document.getElementById('km-data');
  const clearBtn = document.getElementById('km-clear');
  const kSelect = document.getElementById('km-k');
  const status = document.getElementById('km-status');
  const mN = document.getElementById('km-n');
  const mSSE = document.getElementById('km-sse');
  const mIter = document.getElementById('km-iter');
  const mConv = document.getElementById('km-conv');
  const legend = document.getElementById('km-legend');

  const W = 800, H = 500, PAD = 34;
  const D = 10;                       // data coords: [0, 10] x [0, 10]
  const COLORS = ['#14b8a6', '#60a5fa', '#fbbf24', '#a78bfa', '#f472b6', '#4ade80'];
  const REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let points = [];
  let centroids = [];                 // [{x, y}]
  let assignments = [];               // per point -> cluster index or -1
  let sse = 0, iterations = 0, converged = false;
  let running = false;
  let animId = 0;

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function dataToPx(x, y) {
    return [PAD + (x / D) * (W - 2 * PAD), PAD + (1 - y / D) * (H - 2 * PAD)];
  }
  function pxToData(px, py) {
    return [(px - PAD) / (W - 2 * PAD) * D, D - (py - PAD) / (H - 2 * PAD) * D];
  }

  function generateData() {
    const rand = mulberry32((Date.now() & 0xffff) ^ 0x9e3779b9);
    const gauss = () => {
      const u = Math.max(rand(), 1e-9), v = Math.max(rand(), 1e-9);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const blobs = 5;
    const centers = [];
    for (let i = 0; i < blobs; i++) {
      centers.push({ x: 2 + rand() * 6, y: 2 + rand() * 6 });
    }
    points = [];
    for (let i = 0; i < 60; i++) {
      const c = centers[i % blobs];
      points.push({
        x: Math.min(D - 0.3, Math.max(0.3, c.x + gauss() * 0.5)),
        y: Math.min(D - 0.3, Math.max(0.3, c.y + gauss() * 0.5)),
      });
    }
    reset();
  }

  function clearPoints() {
    points = [];
    reset();
  }

  function reset() {
    centroids = [];
    assignments = new Array(points.length).fill(-1);
    sse = 0; iterations = 0; converged = false;
    update();
  }

  function kmeansInit() {
    const k = parseInt(kSelect.value, 10);
    if (points.length < k) return;
    const rand = mulberry32((Date.now() & 0xffff) ^ 0x2545f491);
    const picked = [];
    const first = Math.floor(rand() * points.length);
    picked.push(first);
    while (picked.length < k) {
      const dists = points.map((p, i) => {
        if (picked.includes(i)) return 0;
        let d2 = Infinity;
        for (const j of picked) {
          const dx = p.x - points[j].x, dy = p.y - points[j].y;
          d2 = Math.min(d2, dx * dx + dy * dy);
        }
        return d2;
      });
      const total = dists.reduce((a, b) => a + b, 0);
      let r = rand() * total;
      let idx = dists.length - 1;
      for (let i = 0; i < dists.length; i++) {
        r -= dists[i];
        if (r <= 0) { idx = i; break; }
      }
      picked.push(idx);
    }
    centroids = picked.map(i => ({ x: points[i].x, y: points[i].y }));
    assignments = new Array(points.length).fill(-1);
    sse = 0; iterations = 0; converged = false;
  }

  function step() {
    const k = centroids.length;
    if (!k || points.length < k) return;
    // assign
    const newAssign = points.map(p => {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = p.x - centroids[c].x, dy = p.y - centroids[c].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = c; }
      }
      return best;
    });
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      if (newAssign[i] !== assignments[i]) { changed = true; break; }
    }
    // update centroids
    const sums = Array.from({ length: k }, () => ({ x: 0, y: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const c = newAssign[i];
      sums[c].x += points[i].x; sums[c].y += points[i].y; sums[c].n++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c].n > 0) {
        centroids[c].x = sums[c].x / sums[c].n;
        centroids[c].y = sums[c].y / sums[c].n;
      }
    }
    assignments = newAssign;
    iterations++;
    // sse
    sse = 0;
    for (let i = 0; i < points.length; i++) {
      const c = assignments[i];
      const dx = points[i].x - centroids[c].x, dy = points[i].y - centroids[c].y;
      sse += dx * dx + dy * dy;
    }
    if (!changed) converged = true;
    update();
    return !converged;
  }

  function runToConvergence() {
    if (running) return;
    const k = parseInt(kSelect.value, 10);
    if (points.length < k) return;
    if (!centroids.length) kmeansInit();
    if (REDUCE) {
      let guard = 0;
      while (!converged && guard < 100) { step(); guard++; }
      return;
    }
    running = true;
    stepBtn.disabled = true;
    runBtn.disabled = true;
    const tick = () => {
      const done = step();
      if (!done || iterations >= 100) {
        running = false;
        stepBtn.disabled = false;
        runBtn.disabled = false;
        return;
      }
      animId = setTimeout(tick, 320);
    };
    animId = setTimeout(tick, 320);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // grid
    ctx.strokeStyle = 'rgba(148,163,184,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const [px] = dataToPx(i * 2, 0);
      ctx.beginPath(); ctx.moveTo(px, PAD); ctx.lineTo(px, H - PAD); ctx.stroke();
      const [, py] = dataToPx(0, i * 2);
      ctx.beginPath(); ctx.moveTo(PAD, py); ctx.lineTo(W - PAD, py); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.strokeRect(PAD, PAD, W - 2 * PAD, H - 2 * PAD);

    // points
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const [px, py] = dataToPx(p.x, p.y);
      const c = assignments[i] >= 0 ? COLORS[assignments[i] % COLORS.length] : '#8b95a3';
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    }

    // centroids
    for (let c = 0; c < centroids.length; c++) {
      const [px, py] = dataToPx(centroids[c].x, centroids[c].y);
      ctx.fillStyle = COLORS[c % COLORS.length];
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f9fafb';
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  function update() {
    mN.textContent = String(points.length);
    mSSE.textContent = centroids.length && assignments.some(a => a >= 0) ? sse.toFixed(2) : '—';
    mIter.textContent = String(iterations);
    mConv.textContent = centroids.length ? (converged ? 'yes' : 'no') : '—';
    status.textContent = !points.length ? 'no data' : !centroids.length ? 'ready — press Run or Step' : converged ? 'converged' : (running ? 'running…' : 'clustering');
    draw();
  }

  // legend
  for (let c = 0; c < COLORS.length; c++) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.background = COLORS[c];
    item.appendChild(dot);
    item.appendChild(document.createTextNode('cluster ' + (c + 1)));
    legend.appendChild(item);
  }
  const cItem = document.createElement('span');
  cItem.className = 'legend-item';
  const cDot = document.createElement('span');
  cDot.className = 'legend-dot';
  cDot.style.background = '#f9fafb';
  cDot.style.border = '2px solid #14b8a6';
  cItem.appendChild(cDot);
  cItem.appendChild(document.createTextNode('centroid'));
  legend.appendChild(cItem);

  // pointer: click/drag to add points
  function addAt(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (W / rect.width);
    const sy = (e.clientY - rect.top) * (H / rect.height);
    if (sx < PAD || sx > W - PAD || sy < PAD || sy > H - PAD) return;
    const [dx, dy] = pxToData(sx, sy);
    points.push({ x: dx, y: dy });
    assignments.push(-1);
    if (centroids.length) { centroids = []; assignments = new Array(points.length).fill(-1); iterations = 0; converged = false; }
    update();
  }
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; canvas.setPointerCapture(e.pointerId); addAt(e); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) addAt(e); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });

  runBtn.addEventListener('click', () => {
    if (!centroids.length && points.length >= parseInt(kSelect.value, 10)) kmeansInit();
    runToConvergence();
  });
  stepBtn.addEventListener('click', () => {
    if (!centroids.length && points.length >= parseInt(kSelect.value, 10)) kmeansInit();
    step();
  });
  resetBtn.addEventListener('click', reset);
  dataBtn.addEventListener('click', generateData);
  clearBtn.addEventListener('click', clearPoints);
  kSelect.addEventListener('change', reset);

  generateData();
})();
