(() => {
  'use strict';

  const canvas = document.getElementById('dt-canvas');
  const ctx = canvas.getContext('2d');
  const trainBtn = document.getElementById('dt-train');
  const stepBtn = document.getElementById('dt-step');
  const resetBtn = document.getElementById('dt-reset');
  const dataBtn = document.getElementById('dt-data');
  const depthSelect = document.getElementById('dt-depth');
  const status = document.getElementById('dt-status');
  const mSplits = document.getElementById('dt-splits');
  const mLeaves = document.getElementById('dt-leaves');
  const mDepth = document.getElementById('dt-depth-val');
  const mAcc = document.getElementById('dt-acc');
  const splitRows = document.getElementById('dt-split-rows');

  const W = 800, H = 500, PAD = 34;
  const D = 10;
  const C_A = '#14b8a6', C_B = '#fbbf24';
  const MIN_LEAF = 4;

  let points = [];        // {x, y, cls: 0|1}
  let root = null;        // tree node
  let revealed = 0;       // number of internal nodes revealed
  let nodeOrder = [];     // BFS order of internal nodes
  let maxDepth = 3;

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

  function generateData() {
    const rand = mulberry32((Date.now() & 0xffff) ^ 0x51ab3d7f);
    const gauss = () => {
      const u = Math.max(rand(), 1e-9), v = Math.max(rand(), 1e-9);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    const ca = { x: 2.8 + rand() * 1.6, y: 2.8 + rand() * 1.6 };
    const cb = { x: 5.8 + rand() * 1.6, y: 5.8 + rand() * 1.6 };
    points = [];
    for (let i = 0; i < 80; i++) {
      const cls = i < 40 ? 0 : 1;
      const c = cls === 0 ? ca : cb;
      points.push({
        x: Math.min(D - 0.4, Math.max(0.4, c.x + gauss() * 0.55)),
        y: Math.min(D - 0.4, Math.max(0.4, c.y + gauss() * 0.55)),
        cls,
      });
    }
    resetTree();
  }

  function gini(rows) {
    if (!rows.length) return 0;
    let n0 = 0;
    for (const r of rows) if (r.cls === 0) n0++;
    const p = n0 / rows.length;
    return 1 - p * p - (1 - p) * (1 - p);
  }

  function majority(rows) {
    let n0 = 0;
    for (const r of rows) if (r.cls === 0) n0++;
    return n0 >= rows.length - n0 ? 0 : 1;
  }

  function buildTree(rows, depth, maxD, region) {
    const node = { region, depth, count: rows.length, gini: gini(rows), cls: majority(rows) };
    const pure = node.gini === 0;
    if (depth >= maxD || pure || rows.length < MIN_LEAF * 2) {
      node.leaf = true;
      node.cls = majority(rows);
      return node;
    }
    // best split: feature 0 = x, 1 = y
    let best = null;
    for (const feat of [0, 1]) {
      const vals = [...new Set(rows.map(r => (feat === 0 ? r.x : r.y)))].sort((a, b) => a - b);
      for (let i = 0; i < vals.length - 1; i++) {
        const t = (vals[i] + vals[i + 1]) / 2;
        const left = rows.filter(r => (feat === 0 ? r.x : r.y) <= t);
        const right = rows.filter(r => (feat === 0 ? r.x : r.y) > t);
        if (!left.length || !right.length) continue;
        const g = (left.length * gini(left) + right.length * gini(right)) / rows.length;
        if (!best || g < best.g) best = { feat, t, g, left, right };
      }
    }
    if (!best) { node.leaf = true; node.cls = majority(rows); return node; }
    node.feat = best.feat;
    node.t = best.t;
    node.splitGini = best.g;
    node.left = buildTree(best.left, depth + 1, maxD, { ...region });
    node.right = buildTree(best.right, depth + 1, maxD, { ...region });
    // subdivide regions for drawing
    if (best.feat === 0) {
      node.left.region = { x0: region.x0, x1: best.t, y0: region.y0, y1: region.y1 };
      node.right.region = { x0: best.t, x1: region.x1, y0: region.y0, y1: region.y1 };
    } else {
      node.left.region = { x0: region.x0, x1: region.x1, y0: region.y0, y1: best.t };
      node.right.region = { x0: region.x0, x1: region.x1, y0: best.t, y1: region.y1 };
    }
    return node;
  }

  function resetTree() {
    root = null;
    revealed = 0;
    nodeOrder = [];
    splitRows.innerHTML = '';
    update();
  }

  function trainFull() {
    maxDepth = parseInt(depthSelect.value, 10);
    root = buildTree(points, 0, maxDepth, { x0: 0, x1: D, y0: 0, y1: D });
    // BFS order of internal nodes
    nodeOrder = [];
    const queue = [root];
    while (queue.length) {
      const n = queue.shift();
      if (!n.leaf) {
        nodeOrder.push(n);
        queue.push(n.left, n.right);
      }
    }
    revealed = nodeOrder.length;
    renderSplitList();
    update();
  }

  function stepOnce() {
    maxDepth = parseInt(depthSelect.value, 10);
    if (!root) {
      root = buildTree(points, 0, maxDepth, { x0: 0, x1: D, y0: 0, y1: D });
      const queue = [root];
      while (queue.length) {
        const n = queue.shift();
        if (!n.leaf) { nodeOrder.push(n); queue.push(n.left, n.right); }
      }
      revealed = 0;
    }
    if (revealed < nodeOrder.length) revealed++;
    renderSplitList();
    update();
  }

  function renderSplitList() {
    splitRows.innerHTML = '';
    const shown = nodeOrder.slice(0, revealed);
    shown.forEach((n, i) => {
      const row = document.createElement('div');
      row.className = 'split-row' + (i === revealed - 1 ? ' active' : '');
      const feat = n.feat === 0 ? 'x' : 'y';
      const aClass = n.left && !n.left.leaf ? '…' : (n.left ? (n.left.cls === 0 ? 'A' : 'B') : '?');
      row.textContent = (i + 1) + '. ' + feat + ' < ' + n.t.toFixed(2) + '  →  ' + aClass + '  (gini ' + n.gini.toFixed(2) + ' → ' + n.splitGini.toFixed(2) + ')';
      splitRows.appendChild(row);
    });
    if (!shown.length) {
      const row = document.createElement('div');
      row.className = 'split-row';
      row.textContent = 'Press Step or Train full tree to grow the first split.';
      splitRows.appendChild(row);
    }
  }

  // collect leaves of the revealed subtree
  function activeLeaves() {
    const revealedSet = new Set(nodeOrder.slice(0, revealed));
    const leaves = [];
    const walk = (n) => {
      if (!n) return;
      if (n.leaf || !revealedSet.has(n)) { leaves.push(n); return; }
      walk(n.left); walk(n.right);
    };
    walk(root);
    return leaves;
  }

  function predict(p) {
    if (!root) return -1;
    const revealedSet = new Set(nodeOrder.slice(0, revealed));
    let n = root;
    while (!n.leaf && revealedSet.has(n)) {
      n = (n.feat === 0 ? p.x : p.y) <= n.t ? n.left : n.right;
    }
    return n.cls;
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

    if (!root) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Press "Train full tree" or "Step" to grow the tree', W / 2, H / 2);
    } else {
      // leaf regions
      const leaves = activeLeaves();
      for (const leaf of leaves) {
        const r = leaf.region;
        const [x0, y1] = dataToPx(r.x0, r.y0);
        const [x1, y0] = dataToPx(r.x1, r.y1);
        ctx.fillStyle = (leaf.cls === 0 ? C_A : C_B) + '1f';
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      // split boundaries (revealed internal nodes)
      const revealedSet = new Set(nodeOrder.slice(0, revealed));
      ctx.strokeStyle = 'rgba(248,250,252,0.6)';
      ctx.lineWidth = 1.5;
      for (const n of nodeOrder.slice(0, revealed)) {
        const r = n.region;
        if (n.feat === 0) {
          const [px] = dataToPx(n.t, 0);
          const [, yT] = dataToPx(0, r.y1);
          const [, yB] = dataToPx(0, r.y0);
          ctx.beginPath(); ctx.moveTo(px, yT); ctx.lineTo(px, yB); ctx.stroke();
        } else {
          const [, py] = dataToPx(0, n.t);
          const [xL] = dataToPx(r.x0, 0);
          const [xR] = dataToPx(r.x1, 0);
          ctx.beginPath(); ctx.moveTo(xL, py); ctx.lineTo(xR, py); ctx.stroke();
        }
      }
      // points: fill true color; white ring when misclassified by current tree
      for (const p of points) {
        const [px, py] = dataToPx(p.x, p.y);
        ctx.fillStyle = p.cls === 0 ? C_A : C_B;
        ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
        const pred = predict(p);
        if (pred !== -1 && pred !== p.cls) {
          ctx.strokeStyle = 'rgba(248,250,252,0.9)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.arc(px, py, 6.5, 0, Math.PI * 2); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }

  function update() {
    if (!root) {
      status.textContent = 'untrained';
      mSplits.textContent = '0';
      mLeaves.textContent = '—';
      mDepth.textContent = '—';
      mAcc.textContent = '—';
      draw();
      return;
    }
    const leaves = activeLeaves();
    let correct = 0;
    for (const p of points) {
      const pred = predict(p);
      if (pred === p.cls) correct++;
    }
    mSplits.textContent = revealed + ' / ' + nodeOrder.length;
    mLeaves.textContent = String(leaves.length);
    mDepth.textContent = String(maxDepth);
    mAcc.textContent = (correct / points.length * 100).toFixed(1) + '%';
    status.textContent = revealed >= nodeOrder.length ? 'trained (full depth)' : 'training… ' + revealed + '/' + nodeOrder.length + ' splits';
    draw();
  }

  trainBtn.addEventListener('click', trainFull);
  stepBtn.addEventListener('click', stepOnce);
  resetBtn.addEventListener('click', resetTree);
  dataBtn.addEventListener('click', generateData);
  depthSelect.addEventListener('change', resetTree);

  generateData();
})();
