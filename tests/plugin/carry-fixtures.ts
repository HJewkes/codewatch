import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures")

export const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8")

/** Writes the head files and one unmerged fragment of each kind under `<root>/.codewatch`. */
export function writeCarryFiles(root: string): void {
  const dir = join(root, ".codewatch")
  mkdirSync(join(dir, "taste.d"), { recursive: true })
  mkdirSync(join(dir, "verdicts.d"), { recursive: true })
  writeFileSync(join(dir, "taste.md"), fixture("taste.md"))
  writeFileSync(join(dir, "taste.d", "cp-2.md"), fixture("taste-fragment.md"))
  writeFileSync(join(dir, "verdicts.jsonl"), fixture("verdicts.jsonl"))
  writeFileSync(join(dir, "verdicts.d", "cp-2.jsonl"), fixture("verdicts-fragment.jsonl"))
  writeFileSync(join(dir, "session-brief.json"), fixture("session-brief.json"))
}
