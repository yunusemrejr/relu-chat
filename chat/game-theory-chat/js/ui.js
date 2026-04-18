export function $(s) { return document.querySelector(s); }

export function escapeHTML(s) { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function md(t) { return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }

export function setStatus(t, ready = false) {
  const statusText = document.getElementById('status-text');
  const container = document.getElementById('status-container');
  const dot = document.getElementById('dot');
  if (statusText) statusText.textContent = t;
  if (container) container.classList.toggle('ready', ready);
  if (dot && ready) dot.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.5)';
}

export function pushMessage(role, html, meta) {
  const messagesEl = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg ' + role;

  if (role === 'bot') {
    const content = document.createElement('div');
    content.className = 'msg-content';

    const icon = document.createElement('div');
    icon.className = 'msg-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';

    const body = document.createElement('div');
    body.className = 'msg-body';

    if (meta && meta.length) {
      const m = document.createElement('div');
      m.className = 'meta';
      for (const c of meta) {
        const chip = document.createElement('span');
        chip.className = 'chip ' + (c.type || '');
        chip.textContent = c.text;
        m.appendChild(chip);
      }
      body.appendChild(m);
    }

    const c = document.createElement('div');
    c.innerHTML = html;
    body.appendChild(c);

    content.appendChild(icon);
    content.appendChild(body);
    div.appendChild(content);
  } else {
    const content = document.createElement('div');
    content.className = 'msg-content';

    const body = document.createElement('div');
    body.className = 'msg-body';
    const c = document.createElement('div');
    c.innerHTML = html;
    body.appendChild(c);

    content.appendChild(body);
    div.appendChild(content);
  }

  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  if (window.renderMathInElement) {
    const target = role === 'bot' ? div.querySelector('.msg-body > div:last-child') : div.querySelector('.msg-body > div');
    if (target) {
      renderMathInElement(target, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        throwOnError: false
      });
    }
  }
  return div;
}

