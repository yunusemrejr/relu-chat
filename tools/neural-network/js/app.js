(() => {
  'use strict';

  const canvas = document.getElementById('nn-canvas');
  const ctx = canvas.getContext('2d');

  const activationSelect = document.getElementById('activation-select');
  const hiddenSizeSelect = document.getElementById('hidden-size-select');
  const inputX = document.getElementById('input-x');
  const inputY = document.getElementById('input-y');
  const randomizeBtn = document.getElementById('randomize-btn');

  const weightControls = document.getElementById('weight-controls');
  const h1Val = document.getElementById('h1-val');
  const h2Val = document.getElementById('h2-val');
  const h3Val = document.getElementById('h3-val');
  const outputVal = document.getElementById('output-val');
  const formulaDisplay = document.getElementById('formula-display');
  const infoBox = document.getElementById('info-box');

  let hiddenSize = 3;
  let weights = [];
  let biases = [];

  function activation(x, name) {
    switch (name) {
      case 'relu': return Math.max(0, x);
      case 'sigmoid': {
        if (x >= 0) return 1 / (1 + Math.exp(-x));
        const e = Math.exp(x);
        return e / (1 + e);
      }
      case 'tanh': return Math.tanh(x);
      case 'linear': return x;
      default: return x;
    }
  }

  function activationPrime(x, name) {
    switch (name) {
      case 'relu': return x > 0 ? 1 : 0;
      case 'sigmoid': { const s = activation(x, 'sigmoid'); return s * (1 - s); }
      case 'tanh': { const t = Math.tanh(x); return 1 - t * t; }
      case 'linear': return 1;
      default: return 1;
    }
  }

  function initNetwork(h) {
    hiddenSize = h;
    weights = {
      ih: Array.from({ length: 2 }, () => Array.from({ length: h }, () => (Math.random() - 0.5) * 2)),
      ho: Array.from({ length: h }, () => (Math.random() - 0.5) * 2)
    };
    biases = {
      h: Array.from({ length: h }, () => (Math.random() - 0.5) * 0.5),
      o: (Math.random() - 0.5) * 0.5
    };
    rebuildWeightControls();
    compute();
  }

  function randomize() {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        weights.ih[i][j] = (Math.random() - 0.5) * 2;
      }
    }
    for (let j = 0; j < hiddenSize; j++) {
      weights.ho[j] = (Math.random() - 0.5) * 2;
      biases.h[j] = (Math.random() - 0.5) * 0.5;
    }
    biases.o = (Math.random() - 0.5) * 0.5;
    syncSliders();
    compute();
  }

  function rebuildWeightControls() {
    weightControls.innerHTML = '';
    const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    for (let j = 0; j < hiddenSize; j++) {
      for (let i = 0; i < 2; i++) {
        const g = document.createElement('div');
        g.className = 'control-group';
        const lbl = document.createElement('span');
        lbl.className = 'control-label';
        lbl.innerHTML = `w<sub>${i+1}${j+1}</sub> <span class="control-value" id="w-ih-${i}-${j}-val">${weights.ih[i][j].toFixed(2)}</span>`;
        const inp = document.createElement('input');
        inp.type = 'range';
        inp.min = -3; inp.max = 3; inp.step = 0.05;
        inp.value = weights.ih[i][j];
        inp.id = `w-ih-${i}-${j}`;
        inp.addEventListener('input', () => {
          weights.ih[i][j] = parseFloat(inp.value);
          document.getElementById(`w-ih-${i}-${j}-val`).textContent = weights.ih[i][j].toFixed(2);
          compute();
        });
        g.appendChild(lbl);
        g.appendChild(inp);
        weightControls.appendChild(g);
      }
    }

    for (let j = 0; j < hiddenSize; j++) {
      const g = document.createElement('div');
      g.className = 'control-group';
      const lbl = document.createElement('span');
      lbl.className = 'control-label';
      lbl.innerHTML = `b<sub>h${j+1}</sub> <span class="control-value" id="b-h-${j}-val">${biases.h[j].toFixed(2)}</span>`;
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = -1; inp.max = 1; inp.step = 0.05;
      inp.value = biases.h[j];
      inp.id = `b-h-${j}`;
      inp.addEventListener('input', () => {
        biases.h[j] = parseFloat(inp.value);
        document.getElementById(`b-h-${j}-val`).textContent = biases.h[j].toFixed(2);
        compute();
      });
      g.appendChild(lbl);
      g.appendChild(inp);
      weightControls.appendChild(g);
    }

    for (let j = 0; j < hiddenSize; j++) {
      const g = document.createElement('div');
      g.className = 'control-group';
      const lbl = document.createElement('span');
      lbl.className = 'control-label';
      lbl.innerHTML = `w<sub>h${j+1}o</sub> <span class="control-value" id="w-ho-${j}-val">${weights.ho[j].toFixed(2)}</span>`;
      const inp = document.createElement('input');
      inp.type = 'range';
      inp.min = -3; inp.max = 3; inp.step = 0.05;
      inp.value = weights.ho[j];
      inp.id = `w-ho-${j}`;
      inp.addEventListener('input', () => {
        weights.ho[j] = parseFloat(inp.value);
        document.getElementById(`w-ho-${j}-val`).textContent = weights.ho[j].toFixed(2);
        compute();
      });
      g.appendChild(lbl);
      g.appendChild(inp);
      weightControls.appendChild(g);
    }

    const g = document.createElement('div');
    g.className = 'control-group';
    const lbl = document.createElement('span');
    lbl.className = 'control-label';
    lbl.innerHTML = `b<sub>o</sub> <span class="control-value" id="b-o-val">${biases.o.toFixed(2)}</span>`;
    const inp = document.createElement('input');
    inp.type = 'range';
    inp.min = -1; inp.max = 1; inp.step = 0.05;
    inp.value = biases.o;
    inp.id = 'b-o';
    inp.addEventListener('input', () => {
      biases.o = parseFloat(inp.value);
      document.getElementById('b-o-val').textContent = biases.o.toFixed(2);
      compute();
    });
    g.appendChild(lbl);
    g.appendChild(inp);
    weightControls.appendChild(g);
  }

  function syncSliders() {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < hiddenSize; j++) {
        const el = document.getElementById(`w-ih-${i}-${j}`);
        if (el) { el.value = weights.ih[i][j]; document.getElementById(`w-ih-${i}-${j}-val`).textContent = weights.ih[i][j].toFixed(2); }
      }
    }
    for (let j = 0; j < hiddenSize; j++) {
      const el = document.getElementById(`b-h-${j}`);
      if (el) { el.value = biases.h[j]; document.getElementById(`b-h-${j}-val`).textContent = biases.h[j].toFixed(2); }
    }
    for (let j = 0; j < hiddenSize; j++) {
      const el = document.getElementById(`w-ho-${j}`);
      if (el) { el.value = weights.ho[j]; document.getElementById(`w-ho-${j}-val`).textContent = weights.ho[j].toFixed(2); }
    }
    const el = document.getElementById('b-o');
    if (el) { el.value = biases.o; document.getElementById('b-o-val').textContent = biases.o.toFixed(2); }
  }

  function compute() {
    const x1 = parseFloat(inputX.value);
    const x2 = parseFloat(inputY.value);
    const actName = activationSelect.value;

    const hidden = [];
    for (let j = 0; j < hiddenSize; j++) {
      const z = x1 * weights.ih[0][j] + x2 * weights.ih[1][j] + biases.h[j];
      hidden.push(activation(z, actName));
    }

    let outSum = biases.o;
    for (let j = 0; j < hiddenSize; j++) {
      outSum += hidden[j] * weights.ho[j];
    }
    const output = activation(outSum, actName);

    // Update metrics
    const hLabels = [h1Val, h2Val, h3Val];
    for (let j = 0; j < 3; j++) {
      if (hLabels[j]) hLabels[j].textContent = j < hiddenSize ? hidden[j].toFixed(4) : '—';
    }
    outputVal.textContent = output.toFixed(4);

    // Build formula display
    let formula = `${actName}(`;
    let parts = [];
    for (let j = 0; j < hiddenSize; j++) {
      let inner = `${biases.o.toFixed(2)}`;
      if (weights.ho[j] !== 0) {
        const sign = weights.ho[j] >= 0 ? ' + ' : ' − ';
        inner += `${sign}${Math.abs(weights.ho[j]).toFixed(2)} · ${actName}(${biases.h[j].toFixed(2)}`;
        for (let i = 0; i < 2; i++) {
          const w = weights.ih[i][j];
          if (w !== 0) {
            const sgn = w >= 0 ? ' + ' : ' − ';
            inner += `${sgn}${Math.abs(w).toFixed(2)}·x${i+1}`;
          }
        }
        inner += ')';
      }
      parts.push(inner);
    }
    formula += parts.join(' + ') + ')';
    formulaDisplay.textContent = formula;

    draw(x1, x2, hidden, output, actName);
  }

  function resizeCanvas() {
    const wrap = document.getElementById('nn-canvas-wrap');
    const w = wrap.clientWidth;
    const ratio = 400 / 800;
    canvas.width = w * (devicePixelRatio || 1);
    canvas.height = w * ratio * (devicePixelRatio || 1);
    canvas.style.width = w + 'px';
    canvas.style.height = (w * ratio) + 'px';
    ctx.scale(devicePixelRatio || 1, devicePixelRatio || 1);
    compute();
  }

  function draw(x1, x2, hidden, output, actName) {
    const W = canvas.width / (devicePixelRatio || 1);
    const H = canvas.height / (devicePixelRatio || 1);
    ctx.clearRect(0, 0, W, H);

    const layerGap = W / 4;
    const xIn = layerGap;
    const xHidden = layerGap * 2;
    const xOut = layerGap * 3;

    const hiddenCount = hiddenSize;
    const inputGap = Math.min(H / 5, 60);
    const hiddenGap = Math.min(H / (hiddenCount + 1), 45);
    const inY = H / 2 - inputGap;
    const inY2 = H / 2 + inputGap;
    const outY = H / 2;

    const inputPos = [{ x: xIn, y: inY }, { x: xIn, y: inY2 }];
    const hiddenPos = Array.from({ length: hiddenCount }, (_, i) => ({
      x: xHidden, y: H / 2 + (i - (hiddenCount - 1) / 2) * hiddenGap
    }));
    const outputPos = { x: xOut, y: outY };

    const maxW = Math.max(1, ...weights.ih.flat().map(Math.abs), ...weights.ho.map(Math.abs));

    function connStrength(w) {
      const t = Math.abs(w) / (maxW || 1);
      return Math.max(0.08, Math.min(1, t));
    }

    // Draw connections: input → hidden
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < hiddenCount; j++) {
        const w = weights.ih[i][j];
        const s = connStrength(w);
        ctx.beginPath();
        ctx.moveTo(inputPos[i].x + 24, inputPos[i].y);
        ctx.lineTo(hiddenPos[j].x - 20, hiddenPos[j].y);
        ctx.strokeStyle = w >= 0
          ? `rgba(20, 184, 166, ${s * 0.6})`
          : `rgba(196, 65, 48, ${s * 0.5})`;
        ctx.lineWidth = 1 + s * 2.5;
        ctx.stroke();
      }
    }

    // Draw connections: hidden → output
    for (let j = 0; j < hiddenCount; j++) {
      const w = weights.ho[j];
      const s = connStrength(w);
      ctx.beginPath();
      ctx.moveTo(hiddenPos[j].x + 24, hiddenPos[j].y);
      ctx.lineTo(outputPos.x - 20, outputPos.y);
      ctx.strokeStyle = w >= 0
        ? `rgba(20, 184, 166, ${s * 0.6})`
        : `rgba(196, 65, 48, ${s * 0.5})`;
      ctx.lineWidth = 1 + s * 2.5;
      ctx.stroke();
    }

    // Draw input nodes
    for (let i = 0; i < 2; i++) {
      drawNode(ctx, inputPos[i].x, inputPos[i].y, 20, [i === 0 ? x1 : x2], actName, false);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`x${i+1} = ${(i === 0 ? x1 : x2).toFixed(2)}`, inputPos[i].x, inputPos[i].y + 36);
    }

    // Draw hidden nodes
    for (let j = 0; j < hiddenCount; j++) {
      drawNode(ctx, hiddenPos[j].x, hiddenPos[j].y, 20, [hidden[j]], actName, true);
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`h${j+1}`, hiddenPos[j].x, hiddenPos[j].y + 34);
    }

    // Draw output node
    drawNode(ctx, outputPos.x, outputPos.y, 24, [output], actName, true);
    ctx.fillStyle = '#f9fafb';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`y = ${output.toFixed(4)}`, outputPos.x, outputPos.y + 40);

    // Layer labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Input', xIn, H - 16);
    ctx.fillText('Hidden', xHidden, H - 16);
    ctx.fillText('Output', xOut, H - 16);

    // Activation label
    ctx.fillStyle = '#4b5563';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`σ = ${actName}  |  ${hiddenCount} hidden`, 12, 18);
  }

  function drawNode(ctx, x, y, r, values, actName, active) {
    // Outer glow for active nodes
    if (active && values[0] !== undefined) {
      const grad = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 1.8);
      grad.addColorStop(0, 'rgba(20, 184, 166, 0.08)');
      grad.addColorStop(1, 'rgba(20, 184, 166, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#1f2937' : '#151b23';
    ctx.fill();
    ctx.strokeStyle = active ? '#14b8a6' : '#374151';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (values[0] !== undefined && active) {
      ctx.fillStyle = '#14b8a6';
      ctx.font = `${Math.max(9, r * 0.55)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const v = values[0];
      ctx.fillText(v >= 0 ? v.toFixed(2) : v.toFixed(2), x, y);
      ctx.textBaseline = 'alphabetic';
    }
  }

  activationSelect.addEventListener('change', compute);
  hiddenSizeSelect.addEventListener('change', () => {
    initNetwork(parseInt(hiddenSizeSelect.value));
  });
  inputX.addEventListener('input', compute);
  inputY.addEventListener('input', compute);
  randomizeBtn.addEventListener('click', randomize);

  const infoTexts = {
    relu: '<strong>ReLU (Rectified Linear Unit):</strong> f(x) = max(0, x). The most widely used activation. Returns x for positive inputs, 0 otherwise. Helps with vanishing gradient problem.',
    sigmoid: '<strong>Sigmoid:</strong> f(x) = 1 / (1 + e<sup>-x</sup>). Squashes values between 0 and 1. Historically popular for binary classification outputs.',
    tanh: '<strong>Tanh (Hyperbolic Tangent):</strong> f(x) = (e<sup>x</sup> - e<sup>-x</sup>) / (e<sup>x</sup> + e<sup>-x</sup>). Squashes values between -1 and 1. Zero-centered, unlike sigmoid.',
    linear: '<strong>Linear:</strong> f(x) = x. Identity activation. Used in output layers for regression tasks. No non-linearity means the network stays a linear model.'
  };
  activationSelect.addEventListener('change', () => {
    infoBox.innerHTML = infoTexts[activationSelect.value] || infoTexts.relu;
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 100);
  });

  initNetwork(3);
  infoBox.innerHTML = infoTexts.relu;

  // Responsive resizing
  setTimeout(resizeCanvas, 50);

  // Exports for testing
  window.__nn = { activation, activationPrime, compute, weights, biases, initNetwork };
})();
