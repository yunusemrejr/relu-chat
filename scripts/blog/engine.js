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

// Injected before </body> on every generated page (shared with hand-maintained pages).
const GUMROAD_WIDGET = fs.readFileSync(path.join(__dirname, 'gumroad-widget.html'), 'utf8').trim();

// Injected before </head> on every generated page (shared with hand-maintained pages).
const AIF_POPUP = fs.readFileSync(path.join(__dirname, 'aif-popup.html'), 'utf8').trim();

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
    : `${SITE_URL}/assets/logo.png`;
  const publishedYear = new Date(post.published_at).getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escapeHTML(post.title)}</title>
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
<link rel="stylesheet" href="/assets/shared-design.css?v=11">
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
<link rel="stylesheet" href="/assets/shared-design.css?v=11">
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
    { url: SITE_URL + '/tools/', changefreq: 'monthly', priority: '0.7' },
    { url: SITE_URL + '/tools/neural-network/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/gradient-descent/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/backpropagation/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/activation-functions/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/k-means-clustering/', changefreq: 'monthly', priority: '0.6' },
    { url: SITE_URL + '/tools/decision-tree/', changefreq: 'monthly', priority: '0.6' },
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
  // AI-agent friendly: allow AI crawlers and browser-based AI assistants.
  // Note: Cloudflare can still inject its own managed block above this file
  // at the edge (dashboard setting) - that is outside this repo's control.
  return `User-agent: *
Allow: /
Disallow: /api/
Disallow: /data/
Disallow: /dev/
Disallow: /core/
Disallow: /policy/
Disallow: /assets/models/
Disallow: /_backups/

# AI crawlers / assistants (content may be read and cited)
User-agent: GPTBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot
Allow: /
User-agent: cohere-ai
Allow: /
User-agent: ai2bot
Allow: /
User-agent: Meta-ExternalAgent
Allow: /

# General search engines
User-agent: Googlebot
Allow: /
User-agent: Bingbot
Allow: /
User-agent: DuckDuckBot
Allow: /

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

  return `# ReLU.chat — Full Documentation for AI Agents

> Free, browser-based, privacy-first open-source chatbots. No servers, no LLMs, no tracking.
> Everything below is factual and verified against the repository at https://github.com/yunusemrejr/relu-chat (MIT license).

## What is ReLU.chat?

ReLU.chat is an open-source platform for building and running interactive chatbots entirely in the browser. All natural language processing happens locally on the user's device using a quantized ONNX sentence-transformer model plus classical retrieval and a small reinforcement-learned policy network. Conversations never leave the browser: there are no servers, no API keys, no LLM calls, and no telemetry.

## Try it (runs 100% client-side, no install)

