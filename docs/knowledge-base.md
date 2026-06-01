# Knowledge Base

Located at `chat/game-theory-chat/js/knowledge-base.js` — the "brain" of the assistant.

## Versioning

- **Version**: `KB_VERSION = '1.1.0'`
- **Last updated**: `KB_UPDATED = '2026-04-18'`

## Structure

Each entry is created with the `kb()` helper:

```js
kb(id, name, aliases, summary, {
  def: [...],
  int: [...],      // intuition
  ex: [...],       // examples
  form: [...],     // formal math / theorems
  app: [...]       // applications
}, related)        // array of related concept IDs
```

- **`entryText()`**: Concatenates all content for embedding
- **Aliases**: Used for precise entity extraction via **pre-compiled regex**
- **Fragments**: Multiple phrasings per category allow for varied, natural responses
- **Related**: Cross-references to conceptually linked entries (e.g., Nash Equilibrium ↔ SPE ↔ PBE)

## Content Quality

- 55+ expertly written entries (as of April 2026)
- Heavy use of LaTeX for precision (`$...$`, `\\begin{pmatrix}...`)
- Balances intuition, rigor, and real-world applicability
- Concepts span non-cooperative, cooperative, mechanism design, evolutionary game theory, and more
- Interlinked with `related` cross-references for "See also" suggestions

## Example Entry (Nash Equilibrium)

See the first entry in the file for the full structured definition, intuition, examples (Prisoner's Dilemma, Matching Pennies), formal proof reference, applications (oligopoly, auctions, PoA), and related concepts (SPE, PBE, mixed strategies, dominant strategies).

## Maintenance

To add a new concept:
1. Follow the exact schema
2. Provide rich content in all five categories when possible
3. Add relevant aliases
4. Add `related` cross-references to conceptually linked entries
5. The system will automatically embed it on next load

This hand-crafted KB is what allows high-quality responses without a large language model.
