export const overrides = {
  openers: ["", "In short, ", "Here's the idea: ", "Let's unpack it. ", "Great question — ", "Consider this: "],
  connectors: {
    def_to_int: ["Intuitively, ", "Put differently, ", "Informally, ", "In essence, ", "To paraphrase, "],
    int_to_ex: ["For instance, ", "As a classic example, ", "Consider: ", "A concrete case — ", "To illustrate, "],
    ex_to_form: ["Formally, ", "Mathematically, ", "Theoretically, ", "From a rigorous standpoint, ", "In formal terms, "],
    form_to_app: ["Applications include ", "It is applied in ", "Practical uses: ", "It shows up in ", "Real-world uses: "],
    def_to_ex: ["For example, ", "As an illustration, ", "Concretely, ", "A classic case: "],
    def_to_form: ["More formally, ", "Rigorously, ", "Precisely, "],
    app_to_ex: ["For example, ", "A concrete case: ", "As an illustration, "],
    app_to_int: ["The intuition is that ", "Intuitively, "]
  },
  closers: ["", " Want me to go deeper on any piece?", " Ask me for a worked example or a related concept.", " Happy to connect this to another topic if helpful."],
  seeAlsoPrefixes: ["See also: ", "Related topics: ", "You might also explore: ", "Further reading: "],
  comparisonOpeners: {
    both: "Both **{A}** and **{B}** are fundamental concepts in game theory. ",
    contrast: "While **{A}** and **{B}** are related, they capture different strategic phenomena. ",
    similarity: "**{A}** and **{B}** share important structural similarities. ",
  },
  transitions: ["\n\nRelatedly, ", "\n\nClosely linked — ", "\n\nConnected idea: ", "\n\nBuilding on that, "],
  greetingResponse: "I'm an on-device assistant focused on **mathematical game theory**. Ask me about Nash equilibrium, Shapley values, auctions, evolutionary stability, or any of 55+ topics I know — all processing runs in your browser.",
  helpResponse: "I can discuss **mathematical game theory** entirely on your device. Try:\n• \"Define Nash equilibrium\"\n• \"Example of a zero-sum game\"\n• \"Formal definition of the Shapley value\"\n• \"Applications of mechanism design\"\n\nTopics I know include: Nash equilibrium, Prisoner's Dilemma, Shapley value, Zero-sum game, Dominant strategy, Nash equilibrium, Minimax, Evolutionary stable strategy, Mechanism design, Auction theory, Bargaining, Repeated games, Subgame perfect equilibrium, Bayesian Nash equilibrium, correlated equilibrium, and many more (55 total).",
  offTopicResponse: "I specialize in **mathematical game theory** and that query didn't map to anything I know well. Try asking about a concept like Nash equilibrium, the Prisoner's Dilemma, auctions, bargaining, or evolutionary strategies."
};
