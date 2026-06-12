#!/usr/bin/env python3
"""
augment_prompts.py — ReLU.chat LLM Prompt Augmentation Pipeline

Generates diverse training prompt variations from seed prompts using
an OpenAI-compatible LLM API. Produces 5000+ total prompts per bot.

Usage:
  python3 augment_prompts.py --bot game-theory --seed-dev dev/datasets/seeds.json
"""

import argparse
import json
import os
import re
import time
import hashlib
from pathlib import Path

SYSTEM_PROMPT = """You are a prompt-generation assistant for a Q&A chatbot training pipeline.
Given seed prompts, generate {n} diverse variations for each seed by:
1. Using synonyms for key terms
2. Rephrasing the question structure
3. Adding typos and informal language
4. Combining multiple intents
5. Adding conversational context like "tell me more" or "what about"

Output ONLY a JSON array of arrays. No explanation."""

def augment_prompts(seed_prompts, n_variations=5, api_key=None, model="openai",
                    cache_dir="dev/datasets"):
    import requests

    api_key = api_key or os.environ.get('OPENAI_API_KEY') or ''
    cache_path = Path(cache_dir) / "augmented_cache.json"
    cache = {}
    if cache_path.exists():
        cache = json.loads(cache_path.read_text())

    augmented = []
    api_endpoint = os.environ.get('LLM_API_ENDPOINT', 'https://text.pollinations.ai/')

    for batch_start in range(0, len(seed_prompts), 5):
        batch = seed_prompts[batch_start:batch_start + 5]
        uncached = []

        for p in batch:
            key = hashlib.md5(p['text'].encode()).hexdigest()[:12]
            if key in cache:
                augmented.extend(cache[key])
            else:
                uncached.append((key, p))

        if not uncached:
            continue

        lines = [f'Seed {i+1}: "{p["text"]}"' for i, (_, p) in enumerate(uncached)]
        user_prompt = '\n'.join(lines) + f'\n\nFor each seed, generate {n_variations} diverse variations. Return JSON array of arrays.'

        try:
            headers = {'Content-Type': 'application/json'}
            if api_key:
                headers['Authorization'] = f'Bearer {api_key}'

            body = {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT.format(n=n_variations)},
                    {"role": "user", "content": user_prompt}
                ],
                "model": model,
                "temperature": 0.9,
                "max_tokens": 2000,
            }

            response = requests.post(api_endpoint, json=body, headers=headers, timeout=60)
            text = response.json().get('choices', [{}])[0].get('message', {}).get('content', '')

            # Parse JSON response
            json_match = re.search(r'\[\[.*\]\]', text, re.DOTALL)
            if json_match:
                variations_list = json.loads(json_match.group())
                for (key, p), vars_list in zip(uncached, variations_list):
                    new_prompts = [{
                        'text': var,
                        'gold_intent': p['gold_intent'],
                        'gold_topics': p['gold_topics'],
                        'gold_difficulty': p.get('gold_difficulty', 1),
                        'source': 'llm_augmented',
                    } for var in vars_list[:n_variations]]
                    cache[key] = new_prompts
                    augmented.extend(new_prompts)

            cache_path.write_text(json.dumps(cache, indent=2))

        except Exception as e:
            print(f"[augment] API error: {e}")

        time.sleep(0.5)

    print(f"[augment] Generated {len(augmented)} augmented prompts")
    return augmented


def main():
    parser = argparse.ArgumentParser(description="ReLU.chat LLM Prompt Augmentation")
    parser.add_argument("--bot", default="game-theory", help="Bot profile")
    parser.add_argument("--seed-dev", default="dev/datasets/seeds.json", help="Seed prompts file")
    parser.add_argument("--output", default="dev/datasets/augmented.json", help="Output path")
    parser.add_argument("--n", type=int, default=5, help="Variations per seed")
    parser.add_argument("--skip-api", action="store_true", help="Skip API calls, use cache only")
    args = parser.parse_args()

    if not Path(args.seed_dev).exists():
        print(f"[augment] Seed file {args.seed_dev} not found. Generating prompts via train-policy.py first.")
        from train_policy import generate_prompts, load_kb, load_intents, BOT_PROFILES
        kb = load_kb(args.bot)
        intents = load_intents(args.bot)
        seed_prompts = generate_prompts(kb, intents)
    else:
        seed_prompts = json.loads(Path(args.seed_dev).read_text())

    if args.skip_api:
        print("[augment] Skipping API calls (--skip-api). Using cache only.")
        augmented = []
    else:
        augmented = augment_prompts(seed_prompts, args.n)

    all_prompts = seed_prompts + augmented
    Path(args.output).write_text(json.dumps(all_prompts, indent=2))
    print(f"[augment] Total prompts ({len(seed_prompts)} seed + {len(augmented)} augmented): {len(all_prompts)}")
    print(f"[augment] Saved to {args.output}")


if __name__ == "__main__":
    main()