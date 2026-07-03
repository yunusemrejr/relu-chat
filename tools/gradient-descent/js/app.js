(() => {
  'use strict';

  const canvas = document.getElementById('gd-canvas');
  const ctx = canvas.getContext('2d');

  const lrSlider = document.getElementById('lr-slider');
  const lrVal = document.getElementById('lr-val');
  const funcSelect = document.getElementById('func-select');
  const startBtn = document.getElementById('start-btn');
  const resetBtn = document.getElementById('reset-btn');
  const stepBtn = document.getElementById('step-btn');
  const currX = document.getElementById('curr-x');
  const currLoss = document.getElementById('curr-loss');
  const currGrad = document.getElementById('curr-grad');
  const stepCount = document.getElementById('step-count');
  const gdFormula = document.getElementById('gd-formula');

  const functions = {
    quadratic: {
      f: (x) => x * x + 0.08 * Math.sin(x * 3),
      df: (x) => 2 * x + 0.24 * Math.cos(x * 3),
      label: 'f(x) = x² + ε'
    },
    quartic: {
      f: (x) => Math.pow(x, 4) - 3 * x * x + 1,
      df: (x) => 4 * Math.pow(x, 3) - 6 * x,
      label: 'f(x) = x⁴ − 3x² + 1'
    },
    sin: {
      f: (x) => Math.sin(x) * x / 3 + 0.5,
      df: (x) => (Math.cos(x) * x + Math.sin(x)) / 3,
      label: 'f(x) = sin(x) · x/3'
    },
    bumpy: {
      f: (x) => Math.sin(x * 2) * 0.8 + Math.sin(x * 5) * 0.3 + 0.2 * x,
      df: (x) => Math.cos(x * 2) * 1.6 + Math.cos(x * 5) * 1.5 + 0.2,
      label: 'f(x) = Σ sin(n·x)'
    }
  };

  let currentFunc = 'quadratic';
  let pos = { x: 2, y: 0 };
  let steps = 0;
  let history = [];
  let running = false;
  let animId = null;

  function getFn(name) {
    return functions[name] || functions.quadratic;
  }

  function computeDerivative(x, fn) {
    const h = 1e-6;
    return (fn.f(x + h) - fn.f(x - h)) / (2 * h);
  }

  function step() {
    const fn = getFn(currentFunc);
    const lr = parseFloat(lrSlider.value);
    const grad = fn.df(pos.x);
    pos.x = pos.x - lr * grad;
    pos.y = fn.f(pos.x);
    steps++;
    history.push({ x: pos.x, y: pos.y, step: steps });
    updateMetrics(fn);
    draw();
  }

  function run() {
    if (running) return;
    running = true;
    startBtn.textContent = '⏹ Stop';

    function loop() {
      if (!running) return;
      const fn = getFn(currentFunc);
      const lr = parseFloat(lrSlider.value);
      const grad = fn.df(pos.x);
      const stepSize = Math.abs(lr * grad);

      if (stepSize < 1e-8 || steps > 500) {
        running = false;
        startBtn.textContent = '▶ Run';
        return;
      }

      pos.x = pos.x - lr * grad;
      pos.y = fn.f(pos.x);
      steps++;
      history.push({ x: pos.x, y: pos.y, step: steps });
      updateMetrics(fn);
      draw();

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    startBtn.textContent = '▶ Run';
    if (animId) cancelAnimationFrame(animId);
    animId = null;
  }

  function resetPosition() {
    const fn = getFn(currentFunc);
    pos = { x: 2, y: fn.f(2) };
    steps = 0;
    history = [{ x: pos.x, y: pos.y, step: 0 }];
    updateMetrics(fn);
    draw();
  }

  function resetAll() {
    stop();
    resetPosition();
  }

  function updateMetrics(fn) {
    const grad = fn.df(pos.x);
    currX.textContent = pos.x.toFixed(4);
    currLoss.textContent = pos.y.toFixed(4);
    currGrad.textContent = grad.toFixed(4);
    stepCount.textContent = steps;
  }

  function setFunction(name) {
    stop();
    currentFunc = name;
    const fn = getFn(name);
    gdFormula.textContent = fn.label;
    resetPosition();
  }

  function resizeCanvas() {
    const wrap = document.getElementById('gd-canvas-wrap');
    const w = wrap.clientWidth;
    const ratio = 400 / 800;
    canvas.width = w * (devicePixelRatio || 1);
    canvas.height = w * ratio * (devicePixelRatio || 1);
    canvas.style.width = w + 'px';
    canvas.style.height = (w * ratio) + 'px';
    ctx.scale(devicePixelRatio || 1, devicePixelRatio || 1);
    draw();
  }

  function draw() {
    const W = canvas.width / (devicePixelRatio || 1);
    const H = canvas.height / (devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);

    const pad = { top: 20, bottom: 30, left: 40, right: 20 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top - pad.bottom;

    const xMin = -3, xMax = 3;
    const fn = getFn(currentFunc);

    // Find y range for the current function
    let yMin = Infinity, yMax = -Infinity;
    const fnSamples = [];
    for (let px = 0; px <= plotW; px++) {
      const t = px / plotW;
      const x = xMin + t * (xMax - xMin);
      const y = fn.f(x);
      fnSamples.push({ x, y });
      if (Number.isFinite(y)) {
        yMin = Math.min(yMin, y);
        yMax = Math.max(yMax, y);
      }
    }
    const yRange = yMax - yMin || 1;
    const yPad = yRange * 0.15;
    yMin -= yPad;
    yMax += yPad;

    function toScreen(x, y) {
      const sx = pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
      const sy = pad.top + ((yMax - y) / (yMax - yMin)) * plotH;
      return { x: sx, y: sy };
    }

    function toPlot(sx, sy) {
      const x = xMin + ((sx - pad.left) / plotW) * (xMax - xMin);
      const y = yMax - ((sy - pad.top) / plotH) * (yMax - yMin);
      return { x, y };
    }

    // Draw grid
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(xMin); gx <= xMax; gx++) {
      const p = toScreen(gx, 0);
      ctx.beginPath();
      ctx.moveTo(p.x, pad.top);
      ctx.lineTo(p.x, H - pad.bottom);
      ctx.stroke();
    }
    for (let gy = Math.ceil(yMin); gy <= yMax; gy++) {
      const p = toScreen(0, gy);
      if (p.y >= pad.top && p.y <= H - pad.bottom) {
        ctx.beginPath();
        ctx.moveTo(pad.left, p.y);
        ctx.lineTo(W - pad.right, p.y);
        ctx.stroke();
      }
    }

    // Draw function curve
    ctx.beginPath();
    ctx.strokeStyle = '#14b8a6';
    ctx.lineWidth = 2;
    for (let i = 0; i < fnSamples.length; i++) {
      const p = toScreen(fnSamples[i].x, fnSamples[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Draw fill under curve
    ctx.beginPath();
    const first = toScreen(fnSamples[0].x, yMin);
    ctx.moveTo(first.x, first.y);
    for (let i = 0; i < fnSamples.length; i++) {
      const p = toScreen(fnSamples[i].x, fnSamples[i].y);
      ctx.lineTo(p.x, p.y);
    }
    const last = toScreen(fnSamples[fnSamples.length - 1].x, yMin);
    ctx.lineTo(last.x, last.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(20, 184, 166, 0.05)';
    ctx.fill();

    // Draw zero line
    const zeroLine = toScreen(0, 0);
    if (zeroLine.y >= pad.top && zeroLine.y <= H - pad.bottom) {
      ctx.beginPath();
      ctx.moveTo(pad.left, zeroLine.y);
      ctx.lineTo(W - pad.right, zeroLine.y);
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw optimization path
    if (history.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const p = toScreen(history[i].x, history[i].y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = 'rgba(20, 184, 166, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw visited points
    for (let i = 0; i < history.length; i++) {
      const p = toScreen(history[i].x, history[i].y);
      const alpha = 0.2 + 0.8 * (i / Math.max(1, history.length - 1));
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(20, 184, 166, ${alpha})`;
      ctx.fill();
    }

    // Draw current position
    const curP = toScreen(pos.x, pos.y);
    ctx.beginPath();
    ctx.arc(curP.x, curP.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#14b8a6';
    ctx.fill();
    ctx.strokeStyle = '#0d1117';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Gradient arrow
    const fnDelta = fn.df(pos.x);
    const arrowLen = Math.min(30, Math.abs(fnDelta) * 8);
    const arrowDir = -Math.sign(fnDelta);
    const arrowEnd = toScreen(pos.x + arrowDir * 0.15, pos.y);

    if (arrowLen > 5) {
      ctx.beginPath();
      ctx.moveTo(curP.x, curP.y);
      ctx.lineTo(arrowEnd.x, arrowEnd.y);
      ctx.strokeStyle = 'rgba(196, 65, 48, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Arrowhead
      const angle = Math.atan2(arrowEnd.y - curP.y, arrowEnd.x - curP.x);
      ctx.beginPath();
      ctx.moveTo(arrowEnd.x, arrowEnd.y);
      ctx.lineTo(arrowEnd.x - 8 * Math.cos(angle - 0.4), arrowEnd.y - 8 * Math.sin(angle - 0.4));
      ctx.moveTo(arrowEnd.x, arrowEnd.y);
      ctx.lineTo(arrowEnd.x - 8 * Math.cos(angle + 0.4), arrowEnd.y - 8 * Math.sin(angle + 0.4));
      ctx.strokeStyle = 'rgba(196, 65, 48, 0.6)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('x', W - pad.right + 12, H - pad.bottom + 5);
    ctx.fillText('f(x)', pad.left - 5, pad.top - 5);
    ctx.textAlign = 'right';
    for (let gx = Math.ceil(xMin); gx <= xMax; gx++) {
      const p = toScreen(gx, 0);
      ctx.fillText(gx, p.x, H - 6);
    }
  }

  // Event handlers
  lrSlider.addEventListener('input', () => {
    lrVal.textContent = lrSlider.value;
  });

  funcSelect.addEventListener('change', () => {
    setFunction(funcSelect.value);
  });

  startBtn.addEventListener('click', () => {
    if (running) { stop(); }
    else { run(); }
  });

  resetBtn.addEventListener('click', resetAll);
  stepBtn.addEventListener('click', step);

  // Click on canvas to set position
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const scaleX = canvas.width / (devicePixelRatio || 1) / rect.width;

    const W = canvas.width / (devicePixelRatio || 1);
    const pad = { top: 20, bottom: 30, left: 40, right: 20 };
    const plotW = W - pad.left - pad.right;
    const xMin = -3, xMax = 3;
    const plotX = sx * scaleX;
    const x = xMin + ((plotX - pad.left) / plotW) * (xMax - xMin);

    if (x >= xMin && x <= xMax) {
      stop();
      const fn = getFn(currentFunc);
      pos = { x, y: fn.f(x) };
      steps = 0;
      history = [{ x: pos.x, y: pos.y, step: 0 }];
      updateMetrics(fn);
      draw();
    }
  });

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches[0];
    const sx = touch.clientX - rect.left;
    const scaleX = canvas.width / (devicePixelRatio || 1) / rect.width;

    const W = canvas.width / (devicePixelRatio || 1);
    const pad = { top: 20, bottom: 30, left: 40, right: 20 };
    const plotW = W - pad.left - pad.right;
    const xMin = -3, xMax = 3;
    const plotX = sx * scaleX;
    const x = xMin + ((plotX - pad.left) / plotW) * (xMax - xMin);

    if (x >= xMin && x <= xMax) {
      stop();
      const fn = getFn(currentFunc);
      pos = { x, y: fn.f(x) };
      steps = 0;
      history = [{ x: pos.x, y: pos.y, step: 0 }];
      updateMetrics(fn);
      draw();
    }
  }, { passive: false });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 100);
  });

  // Init
  setFunction('quadratic');
  setTimeout(resizeCanvas, 50);

  // Exports for testing
  window.__gd = { functions, step, resetAll, setFunction, computeDerivative };
})();
