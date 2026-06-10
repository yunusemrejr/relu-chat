// ============================================================
//  ReLU.chat — Diagram AST Validators
//  Schema validation for all diagram types.
//  Part of the safe diagram renderer (Track C P1).
// ============================================================

const STYLE_WHITELIST = new Set([
  'highlight', 'muted', 'emphasis', 'primary',
  'secondary', 'success', 'warning', 'danger'
]);

const KNOWN_TYPES = new Set([
  'payoff_matrix', 'confusion_matrix', 'timeline', 'flow', 'chart'
]);

export { STYLE_WHITELIST, KNOWN_TYPES };

export function validateDiagramAST(ast) {
  const errors = [];
  if (!ast || typeof ast !== 'object' || Array.isArray(ast)) {
    return { valid: false, errors: ['AST must be a non-null object'] };
  }
  if (!ast.type || !KNOWN_TYPES.has(ast.type)) {
    errors.push(`Unknown or missing diagram type: "${ast.type}". Must be one of: ${[...KNOWN_TYPES].join(', ')}`);
    return { valid: false, errors };
  }

  switch (ast.type) {
    case 'payoff_matrix':  return validatePayoffMatrix(ast, errors);
    case 'confusion_matrix': return validateConfusionMatrix(ast, errors);
    case 'timeline':       return validateTimeline(ast, errors);
    case 'flow':           return validateFlow(ast, errors);
    case 'chart':          return validateChart(ast, errors);
    default:               return { valid: false, errors: [`Unknown type: ${ast.type}`] };
  }
}

function validatePayoffMatrix(ast, errors) {
  if (!Array.isArray(ast.players) || ast.players.length < 2) {
    errors.push('payoff_matrix requires "players" array with at least 2 entries');
  }
  if (!Array.isArray(ast.rows) || ast.rows.length === 0) {
    errors.push('payoff_matrix requires non-empty "rows" array');
  }
  if (!Array.isArray(ast.cols) || ast.cols.length === 0) {
    errors.push('payoff_matrix requires non-empty "cols" array');
  }
  if (Array.isArray(ast.cells)) {
    const expected = ast.rows.length * ast.cols.length;
    if (ast.cells.length !== expected) {
      errors.push(`payoff_matrix cells length ${ast.cells.length} does not match rows×cols (${expected})`);
    }
    for (let i = 0; i < ast.cells.length; i++) {
      const c = ast.cells[i];
      if (!c || typeof c !== 'object') {
        errors.push(`cells[${i}] must be an object`);
        continue;
      }
      if (!Array.isArray(c.payoff) || c.payoff.length < 2) {
        errors.push(`cells[${i}].payoff must be an array with at least 2 numbers`);
      } else {
        for (let j = 0; j < c.payoff.length; j++) {
          if (typeof c.payoff[j] !== 'number' || !isFinite(c.payoff[j])) {
            errors.push(`cells[${i}].payoff[${j}] must be a finite number`);
          }
        }
      }
    }
  } else {
    errors.push('payoff_matrix requires "cells" array');
  }
  return { valid: errors.length === 0, errors };
}

function validateConfusionMatrix(ast, errors) {
  if (!Array.isArray(ast.labels) || ast.labels.length < 2) {
    errors.push('confusion_matrix requires "labels" array with at least 2 entries');
  }
  if (!Array.isArray(ast.cells) || ast.cells.length === 0) {
    errors.push('confusion_matrix requires non-empty "cells" 2D array');
  } else {
    const nLabels = ast.labels ? ast.labels.length : 0;
    for (let i = 0; i < ast.cells.length; i++) {
      if (!Array.isArray(ast.cells[i])) {
        errors.push(`confusion_matrix cells[${i}] must be an array`);
      } else if (nLabels > 0 && ast.cells[i].length !== nLabels) {
        errors.push(`confusion_matrix cells[${i}] length ${ast.cells[i].length} != labels count ${nLabels}`);
      } else {
        for (let j = 0; j < ast.cells[i].length; j++) {
          if (typeof ast.cells[i][j] !== 'number' || !isFinite(ast.cells[i][j]) || ast.cells[i][j] < 0) {
            errors.push(`confusion_matrix cells[${i}][${j}] must be a non-negative finite number`);
          }
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateTimeline(ast, errors) {
  if (!Array.isArray(ast.events) || ast.events.length === 0) {
    errors.push('timeline requires non-empty "events" array');
  } else {
    for (let i = 0; i < ast.events.length; i++) {
      const e = ast.events[i];
      if (!e || typeof e !== 'object') {
        errors.push(`events[${i}] must be an object`);
        continue;
      }
      if (typeof e.year !== 'string' || !e.year.trim()) {
        errors.push(`events[${i}].year must be a non-empty string`);
      }
      if (typeof e.title !== 'string' || !e.title.trim()) {
        errors.push(`events[${i}].title must be a non-empty string`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateFlow(ast, errors) {
  if (!Array.isArray(ast.nodes) || ast.nodes.length === 0) {
    errors.push('flow requires non-empty "nodes" array');
  } else {
    const ids = new Set();
    for (let i = 0; i < ast.nodes.length; i++) {
      const n = ast.nodes[i];
      if (!n || typeof n !== 'object') {
        errors.push(`nodes[${i}] must be an object`);
        continue;
      }
      if (typeof n.id !== 'string' || !n.id.trim()) errors.push(`nodes[${i}].id must be a non-empty string`);
      if (ids.has(n.id)) errors.push(`Duplicate node id: "${n.id}"`);
      ids.add(n.id);
      if (typeof n.label !== 'string') errors.push(`nodes[${i}].label must be a string`);
      if (typeof n.x !== 'number' || n.x < 0 || n.x > 1) errors.push(`nodes[${i}].x must be a number in [0,1]`);
      if (typeof n.y !== 'number' || n.y < 0 || n.y > 1) errors.push(`nodes[${i}].y must be a number in [0,1]`);
    }
    if (Array.isArray(ast.edges)) {
      for (let i = 0; i < ast.edges.length; i++) {
        const e = ast.edges[i];
        if (!e || typeof e !== 'object') {
          errors.push(`edges[${i}] must be an object`);
          continue;
        }
        if (!ids.has(e.from)) errors.push(`edges[${i}].from "${e.from}" does not reference a known node id`);
        if (!ids.has(e.to))   errors.push(`edges[${i}].to "${e.to}" does not reference a known node id`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function validateChart(ast, errors) {
  if (!Array.isArray(ast.bars) || ast.bars.length === 0) {
    errors.push('chart requires non-empty "bars" array');
  } else {
    for (let i = 0; i < ast.bars.length; i++) {
      const b = ast.bars[i];
      if (!b || typeof b !== 'object') {
        errors.push(`bars[${i}] must be an object`);
        continue;
      }
      if (typeof b.label !== 'string') errors.push(`bars[${i}].label must be a string`);
      if (typeof b.value !== 'number' || !isFinite(b.value)) errors.push(`bars[${i}].value must be a finite number`);
      if (b.color && typeof b.color !== 'string') errors.push(`bars[${i}].color must be a string if provided`);
      if (b.style && !STYLE_WHITELIST.has(b.style)) {
        errors.push(`bars[${i}].style "${b.style}" is not in the style whitelist`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
