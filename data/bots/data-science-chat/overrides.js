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
  closers: ["", " Want me to go deeper on any piece?", " Ask me for a worked example.", " Happy to connect this to related topics."],
  seeAlsoPrefixes: ["See also: ", "Related topics: ", "You might also explore: ", "Further reading: "],
  comparisonOpeners: {
    both: "Both **{A}** and **{B}** are important in data science. ",
    contrast: "While **{A}** and **{B}** are related, they address different aspects of data science. ",
    similarity: "**{A}** and **{B}** share important structural similarities. ",
  },
  transitions: ["\n\nRelatedly, ", "\n\nClosely linked — ", "\n\nConnected idea: ", "\n\nBuilding on that, "],
  greetingResponse: "I'm an on-device assistant focused on **data science**. Ask me about pandas, NumPy, statistics, machine learning, classification, regression, clustering, feature engineering, model evaluation, and much more — all processing runs in your browser.",
  helpResponse: "I can discuss **data science** entirely on your device. Try:\n• \"Explain logistic regression\"\n• \"Example of data leakage\"\n• \"What is the bias-variance tradeoff?\"\n• \"Applications of PCA\"\n\nTopics I know include: pandas, NumPy, data cleaning, statistics, probability, visualization, regression, classification, decision trees, clustering, cross-validation, regularization, ensemble methods, PCA, time series, deployment, and many more (38 total).",
  offTopicResponse: "I specialize in **data science** and that query didn't map to anything I know well. Try asking about a concept like pandas DataFrames, logistic regression, cross-validation, regularization, clustering, or feature engineering."
};
