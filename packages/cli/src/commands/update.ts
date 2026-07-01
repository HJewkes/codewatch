import type { Profile, StyleRule } from "@codewatch/profile";

export interface MergeOptions {
  keepOverrides: boolean;
}

function mergeCategory(
  existing: Record<string, StyleRule>,
  incoming: Record<string, StyleRule>,
): Record<string, StyleRule> {
  const merged = { ...existing };

  for (const [key, incomingRule] of Object.entries(incoming)) {
    if (!incomingRule) continue;
    const existingRule = merged[key];
    if (!existingRule) {
      merged[key] = incomingRule;
    } else if (incomingRule.confidence > existingRule.confidence) {
      merged[key] = incomingRule;
    }
  }

  return merged;
}

export function mergeProfiles(
  existing: Profile,
  incoming: Profile,
  options: MergeOptions,
): Profile {
  const uniqueSources = [...new Set([...existing.sources, ...incoming.sources])];

  return {
    ...existing,
    generated: new Date().toISOString().split("T")[0],
    sources: uniqueSources,
    naming: mergeCategory(
      existing.naming as Record<string, StyleRule>,
      incoming.naming as Record<string, StyleRule>,
    ),
    structure: mergeCategory(
      existing.structure as Record<string, StyleRule>,
      incoming.structure as Record<string, StyleRule>,
    ),
    documentation: mergeCategory(
      existing.documentation as Record<string, StyleRule>,
      incoming.documentation as Record<string, StyleRule>,
    ),
    errorHandling: mergeCategory(
      existing.errorHandling as Record<string, StyleRule>,
      incoming.errorHandling as Record<string, StyleRule>,
    ),
    formatting: mergeCategory(
      existing.formatting as Record<string, StyleRule>,
      incoming.formatting as Record<string, StyleRule>,
    ),
    patterns: mergeCategory(
      existing.patterns as Record<string, StyleRule>,
      incoming.patterns as Record<string, StyleRule>,
    ),
    overrides: options.keepOverrides ? existing.overrides : incoming.overrides,
  };
}

export interface UpdateCommandOptions {
  repos?: string[];
  keepOverrides?: boolean;
  profile?: string;
  githubToken?: string;
}

export async function runUpdate(options: UpdateCommandOptions): Promise<void> {
  const { readProfile, writeProfile } = await import("@codewatch/profile");
  const { getDefaultProfilePath, loadConfig, getDefaultConfigPath } = await import("../utils/config.js");
  const { formatStep, formatSuccess } = await import("../utils/output.js");

  const profilePath = options.profile ?? getDefaultProfilePath();
  const existing = await readProfile(profilePath);
  const config = await loadConfig(getDefaultConfigPath());
  const token = options.githubToken ?? config.githubToken;

  if (!token) {
    throw new Error("GitHub token required. Set via --github-token or run codewatch init.");
  }

  const repos = options.repos ?? existing.sources;

  const analyzer = await import("@codewatch/analyzer");
  const { runReviewSession } = await import("../interactive/review.js");

  console.log(formatStep(1, 5, "Ingesting repositories..."));
  const service = new analyzer.GitHubService({
    repos,
    languages: ["ts", "js"],
    githubToken: token,
  });
  const corpus = await service.ingest();

  console.log(formatStep(2, 5, "Extracting style features..."));
  const extractors = [
    new analyzer.NamingExtractor(),
    new analyzer.StructureExtractor(),
    new analyzer.ControlFlowExtractor(),
    new analyzer.DocumentationExtractor(),
    new analyzer.ErrorHandlingExtractor(),
  ] as const;
  const observations: unknown[] = [];
  for (const file of corpus.files) {
    const parsed = await analyzer.parseFile(file.content, file.path, file.language);
    if (!parsed) continue;
    for (const extractor of extractors) {
      observations.push(...extractor.extract(parsed));
    }
  }

  console.log(formatStep(3, 5, "Aggregating patterns..."));
  const aggregator = new analyzer.Aggregator();
  const aggregated = await aggregator.aggregate(observations as Parameters<typeof aggregator.aggregate>[0]);

  console.log(formatStep(4, 5, "Enriching and reviewing..."));
  const reviewed = await runReviewSession(aggregated);
  const incoming = reviewed as Profile;

  console.log(formatStep(5, 5, "Merging profiles..."));
  const merged = mergeProfiles(existing, incoming, {
    keepOverrides: options.keepOverrides ?? true,
  });

  await writeProfile(profilePath, merged);
  console.log(formatSuccess(`Profile updated at ${profilePath}`));
}
