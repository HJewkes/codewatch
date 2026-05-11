import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  fileId,
  moduleId,
  parentModuleId,
  packageId,
  externalId,
} from "../extractors/ids.js";

const ROOT = path.resolve("/repo");

describe("fileId", () => {
  it("returns the repo-relative path with extension", () => {
    expect(fileId(ROOT, path.join(ROOT, "src", "index.ts"))).toBe("src/index.ts");
  });

  it("preserves tsx extensions", () => {
    expect(fileId(ROOT, path.join(ROOT, "src", "App.tsx"))).toBe("src/App.tsx");
  });
});

describe("moduleId", () => {
  it("strips the .ts extension", () => {
    expect(moduleId(ROOT, path.join(ROOT, "src", "index.ts"))).toBe("src/index");
  });

  it("strips the .tsx extension", () => {
    expect(moduleId(ROOT, path.join(ROOT, "src", "App.tsx"))).toBe("src/App");
  });

  it("strips .mts and .cts extensions", () => {
    expect(moduleId(ROOT, path.join(ROOT, "src", "a.mts"))).toBe("src/a");
    expect(moduleId(ROOT, path.join(ROOT, "src", "b.cts"))).toBe("src/b");
  });
});

describe("parentModuleId", () => {
  it("returns the parent directory", () => {
    expect(parentModuleId("packages/graph/src/index")).toBe("packages/graph/src");
  });

  it("returns null at the repo root", () => {
    expect(parentModuleId("index")).toBeNull();
  });
});

describe("packageId", () => {
  it("returns the package name unchanged", () => {
    expect(packageId("@code-style/graph")).toBe("@code-style/graph");
    expect(packageId("better-sqlite3")).toBe("better-sqlite3");
  });
});

describe("externalId", () => {
  it("preserves node: builtins verbatim", () => {
    expect(externalId("node:fs/promises")).toBe("node:fs/promises");
    expect(externalId("node:fs")).toBe("node:fs");
  });

  it("strips subpaths from bare npm packages", () => {
    expect(externalId("typescript")).toBe("npm:typescript");
    expect(externalId("foo/bar")).toBe("npm:foo");
    expect(externalId("lodash/fp/flow")).toBe("npm:lodash");
  });

  it("preserves scope when stripping subpaths from scoped packages", () => {
    expect(externalId("@scope/pkg")).toBe("npm:@scope/pkg");
    expect(externalId("@scope/pkg/sub")).toBe("npm:@scope/pkg");
    expect(externalId("@code-style/core/foo/bar")).toBe("npm:@code-style/core");
  });
});
