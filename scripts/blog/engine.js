/**
 * ReLU.chat Blog Engine
 * Reads JSON posts, generates static HTML, validates content.
 * Private — not part of the open-source repo.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const POSTS_DIR = path.join(ROOT, 'content/blog/posts');
const BLOG_OUT = path.join(ROOT, 'blog');
const SCHEMA_PATH = path.join(__dirname, 'schema.json');
const SITE_URL = 'https://relu.chat';

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function listPostFiles() {
  if (!fs.existsSync(POSTS_DIR)) return [];
  return fs.readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(POSTS_DIR, f));
}

function loadPost(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadAllPosts() {
  return listPostFiles().map(loadPost);
}

function getPublishedPosts() {
  return loadAllPosts()
    .filter(p => p.status === 'published')
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
}

function findBySlug(slug) {
  return loadAllPosts().find(p => p.slug === slug) || null;
}

function validatePost(post) {
  const errors = [];
  const schema = loadSchema();

  for (const field of schema.required) {
    if (!post[field] || (typeof post[field] === 'string' && post[field].trim() === '')) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (post.slug && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(post.slug)) {
    errors.push('Invalid slug format');
  }

  if (post.meta_title && post.meta_title.length > 60) {
    errors.push(`meta_title too long (${post.meta_title.length}/60)`);
  }

  if (post.meta_description && post.meta_description.length > 160) {
    errors.push(`meta_description too long (${post.meta_description.length}/160)`);
  }

  if (post.status === 'published') {
    if (!post.published_at) errors.push('Published post needs published_at');
    if (!post.meta_title) errors.push('Published post needs meta_title');
    if (!post.meta_description) errors.push('Published post needs meta_description');
  }

  // Check duplicate slug
  const existing = findBySlug(post.slug);
  if (existing && existing.id !== post.id) {
    errors.push(`Duplicate slug: ${post.slug}`);
  }

  return errors;
}

function renderMarkdownLite(md) {
  // Minimal markdown → HTML for blog content
  // Handles: headings, paragraphs, bold, italic, links, code blocks, lists, images
  let html = md;

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code${lang ? ` class="lang-${lang}"` : ''}>${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Unordered lists
  html = html.replace(/(?:^- .+\n?)+/gm, (match) => {
    const items = match.trim().split('\n')
      .map(line => `<li>${line.replace(/^- /, '')}</li>`)
      .join('\n');
    return `<ul>\n${items}\n</ul>`;
  });

  // Ordered lists
  html = html.replace(/(?:^\d+\. .+\n?)+/gm, (match) => {
    const items = match.trim().split('\n')
      .map(line => `<li>${line.replace(/^\d+\. /, '')}</li>`)
      .join('\n');
    return `<ol>\n${items}\n</ol>`;
  });

  // Paragraphs — wrap lines not already in block elements
  const lines = html.split('\n\n');
  html = lines.map(block => {
    block = block.trim();
    if (!block) return '';
    if (/^<(h[1-6]|pre|ul|ol|li|hr|div|blockquote|table|img)/.test(block)) return block;
    return `<p>${block}</p>`;
  }).join('\n\n');

  return html;
}

function readingTime(text) {
  const words = text.replace(/[#*`\[\]()!]/g, '').split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 230));
  return minutes;
}

function generatePostHTML(post) {
  // Strip the first H1 from content to avoid duplicate title
  let contentBody = post.content.replace(/^\s*#\s+.+\n?/, '');
  const contentHTML = renderMarkdownLite(contentBody);
  const readMin = readingTime(post.content);
  const canonical = post.canonical || `${SITE_URL}/blog/${post.slug}/`;
  const publishedDate = new Date(post.published_at).toISOString();
  const updatedDate = post.updated_at ? new Date(post.updated_at).toISOString() : publishedDate;
  const ogImage = post.cover_image
    ? (post.cover_image.startsWith('http') ? post.cover_image : `${SITE_URL}/${post.cover_image.replace(/^\//, '')}`)
    : `${SITE_URL}/assets/logo.png`;
  const publishedYear = new Date(post.published_at).getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escapeHTML(post.meta_title || post.title)}</title>
<meta name="description" content="${escapeHTML(post.meta_description || '')}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${canonical}">

<meta property="og:title" content="${escapeHTML(post.meta_title || post.title)}">
<meta property="og:description" content="${escapeHTML(post.meta_description || '')}">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${ogImage}">
<meta property="og:site_name" content="ReLU.chat">
<meta property="article:published_time" content="${publishedDate}">
<meta property="article:modified_time" content="${updatedDate}">
<meta property="article:author" content="${escapeHTML(post.author || 'ReLU.chat')}">
${post.tags ? post.tags.map(t => `<meta property="article:tag" content="${escapeHTML(t)}">`).join('\n') : ''}

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHTML(post.meta_title || post.title)}">
<meta name="twitter:description" content="${escapeHTML(post.meta_description || '')}">
<meta name="twitter:image" content="${ogImage}">

<meta name="theme-color" content="#060708">
<link rel="apple-touch-icon" href="/assets/logo.png">
<link rel="icon" href="/assets/logo.png" type="image/png">
<link rel="stylesheet" href="/assets/fonts/inter.css">
<link rel="stylesheet" href="/assets/shared-design.css">
<link rel="stylesheet" href="/assets/css/blog.css">
</head>
<body>

<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo"><img src="/assets/logo.png" alt="">ReLU.chat</a>
    <ul class="nav-links">
      <li><a href="/#features">Features</a></li>
      <li><a href="/#showcase">Chat</a></li>
      <li><a href="/how-it-works.html">How It Works</a></li>
      <li><a href="/blog/" class="active">Blog</a></li>
    </ul>
    <a href="/#showcase" class="nav-cta"><span class="nav-label">Try Chat</span></a>
  </div>
</nav>

<article class="article-container">
  <div class="article-breadcrumb">
    <a href="/">Home</a><span class="sep">/</span><a href="/blog/">Blog</a><span class="sep">/</span><span>${escapeHTML(post.title)}</span>
  </div>

  ${post.tags && post.tags.length ? `<div class="article-tags">${post.tags.map(t => `<span class="article-tag">${escapeHTML(t)}</span>`).join('')}</div>` : ''}

  <h1 class="article-hero-title">${escapeHTML(post.title)}</h1>

  <div class="article-meta-bar">
    <div class="article-meta-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      <span>${escapeHTML(post.author || 'ReLU.chat')}</span>
    </div>
    <div class="article-meta-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
      <time datetime="${publishedDate}">${formatDate(post.published_at)}</time>
    </div>
    <div class="article-meta-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
      <span>${readMin} min read</span>
    </div>
    ${post.updated_at && post.updated_at !== post.published_at ? `<div class="article-meta-item">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      <span>Updated ${formatDate(post.updated_at)}</span>
    </div>` : ''}
  </div>

  <div class="article-divider"></div>

  ${post.cover_image ? `<img class="article-cover" src="${post.cover_image.startsWith('http') ? post.cover_image : '/' + post.cover_image.replace(/^\//, '')}" alt="${escapeHTML(post.cover_image_alt || post.title)}">` : ''}

  <div class="article-body">
    ${contentHTML}
  </div>

  <div class="article-footer">
    <a href="/blog/" class="back-link">&larr; Back to Blog</a>
    <div class="share-links">
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(canonical)}" target="_blank" rel="noopener" class="share-link" title="Share on X">X</a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(canonical)}" target="_blank" rel="noopener" class="share-link" title="Share on LinkedIn">in</a>
    </div>
  </div>
</article>

<footer>
  <p><a href="/">ReLU.chat</a> — MIT licensed open-source project</p>
  <p style="margin-top:4px"><a href="https://github.com/yunusemrejr/relu-chat">View on GitHub</a></p>
</footer>

</body>
</html>`;
}

function generateIndexHTML(posts) {
  const totalReadMin = posts.reduce((sum, p) => sum + readingTime(p.content), 0);
  const allTags = [...new Set(posts.flatMap(p => p.tags || []))];

  // Featured post (latest)
  const featured = posts[0];
  const featuredReadMin = readingTime(featured.content);
  const featuredExcerpt = featured.excerpt || (featured.meta_description || '').substring(0, 200);

  // Remaining posts
  const remaining = posts.slice(1);

  const featuredHTML = `
    <a href="/blog/${featured.slug}/" class="featured-card">
      <div class="featured-card-inner">
        <div class="featured-card-content">
          <div class="featured-badge">Latest</div>
          ${featured.tags && featured.tags.length ? `<div class="featured-tags">${featured.tags.slice(0, 3).map(t => `<span class="article-tag">${escapeHTML(t)}</span>`).join('')}</div>` : ''}
          <h2 class="featured-title">${escapeHTML(featured.title)}</h2>
          <p class="featured-excerpt">${escapeHTML(featuredExcerpt)}</p>
          <div class="featured-meta">
            <span>${escapeHTML(featured.author || 'ReLU.chat')}</span>
            <span class="featured-dot"></span>
            <time datetime="${new Date(featured.published_at).toISOString()}">${formatDate(featured.published_at)}</time>
            <span class="featured-dot"></span>
            <span>${featuredReadMin} min read</span>
          </div>
          <span class="featured-cta">Read article <span class="featured-arrow">&rarr;</span></span>
        </div>
        <div class="featured-visual">
          ${featured.cover_image ? `<img class="featured-cover-img" src="/${featured.cover_image.replace(/^\//, '')}" alt="${escapeHTML(featured.cover_image_alt || featured.title)}" loading="lazy">` : `<div class="featured-visual-inner"><div class="featured-visual-orb featured-orb-1"></div><div class="featured-visual-orb featured-orb-2"></div><div class="featured-visual-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div></div>`}
        </div>
      </div>
    </a>`;

  const cardsHTML = remaining.map((post, idx) => {
    const href = `/blog/${post.slug}/`;
    const date = formatDate(post.published_at);
    const excerpt = post.excerpt || (post.meta_description || '').substring(0, 160);
    const readMin = readingTime(post.content);
    const dateShort = new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const monthNum = String(new Date(post.published_at).getMonth() + 1).padStart(2, '0');
    const dayNum = String(new Date(post.published_at).getDate()).padStart(2, '0');
    return `
    <a href="${href}" class="blog-card" style="--card-idx:${idx}" data-tags="${(post.tags||[]).join(',')}">
      <div class="blog-card-accent"></div>
      ${post.cover_image ? `<div class="blog-card-img"><img src="/${post.cover_image.replace(/^\//, '')}" alt="${escapeHTML(post.cover_image_alt || post.title)}" loading="lazy"></div>` : `<div class="blog-card-img blog-card-img-placeholder"><div class="blog-card-placeholder-pattern"></div><div class="blog-card-placeholder-inner"><span class="blog-card-date-big">${dayNum}</span><span class="blog-card-date-month">${new Date(post.published_at).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span></div></div>`}
      <div class="blog-card-body">
        <div class="blog-card-top">
          ${post.tags && post.tags.length ? `<div class="blog-card-tags">${post.tags.slice(0, 2).map(t => `<span class="article-tag">${escapeHTML(t)}</span>`).join('')}</div>` : ''}
          <span class="blog-card-read">${readMin} min</span>
        </div>
        <h2 class="blog-card-title">${escapeHTML(post.title)}</h2>
        <p class="blog-card-excerpt">${escapeHTML(excerpt)}</p>
        <div class="blog-card-meta">
          <span>${escapeHTML(post.author || 'ReLU.chat')}</span>
          <span class="dot"></span>
          <time datetime="${new Date(post.published_at).toISOString()}">${date}</time>
        </div>
      </div>
    </a>`;
  }).join('\n');

  const filterPillsHTML = allTags.map(t =>
    `<button class="filter-pill" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Blog — ReLU.chat</title>
<meta name="description" content="Technical articles about on-device AI, browser-based chatbots, NLP, reinforcement learning, and privacy-first machine learning from the ReLU.chat team.">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${SITE_URL}/blog/">

<meta property="og:title" content="Blog — ReLU.chat">
<meta property="og:description" content="Technical articles about on-device AI, browser-based chatbots, NLP, and privacy-first ML.">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}/blog/">
<meta property="og:image" content="${SITE_URL}/assets/logo.png">
<meta property="og:site_name" content="ReLU.chat">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Blog — ReLU.chat">
<meta name="twitter:description" content="Technical articles about on-device AI, browser-based chatbots, NLP, and privacy-first ML.">

<meta name="theme-color" content="#060708">
<link rel="apple-touch-icon" href="/assets/logo.png">
<link rel="icon" href="/assets/logo.png" type="image/png">
<link rel="stylesheet" href="/assets/fonts/inter.css">
<link rel="stylesheet" href="/assets/shared-design.css">
<link rel="stylesheet" href="/assets/css/blog.css">
</head>
<body>

<nav>
  <div class="nav-inner">
    <a href="/" class="nav-logo"><img src="/assets/logo.png" alt="">ReLU.chat</a>
    <ul class="nav-links">
      <li><a href="/#features">Features</a></li>
      <li><a href="/#showcase">Chat</a></li>
      <li><a href="/how-it-works.html">How It Works</a></li>
      <li><a href="/blog/" class="active">Blog</a></li>
    </ul>
    <a href="/#showcase" class="nav-cta"><span class="nav-label">Try Chat</span></a>
  </div>
</nav>

<div class="blog-container">
  <div class="blog-hero">
    <div class="blog-hero-top">
      <div>
        <h1>Blog</h1>
        <p class="blog-hero-sub">Technical articles about on-device AI, browser-based chatbots, NLP, reinforcement learning, and privacy-first machine learning.</p>
        <div class="blog-hero-accent"></div>
      </div>
      <div class="blog-hero-stats">
        <div class="blog-hero-stat"><strong>${posts.length}</strong> articles</div>
        <div class="blog-hero-stat"><strong>${totalReadMin}</strong> min total</div>
      </div>
    </div>
  </div>

  ${featuredHTML}

  ${allTags.length > 0 ? `<div class="filter-bar">
    <span class="filter-label">Topics</span>
    <button class="filter-pill active" data-tag="all">All</button>
    ${filterPillsHTML}
  </div>` : ''}

  ${remaining.length > 0 ? `<div class="blog-grid">${cardsHTML}</div>` : (posts.length === 0 ? `<div class="blog-empty"><h2>No posts yet</h2><p>Check back soon for technical articles and updates.</p></div>` : '')}

</div>

<footer>
  <p><a href="/">ReLU.chat</a> — MIT licensed open-source project</p>
  <p style="margin-top:4px"><a href="https://github.com/yunusemrejr/relu-chat">View on GitHub</a></p>
</footer>

<script>
(function(){
  var pills=document.querySelectorAll('.filter-pill[data-tag]');
  var cards=document.querySelectorAll('.blog-card[data-tags]');
  if(!pills.length)return;
  pills.forEach(function(p){
    p.addEventListener('click',function(){
      pills.forEach(function(x){x.classList.remove('active')});
      p.classList.add('active');
      var tag=p.getAttribute('data-tag');
      cards.forEach(function(c){
        if(tag==='all'){c.style.display='';return}
        var tags=c.getAttribute('data-tags')||'';
        c.style.display=tags.indexOf(tag)>=0?'':'none';
      });
    });
  });
})();
</script>

</body>
</html>`;
}

function generateRSSFeed(posts) {
  const items = posts.slice(0, 20).map(post => {
    const url = `${SITE_URL}/blog/${post.slug}/`;
    const pubDate = new Date(post.published_at).toUTCString();
    return `  <item>
    <title>${escapeHTML(post.title)}</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${escapeHTML(post.meta_description || post.excerpt || '')}</description>
    <author>${escapeHTML(post.author || 'relu@relu.chat')}</author>
    ${post.tags ? post.tags.map(t => `<category>${escapeHTML(t)}</category>`).join('\n    ') : ''}
  </item>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>ReLU.chat Blog</title>
  <link>${SITE_URL}/blog/</link>
  <description>Technical articles about on-device AI, browser-based chatbots, NLP, and privacy-first machine learning.</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/>
  <image>
    <url>${SITE_URL}/assets/logo.png</url>
    <title>ReLU.chat</title>
    <link>${SITE_URL}</link>
  </image>
${items}
</channel>
</rss>`;
}

function generateSitemap(posts) {
  const staticPages = [
    { url: SITE_URL + '/', changefreq: 'weekly', priority: '1.0' },
    { url: SITE_URL + '/how-it-works.html', changefreq: 'monthly', priority: '0.8' },
    { url: SITE_URL + '/blog/', changefreq: 'weekly', priority: '0.9' },
  ];

  const blogPages = posts.map(p => ({
    url: `${SITE_URL}/blog/${p.slug}/`,
    changefreq: 'monthly',
    priority: '0.7',
    lastmod: new Date(p.updated_at || p.published_at).toISOString().split('T')[0]
  }));

  const allPages = [...staticPages, ...blogPages];

  const urls = allPages.map(p => `  <url>
    <loc>${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
    ${p.lastmod ? `<lastmod>${p.lastmod}</lastmod>` : ''}
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function generateRobotsTxt() {
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /data/
Disallow: /dev/
Disallow: /core/
Disallow: /policy/
Disallow: /assets/models/
Disallow: /_backups/

User-agent: GPTBot
Allow: /
Allow: /blog/
Allow: /how-it-works.html

User-agent: ClaudeBot
Allow: /
Allow: /blog/
Allow: /how-it-works.html

User-agent: PerplexityBot
Allow: /
Allow: /blog/
Allow: /how-it-works.html

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`;
}

function generateLLMsTxt() {
  return `# ReLU.chat

> Free, browser-based, privacy-first open-source chatbots that run entirely in your browser. No servers, no LLMs, no tracking.

## Overview

ReLU.chat is an open-source platform for interactive on-device chatbots. All NLP processing happens in the browser using quantized ONNX models (~22MB). The system uses sentence transformers for 384-dimensional embeddings, BM25 sparse retrieval, dense cosine similarity, and a reinforcement-learning-trained MLP policy network.

## Key Pages

- [Home](https://relu.chat/) — Landing page with feature overview
- [How It Works](https://relu.chat/how-it-works.html) — Full technical architecture
- [Blog](https://relu.chat/blog/) — Technical articles on on-device AI and NLP

## Architecture

- **Embedding**: all-MiniLM-L6-v2 (quantized ONNX, 384-dim)
- **Retrieval**: BM25 sparse + dense cosine similarity ensemble
- **Policy**: MLP 25→128→64→6 action heads, RL-trained
- **Runtime**: Pure browser JavaScript, WebAssembly, ONNX Runtime
- **Storage**: Client-side only (IndexedDB, no server state)

## Source Code

GitHub: https://github.com/yunusemrejr/relu-chat
License: MIT

## Contact

For questions about the project, visit the GitHub repository.
`;
}

function generateLLMsFullTxt() {
  return `# ReLU.chat — Full Documentation

> Free, browser-based, privacy-first open-source chatbots. No servers, no LLMs, no tracking.

## What is ReLU.chat?

ReLU.chat is an open-source platform for building and running interactive chatbots entirely in the browser. Unlike cloud-based AI services, ReLU.chat processes all natural language locally using quantized ONNX models, ensuring complete privacy and zero data transmission to external servers.

## Technical Architecture

### Embedding Layer
The system uses the all-MiniLM-L6-v2 sentence transformer model, quantized to ONNX format (~22MB). It converts user queries and knowledge-base entries into 384-dimensional dense vectors for semantic similarity computation.

### Signal Layer
A multi-signal retrieval system combines:
- **BM25 sparse retrieval**: Term-frequency based matching against the knowledge base
- **Dense cosine similarity**: Semantic matching via embedding vectors
- **Entity extraction**: Named entity recognition and boosting
- **Intent classification**: Temperature-calibrated intent scoring
- **Follow-up detection**: Context-aware follow-up query handling

All signals are fused into a 25-feature decision packet.

### Policy Network
A multi-layer perceptron (MLP) with architecture 25→128→64→6 action heads, trained via reinforcement learning. The policy decides how to compose responses from fragment-based knowledge entries. Action heads control:
- Fragment selection strategy
- Response length and detail level
- Connector and transition usage
- Confidence scoring
- Creative vs. factual balance
- Follow-up prompt generation

### Fragment Composition
Responses are composed from knowledge-base fragments connected by linguistic connectors. The system supports LaTeX rendering (via KaTeX), code blocks, and structured data presentation.

### Heuristic Fallback
When the MLP is unavailable (cold start, weight load failure), a parameterized heuristic system provides fallback behavior using 15 decision thresholds.

## Key Features

1. **Complete Privacy**: Zero data leaves the browser. No API calls, no telemetry, no tracking.
2. **Offline Capable**: Works without internet after initial load (PWA with service worker).
3. **Fast Response**: Sub-100ms inference using quantized ONNX models.
4. **Interactive Visualizations**: Built-in tools for data science, game theory, and more.
5. **Extensible Knowledge Base**: Add custom fragments to create domain-specific chatbots.
6. **Reinforcement Learning**: Continuously improving response quality through RL training.

## Source Code Structure

- \`core/\` — NLP engine, chatbot engine, session memory, BM25 scorer, signal layer
- \`policy/\` — Feature extractor, MLP inference, action schema, policy runtime
- \`chat/\` — Individual chatbot implementations (data science, game theory, etc.)
- \`data/\` — Knowledge base fragments, bot configurations, manifest
- \`dev/scripts/\` — PyTorch training, weight export, prompt augmentation
- \`assets/\` — Models, fonts, styles, shared design system

## Blog

Technical articles and updates are published at https://relu.chat/blog/

## Links

- Source: https://github.com/yunusemrejr/relu-chat
- License: MIT
- How It Works: https://relu.chat/how-it-works.html
`;
}

// Helpers
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

module.exports = {
  loadSchema, listPostFiles, loadPost, loadAllPosts,
  getPublishedPosts, findBySlug, validatePost,
  renderMarkdownLite, generatePostHTML, generateIndexHTML,
  generateRSSFeed, generateSitemap, generateRobotsTxt,
  generateLLMsTxt, generateLLMsFullTxt,
  escapeHTML, formatDate, POSTS_DIR, BLOG_OUT, SITE_URL
};
