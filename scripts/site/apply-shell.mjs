// Applies the shared shell (head assets, nav, footer, hashed asset URLs) to
// every static page. Idempotent: running twice changes nothing. Used by
// build-site.mjs; `--check` mode (via build-site) reports drift without writing.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { applyBook } from './book.mjs';
import { ROOT, head, nav, footer, sectionOf, versioned } from './shell.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dev', '_backups', 'tests', 'docs', 'assets', 'core', 'policy', 'data', 'scripts', 'api', 'content', '.agents', '.codex', '.pi', '.github', '.well-known', '.agent_memory']);

export function listPages() {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name) && dir === ROOT.replace(/\/$/, '')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name) || dir !== ROOT.replace(/\/$/, '')) walk(full); }
      else if (name.endsWith('.html')) out.push(full);
    }
  })(ROOT.replace(/\/$/, ''));
  return out.sort();
}

const urlPathOf = (file) => {
  const rel = '/' + relative(ROOT, file).replace(/\\/g, '/');
  return rel.endsWith('/index.html') ? rel.slice(0, -'index.html'.length) : rel;
};

const between = (name, html) => {
  const re = new RegExp(`<!--shell:${name}-->[\\s\\S]*?<!--/shell:${name}-->`);
  return { re, has: re.test(html) };
};

// Legacy head tags superseded by the shell head block.
const LEGACY_HEAD = [
  /[ \t]*<link[^>]*sora\.css[^>]*>\s*\n?/g,
  /[ \t]*<meta\s+name="(?:theme-color|background_color)"[^>]*>\s*\n?/g,
  /[ \t]*<link\s+rel="(?:apple-touch-icon|icon)"[^>]*>\s*\n?/g,
  /[ \t]*<script[^>]*api\/ping\.php[^>]*><\/script>\s*\n?/g,
];

const CSS_LINK = /(href=")((?:\.\.\/)*\/?)(assets\/(?:css\/[\w.-]+|shared-design)\.css)(\?v=[^"]*)?(")/g;

export function transform(file, html) {
  const urlPath = urlPathOf(file);
  const section = sectionOf(urlPath);
  const isChat = /^\/chat\/[^/]+\/$/.test(urlPath);
  let out = html;

  // 1) head
  const h = between('head', out);
  if (h.has) out = out.replace(h.re, () => head());
  else {
    for (const re of LEGACY_HEAD) out = out.replace(re, '');
    if (!out.includes('</head>')) throw new Error(`${file}: no </head>`);
    out = out.replace('</head>', () => `${head()}\n</head>`);
  }
  out = out.replace(CSS_LINK, (m, a, _s, p, _v, z) => `${a}/${p}?v=${versioned('/' + p).split('?v=')[1]}${z}`);

  // 2) nav
  let navHtml;
  if (isChat) {
    const old = out.match(/<div class="nav-status"[\s\S]*?<\/div>/);
    const status = old ? old[0] : '';
    navHtml = nav({ section: 'chat', extra: status, cta: false });
  } else navHtml = nav({ section });
  const n = between('nav', out);
  if (n.has) out = out.replace(n.re, () => navHtml);
  else {
    const re = /<nav\b[^>]*(?:aria-label="Primary navigation"|class="site-nav")[^>]*>[\s\S]*?<\/nav>/;
    if (!re.test(out)) throw new Error(`${file}: primary nav not found`);
    out = out.replace(re, () => navHtml);
  }

  // 3) footer (chat pages are app-shaped and keep their own compact footer area)
  if (!isChat) {
    const f = between('footer', out);
    if (f.has) out = out.replace(f.re, () => footer());
    else {
      const re = /<footer\b[\s\S]*?<\/footer>/;
      if (re.test(out)) out = out.replace(re, () => footer());
      else if (out.includes('</main>')) out = out.replace('</main>', () => `</main>\n${footer()}`);
      else out = out.replace('</body>', () => `${footer()}\n</body>`);
    }
  }
  return applyBook(out);
}

export function applyShell({ write = true } = {}) {
  const drifted = [];
  for (const file of listPages()) {
    const before = readFileSync(file, 'utf8');
    if (!/<nav\b|<!--shell:nav-->/.test(before)) continue; // fragments, redirects
    const after = transform(file, before);
    if (after !== before) {
      drifted.push(relative(ROOT, file));
      if (write) writeFileSync(file, after);
    }
  }
  return drifted;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const changed = applyShell({ write: !process.argv.includes('--check') });
  console.log(`${changed.length} page(s) ${process.argv.includes('--check') ? 'out of date' : 'updated'}`);
  if (process.argv.includes('--check') && changed.length) { console.log(changed.slice(0, 20).join('\n')); process.exit(1); }
}
