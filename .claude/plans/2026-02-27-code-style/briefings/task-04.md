# Task 04: Extractor Framework + Naming Extractor

## Architectural Context

The extractor framework is the core of Stage 2 (Extract) in the analysis pipeline. Every extractor follows the same interface: it receives a parsed file (tree-sitter AST + metadata) and returns raw observations. The naming extractor is the first concrete implementation, covering 10 features from Category 1 of the feature taxonomy (variable, function, type, file, boolean, constant, enum, parameter, private member naming). Tree-sitter is the primary AST engine, initialized with TypeScript and Python grammars. All extractors live in `@code-style/analyzer` under `src/extractors/`. Tasks 05-08 add additional extractors that follow the same `Extractor` interface established here.

## File Ownership

**May modify:**
- `/packages/analyzer/package.json` (add tree-sitter dependencies)
- `/packages/analyzer/src/index.ts` (add extractor exports)
- `/packages/analyzer/src/extractors/types.ts` (NEW)
- `/packages/analyzer/src/extractors/parser.ts` (NEW)
- `/packages/analyzer/src/extractors/naming.ts` (NEW)
- `/packages/analyzer/src/extractors/index.ts` (NEW)
- `/packages/analyzer/src/__tests__/naming.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/parser.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/naming-sample.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/naming-sample.py` (NEW)

**Must not touch:**
- `/packages/profile/**` (completed in Task 02)
- `/packages/analyzer/src/ingest/**` (completed in Task 03)
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`

**Read for context (do not modify):**
- `/docs/plans/2026-02-27-code-style-design.md` (extractor architecture)
- `/docs/research/07-unified-feature-taxonomy.md` (Category 1: Naming Conventions -- 10 features)
- `/docs/research/08-tool-pipeline-matrix.md` (tree-sitter as primary extraction tool)

## Steps

### Step 1: Add tree-sitter dependencies

```bash
pnpm --filter @code-style/analyzer add tree-sitter tree-sitter-typescript tree-sitter-python
```

Note: `tree-sitter-typescript` exports both TypeScript and TSX grammars.

### Step 2: Define extractor types

**`packages/analyzer/src/extractors/types.ts`**:

```ts
import type Parser from "tree-sitter";

export interface Observation {
  /** Feature type, e.g. "naming.variable", "naming.function" */
  type: string;
  /** Top-level category, e.g. "naming", "structure" */
  category: string;
  /** Detected value, e.g. "camelCase", true, 28 */
  value: string | number | boolean;
  /** Source file path */
  file: string;
  /** Line number (1-based) */
  line: number;
  /** Additional context for aggregation */
  metadata?: Record<string, unknown>;
}

export interface ParsedFile {
  tree: Parser.Tree;
  content: string;
  filePath: string;
  language: string;
}

export interface Extractor {
  name: string;
  extract(file: ParsedFile): Observation[];
}
```

### Step 3: Write parser tests

**`packages/analyzer/src/__tests__/parser.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { parseFile, getSupportedLanguages } from "../extractors/parser.js";

describe("parseFile", () => {
  it("parses TypeScript source code", () => {
    const result = parseFile(
      'const userName = "test";',
      "test.ts",
      "typescript",
    );

    expect(result.tree.rootNode.type).toBe("program");
    expect(result.filePath).toBe("test.ts");
    expect(result.language).toBe("typescript");
  });

  it("parses Python source code", () => {
    const result = parseFile(
      'user_name = "test"',
      "test.py",
      "python",
    );

    expect(result.tree.rootNode.type).toBe("module");
    expect(result.language).toBe("python");
  });

  it("throws for unsupported language", () => {
    expect(() => parseFile("code", "test.rb", "ruby")).toThrow(
      "Unsupported language: ruby",
    );
  });
});

