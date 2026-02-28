#!/usr/bin/env node
import { Command } from "commander";
import { writeProfile } from "@code-style/profile";
import type {
  CodeCorpus,
  Extractor,
  Observation,
} from "@code-style/analyzer";
import { promptForInitOptions, runInitPipeline } from "./commands/init.js";
import { getDefaultProfilePath } from "./utils/config.js";
import { formatError } from "./utils/output.js";

const program = new Command();

program
  .name("code-style")
  .description(
    "Analyze GitHub contributions to create a personal coding style profile",
  )
  .version("0.0.1");

program
  .command("init")
  .description("Run full analysis pipeline and create your style profile")
  .option("--repos <repos...>", "Repository slugs (owner/repo)")
  .option("--github-token <token>", "GitHub personal access token")
  .option("--since <date>", "Analyze commits since this date")
  .option("--until <date>", "Analyze commits until this date")
  .option("--languages <langs...>", "Languages to analyze (ts, py)")
  .action(async (options) => {
    try {
      const { token, repos } = await promptForInitOptions({
        githubToken: options.githubToken,
        repos: options.repos,
        since: options.since,
        until: options.until,
        languages: options.languages,
      });

      const analyzer = await import("@code-style/analyzer");

      await runInitPipeline({
        githubToken: token,
        repos,
        ingest: async (t, r) => {
          const service = new analyzer.GitHubService({
            repos: r,
            languages: options.languages ?? ["ts", "js"],
            githubToken: t,
            since: options.since,
            until: options.until,
          });
          return service.ingest();
        },
        extract: async (corpus) => {
          const typedCorpus = corpus as CodeCorpus;
          const extractors: Extractor[] = [
            new analyzer.NamingExtractor(),
            new analyzer.StructureExtractor(),
            new analyzer.ControlFlowExtractor(),
            new analyzer.DocumentationExtractor(),
            new analyzer.ErrorHandlingExtractor(),
          ];
          const observations: Observation[] = [];
          for (const file of typedCorpus.files) {
            const parsed = await analyzer.parseFile(
              file.content,
              file.path,
              file.language,
            );
            if (!parsed) continue;
            for (const extractor of extractors) {
              observations.push(...extractor.extract(parsed));
            }
          }
          return observations;
        },
        aggregate: async (observations) => {
          const aggregator = new analyzer.Aggregator();
          return aggregator.aggregate(observations as Observation[]);
        },
        enrich: async (aggregated) => {
          return aggregated;
        },
        review: async (enriched) => {
          return enriched;
        },
        writeProfile: async (filePath, profile) => {
          await writeProfile(filePath, profile);
        },
        profilePath: getDefaultProfilePath(),
      });
    } catch (err) {
      console.error(
        formatError(err instanceof Error ? err.message : String(err)),
      );
      process.exitCode = 1;
    }
  });

program.parse();
