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
const BLOG_ASSETS_DIR = path.join(ROOT, 'assets/blog');
const SCHEMA_PATH = path.join(__dirname, 'schema.json');
const SITE_URL = 'https://relu.chat';

// Injected before </body> on every generated page (shared with hand-maintained pages).
const GUMROAD_WIDGET = ''; // Contextual product links remain; no interruptive catalogue widget.

// Injected before </head> on every generated page (shared with hand-maintained pages).
const AIF_POPUP = ''; // Reading is never interrupted by timed promotion modals.

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
    .sort((a, b) => {
      const d = new Date(b.published_at) - new Date(a.published_at);
      if (d !== 0) return d;
      const u = new Date(b.updated_at || b.published_at) - new Date(a.updated_at || a.published_at);
      if (u !== 0) return u;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
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

  if (post.published_at && isNaN(new Date(post.published_at).getTime())) {
    errors.push(`published_at is not a valid date: ${post.published_at}`);
  }
  if (post.updated_at && isNaN(new Date(post.updated_at).getTime())) {
    errors.push(`updated_at is not a valid date: ${post.updated_at}`);
  }

  // Check duplicate slug
  const existing = findBySlug(post.slug);
  if (existing && existing.id !== post.id) {
    errors.push(`Duplicate slug: ${post.slug}`);
  }

  return errors;
}

function renderMarkdownLite(md) {
  // Minimal markdown to HTML for blog content.
  // Block-aware: headings, lists, code fences and blockquotes are split into
  // their own blocks even when a paragraph above them has no blank line
  // (naive wrapping produced invalid HTML like <p>...</p><ul> inside <p>).
  const inline = (s) => {
    // Stash code spans, images and links before emphasis runs so that
    // asterisks inside inline code (e.g. `q_a * q_w`) never become <em>.
    const stash = [];
    const stashRe = (re, wrap) => {
      s = s.replace(re, (m, a, b) => {
        stash.push(wrap(a, b));
        return '\u0000' + (stash.length - 1) + '\u0000';
      });
    };
    stashRe(/`([^`]+)`/g, (c) => '<code>' + c + '</code>');
    stashRe(/!\[([^\]]*)\]\(([^)]+)\)/g, (alt, url) => '<img src="' + url + '" alt="' + alt + '" loading="lazy">');
    stashRe(/\[([^\]]+)\]\(([^)]+)\)/g, (txt, url) => '<a href="' + url + '" rel="noopener">' + txt + '</a>');
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (m, i) => stash[+i] || '');
  };

  const esc = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const out = [];
  let para = [];
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  const flushPara = () => {
    if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
  };

  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();

    if (inCode) {
      if (/^```/.test(t)) {
        const langAttr = codeLang ? ' class="lang-' + codeLang + '"' : '';
        out.push('<pre><code' + langAttr + '>' + esc(codeBuf.join('\n') + '\n') + '</code></pre>');
        codeBuf = []; inCode = false; codeLang = '';
      } else {
        codeBuf.push(lines[i]);
      }
      continue;
    }
    if (/^```(\w*)/.test(t)) { flushPara(); inCode = true; codeLang = t.match(/^```(\w*)/)[1] || ''; codeBuf = []; continue; }
    if (t === '') { flushPara(); continue; }
    if (/^#{1,4} /.test(t)) {
      flushPara();
      const level = t.match(/^#+/)[0].length;
      out.push('<h' + level + '>' + inline(t.replace(/^#+\s*/, '')) + '</h' + level + '>');
    } else if (/^[-*] /.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        items.push('<li>' + inline(lines[i].trim().replace(/^[-*]\s*/, '')) + '</li>');
        i++;
      }
      i--;
      out.push('<ul>\n' + items.join('\n') + '\n</ul>');
    } else if (/^\d+\. /.test(t)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\d+\. /.test(lines[i].trim())) {
        items.push('<li>' + inline(lines[i].trim().replace(/^\d+\.\s*/, '')) + '</li>');
        i++;
      }
      i--;
      out.push('<ol>\n' + items.join('\n') + '\n</ol>');
    } else if (/^---+$/.test(t) || /^\*\*\*+$/.test(t)) {
      flushPara();
      out.push('<hr>');
    } else if (/^> /.test(t)) {
      flushPara();
      out.push('<blockquote>' + inline(t.replace(/^>\s*/, '')) + '</blockquote>');
    } else {
      para.push(lines[i].trim());
    }
  }
  if (inCode) out.push('<pre><code>' + esc(codeBuf.join('\n') + '\n') + '</code></pre>');
  flushPara();
  return out.join('\n\n');
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
    : (fs.existsSync(path.join(BLOG_ASSETS_DIR, post.slug + '.png')) ? `${SITE_URL}/assets/blog/${post.slug}.png` : `${SITE_URL}/assets/logo.png`);
  const publishedYear = new Date(post.published_at).getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escapeHTML(post.meta_title || post.title)} — ReLU.chat</title>
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
<link rel="stylesheet" href="/assets/fonts/sora.css">
<link rel="stylesheet" href="/assets/shared-design.css?v=14">
<link rel="stylesheet" href="/assets/css/article.css">

