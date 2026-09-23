import { describe, it, expect } from "vitest";
import { describeChurnWindow, parseChurnWindow } from "../utils/churn-window.js";

describe("parseChurnWindow", () => {
  it("returns undefined when the flag is absent", () => {
    expect(parseChurnWindow(undefined)).toBeUndefined();
  });

  it("parses a day count", () => {
    expect(parseChurnWindow("14")).toBe(14);
  });

  it("accepts lifetime in any case", () => {
    expect(parseChurnWindow("lifetime")).toBe("lifetime");
    expect(parseChurnWindow("LIFETIME")).toBe("lifetime");
  });

  it("rejects values that are neither a positive day count nor lifetime", () => {
    expect(() => parseChurnWindow("forever")).toThrow(/Invalid --window-days "forever"/);
    expect(() => parseChurnWindow("0")).toThrow(/positive day count/);
  });
});

describe("describeChurnWindow", () => {
  it("labels finite and lifetime windows", () => {
    expect(describeChurnWindow(30)).toBe("last 30d");
    expect(describeChurnWindow("lifetime")).toBe("all-time");
  });
});
