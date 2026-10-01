// Generated visual regions shared by the homepage, /chat/ and /tools/:
// subject panels, tool tiles, guide cards. Plates come from art.cjs.
import { createRequire } from 'node:module';
import { BOTS, TOOLS } from './config.mjs';
import { esc, clip, plain } from './render.mjs';

const require = createRequire(import.meta.url);
const art = require('./art.cjs');
export const { plate, coverSvg, COLORS, subjectOfPost } = art;

const num = (i) => String(i + 1).padStart(2, '0');
const longDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const ask = (b, t) => `<a href="/chat/${b.id}/?q=${encodeURIComponent('Explain ' + t.name).replace(/%20/g, '+')}">${esc(t.name)}</a>`;

/** Homepage: one sticky colour panel per assistant. */
export function subjectPanels(bots, manifestBots) {
  return manifestBots.map((m, i) => {
    const b = bots.find((x) => x.id === m.id);
    const tries = b.cfg.featured.slice(0, 3).map((id) => ask(b, b.byId.get(id))).join('');
    return `<article class="panel cut" data-subject="${b.cfg.slug}" style="--n:${i}"><div class="panel-copy"><p class="panel-count"><b data-count="${b.topics.length}">${b.topics.length}</b><span>topics</span></p><h3><a href="/chat/${b.id}/">${esc(m.name)}</a></h3><p class="panel-lead">${esc(b.cfg.lead)}</p><p class="panel-try"><span>Try asking</span>${tries}</p><div class="panel-actions"><a class="btn btn-ink" href="/chat/${b.id}/">Open the chat <span class="arrow" aria-hidden="true">→</span></a><a class="panel-link" href="/learn/${b.cfg.slug}/">Read the ${b.topics.length} topics</a></div></div><div class="panel-art plate">${plate(b.cfg.slug, b.id)}</div></article>`;
  }).join('');
}

/** /chat/ directory: the same six subjects as a colour-block grid. */
export function chatTiles(bots, manifestBots) {
  return manifestBots.map((m, i) => {
    const b = bots.find((x) => x.id === m.id);
    const tries = b.cfg.featured.slice(0, 2).map((id) => ask(b, b.byId.get(id))).join('');
    return `<li class="tile cut reveal" data-subject="${b.cfg.slug}"><div class="tile-art plate">${plate(b.cfg.slug, b.id + 'tile')}</div><div class="tile-body"><p class="tile-count"><b>${b.topics.length}</b> topics</p><h2><a href="/chat/${b.id}/">${esc(m.name)}</a></h2><p>${esc(b.cfg.lead)}</p><p class="tile-try">${tries}</p><div class="tile-actions"><a class="btn btn-ink btn-sm" href="/chat/${b.id}/">Open chat <span class="arrow" aria-hidden="true">→</span></a><a class="panel-link" href="/learn/${b.cfg.slug}/">Browse topics</a></div></div></li>`;
  }).join('');
}

