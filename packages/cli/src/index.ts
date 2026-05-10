#!/usr/bin/env node
import { Command } from "commander";
import { readProfile, writeProfile } from "@code-style/profile";
import type {
  CodeCorpus,
  Observation,
} from "@code-style/analyzer";
import { promptForInitOptions, runInitPipeline } from "./commands/init.js";
import { formatProfileText, formatProfileJson } from "./commands/show.js";
import {
  diffAgainstProfile,
  getChangedFiles,
} from "./commands/diff.js";
import { getDefaultProfilePath } from "./utils/config.js";
import { formatError, formatSuccess } from "./utils/output.js";
import { extractFromFiles } from "./utils/pipeline.js";

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
          const extractors = analyzer.createStyleExtractors();
          return extractFromFiles(
            typedCorpus.files.map((f) => ({
              content: f.content,
              path: f.path,
              language: f.language,
            })),
            extractors,
            analyzer.parseFile,
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
      const fs = await import("node:fs/promises");
      const extractors = analyzer.createStyleExtractors();
      const fileInputs: { content: string; path: string; language: string }[] = [];
      for (const filePath of files) {
        const lang = analyzer.getLanguageFromPath(filePath);
        if (!lang) continue;
        const content = await fs.readFile(filePath, "utf-8");
        fileInputs.push({ content, path: filePath, language: lang });
      }
      const observations = await extractFromFiles(
        fileInputs,
        extractors,
        analyzer.parseFile,
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
  .option("--profile <path>", "Path to your profile (default: ~/.code-style/profile.json)")
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

const hookCmd = program
  .command("hook")
  .description("Manage git pre-commit hooks");

hookCmd
  .command("install")
  .description("Install code-style pre-commit hook")
  .action(async () => {
    try {
      const { installHook } = await import("./commands/hook.js");
      await installHook(process.cwd());
      console.log(formatSuccess("Pre-commit hook installed."));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

hookCmd
  .command("remove")
  .description("Remove code-style pre-commit hook")
  .action(async () => {
    try {
      const { removeHook } = await import("./commands/hook.js");
      await removeHook(process.cwd());
      console.log(formatSuccess("Pre-commit hook removed."));
    } catch (err) {
      console.error(formatError(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
    }
  });

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

const graphCmd = program
  .command("graph")
  .description("Code graph commands (index, query, render)");

graphCmd
  .command("index <path>")
  .description("Build a code graph snapshot for a directory")
  .option("--db <path>", "Database path (default: <path>/.codewatch/graph.db)")
  .option("--ref <ref>", "Snapshot ref label", "wd")
  .option("--ts-config <path>", "Path to tsconfig.json for ts-morph")
  .option(
    "--no-detect-renames",
    "Skip git rename detection (no id_alias entries)",
  )
  .option("--json", "Output structured JSON")
  .action(
    async (
      rootDir: string,
      options: {
        db?: string;
        ref?: string;
        tsConfig?: string;
        detectRenames?: boolean;
        json?: boolean;
      },
    ) => {
      try {
        const { runGraphIndexCommand } = await import(
          "./commands/graph-index.js"
        );
        const { output } = await runGraphIndexCommand({
          rootDir,
          dbPath: options.db,
          ref: options.ref,
          tsConfigPath: options.tsConfig,
          detectRenames: options.detectRenames,
          json: options.json,
        });
        console.log(output);
      } catch (err) {
        console.error(
          formatError(err instanceof Error ? err.message : String(err)),
        );
        process.exitCode = 1;
      }
    },
  );

graphCmd
  .command("diff")
  .description("Diff two graph snapshots (added / removed / renamed nodes + edges, metric deltas)")
  .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
  .requiredOption("--from <ref-or-id>", "From-side snapshot: numeric id or ref name")
  .requiredOption("--to <ref-or-id>", "To-side snapshot: numeric id or ref name")
  .option("--json", "Output structured JSON")
  .action(
    async (options: { db: string; from: string; to: string; json?: boolean }) => {
      try {
        const { runGraphDiffCommand, formatGraphDiffText, formatGraphDiffJson } =
          await import("./commands/graph-diff.js");
        const result = await runGraphDiffCommand(options);
        console.log(
          options.json
            ? formatGraphDiffJson(result)
            : formatGraphDiffText(result),
        );
      } catch (err) {
        console.error(
          formatError(err instanceof Error ? err.message : String(err)),
        );
        process.exitCode = 1;
      }
    },
  );

graphCmd
  .command("render-diff")
  .description("Render a two-snapshot diff to a standalone HTML file (added/removed/renamed highlighted)")
  .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
  .requiredOption("--from <ref-or-id>", "From-side snapshot: numeric id or ref name")
  .requiredOption("--to <ref-or-id>", "To-side snapshot: numeric id or ref name")
  .requiredOption("--out <path>", "Output HTML file")
  .option("--title <string>", "Heading shown in the HTML")
  .option("--subtitle <string>", "Small subheading (default: from→to refs)")
  .action(
    async (options: {
      db: string;
      from: string;
      to: string;
      out: string;
      title?: string;
      subtitle?: string;
    }) => {
      try {
        const { runGraphRenderDiffCommand, formatGraphRenderDiffText } =
          await import("./commands/graph-render-diff.js");
        const result = await runGraphRenderDiffCommand(options);
        console.log(formatGraphRenderDiffText(result));
      } catch (err) {
        console.error(
          formatError(err instanceof Error ? err.message : String(err)),
        );
        process.exitCode = 1;
      }
    },
  );

graphCmd
  .command("render")
  .description("Render a graph snapshot to a standalone HTML file")
  .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
  .option("--snapshot <id>", "Snapshot id (default: latest)")
  .requiredOption("--out <path>", "Output HTML file")
  .option("--title <string>", "Heading shown in the HTML")
  .option("--subtitle <string>", "Small subheading")
  .action(
    async (options: {
      db: string;
      snapshot?: string;
      out: string;
      title?: string;
      subtitle?: string;
    }) => {
      try {
        const { runGraphRenderCommand, formatGraphRenderText } = await import(
          "./commands/graph-render.js"
        );
        const result = await runGraphRenderCommand({
          db: options.db,
          snapshot:
            options.snapshot !== undefined ? Number(options.snapshot) : undefined,
          out: options.out,
          title: options.title,
          subtitle: options.subtitle,
        });
        console.log(formatGraphRenderText(result));
      } catch (err) {
        console.error(
          formatError(err instanceof Error ? err.message : String(err)),
        );
        process.exitCode = 1;
      }
    },
  );

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
