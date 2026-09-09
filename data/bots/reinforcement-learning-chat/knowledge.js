export const KB_VERSION = '2.0.0';
export const KB_UPDATED = '2026-09-09';
export const KB = [
  {
    "id": "reinforcement-learning",
    "name": "Reinforcement learning",
    "aliases": [
      "reinforcement learning",
      "rl",
      "agent",
      "environment"
    ],
    "summary": "Reinforcement learning studies agents that improve decisions through interaction and reward. The objective is expected return over time, not simply predicting a labeled answer.",
    "f": {
      "int": [
        "An action can change both the immediate payoff and the situations the agent sees next. That delayed effect distinguishes a sequential problem from a one-step prediction."
      ],
      "ex": [
        "A robot may take a longer route now to reach a charging station before attempting a delivery."
      ],
      "form": [
        "A policy maps a state to an action distribution: $\\pi(a|s)$. An agent seeks to maximize expected cumulative reward."
      ],
      "app": [
        "Use RL when actions affect future opportunities and you can evaluate a reward safely. Start with a simple baseline."
      ],
      "def": [
        "Reinforcement learning studies agents that improve decisions through interaction and reward. The objective is expected return over time, not simply predicting a labeled answer."
      ]
    },
    "related": [
      "markov-decision-process"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "markov-decision-process",
    "name": "Markov decision process",
    "aliases": [
      "markov decision process",
      "mdp",
      "markov property",
      "state"
    ],
    "summary": "An MDP describes states, actions, transition probabilities, rewards, and a discount factor. A state is Markov when it contains the information needed to predict the next transition given the action.",
    "f": {
      "int": [
        "A position alone is insufficient for a moving vehicle: velocity also affects what happens next. State design matters as much as the learning algorithm."
      ],
      "ex": [
        "In a grid world, the state can be the current cell, actions are four directions, and reaching the goal ends the episode."
      ],
      "form": [
        "An MDP is commonly written $(S,A,P,R,\\gamma)$. The transition model is $P(s^{\\prime}|s,a)$."
      ],
      "app": [
        "Use the MDP description to test whether observation history or hidden variables are missing from your agent input."
      ],
      "def": [
        "An MDP describes states, actions, transition probabilities, rewards, and a discount factor. A state is Markov when it contains the information needed to predict the next transition given the action."
      ]
    },
    "related": [
      "reward-return"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "reward-return",
    "name": "Reward and return",
    "aliases": [
      "reward and return",
      "return",
      "discount factor",
      "gamma",
      "cumulative reward"
    ],
    "summary": "Reward is feedback for one transition; return aggregates rewards across future steps. They are different learning targets.",
    "f": {
      "int": [
        "A small immediate reward can lead to a poor overall outcome. Discounting expresses how future rewards contribute, but also changes the task objective."
      ],
      "ex": [
        "For rewards 1, 2, 3 and discount 0.5, the return is 1 + 0.5 × 2 + 0.25 × 3 = 2.75."
      ],
      "form": [
        "The discounted return is $G_t=\\sum_{k=0}^{\\infty}\\gamma^k R_{t+k+1}$. Finite episodic sums stop at termination."
      ],
      "app": [
        "Check the timing and scale of rewards before tuning a model; a sign or off-by-one error can reverse the learned behavior."
      ],
      "def": [
        "Reward is feedback for one transition; return aggregates rewards across future steps. They are different learning targets."
      ]
    },
    "related": [
      "exploration-exploitation"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "exploration-exploitation",
    "name": "Exploration and exploitation",
    "aliases": [
      "exploration and exploitation",
      "exploration",
      "exploitation",
      "epsilon greedy"
    ],
    "summary": "Exploration tries actions to learn about their outcomes; exploitation chooses actions that currently appear best.",
    "f": {
      "int": [
        "A restaurant with one good review may look best only because you have not tried alternatives. Uncertainty matters."
      ],
      "ex": [
        "With epsilon = 0.1 and two actions, epsilon-greedy picks the greedy action with probability 0.9 + 0.1/2 = 0.95."
      ],
      "form": [
        "In epsilon-greedy, take a uniformly random action with probability $\\epsilon$ and an estimated best action otherwise."
      ],
      "app": [
        "Explore during training where mistakes are controlled. Evaluate separately with a fixed policy so exploration noise does not hide progress."
      ],
      "def": [
        "Exploration tries actions to learn about their outcomes; exploitation chooses actions that currently appear best."
      ]
    },
    "related": [
      "contextual-bandit"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "contextual-bandit",
    "name": "Contextual bandit",
    "aliases": [
      "contextual bandit",
      "bandit",
      "multi armed bandit",
      "one step rl"
    ],
    "summary": "A contextual bandit chooses an action using the current context and receives one-step reward. It does not model how the action changes future states.",
    "f": {
      "int": [
        "Choosing an answer format is often closer to a bandit than to a long-horizon control problem, unless future conversation effects are explicitly rewarded."
      ],
      "ex": [
        "A tutor selects a short explanation or a worked example for a question, then receives an evaluation score for that response."
      ],
      "form": [
        "Choose $a\\sim\\pi(\\cdot|x)$ and optimize $\\mathbb{E}[r(x,a)]$. There is no bootstrapped next-state target."
      ],
      "app": [
        "Use a bandit for small routing decisions and compare it against rules and supervised learning before adding complexity."
      ],
      "def": [
        "A contextual bandit chooses an action using the current context and receives one-step reward. It does not model how the action changes future states."
      ]
    },
    "related": [
      "value-function"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "value-function",
    "name": "Value function",
    "aliases": [
      "value function",
      "state value",
      "v function",
      "value estimate"
    ],
    "summary": "A state-value function estimates expected return from a state when following a particular policy. It depends on both the environment and the policy.",
    "f": {
      "int": [
        "Value is the promise of future reward from where you are, averaged over what the policy will do."
      ],
      "ex": [
        "A cell near the goal can have low value if a hazardous transition makes failure likely. Distance alone does not determine value."
      ],
      "form": [
        "$V^\\pi(s)=\\mathbb{E}_{\\pi}[G_t|S_t=s]$. An action-value function additionally conditions on the first action."
      ],
      "app": [
        "Value estimates guide planning, actor-critic baselines, and debugging of unexpectedly preferred states."
      ],
      "def": [
        "A state-value function estimates expected return from a state when following a particular policy. It depends on both the environment and the policy."
      ]
    },
    "related": [
      "bellman-equation"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "bellman-equation",
    "name": "Bellman equation",
    "aliases": [
      "bellman equation",
      "bellman expectation",
      "bellman optimality"
    ],
    "summary": "A Bellman equation relates value now to expected immediate reward plus discounted value after the next transition.",
    "f": {
      "int": [
        "It breaks a long-horizon prediction into a local consistency condition."
      ],
      "ex": [
        "With certain reward 2, next-state value 5, and discount 0.9, a consistent current value is 2 + 0.9 × 5 = 6.5."
      ],
      "form": [
        "$V^\\pi(s)=\\sum_a\\pi(a|s)\\sum_{s^{\\prime}}P(s^{\\prime}|s,a)[R(s,a,s^{\\prime})+\\gamma V^\\pi(s^{\\prime})]$."
      ],
      "app": [
        "Use Bellman residuals to diagnose value estimates, while remembering that a small training residual does not guarantee good unseen behavior."
      ],
      "def": [
        "A Bellman equation relates value now to expected immediate reward plus discounted value after the next transition."
      ]
    },
    "related": [
      "q-learning"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "q-learning",
    "name": "Q-learning",
    "aliases": [
      "q-learning",
      "q learning",
      "q value",
      "temporal difference"
    ],
    "summary": "Q-learning is an off-policy temporal-difference method that updates an action-value estimate toward a reward plus the best estimated next-state value.",
    "f": {
      "int": [
        "It learns about a greedy target policy even when behavior explores other actions."
      ],
      "ex": [
        "If Q = 2, reward = 1, next best Q = 4, discount = 0.9, and learning rate = 0.5, the updated value is 3.3."
      ],
      "form": [
        "$Q(s,a)\\leftarrow Q(s,a)+\\alpha[r+\\gamma\\max_{a^{\\prime}}Q(s^{\\prime},a^{\\prime})-Q(s,a)]$. At a true terminal state, omit the bootstrap term."
      ],
      "app": [
        "A small tabular Q-learning task is a useful first baseline before neural networks and replay buffers."
      ],
      "def": [
        "Q-learning is an off-policy temporal-difference method that updates an action-value estimate toward a reward plus the best estimated next-state value."
      ]
    },
    "related": [
      "sarsa"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "sarsa",
    "name": "SARSA",
    "aliases": [
      "sarsa",
      "on policy td",
      "state action reward state action"
    ],
    "summary": "SARSA updates an action-value estimate using the next action actually chosen by the behavior policy. It is an on-policy TD control method.",
    "f": {
      "int": [
        "Because the target includes exploratory actions, the learner accounts for the risks of its own exploration."
      ],
      "ex": [
        "In a cliff-walking task, exploratory moves near the edge can make SARSA prefer a safer route during training."
      ],
      "form": [
        "$Q(s,a)\\leftarrow Q(s,a)+\\alpha[r+\\gamma Q(s^{\\prime},a^{\\prime})-Q(s,a)]$, where $a^{\\prime}$ is sampled from the behavior policy."
      ],
      "app": [
        "Compare SARSA and Q-learning under the same exploration schedule to separate behavior-policy effects from implementation differences."
      ],
      "def": [
        "SARSA updates an action-value estimate using the next action actually chosen by the behavior policy. It is an on-policy TD control method."
      ]
    },
    "related": [
      "policy-gradient"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "policy-gradient",
    "name": "Policy gradient",
    "aliases": [
      "policy gradient",
      "reinforce",
      "score function",
      "policy gradients"
    ],
    "summary": "Policy-gradient methods adjust a parameterized action distribution to increase expected return. REINFORCE uses sampled returns to weight log-probability gradients.",
    "f": {
      "int": [
        "Increase the probability of actions that performed better than expected, and reduce it for worse outcomes."
      ],
      "ex": [
        "If choosing a worked example earns more reward than the baseline, its sampled log-probability receives a positive learning signal."
      ],
      "form": [
        "$\\nabla J(\\theta)=\\mathbb{E}[\\nabla\\log\\pi_\\theta(a|s)(G-b(s))]$ for an action-independent baseline."
      ],
      "app": [
        "Use fresh on-policy samples or a justified off-policy correction; replaying old log probabilities as if current can invalidate the update."
      ],
      "def": [
        "Policy-gradient methods adjust a parameterized action distribution to increase expected return. REINFORCE uses sampled returns to weight log-probability gradients."
      ]
    },
    "related": [
      "actor-critic"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "actor-critic",
    "name": "Actor-critic",
    "aliases": [
      "actor-critic",
      "actor critic",
      "advantage",
      "baseline"
    ],
    "summary": "Actor-critic methods combine a policy, the actor, with a learned value estimator, the critic. The critic supplies a lower-variance learning signal.",
    "f": {
      "int": [
        "The actor chooses; the critic estimates how much better an outcome was than expected."
      ],
      "ex": [
        "For reward 1, discount 0.9, next value 4, and current value 3, the one-step TD advantage estimate is 1.6."
      ],
      "form": [
        "$\\delta_t=r_t+\\gamma V(s_{t+1})-V(s_t)$. A terminal transition uses zero next-state value."
      ],
      "app": [
        "Inspect critic loss and policy behavior together: an inaccurate critic can confidently push the actor in the wrong direction."
      ],
      "def": [
        "Actor-critic methods combine a policy, the actor, with a learned value estimator, the critic. The critic supplies a lower-variance learning signal."
      ]
    },
    "related": [
      "experience-replay"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "experience-replay",
    "name": "Experience replay",
    "aliases": [
      "experience replay",
      "replay buffer",
      "off policy",
      "replay"
    ],
    "summary": "Experience replay stores transitions and samples them later for learning. It can reduce sample correlation and reuse expensive experience.",
    "f": {
      "int": [
        "Reusing data saves environment interaction, but old data was collected under older behavior policies."
      ],
      "ex": [
        "A DQN buffer stores state, action, reward, next state, and terminal status, then samples a minibatch."
      ],
      "form": [
        "Off-policy value learning can use replay under its assumptions; a naive on-policy REINFORCE update cannot simply reuse stale policy log probabilities."
      ],
      "app": [
        "Bound replay memory on a laptop and measure useful updates per second rather than maximizing buffer size."
      ],
      "def": [
        "Experience replay stores transitions and samples them later for learning. It can reduce sample correlation and reuse expensive experience."
      ]
    },
    "related": [
      "reward-shaping"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "reward-shaping",
    "name": "Reward shaping",
    "aliases": [
      "reward shaping",
      "potential shaping",
      "reward hacking",
      "reward design"
    ],
    "summary": "Reward shaping adds learning guidance. Poorly designed rewards can teach an agent to optimize a proxy while failing the intended task.",
    "f": {
      "int": [
        "Rewarding long answers may produce verbosity instead of accuracy. A reward must reflect what you actually want to improve."
      ],
      "ex": [
        "A maze agent rewarded whenever it approaches a goal may exploit repeated movements unless the shaping rule is designed carefully."
      ],
      "form": [
        "Potential-based shaping uses $F(s,a,s^{\\prime})=\\gamma\\Phi(s^{\\prime})-\\Phi(s)$, with assumptions and terminal handling needed for policy invariance."
      ],
      "app": [
        "Evaluate real task outcomes separately from the optimized reward and keep explicit failure examples in the test set."
      ],
      "def": [
        "Reward shaping adds learning guidance. Poorly designed rewards can teach an agent to optimize a proxy while failing the intended task."
      ]
    },
    "related": [
      "rl-evaluation"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "rl-evaluation",
    "name": "RL evaluation",
    "aliases": [
      "rl evaluation",
      "evaluation",
      "held out",
      "random seed",
      "test set"
    ],
    "summary": "RL evaluation measures a fixed policy on tasks, seeds, or environments that were not used to choose its parameters. Training reward alone is insufficient.",
    "f": {
      "int": [
        "A student can memorize practice questions. Evaluation asks whether the learned behavior transfers."
      ],
      "ex": [
        "Train on one set of question templates, tune on another, and reserve new topics and paraphrases for the final test."
      ],
      "form": [
        "Report per-task outcomes, sample counts, and variability across seeds. A point estimate without a denominator can mislead."
      ],
      "app": [
        "Compare against random, rule-based, and supervised baselines. Report failures as well as averages."
      ],
      "def": [
        "RL evaluation measures a fixed policy on tasks, seeds, or environments that were not used to choose its parameters. Training reward alone is insufficient."
      ]
    },
    "related": [
      "efficient-rl-on-a-laptop"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "efficient-rl-on-a-laptop",
    "name": "Efficient RL on a laptop",
    "aliases": [
      "efficient rl on a laptop",
      "cpu training",
      "fast training",
      "ten minute",
      "small policy"
    ],
    "summary": "Efficient laptop training starts with a small decision problem, compact features, vectorized batches, and a fixed wall-clock budget.",
    "f": {
      "int": [
        "A larger network cannot rescue a broken reward or mismatched feature representation. Fix those first."
      ],
      "ex": [
        "For answer routing, a 25-input MLP can train on CPU without updating a language model or downloading GPU packages."
      ],
      "form": [
        "Measure total wall time including feature preparation, training, export, and evaluation; preserve the best validation checkpoint."
      ],
      "app": [
        "Cap numerical-library threads to avoid oversubscription. Stop on a deadline and refuse to deploy a model that fails held-out checks."
      ],
      "def": [
        "Efficient laptop training starts with a small decision problem, compact features, vectorized batches, and a fixed wall-clock budget."
      ]
    },
    "related": [
      "termination-truncation"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  },
  {
    "id": "termination-truncation",
    "name": "Termination and truncation",
    "aliases": [
      "termination and truncation",
      "terminal",
      "truncated",
      "time limit",
      "episode"
    ],
    "summary": "Termination means the task reached an end state. Truncation means an external limit stopped observation, even if the underlying task could continue.",
    "f": {
      "int": [
        "Running out of test time is different from reaching the goal. Confusing them changes the value target."
      ],
      "ex": [
        "A robot reaches its destination: termination. A simulator stops after 200 steps while the robot is moving: truncation."
      ],
      "form": [
        "For a genuine terminal state, the next-state value is zero. Time-limit truncation may still require bootstrapping when the task continues."
      ],
      "app": [
        "Store both flags in a replay buffer and test the target for each case. Use the environment semantics to decide whether the horizon is part of the task."
      ],
      "def": [
        "Termination means the task reached an end state. Truncation means an external limit stopped observation, even if the underlying task could continue."
      ]
    },
    "related": [
      "reinforcement-learning"
    ],
    "sources": [
      {
        "title": "Sutton & Barto, Reinforcement Learning",
        "url": "https://incompleteideas.net/book/RLbook2020.pdf"
      }
    ]
  }
];
export function entryText(e) { return `${e.name} ${e.aliases.join(' ')} ${e.summary} ${Object.values(e.f).flat().map(x => typeof x === 'string' ? x : x.text).join(' ')}`; }