// ---- tool illustrations (hand-drawn, 200x120) --------------------------------
const toolArt = {
  'neural-network': () => {
    const L = [[40, [30, 60, 90]], [100, [20, 50, 70, 100]], [160, [45, 75]]];
    let s = '';
    for (let a = 0; a < L.length - 1; a++) for (const y1 of L[a][1]) for (const y2 of L[a + 1][1]) s += `<line class="a-fade" x1="${L[a][0]}" y1="${y1}" x2="${L[a + 1][0]}" y2="${y2}" stroke="currentColor" stroke-opacity=".28" stroke-width="1.6"/>`;
    L.forEach(([x, ys], a) => ys.forEach((y, k) => { s += `<circle class="a-pop" style="--d:${a * 120 + k * 50}ms" cx="${x}" cy="${y}" r="8" fill="${(a + k) % 2 ? 'var(--accent)' : 'var(--accent-2)'}" stroke="var(--bg-elevated)" stroke-width="3"/>`; }));
    return s;
  },
  'activation-functions': () => `<path d="M10 100H190M100 12V108" stroke="currentColor" stroke-opacity=".3" stroke-width="1.5" fill="none"/><path class="a-draw" pathLength="1" d="M14 100H100L186 20" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path class="a-draw" style="--d:150ms" pathLength="1" d="M14 98C60 98 70 96 100 60S150 24 186 22" fill="none" stroke="var(--accent-2)" stroke-width="4" stroke-linecap="round"/><path class="a-draw" style="--d:300ms" pathLength="1" d="M14 94C54 93 80 80 100 60S146 26 186 24" fill="none" stroke="var(--cat-3)" stroke-width="3" stroke-linecap="round" stroke-dasharray="1"/>`,
  'gradient-descent': () => {
    const pts = [[34, 22], [58, 52], [78, 74], [92, 88], [100, 94]];
    return `<path d="M14 18C50 126 150 126 186 18" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/><path class="a-draw" pathLength="1" d="M${pts.map((p) => p.join(' ')).join('L')}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-dasharray="1"/>${pts.map((p, i) => `<circle class="a-pop" style="--d:${i * 120}ms" cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 8 : 6}" fill="${i === pts.length - 1 ? 'var(--accent)' : 'var(--bg-elevated)'}" stroke="var(--accent)" stroke-width="3"/>`).join('')}`;
  },
  backpropagation: () => `<g fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="1.6"><path d="M40 35L100 60M40 85L100 60M100 60L160 60"/></g>${[[40, 35], [40, 85], [100, 60], [160, 60]].map(([x, y], i) => `<circle class="a-pop" style="--d:${i * 90}ms" cx="${x}" cy="${y}" r="10" fill="var(--bg-surface)" stroke="currentColor" stroke-opacity=".5" stroke-width="2"/>`).join('')}<path class="a-draw" pathLength="1" d="M148 30C120 14 70 12 44 24" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round"/><path class="a-fade" d="M52 14L40 25L56 31" fill="none" stroke="var(--accent)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path class="a-draw" style="--d:200ms" pathLength="1" d="M148 98C120 112 70 112 44 100" fill="none" stroke="var(--accent-2)" stroke-width="3.5" stroke-linecap="round"/>`,
  'k-means-clustering': () => {
    const C = [['var(--accent)', 54, 40], ['var(--accent-2)', 140, 46], ['var(--cat-3)', 96, 94]];
    let s = '', k = 0;
    C.forEach(([col, cx, cy], ci) => { for (let i = 0; i < 7; i++) { const a = i * 0.9 + ci, r = 10 + ((i * 7 + ci * 5) % 18); s += `<circle class="a-pop" style="--d:${k++ * 35}ms" cx="${(cx + Math.cos(a) * r).toFixed(1)}" cy="${(cy + Math.sin(a) * r * 0.8).toFixed(1)}" r="5" fill="${col}"/>`; } s += `<path class="a-fade" d="M${cx - 8} ${cy}H${cx + 8}M${cx} ${cy - 8}V${cy + 8}" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`; });
    return s;
  },
  'decision-tree': () => `<g fill="none" stroke="currentColor" stroke-opacity=".4" stroke-width="2"><path d="M100 24V44M100 44H56V66M100 44H144V66M56 66V84M56 84H34V100M56 84H78V100M144 66V84M144 84H122V100M144 84H166V100"/></g>${[[100, 20, 'var(--accent)'], [56, 70, 'var(--bg-surface)'], [144, 70, 'var(--bg-surface)']].map(([x, y, f], i) => `<rect class="a-pop" style="--d:${i * 100}ms" x="${x - 14}" y="${y - 10}" width="28" height="20" rx="6" fill="${f}" stroke="currentColor" stroke-opacity=".5" stroke-width="2"/>`).join('')}${[[34, 'var(--accent-2)'], [78, 'var(--accent)'], [122, 'var(--accent-2)'], [166, 'var(--cat-3)']].map(([x, f], i) => `<circle class="a-pop" style="--d:${300 + i * 80}ms" cx="${x}" cy="108" r="9" fill="${f}"/>`).join('')}`,
};

export function toolSvg(slug) {
  const body = (toolArt[slug] || (() => ''))();
  return `<svg class="tool-svg" data-anim viewBox="0 0 200 120" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Homepage + /tools/: one tile per tool. */
export function toolTiles(base = '/tools/') {
  return TOOLS.map((t, i) => `<li class="reveal-pop"><a class="tool-tile" href="${base}${t.slug}/"><div class="tool-pic">${toolSvg(t.slug)}</div><strong>${esc(t.name)}</strong><span>${esc(t.blurb)}</span><i class="tool-go" aria-hidden="true">→</i></a></li>`).join('');
}

/** Homepage: guide cards, the newest one large. */
export function postCards(posts, n = 3) {
  const list = posts.slice(0, n);
  return list.map((p, i) => {
    const subject = subjectOfPost(p);
    const lead = i === 0;
    return `<li class="post${lead ? ' post-lead' : ''} reveal" data-subject="${subject}"><a href="/blog/${p.slug}/"><div class="post-art plate">${plate(subject, p.slug)}</div><div class="post-text"><time datetime="${new Date(p.published).toISOString().slice(0, 10)}">${longDate(p.published)}</time><strong>${esc(p.title)}</strong><span>${esc(clip(plain(p.excerpt), lead ? 170 : 120))}</span></div></a></li>`;
  }).join('');
}
