# Task 06: Documentation + Error-Handling Extractors

## Architectural Context

These two extractors cover Categories 5 (Documentation) and 4 (Error Handling) from the feature taxonomy. Both follow the established `Extractor` interface from Task 04 and use the same tree-sitter AST walk approach. The **documentation extractor** analyzes comment nodes relative to declarations: it detects JSDoc/docstring presence per function/class, distinguishes public vs private doc coverage, counts inline comments, classifies comment placement (leading vs trailing), and extracts JSDoc tags (@param, @returns, @throws) and Python doc section headers (Args, Returns, Raises). The **error-handling extractor** detects try/catch patterns, classifies catch clause specificity (instanceof checks vs generic catch), identifies Result type usage, custom error classes (extends Error), the assertNever exhaustive-checking pattern, and exhaustive switch statements. Together with Tasks 04 and 05, these complete the core extraction layer for the programmatic features.

## File Ownership

**May modify:**
- `/packages/analyzer/src/extractors/documentation.ts` (NEW)
- `/packages/analyzer/src/extractors/error-handling.ts` (NEW)
- `/packages/analyzer/src/extractors/index.ts` (add exports)
- `/packages/analyzer/src/index.ts` (add exports)
- `/packages/analyzer/src/__tests__/documentation.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/error-handling.test.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/documentation-sample.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/documentation-sample.py` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/error-handling-sample.ts` (NEW)
- `/packages/analyzer/src/__tests__/fixtures/error-handling-sample.py` (NEW)

**Must not touch:**
- `/packages/profile/**`
- `/packages/analyzer/src/ingest/**` (completed in Task 03)
- `/packages/analyzer/src/extractors/types.ts` (established in Task 04)
- `/packages/analyzer/src/extractors/parser.ts` (established in Task 04)
- `/packages/analyzer/src/extractors/naming.ts` (completed in Task 04)
- `/packages/analyzer/src/extractors/structure.ts` (completed in Task 05)
- `/packages/analyzer/src/extractors/control-flow.ts` (completed in Task 05)
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`

**Read for context (do not modify):**
- `/packages/analyzer/src/extractors/types.ts` (Extractor, Observation, ParsedFile interfaces)
- `/packages/analyzer/src/extractors/naming.ts` (reference pattern for tree-sitter walk + emit helper)
- `/docs/research/07-unified-feature-taxonomy.md` (Categories 4 and 5)
- `/docs/plans/2026-02-27-code-style-design.md` (documentation and error-handling feature descriptions)

## Steps

### Step 1: Create documentation fixture

**`packages/analyzer/src/__tests__/fixtures/documentation-sample.ts`**:

```ts
/**
 * Fetches a user profile from the API.
 *
 * @param userId - The user's unique identifier
 * @returns The user profile object
 * @throws {NotFoundError} If the user does not exist
 */
export function fetchUserProfile(userId: string): Promise<UserProfile> {
  return api.get(`/users/${userId}`);
}

/** Validates email format. */
export function validateEmail(email: string): boolean {
  return /^[^@]+@[^@]+\.[^@]+$/.test(email);
}

// This is a helper that normalizes whitespace
function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function undocumentedPublicFunction(data: unknown): void {
  console.log(data);
}

function undocumentedPrivateFunction(): number {
  return 42;
}

export class UserService {
  /**
   * Creates a new user in the database.
   *
   * @param name - Display name
   * @param email - Email address
   */
  async createUser(name: string, email: string): Promise<User> {
    return this.db.insert({ name, email });
  }

  // Quick lookup by ID
  async getUser(id: string): Promise<User | null> {
    return this.db.findById(id); // inline trailing comment
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }
}

// Section: Utility functions
// These helpers are used across the codebase

function helperA() {
  return 1;
}

function helperB() {
  return 2; // trailing
}
```

**`packages/analyzer/src/__tests__/fixtures/documentation-sample.py`**:

```python
def fetch_user_profile(user_id: str) -> dict:
    """Fetch a user profile from the API.

    Args:
        user_id: The user's unique identifier.

    Returns:
        The user profile dictionary.

    Raises:
        NotFoundError: If the user does not exist.
    """
    return api.get(f"/users/{user_id}")


