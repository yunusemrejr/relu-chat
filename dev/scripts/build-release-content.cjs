const fs=require('fs'),path=require('path');
const engine=require('../../scripts/blog/engine.js');
const all=engine.getPublishedPosts();
const slugs=all.filter(p=>p.published_at.startsWith('2026-09-09')).map(p=>p.slug);
const fresh=all.filter(p=>slugs.includes(p.slug));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
engine.generateDefaultCovers(fresh);
for(const post of fresh){const dir='blog/'+post.slug;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/index.html',engine.generatePostHTML(post));}
function decorate(html,post){
 const headings=[];
 html=html.replace(/<h2(?: id="[^"]*")?>([\s\S]*?)<\/h2>/g,(m,title)=>{
  const text=title.replace(/<[^>]*>/g,'');const id='section-'+text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');headings.push({id,text});return `<h2 id="${id}">${title}</h2>`;
 });
 if(headings.length>=3&&!html.includes('class="article-toc"')){
  const toc=`<nav class="article-toc" aria-label="On this page"><strong>On this page</strong><ol>${headings.map(h=>`<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></nav>`;
  html=html.replace(/<div class="article-body">/,toc+'<div class="article-body">');
 }
 if(!html.includes('class="related-reading"')){
  const related=all.filter(p=>p.slug!==post.slug).map(p=>({post:p,score:(p.tags||[]).filter(t=>(post.tags||[]).includes(t)).length})).sort((a,b)=>b.score-a.score).slice(0,3).map(x=>x.post);
  const bot=post.related_bot;const items=related.map(p=>`<li><a href="/blog/${p.slug}/">${esc(p.title)}</a></li>`).join('');
  const relatedHTML=`<aside class="related-reading" aria-label="Keep learning"><h2>Keep learning</h2>${bot?`<p><a href="/chat/${bot}/">Explore this subject with a free chatbot →</a></p>`:''}<ul>${items}</ul></aside>`;
  html=html.replace(/<div class="article-footer">/,relatedHTML+'<div class="article-footer">');
 }
 return html.replace('href="/#showcase"','href="/chat/"');
}
for(const post of all){const p='blog/'+post.slug+'/index.html';if(fs.existsSync(p))fs.writeFileSync(p,decorate(fs.readFileSync(p,'utf8'),post));}
let index=fs.readFileSync('blog/index.html','utf8');
index=index.replaceAll('href="/#showcase"','href="/chat/"');
index=index.replace(/class="featured-card"(?: data-tags="[^"]*")?/, 'class="featured-card" data-tags="retrieval,ndcg,mrr,evaluation"');
const tagOrder=['reinforcement-learning','linear-algebra','data-science','game-theory','history-of-science','web-platform','worked-example','performance','privacy','retrieval'];
const allTags=[...new Set(all.flatMap(p=>p.tags||[]))];
const orderedTags=[...tagOrder.filter(t=>allTags.includes(t)),...allTags.filter(t=>!tagOrder.includes(t)).sort()];
index=index.replace(/<div class="filter-bar">[\s\S]*?<\/div>/, '<div class="filter-bar"><span class="filter-label">Topics</span><button class="filter-pill active" data-tag="all">All</button>'+orderedTags.map(tag=>`<button class="filter-pill" data-tag="${esc(tag)}">${esc(tag)}</button>`).join('')+'</div>');
index=index.replace(/<h1>Blog<\/h1>/,'<h1>Ideas you can work through.</h1>');
index=index.replace(/<p class="blog-hero-sub">[\s\S]*?<\/p>/,'<p class="blog-hero-sub">Worked examples and practical guides to machine learning, mathematics, browser engineering, and the history of science.</p>');
index=index.replace(/(<div class="blog-hero-stat"><strong>)\d+(<\/strong> articles)/,'$1'+all.length+'$2');
index=index.replace(/(<div class="blog-hero-stat"><strong>)\d+(<\/strong> min total)/,'$1'+all.reduce((n,p)=>n+engine.readingTime(p.content),0)+'$2');
const cards=fresh.map(p=>`<a href="/blog/${p.slug}/" class="blog-card" data-tags="${esc(p.tags.join(','))}"><div class="blog-card-accent"></div><div class="blog-card-body"><div class="blog-card-top"><div class="blog-card-tags">${p.tags.slice(0,2).map(t=>`<span class="article-tag">${esc(t)}</span>`).join('')}</div><span class="blog-card-read">${engine.readingTime(p.content)} min</span></div><h2 class="blog-card-title">${esc(p.title)}</h2><p class="blog-card-excerpt">${esc(p.meta_description)}</p><div class="blog-card-meta"><span>ReLU.chat</span><time datetime="${p.published_at}">September 9, 2026</time></div></div></a>`).join('\n');
index=index.replace(/<!-- START NEW POSTS -->[\s\S]*?<!-- END NEW POSTS -->/,'');
index=index.replace('<div class="blog-grid">','<div class="blog-grid"><!-- START NEW POSTS -->'+cards+'<!-- END NEW POSTS -->');
// Preserve the established featured layout; keep its date honest.
index=index.replace('<div class="featured-badge">Latest</div>','<div class="featured-badge">Start here</div>');
if(!index.includes('id="blog-search"'))index=index.replace('<div class="filter-bar">','<div class="blog-search"><label for="blog-search">Find a guide</label><input id="blog-search" type="search" placeholder="Search topics, titles, and examples…" aria-describedby="search-count"><p id="search-count" role="status"></p></div><div class="filter-bar">');
index=index.replace(/<script>\s*\(function \(\) \{\s*var pills[\s\S]*?<\/script>/,'<script src="/assets/blog/search.js" defer></script>');
// Keep the collection structured data in step with actual published pages.
index=index.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/,`<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'CollectionPage',name:'ReLU.chat learning guides',url:'https://relu.chat/blog/',mainEntity:{'@type':'ItemList',numberOfItems:all.length,itemListElement:all.map((p,i)=>({'@type':'ListItem',position:i+1,name:p.title,url:'https://relu.chat/blog/'+p.slug+'/'}))}})}</script>`);
fs.writeFileSync('blog/index.html',index);
for(const [name,fn] of [['feed.xml',engine.generateRSSFeed],['sitemap.xml',engine.generateSitemap],['llms.txt',engine.generateLLMsTxt],['llms-full.txt',engine.generateLLMsFullTxt]]){
 const data=fn(all);fs.writeFileSync('blog/'+name,data);if(name!=='feed.xml')fs.writeFileSync(name,data);
}
// Discovery is maintained from the same bot manifest, rather than three stale hard-coded entries.
const bots=JSON.parse(fs.readFileSync('data/manifest.json')).bots;
const llms='# ReLU.chat\n\n> Six free learning assistants. Questions are processed locally in the browser; page and optional model downloads use the network.\n\n## Chatbots\n'+bots.map(b=>`- [${b.name}](https://relu.chat${b.url}): ${b.description} ${b.topic_count} topics.`).join('\n')+'\n\n## Learn and inspect\n- [Learning guides](https://relu.chat/blog/)\n- [Interactive ML tools](https://relu.chat/tools/)\n- [Architecture and limits](https://relu.chat/how-it-works.html)\n- [Policy evaluation](https://relu.chat/data/policy-evaluation.json)\n\nThese are curated retrieval assistants, not general-purpose language models. They can misunderstand questions and do not execute code or solve arbitrary exercises. Offline use requires previously loaded assets.\n';
for(const p of ['llms.txt','blog/llms.txt'])fs.writeFileSync(p,llms);
const report=JSON.parse(fs.readFileSync(fs.existsSync('dev/exports/fast-policy/report.json')?'dev/exports/fast-policy/report.json':'data/policy-evaluation.json'));delete report.history;
if(fs.existsSync('dev/exports/fast-policy/retrieval-benchmark.json'))report.retrieval_benchmark=JSON.parse(fs.readFileSync('dev/exports/fast-policy/retrieval-benchmark.json'));
if(fs.existsSync('dev/exports/fast-policy/parity-benchmark.json'))report.numerical_verification=JSON.parse(fs.readFileSync('dev/exports/fast-policy/parity-benchmark.json'));
report.split_protocol='Topics are disjoint across all three splits. Training question templates differ from validation/test templates. Authored cases; no user conversations.';
fs.writeFileSync('data/policy-evaluation.json',JSON.stringify(report,null,2)+'\n');
console.log('Published',fresh.length,'new guides;',all.length,'total; updated discovery and all article navigation.');
