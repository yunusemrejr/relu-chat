// ============================================================
//  ReLU.chat — Diagram Type Renderers
//  Pure-DOM SVG renderers for all 5 diagram types.
//  Part of the safe diagram renderer (Track C P1).
// ============================================================

// ---- SVG namespace & helpers ----
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tagName) {
  return document.createElementNS(SVG_NS, tagName);
}

function setAttrs(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, String(v));
  }
}

function svgText(x, y, content, cls) {
  const t = svgEl('text');
  setAttrs(t, { x, y });
  t.textContent = String(content);
  if (cls) t.setAttribute('class', cls);
  return t;
}

// ---- Theme colour palettes ----
const THEMES = {
  light: {
    bg:          '#ffffff',
    surface:     '#f5f5f5',
    border:      '#d4d4d4',
    text:        '#1a1a1a',
    textMuted:   '#666666',
    accent:      '#c9853a',
    highlight:   '#fff3cd',
    highlightBorder: '#ffc107',
    diagGreen:   '#4caf50',
    diagTeal:    '#2196f3',
    diagOrange:  '#ff9800',
    gridLine:    '#e0e0e0'
  },
  dark: {
    bg:          '#0b0b0d',
    surface:     'rgba(243,239,231,0.04)',
    border:      'rgba(255,255,255,0.12)',
    text:        '#f3efe7',
    textMuted:   'rgba(243,239,231,0.52)',
    accent:      '#c9853a',
    highlight:   'rgba(201,133,58,0.2)',
    highlightBorder: '#c9853a',
    diagGreen:   '#2d9e5a',
    diagTeal:    '#417d97',
    diagOrange:  '#c9853a',
    gridLine:    'rgba(255,255,255,0.08)'
  }
};

// ---- Text fallback builder ----
function buildTextFallback(ast) {
  const lines = [];
  if (ast.title) lines.push(ast.title);
  switch (ast.type) {
    case 'payoff_matrix': {
      lines.push(['', ...ast.cols].join(' | '));
      for (let i = 0; i < ast.rows.length; i++) {
        const row = [ast.rows[i]];
        for (let j = 0; j < ast.cols.length; j++) {
          const idx = i * ast.cols.length + j;
          const c = ast.cells[idx];
          row.push(c ? c.payoff.join(',') : '-');
        }
        lines.push(row.join(' | '));
      }
      break;
    }
    case 'confusion_matrix': {
      lines.push(['', ...ast.labels].join(' | '));
      for (let i = 0; i < ast.cells.length; i++) {
        lines.push([ast.labels[i], ...ast.cells[i]].join(' | '));
      }
      break;
    }
    case 'timeline':
      for (const e of ast.events) {
        lines.push(`${e.year}: ${e.title}${e.detail ? ' - ' + e.detail : ''}`);
      }
      break;
    case 'flow':
      for (const n of ast.nodes) lines.push(`${n.label} (${n.id})`);
      if (ast.edges) {
        lines.push('');
        for (const e of ast.edges) lines.push(`${e.from} -> ${e.to}${e.label ? ': ' + e.label : ''}`);
      }
      break;
    case 'chart':
      for (const b of ast.bars) lines.push(`${b.label}: ${Math.round(b.value * 100)}%`);
      break;
    default:
      lines.push('Unknown diagram type');
  }
  if (ast.caption) lines.push('', ast.caption);
  return lines.join('\n');
}

