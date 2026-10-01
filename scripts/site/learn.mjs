// Generates /learn/: one crawlable page per assistant topic, a hub per
// subject and a global index. Everything is derived from data/bot-packs, so a
// topic added to a knowledge base gets a page, a sitemap entry and internal
// links on the next build with no manual step.
import { SITE, BOOK_COPY, TOOLS, BOTS } from './config.mjs';
import { bookCard } from './book.mjs';
import { esc, richText, plain, clip, fmtDate, breadcrumbLd, orgLd, authorLd, document_ } from './render.mjs';
import { plate } from './home.mjs';
import { versioned } from './shell.mjs';

// Topics with fewer own words than this stay out of the index (noindex,follow)
// and the sitemap until the knowledge base grows them. Avoids thin pages.
export const MIN_INDEX_WORDS = 70;

const topicUrl = (bot, t) => `/learn/${bot.cfg.slug}/${t.slug}/`;
const chatLink = (bot, t) => `/chat/${bot.id}/?q=${encodeURIComponent('Explain ' + t.name).replace(/%20/g, '+')}`;
const ogFor = (bot) => `/assets/og/${bot.cfg.slug}.png`;

const STOP = new Set(['the', 'and', 'for', 'with', 'of', 'in', 'to', 'a', 'an', 'is', 'on', 'game', 'theory', 'basics', 'analysis']);
const tokens = (s) => [...new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9+-]{2,}/g) || []).filter((w) => !STOP.has(w)))];

