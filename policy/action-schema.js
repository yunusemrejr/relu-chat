/**
 * action-schema.js — ReLU.chat WASM Policy Runtime
 *
 * Defines the AnswerPlan schema, validation, and defaults.
 * This is the contract between the policy engine (WASM or heuristic)
 * and the renderer (composeV2 in nlp.js).
 *
 * Design Version: 1.0.0 (wasm-policy-architecture.json §3)
 * Determinisim:    The policy returns a fully-specified plan;
 *                  the renderer is a pure function of plan + KB + overrides.
 */

// ---------------------------------------------------------------------------
// 1. Schema definition — every field, its type, constraints, and defaults
// ---------------------------------------------------------------------------

/** @type {import('./action-schema').PlanSchema} */
export const PLAN_SCHEMA = Object.freeze({
  mode: {
    type: 'string',
    enum: ['normal', 'off_topic', 'greeting', 'help', 'comparison'],
    default: 'normal',
    desc: 'Top-level control flow. Determines which render path to use.'
  },
  topics: {
    type: 'array',
    elementType: 'number',   // all are integer KB-indices
    maxItems: 3,
    minItems: 0,
    default: [],
    desc: 'KB entry indices in presentation order (policy decides ranking + count).'
  },
  intent: {
    type: 'string',
    enum: ['definition', 'example', 'formal', 'application', 'comparison'],
    default: 'definition',
    desc: 'Selected intent. Policy can override low-confidence classifier output.'
  },
  fragmentPlan: {
    type: 'array',
    elementType: 'object',
    default: [],
    itemSchema: {
      topicIdx: { type: 'number', isInteger: true, min: 0,           desc: 'Index into the topics[] array (0-based).' },
      cats:     { type: 'array',  elementType: 'string', maxItems: 3, desc: 'Category codes: def, int, ex, form, app.' },
      fragIndices: { type: 'array', elementType: 'number', isInteger: true, min: 0, desc: 'Index into entry.f[cat] array chosen by policy.' }
    },
    desc: 'Per-topic fragment selection plan. One entry per topic in topics[].'
  },
  template: {
    type: 'object',
    default: {
      openerIdx: 0,
      closerIdx: 0,
      comparisonOpenerKey: 'none',
      connectorKeys: []
    },
    itemSchema: {
      openerIdx:           { type: 'number', isInteger: true, min: 0, default: 0, desc: 'Index into overrides.openers pool.' },
      closerIdx:           { type: 'number', isInteger: true, min: 0, default: 0, desc: 'Index into overrides.closers pool.' },
      comparisonOpenerKey: { type: 'string', enum: ['both', 'contrast', 'similarity', 'none'], default: 'none', desc: 'Which comparison opener variant to use.' },
      connectorKeys:       { type: 'array',  elementType: 'string', default: [], desc: 'Keys like "def_to_int" selected by policy; one per transition.' }
    },
    desc: 'Template indices. Policy chooses numeric indices into lexical pools so renderer is deterministic.'
  },
  tone: {
    type: 'string',
    enum: ['neutral', 'formal', 'intuitive', 'playful'],
    default: 'neutral',
    desc: 'Affects connector/closer lexical choice at render time.'
  },
  creativity: {
    type: 'number',
    min: 0,
    max: 1,
    default: 0.5,
    desc: 'Softmax temperature multiplier for any remaining stochastic choice.'
  },
  guardrails: {
    type: 'object',
    default: {
      maxTopics: 3,
      requireEntity: false,
      minSim: 0.15,
      allowOffTopic: false
    },
    itemSchema: {
      maxTopics:      { type: 'number', isInteger: true, min: 0, max: 5, default: 3,     desc: 'Hard cap on topics selected.' },
      requireEntity:  { type: 'boolean', default: false,                                     desc: 'If true, entity match is required to include a topic.' },
      minSim:         { type: 'number',  min: 0, max: 1,              default: 0.15,          desc: 'Minimum similarity threshold for topic inclusion.' },
      allowOffTopic:  { type: 'boolean', default: false,                                     desc: 'If true, allows off-topic response path.' }
    },
    desc: 'Safety constraints applied during plan validation.'
  },
  meta: {
    type: 'object',
    default: {
      policyVersion: '0.1.0',
      policyHash: 'heuristic-fallback',
      decisionPath: []
    },
    itemSchema: {
      policyVersion: { type: 'string', default: '0.1.0', desc: 'Semantic version of policy that generated this plan.' },
      policyHash:    { type: 'string', default: '',       desc: 'Hash of weights used for generation (for audit).' },
      decisionPath:  { type: 'array',  elementType: 'string', default: [], desc: 'Decision trace e.g. ["greeting: low sim", "entity: Nash equilibrium"].' }
    },
    desc: 'Metadata for traceability and debugging.'
  }
});

