// Loads the structured content the site is generated from: assistant
// knowledge bases (data/bot-packs) and blog posts (content/blog/posts).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './shell.mjs';
import { BOTS } from './config.mjs';

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

export function slugify(name) {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const wordCount = (s) => (s.replace(/\$[^$]*\$/g, ' m ').match(/[\p{L}\p{N}']+/gu) || []).length;

export function loadBots() {
  const manifest = readJson('data/manifest.json');
  const bots = [];
  for (const m of manifest.bots) {
    const cfg = BOTS[m.id];
    if (!cfg) throw new Error(`No BOTS config for assistant "${m.id}" (add it to scripts/site/config.mjs)`);
    const entries = readJson(`data/bot-packs/${m.id}/entries.json`);
    const frags = readJson(`data/bot-packs/${m.id}/fragments.json`);
    const seen = new Set();
    const topics = entries.map((e) => {
      const f = frags[e.id];
      if (!f) throw new Error(`${m.id}: entry ${e.id} has no fragments`);
      let slug = slugify(e.name);
      if (!slug || seen.has(slug)) slug = `${slug}-${slugify(e.id)}`;
      seen.add(slug);
      const fragments = {};
      let words = 0;
      for (const k of ['def', 'int', 'ex', 'form', 'app']) {
        const arr = (f.fragments?.[k] || []).filter(Boolean);
        if (arr.length) { fragments[k] = arr; words += arr.reduce((n, s) => n + wordCount(s), 0); }
      }
      return {
        id: e.id, name: e.name, slug, summary: e.summary, aliases: e.aliases || [],
        related: e.related || [], fragments, sources: f.sources || [], words,
      };
    });
    const byId = new Map(topics.map((t) => [t.id, t]));
    for (const id of cfg.featured) if (!byId.has(id)) throw new Error(`${m.id}: featured topic "${id}" does not exist`);
    bots.push({ id: m.id, cfg, name: m.name, description: m.description, updated: m.kb_updated || manifest.updated, topics, byId, url: m.url });
  }
  return bots;
}

export function loadPosts() {
  const dir = join(ROOT, 'content/blog/posts');
  const posts = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const p = readJson(`content/blog/posts/${f}`);
    if (p.status && p.status !== 'published') continue;
    if (!existsSync(join(ROOT, 'blog', p.slug, 'index.html'))) continue;
    const tags = Array.isArray(p.tags) ? p.tags : [];
    posts.push({
      slug: p.slug, title: p.title, excerpt: p.excerpt || p.meta_description || '', tags,
      published: p.published_at, updated: p.updated_at || p.published_at,
    });
  }
  posts.sort((a, b) => (b.published || '').localeCompare(a.published || '') || a.slug.localeCompare(b.slug));
  return posts;
}