<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      "url": SITE_URL,
      "name": "ReLU.chat",
      "description": "Free, browser-based, privacy-first open-source chatbots"
    },
    {
      "@type": "WebPage",
      "@id": `${canonical}#webpage`,
      "url": canonical,
      "name": post.meta_title || post.title,
      "description": post.meta_description || "",
      "inLanguage": "en",
      "isPartOf": { "@id": `${SITE_URL}/#website` },
      "datePublished": publishedDate,
      "dateModified": updatedDate
    },
    {
      "@type": "Article",
      "@id": `${canonical}#article`,
      "headline": post.title,
      "description": post.meta_description || "",
      "datePublished": publishedDate,
      "dateModified": updatedDate,
      "author": {
        "@type": "Person",
        "name": post.author || "ReLU.chat"
      },
      "publisher": {
        "@type": "Organization",
        "name": "ReLU.chat",
        "url": SITE_URL,
        "logo": {
          "@type": "ImageObject",
          "url": `${SITE_URL}/assets/logo.png`
        }
      },
      "mainEntityOfPage": { "@id": `${canonical}#webpage` },
      "image": ogImage,
      "keywords": post.tags ? post.tags.join(', ') : ''
    }
  ]
}, null, 2)}
</script>

${AIF_POPUP}
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>

<nav aria-label="Primary navigation">
  <div class="nav-inner">
    <a href="/" class="nav-logo"><img src="/assets/logo.png" alt="" width="24" height="24">ReLU.chat</a>
    <ul class="nav-links">
      <li><a href="/#features">Features</a></li>
      <li><a href="/#showcase">Chat</a></li>
      <li><a href="/how-it-works.html">How It Works</a></li>
      <li><a href="/blog/" class="active">Blog</a></li>
    </ul>
    <a href="/#showcase" class="nav-cta"><span class="nav-label">Try Chat</span></a>
  </div>
</nav>

<main id="main-content">
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
</main>

<footer>
  <p><a href="/">ReLU.chat</a> — MIT licensed open-source project</p>
  <p style="margin-top:4px"><a href="https://github.com/yunusemrejr/relu-chat">View on GitHub</a> &middot; <a href="/blog/feed.xml">RSS</a> &middot; <a href="/llms.txt">llms.txt</a></p>
</footer>