// ---------------------------------------------------------------------------
// 2. Default plan — used as a safe fallback when validation fails
// ---------------------------------------------------------------------------

/**
 * Heuristic fallback plan.  Always valid, always safe.
 * The renderer receiving this plan will produce a generic off-topic response.
 */
export const DEFAULT_PLAN = Object.freeze({
  mode: 'off_topic',
  topics: [],
  intent: 'definition',
  fragmentPlan: [],
  template: {
    openerIdx: 0,
    closerIdx: 0,
    comparisonOpenerKey: 'none',
    connectorKeys: []
  },
  tone: 'neutral',
  creativity: 0.3,
  guardrails: {
    maxTopics: 3,
    requireEntity: false,
    minSim: 0.15,
    allowOffTopic: true
  },
  meta: {
    policyVersion: '0.1.0',
    policyHash: 'default-plan',
    decisionPath: ['DEFAULT_PLAN']
  }
});

// ---------------------------------------------------------------------------
// 3. Validation helpers
// ---------------------------------------------------------------------------

/**
 * Type-check a single value against a field schema entry.
 * @param {*} val          - value to check
 * @param {object} schema  - field schema sub-object
 * @param {string} path    - human-readable path for error messages
 * @returns {string|null}  - error string or null if valid
 */
function checkField(val, schema, path) {
  if (val === undefined || val === null) return `${path}: required field is missing`;

  switch (schema.type) {
    case 'string': {
      if (typeof val !== 'string') return `${path}: expected string, got ${typeof val}`;
      if (schema.enum && !schema.enum.includes(val))
        return `${path}: "${val}" not in enum [${schema.enum.join(', ')}]`;
      return null;
    }
    case 'number': {
      if (typeof val !== 'number' || !Number.isFinite(val)) return `${path}: expected finite number, got ${val}`;
      if (schema.isInteger && !Number.isInteger(val)) return `${path}: expected integer`;
      if (schema.min !== undefined && val < schema.min) return `${path}: ${val} < min ${schema.min}`;
      if (schema.max !== undefined && val > schema.max) return `${path}: ${val} > max ${schema.max}`;
      return null;
    }
    case 'boolean': {
      if (typeof val !== 'boolean') return `${path}: expected boolean, got ${typeof val}`;
      return null;
    }
    case 'array': {
      if (!Array.isArray(val)) return `${path}: expected array, got ${typeof val}`;
      if (schema.maxItems !== undefined && val.length > schema.maxItems)
        return `${path}: length ${val.length} > maxItems ${schema.maxItems}`;
      if (schema.minItems !== undefined && val.length < schema.minItems)
        return `${path}: length ${val.length} < minItems ${schema.minItems}`;
      if (schema.elementType === 'number') {
        for (let i = 0; i < val.length; i++) {
          if (typeof val[i] !== 'number' || !Number.isFinite(val[i]))
            return `${path}[${i}]: expected number, got ${typeof val[i]}`;
        }
      }
      if (schema.elementType === 'string') {
        for (let i = 0; i < val.length; i++) {
          if (typeof val[i] !== 'string')
            return `${path}[${i}]: expected string, got ${typeof val[i]}`;
        }
      }
      return null;
    }
    case 'object': {
      if (typeof val !== 'object' || val === null || Array.isArray(val))
        return `${path}: expected plain object, got ${Array.isArray(val) ? 'array' : typeof val}`;
      if (schema.itemSchema) {
        for (const [k, sub] of Object.entries(schema.itemSchema)) {
          // missing required fields inside object (all fields in schema are required by convention)
          if (!(k in val)) return `${path}.${k}: required field missing`;
          const err = checkField(val[k], sub, `${path}.${k}`);
          if (err) return err;
        }
      }
      return null;
    }
    default:
      return `${path}: unknown schema type "${schema.type}"`;
  }
}

