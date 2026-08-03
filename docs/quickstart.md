# Quickstart

> MVP status: the Controller is installable and deterministic adapters are covered by tests. Run it on a disposable branch/repository before enabling auto-merge.

## Requirements

- WSL with Node.js 20+, Git, and Pi
- GitHub CLI (`gh`) authenticated with permission to read and update Issues
- A clean Git checkout with a GitHub `origin` remote
- Worker and Reviewer models available to Pi

## Install

Install from Git into the project you want to automate (run inside that project's checkout):

```bash
pi install git:github.com/xuzhaorui/pi-agent-controller
```

Pi writes the package reference to `.pi/settings.json` and loads it on startup once the project is **trusted**. The first `pi` launch in a new project prompts for trust; approve it so the package auto-loads on every subsequent launch.

For development, install the local checkout instead:

```bash
pi install .
```

### Verify the extension loads

To try the package without trusting the project, load it ephemerally and confirm the `controller_status` tool answers:

```bash
pi -e . --tools controller_status -p "Call the controller_status tool."
```

A working install replies `Controller: idle (no Run)`. Slash commands (`/controller-start`, `/controller-status`, …) are available once the package is loaded in an interactive `pi` session.

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
/controller-events 10
```

`/controller-status` includes the active Execution identity, Role, state, and supported controls. `/controller-events` shows recent normalized lifecycle, tool, usage, completion, failure, and cancellation events from the durable Run Journal.

The Controller performs this loop without another prompt:

```text
claim Issue → create Worktree → run observable Worker Execution → run Verification → run Reviewer Execution → merge → close/update Issue → claim next Issue
```

Useful controls:

```text
/controller-pause
/controller-resume
/controller-interrupt
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
- Worker and Reviewer work is modeled as a bounded Execution, not a nested Subagent.
- The Pi process Runtime declares `cancel` support. `/controller-interrupt` cancels only the active Execution; retry or blocking remains Policy-controlled. `/controller-stop` cancels it and terminates the Run.
- Mid-Execution `pause` and `steer` are currently unsupported; graceful Run pause takes effect at a safe checkpoint.
- Failed Workspaces are retained by default; inspect their evidence before cleanup.
- Runtime Journal and lease data are stored under the repository's Git metadata, not committed to the project.
