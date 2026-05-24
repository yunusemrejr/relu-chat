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

const WELCOME = '<span style="font-size:1.125rem;font-weight:600;color:var(--text-primary);letter-spacing:-0.02em;">Game Theory Chat</span><br><br>Hi! I run <strong>entirely on-device</strong> — no servers, no API calls, no tracking. <br><br><strong>How it works:</strong> Your question is embedded with a transformer, then a signal layer combines BM25 sparse retrieval, entity extraction, and ensemble dense-sparse ranking into a calibrated decision packet. An <strong>RL-trained MLP policy network</strong> (13K params) decides mode, intent, tone, and topic composition. Responses are assembled from knowledge fragments with linguistic connectors — all in your browser.<br><br>First query warms up the model (~22 MB, cached). <a href="/how-it-works.html" style="color:var(--accent-light)">Read the architecture →</a>';

const botProfile = {
  id: "game-theory",
  name: "Game Theory Chat",
  allowedIntents: Object.keys(INTENTS),
  tone: "neutral",
  maxTopics: 3,
  creativityCeiling: 0.35
};

createChatbot({
  KB,
  entryText,
  CONFIG,
  INTENTS,
  overrides,
  suggestions: SUGGESTIONS,
  welcomeMessage: WELCOME,
  botProfile
});
