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

<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px;scroll-behavior:smooth}
body{font-family:var(--font);background:var(--bg);color:var(--text-primary);min-height:100dvh;line-height:1.7;-webkit-font-smoothing:antialiased}

nav{position:sticky;top:0;z-index:100;background:rgba(7,8,9,0.88);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 24px}
.nav-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:56px}
.nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--text-primary);font-weight:600;font-size:16px}
.nav-logo img{width:24px;height:24px}
.nav-links{display:flex;align-items:center;gap:16px;list-style:none}
.nav-links a{color:var(--text-secondary);text-decoration:none;font-size:14px;transition:color .15s}
.nav-links a:hover{color:var(--text-primary)}
.nav-links a.active{color:var(--accent-light)}
.nav-cta{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--radius-sm);background:var(--accent);color:#fff;text-decoration:none;font-size:13px;font-weight:500;border:1px solid var(--border-accent);transition:background 0.15s}
.nav-cta:hover{background:var(--accent-hover)}

.article-container{max-width:760px;margin:0 auto;padding:48px 24px 80px}

.article-breadcrumb{font-size:13px;color:var(--text-tertiary);margin-bottom:24px}
.article-breadcrumb a{color:var(--text-secondary);text-decoration:none}
.article-breadcrumb a:hover{color:var(--accent-light)}
.article-breadcrumb .sep{margin:0 8px;opacity:0.4}

.article-hero-title{font-size:clamp(28px,5.5vw,42px);font-weight:800;letter-spacing:-0.035em;line-height:1.12;margin-bottom:0}

.article-meta-bar{display:flex;align-items:center;gap:0;margin:16px 0 24px;padding:14px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.article-meta-item{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);padding:0 16px;border-right:1px solid var(--border)}
.article-meta-item:first-child{padding-left:0}
.article-meta-item:last-child{border-right:none}
.article-meta-item svg{width:14px;height:14px;opacity:0.5;flex-shrink:0}
.article-meta-item .accent{color:var(--accent-light)}

.article-divider{width:48px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--teal));margin:0 0 32px}

.article-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px}
.article-tag{display:inline-block;padding:3px 12px;border-radius:var(--radius-full);background:var(--accent-soft);color:var(--accent-light);font-size:11px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase}

.article-cover{width:100%;max-height:420px;object-fit:cover;border-radius:var(--radius-lg);margin-bottom:36px;border:1px solid var(--border)}

.article-body{font-size:15.5px;line-height:1.85}
.article-body h2{font-size:22px;font-weight:700;letter-spacing:-0.02em;margin:48px 0 14px;padding-bottom:10px;border-bottom:1px solid var(--border);color:var(--text-primary)}
.article-body h3{font-size:17px;font-weight:600;margin:32px 0 10px;color:var(--text-primary)}
.article-body h4{font-size:15px;font-weight:600;margin:24px 0 8px;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em}
.article-body p{color:var(--text-secondary);margin-bottom:18px}
.article-body a{color:var(--accent-light);text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(201,133,58,0.3)}
.article-body a:hover{color:var(--accent-hover);text-decoration-color:var(--accent)}
.article-body strong{color:var(--text-primary);font-weight:600}
.article-body em{font-style:italic}
.article-body ul,.article-body ol{color:var(--text-secondary);padding-left:24px;margin-bottom:18px}
.article-body li{margin-bottom:6px}
.article-body li::marker{color:var(--accent)}
.article-body code{font-family:'JetBrains Mono','Fira Code',monospace;font-size:13px;background:rgba(228,174,93,0.08);color:var(--accent-light);padding:2px 6px;border-radius:4px}
.article-body pre{background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-md);padding:20px 24px;overflow-x:auto;margin-bottom:24px;font-size:13px;line-height:1.6}
.article-body pre code{background:transparent;color:var(--text-secondary);padding:0;font-size:13px}
.article-body img{max-width:100%;height:auto;border-radius:var(--radius-md);margin:24px 0;border:1px solid var(--border)}
.article-body blockquote{border-left:3px solid var(--accent);background:var(--bg-surface);padding:16px 20px;margin:24px 0;border-radius:0 var(--radius-md) var(--radius-md) 0;color:var(--text-secondary);font-style:italic}
.article-body blockquote p:last-child{margin-bottom:0}
.article-body hr{border:none;height:1px;background:var(--border);margin:40px 0}

.article-body .drop-cap::first-letter{float:left;font-size:3.2em;line-height:0.8;padding-right:8px;padding-top:4px;color:var(--accent-light);font-weight:700}

