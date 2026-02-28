# Task 10: AI Enricher

## Architectural Context

The AI enricher is the only pipeline stage that uses LLM tokens. It takes aggregated statistics and representative code samples from the aggregator (task-09) and calls Claude Haiku to generate prose descriptions, synthesize review-voice themes, classify documentation tone, and produce holistic architectural assessments. Only 9 of 85 features (11%) require AI -- everything else is handled programmatically upstream.

The enricher NEVER receives raw source files. Its input is always summarized observations: frequency distributions, dominant patterns, consistency scores, and 3-5 representative code snippets per category. The total token budget is approximately 20K tokens (~2K per category that needs enrichment).

The enricher consists of three files matching the manifest: `index.ts` (orchestration, result types, and barrel export), `prompts.ts` (prompt templates for each enrichment type), and `providers.ts` (LLM provider abstraction with Claude Haiku and Ollama implementations). It supports two providers: Claude Haiku (primary, via direct Anthropic REST API) and Ollama (optional local inference). It must be fully skippable via `--no-ai` flag -- the profile is valid without enrichment, just missing prose descriptions and AI-derived assessments.

## File Ownership

**May modify:**
- `/packages/analyzer/src/enricher/index.ts` (NEW)
- `/packages/analyzer/src/enricher/prompts.ts` (NEW)
- `/packages/analyzer/src/enricher/providers.ts` (NEW)
- `/packages/analyzer/tests/enricher/index.test.ts` (NEW)

**Must not touch:**
- `/packages/profile/**`
- `/packages/cli/**`
- `/packages/checker/**`
- `/packages/analyzer/src/extractors/**`
- `/packages/analyzer/src/aggregator/**`
- `/docs/**`
- `/.claude/**`

**Read for context (do not modify):**
- `/packages/analyzer/src/aggregator/index.ts` (AggregatorResult, AggregatedFeature types)
- `/packages/analyzer/src/aggregator/confidence.ts` (Severity type)
- `/packages/analyzer/src/aggregator/stability.ts` (Stability type)
- `/packages/profile/src/schema/profile.ts` (Profile shape -- enricher output augments this)
- `/docs/research/07-unified-feature-taxonomy.md` (which 9 features need AI: documentation voice/tone, why-vs-what, redundancy; review-voice tone/themes/values; pure function assessment; error boundary architecture; file organization)
- `/docs/plans/2026-02-27-code-style-design.md` (enricher stage description, token budget)

## Steps

### Step 1: Define the prompt templates

The prompts.ts file contains all prompt templates used for AI enrichment, plus the list of feature types that require AI. Each template takes summarized statistics and examples as input -- never raw files.

**`/packages/analyzer/src/enricher/prompts.ts`**:

