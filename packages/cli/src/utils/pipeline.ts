import type { Extractor, Observation, ParsedFile } from "@code-style/analyzer";

export interface ExtractorModule {
  NamingExtractor: new () => Extractor;
  StructureExtractor: new () => Extractor;
  ControlFlowExtractor: new () => Extractor;
  DocumentationExtractor: new () => Extractor;
  ErrorHandlingExtractor: new () => Extractor;
  parseFile: (
    content: string,
    filePath: string,
    language: string,
  ) => Promise<ParsedFile | null>;
  getLanguageFromPath: (filePath: string) => string | null;
}

export function createExtractors(analyzer: ExtractorModule): Extractor[] {
  return [
    new analyzer.NamingExtractor(),
    new analyzer.StructureExtractor(),
    new analyzer.ControlFlowExtractor(),
    new analyzer.DocumentationExtractor(),
    new analyzer.ErrorHandlingExtractor(),
  ];
}

export async function extractFromFiles(
  files: { content: string; path: string; language: string }[],
  extractors: Extractor[],
  parseFn: ExtractorModule["parseFile"],
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
