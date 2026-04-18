# Game Theory Chat

The flagship chatbot at `/chat/game-theory-chat/`.

## Capabilities

- Explains 55+ core concepts in mathematical game theory
- Handles questions about definitions, intuitions, examples, formal math, and applications
- Uses transformer embeddings for semantic search
- Generates coherent, natural-sounding responses with proper mathematical notation
- Provides metadata about intent and confidence

## Topics Covered

From the knowledge base:
- **Equilibrium Concepts**: Nash Equilibrium, Dominant Strategies, Mixed Strategies, Evolutionary Stable Strategies
- **Classic Games**: Prisoner's Dilemma, Matching Pennies, Battle of the Sexes, Hawk-Dove
- **Solution Concepts**: Shapley Value, Core, Nucleolus, Subgame Perfect Equilibrium
- **Mechanism Design**: Auctions (Vickrey, First-price, All-pay), VCG mechanisms, Price of Anarchy
- **Advanced**: Bayesian Games, Repeated Games, Bargaining (Rubinstein), Cooperative Game Theory, Zero-sum games

## UI Features

- Auto-growing textarea
- Suggestion chips with example queries
- Real-time typing indicator
- KaTeX-rendered math
- Response metadata tags (intent, similarity, entities)
- Dark technical design matching the landing page

## Technical Implementation

See:
- [NLP & Retrieval Pipeline](nlp-pipeline.md)
- [Knowledge Base](knowledge-base.md)
- [Architecture](architecture.md)
