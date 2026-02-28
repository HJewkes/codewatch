# Task 08: jscpd Idiom + Review-Voice Extractors

## Architectural Context

This task adds two specialized extractors to the Wave 3 set. The **idiom extractor** uses jscpd's programmatic TypeScript API (Rabin-Karp token-based clone detection) to find repeated code patterns that represent habitual idioms -- recurring structural shapes a developer gravitates toward. Unlike other extractors that analyze individual AST nodes, this one operates on tokenized code fragments across multiple files, looking for patterns that appear 3+ times. The **review-voice extractor** analyzes PR review comment text (plain strings, not code) using regex-based topic categorization and keyword frequency analysis to understand what the developer flags in code reviews.

Both implement the `Extractor` interface from task-04. Idiom features map to Category 9 (Habitual Idioms) in the taxonomy -- 5 features, mostly heuristic. Review-voice features map to Category 10 (Review Voice) -- 4 features, split between heuristic extract and AI-enriched synthesis. This task handles only the heuristic extraction; the AI synthesis belongs to task-10 (AI enricher).

## File Ownership

**May modify:**
- `/packages/analyzer/src/extractors/idioms.ts` (NEW)
- `/packages/analyzer/src/extractors/review-voice.ts` (NEW)
- `/packages/analyzer/tests/extractors/idioms.test.ts` (NEW)
- `/packages/analyzer/tests/extractors/review-voice.test.ts` (NEW)
- `/tests/fixtures/idioms/` (NEW -- all fixture files)
- `/tests/fixtures/review-voice/` (NEW -- all fixture files)
- `/packages/analyzer/package.json` (add jscpd dependency)

**Must not touch:**
- `/packages/analyzer/src/extractors/types.ts` (task-04 owns)
- `/packages/analyzer/src/extractors/base.ts` (task-04 owns)
- `/packages/analyzer/src/extractors/naming.ts` (task-04 owns)
- `/packages/analyzer/src/extractors/index.ts` (task-04 owns)
- `/packages/profile/**`
- `/packages/checker/**`
- `/packages/cli/**`
- `/docs/**`
- `/.claude/**`

**Read for context (do not modify):**
- `/packages/analyzer/src/extractors/types.ts` (Extractor interface, Observation type)
- `/packages/analyzer/src/extractors/naming.ts` (reference extractor implementation)
- `/docs/research/07-unified-feature-taxonomy.md` (Category 9: Habitual Idioms, Category 10: Review Voice)
- `/docs/research/08-tool-pipeline-matrix.md` (jscpd role, review-voice detection method)
- `/docs/plans/2026-02-27-code-style-design.md` (jscpd integration, review voice description)

## Steps

### Step 1: Install jscpd dependency

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm --filter @code-style/analyzer add @jscpd/core @jscpd/tokenizer
```

### Step 2: Create idiom fixture files

**`/tests/fixtures/idioms/repeated-fetch-pattern.ts`**:

```ts
async function getUser(id: string) {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch user:", err);
    throw err;
  }
}

