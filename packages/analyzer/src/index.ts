export type {
  IngestConfig,
  CodeCorpus,
  CodeFile,
  ReviewComment,
  PullRequest,
  PullRequestFile,
  IngestMetadata,
} from "@codewatch/core";
export {
  GitHubService,
  shouldIncludeFile,
  getLanguageFromPath,
  FileCache,
} from "@codewatch/core";

// Extractors
export type {
  StyleExtractor,
  Extractor,
  Observation,
  ObservationCategory,
  ParsedFile,
} from "./extractors/types.js";
export { parseFile, getSupportedLanguages } from "@codewatch/core";
export { NamingExtractor } from "./extractors/naming.js";
export { StructureExtractor } from "./extractors/structure.js";
export { ControlFlowExtractor } from "./extractors/control-flow.js";
export { DocumentationExtractor } from "./extractors/documentation.js";
export { ErrorHandlingExtractor } from "./extractors/error-handling.js";
export { FormattingExtractor } from "./extractors/formatting.js";
export { ComplexityExtractor } from "./extractors/complexity.js";
export { IdiomsExtractor } from "./extractors/idioms.js";
export { ReviewVoiceExtractor } from "./extractors/review-voice.js";

export { createStyleExtractors } from "./extractors/factory.js";

// Aggregator
export {
  Aggregator,
  computeConfidence,
  mapSeverity,
  lookupStability,
  type AggregatedFeature,
  type AggregatorConfig,
  type AggregatorResult,
  type FrequencyDistribution,
  type Severity,
  type Stability,
  type StabilityWeights,
  type SeverityThresholds,
} from "./aggregator/aggregator.js";

// Enricher
export {
  Enricher,
  needsAiEnrichment,
  AI_ENRICHED_FEATURES,
  createProvider,
  ClaudeHaikuProvider,
  OllamaProvider,
  type LlmProvider,
  type LlmMessage,
  type LlmResponse,
  type EnrichmentEntry,
  type EnrichmentError,
  type EnrichmentResult,
  type EnricherConfig,
} from "./enricher/enricher.js";