describe("getSupportedLanguages", () => {
  it("returns typescript and python", () => {
    const languages = getSupportedLanguages();
    expect(languages).toContain("typescript");
    expect(languages).toContain("python");
  });
});
```

### Step 4: Implement parser

**`packages/analyzer/src/extractors/parser.ts`**:

```ts
import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import Python from "tree-sitter-python";
import type { ParsedFile } from "./types.js";

const parsers = new Map<string, Parser>();

function getParser(language: string): Parser {
  const cached = parsers.get(language);
  if (cached) return cached;

  const parser = new Parser();

  switch (language) {
    case "typescript":
      parser.setLanguage(TypeScript.typescript);
      break;
    case "tsx":
      parser.setLanguage(TypeScript.tsx);
      break;
    case "python":
      parser.setLanguage(Python);
      break;
    default:
      throw new Error(`Unsupported language: ${language}`);
  }

  parsers.set(language, parser);
  return parser;
}

export function parseFile(
  content: string,
  filePath: string,
  language: string,
): ParsedFile {
  const parser = getParser(language);
  const tree = parser.parse(content);
  return { tree, content, filePath, language };
}

export function getSupportedLanguages(): string[] {
  return ["typescript", "tsx", "python"];
}
```

Run: `pnpm test -- packages/analyzer/src/__tests__/parser` -- parser tests should pass.

### Step 5: Create naming fixture files

**`packages/analyzer/src/__tests__/fixtures/naming-sample.ts`**:

```ts
// Variables: camelCase
const userName = "Alice";
const accountBalance = 100;
let isActive = true;
let hasPermission = false;
const shouldRetry = true;

// Constants: SCREAMING_SNAKE
const MAX_RETRIES = 3;
const API_BASE_URL = "https://api.example.com";

// Functions: camelCase
function fetchUserProfile(userId: string) {
  return userId;
}

const calculateTotal = (items: number[]) => {
  return items.reduce((sum, item) => sum + item, 0);
};

// Types: PascalCase
interface UserProfile {
  name: string;
  age: number;
}

type ApiResponse = {
  data: unknown;
  status: number;
};

enum UserRole {
  Admin = "admin",
  Editor = "editor",
  Viewer = "viewer",
}

// Class: PascalCase
class HttpClient {
  private _baseUrl: string;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl;
  }

  async getData(endpoint: string) {
    return endpoint;
  }
}

// Parameters: camelCase
function processOrder(orderId: string, itemCount: number) {
  return { orderId, itemCount };
}
```

**`packages/analyzer/src/__tests__/fixtures/naming-sample.py`**:

```python
# Variables: snake_case
user_name = "Alice"
account_balance = 100
is_active = True
has_permission = False

# Constants: SCREAMING_SNAKE
MAX_RETRIES = 3
API_BASE_URL = "https://api.example.com"

# Functions: snake_case
def fetch_user_profile(user_id: str):
    return user_id

def calculate_total(items: list[int]) -> int:
    return sum(items)

# Classes: PascalCase
class HttpClient:
    def __init__(self, base_url: str):
        self._base_url = base_url

    def get_data(self, endpoint: str):
        return endpoint

# Parameters: snake_case
def process_order(order_id: str, item_count: int):
    return {"order_id": order_id, "item_count": item_count}
```

### Step 6: Write naming extractor tests

**`packages/analyzer/src/__tests__/naming.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { NamingExtractor } from "../extractors/naming.js";
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

