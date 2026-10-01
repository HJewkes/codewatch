import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    pool: "threads",
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
    testTimeout: 15_000,
    include: ["**/*.test.ts"],
  },
});
