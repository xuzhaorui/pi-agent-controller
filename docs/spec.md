# Pi Agent Controller 产品规格

## Problem Statement

Pi 在长期会话、会话内模型切换和 token 利用率方面很适合作为持续的软件工程工作台；WSL 则提供真实的 Git、测试、构建和 benchmark 环境。隔离的 Pi 进程已经能承担编码、测试等有边界的 Execution，但一次 Execution 完成后，主会话往往停止，无法可靠地继续领取下一个 GitHub Issue。

用户已经在 GitHub 中细粒度拆分了 Backlog，不需要另一个自由发挥的 Planner。真正缺失的是一个不依赖 LLM 临场记忆的确定性控制闭环：持续比较期望状态与实际状态，领取 Task、建立隔离 Workspace、运行 Worker、收集结构化 Result、执行 Verification 和 Review、完成合并，然后继续下一项 Task；只有在 Backlog 为空、发生阻塞、预算耗尽或需要人类决策时停止。

如果继续依赖主 Agent 自己决定是否推进，会产生重复上下文、无理由停机、状态丢失、并发修改冲突、把“Agent 声称完成”误判为真正完成，以及危险变更未经批准等问题。

## Solution

构建一个可作为 Pi Package 安装的 **Pi Agent Controller** 扩展。它把人类定位为 Tech Lead，把 GitHub Issue 视为 Task 的期望状态，把 Git 仓库视为代码事实来源，把持久化 Run Journal 视为执行事实来源，并以确定性的 Reconcile Loop 驡动一个有边界的顺序工作流。

用户在 Pi 中启动一个 Run。Controller 根据 Policy 从 GitHub 发现带有 `ready-for-agent` 标签的 Task，确定性地领取其中一个 Task，在独立 Git Worktree 中创建 Workspace，通过可替换的 Execution Runtime 启动 Worker Execution，要求它返回经过 schema 校验的 Result，然后执行项目配置的 Verification。通过验证后，Controller 启动 Reviewer Execution；审查通过后按 Policy 合并、同步 GitHub Issue 并继续领取下一项 Task。

普通编码、测试、审查和下一任务领取由 Controller 自动推进。架构边界变化、危险操作、保护分支操作、无法自动解决的合并冲突，以及 Policy 明确要求的阶段检查进入 Human Gate。Controller 只在终止条件成立时停止，并向用户显示明确的 Stop Reason、证据和恢复动作。

第一版强调安全、可恢复和可解释，而不是追求完全自治：单个 Controller 实例、单个活动 Task、有限重试、有限 Run Budget、显式启动与恢复、默认失败关闭。Worker 与 Reviewer 是独立的 Pi 进程 Execution，而不是嵌套的“子代理”。初始 Execution Runtime 把公开的 Pi JSON 事件流标准化为可持久化的 Execution Event，显式声明可取消但暂不支持 pause/steer，并保留替换 Runtime 的稳定边界。

## User Stories

