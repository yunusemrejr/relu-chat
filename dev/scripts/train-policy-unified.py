#!/usr/bin/env python3
"""
train-policy-unified.py — ReLU.chat Unified Policy Training Pipeline

Merges the best parts of train-policy.py (REINFORCE with replay buffer,
9-component reward, curriculum learning, entropy annealing, cosine LR,
gradient clipping, advantage normalization, multi-turn follow-ups) and
train_real.py (real KB parsing, fragment-meta loading, supervised
pretraining, state-dependent value baseline, discrimination test,
anti-collapse measures).

Adds:
  - Answer budget labeling (short/medium/long)
  - Diagram use labeling
  - Golden evaluation with confusion matrix + regression check
  - Structured artifact output (config, dataset summary, metrics,
    validation report, confusion matrix, weights JSON+bin, manifest, eval.html)

Usage:
  python3 dev/scripts/train-policy-unified.py --bot game-theory --output dev/exports/policy-runs/
  python3 dev/scripts/train-policy-unified.py --bot all --epochs 50

Design Version: 0.5.0
"""

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# Import shared policy model
sys.path.insert(0, str(Path(__file__).parent))
from policy_model import PolicyNetwork, ACTION_SIZES_ORDERED, N_FEATURES

# ────────────────────────────────────────────────────────────────────────
# Constants
# ────────────────────────────────────────────────────────────────────────

VERSION = "0.5.0"
FEATURE_SCHEMA_VERSION = "0.5.0"

BOT_PROFILES = ["game-theory", "golden-age", "data-science"]

ALL_INTENTS = ["definition", "example", "formal", "application", "comparison"]
MODE_LABELS = ["normal", "off_topic", "greeting", "help", "comparison"]
TONE_LABELS = ["neutral", "formal", "intuitive", "playful"]
COUNT_LABELS = [1, 2, 3, 4]

REWARD_WEIGHTS = {
    "intent_match": 0.20,
    "topic_precision": 0.15,
    "fragment_coherence": 0.12,
    "length_penalty": 0.08,
    "creativity_alignment": 0.08,
    "guardrail_ok": 0.15,
    "follow_up_continuity": 0.18,
    "diversity": 0.07,
    "response_coherence": 0.05,
}

FEATURE_NAMES = [
    "qSimTop1", "qSimTop2",
    "entityCount", "entityBoostHit",
    "intentDefScore", "intentExScore",
    "intentFormScore", "intentAppScore",
    "intentCompScore", "lastTopicSim",
    "lastTopicAge", "kbCoverage",
    "queryLenTokens", "hasComparisonCue",
    "hasFormalCue", "hasExampleCue",
    "botCreativity", "domainMatch",
    "followUpType", "wasAmbiguous",
    "avgTruthConf", "avgSourceConf",
    "minDifficulty", "fragDiversity",
    "avoidWithCount",
]

INTENT_PROTOS = {
    "definition": ["what is X", "define X", "explain X", "what does X mean"],
    "example": ["give an example of X", "show me an example of X", "example of X"],
    "formal": ["formal definition of X", "prove X", "theorem about X"],
    "application": ["applications of X", "where is X used", "real world use of X"],
    "comparison": ["difference between X and Y", "X vs Y", "compare X and Y"],
}

FOLLOW_UP_TEMPLATES = [
    ("go on", "continuation", 0.90),
    ("what else", "expansion", 0.80),
    ("how", "procedural", 0.70),
    ("example", "example", 0.65),
    ("simplify", "simplification", 0.60),
    ("can you elaborate", "elaboration", 0.80),
    ("i don't understand", "clarification", 0.50),
    ("what do you mean by that", "clarification", 0.70),
    ("why", "causal", 0.60),
    ("give me more details", "expansion", 0.75),
    ("i asked about X actually", "topic_correction", 0.95),
    ("no, just X", "topic_correction", 0.95),
    ("not that, X", "topic_correction", 0.90),
    ("not subgame stuff", "topic_rejection", 0.30),
]

FOLLOWUP_TYPE_TO_CODE = {
    "simplify": 1, "compare_previous": 2, "example": 3, "elaborate": 4,
    "reference_index": 5, "another_example": 6, "specific": 7,
    "continue": 8, "how": 9, "why": 10, "challenge": 11,
    "acknowledge": 12, "clarify": 13, "deep_dive": 14, "relevance": 15,
    "evidence": 16, "comparison": 17, "summarize": 18, "affirm_continue": 19,
    "what_else": 20, "topic_correction": 21, "topic_rejection": 22,
}

FOLLOWUP_LABEL_TO_TYPE = {
    "continuation": "continue",
    "expansion": "elaborate",
    "procedural": "how",
    "example": "example",
    "simplification": "simplify",
    "elaboration": "elaborate",
    "clarification": "clarify",
    "causal": "why",
    "topic_correction": "topic_correction",
    "topic_rejection": "topic_rejection",
}

_GREETING_WORDS = {"hi", "hey", "hello", "yo", "sup"}
_HELP_WORDS = {"help", "confused", "how do", "dont understand", "stuck"}
_COMP_CUE = re.compile(r'\b(compare|vs|versus|difference|differ|between)\b', re.I)
_FORMAL_CUE = re.compile(r'\b(prove|theorem|formal|math|rigorous|derive)\b', re.I)
_EXAMPLE_CUE = re.compile(r'\b(example|illustrate|show me|demonstrate)\b', re.I)
_DOMAIN_KW = re.compile(
    r'\b(game|theory|strategy|nash|equilibrium|islamic|golden|age|history|'
    r'math|science|data|regression|classification|cluster|learning|model|'
    r'algorithm|network|neural|deep|cnn|rnn|transformer|bert|gpt|'
    r'probability|utility|payoff|dominant|mixed|preference|belief|'
    r'koran|quran|islam|medieval|civilization|culture|art|architecture)\b',
    re.I
)


# ────────────────────────────────────────────────────────────────────────
# Deterministic seed
# ────────────────────────────────────────────────────────────────────────

def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
    torch.backends.cudnn.deterministic = True
    torch.backends.cudnn.benchmark = False


# ────────────────────────────────────────────────────────────────────────
# KB & Fragment-Meta Parsing (from train_real.py)
# ────────────────────────────────────────────────────────────────────────

def _split_js_args(text: str) -> list:
    args = []
    depth = 0
    in_str = False
    str_char = None
    start = 0
    i = 0
    while i < len(text):
        c = text[i]
        if in_str:
            if c == '\\' and i + 1 < len(text):
                i += 2
                continue
            if c == str_char:
                in_str = False
        else:
            if c in ("'", '"'):
                in_str = True
                str_char = c
            elif c in '([{':
                depth += 1
            elif c in ')]}':
                depth -= 1
            elif c == ',' and depth == 0:
                args.append(text[start:i].strip())
                start = i + 1
        i += 1
    last = text[start:].strip()
    if last:
        args.append(last)
    return args


def _parse_js_str(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] in ("'", '"') and s[-1] == s[0]:
        s = s[1:-1]
    return s.replace("\\'", "'").replace('\\"', '"')


def _parse_js_str_array(s: str) -> list:
    s = s.strip()
    if s.startswith('[') and s.endswith(']'):
        s = s[1:-1]
    if not s.strip():
        return []
    items = _split_js_args(s)
    return [_parse_js_str(item) for item in items]


def _parse_js_fragments(s: str) -> dict:
    s = s.strip()
    result = {}
    if not (s.startswith('{') and s.endswith('}')):
        return result
    s = s[1:-1].strip()
    pairs = _split_js_args(s)
    for pair in pairs:
        pair = pair.strip()
        colon = pair.find(':')
        if colon == -1:
            continue
        key = pair[:colon].strip().strip("'\" ")
        val = pair[colon + 1:].strip()
        if val.startswith('['):
            result[key] = _parse_js_str_array(val)
        else:
            result[key] = _parse_js_str(val)
    return result


def parse_kb_js(filepath: str) -> list:
    """Parse kb(id, name, aliases, summary, f, related) calls from a JS file."""
    with open(filepath, 'r', encoding='utf-8') as fh:
        content = fh.read()
    entries = []
    idx = 0
    while True:
        pos = content.find('kb(', idx)
        if pos == -1:
            break
        depth = 0
        j = pos
        in_str = False
        str_char = None
        while j < len(content):
            c = content[j]
            if in_str:
                if c == '\\':
                    j += 2
                    continue
                if c == str_char:
                    in_str = False
            else:
                if c in ("'", '"'):
                    in_str = True
                    str_char = c
                elif c == '(':
                    depth += 1
                elif c == ')':
                    depth -= 1
                    if depth == 0:
                        break
            j += 1
        call_text = content[pos + 3:j].strip()
        args = _split_js_args(call_text)
        if len(args) >= 5:
            entry_id = _parse_js_str(args[0])
            entry = {
                'id': entry_id,
                'name': _parse_js_str(args[1]),
                'aliases': _parse_js_str_array(args[2]),
                'summary': _parse_js_str(args[3]),
                'f': _parse_js_fragments(args[4]),
                'related': _parse_js_str_array(args[5]) if len(args) > 5 else [],
            }
            entries.append(entry)
        idx = j + 1
    return entries


