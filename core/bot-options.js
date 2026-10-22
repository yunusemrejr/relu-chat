// Per-assistant wording for the responder: how to name the subject in a
// sentence, and which short lead-ins suit each kind of fragment. History reads
// better without "For example:" in front of a scholar's works.
const SUBJECTS = {
  'game-theory-chat': 'game theory',
  'golden-age-inquiry': 'the Islamic Golden Age',
  'data-science-chat': 'data science',
  'reinforcement-learning-chat': 'reinforcement learning',
  'linear-algebra-chat': 'linear algebra',
  'web-platform-chat': 'the web platform',
};
const LEAD_INS = {
  'golden-age-inquiry': { ex: null, app: null },
};
// How to name each kind of fragment when suggesting what to ask next.
const ASK_FOR = {
  'golden-age-inquiry': { ex: 'key works', form: 'more detail', app: 'its legacy' },
};

/** @param {string} botId */
export function botOptions(botId) {
  return {
    subject: SUBJECTS[botId],
    leadIns: LEAD_INS[botId] || { ex: 'For example: ' },
    askFor: ASK_FOR[botId] || { ex: 'an example', form: 'the math', app: 'where it is used' },
  };
}