// ---------------------------------------------------------------------------
// 4. Main validation entry point
// ---------------------------------------------------------------------------

/**
 * Validate an AnswerPlan object against PLAN_SCHEMA.
 *
 * This is called by the runtime before rendering any plan, regardless of
 * whether it came from WASM inference or the heuristic fallback.
 *
 * @param {object} plan - the plan to validate
 * @returns {{ valid: boolean, errors: string[], sanitized: object }}
 *          sanitized contains the plan with errors fixed (or DEFAULT_PLAN if fatal)
 */
export function validatePlan(plan) {
  const errors = [];
  const sanitized = structuredClone ? structuredClone(DEFAULT_PLAN) : JSON.parse(JSON.stringify(DEFAULT_PLAN));

  if (!plan || typeof plan !== 'object') {
    errors.push('plan is null or not an object – using DEFAULT_PLAN');
    return { valid: false, errors, sanitized };
  }

  // Walk the schema and check every top-level field
  for (const [field, schema] of Object.entries(PLAN_SCHEMA)) {
    if (!(field in plan)) {
      errors.push(`${field}: missing – using default`);
      sanitized[field] = schema.default;
      continue;
    }

    const err = checkField(plan[field], schema, field);
    if (err) {
      errors.push(err + ' – using default');
      sanitized[field] = schema.default;
    } else {
      sanitized[field] = plan[field];
    }
  }

  // Cross-field validation: topics length must equal fragmentPlan length
  if (sanitized.topics.length !== sanitized.fragmentPlan.length) {
    errors.push(
      `topics.length (${sanitized.topics.length}) != fragmentPlan.length ` +
      `(${sanitized.fragmentPlan.length}) – truncating fragmentPlan`
    );
    sanitized.fragmentPlan = sanitized.fragmentPlan.slice(0, sanitized.topics.length);
  }

  // Cross-field validation: fragmentPlan topicIdx must be valid
  for (let i = 0; i < sanitized.fragmentPlan.length; i++) {
    const fp = sanitized.fragmentPlan[i];
    if (fp.topicIdx < 0 || fp.topicIdx >= sanitized.topics.length) {
      errors.push(`fragmentPlan[${i}].topicIdx=${fp.topicIdx} out of range [0,${sanitized.topics.length - 1}] – fixing to 0`);
      fp.topicIdx = 0;
    }
  }

  // Cross-field validation: comparison mode needs ≥2 topics
  if (sanitized.mode === 'comparison' && sanitized.topics.length < 2) {
    errors.push('comparison mode requires ≥2 topics – falling back to normal');
    sanitized.mode = 'normal';
  }

  // Ensure guardrails.maxTopics is consistent with topics.length
  if (sanitized.topics.length > sanitized.guardrails.maxTopics) {
    errors.push(
      `topics.length (${sanitized.topics.length}) > guardrails.maxTopics ` +
      `(${sanitized.guardrails.maxTopics}) – truncating topics`
    );
    sanitized.topics = sanitized.topics.slice(0, sanitized.guardrails.maxTopics);
    sanitized.fragmentPlan = sanitized.fragmentPlan.slice(0, sanitized.guardrails.maxTopics);
  }

  // Ensure decisionPath is always initialized
  if (!Array.isArray(sanitized.meta.decisionPath)) {
    sanitized.meta.decisionPath = [];
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized
  };
}

/**
 * Quick type-check: is this object shaped like an AnswerPlan?
 * Useful as a guard before calling validatePlan.
 *
 * @param {*} candidate
 * @returns {boolean}
 */
export function isAnswerPlanLike(candidate) {
  return candidate
    && typeof candidate === 'object'
    && typeof candidate.mode === 'string'
    && Array.isArray(candidate.topics);
}
