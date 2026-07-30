# Quickstart

> MVP status: the Controller is installable and deterministic adapters are covered by tests. Run it on a disposable branch/repository before enabling auto-merge.

## Requirements

- WSL with Node.js 20+, Git, and Pi
- GitHub CLI (`gh`) authenticated with permission to read and update Issues
- A clean Git checkout with a GitHub `origin` remote
- Worker and Reviewer models available to Pi

## Install

From the repository checkout:

```bash
pi install git:github.com/xuzhaorui/pi-agent-controller
```

For development, install the local package from the repository root:

```bash
pi install .
```

## Configure

Copy `examples/agent-controller.json` to the project being automated:

```bash
mkdir -p .pi
cp /path/to/pi-agent-controller/examples/agent-controller.json .pi/agent-controller.json
```

Set the Worker and Reviewer model identifiers to identifiers accepted by your Pi installation. Start with `closeIssueOnDone: false` and `autoMerge: false` until the workflow is proven on a disposable repository.

Use the `ready-for-agent` label to mark eligible Issues. Optional priority labels are `priority:p0` through `priority:p3`; lower numbers run first and Issue number breaks ties.

## Run

Inside the target Git checkout:

```text
/controller-start --dry-run
/controller-start
/controller-status
```

The Controller performs this loop without another prompt:

```text
claim Issue → create Worktree → run Worker → run Verification → run Reviewer → merge → close/update Issue → claim next Issue
```

Useful controls:

```text
/controller-pause
/controller-resume
/controller-stop
/controller-approve <gate-id> allow
/controller-approve <gate-id> reject
```

A run stops with an explicit reason such as `BACKLOG_EMPTY`, `HUMAN_DECISION_REQUIRED`, `BLOCKED`, or `BUDGET_EXHAUSTED`.

## Safety

- The current checkout must be clean before a Worktree is created.
- Repository-local agent prompts are untrusted and require a trusted Pi project.
- Human approval is required for guarded content or Policy-disabled auto-merge.
- Non-interactive mode fails closed when a Human Gate is required.
- Failed Workspaces are retained by default; inspect their evidence before cleanup.
- Runtime Journal and lease data are stored under the repository's Git metadata, not committed to the project.
