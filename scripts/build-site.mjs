#!/usr/bin/env node
// One command that keeps every generated part of the site in sync:
//   - /learn/ pages (topic, subject hub, index) from the assistant knowledge bases
//   - shared shell (head assets, nav, footer) on every static page
//   - sitemap.xml (+ blog/sitemap.xml copy) with truthful lastmod values
//   - llms.txt discovery file
//   - homepage counts / latest-guides region
//
//   node scripts/build-site.mjs           write changes
//   node scripts/build-site.mjs --check   exit 1 if anything is stale (used by npm test / CI)
//
// lastmod is only advanced when a page's own content changes: the ledger in
// scripts/site/sitemap-state.json stores a hash of each page's <main> region.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './site/shell.mjs';
import { SITE, BOTS, TOOLS, BOOK } from './site/config.mjs';
import { transform, listPages } from './site/apply-shell.mjs';
import { loadBots, loadPosts } from './site/data.mjs';
import { renderAllLearn } from './site/learn.mjs';
import { renderErrors } from './site/errors.mjs';
import { warnings, esc, clip, plain } from './site/render.mjs';

const CHECK = process.argv.includes('--check');
const abs = (rel) => join(ROOT, rel);
const out = new Map(); // relative path -> content
const read = (rel) => readFileSync(abs(rel), 'utf8');
const today = () => new Date().toISOString().slice(0, 10);

const bots = loadBots();
const posts = loadPosts();
const topicTotal = bots.reduce((n, b) => n + b.topics.length, 0);

// ---------- 1. generated /learn/ pages ----------
const learn = renderAllLearn(bots, posts);
for (const p of learn) out.set(`${p.path.slice(1)}index.html`, p.html);

for (const [k, v] of renderErrors()) out.set(k, v);

// ---------- 2. static pages: shared shell + generated regions ----------
const gen = {
  topics: String(topicTotal),
  assistants: String(bots.length),
  guides: String(posts.length),
  tools: String(TOOLS.length),
  'latest-posts': posts.slice(0, 3).map((p) => `<li><a href="/blog/${p.slug}/"><span class="post-date">${new Date(p.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span><strong>${esc(p.title)}</strong><span>${esc(clip(plain(p.excerpt), 130))}</span></a></li>`).join(''),
};
const num = (i) => String(i + 1).padStart(2, '0');
const manifestBots = JSON.parse(read('data/manifest.json')).bots;
gen['subject-rows'] = manifestBots.map((m, i) => {
  const b = bots.find((x) => x.id === m.id);
  const tries = b.cfg.featured.slice(0, 2).map((id) => b.byId.get(id)).map((t) => `<a href="/chat/${b.id}/?q=${encodeURIComponent('Explain ' + t.name).replace(/%20/g, '+')}">${esc(t.name)}</a>`).join('<span aria-hidden="true"> · </span>');
  return `<li class="subject-row reveal"><span class="row-num" aria-hidden="true">${num(i)}</span><div class="row-main"><h3><a href="/chat/${b.id}/">${esc(m.name)}</a></h3><p>${esc(b.cfg.lead)}</p><p class="row-try"><span>Ask about</span> ${tries}</p></div><div class="row-side"><span class="row-count">${b.topics.length} topics</span><a class="row-browse" href="/learn/${b.cfg.slug}/">Browse topics</a><a class="btn btn-secondary btn-sm" href="/chat/${b.id}/">Open chat</a></div></li>`;
}).join('');
gen['tool-rows'] = TOOLS.map((t, i) => `<li class="reveal"><a href="/tools/${t.slug}/"><span class="row-num" aria-hidden="true">${num(i)}</span><strong>${esc(t.name)}</strong><span>${esc(t.blurb)}</span></a></li>`).join('');
const fillGen = (html) => html.replace(/<!--gen:([\w-]+)-->([\s\S]*?)<!--\/gen:\1-->/g, (m, k) => {
  if (!(k in gen)) throw new Error(`Unknown generated region "${k}"`);
  return `<!--gen:${k}-->${gen[k]}<!--/gen:${k}-->`;
});
for (const file of listPages()) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('learn/') || (rel.startsWith('errors/') && out.has(rel))) continue;
  const before = readFileSync(file, 'utf8');
  if (!/<nav\b|<!--shell:nav-->/.test(before)) continue;
  out.set(rel, fillGen(transform(file, before)));
}

