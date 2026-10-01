#!/usr/bin/env node
// Renders the 1200x630 social images in assets/og/ with headless Chrome.
// Dev-time only (images are committed); build-site.mjs fails if one is missing.
//   node scripts/site/build-og.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './shell.mjs';
import { BOTS } from './config.mjs';

const force = process.argv.includes('--force');
const chrome = process.env.CHROME || 'google-chrome';
const tpl = join(ROOT, 'scripts/site/og/og.html');
const jobs = [
  { file: 'default', e: 'Free · No account', t: 'Ask the hard question. Get the worked answer.', s: 'Learning assistants that run in your browser' },
  { file: 'learn', e: 'Learn', t: 'Every concept, explained with an example', s: 'Definitions, intuition and the math · relu.chat/learn' },
  ...Object.values(BOTS).map((b) => ({ file: b.slug, e: 'Learn', t: b.subject, s: b.lead.length > 70 ? b.lead.slice(0, 67).replace(/[,\s]+\S*$/, '') + '…' : b.lead })),
];
mkdirSync(join(ROOT, 'assets/og'), { recursive: true });
for (const j of jobs) {
  const out = join(ROOT, `assets/og/${j.file}.png`);
  if (existsSync(out) && !force) continue;
  const url = `file://${tpl}?e=${encodeURIComponent(j.e)}&t=${encodeURIComponent(j.t)}&s=${encodeURIComponent(j.s)}`;
  execFileSync(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--virtual-time-budget=3000', '--window-size=1200,630', `--screenshot=${out}`, url], { stdio: 'ignore' });
  console.log('wrote', out);
}
