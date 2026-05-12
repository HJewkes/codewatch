import { describe, it, expect } from "vitest";
import { snapshotVersionMismatchWarning } from "../utils/output.js";

describe("snapshotVersionMismatchWarning", () => {
  it("returns null when versions match", () => {
    expect(snapshotVersionMismatchWarning("0.2.0", "0.2.0", "ctx")).toBeNull();
  });

  it("returns a warning mentioning both versions and context when they differ", () => {
    const warning = snapshotVersionMismatchWarning("0.2.0", "0.1.0", "graph report --vs");
    expect(warning).not.toBeNull();
    expect(warning!).toContain("0.2.0");
    expect(warning!).toContain("0.1.0");
    expect(warning!).toContain("graph report --vs");
  });
});
