#!/usr/bin/env python3
"""
train-policy.py — ReLU.chat WASM Policy Training Pipeline
Design: wasm-policy-architecture.json §7

This script will train a lightweight policy model (linear Q-table / small MLP)
using REINFORCE or PPO, then export to ONNX and compile to WASM via wasm-opt.

Current state: SKELETON — generates prompts, defines reward function, stubs
the training loop. The full implementation requires:
  - PyTorch 2.x
  - numpy
  - onnx / onnxruntime
  - A GPU runner (T4 via GitHub Actions or local)

Pipeline steps:
  1. generatePrompts()         — create 5000+ seed + augmented prompts per bot
  2. buildRetrievalDataset()   — simulate embedding + ranking → candidate sets
  3. definePolicyNetwork()     — small MLP: 25 in → 128 → 64 → action_heads
  4. defineRewardFunction()    — multi-component reward (architecture §7.5)
  5. train()                   — REINFORCE/PPO loop with baseline subtraction
  6. export_onnx()             — freeze graph → ONNX
  7. compile_wasm()            — onnx → wasm via wasm-opt (instructions here)

Improvements (2026-05-26):
  - Experience replay buffer for off-policy mini-batch training stability
  - Configurable multi-component reward with follow-up, diversity, coherence
  - Curriculum learning with difficulty-based sampling schedule
  - Entropy regularization with annealing (0.05 → 0.01)
  - Cosine LR scheduling for better convergence
  - Gradient clipping and advantage normalization
  - Multi-turn training data generation (follow-up query pairs)
  - Rich training metrics: reward, entropy, loss, value loss, learning rate
  - Deterministic seeds for reproducible training (--seed)
  - Train/validation split with val metrics tracking (--val-split)
  - Per-component reward breakdown in metrics (intent_match, topic_precision, etc.)
  - Policy metadata export (model version, heads, reward weights, training config)

Usage:
  python3 train-policy.py --bot game-theory --epochs 1000 --output ../assets/models/policy/
"""

import argparse
import json
import re
import os
import random
import sys
import time
import torch
import torch.nn.functional as F
import numpy as np
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict, deque

from policy_model import PolicyNetwork, ACTION_SIZES_ORDERED, N_FEATURES

# ---------------------------------------------------------------------------
# Deterministic seed for reproducible training
# ---------------------------------------------------------------------------

def set_seed(seed: int):
    """Set all random seeds for deterministic training."""
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False
    print(f"[seed] Deterministic mode enabled (seed={seed})")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Feature layout (must match policy/feature-extractor.js exactly)
FEATURE_NAMES = [
    "qSimTop1", "qSimTop2",               # 0-1
    "entityCount", "entityBoostHit",        # 2-3
    "intentDefScore", "intentExScore",     # 4-5
    "intentFormScore", "intentAppScore",   # 6-7
    "intentCompScore", "lastTopicSim",     # 8-9
    "lastTopicAge", "kbCoverage",          # 10-11
    "queryLenTokens", "hasComparisonCue",  # 12-13
    "hasFormalCue", "hasExampleCue",       # 14-15
    "botCreativity", "domainMatch",        # 16-17
    "followUpType", "wasAmbiguous",       # 18-19
    "avgTruthConf", "avgSourceConf",      # 20-21
    "minDifficulty", "fragDiversity",     # 22-23
    "avoidWithCount",                    # 24
]
# N_FEATURES imported from policy_model (also defined there as 25)

# Action space sizes (discrete action heads)
ACTION_SIZES = {
    "mode":         5,   # normal, off_topic, greeting, help, comparison
    "intent":       5,   # definition, example, formal, application, comparison
    "topic_count":  4,   # 1, 2, 3, 4
    "frag_count":   4,   # 1, 2, 3, 4 fragments per topic
    "creativity":   1,   # sigmoid scalar [0,1]
    "tone":         4,   # neutral, formal, intuitive, playful
}

# Bot profiles (matching data/bots/*/ structure)
BOT_PROFILES = ["game-theory", "golden-age", "data-science"]

# ---------------------------------------------------------------------------
# Improved: Configurable reward weights (tune these for your use case)
# ---------------------------------------------------------------------------
REWARD_WEIGHTS = {
    "intent_match":         0.20,   # how well chosen intent matches gold
    "topic_precision":      0.15,   # topic count vs expected
    "fragment_coherence":   0.12,   # truth/source/coverage of fragments
    "length_penalty":       0.08,   # penalize too-short or too-long responses
    "creativity_alignment": 0.08,   # creativity level vs expected difficulty
    "guardrail_ok":         0.15,   # guardrail compliance (topic limits, truth)
    "follow_up_continuity": 0.18,   # Reward topic continuity for follow-ups (increased from 0.10)
    "diversity":            0.07,   # NEW: penalize always choosing same mode/intent
    "response_coherence":   0.05,   # NEW: reward fragment-semantic match to query
}

# ---------------------------------------------------------------------------
# Step 1: Prompt generation
# ---------------------------------------------------------------------------

def generate_prompts(kb_entries: list, intents: dict, n_variations: int = 5) -> list:
    """
    Generate training prompts from KB entries and intent prototypes.

    For each KB topic, create prompts across all intent types.
    Each prompt is a dict:
      {
        "text": str,
        "gold_intent": str,
        "gold_topics": [topic_id, ...],
        "gold_difficulty": int,
        "source": "seed" | "llm_augmented"
      }

    Args:
        kb_entries: list of KB entry dicts with keys (id, name, aliases, ...)
        intents: dict of intent_name → { prototypes: [...], order: [...] }
        n_variations: number of LLM-augmented variations per seed prompt

    Returns:
        list of prompt dicts (target: 5000+ per bot)
    """
    prompts = []
    intent_choices = list(intents.keys())

    for entry in kb_entries:
        name = entry.get("name", entry.get("id", "unknown"))
        aliases_list = entry.get("aliases", [name])

        for alias in aliases_list[:3]:  # use top 3 aliases
            for intent_name in intent_choices:
                if intent_name in ("greeting", "help"):
                    continue  # handled specially

                # Build seed prompt from intent prototypes
                prototypes = intents[intent_name].get("prototypes", [f"{intent_name} of X"])
                for proto in prototypes[:2]:  # sample 2 prototypes
                    prompt_text = proto.replace("X", alias).replace("Y", alias)
                    prompts.append({
                        "text": prompt_text,
                        "gold_intent": intent_name,
                        "gold_topics": [entry["id"]],
                        "gold_difficulty": 1,  # default moderate
                        "source": "seed",
                    })

    # Generate basic variations with rephrasing, typos, informal phrasing
    import random as _random
    _TYPO_MAP = {
        'what': 'wat', 'is': 'iz', 'the': 'teh', 'you': 'u', 'are': 'r',
        'explain': 'xplain', 'example': 'exmple', 'equilibrium': 'equlibrium',
        'difference': 'diference', 'theory': 'thoery', 'between': 'btwn',
    }
    _INFORMAL_PREFIXES = [
        'hey can u', 'yo tell me', 'hmm i wonder', 'quick question:',
        'any idea what', 'so like', 'k so', 'bruh what is',
    ]
    _CONTEXT_PREFIXES = [
        'i was reading about this and', 'someone told me about', 'im confused about',
        'can you help me understand', 'i need a refresher on',
    ]

    augmented = []
    for p in prompts:
        for v in range(min(n_variations, 3)):
            text = p['text']
            r = _random.random()
            if r < 0.15 and len(text) > 4:
                words = text.split()
                if words:
                    ti = _random.randint(0, len(words) - 1)
                    w = words[ti].lower().rstrip('?!.,')
                    if w in _TYPO_MAP:
                        words[ti] = _TYPO_MAP[w]
                        text = ' '.join(words)
            elif r < 0.30:
                text = f"{_random.choice(_INFORMAL_PREFIXES)} {text.lower().lstrip('what is ')}"
            elif r < 0.45:
                text = f"{_random.choice(_CONTEXT_PREFIXES)}, {text.lower()}"
            elif r < 0.60:
                text = text.replace('?', '? pls explain simply')
            elif r < 0.75:
                for old, new in [('what is', 'define'), ('explain', 'describe'),
                                 ('difference', 'distinction')]:
                    text = text.replace(old, new, 1)

            augmented.append({
                'text': text,
                'gold_intent': p['gold_intent'],
                'gold_topics': p['gold_topics'],
                'gold_difficulty': min(4, p.get('gold_difficulty', 1) + _random.randint(0, 2)),
                'source': 'augmented',
            })

    all_prompts = prompts + augmented
    print(f"[prompts] Generated {len(prompts)} seed + {len(augmented)} augmented = {len(all_prompts)} total")
    return all_prompts


