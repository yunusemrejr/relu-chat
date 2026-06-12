/**
 * debug-panel.js — ReLU.chat Dev-Only Debug Drawer
 *
 * Gated by localStorage flag 'relu_debug' or URL query param ?debug=1.
 * Shows policy decisions, scores, and timings.
 *
 * NEVER sends telemetry — all display is local DOM.
 */

import { getDeviceContext } from './mobile-rules.js';

/** @type {string} */
const STORAGE_KEY = 'relu_debug';

/** @type {string} */
const DRAWER_ID = 'relu-debug-drawer';

/** @type {string} */
const TOGGLE_ID = 'relu-debug-toggle';

/** @type {string} */
const CSS_INJECTED = 'relu-debug-css';

/**
 * Dev-only debug drawer. Creates a slide-out panel from the right
 * showing decision packet internals, device context, and cache state.
 */
export class DebugPanel {
  constructor() {
    /** @type {HTMLElement|null} */
    this._drawer = null;
    /** @type {HTMLElement|null} */
    this._toggle = null;
    /** @type {boolean} */
    this._visible = false;
    /** @type {object|null} */
    this._lastPacket = null;
  }

  /**
   * Check if the debug panel is enabled via localStorage or URL param.
   * @returns {boolean}
   */
  isEnabled() {
    if (typeof window === 'undefined') return false;

    try {
      const fromStorage = window.localStorage.getItem(STORAGE_KEY) === '1';
      const fromUrl = new URLSearchParams(window.location.search).has('debug');
      return fromStorage || fromUrl;
    } catch {
      return false;
    }
  }

  /**
   * Create the drawer DOM, inject CSS, and bind the toggle button.
   * Safe to call multiple times.
   */
  init() {
    if (!this.isEnabled()) return;
    if (document.getElementById(DRAWER_ID)) return; // already initialized

    this._injectCSS();
    this._createDrawer();
    this._createToggle();
  }

  /**
   * Update the drawer with the latest decision packet.
   *
   * @param {object} dp - decision packet
   * @param {string} dp.mode
   * @param {string} dp.intent
   * @param {string} dp.answerBudget
   * @param {string} dp.visualMode
   * @param {string[]} dp.topics
   * @param {number[]} dp.sparseScores
   * @param {number[]} dp.denseScores
   * @param {number} dp.confidence
   * @param {string|null} dp.followUpType
   * @param {string[]} dp.decisionPath
   * @param {{embed?:number,bm25?:number,policy?:number,compose?:number,total?:number}} dp.timings
   * @param {{hits:number,misses:number,size:number}} dp.cacheState
   */
  update(dp) {
    if (!this.isEnabled() || !this._drawer) return;
    this._lastPacket = dp;
    this._render(dp);
  }

  /** Show the drawer. */
  show() {
    if (!this._drawer) return;
    this._drawer.classList.add('relu-debug-visible');
    this._visible = true;
  }

  /** Hide the drawer. */
  hide() {
    if (!this._drawer) return;
    this._drawer.classList.remove('relu-debug-visible');
    this._visible = false;
  }

