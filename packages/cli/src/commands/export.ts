import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExportFormat } from "@codewatch/profile";
import { formatSuccess } from "../utils/output.js";

export interface ExportCommandOptions {
  format: ExportFormat;
  outputDir?: string;
  profile?: string;
}

export async function runExport(options: ExportCommandOptions): Promise<void> {
  const { readProfile, exportProfile } = await import("@codewatch/profile");
  const { getDefaultProfilePath } = await import("../utils/config.js");

  const profilePath = options.profile ?? getDefaultProfilePath();
  const profile = await readProfile(profilePath);
  const outputDir = options.outputDir ?? process.cwd();

  const files = exportProfile(profile, options.format);

  for (const file of files) {
    const outputPath = path.join(outputDir, file.path);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, file.content);
    console.log(formatSuccess(`Wrote ${file.path}`));
  }

  console.log(formatSuccess(`Exported ${files.length} file(s) in ${options.format} format`));
}