# ---------------------------------------------------------------------------
# Improved: Follow-up query generation (multi-turn training data)
# ---------------------------------------------------------------------------

FOLLOW_UP_TEMPLATES = [
    ("go on",            "continuation",     0.90),
    ("what else",        "expansion",        0.80),
    ("how",              "procedural",       0.70),
    ("example",          "example",          0.65),
    ("simplify",         "simplification",   0.60),
    ("can you elaborate","elaboration",      0.80),
    ("i don't understand","clarification",   0.50),
    ("what do you mean by that", "clarification", 0.70),
    ("why",              "causal",           0.60),
    ("give me more details", "expansion",    0.75),
    ("i asked about X actually", "topic_correction", 0.95),
    ("no, just X",       "topic_correction", 0.95),
    ("not that, X",      "topic_correction", 0.90),
    ("not subgame stuff", "topic_rejection", 0.30),
]

# Follow-up type string → numeric code mapping (must match feature-extractor.js FOLLOWUP_TYPE_MAP)
FOLLOWUP_TYPE_TO_CODE = {
    'simplify': 1, 'compare_previous': 2, 'example': 3, 'elaborate': 4,
    'reference_index': 5, 'another_example': 6, 'specific': 7,
    'continue': 8, 'how': 9, 'why': 10, 'challenge': 11,
    'acknowledge': 12, 'clarify': 13, 'deep_dive': 14, 'relevance': 15,
    'evidence': 16, 'comparison': 17, 'summarize': 18, 'affirm_continue': 19,
    'what_else': 20, 'topic_correction': 21, 'topic_rejection': 22,
}

# Follow-up type string → follow_up_type string mapping (for training data)
FOLLOWUP_LABEL_TO_TYPE = {
    'continuation':    'continue',
    'expansion':       'elaborate',
    'procedural':      'how',
    'example':         'example',
    'simplification':  'simplify',
    'elaboration':     'elaborate',
    'clarification':   'clarify',
    'causal':          'why',
    'topic_correction':'topic_correction',
    'topic_rejection': 'topic_rejection',
}


def generate_follow_up_pairs(prompts: list, n_pairs: int = 500) -> list:
    """
    Generate initial-query → follow-up pairs for multi-turn conversation training.

    For each selected prompt, create a realistic follow-up query that the policy
    should handle while maintaining topic continuity. Each pair includes:
      - initial: the original prompt
      - follow_up: the follow-up query with type and continuity metadata
      - type: the kind of follow-up (continuation, expansion, etc.)

    Args:
        prompts: list of base prompt dicts
        n_pairs: number of follow-up pairs to generate

    Returns:
        list of pair dicts with keys (initial, follow_up, type)
    """
    pairs = []
    selected = random.sample(prompts, min(len(prompts), n_pairs))

    for prompt in selected:
        fu_template, fu_type, topic_continuity = random.choice(FOLLOW_UP_TEMPLATES)

        # Build follow-up query text: append or replace
        if random.random() < 0.3 and len(prompt['text']) > 10:
            # Append-style: original query context + follow-up
            fu_text = f"{prompt['text']} — {fu_template}"
        else:
            # Standalone: just the follow-up phrase
            fu_text = fu_template

        follow_up = {
            "text": fu_text,
            "gold_intent": prompt.get("gold_intent", "definition"),
            "gold_topics": prompt.get("gold_topics", []),
            "gold_difficulty": min(4, prompt.get("gold_difficulty", 1) + 1),
            "source": "follow_up",
            "follow_up_type": fu_type,
            "topic_continuity": topic_continuity,
        }

        pairs.append({
            "initial": prompt,
            "follow_up": follow_up,
            "type": fu_type,
        })

    print(f"[follow-ups] Generated {len(pairs)} follow-up pairs")
    return pairs


# ---------------------------------------------------------------------------
# Step 2: Retrieval dataset builder (simulate extraction + ranking)
# ---------------------------------------------------------------------------

def build_retrieval_dataset(prompts: list, kb_entries: list, intent_prototypes: dict) -> list:
    import numpy as np
    import re
    
    STOP_WORDS = set("a an the of in on at for to with and or is are was were be been being what which who whom whose this that these i you he she it we they them us my your his her its our their me do does did can could should would will might may has have had".split())
    COMPARISON_CUES = re.compile(r'\b(vs|versus|compare|comparison|difference|differ|distinguish|between)\b', re.I)
    FORMAL_CUES = re.compile(r'\b(prove|proof|theorem|formal|math|mathematical|rigorous|derive|defini)\w*\b', re.I)
    EXAMPLE_CUES = re.compile(r'\b(example|illustrate|illustration|case|concrete|instance|show me)\b', re.I)
    
    # Try to use sentence-transformers for real embeddings
    embedder = None
    try:
        from sentence_transformers import SentenceTransformer
        embedder = SentenceTransformer('all-MiniLM-L6-v2')
        print("[dataset] Using sentence-transformers for real embeddings")
    except ImportError:
        print("[dataset] sentence-transformers not available, using TF-IDF fallback")
    
    def _embed(texts):
        if embedder:
            return embedder.encode(texts, normalize_embeddings=True)
        else:
            # Simple TF-IDF-like fallback
            import hashlib
            return [np.array([hashlib.md5((t + str(i)).encode()).digest()[0] / 255.0 for i in range(24)], dtype=np.float32) for t in texts]
    
    def _cosine_sim(a, b):
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    
    def _tokens(text):
        return [t for t in re.sub(r'[^a-z0-9\s]', ' ', text.lower()).split() if t and t not in STOP_WORDS]
    
    def _extract_entities(query, kb_entries):
        q = ' ' + query.lower() + ' '
        found = []
        seen = set()
        for i, entry in enumerate(kb_entries):
            for alias in entry.get('aliases', [entry.get('name', '')]):
                escaped = re.escape(alias.lower().strip())
                if re.search(r'(?:^|\s|\b)' + escaped + r'(?:\s|\b|$)', q, re.I):
                    if entry.get('id') not in seen:
                        found.append(i)
                        seen.add(entry['id'])
                        break
        return found
    
    # Pre-compute entry embeddings
    entry_texts = []
    for e in kb_entries:
        parts = [e.get('name', ''), e.get('summary', '')]
        f = e.get('f', {})
        for cat in ['def', 'int', 'ex', 'form', 'app']:
            frags = f.get(cat, [])
            if frags:
                parts.extend([fr if isinstance(fr, str) else fr.get('text', str(fr)) for fr in frags])
        entry_texts.append(' '.join(parts))
    
    entry_embs = _embed(entry_texts)
    
    # Pre-embed intent prototypes
    intent_embs = {}
    for iname, idata in intent_prototypes.items():
        if idata.get('prototypes'):
            intent_embs[iname] = _embed(idata['prototypes'])
    
    def _build_sample(prompt):
        """Build a single dataset sample from a prompt dict."""
        q_emb = _embed([prompt['text']])[0]
        
        # Real ranking by cosine
        ranked = sorted(
            [(i, _cosine_sim(q_emb, entry_embs[i])) for i in range(len(kb_entries))],
            key=lambda x: -x[1]
        )
        
        # Real entity extraction
        entities = _extract_entities(prompt['text'], kb_entries)
        
        # Real intent scores
        intent_scores = {}
        for iname, iembs in intent_embs.items():
            intent_scores[iname] = max(_cosine_sim(q_emb, ie) for ie in iembs) if len(iembs) > 0 else 0.0
        
        # Build feature vector matching feature-extractor.js exactly
        features = [0.0] * N_FEATURES
        features[0] = ranked[0][1] if ranked else 0
        features[1] = ranked[1][1] if len(ranked) > 1 else 0
        features[2] = min(len(entities), 3)
        features[3] = 1.0 if entities else 0.0
        for j, iname in enumerate(['definition', 'example', 'formal', 'application', 'comparison']):
            features[4 + j] = intent_scores.get(iname, 0)
        features[9] = 0.0   # lastTopicSim (cold start)
        features[10] = 8.0  # lastTopicAge (max)
        features[11] = sum(1 for _, s in ranked if s > 0.25) / max(len(kb_entries), 1)
        tokens_list = _tokens(prompt['text'])
        features[12] = max(1, min(len(tokens_list), 32))
        features[13] = 1.0 if COMPARISON_CUES.search(prompt['text']) else 0.0
        features[14] = 1.0 if FORMAL_CUES.search(prompt['text']) else 0.0
        features[15] = 1.0 if EXAMPLE_CUES.search(prompt['text']) else 0.0
        features[16] = 0.5
        features[17] = 0.6

        # Improved: set follow-up features for multi-turn training
        # Use mapped numeric followUpType code (1-19) based on follow_up_type label
        is_follow_up = prompt.get('source') == 'follow_up'
        if is_follow_up:
            type_label = prompt.get('follow_up_type', '')
            fu_type = FOLLOWUP_LABEL_TO_TYPE.get(type_label, 'elaborate')
            features[18] = FOLLOWUP_TYPE_TO_CODE.get(fu_type, 4)  # default to elaborate (4)
        else:
            features[18] = 0  # no follow-up
        features[19] = 0  # wasAmbiguous
        features[20] = 0.8  # avgTruthConf (placeholder)
        features[21] = 0.7  # avgSourceConf (placeholder)
        features[22] = prompt.get('gold_difficulty', 1)  # minDifficulty
        features[23] = 2    # fragDiversity

        # avoidWithCount: fraction of top-10 entries with compatibility constraints
        avoid_with_count = 0
        for ei in range(min(10, len(kb_entries))):
            entry = kb_entries[ei]
            if entry.get('avoid_with') or entry.get('related'):
                avoid_with_count += 1
        features[24] = avoid_with_count / max(min(10, len(kb_entries)), 1)
        
        return {
            "prompt": prompt,
            "features": features,
            "ranked_indices": [r[0] for r in ranked[:10]],
            "entity_indices": entities,
            "intent_raw_scores": intent_scores,
        }

    dataset = [_build_sample(prompt) for prompt in prompts]
    return dataset