.article-footer{margin-top:64px;padding-top:32px;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.back-link{display:inline-flex;align-items:center;gap:6px;color:var(--text-secondary);text-decoration:none;font-size:14px;font-weight:500;transition:color .15s}
.back-link:hover{color:var(--accent-light)}
.share-links{display:flex;gap:8px}
.share-link{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--radius-sm);background:var(--bg-surface);border:1px solid var(--border);color:var(--text-tertiary);text-decoration:none;font-size:13px;transition:border-color .2s,color .2s}
.share-link:hover{border-color:var(--border-medium);color:var(--text-primary)}

footer{border-top:1px solid var(--border);padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px}
footer a{color:var(--text-secondary);text-decoration:underline}

@media(max-width:640px){
  .article-container{padding:32px 16px 48px}
  .article-meta-bar{flex-wrap:wrap;gap:8px;padding:12px 0}
  .article-meta-item{border-right:none;padding:0 12px 0 0}
  .article-footer{flex-direction:column;align-items:flex-start}
  .nav-cta span.nav-label{display:none}
}
</style>
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

<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
html{font-size:16px;scroll-behavior:smooth}
body{font-family:var(--font);background:var(--bg);color:var(--text-primary);min-height:100dvh;line-height:1.7;-webkit-font-smoothing:antialiased}

nav{position:sticky;top:0;z-index:100;background:rgba(7,8,9,0.88);backdrop-filter:blur(16px);border-bottom:1px solid var(--border);padding:0 24px}
.nav-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:56px}
.nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--text-primary);font-weight:600;font-size:16px}
.nav-logo img{width:24px;height:24px}
.nav-links{display:flex;align-items:center;gap:16px;list-style:none}
.nav-links a{color:var(--text-secondary);text-decoration:none;font-size:14px;transition:color .15s}
.nav-links a:hover{color:var(--text-primary)}
.nav-links a.active{color:var(--accent-light)}
.nav-cta{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:var(--radius-sm);background:var(--accent);color:#fff;text-decoration:none;font-size:13px;font-weight:500;border:1px solid var(--border-accent);transition:background 0.15s}
.nav-cta:hover{background:var(--accent-hover)}

.blog-container{max-width:940px;margin:0 auto;padding:48px 24px 80px}

.blog-hero{margin-bottom:40px;position:relative}
.blog-hero-top{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap}
.blog-hero h1{font-size:clamp(28px,5vw,44px);font-weight:800;letter-spacing:-0.03em;line-height:1.15;margin-bottom:8px}
.blog-hero-sub{color:var(--text-secondary);font-size:16px;max-width:560px;line-height:1.6}
.blog-hero-accent{width:48px;height:3px;border-radius:2px;background:linear-gradient(90deg,var(--accent),var(--teal));margin:16px 0 0}
.blog-hero-stats{display:flex;gap:20px;margin-top:16px}
.blog-hero-stat{font-size:12px;color:var(--text-tertiary);letter-spacing:0.02em}
.blog-hero-stat strong{color:var(--text-secondary);font-weight:600}

.featured-card{display:block;text-decoration:none;margin-bottom:40px;position:relative}
.featured-card-inner{display:grid;grid-template-columns:1fr 280px;gap:0;border:1px solid var(--border);border-radius:var(--radius-xl);overflow:hidden;background:var(--bg-elevated);transition:border-color .3s,box-shadow .3s}
.featured-card:hover .featured-card-inner{border-color:var(--border-strong);box-shadow:0 12px 48px rgba(0,0,0,0.3)}
.featured-card-content{padding:36px 32px;display:flex;flex-direction:column;justify-content:center}
.featured-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent-light);margin-bottom:12px;background:var(--accent-soft);padding:3px 10px;border-radius:var(--radius-full);width:fit-content}
.featured-tags{display:flex;gap:6px;margin-bottom:12px}
.featured-title{font-size:clamp(22px,3vw,28px);font-weight:800;letter-spacing:-0.03em;line-height:1.2;margin-bottom:12px;color:var(--text-primary)}
.featured-excerpt{font-size:14.5px;color:var(--text-secondary);line-height:1.7;margin-bottom:16px;max-width:480px}
.featured-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-tertiary);margin-bottom:16px}
.featured-dot{width:3px;height:3px;border-radius:50%;background:var(--text-tertiary);opacity:0.5}
.featured-cta{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--accent-light);transition:gap .2s}
.featured-card:hover .featured-cta{gap:10px}
.featured-arrow{transition:transform .2s}
.featured-card:hover .featured-arrow{transform:translateX(3px)}

