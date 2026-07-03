(() => {
  'use strict';

  const canvas = document.getElementById('bp-canvas');
  const ctx = canvas.getContext('2d');

  const x1Slider = document.getElementById('bp-x1');
  const x2Slider = document.getElementById('bp-x2');
  const targetSlider = document.getElementById('bp-target');
  const forwardBtn = document.getElementById('forward-btn');
  const backwardBtn = document.getElementById('backward-btn');
  const resetBtn = document.getElementById('bp-reset-btn');
  const stepsEl = document.getElementById('bp-steps');

  const gradEls = {
    w11: document.getElementById('grad-w11'),
    w12: document.getElementById('grad-w12'),
    w21: document.getElementById('grad-w21'),
    w22: document.getElementById('grad-w22'),
    wh1: document.getElementById('grad-wh1'),
    wh2: document.getElementById('grad-wh2')
  };

  // Fixed initial weights for reproducibility
  const W = {
    ih: [[0.5, -0.4], [0.3, 0.6]],
    ho: [0.8, -0.5]
  };
  const B = { h: [0.1, -0.2], o: 0.3 };

  let state = {
    x1: 0.5, x2: 0.3, target: 1,
    z1: 0, a1: 0, z2: 0, a2: 0,
    y: 0, loss: 0,
    grad: { w11: 0, w12: 0, w21: 0, w22: 0, wh1: 0, wh2: 0 },
    forwardDone: false,
    backwardDone: false
  };

  function sigmoid(x) {
    if (x >= 0) return 1 / (1 + Math.exp(-x));
    const e = Math.exp(x);
    return e / (1 + e);
  }

  function relu(x) { return Math.max(0, x); }

  function sigmoidPrime(x) {
    const s = sigmoid(x);
    return s * (1 - s);
  }

  function reluPrime(x) {
    return x > 0 ? 1 : 0;
  }

  function forward() {
    const x1 = parseFloat(x1Slider.value);
    const x2 = parseFloat(x2Slider.value);
    const target = parseFloat(targetSlider.value);

    // Hidden layer
    const z1 = x1 * W.ih[0][0] + x2 * W.ih[1][0] + B.h[0];
    const a1 = relu(z1);
    const z2 = x1 * W.ih[0][1] + x2 * W.ih[1][1] + B.h[1];
    const a2 = relu(z2);

    // Output layer
    const yRaw = a1 * W.ho[0] + a2 * W.ho[1] + B.o;
    const y = sigmoid(yRaw);

    // MSE loss
    const loss = 0.5 * Math.pow(y - target, 2);

    state = {
      ...state,
      x1, x2, target,
      z1, a1, z2, a2,
      yRaw, y, loss,
      forwardDone: true,
      backwardDone: false
    };

    // Zero gradients
    Object.keys(state.grad).forEach(k => state.grad[k] = 0);

    showForwardSteps();
    backwardBtn.disabled = false;
    draw();
  }

  function backward() {
    if (!state.forwardDone) return;

    const { a1, a2, y, target, yRaw } = state;

    // dL/dy
    const dLdy = y - target;
    // dy/dyRaw = sigmoid'(yRaw)
    const dy_dyRaw = sigmoidPrime(yRaw);
    // dL/dyRaw
    const dL_dyRaw = dLdy * dy_dyRaw;

    // Gradients for hidden→output weights
    const gradWh1 = dL_dyRaw * a1;
    const gradWh2 = dL_dyRaw * a2;

    // Gradients for input→hidden weights
    // For h1:
    const dL_da1 = dL_dyRaw * W.ho[0];
    const da1_dz1 = reluPrime(state.z1);
    const dL_dz1 = dL_da1 * da1_dz1;
    const gradW11 = dL_dz1 * state.x1;
    const gradW21 = dL_dz1 * state.x2;

    // For h2:
    const dL_da2 = dL_dyRaw * W.ho[1];
    const da2_dz2 = reluPrime(state.z2);
    const dL_dz2 = dL_da2 * da2_dz2;
    const gradW12 = dL_dz2 * state.x1;
    const gradW22 = dL_dz2 * state.x2;

    state.grad = { w11: gradW11, w12: gradW12, w21: gradW21, w22: gradW22, wh1: gradWh1, wh2: gradWh2 };
    state.backwardDone = true;

    updateGradMetrics();
    showBackwardSteps();
    draw();
  }

  function reset() {
    state = {
      x1: parseFloat(x1Slider.value),
      x2: parseFloat(x2Slider.value),
      target: parseFloat(targetSlider.value),
      z1: 0, a1: 0, z2: 0, a2: 0,
      yRaw: 0, y: 0, loss: 0,
      grad: { w11: 0, w12: 0, w21: 0, w22: 0, wh1: 0, wh2: 0 },
      forwardDone: false,
      backwardDone: false
    };
    backwardBtn.disabled = true;
    stepsEl.innerHTML = '<div class="step-line dim">Click "Forward Pass" to compute forward propagation.</div>';
    Object.values(gradEls).forEach(el => el.textContent = '—');
    draw();
  }

  function showForwardSteps() {
    const s = state;
    stepsEl.innerHTML = `
      <div class="step-line"><span class="hl">Forward Pass</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">Hidden neuron h₁:</span></div>
      <div class="step-line">  z₁ = x₁·w₁₁ + x₂·w₂₁ + b₁ = ${s.x1}·${W.ih[0][0]} + ${s.x2}·${W.ih[1][0]} + ${B.h[0]} = <span class="hl">${s.z1.toFixed(4)}</span></div>
      <div class="step-line">  a₁ = ReLU(z₁) = max(0, ${s.z1.toFixed(4)}) = <span class="hl">${s.a1.toFixed(4)}</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">Hidden neuron h₂:</span></div>
      <div class="step-line">  z₂ = x₁·w₁₂ + x₂·w₂₂ + b₂ = ${s.x1}·${W.ih[0][1]} + ${s.x2}·${W.ih[1][1]} + ${B.h[1]} = <span class="hl">${s.z2.toFixed(4)}</span></div>
      <div class="step-line">  a₂ = ReLU(z₂) = max(0, ${s.z2.toFixed(4)}) = <span class="hl">${s.a2.toFixed(4)}</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">Output layer:</span></div>
      <div class="step-line">  y_raw = a₁·wₕ₁ + a₂·wₕ₂ + bₒ = ${s.a1.toFixed(4)}·${W.ho[0]} + ${s.a2.toFixed(4)}·${W.ho[1]} + ${B.o} = <span class="hl">${s.yRaw.toFixed(4)}</span></div>
      <div class="step-line">  y = σ(y_raw) = sigmoid(${s.yRaw.toFixed(4)}) = <span class="hl">${s.y.toFixed(4)}</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="hl">Loss L = ½(y − t)² = ½(${s.y.toFixed(4)} − ${s.target})² = ${s.loss.toFixed(6)}</span></div>
    `;
  }

  function showBackwardSteps() {
    const s = state;
    const g = s.grad;
    stepsEl.innerHTML += `
      <div class="step-line"> </div>
      <div class="step-line"><span class="hl">Backward Pass (Chain Rule)</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">∂L/∂y = y − t = ${(s.y - s.target).toFixed(4)}</span></div>
      <div class="step-line"><span class="dim">∂y/∂y_raw = σ′(y_raw) = y·(1−y) = ${(s.y * (1 - s.y)).toFixed(4)}</span></div>
      <div class="step-line"><span class="hl">∂L/∂y_raw = ${(s.y - s.target).toFixed(4)} · ${(s.y * (1 - s.y)).toFixed(4)} = ${((s.y - s.target) * s.y * (1 - s.y)).toFixed(4)}</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">Hidden → Output:</span></div>
      <div class="step-line">  ∂L/∂wₕ₁ = ∂L/∂y_raw · a₁ = ${((s.y - s.target) * s.y * (1 - s.y)).toFixed(4)} · ${s.a1.toFixed(4)} = <span class="hl">${g.wh1.toFixed(4)}</span></div>
      <div class="step-line">  ∂L/∂wₕ₂ = ∂L/∂y_raw · a₂ = ${((s.y - s.target) * s.y * (1 - s.y)).toFixed(4)} · ${s.a2.toFixed(4)} = <span class="hl">${g.wh2.toFixed(4)}</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">Input → Hidden (h₁ path):</span></div>
      <div class="step-line">  ∂L/∂a₁ = ∂L/∂y_raw · wₕ₁ = ${((s.y - s.target) * s.y * (1 - s.y)).toFixed(4)} · ${W.ho[0]} = <span class="hl">${((s.y - s.target) * s.y * (1 - s.y) * W.ho[0]).toFixed(4)}</span></div>
      <div class="step-line">  ∂a₁/∂z₁ = ReLU′(z₁) = ${reluPrime(s.z1)}</div>
      <div class="step-line">  ∂L/∂z₁ = ∂L/∂a₁ · ∂a₁/∂z₁</div>
      <div class="step-line">  ∂L/∂w₁₁ = ∂L/∂z₁ · x₁ = <span class="hl">${g.w11.toFixed(4)}</span> &nbsp;|&nbsp; ∂L/∂w₂₁ = ∂L/∂z₁ · x₂ = <span class="hl">${g.w21.toFixed(4)}</span></div>
      <div class="step-line"> </div>
      <div class="step-line"><span class="dim">Input → Hidden (h₂ path):</span></div>
      <div class="step-line">  ∂L/∂a₂ = ∂L/∂y_raw · wₕ₂ = ${((s.y - s.target) * s.y * (1 - s.y)).toFixed(4)} · ${W.ho[1]} = <span class="hl">${((s.y - s.target) * s.y * (1 - s.y) * W.ho[1]).toFixed(4)}</span></div>
      <div class="step-line">  ∂L/∂w₁₂ = ∂L/∂z₂ · x₁ = <span class="hl">${g.w12.toFixed(4)}</span> &nbsp;|&nbsp; ∂L/∂w₂₂ = ∂L/∂z₂ · x₂ = <span class="hl">${g.w22.toFixed(4)}</span></div>
    `;
  }

  function updateGradMetrics() {
    const g = state.grad;
    gradEls.w11.textContent = g.w11.toFixed(4);
    gradEls.w12.textContent = g.w12.toFixed(4);
    gradEls.w21.textContent = g.w21.toFixed(4);
    gradEls.w22.textContent = g.w22.toFixed(4);
    gradEls.wh1.textContent = g.wh1.toFixed(4);
    gradEls.wh2.textContent = g.wh2.toFixed(4);

    // Color code positive/negative gradients
    Object.entries(gradEls).forEach(([key, el]) => {
      const v = g[key] || 0;
      el.style.color = v > 0.01 ? '#c44130' : v < -0.01 ? '#14b8a6' : 'var(--text-primary)';
    });
  }

  function resizeCanvas() {
    const wrap = document.getElementById('bp-canvas-wrap');
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
    const W_ = canvas.width / (devicePixelRatio || 1);
    const H_ = canvas.height / (devicePixelRatio || 1);
    ctx.clearRect(0, 0, W_, H_);

    const layerGap = W_ / 4;
    const xIn = layerGap;
    const xHidden = layerGap * 2;
    const xOut = layerGap * 3;

    const inY1 = H_ / 2 - 35;
    const inY2 = H_ / 2 + 35;
    const hY1 = H_ / 2 - 30;
    const hY2 = H_ / 2 + 30;
    const outY = H_ / 2;

    const inputPos = [{ x: xIn, y: inY1 }, { x: xIn, y: inY2 }];
    const hiddenPos = [{ x: xHidden, y: hY1 }, { x: xHidden, y: hY2 }];
    const outputPos = { x: xOut, y: outY };

    const showForward = state.forwardDone;
    const showBackward = state.backwardDone;

    // Draw edges input → hidden
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const w = W.ih[i][j];
        const gradKey = `w${i+1}${j+1}`;
        const grad = state.grad[gradKey] || 0;

        ctx.beginPath();
        ctx.moveTo(inputPos[i].x + 22, inputPos[i].y);
        ctx.lineTo(hiddenPos[j].x - 22, hiddenPos[j].y);

        if (showBackward && Math.abs(grad) > 0.001) {
          const intensity = Math.min(1, Math.abs(grad) * 3);
          ctx.strokeStyle = grad > 0
            ? `rgba(196, 65, 48, ${intensity * 0.6})`
            : `rgba(20, 184, 166, ${intensity * 0.6})`;
          ctx.lineWidth = 1 + intensity * 3;
        } else if (showForward) {
          ctx.strokeStyle = 'rgba(255,255,255,0.06)';
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 0.5;
        }
        ctx.stroke();
      }
    }

    // Draw edges hidden → output
    for (let j = 0; j < 2; j++) {
      const w = W.ho[j];
      const gradKey = `wh${j+1}`;
      const grad = state.grad[gradKey] || 0;

      ctx.beginPath();
      ctx.moveTo(hiddenPos[j].x + 22, hiddenPos[j].y);
      ctx.lineTo(outputPos.x - 22, outputPos.y);

      if (showBackward && Math.abs(grad) > 0.001) {
        const intensity = Math.min(1, Math.abs(grad) * 3);
        ctx.strokeStyle = grad > 0
          ? `rgba(196, 65, 48, ${intensity * 0.6})`
          : `rgba(20, 184, 166, ${intensity * 0.6})`;
        ctx.lineWidth = 1 + intensity * 3;
      } else if (showForward) {
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
      }
      ctx.stroke();
    }

    // Draw input nodes
    const inputVals = [parseFloat(x1Slider.value), parseFloat(x2Slider.value)];
    for (let i = 0; i < 2; i++) {
      drawBpNode(ctx, inputPos[i].x, inputPos[i].y, 22, inputVals[i].toFixed(1), false);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`x${i+1}`, inputPos[i].x, inputPos[i].y + 36);
    }

    // Draw hidden nodes
    for (let j = 0; j < 2; j++) {
      const val = showForward ? (j === 0 ? state.a1 : state.a2) : null;
      drawBpNode(ctx, hiddenPos[j].x, hiddenPos[j].y, 22, val !== null ? val.toFixed(2) : '—', showForward);
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`h${j+1}`, hiddenPos[j].x, hiddenPos[j].y + 36);
    }

    // Draw output node
    const outVal = showForward ? state.y.toFixed(4) : '—';
    drawBpNode(ctx, outputPos.x, outputPos.y, 26, outVal, showForward);
    ctx.fillStyle = '#f9fafb';
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('y', outputPos.x, outputPos.y + 40);

    // Draw target
    ctx.fillStyle = '#6b7280';
    ctx.font = '9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`target: ${parseFloat(targetSlider.value).toFixed(1)}`, outputPos.x, outputPos.y + 54);

    // Layer labels
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Input (2)', xIn, H_ - 16);
    ctx.fillText('Hidden (2)', xHidden, H_ - 16);
    ctx.fillText('Output (1)', xOut, H_ - 16);

    // Status indicator
    if (showBackward) {
      ctx.fillStyle = '#14b8a6';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('✓ Backpropagation complete — gradients shown on edges', 12, 18);
    } else if (showForward) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Forward pass complete — click Backward Pass for gradients', 12, 18);
    }
  }

  function drawBpNode(ctx, x, y, r, label, active) {
    if (active) {
      const grad = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 1.6);
      grad.addColorStop(0, 'rgba(20, 184, 166, 0.08)');
      grad.addColorStop(1, 'rgba(20, 184, 166, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = active || label !== '—' ? '#1f2937' : '#151b23';
    ctx.fill();
    ctx.strokeStyle = active ? '#14b8a6' : '#374151';
    ctx.lineWidth = active ? 1.5 : 1;
    ctx.stroke();

    if (label !== undefined && label !== null) {
      ctx.fillStyle = active ? '#14b8a6' : '#6b7280';
      ctx.font = `${Math.max(9, r * 0.5)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(label), x, y);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Event handlers
  forwardBtn.addEventListener('click', () => { forward(); });
  backwardBtn.addEventListener('click', () => { backward(); });
  resetBtn.addEventListener('click', reset);

  [x1Slider, x2Slider, targetSlider].forEach(slider => {
    slider.addEventListener('input', () => {
      if (state.forwardDone && !state.backwardDone) {
        forward();
      } else {
        reset();
      }
    });
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 100);
  });

  // Init
  reset();
  setTimeout(resizeCanvas, 50);

  // Exports for testing
  window.__bp = { forward, backward, reset, state, W, B, sigmoid, relu, sigmoidPrime, reluPrime };
})();