${GUMROAD_WIDGET}
</body>
</html>`;
}

function coverSrc(post) {
  if (post.cover_image) {
    return post.cover_image.startsWith('http') ? post.cover_image : '/' + post.cover_image.replace(/^\//, '');
  }
  // No cover in the post data: fall back to the generated default thumbnail.
  return `/assets/blog/${post.slug}.svg`;
}

function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function defaultCoverSvg(post) {
  // Deterministic, on-brand thumbnail (dark, teal accent) derived from the
  // slug. Used for every post without a cover_image so cards never show a
  // bare placeholder. Decorative: alt text is empty in the card markup.
  const rand = mulberry32(hashStr(post.slug));
  const tag = (post.tags && post.tags[0] ? post.tags[0] : 'ml').toUpperCase();
  const W = 1200, H = 630;
  let shapes = '';
  const nodes = [];
  const N = 11;
  for (let i = 0; i < N; i++) {
    nodes.push({ x: 60 + rand() * (W - 120), y: 70 + rand() * (H - 170) });
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 170 * 170) {
        const alpha = (0.10 + rand() * 0.14).toFixed(2);
        shapes += `<line x1="${nodes[i].x.toFixed(0)}" y1="${nodes[i].y.toFixed(0)}" x2="${nodes[j].x.toFixed(0)}" y2="${nodes[j].y.toFixed(0)}" stroke="rgba(20,184,166,${alpha})" stroke-width="1.5"/>`;
      }
    }
  }
  for (const n of nodes) {
    shapes += `<circle cx="${n.x.toFixed(0)}" cy="${n.y.toFixed(0)}" r="${(1.5 + rand() * 2.2).toFixed(1)}" fill="rgba(20,184,166,${(0.22 + rand() * 0.25).toFixed(2)})"/>`;
  }
  const labelX = Math.round(60 + rand() * 40);
  const labelY = H - 78;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#0d1117"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="#151b23" opacity="0.55"/>
  <g>${shapes}</g>
  <line x1="${labelX}" y1="${labelY}" x2="${labelX + 96}" y2="${labelY}" stroke="#14b8a6" stroke-width="3"/>
  <text x="${labelX + 112}" y="${labelY + 10}" font-family="Sora, system-ui, sans-serif" font-size="30" font-weight="600" letter-spacing="7" fill="#f9fafb">${tag}</text>
  <circle cx="${W - 76}" cy="76" r="5" fill="#14b8a6"/>
</svg>
`;
}

function generateDefaultCovers(posts) {
  if (!fs.existsSync(BLOG_ASSETS_DIR)) fs.mkdirSync(BLOG_ASSETS_DIR, { recursive: true });
  let count = 0;
  for (const post of posts) {
    if (post.cover_image) continue;
    const file = path.join(BLOG_ASSETS_DIR, post.slug + '.svg');
    const svg = defaultCoverSvg(post);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== svg) {
      fs.writeFileSync(file, svg);
      count++;
    }
  }
  return count;
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
          <img class="featured-cover-img${featured.cover_image ? '' : ' default-thumb'}" src="${coverSrc(featured)}" alt="${escapeHTML(featured.cover_image_alt || featured.title)}" loading="lazy">
        </div>
      </div>
    </a>`;

  const cardsHTML = remaining.map((post, idx) => {
    const href = `/blog/${post.slug}/`;
    const date = formatDate(post.published_at);
    const excerpt = post.excerpt || (post.meta_description || '').substring(0, 160);
    const readMin = readingTime(post.content);
    const isDefaultCover = !post.cover_image;
    return `
    <a href="${href}" class="blog-card" style="--card-idx:${idx}" data-tags="${(post.tags||[]).join(',')}">
      <div class="blog-card-accent"></div>
      <div class="blog-card-img"><img class="${isDefaultCover ? 'default-thumb' : ''}" src="${coverSrc(post)}" alt="" loading="lazy"></div>
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
<link rel="alternate" type="application/rss+xml" title="ReLU.chat Blog" href="${SITE_URL}/blog/feed.xml">

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
<link rel="stylesheet" href="/assets/fonts/sora.css">
<link rel="stylesheet" href="/assets/shared-design.css?v=14">
<link rel="stylesheet" href="/assets/css/blog-index.css">

<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      "url": SITE_URL,
      "name": "ReLU.chat",
      "description": "Free, browser-based, privacy-first open-source chatbots"
    },
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}/blog/#webpage`,
      "url": `${SITE_URL}/blog/`,
      "name": "Blog — ReLU.chat",
      "description": "Technical articles about on-device AI, browser-based chatbots, NLP, and privacy-first machine learning.",
      "inLanguage": "en",
      "isPartOf": { "@id": `${SITE_URL}/#website` },
      "mainEntity": {
        "@type": "ItemList",
        "itemListElement": posts.map((p, i) => ({
          "@type": "ListItem",
          "position": i + 1,
          "url": `${SITE_URL}/blog/${p.slug}/`
        }))
      }
    }
  ]
}, null, 2)}
</script>

