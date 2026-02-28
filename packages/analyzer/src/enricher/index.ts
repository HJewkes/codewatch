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

export type { AggregatedFeature } from "../aggregator/index.js";

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
