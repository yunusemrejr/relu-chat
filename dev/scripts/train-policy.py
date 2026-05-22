#!/usr/bin/env python3
"""
train-policy.py — ReLU.chat WASM Policy Training Pipeline (Skeleton)

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
  3. definePolicyNetwork()     — small MLP: 18 in → 64 → 32 → action_heads
  4. defineRewardFunction()    — multi-component reward (architecture §7.5)
  5. train()                   — REINFORCE/PPO loop with baseline subtraction
  6. export_onnx()             — freeze graph → ONNX
  7. compile_wasm()            — onnx → wasm via wasm-opt (instructions here)

Usage:
  python3 train-policy.py --bot game-theory --epochs 1000 --output ../assets/models/policy/
"""

import argparse
import json
import os
import sys
from pathlib import Path
from collections import defaultdict

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
]
N_FEATURES = 18

# Action space sizes (discrete action heads)
ACTION_SIZES = {
    "mode":        5,  # normal, off_topic, greeting, help, comparison
    "topic_count": 4,  # 0, 1, 2, 3
    "intent":      5,  # definition, example, formal, application, comparison
    "tone":        4,  # neutral, formal, intuitive, playful
    "creativity_bucket": 10,    # 0.0-1.0 in 0.1 increments
    "opener_idx":  6,           # indices into overrides.openers
    "closer_idx":  4,           # indices into overrides.closers
}

# Bot profiles (matching data/bots/*/ structure)
BOT_PROFILES = ["game-theory", "golden-age", "data-science"]

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

    # TODO (Phase 3): LLM-augmented variations
    # for each seed prompt, call an LLM API (temp 0.9) to generate n_variations
    # variations with synonyms, rephrasing, different difficulty levels
    # Mark source as "llm_augmented"

    print(f"[prompts] Generated {len(prompts)} seed prompts")
    return prompts


# ---------------------------------------------------------------------------
# Step 2: Retrieval dataset builder (simulate extraction + ranking)
# ---------------------------------------------------------------------------

def build_retrieval_dataset(prompts: list, kb_entries: list, intent_prototypes: dict) -> list:
    """
    Simulate the retrieval stack for each prompt, producing per-prompt context.

    In production (Phase 3), this would run the actual embedding model
    (all-MiniLM-L6-v2 via transformers.js or sentence-transformers).
    Here we use a deterministic stub.

    Returns a list of:
      {
        "prompt": prompt_dict,
        "features": [18 floats],      # raw feature vector
        "ranked_indices": [int],      # KB entry indices ranked by sim
        "entity_indices": [int],      # KB entry indices with alias match
        "intent_raw_scores": {intent_name: float},
      }
    """
    dataset = []

    # Stub: generate synthetic features based on prompt properties
    # In real training, each prompt is embedded and ranked against KB entries.
    for prompt in prompts:
        # Synthetic feature generation (placeholder)
        features = [0.0] * N_FEATURES

        # Fill with plausible synthetic values based on prompt metadata
        gold_intent = prompt.get("gold_intent", "definition")

        # Simulate retrieval: high sim for gold topics, moderate for related
        features[0] = 0.65 + 0.2 * hash(prompt["text"]) % 1 / 100  # qSimTop1
        features[1] = 0.35 + 0.2 * hash(prompt["text"] + "2") % 1 / 100  # qSimTop2

        # Entity extraction: simulate match for topic names in prompt
        entity_indices = []
        for i, entry in enumerate(kb_entries):
            if entry.get("id") in prompt.get("gold_topics", []):
                entity_indices.append(i)
        features[2] = min(len(entity_indices), 3)  # entityCount
        features[3] = 1.0 if entity_indices else 0.0  # entityBoostHit

        # Intent scores: gold intent gets highest score
        for j, intent_name in enumerate(["definition", "example", "formal", "application", "comparison"]):
            score = 0.75 if intent_name == gold_intent else 0.15 + 0.1 * hash(intent_name + prompt["text"]) % 1 / 100
            features[4 + j] = score

        # Last topic: simulate no prior context (cold start)
        features[9] = 0.0   # lastTopicSim
        features[10] = 8.0  # lastTopicAge (max)

        # KB coverage: high sim for gold topics
        features[11] = 0.3

        # Query length: tokenize and count
        tokens = prompt["text"].lower().split()
        features[12] = min(len(tokens), 32)

        # Lexical cues
        features[13] = 1.0 if any(w in prompt["text"].lower() for w in ("vs", "versus", "compare", "difference")) else 0.0
        features[14] = 1.0 if any(w in prompt["text"].lower() for w in ("prove", "theorem", "formal", "math")) else 0.0
        features[15] = 1.0 if any(w in prompt["text"].lower() for w in ("example", "illustrate", "case")) else 0.0

        # Bot profile injection (defaults)
        features[16] = 0.5  # botCreativity
        features[17] = 0.6  # domainMatch

        dataset.append({
            "prompt": prompt,
            "features": features,
            "ranked_indices": list(range(min(len(kb_entries), 10))),  # top-10 stub
            "entity_indices": entity_indices,
            "intent_raw_scores": {
                "definition": features[4],
                "example": features[5],
                "formal": features[6],
                "application": features[7],
                "comparison": features[8],
            },
        })

    return dataset


