import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLOSED_STATUSES,
  JOB_STATUSES,
  STATUS_CONFIG,
  USER_SELECTABLE_STATUSES,
} from "../lib/job-status";

describe("job statuses", () => {
  it("provides display configuration for every persisted status", () => {
    assert.deepEqual(Object.keys(STATUS_CONFIG).sort(), [...JOB_STATUSES].sort());
  });

  it("keeps the system-only generating status out of user controls", () => {
    assert.equal(USER_SELECTABLE_STATUSES.includes("generating"), false);
    assert.equal(USER_SELECTABLE_STATUSES.length, JOB_STATUSES.length - 1);
  });

  it("recognizes terminal application states", () => {
    assert.deepEqual(CLOSED_STATUSES, ["rejected", "withdrawn", "ghosted", "position_filled"]);
  });
});