def find_kb_file(bot_name: str) -> str | None:
    bot_to_chat = {
        'game-theory': 'game-theory-chat',
        'golden-age': 'golden-age-inquiry',
        'data-science': 'data-science-chat',
    }
    chat_dir = bot_to_chat.get(bot_name)
    if chat_dir:
        p = Path('chat') / chat_dir / 'js' / 'knowledge-base.js'
        if p.exists():
            return str(p)
        p = Path('data') / 'bots' / chat_dir / 'knowledge.js'
        if p.exists():
            return str(p)
    return None


def load_bot_kb(bot_name: str) -> list:
    kb_path = find_kb_file(bot_name)
    if kb_path:
        print(f"[kb] Loading from {kb_path}")
        entries = parse_kb_js(kb_path)
        print(f"[kb] Parsed {len(entries)} entries")
        return entries
    print(f"[kb] WARNING: No KB found for {bot_name}")
    return []


def load_fragment_meta(bot_name: str) -> dict:
    bot_to_dir = {
        'game-theory': 'game-theory-chat',
        'golden-age': 'golden-age-inquiry',
        'data-science': 'data-science-chat',
    }
    chat_dir = bot_to_dir.get(bot_name)
    if not chat_dir:
        return {}
    p = Path('data') / 'bots' / chat_dir / 'fragment-meta.json'
    if p.exists():
        try:
            with open(p, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"[meta] WARNING: failed to load {p}: {e}")
    return {}


# ────────────────────────────────────────────────────────────────────────
# Answer Budget & Diagram Labeling
# ────────────────────────────────────────────────────────────────────────

def label_answer_budget(gold_intent: str, gold_difficulty: int, query_text: str) -> str:
    """
    Classify the expected answer length budget for a query.
    Returns 'short', 'medium', or 'long'.
    """
    tokens = len(query_text.split())
    if gold_intent == 'definition':
        if gold_difficulty <= 1:
            return 'short'
        return 'medium'
    elif gold_intent == 'example':
        return 'medium' if gold_difficulty >= 2 else 'short'
    elif gold_intent == 'formal':
        return 'long' if gold_difficulty >= 2 else 'medium'
    elif gold_intent == 'application':
        return 'long'
    elif gold_intent == 'comparison':
        return 'long'
    if tokens < 4:
        return 'short'
    elif tokens < 12:
        return 'medium'
    return 'long'


def label_diagram_beneficial(query_text: str, gold_intent: str, kb_entry: dict = None) -> bool:
    """
    Determine if a diagram would be beneficial for this query.
    True for: formal intents, comparison intents, queries with
    diagram-related cues (graph, chart, plot, tree, matrix, table, curve),
    and for math-heavy KB topics.
    """
    text_lower = query_text.lower()
    diagram_cues = {'graph', 'chart', 'plot', 'tree', 'matrix', 'table',
                    'curve', 'figure', 'draw', 'visual', 'diagram', 'axis',
                    'coordinate', 'heatmap', 'network', 'path'}
    if diagram_cues & set(re.findall(r'\w+', text_lower)):
        return True
    if gold_intent in ('formal', 'comparison'):
        return True
    if kb_entry:
        math_cues = {'matrix', 'tree', 'graph', 'curve', 'equation', 'inequality',
                     'payoff', 'function', 'axis', 'polytope', 'convex'}
        name_lower = kb_entry.get('name', '').lower()
        summary_lower = kb_entry.get('summary', '').lower()
        if math_cues & set(re.findall(r'\w+', name_lower + ' ' + summary_lower)):
            return True
    return False


# ────────────────────────────────────────────────────────────────────────
# Prompt Generation (merged from both scripts)
# ────────────────────────────────────────────────────────────────────────

