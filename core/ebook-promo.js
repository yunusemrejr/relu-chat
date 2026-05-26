/* ============================================================
   ReLU.chat — E-Book Promo Module
   Central module for the Edge RL e-book promotion section.
   Update this file to change the promo across all pages.
   ============================================================ */

var EbookPromo = (function () {
  'use strict';

  var CONFIG = {
    title: 'Fringe Learning',
    subtitle: 'Resource-Efficient RL for Edge ML',
    description: 'A practical guide to building reinforcement learning pipelines that train intelligent agents on resource-constrained edge hardware. Covers reward shaping, policy distillation, quantization-aware training, and deployment strategies for microcontrollers and embedded GPUs.',
    ctaText: 'Get the Book',
    ctaUrl: '#/null',
    tags: ['Reinforcement Learning', 'Edge ML', 'Embedded AI', 'Model Compression']
  };

  var STYLE_ID = 'ebook-promo-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '.ebook-promo{',
      '  margin:3rem auto 0;',
      '  max-width:1000px;',
      '  padding:0 clamp(1rem,3vw,2rem);',
      '}',
      '.ebook-promo-inner{',
      '  position:relative;',
      '  overflow:hidden;',
      '  border-radius:var(--radius-xl);',
      '  border:1px solid var(--border-medium);',
      '  background:var(--bg-surface);',
      '  box-shadow:inset 0 1px 0 rgba(255,255,255,0.02),0 0 0 1px rgba(0,0,0,0.2);',
      '  padding:2.5rem 2.75rem;',
      '  display:flex;',
      '  align-items:center;',
      '  gap:2.5rem;',
      '  transition:border-color 0.35s var(--ease-out),box-shadow 0.35s var(--ease-out);',
      '}',
      '.ebook-promo-inner::before{',
      '  content:"";',
      '  position:absolute;',
      '  inset:0;',
      '  border-radius:inherit;',
      '  background:',
      '    radial-gradient(ellipse at 0% 0%,rgba(201,133,58,0.04) 0%,transparent 55%),',
      '    radial-gradient(ellipse at 100% 100%,rgba(65,125,151,0.03) 0%,transparent 55%);',
      '  pointer-events:none;',
      '}',
      '.ebook-promo-inner::after{',
      '  content:"";',
      '  position:absolute;',
      '  top:0;left:2rem;right:2rem;',
      '  height:1px;',
      '  background:linear-gradient(90deg,transparent,var(--accent-light),transparent);',
      '  opacity:0.2;',
      '}',
      '.ebook-promo-inner:hover{',
      '  border-color:rgba(201,133,58,0.18);',
      '  box-shadow:',
      '    inset 0 1px 0 rgba(255,255,255,0.02),',
      '    0 0 0 1px rgba(0,0,0,0.2),',
      '    0 0 40px rgba(201,133,58,0.04);',
      '}',
      '.ebook-promo-icon{',
      '  flex-shrink:0;',
      '  width:72px;height:72px;',
      '  border-radius:var(--radius-lg);',
      '  background:rgba(201,133,58,0.08);',
      '  border:1px solid rgba(201,133,58,0.15);',
      '  display:flex;',
      '  align-items:center;',
      '  justify-content:center;',
      '  box-shadow:0 0 24px rgba(201,133,58,0.06);',
      '  transition:box-shadow 0.35s var(--ease-out);',
      '}',
      '.ebook-promo-inner:hover .ebook-promo-icon{',
      '  box-shadow:0 0 32px rgba(201,133,58,0.12);',
      '}',
      '.ebook-promo-icon svg{',
      '  width:32px;height:32px;',
      '  stroke:var(--accent-light);',
      '  fill:none;',
      '}',
      '.ebook-promo-body{',
      '  flex:1;min-width:0;',
      '  position:relative;',
      '  z-index:1;',
      '}',
      '.ebook-promo-label{',
      '  display:inline-block;',
      '  font-size:0.625rem;',
      '  font-weight:700;',
      '  letter-spacing:0.1em;',
      '  text-transform:uppercase;',
      '  color:var(--accent-light);',
      '  margin-bottom:0.5rem;',
      '}',
      '.ebook-promo-title{',
      '  font-size:clamp(1.2rem,1.5vw,1.4rem);',
      '  font-weight:700;',
      '  color:var(--text-primary);',
      '  letter-spacing:-0.03em;',
      '  line-height:1.2;',
      '  margin-bottom:0.125rem;',
      '}',
      '.ebook-promo-subtitle{',
      '  font-size:0.8125rem;',
      '  font-weight:500;',
      '  color:var(--accent-light);',
      '  letter-spacing:-0.01em;',
      '  margin-bottom:0.75rem;',
      '  opacity:0.85;',
      '}',
      '.ebook-promo-desc{',
      '  font-size:0.8125rem;',
      '  line-height:1.7;',
      '  color:var(--text-secondary);',
      '  margin-bottom:1rem;',
      '  max-width:560px;',
      '}',
      '.ebook-promo-tags{',
      '  display:flex;',
      '  flex-wrap:wrap;',
      '  gap:0.375rem;',
      '  margin-bottom:1.25rem;',
      '}',
      '.ebook-promo-tag{',
      '  font-size:0.625rem;',
      '  padding:0.25rem 0.625rem;',
      '  background:var(--bg-surface);',
      '  border:1px solid var(--border);',
      '  border-radius:var(--radius-full);',
      '  color:var(--text-tertiary);',
      '  font-weight:500;',
      '  transition:border-color 0.2s var(--ease-out),color 0.2s var(--ease-out);',
      '}',
      '.ebook-promo-inner:hover .ebook-promo-tag{',
      '  border-color:var(--border-medium);',
      '  color:var(--text-secondary);',
      '}',
      '.ebook-promo-cta{',
      '  display:inline-flex;',
      '  align-items:center;',
      '  gap:0.5rem;',
      '  min-height:44px;',
      '  padding:0.625rem 1.5rem;',
      '  background:var(--accent);',
      '  color:#fff;',
      '  border:1px solid rgba(228,174,93,0.3);',
      '  border-radius:var(--radius-md);',
      '  font-family:var(--font);',
      '  font-size:0.8125rem;',
      '  font-weight:600;',
      '  text-decoration:none;',
      '  cursor:pointer;',
      '  transition:transform 0.15s var(--ease-out),box-shadow 0.2s var(--ease-out),background 0.2s var(--ease-out),border-color 0.2s var(--ease-out);',
      '  box-shadow:0 0 0 1px rgba(228,174,93,0.12),0 1px 2px rgba(0,0,0,0.25);',
      '  width:fit-content;',
      '  letter-spacing:-0.01em;',
      '}',
      '.ebook-promo-cta:hover{',
      '  background:var(--accent-hover);',
      '  border-color:var(--border-accent-strong);',
      '  box-shadow:0 0 0 1px rgba(228,174,93,0.2),0 0 20px var(--accent-glow);',
      '  transform:translateY(-1px);',
      '}',
      '.ebook-promo-cta:active{',
      '  transform:scale(0.97);',
      '}',
      '.ebook-promo-cta svg{',
      '  width:14px;height:14px;',
      '  transition:transform 0.2s var(--ease-out);',
      '}',
      '.ebook-promo-cta:hover svg{',
      '  transform:translateX(2px);',
      '}',
      '@media(max-width:768px){',
      '  .ebook-promo-inner{',
      '    flex-direction:column;',
      '    text-align:center;',
      '    padding:2rem 1.5rem;',
      '    gap:1.5rem;',
      '  }',
      '  .ebook-promo-icon{',
      '    width:64px;height:64px;',
      '  }',
      '  .ebook-promo-icon svg{',
      '    width:28px;height:28px;',
      '  }',
      '  .ebook-promo-desc{',
      '    max-width:100%;',
      '  }',
      '  .ebook-promo-tags{',
      '    justify-content:center;',
      '  }',
      '}',
      '@media(max-width:480px){',
      '  .ebook-promo{',
      '    margin-top:2rem;',
      '  }',
      '  .ebook-promo-inner{',
      '    padding:1.5rem 1.25rem;',
      '  }',
      '}',
      '@media(prefers-reduced-motion:reduce){',
      '  .ebook-promo-inner,',
      '  .ebook-promo-icon,',
      '  .ebook-promo-tag,',
      '  .ebook-promo-cta{',
      '    transition:none;',
      '  }',
      '}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function createSection(options) {
    var o = options || {};
    var title = o.title || CONFIG.title;
    var subtitle = o.subtitle || CONFIG.subtitle;
    var desc = o.description || CONFIG.description;
    var ctaText = o.ctaText || CONFIG.ctaText;
    var ctaUrl = o.ctaUrl || CONFIG.ctaUrl;
    var tags = o.tags || CONFIG.tags;

    var section = document.createElement('section');
    section.className = 'ebook-promo';

    var tagsHtml = '';
    for (var i = 0; i < tags.length; i++) {
      tagsHtml += '<span class="ebook-promo-tag">' + tags[i] + '</span>';
    }

    section.innerHTML =
      '<div class="ebook-promo-inner">' +
        '<div class="ebook-promo-icon" aria-hidden="true">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>' +
            '<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' +
            '<path d="M8 7h8M8 11h6"/>' +
          '</svg>' +
        '</div>' +
        '<div class="ebook-promo-body">' +
          '<span class="ebook-promo-label">New E-Book</span>' +
          '<h3 class="ebook-promo-title">' + title + '</h3>' +
          '<p class="ebook-promo-subtitle">' + subtitle + '</p>' +
          '<p class="ebook-promo-desc">' + desc + '</p>' +
          '<div class="ebook-promo-tags">' + tagsHtml + '</div>' +
          '<a href="' + ctaUrl + '" class="ebook-promo-cta" rel="noopener">' +
            ctaText +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>' +
            '</svg>' +
          '</a>' +
        '</div>' +
      '</div>';

    return section;
  }

  function mount(anchorEl, options) {
    if (!anchorEl) return null;
    injectStyles();
    var section = createSection(options);
    anchorEl.parentNode.insertBefore(section, anchorEl.nextSibling);
    return section;
  }

  function mountBefore(anchorEl, options) {
    if (!anchorEl) return null;
    injectStyles();
    var section = createSection(options);
    anchorEl.parentNode.insertBefore(section, anchorEl);
    return section;
  }

  return {
    CONFIG: CONFIG,
    createSection: createSection,
    mount: mount,
    mountBefore: mountBefore,
    injectStyles: injectStyles
  };
})();
