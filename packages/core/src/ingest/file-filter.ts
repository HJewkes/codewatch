import * as path from "node:path";

const EXCLUDED_DIRS = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  "__generated__",
  ".git",
  ".claude",
  "coverage",
];

const EXCLUDED_PATTERNS = [
  /\.min\.[jt]sx?$/,
  /\.d\.ts$/,
  /\.map$/,
  /lock\.(json|yaml)$/,
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
];

const LANGUAGE_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx"],
  python: [".py"],
};

export function shouldIncludeFile(
  filePath: string,
  languages: string[],
): boolean {
  const segments = filePath.split("/");
  if (segments.some((s) => EXCLUDED_DIRS.includes(s))) {
    return false;
  }

  if (EXCLUDED_PATTERNS.some((p) => p.test(filePath))) {
    return false;
  }

  const ext = path.extname(filePath);
  const allowedExtensions = languages.flatMap(
    (lang) => LANGUAGE_EXTENSIONS[lang] ?? [],
  );

  return allowedExtensions.includes(ext);
}

export function getLanguageFromPath(filePath: string): string | null {
  const ext = path.extname(filePath);
  for (const [language, extensions] of Object.entries(LANGUAGE_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return language;
    }
  }
  return null;
}
