// Small rendering helpers shared by the generators.
import { createRequire } from 'node:module';
import { ROOT, head, nav, footer, versioned } from './shell.mjs';
import { SITE, AUTHOR } from './config.mjs';

const require = createRequire(ROOT);
const katex = require(`${ROOT}assets/katex/katex.min.js`);

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const warnings = [];

/** Fragment text -> safe HTML with pre-rendered KaTeX. `$..$` is math, `\$` a literal dollar. */
export function richText(src, where = '') {
  const text = src.replace(/\\`([a-z])/g, (_, c) => ({ e: 'è', a: 'à', o: 'ò' }[c] || c));
  const out = [];
  let buf = '';
  let i = 0;
  const flush = () => { if (buf) { out.push(esc(buf)); buf = ''; } };
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && text[i + 1] === '$') { buf += '$'; i += 2; continue; }
    if (c === '$') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '$' && text[j - 1] !== '\\')) j++;
      if (j >= text.length) { buf += text.slice(i); break; } // unmatched: literal
      flush();
      const tex = text.slice(i + 1, j);
      try {
        out.push(katex.renderToString(tex, { throwOnError: true, output: 'htmlAndMathml', macros: { '\\softmax': '\\operatorname{softmax}' } }));
      } catch (e) {
        warnings.push(`KaTeX failed${where ? ' in ' + where : ''}: ${tex.slice(0, 60)}`);
        out.push(`<code>${esc(tex)}</code>`);
      }
      i = j + 1;
      continue;
    }
    buf += c; i++;
  }
  flush();
  return out.join('');
}

/** Plain-text version (for meta descriptions): math markup flattened. */
export function plain(src) {
  return src.replace(/\\\$/g, '\u0000').replace(/\$([^$]*)\$/g, (_, t) => t.replace(/\\[a-zA-Z]+/g, ' ').replace(/[{}^_\\]/g, '')).replace(/\u0000/g, '$').replace(/\s+/g, ' ').trim();
}

export function clip(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:\s]+$/, '') + '…';
}

export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

const ORG = { '@type': 'Organization', '@id': `${SITE}/#organization`, name: 'ReLU.chat', url: `${SITE}/`, logo: { '@type': 'ImageObject', url: `${SITE}/assets/logo.png` } };

export function breadcrumbLd(trail) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: SITE + t.path })),
  };
}

export const orgLd = ORG;
export const authorLd = AUTHOR;

/** Full HTML document for a generated page. `body` is the <main> content. */
export function document_({ title, description, path, robots = 'index, follow', og, ld, body, section, css = [], bodyClass = '', katexCss = false, scripts = '' }) {
  const url = SITE + path;
  const ogUrl = og.startsWith('http') ? og : SITE + og;
  const cssLinks = ['/assets/shared-design.css', ...css].map((h) => `<link rel="stylesheet" href="${versioned(h)}">`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ReLU.chat">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ogUrl}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogUrl}">
${cssLinks}
${katexCss ? '<link rel="stylesheet" href="/assets/katex/katex.min.css">\n' : ''}<script type="application/ld+json">${JSON.stringify(ld)}</script>
${head()}
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a href="#main-content" class="skip-link">Skip to main content</a>
${nav({ section })}
<main id="main-content">
${body}
</main>
${footer()}
${scripts}
</body>
</html>
`;
}