# ---------------------------------------------------------------------------
# Step 3: Policy network definition
# ---------------------------------------------------------------------------

class PolicyNetwork:
    """
    Lightweight policy network: 18 → 64 → 32 → action_heads.

    Each action head is a separate linear layer producing logits over its
    discrete action space. A shared trunk learns a compact state representation.

    This is the architecture that gets compiled to WASM.
    Target size: < 180 KiB gzipped.
    """
    def __init__(self, n_features=N_FEATURES, action_sizes=None):
        if action_sizes is None:
            action_sizes = ACTION_SIZES
        self.action_sizes = action_sizes
        self.n_features = n_features

        # Placeholder weights (replace with real torch.nn.Module in Phase 3)
        # Shared trunk: 18 → 64 → 32 (ReLU activations)
        # Action heads: 32 → action_size (one per discrete action)
        self._placeholder = True

    def forward(self, features):
        """
        Forward pass: features → action logits dict.

        Returns:
          { "mode": logits(5), "intent": logits(5), ... }
        """
        # Stub: return random logits
        # In real implementation: torch forward pass through trunk + heads
        import random
        return {name: [random.random() for _ in range(size)]
                for name, size in self.action_sizes.items()}

    def sample_action(self, logits, temperature=1.0):
        """
        Sample from action logits with temperature scaling.
        Returns a dict of action choices and log-probabilities for RL.
        """
        import random, math
        actions = {}
        log_probs = {}

        for name, logit_vec in logits.items():
            # Softmax with temperature
            scaled = [l / max(temperature, 1e-6) for l in logit_vec]
            max_l = max(scaled)
            exp_vals = [math.exp(l - max_l) for l in scaled]
            total = sum(exp_vals)
            probs = [e / total for e in exp_vals]

            # Sample
            r = random.random()
            cum = 0
            chosen_idx = 0
            for i, p in enumerate(probs):
                cum += p
                if r <= cum:
                    chosen_idx = i
                    break

            actions[name] = chosen_idx
            log_probs[name] = math.log(probs[chosen_idx] + 1e-9)

        return actions, log_probs


# ---------------------------------------------------------------------------
# Step 4: Reward function
# ---------------------------------------------------------------------------

