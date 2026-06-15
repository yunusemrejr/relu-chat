/* ============================================================
   ReLU.chat — E-Book Promo Module (Redesigned)
   Premium, visual-forward promotion for "Fringe Learning".
   Uses custom generated artwork for a much stronger impression.
   ============================================================ */

var EbookPromo = (function () {
  'use strict';

  var CONFIG = {
    title: 'Fringe Learning',
    subtitle: 'Resource-Efficient RL for Edge ML',
    description: 'A practical, no-fluff guide to training and deploying reinforcement learning agents on microcontrollers, NPUs, and other severely constrained hardware. Real techniques for reward design, quantization-aware training, policy distillation, and production deployment on the edge.',
    ctaText: 'Get the Book',
    ctaUrl: 'https://elroystar8.gumroad.com/l/ecvuf',
    tags: ['Reinforcement Learning', 'Edge AI', 'TinyML', 'Model Compression']
  };

  var STYLE_ID = 'ebook-promo-styles';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .ebook-promo {
        margin: 3.25rem auto 0;
        max-width: 1080px;
        padding: 0 clamp(1rem, 3vw, 2rem);
      }

      .ebook-promo-inner {
        position: relative;
        overflow: hidden;
        border-radius: 6px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        display: grid;
        grid-template-columns: 260px 1fr;
        gap: 2.25rem;
        padding: 2.25rem 2.5rem;
        align-items: center;
        transition: border-color 0.15s ease;
      }

      .ebook-promo-inner:hover {
        border-color: var(--border-strong);
      }

      .ebook-promo-cover {
        position: relative;
        border-radius: 6px;
        overflow: hidden;
        background: var(--bg-surface);
        border: 1px solid var(--border);
      }

      .ebook-promo-cover img {
        display: block;
        width: 100%;
        height: auto;
        transition: transform 0.3s ease;
      }

      .ebook-promo-inner:hover .ebook-promo-cover img {
        transform: scale(1.02);
      }

      .ebook-promo-body {
        min-width: 0;
      }

      .ebook-promo-label {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.6875rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 0.6rem;
      }

      .ebook-promo-label::before {
        content: '';
        display: block;
        width: 18px;
        height: 1px;
        background: var(--border-strong);
      }

      .ebook-promo-title {
        font-size: clamp(1.25rem, 2.1vw, 1.5rem);
        font-weight: 600;
        line-height: 1.15;
        letter-spacing: -0.02em;
        color: var(--text-primary);
        margin-bottom: 0.35rem;
      }

      .ebook-promo-subtitle {
        font-size: 0.9375rem;
        font-weight: 500;
        color: var(--text-secondary);
        letter-spacing: -0.005em;
        margin-bottom: 1rem;
      }

      .ebook-promo-desc {
        font-size: 0.875rem;
        line-height: 1.6;
        color: var(--text-secondary);
        margin-bottom: 1.15rem;
        max-width: 52ch;
      }

      .ebook-promo-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        margin-bottom: 1.35rem;
      }

      .ebook-promo-tag {
        font-size: 0.6875rem;
        padding: 2px 6px;
        background: var(--bg-surface);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--text-muted);
        font-weight: 500;
        white-space: nowrap;
        transition: color 0.15s ease, border-color 0.15s ease;
      }

      .ebook-promo-inner:hover .ebook-promo-tag {
        border-color: var(--border-strong);
        color: var(--text-secondary);
      }

      .ebook-promo-cta {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        height: 40px;
        padding: 0 1rem;
        background: var(--accent);
        color: #0a0a0b;
        border: 1px solid var(--accent);
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        text-decoration: none;
        letter-spacing: -0.01em;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .ebook-promo-cta:hover {
        background: #6f9bf5;
        border-color: #6f9bf5;
      }

      .ebook-promo-cta svg {
        width: 14px;
        height: 14px;
        transition: transform 0.15s ease;
      }

      .ebook-promo-cta:hover svg {
        transform: translateX(2px);
      }

      @media (max-width: 720px) {
        .ebook-promo-inner {
          grid-template-columns: 1fr;
          gap: 1.5rem;
          padding: 1.75rem 1.5rem;
          text-align: center;
        }

        .ebook-promo-cover {
          max-width: 210px;
          margin: 0 auto;
        }

        .ebook-promo-desc {
          max-width: 100%;
        }

        .ebook-promo-tags {
          justify-content: center;
        }

        .ebook-promo-cta {
          width: 100%;
          justify-content: center;
        }
      }
    `;
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

    var tagsHtml = tags.map(function (tag) {
      return '<span class="ebook-promo-tag">' + tag + '</span>';
    }).join('');

    section.innerHTML =
      '<div class="ebook-promo-inner">' +
        '<div class="ebook-promo-cover" aria-hidden="true">' +
          '<img src="/assets/ebook-cover.jpg" alt="Fringe Learning book cover" width="260" height="340">' +
        '</div>' +
        '<div class="ebook-promo-body">' +
          '<div class="ebook-promo-label">New from ReLU Research</div>' +
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