import assert from "node:assert/strict";
import test from "node:test";
import { deadlineDecision } from "../src/course_delivery.js";

test("accepts a learner submission exactly at the deadline", () => {
  assert.equal(
    deadlineDecision("2026-09-21T12:00:00.000Z", new Date("2026-09-21T12:00:00.000Z")),
    "accept",
  );
});

test("closes a learner submission one millisecond after the deadline", () => {
  assert.equal(
    deadlineDecision("2026-09-21T12:00:00.000Z", new Date("2026-09-21T12:00:00.001Z")),
    "closed",
  );
});