1. As a Tech Lead, I want to start a Controller Run from my current Pi session, so that the project can continue without repeatedly restating its background.
2. As a Tech Lead, I want to preview the next eligible Task before starting, so that I can verify the Controller selected the intended work.
3. As a Tech Lead, I want to see whether the Controller is running, paused, blocked, or idle, so that I always understand its current condition.
4. As a Tech Lead, I want to pause a Run gracefully, so that the active step reaches a safe checkpoint before automation stops.
5. As a Tech Lead, I want to stop a Run immediately and cancel its active Execution when necessary, so that I can contain unsafe or wasteful behavior.
6. As a Tech Lead, I want to resume an interrupted Run from durable state, so that a Pi restart or WSL terminal closure does not force the workflow to start over.
7. As a Tech Lead, I want the Controller to explain why it stopped, so that I know whether to add work, resolve a blocker, approve a decision, or increase a budget.
8. As a Tech Lead, I want to configure maximum Tasks, elapsed time, retries, tokens, and cost for a Run, so that autonomous execution remains bounded.
9. As a Tech Lead, I want the Controller to stop when a Run Budget is exhausted, so that a faulty loop cannot consume unlimited resources.
10. As a Tech Lead, I want GitHub Issues with an allowed readiness label to be the Backlog, so that existing project planning remains the Task source.
11. As a Tech Lead, I want Task eligibility rules to be configurable, so that blocked, dependency-bound, draft, or excluded Issues are not executed.
12. As a Tech Lead, I want Task selection to be deterministic by priority and stable tie-breaker, so that runs are predictable and testable.
13. As a Tech Lead, I want the Controller to claim a Task before execution, so that the same Controller does not start it twice.
14. As a Tech Lead, I want every claim to leave an audit trail on the Issue, so that people can see which Run owns the Task.
15. As a Tech Lead, I want Issue content to be treated as untrusted input, so that a malicious or accidental prompt cannot override Controller Policy.
16. As a Tech Lead, I want the Controller to reject Tasks without explicit acceptance criteria when Policy requires them, so that Workers receive executable work.
17. As a Tech Lead, I want each Task to receive its own Git branch and Worktree, so that changes are isolated from the main workspace and other runs.
18. As a Tech Lead, I want branch and Workspace names derived safely from the Task identity, so that unusual Issue titles cannot cause shell or path injection.
19. As a Tech Lead, I want the Controller to verify the repository is clean and suitable before creating a Workspace, so that it does not overwrite local work.
20. As a Tech Lead, I want stale Workspaces to be detected during recovery, so that the Controller can resume or request cleanup instead of duplicating them.
21. As a Tech Lead, I want Workspace cleanup to happen only after evidence is retained, so that failed Tasks remain diagnosable.
22. As a Tech Lead, I want Worker model and tool permissions to be selected by role through Policy, so that routine coding can use a cost-efficient model without granting unnecessary capabilities.
23. As a Tech Lead, I want Reviewer model and permissions to be independent from the Worker, so that review is an independent check rather than self-approval.
24. As a Tech Lead, I want an Architect or Human Gate only when deterministic rules cannot decide safely, so that expensive reasoning is reserved for high-value decisions.
25. As the Worker Role, I want a Handoff containing the Task goal, acceptance criteria, constraints, architecture context, Workspace, and Verification expectations, so that I can execute without guessing intent.
26. As the Worker Role, I want to return a structured Result, so that the Controller can process completion without parsing conversational prose.
27. As a Controller, I want to schema-validate every Result, so that malformed Execution output cannot advance the state machine.
28. As a Controller, I want every Execution to have a stable identity and a bounded event stream covering lifecycle, tool activity, usage, completion, failure, and cancellation, so that current work is observable and durably auditable.
29. As a Controller, I want changed files, commit identity, claims, risks, blockers, usage, process failure, timeout, cancellation, and malformed Results to become explicit evidence or failed attempts, so that failure is never mistaken for completion.
30. As a Tech Lead, I want retry rules to distinguish transient failures from deterministic failures, so that the Controller retries only when useful.
31. As a Tech Lead, I want configurable test, integration-test, lint, build, and benchmark commands, so that completion reflects each repository’s real quality gates.
32. As a Controller, I want Verification commands to run inside the Task Workspace, so that evidence applies to the exact candidate changes.
33. As a Controller, I want command exit codes and bounded output captured as Evidence, so that pass/fail decisions do not rely on Agent claims.
34. As a Tech Lead, I want Verification output to be truncated for model context while preserving the full artifact location, so that diagnostics remain available without flooding tokens.
35. As a Tech Lead, I want performance thresholds to be expressible as Policy where a project supplies machine-readable metrics, so that regressions can block completion.
36. As the Reviewer Role, I want the Task, diff, architecture constraints, and Verification Evidence, so that I can assess correctness, scope, safety, and maintainability.
37. As a Controller, I want Review output to follow an approved, changes-requested, blocked, or human-decision schema, so that Review drives deterministic transitions.
38. As a Tech Lead, I want requested changes to return to the Worker with the Reviewer findings, so that the workflow can repair and re-verify within the retry budget.
39. As a Tech Lead, I want a Task to be merged only after required Verification and Review pass, so that “code written” never means “Task done.”
40. As a Tech Lead, I want merge strategy and protected branches controlled by Policy, so that repositories can choose auto-merge or Human Gate behavior.
41. As a Controller, I want merge conflicts to become a Blocker instead of being resolved blindly, so that unrelated code is not silently damaged.
42. As a Tech Lead, I want successful completion to update and close the GitHub Issue with links to commit and Evidence, so that Backlog state matches repository state.
43. As a Tech Lead, I want failed or blocked Tasks reflected on GitHub without losing the readiness history, so that humans can triage them.
44. As a Tech Lead, I want the Controller to immediately reconcile again after a Task reaches Done, so that the next eligible Task starts without another prompt.
45. As a Tech Lead, I want the Run to become Idle with `BACKLOG_EMPTY` only when no eligible Task exists, so that silence is never ambiguous.
46. As a Tech Lead, I want architectural boundary changes to trigger a Human Gate with options, evidence, and a recommended choice, so that direction remains a human responsibility.
47. As a Tech Lead, I want destructive commands, credential access, database schema changes, production configuration changes, and protected-branch operations to require approval or be denied, so that autonomy has a safety boundary.
48. As a Tech Lead, I want non-interactive mode to fail closed whenever approval is required, so that missing UI never implies consent.
49. As a Tech Lead, I want to approve, reject, or supply a decision to a pending Human Gate from Pi, so that work can continue in the same long-lived session.
50. As a Tech Lead, I want every state transition to include time, cause, Task, Run, and Evidence references, so that the system is auditable.
51. As a Tech Lead, I want the durable Run Journal to survive session branching and compaction independently of LLM context, so that orchestration state is not conversational memory.
52. As a Tech Lead, I want only concise status and decision context injected into the main Pi session, so that Controller operation preserves Pi’s token-efficiency advantage.
53. As a Tech Lead, I want token and cost usage reported separately for Worker, Reviewer, and Architect roles, so that model routing can be optimized.
54. As a Tech Lead, I want status shown compactly in Pi and details available on demand, so that long Runs do not overwhelm the terminal.
55. As a Tech Lead, I want Controller and Execution Events to redact known secrets before persistence and display, so that auditability does not leak credentials.
56. As a Tech Lead, I want only one active Controller instance for a repository in the MVP, so that duplicate reconciliation cannot corrupt state.
57. As a Controller, I want an exclusive repository-level lease, so that a second local instance fails clearly instead of executing concurrently.
58. As a Tech Lead, I want configuration validation before a Run starts, so that missing GitHub authentication, invalid models, unsafe commands, or unavailable tools fail early.
59. As a Tech Lead, I want a dry-run mode that discovers and plans actions without claiming Issues or changing Git, so that I can validate Policy safely.
60. As a Pi Package user, I want to install the Controller from Git or npm using Pi’s package mechanism, so that setup follows Pi conventions.
61. As a Pi Package user, I want the extension to start no long-lived process merely by being imported, so that loading Pi remains safe and predictable.
62. As a Pi Package user, I want session shutdown and reload to cancel or checkpoint Controller resources cleanly, so that no orphan Execution process remains.
63. As a Pi Package user, I want project-local Agent definitions to require a trusted project and explicit Policy, so that repository-controlled prompts are not silently executed.
64. As a maintainer, I want GitHub, Execution Runtime, Git Workspace, Verification, and persistence behind ports, so that external dependencies can be tested and replaced without changing the state machine.
65. As a maintainer, I want state transitions rejected when they are illegal, so that recovery and retries cannot skip quality gates.
66. As a maintainer, I want every external action to be idempotent or recoverably journaled, so that process crashes do not duplicate comments, branches, commits, or merges.
67. As a maintainer, I want schema versions on Policy, Journal events, handoffs, and Results, so that future releases can migrate durable state safely.
68. As a maintainer, I want Controller output capped according to Pi’s context-safety conventions, so that large logs cannot cause context overflow.
69. As a maintainer, I want supported interventions to be capability-declared and cancellation propagated from Pi through Controller to active Execution and Verification processes, so that the UI never implies unavailable pause or steer controls.
70. As a maintainer, I want a concise completion report for every Run, so that users can assess completed Tasks, failures, usage, Evidence, and remaining work.

