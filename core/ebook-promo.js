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
    ctaUrl: '#/null',
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
        border-radius: 20px;
        background: rgba(20, 22, 28, 0.78);
        border: 1px solid rgba(255,255,255,0.08);
        box-shadow: 
          0 10px 40px rgba(0,0,0,0.35),
          inset 0 1px 0 rgba(255,255,255,0.06);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        display: grid;
        grid-template-columns: 260px 1fr;
        gap: 2.25rem;
        padding: 2.25rem 2.5rem 2.25rem 2.25rem;
        align-items: center;
        transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1),
                    box-shadow 0.2s cubic-bezier(0.23, 1, 0.32, 1),
                    border-color 0.2s ease;
      }

      .ebook-promo-inner:hover {
        transform: translateY(-2px);
        box-shadow: 
          0 20px 60px rgba(0,0,0,0.45),
          inset 0 1px 0 rgba(255,255,255,0.08);
        border-color: rgba(201, 133, 58, 0.25);
      }

      .ebook-promo-cover {
        position: relative;
        border-radius: 12px;
        overflow: hidden;
        box-shadow: 
          0 8px 30px rgba(0,0,0,0.45),
          0 0 0 1px rgba(255,255,255,0.08);
        background: #111;
      }

      .ebook-promo-cover img {
        display: block;
        width: 100%;
        height: auto;
        transition: transform 0.4s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .ebook-promo-inner:hover .ebook-promo-cover img {
        transform: scale(1.04);
      }

      .ebook-promo-cover::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          to bottom,
          rgba(0,0,0,0.0) 40%,
          rgba(0,0,0,0.35) 100%
        );
        pointer-events: none;
      }

      .ebook-promo-body {
        min-width: 0;
      }

      .ebook-promo-label {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.625rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #c9853a;
        margin-bottom: 0.6rem;
      }

      .ebook-promo-label::before {
        content: '';
        display: block;
        width: 18px;
        height: 1px;
        background: linear-gradient(to right, #c9853a, transparent);
      }

      .ebook-promo-title {
        font-size: clamp(1.35rem, 2.1vw, 1.65rem);
        font-weight: 700;
        line-height: 1.15;
        letter-spacing: -0.025em;
        color: #f5f5f7;
        margin-bottom: 0.35rem;
      }

      .ebook-promo-subtitle {
        font-size: 0.95rem;
        font-weight: 500;
        color: #c9853a;
        letter-spacing: -0.005em;
        margin-bottom: 1rem;
        opacity: 0.95;
      }

      .ebook-promo-desc {
        font-size: 0.875rem;
        line-height: 1.65;
        color: rgba(245, 245, 247, 0.78);
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
        font-size: 0.625rem;
        padding: 0.2rem 0.7rem;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 9999px;
        color: rgba(245,245,247,0.65);
        font-weight: 500;
        white-space: nowrap;
        transition: all 0.15s ease;
      }

      .ebook-promo-inner:hover .ebook-promo-tag {
        border-color: rgba(201, 133, 58, 0.3);
        color: rgba(245,245,247,0.85);
      }

      .ebook-promo-cta {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        height: 46px;
        padding: 0 1.65rem;
        background: linear-gradient(145deg, #c9853a, #a36a2e);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 0.875rem;
        font-weight: 600;
        text-decoration: none;
        letter-spacing: -0.01em;
        box-shadow: 
          0 1px 2px rgba(0,0,0,0.2),
          0 4px 12px rgba(201, 133, 58, 0.25);
        transition: all 0.15s cubic-bezier(0.23, 1, 0.32, 1);
      }

      .ebook-promo-cta:hover {
        transform: translateY(-1px);
        box-shadow: 
          0 1px 2px rgba(0,0,0,0.2),
          0 8px 24px rgba(201, 133, 58, 0.35);
        background: linear-gradient(145deg, #d99a50, #b87a37);
      }

      .ebook-promo-cta:active {
        transform: scale(0.985);
      }

      .ebook-promo-cta svg {
        width: 15px;
        height: 15px;
        transition: transform 0.2s ease;
      }

      .ebook-promo-cta:hover svg {
        transform: translateX(2px);
      }

      /* Mobile */
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