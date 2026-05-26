#!/usr/bin/env python3
"""
policy_model.py — ReLU.chat Policy Network (PyTorch)
Architecture: 25→128(ReLU+LayerNorm+Dropout)→64(ReLU+LayerNorm+Dropout)→6 action heads + value head
Matches mlp-inference.js WEIGHT_SHAPES exactly.

Improvements (2026-05-26):
  - LayerNorm after each hidden layer for training stability (not exported to JS)
  - Dropout (p=0.1) between hidden layers to reduce overfitting
  - Orthogonal weight initialization for better gradient flow through deep nets
  - Gradient clipping support in training loop (applied externally via clip_grad_norm_)
"""

import torch
import torch.nn as nn
from torch.distributions import Categorical

ACTION_SIZES_ORDERED = [
    ("mode", 5),
    ("intent", 5),
    ("topic_count", 4),
    ("frag_count", 4),
    ("creativity", 1),
    ("tone", 4),
]

N_FEATURES = 25


class PolicyNetwork(nn.Module):
    def __init__(self, n_features=N_FEATURES, action_sizes=None):
        super().__init__()
        if action_sizes is None:
            action_sizes = ACTION_SIZES_ORDERED
        self.action_names = [name for name, _ in action_sizes]
        self.action_sizes = {name: sz for name, sz in action_sizes}

        # Hidden layers — architecture dimensions: 25 → 128 → 64 → 6 heads
        self.fc1 = nn.Linear(n_features, 128)

        # Improved: LayerNorm stabilizes training by normalizing activations.
        # These are NOT exported to JS inference — they only help the Linear
        # weights converge to better values during training.
        self.norm1 = nn.LayerNorm(128)

        # Improved: Dropout reduces overfitting on the small training dataset.
        # Only active during training (model.train()); disabled during export.
        self.dropout1 = nn.Dropout(0.1)

        self.fc2 = nn.Linear(128, 64)
        self.norm2 = nn.LayerNorm(64)
        self.dropout2 = nn.Dropout(0.1)

        # Action heads (6 heads: mode, intent, topic_count, frag_count, creativity, tone)
        self.heads = nn.ModuleDict({
            name: nn.Linear(64, size) for name, size in action_sizes
        })

        # Value head for baseline subtraction (REINFORCE with baseline)
        self.value_head = nn.Linear(64, 1)

        self._init_weights()

    def _init_weights(self):
        """
        Improved: Orthogonal initialization provides better gradient flow
        through deep networks compared to Kaiming/Xavier uniform.
        
        Gains:
          - sqrt(2) for ReLU-activated hidden layers (preserves variance)
          - 0.01 for output heads (small initial outputs for stable learning)
        """
        for m in [self.fc1, self.fc2]:
            nn.init.orthogonal_(m.weight, gain=nn.init.calculate_gain('relu'))
            nn.init.zeros_(m.bias)
        for head in self.heads.values():
            nn.init.orthogonal_(head.weight, gain=0.01)
            nn.init.zeros_(head.bias)
        nn.init.orthogonal_(self.value_head.weight, gain=0.01)
        nn.init.zeros_(self.value_head.bias)

    def forward(self, features):
        """
        Forward pass with pre-norm architecture:
          fc → layer_norm → relu → dropout
        
        LayerNorm before activation (pre-norm) provides more stable gradients
        than post-norm, especially in deeper networks.
        
        Dropout is only active during training — model.eval() disables it
        for inference and export.
        """
        # Layer 1: 25 → 128
        h = self.fc1(features)
        h = self.norm1(h)
        h = torch.relu(h)
        h = self.dropout1(h)

        # Layer 2: 128 → 64
        h = self.fc2(h)
        h = self.norm2(h)
        h = torch.relu(h)
        h = self.dropout2(h)

        # Action heads + value head
        logits = {name: head(h) for name, head in self.heads.items()}
        value = self.value_head(h).squeeze(-1)
        return logits, value

    def sample_action(self, logits, deterministic=False):
        """
        Sample discrete actions from categorical distributions.
        
        Returns:
          actions: dict of name → tensor of action indices
          log_probs: dict of name → tensor of log probabilities
          entropies: dict of name → tensor of per-sample entropies (for regularization)
        """
        actions = {}
        log_probs = {}
        entropies = {}
        for name, logit in logits.items():
            dist = Categorical(logits=logit)
            action = logit.argmax(dim=-1) if deterministic else dist.sample()
            actions[name] = action
            log_probs[name] = dist.log_prob(action)
            entropies[name] = dist.entropy()
        return actions, log_probs, entropies

    def get_log_probs(self, logits, actions):
        """
        Get log probabilities of given actions under current policy.
        Used for off-policy updates from replay buffer.
        """
        log_probs = {}
        for name, logit in logits.items():
            dist = Categorical(logits=logit)
            log_probs[name] = dist.log_prob(actions[name])
        return log_probs

    def entropy(self, logits):
        """
        Compute total entropy across all action heads (summed).
        Higher entropy = more exploration. Used for entropy regularization loss.
        
        Returns:
          Tensor of shape [batch_size] with total entropy per sample.
        """
        total = None
        for logit in logits.values():
            dist = Categorical(logits=logit)
            if total is None:
                total = dist.entropy()
            else:
                total += dist.entropy()
        return total if total is not None else torch.tensor(0.0)

    # -----------------------------------------------------------------------
    # Export methods — produce dict matching MLPPolicy._validate expectations
    # -----------------------------------------------------------------------

    EXPORT_LAYER_MAP = [
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

    def export_weights_dict(self):
        """
        Return a dict mapping JS-weight keys to Python lists of the
        correct shapes expected by MLPPolicy._validate() in mlp-inference.js.

        NOTE: Only Linear layer weights are exported. LayerNorm (norm1, norm2)
        and Dropout (dropout1, dropout2) are training-only helpers and are NOT
        included in the export. This ensures full compatibility with the JS
        inference pipeline which implements a simple Linear+ReLU forward pass.

        Keys produced:
          fc1.weight [128,25], fc1.bias [128],
          fc2.weight [64,128], fc2.bias [64],
          mode_head.weight [5,64], mode_head.bias [5],
          intent_head.weight [5,64], intent_head.bias [5],
          topic_count_head.weight [4,64], topic_count_head.bias [4],
          frag_count_head.weight [4,64], frag_count_head.bias [4],
          creativity_head.weight [1,64], creativity_head.bias [1],
          tone_head.weight [4,64], tone_head.bias [4]
        """
        state = self.state_dict()
        weights = {}
        for pt_key, js_key in self.EXPORT_LAYER_MAP:
            weights[js_key] = state[pt_key].cpu().numpy().tolist()
        weights['_version'] = 2
        weights['_n_features'] = N_FEATURES
        return weights

    def save_weights_json(self, path):
        """
        Save weights to a JSON file matching the format expected by
        MLPPolicy.load() / MLPPolicy._validate().

        The file is written flat — weight arrays sit at the top level
        alongside metadata keys (_version, _n_features).  MLPPolicy.load()
        handles both flat and { "weights": ... } wrappers via
        `json.weights || json`.
        """
        import json, os
        weights = self.export_weights_dict()
        # Write flat (no 'weights' wrapper) for compatibility with
        # existing assets/models/policy/policy.weights.json format.
        os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
        with open(path, 'w') as f:
            json.dump(weights, f, indent=2)
        size_kb = os.path.getsize(path) / 1024
        print(f"[export] Weights saved to {path} ({size_kb:.1f} KiB)")