describe("NamingExtractor", () => {
  const extractor = new NamingExtractor();

  describe("TypeScript", () => {
    const parsed = loadFixture("naming-sample.ts", "typescript");
    const observations = extractor.extract(parsed);

    it("has name 'naming'", () => {
      expect(extractor.name).toBe("naming");
    });

    it("detects camelCase variables", () => {
      const vars = observations.filter(
        (o) => o.type === "naming.variable" && o.value === "camelCase",
      );
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it("detects SCREAMING_SNAKE constants", () => {
      const constants = observations.filter(
        (o) => o.type === "naming.constant" && o.value === "SCREAMING_SNAKE",
      );
      expect(constants.length).toBe(2);
    });

    it("detects camelCase functions", () => {
      const fns = observations.filter(
        (o) => o.type === "naming.function" && o.value === "camelCase",
      );
      expect(fns.length).toBeGreaterThanOrEqual(2);
    });

    it("detects PascalCase types", () => {
      const types = observations.filter(
        (o) => o.type === "naming.type" && o.value === "PascalCase",
      );
      expect(types.length).toBeGreaterThanOrEqual(2);
    });

    it("detects boolean prefixes", () => {
      const booleans = observations.filter(
        (o) => o.type === "naming.boolean",
      );
      expect(booleans.length).toBeGreaterThanOrEqual(3);
      booleans.forEach((b) => {
        expect(["is", "has", "should"]).toContain(b.value);
      });
    });

    it("detects PascalCase enum", () => {
      const enums = observations.filter(
        (o) => o.type === "naming.enum",
      );
      expect(enums.length).toBeGreaterThanOrEqual(1);
      expect(enums[0].value).toBe("PascalCase");
    });

    it("detects camelCase parameters", () => {
      const params = observations.filter(
        (o) => o.type === "naming.parameter" && o.value === "camelCase",
      );
      expect(params.length).toBeGreaterThanOrEqual(2);
    });

    it("detects private member prefix", () => {
      const priv = observations.filter(
        (o) => o.type === "naming.private-member",
      );
      expect(priv.length).toBeGreaterThanOrEqual(1);
      expect(priv[0].value).toBe("underscore-prefix");
    });

    it("sets correct category on all observations", () => {
      observations.forEach((o) => {
        expect(o.category).toBe("naming");
      });
    });
  });

  describe("Python", () => {
    const parsed = loadFixture("naming-sample.py", "python");
    const observations = extractor.extract(parsed);

    it("detects snake_case variables", () => {
      const vars = observations.filter(
        (o) => o.type === "naming.variable" && o.value === "snake_case",
      );
      expect(vars.length).toBeGreaterThanOrEqual(2);
    });

    it("detects snake_case functions", () => {
      const fns = observations.filter(
        (o) => o.type === "naming.function" && o.value === "snake_case",
      );
      expect(fns.length).toBeGreaterThanOrEqual(2);
    });

    it("detects PascalCase classes", () => {
      const types = observations.filter(
        (o) => o.type === "naming.type" && o.value === "PascalCase",
      );
      expect(types.length).toBeGreaterThanOrEqual(1);
    });

    it("detects boolean prefixes in Python", () => {
      const booleans = observations.filter(
        (o) => o.type === "naming.boolean",
      );
      expect(booleans.length).toBeGreaterThanOrEqual(2);
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/src/__tests__/naming` -- expect failures.

### Step 7: Implement naming extractor

**`packages/analyzer/src/extractors/naming.ts`**:

```ts
import type Parser from "tree-sitter";
import type { Extractor, ParsedFile, Observation } from "./types.js";

const NAMING_PATTERNS: Record<string, RegExp> = {
  camelCase: /^[a-z][a-zA-Z0-9]*$/,
  PascalCase: /^[A-Z][a-zA-Z0-9]*$/,
  snake_case: /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/,
  SCREAMING_SNAKE: /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/,
  "kebab-case": /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/,
};

const BOOLEAN_PREFIXES = /^(is|has|should|can|will|did|was)[A-Z_]/;
const PYTHON_BOOLEAN_PREFIXES = /^(is|has|should|can|will|did|was)_/;

function detectConvention(name: string): string | null {
  for (const [convention, pattern] of Object.entries(NAMING_PATTERNS)) {
    if (pattern.test(name)) return convention;
  }
  // Single-word lowercase matches both camelCase and snake_case; prefer camelCase
  if (/^[a-z][a-z0-9]*$/.test(name)) return "camelCase";
  return null;
}

function detectBooleanPrefix(name: string, language: string): string | null {
  const pattern = language === "python" ? PYTHON_BOOLEAN_PREFIXES : BOOLEAN_PREFIXES;
  const match = name.match(pattern);
  return match ? match[1] : null;
}

export class NamingExtractor implements Extractor {
  readonly name = "naming";

  extract(file: ParsedFile): Observation[] {
    const observations: Observation[] = [];

    const visit = (node: Parser.SyntaxNode): void => {
      this.processNode(node, file, observations);
      for (const child of node.children) {
        visit(child);
      }
    };

    visit(file.tree.rootNode);
    return observations;
  }

  private processNode(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    switch (file.language) {
      case "typescript":
      case "tsx":
        this.processTypeScriptNode(node, file, observations);
        break;
      case "python":
        this.processPythonNode(node, file, observations);
        break;
    }
  }

  private processTypeScriptNode(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    switch (node.type) {
      case "variable_declarator": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode || nameNode.type !== "identifier") break;
        const name = nameNode.text;

        // Check if it is a constant (const + SCREAMING_SNAKE)
        const declKind = node.parent?.parent?.type === "lexical_declaration"
          ? node.parent.parent.children[0]?.text
          : null;

        if (declKind === "const" && NAMING_PATTERNS.SCREAMING_SNAKE.test(name)) {
          this.addObservation(observations, "naming.constant", "SCREAMING_SNAKE", file, node);
          break;
        }

        // Boolean detection
        const prefix = detectBooleanPrefix(name, file.language);
        if (prefix) {
          this.addObservation(observations, "naming.boolean", prefix, file, node);
        }

        const convention = detectConvention(name);
        if (convention) {
          this.addObservation(observations, "naming.variable", convention, file, node);
        }
        break;
      }

      case "function_declaration": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.function", convention, file, node);
        }
        break;
      }

      case "interface_declaration":
      case "type_alias_declaration": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.type", convention, file, node);
        }
        break;
      }

      case "enum_declaration": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.enum", convention, file, node);
        }
        break;
      }

      case "class_declaration": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.type", convention, file, node);
        }

        // Check for private members within the class body
        this.detectPrivateMembers(node, file, observations);
        break;
      }

      case "required_parameter":
      case "optional_parameter": {
        const nameNode = node.childForFieldName("pattern") ?? node.childForFieldName("name");
        if (!nameNode || nameNode.type !== "identifier") break;
        if (nameNode.text === "this") break;
        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.parameter", convention, file, node);
        }
        break;
      }
    }
  }

  private processPythonNode(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    switch (node.type) {
      case "assignment": {
        const left = node.childForFieldName("left");
        if (!left || left.type !== "identifier") break;
        const name = left.text;

        // Module-level SCREAMING_SNAKE = constant
        if (
          node.parent?.type === "module" &&
          NAMING_PATTERNS.SCREAMING_SNAKE.test(name)
        ) {
          this.addObservation(observations, "naming.constant", "SCREAMING_SNAKE", file, node);
          break;
        }

        const prefix = detectBooleanPrefix(name, file.language);
        if (prefix) {
          this.addObservation(observations, "naming.boolean", prefix, file, node);
        }

        const convention = detectConvention(name);
        if (convention) {
          this.addObservation(observations, "naming.variable", convention, file, node);
        }
        break;
      }

      case "function_definition": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        // Skip dunder methods
        if (nameNode.text.startsWith("__") && nameNode.text.endsWith("__")) break;

        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.function", convention, file, node);
        }
        break;
      }

      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        const convention = detectConvention(nameNode.text);
        if (convention) {
          this.addObservation(observations, "naming.type", convention, file, node);
        }
        break;
      }

      case "parameters": {
        for (const child of node.children) {
          if (child.type === "identifier" && child.text !== "self" && child.text !== "cls") {
            const convention = detectConvention(child.text);
            if (convention) {
              this.addObservation(observations, "naming.parameter", convention, file, child);
            }
          }
          // Handle typed parameters
          if (child.type === "typed_parameter") {
            const paramName = child.childForFieldName("name") ?? child.children[0];
            if (paramName && paramName.type === "identifier" && paramName.text !== "self") {
              const convention = detectConvention(paramName.text);
              if (convention) {
                this.addObservation(observations, "naming.parameter", convention, file, child);
              }
            }
          }
        }
        break;
      }
    }
  }

  private detectPrivateMembers(
    classNode: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const body = classNode.childForFieldName("body");
    if (!body) return;

    for (const member of body.children) {
      if (member.type === "public_field_definition") {
        const nameNode = member.childForFieldName("name");
        if (!nameNode) continue;
        const name = nameNode.text;

        if (name.startsWith("#")) {
          this.addObservation(observations, "naming.private-member", "hash-prefix", file, member);
        } else if (name.startsWith("_") && !name.startsWith("__")) {
          this.addObservation(observations, "naming.private-member", "underscore-prefix", file, member);
        }
      }
    }
  }

  private addObservation(
    observations: Observation[],
    type: string,
    value: string | number | boolean,
    file: ParsedFile,
    node: Parser.SyntaxNode,
  ): void {
    observations.push({
      type,
      category: "naming",
      value,
      file: file.filePath,
      line: node.startPosition.row + 1,
    });
  }
}
```

### Step 8: Create barrel export for extractors

**`packages/analyzer/src/extractors/index.ts`**:

```ts
export type { Extractor, Observation, ParsedFile } from "./types.js";
export { parseFile, getSupportedLanguages } from "./parser.js";
export { NamingExtractor } from "./naming.js";
```

Update **`packages/analyzer/src/index.ts`** to add extractor exports:

```ts
// Ingest
export {
  type IngestConfig,
  type CodeCorpus,
  type CodeFile,
  type ReviewComment,
  type PullRequest,
  type PullRequestFile,
  type IngestMetadata,
  GitHubService,
  shouldIncludeFile,
  getLanguageFromPath,
  FileCache,
} from "./ingest/index.js";

