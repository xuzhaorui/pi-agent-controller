# Pi Agent Controller

A deterministic controller loop for continuously advancing GitHub Issues with Pi agents in isolated Git worktrees.

Pi Agent Controller is designed for a **Pi + WSL** workflow where Pi provides long-lived context and model switching, while the controller provides the missing orchestration loop:

```text
GitHub Task → Claim → Worktree → Worker → Verify → Review → Merge → Next Task
```

The controller stops only for an explicit reason such as an empty backlog, a blocker, a human decision, a user pause, or an exhausted run budget.

## Status

Specification stage. No implementation has been released yet.

- [Product specification](docs/spec.md)
- [Domain glossary](docs/domain-glossary.md)
- [Background](2026-07-30-pi与WSL结合优势.md)

## MVP principles

- Deterministic reconciliation, not an LLM deciding whether to continue
- GitHub Issues as task intent; Git as code truth; durable journal as execution truth
- One active task in one isolated worktree
- Structured worker and reviewer results
- Controller-owned verification evidence
- Human gates for architecture and dangerous operations
- Bounded autonomy through budgets, retries, and explicit stop reasons
- Installable as a Pi package

## License

[MIT](LICENSE)