function relatedPosts(topic, posts) {
  const names = [topic.name, ...topic.aliases].map((s) => s.toLowerCase());
  const toks = tokens(topic.name);
  const scored = [];
  for (const p of posts) {
    const title = p.title.toLowerCase();
    const hay = `${p.excerpt} ${p.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const n of names) if (n.length > 3 && title.includes(n)) score += 4;
    for (const w of toks) { if (title.includes(w)) score += 2; if (p.tags.some((t) => t.includes(w))) score += 2; if (hay.includes(w)) score += 1; }
    if (score >= 3) scored.push({ p, score });
  }
  return scored.sort((a, b) => b.score - a.score || (b.p.published || '').localeCompare(a.p.published || '')).slice(0, 3).map((s) => s.p);
}

function relatedTools(topic) {
  const hay = `${topic.name} ${topic.aliases.join(' ')} ${topic.summary}`.toLowerCase();
  return TOOLS.map((t) => ({ t, score: t.terms.filter((term) => hay.includes(term)).length })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.t);
}

function relatedTopics(bot, topic) {
  const out = []; const seen = new Set([topic.id]);
  const add = (t) => { if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t); } };
  topic.related.forEach((id) => add(bot.byId.get(id)));
  // reverse links keep the graph connected in both directions
  bot.topics.forEach((t) => { if (t.related.includes(topic.id)) add(t); });
  return out.slice(0, 6);
}

function topicBody(bot, topic, ctx) {
  const L = bot.cfg.labels;
  const sections = Object.keys(topic.fragments).map((k) => ({ k, id: { def: 'definition', int: 'intuition', ex: 'example', form: 'details', app: 'applications' }[k], label: L[k] }));
  const toc = sections.map((s) => `<li><a href="#${s.id}">${esc(s.label)}</a></li>`).join('');
  const where = `${bot.id}/${topic.id}`;
  const sec = sections.map((s) => `<section class="topic-section" id="${s.id}"><h2>${esc(s.label)}</h2>${topic.fragments[s.k].map((f) => `<p>${richText(f, where)}</p>`).join('')}</section>`).join('\n');
  const rel = relatedTopics(bot, topic);
  const relHtml = rel.length ? `<section class="topic-related" id="related"><h2>Related topics</h2><ul class="topic-cards">${rel.map((r) => `<li><a href="${topicUrl(bot, r)}"><strong>${esc(r.name)}</strong><span>${esc(clip(plain(r.summary), 120))}</span></a></li>`).join('')}</ul></section>` : '';
  const posts = relatedPosts(topic, ctx.posts);
  const tools = relatedTools(topic);
  const deeper = posts.length || tools.length
    ? `<section class="topic-deeper" id="go-deeper"><h2>Go deeper</h2><ul class="deeper-list">${posts.map((p) => `<li><span class="deeper-kind">Guide</span><a href="/blog/${p.slug}/">${esc(p.title)}</a></li>`).join('')}${tools.map((t) => `<li><span class="deeper-kind">Interactive</span><a href="/tools/${t.slug}/">${esc(t.name)}</a></li>`).join('')}</ul></section>`
    : '';
  const idx = bot.topics.indexOf(topic);
  const near = [-2, -1, 1, 2].map((d) => bot.topics[idx + d]).filter(Boolean);
  const more = near.length ? `<section class="topic-more"><h2>More in ${esc(bot.cfg.subject)}</h2><ul class="topic-chips">${near.map((t) => `<li><a href="${topicUrl(bot, t)}">${esc(t.name)}</a></li>`).join('')}<li><a class="chip-all" href="/learn/${bot.cfg.slug}/">All ${bot.topics.length} topics</a></li></ul></section>` : '';
  const sources = topic.sources.length ? `<section class="topic-sources" id="sources"><h2>Sources</h2><ul>${topic.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a></li>`).join('')}</ul></section>` : '';
  const trail = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/learn/">Learn</a></li><li><a href="/learn/${bot.cfg.slug}/">${esc(bot.cfg.subject)}</a></li><li aria-current="page">${esc(topic.name)}</li></ol></nav>`;
  const mins = Math.max(1, Math.round(topic.words / 200));
  return `<article class="topic" data-subject="${bot.cfg.slug}">
<header class="topic-hero cut">
<div class="topic-hero-text">
${trail}
<p class="kicker"><a href="/learn/${bot.cfg.slug}/">${esc(bot.cfg.subject)}</a></p>
<h1>${esc(topic.name)}</h1>
<p class="topic-lead">${richText(topic.summary, where)}</p>
<div class="topic-actions"><a class="btn btn-ink" href="${chatLink(bot, topic)}">Ask the ${esc(bot.cfg.subject)} assistant <span class="arrow" aria-hidden="true">→</span></a><span class="topic-meta">${mins} min read · Updated ${fmtDate(bot.updated)}</span></div>
</div>
<div class="topic-hero-art plate">${plate(bot.cfg.slug, topic.slug)}</div>
</header>
<div class="topic-main">
<nav class="topic-toc" aria-label="On this page"><span>On this page</span><ol>${toc}${rel.length ? '<li><a href="#related">Related topics</a></li>' : ''}</ol></nav>
<div class="topic-body">
${sec}
</div>
${relHtml}
${deeper}
<aside class="topic-ask" aria-label="Ask a follow-up"><div><h2>Still unsure?</h2><p>Ask a follow-up in the ${esc(bot.cfg.subject)} assistant. It answers in your browser and keeps the conversation on your device.</p></div><a class="btn btn-subject" href="${chatLink(bot, topic)}">Open the assistant <span class="arrow" aria-hidden="true">→</span></a></aside>
${bookCard(BOOK_COPY[bot.cfg.kind])}
${sources}
${more}
<p class="topic-note">Assembled from the ReLU.chat curated knowledge base. These explanations are concise on purpose; check the sources for anything important.</p>
</div>
</article>`;
}

export function renderTopic(bot, topic, ctx) {
  const url = topicUrl(bot, topic);
  const longTitle = `${topic.name}: ${bot.cfg.titleSuffix} | ReLU.chat`;
  const title = longTitle.length <= 68 ? longTitle : `${topic.name} explained | ReLU.chat`;
  const indexable = topic.words >= MIN_INDEX_WORDS;
  const description = clip(`${plain(topic.summary)} ${bot.cfg.subject}: definition, worked example and related topics.`, 158);
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['Article', 'LearningResource'], '@id': `${SITE}${url}#article`, url: SITE + url, mainEntityOfPage: SITE + url,
        headline: clip(`${topic.name}: ${bot.cfg.titleSuffix}`, 110), description: plain(topic.summary), inLanguage: 'en', isAccessibleForFree: true,
        datePublished: bot.updated, dateModified: bot.updated, author: authorLd, publisher: orgLd,
        image: SITE + ogFor(bot), about: { '@type': 'Thing', name: topic.name, description: plain(topic.summary) },
        teaches: topic.name, learningResourceType: 'explanation', isPartOf: { '@id': `${SITE}/learn/${bot.cfg.slug}/#collection` },
      },
      breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Learn', path: '/learn/' }, { name: bot.cfg.subject, path: `/learn/${bot.cfg.slug}/` }, { name: topic.name, path: url }]),
    ],
  };
  const html = document_({
    title, description, path: url, og: ogFor(bot), ld, section: 'learn', css: ['/assets/css/learn.css', '/assets/css/remain-valuable.css'], katexCss: true,
    robots: indexable ? 'index, follow, max-snippet:-1, max-image-preview:large' : 'noindex, follow',
    body: topicBody(bot, topic, ctx),
  });
  return { path: url, html, indexable, lastmod: bot.updated };
}

