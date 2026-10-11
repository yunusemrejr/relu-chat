// Generated visual regions shared by the homepage, /chat/ and /tools/:
// subject panels, tool tiles, guide cards. Plates come from art.cjs.
import { createRequire } from 'node:module';
import { BOTS, TOOLS } from './config.mjs';
import { esc, clip, plain } from './render.mjs';

const require = createRequire(import.meta.url);
const art = require('./art.cjs');
const { SUBJECTS } = require('./instruments.cjs');
const { toolPreview } = require('./figures.cjs');
export const { plate, coverSvg, COLORS, subjectOfPost } = art;

const num = (i) => String(i + 1).padStart(2, '0');
const longDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const ask = (b, t) => `<a href="/chat/${b.id}/?q=${encodeURIComponent('Explain ' + t.name).replace(/%20/g, '+')}">${esc(t.name)}</a>`;

/** Homepage: one sticky colour panel per assistant. */
export function subjectPanels(bots, manifestBots) {
  return manifestBots.map((m, i) => {
    const b = bots.find((x) => x.id === m.id);
    const tries = b.cfg.featured.slice(0, 3).map((id) => ask(b, b.byId.get(id))).join('');
    return `<article class="panel cut" data-subject="${b.cfg.slug}" style="--n:${i}"><div class="panel-copy"><p class="panel-count"><b data-count="${b.topics.length}">${b.topics.length}</b><span>topics</span></p><h3><a href="/chat/${b.id}/">${esc(m.name)}</a></h3><p class="panel-lead">${esc(b.cfg.lead)}</p><p class="panel-try"><span>Try asking</span>${tries}</p><div class="panel-actions"><a class="btn btn-ink" href="/chat/${b.id}/">Open the chat <span class="arrow" aria-hidden="true">→</span></a><a class="panel-link" href="/learn/${b.cfg.slug}/">Read the ${b.topics.length} topics</a></div></div><figure class="panel-art plate" data-subject-figure><div class="instrument-topline"><span>FIG. ${num(i)} / ${esc(b.cfg.subject)}</span><button class="figure-replay" type="button" data-motion-replay aria-label="Replay the ${esc(b.cfg.subject)} illustration">Replay <span aria-hidden="true">↻</span></button></div>${plate(b.cfg.slug, b.id)}<figcaption class="instrument-caption"><strong>${SUBJECTS[b.cfg.slug].name}</strong><span>${SUBJECTS[b.cfg.slug].note}</span></figcaption></figure></article>`;
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

// Preview geometry is shared with the tools directory; actual tools keep their canvases.
export const toolSvg = toolPreview;

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
