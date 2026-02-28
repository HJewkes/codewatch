export {
  StyleRuleSchema,
  ExampleSchema,
  StabilitySchema,
  FixabilitySchema,
  ProfileSchema,
  SCHEMA_VERSION,
  DEFAULT_SEVERITY_THRESHOLDS,
  PROFILE_CATEGORIES,
  type StyleRule,
  type Stability,
  type Fixability,
  type Profile,
  type ProfileCategory,
  type SeverityThresholds,
  type Severity,
} from "./schema/index.js";

export { readProfile, writeProfile, validateProfile } from "./io.js";

export { migrateProfile, registerMigration } from "./migrations/index.js";

export {
  type GeneratedFile,
  generateSkillFiles,
  generateClaudeRules,
  generateHooksConfig,
  generateEslintExport,
  generateRuffExport,
  generateMarkdownExport,
  generateEditorConfigExport,
  exportProfile,
  SUPPORTED_FORMATS,
  type ExportFormat,
  extractAllRules,
  getTopRules,
  getRulesByCategory,
  getRulesForCategory,
  detectLanguages,
  type RuleEntry,
  type ExtractedRule,
} from "./exporters/index.js";