function groupAZ(topics) {
  const groups = new Map();
  [...topics].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })).forEach((t) => {
    const k = (t.name.normalize('NFKD').replace(/[^A-Za-z]/g, '')[0] || '#').toUpperCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  });
  return [...groups.entries()];
}

export function renderBotHub(bot) {
  const url = `/learn/${bot.cfg.slug}/`;
  const n = bot.topics.length;
  const title = `${bot.cfg.subject}: ${n} topics explained with examples | ReLU.chat`;
  const description = clip(`${bot.cfg.lead} ${n} concepts with definitions, worked examples and a free chat assistant.`, 158);
  const groups = groupAZ(bot.topics);
  const jump = groups.map(([k]) => `<li><a href="#az-${k}">${k}</a></li>`).join('');
  const list = groups.map(([k, ts]) => `<section class="az-group" id="az-${k}"><h2>${k}</h2><ul class="az-list">${ts.map((t) => `<li><a href="${topicUrl(bot, t)}"><strong>${esc(t.name)}</strong><span>${esc(clip(plain(t.summary), 140))}</span></a></li>`).join('')}</ul></section>`).join('\n');
  const feat = bot.cfg.featured.map((id) => bot.byId.get(id));
  const body = `<div class="hub" data-subject="${bot.cfg.slug}">
<header class="topic-hero cut hub-hero">
<div class="topic-hero-text">
<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li><a href="/learn/">Learn</a></li><li aria-current="page">${esc(bot.cfg.subject)}</li></ol></nav>
<p class="kicker">${n} topics</p><h1>${esc(bot.cfg.subject)}</h1><p class="topic-lead">${esc(bot.cfg.lead)}</p>
<div class="topic-actions"><a class="btn btn-ink" href="/chat/${bot.id}/">Chat with the ${esc(bot.cfg.subject)} assistant <span class="arrow" aria-hidden="true">→</span></a><span class="topic-meta">Start with: ${feat.map((t) => `<a href="${topicUrl(bot, t)}">${esc(t.name)}</a>`).join(', ')}</span></div>
</div>
<div class="topic-hero-art plate">${plate(bot.cfg.slug, bot.id + 'hub')}</div>
</header>
<div class="hub-main">
<nav class="az-jump" aria-label="Jump to letter"><ol>${jump}</ol></nav>
${list}
${bookCard(BOOK_COPY[bot.cfg.kind])}
</div>
</div>`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${SITE}${url}#collection`, url: SITE + url, name: `${bot.cfg.subject}: topics explained`, description: bot.cfg.lead, inLanguage: 'en', isAccessibleForFree: true, dateModified: bot.updated, publisher: orgLd,
        mainEntity: { '@type': 'ItemList', numberOfItems: n, itemListElement: bot.topics.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: SITE + topicUrl(bot, t) })) } },
      breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Learn', path: '/learn/' }, { name: bot.cfg.subject, path: url }]),
    ],
  };
  return { path: url, html: document_({ title, description, path: url, og: ogFor(bot), ld, section: 'learn', css: ['/assets/css/learn.css', '/assets/css/remain-valuable.css'], body, robots: 'index, follow, max-snippet:-1, max-image-preview:large' }), indexable: true, lastmod: bot.updated };
}

