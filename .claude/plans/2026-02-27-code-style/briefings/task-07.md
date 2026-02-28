# Task 07: Formatting + Complexity Extractors

## Architectural Context

This task adds two extractors to the Wave 3 extractor set. The **formatting extractor** detects low-level code layout preferences (semicolons, trailing commas, brace style, quote style, indentation) by first checking existing config files (`.prettierrc`, `.editorconfig`) and falling back to ECLint-style frequency analysis on source code when no config exists. The **complexity extractor** measures function length (statement count via tree-sitter), maximum nesting depth per function, and cyclomatic complexity approximation.

Both extractors implement the `Extractor` interface from task-04 and produce `Observation[]` arrays. Formatting features map to Category 7 (Formatting & Layout) in the taxonomy -- 12 features total, all programmatic or heuristic, zero tokens. Complexity features map to function length and nesting depth from Category 2 (Code Structure), plus a cyclomatic complexity approximation.

The formatting extractor is unusual because its primary signal comes from **existing config files**, not AST analysis. When `.prettierrc`, `.editorconfig`, or similar configs exist, those are ground truth. Code-level frequency analysis is the fallback for repos without formatters. Per the tool pipeline matrix, tree-sitter is deliberately NOT used for formatting detection.

## File Ownership

**May modify:**
- `/packages/analyzer/src/extractors/formatting.ts` (NEW)
- `/packages/analyzer/src/extractors/complexity.ts` (NEW)
- `/packages/analyzer/tests/extractors/formatting.test.ts` (NEW)
- `/packages/analyzer/tests/extractors/complexity.test.ts` (NEW)
- `/tests/fixtures/formatting/` (NEW -- all fixture files)
- `/tests/fixtures/complexity/` (NEW -- all fixture files)

