#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { readProfile, writeProfile } from "@titan-design/style-profile";
import { diffAgainstProfile } from "@titan-design/style-checker";
import type { CodeCorpus } from "@codewatch/core";
import type { Observation } from "@titan-design/style-analyzer";
import { promptForInitOptions, runInitPipeline } from "./commands/init.js";
import { formatProfileText, formatProfileJson } from "./commands/show.js";
import {
  formatSkippedNoParser,
  getChangedFiles,
  selectParseableFiles,
} from "./commands/diff.js";
import { getDefaultProfilePath } from "./utils/config.js";
import { formatError } from "./utils/output.js";
import { extractFromFiles } from "./utils/pipeline.js";
import { registerGraphCommands } from "./commands/graph-cli.js";
import { registerHookCommands } from "./commands/hook-cli.js";

// Read the real version from package.json (one root up from dist/) so
// `codewatch --version` tracks the published package version instead of a
// hand-maintained literal that silently drifts.
const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("codewatch")
  .description(
    "Analyze GitHub contributions to create a personal coding style profile",
  )
  .version(version);

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

      const core = await import("@codewatch/core");
      const parser = await import("@titan-design/code-parser");
      const analyzer = await import("@titan-design/style-analyzer");

      await runInitPipeline({
        githubToken: token,
        repos,
        ingest: async (t, r) => {
          const service = new core.GitHubService({
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
          const extractors = analyzer.createStyleExtractors();
          return extractFromFiles(
            typedCorpus.files.map((f) => ({
              content: f.content,
              path: f.path,
              language: f.language,
            })),
            extractors,
            parser.parseFile,
          );
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
      const { output, exitCode, stderr } = await runCheck(paths, {
        fix: options.fix,
        format: options.format,
        profile: options.profile,
        language: options.language,
      });
      console.log(output);
      if (stderr) console.error(stderr);
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
      const parser = await import("@titan-design/code-parser");
      const analyzer = await import("@titan-design/style-analyzer");
      const fs = await import("node:fs/promises");
      const extractors = analyzer.createStyleExtractors();
      const { parseable, skippedNoParser } = selectParseableFiles(
        files,
        parser.getLanguageFromPath,
      );
      if (skippedNoParser.length > 0) {
        console.error(formatSkippedNoParser(skippedNoParser));
      }
      const fileInputs: { content: string; path: string; language: string }[] = [];
      for (const file of parseable) {
        const content = await fs.readFile(file.path, "utf-8");
        fileInputs.push({ ...file, content });
      }
      const observations = await extractFromFiles(
        fileInputs,
        extractors,
        parser.parseFile,
      );
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

program
  .command("update")
  .description("Re-run analysis and merge with existing profile")
  .option("--repos <repos...>", "Repository slugs (owner/repo)")
  .option("--keep-overrides", "Preserve existing overrides", true)
  .option("--profile <path>", "Path to profile file")
  .option("--github-token <token>", "GitHub personal access token")
  .action(async (options) => {
    try {
      const { runUpdate } = await import("./commands/update.js");
      await runUpdate(options);
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

program
  .command("compare <profilePath>")
  .description("Compare current profile with another profile")
  .option("--profile <path>", "Path to your profile (default: ~/.codewatch/profile.json)")
  .action(async (otherPath: string, options) => {
    try {
      const { compareProfiles, formatComparison } = await import("./commands/compare.js");

      const leftPath = options.profile ?? getDefaultProfilePath();
      const [left, right] = await Promise.all([
        readProfile(leftPath),
        readProfile(otherPath),
      ]);

      const diffs = compareProfiles(left, right);
      console.log(formatComparison(diffs));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

registerHookCommands(program);

program
  .command("export")
  .description("Export profile in different formats")
  .requiredOption("--format <format>", "Export format: skill, claude-rules, hooks, eslint, ruff, editorconfig, markdown")
  .option("--output <dir>", "Output directory (default: current directory)")
  .option("--profile <path>", "Path to profile file")
  .action(async (options) => {
    try {
      const { runExport } = await import("./commands/export.js");
      await runExport({
        format: options.format,
        outputDir: options.output,
        profile: options.profile,
      });
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

registerGraphCommands(program);

program
  .command("analyze <path>")
  .description("Run extraction pipeline against a local directory")
  .option(
    "--lang <langs...>",
    "Languages to analyze (typescript, python)",
  )
  .option("--json", "Output structured JSON")
  .action(async (rootDir: string, options: { lang?: string[]; json?: boolean }) => {
    try {
      const { runAnalyze, formatAnalyzeText, formatAnalyzeJson } = await import(
        "./commands/analyze.js"
      );
      const result = await runAnalyze({
        rootDir,
        languages: options.lang,
      });
      console.log(
        options.json ? formatAnalyzeJson(result) : formatAnalyzeText(result),
      );
    } catch (err) {
      console.error(
        formatError(err instanceof Error ? err.message : String(err)),
      );
      process.exitCode = 1;
    }
  });

program.parse();
