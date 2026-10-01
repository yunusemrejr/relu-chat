'use strict';
// Generative "plates": one small picture per subject, deterministic from a seed
// (a topic or post slug), so every page gets its own illustration without any
// stored image files. Each plate is drawn from the subject's own vocabulary:
//   game theory   payoff matrix, best-response arrows, one Nash cell
//   golden age    eight-point star tiling (girih-style geometry)
//   data science  scatter, fitted line, residuals, histogram
//   RL            grid world with a value heat-trail to the goal
//   linear alg.   unit square sheared by a matrix, eigen-directions
//   web platform  stacked windows and a message crossing between threads
// No text is drawn, so the same markup works inline and as a standalone .svg.
// Classes a-draw / a-pop / a-fade are animation hooks (see shared-design.css);
// the static state is the finished picture.

const COLORS = {
  'game-theory': '#f4b73f',
  'golden-age': '#36c6b3',
  'data-science': '#5aaaf5',
  'reinforcement-learning': '#9bd54a',
  'linear-algebra': '#f26da6',
  'web-platform': '#a994ff',
  brand: '#ff6b4a',
};
const INK = '#0d1210';
const PAPER = '#f3f5f2';
const W = 480, H = 320;

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = hashStr(String(seed));
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const f = (n) => +n.toFixed(1);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const pts = (a) => a.map((p) => `${f(p[0])},${f(p[1])}`).join(' ');

function gameTheory(r, c) {
  const cw = 150, ch = 104, gap = 8, x0 = (W - 2 * cw - gap) / 2 + 14, y0 = 46;
  const nash = [Math.floor(r() * 2), Math.floor(r() * 2)];
  const mate = '#ff6b4a';
  let s = '';
  // strategy tabs: two per player
  for (let i = 0; i < 2; i++) {
    s += `<rect x="${f(x0 - 22)}" y="${f(y0 + i * (ch + gap) + ch * 0.2)}" width="10" height="${f(ch * 0.6)}" rx="5" fill="${INK}" opacity="${i === nash[0] ? 1 : 0.35}"/>`;
    s += `<rect x="${f(x0 + i * (cw + gap) + cw * 0.2)}" y="${f(y0 - 24)}" width="${f(cw * 0.6)}" height="10" rx="5" fill="${INK}" opacity="${i === nash[1] ? 1 : 0.35}"/>`;
  }
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const x = x0 + j * (cw + gap), y = y0 + i * (ch + gap), isN = i === nash[0] && j === nash[1];
    s += `<rect x="${f(x)}" y="${f(y)}" width="${cw}" height="${ch}" rx="14" fill="${isN ? PAPER : 'rgba(255,255,255,.3)'}"/>`;
    const ha = 18 + r() * 62, hb = 18 + r() * 62;
    const base = y + ch - 16;
    s += `<rect class="a-pop" style="--d:${(i * 2 + j) * 90}ms" x="${f(x + cw * 0.22)}" y="${f(base - ha)}" width="${f(cw * 0.22)}" height="${f(ha)}" rx="6" fill="${INK}"/>`;
    s += `<rect class="a-pop" style="--d:${(i * 2 + j) * 90 + 60}ms" x="${f(x + cw * 0.56)}" y="${f(base - hb)}" width="${f(cw * 0.22)}" height="${f(hb)}" rx="6" fill="${isN ? mate : PAPER}"/>`;
    if (isN) s += `<rect class="a-draw" pathLength="1" x="${f(x - 4)}" y="${f(y - 4)}" width="${cw + 8}" height="${ch + 8}" rx="18" fill="none" stroke="${INK}" stroke-width="5"/>`;
  }
  // best-response arrows pointing toward the equilibrium cell
  const nx = x0 + nash[1] * (cw + gap) + cw / 2, ny = y0 + nash[0] * (ch + gap) + ch / 2;
  for (let j = 0; j < 2; j++) if (j !== nash[1]) {
    const ax = x0 + j * (cw + gap) + cw / 2, dir = nx > ax ? 1 : -1, mx = (ax + nx) / 2;
    s += `<path class="a-fade" d="M${f(mx - dir * 9)} ${f(ny - 13)}l${dir * 18} 13l${-dir * 18} 13z" fill="${INK}"/>`;
  }
  for (let i = 0; i < 2; i++) if (i !== nash[0]) {
    const ay = y0 + i * (ch + gap) + ch / 2, dir = ny > ay ? 1 : -1, my = (ay + ny) / 2;
    s += `<path class="a-fade" d="M${f(nx - 13)} ${f(my - dir * 9)}l13 ${dir * 18}l13 ${-dir * 18}z" fill="${INK}"/>`;
  }
  return s;
}