```ts
export interface PromptInput {
  category: string;
  featureType: string;
  convention: string | number | boolean | string[];
  confidence: number;
  consistency: number;
  examples: string[];
  distribution?: Record<string, number>;
}

export interface PromptTemplate {
  featureTypes: string[];
  system: string;
  buildUserMessage: (input: PromptInput) => string;
  maxTokens: number;
}

export const DESCRIPTION_PROMPT: PromptTemplate = {
  featureTypes: [
    "documentation.voice",
    "documentation.whyVsWhat",
    "documentation.redundancy",
    "patterns.pureFunctions",
    "patterns.explicitVsImplicit",
    "errorHandling.errorBoundary",
    "structure.fileOrganization",
  ],
  system:
    "You are a code style analyst. Given statistical observations about a developer's coding patterns, write a concise, actionable style rule description. Output ONLY the description text (1-3 sentences). Do not include markdown formatting or headers.",
  buildUserMessage: (input: PromptInput) => {
    const lines = [
      `Feature: ${input.featureType}`,
      `Dominant pattern: ${JSON.stringify(input.convention)}`,
      `Confidence: ${(input.confidence * 100).toFixed(0)}%`,
      `Consistency: ${(input.consistency * 100).toFixed(0)}%`,
    ];

    if (input.distribution) {
      lines.push(
        `Distribution: ${JSON.stringify(input.distribution)}`,
      );
    }

    if (input.examples.length > 0) {
      lines.push("", "Representative code samples:");
      for (const example of input.examples.slice(0, 5)) {
        lines.push("```", example, "```");
      }
    }

    lines.push(
      "",
      "Write a concise style rule description for this pattern.",
    );

    return lines.join("\n");
  },
  maxTokens: 300,
};

export const REVIEW_VOICE_PROMPT: PromptTemplate = {
  featureTypes: [
    "reviewVoice.tone",
    "reviewVoice.themes",
    "reviewVoice.values",
  ],
  system:
    "You are analyzing a developer's code review comments to understand their review voice and priorities. Given topic frequencies and example comments, synthesize a brief description of what this developer cares about in code reviews. Output ONLY the synthesis text (2-4 sentences). Do not include markdown formatting or headers.",
  buildUserMessage: (input: PromptInput) => {
    const lines = [
      `Review topic: ${input.featureType}`,
      `Pattern: ${JSON.stringify(input.convention)}`,
    ];

    if (input.distribution) {
      lines.push(
        `Topic frequencies: ${JSON.stringify(input.distribution)}`,
      );
    }

    if (input.examples.length > 0) {
      lines.push("", "Example review comments:");
      for (const example of input.examples.slice(0, 5)) {
        lines.push(`- "${example}"`);
      }
    }

    lines.push(
      "",
      "Synthesize what this developer values in code reviews.",
    );

    return lines.join("\n");
  },
  maxTokens: 400,
};

export const AI_ENRICHED_FEATURES = [
  ...DESCRIPTION_PROMPT.featureTypes,
  ...REVIEW_VOICE_PROMPT.featureTypes,
];

export function getPromptForFeature(
  featureType: string,
): PromptTemplate | null {
  if (DESCRIPTION_PROMPT.featureTypes.includes(featureType)) {
    return DESCRIPTION_PROMPT;
  }
  if (REVIEW_VOICE_PROMPT.featureTypes.includes(featureType)) {
    return REVIEW_VOICE_PROMPT;
  }
  return null;
}

export function needsAiEnrichment(featureType: string): boolean {
  return AI_ENRICHED_FEATURES.includes(featureType);
}
```

### Step 2: Implement the provider abstraction

The providers.ts file defines the LLM provider interface and both implementations. Uses plain `fetch()` for the Anthropic API to avoid a heavy SDK dependency for a small number of API calls.

**`/packages/analyzer/src/enricher/providers.ts`**:

```ts
export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  tokensUsed: number;
}

export interface LlmProvider {
  name: string;
  generate(
    messages: LlmMessage[],
    options: { maxTokens: number },
  ): Promise<LlmResponse>;
}

export class ClaudeHaikuProvider implements LlmProvider {
  readonly name = "claude-haiku";
  private apiKey: string;
  private model: string;

  constructor(options: { apiKey: string; model?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-haiku-4-20250414";
  }

  async generate(
    messages: LlmMessage[],
    options: { maxTokens: number },
  ): Promise<LlmResponse> {
    const systemMessage = messages.find((m) => m.role === "system");
    const userMessages = messages.filter((m) => m.role !== "system");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: options.maxTokens,
        system: systemMessage?.content,
        messages: userMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Claude API error (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    return {
      content: text,
      tokensUsed: data.usage.input_tokens + data.usage.output_tokens,
    };
  }
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;

  constructor(options?: { baseUrl?: string; model?: string }) {
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";
    this.model = options?.model ?? "llama3.2";
  }

  async generate(
    messages: LlmMessage[],
    options: { maxTokens: number },
  ): Promise<LlmResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options: {
          num_predict: options.maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Ollama API error (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      message: { content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    return {
      content: data.message.content,
      tokensUsed: (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0),
    };
  }
}

export function createProvider(
  type: "claude" | "ollama",
  options?: Record<string, string>,
): LlmProvider {
  if (type === "claude") {
    const apiKey = options?.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for Claude provider",
      );
    }
    return new ClaudeHaikuProvider({
      apiKey,
      model: options?.model,
    });
  }

  return new OllamaProvider({
    baseUrl: options?.baseUrl,
    model: options?.model,
  });
}
```

### Step 3: Write enricher tests

All tests mock the LLM provider -- no actual API calls during testing.

**`/packages/analyzer/tests/enricher/index.test.ts`**:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Enricher } from "../../src/enricher/index.js";
import type { LlmProvider, LlmResponse } from "../../src/enricher/providers.js";
import type { AggregatedFeature } from "../../src/aggregator/index.js";

