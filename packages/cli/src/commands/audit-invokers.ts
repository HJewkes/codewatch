import { execFileSync } from "node:child_process";
import path from "node:path";

/** A line that runs a script: directly, or through one npm-script hop. */
export interface Invoker {
  file: string;
  line: number;
  /** The package.json `scripts` entry the line is. */
  label?: string;
  /** The npm script a hop line runs. */
  via?: string;
  /** What the invocation passes: the line, plus the npm script's own value for a hop. */
  args: string;
}

export interface InvokerQuery {
  /** Repo-relative path of the script. */
  script: string;
  /** Repo-relative tracked files at head. */
  files: readonly string[];
  readFile: (file: string) => string | undefined;
}

const CONFIG_FILE = /(?:^|\/)(?:package\.json|Makefile)$|\.(?:ya?ml|sh)$/;
const CODE_FILE = /\.(?:py|ts|mts|mjs|cjs|js)$/;
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const JSON_KEY = /^\s*"((?:\\.|[^"\\])*)"\s*:/;
const COMMENT_LINE = /^\s*(?:#|\/\/|\/\*|\*)/;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isScanned = (file: string): boolean => CONFIG_FILE.test(file) || CODE_FILE.test(file);

/** Whether a line runs the script: its path anywhere, its basename as a token in a value or string literal, or `-m <module>`. */
function lineMatcher(script: string): (text: string, file: string) => boolean {
  const token = new RegExp(`(?:^|[^\\w.-])${escape(path.posix.basename(script))}(?![\\w.-])`);
  const module = script.endsWith(".py") ? new RegExp(`-m\\s+${escape(script.slice(0, -3).replaceAll("/", "."))}(?![\\w.])`) : undefined;
  return (text, file) => {
    if (text.includes(script) || module?.test(text)) return true;
    if (CONFIG_FILE.test(file)) return token.test(text);
    return [...text.matchAll(STRING_LITERAL)].some((m) => token.test(m[2]!));
  };
}

function npmScripts(text: string): Record<string, string> {
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    return scripts && typeof scripts === "object" ? (scripts as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The `scripts` entry a package.json line holds, if any. */
function scriptLabel(file: string, text: string, scripts: Readonly<Record<string, string>>): string | undefined {
  const key = path.posix.basename(file) === "package.json" ? JSON_KEY.exec(text)?.[1] : undefined;
  const value = key === undefined ? undefined : scripts[key];
  return typeof value === "string" && text.includes(JSON.stringify(value)) ? key : undefined;
}

function directInvokers(query: InvokerQuery, texts: ReadonlyMap<string, string[]>): Invoker[] {
  const matches = lineMatcher(query.script);
  const out: Invoker[] = [];
  for (const [file, lines] of texts) {
    const scripts = path.posix.basename(file) === "package.json" ? npmScripts(lines.join("\n")) : {};
    lines.forEach((text, i) => {
      if (!matches(text, file)) return;
      const label = scriptLabel(file, text, scripts);
      out.push({ file, line: i + 1, ...(label === undefined ? {} : { label: `"${label}"` }), args: text });
    });
  }
  return out;
}

/** Lines that run an npm script which itself invokes the script; one hop only. */
function hopInvokers(direct: readonly Invoker[], texts: ReadonlyMap<string, string[]>): Invoker[] {
  const seen = new Set(direct.map((i) => `${i.file}:${i.line}`));
  const out: Invoker[] = [];
  for (const entry of direct.filter((i) => i.label !== undefined)) {
    const name = entry.label!.slice(1, -1);
    const runs = new RegExp(`(?:pnpm|yarn|npm run)\\s+(?:run\\s+)?${escape(name)}(?![\\w:.-])`);
    for (const [file, lines] of texts) {
      lines.forEach((text, i) => {
        if (!runs.test(text) || seen.has(`${file}:${i + 1}`)) return;
        seen.add(`${file}:${i + 1}`);
        out.push({ file, line: i + 1, via: name, args: `${text}\n${entry.args}` });
      });
    }
  }
  return out;
}

/** Package scripts, CI and build files, shell scripts and source lines that run `script`; docs and comment lines never count. */
export function findInvokers(query: InvokerQuery): Invoker[] {
  const texts = new Map<string, string[]>();
  for (const file of query.files) {
    const text = file !== query.script && isScanned(file) ? query.readFile(file) : undefined;
    if (text !== undefined) texts.set(file, text.split("\n").map((line) => (COMMENT_LINE.test(line) ? "" : line)));
  }
  const direct = directInvokers(query, texts);
  return [...direct, ...hopInvokers(direct, texts)];
}

/** Repo-relative paths git tracks in the repo at `idRoot`. */
export function trackedFiles(idRoot: string): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: idRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return out.split("\0").filter((f) => f.length > 0);
}