## Implementation Decisions

- The product is a Pi Package containing a TypeScript extension and supporting domain modules. It follows Pi package discovery and peer-dependency conventions and can be installed from Git first; npm publication is optional later.
- The extension factory performs registration only. Long-lived resources begin from an explicit Controller command or a resumed Run after session startup, and are cancelled or checkpointed on session shutdown and reload.
- The architecture separates a deterministic Controller Core from adapters for Issue Tracker, Git Workspace, Execution Runtime, Verification, persistence, clock, and UI. The Core does not call GitHub, Git, shell, or Pi APIs directly.
- The primary domain vocabulary is: Project, Backlog, Task, Run, Reconcile Loop, Policy, Workspace, Role, Execution, Execution Event, Intervention, Handoff, Result, Verification, Review, Evidence, Human Gate, Blocker, Run Budget, Run Journal, State Transition, and Stop Reason.
- GitHub Issue is authoritative for Task intent and shared Backlog status. Git is authoritative for source changes and commits. An append-only, schema-versioned Run Journal is authoritative for local execution and recovery. No duplicated local queue is treated as an independent source of truth.
- Runtime state is stored outside normal branch contents in repository-associated Git metadata so all Worktrees see one journal and automation does not create commits merely by changing state. Project Policy remains versionable project configuration.
- MVP supports GitHub through the authenticated `gh` CLI. Repository resolution uses the current Git remote. GitHub operations carry stable Run and Task identifiers so comments and label changes can be retried idempotently.
- The default readiness vocabulary is `ready-for-agent`. In-progress, review, and blocked label mappings are Policy-controlled rather than hard-coded, allowing adoption in repositories with existing workflows.
- MVP is single-instance and sequential: one repository lease, one active Run, one active Task, one Worker at a time. Distributed coordination and parallel workers are deliberately deferred.
- Task selection is deterministic: eligible readiness state, no blocker/dependency violation, then configured priority, then stable Issue-number ordering. Dry-run uses the same selection without side effects.
- The Task state machine permits only explicit transitions through Ready, Claimed, Running, Verifying, Reviewing, Merging, and Done. Failed, Blocked, Awaiting Human, Paused, and Cancelled are explicit non-success states. Done cannot be reached without all Policy-required Evidence.
- Reconciliation is event-driven after local actions and may poll GitHub at a bounded interval while a Run is active. There is no unbounded LLM-driven “decide what to do next” loop.
- A Run ends only with a typed Stop Reason, including Backlog Empty, Paused by User, Cancelled by User, Human Decision Required, Blocked, Budget Exhausted, Configuration Invalid, Lease Unavailable, or Internal Failure.
- Run Budget includes maximum completed Tasks, attempts per Task, elapsed duration, and optional token/cost ceilings. Defaults are conservative and every loop checks the budget before external side effects.
- Each Task receives a sanitized branch and isolated Git Worktree. The base branch, branch prefix, merge strategy, cleanup strategy, and protected-branch behavior are Policy-controlled.
- Policy may instead set `workspaceMode: "current"` to run Tasks directly in the current checkout: no Worktree is created, commits are not enforced, merges and cleanup are no-ops, and changes are left in place for the human to review and commit. In-place Workspaces are marked in the Run Journal so recovery keeps treating them the same way.
- Workspace creation, claim updates, comments, Execution starts, Verification commands, and merges use idempotency keys recorded before or with the side effect. Recovery reconciles journal intent with actual Git and GitHub state.
- Execution Runtime is a port with an explicit request, Handoff, Result, normalized Execution Event stream, and declared intervention capabilities. The initial adapter starts an isolated Pi process in JSON mode, selects model and tools by Role, persists bounded lifecycle/tool/usage events, and propagates cancellation.
- The Controller does not define parent/child Agent classes, recursive delegation, or a private Agent communication protocol. Compatibility with other runtimes belongs behind the Execution Runtime boundary and requires a stable callable contract.
- The initial Pi Runtime declares `cancel: true`, `pause: false`, and `steer: false`. Unsupported controls must remain visible as unsupported rather than being emulated through hidden prompts or process behavior.
- Worker, Reviewer, and optional Architect are roles, not fixed model names. Role-to-model and role-to-tool mappings are Policy. Missing model credentials fail validation before work begins.
- Every Worker receives a schema-versioned Handoff containing Task identity, goal, acceptance criteria, constraints, relevant project context references, Workspace identity, allowed tools, Verification expectations, and output contract.
- Every Execution must finish through a terminating structured Result contract. Conversational “done” text is insufficient. Result parsing is strict; invalid output becomes a failed attempt.
- Worker Result records outcome, changed paths, commit, tests claimed, risks, blockers, recommended disposition, usage, and artifact references. Reviewer Result records approved, changes requested, blocked, or human decision required, with findings and evidence references.
- Verification is Controller-owned rather than Worker-owned. Policy defines bounded shell commands and optional machine-readable metric thresholds. Commands execute without shell interpolation where possible, inside the candidate Workspace, with timeout and cancellation.
- Verification Evidence includes command, sanitized environment metadata, exit status, duration, bounded output, and full artifact reference. Large output follows Pi’s 50 KB or 2,000-line context-safety convention while preserving full logs outside model context.
- Review occurs only after required deterministic Verification passes. Changes requested return to Worker, then repeat Verification and Review within the attempt budget. The Worker cannot approve its own result.
- Normal, Policy-approved changes may auto-merge after Verification and Review. Architecture changes, destructive operations, protected branch actions, database schema changes, production configuration changes, credential access, and unresolved conflicts require a Human Gate or are denied.
- Issue bodies, comments, repository Agent definitions, and generated text are untrusted. Controller Policy and system-generated contracts are kept separate from untrusted content. Project-local agents run only for trusted projects and explicit Policy.
- In non-interactive modes, any action requiring approval fails closed and records Human Decision Required. The Controller does not infer approval from timeout or absent UI.
- Pi interaction is command-first and compact: start, dry-run, status, pause, stop, resume, approve, reject, and retry. A status indicator/widget may show active Run, Task, phase, budget, and Stop Reason; detailed logs remain outside the main LLM context unless requested.
- Pi session entries may provide display and audit references but are not the orchestration source of truth. Session compaction, branching, switching, or model changes must not alter Controller state.
- Extension errors, child-process errors, malformed Results, and failed commands become domain failures with Evidence. No exception may silently advance a Task.
- Sensitive values are not persisted intentionally. Known credential patterns and configured secret values are redacted from Result, Evidence, GitHub comments, and UI summaries.
- MVP merge completion updates the Issue with the resulting commit, Verification summary, Review disposition, and Run identifier, then removes or changes workflow labels according to Policy and closes the Issue when configured.
- After Done, the Core immediately reconciles again. It never asks an LLM whether to continue. The next Task starts unless a typed termination condition applies.

