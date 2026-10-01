#!/usr/bin/env node
// Renders the 1200x630 social images with headless Chrome:
//   assets/og/*.png    home, /learn/, one per subject
//   assets/blog/*.png  one per guide (og:image), plus the .svg card thumbnails
// Dev-time only (images are committed); build-site.mjs fails if an og image is missing.
//   node scripts/site/build-og.mjs [--force] [--blog]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { ROOT } from './shell.mjs';
import { BOTS } from './config.mjs';
import { loadPosts } from './data.mjs';

const require = createRequire(import.meta.url);
const art = require('./art.cjs');
const force = process.argv.includes('--force');
const blog = process.argv.includes('--blog');
const chrome = process.env.CHROME || 'google-chrome';
const fontUrl = (f) => `file://${join(ROOT, 'assets/fonts', f)}`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mark = '<svg viewBox="64 120 380 260" fill="none" stroke-width="44" stroke-linecap="round"><path d="M92 344H232" stroke="#0d1210" stroke-opacity=".55"/><path d="M232 344L404 164" stroke="#0d1210"/><circle cx="232" cy="344" r="22" fill="#0d1210" stroke="none"/></svg>';

function page({ subject, eyebrow, title, sub, seed }) {
  const size = title.length <= 26 ? 104 : title.length <= 44 ? 84 : title.length <= 66 ? 68 : 56;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'B';font-weight:200 800;src:url(${fontUrl('bricolage-latin.woff2')}) format('woff2')}
@font-face{font-family:'A';font-weight:200 800;src:url(${fontUrl('atkinson-latin.woff2')}) format('woff2')}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:${art.COLORS[subject] || art.COLORS.brand};color:#0d1210;font-family:'A',sans-serif;position:relative;overflow:hidden}
.plate{position:absolute;right:36px;top:135px;width:540px;height:360px}
.plate svg{width:100%;height:100%;display:block}
.brand{position:absolute;left:68px;top:56px;display:flex;align-items:center;gap:14px;font-family:'B';font-weight:760;font-size:36px;letter-spacing:-.03em}
.brand svg{width:54px}
.eyebrow{position:absolute;left:68px;top:176px;font-family:'B';font-weight:700;font-size:28px}
h1{position:absolute;left:68px;top:222px;width:610px;font-family:'B';font-weight:800;font-size:${size}px;line-height:.98;letter-spacing:-.05em}
.sub{position:absolute;left:68px;bottom:52px;width:620px;font-size:27px;line-height:1.3;font-weight:500;opacity:.85}
</style></head><body>
<div class="plate">${art.plate(subject, seed, { anim: false })}</div>
<div class="brand">${mark}<span>ReLU.chat</span></div>
<p class="eyebrow">${esc(eyebrow)}</p>
<h1>${esc(title)}</h1>
${sub ? `<p class="sub">${esc(sub)}</p>` : ''}
</body></html>`;
}

const tmp = mkdtempSync(join(tmpdir(), 'og-'));
function shot(out, job) {
  const html = join(tmp, 'og.html');
  writeFileSync(html, page(job));
  execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--virtual-time-budget=2500', '--window-size=1200,630', `--screenshot=${out}`, `file://${html}`], { stdio: 'ignore' });
  console.log('wrote', out);
}

mkdirSync(join(ROOT, 'assets/og'), { recursive: true });
const jobs = [
  { file: 'default', subject: 'brand', eyebrow: 'Free · no account', title: 'Ask the hard question. Get the worked answer.', sub: 'Learning assistants that run in your browser', seed: 'home' },
  { file: 'learn', subject: 'brand', eyebrow: 'Learn', title: 'Every concept, explained with an example', sub: 'Definitions, intuition and the math · relu.chat/learn', seed: 'learn' },
  ...Object.values(BOTS).map((b) => ({ file: b.slug, subject: b.slug, eyebrow: 'Learn', title: b.subject, sub: b.lead.length > 90 ? b.lead.slice(0, 87).replace(/[,\s]+\S*$/, '') + '…' : b.lead, seed: b.slug })),
];
for (const j of jobs) {
  const out = join(ROOT, `assets/og/${j.file}.png`);
  if (existsSync(out) && !force) continue;
  shot(out, j);
}

if (blog) {
  for (const p of loadPosts()) {
    const subject = art.subjectOfPost(p);
    writeFileSync(join(ROOT, `assets/blog/${p.slug}.svg`), art.coverSvg(subject, p.slug));
    shot(join(ROOT, `assets/blog/${p.slug}.png`), { subject, eyebrow: 'Guide', title: p.title.replace(/:.*$/, (m) => (p.title.length > 62 ? '' : m)), sub: '', seed: p.slug });
  }
}
rmSync(tmp, { recursive: true, force: true });
