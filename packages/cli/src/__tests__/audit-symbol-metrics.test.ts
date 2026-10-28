import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAuditCommand } from "../commands/audit.js";

const LONG_BODY = Array.from({ length: 65 }, (_, i) => `    x${i} = ${i}`).join("\n");
const LONG_SRC = `def long_function():\n${LONG_BODY}\n    return x64\n`;

const DEEPLY_NESTED_SRC = `def deeply_nested(a, b, c, d, e):
    if a:
        if b:
            if c:
                if d:
                    if e:
                        return 1
    return 0
`;

const FLAT_SRC = `def flat_function(x):
    return x + 1
`;

let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "c104-audit-"));
  mkdirSync(join(dir, "pkg"));
  writeFileSync(join(dir, "pkg", "__init__.py"), "");
  writeFileSync(join(dir, "pkg", "long.py"), LONG_SRC);
  writeFileSync(join(dir, "pkg", "nested.py"), DEEPLY_NESTED_SRC);
  writeFileSync(join(dir, "pkg", "flat.py"), FLAT_SRC);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("codewatch audit symbol-loc and symbol-nesting rules", () => {
  it("flags the over-length function as symbol-loc and the deeply nested one as symbol-nesting, and flags the flat function as neither", async () => {
    const result = await runAuditCommand({ path: dir, noRuff: true });

    const locFinding = result.findings.find((f) => f.signal === "symbol-loc");
    expect(locFinding).toMatchObject({
      path: "pkg/long.py",
      symbol: "long_function",
      signal: "symbol-loc",
      tool: "code-graph",
    });
    expect(locFinding?.lineStart).toBe(1);
    expect(locFinding?.lineEnd).toBeGreaterThan(60);

    const nestingFinding = result.findings.find((f) => f.signal === "symbol-nesting");
    expect(nestingFinding).toMatchObject({
      path: "pkg/nested.py",
      symbol: "deeply_nested",
      signal: "symbol-nesting",
      tool: "code-graph",
    });
    expect(nestingFinding?.lineStart).toBe(1);
    expect(nestingFinding?.lineEnd).toBe(8);

    const flatSignals = result.findings.filter((f) => f.path === "pkg/flat.py").map((f) => f.signal);
    expect(flatSignals).not.toContain("symbol-loc");
    expect(flatSignals).not.toContain("symbol-nesting");
  });
});

const propNames = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i}`);

function componentSrc(name: string, props: readonly string[], read: readonly string[]): string {
  const members = props.map((p) => `  ${p}: string;`).join("\n");
  const body = read.map((p) => `{${p}}`).join("");
  return `type ${name}Props = {\n${members}\n};\n\nexport function ${name}({ ${props.join(", ")} }: ${name}Props) {\n  return <div>${body}</div>;\n}\n`;
}

describe("codewatch audit component prop rules", () => {
  let tsxDir: string;

  beforeAll(() => {
    tsxDir = mkdtempSync(join(tmpdir(), "c131-audit-"));
    mkdirSync(join(tsxDir, "src"));
    const components: Array<[string, string[], string[]]> = [
      ["Wide", propNames(16), propNames(16)],
      ["Narrow", propNames(15), propNames(15)],
      ["Unread", propNames(2), propNames(1)],
    ];
    for (const [name, props, read] of components) writeFileSync(join(tsxDir, "src", `${name}.tsx`), componentSrc(name, props, read));
  });

  afterAll(() => {
    rmSync(tsxDir, { recursive: true, force: true });
  });

  it("flags the 16-prop component and the one with an unread prop, and neither rule on the 15-prop fully read one", async () => {
    const result = await runAuditCommand({ path: tsxDir, noRuff: true });

    const propFindings = result.findings
      .filter((f) => f.signal === "symbol-prop-count" || f.signal === "symbol-unread-props")
      .map((f) => `${f.signal} ${f.path}#${f.symbol}`)
      .sort();
    expect(propFindings).toEqual(["symbol-prop-count src/Wide.tsx#Wide", "symbol-unread-props src/Unread.tsx#Unread"]);
  });
});
