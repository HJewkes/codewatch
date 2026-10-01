import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    projects: ["packages/*", "tests/integration", "tests/plugin"],
    passWithNoTests: true,
    // vitest 3.x reads poolOptions only from the root, so the cap lives here
    pool: "threads",
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
  },
});
