// Generated site parts must be in sync with their sources, and the generated
// topic pages must be well-formed. Fix a failure with: node scripts/build-site.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;

test('generated pages, sitemap and shell are up to date', () => {
  const run = spawnSync(process.execPath, ['scripts/build-site.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(/warning:/.test(run.stderr), false, run.stderr);
});

test('every assistant topic has a crawlable page with one h1 and canonical', () => {
  const sitemap = readFileSync(root + 'sitemap.xml', 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const learn = locs.filter((u) => /\/learn\/[^/]+\/[^/]+\/$/.test(u));
  assert.ok(learn.length >= 200, `expected 200+ indexable topic URLs, got ${learn.length}`);
  for (const u of learn.slice(0, 400)) {
    const file = root + new URL(u).pathname.slice(1) + 'index.html';
    assert.ok(existsSync(file), file);
    const html = readFileSync(file, 'utf8');
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1, u);
    assert.ok(html.includes(`<link rel="canonical" href="${u}">`), u);
    assert.equal(/noindex/.test(html), false, u);
  }
});

test('book facts match the single source of truth', () => {
  const home = readFileSync(root + 'index.html', 'utf8');
  assert.match(home, /224-page/);
  assert.equal(/240[- ]pages?/.test(home), false);
  assert.ok(existsSync(root + 'assets/remain-valuable-cover.webp'));
});
