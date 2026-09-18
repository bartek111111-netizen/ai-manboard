import { describe, expect, it } from "vitest";
import {
  INSTANCE_STATES,
  TRANSITIONS,
  canTransition,
  isLive,
  transition,
  type InstanceEvent,
  type InstanceState,
} from "./states.js";

/**
 * FSM (PLAN §11.2, FP-6) — every legal transition, plus the guard that any
 * unlisted (state, event) pair is INVALID_STATE.
 */
describe("transition (PLAN §11.2)", () => {
  const legal: [InstanceState, InstanceEvent, InstanceState][] = [
    ["stopped", "start", "starting"],
    ["error", "start", "starting"],
    ["crashed", "start", "starting"],
    ["unknown", "start", "starting"],
    ["unknown", "stop", "stopped"],
    ["error", "stop", "stopped"],
    ["starting", "probe-ok", "running"],
    ["starting", "timeout", "error"],
    ["starting", "spawn-failed", "error"],
    ["starting", "exit-abnormal", "crashed"],
    ["starting", "exit-clean", "stopped"],
    ["starting", "stop", "stopping"],
    ["running", "stop", "stopping"],
    ["running", "hang", "error"],
    ["running", "exit-abnormal", "crashed"],
    ["running", "exit-clean", "stopped"],
    ["stopping", "stop-complete", "stopped"],
    ["stopping", "stop-timeout", "stopped"],
    ["stopping", "exit-clean", "stopped"],
    ["stopping", "exit-abnormal", "stopped"],
  ];

  for (const [state, event, next] of legal) {
    it(`${state} + ${event} → ${next}`, () => {
      expect(transition(state, event)).toBe(next);
      expect(canTransition(state, event)).toBe(true);
    });
  }

  it("throws INVALID_STATE for an unlisted (state, event) pair", () => {
    expect(() => transition("running", "start")).toThrow();
    expect(() => transition("stopping", "start")).toThrow();
    expect(() => transition("stopped", "stop")).toThrow();
    expect(canTransition("running", "start")).toBe(false);
  });

  it("covers every state in the table exactly once", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(
      [...INSTANCE_STATES].sort(),
    );
  });

  it("isLive marks the states that hold a child process", () => {
    expect(isLive("starting")).toBe(true);
    expect(isLive("running")).toBe(true);
    expect(isLive("stopping")).toBe(true);
    expect(isLive("stopped")).toBe(false);
    expect(isLive("error")).toBe(false);
    expect(isLive("crashed")).toBe(false);
  });
});