.featured-visual{position:relative;overflow:hidden;background:var(--bg-surface)}
.featured-cover-img{width:100%;height:100%;object-fit:cover;transition:transform .4s}
.featured-card:hover .featured-cover-img{transform:scale(1.04)}
.featured-visual-inner{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.featured-visual-orb{position:absolute;border-radius:50%;filter:blur(60px);opacity:0.15}
.featured-orb-1{width:200px;height:200px;background:var(--accent);top:-40px;right:-40px}
.featured-orb-2{width:160px;height:160px;background:var(--teal);bottom:-30px;left:-20px}
.featured-visual-icon{position:relative;z-index:1}
.featured-visual-icon svg{width:64px;height:64px;color:var(--accent-light);opacity:0.25}

.filter-bar{display:flex;gap:8px;margin-bottom:32px;flex-wrap:wrap;align-items:center}
.filter-label{font-size:12px;color:var(--text-tertiary);font-weight:500;margin-right:4px;letter-spacing:0.03em;text-transform:uppercase}
.filter-pill{display:inline-flex;align-items:center;padding:5px 14px;border-radius:var(--radius-full);background:var(--bg-surface);border:1px solid var(--border);color:var(--text-secondary);font-size:12px;font-weight:500;cursor:pointer;transition:all .2s;font-family:var(--font)}
.filter-pill:hover{border-color:var(--border-medium);color:var(--text-primary);background:var(--bg-surface-hover)}
.filter-pill.active{background:var(--accent-soft);border-color:var(--border-accent);color:var(--accent-light)}

.blog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}

.blog-card{position:relative;display:flex;flex-direction:column;background:var(--bg-elevated);border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;text-decoration:none;transition:border-color .25s,box-shadow .25s,transform .25s;animation:cardIn .5s ease both;animation-delay:calc(var(--card-idx,0)*.08s)}
.blog-card:hover{border-color:var(--border-strong);box-shadow:0 8px 32px rgba(0,0,0,0.25);transform:translateY(-3px)}
.blog-card-accent{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--accent),var(--teal));opacity:0;transition:opacity .25s}
.blog-card:hover .blog-card-accent{opacity:1}

.blog-card-img{width:100%;height:160px;overflow:hidden;position:relative}
.blog-card-img img{width:100%;height:100%;object-fit:cover;transition:transform .4s}
.blog-card:hover .blog-card-img img{transform:scale(1.04)}
.blog-card-img-placeholder{display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,rgba(201,133,58,0.08) 0%,var(--bg-surface) 40%,rgba(65,125,151,0.06) 100%);border-bottom:1px solid var(--border)}
.blog-card-placeholder-pattern{position:absolute;inset:0;background-image:radial-gradient(circle at 20% 50%,rgba(201,133,58,0.06) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(65,125,151,0.05) 0%,transparent 40%);opacity:1}
.blog-card-placeholder-inner{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:2px}
.blog-card-date-big{font-size:38px;font-weight:800;color:var(--accent);opacity:0.18;line-height:1;letter-spacing:-0.03em}
.blog-card-date-month{font-size:10px;font-weight:700;letter-spacing:0.12em;color:var(--text-tertiary);opacity:0.5}

.blog-card-body{padding:18px 20px;flex:1;display:flex;flex-direction:column}
.blog-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.blog-card-tags{display:flex;gap:6px}
.blog-card-read{font-size:11px;color:var(--text-tertiary);font-weight:500}
.blog-card-title{font-size:17px;font-weight:700;letter-spacing:-0.02em;color:var(--text-primary);margin-bottom:8px;line-height:1.35}
.blog-card-excerpt{font-size:13.5px;color:var(--text-secondary);line-height:1.65;flex:1;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.blog-card-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-tertiary)}
.blog-card-meta .dot{width:3px;height:3px;border-radius:50%;background:var(--text-tertiary);opacity:0.5}

.blog-empty{text-align:center;padding:80px 24px;color:var(--text-tertiary)}
.blog-empty h2{font-size:20px;color:var(--text-secondary);margin-bottom:8px}

footer{border-top:1px solid var(--border);padding:24px;text-align:center;color:var(--text-tertiary);font-size:13px}
footer a{color:var(--text-secondary);text-decoration:underline}

@keyframes cardIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}

@media(max-width:640px){
  .blog-container{padding:32px 16px 48px}
  .blog-grid{grid-template-columns:1fr}
  .featured-card-inner{grid-template-columns:1fr}
  .featured-visual{height:120px}
  .featured-card-content{padding:24px 20px}
  .blog-hero-top{flex-direction:column;align-items:flex-start}
  .blog-newsletter-form{flex-direction:column}
  .nav-cta span.nav-label{display:none}
}
</style>
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
