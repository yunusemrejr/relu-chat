#!/usr/bin/env python3
"""
tune-heuristic.py — ReLU.chat Heuristic Threshold Tuning

Parameterizes the decision thresholds in planAnswerHeuristic() and tunes
them via random search against a small validation set.

Usage:
  python3 dev/scripts/tune-heuristic.py --trials 500 --output dev/exports/best_thresholds.json
"""

import json
import random
import math
import sys
from pathlib import Path

# The ~15 thresholds from planAnswerHeuristic()
DEFAULT_THRESHOLDS = {
    # Mode detection
    'greeting_sim_threshold': 0.15,       # qSimTop1 < this + short query -> greeting
    'greeting_max_intent': 0.2,           # max intent score < this -> greeting
    'greeting_max_tokens': 4,             # queryLenTokens <= this -> greeting
    'off_topic_sim_threshold': 0.15,      # qSimTop1 < this + no entities -> off_topic
    'help_sim_threshold': 0.12,           # qSimTop1 < this + no entities -> help
    'help_second_sim_threshold': 0.10,    # qSimTop2 < this -> help
    
    # Intent detection
    'comparison_second_sim_min': 0.25,    # qSimTop2 < this -> fallback from comparison
    
    # Topic selection
    'entity_boost_threshold': 0.45,       # ENTITY_BOOST threshold
    'secondary_entry_threshold': 0.38,    # SECONDARY_ENTRY threshold
    'min_sim_for_topic': 0.15,            # minSim in guardrails
    'greeting_fallback_threshold': 0.25,  # GREETING_FALLBACK threshold
    
    # Comparison opener weights
    'comparison_similarity_weight': 0.33, # probability of 'similarity'
    'comparison_contrast_weight': 0.50,   # cumulative prob of 'similarity' + 'contrast'
    
    # Creativity
    'default_creativity': 0.5,
    'default_domain_match': 0.6,
}

THRESHOLD_RANGES = {
    'greeting_sim_threshold': (0.05, 0.30),
    'greeting_max_intent': (0.05, 0.40),
    'greeting_max_tokens': (1, 6),
    'off_topic_sim_threshold': (0.05, 0.30),
    'help_sim_threshold': (0.05, 0.25),
    'help_second_sim_threshold': (0.05, 0.20),
    'comparison_second_sim_min': (0.10, 0.40),
    'entity_boost_threshold': (0.30, 0.60),
    'secondary_entry_threshold': (0.25, 0.50),
    'min_sim_for_topic': (0.05, 0.30),
    'greeting_fallback_threshold': (0.10, 0.40),
    'comparison_similarity_weight': (0.10, 0.50),
    'comparison_contrast_weight': (0.30, 0.70),
    'default_creativity': (0.1, 1.0),
    'default_domain_match': (0.1, 1.0),
}

# Validation examples (hardcoded small set)
VALIDATION_EXAMPLES = [
    # (features_dict, expected_mode, expected_intent)
    {
        'qSimTop1': 0.12, 'qSimTop2': 0.08, 'entityCount': 0, 'queryLenTokens': 2,
        'intentDefScore': 0.15, 'intentExScore': 0.12, 'intentFormScore': 0.10,
        'intentAppScore': 0.08, 'intentCompScore': 0.05,
        'expected_mode': 'greeting', 'expected_intent': 'definition',
    },
    {
        'qSimTop1': 0.72, 'qSimTop2': 0.45, 'entityCount': 0, 'queryLenTokens': 6,
        'intentDefScore': 0.65, 'intentExScore': 0.42, 'intentFormScore': 0.21,
        'intentAppScore': 0.33, 'intentCompScore': 0.55,
        'expected_mode': 'normal', 'expected_intent': 'definition',
    },
    {
        'qSimTop1': 0.12, 'qSimTop2': 0.08, 'entityCount': 0, 'queryLenTokens': 5,
        'intentDefScore': 0.15, 'intentExScore': 0.12, 'intentFormScore': 0.10,
        'intentAppScore': 0.08, 'intentCompScore': 0.05,
        'hasFormalCue': True,
        'expected_mode': 'off_topic', 'expected_intent': 'definition',
    },
    {
        'qSimTop1': 0.30, 'qSimTop2': 0.20, 'entityCount': 0, 'queryLenTokens': 8,
        'intentDefScore': 0.80, 'intentExScore': 0.30, 'intentFormScore': 0.20,
        'intentAppScore': 0.25, 'intentCompScore': 0.35,
        'expected_mode': 'normal', 'expected_intent': 'definition',
    },
    {
        'qSimTop1': 0.70, 'qSimTop2': 0.20, 'entityCount': 1, 'queryLenTokens': 7,
        'intentDefScore': 0.30, 'intentExScore': 0.25, 'intentFormScore': 0.20,
        'intentAppScore': 0.35, 'intentCompScore': 0.85,
        'expected_mode': 'normal', 'expected_intent': 'definition',
        'note': 'comparison intent should fall back due to low qSimTop2',
    },
]