## Testing Decisions

- The primary test seam is the public **Reconcile Run** behavior of Controller Core. A test supplies a Policy and observable adapter doubles, invokes reconciliation until a Stop Reason, and asserts externally visible Task state, Run Journal events, adapter actions, Evidence, and final Stop Reason. This is the highest stable seam and should cover most behavior without testing private reducers or helper functions.
- Controller tests assert behavior, not implementation: which Task was selected, whether it was claimed once, what Handoff was sent, whether Verification and Review gated merge, whether the next Task was selected, and why the Run stopped.
- State-machine coverage is achieved through scenario tests at the Reconcile seam rather than direct tests for each private transition function. Illegal or skipped transitions are observed as rejected Runs with no forbidden side effect.
- Recovery scenarios restart the Core from a persisted Journal while adapters report actual GitHub and Git state. Tests verify idempotency after crashes before and after claims, Workspace creation, Execution completion, comments, merge, and Issue closure.
- Git behavior uses temporary real Git repositories and Worktrees at the same Reconcile seam. This gives confidence in branch/worktree semantics without mocking Git command text.
- GitHub behavior uses a contract-compatible fake for most scenarios and a small optional integration suite against a disposable test repository. The contract suite covers pagination, labels, comments, Issue closure, authentication failures, rate limits, and idempotency markers.
- Execution Runtime behavior uses a deterministic fake at the Reconcile seam for success, structured failure, malformed Result, timeout, cancellation, event observation, token usage, and requested changes. A thin process contract test verifies Pi JSON normalization, lifecycle/tool events, model/tool arguments, output termination, usage collection, declared capabilities, and abort propagation.
- Verification tests run harmless fixture commands in temporary Workspaces and assert timeout, exit code, output truncation, artifact retention, redaction, cancellation, and metric threshold behavior.
- Human Gate scenarios verify that guarded actions never occur before approval, rejection leaves evidence, approval resumes from the exact checkpoint, and non-interactive mode fails closed.
- Budget scenarios verify limits before side effects and after completed attempts, including max Tasks, retries, elapsed time, token ceilings, and cost ceilings.
- Security scenarios cover malicious Issue text, unsafe branch names, shell metacharacters, symlink/path escape attempts, untrusted project agents, secret-like log content, and a second Controller instance competing for the lease.
- Pi extension smoke tests load the package with Pi and exercise command registration plus session shutdown cleanup. TUI styling is not snapshot-tested unless it carries behavior; Core behavior remains covered through the Reconcile seam.
- Prior art from Pi is followed for subprocess isolation and JSON streaming, structured terminating output, cancellation propagation, project-agent trust, permission gates, GitHub resolution, state reconstruction, and output truncation.
- A good acceptance test is deterministic, uses bounded time, requires no paid model call, and proves a user-visible outcome or safety invariant. Live-model end-to-end tests are optional manual checks, not merge-blocking tests.

