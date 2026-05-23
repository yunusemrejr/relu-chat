#!/usr/bin/env python3
"""
policy_model.py — ReLU.chat Policy Network (PyTorch)
Architecture: 24→128(ReLU)→64(ReLU)→6 action heads + value head
Matches mlp-inference.js WEIGHT_SHAPES exactly.
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

N_FEATURES = 24


class PolicyNetwork(nn.Module):
    def __init__(self, n_features=N_FEATURES, action_sizes=None):
        super().__init__()
        if action_sizes is None:
            action_sizes = ACTION_SIZES_ORDERED
        self.action_names = [name for name, _ in action_sizes]
        self.action_sizes = {name: sz for name, sz in action_sizes}

        self.fc1 = nn.Linear(n_features, 128)
        self.fc2 = nn.Linear(128, 64)

        self.heads = nn.ModuleDict({
            name: nn.Linear(64, size) for name, size in action_sizes
        })
        self.value_head = nn.Linear(64, 1)
        self._init_weights()

    def _init_weights(self):
        for m in [self.fc1, self.fc2]:
            nn.init.kaiming_uniform_(m.weight, nonlinearity='relu')
            nn.init.zeros_(m.bias)
        for head in self.heads.values():
            nn.init.xavier_uniform_(head.weight)
            nn.init.zeros_(head.bias)
        nn.init.xavier_uniform_(self.value_head.weight)
        nn.init.zeros_(self.value_head.bias)

    def forward(self, features):
        h = torch.relu(self.fc1(features))
        h = torch.relu(self.fc2(h))
        logits = {name: head(h) for name, head in self.heads.items()}
        value = self.value_head(h).squeeze(-1)
        return logits, value

    def sample_action(self, logits, deterministic=False):
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
        log_probs = {}
        for name, logit in logits.items():
            dist = Categorical(logits=logit)
            log_probs[name] = dist.log_prob(actions[name])
        return log_probs

    def entropy(self, logits):
        total = None
        for logit in logits.values():
            dist = Categorical(logits=logit)
            if total is None:
                total = dist.entropy()
            else:
                total += dist.entropy()
        return total if total is not None else torch.tensor(0.0)
