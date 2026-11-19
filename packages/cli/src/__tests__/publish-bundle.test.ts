import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { describe, it, expect } from "vitest";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const distDir = join(cliRoot, "dist");
const INTERNAL_IMPORT = /(?:from\s*|import\(\s*)["']@codewatch\//;
const TITAN_IMPORT = /(?:from\s*|import\(\s*)["']@titan-design\//;

function builtJsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return builtJsFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

const BARE_IMPORT =
  /^(?:import|export)\s[^"'`;]*?from\s*["']([^"'./][^"']*)["']|^import\s*["']([^"'./][^"']*)["']|\bimport\(\s*["']([^"'./][^"']*)["']\s*\)/gm;

function packageName(specifier: string): string {
  const [scopeOrName, second] = specifier.split("/");
  return scopeOrName.startsWith("@") ? `${scopeOrName}/${second}` : scopeOrName;
}

function externalPackagesImported(): Set<string> {
  const names = new Set<string>();
  for (const file of builtJsFiles(distDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(BARE_IMPORT)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (specifier.startsWith("node:") || builtinModules.includes(specifier)) continue;
      names.add(packageName(specifier));
    }
  }
  return names;
}

function readManifest(): Record<string, Record<string, string> | undefined> {
  return JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8"));
}

describe("published @codewatch/cli bundle", () => {
  it("has a build to inspect (run pnpm build first)", () => {
    expect(existsSync(join(distDir, "index.js"))).toBe(true);
  });

  it("inlines the private workspace packages instead of importing them", () => {
    const offenders = builtJsFiles(distDir)
      .filter((file) => INTERNAL_IMPORT.test(readFileSync(file, "utf8")))
      .map((file) => relative(distDir, file));

    expect(offenders).toEqual([]);
  });

  it("keeps @titan-design packages external so they resolve their own assets", () => {
    const importers = builtJsFiles(distDir).filter((file) =>
      TITAN_IMPORT.test(readFileSync(file, "utf8")),
    );

    expect(importers.length).toBeGreaterThan(0);
  });

  it("ships the TS slop rules at the path the bundle reads them from", () => {
    const files = readManifest().files as unknown as string[];

    expect(files).toContain("resources");
    expect(existsSync(join(distDir, "../resources/ts-slop-rules/misc.yml"))).toBe(true);
  });

  it("declares no runtime dependency on an unpublished @codewatch package", () => {
    const deps = Object.keys(readManifest().dependencies ?? {});

    expect(deps.filter((name) => name.startsWith("@codewatch/"))).toEqual([]);
  });

  it("declares every external package the bundle imports as a dependency", () => {
    const declared = new Set(Object.keys(readManifest().dependencies ?? {}));
    const missing = [...externalPackagesImported()].filter((name) => !declared.has(name));

    expect(missing).toEqual([]);
  });
});
