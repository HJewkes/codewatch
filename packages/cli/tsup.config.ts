import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/read-api/reader.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Only the private workspace packages are inlined; @titan-design/* must stay external (style-profile resolves templates from its own package.json).
  noExternal: ["@codewatch/core", "@codewatch/render"],
});