# ---------------------------------------------------------------------------
# Step 3: Policy network definition
# ---------------------------------------------------------------------------

class PolicyNetworkWrapper:
    def __init__(self, n_features=N_FEATURES, action_sizes=None):
        if action_sizes is None:
            action_sizes = {name: sz for name, sz in ACTION_SIZES_ORDERED}
        self.action_sizes = action_sizes
        self.n_features = n_features
        self.net = PolicyNetwork(n_features, ACTION_SIZES_ORDERED)
        # Note: no longer calling self.net.eval() here — training mode
        # is set explicitly in train() to enable dropout.

    def forward(self, features):
        logits, _ = self.net(features)
        return logits

    def sample_action(self, logits, temperature=1.0):
        actions, log_probs, _entropies = self.net.sample_action(logits)
        return actions, log_probs


# ---------------------------------------------------------------------------
# Improved: Experience replay buffer for off-policy training
# ---------------------------------------------------------------------------

class ReplayBuffer:
    """
    Experience replay buffer for stabilizing off-policy training.

    Instead of training on single samples (high variance), we collect
    experiences into a FIFO buffer and sample random mini-batches. This
    breaks temporal correlations and reduces gradient variance.

    Buffer size: 10000 — large enough to decorrelate samples
                   but small enough to keep recent experiences.
    """
    def __init__(self, capacity=10000):
        self.buffer = deque(maxlen=capacity)

    def store(self, state, actions, reward, log_probs, value):
        """
        Store a single experience tuple.

        Args:
          state: list of 25 feature values
          actions: dict of name → int (action index per head)
          reward: scalar float
          log_probs: dict of name → float (log prob of chosen action)
          value: scalar float (value head prediction)
        """
        self.buffer.append({
            'state': state,
            'actions': actions,
            'reward': reward,
            'log_probs': log_probs,
            'value': value,
        })

    def sample(self, batch_size=64):
        """
        Sample a random mini-batch of experiences.

        Returns list of dicts, or all stored items if fewer than batch_size.
        """
        if len(self.buffer) < batch_size:
            indices = list(range(len(self.buffer)))
        else:
            indices = random.sample(range(len(self.buffer)), batch_size)
        return [self.buffer[i] for i in indices]

    def __len__(self):
        return len(self.buffer)

    def clear(self):
        """Clear all stored experiences."""
        self.buffer.clear()


# ---------------------------------------------------------------------------
# Improved: Curriculum learning difficulty scheduler
# ---------------------------------------------------------------------------

class DifficultyScheduler:
    """
    Curriculum learning: start with easy samples, gradually add harder ones.

    Strategy:
      - Epochs 0..warmup:     only difficulty ≤ 1 (easy, high-confidence queries)
      - Epochs warmup..+step:  difficulty ≤ 2 (add moderate samples)
      - Epochs warmup..+2step: difficulty ≤ 3 (add hard samples)
      - Epochs warmup..+3step: difficulty ≤ 4 (all samples)
    """
    def __init__(self, max_difficulty=4, warmup_epochs=200, step_epochs=200):
        self.max_difficulty = max_difficulty
        self.warmup_epochs = warmup_epochs
        self.step_epochs = step_epochs

    def get_threshold(self, epoch):
        """
        Return the current maximum difficulty level for this epoch.
        Samples with gold_difficulty > threshold are excluded.
        """
        if epoch < self.warmup_epochs:
            return 1  # Only easiest samples during warmup
        steps = (epoch - self.warmup_epochs) // self.step_epochs
        return min(1 + steps, self.max_difficulty)


# ---------------------------------------------------------------------------
# Improved: Action diversity tracking for reward computation
# ---------------------------------------------------------------------------

# Track recent (mode, intent) pairs to compute diversity bonus
_action_mode_intent_history = deque(maxlen=100)


def _get_diversity_bonus(mode_val, intent_val) -> float:
    """
    Compute diversity bonus: penalize always choosing the same (mode, intent) pair.

    Returns 0.5–1.0:
      - 1.0 if the pair is rare in recent history (diverse behavior)
      - 0.5 if the pair appears in every recent sample (repetitive)
    """
    key = (int(mode_val) if not isinstance(mode_val, torch.Tensor) else mode_val.item(),
           int(intent_val) if not isinstance(intent_val, torch.Tensor) else intent_val.item())
    _action_mode_intent_history.append(key)

    if len(_action_mode_intent_history) < 10:
        return 0.75  # Neutral before enough history

    recent = list(_action_mode_intent_history)[-20:]  # last 20 actions
    freq = recent.count(key) / len(recent)
    # freq=0.05 (unique) → 0.975 bonus; freq=1.0 (all same) → 0.5 bonus
    return 1.0 - 0.5 * freq


# ---------------------------------------------------------------------------
# Step 4: Reward function (improved with 9 components)
# ---------------------------------------------------------------------------

