# Task 05: Structure + Control-Flow Extractors

## Architectural Context

These two extractors cover Categories 2 (Code Structure) and 3 (Control Flow Patterns) from the feature taxonomy. Both follow the `Extractor` interface established in Task 04 and use the same tree-sitter AST walk approach. The **structure extractor** analyzes import ordering (classifying imports into builtin/external/internal/relative groups), export style (named vs default ratios), export proximity (inline vs trailing), barrel file detection, and function length in statement counts. The **control-flow extractor** detects guard clauses via return-depth analysis, else-after-return patterns, ternary vs if/else preference, array method vs for loop preference (including Python list comprehensions), async/await vs promise chain patterns, and loop type distinctions (for-of vs for-in vs indexed for). These extractors produce ratio-based heuristic observations that the aggregator (Task 09) later turns into profile rules with confidence scores.

## File Ownership

**May modify:**
- `/packages/analyzer/src/extractors/structure.ts` (NEW)
- `/packages/analyzer/src/extractors/control-flow.ts` (NEW)
- `/packages/analyzer/src/extractors/index.ts` (add exports)
- `/packages/analyzer/src/index.ts` (add exports)
- `/packages/analyzer/src/__tests__/structure.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/control-flow.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/structure-sample.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/structure-sample.py` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/control-flow-sample.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/control-flow-sample.py` (NEW)

**Must not touch:**
- `/packages/profile/**`
- `/packages/analyzer/src/ingest/**` (completed in Task 03)
- `/packages/analyzer/src/extractors/types.ts` (established in Task 04)
- `/packages/analyzer/src/extractors/parser.ts` (established in Task 04)
- `/packages/analyzer/src/extractors/naming.ts` (completed in Task 04)
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/analyzer/src/extractors/types.ts` (Extractor, Observation, ParsedFile interfaces)
- `/packages/analyzer/src/extractors/naming.ts` (reference pattern for tree-sitter walk + emit helper)
- `/docs/research/07-unified-feature-taxonomy.md` (Categories 2 and 3)
- `/docs/plans/2026-02-27-code-style-design.md` (extractor architecture, ratio-based measurements)

## Steps

### Step 1: Create structure fixture

**`packages/analyzer/src/__tests__/fixtures/structure-sample.ts`**:

```ts
// Builtin imports
import * as path from "node:path";
import * as fs from "node:fs";

// External imports
import { z } from "zod";
import chalk from "chalk";

// Internal imports (aliases)
import { UserService } from "@app/services/user";
import type { Config } from "@app/config";

// Relative imports
import { helper } from "./utils";
import { CONSTANTS } from "../constants";

// Named exports (inline)
export function processData(input: string): string {
  return input.trim();
}

export const VERSION = "1.0.0";

export interface DataResult {
  value: string;
  status: number;
}

// Default export
export default class DataProcessor {
  process(input: string) {
    return input;
  }
}
```

**`packages/analyzer/src/__tests__/fixtures/structure-sample.py`**:

```python
# Builtin imports
import os
import sys
from pathlib import Path

# External imports
import requests
from pydantic import BaseModel

# Relative imports
from .utils import helper
from ..constants import MAX_SIZE


# Named functions (no default export concept in Python)
def process_data(input_str: str) -> str:
    return input_str.strip()


VERSION = "1.0.0"


class DataProcessor:
    def process(self, input_str: str) -> str:
        return input_str
```

### Step 2: Write structure extractor tests

**`packages/analyzer/src/__tests__/structure.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { StructureExtractor } from "../extractors/structure.js";
import { parseFile } from "../extractors/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(filename: string, language: string) {
  const fixturePath = path.join(__dirname, "fixtures", filename);
  const content = fs.readFileSync(fixturePath, "utf-8");
  return parseFile(content, fixturePath, language);
}

describe("StructureExtractor", () => {
  const extractor = new StructureExtractor();

  it("has name 'structure'", () => {
    expect(extractor.name).toBe("structure");
  });

  describe("TypeScript", () => {
    const parsed = loadFixture("structure-sample.ts", "typescript");
    const observations = extractor.extract(parsed);

    it("classifies builtin imports", () => {
      const builtin = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "builtin",
      );
      expect(builtin.length).toBe(2);
    });

    it("classifies external imports", () => {
      const external = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "external",
      );
      expect(external.length).toBe(2);
    });

    it("classifies internal (alias) imports", () => {
      const internal = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "internal",
      );
      expect(internal.length).toBe(2);
    });

    it("classifies relative imports", () => {
      const relative = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "relative",
      );
      expect(relative.length).toBe(2);
    });

    it("counts named exports", () => {
      const named = observations.filter(
        (o) => o.type === "structure.export-style" && o.value === "named",
      );
      expect(named.length).toBeGreaterThanOrEqual(3);
    });

    it("counts default exports", () => {
      const defaults = observations.filter(
        (o) => o.type === "structure.export-style" && o.value === "default",
      );
      expect(defaults.length).toBe(1);
    });

    it("detects export proximity (inline)", () => {
      const inline = observations.filter(
        (o) => o.type === "structure.export-proximity" && o.value === "inline",
      );
      expect(inline.length).toBeGreaterThanOrEqual(3);
    });

    it("sets correct category on all observations", () => {
      observations.forEach((o) => {
        expect(o.category).toBe("structure");
      });
    });
  });

  describe("Python", () => {
    const parsed = loadFixture("structure-sample.py", "python");
    const observations = extractor.extract(parsed);

    it("classifies builtin imports", () => {
      const builtin = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "builtin",
      );
      expect(builtin.length).toBeGreaterThanOrEqual(2);
    });

    it("classifies external imports", () => {
      const external = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "external",
      );
      expect(external.length).toBeGreaterThanOrEqual(1);
    });

    it("classifies relative imports", () => {
      const relative = observations.filter(
        (o) => o.type === "structure.import-group" && o.value === "relative",
      );
      expect(relative.length).toBe(2);
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/src/__tests__/structure` -- expect failures.

### Step 3: Implement structure extractor

**`packages/analyzer/src/extractors/structure.ts`**:

```ts
import type Parser from "tree-sitter";
import type { Extractor, ParsedFile, Observation } from "./types.js";

const PYTHON_BUILTINS = new Set([
  "os", "sys", "re", "json", "math", "time", "datetime", "pathlib",
  "collections", "itertools", "functools", "typing", "io", "abc",
  "dataclasses", "enum", "logging", "unittest", "hashlib", "subprocess",
  "argparse", "copy", "glob", "shutil", "tempfile", "textwrap",
  "contextlib", "operator", "string", "struct", "csv", "xml",
]);

function classifyImportSource(source: string, language: string): string {
  if (language === "python") {
    if (source.startsWith(".")) return "relative";
    const topModule = source.split(".")[0];
    if (PYTHON_BUILTINS.has(topModule)) return "builtin";
    return "external";
  }

  // TypeScript / JavaScript
  if (source.startsWith("node:")) return "builtin";
  if (source.startsWith(".") || source.startsWith("..")) return "relative";
  if (source.startsWith("@")) {
    const scope = source.split("/")[0];
    if (["@app", "@lib", "@src", "@internal", "@modules"].includes(scope)) {
      return "internal";
    }
  }
  return "external";
}

function isBarrelFile(root: Parser.SyntaxNode): boolean {
  let exportFromCount = 0;
  let otherStatements = 0;

  for (const child of root.children) {
    if (child.type === "export_statement") {
      const source = child.childForFieldName("source");
      if (source) {
        exportFromCount++;
      } else {
        otherStatements++;
      }
    } else if (child.isNamed && child.type !== "comment") {
      otherStatements++;
    }
  }

  return exportFromCount > 0 && otherStatements <= 1;
}

export class StructureExtractor implements Extractor {
  readonly name = "structure";

  extract(file: ParsedFile): Observation[] {
    const observations: Observation[] = [];
    const root = file.tree.rootNode;

    this.extractImports(root, file, observations);
    this.extractExports(root, file, observations);
    this.detectBarrelFile(root, file, observations);

    return observations;
  }

  private extractImports(
    root: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    for (const child of root.children) {
      let source: string | null = null;

      if (file.language === "python") {
        if (child.type === "import_statement") {
          const nameNode = child.childForFieldName("name");
          source = nameNode?.text ?? null;
        } else if (child.type === "import_from_statement") {
          const moduleNode = child.childForFieldName("module_name");
          const dotPrefix = child.children
            .filter((c) => c.type === "." || c.type === "relative_import")
            .map((c) => c.text)
            .join("");
          source = dotPrefix + (moduleNode?.text ?? "");
        }
      } else {
        if (child.type === "import_statement") {
          const sourceNode = child.childForFieldName("source");
          source = sourceNode?.text?.replace(/['"]/g, "") ?? null;
        }
      }

      if (source) {
        const group = classifyImportSource(source, file.language);
        observations.push({
          type: "structure.import-group",
          category: "structure",
          value: group,
          file: file.filePath,
          line: child.startPosition.row + 1,
          metadata: { source },
        });
      }
    }
  }

  private extractExports(
    root: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    if (file.language === "python") return;

    for (const child of root.children) {
      if (child.type === "export_statement") {
        const isDefault = child.children.some((c) => c.type === "default");
        const style = isDefault ? "default" : "named";

        observations.push({
          type: "structure.export-style",
          category: "structure",
          value: style,
          file: file.filePath,
          line: child.startPosition.row + 1,
        });

        const hasDeclaration = child.children.some((c) =>
          ["function_declaration", "class_declaration", "lexical_declaration",
           "interface_declaration", "type_alias_declaration", "enum_declaration"]
            .includes(c.type),
        );
        const isReExport = child.childForFieldName("source") !== null;

        if (hasDeclaration || isDefault) {
          observations.push({
            type: "structure.export-proximity",
            category: "structure",
            value: "inline",
            file: file.filePath,
            line: child.startPosition.row + 1,
          });
        } else if (!isReExport) {
          observations.push({
            type: "structure.export-proximity",
            category: "structure",
            value: "trailing",
            file: file.filePath,
            line: child.startPosition.row + 1,
          });
        }
      }
    }
  }

  private detectBarrelFile(
    root: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    if (file.language === "python") return;

    if (isBarrelFile(root)) {
      observations.push({
        type: "structure.barrel-file",
        category: "structure",
        value: true,
        file: file.filePath,
        line: 1,
      });
    }
  }
}
```

Run: `pnpm test -- packages/analyzer/src/__tests__/structure` -- should pass.

### Step 4: Create control-flow fixture

**`packages/analyzer/src/__tests__/fixtures/control-flow-sample.ts`**:

```ts
// Guard clauses / early return
function processUser(user: { active: boolean; name: string } | null) {
  if (!user) return null;
  if (!user.active) return null;
  return user.name.toUpperCase();
}

// Else-after-return (non-guard pattern)
function classify(score: number) {
  if (score >= 90) {
    return "A";
  } else if (score >= 80) {
    return "B";
  } else {
    return "C";
  }
}

// Ternary
const label = true ? "yes" : "no";
const status = false ? "active" : "inactive";

// If/else (non-ternary conditional)
function getLabel(flag: boolean) {
  if (flag) {
    return "on";
  } else {
    return "off";
  }
}

// Array methods
const nums = [1, 2, 3, 4, 5];
const doubled = nums.map((n) => n * 2);
const evens = nums.filter((n) => n % 2 === 0);
const sum = nums.reduce((acc, n) => acc + n, 0);

// For loop (indexed)
function sumArray(arr: number[]) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total += arr[i];
  }
  return total;
}

// For-of loop
function printAll(items: string[]) {
  for (const item of items) {
    console.log(item);
  }
}

// Async/await
async function fetchData(url: string) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

// Promise .then() chain
function fetchDataThen(url: string) {
  return fetch(url)
    .then((res) => res.json())
    .then((data) => data);
}
```

**`packages/analyzer/src/__tests__/fixtures/control-flow-sample.py`**:

```python
# Guard clauses / early return
def process_user(user):
    if user is None:
        return None
    if not user.get("active"):
        return None
    return user["name"].upper()


# Ternary (conditional expression)
label = "yes" if True else "no"
status = "active" if False else "inactive"


# List comprehension (array method equivalent)
nums = [1, 2, 3, 4, 5]
doubled = [n * 2 for n in nums]
evens = [n for n in nums if n % 2 == 0]


# For loop
def sum_array(arr):
    total = 0
    for n in arr:
        total += n
    return total


# Async/await
async def fetch_data(url):
    response = await aiohttp.get(url)
    data = await response.json()
    return data
```

### Step 5: Write control-flow extractor tests

**`packages/analyzer/src/__tests__/control-flow.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { ControlFlowExtractor } from "../extractors/control-flow.js";
import { parseFile } from "../extractors/parser.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(filename: string, language: string) {
  const fixturePath = path.join(__dirname, "fixtures", filename);
  const content = fs.readFileSync(fixturePath, "utf-8");
  return parseFile(content, fixturePath, language);
}

describe("ControlFlowExtractor", () => {
  const extractor = new ControlFlowExtractor();

  it("has name 'control-flow'", () => {
    expect(extractor.name).toBe("control-flow");
  });

  describe("TypeScript", () => {
    const parsed = loadFixture("control-flow-sample.ts", "typescript");
    const observations = extractor.extract(parsed);

    it("detects guard clauses (early returns at top of function)", () => {
      const guards = observations.filter(
        (o) => o.type === "control-flow.guard-clause" && o.value === true,
      );
      expect(guards.length).toBeGreaterThanOrEqual(2);
    });

    it("detects else-after-return", () => {
      const elseAfterReturn = observations.filter(
        (o) => o.type === "control-flow.else-after-return",
      );
      expect(elseAfterReturn.length).toBeGreaterThanOrEqual(1);
    });

    it("counts ternary expressions", () => {
      const ternaries = observations.filter(
        (o) => o.type === "control-flow.ternary",
      );
      expect(ternaries.length).toBe(2);
    });

    it("counts if/else statements", () => {
      const ifElse = observations.filter(
        (o) => o.type === "control-flow.if-else",
      );
      expect(ifElse.length).toBeGreaterThanOrEqual(2);
    });

    it("counts array method calls", () => {
      const arrayMethods = observations.filter(
        (o) => o.type === "control-flow.array-method",
      );
      expect(arrayMethods.length).toBe(3);
    });

    it("counts indexed for loops", () => {
      const forLoops = observations.filter(
        (o) => o.type === "control-flow.for-loop",
      );
      expect(forLoops.length).toBeGreaterThanOrEqual(1);
    });

    it("counts for-of loops", () => {
      const forOf = observations.filter(
        (o) => o.type === "control-flow.for-of",
      );
      expect(forOf.length).toBe(1);
    });

    it("counts await expressions", () => {
      const awaits = observations.filter(
        (o) => o.type === "control-flow.async-await",
      );
      expect(awaits.length).toBe(2);
    });

    it("counts .then() chains", () => {
      const thens = observations.filter(
        (o) => o.type === "control-flow.promise-then",
      );
      expect(thens.length).toBeGreaterThanOrEqual(1);
    });

    it("sets correct category on all observations", () => {
      observations.forEach((o) => {
        expect(o.category).toBe("control-flow");
      });
    });
  });

  describe("Python", () => {
    const parsed = loadFixture("control-flow-sample.py", "python");
    const observations = extractor.extract(parsed);

    it("detects guard clauses", () => {
      const guards = observations.filter(
        (o) => o.type === "control-flow.guard-clause" && o.value === true,
      );
      expect(guards.length).toBeGreaterThanOrEqual(2);
    });

    it("counts conditional expressions (ternary)", () => {
      const ternaries = observations.filter(
        (o) => o.type === "control-flow.ternary",
      );
      expect(ternaries.length).toBe(2);
    });

    it("detects list comprehensions as array-method equivalent", () => {
      const comps = observations.filter(
        (o) => o.type === "control-flow.array-method",
      );
      expect(comps.length).toBeGreaterThanOrEqual(2);
    });

    it("counts for loops", () => {
      const forLoops = observations.filter(
        (o) => o.type === "control-flow.for-loop",
      );
      expect(forLoops.length).toBeGreaterThanOrEqual(1);
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/src/__tests__/control-flow` -- expect failures.

### Step 6: Implement control-flow extractor

**`packages/analyzer/src/extractors/control-flow.ts`**:

The control-flow extractor walks the AST recursively, detecting patterns by node type. Key detection logic:

- **Guard clause**: An `if_statement` at the top of a function body whose consequent contains a `return_statement` and has no `else` branch.
- **Else-after-return**: An `if_statement` where the consequent branch returns but an `else` branch follows.
- **Array methods**: `call_expression` where the function is a `member_expression` with property `.map`, `.filter`, `.reduce`, `.forEach`, `.find`, `.some`, `.every`, `.flatMap`.
- **Promise .then()**: `call_expression` where property is `.then`.

```ts
import type Parser from "tree-sitter";
import type { Extractor, ParsedFile, Observation } from "./types.js";

const ARRAY_METHODS = new Set([
  "map", "filter", "reduce", "forEach", "find", "some", "every", "flatMap",
  "findIndex",
]);

export class ControlFlowExtractor implements Extractor {
  readonly name = "control-flow";

  extract(file: ParsedFile): Observation[] {
    const observations: Observation[] = [];
    this.walk(file.tree.rootNode, file, observations);
    return observations;
  }

  private walk(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    this.processNode(node, file, observations);
    for (const child of node.children) {
      this.walk(child, file, observations);
    }
  }

  private processNode(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    // Ternary / conditional expression
    if (
      node.type === "ternary_expression" ||
      node.type === "conditional_expression"
    ) {
      this.emit(observations, "control-flow.ternary", true, file, node);
    }

    // If/else
    if (node.type === "if_statement") {
      this.emit(observations, "control-flow.if-else", true, file, node);
      this.detectGuardClause(node, file, observations);
      this.detectElseAfterReturn(node, file, observations);
    }

    // Indexed for loops (TypeScript)
    if (node.type === "for_statement" && file.language !== "python") {
      this.emit(observations, "control-flow.for-loop", true, file, node);
    }

    // for-of and for-in (TypeScript)
    if (node.type === "for_in_statement") {
      const isForOf = node.children.some((c) => c.type === "of");
      this.emit(
        observations,
        isForOf ? "control-flow.for-of" : "control-flow.for-in",
        true,
        file,
        node,
      );
    }

    // Python for loop (for x in y)
    if (node.type === "for_statement" && file.language === "python") {
      this.emit(observations, "control-flow.for-loop", true, file, node);
    }

    // List/set/dict comprehension and generator expression (Python array-method equivalent)
    if (
      node.type === "list_comprehension" ||
      node.type === "set_comprehension" ||
      node.type === "dictionary_comprehension" ||
      node.type === "generator_expression"
    ) {
      this.emit(observations, "control-flow.array-method", true, file, node);
    }

    // Call expressions: detect array methods and .then()
    if (node.type === "call_expression") {
      const fn = node.childForFieldName("function");
      if (fn?.type === "member_expression") {
        const property = fn.childForFieldName("property");
        if (property) {
          const methodName = property.text;
          if (ARRAY_METHODS.has(methodName)) {
            this.emit(observations, "control-flow.array-method", methodName, file, node);
          }
          if (methodName === "then") {
            this.emit(observations, "control-flow.promise-then", true, file, node);
          }
        }
      }
    }

    // Await expression
    if (node.type === "await_expression") {
      this.emit(observations, "control-flow.async-await", true, file, node);
    }
  }

  private detectGuardClause(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    // A guard clause is an if-statement at the start of a function body
    // that returns early and has no else branch
    const parent = node.parent;
    if (!parent) return;

    const isFunctionBody =
      parent.type === "statement_block" &&
      (parent.parent?.type === "function_declaration" ||
       parent.parent?.type === "method_definition" ||
       parent.parent?.type === "arrow_function");

    const isPythonFunctionBody =
      parent.type === "block" &&
      parent.parent?.type === "function_definition";

    if (!isFunctionBody && !isPythonFunctionBody) return;

    // Must be among the first statements (before any non-guard logic)
    const siblings = parent.children.filter(
      (c) => c.type !== "comment" && c.type !== "{" && c.type !== "}",
    );
    const nodeIndex = siblings.indexOf(node);
    if (nodeIndex > 2) return;

    // The consequent must contain a return statement
    const consequent = node.childForFieldName("consequence") ?? node.childForFieldName("body");
    if (!consequent) return;

    const hasReturn = this.containsReturn(consequent);
    const hasElse = node.childForFieldName("alternative") !== null;

    if (hasReturn && !hasElse) {
      this.emit(observations, "control-flow.guard-clause", true, file, node);
    }
  }

  private detectElseAfterReturn(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const consequent = node.childForFieldName("consequence") ?? node.childForFieldName("body");
    const alternative = node.childForFieldName("alternative");

    if (!consequent || !alternative) return;

    if (this.containsReturn(consequent)) {
      this.emit(observations, "control-flow.else-after-return", true, file, node);
    }
  }

  private containsReturn(node: Parser.SyntaxNode): boolean {
    if (node.type === "return_statement") return true;
    for (const child of node.children) {
      if (child.type === "return_statement") return true;
    }
    return false;
  }

  private emit(
    observations: Observation[],
    type: string,
    value: string | number | boolean,
    file: ParsedFile,
    node: Parser.SyntaxNode,
  ): void {
    observations.push({
      type,
      category: "control-flow",
      value,
      file: file.filePath,
      line: node.startPosition.row + 1,
    });
  }
}
```

Run: `pnpm test -- packages/analyzer/src/__tests__/control-flow` -- should pass.

### Step 7: Update barrel exports

Add to **`packages/analyzer/src/extractors/index.ts`**:

```ts
export { StructureExtractor } from "./structure.js";
export { ControlFlowExtractor } from "./control-flow.js";
```

Add to **`packages/analyzer/src/index.ts`** extractors section:

```ts
export { StructureExtractor, ControlFlowExtractor } from "./extractors/index.js";
```

### Step 8: Verify and commit

```bash
pnpm typecheck
pnpm test -- packages/analyzer
pnpm build
```

```bash
git add packages/analyzer/src/extractors/structure.ts \
       packages/analyzer/src/extractors/control-flow.ts \
       packages/analyzer/src/extractors/index.ts \
       packages/analyzer/src/index.ts \
       packages/analyzer/src/__tests__/
git commit -m "Add structure and control-flow extractors with import/export and pattern detection"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer` passes all tests (structure + control-flow + existing naming tests)
- [ ] `pnpm typecheck` exits 0
- [ ] Structure extractor classifies imports into 4 groups: builtin, external, internal, relative
- [ ] Structure extractor counts named vs default exports
- [ ] Structure extractor detects export proximity (inline vs trailing)
- [ ] Structure extractor detects barrel files
- [ ] Control-flow extractor detects guard clauses at function entry (first 1-3 statements)
- [ ] Control-flow extractor detects else-after-return patterns
- [ ] Control-flow extractor counts ternary vs if/else
- [ ] Control-flow extractor counts array methods vs for loops
- [ ] Control-flow extractor distinguishes for-of, for-in, and indexed for loops
- [ ] Control-flow extractor counts async/await vs .then() chains
- [ ] Python list comprehensions are classified as `control-flow.array-method`
- [ ] Both extractors work for TypeScript and Python fixtures
- [ ] All observations have the correct category field and 1-based line numbers
- [ ] `pnpm build` produces valid `.d.ts` files for all exported types

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace
2. **Do not skip the verify step** -- run typecheck and tests before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not modify the Extractor interface or types.ts** -- that file belongs to Task 04; implement the interface as-is
5. **Do not count guard clauses deep inside nested functions** -- only detect guards at the immediate top of a function body (first 1-3 statements); mid-function returns are not guard clauses
6. **Do not conflate for-of with for-in** -- they are separate observation types; for-of is the modern iteration pattern, for-in iterates over keys
7. **Do not process Python list comprehensions as for-loops** -- they are the Pythonic equivalent of array methods (.map/.filter) and should be categorized as `control-flow.array-method`
8. **Do not hardcode the Python stdlib list exhaustively** -- use a representative subset and document that it is non-exhaustive; it can be expanded later
