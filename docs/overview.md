# Project Overview

**ReLU.chat** is a demonstration of what is possible with modern in-browser machine learning. It hosts specialized chatbots that require **zero backend infrastructure**.

## What is ReLU.chat?

A static website featuring:
- Beautiful dark-themed marketing landing page (`index.html`)
- Fully functional **Game Theory Chat** — an expert-level assistant for concepts like Nash equilibrium, Shapley values, mechanism design, auctions, and more
- Future-ready architecture for adding more domain-specific chatbots (e.g. quantum computing, cryptography, etc.)

## Key Differentiators

- **Privacy**: All computation happens in the user's browser using WebAssembly
- **No LLMs**: Uses classical embedding + retrieval augmented generation (RAG) with a hand-crafted knowledge base
- **Mathematical Precision**: Responses include properly typeset LaTeX equations via KaTeX
- **Lightweight**: The entire experience (model + KB + UI) loads quickly even on modest hardware
- **Configurable**: All thresholds and parameters centralized in `config.js`

## Current Chatbots

1. **Game Theory Chat** (`/chat/game-theory-chat/`)
   - Deep knowledge of cooperative and non-cooperative game theory
   - Structured knowledge base with definitions, intuitions, examples, formal math, and real-world applications
   - Intent classification and smart response composition
   - Conversation context tracking for follow-up questions
   - Cross-referenced concepts via `related` field

The project name is a pun on the **ReLU** activation function and "**real** local" compute.

See [How It Works](how-it-works.md) for technical details.
