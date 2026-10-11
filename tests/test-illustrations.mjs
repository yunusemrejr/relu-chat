import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { PAYOFFS, OBSERVATIONS, REGRESSION, GRID, SHEAR, transform, SUBJECTS, MOTIFS, motifOf, instrument } = require('../scripts/site/instruments.cjs');
const { plate, coverSvg } = require('../scripts/site/art.cjs');

test('the payoff board highlights the unique Nash equilibrium of its displayed game', () => {
  const equilibria = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const [a,b] = PAYOFFS[row][col];
    if (a >= PAYOFFS[1-row][col][0] && b >= PAYOFFS[row][1-col][1]) equilibria.push([row,col]);
  }
  assert.deepEqual(equilibria, [[1,1]]);
  assert.deepEqual(PAYOFFS[0][0], [3,3]);
});

test('regression plotter fits the observations, with zero-sum and orthogonal residuals', () => {
  const residuals = OBSERVATIONS.map(([x,y]) => y - REGRESSION.intercept - REGRESSION.slope*x);
  assert.ok(Math.abs(residuals.reduce((a,b)=>a+b,0)) < 1e-10);
  assert.ok(Math.abs(residuals.reduce((s,r,i)=>s+r*OBSERVATIONS[i][0],0)) < 1e-10);
  const loss = (m,b) => OBSERVATIONS.reduce((s,[x,y])=>s+(y-m*x-b)**2,0);
  const fitLoss = loss(REGRESSION.slope, REGRESSION.intercept);
  for (const [dm,db] of [[.01,0],[-.01,0],[0,1],[0,-1]]) assert.ok(loss(REGRESSION.slope+dm,REGRESSION.intercept+db)>fitLoss);
});

test('the animated grid route stays on legal adjacent cells and reaches its destination', () => {
  const walls = new Set(GRID.walls.map(p=>p.join(',')));
  GRID.route.forEach(([x,y],i) => {
    assert.ok(x>=0 && x<GRID.cols && y>=0 && y<GRID.rows);
    assert.equal(walls.has([x,y].join(',')),false);
    if (i) assert.equal(Math.abs(x-GRID.route[i-1][0])+Math.abs(y-GRID.route[i-1][1]),1);
  });
  assert.deepEqual(GRID.route.at(-1),[6,3]);
});

test('the transformation frame shows a shear preserving area and the first basis', () => {
  assert.deepEqual(transform([1,0]),[1,0]);
  assert.deepEqual(transform([0,1]),[.6,1]);
  assert.equal(SHEAR[0][0]*SHEAR[1][1]-SHEAR[0][1]*SHEAR[1][0],1);
});

test('shared figures ship full static SVGs, unique-free markup and bounded complexity', () => {
  for (const subject of [...Object.keys(SUBJECTS),...Object.keys(MOTIFS)]) {
    const body = instrument(subject);
    assert.ok(body.length > 3000, subject);
    assert.ok(body.length < 35000, `${subject}: ${body.length}`);
    assert.equal(/\b(?:NaN|Infinity|undefined)\b/.test(body),false,subject);
    assert.equal(/<(?:script|image|foreignObject|filter)\b|\bid=/.test(body),false,subject);
    assert.ok((body.match(/<(?:path|polygon|circle|ellipse)\b/g)||[]).length < 300,subject);
    assert.match(plate(subject), /preserveAspectRatio="xMidYMid meet"/);
    assert.equal(/data-motion-figure/.test(plate(subject,'',{anim:false})),false);
    assert.equal(/<animate|<script/.test(coverSvg(subject)),false);
  }
});

test('generated covers and article content keep the same canonical illustration source', () => {
  const home = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((home.match(/id="plot-dot"/g)||[]).length,1);
  assert.equal((home.match(/class="process-cell"/g)||[]).length,5);
  assert.match(home,/aria-labelledby="activation-title activation-desc"/);
  assert.match(home,/data-motion-toggle/);
  const cover = readFileSync(new URL('../assets/blog/greedy-vs-beam-search-decoding.svg',import.meta.url),'utf8');
  assert.ok(cover.includes(instrument('data-science','greedy-vs-beam-search-decoding')));
});

test('guide illustrations follow the content rather than randomly assigning a motif', () => {
  assert.equal(motifOf('data-science','greedy-vs-beam-search-decoding'),'search-tree');
  assert.equal(motifOf('data-science','dropout-regularization-tiny-mlp'),'network');
  assert.equal(motifOf('web-platform','int8-quantization-explained'),'quantization');
  assert.equal(motifOf('data-science','bm25-math-worked-example'),'retrieval');
  assert.equal(motifOf('data-science','confusion-matrix-intent-classification'),'evaluation');
  assert.equal(motifOf('data-science','precision-recall-small-example'),'evaluation');
  for(const subject of Object.keys(SUBJECTS))assert.equal(motifOf(subject,subject+'-chat'),subject);
});

test('immutable blog covers are referenced with the current content hash', async () => {
  const { createHash } = await import('node:crypto');
  const slug='greedy-vs-beam-search-decoding';
  const svg=readFileSync(new URL('../assets/blog/'+slug+'.svg',import.meta.url));
  const hash=createHash('sha1').update(svg).digest('hex').slice(0,8);
  for(const name of ['blog/index.html','blog/'+slug+'/index.html']) {
    const html=readFileSync(new URL('../'+name,import.meta.url),'utf8');
    assert.ok(html.includes('/assets/blog/'+slug+'.svg?v='+hash),name);
  }
  const sitemap=readFileSync(new URL('../sitemap.xml',import.meta.url),'utf8');
  const pages=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  assert.equal(pages.some(url=>url.endsWith('.svg')),false,'image assets must not become page URLs');
});
