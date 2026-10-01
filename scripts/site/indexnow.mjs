#!/usr/bin/env node
// Submits new/changed URLs to IndexNow (Bing, Yandex, others) after a deploy.
// Runs from CI (.github/workflows/indexnow.yml): waits until production serves
// the sitemap from this commit, diffs it against the previous commit's sitemap,
// and submits only URLs that are new or whose <lastmod> changed. Never fails
// the build: indexing pings are best-effort.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HOST = 'relu.chat';
const KEY = '8dbf00ebf5052a221fc2e9b70e1169eb'; // public by design; verified via /<key>.txt
const parse = (xml) => new Map([...xml.matchAll(/<loc>([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => [m[1], m[2] || '']));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const current = readFileSync('sitemap.xml', 'utf8');
// Base = the commit before this push (all commits of a multi-commit push count), else the parent.
const base = process.env.BASE_SHA && !/^0+$/.test(process.env.BASE_SHA) ? process.env.BASE_SHA : 'HEAD~1';
let previous = '';
try { previous = execFileSync('git', ['show', `${base}:sitemap.xml`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { /* new branch or first commit: submit everything */ }
const now = parse(current), before = parse(previous);
const changed = [...now].filter(([url, mod]) => before.get(url) !== mod).map(([url]) => url);
if (!changed.length) { console.log('No new or changed URLs; nothing to submit.'); process.exit(0); }

// Wait for the deploy (push to the production remote happens after this workflow starts).
let live = false;
for (let i = 0; i < 40 && !live; i++) {
  try {
    const res = await fetch(`https://${HOST}/sitemap.xml?cb=${Date.now()}`, { headers: { 'cache-control': 'no-cache' } });
    live = res.ok && (await res.text()).trim() === current.trim();
  } catch { /* retry */ }
  if (!live) await sleep(30000);
}
if (!live) { console.log('Production sitemap does not match this commit yet; skipping (next deploy will cover it).'); process.exit(0); }

if (process.argv.includes('--dry-run')) { console.log(`[dry-run] would submit ${changed.length} URL(s), e.g. ${changed.slice(0, 3).join(', ')}`); process.exit(0); }
for (let i = 0; i < changed.length; i += 9000) {
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: changed.slice(i, i + 9000) }),
  });
  console.log(`IndexNow submitted ${Math.min(9000, changed.length - i)} URL(s): HTTP ${res.status}`);
}
