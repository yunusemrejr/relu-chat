/**
 * export-bot-pack.js
 * Bot-pack exporter for relu.chat — Track B P1.
 *
 * Reads existing bot KB data and produces optimized pack files:
 *   bot.pack.json, entries.json, fragments.json, aliases.json,
 *   bm25.json, diagrams.json, plus optional policy weights.
 *
 * Usage:
 *   node dev/scripts/export-bot-pack.js --bot game-theory-chat
 *   node dev/scripts/export-bot-pack.js --bot all
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { buildBM25Index, buildAliasIndex } = require('./build-bm25-index.js');

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data', 'bots');
const POLICY_DIR = path.join(PROJECT_ROOT, 'assets', 'models', 'policy');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'dev', 'exports', 'bot-packs');

// ── Bot ID → policy folder mapping ────────────────────────────────────────
function policyFolderForBotId(botId) {
  const map = {
    'game-theory-chat': 'game-theory',
    'data-science-chat': 'data-science',
    'golden-age-inquiry': 'golden-age'
  };
  if (map[botId]) return map[botId];
  // Fallback: strip common suffixes
  return botId.replace(/-(chat|inquiry|bot)$/, '');
}

// ── CLI args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  let botArg = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bot' && i + 1 < args.length) {
      botArg = args[i + 1];
    }
  }
  return { botArg };
}

function getBotIds() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error('Data directory not found:', DATA_DIR);
    process.exit(1);
  }
  return fs.readdirSync(DATA_DIR).filter(f => {
    const p = path.join(DATA_DIR, f);
    return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'knowledge.js'));
  });
}

// ── Dynamic import of ES module files ─────────────────────────────────────
async function importModule(filePath) {
  const url = pathToFileURL(filePath).href;
  try {
    const mod = await import(url);
    return mod;
  } catch (e) {
    console.error(`Failed to import ${filePath}:`, e.message);
    throw e;
  }
}

// ── Load bot data ─────────────────────────────────────────────────────────
async function loadBotData(botId) {
  const botDir = path.join(DATA_DIR, botId);

  // Knowledge base
  const kbPath = path.join(botDir, 'knowledge.js');
  const kbMod = await importModule(kbPath);
  const KB = kbMod.KB || [];
  const entryText = kbMod.entryText || ((e) => `${e.name} ${e.aliases?.join(' ') || ''} ${e.summary}`);
  const KB_VERSION = kbMod.KB_VERSION || '1.0.0';

  // Fragment metadata
  const fragmentMetaPath = path.join(botDir, 'fragment-meta.json');
  let fragmentMeta = {};
  if (fs.existsSync(fragmentMetaPath)) {
    fragmentMeta = JSON.parse(fs.readFileSync(fragmentMetaPath, 'utf-8'));
  }

  // Overrides
  const overridesPath = path.join(botDir, 'overrides.js');
  let overrides = {};
  if (fs.existsSync(overridesPath)) {
    const overridesMod = await importModule(overridesPath);
    overrides = overridesMod.overrides || {};
  }

  // Intents
  const intentsPath = path.join(botDir, 'intents.js');
  let INTENTS = {};
  let INTENTS_ORDER = {};
  if (fs.existsSync(intentsPath)) {
    const intentsMod = await importModule(intentsPath);
    INTENTS = intentsMod.INTENTS || {};
    INTENTS_ORDER = intentsMod.INTENTS_ORDER || {};
  }

  // Policy weights
  const policyFolder = policyFolderForBotId(botId);
  const policyWeightsPath = path.join(POLICY_DIR, policyFolder, 'policy.weights.json');
  const policyManifestPath = path.join(POLICY_DIR, policyFolder, 'policy.manifest.json');
  const hasPolicyWeights = fs.existsSync(policyWeightsPath);
  const hasPolicyManifest = fs.existsSync(policyManifestPath);

  return {
    botId,
    KB,
    entryText,
    KB_VERSION,
    fragmentMeta,
    overrides,
    INTENTS,
    INTENTS_ORDER,
    policyWeightsPath: hasPolicyWeights ? policyWeightsPath : null,
    policyManifestPath: hasPolicyManifest ? policyManifestPath : null,
    hasPolicy: hasPolicyWeights
  };
}

// ── Build entries.json ────────────────────────────────────────────────────
function buildEntries(KB) {
  return KB.map((entry, idx) => ({
    id: entry.id,
    idx,
    name: entry.name,
    aliases: entry.aliases || [],
    summary: entry.summary || '',
    related: entry.related || [],
    fragmentKeys: Object.keys(entry.f || {})
  }));
}

// ── Build fragments.json ──────────────────────────────────────────────────
function buildFragments(fragmentMeta) {
  // Return a compact version of fragment metadata keyed by entry_id
  const result = {};
  for (const [key, meta] of Object.entries(fragmentMeta)) {
    result[key] = {
      entry_id: meta.entry_id,
      name: meta.name,
      summary: meta.summary,
      related: meta.related || [],
      fragmentCount: meta.fragments
        ? Object.values(meta.fragments).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0)
        : 0
    };
  }
  return result;
}

// ── Build diagrams.json (related-entry graph) ─────────────────────────────
function buildDiagrams(fragmentMeta) {
  const nodes = [];
  const edges = [];
  const seen = new Set();

  for (const [key, meta] of Object.entries(fragmentMeta)) {
    if (!seen.has(key)) {
      seen.add(key);
      nodes.push({ id: key, label: meta.name || key });
    }
    for (const related of meta.related || []) {
      if (!seen.has(related)) {
        seen.add(related);
        nodes.push({ id: related, label: related });
      }
      edges.push({ source: key, target: related });
    }
  }

  return { nodes, edges };
}

// ── Build overrides.json ──────────────────────────────────────────────────
function buildOverrides(overrides) {
  return overrides;
}

// ── Build intents.json ────────────────────────────────────────────────────
function buildIntents(INTENTS, INTENTS_ORDER) {
  return { INTENTS, INTENTS_ORDER };
}

// ── Write file helper ─────────────────────────────────────────────────────
function writeJSON(dir, filename, data) {
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

function writeFile(dir, filename, srcPath) {
  const destPath = path.join(dir, filename);
  fs.copyFileSync(srcPath, destPath);
  return destPath;
}

// ── Generate float16 vectors placeholder ──────────────────────────────────
function writeVectorPlaceholder(dir, filename, count, dim) {
  const placeholder = {
    _note: 'Precomputed vectors not generated by export script. Run transformer model to produce actual vectors.',
    count,
    dim,
    dtype: 'float16',
    data: null
  };
  return writeJSON(dir, filename, placeholder);
}

// ── Export a single bot ───────────────────────────────────────────────────
async function exportBot(botId) {
  console.log(`\n📦 Exporting bot-pack for: ${botId}`);

  const data = await loadBotData(botId);
  const outDir = path.join(OUTPUT_DIR, botId);
  fs.mkdirSync(outDir, { recursive: true });

  // 1. entries.json
  const entries = buildEntries(data.KB);
  writeJSON(outDir, 'entries.json', entries);
  console.log(`  ✓ entries.json (${entries.length} entries)`);

  // 2. fragments.json
  const fragments = buildFragments(data.fragmentMeta);
  writeJSON(outDir, 'fragments.json', fragments);
  console.log(`  ✓ fragments.json (${Object.keys(fragments).length} fragment groups)`);

  // 3. aliases.json
  const aliasIndex = buildAliasIndex(data.KB);
  writeJSON(outDir, 'aliases.json', aliasIndex);
  console.log(`  ✓ aliases.json (${Object.keys(aliasIndex).length} aliases)`);

  // 4. bm25.json
  const bm25Index = buildBM25Index(data.KB);
  writeJSON(outDir, 'bm25.json', bm25Index);
  console.log(`  ✓ bm25.json (${Object.keys(bm25Index.terms).length} terms, ${Object.keys(bm25Index.bigrams).length} bigrams)`);

  // 5. diagrams.json
  const diagrams = buildDiagrams(data.fragmentMeta);
  writeJSON(outDir, 'diagrams.json', diagrams);
  console.log(`  ✓ diagrams.json (${diagrams.nodes.length} nodes, ${diagrams.edges.length} edges)`);

  // 6. overrides.json
  const overrides = buildOverrides(data.overrides);
  writeJSON(outDir, 'overrides.json', overrides);
  console.log(`  ✓ overrides.json`);

  // 7. intents.json
  const intents = buildIntents(data.INTENTS, data.INTENTS_ORDER);
  writeJSON(outDir, 'intents.json', intents);
  console.log(`  ✓ intents.json (${Object.keys(intents.INTENTS).length} intents)`);

  // 8. Vector placeholders
  writeVectorPlaceholder(outDir, 'entry-vectors.f16.json', data.KB.length, 384);
  writeVectorPlaceholder(outDir, 'fragment-vectors.f16.json', Object.keys(data.fragmentMeta).length, 384);
  console.log(`  ✓ entry-vectors.f16.json (placeholder)`);
  console.log(`  ✓ fragment-vectors.f16.json (placeholder)`);

  // 9. Policy weights
  let policyManifest = null;
  if (data.hasPolicy) {
    writeFile(outDir, 'policy.weights.json', data.policyWeightsPath);
    console.log(`  ✓ policy.weights.json`);
    if (data.policyManifestPath) {
      writeFile(outDir, 'policy.manifest.json', data.policyManifestPath);
      policyManifest = JSON.parse(fs.readFileSync(data.policyManifestPath, 'utf-8'));
      console.log(`  ✓ policy.manifest.json`);
    }
  }

  // 10. bot.pack.json manifest
  const packManifest = {
    botId: data.botId,
    kbVersion: data.KB_VERSION,
    model: {
      embedding: 'all-MiniLM-L6-v2',
      dim: 384,
      vectorDtype: 'float16'
    },
    config: {
      thresholds: {
        minSim: 0.15,
        entityBoost: 0.2,
        followUpBoost: 0.15
      }
    },
    entries: 'entries.json',
    fragments: 'fragments.json',
    aliasIndex: 'aliases.json',
    bm25Index: 'bm25.json',
    entryVectors: 'entry-vectors.f16.json',
    fragmentVectors: 'fragment-vectors.f16.json',
    diagrams: 'diagrams.json',
    overrides: 'overrides.json',
    intents: 'intents.json',
    policy: data.hasPolicy
      ? {
          weights: 'policy.weights.json',
          manifest: data.policyManifestPath ? 'policy.manifest.json' : null
        }
      : null
  };

  writeJSON(outDir, 'bot.pack.json', packManifest);
  console.log(`  ✓ bot.pack.json`);

  // Summary
  const stats = {
    botId: data.botId,
    kbVersion: data.KB_VERSION,
    entryCount: entries.length,
    fragmentGroupCount: Object.keys(fragments).length,
    aliasCount: Object.keys(aliasIndex).length,
    bm25Terms: Object.keys(bm25Index.terms).length,
    bm25Bigrams: Object.keys(bm25Index.bigrams).length,
    diagramNodes: diagrams.nodes.length,
    diagramEdges: diagrams.edges.length,
    policyIncluded: data.hasPolicy,
    outputDir: outDir
  };

  console.log(`\n  📊 Summary for ${botId}:`);
  console.log(`     Entries:        ${stats.entryCount}`);
  console.log(`     Fragments:      ${stats.fragmentGroupCount} groups`);
  console.log(`     Aliases:        ${stats.aliasCount}`);
  console.log(`     BM25 terms:     ${stats.bm25Terms}`);
  console.log(`     BM25 bigrams:   ${stats.bm25Bigrams}`);
  console.log(`     Diagram nodes:  ${stats.diagramNodes}`);
  console.log(`     Diagram edges:  ${stats.diagramEdges}`);
  console.log(`     Policy:         ${stats.policyIncluded ? 'yes' : 'no'}`);

  return stats;
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const { botArg } = parseArgs();

  if (!botArg) {
    console.error('Usage: node dev/scripts/export-bot-pack.js --bot <bot-id> | --bot all');
    console.error('');
    console.error('Available bots:');
    for (const b of getBotIds()) {
      console.error(`  ${b}`);
    }
    process.exit(1);
  }

  let botIds;
  if (botArg === 'all') {
    botIds = getBotIds();
    if (botIds.length === 0) {
      console.error('No bots found in', DATA_DIR);
      process.exit(1);
    }
  } else {
    botIds = [botArg];
  }

  const allStats = [];
  for (const botId of botIds) {
    try {
      const stats = await exportBot(botId);
      allStats.push(stats);
    } catch (err) {
      console.error(`\n❌ Failed to export ${botId}:`, err.message);
      console.error(err.stack);
      process.exitCode = 1;
    }
  }

  console.log(`\n✅ Export complete. Output: ${OUTPUT_DIR}`);
  console.log(`   Bots exported: ${allStats.length}`);
  for (const s of allStats) {
    console.log(`   • ${s.botId}: ${s.entryCount} entries, ${s.bm25Terms} terms`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
