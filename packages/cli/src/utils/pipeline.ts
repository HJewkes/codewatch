import type {
  Extractor,
  Observation,
  ParsedFile,
} from "@codewatch/analyzer";

type ParseFn = (
  content: string,
  filePath: string,
  language: string,
) => Promise<ParsedFile | null>;

export async function extractFromFiles(
  files: { content: string; path: string; language: string }[],
  extractors: Extractor[],
  parseFn: ParseFn,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  for (const file of files) {
    const parsed = await parseFn(file.content, file.path, file.language);
    if (!parsed) continue;
    for (const extractor of extractors) {
      observations.push(...extractor.extract(parsed));
    }
  }
  return observations;
}
