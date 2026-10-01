// Shared page shell: head assets, navigation, footer. One definition, applied
// to every static page by apply-shell.mjs, so a change here changes the site.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOTS, NAV, GITHUB, BOOK, TOOLKIT_URL } from './config.mjs';

export const ROOT = new URL('../../', import.meta.url).pathname;

const hashCache = new Map();
/** Short content hash used as a cache-busting query string (?v=...). */
export function assetVersion(publicPath) {
  if (!hashCache.has(publicPath)) {
    const buf = readFileSync(join(ROOT, publicPath.replace(/^\//, '')));
    hashCache.set(publicPath, createHash('sha1').update(buf).digest('hex').slice(0, 8));
  }
  return hashCache.get(publicPath);
}
export const versioned = (publicPath) => `${publicPath}?v=${assetVersion(publicPath)}`;

const markSvg = `<svg class="nav-mark" viewBox="64 120 380 260" aria-hidden="true" focusable="false" fill="none" stroke-width="44" stroke-linecap="round"><path class="mark-flat" d="M92 344 H232"/><path class="mark-live" d="M232 344 L404 164"/><circle class="mark-dot" cx="232" cy="344" r="22" stroke="none"/></svg>`;

const moon = `<svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
const sun = `<svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;

/** Section of the site a URL path belongs to, for aria-current. */
export function sectionOf(urlPath) {
  if (urlPath === '/' ) return 'home';
  if (urlPath.startsWith('/chat/')) return 'chat';
  if (urlPath.startsWith('/learn/')) return 'learn';
  if (urlPath.startsWith('/tools/')) return 'tools';
  if (urlPath.startsWith('/blog/')) return 'blog';
  if (urlPath.startsWith('/how-it-works')) return 'how';
  return '';
}

export function head() {
  return [
    '<!--shell:head-->',
    '<script data-cfasync="false">(function(){var d=document.documentElement;d.classList.add("js");try{var t=localStorage.getItem("relu-theme");if(t==="light"||t==="dark")d.setAttribute("data-theme",t)}catch(e){}})()</script>',
    '<meta name="theme-color" content="#0b1017" media="(prefers-color-scheme: dark)">',
    '<meta name="theme-color" content="#f4f6fa" media="(prefers-color-scheme: light)">',
    '<link rel="icon" href="/assets/logo.svg" type="image/svg+xml">',
    `<link rel="icon" href="${versioned('/assets/logo.png')}" type="image/png" sizes="512x512">`,
    `<link rel="apple-touch-icon" href="${versioned('/assets/logo.png')}">`,
    '<link rel="preload" href="/assets/fonts/plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>',
    `<link rel="stylesheet" href="${versioned('/assets/fonts/plex.css')}">`,
    `<script src="${versioned('/assets/js/shell.js')}" defer data-cfasync="false"></script>`,
    '<!--/shell:head-->',
  ].join('\n');
}

export function nav({ section = '', extra = '', cta = true } = {}) {
  const links = NAV.map((l) => `<li><a href="${l.href}"${l.section === section ? ' aria-current="page"' : ''}>${l.label}</a></li>`).join('');
  return `<!--shell:nav-->
<nav class="site-nav" id="navbar" aria-label="Primary">
<div class="nav-container">
<a href="/" class="nav-logo" aria-label="ReLU.chat home">${markSvg}<span>ReLU.chat</span></a>
<ul class="nav-links" id="nav-links">${links}</ul>
<div class="nav-tools">${extra}<button class="theme-toggle" type="button" aria-label="Switch color theme">${moon}${sun}</button>${cta ? '<a class="btn btn-primary btn-sm nav-cta" href="/chat/">Start chatting</a>' : ''}<button class="nav-menu-btn" type="button" aria-expanded="false" aria-controls="nav-links" aria-label="Menu"><span></span><span></span><span></span></button></div>
</div>
</nav>
<!--/shell:nav-->`;
}

export function footer() {
  const subjects = Object.values(BOTS).map((b) => `<li><a href="/learn/${b.slug}/">${b.subject}</a></li>`).join('');
  return `<!--shell:footer-->
<footer class="site-footer">
<div class="footer-grid">
<div class="footer-brand"><a href="/" class="nav-logo" aria-label="ReLU.chat home">${markSvg}<span>ReLU.chat</span></a><p>Six free learning assistants, interactive ML tools and worked examples. Questions are answered in your browser.</p></div>
<nav class="footer-col" aria-label="Learn"><h2 class="footer-h">Learn</h2><ul>${subjects}<li><a href="/learn/">All topics</a></li></ul></nav>
<nav class="footer-col" aria-label="Explore"><h2 class="footer-h">Explore</h2><ul><li><a href="/chat/">Chat assistants</a></li><li><a href="/tools/">Interactive tools</a></li><li><a href="/blog/">Blog</a></li><li><a href="/how-it-works.html">How it works</a></li><li><a href="/blog/feed.xml">RSS feed</a></li></ul></nav>
<nav class="footer-col" aria-label="More from the makers"><h2 class="footer-h">From the makers</h2><ul><li><a href="${BOOK.url}" target="_blank" rel="noopener noreferrer">Remain Valuable (book) <span aria-hidden="true">↗</span></a></li><li><a href="${TOOLKIT_URL}" target="_blank" rel="noopener noreferrer">Chatbot builder toolkit <span aria-hidden="true">↗</span></a></li><li><a href="${GITHUB}" target="_blank" rel="noopener noreferrer">Source on GitHub <span aria-hidden="true">↗</span></a></li><li><a href="/llms.txt">llms.txt</a></li></ul></nav>
</div>
<div class="footer-base"><p>© 2026 ReLU.chat · MIT-licensed open source</p><p>Chat questions are processed in your browser.</p></div>
</footer>
<!--/shell:footer-->`;
}