  /** Toggle drawer visibility. */
  toggle() {
    if (this._visible) this.hide();
    else this.show();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  _injectCSS() {
    if (document.getElementById(CSS_INJECTED)) return;

    const style = document.createElement('style');
    style.id = CSS_INJECTED;
    style.textContent = `
      #${DRAWER_ID} {
        position: fixed;
        top: 0; right: -420px;
        width: 400px; max-width: 90vw;
        height: 100vh;
        background: #1a1a2e;
        color: #e0e0e0;
        font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
        font-size: 12px;
        line-height: 1.5;
        border-left: 1px solid #333;
        box-shadow: -4px 0 20px rgba(0,0,0,0.5);
        z-index: 999999;
        transition: right 0.25s ease;
        overflow-y: auto;
        padding: 16px;
        box-sizing: border-box;
      }
      #${DRAWER_ID}.relu-debug-visible { right: 0; }
      #${DRAWER_ID} h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        color: #fff;
        border-bottom: 1px solid #333;
        padding-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${DRAWER_ID} h4 {
        margin: 16px 0 8px 0;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #888;
      }
      #${DRAWER_ID} .relu-debug-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        margin-right: 6px;
      }
      #${DRAWER_ID} .relu-debug-badge-mode {
        background: #4a90d9; color: #fff;
      }
      #${DRAWER_ID} .relu-debug-badge-intent {
        background: #9b59b6; color: #fff;
      }
      #${DRAWER_ID} .relu-debug-badge-budget {
        background: #e67e22; color: #fff;
      }
      #${DRAWER_ID} .relu-debug-badge-visual {
        background: #27ae60; color: #fff;
      }
      #${DRAWER_ID} .relu-debug-badge-confidence {
        background: #c0392b; color: #fff;
      }
      #${DRAWER_ID} .relu-debug-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        border-bottom: 1px solid #222;
      }
      #${DRAWER_ID} .relu-debug-row:last-child {
        border-bottom: none;
      }
      #${DRAWER_ID} .relu-debug-label {
        color: #888;
      }
      #${DRAWER_ID} .relu-debug-value {
        color: #fff;
        font-weight: 600;
        text-align: right;
        max-width: 60%;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${DRAWER_ID} .relu-debug-topic {
        display: flex;
        justify-content: space-between;
        padding: 3px 0;
        font-size: 11px;
      }
      #${DRAWER_ID} .relu-debug-bar {
        height: 4px;
        background: #333;
        border-radius: 2px;
        margin-top: 2px;
        overflow: hidden;
      }
      #${DRAWER_ID} .relu-debug-bar-fill {
        height: 100%;
        border-radius: 2px;
      }
      #${DRAWER_ID} .relu-debug-bar-sparse {
        background: #4a90d9;
      }
      #${DRAWER_ID} .relu-debug-bar-dense {
        background: #9b59b6;
      }
      #${DRAWER_ID} .relu-debug-timing {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 4px 12px;
        font-size: 11px;
      }
      #${DRAWER_ID} .relu-debug-timing-label {
        color: #888;
      }
      #${DRAWER_ID} .relu-debug-timing-value {
        color: #2ecc71;
        font-weight: 600;
        text-align: right;
      }
      #${DRAWER_ID} .relu-debug-path {
        font-size: 11px;
        color: #aaa;
        line-height: 1.7;
      }
      #${DRAWER_ID} .relu-debug-path-step {
        padding-left: 12px;
        position: relative;
      }
      #${DRAWER_ID} .relu-debug-path-step::before {
        content: '→';
        position: absolute;
        left: 0;
        color: #555;
      }
      #${DRAWER_ID} .relu-debug-path-step:first-child::before {
        content: '▶';
        color: #2ecc71;
      }
      #${DRAWER_ID} .relu-debug-device {
        font-size: 11px;
        color: #aaa;
      }
      #${DRAWER_ID} .relu-debug-device-row {
        display: flex;
        justify-content: space-between;
        padding: 2px 0;
      }
      #${TOGGLE_ID} {
        position: fixed;
        bottom: 16px; right: 16px;
        width: 36px; height: 36px;
        border-radius: 50%;
        background: #333;
        color: #fff;
        border: 1px solid #555;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.7;
        transition: opacity 0.15s;
      }
      #${TOGGLE_ID}:hover {
        opacity: 1;
        background: #444;
      }
    `;
    document.head.appendChild(style);
  }

  _createDrawer() {
    const drawer = document.createElement('div');
    drawer.id = DRAWER_ID;
    drawer.innerHTML = `
      <h3>🐛 ReLU Debug</h3>
      <div id="relu-debug-content"></div>
    `;
    document.body.appendChild(drawer);
    this._drawer = drawer;
  }

  _createToggle() {
    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.textContent = '🐛';
    btn.title = 'Toggle debug panel';
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);
    this._toggle = btn;
  }

