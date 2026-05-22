import { KB, entryText } from '../../../data/bots/game-theory-chat/knowledge.js';
import { INTENTS } from '../../../data/bots/game-theory-chat/intents.js';
import { CONFIG } from './config.js';
import { overrides } from '../../../data/bots/game-theory-chat/overrides.js';
import { createChatbot } from '../../../core/chatbot-engine.js';

const SUGGESTIONS = [
  "What is Nash equilibrium?",
  "Example of a zero-sum game",
  "Formal definition of Shapley value",
  "Explain evolutionarily stable strategies",
  "Applications of mechanism design",
  "Prisoner's dilemma explained",
  "Minimax theorem",
  "Rubinstein bargaining"
];

const WELCOME = '<span style="font-size:1.125rem;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;">Game Theory Chat</span><br><br>Hi! I\'m an <strong>on-device</strong> assistant specialized in <strong>mathematical game theory</strong>. I understand your question with a transformer running entirely in your browser and compose responses from weighted concept fragments — nothing is sent to a server.<br><br>The first query will warm up the model (a one-time download). Try a suggestion below, or ask your own question.';

createChatbot({
  KB,
  entryText,
  CONFIG,
  INTENTS,
  overrides,
  suggestions: SUGGESTIONS,
  welcomeMessage: WELCOME
});
