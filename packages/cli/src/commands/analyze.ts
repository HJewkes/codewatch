import * as fs from "node:fs/promises";
import * as path from "node:path";
import chalk from "chalk";
import {
  Aggregator,
  createStyleExtractors,
  parseFile,
  getLanguageFromPath,
  type AggregatedFeature,
  type Extractor,
  type Observation,
} from "@codewatch/analyzer";
import { walkSourceFiles } from "@codewatch/graph";

export interface AnalyzeOptions {
  rootDir: string;
  languages?: string[];
  extractors?: Extractor[];
}

export interface AnalyzeFileSummary {
  total: number;
  byLanguage: Record<string, number>;
}

export interface AnalyzeResult {
  rootDir: string;
  files: AnalyzeFileSummary;
  observations: number;
  durationMs: { parse: number; aggregate: number };
  features: AggregatedFeature[];
  reviewQueue: AggregatedFeature[];
  summary: {
    totalFeatures: number;
    avgConfidence: number;
    featuresNeedingReview: number;
  };
}

const DEFAULT_LANGUAGES = ["typescript", "python"];

export async function runAnalyze(
  options: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const rootDir = path.resolve(options.rootDir);
  const languages = options.languages ?? DEFAULT_LANGUAGES;
  const extractors = options.extractors ?? createStyleExtractors();

  const filePaths = await walkSourceFiles([rootDir], languages);
  const byLanguage: Record<string, number> = {};

  const observations: Observation[] = [];
  const t0 = performance.now();
  for (const filePath of filePaths) {
    const language = getLanguageFromPath(filePath);
    if (!language) continue;
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = await parseFile(content, filePath, language);
    for (const ex of extractors) {
      observations.push(...ex.extract(parsed));
    }
  }
  const tParse = performance.now() - t0;

  const t1 = performance.now();
  const result = new Aggregator().aggregate(observations);
  const tAgg = performance.now() - t1;

  return {
    rootDir,
    files: { total: filePaths.length, byLanguage },
    observations: observations.length,
    durationMs: { parse: tParse, aggregate: tAgg },
    features: [...result.features.values()],
    reviewQueue: result.reviewQueue,
    summary: result.summary,
  };
}

export function formatAnalyzeText(result: AnalyzeResult): string {
  const lines: string[] = [];
  lines.push(chalk.bold.underline(`Analysis: ${result.rootDir}`));
  const langSummary = Object.entries(result.files.byLanguage)
    .map(([lang, n]) => `${n} ${lang}`)
    .join(", ");
  lines.push(
    chalk.dim(
      `${result.files.total} files (${langSummary})  ` +
        `${result.observations} observations  ` +
        `parse ${result.durationMs.parse.toFixed(0)}ms  ` +
        `agg ${result.durationMs.aggregate.toFixed(0)}ms`,
    ),
  );
  lines.push("");

  const sorted = [...result.features].sort(
    (a, b) => b.confidence - a.confidence,
  );

  lines.push(chalk.bold("Top conventions"));
  for (const f of sorted.slice(0, 15)) {
    lines.push(formatFeatureLine(f));
  }

  const review = result.reviewQueue;
  if (review.length > 0) {
    lines.push("");
    lines.push(chalk.bold(`Needs review (${review.length})`));
    for (const f of review.slice(0, 10)) {
      lines.push(formatFeatureLine(f));
    }
  }

  lines.push("");
  lines.push(
    chalk.dim(
      `Total features: ${result.summary.totalFeatures}  ` +
        `Avg confidence: ${(result.summary.avgConfidence * 100).toFixed(0)}%  ` +
        `Need review: ${result.summary.featuresNeedingReview}`,
    ),
  );
  return lines.join("\n");
}

function formatFeatureLine(f: AggregatedFeature): string {
  const conv = formatConvention(f.convention);
  const sev = severityColor(f.severity)(f.severity.padEnd(5));
  const conf = chalk.dim(`${(f.confidence * 100).toFixed(0)}%`);
  return `  ${sev} ${chalk.bold(f.type.padEnd(38))} → ${conv}  ${conf}`;
}

function severityColor(
  severity: "error" | "warn" | "info" | "off",
): (s: string) => string {
  switch (severity) {
    case "error":
      return chalk.red;
    case "warn":
      return chalk.yellow;
    case "info":
      return chalk.blue;
    default:
      return chalk.dim;
  }
}

function formatConvention(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function formatAnalyzeJson(result: AnalyzeResult): string {
  return JSON.stringify(
    {
      rootDir: result.rootDir,
      files: result.files,
      observations: result.observations,
      durationMs: result.durationMs,
      summary: result.summary,
      features: result.features.map((f) => ({
        type: f.type,
        category: f.category,
        convention: f.convention,
        confidence: f.confidence,
        stability: f.stability,
        severity: f.severity,
        needsReview: f.needsReview,
      })),
    },
    null,
    2,
  );
}
