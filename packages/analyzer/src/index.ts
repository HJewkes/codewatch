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
  StructureExtractor,
  ControlFlowExtractor,
  DocumentationExtractor,
  ErrorHandlingExtractor,
} from "./extractors/index.js";