// ============================================================
//  PAYOFF MATRIX
// ============================================================
function renderPayoffMatrix(ast, t, w) {
  const svg = svgEl('svg');
  const nRows = ast.rows.length, nCols = ast.cols.length;
  const padL = 100, padT = 60, padR = 20, padB = 40;
  const cellW = Math.max(70, (w - padL - padR) / (nCols + 1));
  const cellH = 44;
  const svgW = padL + (nCols + 1) * cellW + padR;
  const svgH = padT + (nRows + 2) * cellH + padB;

  setAttrs(svg, { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}`, role: 'img', 'aria-label': ast.title || 'Payoff matrix' });

  if (ast.title) {
    const titleEl = svgText(padL, 25, ast.title);
    titleEl.setAttribute('font-size', '14');
    titleEl.setAttribute('font-weight', '600');
    titleEl.setAttribute('fill', t.text);
    svg.appendChild(titleEl);
  }

  svg.appendChild(svgText(padL, padT - 12, ast.players[0] || 'Player 1'));
  svg.appendChild(svgText(padL, padT + (nRows + 1) * cellH + 20, ast.players[1] || 'Player 2'));

  // Column headers
  for (let j = 0; j < nCols; j++) {
    svg.appendChild(svgText(padL + (j + 1) * cellW + cellW / 2, padT - 8, ast.cols[j], 'relu-diagram-cell-label'));
  }
  // Row headers
  for (let i = 0; i < nRows; i++) {
    svg.appendChild(svgText(padL - 10, padT + cellH + i * cellH + cellH / 2 + 5, ast.rows[i], 'relu-diagram-cell-label'));
  }

  // Cells
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const cell = ast.cells[i * nCols + j];
      const cx = padL + (j + 1) * cellW, cy = padT + i * cellH;
      const isHighlight = cell && cell.highlight;

      const rect = svgEl('rect');
      setAttrs(rect, {
        x: cx, y: cy, width: cellW, height: cellH,
        fill: isHighlight ? t.highlight : t.surface,
        stroke: isHighlight ? t.highlightBorder : t.border,
        'stroke-width': isHighlight ? 2 : 1, rx: 4
      });
      svg.appendChild(rect);

      if (cell) {
        const txt = svgText(cx + cellW / 2, cy + cellH / 2 + 5, cell.payoff.join(', '));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', isHighlight ? t.accent : t.text);
        txt.setAttribute('font-size', '13');
        txt.setAttribute('font-weight', isHighlight ? '600' : '400');
        if (cell.label) {
          const lt = svgText(cx + cellW / 2, cy + cellH / 2 - 13, cell.label);
          lt.setAttribute('text-anchor', 'middle');
          lt.setAttribute('fill', t.textMuted);
          lt.setAttribute('font-size', '10');
          svg.appendChild(lt);
        }
        svg.appendChild(txt);
      }
    }
  }

  if (ast.caption) {
    const cap = svgText(padL, svgH - 8, ast.caption);
    cap.setAttribute('font-size', '11'); cap.setAttribute('fill', t.textMuted);
    cap.setAttribute('font-style', 'italic');
    svg.appendChild(cap);
  }
  return svg;
}

// ============================================================
//  CONFUSION MATRIX
// ============================================================
function renderConfusionMatrix(ast, t, w) {
  const svg = svgEl('svg');
  const n = ast.labels.length;
  const cellSize = Math.min(70, (w - 120) / (n + 1));
  const padL = Math.max(80, cellSize), padT = 60, padB = 40;
  const svgW = padL + (n + 1) * cellSize + 20;
  const svgH = padT + (n + 1) * cellSize + padB;

  setAttrs(svg, { width: svgW, height: svgH, viewBox: `0 0 ${svgW} ${svgH}`, role: 'img', 'aria-label': ast.title || 'Confusion matrix' });

  if (ast.title) {
    const titleEl = svgText(padL, 25, ast.title);
    titleEl.setAttribute('font-size', '14'); titleEl.setAttribute('font-weight', '600');
    titleEl.setAttribute('fill', t.text);
    svg.appendChild(titleEl);
  }

  let maxVal = 0;
  for (const row of ast.cells) for (const v of row) { if (v > maxVal) maxVal = v; }
  maxVal = maxVal || 1;

  svg.appendChild(svgText(10, padT - 15, ast.rowLabel || 'Actual'));
  svg.appendChild(svgText(padL + n * cellSize / 2, padT + (n + 1) * cellSize + 20, ast.colLabel || 'Predicted'));

  for (let j = 0; j < n; j++) {
    svg.appendChild(svgText(padL + cellSize / 2 + j * cellSize, padT - 8, ast.labels[j], 'relu-diagram-cell-label'));
  }
  for (let i = 0; i < n; i++) {
    svg.appendChild(svgText(padL - 10, padT + cellSize / 2 + i * cellSize + 5, ast.labels[i], 'relu-diagram-cell-label'));
    for (let j = 0; j < n; j++) {
      const cx = padL + j * cellSize, cy = padT + i * cellSize;
      const val = ast.cells[i][j];
      const intensity = Math.sqrt(val / maxVal);
      const isDiag = i === j;
      const fill = isDiag
        ? `rgba(65,125,151,${0.15 + intensity * 0.5})`
        : `rgba(45,158,90,${0.08 + intensity * 0.35})`;

      const rect = svgEl('rect');
      setAttrs(rect, { x: cx, y: cy, width: cellSize, height: cellSize, fill, stroke: isDiag ? t.accent : t.border, 'stroke-width': isDiag ? 2 : 1, rx: 3 });
      svg.appendChild(rect);

      const txt = svgText(cx + cellSize / 2, cy + cellSize / 2 + 5, String(val));
      txt.setAttribute('text-anchor', 'middle'); txt.setAttribute('fill', t.text);
      txt.setAttribute('font-size', '14'); txt.setAttribute('font-weight', '600');
      svg.appendChild(txt);
    }
  }

  if (ast.caption) {
    const cap = svgText(padL, svgH - 8, ast.caption);
    cap.setAttribute('font-size', '11'); cap.setAttribute('fill', t.textMuted);
    cap.setAttribute('font-style', 'italic');
    svg.appendChild(cap);
  }
  return svg;
}

// ============================================================
//  TIMELINE
// ============================================================
function renderTimeline(ast, t, w) {
  const svg = svgEl('svg');
  const padL = 40, padR = 20, padT = 50, padB = 40;
  const lineX = padL + 30, cardX = lineX + 20;
  const cardW = Math.min(320, w - cardX - padR);
  const events = ast.events;
  let svgH = padT + events.length * 72 + padB;
  if (ast.title) svgH += 10;
  if (ast.caption) svgH += 20;
  svgH = Math.max(svgH, 160);

  setAttrs(svg, { width: w, height: svgH, viewBox: `0 0 ${w} ${svgH}`, role: 'img', 'aria-label': ast.title || 'Timeline' });

  let curY = 25;
  if (ast.title) {
    const titleEl = svgText(lineX, curY, ast.title);
    titleEl.setAttribute('font-size', '14'); titleEl.setAttribute('font-weight', '600');
    titleEl.setAttribute('fill', t.text);
    svg.appendChild(titleEl);
    curY += 20;
  }

  const lineStartY = curY + 10, lineEndY = curY + events.length * 72 + 10;
  const vline = svgEl('line');
  setAttrs(vline, { x1: lineX, y1: lineStartY, x2: lineX, y2: lineEndY, stroke: t.border, 'stroke-width': 2 });
  svg.appendChild(vline);

  for (let i = 0; i < events.length; i++) {
    const e = events[i], ey = curY + 20 + i * 72;
    const dot = svgEl('circle');
    setAttrs(dot, { cx: lineX, cy: ey, r: 6, fill: t.accent, stroke: t.bg, 'stroke-width': 2 });
    svg.appendChild(dot);

    const yearEl = svgText(lineX - 16, ey - 12, e.year);
    yearEl.setAttribute('text-anchor', 'end'); yearEl.setAttribute('fill', t.accent);
    yearEl.setAttribute('font-size', '11'); yearEl.setAttribute('font-weight', '600');
    svg.appendChild(yearEl);

    const cardH = 52;
    const cr = svgEl('rect');
    setAttrs(cr, { x: cardX, y: ey - cardH / 2, width: cardW, height: cardH, fill: t.surface, stroke: t.border, 'stroke-width': 1, rx: 6 });
    svg.appendChild(cr);

    const titleEl = svgText(cardX + 10, ey - 6, e.title);
    titleEl.setAttribute('fill', t.text); titleEl.setAttribute('font-size', '13');
    titleEl.setAttribute('font-weight', '500');
    svg.appendChild(titleEl);

    if (e.detail) {
      const detailEl = svgText(cardX + 10, ey + 14, e.detail);
      detailEl.setAttribute('fill', t.textMuted); detailEl.setAttribute('font-size', '11');
      svg.appendChild(detailEl);
    }
  }

  if (ast.caption) {
    const cap = svgText(lineX, svgH - 8, ast.caption);
    cap.setAttribute('font-size', '11'); cap.setAttribute('fill', t.textMuted);
    cap.setAttribute('font-style', 'italic');
    svg.appendChild(cap);
  }
  return svg;
}

// ============================================================
//  FLOWCHART / TREE
// ============================================================
function renderFlow(ast, t, w) {
  const svg = svgEl('svg');
  const pad = 40, innerW = w - 2 * pad;
  const innerH = Math.max(300, innerW * 0.75);
  let svgH = innerH + 2 * pad + 60;
  if (ast.title) svgH += 30;
  if (ast.caption) svgH += 20;

  setAttrs(svg, { width: w, height: svgH, viewBox: `0 0 ${w} ${svgH}`, role: 'img', 'aria-label': ast.title || 'Flowchart' });

  let offsetY = 0;
  if (ast.title) {
    const titleEl = svgText(pad, 25, ast.title);
    titleEl.setAttribute('font-size', '14'); titleEl.setAttribute('font-weight', '600');
    titleEl.setAttribute('fill', t.text);
    svg.appendChild(titleEl);
    offsetY = 25;
  }

  const nodeRadius = 36;
  const nodePositions = {};
  for (const n of ast.nodes) {
    nodePositions[n.id] = { x: pad + n.x * innerW, y: pad + offsetY + 5 + n.y * innerH };
  }

  // Edges
  if (ast.edges) {
    for (const e of ast.edges) {
      const from = nodePositions[e.from], to = nodePositions[e.to];
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) continue;
      const ux = dx / len, uy = dy / len;
      const x1 = from.x + ux * nodeRadius, y1 = from.y + uy * nodeRadius;
      const x2 = to.x - ux * nodeRadius, y2 = to.y - uy * nodeRadius;

      const line = svgEl('line');
      setAttrs(line, { x1, y1, x2, y2, stroke: t.border, 'stroke-width': 1.5 });
      svg.appendChild(line);

      const as = 7;
      const ax = x2 - ux * as, ay = y2 - uy * as;
      const aw1x = ax + (-ux * as - uy * as) * 0.5, aw1y = ay + (-uy * as + ux * as) * 0.5;
      const aw2x = ax + (-ux * as + uy * as) * 0.5, aw2y = ay + (-uy * as - ux * as) * 0.5;
      const arrow = svgEl('polygon');
      setAttrs(arrow, { points: `${x2},${y2} ${aw1x},${aw1y} ${aw2x},${aw2y}`, fill: t.border });
      svg.appendChild(arrow);

      if (e.label) {
        const el = svgText((x1 + x2) / 2, (y1 + y2) / 2 - 10, e.label, 'relu-diagram-edge-label');
        el.setAttribute('text-anchor', 'middle');
        el.setAttribute('fill', t.textMuted); el.setAttribute('font-size', '11');
        svg.appendChild(el);
      }
    }
  }

  // Nodes
  for (const n of ast.nodes) {
    const pos = nodePositions[n.id];
    if (!pos) continue;
    const circle = svgEl('circle');
    setAttrs(circle, { cx: pos.x, cy: pos.y, r: nodeRadius, fill: t.surface, stroke: t.accent, 'stroke-width': 1.5 });
    svg.appendChild(circle);

    // Multi-line label
    const words = n.label.split(' ');
    const lines = [];
    let cur = '';
    for (const wd of words) {
      const test = cur ? cur + ' ' + wd : wd;
      if (test.length > 12 && cur) { lines.push(cur); cur = wd; }
      else { cur = test; }
    }
    if (cur) lines.push(cur);

    const lh = 15, startY = pos.y - ((lines.length - 1) * lh) / 2;
    for (let li = 0; li < lines.length; li++) {
      const nl = svgText(pos.x, startY + li * lh + 5, lines[li]);
      nl.setAttribute('text-anchor', 'middle'); nl.setAttribute('fill', t.text);
      nl.setAttribute('font-size', '11'); nl.setAttribute('font-weight', '500');
      svg.appendChild(nl);
    }
  }

  if (ast.caption) {
    const cap = svgText(pad, svgH - 8, ast.caption);
    cap.setAttribute('font-size', '11'); cap.setAttribute('fill', t.textMuted);
    cap.setAttribute('font-style', 'italic');
    svg.appendChild(cap);
  }
  return svg;
}

// ============================================================
//  BAR / COMPARISON CHART
// ============================================================
function renderChart(ast, t, w) {
  const svg = svgEl('svg');
  const padL = 120, padR = 30, padT = 50, padB = 60;
  const chartW = w - padL - padR, barH = 28, barGap = 10;
  const bars = ast.bars, nBars = bars.length;
  const svgH = padT + nBars * (barH + barGap) + padB;

  setAttrs(svg, { width: w, height: svgH, viewBox: `0 0 ${w} ${svgH}`, role: 'img', 'aria-label': ast.title || 'Bar chart' });

  if (ast.title) {
    const titleEl = svgText(padL, 25, ast.title);
    titleEl.setAttribute('font-size', '14'); titleEl.setAttribute('font-weight', '600');
    titleEl.setAttribute('fill', t.text);
    svg.appendChild(titleEl);
  }

  if (ast.xLabel) {
    const xl = svgText(padL + chartW / 2, svgH - 8, ast.xLabel);
    xl.setAttribute('text-anchor', 'middle'); xl.setAttribute('fill', t.textMuted);
    xl.setAttribute('font-size', '11');
    svg.appendChild(xl);
  }

  const maxVal = Math.max(...bars.map(b => b.value), 0.01);
  for (let pct = 0; pct <= 100; pct += 25) {
    const frac = pct / 100, gx = padL + frac * chartW;
    const gyBot = padT + nBars * (barH + barGap) - barGap;
    const gl = svgEl('line');
    setAttrs(gl, { x1: gx, y1: padT, x2: gx, y2: gyBot, stroke: t.gridLine, 'stroke-width': 0.5 });
    svg.appendChild(gl);
    const glabel = svgText(gx, gyBot + 16, pct + '%');
    glabel.setAttribute('text-anchor', 'middle'); glabel.setAttribute('fill', t.textMuted);
    glabel.setAttribute('font-size', '10');
    svg.appendChild(glabel);
  }

  for (let i = 0; i < nBars; i++) {
    const b = bars[i];
    const valFrac = Math.min(b.value / maxVal, 1), barW = valFrac * chartW;
    const by = padT + i * (barH + barGap), color = b.color || t.diagTeal;

    const lbl = svgText(padL - 10, by + barH / 2 + 5, b.label);
    lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('fill', t.text);
    lbl.setAttribute('font-size', '12');
    svg.appendChild(lbl);

    const bgRect = svgEl('rect');
    setAttrs(bgRect, { x: padL, y: by, width: chartW, height: barH, fill: t.surface, rx: 4 });
    svg.appendChild(bgRect);

    if (barW > 0) {
      const barRect = svgEl('rect');
      setAttrs(barRect, { x: padL, y: by, width: barW, height: barH, fill: color, rx: 4, opacity: 0.85 });
      svg.appendChild(barRect);
    }

    const pctLabel = Math.round(b.value * 100) + '%';
    const valEl = svgText(padL + barW + 6, by + barH / 2 + 5, pctLabel);
    valEl.setAttribute('fill', barW < chartW * 0.3 ? t.text : '#ffffff');
    valEl.setAttribute('x', barW < chartW * 0.3 ? padL + barW + 6 : padL + barW - 6);
    if (barW >= chartW * 0.3) valEl.setAttribute('text-anchor', 'end');
    valEl.setAttribute('font-size', '12'); valEl.setAttribute('font-weight', '600');
    svg.appendChild(valEl);
  }

  if (ast.caption) {
    const cap = svgText(padL, svgH - 28, ast.caption);
    cap.setAttribute('font-size', '11'); cap.setAttribute('fill', t.textMuted);
    cap.setAttribute('font-style', 'italic');
    svg.appendChild(cap);
  }
  return svg;
}

// ---- Renderer map ----
const RENDERERS = {
  payoff_matrix: renderPayoffMatrix,
  confusion_matrix: renderConfusionMatrix,
  timeline: renderTimeline,
  flow: renderFlow,
  chart: renderChart
};

/**
 * Render an SVG element for the given diagram AST type.
 * @param {Object} ast - Validated diagram AST.
 * @param {Object} t - Theme colour palette.
 * @param {number} w - Max width.
 * @returns {SVGElement}
 */
export function renderByType(ast, t, w) {
  const renderer = RENDERERS[ast.type];
  if (!renderer) throw new Error(`No renderer for type: ${ast.type}`);
  return renderer(ast, t, w);
}

export { THEMES, buildTextFallback, SVG_NS };
