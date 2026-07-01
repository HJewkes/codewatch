import { describe, it, expect } from "vitest";
import { annotateRoles, classifyRole } from "../roles.js";
import type { GraphNode } from "../types.js";

describe("classifyRole", () => {
  it("recognizes test files", () => {
    expect(classifyRole("packages/foo/src/__tests__/bar.test.ts")).toBe("test");
    expect(classifyRole("src/foo.test.ts")).toBe("test");
    expect(classifyRole("src/foo.spec.ts")).toBe("test");
    expect(classifyRole("src/__tests__/foo")).toBe("test");
  });

  it("recognizes fixture directories", () => {
    expect(classifyRole("src/__tests__/fixtures/sample.ts")).toBe("test");
    expect(classifyRole("src/fixtures/sample.ts")).toBe("fixture");
    expect(classifyRole("fixtures/x")).toBe("fixture");
  });

  it("recognizes barrel files (index.*)", () => {
    expect(classifyRole("packages/foo/src/index.ts")).toBe("barrel");
    expect(classifyRole("foo/index")).toBe("barrel");
    expect(classifyRole("foo/index.js")).toBe("barrel");
  });

  it("recognizes types files", () => {
    expect(classifyRole("src/types.ts")).toBe("types");
    expect(classifyRole("src/foo.types.ts")).toBe("types");
    expect(classifyRole("packages/foo/src/types")).toBe("types");
  });

  it("recognizes config files", () => {
    expect(classifyRole("vite.config.ts")).toBe("config");
    expect(classifyRole("packages/foo/tsup.config.ts")).toBe("config");
  });

  it("recognizes scripts/ and archive/ files as script role", () => {
    expect(classifyRole("scripts/regenerate.ts")).toBe("script");
    expect(classifyRole("packages/render/scripts/build.ts")).toBe("script");
    expect(classifyRole("archive/old-thing.ts")).toBe("script");
    expect(classifyRole("scripts/diagnostic/run.ts")).toBe("script");
  });

  it("does not treat a non-segment 'scripts' substring as script role", () => {
    expect(classifyRole("src/scripts-utils.ts")).toBe("source");
    expect(classifyRole("src/typescripts/foo.ts")).toBe("source");
  });

  it("test wins over script for a test file under scripts/", () => {
    expect(classifyRole("scripts/foo.test.ts")).toBe("test");
  });

  it("falls through to source for everything else", () => {
    expect(classifyRole("packages/cli/src/commands/graph-top.ts")).toBe("source");
    expect(classifyRole("packages/graph/src/database")).toBe("source");
  });

  it("test takes precedence over barrel/types/config", () => {
    expect(classifyRole("__tests__/index.test.ts")).toBe("test");
    expect(classifyRole("src/__tests__/types.test.ts")).toBe("test");
  });
});

describe("annotateRoles", () => {
  const nodes: GraphNode[] = [
    { id: "src/foo.ts", kind: "file", name: "foo" },
    { id: "src/__tests__/foo.test.ts", kind: "file", name: "foo.test" },
    { id: "src/index", kind: "module", name: "index" },
    { id: "npm:lodash", kind: "external", name: "lodash" },
    { id: "src/foo", kind: "module", name: "foo" },
  ];

  it("assigns roles to file and module nodes", () => {
    const out = annotateRoles(nodes);
    expect(out.find((n) => n.id === "src/foo.ts")?.role).toBe("source");
    expect(out.find((n) => n.id === "src/__tests__/foo.test.ts")?.role).toBe("test");
    expect(out.find((n) => n.id === "src/index")?.role).toBe("barrel");
    expect(out.find((n) => n.id === "src/foo")?.role).toBe("source");
  });

  it("leaves external nodes alone", () => {
    const out = annotateRoles(nodes);
    expect(out.find((n) => n.id === "npm:lodash")?.role).toBeUndefined();
  });

  it("preserves an explicit role if already set", () => {
    const explicit: GraphNode[] = [
      { id: "src/foo.ts", kind: "file", name: "foo", role: "config" },
    ];
    expect(annotateRoles(explicit)[0]!.role).toBe("config");
  });
});
