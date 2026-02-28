import { input, confirm } from "@inquirer/prompts";
import {
  loadConfig,
  saveConfig,
  getDefaultConfigPath,
  type CliConfig,
} from "../utils/config.js";
import { formatStep, formatSuccess, formatError } from "../utils/output.js";

export interface InitPipelineDeps {
  githubToken: string;
  repos: string[];
  ingest: (token: string, repos: string[]) => Promise<unknown>;
  extract: (corpus: unknown) => Promise<unknown[]>;
  aggregate: (observations: unknown[]) => Promise<unknown>;
  enrich: (aggregated: unknown) => Promise<unknown>;
  review: (enriched: unknown) => Promise<unknown>;
  writeProfile: (filePath: string, profile: unknown) => Promise<void>;
  profilePath: string;
}

export async function runInitPipeline(deps: InitPipelineDeps): Promise<void> {
  const {
    githubToken,
    repos,
    ingest,
    extract,
    aggregate,
    enrich,
    review,
    writeProfile,
    profilePath,
  } = deps;

  console.log(formatStep(1, 6, "Ingesting repositories..."));
  const corpus = await ingest(githubToken, repos);

  console.log(formatStep(2, 6, "Extracting style features..."));
  const observations = await extract(corpus);

  console.log(formatStep(3, 6, "Aggregating patterns..."));
  const aggregated = await aggregate(observations);

  console.log(formatStep(4, 6, "Enriching with AI analysis..."));
  const enriched = await enrich(aggregated);

  console.log(formatStep(5, 6, "Interactive review..."));
  const reviewed = await review(enriched);

  console.log(formatStep(6, 6, "Saving profile..."));
  await writeProfile(profilePath, reviewed);

  console.log(formatSuccess(`Profile saved to ${profilePath}`));
}

export interface InitCommandOptions {
  githubToken?: string;
  repos?: string[];
  since?: string;
  until?: string;
  languages?: string[];
}

export async function promptForInitOptions(
  options: InitCommandOptions,
): Promise<{ token: string; repos: string[] }> {
  const configPath = getDefaultConfigPath();
  const existingConfig = await loadConfig(configPath);

  const token =
    options.githubToken ??
    existingConfig.githubToken ??
    (await input({
      message: "GitHub personal access token:",
      validate: (val) =>
        val.startsWith("ghp_") || val.startsWith("github_pat_")
          ? true
          : "Token must start with ghp_ or github_pat_",
    }));

  const repos =
    options.repos ??
    (existingConfig.defaultRepos.length > 0
      ? existingConfig.defaultRepos
      : (
          await input({
            message:
              "Repository slugs (comma-separated, e.g. owner/repo):",
            validate: (val) =>
              val.split(",").every((r) => r.trim().includes("/"))
                ? true
                : "Each repo must be in owner/repo format",
          })
        )
          .split(",")
          .map((r) => r.trim()));

  const shouldSaveToken = await confirm({
    message: "Save token to config for future use?",
    default: true,
  });

  if (shouldSaveToken) {
    await saveConfig(configPath, {
      githubToken: token,
      defaultRepos: repos,
    });
  }

  return { token, repos };
}
