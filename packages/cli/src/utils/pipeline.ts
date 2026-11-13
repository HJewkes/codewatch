import { getSupportedLanguages, type GrammarLanguage, type ParsedFile } from "@titan-design/code-parser";
import type { Extractor, Observation } from "@titan-design/style-analyzer";

type ParseFn = (
  content: string,
  filePath: string,
  language: GrammarLanguage,
) => Promise<ParsedFile | null>;

function toGrammarLanguage(language: string): GrammarLanguage {
  const match = getSupportedLanguages().find((l) => l === language);
  if (!match) throw new Error(`Unsupported language: ${language}`);
  return match;
}

export async function extractFromFiles(
  files: { content: string; path: string; language: string }[],
  extractors: Extractor[],
  parseFn: ParseFn,
): Promise<Observation[]> {
  const observations: Observation[] = [];
  for (const file of files) {
    const parsed = await parseFn(file.content, file.path, toGrammarLanguage(file.language));
    if (!parsed) continue;
    for (const extractor of extractors) {
      observations.push(...extractor.extract(parsed));
    }
  }
  return observations;
}
