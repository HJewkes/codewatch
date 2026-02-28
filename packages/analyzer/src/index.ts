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
  type ObservationCategory,
  type ParsedFile,
  parseFile,
  getSupportedLanguages,
  NamingExtractor,
  StructureExtractor,
  ControlFlowExtractor,
  DocumentationExtractor,
  ErrorHandlingExtractor,
} from "./extractors/index.js";

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
} from "./aggregator/index.js";

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
} from "./enricher/index.js";