def compute_reward(actions: dict, prompt: dict, rendered_text: str,
                   features: list, dataset_sample: dict = None) -> tuple:
    """
    Multi-component reward function. Components:

    1. intent_match        — exact + neighbor matching of chosen vs gold intent
    2. topic_precision     — topic count vs gold expectation
    3. fragment_coherence  — truth/source confidence weighted average
    4. length_penalty      — quadratic penalty outside [40, 180] tokens
    5. creativity_alignment— how well creativity matches expected difficulty
    6. guardrail_ok        — binary: passes topic limits and truth threshold
    7. follow_up_continuity— (NEW) reward topic consistency in follow-up queries
    8. diversity           — (NEW) penalize repetitive mode/intent choices
    9. response_coherence  — (NEW) reward fragments matching query semantic intent

    All weights are configurable via the REWARD_WEIGHTS dict at the top of this file.

    Returns:
        (total_reward: float, components: dict) — total weighted sum and per-component breakdown
    """
    intent_names = ["definition", "example", "formal", "application", "comparison"]

    # --- Helper: safely extract scalar from action value ---
    def _scalar(a, default=0):
        if isinstance(a, torch.Tensor):
            return a.item() if a.numel() == 1 else int(a)
        return a if a is not None else default

    action_vals = {k: _scalar(v) for k, v in actions.items()}
    chosen_intent = intent_names[action_vals.get("intent", 0) % len(intent_names)]
    gold_intent = prompt.get("gold_intent", "definition")

    # -------------------------------------------------------
    # Component 1: Intent match (continuous, not binary)
    # -------------------------------------------------------
    intent_match = 1.0 if chosen_intent == gold_intent else 0.0
    intent_neighbors = {
        'definition':  {'example': 0.5, 'formal': 0.4, 'application': 0.3},
        'example':     {'definition': 0.5, 'application': 0.4},
        'formal':      {'definition': 0.4, 'application': 0.3},
        'application': {'definition': 0.3, 'example': 0.4},
        'comparison':  {'definition': 0.2},
    }
    if intent_match == 0.0:
        intent_match = intent_neighbors.get(gold_intent, {}).get(chosen_intent, 0.0)

    # -------------------------------------------------------
    # Component 2: Topic precision from features
    # -------------------------------------------------------
    gold_topics = set(prompt.get("gold_topics", []))
    selected_topic_count = action_vals.get("topic_count", 1)
    topic_precision = (
        min(selected_topic_count, max(len(gold_topics), 1)) / max(len(gold_topics), 1)
        if len(gold_topics) > 0 else 0.5
    )

    # -------------------------------------------------------
    # Component 3: Fragment coherence from features
    # -------------------------------------------------------
    kb_coverage = features[11] if len(features) > 11 else 0.3
    avg_truth = features[20] if len(features) > 20 else 0.7
    avg_source = features[21] if len(features) > 21 else 0.7
    fragment_coherence = 0.5 * avg_truth + 0.3 * avg_source + 0.2 * kb_coverage

    # -------------------------------------------------------
    # Component 4: Length penalty (quadratic outside [40, 180])
    # -------------------------------------------------------
    n_tokens = len(rendered_text.split()) if rendered_text else 0
    if 40 <= n_tokens <= 180:
        length_penalty = 1.0
    elif n_tokens < 40:
        length_penalty = max(0.0, 1.0 - ((40 - n_tokens) / 40) ** 2)
    else:
        length_penalty = max(0.0, 1.0 - ((n_tokens - 180) / 180) ** 2)

    # -------------------------------------------------------
    # Component 5: Creativity alignment from features
    # -------------------------------------------------------
    creativity_val = action_vals.get('creativity', 0)
    if isinstance(creativity_val, (int, float)):
        gold_creativity = prompt.get('gold_difficulty', 1) / 4.0
        creativity_alignment = 1.0 - min(abs(float(creativity_val) - gold_creativity), 1.0)
    else:
        creativity_alignment = 0.8

    # -------------------------------------------------------
    # Component 6: Guardrail compliance
    # -------------------------------------------------------
    guardrail_ok = 1.0
    if selected_topic_count > 3:
        guardrail_ok = 0.0
    if avg_truth < 0.5 and avg_truth > 0:
        guardrail_ok = 0.0

    # -------------------------------------------------------
    # Component 7 (NEW): Follow-up continuity reward
    # -------------------------------------------------------
    is_follow_up = features[18] > 0 if len(features) > 18 else False
    follow_up_continuity = 0.5

    if is_follow_up:
        topic_continuity = prompt.get('topic_continuity', 0.5)
        last_topic_sim = features[9] if len(features) > 9 else 0.5
        follow_up_continuity = 0.4 * topic_continuity + 0.6 * last_topic_sim

    # -------------------------------------------------------
    # Component 8 (NEW): Diversity reward
    # -------------------------------------------------------
    diversity = _get_diversity_bonus(
        action_vals.get("mode", 0),
        action_vals.get("intent", 0)
    )

    # -------------------------------------------------------
    # Component 9 (NEW): Response coherence reward
    # -------------------------------------------------------
    response_coherence = 0.5
    if dataset_sample:
        intent_raw_scores = dataset_sample.get('intent_raw_scores', {})
        chosen_intent_score = intent_raw_scores.get(chosen_intent, 0.5)
        gold_intent_score = intent_raw_scores.get(gold_intent, 0.5)
        response_coherence = 0.6 * chosen_intent_score + 0.4 * gold_intent_score

    # -------------------------------------------------------
    # Build components dict for logging
    # -------------------------------------------------------
    components = {
        'intent_match':          intent_match,
        'topic_precision':       topic_precision,
        'fragment_coherence':    fragment_coherence,
        'length_penalty':        length_penalty,
        'creativity_alignment':  creativity_alignment,
        'guardrail_ok':          guardrail_ok,
        'follow_up_continuity':  follow_up_continuity,
        'diversity':             diversity,
        'response_coherence':    response_coherence,
    }

    # Weighted sum
    total = (
        REWARD_WEIGHTS['intent_match']          * intent_match
        + REWARD_WEIGHTS['topic_precision']     * topic_precision
        + REWARD_WEIGHTS['fragment_coherence']  * fragment_coherence
        + REWARD_WEIGHTS['length_penalty']      * length_penalty
        + REWARD_WEIGHTS['creativity_alignment'] * creativity_alignment
        + REWARD_WEIGHTS['guardrail_ok']        * guardrail_ok
        + REWARD_WEIGHTS['follow_up_continuity'] * follow_up_continuity
        + REWARD_WEIGHTS['diversity']           * diversity
        + REWARD_WEIGHTS['response_coherence']  * response_coherence
    )
    return total, components


# ---------------------------------------------------------------------------
# Step 5: Training loop (improved with replay buffer, entropy annealing,
#         curriculum learning, cosine LR, and metrics tracking)
# ---------------------------------------------------------------------------

