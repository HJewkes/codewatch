import { describe, it, expect } from "vitest";
import {
  isManifestPath,
  owningPackage,
  packagesSpanned,
  parseWorkspace,
  resolveWorkspaceSpecifier,
} from "../coding-workspace.js";

const WORKSPACE = parseWorkspace(
  new Map([
    ["package.json", '{"name":"monorepo","private":true}'],
    [
      "packages/core/package.json",
      '{"name":"@acme/core","exports":{".":{"types":"./dist/index.d.ts","import":"./dist/index.js"},"./graph":"./dist/graph/open.js"}}',
    ],
    ["packages/render/package.json", '{"name":"@acme/render","main":"lib/main.js"}'],
    ["packages/bare/package.json", '{"name":"@acme/bare"}'],
    [
      "packages/tools/package.json",
      '{"name":"@acme/tools","exports":{".":"./dist/main.js","./*":{"import":"./dist/lib/*.js"}}}',
    ],
    ["packages/broken/package.json", "{not json"],
  ]),
);

const FILE_IDS = new Set([
  "packages/core/src/index.ts",
  "packages/core/src/graph/open.ts",
  "packages/core/src/util.ts",
  "packages/render/src/main.ts",
  "packages/bare/src/index.ts",
  "packages/bare/src/extra/helper.ts",
  "packages/tools/src/main.ts",
  "packages/tools/src/lib/fmt.ts",
]);

function resolve(specifier: string): string | null {
  return resolveWorkspaceSpecifier(specifier, WORKSPACE, FILE_IDS);
}

describe("resolveWorkspaceSpecifier", () => {
  it("maps a conditional exports entry from dist to its source file", () => {
    expect(resolve("@acme/core")).toBe("packages/core/src/index.ts");
  });

  it("resolves an exported subpath", () => {
    expect(resolve("@acme/core/graph")).toBe("packages/core/src/graph/open.ts");
  });

  it("resolves a subpath through a single-star exports pattern", () => {
    expect(resolve("@acme/tools/fmt")).toBe("packages/tools/src/lib/fmt.ts");
  });

  it("maps a main field under lib/ to src/", () => {
    expect(resolve("@acme/render")).toBe("packages/render/src/main.ts");
  });

  it("falls back to src/ for a package with no declared entry", () => {
    expect(resolve("@acme/bare")).toBe("packages/bare/src/index.ts");
    expect(resolve("@acme/bare/extra/helper.js")).toBe("packages/bare/src/extra/helper.ts");
  });

  it("leaves packages outside the workspace and relative specifiers unresolved", () => {
    expect(resolve("@other/pkg")).toBeNull();
    expect(resolve("vitest")).toBeNull();
    expect(resolve("./util")).toBeNull();
  });
});

describe("parseWorkspace", () => {
  it("skips manifests that are not valid JSON", () => {
    expect([...WORKSPACE.keys()].sort()).toEqual([
      "@acme/bare",
      "@acme/core",
      "@acme/render",
      "@acme/tools",
      "monorepo",
    ]);
  });
});

describe("isManifestPath", () => {
  it("accepts package.json files outside node_modules only", () => {
    expect(isManifestPath("package.json")).toBe(true);
    expect(isManifestPath("packages/core/package.json")).toBe(true);
    expect(isManifestPath("node_modules/x/package.json")).toBe(false);
    expect(isManifestPath("src/my-package.json")).toBe(false);
  });
});

describe("packagesSpanned", () => {
  it("counts the deepest owning package of each edit file", () => {
    expect(owningPackage("packages/core/src/util.ts", WORKSPACE)).toBe("@acme/core");
    expect(owningPackage("scripts/x.ts", WORKSPACE)).toBe("monorepo");
    expect(
      packagesSpanned(
        ["packages/core/src/util.ts", "packages/core/src/index.ts", "packages/render/src/main.ts"],
        WORKSPACE,
      ),
    ).toBe(2);
  });

  it("counts a repo with no manifests as one package", () => {
    expect(packagesSpanned(["src/a.ts", "lib/b.ts"], new Map())).toBe(1);
  });
});
