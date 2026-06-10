/**
 * mobile-rules.js — ReLU.chat Mobile Detection & Adaptive Rules
 *
 * Mobile-specific behavior rules. All decisions are local.
 * No data leaves the browser.
 */

/**
 * Check if the current device is mobile.
 * Uses viewport width and touch capability heuristics.
 *
 * @returns {boolean}
 */
export function isMobile() {
  if (typeof window === 'undefined') return false;

  const narrowViewport = window.innerWidth < 768;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  return narrowViewport || (coarsePointer && touchDevice);
}

/**
 * Check if the user has enabled Data Saver mode.
 *
 * @returns {boolean}
 */
export function isSaveData() {
  if (typeof navigator === 'undefined') return false;

  const conn = navigator.connection;
  if (conn && typeof conn.saveData === 'boolean') {
    return conn.saveData;
  }
  return false;
}

/**
 * Check if the device has low memory (< 4 GB).
 *
 * @returns {boolean}
 */
export function hasLowMemory() {
  if (typeof navigator === 'undefined') return false;

  const mem = navigator.deviceMemory;
  if (typeof mem === 'number') {
    return mem < 4;
  }
  return false;
}

/**
 * Get the default answer budget for the current device.
 *
 * Returns 'short' if any mobile / save-data / low-memory condition is met.
 * Otherwise returns 'medium'.
 *
 * @returns {'short'|'medium'|'long'}
 */
export function getDeviceDefaultBudget() {
  if (isMobile() || isSaveData() || hasLowMemory()) {
    return 'short';
  }
  return 'medium';
}

/**
 * Get the diagram display mode for the current device.
 *
 * @returns {'expandable'|'inline'}
 */
export function getDeviceDiagramMode() {
  return isMobile() ? 'expandable' : 'inline';
}

/**
 * Determine whether heavy models should be preloaded.
 *
 * Returns false if Data Saver is on, memory is low, or the document is hidden.
 *
 * @returns {boolean}
 */
export function shouldPreloadModels() {
  if (isSaveData()) return false;
  if (hasLowMemory()) return false;
  if (typeof document !== 'undefined' && document.hidden) return false;
  return true;
}

/**
 * Get the maximum preload concurrency for the current device.
 *
 * @returns {number}
 */
export function getMaxPreloadConcurrency() {
  return isMobile() ? 1 : 3;
}

/**
 * Get a summary of the current device context.
 * Useful for debug panels and adaptive rendering.
 *
 * @returns {{
 *   isMobile: boolean,
 *   isSaveData: boolean,
 *   hasLowMemory: boolean,
 *   defaultBudget: 'short'|'medium'|'long',
 *   diagramMode: 'expandable'|'inline',
 *   shouldPreload: boolean,
 *   maxConcurrency: number,
 *   viewportWidth: number,
 *   deviceMemory: number|null,
 *   connectionType: string|null,
 *   effectiveType: string|null
 * }}
 */
export function getDeviceContext() {
  const conn = typeof navigator !== 'undefined' ? navigator.connection : null;

  return {
    isMobile: isMobile(),
    isSaveData: isSaveData(),
    hasLowMemory: hasLowMemory(),
    defaultBudget: getDeviceDefaultBudget(),
    diagramMode: getDeviceDiagramMode(),
    shouldPreload: shouldPreloadModels(),
    maxConcurrency: getMaxPreloadConcurrency(),
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
    deviceMemory: typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? navigator.deviceMemory
      : null,
    connectionType: conn?.type || null,
    effectiveType: conn?.effectiveType || null,
  };
}