function goldenAge(r, c) {
  const R = 47, cols = 5, rows = 3, sx = R * 1.86, sy = R * 1.86;
  const rot = (r() * 22.5) * Math.PI / 180;
  const fills = [PAPER, '#ff6b4a', INK, '#f4b73f'];
  let s = '';
  const ox = W / 2 - ((cols - 1) * sx) / 2, oy = H / 2 - ((rows - 1) * sy) / 2;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const cx = ox + j * sx, cy = oy + i * sy;
    const v = []; for (let k = 0; k < 8; k++) { const a = rot + k * Math.PI / 4; v.push([cx + Math.cos(a) * R, cy + Math.sin(a) * R]); }
    const star = [0, 3, 6, 1, 4, 7, 2, 5, 0].map((k) => v[k]);
    const fill = r() < 0.34 ? pick(r, fills) : 'none';
    if (fill !== 'none') s += `<polygon points="${pts(v)}" fill="${fill}" opacity="${fill === INK ? 0.9 : 0.95}"/>`;
    s += `<polyline class="a-draw" pathLength="1" style="--d:${(i * cols + j) * 55}ms" points="${pts(star)}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
    // small lozenge between stars
    if (j < cols - 1 && i < rows - 1) {
      const mx = cx + sx / 2, my = cy + sy / 2, d = R * 0.34;
      s += `<polygon class="a-fade" points="${pts([[mx, my - d], [mx + d, my], [mx, my + d], [mx - d, my]])}" fill="${INK}"/>`;
    }
  }
  return s;
}

function dataScience(r, c) {
  const slope = (r() * 0.9 - 0.45), icpt = H * 0.5 + (r() - 0.5) * 40;
  const x0 = 56, x1 = W - 40;
  const line = (x) => icpt + (x - W / 2) * -Math.abs(slope) * (r.flip ? 1 : 1);
  const sgn = slope >= 0 ? -1 : 1; // plotted y grows downward
  const y = (x) => icpt + (x - W / 2) * Math.abs(slope) * sgn * 1.0;
  let s = '';
  // histogram along the bottom
  const bins = 11; const bw = (x1 - x0) / bins;
  for (let i = 0; i < bins; i++) {
    const t = (i - (bins - 1) / 2) / 2.4, h = 14 + 44 * Math.exp(-t * t) * (0.8 + r() * 0.4);
    s += `<rect class="a-pop" style="--d:${i * 40}ms" x="${f(x0 + i * bw + 3)}" y="${f(H - 28 - h)}" width="${f(bw - 6)}" height="${f(h)}" rx="4" fill="${INK}" opacity="0.88"/>`;
  }
  const n = 34, outlier = Math.floor(r() * n);
  for (let i = 0; i < n; i++) {
    const x = x0 + 16 + r() * (x1 - x0 - 32);
    let yy = y(x) + (r() - 0.5) * 78;
    if (i === outlier) yy = Math.max(46, Math.min(H - 110, y(x) - 90 * (r() < 0.5 ? 1 : -1)));
    yy = Math.max(34, Math.min(H - 100, yy));
    if (i % 3 === 0 && i !== outlier) s += `<line class="a-fade" x1="${f(x)}" y1="${f(yy)}" x2="${f(x)}" y2="${f(y(x))}" stroke="${INK}" stroke-width="1.6" opacity="0.5"/>`;
    s += `<circle class="a-pop" style="--d:${i * 28}ms" cx="${f(x)}" cy="${f(yy)}" r="${i === outlier ? 8 : 6}" fill="${i === outlier ? '#ff6b4a' : i % 2 ? PAPER : INK}" ${i % 2 && i !== outlier ? `stroke="${INK}" stroke-width="2"` : ''}/>`;
  }
  s += `<line class="a-draw" pathLength="1" x1="${x0}" y1="${f(y(x0))}" x2="${x1}" y2="${f(y(x1))}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;
  return s;
}