## Out of Scope

- More than one active Task or parallel Worker execution in the MVP.
- Distributed Controller coordination across multiple machines, WSL instances, or CI runners.
- A general-purpose workflow DSL or arbitrary DAG execution engine.
- Automatic decomposition of broad product goals into GitHub Issues.
- Replacing GitHub with GitLab, Jira, Linear, local TODO files, or GitHub Projects in the first release.
- A web dashboard, desktop GUI, or custom full-screen project-management interface.
- Autonomous architecture decisions, product direction, or unrestricted changes to public APIs.
- Blind automatic conflict resolution, force pushes, destructive repository cleanup, production deployment, or secret management.
- Training models, providing an LLM gateway, or implementing a general memory/vector database.
- Guaranteeing compatibility with undocumented pi-open-agents internals.
- Publishing to npm in the initial Git-installable release.
- Replacing repository CI; the Controller runs configured local Verification and may report evidence, but CI orchestration is a later integration.
- Full benchmark interpretation when a project cannot emit machine-readable metrics.

## Further Notes

### Delivery Issues

1. [#2 Bootstrap Pi Package、Controller Core 与持久化 Run 生命周期](https://github.com/xuzhaorui/pi-agent-controller/issues/2)
2. [#3 接入 GitHub Backlog 的确定性 Task 发现与领取](https://github.com/xuzhaorui/pi-agent-controller/issues/3)
3. [#4 建立 Git Worktree Workspace 与结构化 Worker Execution](https://github.com/xuzhaorui/pi-agent-controller/issues/4)
4. [#5 实现 Controller Verification 与独立 Reviewer 修复循环](https://github.com/xuzhaorui/pi-agent-controller/issues/5)
5. [#6 完成 Merge、Issue 同步与自动领取下一 Task 的闭环](https://github.com/xuzhaorui/pi-agent-controller/issues/6)
6. [#7 加入 Human Gate、危险操作保护与 Run Budget](https://github.com/xuzhaorui/pi-agent-controller/issues/7)
7. [#8 强化 Crash Recovery、幂等性与 Repository Lease](https://github.com/xuzhaorui/pi-agent-controller/issues/8)
8. [#9 交付 Git-installable MVP 文档、示例与端到端验收](https://github.com/xuzhaorui/pi-agent-controller/issues/9)

- This product is intentionally a **Controller**, not an Agent Manager. Agent intelligence performs bounded work; deterministic reconciliation owns continuity.
- The human remains responsible for Vision and high-impact Decisions. Agents own implementation and evidence gathering within Policy.
- The key success metric is not lines of code generated. It is the percentage of eligible Tasks advanced from Ready to Done without an unnecessary human prompt, while preserving Verification quality and producing zero unauthorized guarded actions.
- Additional useful metrics are recovery success after interruption, duplicate-side-effect count, average tokens per completed Task, Worker-to-Reviewer rework rate, blocked-time distribution, and false completion rate.
- The first release should optimize the complete sequential happy path and its recovery path before adding more Roles or parallelism.
- The planned primary testing seam has been inferred from the current requirements without an interview, as required by the specification workflow: one high-level Reconcile seam, with only thin external contract and package-load checks where unavoidable.