async function getPost(id: string) {
  try {
    const res = await fetch(`/api/posts/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch post:", err);
    throw err;
  }
}

async function getComment(id: string) {
  try {
    const res = await fetch(`/api/comments/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Failed to fetch comment:", err);
    throw err;
  }
}
```

**`/tests/fixtures/idioms/repeated-across-files-a.ts`**:

```ts
export async function fetchUserProfile(userId: string) {
  try {
    const response = await fetch(`/api/profiles/${userId}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch profile:", error);
    throw error;
  }
}
```

**`/tests/fixtures/idioms/repeated-across-files-b.ts`**:

```ts
export async function fetchTeamMembers(teamId: string) {
  try {
    const response = await fetch(`/api/teams/${teamId}/members`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch members:", error);
    throw error;
  }
}
```

**`/tests/fixtures/idioms/no-clones.ts`**:

```ts
function add(a: number, b: number): number {
  return a + b;
}

function greet(name: string): string {
  return `Hello, ${name}!`;
}

function isEven(n: number): boolean {
  return n % 2 === 0;
}
```

### Step 3: Write idiom extractor tests

**`/packages/analyzer/tests/extractors/idioms.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { IdiomsExtractor } from "../../src/extractors/idioms.js";
import type { Observation } from "../../src/extractors/types.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const FIXTURES = resolve(
  import.meta.dirname,
  "../../../../tests/fixtures/idioms",
);

describe("IdiomsExtractor", () => {
  const extractor = new IdiomsExtractor();

  describe("clone detection within a single file", () => {
    it("detects repeated structural patterns across functions", async () => {
      const source = await readFile(
        resolve(FIXTURES, "repeated-fetch-pattern.ts"),
        "utf-8",
      );

      const observations = await extractor.extractFromSources([
        { content: source, path: "repeated-fetch-pattern.ts", language: "typescript" },
      ]);

      const idiomObs = observations.filter(
        (o) => o.type === "idiom.clone",
      );

      expect(idiomObs.length).toBeGreaterThan(0);
      for (const obs of idiomObs) {
        expect(obs.value).toBeDefined();
        expect(obs.metadata?.frequency).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("clone detection across multiple files", () => {
    it("detects idioms repeated across different files", async () => {
      const fileA = await readFile(
        resolve(FIXTURES, "repeated-across-files-a.ts"),
        "utf-8",
      );
      const fileB = await readFile(
        resolve(FIXTURES, "repeated-across-files-b.ts"),
        "utf-8",
      );

      const observations = await extractor.extractFromSources([
        { content: fileA, path: "file-a.ts", language: "typescript" },
        { content: fileB, path: "file-b.ts", language: "typescript" },
      ]);

      const idiomObs = observations.filter(
        (o) => o.type === "idiom.clone",
      );

      expect(idiomObs.length).toBeGreaterThan(0);
    });
  });

  describe("no clones", () => {
    it("returns no clones for unique functions", async () => {
      const source = await readFile(
        resolve(FIXTURES, "no-clones.ts"),
        "utf-8",
      );

      const observations = await extractor.extractFromSources([
        { content: source, path: "no-clones.ts", language: "typescript" },
      ]);

      const idiomObs = observations.filter(
        (o) => o.type === "idiom.clone",
      );
      expect(idiomObs).toHaveLength(0);
    });
  });

  describe("observation format", () => {
    it("includes clone fragment text in metadata", async () => {
      const source = await readFile(
        resolve(FIXTURES, "repeated-fetch-pattern.ts"),
        "utf-8",
      );

      const observations = await extractor.extractFromSources([
        { content: source, path: "repeated-fetch-pattern.ts", language: "typescript" },
      ]);

      const idiomObs = observations.filter(
        (o) => o.type === "idiom.clone",
      );

      if (idiomObs.length > 0) {
        expect(idiomObs[0].metadata?.fragment).toBeDefined();
        expect(typeof idiomObs[0].metadata?.fragment).toBe("string");
      }
    });

    it("includes location information for each clone instance", async () => {
      const source = await readFile(
        resolve(FIXTURES, "repeated-fetch-pattern.ts"),
        "utf-8",
      );

      const observations = await extractor.extractFromSources([
        { content: source, path: "repeated-fetch-pattern.ts", language: "typescript" },
      ]);

      const idiomObs = observations.filter(
        (o) => o.type === "idiom.clone",
      );

      if (idiomObs.length > 0) {
        expect(idiomObs[0].metadata?.locations).toBeDefined();
        expect(Array.isArray(idiomObs[0].metadata?.locations)).toBe(true);
      }
    });
  });

  describe("Extractor interface", () => {
    it("has correct category", () => {
      expect(extractor.category).toBe("idioms");
    });

    it("implements extract()", () => {
      expect(typeof extractor.extract).toBe("function");
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/extractors/idioms` -- expect failures.

### Step 4: Implement the idioms extractor

**`/packages/analyzer/src/extractors/idioms.ts`**:

```ts
import type { Extractor, Observation, ExtractorContext } from "./types.js";

interface SourceFile {
  content: string;
  path: string;
  language: string;
}

interface CloneInstance {
  sourceFile: string;
  startLine: number;
  endLine: number;
  fragment: string;
}

interface DetectedClone {
  instances: CloneInstance[];
  linesCount: number;
}

export class IdiomsExtractor implements Extractor {
  readonly category = "idioms";

  private minLines: number;
  private minTokens: number;

  constructor(options?: { minLines?: number; minTokens?: number }) {
    this.minLines = options?.minLines ?? 5;
    this.minTokens = options?.minTokens ?? 50;
  }

  async extract(context: ExtractorContext): Promise<Observation[]> {
    const sources = context.files.map((f) => ({
      content: f.content,
      path: f.path,
      language: f.language,
    }));
    return this.extractFromSources(sources);
  }

  async extractFromSources(sources: SourceFile[]): Promise<Observation[]> {
    const observations: Observation[] = [];

    try {
      const clones = await this.detectClones(sources);

      const cloneGroups = this.groupClones(clones);

      for (const [, group] of cloneGroups) {
        const frequency = group.instances.length;
        if (frequency < 2) continue;

        const firstInstance = group.instances[0];

        observations.push({
          type: "idiom.clone",
          value: this.summarizeClone(firstInstance.fragment),
          file: firstInstance.sourceFile,
          line: firstInstance.startLine,
          metadata: {
            frequency,
            fragment: firstInstance.fragment,
            linesCount: group.linesCount,
            locations: group.instances.map((inst) => ({
              file: inst.sourceFile,
              startLine: inst.startLine,
              endLine: inst.endLine,
            })),
          },
        });
      }
    } catch (error) {
      // jscpd may fail on very small inputs or find no clones; that is acceptable
      if (
        error instanceof Error &&
        !error.message.includes("No clones found")
      ) {
        throw error;
      }
    }

    return observations;
  }

  private async detectClones(sources: SourceFile[]): Promise<DetectedClone[]> {
    const jscpdCore = await import("@jscpd/core");
    const { Detector, MemoryStore } = jscpdCore;

    const store = new MemoryStore();
    const detector = new Detector(
      {
        minLines: this.minLines,
        minTokens: this.minTokens,
        output: false,
      },
      store,
    );

    const clones: DetectedClone[] = [];

    for (const source of sources) {
      const format = this.languageToFormat(source.language);
      const detected = await detector.detect(source.content, {
        id: source.path,
        format,
      });

      for (const clone of detected) {
        const lines = source.content.split("\n");
        const fragmentA = lines
          .slice(
            clone.duplicationA.start.line - 1,
            clone.duplicationA.end.line,
          )
          .join("\n");
        const fragmentB = lines
          .slice(
            clone.duplicationB.start.line - 1,
            clone.duplicationB.end.line,
          )
          .join("\n");

        clones.push({
          instances: [
            {
              sourceFile: clone.duplicationA.sourceId,
              startLine: clone.duplicationA.start.line,
              endLine: clone.duplicationA.end.line,
              fragment: fragmentA,
            },
            {
              sourceFile: clone.duplicationB.sourceId,
              startLine: clone.duplicationB.start.line,
              endLine: clone.duplicationB.end.line,
              fragment: fragmentB,
            },
          ],
          linesCount:
            clone.duplicationA.end.line -
            clone.duplicationA.start.line +
            1,
        });
      }
    }

    return clones;
  }

  private languageToFormat(language: string): string {
    const mapping: Record<string, string> = {
      typescript: "typescript",
      javascript: "javascript",
      python: "python",
      tsx: "tsx",
      jsx: "jsx",
    };
    return mapping[language] ?? language;
  }

  private groupClones(
    clones: DetectedClone[],
  ): Map<string, { instances: CloneInstance[]; linesCount: number }> {
    const groups = new Map<
      string,
      { instances: CloneInstance[]; linesCount: number }
    >();

    for (const clone of clones) {
      const key = this.normalizeFragment(clone.instances[0]?.fragment ?? "");

      const existing = groups.get(key);
      if (existing) {
        for (const inst of clone.instances) {
          const alreadyTracked = existing.instances.some(
            (e) =>
              e.sourceFile === inst.sourceFile &&
              e.startLine === inst.startLine,
          );
          if (!alreadyTracked) {
            existing.instances.push(inst);
          }
        }
      } else {
        groups.set(key, {
          instances: [...clone.instances],
          linesCount: clone.linesCount,
        });
      }
    }

    return groups;
  }

  private normalizeFragment(fragment: string): string {
    return fragment.replace(/\s+/g, " ").trim().substring(0, 200);
  }

  private summarizeClone(fragment: string): string {
    const firstLine = fragment.split("\n")[0]?.trim() ?? "";
    if (firstLine.length > 80) {
      return firstLine.substring(0, 77) + "...";
    }
    return firstLine;
  }
}
```

Run: `pnpm test -- packages/analyzer/tests/extractors/idioms` -- tests should pass.

### Step 5: Create review-voice fixture data

**`/tests/fixtures/review-voice/review-comments.json`**:

```json
[
  { "body": "This function name is not descriptive enough. Consider renaming to something that explains the intent.", "file": "src/utils.ts" },
  { "body": "Missing error handling here. What happens if the API call fails?", "file": "src/api.ts" },
  { "body": "This is getting complex. Can we extract this into smaller functions?", "file": "src/processor.ts" },
  { "body": "Nit: inconsistent naming. We use camelCase everywhere else.", "file": "src/helpers.ts" },
  { "body": "This could be more performant. Consider memoizing the result.", "file": "src/compute.ts" },
  { "body": "Good use of early return here!", "file": "src/auth.ts" },
  { "body": "Please add error handling for the edge case where input is null.", "file": "src/parser.ts" },
  { "body": "The naming here is confusing. What does 'x' represent?", "file": "src/math.ts" },
  { "body": "Style: prefer single quotes for consistency.", "file": "src/config.ts" },
  { "body": "This function is too long. Split it up.", "file": "src/handler.ts" },
  { "body": "Performance concern: this will re-render on every state change.", "file": "src/component.tsx" },
  { "body": "Naming: prefer 'isEnabled' over 'enabled' for boolean vars.", "file": "src/flags.ts" }
]
```

### Step 6: Write review-voice extractor tests

**`/packages/analyzer/tests/extractors/review-voice.test.ts`**:

```ts
import { describe, it, expect } from "vitest";
import { ReviewVoiceExtractor } from "../../src/extractors/review-voice.js";
import type { Observation } from "../../src/extractors/types.js";

describe("ReviewVoiceExtractor", () => {
  const extractor = new ReviewVoiceExtractor();

  const sampleComments = [
    { body: "This function name is not descriptive enough.", file: "src/utils.ts" },
    { body: "Missing error handling here. What happens if the API call fails?", file: "src/api.ts" },
    { body: "This is getting complex. Can we extract this into smaller functions?", file: "src/processor.ts" },
    { body: "Nit: inconsistent naming. We use camelCase everywhere else.", file: "src/helpers.ts" },
    { body: "This could be more performant. Consider memoizing.", file: "src/compute.ts" },
    { body: "Please add error handling for null input.", file: "src/parser.ts" },
    { body: "The naming here is confusing.", file: "src/math.ts" },
    { body: "Style: prefer single quotes for consistency.", file: "src/config.ts" },
    { body: "This function is too long. Split it up.", file: "src/handler.ts" },
    { body: "Performance concern: this re-renders on every change.", file: "src/component.tsx" },
    { body: "Naming: prefer isEnabled over enabled for booleans.", file: "src/flags.ts" },
    { body: "Good use of early return pattern here.", file: "src/auth.ts" },
  ];

  describe("topic categorization", () => {
    it("categorizes comments into review topics", () => {
      const observations = extractor.extractFromComments(sampleComments);

      const topicObs = observations.filter(
        (o) => o.type === "reviewVoice.topicFrequency",
      );

      expect(topicObs.length).toBeGreaterThan(0);

      const topics = topicObs.map((o) => o.value);
      expect(topics).toContain("naming");
      expect(topics).toContain("error-handling");
      expect(topics).toContain("complexity");
    });

    it("counts frequency of each topic", () => {
      const observations = extractor.extractFromComments(sampleComments);

      const namingObs = observations.find(
        (o) =>
          o.type === "reviewVoice.topicFrequency" && o.value === "naming",
      );
      expect(namingObs).toBeDefined();
      expect(namingObs!.metadata?.count).toBeGreaterThanOrEqual(3);

      const errorObs = observations.find(
        (o) =>
          o.type === "reviewVoice.topicFrequency" &&
          o.value === "error-handling",
      );
      expect(errorObs).toBeDefined();
      expect(errorObs!.metadata?.count).toBeGreaterThanOrEqual(2);
    });

    it("includes ratio of topic to total comments", () => {
      const observations = extractor.extractFromComments(sampleComments);

      const topicObs = observations.filter(
        (o) => o.type === "reviewVoice.topicFrequency",
      );

      for (const obs of topicObs) {
        expect(obs.metadata?.ratio).toBeGreaterThan(0);
        expect(obs.metadata?.ratio).toBeLessThanOrEqual(1);
        expect(obs.metadata?.total).toBe(sampleComments.length);
      }
    });

    it("includes example comments for each topic", () => {
      const observations = extractor.extractFromComments(sampleComments);

      const topicObs = observations.filter(
        (o) => o.type === "reviewVoice.topicFrequency",
      );

      for (const obs of topicObs) {
        expect(obs.metadata?.examples).toBeDefined();
        expect(Array.isArray(obs.metadata?.examples)).toBe(true);
        expect(obs.metadata?.examples.length).toBeGreaterThan(0);
        expect(obs.metadata?.examples.length).toBeLessThanOrEqual(3);
      }
    });
  });

  describe("keyword extraction", () => {
    it("extracts frequently mentioned keywords", () => {
      const observations = extractor.extractFromComments(sampleComments);

      const keywordObs = observations.filter(
        (o) => o.type === "reviewVoice.keyword",
      );

      expect(keywordObs.length).toBeGreaterThan(0);
      for (const obs of keywordObs) {
        expect(obs.metadata?.count).toBeGreaterThanOrEqual(1);
      }
    });

    it("detects early-return keyword", () => {
      const observations = extractor.extractFromComments(sampleComments);

      const earlyReturn = observations.find(
        (o) => o.type === "reviewVoice.keyword" && o.value === "early-return",
      );
      expect(earlyReturn).toBeDefined();
    });
  });

  describe("edge cases", () => {
    it("handles empty comment list", () => {
      const observations = extractor.extractFromComments([]);
      expect(observations).toEqual([]);
    });

    it("handles comments with no recognizable topics", () => {
      const observations = extractor.extractFromComments([
        { body: "LGTM", file: "src/foo.ts" },
        { body: "Looks good to me!", file: "src/bar.ts" },
      ]);

      const topicObs = observations.filter(
        (o) => o.type === "reviewVoice.topicFrequency",
      );
      expect(topicObs.length).toBeLessThanOrEqual(1);
    });

    it("handles single-word comments gracefully", () => {
      const observations = extractor.extractFromComments([
        { body: "Nit", file: "src/foo.ts" },
      ]);
      // Should not crash
      expect(observations).toBeDefined();
    });
  });

  describe("Extractor interface", () => {
    it("has correct category", () => {
      expect(extractor.category).toBe("reviewVoice");
    });

    it("implements extract()", () => {
      expect(typeof extractor.extract).toBe("function");
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/extractors/review-voice` -- expect failures.

### Step 7: Implement the review-voice extractor

**`/packages/analyzer/src/extractors/review-voice.ts`**:

```ts
import type { Extractor, Observation, ExtractorContext } from "./types.js";

interface ReviewComment {
  body: string;
  file?: string;
}

type ReviewTopic =
  | "naming"
  | "error-handling"
  | "complexity"
  | "style"
  | "performance"
  | "documentation"
  | "testing"
  | "security"
  | "readability"
  | "structure";

interface TopicPattern {
  topic: ReviewTopic;
  patterns: RegExp[];
}

const TOPIC_PATTERNS: TopicPattern[] = [
  {
    topic: "naming",
    patterns: [
      /\bnam(?:e|ing)\b/i,
      /\brenam(?:e|ing)\b/i,
      /\bcamelCase\b/i,
      /\bsnake_case\b/i,
      /\bdescriptive\b/i,
      /\bconfusing\b.*\bname/i,
      /\bname\b.*\bconfusing/i,
      /\bprefer\s+\w+\s+over\b/i,
    ],
  },
  {
    topic: "error-handling",
    patterns: [
      /\berror\s*handl/i,
      /\bmissing\s+error/i,
      /\btry\s*\/?\s*catch\b/i,
      /\bwhat\s+happens\s+if\b/i,
      /\bedge\s*case/i,
      /\bnull\b.*\bhandl/i,
      /\bfails?\b/i,
    ],
  },
  {
    topic: "complexity",
    patterns: [
      /\bcomplex\b/i,
      /\btoo\s+long\b/i,
      /\bsplit\b.*\bup\b/i,
      /\bextract\b.*\bfunction/i,
      /\bsmaller\s+functions?\b/i,
      /\bsimplif/i,
      /\bnesting\b/i,
    ],
  },
  {
    topic: "style",
    patterns: [
      /\bstyle\b/i,
      /\bformat/i,
      /\bconsistenc/i,
      /\bnit\b/i,
      /\bquotes?\b/i,
      /\bsemicolon/i,
      /\bindent/i,
      /\bwhitespace\b/i,
    ],
  },
  {
    topic: "performance",
    patterns: [
      /\bperforman/i,
      /\bmemoiz/i,
      /\bre-?render/i,
      /\boptimiz/i,
      /\bexpensive\b/i,
      /\befficien/i,
      /\bcach/i,
    ],
  },
  {
    topic: "documentation",
    patterns: [
      /\bdoc(?:ument)?/i,
      /\bcomment/i,
      /\bjsdoc\b/i,
      /\bdescri(?:be|ption)\b/i,
      /\bexplain\b/i,
    ],
  },
  {
    topic: "testing",
    patterns: [
      /\btest/i,
      /\bcover(?:age)?\b/i,
      /\bassert/i,
      /\bmock/i,
      /\bspec\b/i,
    ],
  },
  {
    topic: "security",
    patterns: [
      /\bsecur/i,
      /\bvulnerab/i,
      /\bsaniti[zs]/i,
      /\binject/i,
      /\bescap/i,
      /\bxss\b/i,
    ],
  },
  {
    topic: "readability",
    patterns: [
      /\breadab/i,
      /\bclear(?:er)?\b/i,
      /\bearly\s+return/i,
      /\bguard\s+clause/i,
      /\bunderstand/i,
    ],
  },
  {
    topic: "structure",
    patterns: [
      /\bstructur/i,
      /\barchitect/i,
      /\bmodule/i,
      /\bimport/i,
      /\bexport/i,
      /\borganiz/i,
      /\bseparati/i,
    ],
  },
];

const KEYWORD_PATTERNS: Array<{ keyword: string; pattern: RegExp }> = [
  { keyword: "early-return", pattern: /\bearly\s+return\b/i },
  { keyword: "guard-clause", pattern: /\bguard\s+clause\b/i },
  { keyword: "single-responsibility", pattern: /\bsingle\s+responsib/i },
  { keyword: "dry", pattern: /\b(?:DRY|don'?t\s+repeat)\b/i },
  { keyword: "immutability", pattern: /\bimmutab/i },
  { keyword: "type-safety", pattern: /\btype[\s-]*safe/i },
  { keyword: "null-check", pattern: /\bnull\s+check/i },
  { keyword: "magic-number", pattern: /\bmagic\s+number/i },
];

export class ReviewVoiceExtractor implements Extractor {
  readonly category = "reviewVoice";

  async extract(context: ExtractorContext): Promise<Observation[]> {
    const comments = context.reviewComments ?? [];
    return this.extractFromComments(comments);
  }

  extractFromComments(comments: ReviewComment[]): Observation[] {
    if (comments.length === 0) return [];

    const observations: Observation[] = [];

    observations.push(...this.categorizeTopics(comments));
    observations.push(...this.extractKeywords(comments));

    return observations;
  }

  private categorizeTopics(comments: ReviewComment[]): Observation[] {
    const topicCounts = new Map<ReviewTopic, number>();
    const topicExamples = new Map<ReviewTopic, string[]>();

    for (const comment of comments) {
      const matchedTopics = new Set<ReviewTopic>();

      for (const { topic, patterns } of TOPIC_PATTERNS) {
        for (const pattern of patterns) {
          if (pattern.test(comment.body)) {
            matchedTopics.add(topic);
            break;
          }
        }
      }

      for (const topic of matchedTopics) {
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);

        const examples = topicExamples.get(topic) ?? [];
        if (examples.length < 3) {
          examples.push(comment.body);
          topicExamples.set(topic, examples);
        }
      }
    }

    const observations: Observation[] = [];

    for (const [topic, count] of topicCounts) {
      observations.push({
        type: "reviewVoice.topicFrequency",
        value: topic,
        file: "_reviews",
        metadata: {
          count,
          total: comments.length,
          ratio: count / comments.length,
          examples: topicExamples.get(topic) ?? [],
        },
      });
    }

    observations.sort(
      (a, b) => (b.metadata?.count ?? 0) - (a.metadata?.count ?? 0),
    );

    return observations;
  }

  private extractKeywords(comments: ReviewComment[]): Observation[] {
    const keywordCounts = new Map<string, number>();

    for (const comment of comments) {
      for (const { keyword, pattern } of KEYWORD_PATTERNS) {
        if (pattern.test(comment.body)) {
          keywordCounts.set(
            keyword,
            (keywordCounts.get(keyword) ?? 0) + 1,
          );
        }
      }
    }

    const observations: Observation[] = [];

    for (const [keyword, count] of keywordCounts) {
      observations.push({
        type: "reviewVoice.keyword",
        value: keyword,
        file: "_reviews",
        metadata: {
          count,
          total: comments.length,
        },
      });
    }

    return observations;
  }
}
```

Run: `pnpm test -- packages/analyzer/tests/extractors/review-voice` -- tests should pass.

### Step 8: Run all tests and verify

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm test -- packages/analyzer/tests/extractors/idioms.test.ts packages/analyzer/tests/extractors/review-voice.test.ts
pnpm typecheck
```

### Step 9: Commit

```bash
git add packages/analyzer/src/extractors/idioms.ts packages/analyzer/src/extractors/review-voice.ts packages/analyzer/tests/extractors/idioms.test.ts packages/analyzer/tests/extractors/review-voice.test.ts tests/fixtures/idioms/ tests/fixtures/review-voice/ packages/analyzer/package.json
git commit -m "Add jscpd idiom extractor and review-voice extractor for habitual pattern and PR comment analysis"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer/tests/extractors/idioms.test.ts` passes all tests
- [ ] `pnpm test -- packages/analyzer/tests/extractors/review-voice.test.ts` passes all tests
- [ ] `pnpm typecheck` exits 0 with no errors in modified files
- [ ] `IdiomsExtractor` detects repeated code patterns using jscpd programmatic API
- [ ] `IdiomsExtractor` reports clone frequency >= 2 for duplicate structures
- [ ] `IdiomsExtractor` detects idioms across multiple files (not just within one file)
- [ ] `IdiomsExtractor` returns empty results for unique code
- [ ] `IdiomsExtractor` includes fragment text, line locations, and frequency in metadata
- [ ] `ReviewVoiceExtractor` categorizes comments into topics (naming, error-handling, complexity, style, performance, etc.)
- [ ] `ReviewVoiceExtractor` counts frequency per topic with ratio to total
- [ ] `ReviewVoiceExtractor` includes up to 3 example comments per topic
- [ ] `ReviewVoiceExtractor` extracts specific keywords (early-return, guard-clause, etc.)
- [ ] `ReviewVoiceExtractor` handles empty comment lists gracefully
- [ ] Both extractors implement the `Extractor` interface from task-04

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not use the jscpd CLI** -- use the programmatic TypeScript API (`@jscpd/core`) only; CLI adds process overhead and output parsing complexity
5. **Do not use NLP libraries for review-voice** -- regex and keyword frequency are sufficient for the extract stage; LLM-based synthesis (tone, intent clustering, theme summarization) belongs in the AI enricher (task-10)
6. **Do not attempt semantic analysis of review comments** -- topic categorization and keyword counting only; deeper analysis is deferred to the AI enricher
7. **Do not hard-fail when jscpd finds no clones** -- an empty clone set is a valid result for repos with low code duplication
8. **Do not filter idioms by minimum frequency in the extractor** -- emit all clones with frequency >= 2; the aggregator (task-09) handles the 3+ threshold for "habitual idiom" classification
