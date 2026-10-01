// Single source of truth for site-wide constants used by the build scripts.
// Nothing here is duplicated by hand in HTML: pages are regenerated from it.
export const SITE = 'https://relu.chat';
export const AUTHOR = {
  '@type': 'Person',
  name: 'Yunus Emre Vurgun',
  url: 'https://yunusemrevurgun.com',
  sameAs: ['https://github.com/yunusemrejr'],
};
export const GITHUB = 'https://github.com/yunusemrejr/relu-chat';

export const BOOK = {
  title: 'How to Remain Valuable When Intelligence Becomes Cheap',
  url: 'https://theknowledgeproject.gumroad.com/l/remainvaluable',
};
export const TOOLKIT_URL = 'https://theknowledgeproject.gumroad.com/l/ekuidr';

// Per-assistant presentation. Topic counts, names and content come from data/.
export const BOTS = {
  'game-theory-chat': {
    featured: ['nash_eq', 'prisoners_dilemma', 'shapley'],
    slug: 'game-theory',
    subject: 'Game theory',
    kind: 'strategy',
    titleSuffix: 'definition, intuition and example',
    labels: { def: 'Definition', int: 'Intuition', ex: 'Worked example', form: 'The math', app: 'Where it is used' },
    lead: 'Strategy, equilibrium and incentives, from the prisoner’s dilemma to mechanism design.',
  },
  'golden-age-inquiry': {
    featured: ['al_khwarizmi', 'house_of_wisdom', 'ibn_al_haytham'],
    slug: 'golden-age',
    subject: 'Islamic Golden Age',
    kind: 'strategy',
    titleSuffix: 'background, contributions and legacy',
    labels: { def: 'Who or what', int: 'Why it mattered', ex: 'Key works and moments', form: 'Further detail', app: 'Legacy' },
    lead: 'Scholars, institutions and ideas of the Islamic Golden Age: algebra, optics, medicine and philosophy.',
  },
  'data-science-chat': {
    featured: ['train_test_split', 'logistic_regression', 'distributions'],
    slug: 'data-science',
    subject: 'Data science',
    kind: 'ml',
    titleSuffix: 'explained with an example',
    labels: { def: 'Definition', int: 'Intuition', ex: 'Worked example', form: 'The math', app: 'In practice' },
    lead: 'Statistics, evaluation and machine-learning concepts with the math shown.',
  },
  'reinforcement-learning-chat': {
    featured: ['q-learning', 'bellman-equation', 'policy-gradient'],
    slug: 'reinforcement-learning',
    subject: 'Reinforcement learning',
    kind: 'ml',
    titleSuffix: 'explained with an example',
    labels: { def: 'Definition', int: 'Intuition', ex: 'Worked example', form: 'The math', app: 'In practice' },
    lead: 'Rewards, value functions, bandits, Q-learning and policy gradients.',
  },
  'linear-algebra-chat': {
    featured: ['eigenvalues-eigenvectors', 'dot-product', 'least-squares'],
    slug: 'linear-algebra',
    subject: 'Linear algebra',
    kind: 'ml',
    titleSuffix: 'explained with an example',
    labels: { def: 'Definition', int: 'Intuition', ex: 'Worked example', form: 'The math', app: 'In machine learning' },
    lead: 'Vectors, matrices, eigenvalues and projections: the algebra behind machine learning.',
  },
  'web-platform-chat': {
    featured: ['service-worker', 'event-loop', 'webassembly'],
    slug: 'web-platform',
    subject: 'Web platform',
    kind: 'web',
    titleSuffix: 'how it works, with an example',
    labels: { def: 'What it is', int: 'Why it matters', ex: 'Example', form: 'Technical detail', app: 'When to use it' },
    lead: 'Browser JavaScript, HTTP caching, WebAssembly, workers and local storage.',
  },
};

export const NAV = [
  { href: '/chat/', label: 'Chat', section: 'chat' },
  { href: '/learn/', label: 'Learn', section: 'learn' },
  { href: '/tools/', label: 'Tools', section: 'tools' },
  { href: '/blog/', label: 'Blog', section: 'blog' },
  { href: '/how-it-works.html', label: 'How it works', section: 'how' },
];

// Interactive tools, with the vocabulary used to relate them to topics.
export const TOOLS = [
  { slug: 'neural-network', blurb: 'Adjust weights and activations and watch a forward pass move through every neuron.', name: 'Neural Network Explorer', terms: ['neural network', 'neuron', 'forward pass', 'perceptron', 'hidden layer', 'relu', 'activation'] },
  { slug: 'activation-functions', blurb: 'Plot ReLU, Sigmoid, Tanh, GELU and more with their derivatives, and see why slope decides whether learning continues.', name: 'Activation Functions Explorer', terms: ['activation', 'relu', 'sigmoid', 'tanh', 'softmax', 'logistic'] },
  { slug: 'gradient-descent', blurb: 'Click a starting point, set the learning rate and follow each step down a loss surface.', name: 'Gradient Descent Lab', terms: ['gradient', 'descent', 'learning rate', 'optimization', 'loss', 'minimum', 'least squares', 'policy gradient'] },
  { slug: 'backpropagation', blurb: 'Walk the chain rule backwards through a 2→2→1 network with every gradient derived.', name: 'Backpropagation Visualizer', terms: ['backpropagation', 'chain rule', 'gradient', 'derivative'] },
  { slug: 'k-means-clustering', blurb: 'Add points, choose k and step through assignment and centroid updates as inertia shrinks.', name: 'K-Means Clustering Playground', terms: ['cluster', 'k-means', 'centroid', 'unsupervised', 'distance'] },
  { slug: 'decision-tree', blurb: 'Grow a tree one split at a time and watch Gini impurity fall, then overfitting appear.', name: 'Decision Tree Explorer', terms: ['decision tree', 'gini', 'impurity', 'classification', 'overfitting', 'split'] },
];

// Contextual copy for the book card on topic pages (mirrors the article variants).
export const BOOK_COPY = {
  strategy: 'Systems change; judgment stays scarce. <em>How to Remain Valuable When Intelligence Becomes Cheap</em> is a 224-page practical guide to the human, economic and strategic advantages that remain valuable even when AI can do most cognitive work.',
  ml: 'This page covered one corner of machine intelligence. <em>How to Remain Valuable When Intelligence Becomes Cheap</em> zooms out: a 224-page practical guide to the human strengths and strategic advantages that stay valuable as AI takes on more cognitive work.',
  web: 'Fast, private software that runs anywhere is one way to stay ahead of the curve. The bigger picture is in <em>How to Remain Valuable When Intelligence Becomes Cheap</em>: a 224-page practical guide to the human and strategic advantages that compound as AI improves.',
};