def validate_email(email: str) -> bool:
    """Validate email format."""
    import re
    return bool(re.match(r"^[^@]+@[^@]+\.[^@]+$", email))


# This normalizes whitespace
def normalize_whitespace(input_str: str) -> str:
    return " ".join(input_str.split())


def undocumented_function(data):
    print(data)


class UserService:
    """Service for managing users."""

    def create_user(self, name: str, email: str) -> dict:
        """Create a new user in the database.

        Args:
            name: Display name.
            email: Email address.
        """
        return self.db.insert({"name": name, "email": email})

    def get_user(self, user_id: str) -> dict:
        # Quick lookup by ID
        return self.db.find_by_id(user_id)
```

### Step 2: Write documentation extractor tests

**`packages/analyzer/src/__tests__/documentation.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { DocumentationExtractor } from "../extractors/documentation.js";
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

describe("DocumentationExtractor", () => {
  const extractor = new DocumentationExtractor();

  it("has name 'documentation'", () => {
    expect(extractor.name).toBe("documentation");
  });

  describe("TypeScript", () => {
    const parsed = loadFixture("documentation-sample.ts", "typescript");
    const observations = extractor.extract(parsed);

    it("detects JSDoc presence on exported functions", () => {
      const jsdocPresent = observations.filter(
        (o) => o.type === "documentation.jsdoc-presence" && o.value === true,
      );
      // fetchUserProfile and validateEmail have JSDoc
      expect(jsdocPresent.length).toBeGreaterThanOrEqual(2);
    });

    it("detects missing docs on exported functions", () => {
      const jsdocMissing = observations.filter(
        (o) => o.type === "documentation.jsdoc-presence" && o.value === false,
      );
      // undocumentedPublicFunction has no JSDoc
      expect(jsdocMissing.length).toBeGreaterThanOrEqual(1);
    });

    it("distinguishes public vs private doc coverage", () => {
      const publicDocs = observations.filter(
        (o) => o.type === "documentation.public-coverage",
      );
      const privateDocs = observations.filter(
        (o) => o.type === "documentation.private-coverage",
      );
      expect(publicDocs.length).toBeGreaterThan(0);
      expect(privateDocs.length).toBeGreaterThan(0);
    });

    it("detects inline comments", () => {
      const inline = observations.filter(
        (o) => o.type === "documentation.inline-comment",
      );
      expect(inline.length).toBeGreaterThanOrEqual(2);
    });

    it("detects leading vs trailing comment placement", () => {
      const leading = observations.filter(
        (o) => o.type === "documentation.comment-placement" && o.value === "leading",
      );
      const trailing = observations.filter(
        (o) => o.type === "documentation.comment-placement" && o.value === "trailing",
      );
      expect(leading.length).toBeGreaterThan(0);
      expect(trailing.length).toBeGreaterThan(0);
    });

    it("detects JSDoc tags", () => {
      const tags = observations.filter(
        (o) => o.type === "documentation.jsdoc-tag",
      );
      const tagValues = tags.map((t) => t.value);
      expect(tagValues).toContain("@param");
      expect(tagValues).toContain("@returns");
      expect(tagValues).toContain("@throws");
    });

    it("sets correct category on all observations", () => {
      observations.forEach((o) => {
        expect(o.category).toBe("documentation");
      });
    });
  });

  describe("Python", () => {
    const parsed = loadFixture("documentation-sample.py", "python");
    const observations = extractor.extract(parsed);

    it("detects docstring presence on functions", () => {
      const docPresent = observations.filter(
        (o) => o.type === "documentation.jsdoc-presence" && o.value === true,
      );
      // fetch_user_profile and validate_email have docstrings
      expect(docPresent.length).toBeGreaterThanOrEqual(2);
    });

    it("detects missing docstrings", () => {
      const docMissing = observations.filter(
        (o) => o.type === "documentation.jsdoc-presence" && o.value === false,
      );
      expect(docMissing.length).toBeGreaterThanOrEqual(1);
    });

    it("detects docstring tags (Args, Returns, Raises)", () => {
      const tags = observations.filter(
        (o) => o.type === "documentation.jsdoc-tag",
      );
      const tagValues = tags.map((t) => t.value);
      expect(tagValues).toContain("Args");
      expect(tagValues).toContain("Returns");
      expect(tagValues).toContain("Raises");
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/src/__tests__/documentation` -- expect failures.

### Step 3: Implement documentation extractor

**`packages/analyzer/src/extractors/documentation.ts`**:

```ts
import type Parser from "tree-sitter";
import type { Extractor, ParsedFile, Observation } from "./types.js";

const JSDOC_TAG_PATTERN = /@(param|returns?|throws?|example|deprecated|see|since|type|typedef|template|callback|async)\b/g;
const PYTHON_DOC_TAG_PATTERN = /^[ \t]*(Args|Returns?|Raises?|Yields?|Note|Notes|Example|Attributes|Todo|References):/gm;

export class DocumentationExtractor implements Extractor {
  readonly name = "documentation";

  extract(file: ParsedFile): Observation[] {
    const observations: Observation[] = [];

    this.extractDeclarationDocs(file.tree.rootNode, file, observations);
    this.extractInlineComments(file.tree.rootNode, file, observations);

    return observations;
  }

  private extractDeclarationDocs(
    root: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    this.walkDeclarations(root, file, observations);
  }

  private walkDeclarations(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    for (const child of node.children) {
      if (this.isDeclaration(child, file.language)) {
        this.processDeclaration(child, file, observations);
      }
      // Recurse into class bodies for methods
      if (
        child.type === "class_declaration" ||
        child.type === "class_definition" ||
        child.type === "class_body" ||
        child.type === "block"
      ) {
        this.walkDeclarations(child, file, observations);
      }
      // For export statements, check the inner declaration
      if (child.type === "export_statement") {
        this.walkDeclarations(child, file, observations);
      }
    }
  }

  private isDeclaration(node: Parser.SyntaxNode, language: string): boolean {
    if (language === "python") {
      return (
        node.type === "function_definition" ||
        node.type === "class_definition"
      );
    }
    return (
      node.type === "function_declaration" ||
      node.type === "method_definition" ||
      node.type === "class_declaration" ||
      node.type === "interface_declaration" ||
      node.type === "type_alias_declaration"
    );
  }

  private processDeclaration(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const isExported = this.isExported(node, file.language);
    const hasDoc = this.hasLeadingDoc(node, file.language);

    // JSDoc/docstring presence
    this.emit(observations, "documentation.jsdoc-presence", hasDoc, file, node);

    // Public vs private coverage
    const coverageType = isExported
      ? "documentation.public-coverage"
      : "documentation.private-coverage";
    this.emit(observations, coverageType, hasDoc, file, node);

    // Extract JSDoc/docstring tags
    if (hasDoc) {
      this.extractTags(node, file, observations);
    }
  }

  private hasLeadingDoc(node: Parser.SyntaxNode, language: string): boolean {
    if (language === "python") {
      return this.hasPythonDocstring(node);
    }
    return this.hasJSDoc(node);
  }

  private hasJSDoc(node: Parser.SyntaxNode): boolean {
    // Check for a comment node immediately preceding this node
    const prev = this.getPreviousSibling(node);
    if (prev?.type === "comment" && prev.text.startsWith("/**")) {
      return true;
    }
    // Also check if parent is export_statement and comment precedes that
    if (node.parent?.type === "export_statement") {
      const exportPrev = this.getPreviousSibling(node.parent);
      if (exportPrev?.type === "comment" && exportPrev.text.startsWith("/**")) {
        return true;
      }
    }
    return false;
  }

  private hasPythonDocstring(node: Parser.SyntaxNode): boolean {
    // Python docstrings are the first expression_statement in a function/class body
    const body = node.childForFieldName("body");
    if (!body) return false;

    const firstStatement = body.children.find(
      (c) => c.type !== "comment" && c.type !== "newline",
    );
    if (!firstStatement) return false;

    if (firstStatement.type === "expression_statement") {
      const expr = firstStatement.children[0];
      return expr?.type === "string" || expr?.type === "concatenated_string";
    }
    return false;
  }

  private extractTags(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    if (file.language === "python") {
      this.extractPythonDocTags(node, file, observations);
      return;
    }

    // Get the JSDoc comment text
    const commentNode = this.getLeadingComment(node);
    if (!commentNode) return;

    const text = commentNode.text;
    const tagMatches = text.matchAll(JSDOC_TAG_PATTERN);
    const seenTags = new Set<string>();

    for (const match of tagMatches) {
      const tag = `@${match[1]}`;
      if (seenTags.has(tag)) continue;
      seenTags.add(tag);

      // Normalize @return to @returns, @throw to @throws
      const normalized = tag
        .replace(/^@return$/, "@returns")
        .replace(/^@throw$/, "@throws");

      this.emit(observations, "documentation.jsdoc-tag", normalized, file, commentNode);
    }
  }

  private extractPythonDocTags(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const body = node.childForFieldName("body");
    if (!body) return;

    const firstStatement = body.children.find(
      (c) => c.type === "expression_statement",
    );
    if (!firstStatement) return;

    const expr = firstStatement.children[0];
    if (!expr) return;

    const text = expr.text;
    const tagMatches = text.matchAll(PYTHON_DOC_TAG_PATTERN);
    const seenTags = new Set<string>();

    for (const match of tagMatches) {
      const tag = match[1];
      if (seenTags.has(tag)) continue;
      seenTags.add(tag);
      this.emit(observations, "documentation.jsdoc-tag", tag, file, expr);
    }
  }

  private extractInlineComments(
    root: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    this.walkForComments(root, file, observations);
  }

  private walkForComments(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    if (node.type === "comment") {
      // Skip JSDoc block comments (already handled as declaration docs)
      if (node.text.startsWith("/**")) return;

      this.emit(observations, "documentation.inline-comment", true, file, node);

      // Determine placement: leading or trailing
      const placement = this.getCommentPlacement(node);
      this.emit(observations, "documentation.comment-placement", placement, file, node);
    }

    for (const child of node.children) {
      this.walkForComments(child, file, observations);
    }
  }

  private getCommentPlacement(node: Parser.SyntaxNode): "leading" | "trailing" {
    // A trailing comment is on the same line as code before it
    const prev = this.getPreviousSibling(node);
    if (prev && prev.endPosition.row === node.startPosition.row) {
      return "trailing";
    }
    return "leading";
  }

  private isExported(node: Parser.SyntaxNode, language: string): boolean {
    if (language === "python") {
      // Python: module-level functions/classes without _ prefix are "public"
      const nameNode = node.childForFieldName("name");
      return (
        node.parent?.type === "module" &&
        !!nameNode &&
        !nameNode.text.startsWith("_")
      );
    }
    // TypeScript: parent is export_statement
    return node.parent?.type === "export_statement";
  }

  private getPreviousSibling(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (!node.parent) return null;
    const siblings = node.parent.children;
    const idx = siblings.indexOf(node);
    if (idx <= 0) return null;
    return siblings[idx - 1];
  }

  private getLeadingComment(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    let prev = this.getPreviousSibling(node);
    if (!prev && node.parent?.type === "export_statement") {
      prev = this.getPreviousSibling(node.parent);
    }
    if (prev?.type === "comment" && prev.text.startsWith("/**")) {
      return prev;
    }
    return null;
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
      category: "documentation",
      value,
      file: file.filePath,
      line: node.startPosition.row + 1,
    });
  }
}
```

Run: `pnpm test -- packages/analyzer/src/__tests__/documentation` -- should pass.

### Step 4: Create error-handling fixture

**`packages/analyzer/src/__tests__/fixtures/error-handling-sample.ts`**:

```ts
// try/catch with specific error type checks
async function fetchUser(id: string) {
  try {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      throw new HttpError(response.status, "Failed to fetch user");
    }
    return await response.json();
  } catch (error) {
    if (error instanceof HttpError) {
      console.error(`HTTP ${error.status}: ${error.message}`);
    } else if (error instanceof TypeError) {
      console.error("Network error");
    }
    throw error;
  }
}

// try/catch with generic catch (non-specific)
function parseConfig(raw: string) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// Custom error class
class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

// Result type pattern
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

function safeParse(input: string): Result<object> {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch (e) {
    return { ok: false, error: e as Error };
  }
}

// Exhaustive switch with assertNever
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number };

function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`);
}

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "square":
      return shape.side ** 2;
    default:
      return assertNever(shape);
  }
}

// Non-exhaustive switch (no default)
function getLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
  }
  return "Unknown";
}
```

**`packages/analyzer/src/__tests__/fixtures/error-handling-sample.py`**:

```python
# try/except with specific exception types
def fetch_user(user_id: str) -> dict:
    try:
        response = requests.get(f"/api/users/{user_id}")
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as e:
        print(f"HTTP error: {e}")
        raise
    except ConnectionError:
        print("Network error")
        raise


# try/except with generic catch
def parse_config(raw: str):
    try:
        return json.loads(raw)
    except Exception:
        return None


# Custom exception class
class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class ValidationError(Exception):
    def __init__(self, field: str, message: str):
        super().__init__(message)
        self.field = field
```

### Step 5: Write error-handling extractor tests

**`packages/analyzer/src/__tests__/error-handling.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { ErrorHandlingExtractor } from "../extractors/error-handling.js";
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

describe("ErrorHandlingExtractor", () => {
  const extractor = new ErrorHandlingExtractor();

  it("has name 'error-handling'", () => {
    expect(extractor.name).toBe("error-handling");
  });

  describe("TypeScript", () => {
    const parsed = loadFixture("error-handling-sample.ts", "typescript");
    const observations = extractor.extract(parsed);

    it("counts try/catch statements", () => {
      const tryCatch = observations.filter(
        (o) => o.type === "error-handling.try-catch",
      );
      // fetchUser, parseConfig, safeParse
      expect(tryCatch.length).toBe(3);
    });

    it("detects specific catch clauses (instanceof checks)", () => {
      const specific = observations.filter(
        (o) => o.type === "error-handling.catch-specificity" && o.value === "specific",
      );
      expect(specific.length).toBeGreaterThanOrEqual(1);
    });

    it("detects generic catch clauses", () => {
      const generic = observations.filter(
        (o) => o.type === "error-handling.catch-specificity" && o.value === "generic",
      );
      expect(generic.length).toBeGreaterThanOrEqual(1);
    });

    it("detects Result type usage", () => {
      const resultTypes = observations.filter(
        (o) => o.type === "error-handling.result-type",
      );
      expect(resultTypes.length).toBeGreaterThanOrEqual(1);
    });

    it("detects custom error classes", () => {
      const customErrors = observations.filter(
        (o) => o.type === "error-handling.custom-error-class",
      );
      // HttpError, ValidationError
      expect(customErrors.length).toBe(2);
    });

    it("detects assertNever pattern", () => {
      const assertNever = observations.filter(
        (o) => o.type === "error-handling.assert-never",
      );
      expect(assertNever.length).toBe(1);
    });

    it("detects exhaustive switch (switch with default calling assertNever)", () => {
      const exhaustive = observations.filter(
        (o) => o.type === "error-handling.exhaustive-switch" && o.value === true,
      );
      expect(exhaustive.length).toBe(1);
    });

    it("sets correct category on all observations", () => {
      observations.forEach((o) => {
        expect(o.category).toBe("error-handling");
      });
    });
  });

  describe("Python", () => {
    const parsed = loadFixture("error-handling-sample.py", "python");
    const observations = extractor.extract(parsed);

    it("counts try/except statements", () => {
      const tryCatch = observations.filter(
        (o) => o.type === "error-handling.try-catch",
      );
      expect(tryCatch.length).toBe(2);
    });

    it("detects specific except clauses", () => {
      const specific = observations.filter(
        (o) => o.type === "error-handling.catch-specificity" && o.value === "specific",
      );
      expect(specific.length).toBeGreaterThanOrEqual(1);
    });

    it("detects generic except clauses (bare Exception)", () => {
      const generic = observations.filter(
        (o) => o.type === "error-handling.catch-specificity" && o.value === "generic",
      );
      expect(generic.length).toBeGreaterThanOrEqual(1);
    });

    it("detects custom exception classes", () => {
      const customErrors = observations.filter(
        (o) => o.type === "error-handling.custom-error-class",
      );
      expect(customErrors.length).toBe(2);
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/src/__tests__/error-handling` -- expect failures.

### Step 6: Implement error-handling extractor

**`packages/analyzer/src/extractors/error-handling.ts`**:

```ts
import type Parser from "tree-sitter";
import type { Extractor, ParsedFile, Observation } from "./types.js";

const RESULT_TYPE_NAMES = new Set([
  "Result", "Either", "Ok", "Err", "Success", "Failure",
]);

const GENERIC_CATCH_TYPES = new Set([
  "Error", "Exception", "unknown",
]);

export class ErrorHandlingExtractor implements Extractor {
  readonly name = "error-handling";

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
    // try/catch (TS) or try/except (Python)
    if (node.type === "try_statement") {
      this.emit(observations, "error-handling.try-catch", true, file, node);
      this.analyzeCatchClauses(node, file, observations);
    }

    // Custom error classes: class X extends Error
    if (
      node.type === "class_declaration" ||
      node.type === "class_definition"
    ) {
      this.detectCustomErrorClass(node, file, observations);
    }

    // Result type usage (TypeScript type aliases)
    if (
      node.type === "type_alias_declaration" &&
      (file.language === "typescript" || file.language === "tsx")
    ) {
      this.detectResultType(node, file, observations);
    }

    // Return type annotations containing Result
    if (
      node.type === "function_declaration" ||
      node.type === "method_definition"
    ) {
      this.detectResultReturnType(node, file, observations);
    }

    // assertNever function detection
    if (node.type === "function_declaration") {
      this.detectAssertNever(node, file, observations);
    }

    // Switch statements: check for exhaustiveness
    if (node.type === "switch_statement") {
      this.detectExhaustiveSwitch(node, file, observations);
    }
  }

  private analyzeCatchClauses(
    tryNode: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    for (const child of tryNode.children) {
      if (child.type === "catch_clause") {
        // TypeScript: check for instanceof in catch body
        const body = child.childForFieldName("body");
        if (body && this.hasInstanceofCheck(body)) {
          this.emit(observations, "error-handling.catch-specificity", "specific", file, child);
        } else {
          this.emit(observations, "error-handling.catch-specificity", "generic", file, child);
        }
      }

      // Python: except_clause
      if (child.type === "except_clause") {
        const typeNode = child.children.find(
          (c) => c.type === "identifier" || c.type === "attribute",
        );

        if (typeNode && !GENERIC_CATCH_TYPES.has(typeNode.text)) {
          this.emit(observations, "error-handling.catch-specificity", "specific", file, child);
        } else {
          this.emit(observations, "error-handling.catch-specificity", "generic", file, child);
        }
      }
    }
  }

  private hasInstanceofCheck(body: Parser.SyntaxNode): boolean {
    const text = body.text;
    return text.includes("instanceof");
  }

  private detectCustomErrorClass(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    if (file.language === "python") {
      // Python: class X(Exception) or class X(SomeError)
      const superclasses = node.childForFieldName("superclasses");
      if (!superclasses) return;

      const bases = superclasses.text;
      if (bases.includes("Error") || bases.includes("Exception")) {
        this.emit(observations, "error-handling.custom-error-class", true, file, node);
      }
      return;
    }

    // TypeScript: class X extends Error
    const heritage = node.children.find(
      (c) => c.type === "class_heritage",
    );
    if (!heritage) return;

    const extendsClause = heritage.text;
    if (extendsClause.includes("Error")) {
      this.emit(observations, "error-handling.custom-error-class", true, file, node);
    }
  }

  private detectResultType(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    if (RESULT_TYPE_NAMES.has(nameNode.text)) {
      this.emit(observations, "error-handling.result-type", nameNode.text, file, node);
    }
  }

  private detectResultReturnType(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const returnType = node.childForFieldName("return_type");
    if (!returnType) return;

    const text = returnType.text;
    for (const name of RESULT_TYPE_NAMES) {
      if (text.includes(name)) {
        this.emit(observations, "error-handling.result-type", name, file, node);
        break;
      }
    }
  }

  private detectAssertNever(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const nameNode = node.childForFieldName("name");
    if (!nameNode) return;

    const name = nameNode.text;
    if (name !== "assertNever" && name !== "absurd") return;

    const params = node.childForFieldName("parameters");
    const returnType = node.childForFieldName("return_type");

    const hasNeverParam = params?.text.includes("never") ?? false;
    const returnsNever = returnType?.text.includes("never") ?? false;

    if (hasNeverParam || returnsNever) {
      this.emit(observations, "error-handling.assert-never", true, file, node);
    }
  }

  private detectExhaustiveSwitch(
    node: Parser.SyntaxNode,
    file: ParsedFile,
    observations: Observation[],
  ): void {
    const body = node.childForFieldName("body");
    if (!body) return;

    let defaultCallsAssertNever = false;

    for (const child of body.children) {
      if (child.type === "switch_default") {
        const text = child.text;
        if (text.includes("assertNever") || text.includes("absurd")) {
          defaultCallsAssertNever = true;
        }
      }
    }

    this.emit(
      observations,
      "error-handling.exhaustive-switch",
      defaultCallsAssertNever,
      file,
      node,
    );
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
      category: "error-handling",
      value,
      file: file.filePath,
      line: node.startPosition.row + 1,
    });
  }
}
```

Run: `pnpm test -- packages/analyzer/src/__tests__/error-handling` -- should pass.

### Step 7: Update barrel exports

Add to **`packages/analyzer/src/extractors/index.ts`**:

```ts
export { DocumentationExtractor } from "./documentation.js";
export { ErrorHandlingExtractor } from "./error-handling.js";
```

Add to **`packages/analyzer/src/index.ts`** extractors section:

```ts
export { DocumentationExtractor, ErrorHandlingExtractor } from "./extractors/index.js";
```

### Step 8: Verify and commit

```bash
pnpm typecheck
pnpm test -- packages/analyzer
pnpm build
```

```bash
git add packages/analyzer/src/extractors/documentation.ts \
       packages/analyzer/src/extractors/error-handling.ts \
       packages/analyzer/src/extractors/index.ts \
       packages/analyzer/src/index.ts \
       packages/analyzer/src/__tests__/
git commit -m "Add documentation and error-handling extractors"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer` passes all tests (all extractors + parser + filter + cache)
- [ ] `pnpm typecheck` exits 0
- [ ] Documentation extractor detects JSDoc/docstring presence per declaration
- [ ] Documentation extractor distinguishes public vs private doc coverage
- [ ] Documentation extractor counts inline comments and classifies placement (leading vs trailing)
- [ ] Documentation extractor extracts JSDoc tags (@param, @returns, @throws) and Python doc tags (Args, Returns, Raises)
- [ ] Documentation extractor normalizes @return to @returns and @throw to @throws
- [ ] Documentation extractor skips JSDoc block comments (`/** */`) when counting inline comments
- [ ] Error-handling extractor counts try/catch (try/except) statements
- [ ] Error-handling extractor classifies catch specificity (specific instanceof checks vs generic catch)
- [ ] Error-handling extractor detects Result type declarations and return type annotations
- [ ] Error-handling extractor detects custom error/exception classes (extends Error / Exception)
- [ ] Error-handling extractor detects assertNever pattern (function with `never` param or return)
- [ ] Error-handling extractor detects exhaustive switch statements (default case calling assertNever)
- [ ] Python `except Exception` is classified as `generic`, not `specific`
- [ ] Both extractors work for TypeScript and Python fixtures
- [ ] All observations have the correct category field and 1-based line numbers
- [ ] `pnpm build` produces valid `.d.ts` files for all exported types

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace
2. **Do not skip the verify step** -- run typecheck and tests before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not parse JSDoc content with a full JSDoc parser** -- regex is sufficient for tag detection; we only need to know which tags are present, not their full structured content
5. **Do not classify `catch (e)` with instanceof checks in the body as generic** -- the presence of instanceof in the catch body makes it specific, even though the parameter itself is untyped
6. **Do not detect assertNever by scanning all function calls** -- only detect the assertNever function *declaration* (the pattern definition); switch statements that *call* it are detected separately via exhaustive-switch analysis
7. **Do not treat Python's `except Exception` as specific** -- `Exception` is the base class and catches everything; it should be classified as `generic`
8. **Do not count JSDoc block comments (`/** ... */`) as inline comments** -- they are declaration documentation and are handled by the JSDoc presence detector, not the inline comment counter
