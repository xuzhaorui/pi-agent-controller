# Pi Agent Controller

A deterministic controller loop for continuously advancing GitHub Issues with Pi agents in isolated Git worktrees.

Pi Agent Controller is designed for a **Pi + WSL** workflow where Pi provides long-lived context and model switching, while the controller provides the missing orchestration loop:

```text
GitHub Task → Claim → Worktree → Observable Execution → Verify → Review → Merge → Next Task
```

The controller stops only for an explicit reason such as an empty backlog, a blocker, a human decision, a user pause, or an exhausted run budget.

## Status

MVP implementation in progress. The deterministic Core, GitHub/Git/verification/Pi adapters, recovery Journal, Human Gates, package commands, and acceptance tests are present; run it on a disposable repository before enabling auto-merge.

- [Product specification](docs/spec.md)
- [Specification issue](https://github.com/xuzhaorui/pi-agent-controller/issues/1)
- [Implementation issues](https://github.com/xuzhaorui/pi-agent-controller/issues)
- [Domain glossary](docs/domain-glossary.md)
- [Quickstart](docs/quickstart.md)
- [Example Policy](examples/agent-controller.json)
- [Background](2026-07-30-pi与WSL结合优势.md)

## MVP principles

- Deterministic reconciliation, not an LLM deciding whether to continue
- GitHub Issues as task intent; Git as code truth; durable journal as execution truth
- One active task in one isolated worktree (or directly in the current checkout with `workspaceMode: "current"`)
- Worker and Reviewer as bounded Executions, not nested Subagents
- Normalized lifecycle, tool, usage, and termination events in the durable journal
- Explicit intervention capabilities: cancellation is supported; pause/steer are never implied
- Structured Worker and Reviewer Results
- Controller-owned verification evidence
- Human gates for architecture and dangerous operations
- Bounded autonomy through budgets, retries, and explicit stop reasons
- Installable as a Pi package

## Workspace modes

Policy controls how a Task Workspace is created via `workspaceMode`:

- `worktree` (default): each Task gets its own Git Worktree on a dedicated branch, isolated from the main checkout.
- `current`: the Worker runs directly in the current checkout — no Worktree is created, no commits are enforced, and no merge happens on completion. Use this when the checkout itself is the deliverable (for example, when the repository does not track the files the Task edits, such as a nested frontend checkout). Changes remain in the checkout for you to review and commit yourself.

## License

[MIT](LICENSE)
