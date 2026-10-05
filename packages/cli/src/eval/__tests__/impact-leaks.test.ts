import { describe, it, expect } from "vitest";
import { findGoldLeaks } from "../impact-leaks.js";

function seedDiff(path: string, added: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,1 @@",
    "-const before = 1;",
    `+${added}`,
    "",
  ].join("\n");
}

function leaks(seedFile: string, added: string, gold: string, ids: string[] = []): string[] {
  const input = { seedDiff: seedDiff(seedFile, added), seedFiles: [seedFile], gold: [gold] };
  return findGoldLeaks(input, new Set(ids));
}

describe("findGoldLeaks", () => {
  it("finds a re-export of a gold index file that shares the seed's basename", () => {
    const found = leaks("src/api/index.ts", 'export * from "../wiring/index.js";', "src/wiring/index.ts");

    expect(found).toEqual(["import:src/wiring/index.ts"]);
  });

  it("finds a directory import that resolves to a gold index file", () => {
    const found = leaks("src/api/index.ts", 'export * from "../wiring";', "src/wiring/index.ts");

    expect(found).toEqual(["import:src/wiring/index.ts"]);
  });

  it("finds an extensionless import of a dotted gold basename", () => {
    const found = leaks("src/api/handler.ts", 'import { find } from "../db/user.service";', "src/db/user.service.ts");

    expect(found).toEqual(["import:src/db/user.service.ts", "specifier:user.service"]);
  });

  it("finds a .js import of a dotted gold basename", () => {
    const found = leaks("src/api/handler.ts", 'import { find } from "../db/user.service.js";', "src/db/user.service.ts");

    expect(found).toEqual(["import:src/db/user.service.ts", "specifier:user.service"]);
  });

  it("finds a template-literal dynamic import of a gold file", () => {
    const found = leaks("src/api/handler.ts", "await import(`../wiring/route-table.js`);", "src/wiring/route-table.ts");

    expect(found).toEqual(["import:src/wiring/route-table.ts", "specifier:route-table"]);
  });

  it("finds a bare mention of a gold basename", () => {
    const found = leaks("src/api/handler.ts", "// mirrors route-table.ts", "src/wiring/route-table.ts");

    expect(found).toEqual(["basename:route-table.ts"]);
  });

  it("ignores a bare basename the seed file shares", () => {
    const found = leaks("src/api/index.ts", "// re-exported from index.ts", "src/wiring/index.ts");

    expect(found).toEqual([]);
  });

  it("finds a gold path and a gold identifier", () => {
    const found = leaks("src/api/handler.ts", "mountQuokka(); // src/wiring/table.ts", "src/wiring/table.ts", [
      "mountQuokka",
    ]);

    expect(found).toEqual(["path:src/wiring/table.ts", "basename:table.ts", "identifier:mountQuokka"]);
  });
});
