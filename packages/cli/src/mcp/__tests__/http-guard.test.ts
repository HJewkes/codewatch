import { describe, it, expect } from "vitest";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasBearerToken, isAllowedOrigin, isLoopbackHost } from "../http-guard.js";
import { createTokenFile } from "../http-token.js";

describe("loopback Host check", () => {
  it.each(["127.0.0.1:7423", "localhost:7423", "LOCALHOST:7423", "[::1]:7423"])("accepts %s", (host) => {
    expect(isLoopbackHost(host, 7423)).toBe(true);
  });

  it.each([
    "evil.example:7423",
    "127.0.0.1.evil.example:7423",
    "localhost",
    "localhost:80",
    "[::2]:7423",
    "",
  ])("refuses %j", (host) => {
    expect(isLoopbackHost(host, 7423)).toBe(false);
  });

  it("refuses a missing Host", () => {
    expect(isLoopbackHost(undefined, 7423)).toBe(false);
  });
});

describe("Origin check", () => {
  it("allows a request with no Origin (a non-browser client)", () => {
    expect(isAllowedOrigin(undefined)).toBe(true);
  });

  it.each(["http://127.0.0.1:7423", "http://localhost:3000", "https://[::1]"])("allows %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(true);
  });

  it.each(["http://evil.example", "null", "file://", "http://localhost.evil.example"])("refuses %s", (origin) => {
    expect(isAllowedOrigin(origin)).toBe(false);
  });
});

describe("bearer token check", () => {
  it("accepts the exact token and refuses anything else", () => {
    expect(hasBearerToken("Bearer abc123", "abc123")).toBe(true);
    expect(hasBearerToken("Bearer abc124", "abc123")).toBe(false);
    expect(hasBearerToken("Bearer abc", "abc123")).toBe(false);
    expect(hasBearerToken("abc123", "abc123")).toBe(false);
    expect(hasBearerToken(undefined, "abc123")).toBe(false);
  });
});

describe("token file", () => {
  it("replaces an existing world-readable file with a fresh 0600 one", () => {
    const dir = mkdtempSync(join(tmpdir(), "c214-token-"));
    const tokenPath = join(dir, "mcp.token");
    writeFileSync(tokenPath, "stale\n");
    chmodSync(tokenPath, 0o644);

    const token = createTokenFile(tokenPath);

    expect(statSync(tokenPath).mode & 0o777).toBe(0o600);
    expect(token).not.toBe("stale");
    rmSync(dir, { recursive: true, force: true });
  });
});