def compute_reward(actions: dict, prompt: dict, rendered_text: str, features: list) -> float:
    """
    Multi-component reward function (architecture §7.5).

    Components:
      1. intentMatch         (weight 0.25): did policy choose correct intent?
      2. topicPrecision      (weight 0.20): fraction of topics that are relevant
      3. fragmentCoherence   (weight 0.15): internal coherence score
      4. lengthPenalty       (weight 0.10): quadratic penalty outside [40,180] tokens
      5. creativityAlignment (weight 0.10): policy creativity vs human-rated
      6. guardrailCompliance (weight 0.20): binary: no violations

    Returns:
        scalar reward ∈ [-1, 1] (approximately)
    """
    # Component 1: Intent match
    gold_intent = prompt.get("gold_intent", "definition")
    intent_names = list(ACTION_SIZES["intent"].keys()) if isinstance(ACTION_SIZES["intent"], dict) else \
                   ["definition", "example", "formal", "application", "comparison"]
    chosen_intent = intent_names[actions.get("intent", 0)]
    intent_match = 1.0 if chosen_intent == gold_intent else 0.0

    # Component 2: Topic precision
    gold_topics = set(prompt.get("gold_topics", []))
    # Stub: assume actions include topic selection (simulated)
    topic_precision = 0.5  # placeholder

    # Component 3: Fragment coherence (stub)
    fragment_coherence = 0.7

    # Component 4: Length penalty (quadratic outside [40, 180])
    n_tokens = len(rendered_text.split()) if rendered_text else 0
    if 40 <= n_tokens <= 180:
        length_penalty = 1.0
    elif n_tokens < 40:
        length_penalty = max(0.0, 1.0 - ((40 - n_tokens) / 40) ** 2)
    else:
        length_penalty = max(0.0, 1.0 - ((n_tokens - 180) / 180) ** 2)

    # Component 5: Creativity alignment (stub)
    creativity_alignment = 0.8

    # Component 6: Guardrail compliance (binary)
    guardrail_ok = 1.0  # placeholder — check maxTopics, requireEntity etc.

    # Weighted sum
    reward = (
        0.25 * intent_match
        + 0.20 * topic_precision
        + 0.15 * fragment_coherence
        + 0.10 * length_penalty
        + 0.10 * creativity_alignment
        + 0.20 * guardrail_ok
    )

    return reward


# ---------------------------------------------------------------------------
# Step 5: Training loop
# ---------------------------------------------------------------------------

def train(policy_net, dataset, epochs=1000, batch_size=64, lr=1e-3,
          exploration_eps=0.15, baseline_decay=0.95):
    """
    REINFORCE with baseline subtraction training loop.

    For each epoch:
      1. Shuffle dataset, split into batches
      2. For each batch:
         a. Forward pass: get action logits
         b. ε-greedy sampling: with prob ε, sample uniformly; else from policy
         c. Simulate rendering (stub) → rendered text
         d. Compute reward via reward function
         e. Compute advantage = reward - baseline
         f. Compute policy gradient: -advantage * log_prob(action)
         g. Update baseline: EMA of reward
         h. Gradient step

    PPO variant (more stable):
      - Clipped surrogate objective
      - Multiple epochs per batch
      - Value function head for advantage estimation

    Args:
        policy_net: PolicyNetwork instance
        dataset: list of retrieval context dicts
        epochs: number of passes over the dataset
        batch_size: mini-batch size
        lr: learning rate
        exploration_eps: ε for ε-greedy exploration
        baseline_decay: EMA decay for reward baseline
    """
    import random

    baseline = 0.0
    total_reward = 0.0
    n_steps = 0

    for epoch in range(epochs):
        random.shuffle(dataset)
        epoch_reward = 0.0
        epoch_loss = 0.0

        for i in range(0, len(dataset), batch_size):
            batch = dataset[i:i + batch_size]
            batch_rewards = []

            for sample in batch:
                features = sample["features"]
                prompt = sample["prompt"]

                # Forward pass
                logits = policy_net.forward(features)

                # ε-greedy exploration
                if random.random() < exploration_eps:
                    # Uniform random action
                    actions = {
                        name: random.randrange(size)
                        for name, size in policy_net.action_sizes.items()
                    }
                    log_probs = {
                        name: -2.3  # log(0.1) approx for uniform over max 10
                        for name in policy_net.action_sizes
                    }
                else:
                    actions, log_probs = policy_net.sample_action(logits, temperature=1.0)

                # Simulate rendering (stub — Phase 3 uses real composeV2)
                rendered_text = _stub_render(actions, prompt, features)

                # Compute reward
                reward = compute_reward(actions, prompt, rendered_text, features)
                batch_rewards.append(reward)

                # Advantage
                advantage = reward - baseline

                # Policy gradient loss (sum of -advantage * log_prob over all heads)
                loss = -advantage * sum(log_probs.values())

                # Update baseline (EMA)
                baseline = baseline_decay * baseline + (1 - baseline_decay) * reward

                epoch_reward += reward
                epoch_loss += abs(loss)
                n_steps += 1

            # Batch update (accumulated gradients in real implementation)
            # In Phase 3: optimizer.step() after backward pass

        avg_reward = epoch_reward / max(len(dataset), 1)
        avg_loss = epoch_loss / max(len(dataset), 1)
        total_reward += epoch_reward

        if epoch % 100 == 0 or epoch == epochs - 1:
            print(f"[train] epoch {epoch:4d} | avg_reward={avg_reward:.4f} | "
                  f"avg_loss={avg_loss:.4f} | baseline={baseline:.4f}")

    print(f"[train] Done. Total steps: {n_steps}, total reward: {total_reward:.2f}")
    return policy_net


