import { describe, it, expect } from "vitest";
import {
  ablateDarkFiles,
  adjudicate,
  failToPassFiles,
  testsBroken,
  type AblateDeps,
} from "../coding-ablate.js";
import type { VitestTest } from "../coding-types.js";

function test(id: string, status: VitestTest["status"]): VitestTest {
  const [file = "", name = ""] = id.split(" :: ");
  return { id, file, name, status };
}

describe("adjudicate", () => {
  it.each([
    { testsFail: true, typeFails: true, expected: "test" },
    { testsFail: true, typeFails: false, expected: "test" },
    { testsFail: false, typeFails: true, expected: "type" },
    { testsFail: false, typeFails: false, expected: "none" },
    { testsFail: true, typeFails: null, expected: "test" },
    { testsFail: false, typeFails: null, expected: "none" },
  ] as const)(
    "tests fail $testsFail, tsc fails $typeFails -> $expected",
    ({ testsFail, typeFails, expected }) => {
      expect(adjudicate({ testsFail, typeFails })).toBe(expected);
    },
  );
});

describe("testsBroken", () => {
  const f2p = ["a.test.ts :: adds", "a.test.ts :: subtracts"];

  it("is false when every failToPass test still passes", () => {
    const results = [test(f2p[0]!, "pass"), test(f2p[1]!, "pass")];

    expect(testsBroken(f2p, results)).toBe(false);
  });

  it("is true when one failToPass test fails again", () => {
    const results = [test(f2p[0]!, "pass"), test(f2p[1]!, "fail")];

    expect(testsBroken(f2p, results)).toBe(true);
  });

  it("is true when the restored file stops the test file from loading", () => {
    expect(testsBroken(f2p, [])).toBe(true);
  });
});

describe("failToPassFiles", () => {
  it("returns each test file once, in order", () => {
    const ids = ["b.test.ts :: x", "a.test.ts :: y", "b.test.ts :: z"];

    expect(failToPassFiles(ids)).toEqual(["b.test.ts", "a.test.ts"]);
  });
});

interface Recorder {
  deps: AblateDeps;
  calls: string[];
}

function recorder(breaksTests: string[], breaksTypes: string[]): Recorder {
  const calls: string[] = [];
  let restored: string | null = null;
  const deps: AblateDeps = {
    reset: (_w, ref) => {
      calls.push(`reset ${ref}`);
      restored = null;
    },
    restore: (_w, ref, file) => {
      calls.push(`restore ${ref} ${file}`);
      restored = file;
    },
    runTests: (_w, files) => {
      calls.push(`test ${files.join(",")}`);
      const status = restored && breaksTests.includes(restored) ? "fail" : "pass";
      return [test("a.test.ts :: works", status)];
    },
    typecheck: (argv) => {
      calls.push(`tsc ${argv.join(" ")}`);
      return !(restored && breaksTypes.includes(restored));
    },
  };
  return { deps, calls };
}

const baseOpts = {
  parentCommit: "p1",
  fixCommit: "f1",
  failToPass: ["a.test.ts :: works"],
};

describe("ablateDarkFiles", () => {
  it("adjudicates each dark file restored on its own at the fix commit", () => {
    const { deps } = recorder(["src/a.ts"], ["src/b.ts"]);

    const result = ablateDarkFiles(
      "/work",
      { ...baseOpts, darkFiles: ["src/a.ts", "src/b.ts", "src/c.ts"], tsc: ["tsc", "--noEmit"] },
      deps,
    );

    expect(result).toEqual({ "src/a.ts": "test", "src/b.ts": "type", "src/c.ts": "none" });
  });

  it("resets to the fix commit before each file and skips tsc once a test fails", () => {
    const { deps, calls } = recorder(["src/a.ts"], []);

    ablateDarkFiles("/work", { ...baseOpts, darkFiles: ["src/a.ts"], tsc: ["tsc"] }, deps);

    expect(calls).toEqual(["reset f1", "restore p1 src/a.ts", "test a.test.ts", "reset f1"]);
  });

  it("never runs tsc when no tsc command is given", () => {
    const { deps, calls } = recorder([], ["src/b.ts"]);

    const result = ablateDarkFiles("/work", { ...baseOpts, darkFiles: ["src/b.ts"] }, deps);

    expect(result).toEqual({ "src/b.ts": "none" });
    expect(calls.some((c) => c.startsWith("tsc"))).toBe(false);
  });
});
