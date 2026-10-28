import { describe, it, expect } from "vitest";
import { parseFile } from "@titan-design/code-parser";
import { errorKey, errorSites, paramsAt } from "../commands/audit-contract-facts.js";

const py = (text: string) => parseFile(text, "m.py", "python");
const ts = (text: string) => parseFile(text, "m.ts", "typescript");

describe("error sites", () => {
  it("counts a call to a method that always raises as that method's exception", async () => {
    const file = await py(`class P:
    def err(self, msg):
        raise QueryError(msg)

    def atom(self):
        self.err("expected  literal", 1)
`);
    expect(errorSites(file).map((s) => [s.line, errorKey(s), s.via])).toEqual([
      [3, "QueryError:", undefined],
      [6, "QueryError:expected literal", "err"],
    ]);
  });

  it("does not treat a function that can return after raising as a raiser", async () => {
    const file = await py(`def check(x):
    if x:
        return 1
    raise ValueError("no")


def use():
    check("bad")
`);
    expect(errorSites(file).map(errorKey)).toEqual(["ValueError:no"]);
  });

  it("keys a template-literal message by its static text before the first substitution", async () => {
    const file = await ts("export function f(n: number): void {\n  throw new Error(`bad width ${n} given`);\n}\n");
    expect(errorSites(file).map(errorKey)).toEqual(["Error:bad width"]);
  });

  it("keys a %-, +- or format-built message by its text before the first placeholder", async () => {
    const pyFile = await py('def f(g):\n    raise E("duplicate field: %s" % g)\n    raise E("bad {}".format(g))\n');
    const tsFile = await ts('function f(g: string): void {\n  throw new E("unknown alias " + g);\n}\n');
    expect([...errorSites(pyFile), ...errorSites(tsFile)].map(errorKey)).toEqual(["E:duplicate field:", "E:bad", "E:unknown alias"]);
  });

  it("keys exits by their non-zero code and falls back to an error-code constant", async () => {
    const file = await ts(`function main(): void {
  process.exit(0);
  process.exit(2);
  process.exitCode = 3;
  throw new Failure(Codes.BAD_INPUT);
}
`);
    expect(errorSites(file).map(errorKey)).toEqual(["exit:2", "exit:3", "Failure:BAD_INPUT"]);
  });

  it("reads sys.exit and raise SystemExit as exits", async () => {
    const file = await py('import sys\n\n\ndef main():\n    sys.exit(1)\n    raise SystemExit("usage")\n');
    expect(errorSites(file).map(errorKey)).toEqual(["exit:1", "exit:usage"]);
  });
});

describe("params", () => {
  it("marks Python params after * as keyword-only and drops the receiver", async () => {
    const file = await py("class C:\n    def m(self, a, b=2, *, c, d: int = 4):\n        pass\n");
    expect(paramsAt(file, 2)).toEqual([
      { name: "a", positional: true, required: true },
      { name: "b", positional: true, required: false, default: "2" },
      { name: "c", positional: false, required: true },
      { name: "d", positional: false, required: false, default: "4" },
    ]);
  });

  it("treats a TS ? param as optional without a default and a valued param as defaulted", async () => {
    const file = await ts("export function f(this: void, a: string, b?: number, c = 4, ...rest: string[]): void {}\n");
    expect(paramsAt(file, 1)).toEqual([
      { name: "a", positional: true, required: true },
      { name: "b", positional: true, required: false },
      { name: "c", positional: true, required: false, default: "4" },
    ]);
  });

  it("finds no callable on a line without one", async () => {
    expect(paramsAt(await ts("const x = 1;\n"), 1)).toBeUndefined();
  });
});