export function renderLearnHub(bots) {
  const url = '/learn/';
  const total = bots.reduce((n, b) => n + b.topics.length, 0);
  const title = `Learn: ${total} topics across ${bots.length} subjects | ReLU.chat`;
  const description = clip(`Plain-language explanations with the math shown: game theory, data science, reinforcement learning, linear algebra, the web platform and the Islamic Golden Age. ${total} topics, free.`, 158);
  const cards = bots.map((b) => `<li class="tile cut reveal" id="${b.cfg.slug}" data-subject="${b.cfg.slug}"><div class="tile-art plate">${plate(b.cfg.slug, b.id + 'learn')}</div><div class="tile-body"><p class="tile-count"><b>${b.topics.length}</b> topics</p><h2><a href="/learn/${b.cfg.slug}/">${esc(b.cfg.subject)}</a></h2><p>${esc(b.cfg.lead)}</p><p class="tile-try">${b.cfg.featured.map((id) => b.byId.get(id)).map((t) => `<a href="${topicUrl(b, t)}">${esc(t.name)}</a>`).join('')}</p><div class="tile-actions"><a class="btn btn-ink btn-sm" href="/learn/${b.cfg.slug}/">All ${b.topics.length} topics <span class="arrow" aria-hidden="true">→</span></a><a class="panel-link" href="/chat/${b.id}/">Ask the assistant</a></div></div></li>`).join('\n');
  const index = bots.map((b) => `<section class="index-group" data-subject="${b.cfg.slug}" data-label="${esc(b.cfg.subject)}"><h3>${esc(b.cfg.subject)}</h3><ul class="index-list">${b.topics.map((t) => `<li data-name="${esc((t.name + ' ' + t.aliases.join(' ')).toLowerCase())}"><a href="${topicUrl(b, t)}">${esc(t.name)}</a></li>`).join('')}</ul></section>`).join('\n');
  const body = `<div class="hub">
<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li><li aria-current="page">Learn</li></ol></nav>
<header class="hub-head"><p class="kicker">Free · No account</p><h1 class="split-words">Learn the concept, then ask about it</h1><p class="topic-lead">${total} short explanations, each with a definition, intuition, a worked example and the math. Every topic links to a chat assistant you can ask follow-ups.</p></header>
<ul class="tile-grid">${cards}</ul>
<section class="index" aria-labelledby="index-h"><div class="index-top"><h2 id="index-h">Every topic</h2><label class="index-search"><span class="sr-only">Filter topics</span><input type="search" id="topic-filter" placeholder="Filter ${total} topics…" autocomplete="off"></label></div><p class="index-empty" id="index-empty" hidden>No topic matches that filter.</p>
${index}</section>
${bookCard(BOOK_COPY.ml)}
</div>`;
  const scripts = `<script src="${versioned('/assets/js/learn-filter.js')}" defer data-cfasync="false"></script>`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'CollectionPage', '@id': `${SITE}${url}#collection`, url: SITE + url, name: 'Learn on ReLU.chat', description, inLanguage: 'en', isAccessibleForFree: true, publisher: orgLd,
        hasPart: bots.map((b) => ({ '@type': 'CollectionPage', name: b.cfg.subject, url: `${SITE}/learn/${b.cfg.slug}/` })) },
      breadcrumbLd([{ name: 'Home', path: '/' }, { name: 'Learn', path: url }]),
    ],
  };
  const latest = bots.map((b) => b.updated).sort().at(-1);
  return { path: url, html: document_({ title, description, path: url, og: '/assets/og/learn.png', ld, section: 'learn', css: ['/assets/css/learn.css', '/assets/css/remain-valuable.css'], body, scripts, robots: 'index, follow, max-snippet:-1, max-image-preview:large' }), indexable: true, lastmod: latest };
}

export function renderAllLearn(bots, posts) {
  const ctx = { posts };
  const pages = [renderLearnHub(bots)];
  for (const bot of bots) {
    pages.push(renderBotHub(bot));
    for (const t of bot.topics) pages.push(renderTopic(bot, t, ctx));
  }
  return pages;
}
