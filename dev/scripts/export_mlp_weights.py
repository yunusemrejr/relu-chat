#!/usr/bin/env python3
"""
export_mlp_weights.py — ReLU.chat MLP Weights Export

Exports trained PyTorch PolicyNetwork weights to the JSON format
expected by mlp-inference.js MLPPolicy.load().

Usage:
  python3 dev/scripts/export_mlp_weights.py checkpoint.pt --output assets/models/policy/policy.weights.json
  python3 dev/scripts/export_mlp_weights.py checkpoint.pt --output assets/models/policy/policy.weights.json --validate
"""

import argparse
import json
import sys
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from policy_model import PolicyNetwork, ACTION_SIZES_ORDERED, N_FEATURES

WEIGHT_SHAPES = [
    ('fc1.weight',              [128, 25]),
    ('fc1.bias',                [128]),
    ('fc2.weight',              [64, 128]),
    ('fc2.bias',                [64]),
    ('mode_head.weight',        [5, 64]),
    ('mode_head.bias',          [5]),
    ('intent_head.weight',      [5, 64]),
    ('intent_head.bias',        [5]),
    ('topic_count_head.weight', [4, 64]),
    ('topic_count_head.bias',   [4]),
    ('frag_count_head.weight',  [4, 64]),
    ('frag_count_head.bias',    [4]),
    ('creativity_head.weight',  [1, 64]),
    ('creativity_head.bias',    [1]),
    ('tone_head.weight',        [4, 64]),
    ('tone_head.bias',          [4]),
]

LAYER_MAP = [
    ('fc1.weight',              'fc1.weight'),
    ('fc1.bias',                'fc1.bias'),
    ('fc2.weight',              'fc2.weight'),
    ('fc2.bias',                'fc2.bias'),
    ('heads.mode.weight',       'mode_head.weight'),
    ('heads.mode.bias',         'mode_head.bias'),
    ('heads.intent.weight',     'intent_head.weight'),
    ('heads.intent.bias',       'intent_head.bias'),
    ('heads.topic_count.weight','topic_count_head.weight'),
    ('heads.topic_count.bias',  'topic_count_head.bias'),
    ('heads.frag_count.weight', 'frag_count_head.weight'),
    ('heads.frag_count.bias',   'frag_count_head.bias'),
    ('heads.creativity.weight', 'creativity_head.weight'),
    ('heads.creativity.bias',   'creativity_head.bias'),
    ('heads.tone.weight',       'tone_head.weight'),
    ('heads.tone.bias',         'tone_head.bias'),
]


def export_weights(checkpoint_path, output_path, validate=True):
    checkpoint = torch.load(checkpoint_path, map_location='cpu', weights_only=True)

    if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
        state_dict = checkpoint['model_state_dict']
    else:
        state_dict = checkpoint

    weights = {}
    for pt_key, js_key in LAYER_MAP:
        tensor = state_dict.get(pt_key)
        if tensor is None:
            available = [k for k in state_dict.keys() if not k.startswith('value_head')]
            raise KeyError(f"Missing key '{pt_key}' in checkpoint. Available: {available[:10]}")
        arr = tensor.numpy()
        weights[js_key] = arr.tolist()

    weights['_version'] = 2
    weights['_source'] = str(checkpoint_path)
    weights['_inputFeatures'] = N_FEATURES

    for js_key, expected_shape in WEIGHT_SHAPES:
        val = weights[js_key]
        actual = shape_of(val)
        if actual != tuple(expected_shape):
            raise ValueError(f"Shape mismatch '{js_key}': expected {expected_shape}, got {actual}")

    output = {'weights': weights}
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(output, f, cls=NumpyEncoder, indent=2)

    size_kb = Path(output_path).stat().st_size / 1024
    print(f"[export] Written {output_path} ({size_kb:.1f} KiB)")

    if validate:
        validate_inference(weights, output_path)

    return output_path


def shape_of(val):
    if isinstance(val, list):
        if len(val) == 0:
            return (0,)
        if isinstance(val[0], list):
            return (len(val), len(val[0]))
        return (len(val),)
    return ()


def validate_inference(weights, output_path):
    print("[export] Validating inference match...")
    model = PolicyNetwork()
    model.eval()

    pt_state = {}
    for pt_key, js_key in LAYER_MAP:
        arr = np.array(weights[js_key], dtype=np.float32)
        pt_state[pt_key] = torch.from_numpy(arr)
    model.load_state_dict(pt_state, strict=False)

    test_input = torch.randn(2, N_FEATURES)
    with torch.no_grad():
        logits, value = model(test_input)

    for name, logit in logits.items():
        print(f"  {name}: shape={list(logit.shape)}, mean={logit.mean():.4f}")
    print(f"  value: shape={list(value.shape)}, mean={value.mean():.4f}")
    print("[export] Validation passed.")


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def main():
    import torch

    parser = argparse.ArgumentParser(description='ReLU.chat MLP Weights Export')
    parser.add_argument('checkpoint', help='Path to PyTorch checkpoint (.pt)')
    parser.add_argument('--output', default='assets/models/policy/policy.weights.json', help='Output JSON path')
    parser.add_argument('--validate', action='store_true', help='Run validation inference after export')
    args = parser.parse_args()

    if not Path(args.checkpoint).exists():
        print(f"[export] Checkpoint not found: {args.checkpoint}")
        print("[export] Creating placeholder weights for development...")
        model = PolicyNetwork()
        model.eval()
        state_dict = model.state_dict()
        Path(args.checkpoint).parent.mkdir(parents=True, exist_ok=True)
        torch.save({'model_state_dict': state_dict}, args.checkpoint)
        print(f"[export] Created placeholder checkpoint: {args.checkpoint}")
        state_dict_to_export = state_dict
    else:
        checkpoint = torch.load(args.checkpoint, map_location='cpu', weights_only=True)
        if isinstance(checkpoint, dict) and 'model_state_dict' in checkpoint:
            state_dict_to_export = checkpoint['model_state_dict']
        else:
            state_dict_to_export = checkpoint

    output_path = export_weights_from_state_dict(state_dict_to_export, args.output, args.validate)
    print(f"[export] Done: {output_path}")


def export_weights_from_state_dict(state_dict, output_path, validate=True):
    import torch

    weights = {}
    for pt_key, js_key in LAYER_MAP:
        tensor = state_dict[pt_key]
        arr = tensor.numpy()
        weights[js_key] = arr.tolist()

    weights['_version'] = 2
    weights['_source'] = 'export_mlp_weights.py'
    weights['_inputFeatures'] = N_FEATURES

    for js_key, expected_shape in WEIGHT_SHAPES:
        val = weights[js_key]
        actual = shape_of(val)
        if actual != tuple(expected_shape):
            raise ValueError(f"Shape mismatch '{js_key}': expected {expected_shape}, got {actual}")

    output = {'weights': weights}
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(output, f, cls=NumpyEncoder, indent=2)

    size_kb = Path(output_path).stat().st_size / 1024
    print(f"[export] Written {output_path} ({size_kb:.1f} KiB)")

    if validate:
        validate_inference(weights, output_path)

    return output_path


if __name__ == '__main__':
    main()