def _stub_render(actions, prompt, features):
    """
    Stub renderer that simulates composeV2(plan, KB, overrides) → text.
    In Phase 3, this calls the actual JS renderer or a Python reimplementation.
    """
    intent_names = ["definition", "example", "formal", "application", "comparison"]
    mode_names = ["normal", "off_topic", "greeting", "help", "comparison"]
    tone_names = ["neutral", "formal", "intuitive", "playful"]

    chosen_intent = intent_names[actions.get("intent", 0) % len(intent_names)]
    chosen_mode = mode_names[actions.get("mode", 0) % len(mode_names)]
    chosen_tone = tone_names[actions.get("tone", 0) % len(tone_names)]

    topic = prompt.get("gold_topics", ["unknown"])[0]
    text = f"[{chosen_mode}/{chosen_intent}/{chosen_tone}] Explanation of {topic}. " \
           f"This is a simulated response for training purposes."

    return text


# ---------------------------------------------------------------------------
# Step 6: ONNX export
# ---------------------------------------------------------------------------

def export_onnx(policy_net, output_path: str):
    """
    Export the trained policy network to ONNX format.

    The ONNX graph represents the forward pass (inference only),
    with all weights frozen. This is the input to the WASM compiler.

    Args:
        policy_net: trained PolicyNetwork
        output_path: path for the .onnx file

    Instructions (Phase 3):
      import torch.onnx
      dummy_input = torch.randn(1, N_FEATURES)
      torch.onnx.export(
          policy_net,
          dummy_input,
          output_path,
          input_names=['features'],
          output_names=['mode', 'intent', 'tone', ...],
          dynamic_axes={'features': {0: 'batch_size'}},
          opset_version=14,
      )
    """
    print(f"[export] ONNX export stub — output would go to {output_path}")
    print(f"[export] In Phase 3, replace this with torch.onnx.export()")

    # Placeholder: write an empty file so downstream CI doesn't break
    # Path(output_path).write_text("# ONNX placeholder")

    return output_path


# ---------------------------------------------------------------------------
# Step 7: WASM compilation
# ---------------------------------------------------------------------------