function reinforcement(r, c) {
  const cols = 9, rows = 6, cell = 46, ox = (W - cols * cell) / 2, oy = (H - rows * cell) / 2 - 2;
  // walk from the left edge to the goal on the right edge
  let x = 0, y = Math.floor(r() * rows); const goal = [cols - 1, Math.floor(r() * rows)];
  const path = [[x, y]];
  let guard = 0;
  while ((x !== goal[0] || y !== goal[1]) && guard++ < 60) {
    const stepX = x < goal[0] && (r() < 0.62 || y === goal[1]);
    if (stepX) x++; else if (y !== goal[1]) y += y < goal[1] ? 1 : -1; else x++;
    path.push([x, y]);
  }
  const onPath = new Set(path.map((p) => p.join(',')));
  const walls = new Set();
  for (let k = 0; k < 7; k++) { const wx = 1 + Math.floor(r() * (cols - 2)), wy = Math.floor(r() * rows); if (!onPath.has(wx + ',' + wy)) walls.add(wx + ',' + wy); }
  let s = '';
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const key = j + ',' + i, cx = ox + j * cell, cy = oy + i * cell;
    const idx = path.findIndex((p) => p[0] === j && p[1] === i);
    let fill = 'rgba(255,255,255,.22)', op = 1;
    if (walls.has(key)) fill = INK;
    else if (idx >= 0) { fill = PAPER; op = 0.35 + 0.65 * (idx / path.length); }
    s += `<rect class="${idx >= 0 ? 'a-pop' : ''}" ${idx >= 0 ? `style="--d:${idx * 55}ms"` : ''} x="${f(cx + 2)}" y="${f(cy + 2)}" width="${cell - 4}" height="${cell - 4}" rx="9" fill="${fill}" opacity="${f(op)}"/>`;
  }
  const poly = path.map((p) => [ox + p[0] * cell + cell / 2, oy + p[1] * cell + cell / 2]);
  s += `<polyline class="a-draw" pathLength="1" points="${pts(poly)}" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const g = poly[poly.length - 1];
  s += `<circle class="a-fade" cx="${f(g[0])}" cy="${f(g[1])}" r="14" fill="#ff6b4a" stroke="${INK}" stroke-width="4"/>`;
  s += `<circle cx="${f(poly[0][0])}" cy="${f(poly[0][1])}" r="9" fill="${INK}"/>`;
  return s;
}

function linearAlgebra(r, c) {
  const a = 1.0 + r() * 0.6, b = 0.2 + r() * 0.7, cc = (r() - 0.35) * 0.6, d = 0.8 + r() * 0.5;
  const U = 112, cx = 92 + r() * 40, cy = H - 62;
  const P = (x, y) => [cx + x * U, cy - y * U];
  const T = (x, y) => [a * x + b * y, cc * x + d * y];
  const sq = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const tsq = sq.map(([x, y]) => P(...T(x, y)));
  let s = '';
  // the lattice the matrix carries along with the square
  for (let i = -2; i <= 4; i++) for (let j = -2; j <= 4; j++) {
    const q = P(...T(i, j));
    if (q[0] < 14 || q[0] > W - 14 || q[1] < 14 || q[1] > H - 14) continue;
    s += `<circle class="a-pop" style="--d:${(i + 2 + j + 2) * 40}ms" cx="${f(q[0])}" cy="${f(q[1])}" r="4.2" fill="${INK}" opacity="0.5"/>`;
  }
  // directions the matrix only stretches
  const dirs = [[1, 0.25 + r() * 0.5], [-0.3 - r() * 0.3, 1]];
  dirs.forEach(([dx, dy]) => {
    const e = P(dx * 5, dy * 5), e2 = P(-dx * 3, -dy * 3);
    s += `<line class="a-fade" x1="${f(e2[0])}" y1="${f(e2[1])}" x2="${f(e[0])}" y2="${f(e[1])}" stroke="${INK}" stroke-width="2.5" stroke-dasharray="2 9" stroke-linecap="round" opacity="0.75"/>`;
  });
  s += `<polygon points="${pts(sq.map(([x, y]) => P(x, y)))}" fill="none" stroke="${INK}" stroke-width="3" stroke-dasharray="7 8"/>`;
  s += `<polygon class="a-fade" points="${pts(tsq)}" fill="${PAPER}" opacity="0.96"/>`;
  s += `<polygon class="a-draw" pathLength="1" points="${pts(tsq)}" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>`;
  const o = P(0, 0), e1 = P(...T(1, 0)), e2 = P(...T(0, 1));
  [[e1, '#ff6b4a'], [e2, INK]].forEach(([e, col]) => {
    const ang = Math.atan2(e[1] - o[1], e[0] - o[0]), L = 17;
    const h1 = [e[0] - L * Math.cos(ang - 0.42), e[1] - L * Math.sin(ang - 0.42)], h2 = [e[0] - L * Math.cos(ang + 0.42), e[1] - L * Math.sin(ang + 0.42)];
    s += `<line class="a-draw" pathLength="1" x1="${f(o[0])}" y1="${f(o[1])}" x2="${f((e[0] + o[0]) / 2 + (e[0] - o[0]) / 2 - 5 * Math.cos(ang))}" y2="${f((e[1] + o[1]) / 2 + (e[1] - o[1]) / 2 - 5 * Math.sin(ang))}" stroke="${col}" stroke-width="7" stroke-linecap="round"/>`;
    s += `<polygon class="a-fade" points="${pts([e, h1, h2])}" fill="${col}"/>`;
  });
  s += `<circle cx="${f(o[0])}" cy="${f(o[1])}" r="8" fill="${INK}"/>`;
  return s;
}

function webPlatform(r, c) {
  const wins = [
    { x: 40 + r() * 20, y: 34, w: 250, h: 150 },
    { x: 130 + r() * 30, y: 98, w: 250, h: 150 },
    { x: 90 + r() * 40, y: 160 + r() * 8, w: 250, h: 120 },
  ];
  const fills = [PAPER, '#ffffff', INK];
  let s = '';
  wins.forEach((w, i) => {
    const dark = i === 2;
    s += `<g class="a-slide" style="--d:${i * 140}ms"><rect x="${f(w.x)}" y="${f(w.y)}" width="${w.w}" height="${w.h}" rx="16" fill="${fills[i]}" ${dark ? '' : `stroke="${INK}" stroke-width="3"`}/>`;
    s += `<rect x="${f(w.x)}" y="${f(w.y)}" width="${w.w}" height="30" rx="16" fill="${dark ? '#26332e' : INK}"/><rect x="${f(w.x)}" y="${f(w.y + 14)}" width="${w.w}" height="16" fill="${dark ? '#26332e' : INK}"/>`;
    [0, 1, 2].forEach((k) => { s += `<circle cx="${f(w.x + 18 + k * 16)}" cy="${f(w.y + 15)}" r="4.5" fill="${['#ff6b4a', '#f4b73f', '#9bd54a'][k]}"/>`; });
    const bars = 3 + Math.floor(r() * 3);
    for (let k = 0; k < bars; k++) {
      const bw = 60 + r() * (w.w - 110);
      s += `<rect x="${f(w.x + 20)}" y="${f(w.y + 46 + k * 22)}" width="${f(bw)}" height="10" rx="5" fill="${dark ? PAPER : INK}" opacity="${k === 0 ? 0.95 : 0.3}"/>`;
    }
    s += `</g>`;
  });
  // a message hopping between the main thread and a worker
  const y = 300, x0 = 330, x1 = 440;
  s += `<line x1="${x0}" y1="40" x2="${x0}" y2="${y}" stroke="${INK}" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round" opacity="0.6"/>`;
  s += `<line x1="${x1}" y1="40" x2="${x1}" y2="${y}" stroke="${INK}" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round" opacity="0.6"/>`;
  for (let k = 0; k < 5; k++) {
    const yy = 64 + k * 46 + r() * 8, right = k % 2 === 0;
    s += `<path class="a-draw" pathLength="1" style="--d:${k * 120}ms" d="M${right ? x0 : x1} ${f(yy)}L${right ? x1 - 12 : x0 + 12} ${f(yy + 22)}" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
    s += `<rect class="a-pop" style="--d:${k * 120 + 200}ms" x="${f((right ? x1 : x0) - 10)}" y="${f(yy + 14)}" width="20" height="16" rx="5" fill="${k === 2 ? '#ff6b4a' : INK}"/>`;
  }
  return s;
}

function brand(r, c) {
  // the ReLU hinge, large, with dots that switch on as x grows
  let s = `<path class="a-draw" pathLength="1" d="M40 220H210L440 40" fill="none" stroke="${INK}" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`;
  const keys = Object.keys(COLORS).slice(0, 6);
  keys.forEach((k, i) => {
    const t = (i + 0.5) / 6, x = 210 + t * 230 - 0, y = 220 - t * 180 - (i ? 0 : 0);
    s += `<circle class="a-pop" style="--d:${i * 110}ms" cx="${f(x)}" cy="${f(y)}" r="22" fill="${COLORS[k]}" stroke="${INK}" stroke-width="6"/>`;
  });
  s += `<circle cx="210" cy="220" r="14" fill="${PAPER}" stroke="${INK}" stroke-width="6"/>`;
  return s;
}

const DRAW = {
  'game-theory': gameTheory, 'golden-age': goldenAge, 'data-science': dataScience,
  'reinforcement-learning': reinforcement, 'linear-algebra': linearAlgebra, 'web-platform': webPlatform, brand,
};

/** Inner SVG markup (no <svg> wrapper) for a subject, seeded for variety. */
function plateBody(subject, seed) {
  const key = DRAW[subject] ? subject : 'brand';
  return DRAW[key](rng(`${key}:${seed}`), COLORS[key]);
}

/**
 * A complete inline plate. `anim` adds the data attribute fx.js animates on
 * scroll. Decorative: aria-hidden, no title.
 */
function plate(subject, seed = '', { anim = true, className = '' } = {}) {
  const key = DRAW[subject] ? subject : 'brand';
  return `<svg class="plate-svg ${className}"${anim ? ' data-anim' : ''} viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><rect width="${W}" height="${H}" fill="${COLORS[key]}"/>${plateBody(key, seed)}</svg>`;
}

/** Standalone .svg document (for blog covers; 1200x630 canvas, plate centred). */
function coverSvg(subject, seed = '') {
  const key = DRAW[subject] ? subject : 'brand';
  const s = 1.7; // 480x320 -> 816x544
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630"><rect width="1200" height="630" fill="${COLORS[key]}"/><g transform="translate(${f((1200 - W * s) / 2)} ${f((630 - H * s) / 2 + 0)}) scale(${s})">${plateBody(key, seed).replace(/ class="a-[a-z]+"/g, '').replace(/ style="--d:\d+ms"/g, '')}</g></svg>\n`;
}

