# Agent Controller

This context advances repository Tasks through a deterministic, policy-bounded workflow while keeping intelligent work isolated, observable, and subject to explicit human control.

## Language

**Project**:
A trusted Git repository controlled by one configured Controller.

**Backlog**:
The eligible GitHub Issues from which the Controller discovers work.

**Controller**:
The deterministic component that reconciles desired Task state with repository and execution state.
_Avoid_: Parent Agent, Agent Manager

**Task**:
One executable unit of desired repository work, normally represented by one GitHub Issue.
_Avoid_: Child task, Agent task

**Run**:
One bounded period of autonomous reconciliation started by a user.

**Reconcile Loop**:
Repeated evaluation of current state, desired state, Policy, and the next legal action.

**Run Budget**:
Limits on Tasks, attempts, elapsed time, tokens, or cost for one Run.

**Execution**:
One bounded attempt by a Role to produce a structured Result from an explicit Handoff. An Execution is an observable unit of work, not a nested agent relationship.
_Avoid_: Subagent, Child Agent

**Role**:
A responsibility such as Worker, Reviewer, or Architect whose model and allowed tools are selected by Policy.
_Avoid_: Agent class, Agent type

**Handoff**:
The schema-versioned Task context and result contract supplied to an Execution.
_Avoid_: Parent prompt, delegation message

**Result**:
Schema-validated structured output returned by an Execution.
_Avoid_: Agent answer, completion message

**Execution Event**:
A durable observation about an Execution, such as lifecycle, tool activity, usage, completion, failure, or cancellation.

**Intervention**:
An explicit supported control applied to a running Execution. Support is capability-declared; currently cancellation is guaranteed while pause and steer must not be implied.
_Avoid_: Agent manipulation, hidden control

**Workspace**:
An isolated Git branch and worktree created for one Task.

**Verification**:
Controller-owned execution of tests, builds, linting, integrations, or benchmarks.

**Review**:
An independent assessment performed after deterministic Verification passes.

**Evidence**:
Durable proof of an action or decision, such as an exit status, log artifact, commit, metric, finding, or Execution Event.

**Human Gate**:
A paused checkpoint requiring an explicit human approval, rejection, or decision.

**Blocker**:
A condition that prevents legal automatic progress.

**Policy**:
Versioned project rules for Task eligibility, Roles, models, tools, Verification, budgets, gates, and merging.

**Run Journal**:
Append-only, schema-versioned execution history used for audit and crash recovery.

**State Transition**:
A legal, journaled change from one Task or Run state to another.

**Issue Tracker**:
The external source that discovers and updates shared Tasks.

**Repository Lease**:
Exclusive ownership that prevents two local Controller instances from operating on the same Project.

**Stop Reason**:
A typed explanation for why a Run is no longer advancing.