  _render(dp) {
    const content = this._drawer.querySelector('#relu-debug-content');
    if (!content) return;

    const device = getDeviceContext();

    content.innerHTML = `
      <!-- Decision badges -->
      <div style="margin-bottom:12px;">
        <span class="relu-debug-badge relu-debug-badge-mode">${this._esc(dp.mode || '—')}</span>
        <span class="relu-debug-badge relu-debug-badge-intent">${this._esc(dp.intent || '—')}</span>
        <span class="relu-debug-badge relu-debug-badge-budget">${this._esc(dp.answerBudget || '—')}</span>
        <span class="relu-debug-badge relu-debug-badge-visual">${this._esc(dp.visualMode || '—')}</span>
      </div>

      <!-- Confidence -->
      <div class="relu-debug-row">
        <span class="relu-debug-label">Confidence</span>
        <span class="relu-debug-badge relu-debug-badge-confidence">${this._fmtNum(dp.confidence)}</span>
      </div>
      <div class="relu-debug-row">
        <span class="relu-debug-label">Follow-up</span>
        <span class="relu-debug-value">${this._esc(dp.followUpType || 'none')}</span>
      </div>

      <!-- Topics -->
      <h4>Topics</h4>
      ${this._renderTopics(dp.topics, dp.sparseScores, dp.denseScores)}

      <!-- Decision path -->
      <h4>Decision Path</h4>
      <div class="relu-debug-path">
        ${(dp.decisionPath || []).map(step => `<div class="relu-debug-path-step">${this._esc(step)}</div>`).join('')}
      </div>

      <!-- Timings -->
      <h4>Timings (ms)</h4>
      <div class="relu-debug-timing">
        ${this._renderTiming('Embed', dp.timings?.embed)}
        ${this._renderTiming('BM25', dp.timings?.bm25)}
        ${this._renderTiming('Policy', dp.timings?.policy)}
        ${this._renderTiming('Compose', dp.timings?.compose)}
        ${this._renderTiming('Total', dp.timings?.total)}
      </div>

      <!-- Cache state -->
      <h4>Cache</h4>
      <div class="relu-debug-row">
        <span class="relu-debug-label">Hits</span>
        <span class="relu-debug-value">${dp.cacheState?.hits ?? '—'}</span>
      </div>
      <div class="relu-debug-row">
        <span class="relu-debug-label">Misses</span>
        <span class="relu-debug-value">${dp.cacheState?.misses ?? '—'}</span>
      </div>
      <div class="relu-debug-row">
        <span class="relu-debug-label">Size</span>
        <span class="relu-debug-value">${dp.cacheState?.size ?? '—'}</span>
      </div>

      <!-- Device context -->
      <h4>Device</h4>
      <div class="relu-debug-device">
        <div class="relu-debug-device-row">
          <span>Mobile</span><span>${device.isMobile ? 'yes' : 'no'}</span>
        </div>
        <div class="relu-debug-device-row">
          <span>Save data</span><span>${device.isSaveData ? 'yes' : 'no'}</span>
        </div>
        <div class="relu-debug-device-row">
          <span>Low memory</span><span>${device.hasLowMemory ? 'yes' : 'no'}</span>
        </div>
        <div class="relu-debug-device-row">
          <span>Budget</span><span>${device.defaultBudget}</span>
        </div>
        <div class="relu-debug-device-row">
          <span>Viewport</span><span>${device.viewportWidth}px</span>
        </div>
        <div class="relu-debug-device-row">
          <span>Memory</span><span>${device.deviceMemory ?? '?'} GB</span>
        </div>
        <div class="relu-debug-device-row">
          <span>Connection</span><span>${device.effectiveType ?? '?'}</span>
        </div>
      </div>
    `;
  }

  _renderTopics(topics, sparseScores, denseScores) {
    if (!topics || topics.length === 0) {
      return '<div style="color:#666;font-size:11px;">No topics</div>';
    }

    const sparse = sparseScores || [];
    const dense = denseScores || [];

    return topics.map((t, i) => {
      const sVal = sparse[i] ?? 0;
      const dVal = dense[i] ?? 0;
      const sPct = Math.round(sVal * 100);
      const dPct = Math.round(dVal * 100);

      return `
        <div class="relu-debug-topic">
          <span>${this._esc(String(t))}</span>
          <span style="color:#888;">S:${sPct}% D:${dPct}%</span>
        </div>
        <div class="relu-debug-bar">
          <div class="relu-debug-bar-fill relu-debug-bar-sparse" style="width:${Math.min(sPct,100)}%;"></div>
        </div>
        <div class="relu-debug-bar">
          <div class="relu-debug-bar-fill relu-debug-bar-dense" style="width:${Math.min(dPct,100)}%;"></div>
        </div>
      `;
    }).join('');
  }

  _renderTiming(label, value) {
    const display = typeof value === 'number' ? `${value.toFixed(1)}` : '—';
    return `
      <span class="relu-debug-timing-label">${this._esc(label)}</span>
      <span class="relu-debug-timing-value">${display}</span>
    `;
  }

  _esc(str) {
    if (str == null) return '—';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  _fmtNum(n) {
    if (n == null) return '—';
    return typeof n === 'number' ? n.toFixed(3) : String(n);
  }
}
