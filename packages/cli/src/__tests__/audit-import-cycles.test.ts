import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuditCommand } from "../commands/audit.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "c129-cycles-"));
  mkdirSync(join(root, "src"));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, "src", name), text);
  return root;
}

async function cycleFindings(root: string) {
  const result = await runAuditCommand({ path: root, noTsSlop: true });
  return result.findings.filter((f) => f.signal === "file-import-cycles");
}

describe("import cycles in codewatch audit", () => {
  it("reports a two-file value cycle as one finding naming both files", async () => {
    dir = fixture({
      "alpha.ts": `import { beta } from "./beta.js";\nexport const alpha = (): number => beta() + 1;\n`,
      "beta.ts": `import { alpha } from "./alpha.js";\nexport const beta = (): number => (alpha.length > 0 ? 1 : 0);\n`,
    });

    const findings = await cycleFindings(dir);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ members: ["src/alpha.ts", "src/beta.ts"], cycleKind: "value", severity: "warning" });
    expect(findings[0]?.evidence).toContain("src/alpha.ts, src/beta.ts");
  });

  it("does not report a cycle closed only by type imports", async () => {
    dir = fixture({
      "shape.ts": `import type { Paint } from "./paint.js";\nexport interface Shape { paint: Paint }\n`,
      "paint.ts": `import type { Shape } from "./shape.js";\nexport interface Paint { owner: Shape }\n`,
    });

    expect(await cycleFindings(dir)).toEqual([]);
  });
});
