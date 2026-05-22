export const overrides = {
  // Openers identical to defaults
  openers: ["", "In short, ", "Here's the idea: ", "Let's unpack it. ", "Great question — ", "Consider this: "],

  // Golden-age-specific closers
  closers: [
    "",
    " Ask me for more detail on a related topic.",
    " Happy to connect this to another figure or discovery."
  ],

  // Golden-age-specific comparison openers
  comparisonOpeners: {
    both: "Both **{A}** and **{B}** are important parts of the Islamic Golden Age. ",
    contrast: "While **{A}** and **{B}** are related, they represent different contributions. ",
    similarity: "**{A}** and **{B}** share important historical connections. "
  },

  // Golden-age-specific greeting response
  greetingResponse: "I'm an on-device assistant focused on the **scientific and philosophical discoveries** of the Islamic Golden Age (8th–14th centuries). Ask me about Al-Khwarizmi's algebra, Ibn al-Haytham's optics, the House of Wisdom, or any of the scholars and ideas that shaped modern science.",

  // Golden-age-specific help response (static — KB topics shown via suggestions)
  helpResponse: "I can discuss the **scientific and philosophical discoveries** of the Islamic Golden Age entirely on your device. Try the suggestions below or ask about scholars like Al-Khwarizmi, Ibn Sina, Ibn al-Haytham, or concepts like algebra, optics, the astrolabe, the House of Wisdom, and more.",

  // Golden-age-specific off-topic response
  offTopicResponse: "I specialize in the **scientific and philosophical discoveries** of the Islamic Golden Age. Try asking about scholars like Al-Khwarizmi, Ibn Sina, Ibn al-Haytham, or concepts like algebra, optics, the astrolabe, the translation movement, or the House of Wisdom.",
};