def evaluate_heuristic(features, thresholds):
    """Simulate planAnswerHeuristic logic with tunable thresholds."""
    # Mode detection
    mode = 'normal'
    max_intent = max(
        features.get('intentDefScore', 0), features.get('intentExScore', 0),
        features.get('intentFormScore', 0), features.get('intentAppScore', 0),
        features.get('intentCompScore', 0)
    )
    
    if features.get('entityCount', 0) == 0 and features.get('qSimTop1', 1) < thresholds['greeting_sim_threshold']:
        if features.get('hasFormalCue') or features.get('hasExampleCue'):
            mode = 'off_topic'
        elif max_intent < thresholds['greeting_max_intent'] and features.get('queryLenTokens', 99) <= thresholds['greeting_max_tokens']:
            mode = 'greeting'
        elif max_intent < thresholds['greeting_max_intent']:
            mode = 'off_topic'
    
    if mode == 'normal' and features.get('entityCount', 0) == 0 and features.get('qSimTop1', 1) < thresholds.get('greeting_fallback_threshold', 0.25):
        if features.get('qSimTop1', 1) < thresholds['help_sim_threshold'] and features.get('qSimTop2', 1) < thresholds['help_second_sim_threshold']:
            if features.get('entityCount', 0) == 0:
                mode = 'help'
    
    # Intent detection
    intent_scores = {
        'definition': features.get('intentDefScore', 0),
        'example': features.get('intentExScore', 0),
        'formal': features.get('intentFormScore', 0),
        'application': features.get('intentAppScore', 0),
        'comparison': features.get('intentCompScore', 0),
    }
    intent = max(intent_scores, key=intent_scores.get)
    
    # Comparison fallback
    if intent == 'comparison' and features.get('qSimTop2', 0) < thresholds['comparison_second_sim_min']:
        alt = [k for k in ['definition', 'example', 'application', 'formal'] if intent_scores.get(k, 0) > 0.2]
        intent = alt[0] if alt else 'definition'
    
    return mode, intent


def compute_accuracy(thresholds, examples):
    """Compute accuracy of heuristic against validation examples."""
    correct_mode = 0
    correct_intent = 0
    for ex in examples:
        mode, intent = evaluate_heuristic(ex, thresholds)
        if mode == ex.get('expected_mode'):
            correct_mode += 1
        if intent == ex.get('expected_intent'):
            correct_intent += 1
    total = len(examples)
    return correct_mode / total, correct_intent / total, (correct_mode + correct_intent) / (2 * total)


def random_search(trials=500, examples=None):
    """Random search over threshold space."""
    if examples is None:
        examples = VALIDATION_EXAMPLES
    
    best_thresholds = None
    best_combined = 0
    
    for trial in range(trials):
        thresholds = {}
        for key, (lo, hi) in THRESHOLD_RANGES.items():
            if isinstance(lo, int) and isinstance(hi, int):
                thresholds[key] = random.randint(lo, hi)
            else:
                thresholds[key] = random.uniform(lo, hi)
        
        # Ensure consistency constraints
        if thresholds['comparison_contrast_weight'] < thresholds['comparison_similarity_weight']:
            thresholds['comparison_similarity_weight'] = random.uniform(0.1, thresholds['comparison_contrast_weight'])
        if thresholds['help_sim_threshold'] >= thresholds['off_topic_sim_threshold']:
            thresholds['help_sim_threshold'] = thresholds['off_topic_sim_threshold'] * 0.8
        if thresholds['help_second_sim_threshold'] >= thresholds['help_sim_threshold']:
            thresholds['help_second_sim_threshold'] = thresholds['help_sim_threshold'] * 0.8
        
        mode_acc, intent_acc, combined = compute_accuracy(thresholds, examples)
        
        if combined > best_combined:
            best_combined = combined
            best_thresholds = thresholds.copy()
            best_thresholds['_metrics'] = {
                'mode_accuracy': mode_acc,
                'intent_accuracy': intent_acc,
                'combined_score': combined,
            }
    
    return best_thresholds


def main():
    import argparse
    parser = argparse.ArgumentParser(description='ReLU.chat Heuristic Threshold Tuning')
    parser.add_argument('--trials', type=int, default=500, help='Number of random search trials')
    parser.add_argument('--output', default='dev/exports/best_thresholds.json', help='Output path')
    args = parser.parse_args()
    
    print(f"Starting random search ({args.trials} trials)...")
    print(f"Validation examples: {len(VALIDATION_EXAMPLES)}")
    print(f"Thresholds to tune: {len(THRESHOLD_RANGES)}")
    print()
    
    result = random_search(args.trials)
    
    if result:
        metrics = result.pop('_metrics')
        print(f"Best result:")
        print(f"  Mode accuracy:     {metrics['mode_accuracy']:.1%}")
        print(f"  Intent accuracy:   {metrics['intent_accuracy']:.1%}")
        print(f"  Combined score:    {metrics['combined_score']:.1%}")
        print(f"\nBest thresholds:")
        for k, v in sorted(result.items()):
            print(f"  {k}: {v:.4f}" if isinstance(v, float) else f"  {k}: {v}")
        
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps({'thresholds': result, 'metrics': metrics}, indent=2))
        print(f"\nSaved to {args.output}")
    else:
        print("No results found.")


if __name__ == '__main__':
    main()
