export function $(s) { return document.querySelector(s); }

export function escapeHTML(s) { return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function md(t) { return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>'); }

export function setStatus(t, ready = false) {
  const statusText = document.getElementById('status-text');
  const container = document.getElementById('status-container');
  const dot = document.getElementById('dot');
  if (statusText) statusText.textContent = t;
  if (container) container.classList.toggle('ready', ready);
}

/**
 * Render a diagram AST into a container element.
 * Dynamically imports diagram-renderer.js and attaches the rendered SVG.
 *
 * @param {Object} ast       - Diagram AST object
 * @param {Object} [options] - Render options
 * @param {HTMLElement} [options.container] - Container to append the diagram to
 * @param {string} [options.theme='dark']   - 'light' or 'dark'
 * @returns {Promise<HTMLElement|null>} The diagram wrapper element, or null on failure
 */
export async function renderDiagramElement(ast, options = {}) {
  if (!ast || typeof ast !== 'object') return null;
  try {
    const { renderDiagram } = await import('./diagram-renderer.js');
    const { svgElement, textFallback, hasRendered } = renderDiagram(ast, { theme: options.theme || 'dark' });

    const wrapper = document.createElement('div');
    wrapper.className = 'relu-diagram';
    wrapper.setAttribute('data-diagram-id', ast.id || '');

    if (hasRendered && svgElement) {
      wrapper.appendChild(svgElement);
    } else if (textFallback) {
      const fb = document.createElement('div');
      fb.className = 'text-fallback';
      fb.textContent = textFallback;
      wrapper.appendChild(fb);
    }

    if (ast.caption) {
      const caption = document.createElement('div');
      caption.className = 'caption';
      caption.textContent = ast.caption;
      wrapper.appendChild(caption);
    }

    const container = options.container || document.getElementById('messages');
    if (container) {
      // Insert after the last bot message or append to end
      const lastMsg = container.querySelector('.msg.bot:last-of-type .msg-body > div:not(.meta)');
      if (lastMsg) {
        lastMsg.appendChild(wrapper);
      } else {
        container.appendChild(wrapper);
      }
    }

    return wrapper;
  } catch (err) {
    console.warn('[ui] renderDiagramElement failed:', err.message);
    return null;
  }
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
    const target = role === 'bot' ? div.querySelector('.msg-body > div:not(.meta)') : div.querySelector('.msg-body > div');
    if (target) {
      renderMathInElement(target, {
        delimiters: [{ left: "$$", right: "$$", display: true }, { left: "$", right: "$", display: false }],
        throwOnError: false
      });
    }
  }
  return div;
}
