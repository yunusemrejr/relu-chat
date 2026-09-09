(() => {
  const input=document.getElementById('blog-search');
  const cards=[...document.querySelectorAll('.blog-card[data-tags], .featured-card[data-tags]')];
  const pills=[...document.querySelectorAll('.filter-pill[data-tag]')];
  const count=document.getElementById('search-count');
  let selected='all';
  const searchable=cards.map(el=>({el,text:el.textContent.toLowerCase(),tags:el.dataset.tags.split(',')}));
  function update(){
    const terms=(input?.value||'').toLowerCase().trim().split(/\s+/).filter(Boolean);let total=0;
    const banner=document.querySelector('.kit-hub-banner');
    if(banner)banner.style.display=terms.length||selected!=='all'?'none':'';
    for(const item of searchable){const shown=(selected==='all'||item.tags.includes(selected))&&terms.every(term=>item.text.includes(term)||item.tags.some(t=>t.includes(term)));item.el.hidden=!shown;item.el.style.display=shown?'':'none';if(shown)total++;}
    if(count)count.textContent=total?`${total} ${total===1?'guide':'guides'} found`:'No guides match. Try a broader term or choose All topics.';
  }
  input?.addEventListener('input',update);
  for(const pill of pills){pill.setAttribute('aria-pressed',String(pill.dataset.tag===selected));pill.addEventListener('click',()=>{selected=pill.dataset.tag;for(const other of pills){const active=other===pill;other.classList.toggle('active',active);other.setAttribute('aria-pressed',String(active));}update();});}
  const extra=pills.filter(p=>p.dataset.tag!=='all').slice(18);const bar=document.querySelector('.filter-bar');
  if(extra.length&&bar){for(const pill of extra)pill.classList.add('filter-extra');bar.classList.add('tags-collapsed');const toggle=document.createElement('button');toggle.type='button';toggle.className='filter-pill filter-more';toggle.textContent='Show all topics';toggle.setAttribute('aria-expanded','false');toggle.onclick=()=>{const collapsed=bar.classList.toggle('tags-collapsed');toggle.setAttribute('aria-expanded',String(!collapsed));toggle.textContent=collapsed?'Show all topics':'Fewer topics';};bar.append(toggle);}
  update();
})();