- [Game Theory Chat](https://relu.chat/chat/game-theory-chat/) — on-device assistant for game theory: Nash equilibrium, Shapley value, auctions, prisoner's dilemma, 55+ topics, LaTeX math.
- [Golden Age Inquiry](https://relu.chat/chat/golden-age-inquiry/) — on-device assistant for the scientific and philosophical discoveries of the Islamic Golden Age (8th-14th centuries).
- [Data Science Chat](https://relu.chat/chat/data-science-chat/) — on-device assistant for data science and ML: pandas, NumPy, statistics, classification, clustering, evaluation.
- [Interactive ML Tools](https://relu.chat/tools/) — six interactive visualizations:
  - [Neural Network Explorer](https://relu.chat/tools/neural-network/) — 2-layer forward pass with adjustable weights and activations
  - [Gradient Descent Lab](https://relu.chat/tools/gradient-descent/) — optimization steps on a loss surface
  - [Backpropagation Visualizer](https://relu.chat/tools/backpropagation/) — step-by-step chain-rule gradients
  - [Activation Functions Explorer](https://relu.chat/tools/activation-functions/) — ReLU, Leaky ReLU, Sigmoid, Tanh, GELU, SiLU, ELU, Softplus with derivatives
  - [K-Means Clustering Playground](https://relu.chat/tools/k-means-clustering/) — interactive clustering with SSE convergence
  - [Decision Tree Explorer](https://relu.chat/tools/decision-tree/) — step-by-step CART splits with Gini impurity

## How it works (full pipeline)

1. **Progressive loading** — a heuristic/BOW fallback answers the very first turns instantly while the ~22MB quantized MiniLM ONNX model and knowledge-base embeddings stream in the background (service worker pre-caches them). The full dense pipeline hot-swaps automatically when ready. Query embeddings are memoized and top-k ranking is bounded (no full sort).
2. **Embedding** — queries and KB entries are embedded into 384-dimensional vectors by all-MiniLM-L6-v2 (quantized ONNX, running via ONNX Runtime/transformers.js).
3. **Signal layer** — field-weighted BM25 sparse retrieval (k1=1.5, b=0.75; entry names repeated 3x, aliases 2x; bigram phrase matching), dense cosine similarity, fuzzy entity extraction (Levenshtein + word-overlap + notation patterns), and temperature-calibrated intent classification (19 prototypes per intent, 70/30 best-vs-average) are fused into a 25-feature decision packet. Explicit topic corrections ("I meant X") force the corrected topic to the top.
4. **Policy network** — a ~13K-parameter MLP (25 inputs -> 128 -> 64 -> 6 action heads: mode, intent, topic count, fragment count, creativity, tone) trained with REINFORCE decides how to respond. Weights are auto-quantized to int8 at construction (~4x memory reduction). A 15-threshold heuristic fallback guarantees the system always works, even during cold start.
5. **Composition** — responses are assembled from knowledge-base fragments (def/int/ex/form/app categories with truth/source confidence, difficulty, style, avoid-with constraints) using linguistic connectors, comparison openers, and session-aware diversity penalties.
6. **Rendering** — KaTeX renders LaTeX math; progressive streaming rendering reveals responses in ~40-char chunks; session memory keeps up to 30 turns of context with importance-based eviction and an EMA summary vector (alpha=0.75).

## Privacy guarantees

- Zero data leaves the browser: no accounts, no cookies, no tracking, no server processing.
- Offline capable after first load (PWA + service worker pre-caches model and policy weights).
- Storage is client-side only (IndexedDB).

## Performance characteristics

- Sub-100ms inference on typical hardware with quantized ONNX models.
- Service-worker pre-caching gives zero-wait chatbot startup on repeat visits.
- All thresholds centralized in config; LRU caches, query memoization, and pre-built BM25 IDF keep retrieval fast.

## Blog

${sortedPosts.length} technical articles at https://relu.chat/blog/ (RSS: https://relu.chat/blog/feed.xml):

${blogList || '- (no posts yet)'}

## Books (by the same author, Gumroad)

- [Fringe Learning: Resource-Efficient RL for Edge ML](https://elroystar8.gumroad.com/l/ecvuf) — practical reinforcement learning methods for resource-constrained edge machine learning.
- [AI & Financial Freedom](https://elroystar8.gumroad.com/l/ai-freedom) — a step-by-step guide to mastering AI tools and workflows for financial independence in the age of AI.
- More books: https://elroystar8.gumroad.com/

## Source code

- GitHub: https://github.com/yunusemrejr/relu-chat
- License: MIT
- Author: Yunus Emre Vurgun (https://yunusemrevurgun.com)

## Repository layout

- core/ — NLP engine, chatbot engine, session memory, BM25 scorer, signal layer, UI
- policy/ — feature extractor, MLP inference, action schema, policy runtime
- chat/ — individual chatbots (game theory, golden age, data science)
- data/ — knowledge-base fragments, bot configurations, manifest
- assets/ — models, fonts, shared design system
- dev/scripts/ — PyTorch training, weight export, prompt augmentation
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
