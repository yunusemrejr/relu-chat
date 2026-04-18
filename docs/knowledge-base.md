# Knowledge Base

Located at `chat/game-theory-chat/js/knowledge-base.js` — the "brain" of the assistant.

## Structure

Each entry is created with the `kb()` helper:

```js
kb(id, name, aliases, summary, {
  def: [...],
  int: [...],      // intuition
  ex: [...],       // examples
  form: [...],     // formal math / theorems
  app: [...]       // applications
})
```

- **`entryText()`**: Concatenates all content for embedding
- **Aliases**: Used for precise entity extraction via regex
- **Fragments**: Multiple phrasings per category allow for varied, natural responses

## Content Quality

- 55+ expertly written entries (as of April 2026)
- Heavy use of LaTeX for precision (`$...$`, `\\begin{pmatrix}...`)
- Balances intuition, rigor, and real-world applicability
- Concepts span non-cooperative, cooperative, mechanism design, evolutionary game theory, and more

## Example Entry (Nash Equilibrium)

See the first entry in the file for the full structured definition, intuition, examples (Prisoner's Dilemma, Matching Pennies), formal proof reference, and applications (oligopoly, auctions, PoA).

## Maintenance

To add a new concept:
1. Follow the exact schema
2. Provide rich content in all five categories when possible
3. Add relevant aliases
4. The system will automatically embed it on next load

This hand-crafted KB is what allows high-quality responses without a large language model.
