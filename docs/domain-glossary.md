# Domain Glossary

| Term | Meaning |
|---|---|
| Project | A trusted Git repository controlled by one configured Controller. |
| Backlog | The eligible GitHub Issues from which the Controller discovers work. |
| Task | One executable unit of desired work, normally represented by one GitHub Issue. |
| Controller | The deterministic component that reconciles desired Task state with repository and execution state. |
| Reconcile Loop | Repeated evaluation of current state, desired state, Policy, and the next legal action. |
| Run | One bounded period of autonomous reconciliation started by a user. |
| Policy | Versioned project rules for task eligibility, roles, models, tools, verification, budgets, gates, and merging. |
| Run Budget | Limits on tasks, attempts, elapsed time, tokens, or cost for one Run. |
| Stop Reason | A typed explanation for why a Run is no longer advancing. |
| Workspace | An isolated Git branch and worktree created for one Task. |
| Agent Role | A responsibility such as Worker, Reviewer, or Architect, mapped to a model and tool set by Policy. |
| Execution | One bounded invocation of an Agent Role for a Task. |
| Handoff | The schema-versioned task context and contract supplied to an Agent. |
| Result | Schema-validated structured output returned by an Agent. |
| Verification | Controller-owned execution of tests, builds, linting, integrations, or benchmarks. |
| Review | An independent assessment performed after deterministic Verification passes. |
| Evidence | Durable proof of an action or decision, such as exit status, log artifact, commit, metrics, or findings. |
| Human Gate | A paused checkpoint requiring an explicit human approval, rejection, or decision. |
| Blocker | A condition that prevents legal automatic progress. |
| Run Journal | Append-only, schema-versioned execution history used for audit and crash recovery. |
| State Transition | A legal, journaled change from one Task or Run state to another. |
| Issue Tracker | The port that discovers and updates GitHub Tasks. |
| Agent Runtime | The port that invokes isolated Pi Agents and returns structured Results. |
| Repository Lease | Exclusive ownership that prevents two local Controller instances from operating on the same Project. |
