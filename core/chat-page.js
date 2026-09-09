import { createChatbot } from './chatbot-engine.js';
import { setStatus } from './ui.js';
const CONFIG = {
  EMBEDDING: { model: 'all-MiniLM-L6-v2', quantized: true },
  THRESHOLDS: { OFF_TOPIC: 0.15, SECONDARY_ENTRY: 0.38, ENTITY_BOOST: 0.45, CONFIDENCE: { definition: .2, example: .22, formal: .25, application: .22, comparison: .25, greeting: .3, help: .3 } },
  COMPOSITION: { FRAGMENT_TEMP: .4, OPENER_WEIGHT: 0, MAX_ENTRIES: 2 },
  CACHE: { MAX_SIZE: 250, QUERY_EMB_MAX: 64 },
};
export async function bootChat(bot) {
  try {
    const [{ KB, entryText }, { INTENTS }, { overrides }] = await Promise.all([
      import(`/data/bots/${bot.id}/knowledge.js`),
      import(`/data/bots/${bot.id}/intents.js`),
      import(`/data/bots/${bot.id}/overrides.js`),
    ]);
    const topics = document.getElementById('topic-list');
    for (const button of topics.querySelectorAll('button[data-question]')) {
      button.addEventListener('click', () => {
        const input = document.getElementById('input'); input.value = button.dataset.question; input.focus();
      });
    }
    await createChatbot({ KB, entryText, INTENTS, CONFIG,
      overrides: { ...overrides, helpResponse: `I can explain ${KB.length} topics in ${bot.name.replace(/ Chat$/, '')}. Ask a question, request an example, or say “what do you mean?” to revisit an explanation.\n\nTry:\n${bot.suggestions.map(q => '• ' + q).join('\n')}`, openers: [''], closers: [''], transitions: ['\n\n'], connectors: Object.fromEntries(['def_to_int','int_to_ex','ex_to_form','form_to_app','def_to_ex','def_to_form','app_to_ex','app_to_int'].map(key => [key, ['\n\n']])) },
      suggestions: bot.suggestions,
      welcomeMessage: 'Choose a question below or ask about a topic. Your conversation stays in this browser. Use “Save chat” to keep a copy.',
      botProfile: { id: bot.id, name: bot.name, allowedIntents: Object.keys(INTENTS), tone: 'neutral', maxTopics: 2, creativityCeiling: .2 },
    });
  } catch (error) {
    console.error('[chat] Unable to start:', error);
    setStatus('Unable to load chat. Reload to retry.', false);
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
