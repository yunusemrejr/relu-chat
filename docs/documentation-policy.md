# Documentation Policy

## Core Rule

**The `docs/` folder is strictly local-only.**

It must **never** be published to:
- The remote GitHub repository (`https://github.com/yunusemrejr/relu-chat`)
- The production server (`relu.chat` / reult.chat)

## Purpose of This Policy

- Documentation contains sensitive deployment details, architecture notes, and internal processes.
- It serves as a living knowledge base for developers working on the local codebase.
- Keeping it offline maintains security and prevents leakage of operational knowledge.

## Rules Enforced

1. `docs/` is explicitly listed in `.gitignore`
2. All deployment scripts (`.deployignore`, `deploy.sh`) exclude the `docs/` directory
3. No commit that adds or modifies `docs/` files should ever be pushed to remote
4. If `docs/` ever appears in remote history, it must be immediately purged via history rewrite (`filter-repo`, `filter-branch`, or force push after removal)
5. This policy document is part of the `docs/` folder itself and must be kept up to date

## How Documentation Stays Local

- All documentation work happens in the local clone
- Changes are committed to the **local git repository only**
- The `docs/` folder exists only on:
  - This local development machine
  - (Potentially) the production server’s filesystem for admin reference (but never served publicly)

## Related Systems

- **Remote Repository**: https://github.com/yunusemrejr/relu-chat (public, cleaned of all sensitive data and documentation)
- **Deployment**: Via `deploy.sh` + lftp to shared hosting (respects `.deployignore`)
- **Production Environment**: Static files only on `relu.chat` (no backend, no docs folder exposed)
- **Offline Repository**: Local clone contains full history + `docs/`

This policy is self-documenting and must be respected in all future work on this project.

**Last updated**: April 2026
