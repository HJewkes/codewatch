#!/usr/bin/env node
import { Command } from "commander";
import { readProfile, writeProfile } from "@code-style/profile";
import type {
  CodeCorpus,
  Extractor,
  Observation,
} from "@code-style/analyzer";
import { promptForInitOptions, runInitPipeline } from "./commands/init.js";
import { formatProfileText, formatProfileJson } from "./commands/show.js";
import {
  diffAgainstProfile,
  getChangedFiles,
} from "./commands/diff.js";
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

program
  .command("show")
  .description("Pretty-print current style profile")
  .option("--category <name>", "Filter to a single category")
  .option("--json", "Output raw JSON")
  .option("--profile <path>", "Path to profile file")
  .action(async (options) => {
    try {
      const profilePath = options.profile ?? getDefaultProfilePath();
      const profile = await readProfile(profilePath);
      if (options.json) {
        console.log(formatProfileJson(profile, options.category));
      } else {
        console.log(formatProfileText(profile, options.category));
      }
    } catch (err) {
      console.error(
        formatError(err instanceof Error ? err.message : String(err)),
      );
      process.exitCode = 1;
    }
  });

program
  .command("check [paths...]")
  .description("Lint files against your style profile")
  .option("--fix", "Auto-fix safe violations")
  .option("--format <format>", "Output format: text, json, reviewdog", "text")
  .option("--profile <path>", "Path to profile file")
  .option("--language <lang>", "Language to check: typescript, python")
  .action(async (paths: string[], options) => {
    try {
      const { runCheck } = await import("./commands/check.js");
      const { output, exitCode } = await runCheck(paths, {
        fix: options.fix,
        format: options.format,
        profile: options.profile,
        language: options.language,
      });
      console.log(output);
      process.exitCode = exitCode;
    } catch (err) {
      console.error(
        formatError(err instanceof Error ? err.message : String(err)),
      );
      process.exitCode = 1;
    }
  });

program
  .command("diff")
  .description("Check staged/changed files against profile")
  .option("--profile <path>", "Path to profile file")
  .action(async (options) => {
    try {
      const profilePath = options.profile ?? getDefaultProfilePath();
      const profile = await readProfile(profilePath);
      const files = getChangedFiles();
      if (files.length === 0) {
        console.log("No changed files to check.");
        return;
      }
      const analyzer = await import("@code-style/analyzer");
      const extractors: Extractor[] = [
        new analyzer.NamingExtractor(),
        new analyzer.StructureExtractor(),
        new analyzer.ControlFlowExtractor(),
        new analyzer.DocumentationExtractor(),
        new analyzer.ErrorHandlingExtractor(),
      ];
      const observations: Observation[] = [];
      for (const filePath of files) {
        const fs = await import("node:fs/promises");
        const content = await fs.readFile(filePath, "utf-8");
        const lang = analyzer.getLanguageFromPath(filePath);
        if (!lang) continue;
        const parsed = await analyzer.parseFile(content, filePath, lang);
        if (!parsed) continue;
        for (const extractor of extractors) {
          observations.push(...extractor.extract(parsed));
        }
      }
      const result = diffAgainstProfile(profile, observations);

      if (result.deviations.length === 0) {
        console.log(
          `All ${result.summary.total} observations match your profile.`,
        );
        process.exitCode = 0;
        return;
      }

      for (const d of result.deviations) {
        const severity = d.severity.toUpperCase().padEnd(5);
        console.log(
          `${d.file}:${d.line} ${severity} expected ${d.expected}, found ${d.found} [${d.rule}]`,
        );
      }

      console.log(
        `\n${result.summary.deviating} deviation(s) in ${result.summary.total} observations.`,
      );
      process.exitCode = result.deviations.some(
        (d) => d.severity === "error",
      )
        ? 1
        : 0;
    } catch (err) {
      console.error(
        formatError(err instanceof Error ? err.message : String(err)),
      );
      process.exitCode = 1;
    }
  });

program.parse();
