import { describe, expect, it } from "vitest";
import { isLiveState, stateUi } from "./state.js";
import { capabilityIcon, capabilityIcons } from "./capabilities.js";

describe("state mapping (Faza 7.1, FP-6)", () => {
  it("maps running → green + Działa", () => {
    expect(stateUi("running")).toEqual({
      colorVar: "--color-state-running",
      label: "Działa",
      symbol: "🟢",
    });
  });

  it("maps unknown → gray + Nieznany", () => {
    expect(stateUi("unknown").symbol).toBe("❓");
  });

  it("isLiveState: running/starting/stopping live", () => {
    expect(isLiveState("running")).toBe(true);
    expect(isLiveState("starting")).toBe(true);
    expect(isLiveState("stopped")).toBe(false);
    expect(isLiveState("unknown")).toBe(false);
  });
});

describe("capability icons (Faza 7.1)", () => {
  it("maps a known capability to its icon", () => {
    expect(capabilityIcon("text")).toEqual({ icon: "🔤", key: "text" });
    expect(capabilityIcon("tool-calling")).toEqual({
      icon: "🔧",
      key: "tool-calling",
    });
  });

  it("maps an unknown capability to a generic bullet", () => {
    expect(capabilityIcon("nonsense").icon).toBe("•");
  });

  it("capabilityIcons: only enabled flags, sorted", () => {
    expect(capabilityIcons({ vision: true, text: true, audio: false })).toEqual(
      [
        { icon: "🔤", key: "text" },
        { icon: "👁", key: "vision" },
      ],
    );
  });
});
