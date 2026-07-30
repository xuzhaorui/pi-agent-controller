import test from "node:test";
import assert from "node:assert/strict";
import { defaultPolicy, selectNextTask, taskFromIssue, validatePolicy, type Task } from "../src/domain.js";

const ready = (number: number, priority: number, body = ""): Task => ({ number, title: `Task ${number}`, body, labels: ["ready-for-agent"], priority, state: "READY", acceptanceCriteria: [], dependencies: [] });

test("selects the highest priority eligible Task with stable Issue-number tie breaking", () => {
  const policy = defaultPolicy();
  const first = ready(10, 1);
  const second = ready(3, 1);
  const blocked = { ...ready(1, 0), dependencies: [10] };
  assert.equal(selectNextTask([first, blocked, second], policy)?.number, 3);
});

test("extracts acceptance criteria and dependencies from an Issue body", () => {
  const policy = defaultPolicy();
  const task = taskFromIssue({ number: 1, title: "Implement", body: "Depends on #4\n- [ ] tests pass\n- [x] review complete", labels: ["ready-for-agent", "priority:p1"] }, policy);
  assert.deepEqual(task.acceptanceCriteria, ["tests pass", "review complete"]);
  assert.deepEqual(task.dependencies, [4]);
  assert.equal(task.priority, 1);
});

test("rejects unsafe or incomplete Policy before a Run starts", () => {
  const policy = defaultPolicy();
  policy.baseBranch = "";
  policy.maxTasks = 0;
  policy.roles.worker.model = "";
  policy.roles.reviewer.model = "reviewer-model";
  assert.deepEqual(validatePolicy(policy), ["baseBranch is required", "maxTasks must be at least 1", "worker model is required"]);
});