function createMockProvider(
  response: string = "Generated description.",
): LlmProvider {
  return {
    name: "mock",
    generate: vi.fn().mockResolvedValue({
      content: response,
      tokensUsed: 150,
    } satisfies LlmResponse),
  };
}

function makeFeature(
  overrides: Partial<AggregatedFeature> & Pick<AggregatedFeature, "type">,
): AggregatedFeature {
  return {
    category: overrides.type.split(".")[0],
    convention: "some-pattern",
    distribution: {
      values: new Map([["some-pattern", 10]]),
      total: 10,
      dominant: "some-pattern",
      consistency: 1.0,
    },
    confidence: 0.85,
    stability: "high",
    severity: "error",
    needsReview: false,
    examples: [],
    ...overrides,
  };
}

describe("Enricher", () => {
  let mockProvider: LlmProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
  });

  describe("feature filtering", () => {
    it("only enriches features that need AI (9 of 85)", async () => {
      const enricher = new Enricher({ provider: mockProvider });

      const features = new Map<string, AggregatedFeature>([
        ["naming.variables", makeFeature({ type: "naming.variables" })],
        ["documentation.voice", makeFeature({ type: "documentation.voice" })],
        ["formatting.semicolons", makeFeature({ type: "formatting.semicolons" })],
        ["reviewVoice.tone", makeFeature({ type: "reviewVoice.tone" })],
      ]);

      const result = await enricher.enrich(features);

      expect(mockProvider.generate).toHaveBeenCalledTimes(2);
      expect(result.enriched.has("documentation.voice")).toBe(true);
      expect(result.enriched.has("reviewVoice.tone")).toBe(true);
      expect(result.enriched.has("naming.variables")).toBe(false);
      expect(result.enriched.has("formatting.semicolons")).toBe(false);
    });

    it("returns empty enrichments when no features need AI", async () => {
      const enricher = new Enricher({ provider: mockProvider });

      const features = new Map<string, AggregatedFeature>([
        ["naming.variables", makeFeature({ type: "naming.variables" })],
        ["formatting.semicolons", makeFeature({ type: "formatting.semicolons" })],
      ]);

      const result = await enricher.enrich(features);

      expect(mockProvider.generate).not.toHaveBeenCalled();
      expect(result.enriched.size).toBe(0);
    });
  });

  describe("prompt construction", () => {
    it("passes summarized statistics to the prompt, not raw code", async () => {
      const enricher = new Enricher({ provider: mockProvider });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({
            type: "documentation.voice",
            convention: "imperative",
            confidence: 0.72,
            examples: [
              { type: "documentation.voice", value: "imperative", file: "test.ts", line: 1 },
            ],
          }),
        ],
      ]);

      await enricher.enrich(features);

      const generateCall = (mockProvider.generate as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      const messages = generateCall[0];
      const userMessage = messages.find(
        (m: { role: string }) => m.role === "user",
      );

      expect(userMessage.content).toContain("documentation.voice");
      expect(userMessage.content).toContain("imperative");
      expect(userMessage.content).toContain("72%");
    });
  });

  describe("enrichment result", () => {
    it("stores generated description in enrichment map", async () => {
      const mockResponse =
        "Prefers imperative voice in documentation comments.";
      const provider = createMockProvider(mockResponse);
      const enricher = new Enricher({ provider });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
      ]);

      const result = await enricher.enrich(features);

      expect(
        result.enriched.get("documentation.voice")?.description,
      ).toBe(mockResponse);
    });

    it("tracks total tokens used", async () => {
      const enricher = new Enricher({ provider: mockProvider });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
        ["reviewVoice.tone", makeFeature({ type: "reviewVoice.tone" })],
      ]);

      const result = await enricher.enrich(features);

      expect(result.totalTokensUsed).toBe(300);
    });
  });

  describe("error handling", () => {
    it("continues enriching other features when one fails", async () => {
      const failingProvider: LlmProvider = {
        name: "failing",
        generate: vi
          .fn()
          .mockRejectedValueOnce(new Error("API error"))
          .mockResolvedValueOnce({
            content: "Success",
            tokensUsed: 100,
          }),
      };
      const enricher = new Enricher({ provider: failingProvider });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
        ["reviewVoice.tone", makeFeature({ type: "reviewVoice.tone" })],
      ]);

      const result = await enricher.enrich(features);

      expect(result.enriched.has("reviewVoice.tone")).toBe(true);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].featureType).toBe("documentation.voice");
    });

    it("reports all errors without throwing", async () => {
      const failingProvider: LlmProvider = {
        name: "failing",
        generate: vi.fn().mockRejectedValue(new Error("API error")),
      };
      const enricher = new Enricher({ provider: failingProvider });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
      ]);

      const result = await enricher.enrich(features);

      expect(result.errors.length).toBe(1);
      expect(result.enriched.size).toBe(0);
    });
  });

  describe("token budget", () => {
    it("respects per-category token limit in options", async () => {
      const enricher = new Enricher({ provider: mockProvider });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
      ]);

      await enricher.enrich(features);

      const generateCall = (mockProvider.generate as ReturnType<typeof vi.fn>)
        .mock.calls[0];
      const options = generateCall[1];
      expect(options.maxTokens).toBeLessThanOrEqual(400);
    });

    it("stops enriching when total budget is exceeded", async () => {
      const expensiveProvider: LlmProvider = {
        name: "expensive",
        generate: vi.fn().mockResolvedValue({
          content: "Description",
          tokensUsed: 15000,
        }),
      };
      const enricher = new Enricher({
        provider: expensiveProvider,
        totalTokenBudget: 20000,
      });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
        [
          "documentation.whyVsWhat",
          makeFeature({ type: "documentation.whyVsWhat" }),
        ],
        ["reviewVoice.tone", makeFeature({ type: "reviewVoice.tone" })],
      ]);

      const result = await enricher.enrich(features);

      expect(expensiveProvider.generate).toHaveBeenCalledTimes(2);
      expect(result.budgetExceeded).toBe(true);
    });
  });

  describe("skip mode (--no-ai flag)", () => {
    it("returns empty results when disabled", async () => {
      const enricher = new Enricher({
        provider: mockProvider,
        enabled: false,
      });

      const features = new Map<string, AggregatedFeature>([
        [
          "documentation.voice",
          makeFeature({ type: "documentation.voice" }),
        ],
      ]);

      const result = await enricher.enrich(features);

      expect(mockProvider.generate).not.toHaveBeenCalled();
      expect(result.enriched.size).toBe(0);
      expect(result.skipped).toBe(true);
    });
  });
});
```

Run: `pnpm test -- packages/analyzer/tests/enricher` -- expect failures.

### Step 4: Implement the enricher

**`/packages/analyzer/src/enricher/index.ts`**:

```ts
import type { AggregatedFeature } from "../aggregator/index.js";
import type { LlmProvider, LlmMessage } from "./providers.js";
import {
  getPromptForFeature,
  needsAiEnrichment,
  type PromptInput,
} from "./prompts.js";

