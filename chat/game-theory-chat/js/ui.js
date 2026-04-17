export function $(s) { return document.querySelector(s); }

export function escapeHTML(s) { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function md(t) { return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }

export function setStatus(t, ready = false) {
  const statusText = document.getElementById('status-text');
  const dot = document.getElementById('dot');
  if (statusText) statusText.textContent = t;
  if (dot) dot.classList.toggle('ready', ready);
}

export function pushMessage(role, html, meta) {
  const messagesEl = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  if (meta && meta.length) {
    const m = document.createElement('div');
    m.className = 'meta';
    for (const c of meta) {
      const chip = document.createElement('span');
      chip.className = 'chip ' + (c.type || '');
      chip.textContent = c.text;
      m.appendChild(chip);
    }
    div.appendChild(m);
  }
  const c = document.createElement('div');
  c.innerHTML = html;
  div.appendChild(c);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (window.renderMathInElement) {
    renderMathInElement(c, {
      delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
      throwOnError: false
    });
  }
  return div;
}

export function buildBowFallback(vocabSet, KB, entryEmb, intentEmb, INTENTS, bowVec, tokens) {
  const voc = new Set();
  for (const e of KB) for (const t of tokens(entryText(e))) voc.add(t);
  for (const k of Object.keys(INTENTS)) for (const p of INTENTS[k].prototypes) for (const t of tokens(p)) voc.add(t);
  const bowVocab = new Map();
  [...voc].forEach((w, i) => bowVocab.set(w, i));
  entryEmb = KB.map(e => bowVec(entryText(e), bowVocab));
  for (const k of Object.keys(INTENTS)) intentEmb[k] = INTENTS[k].prototypes.map(p => bowVec(p, bowVocab));
  return { bowVocab, entryEmb, intentEmb };
}