def train(policy_net, dataset, epochs=1000, batch_size=64, lr=1e-3,
          val_dataset=None,
          # Replay buffer settings
          replay_capacity=10000,
          replay_batch_size=64,
          # Entropy regularization settings
          entropy_start=0.05,
          entropy_end=0.01,
          entropy_anneal_epochs=500,
          # Value function settings
          value_loss_coeff=0.5,
          max_grad_norm=0.5,
          # Curriculum learning settings
          curriculum_warmup=200,
          curriculum_step=200):
    """
    Train the policy network using REINFORCE with baseline and experience replay.

    Improvements over the original skeleton:
      - Replay buffer: collect experiences, sample mini-batches (reduces variance)
      - Entropy regularization: encourages exploration, annealed over training
      - Cosine LR scheduling: smooth learning rate decay
      - Curriculum learning: start easy, gradually increase difficulty
      - Advantage normalization: subtract mean, divide by std
      - Rich metrics: reward, loss, entropy, value loss, learning rate
      - Multi-turn support: follow-up queries train topic continuity
      - Validation: periodic evaluation on held-out data (overfitting detection)
      - Per-component reward: individual reward component tracking

    Args:
        policy_net: PolicyNetworkWrapper instance
        dataset: list of dataset dicts (training set, from build_retrieval_dataset)
        val_dataset: list of dataset dicts (validation set, optional)
        ... (see function body for all params)
    """
    import torch.optim as optim

    optimizer = optim.Adam(policy_net.net.parameters(), lr=lr)

    scheduler = optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=epochs, eta_min=lr * 0.01
    )

    replay_buffer = ReplayBuffer(capacity=replay_capacity)

    diff_scheduler = DifficultyScheduler(
        max_difficulty=4,
        warmup_epochs=curriculum_warmup,
        step_epochs=curriculum_step,
    )

    # Metrics tracking across epochs
    metrics_history = {
        'avg_reward': [],
        'avg_loss': [],
        'avg_policy_loss': [],
        'avg_value_loss': [],
        'avg_entropy': [],
        'avg_advantage': [],
        'entropy_coeff': [],
        'learning_rate': [],
        'difficulty_threshold': [],
        'buffer_size': [],
        # Per-component reward breakdown
        'reward_intent_match': [],
        'reward_topic_precision': [],
        'reward_fragment_coherence': [],
        'reward_length_penalty': [],
        'reward_creativity_alignment': [],
        'reward_guardrail_ok': [],
        'reward_follow_up_continuity': [],
        'reward_diversity': [],
        'reward_response_coherence': [],
        # Validation metrics
        'val_avg_reward': [],
        'val_avg_entropy': [],
    }

    total_steps = 0

    for epoch in range(epochs):
        policy_net.net.train()

        # ---------------------------------------------------------------
        # Curriculum learning: filter training samples by current difficulty cap
        # ---------------------------------------------------------------
        diff_threshold = diff_scheduler.get_threshold(epoch)
        eligible_samples = [
            s for s in dataset
            if s['prompt'].get('gold_difficulty', 1) <= diff_threshold
        ]
        if not eligible_samples:
            eligible_samples = dataset

        random.shuffle(eligible_samples)

        # Per-epoch accumulators
        epoch_rewards = []
        epoch_losses = []
        epoch_policy_losses = []
        epoch_value_losses = []
        epoch_entropies = []
        epoch_advantages = []
        # Per-component accumulators
        epoch_comp_sums = {k: 0.0 for k in REWARD_WEIGHTS}
        epoch_comp_counts = 0

        # ---------------------------------------------------------------
        # Phase 1: Collect experiences by running the policy
        # ---------------------------------------------------------------
        for batch_start in range(0, len(eligible_samples), batch_size):
            batch_samples = eligible_samples[batch_start:batch_start + batch_size]

            batch_features = torch.tensor(
                [s["features"] for s in batch_samples], dtype=torch.float32
            )

            logits, values = policy_net.net(batch_features)
            actions, log_probs, entropies = policy_net.net.sample_action(logits)

            for j, sample in enumerate(batch_samples):
                sample_actions = {
                    name: actions[name][j].item()
                    if actions[name].dim() > 0 else actions[name].item()
                    for name in actions
                }

                rendered = _stub_render(sample_actions, sample["prompt"], sample["features"])
                reward_total, reward_components = compute_reward(
                    sample_actions, sample["prompt"], rendered,
                    sample["features"], dataset_sample=sample
                )

                replay_buffer.store(
                    state=sample["features"],
                    actions={k: int(v) if isinstance(v, (int, float)) else v
                             for k, v in sample_actions.items()},
                    reward=reward_total,
                    log_probs={k: log_probs[k][j].item()
                               if log_probs[k].dim() > 0 else log_probs[k].item()
                               for k in log_probs},
                    value=values[j].item() if values.dim() > 0 else values.item(),
                )

                epoch_rewards.append(reward_total)
                for k, v in reward_components.items():
                    epoch_comp_sums[k] += v
                epoch_comp_counts += 1

            # ---------------------------------------------------------------
            # Phase 2: Train on replay buffer mini-batches
            # ---------------------------------------------------------------
            if len(replay_buffer) >= replay_batch_size:
                replay_samples = replay_buffer.sample(replay_batch_size)

                rb_features = torch.tensor(
                    [s['state'] for s in replay_samples], dtype=torch.float32
                )
                rb_rewards = torch.tensor(
                    [s['reward'] for s in replay_samples], dtype=torch.float32
                )

                rb_logits, rb_values = policy_net.net(rb_features)

                # Normalized advantage estimation
                advantages = rb_rewards - rb_values.detach()
                advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

                rb_actions = {}
                for name in policy_net.net.action_names:
                    rb_actions[name] = torch.tensor(
                        [s['actions'][name] for s in replay_samples], dtype=torch.long
                    )
                rb_log_probs = policy_net.net.get_log_probs(rb_logits, rb_actions)

                policy_loss = sum(
                    (-advantages * rb_log_probs[name]).mean()
                    for name in policy_net.net.action_names
                )

                value_loss = F.mse_loss(rb_values, rb_rewards)

                progress = min(1.0, epoch / max(1, entropy_anneal_epochs))
                entropy_coeff = entropy_start + (entropy_end - entropy_start) * progress

                total_entropy = policy_net.net.entropy(rb_logits).mean()

                loss = (
                    policy_loss
                    + value_loss_coeff * value_loss
                    - entropy_coeff * total_entropy
                )

                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(
                    policy_net.net.parameters(), max_grad_norm
                )
                optimizer.step()

                epoch_losses.append(loss.item())
                epoch_policy_losses.append(policy_loss.item())
                epoch_value_losses.append(value_loss.item())
                epoch_entropies.append(total_entropy.item())
                epoch_advantages.append(advantages.mean().item())

                total_steps += 1

        # ---------------------------------------------------------------
        # End of epoch: update LR schedule
        # ---------------------------------------------------------------
        scheduler.step()

        # ---------------------------------------------------------------
        # Compute epoch metrics
        # ---------------------------------------------------------------
        avg_reward = np.mean(epoch_rewards) if epoch_rewards else 0.0
        avg_loss = np.mean(epoch_losses) if epoch_losses else 0.0
        avg_policy_loss = np.mean(epoch_policy_losses) if epoch_policy_losses else 0.0
        avg_value_loss = np.mean(epoch_value_losses) if epoch_value_losses else 0.0
        avg_entropy = np.mean(epoch_entropies) if epoch_entropies else 0.0
        avg_advantage = np.mean(epoch_advantages) if epoch_advantages else 0.0
        current_lr = optimizer.param_groups[0]['lr']

        metrics_history['avg_reward'].append(float(avg_reward))
        metrics_history['avg_loss'].append(float(avg_loss))
        metrics_history['avg_policy_loss'].append(float(avg_policy_loss))
        metrics_history['avg_value_loss'].append(float(avg_value_loss))
        metrics_history['avg_entropy'].append(float(avg_entropy))
        metrics_history['avg_advantage'].append(float(avg_advantage))
        metrics_history['entropy_coeff'].append(float(entropy_coeff))
        metrics_history['learning_rate'].append(float(current_lr))
        metrics_history['difficulty_threshold'].append(int(diff_threshold))
        metrics_history['buffer_size'].append(len(replay_buffer))

        # Per-component averages
        for k in REWARD_WEIGHTS:
            avg_comp = epoch_comp_sums[k] / max(epoch_comp_counts, 1)
            metrics_history[f'reward_{k}'].append(float(avg_comp))

        # ---------------------------------------------------------------
        # Validation: evaluate on held-out data (all difficulty levels)
        # ---------------------------------------------------------------
        val_avg_reward = 0.0
        val_avg_entropy = 0.0
        if val_dataset:
            policy_net.net.eval()
            val_rewards = []
            val_entropies = []
            with torch.no_grad():
                for batch_start in range(0, len(val_dataset), batch_size):
                    batch_samples = val_dataset[batch_start:batch_start + batch_size]
                    batch_features = torch.tensor(
                        [s["features"] for s in batch_samples], dtype=torch.float32
                    )
                    logits, _ = policy_net.net(batch_features)
                    actions, _, _entropies = policy_net.net.sample_action(logits, deterministic=True)

                    for j, sample in enumerate(batch_samples):
                        sample_actions = {
                            name: actions[name][j].item()
                            if actions[name].dim() > 0 else actions[name].item()
                            for name in actions
                        }
                        rendered = _stub_render(sample_actions, sample["prompt"], sample["features"])
                        reward_total, _ = compute_reward(
                            sample_actions, sample["prompt"], rendered,
                            sample["features"], dataset_sample=sample
                        )
                        val_rewards.append(reward_total)

                    # Average entropy on val batch
                    val_entropies.append(policy_net.net.entropy(logits).mean().item())

            val_avg_reward = np.mean(val_rewards) if val_rewards else 0.0
            val_avg_entropy = np.mean(val_entropies) if val_entropies else 0.0
            policy_net.net.train()

        metrics_history['val_avg_reward'].append(float(val_avg_reward))
        metrics_history['val_avg_entropy'].append(float(val_avg_entropy))

        # ---------------------------------------------------------------
        # Log at regular intervals
        # ---------------------------------------------------------------
        if epoch % 100 == 0 or epoch == epochs - 1:
            comp_str = " | ".join(
                f"{k}={metrics_history[f'reward_{k}'][-1]:.3f}"
                for k in ['intent_match', 'topic_precision', 'guardrail_ok']
            )
            val_str = f" val_r={val_avg_reward:.4f} val_H={val_avg_entropy:.4f}" if val_dataset else ""
            print(
                f"[train] epoch {epoch:4d} | "
                f"reward={avg_reward:.4f} | loss={avg_loss:.4f} "
                f"(π={avg_policy_loss:.4f} v={avg_value_loss:.4f}) | "
                f"entropy={avg_entropy:.4f} coeff={entropy_coeff:.4f} | "
                f"adv={avg_advantage:.4f} | "
                f"lr={current_lr:.6f} | diff≤{diff_threshold} | "
                f"buf={len(replay_buffer)}{val_str}"
            )
            if epoch_comp_counts > 0:
                print(f"[train]       components: {comp_str}")

    print(f"[train] Done. Total epochs: {epochs}, total gradient steps: {total_steps}")
    return policy_net, dict(metrics_history)


def _stub_render(actions, prompt, features):
    intent_names = ["definition", "example", "formal", "application", "comparison"]
    mode_names = ["normal", "off_topic", "greeting", "help", "comparison"]
    tone_names = ["neutral", "formal", "intuitive", "playful"]

    def _val(a, default=0):
        if isinstance(a, torch.Tensor):
            return a.item() if a.numel() == 1 else default
        return a if a is not None else default

    chosen_intent = intent_names[_val(actions.get("intent", 0)) % len(intent_names)]
    chosen_mode = mode_names[_val(actions.get("mode", 0)) % len(mode_names)]
    chosen_tone = tone_names[_val(actions.get("tone", 0)) % len(tone_names)]

    topic = prompt.get("gold_topics", ["unknown"])[0]
    text = f"[{chosen_mode}/{chosen_intent}/{chosen_tone}] Explanation of {topic}. " \
           f"This is a simulated response for training purposes."

    return text


# ---------------------------------------------------------------------------
# Step 6: ONNX export
# ---------------------------------------------------------------------------