${AIF_POPUP}
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>

<nav aria-label="Primary navigation">
  <div class="nav-inner">
    <a href="/" class="nav-logo"><img src="/assets/logo.png" alt="" width="24" height="24">ReLU.chat</a>
    <ul class="nav-links">
      <li><a href="/#features">Features</a></li>
      <li><a href="/#showcase">Chat</a></li>
      <li><a href="/how-it-works.html">How It Works</a></li>
      <li><a href="/blog/" class="active">Blog</a></li>
    </ul>
    <a href="/#showcase" class="nav-cta"><span class="nav-label">Try Chat</span></a>
  </div>
</nav>

<main id="main-content" class="blog-container">
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

</main>

<footer>
  <p><a href="/">ReLU.chat</a> — MIT licensed open-source project</p>
  <p style="margin-top:4px"><a href="https://github.com/yunusemrejr/relu-chat">View on GitHub</a> &middot; <a href="/blog/feed.xml">RSS</a> &middot; <a href="/llms.txt">llms.txt</a></p>
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

${GUMROAD_WIDGET}
</body>
</html>`;
}

function generateRSSFeed(posts) {
  const items = posts.slice(0, 20).map(post => {
    const url = `${SITE_URL}/blog/${post.slug}/`;
    const pubDate = new Date(post.published_at).toUTCString();
    return `  <item>
    <title>${escapeHTML(post.meta_title || post.title)} — ReLU.chat</title>
    <link>${url}</link>
    <guid isPermaLink="true">${url}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${escapeHTML(post.meta_description || post.excerpt || '')}</description>
    <author>Yunus Emre Vurgun (https://yunusemrevurgun.com)</author>
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
    { url: SITE_URL + '/chat/data-science-chat/', changefreq: 'monthly', priority: '0.8' },
    { url: SITE_URL + '/chat/game-theory-chat/', changefreq: 'monthly', priority: '0.8' },
    { url: SITE_URL + '/chat/golden-age-inquiry/', changefreq: 'monthly', priority: '0.8' },
    { url: SITE_URL + '/tools/', changefreq: 'monthly', priority: '0.7' },
    { url: SITE_URL + '/tools/neural-network/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/gradient-descent/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/backpropagation/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/activation-functions/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/k-means-clustering/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/decision-tree/', changefreq: 'monthly', priority: '0.6' },
  ];

  const bots = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/manifest.json'), 'utf8')).bots;
  staticPages.push({url:SITE_URL+'/chat/',changefreq:'monthly',priority:'0.9',lastmod:'2026-09-09'});
  for (const bot of bots) {
    const existing = staticPages.find(p => p.url === SITE_URL + bot.url);
    if (existing) existing.lastmod = bot.kb_updated;
    else staticPages.push({url:SITE_URL+bot.url,changefreq:'monthly',priority:'0.8',lastmod:bot.kb_updated});
  }

  const blogPages = posts.map(p => ({
    url: `${SITE_URL}/blog/${p.slug}/`,
    changefreq: 'monthly',
    priority: '0.7',
    lastmod: new Date(p.updated_at || p.published_at).toISOString().split('T')[0],
    title: p.title,
    image: p.og_image || SITE_URL + coverSrc(p)
  }));

  const allPages = [...staticPages, ...blogPages];

  const urls = allPages.map(p => {
    let b = `  <url>
    <loc>${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>`;
    if (p.lastmod) b += `
    <lastmod>${p.lastmod}</lastmod>`;
    if (p.image) b += `
    <image:image>
      <image:loc>${p.image}</image:loc>
      <image:caption>${escapeHTML(p.title || '')}</image:caption>

    </image:image>`;
    b += `
  </url>`;
    return b;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>`;
}
function generateRobotsTxt() {
  // 2026 policy: real-time search & AI discovery get full access; AI training
  // crawlers may read/cite HTML but are excluded from heavy media (/assets/)
  // and PDFs (crawl-budget protection). Cloudflare's edge managed robots.txt
  // (ai-train=no) additionally blocks some agents; origin rules never override
  // those edge blocks for media paths.
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /data/
Disallow: /dev/
Disallow: /core/
Disallow: /policy/
Disallow: /assets/models/
Disallow: /_backups/

# --- Real-time search & AI discovery: full access ---
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: DuckDuckBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: Applebot
Allow: /

# --- AI training crawlers: HTML citable, media/PDFs excluded ---
User-agent: GPTBot
Allow: /
Disallow: /assets/
Disallow: /*.pdf$
User-agent: Google-Extended
Allow: /
Disallow: /assets/
Disallow: /*.pdf$
User-agent: ClaudeBot
Allow: /
Disallow: /assets/
Disallow: /*.pdf$
User-agent: PerplexityBot
Allow: /
Disallow: /assets/
Disallow: /*.pdf$
User-agent: cohere-ai
Allow: /
Disallow: /assets/
Disallow: /*.pdf$
User-agent: ai2bot
Allow: /
Disallow: /assets/
Disallow: /*.pdf$

Sitemap: ${SITE_URL}/sitemap.xml
`;
}
function generateLLMsTxt(posts) {
  const chatLines = [
    ['Game Theory Chat', 'https://relu.chat/chat/game-theory-chat/', "On-device assistant for game theory: Nash equilibrium, Shapley value, auctions, prisoner's dilemma and 55+ topics with LaTeX math."],
    ['Golden Age Inquiry', 'https://relu.chat/chat/golden-age-inquiry/', 'On-device assistant for the science and philosophy of the Islamic Golden Age (8th-14th centuries): algebra, optics, astronomy, medicine.'],
    ['Data Science Chat', 'https://relu.chat/chat/data-science-chat/', 'On-device assistant for data science and ML: pandas, NumPy, statistics, classification, regression, clustering.'],
  ].map(([t, u, d]) => `- [${t}](${u}) — ${d}`).join('\n');

  return `# ReLU.chat

> Free, browser-based, privacy-first open-source chatbots that run entirely in your browser. No servers, no LLMs, no tracking.

## Overview

ReLU.chat is an open-source platform for interactive on-device chatbots. All NLP processing happens in the browser using a quantized ONNX sentence-transformer (all-MiniLM-L6-v2, 384-dim, ~22MB), field-weighted BM25 sparse retrieval, dense-sparse ensemble ranking, and a reinforcement-learning-trained MLP policy network. No data ever leaves the device.

## Key Pages

- [Home](https://relu.chat/) — Landing page with feature overview
- [How It Works](https://relu.chat/how-it-works.html) — Full technical architecture
- [Blog](https://relu.chat/blog/) — Technical articles on on-device AI and NLP (${posts.length} posts)

## Chatbots (try them in your browser)

${chatLines}

## Architecture

- **Embedding**: all-MiniLM-L6-v2 (quantized ONNX, 384-dim)
- **Retrieval**: BM25 sparse (k1=1.5, b=0.75, field-weighted + bigrams) + dense cosine ensemble
- **Policy**: MLP 25->128->64->6 action heads (~13K params), RL-trained (REINFORCE), int8-quantized
- **Runtime**: Pure browser JavaScript, WebAssembly, ONNX Runtime, Web Workers
- **Storage**: Client-side only (IndexedDB, no server state)

## Source Code

GitHub: https://github.com/yunusemrejr/relu-chat (MIT license)

## Contact

For questions, open an issue on GitHub or visit the repository.
`;
}

function generateLLMsFullTxt(posts) {
  const sortedPosts = (posts || []).slice().sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
  const blogList = sortedPosts.map(p => {
    const d = new Date(p.published_at).toISOString().split('T')[0];
    const excerpt = (p.excerpt || p.meta_description || '').replace(/\n/g, ' ').trim();
    return `- ${d} — [${p.title}](https://relu.chat/blog/${p.slug}/) — ${excerpt}`;
  }).join('\n');

  const bots = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/manifest.json'), 'utf8')).bots;
  return `# ReLU.chat — Architecture and Learning Resources

> Six free, open-source learning assistants. Questions are processed locally; page and optional model downloads use the network.

## Chatbots

${bots.map(b => `- [${b.name}](https://relu.chat${b.url}) — ${b.description} ${b.topic_count} topics.`).join('\n')}

## How the current release works

1. The selected knowledge base starts with keyword vectors and field-weighted BM25. No large model download is required to ask a question.
2. Explicit entity and intent cues guide retrieval. Follow-ups retain the last topic, while a newly named topic takes precedence.
3. A 13,079-parameter policy has 25 inputs, 128 and 64 ReLU hidden units, and six action heads. It runs in verified WebAssembly or JavaScript, with a heuristic fallback. Float32 weights are used by default; int8 is optional.
4. Complete answers are assembled from curated fragments and rendered with math and available source links. These assistants do not generate arbitrary text, execute code, or solve arbitrary exercises.
5. Enhanced matching is optional: a button downloads the approximately 22 MB quantized MiniLM model plus runtime assets. The browser prepares the complete embedding set before switching, clears incompatible query vectors, and can cache public knowledge vectors in IndexedDB.
6. Conversations stay in memory unless the user saves a text file. Cached pages and assets support offline reuse; an unvisited page needs a connection. The service worker does not prefetch the large model.

## Evaluation and limits

The September 9, 2026 CPU training run took 3.10 seconds. On 438 authored held-out routing cases, joint mode/intent accuracy rose from 93.6% for the previous policy to 98.6% for the new policy. The RL stage matched supervised training on this test. These are routing measurements, not factual-answer accuracy or real-user satisfaction. Topics are disjoint across training, validation, and test splits; training templates differ from validation/test templates.

The fixed-memory WASM module uses 128 KiB and matches JavaScript outputs on 40 exported fixtures. Both paths took around 14 microseconds in the recorded policy microbenchmark; no WASM speed advantage is claimed. Optimized BM25 preserved original scores and rankings on 30 benchmark queries, with median scoring time falling from 16.67 ms to 0.073 ms on the measured laptop. End-to-end browser latency varies.

- [Architecture and limits](https://relu.chat/how-it-works.html)
- [Reproducible evaluation results](https://relu.chat/data/policy-evaluation.json)
- [Six interactive ML tools](https://relu.chat/tools/)
- [Source repository](https://github.com/yunusemrejr/relu-chat)

## Privacy and network use

Chat questions are not sent to a language-generation API. The host receives normal page and asset requests. Optional model downloads use the site origin. Following external links, purchasing an ebook, or submitting a separate signup form involves the respective service. Browser storage contains public assets and knowledge embeddings, not saved chat transcripts.

## Learning guides

${sortedPosts.length} original technical articles at https://relu.chat/blog/ (RSS: https://relu.chat/blog/feed.xml):

${blogList || '- (no posts yet)'}

## Development

The repository contains the shared runtime in core/, policy inference in policy/, six chatbot pages in chat/, and authored knowledge in data/bots/. The bounded CPU trainer is dev/scripts/train-policy-fast.py; its maximum allowed training budget is 540 seconds. See README.md for dataset, training, parity, and regression commands. Source code is MIT licensed.
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
  // Always render in UTC: published_at is an absolute instant, so the
  // displayed day must not depend on the generator machine's timezone
  // (a post at 2026-08-06T01:00:00Z would otherwise show as Aug 5 on
  // UTC-5/UTC-3 machines).
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

module.exports = {
  loadSchema, listPostFiles, loadPost, loadAllPosts,
  getPublishedPosts, findBySlug, validatePost,
  renderMarkdownLite, generatePostHTML, generateIndexHTML,
  generateRSSFeed, generateSitemap, generateRobotsTxt,
  generateLLMsTxt, generateLLMsFullTxt,
  generateDefaultCovers, defaultCoverSvg, coverSrc,
  escapeHTML, formatDate, readingTime, POSTS_DIR, BLOG_OUT, SITE_URL
};
