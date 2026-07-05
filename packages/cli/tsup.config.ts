import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/read-api/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
