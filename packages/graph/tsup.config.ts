import { defineConfig } from "tsup";
import { copyFile } from "node:fs/promises";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  async onSuccess() {
    await copyFile("src/schema.sql", "dist/schema.sql");
  },
});