def export_onnx(policy_net, output_path: str):
    """Export trained policy network to ONNX format."""
    import torch
    import onnx

    policy_net.net.eval()
    dummy_input = torch.randn(1, N_FEATURES)

    class InferenceWrapper(torch.nn.Module):
        def __init__(self, net):
            super().__init__()
            self.net = net
        def forward(self, x):
            # During export, dropout is disabled (eval mode) and layer norms
            # pass through with their learned affine params. The JS inference
            # does not replicate layer norm, but the export captures whatever
            # the model computes. For deployment, the raw Linear weights
            # are extracted separately via export_weights_dict().
            logits, _ = self.net(x)
            return tuple(logits[name] for name in ["mode", "intent", "topic_count", "frag_count", "creativity", "tone"])

    wrapper = InferenceWrapper(policy_net.net)

    torch.onnx.export(
        wrapper, dummy_input, output_path,
        input_names=['features'],
        output_names=['mode', 'intent', 'topic_count', 'frag_count', 'creativity', 'tone'],
        dynamic_axes={'features': {0: 'batch_size'}},
        opset_version=17,
        do_constant_folding=True,
    )

    onnx.checker.check_model(onnx.load(output_path))
    print(f"[export] ONNX exported and validated: {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Step 7: WASM compilation
# ---------------------------------------------------------------------------

def compile_wasm(onnx_path: str, wasm_output_path: str, weights_output_path: str):
    """Compile ONNX to WASM using available tools."""
    import shutil
    import subprocess

    onnx_path_simplified = onnx_path.replace('.onnx', '_simplified.onnx')

    tools_found = {}
    if shutil.which('wonnx-cli'):
        tools_found['wonnx-cli'] = 'wonnx-cli'
    elif shutil.which('onnx2json'):
        tools_found['onnx2json'] = 'onnx2json'
    if shutil.which('wasm-opt'):
        tools_found['wasm-opt'] = 'wasm-opt'

    if not tools_found:
        print(f"[wasm] No compilation tools found. Generating JS-only stub.")
        Path(wasm_output_path).write_bytes(
            b'\x00asm\x01\x00\x00\x00'  # minimal valid WASM header
        )
        _export_weights_json(onnx_path, weights_output_path)
        return wasm_output_path

    print(f"[wasm] Available tools: {', '.join(tools_found.keys())}")

    # Step 1: Simplify ONNX model
    if shutil.which('onnxsim'):
        print(f"[wasm] Simplifying ONNX model...")
        subprocess.run(['onnxsim', onnx_path, onnx_path_simplified],
                       capture_output=True, text=True)
        if Path(onnx_path_simplified).exists():
            onnx_path = onnx_path_simplified
            print(f"[wasm] ONNX simplified: {onnx_path_simplified}")
    elif shutil.which('python3') or shutil.which('python'):
        py = 'python3' if shutil.which('python3') else 'python'
        try:
            import onnx
            model = onnx.load(onnx_path)
            onnx.checker.check_model(model)
            print(f"[wasm] ONNX model validated (no simplification tools available)")
        except Exception as e:
            print(f"[wasm] ONNX validation warning: {e}")

    # Step 2: Try wonnx-cli for WASM compilation
    if 'wonnx-cli' in tools_found:
        print(f"[wasm] Running wonnx-cli {onnx_path} -> {wasm_output_path}")
        result = subprocess.run(
            ['wonnx-cli', 'build', onnx_path, '-o', wasm_output_path],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0 and Path(wasm_output_path).exists():
            wasm_size = Path(wasm_output_path).stat().st_size
            print(f"[wasm] wonnx-cli succeeded: {wasm_output_path} ({wasm_size} bytes)")
        else:
            print(f"[wasm] wonnx-cli failed: {result.stderr[:200]}")
            _export_weights_json(onnx_path, weights_output_path)
            _generate_minimal_wasm_stub(wasm_output_path)
    elif 'onnx2json' in tools_found:
        print(f"[wasm] Using onnx2json for weight extraction")
        _export_weights_json(onnx_path, weights_output_path)
        _generate_minimal_wasm_stub(wasm_output_path)
    else:
        _export_weights_json(onnx_path, weights_output_path)
        _generate_minimal_wasm_stub(wasm_output_path)

    # Step 3: Optimize WASM with wasm-opt if available
    if 'wasm-opt' in tools_found and Path(wasm_output_path).exists():
        opt_path = wasm_output_path + '.opt'
        result = subprocess.run(
            ['wasm-opt', '-O3', wasm_output_path, '-o', opt_path],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0 and Path(opt_path).exists():
            shutil.move(opt_path, wasm_output_path)
            wasm_size = Path(wasm_output_path).stat().st_size
            print(f"[wasm] wasm-opt optimized: {wasm_output_path} ({wasm_size} bytes)")

    print(f"[wasm] Compilation complete: {wasm_output_path}")
    return wasm_output_path


def _export_weights_json(onnx_path, weights_output_path):
    """Extract weights from ONNX model into JSON format for JS MLP."""
    import numpy as np
    import onnx
    from onnx import numpy_helper
    model = onnx.load(onnx_path)
    weights = {}
    for init in model.graph.initializer:
        arr = numpy_helper.to_array(init)
        weights[init.name] = arr.tolist() if arr.ndim == 2 else arr.tolist()
    Path(weights_output_path).write_text(json.dumps({"weights": weights, "_version": 2}, indent=2))
    print(f"[wasm] Weights exported: {weights_output_path} ({Path(weights_output_path).stat().st_size} bytes)")


def _generate_minimal_wasm_stub(wasm_output_path):
    """Generate a minimal valid WASM module stub."""
    stub = bytes([
        0x00, 0x61, 0x73, 0x6d,  # \0asm
        0x01, 0x00, 0x00, 0x00,  # version 1
    ])
    Path(wasm_output_path).write_bytes(stub)
    print(f"[wasm] Minimal WASM stub written: {wasm_output_path} ({len(stub)} bytes)")


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def _parse_js_kb(content: str) -> list:
    """
    Parse a JavaScript knowledge-base.js file into Python dicts.
    Handles the kb(id, name, aliases, summary, {def:[], int:[], ...}, related[]) pattern.
    """
    import ast

    entries = []
    # Find all kb( ... ) calls — match nested braces properly
    i = 0
    while i < len(content):
        # Find next kb( call
        match = re.search(r'\bkb\s*\(', content[i:])
        if not match:
            break
        start = i + match.end()
        # Find matching closing paren by counting parens/braces
        depth = 1
        j = start
        in_string = False
        escape = False
        string_char = None
        while j < len(content) and depth > 0:
            c = content[j]
            if escape:
                escape = False
                j += 1
                continue
            if c == '\\':
                escape = True
                j += 1
                continue
            if in_string:
                if c == string_char:
                    in_string = False
                j += 1
                continue
            if c in ('"', "'"):
                in_string = True
                string_char = c
                j += 1
                continue
            if c in ('(', '{'):
                depth += 1
            elif c in (')', '}'):
                depth -= 1
            j += 1
        if depth != 0:
            i = start
            continue
        raw = content[start:j-1].strip()
        i = j

        # Parse the arguments: id, name, aliases, summary, f_obj, related
        # Strategy: split by top-level commas respecting brackets
        args = _split_js_args(raw)
        if len(args) < 5:
            continue

        def unquote(s):
            s = s.strip()
            if len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
                return s[1:-1].replace("\\'", "'").replace('\\"', '"')
            return s

        entry_id = unquote(args[0])
        name = unquote(args[1])

        # Parse aliases array
        aliases_raw = args[2].strip()
        aliases = []
        if aliases_raw.startswith('['):
            inner = aliases_raw[1:-1].strip()
            if inner:
                aliases = [unquote(a) for a in _split_js_args(inner)]

        summary = unquote(args[3])

        # Parse f object {def:[], int:[], ex:[], form:[], app:[]}
        f_obj = {}
        f_raw = args[4].strip()
        if f_raw.startswith('{'):
            # Extract each category
            for cat in ['def', 'int', 'ex', 'form', 'app']:
                cat_match = re.search(rf'{cat}\s*:\s*\[', f_raw)
                if cat_match:
                    arr_start = cat_match.end() - 1
                    # Find matching ]
                    d = 1
                    k = arr_start + 1
                    while k < len(f_raw) and d > 0:
                        if f_raw[k] == '[':
                            d += 1
                        elif f_raw[k] == ']':
                            d -= 1
                        k += 1
                    arr_content = f_raw[arr_start+1:k-1].strip()
                    if arr_content:
                        frags = []
                        for frag in _split_js_args(arr_content):
                            frags.append(unquote(frag))
                        f_obj[cat] = frags
                    else:
                        f_obj[cat] = []

        # Parse related array
        related = []
        if len(args) > 5:
            rel_raw = args[5].strip()
            if rel_raw.startswith('['):
                inner = rel_raw[1:-1].strip()
                if inner:
                    related = [unquote(r) for r in _split_js_args(inner)]

        entries.append({
            "id": entry_id,
            "name": name,
            "aliases": [name.lower()] + [a.lower() for a in aliases],
            "summary": summary,
            "f": f_obj,
            "related": related,
        })

    return entries


def _split_js_args(raw: str) -> list:
    """Split a JS argument list by top-level commas, respecting brackets and strings."""
    args = []
    depth = 0
    in_string = False
    escape = False
    string_char = None
    current = []
    for c in raw:
        if escape:
            current.append(c)
            escape = False
            continue
        if c == '\\':
            escape = True
            current.append(c)
            continue
        if in_string:
            current.append(c)
            if c == string_char:
                in_string = False
            continue
        if c in ('"', "'"):
            in_string = True
            string_char = c
            current.append(c)
            continue
        if c in ('(', '[', '{'):
            depth += 1
            current.append(c)
        elif c in (')', ']', '}'):
            depth -= 1
            current.append(c)
        elif c == ',' and depth == 0:
            args.append(''.join(current).strip())
            current = []
        else:
            current.append(c)
    if current:
        args.append(''.join(current).strip())
    return args


def _parse_js_intents(content: str) -> dict:
    """Parse INTENTS object from a JS intents.js file."""
    intents = {}
    # Find INTENTS = { ... }
    match = re.search(r'INTENTS\s*=\s*\{', content)
    if not match:
        return intents
    start = match.end() - 1
    # Find matching brace
    depth = 1
    j = start + 1
    while j < len(content) and depth > 0:
        if content[j] == '{':
            depth += 1
        elif content[j] == '}':
            depth -= 1
        j += 1
    obj_content = content[start+1:j-1].strip()

    # Parse each intent: name: { prototypes: [...], order: [...] }
    for intent_match in re.finditer(r"(\w+)\s*:\s*\{", obj_content):
        intent_name = intent_match.group(1)
        brace_start = intent_match.end() - 1
        depth = 1
        k = brace_start + 1
        while k < len(obj_content) and depth > 0:
            if obj_content[k] == '{':
                depth += 1
            elif obj_content[k] == '}':
                depth -= 1
            k += 1
        inner = obj_content[brace_start+1:k-1].strip()

        prototypes = []
        order = None

        # Extract prototypes array
        proto_match = re.search(r'prototypes\s*:\s*\[', inner)
        if proto_match:
            arr_start = proto_match.end() - 1
            d = 1
            m = arr_start + 1
            while m < len(inner) and d > 0:
                if inner[m] == '[':
                    d += 1
                elif inner[m] == ']':
                    d -= 1
                m += 1
            arr_content = inner[arr_start+1:m-1].strip()
            if arr_content:
                prototypes = [_strip_quotes(a) for a in _split_js_args(arr_content)]

        # Extract order array
        order_match = re.search(r'order\s*:\s*\[', inner)
        if order_match:
            arr_start = order_match.end() - 1
            d = 1
            m = arr_start + 1
            while m < len(inner) and d > 0:
                if inner[m] == '[':
                    d += 1
                elif inner[m] == ']':
                    d -= 1
                m += 1
            arr_content = inner[arr_start+1:m-1].strip()
            if arr_content and arr_content != 'null':
                order = [_strip_quotes(a) for a in _split_js_args(arr_content)]

        if prototypes:
            intents[intent_name] = {
                "prototypes": prototypes,
                "order": order or ['def', 'int', 'ex'],
            }

    return intents


def _strip_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] in ('"', "'") and s[-1] == s[0]:
        return s[1:-1].replace("\\'", "'").replace('\\"', '"')
    return s


def load_kb(bot_name: str, data_dir: str = "data/bots") -> list:
    """
    Load knowledge base entries for a given bot by parsing the JS source.

    Searches in order:
      1. chat/{bot_name}-chat/js/knowledge-base.js (canonical KB)
      2. ../../chat/{bot_name}-chat/js/knowledge-base.js (relative to dev/scripts)
      3. {data_dir}/{bot_name}/knowledge-base.js
    Falls back to synthetic KB if parsing fails.
    """
    # Search multiple possible paths (handles running from different directories)
    canonical_names = [
        Path("chat") / f"{bot_name}-chat" / "js" / "knowledge-base.js",
        Path("../../chat") / f"{bot_name}-chat" / "js" / "knowledge-base.js",
        Path("../..") / "chat" / f"{bot_name}-chat" / "js" / "knowledge-base.js",
        Path(data_dir) / f"{bot_name}-chat" / "knowledge-base.js",
    ]
    kb_path = None
    for p in canonical_names:
        if p.exists():
            kb_path = p
            break
    if kb_path:
        try:
            content = kb_path.read_text(encoding='utf-8')
            entries = _parse_js_kb(content)
            if entries:
                print(f"[kb] Parsed {len(entries)} entries from {kb_path}")
                return entries
            else:
                print(f"[kb] WARNING: parsed 0 entries from {kb_path}, falling back")
        except Exception as e:
            print(f"[kb] Parse error for {kb_path}: {e}, falling back")

    # Fallback: synthetic
    print(f"[kb] No parseable KB found for '{bot_name}' — using synthetic entries")
    return [
        {"id": "topic_001", "name": "Nash Equilibrium", "aliases": ["nash equilibrium", "nash"], "difficulty": 2},
        {"id": "topic_002", "name": "Prisoner's Dilemma", "aliases": ["prisoner's dilemma", "pd"], "difficulty": 1},
        {"id": "topic_003", "name": "Shapley Value", "aliases": ["shapley value", "shapley"], "difficulty": 3},
        {"id": "topic_004", "name": "Zero-Sum Game", "aliases": ["zero-sum game", "zero sum"], "difficulty": 1},
        {"id": "topic_005", "name": "Dominant Strategy", "aliases": ["dominant strategy", "dominance"], "difficulty": 1},
    ]


def load_intents(bot_name: str, data_dir: str = "data/bots") -> dict:
    """
    Load intent definitions for a bot by parsing the JS intents.js file.
    """
    intent_paths = [
        Path(data_dir) / f"{bot_name}-chat" / "intents.js",
        Path("../../data") / "bots" / f"{bot_name}-chat" / "intents.js",
    ]
    for intents_path in intent_paths:
        if intents_path.exists():
            try:
                content = intents_path.read_text(encoding='utf-8')
                intents = _parse_js_intents(content)
                if intents:
                    print(f"[intents] Parsed {len(intents)} intents from {intents_path}")
                    return intents
            except Exception as e:
                print(f"[intents] Parse error: {e}, using defaults")

    print(f"[intents] Using default intent prototypes")

    # Default intent prototypes (mirrors core/nlp.js DEFAULT_INTENTS)
    return {
        "definition": {
            "prototypes": [
                "what is X", "define X", "explain X", "what does X mean",
                "tell me about X", "describe X"
            ],
            "order": ["def", "int", "ex"],
        },
        "example": {
            "prototypes": [
                "give an example of X", "show me an example", "example of X",
                "illustrate X", "concrete case of X"
            ],
            "order": ["ex", "int", "def"],
        },
        "formal": {
            "prototypes": [
                "formal definition of X", "prove X", "theorem about X",
                "math behind X", "derive X", "equation for X"
            ],
            "order": ["form", "def", "ex"],
        },
        "application": {
            "prototypes": [
                "applications of X", "where is X used", "uses of X",
                "real world X", "practical use of X"
            ],
            "order": ["app", "ex", "int"],
        },
        "comparison": {
            "prototypes": [
                "difference between X and Y", "X vs Y", "compare X and Y",
                "how is X different from Y", "relation between X and Y"
            ],
            "order": ["def", "int", "ex"],
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="ReLU.chat WASM Policy Training Pipeline"
    )
    parser.add_argument(
        "--bot", type=str, default="game-theory",
        choices=BOT_PROFILES,
        help="Bot profile to train for",
    )
    parser.add_argument(
        "--epochs", type=int, default=1000,
        help="Number of training epochs",
    )
    parser.add_argument(
        "--output", type=str, default="assets/models/policy",
        help="Output directory for policy.wasm, weights.bin, manifest.json",
    )
    parser.add_argument(
        "--skip-train", action="store_true",
        help="Skip training (just generate prompts and dataset)",
    )
    parser.add_argument(
        "--export-only", type=str, default=None,
        help="Path to pre-trained checkpoint for export to ONNX/WASM",
    )
    parser.add_argument(
        "--data-dir", type=str, default="data/bots",
        help="Directory containing bot data folders",
    )
    # Improved: Additional training hyperparameters exposed as CLI args
    parser.add_argument(
        "--replay-capacity", type=int, default=10000,
        help="Replay buffer capacity (default: 10000)",
    )
    parser.add_argument(
        "--replay-batch-size", type=int, default=64,
        help="Mini-batch size for replay training (default: 64)",
    )
    parser.add_argument(
        "--entropy-start", type=float, default=0.05,
        help="Initial entropy coefficient (default: 0.05)",
    )
    parser.add_argument(
        "--entropy-end", type=float, default=0.01,
        help="Final entropy coefficient (default: 0.01)",
    )
    parser.add_argument(
        "--curriculum-warmup", type=int, default=200,
        help="Epochs at difficulty 1 before increasing (default: 200)",
    )
    parser.add_argument(
        "--no-follow-ups", action="store_true",
        help="Disable follow-up query generation",
    )
    parser.add_argument(
        "--metrics-output", type=str, default=None,
        help="Save training metrics JSON to this path",
    )
    parser.add_argument(
        "--seed", type=int, default=42,
        help="Random seed for deterministic training (default: 42)",
    )
    parser.add_argument(
        "--val-split", type=float, default=0.15,
        help="Fraction of dataset to reserve for validation (default: 0.15)",
    )
    parser.add_argument(
        "--metadata-output", type=str, default=None,
        help="Save training metadata JSON to this path (model info, reward weights, config)",
    )
    args = parser.parse_args()

    # Set deterministic seed for reproducibility
    set_seed(args.seed)

    print("=" * 60)
    print("ReLU.chat WASM Policy Training Pipeline")
    print(f"  Bot:               {args.bot}")
    print(f"  Epochs:            {args.epochs}")
    print(f"  Output:            {args.output}")
    print(f"  Seed:              {args.seed}")
    print(f"  Val split:         {args.val_split}")
    print(f"  Replay capacity:   {args.replay_capacity}")
    print(f"  Replay batch size: {args.replay_batch_size}")
    print(f"  Entropy range:     {args.entropy_start} → {args.entropy_end}")
    print(f"  Curriculum warmup: {args.curriculum_warmup}")
    print(f"  Follow-up queries: {'OFF' if args.no_follow_ups else 'ON'}")
    print("=" * 60)
    print()

    # Step 1: Load KB and intents
    kb = load_kb(args.bot, args.data_dir)
    intents = load_intents(args.bot, args.data_dir)
    print(f"[init] Loaded {len(kb)} KB entries, {len(intents)} intents")

    # Step 2: Generate prompts
    prompts = generate_prompts(kb, intents)
    print(f"[prompts] Total: {len(prompts)}")

    # Step 2b: Generate follow-up pairs for multi-turn training
    if not args.no_follow_ups:
        follow_up_pairs = generate_follow_up_pairs(prompts, n_pairs=min(500, len(prompts)))
        # Add follow-up prompts to the main prompt list
        fu_prompts = [pair["follow_up"] for pair in follow_up_pairs]
        # Also add initial prompts of pairs to ensure both are in dataset
        initial_of_pairs = [pair["initial"] for pair in follow_up_pairs]
        # Merge (deduplicate by text)
        all_texts = {p["text"] for p in prompts}
        for p in initial_of_pairs:
            if p["text"] not in all_texts:
                prompts.append(p)
                all_texts.add(p["text"])
        for p in fu_prompts:
            if p["text"] not in all_texts:
                prompts.append(p)
                all_texts.add(p["text"])
        print(f"[prompts] Total with follow-ups: {len(prompts)}")

    # Step 3: Build retrieval dataset
    dataset = build_retrieval_dataset(prompts, kb, intents)
    print(f"[dataset] Total samples: {len(dataset)}")

    # Step 3b: Train/validation split
    val_dataset = None
    if args.val_split > 0 and args.val_split < 1:
        random.shuffle(dataset)
        split_idx = int(len(dataset) * (1 - args.val_split))
        train_dataset = dataset[:split_idx]
        val_dataset = dataset[split_idx:]
        print(f"[dataset] Train: {len(train_dataset)}, Val: {len(val_dataset)}")
    else:
        train_dataset = dataset
        print(f"[dataset] No validation split (val-split={args.val_split})")

    if args.skip_train:
        print("[skip] Training skipped (--skip-train)")
        return

    if args.export_only:
        print(f"[export] Loading checkpoint from {args.export_only} ...")
        # TODO: load PyTorch checkpoint
        policy_net = PolicyNetworkWrapper()
    else:
        # Step 4: Initialize policy network
        policy_net = PolicyNetworkWrapper()

        # Step 5: Train (improved with replay, entropy, curriculum, cosine LR)
        print(f"[train] Starting {args.epochs} epochs on {len(train_dataset)} train / {len(val_dataset) if val_dataset else 0} val samples...")
        policy_net, metrics = train(
            policy_net, train_dataset,
            val_dataset=val_dataset,
            epochs=args.epochs,
            replay_capacity=args.replay_capacity,
            replay_batch_size=args.replay_batch_size,
            entropy_start=args.entropy_start,
            entropy_end=args.entropy_end,
            curriculum_warmup=args.curriculum_warmup,
        )
        print("[train] Training complete")

        # Save training metrics if requested
        if args.metrics_output:
            os.makedirs(os.path.dirname(args.metrics_output) or '.', exist_ok=True)
            with open(args.metrics_output, 'w') as f:
                json.dump(metrics, f, indent=2)
            print(f"[metrics] Saved to {args.metrics_output}")

        # Export rich training metadata
        training_date = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        metadata = {
            "model_version": "0.4.0",
            "n_features": N_FEATURES,
            "output_heads": {name: size for name, size in ACTION_SIZES_ORDERED},
            "reward_weights": dict(REWARD_WEIGHTS),
            "training_date": training_date,
            "seed": args.seed,
            "bot": args.bot,
            "hyperparameters": {
                "epochs": args.epochs,
                "learning_rate": 1e-3,
                "batch_size": 64,
                "replay_capacity": args.replay_capacity,
                "replay_batch_size": args.replay_batch_size,
                "entropy_start": args.entropy_start,
                "entropy_end": args.entropy_end,
                "entropy_anneal_epochs": 500,
                "value_loss_coeff": 0.5,
                "max_grad_norm": 0.5,
                "curriculum_warmup": args.curriculum_warmup,
                "curriculum_step": 200,
                "val_split": args.val_split,
            },
            "dataset": {
                "total_prompts": len(prompts),
                "train_samples": len(train_dataset),
                "val_samples": len(val_dataset) if val_dataset else 0,
                "follow_up_pairs": 0 if args.no_follow_ups else min(500, len(prompts)),
            },
            "architecture": {
                "trunk": "25→128→64 (ReLU + LayerNorm + Dropout)",
                "total_params": sum(p.numel() for p in policy_net.net.parameters()),
            },
            "metrics_summary": {
                "final_train_reward": float(metrics['avg_reward'][-1]) if metrics['avg_reward'] else None,
                "final_val_reward": float(metrics['val_avg_reward'][-1]) if metrics.get('val_avg_reward') and metrics['val_avg_reward'][-1] > 0 else None,
                "final_entropy": float(metrics['avg_entropy'][-1]) if metrics['avg_entropy'] else None,
                "total_gradient_steps": len(metrics['avg_loss']),
            },
        }
        metadata_path = args.metadata_output or os.path.join(args.output, "policy.train_metadata.json")
        os.makedirs(os.path.dirname(metadata_path) or '.', exist_ok=True)
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        print(f"[metadata] Training metadata saved to {metadata_path}")

    # Step 6: Export weights directly to JSON (what JS MLP engine loads)
    os.makedirs(args.output, exist_ok=True)

    # Per-bot weights
    bot_weights_path = os.path.join(args.output, args.bot, "policy.weights.json")
    os.makedirs(os.path.dirname(bot_weights_path), exist_ok=True)
    policy_net.net.save_weights_json(bot_weights_path)

    # Also export to main weights path
    main_weights_path = os.path.join(args.output, "policy.weights.json")
    policy_net.net.save_weights_json(main_weights_path)

    # Step 7: Update manifest
    manifest_path = os.path.join(args.output, "policy.manifest.json")
    weights_size = os.path.getsize(main_weights_path)
    training_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    manifest = {
        "version": "0.4.0",
        "inputFeatures": 25,
        "inputBytes": 107,
        "outputSchema": "AnswerPlan.v1",
        "fragmentMetaVersion": "1.0.0",
        "model": "mlp_policy",
        "weightsSize": weights_size,
        "wasmSize": 43,
        "wasmHash": "sha256-stub",
        "botProfiles": ["game-theory", "golden-age", "data-science"],
        "trained": training_date,
        "seed": args.seed,
        "rewardWeights": dict(REWARD_WEIGHTS),
        "architecture": {
            "trunk": "25→128→64 (ReLU + LayerNorm + Dropout)",
            "heads": {name: size for name, size in ACTION_SIZES_ORDERED},
            "total_params": sum(p.numel() for p in policy_net.net.parameters()),
        },
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[manifest] Updated {manifest_path}")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[manifest] Updated {manifest_path}")

    print()
    print("=" * 60)
    print(f"Pipeline complete for {args.bot}.")
    print(f"  Weights: {main_weights_path} ({weights_size} bytes)")
    print(f"  Per-bot: {bot_weights_path}")
    print("=" * 60)


if __name__ == "__main__":
    main()
