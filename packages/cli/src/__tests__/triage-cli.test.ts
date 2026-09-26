import { describe, it, expect, vi, beforeEach } from "vitest";
import { Command } from "commander";
import { registerTriageCommand } from "../commands/triage-cli.js";

const runTriage = vi.hoisted(() => vi.fn());
vi.mock("../commands/triage.js", () => ({ runTriage }));
vi.mock("../commands/triage-output.js", () => ({ formatTriageSummary: () => [] }));

const REPORT = { warnings: [], controls: { controlRun: "ok" } };

async function triage(...args: string[]): Promise<Record<string, unknown>> {
  const program = new Command().exitOverride();
  registerTriageCommand(program);
  await program.parseAsync(["node", "codewatch", "triage", "repo", ...args]);
  return runTriage.mock.calls[0]![0] as Record<string, unknown>;
}

describe("codewatch triage --max-failures", () => {
  beforeEach(() => {
    runTriage.mockReset();
    runTriage.mockResolvedValue({ report: REPORT, outDir: "out" });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("tolerates three failed reader calls by default", async () => {
    expect(await triage()).toMatchObject({ maxFailures: 3 });
  });

  it("passes the flag's value to the triage run", async () => {
    expect(await triage("--max-failures", "0")).toMatchObject({ maxFailures: 0 });
  });

  it("rejects a fractional value", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(triage("--max-failures", "1.5")).rejects.toThrow(/whole number/);
  });
});
