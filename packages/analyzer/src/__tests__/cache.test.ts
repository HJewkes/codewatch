import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileCache } from "../ingest/cache.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("FileCache", () => {
  let cacheDir: string;
  let cache: FileCache;

  beforeEach(async () => {
    cacheDir = path.join(tmpdir(), `code-style-cache-${Date.now()}`);
    cache = new FileCache(cacheDir);
  });

  afterEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  it("returns null on cache miss", async () => {
    const result = await cache.get("nonexistent-key");
    expect(result).toBeNull();
  });

  it("returns cached value on cache hit", async () => {
    const data = { files: [{ path: "test.ts" }] };
    await cache.set("my-key", data);

    const result = await cache.get("my-key");
    expect(result).toEqual(data);
  });

  it("creates cache directory if it does not exist", async () => {
    const nestedDir = path.join(cacheDir, "nested", "deep");
    const nestedCache = new FileCache(nestedDir);
    await nestedCache.set("key", { value: 1 });

    const result = await nestedCache.get("key");
    expect(result).toEqual({ value: 1 });
  });

  it("uses content-addressed filenames", async () => {
    await cache.set("test-key", { data: true });

    const entries = await fs.readdir(cacheDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^[a-f0-9]+\.json$/);
  });
});
