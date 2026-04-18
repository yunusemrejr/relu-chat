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

