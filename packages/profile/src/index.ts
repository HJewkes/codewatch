export {
  StyleRuleSchema,
  ExampleSchema,
  StabilitySchema,
  FixabilitySchema,
  ProfileSchema,
  SCHEMA_VERSION,
  DEFAULT_SEVERITY_THRESHOLDS,
  type StyleRule,
  type Stability,
  type Fixability,
  type Profile,
  type SeverityThresholds,
} from "./schema/index.js";

export { readProfile, writeProfile, validateProfile } from "./io.js";

export { migrateProfile, registerMigration } from "./migrations/index.js";