// Extractors
export {
  type Extractor,
  type Observation,
  type ParsedFile,
  parseFile,
  getSupportedLanguages,
  NamingExtractor,
} from "./extractors/index.js";
```

### Step 9: Verify and commit

```bash
pnpm typecheck
pnpm test -- packages/analyzer
pnpm build
```

```bash
git add packages/analyzer/
git commit -m "Add extractor framework with tree-sitter parser and naming extractor"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer` passes all tests (parser, naming for TS and Python)
- [ ] `pnpm typecheck` exits 0
- [ ] Parser initializes tree-sitter with TypeScript and Python grammars
- [ ] Parser caches parser instances by language in a module-level Map
- [ ] Parser throws on unsupported language
- [ ] Naming extractor detects all convention types: camelCase, PascalCase, snake_case, SCREAMING_SNAKE
- [ ] Naming extractor classifies identifiers by context: variable, function, type, parameter, constant, enum, boolean, private-member
- [ ] Boolean prefix detection works for is/has/should in both TypeScript and Python
- [ ] Python dunder methods (__init__, __str__) are skipped
- [ ] All observations have correct `category: "naming"` and 1-based line numbers
- [ ] Fixture files cover representative patterns for both TypeScript and Python
- [ ] `pnpm build` produces valid `.d.ts` files for all exported types

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace
2. **Do not skip the verify step** -- run typecheck and tests before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use tree-sitter queries (S-expressions) for v1** -- walk the tree manually using `node.type` and `childForFieldName()`; queries are more elegant but harder to debug and less portable across grammar versions
5. **Do not classify single-word lowercase identifiers as snake_case** -- `name` is `camelCase`, not `snake_case`; snake_case requires at least one underscore
6. **Do not create a new Parser instance per file** -- cache parsers by language in a module-level Map
7. **Do not process dunder methods (__init__, __str__) as function naming observations** -- they are language conventions, not developer style
8. **Do not mix fixture file formats** -- each fixture should be a real, parseable source file in its target language