def generate_prompts(kb: list, fragment_meta: dict = None, max_n: int = 800) -> list:
    """
    Deterministic prompt generation with fragment-meta awareness.
    Covers all 5 intents per KB topic.
    """
    random.seed(42)
    fragment_meta = fragment_meta or {}
    prompts = []

    if not kb:
        for intent in ALL_INTENTS:
            for i in range(max_n // 5):
                prompts.append({
                    'text': f'tell me about topic {i}',
                    'gold_intent': intent,
                    'gold_topics': [],
                    'gold_difficulty': random.randint(1, 3),
                    'gold_frag_count': 2,
                    'gold_budget': 'medium',
                    'diagram_beneficial': False,
                })
        return prompts[:max_n]

    n_topics = min(len(kb), max(max_n // 4, 60))
    topics = kb[:n_topics]
    for entry in topics:
        eid = entry.get('id', 'unknown')
        name = entry.get('name', eid)
        aliases = [name] + [a for a in entry.get('aliases', []) if isinstance(a, str)][:2]
        meta_entry = fragment_meta.get(eid, {})
        frags = meta_entry.get('fragments', {})
        n_high_conf = sum(
            1 for cat in frags.values() if isinstance(cat, list)
            for f in cat
            if isinstance(f, dict) and f.get('meta', {}).get('truth_confidence', 0) >= 0.8
        )
        gold_fc = max(1, min(4, 1 + n_high_conf // 3))

        for intent in ALL_INTENTS:
            if intent == 'comparison' and len(set(a.lower() for a in aliases)) < 2:
                continue
            proto = INTENT_PROTOS[intent][0]
            text = proto.replace('X', aliases[0])
            if 'Y' in text:
                text = text.replace('Y', aliases[1] if len(aliases) > 1 else aliases[0])
            difficulty = 1 + ALL_INTENTS.index(intent) % 2
            prompts.append({
                'text': text,
                'gold_intent': intent,
                'gold_topics': [eid],
                'gold_difficulty': difficulty,
                'gold_frag_count': gold_fc,
                'gold_budget': label_answer_budget(intent, difficulty, text),
                'diagram_beneficial': label_diagram_beneficial(text, intent, entry),
            })
            if len(prompts) >= max_n:
                break
        if len(prompts) >= max_n:
            break
    return prompts[:max_n]


# ────────────────────────────────────────────────────────────────────────
# Follow-Up Query Generation (from train-policy.py)
# ────────────────────────────────────────────────────────────────────────

def generate_follow_up_pairs(prompts: list, n_pairs: int = 500) -> list:
    pairs = []
    selected = random.sample(prompts, min(len(prompts), n_pairs))
    for prompt in selected:
        fu_template, fu_type, topic_continuity = random.choice(FOLLOW_UP_TEMPLATES)
        if random.random() < 0.3 and len(prompt['text']) > 10:
            fu_text = f"{prompt['text']} — {fu_template}"
        else:
            fu_text = fu_template
        follow_up = {
            'text': fu_text,
            'gold_intent': prompt.get('gold_intent', 'definition'),
            'gold_topics': prompt.get('gold_topics', []),
            'gold_difficulty': min(4, prompt.get('gold_difficulty', 1) + 1),
            'source': 'follow_up',
            'follow_up_type': fu_type,
            'topic_continuity': topic_continuity,
            'gold_budget': 'short',
            'diagram_beneficial': False,
        }
        pairs.append({'initial': prompt, 'follow_up': follow_up, 'type': fu_type})
    print(f"[follow-ups] Generated {len(pairs)} follow-up pairs")
    return pairs


# ────────────────────────────────────────────────────────────────────────
# Feature Building (from train_real.py, fragment-meta aware)
# ────────────────────────────────────────────────────────────────────────

def build_features(text: str, fragment_meta: dict = None, topic_ids: list = None) -> list:
    f = [0.0] * N_FEATURES
    text_lower = text.lower()
    words = re.sub(r'[^a-z0-9\s]', ' ', text_lower).split()
    tokens = [w for w in words if w]
    tl = len(text_lower)

    # [4-8] intent scores from keyword overlap
    intent_kws = {
        'definition': ['what is', 'define', 'explain', 'meaning', 'what does'],
        'example': ['example', 'illustrate', 'show me', 'give an', 'demonstrate'],
        'formal': ['prove', 'theorem', 'formal', 'derive', 'rigorous', 'proof'],
        'application': ['application', 'used', 'practical', 'where is', 'real world'],
        'comparison': ['difference', 'compare', 'vs', 'versus', 'how different', 'relation'],
    }
    intent_scores = []
    for j, intent_name in enumerate(ALL_INTENTS):
        kws = intent_kws.get(intent_name, [])
        hits = sum(1 for kw in kws if kw in text_lower)
        f[4 + j] = hits / max(len(kws), 1)
        intent_scores.append(f[4 + j])

    # [0] qSimTop1, [1] qSimTop2
    sorted_scores = sorted(intent_scores, reverse=True)
    f[0] = sorted_scores[0] * 0.9 if sorted_scores[0] > 0 else 0.0
    f[1] = sorted_scores[1] * 0.7 if len(sorted_scores) > 1 and sorted_scores[1] > 0 else f[0] * 0.5

    # [2] entityCount, [3] entityBoostHit
    f[2] = min(len(set(tokens)), 3) / 3.0
    f[3] = 1.0 if len(set(tokens)) > 2 else 0.0

    # [9] lastTopicSim, [10] lastTopicAge (cold start)
    f[9] = f[0] * 0.5
    f[10] = 0.0

    # [11] kbCoverage
    f[11] = sum(intent_scores) / max(len(intent_scores), 1)

    # [12] queryLenTokens normalized
    f[12] = (min(max(1, len(tokens)), 32) - 1) / 31.0

    # [13-15] cue flags
    f[13] = 1.0 if _COMP_CUE.search(text) else 0.0
    f[14] = 1.0 if _FORMAL_CUE.search(text) else 0.0
    f[15] = 1.0 if _EXAMPLE_CUE.search(text) else 0.0

    # [16] botCreativity
    f[16] = 0.25 + 0.15 * (min(len(tokens), 20) / 20.0)

    # [17] domainMatch
    f[17] = min(sum(1 for dk in re.findall(r'\w+', text_lower) if dk in _DOMAIN_KW.pattern) / 3.0, 1.0)

    # [18] followUpType = 0 (synthetic prompts have no multi-turn context)
    f[18] = 0.0

    # [19] wasAmbiguous
    f[19] = 1.0 if tl < 15 else 0.0

    # [20-24] fragment metadata from real fragment-meta.json
    f[20] = 0.0
    f[21] = 0.0
    f[22] = 0.0
    f[23] = 0.0
    f[24] = 0.0

    if fragment_meta and topic_ids:
        all_truth = []
        all_source = []
        min_diff = []
        for tid in topic_ids:
            meta_entry = fragment_meta.get(tid, {})
            frags = meta_entry.get('fragments', {})
            for cat_frags in frags.values():
                if isinstance(cat_frags, list):
                    for frag in cat_frags:
                        if isinstance(frag, dict):
                            m = frag.get('meta', {})
                            tc = m.get('truth_confidence')
                            sc = m.get('source_confidence')
                            d = m.get('difficulty')
                            if tc is not None:
                                all_truth.append(tc)
                            if sc is not None:
                                all_source.append(sc)
                            if d is not None:
                                min_diff.append(d)
        if all_truth:
            f[20] = sum(all_truth) / len(all_truth)
        if all_source:
            f[21] = sum(all_source) / len(all_source)
        if min_diff:
            f[22] = min(min_diff) / 4.0
        f[23] = min(len(set(str(f) for f in min_diff if f)), 3) / 3.0  # fragDiversity
        # [24] avoidWithCount: fraction of first few topics with avoid constraints
        avoid_count = 0
        for tid in topic_ids[:3]:
            meta_entry = fragment_meta.get(tid, {})
            frags = meta_entry.get('fragments', {})
            has_avoid = False
            for cat_frags in frags.values():
                if isinstance(cat_frags, list):
                    for frag in cat_frags:
                        if isinstance(frag, dict) and frag.get('meta', {}).get('avoid_with'):
                            has_avoid = True
                            break
                if has_avoid:
                    break
            if has_avoid:
                avoid_count += 1
        f[24] = avoid_count / max(len(topic_ids[:3]), 1)

    return f


# ────────────────────────────────────────────────────────────────────────
# Dataset Construction
# ────────────────────────────────────────────────────────────────────────

def build_dataset(prompts: list, fragment_meta: dict = None) -> list:
    dataset = []
    for p in prompts:
        feat = build_features(
            p['text'],
            fragment_meta=fragment_meta,
            topic_ids=p.get('gold_topics', [])
        )
        dataset.append({'prompt': p, 'features': feat})
    return dataset


# ────────────────────────────────────────────────────────────────────────
# Replay Buffer (from train-policy.py)
# ────────────────────────────────────────────────────────────────────────

class ReplayBuffer:
    def __init__(self, capacity=10000):
        self.buffer = deque(maxlen=capacity)

    def store(self, state, actions, reward, log_probs, value):
        self.buffer.append({
            'state': state,
            'actions': actions,
            'reward': reward,
            'log_probs': log_probs,
            'value': value,
        })

    def sample(self, batch_size=64):
        if len(self.buffer) < batch_size:
            indices = list(range(len(self.buffer)))
        else:
            indices = random.sample(range(len(self.buffer)), batch_size)
        return [self.buffer[i] for i in indices]

    def __len__(self):
        return len(self.buffer)

    def clear(self):
        self.buffer.clear()


# ────────────────────────────────────────────────────────────────────────
# Curriculum Learning Scheduler (from train-policy.py)
# ────────────────────────────────────────────────────────────────────────

class DifficultyScheduler:
    def __init__(self, max_difficulty=4, warmup_epochs=200, step_epochs=200):
        self.max_difficulty = max_difficulty
        self.warmup_epochs = warmup_epochs
        self.step_epochs = step_epochs

    def get_threshold(self, epoch):
        if epoch < self.warmup_epochs:
            return 1
        steps = (epoch - self.warmup_epochs) // self.step_epochs
        return min(1 + steps, self.max_difficulty)


# ────────────────────────────────────────────────────────────────────────
# Diversity Tracker (from train-policy.py)
# ────────────────────────────────────────────────────────────────────────

_action_mode_intent_history = deque(maxlen=100)


def _get_diversity_bonus(mode_val, intent_val) -> float:
    key = (int(mode_val) if not isinstance(mode_val, torch.Tensor) else mode_val.item(),
           int(intent_val) if not isinstance(intent_val, torch.Tensor) else intent_val.item())
    _action_mode_intent_history.append(key)
    if len(_action_mode_intent_history) < 10:
        return 0.75
    recent = list(_action_mode_intent_history)[-20:]
    freq = recent.count(key) / len(recent)
    return 1.0 - 0.5 * freq


# ────────────────────────────────────────────────────────────────────────
# Reward Function (9-component, from train-policy.py + fragment from train_real.py)
# ────────────────────────────────────────────────────────────────────────

def compute_reward(actions: dict, prompt: dict, features: list,
                   dataset_sample: dict = None) -> tuple:
    intent_names = ["definition", "example", "formal", "application", "comparison"]

    def _scalar(a, default=0):
        if isinstance(a, torch.Tensor):
            return a.item() if a.numel() == 1 else int(a)
        return a if a is not None else default

    action_vals = {k: _scalar(v) for k, v in actions.items()}
    chosen_intent = intent_names[action_vals.get("intent", 0) % len(intent_names)]
    gold_intent = prompt.get("gold_intent", "definition")

    # Intent match (with neighbor partial credit)
    intent_match = 1.0 if chosen_intent == gold_intent else 0.0
    intent_neighbors = {
        'definition': {'example': 0.5, 'formal': 0.4, 'application': 0.3},
        'example': {'definition': 0.5, 'application': 0.4},
        'formal': {'definition': 0.4, 'application': 0.3},
        'application': {'definition': 0.3, 'example': 0.4},
        'comparison': {'definition': 0.2},
    }
    if intent_match == 0.0:
        intent_match = intent_neighbors.get(gold_intent, {}).get(chosen_intent, 0.0)

    # Topic precision
    gold_topics = set(prompt.get("gold_topics", []))
    selected_topic_count = action_vals.get("topic_count", 1)
    topic_precision = (
        min(selected_topic_count, max(len(gold_topics), 1)) / max(len(gold_topics), 1)
        if len(gold_topics) > 0 else 0.5
    )

    # Fragment coherence
    kb_coverage = features[11] if len(features) > 11 else 0.3
    avg_truth = features[20] if len(features) > 20 else 0.7
    avg_source = features[21] if len(features) > 21 else 0.7
    fragment_coherence = 0.5 * avg_truth + 0.3 * avg_source + 0.2 * kb_coverage

    # Length penalty (quadratic outside [40, 180])
    rendered_text = _stub_render(actions, prompt, features)
    n_tokens = len(rendered_text.split()) if rendered_text else 0
    if 40 <= n_tokens <= 180:
        length_penalty = 1.0
    elif n_tokens < 40:
        length_penalty = max(0.0, 1.0 - ((40 - n_tokens) / 40) ** 2)
    else:
        length_penalty = max(0.0, 1.0 - ((n_tokens - 180) / 180) ** 2)

    # Creativity alignment
    creativity_val = action_vals.get('creativity', 0)
    if isinstance(creativity_val, (int, float)):
        gold_creativity = prompt.get('gold_difficulty', 1) / 4.0
        creativity_alignment = 1.0 - min(abs(float(creativity_val) - gold_creativity), 1.0)
    else:
        creativity_alignment = 0.8

    # Guardrail compliance
    guardrail_ok = 1.0
    if selected_topic_count > 3:
        guardrail_ok = 0.0
    if avg_truth < 0.5 and avg_truth > 0:
        guardrail_ok = 0.0

    # Follow-up continuity
    is_follow_up = features[18] > 0 if len(features) > 18 else False
    follow_up_continuity = 0.5
    if is_follow_up:
        topic_continuity = prompt.get('topic_continuity', 0.5)
        last_topic_sim = features[9] if len(features) > 9 else 0.5
        follow_up_continuity = 0.4 * topic_continuity + 0.6 * last_topic_sim

    # Diversity bonus
    diversity = _get_diversity_bonus(
        action_vals.get("mode", 0), action_vals.get("intent", 0)
    )

    # Response coherence
    response_coherence = 0.5
    if dataset_sample:
        intent_raw_scores = dataset_sample.get('intent_raw_scores', {})
        chosen_intent_score = intent_raw_scores.get(chosen_intent, 0.5)
        gold_intent_score = intent_raw_scores.get(gold_intent, 0.5)
        response_coherence = 0.6 * chosen_intent_score + 0.4 * gold_intent_score

    # Fragment count alignment (from train_real.py)
    gold_fc = int(prompt.get('gold_frag_count', 2))
    pred_fc_idx = int(action_vals.get('frag_count', 1))
    pred_fc = [1, 2, 3, 4][pred_fc_idx] if 0 <= pred_fc_idx < 4 else 2
    fc_match = 1.0 - abs(pred_fc - gold_fc) / 3.0

    components = {
        'intent_match': intent_match,
        'topic_precision': topic_precision,
        'fragment_coherence': fragment_coherence,
        'length_penalty': length_penalty,
        'creativity_alignment': creativity_alignment,
        'guardrail_ok': guardrail_ok,
        'follow_up_continuity': follow_up_continuity,
        'diversity': diversity,
        'response_coherence': response_coherence,
    }

    total = (
        REWARD_WEIGHTS['intent_match'] * intent_match
        + REWARD_WEIGHTS['topic_precision'] * topic_precision
        + REWARD_WEIGHTS['fragment_coherence'] * fragment_coherence
        + REWARD_WEIGHTS['length_penalty'] * length_penalty
        + REWARD_WEIGHTS['creativity_alignment'] * creativity_alignment
        + REWARD_WEIGHTS['guardrail_ok'] * guardrail_ok
        + REWARD_WEIGHTS['follow_up_continuity'] * follow_up_continuity
        + REWARD_WEIGHTS['diversity'] * diversity
        + REWARD_WEIGHTS['response_coherence'] * response_coherence
    )

    # Moderate bonus for fragment count alignment
    total += 0.1 * fc_match

    return total, components


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
    return f"[{chosen_mode}/{chosen_intent}/{chosen_tone}] Explanation of {topic}. Simulated training response."


# ────────────────────────────────────────────────────────────────────────
# Supervised Pretraining (from train_real.py)
# ────────────────────────────────────────────────────────────────────────

def pretrain(net: nn.Module, dataset: list, epochs: int = 25,
             batch_size: int = 32, lr: float = 1e-2) -> nn.Module:
    """Supervised pretraining: cross-entropy on gold intent + gold mode + value regression."""
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    ce = nn.CrossEntropyLoss()
    mse = nn.MSELoss()

    intent_idx = {v: i for i, v in enumerate(ALL_INTENTS)}
    mode_idx = {v: i for i, v in enumerate(MODE_LABELS)}

    for ep in range(epochs):
        random.shuffle(dataset)
        total_loss = 0.0
        nb = 0
        for i in range(0, len(dataset), batch_size):
            batch = dataset[i:i + batch_size]
            bsz = len(batch)
            ft = torch.tensor([s['features'] for s in batch], dtype=torch.float32)
            logits, vals = net(ft)

            gold_intent = torch.tensor([
                intent_idx.get(batch[j]['prompt'].get('gold_intent', 'definition'), 0)
                for j in range(bsz)
            ], dtype=torch.long)

            is_greet = torch.tensor([
                bool(set(re.findall(r'\w+', batch[j]['prompt']['text'].lower()))
                     & _GREETING_WORDS)
                for j in range(bsz)
            ], dtype=torch.bool)
            is_help = torch.tensor([
                bool(set(re.findall(r'\w+', batch[j]['prompt']['text'].lower()))
                     & _HELP_WORDS)
                for j in range(bsz)
            ], dtype=torch.bool)
            gold_mode = torch.where(
                is_greet, mode_idx['greeting'],
                torch.where(is_help, mode_idx['help'],
                            torch.full((bsz,), mode_idx['normal'], dtype=torch.long))
            )

            loss = ce(logits['intent'], gold_intent) + 0.5 * ce(logits['mode'], gold_mode)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 2.0)
            opt.step()
            total_loss += loss.item()
            nb += 1

        if ep % 10 == 0 or ep == epochs - 1:
            print(f"  pretrain {ep:4d}/{epochs} | loss={total_loss / max(nb, 1):.4f}")

    return net


# ────────────────────────────────────────────────────────────────────────
# REINFORCE Training (from train-policy.py with improvements)
# ────────────────────────────────────────────────────────────────────────

def train_reinforce(net: nn.Module, dataset: list, epochs: int = 50,
                    batch_size: int = 64, lr: float = 1e-3,
                    val_dataset: list = None,
                    replay_capacity: int = 10000,
                    replay_batch_size: int = 64,
                    entropy_start: float = 0.05,
                    entropy_end: float = 0.01,
                    entropy_anneal_epochs: int = 500,
                    value_loss_coeff: float = 0.5,
                    max_grad_norm: float = 0.5,
                    curriculum_warmup: int = 200,
                    curriculum_step: int = 200):
    """
    REINFORCE with baseline, experience replay, entropy regularization,
    curriculum learning, cosine LR scheduling, gradient clipping,
    and advantage normalization.
    """
    optimizer = torch.optim.Adam(net.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=epochs, eta_min=lr * 0.01
    )
    replay_buffer = ReplayBuffer(capacity=replay_capacity)
    diff_scheduler = DifficultyScheduler(
        max_difficulty=4,
        warmup_epochs=curriculum_warmup,
        step_epochs=curriculum_step,
    )

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
    }
    for k in REWARD_WEIGHTS:
        metrics_history[f'reward_{k}'] = []

    total_steps = 0

    for epoch in range(epochs):
        net.train()
        progress = min(1.0, epoch / max(1, entropy_anneal_epochs))
        entropy_coeff = entropy_start + (entropy_end - entropy_start) * progress

        diff_threshold = diff_scheduler.get_threshold(epoch)
        eligible_samples = [
            s for s in dataset
            if s['prompt'].get('gold_difficulty', 1) <= diff_threshold
        ]
        if not eligible_samples:
            eligible_samples = dataset

        random.shuffle(eligible_samples)

        epoch_rewards = []
        epoch_losses = []
        epoch_policy_losses = []
        epoch_value_losses = []
        epoch_entropies = []
        epoch_advantages = []
        epoch_comp_sums = {k: 0.0 for k in REWARD_WEIGHTS}
        epoch_comp_counts = 0

        # Phase 1: Collect experiences
        for batch_start in range(0, len(eligible_samples), batch_size):
            batch_samples = eligible_samples[batch_start:batch_start + batch_size]
            batch_features = torch.tensor(
                [s['features'] for s in batch_samples], dtype=torch.float32
            )

            logits, values = net(batch_features)
            actions, log_probs, entropies = net.sample_action(logits)

            for j, sample in enumerate(batch_samples):
                sample_actions = {
                    name: actions[name][j].item()
                    if actions[name].dim() > 0 else actions[name].item()
                    for name in actions
                }
                reward_total, reward_components = compute_reward(
                    sample_actions, sample['prompt'],
                    sample['features'], dataset_sample=sample
                )
                replay_buffer.store(
                    state=sample['features'],
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

            # Phase 2: Train on replay buffer mini-batches
            if len(replay_buffer) >= replay_batch_size:
                replay_samples = replay_buffer.sample(replay_batch_size)
                rb_features = torch.tensor(
                    [s['state'] for s in replay_samples], dtype=torch.float32
                )
                rb_rewards = torch.tensor(
                    [s['reward'] for s in replay_samples], dtype=torch.float32
                )
                rb_logits, rb_values = net(rb_features)

                advantages = rb_rewards - rb_values.detach()
                advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

                rb_actions = {}
                for name in net.action_names:
                    rb_actions[name] = torch.tensor(
                        [s['actions'][name] for s in replay_samples], dtype=torch.long
                    )
                rb_log_probs = net.get_log_probs(rb_logits, rb_actions)

                policy_loss = sum(
                    (-advantages * rb_log_probs[name]).mean()
                    for name in net.action_names
                )
                value_loss = F.mse_loss(rb_values, rb_rewards)
                total_entropy = net.entropy(rb_logits).mean()

                loss = (
                    policy_loss
                    + value_loss_coeff * value_loss
                    - entropy_coeff * total_entropy
                )

                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(net.parameters(), max_grad_norm)
                optimizer.step()

                epoch_losses.append(loss.item())
                epoch_policy_losses.append(policy_loss.item())
                epoch_value_losses.append(value_loss.item())
                epoch_entropies.append(total_entropy.item())
                epoch_advantages.append(advantages.mean().item())
                total_steps += 1

        scheduler.step()

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

        for k in REWARD_WEIGHTS:
            avg_comp = epoch_comp_sums[k] / max(epoch_comp_counts, 1)
            metrics_history[f'reward_{k}'].append(float(avg_comp))

        if epoch % 15 == 0 or epoch == epochs - 1:
            comp_str = " | ".join(
                f"{k}={metrics_history[f'reward_{k}'][-1]:.3f}"
                for k in ['intent_match', 'topic_precision', 'guardrail_ok']
            )
            print(
                f"[train] epoch {epoch:4d} | "
                f"reward={avg_reward:.4f} | loss={avg_loss:.4f} "
                f"(π={avg_policy_loss:.4f} v={avg_value_loss:.4f}) | "
                f"entropy={avg_entropy:.4f} coeff={entropy_coeff:.4f} | "
                f"adv={avg_advantage:.4f} | lr={current_lr:.6f} | diff≤{diff_threshold} | "
                f"buf={len(replay_buffer)}"
            )
            print(f"[train]       components: {comp_str}")

    print(f"[train] Done. Total epochs: {epochs}, total gradient steps: {total_steps}")
    return net, dict(metrics_history)


# ────────────────────────────────────────────────────────────────────────
# Discrimination Test (from train_real.py)
# ────────────────────────────────────────────────────────────────────────

def test_discrimination(net: nn.Module, dataset: list) -> bool:
    """Verify different inputs produce different outputs: ≥2 unique modes and intents."""
    _rnd = random.Random(42)
    sample = _rnd.sample(dataset, min(8, len(dataset)))

    net.eval()
    outputs = []
    with torch.no_grad():
        for s in sample:
            ft = torch.tensor(s['features'], dtype=torch.float32).unsqueeze(0)
            logits, _ = net(ft)
            mode_idx = int(logits['mode'].argmax(-1).squeeze())
            intent_idx = int(logits['intent'].argmax(-1).squeeze())
            tone_idx = int(logits['tone'].argmax(-1).squeeze())
            outputs.append({
                'prompt': s['prompt']['text'][:50],
                'gold_intent': s['prompt'].get('gold_intent', '?'),
                'mode': MODE_LABELS[mode_idx],
                'intent': ALL_INTENTS[intent_idx],
                'tone': TONE_LABELS[tone_idx],
            })

    seen_mode = set(o['mode'] for o in outputs)
    seen_intent = set(o['intent'] for o in outputs)
    print(f"\n  [discrimination] Unique modes: {len(seen_mode)}, intents: {len(seen_intent)} (from {len(outputs)} prompts)")
    for o in outputs[:6]:
        print(f"    [{o['gold_intent']:12s}] {o['prompt']:50s} → {o['mode']:10s} {o['intent']}")

    return len(seen_mode) >= 2 and len(seen_intent) >= 2


# ────────────────────────────────────────────────────────────────────────
# Golden Evaluation
# ────────────────────────────────────────────────────────────────────────

def generate_golden_test_queries(kb: list, fragment_meta: dict) -> list:
    """
    Generate golden evaluation queries across 9 buckets:
    1. Direct definitions for every topic alias
    2. Examples for every topic with example fragments
    3. Formal questions for formula-heavy topics
    4. Application questions for practical topics
    5. Comparison pairs from related topic graph
    6. Short follow-ups
    7. Topic corrections and rejections
    8. Off-topic and ambiguous queries
    9. Mobile style queries: terse, typo-heavy, punctuation-only
    """
    buckets = {}

    # Bucket 1: Direct definitions
    bucket1 = []
    for entry in kb[:20]:
        for alias in (entry.get('aliases', []) or [entry.get('name', '')])[:2]:
            bucket1.append({
                'text': f'what is {alias}',
                'gold_intent': 'definition',
                'gold_topics': [entry['id']],
                'gold_difficulty': 1,
                'gold_budget': 'short',
                'gold_mode': 'normal',
                'bucket': 'definitions',
            })
    buckets['definitions'] = bucket1

    # Bucket 2: Examples
    bucket2 = []
    for entry in kb[:15]:
        meta_entry = fragment_meta.get(entry['id'], {}) if fragment_meta else {}
        frags = meta_entry.get('fragments', {})
        if frags.get('ex'):
            alias = entry.get('aliases', [entry.get('name', '')])[0] if entry.get('aliases') else entry.get('name', '')
            bucket2.append({
                'text': f'give an example of {alias}',
                'gold_intent': 'example',
                'gold_topics': [entry['id']],
                'gold_difficulty': 1,
                'gold_budget': 'medium',
                'gold_mode': 'normal',
                'bucket': 'examples',
            })
    buckets['examples'] = bucket2

    # Bucket 3: Formal questions
    bucket3 = []
    for entry in kb[:15]:
        meta_entry = fragment_meta.get(entry['id'], {}) if fragment_meta else {}
        frags = meta_entry.get('fragments', {})
        if frags.get('form'):
            alias = entry.get('aliases', [entry.get('name', '')])[0] if entry.get('aliases') else entry.get('name', '')
            bucket3.append({
                'text': f'prove the theorem about {alias}',
                'gold_intent': 'formal',
                'gold_topics': [entry['id']],
                'gold_difficulty': 3,
                'gold_budget': 'long',
                'gold_mode': 'normal',
                'bucket': 'formal',
            })
    buckets['formal'] = bucket3

    # Bucket 4: Application questions
    bucket4 = []
    for entry in kb[:15]:
        meta_entry = fragment_meta.get(entry['id'], {}) if fragment_meta else {}
        frags = meta_entry.get('fragments', {})
        if frags.get('app'):
            alias = entry.get('aliases', [entry.get('name', '')])[0] if entry.get('aliases') else entry.get('name', '')
            bucket4.append({
                'text': f'where is {alias} used in the real world',
                'gold_intent': 'application',
                'gold_topics': [entry['id']],
                'gold_difficulty': 2,
                'gold_budget': 'long',
                'gold_mode': 'normal',
                'bucket': 'applications',
            })
    buckets['applications'] = bucket4

    # Bucket 5: Comparison pairs from related topic graph
    bucket5 = []
    for entry in kb:
        related = entry.get('related', [])
        if related:
            for rel_id in related[:2]:
                rel_entry = next((e for e in kb if e.get('id') == rel_id), None)
                if rel_entry:
                    alias1 = entry.get('aliases', [entry.get('name', '')])[0] if entry.get('aliases') else entry.get('name', '')
                    alias2 = rel_entry.get('aliases', [rel_entry.get('name', '')])[0] if rel_entry.get('aliases') else rel_entry.get('name', '')
                    bucket5.append({
                        'text': f'compare {alias1} and {alias2}',
                        'gold_intent': 'comparison',
                        'gold_topics': [entry['id'], rel_id],
                        'gold_difficulty': 3,
                        'gold_budget': 'long',
                        'gold_mode': 'comparison',
                        'bucket': 'comparisons',
                    })
            if len(bucket5) >= 15:
                break
    buckets['comparisons'] = bucket5

    # Bucket 6: Short follow-ups
    bucket6 = []
    follow_ups = ['how', 'why', 'example', 'simplify', 'summarize', 'what else', 'prove it', 'compare']
    for fu in follow_ups:
        bucket6.append({
            'text': fu,
            'gold_intent': 'example',
            'gold_topics': [],
            'gold_difficulty': 1,
            'gold_budget': 'short',
            'gold_mode': 'normal',
            'bucket': 'follow_ups',
        })
    buckets['follow_ups'] = bucket6

    # Bucket 7: Topic corrections and rejections
    bucket7 = [
        {'text': 'no, i mean the nash equilibrium', 'gold_intent': 'definition', 'gold_topics': ['nash_eq'],
         'gold_difficulty': 1, 'gold_budget': 'medium', 'gold_mode': 'normal', 'bucket': 'corrections'},
        {'text': "not that, the prisoner's dilemma", 'gold_intent': 'definition', 'gold_topics': ['prisoners_dilemma'],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'normal', 'bucket': 'corrections'},
        {'text': 'i asked about dominant strategy actually', 'gold_intent': 'formal', 'gold_topics': ['dom_strat'],
         'gold_difficulty': 1, 'gold_budget': 'medium', 'gold_mode': 'normal', 'bucket': 'corrections'},
    ]
    buckets['corrections'] = bucket7

    # Bucket 8: Off-topic and ambiguous queries
    bucket8 = [
        {'text': 'what is the weather today', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'off_topic'},
        {'text': 'tell me a joke', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'off_topic'},
        {'text': 'hmm', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'off_topic'},
        {'text': 'what?', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'off_topic'},
        {'text': 'a', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'off_topic'},
    ]
    buckets['off_topic'] = bucket8

    # Bucket 9: Mobile style queries
    bucket9 = [
        {'text': 'wat iz nash eq', 'gold_intent': 'definition', 'gold_topics': ['nash_eq'],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'normal', 'bucket': 'mobile'},
        {'text': 'prisoners dilema explain', 'gold_intent': 'definition', 'gold_topics': ['prisoners_dilemma'],
         'gold_difficulty': 1, 'gold_budget': 'medium', 'gold_mode': 'normal', 'bucket': 'mobile'},
        {'text': '??', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'mobile'},
        {'text': 'y tho', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'mobile'},
        {'text': '??????????', 'gold_intent': 'definition', 'gold_topics': [],
         'gold_difficulty': 1, 'gold_budget': 'short', 'gold_mode': 'off_topic', 'bucket': 'mobile'},
    ]
    buckets['mobile'] = bucket9

    all_queries = []
    for bucket_name, queries in buckets.items():
        for q in queries:
            q['bucket'] = bucket_name
            all_queries.append(q)

    print(f"[golden] Generated {len(all_queries)} golden test queries across {len(buckets)} buckets")
    return all_queries


def run_golden_evaluation(net: nn.Module, golden_queries: list,
                          fragment_meta: dict = None) -> dict:
    """Evaluate the trained model on golden test queries and produce a confusion matrix."""
    net.eval()
    intent_idx = {v: i for i, v in enumerate(ALL_INTENTS)}
    mode_idx = {v: i for i, v in enumerate(MODE_LABELS)}
    budget_labels = ['short', 'medium', 'long']

    # Confusion matrix tracking
    intent_cm = defaultdict(lambda: defaultdict(int))  # gold → pred
    mode_cm = defaultdict(lambda: defaultdict(int))
    budget_cm = defaultdict(lambda: defaultdict(int))

    total = len(golden_queries)
    passed = 0
    failed = 0
    regressions = 0
    results = []

    # Accuracy accumulators
    intent_correct = 0
    mode_correct = 0
    budget_correct = 0

    with torch.no_grad():
        for q in golden_queries:
            feat = build_features(q['text'], fragment_meta=fragment_meta,
                                   topic_ids=q.get('gold_topics', []))
            ft = torch.tensor(feat, dtype=torch.float32).unsqueeze(0)
            logits, _ = net(ft)

            pred_intent_idx = int(logits['intent'].argmax(-1).squeeze())
            pred_mode_idx = int(logits['mode'].argmax(-1).squeeze())
            pred_topic_count = int(logits['topic_count'].argmax(-1).squeeze()) + 1

            pred_intent = ALL_INTENTS[pred_intent_idx]
            pred_mode = MODE_LABELS[pred_mode_idx]
            gold_intent = q.get('gold_intent', 'definition')
            gold_mode = q.get('gold_mode', 'normal')
            gold_budget = q.get('gold_budget', 'medium')

            # Predict budget from intent + topic count
            if pred_intent in ('definition', 'example'):
                pred_budget = 'short' if pred_topic_count <= 1 else 'medium'
            elif pred_intent == 'formal':
                pred_budget = 'long' if pred_topic_count >= 2 else 'medium'
            else:
                pred_budget = 'long'

            intent_match = pred_intent == gold_intent
            mode_match = pred_mode == gold_mode
            budget_match = pred_budget == gold_budget

            # Update confusion matrices
            intent_cm[gold_intent][pred_intent] += 1
            mode_cm[gold_mode][pred_mode] += 1
            budget_cm[gold_budget][pred_budget] += 1

            if intent_match:
                intent_correct += 1
            if mode_match:
                mode_correct += 1
            if budget_match:
                budget_correct += 1

            passed_test = intent_match and mode_match
            if passed_test:
                passed += 1
            else:
                failed += 1

            results.append({
                'query': q['text'],
                'bucket': q.get('bucket', 'unknown'),
                'gold_intent': gold_intent,
                'pred_intent': pred_intent,
                'gold_mode': gold_mode,
                'pred_mode': pred_mode,
                'gold_budget': gold_budget,
                'pred_budget': pred_budget,
                'intent_match': intent_match,
                'mode_match': mode_match,
                'budget_match': budget_match,
                'passed': passed_test,
            })

    eval_scores = {
        'modeAccuracy': round(mode_correct / total, 4) if total > 0 else 0,
        'intentAccuracy': round(intent_correct / total, 4) if total > 0 else 0,
        'topicPrecision': 0.0,  # would require actual topic ranking, placeholder
        'budgetAccuracy': round(budget_correct / total, 4) if total > 0 else 0,
        'diagramAccuracy': 0.0,  # placeholder for future diagram classification
        'followUpContinuity': 0.0,  # placeholder
    }

    # Build confusion matrix serializable
    confusion_matrix = {
        'intent': {gold: dict(pred) for gold, pred in intent_cm.items()},
        'mode': {gold: dict(pred) for gold, pred in mode_cm.items()},
        'budget': {gold: dict(pred) for gold, pred in budget_cm.items()},
    }

    # Per-bucket summary
    bucket_summary = defaultdict(lambda: {'total': 0, 'passed': 0})
    for r in results:
        b = r['bucket']
        bucket_summary[b]['total'] += 1
        if r['passed']:
            bucket_summary[b]['passed'] += 1

    golden_tests = {
        'total': total,
        'passed': passed,
        'failed': failed,
        'regressions': regressions,
        'buckets': {b: {'total': s['total'], 'passed': s['passed'],
                         'accuracy': round(s['passed'] / max(s['total'], 1), 4)}
                     for b, s in bucket_summary.items()},
    }

    print(f"\n[golden] Evaluation complete: {passed}/{total} passed, {failed} failed")
    print(f"  Intent accuracy:  {eval_scores['intentAccuracy']:.3f}")
    print(f"  Mode accuracy:    {eval_scores['modeAccuracy']:.3f}")
    print(f"  Budget accuracy:  {eval_scores['budgetAccuracy']:.3f}")

    return {
        'eval_scores': eval_scores,
        'golden_tests': golden_tests,
        'confusion_matrix': confusion_matrix,
        'results': results,
    }


def check_regression(eval_scores: dict, previous_best_path: str = None,
                     thresholds: dict = None) -> dict:
    """Check if any accuracy metric dropped below threshold."""
    if thresholds is None:
        thresholds = {
            'modeAccuracy': 0.15,
            'intentAccuracy': 0.15,
            'topicPrecision': 0.15,
            'budgetAccuracy': 0.15,
            'diagramAccuracy': 0.15,
        }

    regressions = []
    if previous_best_path and Path(previous_best_path).exists():
        try:
            prev = json.loads(Path(previous_best_path).read_text())
            prev_scores = prev.get('evalScores', {})
            for key, threshold in thresholds.items():
                prev_val = prev_scores.get(key, 0)
                curr_val = eval_scores.get(key, 0)
                if curr_val < prev_val - threshold:
                    regressions.append({
                        'metric': key,
                        'previous': prev_val,
                        'current': curr_val,
                        'delta': curr_val - prev_val,
                        'threshold': threshold,
                    })
        except Exception as e:
            print(f"[regression] Could not load previous best: {e}")

    has_regression = len(regressions) > 0
    if has_regression:
        print(f"\n[regression] FAIL: {len(regressions)} metric(s) dropped below threshold:")
        for r in regressions:
            print(f"  {r['metric']}: {r['previous']:.4f} → {r['current']:.4f} (Δ={r['delta']:.4f}, limit -{r['threshold']:.4f})")
    else:
        print(f"\n[regression] PASS: No metrics dropped below thresholds")

    return {
        'has_regression': has_regression,
        'regressions': regressions,
        'thresholds': thresholds,
    }


# ────────────────────────────────────────────────────────────────────────
# Artifact Export
# ────────────────────────────────────────────────────────────────────────

def compute_dataset_hash(dataset: list) -> str:
    """Compute SHA-256 of sorted prompt texts."""
    texts = sorted(s['prompt'].get('text', '') for s in dataset)
    h = hashlib.sha256('|'.join(texts).encode('utf-8')).hexdigest()
    return f"sha256:{h}"


def compute_kb_hash(kb: list) -> str:
    ids = sorted(e.get('id', '') for e in kb)
    h = hashlib.sha256('|'.join(ids).encode('utf-8')).hexdigest()
    return f"sha256:{h}"


def export_weights_binary(net: nn.Module, path: str):
    """Export all Linear layer weights as Float32 binary blob."""
    state = net.state_dict()
    arrays = []
    for name in ['fc1.weight', 'fc1.bias', 'fc2.weight', 'fc2.bias']:
        arrays.append(state[name].cpu().numpy().ravel())
    for head_name in net.action_names:
        arrays.append(state[f'heads.{head_name}.weight'].cpu().numpy().ravel())
        arrays.append(state[f'heads.{head_name}.bias'].cpu().numpy().ravel())
    blob = np.concatenate(arrays).astype(np.float32).tobytes()
    Path(path).write_bytes(blob)
    print(f"[export] Binary weights saved: {path} ({len(blob)} bytes)")

    h = hashlib.sha256(blob).hexdigest()
    return f"sha256:{h}", len(blob)


def export_all_artifacts(net: nn.Module, dataset: list, metrics: dict,
                         eval_result: dict, regression_result: dict,
                         config: dict, output_dir: str, bot_name: str,
                         fragment_meta: dict, kb: list):
    """Export all required artifacts to the output directory."""
    os.makedirs(output_dir, exist_ok=True)

    # config.json
    config_path = os.path.join(output_dir, 'config.json')
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    print(f"[export] {config_path}")

    # dataset-summary.json
    intent_counts = defaultdict(int)
    budget_counts = defaultdict(int)
    for s in dataset:
        intent_counts[s['prompt'].get('gold_intent', 'unknown')] += 1
        budget_counts[s['prompt'].get('gold_budget', 'medium')] += 1
    dataset_summary = {
        'total_samples': len(dataset),
        'intent_distribution': dict(intent_counts),
        'budget_distribution': dict(budget_counts),
        'feature_dim': N_FEATURES,
        'has_fragment_meta': len(fragment_meta) > 0,
        'kb_topics': len(kb),
    }
    summary_path = os.path.join(output_dir, 'dataset-summary.json')
    with open(summary_path, 'w') as f:
        json.dump(dataset_summary, f, indent=2)
    print(f"[export] {summary_path}")

    # train-metrics.jsonl
    metrics_path = os.path.join(output_dir, 'train-metrics.jsonl')
    with open(metrics_path, 'w') as f:
        for metric_name in metrics:
            f.write(json.dumps({'metric': metric_name, 'values': metrics[metric_name]}) + '\n')
    print(f"[export] {metrics_path}")

    # validation-report.json
    val_report = {
        'bot': bot_name,
        'trained_at': datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        'eval_scores': eval_result['eval_scores'],
        'golden_tests': eval_result['golden_tests'],
        'regression_check': regression_result,
        'discrimination_passed': config.get('discrimination_passed', False),
    }
    val_path = os.path.join(output_dir, 'validation-report.json')
    with open(val_path, 'w') as f:
        json.dump(val_report, f, indent=2)
    print(f"[export] {val_path}")

    # confusion-matrix.json
    cm_path = os.path.join(output_dir, 'confusion-matrix.json')
    with open(cm_path, 'w') as f:
        json.dump(eval_result['confusion_matrix'], f, indent=2)
    print(f"[export] {cm_path}")

    # policy.weights.json (MLP weights)
    weights_json_path = os.path.join(output_dir, 'policy.weights.json')
    net.save_weights_json(weights_json_path)

    # policy.weights.bin (Float32 binary)
    weights_bin_path = os.path.join(output_dir, 'policy.weights.bin')
    model_hash, weights_bin_size = export_weights_binary(net, weights_bin_path)

    # policy.manifest.json
    dataset_hash = compute_dataset_hash(dataset)
    kb_hash = compute_kb_hash(kb)
    total_params = sum(p.numel() for p in net.parameters())

    manifest = {
        'version': VERSION,
        'featureSchemaVersion': FEATURE_SCHEMA_VERSION,
        'inputFeatures': N_FEATURES,
        'hiddenLayers': [128, 64],
        'actionHeads': 6,
        'rewardWeights': dict(REWARD_WEIGHTS),
        'datasetHash': dataset_hash,
        'kbHash': kb_hash,
        'modelHash': model_hash,
        'evalScores': eval_result['eval_scores'],
        'goldenTests': eval_result['golden_tests'],
        'trainedAt': datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        'botProfiles': [bot_name],
        'architecture': {
            'trunk': '25→128→64 (ReLU + LayerNorm + Dropout)',
            'totalParams': total_params,
            'heads': {name: size for name, size in ACTION_SIZES_ORDERED},
        },
    }
    manifest_path = os.path.join(output_dir, 'policy.manifest.json')
    with open(manifest_path, 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f"[export] {manifest_path}")

    # eval.html — human-readable evaluation report
    html_path = os.path.join(output_dir, 'eval.html')
    generate_eval_html(eval_result, regression_result, dataset_summary,
                        manifest, bot_name, html_path)
    print(f"[export] {html_path}")

    return manifest_path


def generate_eval_html(eval_result: dict, regression_result: dict,
                       dataset_summary: dict, manifest: dict,
                       bot_name: str, output_path: str):
    """Generate a human-readable evaluation report HTML."""
    scores = eval_result['eval_scores']
    golden = eval_result['golden_tests']
    reg = regression_result
    buckets = golden.get('buckets', {})

    bucket_rows = ''
    for bname, bdata in sorted(buckets.items()):
        acc = bdata.get('accuracy', 0)
        color = '#4caf50' if acc >= 0.8 else ('#ff9800' if acc >= 0.5 else '#f44336')
        bucket_rows += f'''<tr>
            <td>{bname}</td>
            <td>{bdata['total']}</td>
            <td>{bdata['passed']}</td>
            <td style="color:{color};font-weight:bold">{acc:.2%}</td>
        </tr>'''

    reg_status = 'PASS' if not reg.get('has_regression') else 'FAIL'
    reg_color = '#4caf50' if reg_status == 'PASS' else '#f44336'

    reg_rows = ''
    for r in reg.get('regressions', []):
        reg_rows += f'''<tr>
            <td>{r['metric']}</td>
            <td>{r['previous']:.4f}</td>
            <td>{r['current']:.4f}</td>
            <td style="color:#f44336">{r['delta']:+.4f}</td>
        </tr>'''

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Policy Training Evaluation — {bot_name}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #333; }}
  h1 {{ color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 0.5rem; }}
  h2 {{ color: #444; margin-top: 2rem; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
  th, td {{ border: 1px solid #ddd; padding: 8px 12px; text-align: left; }}
  th {{ background: #f5f5f5; }}
  .pass {{ color: #4caf50; font-weight: bold; }}
  .fail {{ color: #f44336; font-weight: bold; }}
  .meta {{ color: #666; font-size: 0.9em; }}
  .score-card {{ display: inline-block; margin: 0.5rem 1rem; text-align: center; }}
  .score-value {{ font-size: 2rem; font-weight: bold; }}
</style>
</head>
<body>
<h1>Policy Training Evaluation</h1>
<p class="meta">Bot: {bot_name} | Version: {manifest.get('version', '?')} |
   Trained: {manifest.get('trainedAt', '?')}</p>

<h2>Overall Scores</h2>
<div>
  <div class="score-card">
    <div class="score-value" style="color:{'#4caf50' if scores.get('modeAccuracy', 0) >= 0.7 else '#ff9800'}">{scores.get('modeAccuracy', 0):.1%}</div>
    <div>Mode Accuracy</div>
  </div>
  <div class="score-card">
    <div class="score-value" style="color:{'#4caf50' if scores.get('intentAccuracy', 0) >= 0.7 else '#ff9800'}">{scores.get('intentAccuracy', 0):.1%}</div>
    <div>Intent Accuracy</div>
  </div>
  <div class="score-card">
    <div class="score-value" style="color:{'#4caf50' if scores.get('budgetAccuracy', 0) >= 0.7 else '#ff9800'}">{scores.get('budgetAccuracy', 0):.1%}</div>
    <div>Budget Accuracy</div>
  </div>
</div>

<h2>Golden Tests</h2>
<table>
  <tr><th>Bucket</th><th>Total</th><th>Passed</th><th>Accuracy</th></tr>
  {bucket_rows}
</table>
<p>Total: {golden['total']}, Passed: {golden['passed']}, Failed: {golden['failed']}, Regressions: {golden['regressions']}</p>

<h2>Regression Check</h2>
<table>
  <tr><th>Metric</th><th>Previous</th><th>Current</th><th>Delta</th></tr>
  {reg_rows if reg_rows else '<tr><td colspan="4">No regressions detected</td></tr>'}
</table>
<p>Status: <span class="{'pass' if reg_status == 'PASS' else 'fail'}">{reg_status}</span></p>

<h2>Dataset Summary</h2>
<table>
  <tr><th>Total Samples</th><td>{dataset_summary.get('total_samples', '?')}</td></tr>
  <tr><th>Feature Dimension</th><td>{dataset_summary.get('feature_dim', '?')}</td></tr>
  <tr><th>KB Topics</th><td>{dataset_summary.get('kb_topics', '?')}</td></tr>
  <tr><th>Fragment Meta</th><td>{'Yes' if dataset_summary.get('has_fragment_meta') else 'No'}</td></tr>
</table>

<h2>Intent Distribution</h2>
<table>
  <tr><th>Intent</th><th>Count</th></tr>
  {''.join(f'<tr><td>{k}</td><td>{v}</td></tr>' for k, v in sorted(dataset_summary.get('intent_distribution', {}).items()))}
</table>

<p class="meta">Generated by train-policy-unified.py v{VERSION}</p>
</body>
</html>'''

    Path(output_path).write_text(html)


# ────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="ReLU.chat Unified Policy Training Pipeline"
    )
    parser.add_argument('--bot', type=str, default='game-theory',
                        help='Bot profile to train for, or "all"')
    parser.add_argument('--epochs', type=int, default=50,
                        help='Number of REINFORCE training epochs')
    parser.add_argument('--pretrain-epochs', type=int, default=25,
                        help='Number of supervised pretraining epochs')
    parser.add_argument('--output', type=str, default='dev/exports/policy-runs',
                        help='Output root directory for policy artifacts')
    parser.add_argument('--seed', type=int, default=42,
                        help='Random seed for reproducibility')
    parser.add_argument('--val-split', type=float, default=0.15,
                        help='Fraction of dataset for validation')
    parser.add_argument('--no-follow-ups', action='store_true',
                        help='Disable follow-up query generation')
    parser.add_argument('--no-pretrain', action='store_true',
                        help='Skip supervised pretraining phase')
    parser.add_argument('--no-golden', action='store_true',
                        help='Skip golden evaluation')
    parser.add_argument('--previous-best', type=str, default=None,
                        help='Path to previous policy.manifest.json for regression check')
    parser.add_argument('--regression-threshold', type=float, default=0.15,
                        help='Max allowed accuracy drop for regression check')
    parser.add_argument('--replay-capacity', type=int, default=10000)
    parser.add_argument('--replay-batch-size', type=int, default=64)
    parser.add_argument('--entropy-start', type=float, default=0.05)
    parser.add_argument('--entropy-end', type=float, default=0.01)
    parser.add_argument('--curriculum-warmup', type=int, default=200)
    args = parser.parse_args()

    set_seed(args.seed)

    bots = BOT_PROFILES if args.bot == 'all' else [args.bot]

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H")
    run_root = Path(args.output) / timestamp

    print("=" * 60)
    print("ReLU.chat Unified Policy Training Pipeline")
    print(f"  Version:        {VERSION}")
    print(f"  Bot(s):         {', '.join(bots)}")
    print(f"  Epochs:         {args.epochs}")
    print(f"  Pretrain:       {args.pretrain_epochs} epochs ({'OFF' if args.no_pretrain else 'ON'})")
    print(f"  Output:         {run_root}")
    print(f"  Seed:           {args.seed}")
    print(f"  Golden eval:    {'OFF' if args.no_golden else 'ON'}")
    print("=" * 60)

    for bot_name in bots:
        print(f"\n{'─' * 50}")
        print(f"  Bot: {bot_name}")
        print(f"{'─' * 50}")

        out_dir = run_root / bot_name

        kb = load_bot_kb(bot_name)
        fmeta = load_fragment_meta(bot_name)

        prompts = generate_prompts(kb, fmeta, max_n=800)
        print(f"[prompts] Generated {len(prompts)} (meta keys: {len(fmeta)})")

        if not args.no_follow_ups:
            fu_pairs = generate_follow_up_pairs(prompts, n_pairs=min(500, len(prompts)))
            fu_prompts = [pair['follow_up'] for pair in fu_pairs]
            initial_of_pairs = [pair['initial'] for pair in fu_pairs]
            all_texts = {p['text'] for p in prompts}
            for p in initial_of_pairs:
                if p['text'] not in all_texts:
                    prompts.append(p)
                    all_texts.add(p['text'])
            for p in fu_prompts:
                if p['text'] not in all_texts:
                    prompts.append(p)
                    all_texts.add(p['text'])
            print(f"[prompts] Total with follow-ups: {len(prompts)}")

        dataset = build_dataset(prompts, fmeta)
        avg_gold_fc = sum(p.get('gold_frag_count', 2) for p in prompts) / max(1, len(prompts))
        print(f"[dataset] Ready. Samples: {len(dataset)}, avg gold_frag_count: {avg_gold_fc:.2f}")

        # Train/val split
        if len(dataset) < 2:
            train_dataset, val_dataset = dataset, []
        else:
            random.shuffle(dataset)
            split_idx = int(len(dataset) * (1 - args.val_split))
            split_idx = max(1, min(split_idx, len(dataset) - 1))
            train_dataset, val_dataset = dataset[:split_idx], dataset[split_idx:]
        print(f"[dataset] Train: {len(train_dataset)}, Val: {len(val_dataset)}")

        # Initialize network
        net = PolicyNetwork()
        total_params = sum(p.numel() for p in net.parameters())
        print(f"[model] Initialized. Params: {total_params}")

        # Supervised pretraining
        if not args.no_pretrain:
            print(f"\n[pretrain] Supervised pretraining ({args.pretrain_epochs} epochs)...")
            net = pretrain(net, train_dataset, epochs=args.pretrain_epochs)

        # REINFORCE training
        print(f"\n[train] REINFORCE training ({args.epochs} epochs)...")
        net, metrics = train_reinforce(
            net, train_dataset,
            epochs=args.epochs,
            lr=1e-3,
            val_dataset=val_dataset,
            replay_capacity=args.replay_capacity,
            replay_batch_size=args.replay_batch_size,
            entropy_start=args.entropy_start,
            entropy_end=args.entropy_end,
            curriculum_warmup=args.curriculum_warmup,
        )

        # Discrimination test (anti-collapse)
        print(f"\n[discrimination] Running discrimination test...")
        disc_ok = test_discrimination(net, dataset)
        if not disc_ok:
            print("  WARNING: Model may have collapsed — <2 unique modes or intents detected")
        else:
            print("  PASS: Model produces diverse outputs")

        # Golden evaluation
        eval_result = {'eval_scores': {}, 'golden_tests': {}, 'confusion_matrix': {}}
        regression_result = {'has_regression': False, 'regressions': [], 'thresholds': {}}

        if not args.no_golden:
            print(f"\n[golden] Running golden evaluation...")
            golden_queries = generate_golden_test_queries(kb, fmeta)
            eval_result = run_golden_evaluation(net, golden_queries, fmeta)

            thresholds = {k: args.regression_threshold
                          for k in ['modeAccuracy', 'intentAccuracy', 'topicPrecision',
                                     'budgetAccuracy', 'diagramAccuracy']}
            regression_result = check_regression(
                eval_result['eval_scores'],
                previous_best_path=args.previous_best,
                thresholds=thresholds,
            )

        # Export all artifacts
        config = {
            'version': VERSION,
            'bot': bot_name,
            'seed': args.seed,
            'pretrain_epochs': args.pretrain_epochs if not args.no_pretrain else 0,
            'reinforce_epochs': args.epochs,
            'replay_capacity': args.replay_capacity,
            'replay_batch_size': args.replay_batch_size,
            'entropy_start': args.entropy_start,
            'entropy_end': args.entropy_end,
            'curriculum_warmup': args.curriculum_warmup,
            'val_split': args.val_split,
            'reward_weights': dict(REWARD_WEIGHTS),
            'discrimination_passed': disc_ok,
            'architecture': {
                'inputFeatures': N_FEATURES,
                'hiddenLayers': [128, 64],
                'actionHeads': 6,
                'totalParams': total_params,
            },
        }

        print(f"\n[export] Writing artifacts to {out_dir}...")
        manifest_path = export_all_artifacts(
            net, dataset, metrics, eval_result, regression_result,
            config, str(out_dir), bot_name, fmeta, kb
        )

        print(f"\n{'─' * 50}")
        print(f"  {bot_name} complete. Artifacts: {out_dir}/")
        print(f"  Manifest: {manifest_path}")

    print(f"\n{'=' * 60}")
    print(f"Pipeline complete for {len(bots)} bot(s).")
    print(f"Output root: {run_root}/")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