/** Which subject a guide belongs to, for its cover colour. First matching tag wins. */
const TAG_SUBJECT = [
  ['reinforcement-learning', ['reinforcement-learning', 'policy-network', 'ppo', 'reward-design', 'training', 'cold-start']],
  ['linear-algebra', ['linear-algebra', 'cosine-similarity', 'vectors', 'vector-search', 'embeddings', 'float32', 'float64', 'precision', 'numerical-computing', 'math', 'word2vec']],
  ['game-theory', ['game-theory']],
  ['golden-age', ['history-of-science', 'sources']],
  ['web-platform', ['web-platform', 'browser', 'service-worker', 'pwa', 'webassembly', 'wasm', 'indexeddb', 'offline', 'offline-first', 'caching', 'web-workers', 'accessibility', 'rendering', 'loading', 'storage', 'javascript', 'performance', 'katex', 'animation', 'webgpu']],
  ['data-science', ['data-science', 'evaluation', 'ndcg', 'mrr', 'machine-learning', 'bias', 'bm25', 'retrieval', 'nlp']],
];
function subjectOfPost(post) {
  const tags = new Set(post.tags || []);
  for (const [subject, list] of TAG_SUBJECT) if (list.some((t) => tags.has(t))) return subject;
  return 'data-science';
}


module.exports = { COLORS, INK, PAPER, plate, plateBody, coverSvg, subjectOfPost };
