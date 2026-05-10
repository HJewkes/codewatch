import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "../packages/analyzer/src/extractors/parser.js";
import { createStyleExtractors } from "../packages/analyzer/src/extractors/factory.js";
import { Aggregator } from "../packages/analyzer/src/aggregator/index.js";
import type { Observation } from "../packages/analyzer/src/extractors/types.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const corpusDir = path.join(projectRoot, "tests/integration/fixtures/corpus/typescript");
const outputPath = path.join(projectRoot, "tests/integration/fixtures/corpus/expected-profile.json");

async function main(): Promise<void> {
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".ts")).sort();
  console.log(`Found ${files.length} corpus files in ${corpusDir}`);

  const extractors = createStyleExtractors();

  const allObservations: Observation[] = [];

  for (const file of files) {
    const filePath = path.join(corpusDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = await parseFile(content, filePath, "typescript");

    for (const extractor of extractors) {
      const observations = extractor.extract(parsed);
      allObservations.push(...observations);
    }
  }

  console.log(`Collected ${allObservations.length} observations from ${files.length} files`);

  const aggregator = new Aggregator();
  const result = aggregator.aggregate(allObservations);

  const profile: Record<string, { convention: string | number | boolean | string[]; confidence: number; severity: string }> = {};
  for (const [type, feature] of result.features) {
    profile[type] = {
      convention: feature.convention,
      confidence: Math.round(feature.confidence * 100) / 100,
      severity: feature.severity,
    };
  }

  let previousProfile: Record<string, { convention: unknown; confidence: number; severity: string }> | null = null;
  if (fs.existsSync(outputPath)) {
    previousProfile = JSON.parse(fs.readFileSync(outputPath, "utf-8"));
  }

  fs.writeFileSync(outputPath, JSON.stringify(profile, null, 2) + "\n", "utf-8");
  console.log(`Wrote ${Object.keys(profile).length} features to ${outputPath}`);

  if (previousProfile) {
    const oldKeys = new Set(Object.keys(previousProfile));
    const newKeys = new Set(Object.keys(profile));

    const added = [...newKeys].filter((k) => !oldKeys.has(k));
    const removed = [...oldKeys].filter((k) => !newKeys.has(k));
    const changed: string[] = [];

    for (const key of newKeys) {
      if (oldKeys.has(key)) {
        const oldEntry = previousProfile[key];
        const newEntry = profile[key];
        if (
          oldEntry.convention !== newEntry.convention ||
          oldEntry.confidence !== newEntry.confidence ||
          oldEntry.severity !== newEntry.severity
        ) {
          changed.push(key);
        }
      }
    }

    if (added.length === 0 && removed.length === 0 && changed.length === 0) {
      console.log("No changes detected.");
    } else {
      if (added.length > 0) console.log(`Added (${added.length}): ${added.join(", ")}`);
      if (removed.length > 0) console.log(`Removed (${removed.length}): ${removed.join(", ")}`);
      if (changed.length > 0) console.log(`Changed (${changed.length}): ${changed.join(", ")}`);
    }
  } else {
    console.log("No previous profile found; created fresh.");
  }
}

main().catch((err) => {
  console.error("Failed to regenerate expected profile:", err);
  process.exit(1);
});
