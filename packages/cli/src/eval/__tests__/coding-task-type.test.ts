import { describe, it, expect } from "vitest";
import type { EditFileScreen } from "../coding-screen.js";
import { assignTaskType } from "../coding-task-type.js";

function lit(path: string, hop: number | null = 1): EditFileScreen {
  return { path, light: "shares-identifier", hop };
}

function added(path: string): EditFileScreen {
  return { path, light: "added", hop: null };
}

function dark(path: string, hop: number | null, hunkKind: EditFileScreen["hunkKind"] = "logic"): EditFileScreen {
  return { path, light: "dark", hop, hunkKind, secondOrderDark: true };
}

describe("assignTaskType", () => {
  it("assigns T4 to a barrel edit that registers an added unit", () => {
    const files = [added("src/tools/plan.ts"), dark("src/tools/index.ts", null, "export-only")];

    expect(assignTaskType(files)).toBe("T4");
  });

  it("assigns T3 to parallel barrels changed together with no added unit", () => {
    const files = [
      lit("src/core/state.ts"),
      dark("src/entries/web/index.ts", null, "export-only"),
      dark("src/entries/native/index.ts", null, "export-only"),
    ];

    expect(assignTaskType(files)).toBe("T3");
  });

  it("assigns T5 to a dark logic edit two or more hops from the tests", () => {
    const files = [lit("src/agents/reap.ts"), dark("src/agents/config-dir.ts", 2)];

    expect(assignTaskType(files)).toBe("T5");
  });

  it("assigns T6 to three or more dark sibling consumers, even when they sit at hop 2", () => {
    const files = [
      lit("src/format.ts"),
      dark("src/commands/search.ts", 2),
      dark("src/commands/status.ts", 2),
      dark("src/commands/memories.ts", null),
      lit("src/commands/format.ts"),
    ];

    expect(assignTaskType(files)).toBe("T6");
  });

  it("does not count a shallow or non-logic dark edit as T5", () => {
    expect(assignTaskType([lit("src/a.ts"), dark("src/b.ts", 1)])).toBeUndefined();
    expect(assignTaskType([lit("src/a.ts"), dark("src/b.ts", 3, "type-only")])).toBeUndefined();
    expect(assignTaskType([lit("src/a.ts"), dark("src/b.ts", null)])).toBeUndefined();
  });

  it("leaves a lone barrel edit with no added unit unset", () => {
    const files = [lit("src/a.ts"), dark("src/index.ts", null, "export-only")];

    expect(assignTaskType(files)).toBeUndefined();
  });

  it("counts only dark files toward a sweep, so lit siblings do not hide a T5", () => {
    const files = [
      added("src/agents/claude-sessions.ts"),
      dark("src/agents/config-dir.ts", 2),
      lit("src/agents/detached-reap.ts", 1),
      dark("src/agents/identity.ts", null),
      lit("src/agents/supervisor.ts", 1),
    ];

    expect(assignTaskType(files)).toBe("T5");
  });

  it("leaves two barrels plus an added unit undecided rather than T4", () => {
    const files = [
      dark("src/index.ts", 2),
      dark("src/sdk/index.ts", 3),
      added("src/sdk/scheduler.ts"),
      lit("src/sdk/types.ts", 2),
      lit("src/sdk/voltra-client.ts", 1),
      added("src/voltra/protocol/rowing-frames.ts"),
    ];

    expect(assignTaskType(files)).toBeUndefined();
  });

  it("treats export-only entry modules as parallel barrels (T3)", () => {
    const files = [
      dark("src/entries/react-native.ts", null, "export-only"),
      dark("src/entries/web.ts", null, "export-only"),
      lit("src/sdk/types.ts"),
      lit("src/voltra/protocol/device-state.ts"),
      lit("src/voltra/protocol/telemetry-decoder.ts"),
      lit("src/voltra/protocol/types.ts"),
    ];

    expect(assignTaskType(files)).toBe("T3");
  });

  it("does not let a sweep override a barrel T3", () => {
    const files = [
      dark("src/entries/react-native.ts", null, "export-only"),
      dark("src/entries/web.ts", null, "export-only"),
      dark("src/voltra/protocol/device-state.ts", null),
      dark("src/voltra/protocol/telemetry-decoder.ts", null),
      dark("src/voltra/protocol/types.ts", null),
    ];

    expect(assignTaskType(files)).toBe("T3");
  });

  it("does not call barrels the tests already point at mirrored sites", () => {
    const files = [
      lit("src/broker/index.ts", null),
      lit("src/server/index.ts", null),
      dark("src/protocol.ts", 2, "type-only"),
    ];

    expect(assignTaskType(files)).toBeUndefined();
  });

  it("leaves the type unset when two rules disagree", () => {
    const files = [
      added("src/tools/plan.ts"),
      dark("src/tools/index.ts", null, "export-only"),
      dark("src/schemas/set.ts", 3),
    ];

    expect(assignTaskType(files)).toBeUndefined();
  });
});
