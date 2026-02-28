import type { Tree } from "web-tree-sitter";
import type { ProfileCategory } from "@code-style/profile";

/**
 * Categories that extractors emit. Includes all ProfileCategory values
 * plus extractor-specific categories that don't map directly to profile sections.
 */
export type ObservationCategory =
  | ProfileCategory
  | "control-flow"
  | "error-handling"
  | "reviewVoice"
  | "idioms"
  | "complexity";

export interface Observation {
  /** Feature type, e.g. "naming.variable", "naming.function" */
  type: string;
  /** Top-level category, e.g. "naming", "structure" */
  category: ObservationCategory;
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
  tree: Tree;
  content: string;
  filePath: string;
  language: string;
}

export interface Extractor {
  name: string;
  extract(file: ParsedFile): Observation[];
}
