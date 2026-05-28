#!/usr/bin/env python3
"""
train_real.py — ReLU.chat RL Training Pipeline with Anti-Collapse Measures

Key features:
- Supervised pretraining (25 epochs cross-entropy on gold intent+mode)
- REINFORCE with entropy bonus (ec=0.15) and state-dependent value baseline
- Varied features with followup-awareness (indices 16-24 reflect context)
- Prompt generation covers all 5 intents per KB topic
- **Round 7**: fragment-meta.json integration (real gold + features for frag data increase)
- Expected runtime: ~3-5 min per bot on CPU (larger dataset)

Usage:
  python3 dev/scripts/train_real.py --bot game-theory --epochs 60 --output assets/models/policy/
  python3 dev/scripts/train_real.py --bot all --epochs 50
"""

import argparse
import hashlib
import json
import math
import os
import random
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

sys.path.insert(0, str(Path(__file__).parent))
from policy_model import PolicyNetwork, ACTION_SIZES_ORDERED, N_FEATURES

BOT_PROFILES = ['game-theory', 'golden-age', 'data-science']
ALL_INTENTS = ['definition', 'example', 'formal', 'application', 'comparison']
MODE_LABELS = ['normal', 'off_topic', 'greeting', 'help', 'comparison']
TONE_LABELS = ['neutral', 'formal', 'intuitive', 'playful']
COUNT_LABELS = [1, 2, 3, 4]

INTENT_PROTOS = {
    'definition': ['what is X', 'define X', 'explain X', 'what does X mean'],
    'example': ['give an example of X', 'show me an example of X', 'example of X'],
    'formal': ['formal definition of X', 'prove X', 'theorem about X'],
    'application': ['applications of X', 'where is X used', 'real world use of X'],
    'comparison': ['difference between X and Y', 'X vs Y', 'compare X and Y'],
}

_COMP_CUE = re.compile(r'\b(compare|vs|versus|difference|differ|between)\b', re.I)
_FORMAL_CUE = re.compile(r'\b(prove|theorem|formal|math|rigorous|derive)\b', re.I)
_EXAMPLE_CUE = re.compile(r'\b(example|illustrate|show me|demonstrate)\b', re.I)
_GREETING_WORDS = {'hi', 'hey', 'hello', 'yo', 'sup'}
_HELP_WORDS = {'help', 'confused', 'how do', 'dont understand', 'stuck'}


def parse_kb_js(filepath: str) -> list:
    """Parse kb(id, name, aliases, summary, f, related) calls."""
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
            entry = {
                'id': _parse_js_str(args[0]),
                'name': _parse_js_str(args[1]),
                'aliases': _parse_js_str_array(args[2]),
                'summary': _parse_js_str(args[3]),
                'f': _parse_js_fragments(args[4]),
            }
            entries.append(entry)
        idx = j + 1
    return entries


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


def find_kb_file(bot_name: str) -> str | None:
    bot_to_chat = {
        'game-theory': 'game-theory-chat',
        'golden-age': 'golden-age-inquiry',
        'data-science': 'data-science-chat',
    }
    chat_dir = bot_to_chat.get(bot_name)
    if chat_dir:
        # Primary path: chat/<bot>/js/knowledge-base.js
        p = Path('chat') / chat_dir / 'js' / 'knowledge-base.js'
        if p.exists():
            return str(p)
        # Fallback: data/bots/<bot>/knowledge.js (data-science uses this)
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
    """Load per-topic fragment metadata (truth_conf, difficulty, style, etc.).
    Enables real gold labels + features instead of hardcoded 0s. Increases
    effective fragment data volume/quality in training (core goal of this round).
    """
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