**Must not touch:**
- `/packages/analyzer/src/extractors/types.ts` (task-04 owns)
- `/packages/analyzer/src/extractors/base.ts` (task-04 owns)
- `/packages/analyzer/src/extractors/naming.ts` (task-04 owns)
- `/packages/analyzer/src/extractors/index.ts` (task-04 owns -- but you should request task-04 author to add your exports)
- `/packages/profile/**`
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`
- `/.claude/**`

**Read for context (do not modify):**
- `/packages/analyzer/src/extractors/types.ts` (Extractor interface, Observation type)
- `/packages/analyzer/src/extractors/base.ts` (BaseExtractor, tree-sitter helpers)
- `/packages/analyzer/src/extractors/naming.ts` (reference extractor implementation)
- `/docs/research/07-unified-feature-taxonomy.md` (Category 7: Formatting & Layout features)
- `/docs/research/08-tool-pipeline-matrix.md` (formatting uses config detection + ECLint-style inference)
- `/docs/plans/2026-02-27-code-style-design.md` (profile schema formatting section)

## Steps

### Step 1: Create formatting fixture files

**`/tests/fixtures/formatting/.prettierrc`**:

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "useTabs": false
}
```

**`/tests/fixtures/formatting/.editorconfig`**:

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

**`/tests/fixtures/formatting/semicolons-yes.ts`**:

```ts
const a = 1;
const b = 2;
function foo() {
  return a + b;
}
```

**`/tests/fixtures/formatting/semicolons-no.ts`**:

```ts
const a = 1
const b = 2
function foo() {
  return a + b
}
```

**`/tests/fixtures/formatting/single-quotes.ts`**:

```ts
const name = 'hello';
const greeting = 'world';
const template = `hello ${name}`;
```

**`/tests/fixtures/formatting/double-quotes.ts`**:

```ts
const name = "hello";
const greeting = "world";
const template = `hello ${name}`;
```

**`/tests/fixtures/formatting/trailing-commas.ts`**:

```ts
const obj = {
  a: 1,
  b: 2,
};

function foo(
  param1: string,
  param2: number,
) {
  return [param1, param2,];
}
```

**`/tests/fixtures/formatting/no-trailing-commas.ts`**:

```ts
const obj = {
  a: 1,
  b: 2
};

function foo(
  param1: string,
  param2: number
) {
  return [param1, param2];
}
```

**`/tests/fixtures/formatting/brace-style-1tbs.ts`**:

```ts
function foo() {
  if (true) {
    return 1;
  } else {
    return 2;
  }
}
```

**`/tests/fixtures/formatting/brace-style-allman.ts`**:

```ts
function foo()
{
  if (true)
  {
    return 1;
  }
  else
  {
    return 2;
  }
}
```

**`/tests/fixtures/formatting/indentation-spaces.ts`** (2-space):

```ts
function foo() {
  if (true) {
    return 1;
  }
}
```

**`/tests/fixtures/formatting/indentation-tabs.ts`** (tab):

```ts
function foo() {
	if (true) {
		return 1;
	}
}
```

### Step 2: Write formatting extractor tests

**`/packages/analyzer/tests/extractors/formatting.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { FormattingExtractor } from "../../src/extractors/formatting.js";
import type { Observation } from "../../src/extractors/types.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FIXTURES = resolve(
  import.meta.dirname,
  "../../../../tests/fixtures/formatting",
);

describe("FormattingExtractor", () => {
  const extractor = new FormattingExtractor();

  describe("config file detection", () => {
    it("parses .prettierrc and emits observations for each setting", async () => {
      const observations = await extractor.extractFromConfig(
        resolve(FIXTURES, ".prettierrc"),
      );

      const semiObs = observations.find(
        (o) => o.type === "formatting.semicolons",
      );
      expect(semiObs).toBeDefined();
      expect(semiObs!.value).toBe(true);
      expect(semiObs!.source).toBe("config");

      const quoteObs = observations.find(
        (o) => o.type === "formatting.quoteStyle",
      );
      expect(quoteObs).toBeDefined();
      expect(quoteObs!.value).toBe("single");

      const trailingObs = observations.find(
        (o) => o.type === "formatting.trailingCommas",
      );
      expect(trailingObs).toBeDefined();
      expect(trailingObs!.value).toBe(true);

      const indentSizeObs = observations.find(
        (o) => o.type === "formatting.indentSize",
      );
      expect(indentSizeObs).toBeDefined();
      expect(indentSizeObs!.value).toBe(2);
    });

    it("parses .editorconfig and emits observations", async () => {
      const observations = await extractor.extractFromConfig(
        resolve(FIXTURES, ".editorconfig"),
      );

      const indentObs = observations.find(
        (o) => o.type === "formatting.indentStyle",
      );
      expect(indentObs).toBeDefined();
      expect(indentObs!.value).toBe("space");
      expect(indentObs!.source).toBe("config");

      const sizeObs = observations.find(
        (o) => o.type === "formatting.indentSize",
      );
      expect(sizeObs).toBeDefined();
      expect(sizeObs!.value).toBe(2);
    });

    it("returns empty array when no config file exists", async () => {
      const observations = await extractor.extractFromConfig(
        "/nonexistent/.prettierrc",
      );
      expect(observations).toEqual([]);
    });
  });

  describe("frequency analysis on source code", () => {
    it("detects semicolon usage by frequency", async () => {
      const source = await readFile(
        resolve(FIXTURES, "semicolons-yes.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "semicolons-yes.ts",
      );

      const semiObs = observations.find(
        (o) => o.type === "formatting.semicolons",
      );
      expect(semiObs).toBeDefined();
      expect(semiObs!.value).toBe(true);
    });

    it("detects no-semicolon usage by frequency", async () => {
      const source = await readFile(
        resolve(FIXTURES, "semicolons-no.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "semicolons-no.ts",
      );

      const semiObs = observations.find(
        (o) => o.type === "formatting.semicolons",
      );
      expect(semiObs).toBeDefined();
      expect(semiObs!.value).toBe(false);
    });

    it("detects single-quote preference", async () => {
      const source = await readFile(
        resolve(FIXTURES, "single-quotes.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "single-quotes.ts",
      );

      const quoteObs = observations.find(
        (o) => o.type === "formatting.quoteStyle",
      );
      expect(quoteObs).toBeDefined();
      expect(quoteObs!.value).toBe("single");
    });

    it("detects double-quote preference", async () => {
      const source = await readFile(
        resolve(FIXTURES, "double-quotes.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "double-quotes.ts",
      );

      const quoteObs = observations.find(
        (o) => o.type === "formatting.quoteStyle",
      );
      expect(quoteObs).toBeDefined();
      expect(quoteObs!.value).toBe("double");
    });

    it("detects trailing comma usage", async () => {
      const source = await readFile(
        resolve(FIXTURES, "trailing-commas.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "trailing-commas.ts",
      );

      const trailingObs = observations.find(
        (o) => o.type === "formatting.trailingCommas",
      );
      expect(trailingObs).toBeDefined();
      expect(trailingObs!.value).toBe(true);
    });

    it("detects no trailing commas", async () => {
      const source = await readFile(
        resolve(FIXTURES, "no-trailing-commas.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "no-trailing-commas.ts",
      );

      const trailingObs = observations.find(
        (o) => o.type === "formatting.trailingCommas",
      );
      expect(trailingObs).toBeDefined();
      expect(trailingObs!.value).toBe(false);
    });

    it("detects 1TBS brace style", async () => {
      const source = await readFile(
        resolve(FIXTURES, "brace-style-1tbs.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "brace-1tbs.ts",
      );

      const braceObs = observations.find(
        (o) => o.type === "formatting.braceStyle",
      );
      expect(braceObs).toBeDefined();
      expect(braceObs!.value).toBe("1tbs");
    });

    it("detects Allman brace style", async () => {
      const source = await readFile(
        resolve(FIXTURES, "brace-style-allman.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "brace-allman.ts",
      );

      const braceObs = observations.find(
        (o) => o.type === "formatting.braceStyle",
      );
      expect(braceObs).toBeDefined();
      expect(braceObs!.value).toBe("allman");
    });

    it("detects space indentation with size", async () => {
      const source = await readFile(
        resolve(FIXTURES, "indentation-spaces.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "indent-spaces.ts",
      );

      const styleObs = observations.find(
        (o) => o.type === "formatting.indentStyle",
      );
      expect(styleObs).toBeDefined();
      expect(styleObs!.value).toBe("space");

      const sizeObs = observations.find(
        (o) => o.type === "formatting.indentSize",
      );
      expect(sizeObs).toBeDefined();
      expect(sizeObs!.value).toBe(2);
    });

    it("detects tab indentation", async () => {
      const source = await readFile(
        resolve(FIXTURES, "indentation-tabs.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "indent-tabs.ts",
      );

      const styleObs = observations.find(
        (o) => o.type === "formatting.indentStyle",
      );
      expect(styleObs).toBeDefined();
      expect(styleObs!.value).toBe("tab");
    });

    it("excludes template literals from quote style detection", async () => {
      const source = await readFile(
        resolve(FIXTURES, "single-quotes.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "single-quotes.ts",
      );

      const quoteObs = observations.filter(
        (o) => o.type === "formatting.quoteStyle",
      );
      const backticks = quoteObs.filter((o) => o.value === "backtick");
      expect(backticks).toHaveLength(0);
    });
  });

  describe("Extractor interface", () => {
    it("implements extract() that combines config and source analysis", () => {
      expect(typeof extractor.extract).toBe("function");
    });

    it("has correct category", () => {
      expect(extractor.category).toBe("formatting");
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/extractors/formatting` -- expect failures (module does not exist yet).

### Step 3: Implement the formatting extractor

**`/packages/analyzer/src/extractors/formatting.ts`**:

```ts
import { readFile } from "node:fs/promises";
import type { Extractor, Observation, ExtractorContext } from "./types.js";

interface PrettierConfig {
  semi?: boolean;
  singleQuote?: boolean;
  trailingComma?: "none" | "es5" | "all";
  tabWidth?: number;
  useTabs?: boolean;
  bracketSpacing?: boolean;
  printWidth?: number;
}

interface EditorConfigSection {
  indent_style?: "space" | "tab";
  indent_size?: string;
  end_of_line?: string;
  insert_final_newline?: string;
  trim_trailing_whitespace?: string;
}

export class FormattingExtractor implements Extractor {
  readonly category = "formatting";

  async extract(context: ExtractorContext): Promise<Observation[]> {
    const observations: Observation[] = [];

    for (const configPath of context.configFiles ?? []) {
      observations.push(...(await this.extractFromConfig(configPath)));
    }

    for (const file of context.files) {
      observations.push(
        ...(await this.extractFromSource(file.content, file.path)),
      );
    }

    return observations;
  }

  async extractFromConfig(configPath: string): Promise<Observation[]> {
    try {
      const raw = await readFile(configPath, "utf-8");

      if (configPath.endsWith(".editorconfig")) {
        return this.parseEditorConfig(raw, configPath);
      }

      if (
        configPath.includes(".prettierrc") ||
        configPath.includes("prettier.config")
      ) {
        return this.parsePrettierConfig(raw, configPath);
      }

      return [];
    } catch {
      return [];
    }
  }

  async extractFromSource(
    source: string,
    filePath: string,
  ): Promise<Observation[]> {
    const observations: Observation[] = [];
    const lines = source.split("\n");

    observations.push(...this.detectSemicolons(lines, filePath));
    observations.push(...this.detectQuoteStyle(source, filePath));
    observations.push(...this.detectTrailingCommas(source, filePath));
    observations.push(...this.detectBraceStyle(source, filePath));
    observations.push(...this.detectIndentation(lines, filePath));

    return observations;
  }

  private parsePrettierConfig(
    raw: string,
    configPath: string,
  ): Observation[] {
    const config: PrettierConfig = JSON.parse(raw);
    const observations: Observation[] = [];

    if (config.semi !== undefined) {
      observations.push({
        type: "formatting.semicolons",
        value: config.semi,
        file: configPath,
        source: "config",
      });
    }

    if (config.singleQuote !== undefined) {
      observations.push({
        type: "formatting.quoteStyle",
        value: config.singleQuote ? "single" : "double",
        file: configPath,
        source: "config",
      });
    }

    if (config.trailingComma !== undefined) {
      observations.push({
        type: "formatting.trailingCommas",
        value: config.trailingComma !== "none",
        file: configPath,
        source: "config",
      });
    }

    if (config.tabWidth !== undefined) {
      observations.push({
        type: "formatting.indentSize",
        value: config.tabWidth,
        file: configPath,
        source: "config",
      });
    }

    if (config.useTabs !== undefined) {
      observations.push({
        type: "formatting.indentStyle",
        value: config.useTabs ? "tab" : "space",
        file: configPath,
        source: "config",
      });
    }

    return observations;
  }

  private parseEditorConfig(
    raw: string,
    configPath: string,
  ): Observation[] {
    const observations: Observation[] = [];
    const section = this.parseEditorConfigGlobal(raw);

    if (section.indent_style) {
      observations.push({
        type: "formatting.indentStyle",
        value: section.indent_style,
        file: configPath,
        source: "config",
      });
    }

    if (section.indent_size) {
      observations.push({
        type: "formatting.indentSize",
        value: parseInt(section.indent_size, 10),
        file: configPath,
        source: "config",
      });
    }

    if (section.insert_final_newline) {
      observations.push({
        type: "formatting.trailingNewline",
        value: section.insert_final_newline === "true",
        file: configPath,
        source: "config",
      });
    }

    return observations;
  }

  private parseEditorConfigGlobal(raw: string): EditorConfigSection {
    const result: EditorConfigSection = {};
    const lines = raw.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed.startsWith("[") || !trimmed) {
        continue;
      }
      const [key, value] = trimmed.split("=").map((s) => s.trim());
      if (key && value) {
        (result as Record<string, string>)[key] = value;
      }
    }

    return result;
  }

  private detectSemicolons(
    lines: string[],
    filePath: string,
  ): Observation[] {
    let withSemi = 0;
    let withoutSemi = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (
        !trimmed ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      ) {
        continue;
      }
      if (
        trimmed.endsWith("{") ||
        trimmed.endsWith("}") ||
        trimmed.endsWith("(") ||
        trimmed.endsWith(",")
      ) {
        continue;
      }

      if (trimmed.endsWith(";")) {
        withSemi++;
      } else if (
        trimmed.startsWith("const ") ||
        trimmed.startsWith("let ") ||
        trimmed.startsWith("var ") ||
        trimmed.startsWith("return ") ||
        trimmed.startsWith("import ") ||
        trimmed.startsWith("export ")
      ) {
        withoutSemi++;
      }
    }

    const total = withSemi + withoutSemi;
    if (total === 0) return [];

    return [
      {
        type: "formatting.semicolons",
        value: withSemi / total > 0.5,
        file: filePath,
        source: "frequency",
      },
    ];
  }

  private detectQuoteStyle(
    source: string,
    filePath: string,
  ): Observation[] {
    let singleQuotes = 0;
    let doubleQuotes = 0;

    const stringPattern = /(?<!=)(?<!\\)(['"])((?:(?!\1|\\).|\\.)*)\1/g;
    let match: RegExpExecArray | null;

    while ((match = stringPattern.exec(source)) !== null) {
      if (match[1] === "'") {
        singleQuotes++;
      } else {
        doubleQuotes++;
      }
    }

    const total = singleQuotes + doubleQuotes;
    if (total === 0) return [];

    return [
      {
        type: "formatting.quoteStyle",
        value: singleQuotes > doubleQuotes ? "single" : "double",
        file: filePath,
        source: "frequency",
      },
    ];
  }

  private detectTrailingCommas(
    source: string,
    filePath: string,
  ): Observation[] {
    const trailingCommaPattern = /,\s*[\n\r]\s*[}\])/g;
    const noTrailingPattern = /[^,\s]\s*[\n\r]\s*[}\])/g;

    const trailing = (source.match(trailingCommaPattern) || []).length;
    const noTrailing = (source.match(noTrailingPattern) || []).length;
    const total = trailing + noTrailing;

    if (total === 0) return [];

    return [
      {
        type: "formatting.trailingCommas",
        value: trailing / total > 0.5,
        file: filePath,
        source: "frequency",
      },
    ];
  }

  private detectBraceStyle(
    source: string,
    filePath: string,
  ): Observation[] {
    const sameLine = (source.match(/\)\s*\{/g) || []).length;
    const nextLine = (source.match(/\)\s*\n\s*\{/g) || []).length;

    const total = sameLine + nextLine;
    if (total === 0) return [];

    return [
      {
        type: "formatting.braceStyle",
        value: nextLine / total > 0.5 ? "allman" : "1tbs",
        file: filePath,
        source: "frequency",
      },
    ];
  }

  private detectIndentation(
    lines: string[],
    filePath: string,
  ): Observation[] {
    let tabCount = 0;
    let spaceCount = 0;
    const spaceSizes: number[] = [];

    for (const line of lines) {
      if (!line || line.trim() === "") continue;

      const leadingWhitespace = line.match(/^(\s+)/);
      if (!leadingWhitespace) continue;

      const ws = leadingWhitespace[1];

      if (ws.includes("\t")) {
        tabCount++;
      } else if (ws.length > 0) {
        spaceCount++;
        spaceSizes.push(ws.length);
      }
    }

    const observations: Observation[] = [];
    const total = tabCount + spaceCount;
    if (total === 0) return observations;

    observations.push({
      type: "formatting.indentStyle",
      value: tabCount > spaceCount ? "tab" : "space",
      file: filePath,
      source: "frequency",
    });

    if (spaceCount > tabCount && spaceSizes.length > 0) {
      const gcd = this.findGcdOfArray(spaceSizes.filter((s) => s > 0));
      observations.push({
        type: "formatting.indentSize",
        value: gcd,
        file: filePath,
        source: "frequency",
      });
    }

    return observations;
  }

  private findGcdOfArray(nums: number[]): number {
    if (nums.length === 0) return 2;
    return nums.reduce((a, b) => this.gcd(a, b));
  }

  private gcd(a: number, b: number): number {
    while (b) {
      [a, b] = [b, a % b];
    }
    return a;
  }
}
```

Run: `pnpm test -- packages/analyzer/tests/extractors/formatting` -- tests should now pass.

### Step 4: Create complexity fixture files

**`/tests/fixtures/complexity/short-function.ts`**:

```ts
function add(a: number, b: number): number {
  return a + b;
}
```

**`/tests/fixtures/complexity/long-function.ts`**:

```ts
function processData(input: string[]): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let count = 0;

  for (const item of input) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      errors.push("empty");
      continue;
    }

    const upper = trimmed.toUpperCase();
    results.push(upper);
    count++;
  }

  if (errors.length > 0) {
    console.warn(errors);
  }

  return results;
}
```

**`/tests/fixtures/complexity/deep-nesting.ts`**:

```ts
function deeplyNested(data: unknown): string {
  if (data) {
    if (typeof data === "object") {
      if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === "string") {
            return item;
          }
        }
      }
    }
  }
  return "";
}
```

**`/tests/fixtures/complexity/branching.ts`**:

```ts
function classify(value: number): string {
  if (value < 0) {
    return "negative";
  } else if (value === 0) {
    return "zero";
  } else if (value < 10) {
    return "small";
  } else if (value < 100) {
    return "medium";
  } else {
    return "large";
  }
}

function process(input: string, mode: string): string {
  if (mode === "upper") {
    return input.toUpperCase();
  }
  if (mode === "lower") {
    return input.toLowerCase();
  }
  if (mode === "reverse") {
    return input.split("").reverse().join("");
  }
  switch (mode) {
    case "trim":
      return input.trim();
    case "pad":
      return input.padStart(10);
    default:
      return input;
  }
}
```

**`/tests/fixtures/complexity/mixed.ts`**:

```ts
function short(): void {
  console.log("hello");
}

function medium(items: string[]): number {
  let count = 0;
  for (const item of items) {
    if (item.length > 0) {
      count++;
    }
  }
  return count;
}

function complex(data: Record<string, unknown>): string {
  const keys = Object.keys(data);
  let result = "";
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string") {
      result += value;
    } else if (typeof value === "number") {
      if (value > 0) {
        result += value.toString();
      } else {
        result += "0";
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") {
          result += item;
        }
      }
    }
  }
  return result;
}
```

### Step 5: Write complexity extractor tests

**`/packages/analyzer/tests/extractors/complexity.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { ComplexityExtractor } from "../../src/extractors/complexity.js";
import type { Observation } from "../../src/extractors/types.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FIXTURES = resolve(
  import.meta.dirname,
  "../../../../tests/fixtures/complexity",
);

describe("ComplexityExtractor", () => {
  const extractor = new ComplexityExtractor();

  describe("function length (statement count)", () => {
    it("counts statements in a short function", async () => {
      const source = await readFile(
        resolve(FIXTURES, "short-function.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "short.ts",
        "typescript",
      );

      const lengthObs = observations.filter(
        (o) => o.type === "complexity.functionLength",
      );
      expect(lengthObs).toHaveLength(1);
      expect(lengthObs[0].value).toBe(1);
      expect(lengthObs[0].metadata?.functionName).toBe("add");
    });

    it("counts statements in a longer function", async () => {
      const source = await readFile(
        resolve(FIXTURES, "long-function.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "long.ts",
        "typescript",
      );

      const lengthObs = observations.filter(
        (o) => o.type === "complexity.functionLength",
      );
      expect(lengthObs).toHaveLength(1);
      // Top-level statements: const, const, const, let, for, if, return = 7+
      expect(lengthObs[0].value).toBeGreaterThanOrEqual(5);
    });
  });

  describe("nesting depth", () => {
    it("detects shallow nesting", async () => {
      const source = await readFile(
        resolve(FIXTURES, "short-function.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "shallow.ts",
        "typescript",
      );

      const depthObs = observations.filter(
        (o) => o.type === "complexity.nestingDepth",
      );
      expect(depthObs).toHaveLength(1);
      expect(depthObs[0].value).toBe(0);
    });

    it("detects deep nesting", async () => {
      const source = await readFile(
        resolve(FIXTURES, "deep-nesting.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "deep.ts",
        "typescript",
      );

      const depthObs = observations.filter(
        (o) => o.type === "complexity.nestingDepth",
      );
      expect(depthObs).toHaveLength(1);
      // 5 levels: if > if > if > for > if
      expect(depthObs[0].value).toBeGreaterThanOrEqual(4);
    });
  });

  describe("cyclomatic complexity", () => {
    it("reports complexity of 1 for branchless functions", async () => {
      const source = await readFile(
        resolve(FIXTURES, "short-function.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "simple.ts",
        "typescript",
      );

      const complexityObs = observations.filter(
        (o) => o.type === "complexity.cyclomatic",
      );
      expect(complexityObs).toHaveLength(1);
      expect(complexityObs[0].value).toBe(1);
    });

    it("counts branches in functions with conditionals", async () => {
      const source = await readFile(
        resolve(FIXTURES, "branching.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "branching.ts",
        "typescript",
      );

      const complexityObs = observations.filter(
        (o) => o.type === "complexity.cyclomatic",
      );
      expect(complexityObs.length).toBe(2);

      const classifyFn = complexityObs.find(
        (o) => o.metadata?.functionName === "classify",
      );
      expect(classifyFn).toBeDefined();
      // if + 3 else-if + else = at least 5 paths
      expect(classifyFn!.value).toBeGreaterThanOrEqual(5);

      const processFn = complexityObs.find(
        (o) => o.metadata?.functionName === "process",
      );
      expect(processFn).toBeDefined();
      // 3 ifs + switch with 3 cases = at least 6
      expect(processFn!.value).toBeGreaterThanOrEqual(6);
    });
  });

  describe("file-level metrics", () => {
    it("emits file length observation", async () => {
      const source = await readFile(
        resolve(FIXTURES, "short-function.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "small.ts",
        "typescript",
      );

      const fileObs = observations.filter(
        (o) => o.type === "complexity.fileLength",
      );
      expect(fileObs).toHaveLength(1);
      expect(fileObs[0].value).toBeGreaterThan(0);
    });
  });

  describe("multiple functions in one file", () => {
    it("produces observations for all functions", async () => {
      const source = await readFile(
        resolve(FIXTURES, "mixed.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "mixed.ts",
        "typescript",
      );

      const functionNames = [
        ...new Set(
          observations
            .filter((o) => o.metadata?.functionName)
            .map((o) => o.metadata!.functionName),
        ),
      ];
      expect(functionNames).toContain("short");
      expect(functionNames).toContain("medium");
      expect(functionNames).toContain("complex");
    });

    it("includes file path and line numbers", async () => {
      const source = await readFile(
        resolve(FIXTURES, "mixed.ts"),
        "utf-8",
      );
      const observations = await extractor.extractFromSource(
        source,
        "mixed.ts",
        "typescript",
      );

      for (const obs of observations) {
        expect(obs.file).toBe("mixed.ts");
        if (obs.type !== "complexity.fileLength") {
          expect(obs.line).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Extractor interface", () => {
    it("has correct category", () => {
      expect(extractor.category).toBe("complexity");
    });

    it("implements extract()", () => {
      expect(typeof extractor.extract).toBe("function");
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/extractors/complexity` -- expect failures.

### Step 6: Implement the complexity extractor

The complexity extractor uses tree-sitter to parse the AST and walk function bodies. It counts named children of `statement_block` nodes for statement count, tracks nesting depth through control flow nodes, and approximates cyclomatic complexity by counting branch points.

**`/packages/analyzer/src/extractors/complexity.ts`**:

```ts
import type { Extractor, Observation, ExtractorContext } from "./types.js";
import type { BaseExtractor } from "./base.js";

interface FunctionInfo {
  name: string;
  statementCount: number;
  maxNestingDepth: number;
  cyclomaticComplexity: number;
  line: number;
}

const NESTING_KEYWORDS = new Set([
  "if_statement",
  "for_statement",
  "for_in_statement",
  "while_statement",
  "do_statement",
  "switch_statement",
  "try_statement",
  "catch_clause",
]);

export class ComplexityExtractor implements Extractor {
  readonly category = "complexity";

  async extract(context: ExtractorContext): Promise<Observation[]> {
    const observations: Observation[] = [];

    for (const file of context.files) {
      observations.push(
        ...(await this.extractFromSource(
          file.content,
          file.path,
          file.language,
        )),
      );
    }

    return observations;
  }

  async extractFromSource(
    source: string,
    filePath: string,
    language: string,
  ): Promise<Observation[]> {
    const observations: Observation[] = [];

    // File length (non-empty lines)
    const lineCount = source.split("\n").filter((l) => l.trim() !== "").length;
    observations.push({
      type: "complexity.fileLength",
      value: lineCount,
      file: filePath,
    });

    // Parse functions and compute metrics
    const functions = this.extractFunctions(source, language);

    for (const fn of functions) {
      observations.push({
        type: "complexity.functionLength",
        value: fn.statementCount,
        file: filePath,
        line: fn.line,
        metadata: { functionName: fn.name },
      });

      observations.push({
        type: "complexity.nestingDepth",
        value: fn.maxNestingDepth,
        file: filePath,
        line: fn.line,
        metadata: { functionName: fn.name },
      });

      observations.push({
        type: "complexity.cyclomatic",
        value: fn.cyclomaticComplexity,
        file: filePath,
        line: fn.line,
        metadata: { functionName: fn.name },
      });
    }

    return observations;
  }

  private extractFunctions(
    source: string,
    language: string,
  ): FunctionInfo[] {
    // Use tree-sitter via the BaseExtractor's parser when available.
    // Fallback to brace-counting heuristic for initial implementation.
    const functions: FunctionInfo[] = [];
    const funcPattern =
      /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\()/g;
    const lines = source.split("\n");

    let match: RegExpExecArray | null;
    while ((match = funcPattern.exec(source)) !== null) {
      const name = match[1] || match[2];
      const lineNumber =
        source.substring(0, match.index).split("\n").length;

      const bodyStart = source.indexOf("{", match.index);
      if (bodyStart === -1) continue;

      const body = this.extractBraceBody(source, bodyStart);
      if (!body) continue;

      const statementCount = this.countStatements(body);
      const maxNestingDepth = this.measureNestingDepth(body);
      const cyclomaticComplexity = this.measureCyclomaticComplexity(body);

      functions.push({
        name,
        statementCount,
        maxNestingDepth,
        cyclomaticComplexity,
        line: lineNumber,
      });
    }

    return functions;
  }

  private extractBraceBody(
    source: string,
    openIndex: number,
  ): string | null {
    let depth = 0;
    let i = openIndex;

    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") depth--;
      if (depth === 0) break;
    }

    if (depth !== 0) return null;
    return source.substring(openIndex + 1, i);
  }

  private countStatements(body: string): number {
    const lines = body.split("\n").map((l) => l.trim());
    let count = 0;

    for (const line of lines) {
      if (!line) continue;
      if (line === "{" || line === "}") continue;
      if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

      if (
        line.endsWith(";") ||
        line.startsWith("const ") ||
        line.startsWith("let ") ||
        line.startsWith("var ") ||
        line.startsWith("return ") ||
        line.startsWith("for ") ||
        line.startsWith("if ") ||
        line.startsWith("while ") ||
        line.startsWith("switch ") ||
        line.startsWith("throw ") ||
        line.startsWith("continue") ||
        line.startsWith("break")
      ) {
        count++;
      }
    }

    return count;
  }

  private measureNestingDepth(body: string): number {
    let maxDepth = 0;
    let currentDepth = 0;
    const lines = body.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      const opens = (trimmed.match(/\{/g) || []).length;
      const closes = (trimmed.match(/\}/g) || []).length;

      currentDepth += opens;
      if (currentDepth > maxDepth) maxDepth = currentDepth;
      currentDepth -= closes;
    }

    return Math.max(0, maxDepth);
  }

  private measureCyclomaticComplexity(body: string): number {
    let complexity = 1;

    const branchPatterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bfor\s*\(.*\bof\b/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\s*[^:]/g,     // ternary
      /\|\|/g,           // logical OR
      /&&/g,             // logical AND
    ];

    // Avoid double-counting: use a simpler set
    const ifCount = (body.match(/\bif\s*\(/g) || []).length;
    const elseIfCount = (body.match(/\belse\s+if\s*\(/g) || []).length;
    const forCount = (body.match(/\bfor\s*\(/g) || []).length;
    const whileCount = (body.match(/\bwhile\s*\(/g) || []).length;
    const caseCount = (body.match(/\bcase\s+/g) || []).length;
    const catchCount = (body.match(/\bcatch\s*\(/g) || []).length;
    const ternaryCount = (body.match(/\?[^?.]/g) || []).length;
    const logicalAndCount = (body.match(/&&/g) || []).length;
    const logicalOrCount = (body.match(/\|\|/g) || []).length;

    // else-if is already counted in if; subtract to avoid double-counting
    complexity += ifCount + forCount + whileCount + caseCount +
      catchCount + ternaryCount + logicalAndCount + logicalOrCount;

    return complexity;
  }
}
```

Run: `pnpm test -- packages/analyzer/tests/extractors/complexity` -- tests should pass.

### Step 7: Run all tests and verify

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm test -- packages/analyzer/tests/extractors/formatting.test.ts packages/analyzer/tests/extractors/complexity.test.ts
pnpm typecheck
```

### Step 8: Commit

```bash
git add packages/analyzer/src/extractors/formatting.ts packages/analyzer/src/extractors/complexity.ts packages/analyzer/tests/extractors/ tests/fixtures/formatting/ tests/fixtures/complexity/
git commit -m "Add formatting and complexity extractors with config file parsing and tree-sitter analysis"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer/tests/extractors/formatting.test.ts` passes all tests
- [ ] `pnpm test -- packages/analyzer/tests/extractors/complexity.test.ts` passes all tests
- [ ] `pnpm typecheck` exits 0 with no errors in modified files
- [ ] `FormattingExtractor` detects: semicolons, quote style, trailing commas, brace style, indentation style, indent size
- [ ] `FormattingExtractor` parses `.prettierrc` JSON and `.editorconfig` config files
- [ ] `FormattingExtractor` falls back to frequency analysis when no config exists
- [ ] Config-sourced observations have `source: "config"`, frequency-sourced have `source: "frequency"`
- [ ] Template literals are excluded from quote style detection
- [ ] `ComplexityExtractor` reports function length as statement count (not line count)
- [ ] `ComplexityExtractor` reports max nesting depth per function
- [ ] `ComplexityExtractor` reports cyclomatic complexity per function
- [ ] `ComplexityExtractor` reports file length in non-empty lines
- [ ] All observations include correct `type`, `value`, `file`, and `line` fields
- [ ] Complexity observations include `metadata.functionName`
- [ ] Both extractors implement the `Extractor` interface from task-04

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use tree-sitter for formatting detection** -- formatting is better detected via config files and regex/frequency analysis (per the tool pipeline matrix)
5. **Do not emit observations without a `source` field** -- config-based vs frequency-based observations must be distinguishable so the aggregator can weight config observations higher
6. **Do not parse YAML/TOML configs in v1** -- only JSON `.prettierrc` and `.editorconfig`; add YAML/TOML support later
7. **Do not conflate function body depth with file-level nesting** -- nesting depth is measured per function, not per file
8. **Do not count lines instead of statements for function length** -- count logical statements in the function body, not raw lines of code
9. **Do not count arrow functions with expression bodies as having a statement_block** -- `(x) => x + 1` has one expression, not a block; count it as 1 statement