// ---------- 3. sitemap ----------
const stateFile = 'scripts/site/sitemap-state.json';
const state = existsSync(abs(stateFile)) ? JSON.parse(read(stateFile)) : {};
const nextState = {};
const mainHash = (html) => {
  const m = html.match(/<main\b[\s\S]*?<\/main>/);
  const body = (m ? m[0] : html).replace(/\?v=[0-9a-f]{8}/g, '');
  return createHash('sha1').update(body).digest('hex').slice(0, 12);
};
function lastmodFor(urlPath, html, fixed) {
  const h = mainHash(html);
  const prev = state[urlPath];
  const lastmod = fixed || (prev && prev.hash === h ? prev.lastmod : today());
  nextState[urlPath] = { hash: h, lastmod };
  return lastmod;
}
const urls = [];
const pageUrl = (rel) => '/' + (rel.endsWith('index.html') ? rel.slice(0, -'index.html'.length) : rel);
const isIndexable = (html) => !/<meta name="robots" content="[^"]*noindex/.test(html);
for (const [rel, html] of [...out.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (rel.startsWith('errors/')) continue;
  if (!isIndexable(html)) continue;
  const u = pageUrl(rel);
  let fixed = null;
  if (rel.startsWith('learn/')) fixed = learn.find((p) => p.path === u)?.lastmod || null; // knowledge-base date is the truthful one
  urls.push({ loc: SITE + u, lastmod: lastmodFor(u, html, fixed), rel, html, depth: u.split('/').length });
}
// order: home first, then top-level sections, then the rest
const weight = (u) => (u.loc === SITE + '/' ? 0 : /^https:\/\/relu\.chat\/(chat|learn|tools|blog)\/$|how-it-works/.test(u.loc) ? 1 : 2);
urls.sort((a, b) => weight(a) - weight(b) || a.loc.localeCompare(b.loc));
const imageFor = (u) => {
  if (!u.rel.startsWith('blog/') || u.rel === 'blog/index.html') return '';
  const og = u.html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
  const title = u.html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/);
  return og ? `\n    <image:image>\n      <image:loc>${og[1]}</image:loc>${title ? `\n      <image:caption>${title[1]}</image:caption>` : ''}\n    </image:image>` : '';
};
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>${imageFor(u)}\n  </url>`).join('\n')}
</urlset>
`;
out.set('sitemap.xml', sitemap);
out.set('blog/sitemap.xml', sitemap);
out.set(stateFile, JSON.stringify(Object.fromEntries(Object.entries(nextState).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');

// ---------- 4. llms.txt ----------
const manifest = JSON.parse(read('data/manifest.json'));
const llms = `# ReLU.chat

> ${bots.length} free learning assistants, ${topicTotal} explained topics, ${TOOLS.length} interactive ML tools and ${posts.length} worked-example guides. Chat questions are processed locally in the browser; page and optional model downloads use the network.

## Learn (one page per concept: definition, intuition, example, math)
${bots.map((b) => `- [${b.cfg.subject}](${SITE}/learn/${b.cfg.slug}/): ${b.topics.length} topics. ${b.cfg.lead}`).join('\n')}
- [All topics](${SITE}/learn/)

## Chat assistants
${manifest.bots.map((m) => `- [${m.name}](${SITE}${m.url}): ${m.description} ${m.topic_count} topics.`).join('\n')}

## Interactive tools
${TOOLS.map((t) => `- [${t.name}](${SITE}/tools/${t.slug}/)`).join('\n')}

## Guides and architecture
- [Learning guides](${SITE}/blog/) (${posts.length} articles, RSS: ${SITE}/blog/feed.xml)
- [How it works: architecture and limits](${SITE}/how-it-works.html)
- [Policy evaluation](${SITE}/data/policy-evaluation.json)
- [Full text for LLMs](${SITE}/llms-full.txt)
- [Source code (MIT)](https://github.com/yunusemrejr/relu-chat)

## From the makers
- [${BOOK.title}](${BOOK.url}): a practical book about the human, economic and strategic advantages that stay valuable as AI takes on cognitive work.

These are curated retrieval assistants, not general-purpose language models. They can misunderstand questions and do not execute code or solve arbitrary exercises. Offline use requires previously loaded assets.
`;
out.set('llms.txt', llms);

// llms-full.txt keeps its hand/engine-written body; the topic index between markers is generated.
const topicIndex = bots.map((b) => `### ${b.cfg.subject}\n${b.topics.map((t) => `- [${t.name}](${SITE}/learn/${b.cfg.slug}/${t.slug}/): ${plain(t.summary)}`).join('\n')}`).join('\n\n');
const learnBlock = `<!-- learn:start -->\n## Learn: ${topicTotal} explained topics\n\n${topicIndex}\n<!-- learn:end -->\n`;
let full = read('llms-full.txt');
full = /<!-- learn:start -->[\s\S]*<!-- learn:end -->\n?/.test(full) ? full.replace(/<!-- learn:start -->[\s\S]*<!-- learn:end -->\n?/, () => learnBlock) : full.replace(/\n*$/, '\n\n') + learnBlock;
out.set('llms-full.txt', full);

// ---------- write / check ----------
let stale = 0;
const written = [];
for (const [rel, content] of out) {
  const cur = existsSync(abs(rel)) ? read(rel) : null;
  if (cur === content) continue;
  stale++;
  written.push(rel);
  if (!CHECK) { mkdirSync(dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), content); }
}
// remove learn/ files that no longer correspond to a generated page
(function prune(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { prune(full); if (!CHECK && !readdirSync(full).length) rmSync(full, { recursive: true }); continue; }
    const rel = relative(ROOT, full).replace(/\\/g, '/');
    if (!out.has(rel)) { stale++; written.push(`${rel} (removed)`); if (!CHECK) rmSync(full); }
  }
})(abs('learn'));

for (const w of [...new Set(warnings)]) console.warn('warning:', w);
console.log(`${CHECK ? 'stale' : 'updated'}: ${stale} file(s); learn pages: ${learn.length} (${learn.filter((p) => p.indexable).length} indexable); sitemap URLs: ${urls.length}`);
if (CHECK && stale) { console.log(written.slice(0, 15).join('\n')); console.log('Run: node scripts/build-site.mjs'); process.exit(1); }