def compile_wasm(onnx_path: str, wasm_output_path: str, weights_output_path: str):
    """
    Compile ONNX model to WASM + weights.bin.

    Toolchain (Phase 3):
      1. onnx → onnx-simplifier (constant folding, dead node elimination)
      2. onnx → onnx2tf → tf-lite → tf-lite-micro → .cpp
      3. .cpp → emcc (Emscripten) → policy.wasm + policy.js
      OR:
      4. onnx → onnxruntime WebAssembly build (ORT Web)
         See: https://onnxruntime.ai/docs/build/web.html

    Alternative approach (simpler):
      Use https://github.com/visheratin/web-ai or
      https://github.com/webonnx/wonnx for direct ONNX→WASM inference.

    Recommended production path:
      1. onnx → onnx-optimizer → optimized.onnx
      2. wasm-opt --strip-debug --enable-bulk-memory on the final .wasm
      3. Validate: wasm2wat policy.wasm → audit exports + memory usage
      4. Quantize: float32 → int8 (reduce weights.bin to < 420 KiB)

    Args:
        onnx_path: path to exported .onnx file
        wasm_output_path: destination for policy.wasm
        weights_output_path: destination for policy.weights.bin
    """
    print(f"[wasm] Compilation stub:")
    print(f"         ONNX:  {onnx_path}")
    print(f"         WASM:  {wasm_output_path}")
    print(f"         Weights: {weights_output_path}")
    print()
    print(f"[wasm] Production compilation commands (Phase 3):")
    print(f"  # 1. Optimize ONNX")
    print(f"  python3 -m onnxsim {onnx_path} optimized.onnx")
    print(f"  python3 -m onnxoptimizer optimized.onnx final.onnx")
    print()
    print(f"  # 2. ONNX → WebAssembly (via ORT Web or wonnx)")
    print(f"  # Option A: ONNX Runtime Web")
    print(f"  npx onnxruntime-web-script-tools --model final.onnx --output .")
    print(f"  # This produces ort-wasm.wasm + ort-wasm.js")
    print()
    print(f"  # Option B: wonnx (Rust-based, smaller binary)")
    print(f"  cargo install wonnx-cli")
    print(f"  wonnx-cli compile final.onnx --output policy.wasm")
    print()
    print(f"  # 3. Extract and compress weights")
    print(f"  python3 extract_weights.py final.onnx policy.weights.bin")
    print(f"  gzip -9 policy.wasm")
    print(f"  # Target: policy.wasm.gz < 180 KiB, weights.bin < 420 KiB (int8)")
    print()
    print(f"  # 4. Validate")
    print(f"  wasm-opt --strip-debug policy.wasm -o policy.min.wasm")
    print(f"  wasm2wat policy.wasm | head -100")
    print()
    print(f"[wasm] For Docker reproducible build:")
    print(f"  docker build -f dev/Dockerfile.policy-build -t relu-policy-builder .")
    print(f"  docker run --rm -v ./assets/models/policy:/out relu-policy-builder")

    return wasm_output_path


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def load_kb(bot_name: str, data_dir: str = "data/bots") -> list:
    """
    Load knowledge base entries for a given bot.

    Expects: {data_dir}/{bot_name}-chat/knowledge.js
    This is a JS module; in production we'd parse it or use a JSON version.
    For the skeleton, we return a synthetic KB.
    """
    kb_path = Path(data_dir) / f"{bot_name}-chat" / "knowledge.js"
    if kb_path.exists():
        # Stub: real implementation would parse the JS file or load a companion JSON
        print(f"[kb] Found knowledge file: {kb_path} (parsing not yet implemented)")
    else:
        print(f"[kb] No knowledge file at {kb_path} — using synthetic entries")

    # Synthetic KB entries for training
    return [
        {"id": "topic_001", "name": "Nash Equilibrium", "aliases": ["Nash equilibrium", "Nash"], "difficulty": 2},
        {"id": "topic_002", "name": "Prisoner's Dilemma", "aliases": ["Prisoner's dilemma", "PD"], "difficulty": 1},
        {"id": "topic_003", "name": "Shapley Value", "aliases": ["Shapley value", "Shapley"], "difficulty": 3},
        {"id": "topic_004", "name": "Zero-Sum Game", "aliases": ["Zero-sum game", "zero sum"], "difficulty": 1},
        {"id": "topic_005", "name": "Dominant Strategy", "aliases": ["Dominant strategy", "dominance"], "difficulty": 1},
    ]


