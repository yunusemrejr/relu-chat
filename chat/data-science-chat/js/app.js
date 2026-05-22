import { KB, entryText } from '../../../data/bots/data-science-chat/knowledge.js';
import { INTENTS } from '../../../data/bots/data-science-chat/intents.js';
import { CONFIG } from './config.js';
import { overrides } from '../../../data/bots/data-science-chat/overrides.js';
import { createChatbot } from '../../../core/chatbot-engine.js';

const SUGGESTIONS = [
  "What is logistic regression?",
  "Example of data leakage",
  "Explain the bias-variance tradeoff",
  "What is a pandas DataFrame?",
  "How does cross-validation work?",
  "Formal definition of PCA",
  "Applications of ensemble methods",
  "Difference between precision and recall"
];

const WELCOME = '<span style="font-size:1.125rem;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;">Data Science Chat</span><br><br>Hi! I\'m an <strong>on-device</strong> assistant specialized in <strong>data science</strong>. I understand your question with a transformer running entirely in your browser and compose responses from weighted concept fragments — nothing is sent to a server.<br><br>The first query will warm up the model (a one-time download). Try a suggestion below, or ask your own question.';

createChatbot({
  KB,
  entryText,
  CONFIG,
  INTENTS,
  overrides,
  suggestions: SUGGESTIONS,
  welcomeMessage: WELCOME,
});
