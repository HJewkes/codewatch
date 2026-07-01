import type { Command } from "commander";
import { formatError } from "../utils/output.js";

function reportError(err: unknown): void {
  console.error(formatError(err instanceof Error ? err.message : String(err)));
}

function asNumber(s: string | undefined): number | undefined {
  return s !== undefined ? Number(s) : undefined;
}

export function registerRenderDiff(graphCmd: Command): void {
  graphCmd
    .command("render-diff")
    .description("Render a two-snapshot diff to a standalone HTML file (added/removed/renamed highlighted)")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .requiredOption("--from <ref-or-id>", "From-side snapshot: numeric id or ref name")
    .requiredOption("--to <ref-or-id>", "To-side snapshot: numeric id or ref name")
    .requiredOption("--out <path>", "Output HTML file")
    .option("--title <string>", "Heading shown in the HTML")
    .option("--subtitle <string>", "Small subheading (default: from→to refs)")
    .option("--size-by <metric>", "Vary node size by this metric")
    .option("--color-by <metric>", "Heat-map node fill by this metric")
    .action(
      async (options: {
        db: string;
        from: string;
        to: string;
        out: string;
        title?: string;
        subtitle?: string;
        sizeBy?: string;
        colorBy?: string;
      }) => {
        try {
          const { runGraphRenderDiffCommand, formatGraphRenderDiffText } =
            await import("./graph-render-diff.js");
          const result = await runGraphRenderDiffCommand(options);
          console.log(formatGraphRenderDiffText(result));
        } catch (err) {
          reportError(err);
          process.exitCode = 1;
        }
      },
    );
}

export function registerRender(graphCmd: Command): void {
  graphCmd
    .command("render")
    .description("Render a graph snapshot to a standalone HTML file")
    .option("--db <path>", "Path to graph.db", "./.codewatch/graph.db")
    .option("--snapshot <id>", "Snapshot id (default: latest)")
    .requiredOption("--out <path>", "Output HTML file")
    .option("--title <string>", "Heading shown in the HTML")
    .option("--subtitle <string>", "Small subheading")
    .option("--size-by <metric>", "Vary node size by this metric")
    .option("--color-by <metric>", "Heat-map node fill by this metric")
    .option(
      "--check <path>",
      "Run rule checks (rules JSON) and overlay violations on the rendered map",
    )
    .option(
      "--baseline <ref-or-id>",
      "Mark violations also present in this baseline as carryover (used with --check)",
    )
    .action(
      async (options: {
        db: string;
        snapshot?: string;
        out: string;
        title?: string;
        subtitle?: string;
        sizeBy?: string;
        colorBy?: string;
        check?: string;
        baseline?: string;
      }) => {
        try {
          const { runGraphRenderCommand, formatGraphRenderText } =
            await import("./graph-render.js");
          const result = await runGraphRenderCommand({
            db: options.db,
            snapshot: asNumber(options.snapshot),
            out: options.out,
            title: options.title,
            subtitle: options.subtitle,
            sizeBy: options.sizeBy,
            colorBy: options.colorBy,
            check: options.check,
            baseline: options.baseline,
          });
          console.log(formatGraphRenderText(result));
        } catch (err) {
          reportError(err);
          process.exitCode = 1;
        }
      },
    );
}