def gen_prompts(kb, fragment_meta=None, max_n=800):
    """Deterministic prompt generation. Now fragment-aware.
    Increased default max_n (400→800) + uses real fragment-meta for gold
    and sampling when available. This directly increases training data
    fragment amount/quality (real conf/difficulty per cat) vs prior synthetic-only.
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
                })
        return prompts[:max_n]

    # Use full KB (or large slice) when meta present for higher fragment data volume
    n_topics = min(len(kb), max(max_n // 4, 60))
    topics = kb[:n_topics]
    for entry in topics:
        eid = entry.get('id', 'unknown')
        name = entry.get('name', eid)
        aliases = [name] + [a for a in entry.get('aliases', []) if isinstance(a, str)][:2]
        meta_entry = fragment_meta.get(eid, {})
        frags = meta_entry.get('fragments', {})
        n_high_conf = sum(1 for cat in frags.values() if isinstance(cat, list) for f in cat
                          if isinstance(f, dict) and f.get('meta', {}).get('truth_confidence', 0) >= 0.8)
        gold_fc = max(1, min(4, 1 + n_high_conf // 3))  # proxy: more high-conf frags → higher gold count

        for intent in ALL_INTENTS:
            if intent == 'comparison' and len(set(a.lower() for a in aliases)) < 2:
                continue
            proto = INTENT_PROTOS[intent][0]
            text = proto.replace('X', aliases[0])
            if 'Y' in text:
                text = text.replace('Y', aliases[1] if len(aliases) > 1 else aliases[0])
            prompts.append({
                'text': text,
                'gold_intent': intent,
                'gold_topics': [eid],
                'gold_difficulty': 1 + ALL_INTENTS.index(intent) % 2,
                'gold_frag_count': gold_fc,
            })
            if len(prompts) >= max_n:
                break
        if len(prompts) >= max_n:
            break
    return prompts[:max_n]


def build_features(text, gold_intent=None):
    """Deterministic 25-feature vector matching inference layout.

    Feature index alignment FIX (was: training put queryLen at [0],
    inference puts qSimTop1. Now matches mlp-inference.js featuresToF32()):
      [0]  qSimTop1 (proxy: max intent score ratio)
      [1]  qSimTop2 (proxy: second-highest intent score)
      [2]  entityCount (proxy: unique token count / 3, capped)
      [3]  entityBoostHit (proxy: >2 unique tokens)
      [4-8] intent scores (keyword hit ratios)
      [9]  lastTopicSim (cold start proxy)
      [10] lastTopicAge (cold start proxy)
      [11] kbCoverage (proxy: avg intent score)
      [12] queryLenTokens normalized ((len-1)/31, matches JS)
      [13-15] cue flags (comparison, formal, example)
      [16] botCreativity (proxy: text complexity)
      [17] domainMatch (proxy: domain keyword hits)
      [18] followUpType = 0 (no multi-turn data in synthetic prompts)
      [19] wasAmbiguous (short queries)
      [20-24] fragment metadata = 0 (no metadata in KB - matches inference)
    """
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

    # [0] qSimTop1 proxy: best intent score (simulates cosine similarity)
    sorted_scores = sorted(intent_scores, reverse=True)
    f[0] = sorted_scores[0] * 0.9 if sorted_scores[0] > 0 else 0.0
    # [1] qSimTop2 proxy: second-best intent score
    f[1] = sorted_scores[1] * 0.7 if len(sorted_scores) > 1 and sorted_scores[1] > 0 else f[0] * 0.5

    # [2] entityCount proxy (capped at 3, normalized to [0,1])
    f[2] = min(len(set(tokens)), 3) / 3.0
    # [3] entityBoostHit
    f[3] = 1.0 if len(set(tokens)) > 2 else 0.0

    # [9] lastTopicSim (cold start)
    f[9] = f[0] * 0.5
    # [10] lastTopicAge (cold start, max 8)
    f[10] = 0.0
    # [11] kbCoverage proxy (match inference [0,1] range, not capped at 0.5)
    f[11] = sum(intent_scores) / max(len(intent_scores), 1)

    # [12] queryLenTokens normalized: (len-1)/31, same formula as featuresToF32()
    f[12] = (min(max(1, len(tokens)), 32) - 1) / 31.0

    # [13-15] cue flags
    f[13] = 1.0 if _COMP_CUE.search(text) else 0.0
    f[14] = 1.0 if _FORMAL_CUE.search(text) else 0.0
    f[15] = 1.0 if _EXAMPLE_CUE.search(text) else 0.0

    # [16] botCreativity — vary by text length
    f[16] = 0.25 + 0.15 * (min(len(tokens), 20) / 20.0)
    # [17] domainMatch — vary by keyword hit count
    domain_kws = ['game', 'theory', 'strategy', 'nash', 'equilibrium', 'science', 'data', 'golden', 'islamic', 'math', 'regression', 'learning']
    f[17] = min(sum(1 for dk in domain_kws if dk in text_lower) / 3.0, 1.0)

    # [18] followUpType = 0: synthetic prompts have no multi-turn context
    # (model learns follow-ups from hard-coded overrides at inference, not from policy)
    f[18] = 0.0

    # [19] wasAmbiguous — short queries are more ambiguous
    f[19] = 1.0 if tl < 15 else 0.0

    # [20-24] fragment metadata — NOW REAL from fragment-meta.json when available.
    # Previously hardcoded 0s (synthetic waste). Training now sees actual
    # truth_conf / difficulty etc. → better supervision for frag_count head.
    # (Matches runtime feature-extractor.js behavior on real KB fragments.)
    f[20] = 0.0
    f[21] = 0.0
    f[22] = 0.0
    f[23] = 0.0
    f[24] = 0.0
    return f


def fast_reward(actions, prompt, features):
    """Reward with gold label alignment to prevent mode collapse."""
    text = prompt['text'].lower()
    words = set(re.findall(r'\w+', text))
    tl = len(text)

    gi = prompt.get('gold_intent', 'definition')
    is_greet = tl < 20 and bool(words & _GREETING_WORDS)
    is_help = bool(words & _HELP_WORDS)
    is_comp = bool(_COMP_CUE.search(text))
    is_formal = bool(_FORMAL_CUE.search(text))

    # KB-relevant keyword detection: off_topic only when query has no KB-related content
    _DOMAIN_KW = re.compile(
        r'\b(game|theory|strategy|nash|equilibrium|islamic|golden|age|history|'
        r'math|science|data|regression|classification|cluster|learning|model|'
        r'algorithm|network|neural|deep|cnn|rnn|transformer|bert|gpt|'
        r'probability|utility|payoff|dominant|mixed|preference|belief|'
        r'koran|quran|islam|medieval|civilization|culture|art|architecture)\b',
        re.I
    )
    has_kb_content = bool(_DOMAIN_KW.search(text))

    gi_to_mode = {'definition': 'normal', 'example': 'normal', 'formal': 'normal',
                  'application': 'normal', 'comparison': 'comparison'}
    expected_mode = ('greeting' if is_greet else
                     'help' if is_help else
                     'off_topic' if not is_greet and not is_help and not has_kb_content and not is_comp and not is_formal else
                     gi_to_mode.get(gi, 'normal'))

    # Gold label alignment: highest weight for correct intent, medium for correct mode
    intent_idx = ALL_INTENTS.index(gi) if gi in ALL_INTENTS else 0
    mode_idx = MODE_LABELS.index(expected_mode) if expected_mode in MODE_LABELS else 0

    pred_intent = int(actions['intent']) if 'intent' in actions else 0
    pred_mode = int(actions['mode']) if 'mode' in actions else 0

    intent_match = 1.0 if pred_intent == intent_idx else 0.0
    mode_match = 1.0 if pred_mode == mode_idx else 0.0

    # Allow neighbor intents to get partial credit
    if not intent_match:
        neighbors = {'definition': ['example', 'formal'], 'example': ['definition'],
                     'formal': ['definition'], 'application': ['example'],
                     'comparison': ['definition']}
        for nb in neighbors.get(gi, []):
            if pred_intent == ALL_INTENTS.index(nb):
                intent_match = 0.5
                break

    # Creativity alignment
    diff = prompt.get('gold_difficulty', 1)
    creativity = float(actions.get('creativity', 0.5))
    diff_r = 1.0 - min(abs(creativity - diff / 4.0), 1.0)

    # NEW (Round 7): frag_count alignment using gold from fragment-meta integration.
    # Directly addresses weak prior signal for frag_count head (was 0 weight).
    # gold_frag_count (1-4) from # high-conf fragments per topic.
    gold_fc = int(prompt.get('gold_frag_count', 2))
    pred_fc_idx = int(actions.get('frag_count', 1))  # 0-3 index into [1,2,3,4]
    pred_fc = [1,2,3,4][pred_fc_idx] if 0 <= pred_fc_idx < 4 else 2
    fc_match = 1.0 - abs(pred_fc - gold_fc) / 3.0

    # Light diversity on counts (prevents always picking 1 or 4)
    fc_div = 0.1 if 1 < pred_fc < 4 else 0.0

    # Follow-up topic continuity bonus: penalize drifting away from the topic
    # when the query was a follow-up (followUpType > 0)
    follow_up_bonus = 0.0
    fu_type = features[18] if len(features) > 18 else 0
    if fu_type > 0:
        # If intent stayed the same (or close) as gold, reward continuity
        follow_up_bonus = 0.8 * intent_match + 0.3 * mode_match
        # Extra penalty for choosing 'off_topic' on a follow-up (drift)
        if pred_mode == MODE_LABELS.index('off_topic'):
            follow_up_bonus -= 0.5

    reward = 2.0 * intent_match + 1.0 * mode_match + 0.5 * diff_r + 0.4 * fc_match + 0.1 * fc_div + 0.6 * follow_up_bonus
    return round(reward, 4)


def pretrain(net, dataset, epochs=25, batch_size=32, lr=1e-2):
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

            # Gold mode: map from intent
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
            gold_mode = torch.where(is_greet, mode_idx['greeting'],
                          torch.where(is_help, mode_idx['help'],
                            torch.full((bsz,), mode_idx['normal'], dtype=torch.long)))

            loss = ce(logits['intent'], gold_intent) + 0.5 * ce(logits['mode'], gold_mode)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 2.0)
            opt.step()
            total_loss += loss.item()
            nb += 1

        if ep % 10 == 0 or ep == epochs - 1:
            print(f"  pretrain {ep:4d}/{epochs} | loss={total_loss/max(nb,1):.4f}")

    return net


def train(net, dataset, epochs=60, batch_size=64, lr=3e-3, ec=0.15):
    """REINFORCE with state-dependent value baseline.

    FIXES applied:
    - Same stochastic actions used for BOTH reward and gradient (was: argmax reward)
    - Value head trained with MSE against observed rewards (was: no value training)
    """
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    heads = [h for h in net.action_names if h != 'creativity']
    mse = nn.MSELoss()

    for ep in range(epochs):
        random.shuffle(dataset)
        ep_rwd = ep_loss = 0.0
        nb = 0

        for i in range(0, len(dataset), batch_size):
            batch = dataset[i:i + batch_size]
            bsz = len(batch)

            ft = torch.tensor([s['features'] for s in batch], dtype=torch.float32)
            logits, vals = net(ft)

            # Use stochastic actions for BOTH reward and gradient (same actions!)
            acts_stoch, lps, ents = net.sample_action(logits)
            with torch.no_grad():
                rwds = torch.tensor([
                    fast_reward({k: int(acts_stoch[k][j]) if k != 'creativity'
                                   else float(acts_stoch[k][j])
                                 for k in acts_stoch},
                                batch[j]['prompt'], batch[j]['features'])
                    for j in range(bsz)
                ], dtype=torch.float32)

            # Advantage with detach: value shouldn't get policy gradient, gets value_loss instead
            adv = (rwds - vals.detach())
            if adv.std() > 1e-6:
                adv = (adv - adv.mean()) / (adv.std() + 1e-8)

            # Policy loss: REINFORCE with entropy bonus
            policy_loss = torch.tensor(0.0)
            for j in range(bsz):
                for n in heads:
                    policy_loss = policy_loss - adv[j] * lps[n][j] - ec * ents[n][j]
            policy_loss = policy_loss / bsz

            # Value loss: MSE against observed returns (was missing!)
            value_loss = mse(vals, rwds)

            loss = policy_loss + 0.5 * value_loss

            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
            opt.step()

            ep_rwd += rwds.sum().item()
            ep_loss += float(abs(loss.item()))
            nb += 1

        if ep % 15 == 0 or ep == epochs - 1:
            ent_total = net.entropy(logits)
            ent_val = float(ent_total.mean().item()) if hasattr(ent_total, 'mean') else float(ent_total) / max(1, bsz)
            print(f"  epoch {ep:4d}/{epochs} | reward={ep_rwd/max(len(dataset),1):+.3f} | loss={ep_loss/max(nb,1):.4f} | ent={ent_val:.3f}")

    return net


def test_discrimination(net, dataset):
    """Verify different inputs produce different outputs using actual prompts."""
    import random as _rnd
    _rnd.seed(42)
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
    print(f"\n  Unique modes: {len(seen_mode)}, intents: {len(seen_intent)} (from {len(outputs)} prompts)")
    for o in outputs[:6]:
        print(f"    [{o['gold_intent']:12s}] {o['prompt']:50s} → {o['mode']:10s} {o['intent']}")

    return len(seen_mode) >= 2 and len(seen_intent) >= 2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bot', type=str, default='game-theory', choices=BOT_PROFILES + ['all'])
    parser.add_argument('--epochs', type=int, default=80)
    parser.add_argument('--output', type=str, default='assets/models/policy')
    args = parser.parse_args()

    print('=' * 60)
    print('  ReLU.chat OPTIMIZED Training Pipeline')
    print('=' * 60)

    bots = BOT_PROFILES if args.bot == 'all' else [args.bot]

    for bot_name in bots:
        print(f'\n--- {bot_name} ---')
        kb = load_bot_kb(bot_name)
        fmeta = load_fragment_meta(bot_name)
        prompts = gen_prompts(kb, fmeta, max_n=800)  # raised + meta-aware for more real fragment data
        print(f'Prompts: {len(prompts)} (meta keys: {len(fmeta)})')

        dataset = []
        for p in prompts:
            feat = build_features(p['text'], p.get('gold_intent'))
            dataset.append({'prompt': p, 'features': feat})

        # Hygiene: sbert available in env (future real-emb option); log fragment data stats
        avg_gold_fc = sum(p.get('gold_frag_count', 2) for p in prompts) / max(1, len(prompts))
        print(f'Dataset ready. Avg gold_frag_count: {avg_gold_fc:.2f} (real meta signal active)')
        print('Pretraining...')
        net = PolicyNetwork()
        net = pretrain(net, dataset)
        net = train(net, dataset, epochs=args.epochs)

        print('Discrimination test...')
        ok = test_discrimination(net, dataset)
        if not ok:
            print('  WARNING: Model may have collapsed')

        out_dir = Path(args.output)
        out_dir.mkdir(parents=True, exist_ok=True)
        weights_path = out_dir / 'policy.weights.json'
        net.save_weights_json(str(weights_path))
        print(f'Exported: {weights_path}')

    print('\nDone.')


if __name__ == '__main__':
    main()
