(() => {
  'use strict';

  const canvas = document.getElementById('af-canvas');
  const ctx = canvas.getContext('2d');
  const fnSelect = document.getElementById('fn-select');
  const paramSlider = document.getElementById('param-slider');
  const paramGroup = document.getElementById('param-group');
  const paramLabel = document.getElementById('param-label');
  const paramValue = document.getElementById('param-value');
  const inputX = document.getElementById('input-x');
  const xValue = document.getElementById('x-value');
  const fnName = document.getElementById('fn-name');
  const formulaDisplay = document.getElementById('formula-display');
  const fnHint = document.getElementById('fn-hint');
  const mFx = document.getElementById('m-fx');
  const mFpx = document.getElementById('m-fpx');
  const mRange = document.getElementById('m-range');
  const mMono = document.getElementById('m-mono');

  const XMIN = -6, XMAX = 6;
  const W = 800, H = 420;
  const PAD = { l: 46, r: 16, t: 16, b: 30 };

  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return sign * y;
  }

  const sig = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));

  const FNS = {
    relu: {
      name: 'ReLU',
      param: null,
      f: (x) => Math.max(0, x),
      fp: (x) => (x > 0 ? 1 : 0),
      formula: 'f(x) = max(0, x)',
      hint: 'Zero for negative inputs, identity for positive ones. The derivative is 0 or 1 — the simplest gate that prevents gradients from vanishing.',
    },
    leaky: {
      name: 'Leaky ReLU',
      param: { key: 'α', min: 0.01, max: 0.5, step: 0.01, def: 0.1 },
      f: (x, a) => (x >= 0 ? x : a * x),
      fp: (x, a) => (x > 0 ? 1 : a),
      formula: 'f(x) = x if x ≥ 0, else α·x',
      hint: 'A small slope α for negative inputs keeps a little gradient flowing even below zero, unlike plain ReLU.',
    },
    sigmoid: {
      name: 'Sigmoid',
      param: null,
      f: (x) => sig(x),
      fp: (x) => { const s = sig(x); return s * (1 - s); },
      formula: 'f(x) = 1 / (1 + e⁻ˣ)',
      hint: 'Squeezes any input into (0, 1) — great for probabilities. Its derivative peaks at 0.25 and flattens at the extremes (vanishing gradient).',
    },
    tanh: {
      name: 'Tanh',
      param: null,
      f: (x) => Math.tanh(x),
      fp: (x) => { const t = Math.tanh(x); return 1 - t * t; },
      formula: 'f(x) = tanh(x)',
      hint: 'Like a centered sigmoid: outputs in (−1, 1), zero-centered, derivative peaks at 1.',
    },
    gelu: {
      name: 'GELU',
      param: null,
      f: (x) => 0.5 * x * (1 + erf(x / Math.SQRT2)),
      fp: (x) => {
        const phi = 0.5 * (1 + erf(x / Math.SQRT2));
        const pdf = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
        return phi + x * pdf;
      },
      formula: 'f(x) = x·Φ(x)  (Gaussian error linear unit)',
      hint: 'Used in GPT-style transformers. Smooth, and unlike ReLU it keeps a tiny gradient for very negative inputs.',
    },
    silu: {
      name: 'SiLU / Swish',
      param: null,
      f: (x) => x * sig(x),
      fp: (x) => { const s = sig(x); return s + x * s * (1 - s); },
      formula: 'f(x) = x·σ(x)',
      hint: 'Self-gated: the input modulates its own gate. Bounded below, unbounded above, smooth everywhere.',
    },
    elu: {
      name: 'ELU',
      param: { key: 'α', min: 0.1, max: 2, step: 0.05, def: 1 },
      f: (x, a) => (x >= 0 ? x : a * (Math.exp(x) - 1)),
      fp: (x, a) => (x > 0 ? 1 : a * Math.exp(x)),
      formula: 'f(x) = x if x ≥ 0, else α·(eˣ − 1)',
      hint: 'Exponential Leaky ReLU: negative values saturate smoothly toward −α instead of growing linearly.',
    },
    softplus: {
      name: 'Softplus',
      param: { key: 'β', min: 0.2, max: 3, step: 0.1, def: 1 },
      f: (x, b) => {
        const z = b * x;
        return z > 0 ? x + Math.log1p(Math.exp(-z)) / b : Math.log1p(Math.exp(z)) / b;
      },
      fp: (x, b) => sig(b * x),
      formula: 'f(x) = (1/β)·ln(1 + e^(β·x))',
      hint: 'A smooth, always-positive approximation of ReLU. As β grows it approaches ReLU more closely.',
    },
  };

  function paramOf() {
    const def = FNS[fnSelect.value].param;
    return def ? parseFloat(paramSlider.value) : 1;
  }

  function xToPx(x) {
    return PAD.l + ((x - XMIN) / (XMAX - XMIN)) * (W - PAD.l - PAD.r);
  }
  function yToPx(y, ymax) {
    return PAD.t + ((ymax - y) / (2 * ymax)) * (H - PAD.t - PAD.b);
  }

  function computeYmax() {
    const fn = FNS[fnSelect.value];
    const p = paramOf();
    let mx = 0;
    for (let i = 0; i <= 300; i++) {
      const x = XMIN + (i / 300) * (XMAX - XMIN);
      mx = Math.max(mx, Math.abs(fn.f(x, p)), Math.abs(fn.fp(x, p)));
    }
    return Math.max(1.2, mx * 1.15);
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const fn = FNS[fnSelect.value];
    const p = paramOf();
    const ymax = computeYmax();

    // grid
    ctx.strokeStyle = 'rgba(148,163,184,0.10)';
    ctx.lineWidth = 1;
    for (let gx = Math.ceil(XMIN); gx <= XMAX; gx++) {
      ctx.beginPath(); ctx.moveTo(xToPx(gx), PAD.t); ctx.lineTo(xToPx(gx), H - PAD.b); ctx.stroke();
    }
    const yStep = ymax > 4 ? 1 : (ymax > 2 ? 0.5 : 0.25);
    for (let gy = -Math.ceil(ymax); gy <= Math.ceil(ymax); gy++) {
      const y = gy * yStep;
      ctx.beginPath(); ctx.moveTo(PAD.l, yToPx(y, ymax)); ctx.lineTo(W - PAD.r, yToPx(y, ymax)); ctx.stroke();
    }

    // axes
    ctx.strokeStyle = 'rgba(148,163,184,0.45)';
    ctx.beginPath(); ctx.moveTo(PAD.l, yToPx(0, ymax)); ctx.lineTo(W - PAD.r, yToPx(0, ymax)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xToPx(0), PAD.t); ctx.lineTo(xToPx(0), H - PAD.b); ctx.stroke();

    // tick labels
    ctx.fillStyle = 'rgba(148,163,184,0.7)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    for (let gx = Math.ceil(XMIN); gx <= XMAX; gx++) {
      ctx.fillText(String(gx), xToPx(gx), H - PAD.b + 14);
    }
    ctx.textAlign = 'right';
    for (let gy = -Math.ceil(ymax); gy <= Math.ceil(ymax); gy++) {
      const y = gy * yStep;
      ctx.fillText(String(y), PAD.l - 6, yToPx(y, ymax) + 3);
    }

    // sample curves
    const N = 300;
    const plot = (get) => {
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = XMIN + (i / N) * (XMAX - XMIN);
        const px = xToPx(x), py = yToPx(get(x, p), ymax);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#60a5fa';
    plot((x) => fn.fp(x, p));
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#14b8a6';
    plot((x) => fn.f(x, p));

    // marker at x0
    const x0 = parseFloat(inputX.value);
    const f0 = fn.f(x0, p), fp0 = fn.fp(x0, p);
    const mx = xToPx(x0), my = yToPx(f0, ymax);

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(248,250,252,0.35)';
    ctx.beginPath(); ctx.moveTo(mx, PAD.t); ctx.lineTo(mx, H - PAD.b); ctx.stroke();
    ctx.setLineDash([]);

    // tangent line with slope fp0, clipped to plot
    const tExt = 1.6;
    const xa = x0 - tExt, xb = x0 + tExt;
    const ya = f0 - fp0 * tExt, yb = f0 + fp0 * tExt;
    ctx.strokeStyle = 'rgba(248,250,252,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xToPx(xa), yToPx(ya, ymax));
    ctx.lineTo(xToPx(xb), yToPx(yb, ymax));
    ctx.stroke();

    // value dots
    ctx.fillStyle = '#14b8a6';
    ctx.beginPath(); ctx.arc(mx, my, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath(); ctx.arc(mx, yToPx(fp0, ymax), 4, 0, Math.PI * 2); ctx.fill();
  }

  function update() {
    const key = fnSelect.value;
    const fn = FNS[key];
    const p = paramOf();

    fnName.textContent = fn.name;
    formulaDisplay.textContent = fn.formula;
    fnHint.textContent = fn.hint;

    const def = fn.param;
    if (def) {
      paramGroup.style.display = '';
      paramLabel.textContent = def.key;
      paramSlider.min = def.min; paramSlider.max = def.max; paramSlider.step = def.step;
      if (!paramSlider.value || paramSlider.value < def.min || paramSlider.value > def.max) {
        paramSlider.value = def.def;
      }
      paramValue.textContent = parseFloat(paramSlider.value).toFixed(def.key === 'β' ? 1 : 2);
    } else {
      paramGroup.style.display = 'none';
    }

    const x0 = parseFloat(inputX.value);
    xValue.textContent = x0.toFixed(2);
    mFx.textContent = fn.f(x0, p).toFixed(4);
    mFpx.textContent = fn.fp(x0, p).toFixed(4);

    // range + monotonicity over the domain
    let lo = Infinity, hi = -Infinity, inc = 0, dec = 0;
    const N = 400;
    let prevFp = null;
    for (let i = 0; i <= N; i++) {
      const x = XMIN + (i / N) * (XMAX - XMIN);
      const v = fn.f(x, p);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      const d = fn.fp(x, p);
      if (prevFp !== null && d > 1e-9) inc++;
      if (prevFp !== null && d < -1e-9) dec++;
      prevFp = d;
    }
    mRange.textContent = lo.toFixed(1) + ' … ' + hi.toFixed(1);
    mMono.textContent = (dec === 0 && inc > 0) ? 'increasing' : (inc === 0 && dec > 0) ? 'decreasing' : (inc === 0 && dec === 0) ? 'constant' : 'non-monotonic';

    draw();
  }

  fnSelect.addEventListener('change', update);
  paramSlider.addEventListener('input', () => { paramValue.textContent = parseFloat(paramSlider.value).toFixed(FNS[fnSelect.value].param.key === 'β' ? 1 : 2); update(); });
  inputX.addEventListener('input', update);
  window.addEventListener('resize', draw);

  update();
})();
