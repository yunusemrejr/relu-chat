import { KB, entryText } from '../../../data/bots/golden-age-inquiry/knowledge.js';
import { INTENTS } from '../../../data/bots/golden-age-inquiry/intents.js';
import { CONFIG } from './config.js';
import { overrides } from '../../../data/bots/golden-age-inquiry/overrides.js';
import { createChatbot } from '../../../core/chatbot-engine.js';
import { pushMessage } from '../../../core/ui.js';

const SUGGESTIONS = [
  "Who was Al-Khwarizmi?",
  "What was the House of Wisdom?",
  "How did Ibn al-Haytham discover optics?",
  "Explain the Tusi couple",
  "What is the Canon of Medicine?",
  "Tell me about the astrolabe",
  "How did paper spread to Europe?",
  "Who discovered pulmonary circulation?"
];

const welcomeMessage =
  '<span style="font-size:1.125rem;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;">Golden Age Inquiry</span><br><br>Hi! I\'m an <strong>on-device</strong> assistant specialized in the <strong>scientific and philosophical discoveries</strong> of the Islamic Golden Age (8th–14th centuries). I understand your question with a transformer running entirely in your browser and compose responses from weighted concept fragments — nothing is sent to a server.<br><br>The first query will warm up the model (a one-time download). Try a suggestion below, or ask your own question.';

createChatbot({
  KB,
  entryText,
  CONFIG,
  INTENTS,
  overrides,
  suggestions: SUGGESTIONS,
  welcomeMessage,
});
