import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/read-api/reader.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