def load_intents(bot_name: str, data_dir: str = "data/bots") -> dict:
    """
    Load intent definitions for a bot.
    """
    intents_path = Path(data_dir) / f"{bot_name}-chat" / "intents.js"
    print(f"[intents] Looking for: {intents_path}")

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
    args = parser.parse_args()

    print("=" * 60)
    print("ReLU.chat WASM Policy Training Pipeline")
    print(f"  Bot:     {args.bot}")
    print(f"  Epochs:  {args.epochs}")
    print(f"  Output:  {args.output}")
    print("=" * 60)
    print()

    # Step 1: Load KB and intents
    kb = load_kb(args.bot, args.data_dir)
    intents = load_intents(args.bot, args.data_dir)
    print(f"[init] Loaded {len(kb)} KB entries, {len(intents)} intents")

    # Step 2: Generate prompts
    prompts = generate_prompts(kb, intents)
    print(f"[prompts] Total: {len(prompts)}")

    # Step 3: Build retrieval dataset
    dataset = build_retrieval_dataset(prompts, kb, intents)
    print(f"[dataset] Total samples: {len(dataset)}")

    if args.skip_train:
        print("[skip] Training skipped (--skip-train)")
        return

    if args.export_only:
        print(f"[export] Loading checkpoint from {args.export_only} ...")
        # TODO: load PyTorch checkpoint
        policy_net = PolicyNetwork()
    else:
        # Step 4: Initialize policy network
        policy_net = PolicyNetwork()

        # Step 5: Train
        print(f"[train] Starting {args.epochs} epochs on {len(dataset)} samples...")
        policy_net = train(policy_net, dataset, epochs=args.epochs)
        print("[train] Training complete")

    # Step 6: Export ONNX
    os.makedirs(args.output, exist_ok=True)
    onnx_path = os.path.join(args.output, "policy.onnx")
    export_onnx(policy_net, onnx_path)

    # Step 7: Compile to WASM
    wasm_path = os.path.join(args.output, "policy.wasm")
    weights_path = os.path.join(args.output, "policy.weights.bin")
    compile_wasm(onnx_path, wasm_path, weights_path)

    # Step 8: Update manifest
    manifest_path = os.path.join(args.output, "policy.manifest.json")
    manifest = {
        "version": "0.1.0",
        "inputFeatures": 18,
        "inputBytes": 76,
        "outputSchema": "AnswerPlan.v1",
        "fragmentMetaVersion": "1.0.0",
        "model": "mlp_policy",
        "weightsSize": os.path.getsize(weights_path) if os.path.exists(weights_path) else 4096,
        "botProfiles": [args.bot],
        "trained": "2026-05-23",
        "architecture": {
            "trunk": "18→64→32 (ReLU)",
            "heads": {name: size for name, size in ACTION_SIZES.items()},
            "total_params": "~5K",  # approximate
        },
    }
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"[manifest] Updated {manifest_path}")

    print()
    print("=" * 60)
    print("Pipeline complete (skeleton).")
    print("Artifacts would be at:", args.output)
    print()
    print("Next steps:")
    print("  1. Implement real embedding model (sentence-transformers)")
    print("  2. Replace PolicyNetwork.forward() with PyTorch nn.Module")
    print("  3. Implement composeV2 renderer in Python")
    print("  4. Implement ONNX export (torch.onnx.export)")
    print("  5. Set up GitHub Actions GPU runner for nightly training")
    print("  6. Deploy artifacts to /assets/models/policy/ via FTP")
    print("=" * 60)


if __name__ == "__main__":
    main()
