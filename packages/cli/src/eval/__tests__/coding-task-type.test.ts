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

  it("assigns T6 to three or more sibling consumers, even when they sit at hop 2", () => {
    const files = [
      lit("src/format.ts"),
      dark("src/commands/search.ts", 2),
      dark("src/commands/status.ts", 2),
      dark("src/commands/memories.ts", null),
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

  it("leaves the type unset when two rules disagree", () => {
    const files = [
      added("src/tools/plan.ts"),
      dark("src/tools/index.ts", null, "export-only"),
      dark("src/schemas/set.ts", 3),
    ];

    expect(assignTaskType(files)).toBeUndefined();
  });
});
