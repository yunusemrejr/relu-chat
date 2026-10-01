// Error pages (403/404/500). Served by Apache's ErrorDocument at the *original*
// URL, so every asset path is absolute. Generated so they share the site shell.
import { head, nav, footer, versioned } from './shell.mjs';
import { BOTS } from './config.mjs';
import { esc } from './render.mjs';
import { plate } from './home.mjs';

const PAGES = [
  { code: 404, title: 'Page not found', msg: "The page you're looking for doesn't exist or has moved. Try one of these instead." },
  { code: 403, title: 'Access denied', msg: "You don't have permission to open this resource. The public pages below are open to everyone." },
  { code: 500, title: 'Server error', msg: 'Something went wrong on our end. Please try again in a moment, or start from one of these pages.' },
];

export function renderErrors() {
  const subjects = Object.values(BOTS).map((b) => `<li><a href="/learn/${b.slug}/">${esc(b.subject)}</a></li>`).join('');
  const out = new Map();
  for (const p of PAGES) {
    out.set(`errors/${p.code}.html`, `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${p.code} — ${p.title} | ReLU.chat</title>
<meta name="description" content="${esc(p.msg)}">
<meta name="robots" content="noindex, follow">
<link rel="stylesheet" href="${versioned('/assets/shared-design.css')}">
<link rel="stylesheet" href="${versioned('/assets/css/error.css')}">
${head()}
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>
${nav({})}
<main id="main-content" class="error-main">
<div class="error-card">
<div class="error-art plate cut" aria-hidden="true">${plate('brand', String(p.code))}</div>
<div class="error-text">
<p class="error-code" aria-hidden="true">${p.code}</p>
<h1>${p.title}</h1>
<p class="error-msg">${esc(p.msg)}</p>
<div class="error-actions"><a href="/" class="btn btn-primary">Back to home <span class="arrow" aria-hidden="true">→</span></a><a href="/learn/" class="btn btn-secondary">Browse topics</a></div>
<ul class="error-links"><li><a href="/chat/">Chat assistants</a></li><li><a href="/tools/">Interactive tools</a></li><li><a href="/blog/">Guides</a></li>${subjects}</ul>
</div>
</div>
</main>
${footer()}
</body>
</html>
`);
  }
  return out;
}
