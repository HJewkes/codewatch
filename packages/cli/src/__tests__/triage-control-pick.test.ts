import { describe, it, expect } from "vitest";
import { kindsAsked, pickRunControls } from "../commands/triage-control-pick.js";
import { loadControls } from "../commands/triage-controls/controls.js";

const POOL = loadControls();
const SEEDS = Array.from({ length: 40 }, (_, i) => `seed-${i}`);

describe("pickRunControls", () => {
  it("plants a helper control in every run whose questions include single-caller-helper", () => {
    const signals = ["symbol-single-caller-helper", "symbol-cognitive"];

    const runs = SEEDS.map((seed) => pickRunControls(POOL, signals, seed, 4));

    for (const picked of runs) {
      expect(picked).toHaveLength(4);
      expect(picked.some((c) => c.kind === "single-caller-helper")).toBe(true);
    }
  });

  it("plants exactly one control of each kind when the run asks all four kinds", () => {
    const signals = ["symbol-single-caller-helper", "symbol-comment-ratio", "pyright/reportUnnecessaryIsInstance", "symbol-pass-through"];

    const runs = SEEDS.map((seed) => pickRunControls(POOL, signals, seed, 4));

    for (const picked of runs) expect(picked.map((c) => c.kind).sort()).toEqual(["comment", "pass-through", "single-caller-helper", "unnecessary-isinstance"]);
    expect(runs.every((picked) => picked.filter((c) => c.label === "clean").length === 2)).toBe(true);
  });

  it("fills to the requested count with both labels when one kind is asked", () => {
    const picked = pickRunControls(POOL, ["symbol-pass-through"], "fill", 4);

    expect(picked).toHaveLength(4);
    expect(new Set(picked.map((c) => c.id)).size).toBe(4);
    expect(picked.filter((c) => c.label === "clean")).toHaveLength(2);
  });

  it("plants one per kind even when more kinds are asked than the requested count", () => {
    const signals = ["symbol-single-caller-helper", "symbol-narrating-comments", "pyright/reportUnnecessaryCast"];

    expect(pickRunControls(POOL, signals, "few", 2)).toHaveLength(3);
  });

  it("plants no control when asked for none", () => {
    expect(pickRunControls(POOL, ["symbol-single-caller-helper"], "none", 0)).toEqual([]);
  });

  it("falls back to a balanced seeded pick when no question matches a control kind", () => {
    const picked = pickRunControls(POOL, ["symbol-cognitive", "file-swallowed-except"], "plain", 4);

    expect(picked).toHaveLength(4);
    expect(picked.filter((c) => c.label === "slop")).toHaveLength(2);
  });
});

describe("kindsAsked", () => {
  it("maps both comment signals and both defensive-check signals to their control kinds", () => {
    expect(kindsAsked(["symbol-comment-ratio", "pyright/reportUnnecessaryCast", "ERA001"])).toEqual(["comment", "unnecessary-isinstance"]);
  });
});
