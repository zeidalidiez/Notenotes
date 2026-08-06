# Notenotes documentation

The repository keeps only current, durable documentation. Git history and merged
pull requests preserve completed plans and investigation notes.

## Current references

- [`architecture.md`](architecture.md) maps the codebase and design boundaries.
- [`roadmap.md`](roadmap.md) records strategic directions, not scheduled work.
- [`manual-qa.md`](manual-qa.md) is the release and device verification checklist.
- [`AI_INTERFACE.md`](AI_INTERFACE.md) defines the optional AI feature contract.
- [`../AGENTS.md`](../AGENTS.md) contains repository-wide contributor rules.

## Where information belongs

- User-facing product information and setup: root [`README.md`](../README.md).
- Durable architecture and invariants: `AGENTS.md` or `architecture.md`.
- Repeatable behavior: automated tests.
- Actionable work with acceptance criteria: GitHub Issues and pull requests.
- Early exploration: GitHub Discussions.

Do not add dated implementation plans, completed-feature journals, PR screenshots,
or generated reports to `docs/`. Update an existing canonical document or rely on
the issue, PR, tests, and Git history instead.
