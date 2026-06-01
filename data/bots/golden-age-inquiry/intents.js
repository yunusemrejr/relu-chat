export const INTENTS = {
  definition: {
    prototypes: [
      "what is X",
      "define X",
      "explain X",
      "what does X mean",
      "tell me about X",
      "describe X",
      "who was X",
      "who is X",
      "what was X",
      "explain the concept of X"
    ],
    order: ['def', 'int', 'ex']
  },
  example: {
    prototypes: [
      "give an example of X",
      "show me an example",
      "example of X",
      "illustrate X",
      "concrete case of X",
      "an example of X",
      "show an example",
      "give examples of X",
      "illustrate with an example"
    ],
    order: ['ex', 'int', 'def']
  },
  formal: {
    prototypes: [
      "formal definition of X",
      "prove X",
      "theorem about X",
      "math behind X",
      "derive X",
      "equation for X",
      "formalism of X",
      "mathematical definition of X",
      "proof of X",
      "formal proof of X",
      "rigorous definition of X",
      "formal treatment of X",
      "mathematical formulation of X"
    ],
    order: ['form', 'def', 'ex']
  },
  application: {
    prototypes: [
      "applications of X",
      "where is X used",
      "uses of X",
      "real world X",
      "practical use of X",
      "why is X useful",
      "how is X applied",
      "real-world applications of X",
      "where does X apply",
      "practical applications of X",
      "use cases of X"
    ],
    order: ['app', 'ex', 'int']
  },
  comparison: {
    prototypes: [
      "difference between X and Y",
      "X vs Y",
      "compare X and Y",
      "how is X different from Y",
      "relation between X and Y",
      "X versus Y",
      "X compared to Y",
      "compare X with Y"
    ],
    order: ['def', 'int', 'ex']
  },
  greeting: {
    prototypes: [
      "hi",
      "hello",
      "hey there",
      "good morning",
      "how are you",
      "what up",
      "hey",
      "hi there",
      "good afternoon",
      "good evening"
    ],
    order: null
  },
  help: {
    prototypes: [
      "help",
      "what can you do",
      "how do i use this",
      "what topics do you know",
      "menu",
      "what can you help with",
      "list topics",
      "what do you know"
    ],
    order: null
  }
};

// Intents order configuration (topics category)
export const INTENTS_ORDER = [
  'definition',
  'example',
  'formal',
  'application',
  'comparison',
  'greeting',
  'help'
];
