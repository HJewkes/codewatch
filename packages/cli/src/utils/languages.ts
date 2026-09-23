// Keys the parser's file filter recognises; anything else admits zero files.
const FILTER_LANGUAGES = ["typescript", "python"] as const;

export type FilterLanguage = (typeof FILTER_LANGUAGES)[number];

export const DEFAULT_LANGUAGES: FilterLanguage[] = ["typescript"];

const ALIASES: Record<string, FilterLanguage> = {
  typescript: "typescript",
  ts: "typescript",
  tsx: "typescript",
  python: "python",
  py: "python",
};

export const LANGUAGE_OPTION_HELP = `Languages to analyze (${FILTER_LANGUAGES.join(
  ", ",
)}; aliases: ts, tsx, py)`;

export function resolveLanguages(input?: string[]): FilterLanguage[] {
  if (!input || input.length === 0) return [...DEFAULT_LANGUAGES];
  return [...new Set(input.map(resolveOne))];
}

function resolveOne(value: string): FilterLanguage {
  const resolved = ALIASES[value.trim().toLowerCase()];
  if (resolved) return resolved;
  throw new Error(
    `Unknown language "${value}". Accepted values: ${Object.keys(ALIASES).join(", ")}.`,
  );
}
