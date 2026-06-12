// ============================================================
//  ReLU.chat — Safe Diagram AST Renderer (Main Module)
//  Pure-DOM SVG renderer. No innerHTML, no raw HTML injection.
//  Track C P1 from the optimization report.
// 
//  Orchestrates: validate.js (schema), renderers.js (SVG generation).
// ============================================================

import { validateDiagramAST } from './diagram-renderer/validate.js';
import { renderByType, buildTextFallback, THEMES, SVG_NS } from './diagram-renderer/renderers.js';

// ---- Rendering cache ----
const renderCache = new Map();
const MAX_CACHE = 200;

function cacheKey(ast, theme) {
  return (ast.id || '') + '|' + theme;
}

function cacheSet(key, result) {
  if (renderCache.size >= MAX_CACHE) {
    renderCache.delete(renderCache.keys().next().value);
  }
  renderCache.set(key, result);
}

/**
 * Render a diagram AST to a safe SVG element.
 *
 * @param {Object} ast  - The diagram AST object.
 * @param {Object} [options] - Render options.
 * @param {number} [options.maxWidth=600] - Max width in pixels.
 * @param {string} [options.theme='dark'] - 'light' or 'dark'.
 * @param {boolean} [options.expandable=false] - Reserved for mobile UX.
 * @param {string} [options.fragmentId] - Cache key component.
 * @returns {{ svgElement: SVGElement|null, textFallback: string, hasRendered: boolean }}
 */
export function renderDiagram(ast, options = {}) {
  const { maxWidth = 600, theme = 'dark', fragmentId = '', expandable = false } = options;

  // 1. Validate
  const validation = validateDiagramAST(ast);
  if (!validation.valid) {
    console.warn('[DiagramRenderer] Invalid AST:', validation.errors);
    return { svgElement: null, textFallback: buildTextFallback(ast), hasRendered: false };
  }

  // 2. Check cache
  const key = cacheKey(ast, theme);
  const cached = renderCache.get(key);
  if (cached) {
    return {
      svgElement: cached.svgElement.cloneNode(true),
      textFallback: cached.textFallback,
      hasRendered: true
    };
  }

  // 3. Select theme colours
  const t = THEMES[theme] || THEMES.dark;

  // 4. Render
  let svgElement = null;
  try {
    svgElement = renderByType(ast, t, maxWidth);
  } catch (err) {
    console.error('[DiagramRenderer] Render error:', err);
    return { svgElement: null, textFallback: buildTextFallback(ast), hasRendered: false };
  }

  // 5. Set shared SVG attributes
  svgElement.setAttribute('class', 'relu-diagram-svg');
  svgElement.setAttribute('data-diagram-type', ast.type);
  svgElement.setAttribute('xmlns', SVG_NS);

  // 6. Build text fallback
  const textFallback = buildTextFallback(ast);

  // 7. Cache
  const result = { svgElement, textFallback, hasRendered: true };
  cacheSet(key, { svgElement: svgElement.cloneNode(true), textFallback, hasRendered: true });

  if (expandable) svgElement.setAttribute('data-expandable', 'true');

  return result;
}

// Re-export validateDiagramAST for external consumers
export { validateDiagramAST };

/**
 * Clear the render cache.
 */
export function clearDiagramCache() {
  renderCache.clear();
}

/**
 * Returns the number of cached entries.
 */
export function getDiagramCacheSize() {
  return renderCache.size;
}