export { needsAiEnrichment, AI_ENRICHED_FEATURES } from "./prompts.js";
export {
  createProvider,
  ClaudeHaikuProvider,
  OllamaProvider,
  type LlmProvider,
  type LlmMessage,
  type LlmResponse,
} from "./providers.js";

export interface EnrichmentEntry {
  featureType: string;
  description: string;
  tokensUsed: number;
}

export interface EnrichmentError {
  featureType: string;
  error: string;
}

export interface EnrichmentResult {
  enriched: Map<string, EnrichmentEntry>;
  errors: EnrichmentError[];
  totalTokensUsed: number;
  budgetExceeded: boolean;
  skipped: boolean;
}

export interface EnricherConfig {
  provider: LlmProvider;
  enabled?: boolean;
  totalTokenBudget?: number;
}

export class Enricher {
  private provider: LlmProvider;
  private enabled: boolean;
  private totalTokenBudget: number;

  constructor(config: EnricherConfig) {
    this.provider = config.provider;
    this.enabled = config.enabled ?? true;
    this.totalTokenBudget = config.totalTokenBudget ?? 20_000;
  }

  async enrich(
    features: Map<string, AggregatedFeature>,
  ): Promise<EnrichmentResult> {
    if (!this.enabled) {
      return {
        enriched: new Map(),
        errors: [],
        totalTokensUsed: 0,
        budgetExceeded: false,
        skipped: true,
      };
    }

    const enriched = new Map<string, EnrichmentEntry>();
    const errors: EnrichmentError[] = [];
    let totalTokensUsed = 0;
    let budgetExceeded = false;

    const featuresToEnrich = Array.from(features.entries()).filter(
      ([type]) => needsAiEnrichment(type),
    );

    for (const [type, feature] of featuresToEnrich) {
      if (totalTokensUsed >= this.totalTokenBudget) {
        budgetExceeded = true;
        break;
      }

      const promptTemplate = getPromptForFeature(type);
      if (!promptTemplate) continue;

      const input = this.buildPromptInput(type, feature);
      const messages: LlmMessage[] = [
        { role: "system", content: promptTemplate.system },
        {
          role: "user",
          content: promptTemplate.buildUserMessage(input),
        },
      ];

      try {
        const response = await this.provider.generate(messages, {
          maxTokens: promptTemplate.maxTokens,
        });

        enriched.set(type, {
          featureType: type,
          description: response.content,
          tokensUsed: response.tokensUsed,
        });

        totalTokensUsed += response.tokensUsed;
      } catch (error) {
        errors.push({
          featureType: type,
          error:
            error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      enriched,
      errors,
      totalTokensUsed,
      budgetExceeded,
      skipped: false,
    };
  }

  private buildPromptInput(
    type: string,
    feature: AggregatedFeature,
  ): PromptInput {
    const distributionRecord: Record<string, number> = {};
    for (const [key, count] of feature.distribution.values) {
      distributionRecord[String(key)] = count;
    }

    const exampleTexts = feature.examples.map((obs) => {
      if (typeof obs.value === "string") return obs.value;
      return JSON.stringify(obs.value);
    });

    return {
      category: feature.category,
      featureType: type,
      convention: feature.convention,
      confidence: feature.confidence,
      consistency: feature.distribution.consistency,
      examples: exampleTexts,
      distribution: distributionRecord,
    };
  }
}
```

### Step 5: Run tests and verify

```bash
cd /Users/hjewkes/Documents/projects/code-style
pnpm test -- packages/analyzer/tests/enricher/index.test.ts
pnpm typecheck
```

### Step 6: Commit

```bash
git add packages/analyzer/src/enricher/ packages/analyzer/tests/enricher/
git commit -m "Add AI enricher with Claude Haiku and Ollama providers for prose generation on 9 features"
```

## Success Criteria

- [ ] `pnpm test -- packages/analyzer/tests/enricher/index.test.ts` passes all tests
- [ ] `pnpm typecheck` exits 0 with no errors in modified files
- [ ] `Enricher` only calls LLM for the 9 AI-required features (not all 85)
- [ ] `Enricher` passes summarized statistics to prompts, never raw source files
- [ ] `Enricher` continues enriching other features when one LLM call fails
- [ ] `Enricher` tracks and reports total tokens used across all calls
- [ ] `Enricher` stops enriching when total token budget is exceeded and sets `budgetExceeded: true`
- [ ] `Enricher` returns `skipped: true` when `enabled: false` (for `--no-ai` flag)
- [ ] `ClaudeHaikuProvider` correctly calls the Anthropic messages REST API via `fetch()`
- [ ] `OllamaProvider` correctly calls the Ollama chat API via `fetch()`
- [ ] `createProvider("claude")` requires `ANTHROPIC_API_KEY` and throws if missing
- [ ] `prompts.ts` defines separate system prompts for description and review-voice synthesis
- [ ] `needsAiEnrichment()` returns true only for the 9 known AI-required feature types
- [ ] All tests mock the `LlmProvider` interface -- no actual API calls during testing
- [ ] Error collection allows partial enrichment when individual calls fail

## Anti-patterns

### Universal
1. **Do not install packages globally** -- all deps go in the workspace root or specific packages
2. **Do not skip the verify step** -- every file must compile before committing
3. **Do not create files outside the defined file ownership list**

### Task-specific
4. **Do not send raw source files to the LLM** -- input is always summarized statistics (frequency distributions, consistency scores) plus 3-5 representative code snippets; never full file contents
5. **Do not make AI enrichment required** -- the enricher must be fully skippable (`enabled: false`); the profile is valid without it, just missing prose descriptions and AI assessments
6. **Do not make actual API calls in tests** -- mock the `LlmProvider` interface; test the orchestration logic, prompt construction, error handling, and budget tracking
7. **Do not use the Anthropic SDK** -- use plain `fetch()` to the Anthropic messages API; this avoids a heavy dependency for a small number of API calls
8. **Do not exceed the token budget silently** -- when the budget is exceeded, set `budgetExceeded: true` in the result so the CLI can inform the user
9. **Do not throw on individual feature enrichment failure** -- collect errors and continue with remaining features; partial enrichment is better than no enrichment
