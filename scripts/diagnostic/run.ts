import { exec, execFile } from "node:child_process"
import {
  readFile,
  mkdir,
  readdir,
  writeFile,
} from "node:fs/promises"
import { join, resolve, dirname } from "node:path"
import { parseArgs } from "node:util"
import { promisify } from "node:util"
import { fileURLToPath } from "node:url"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(__dirname, "../..")

async function runClaude(prompt: string, outputFile: string, timeoutMs: number): Promise<string> {
  // Write prompt to temp file to avoid shell escaping issues
  const promptFile = outputFile + ".prompt.tmp"
  await writeFile(promptFile, prompt, "utf-8")

  const cmd = [
    "env -u CLAUDECODE",
    "claude -p",
    "--model sonnet",
    "--output-format json",
    "--permission-mode bypassPermissions",
    "--no-session-persistence",
    `"$(cat ${JSON.stringify(promptFile)})"`,
  ].join(" ")

  try {
    const { stdout } = await execAsync(cmd, {
      cwd: PROJECT_DIR,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout
  } finally {
    await import("node:fs/promises").then(fs => fs.rm(promptFile, { force: true })).catch(() => {})
  }
}

interface RunConfig {
  version: string
  profilePath: string
  concurrency: number
  skipCheck: boolean
  skipJudge: boolean
  dryRun: boolean
}

function parseCliArgs(): RunConfig {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: "string", default: "scripts/diagnostic/fixtures/test-profile.json" },
      concurrency: { type: "string", default: "3" },
      "skip-check": { type: "boolean", default: false },
      "skip-judge": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  })

  const version = positionals[0]
  if (!version) {
    console.error("Usage: run.ts <version> [--profile <path>] [--concurrency <n>] [--skip-check] [--skip-judge] [--dry-run]")
    process.exit(1)
  }

  return {
    version,
    profilePath: values.profile as string,
    concurrency: Number(values.concurrency),
    skipCheck: values["skip-check"] as boolean,
    skipJudge: values["skip-judge"] as boolean,
    dryRun: values["dry-run"] as boolean,
  }
}

function log(phase: string, message: string): void {
  console.log(`  [${phase}] ${message}`)
}

function logError(phase: string, promptId: string, message: string, filePath?: string): void {
  const parts = [`  [${phase}] ERROR (${promptId})`]
  if (filePath) parts.push(`file=${filePath}`)
  parts.push(message)
  console.error(parts.join(" — "))
}

async function withConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = []
  const executing: Set<Promise<void>> = new Set()

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result)
    })
    const tracked = p.finally(() => executing.delete(tracked))
    executing.add(tracked)
    if (executing.size >= limit) {
      await Promise.race(executing)
    }
  }

  await Promise.all(executing)
  return results
}

function extractTaskDescription(promptContent: string): string {
  const taskMatch = promptContent.match(/## Task\n([\s\S]*?)(?=\n## |\n$|$)/)
  return taskMatch ? taskMatch[1].trim() : ""
}

async function discoverPrompts(promptsDir: string): Promise<string[]> {
  const entries = await readdir(promptsDir)
  return entries
    .filter((f) => /^D-\d+\.md$/.test(f))
    .sort()
}

// ── Phase 1: Setup ──────────────────────────────────────

interface SetupResult {
  skillContent: string
}

async function phaseSetup(config: RunConfig): Promise<SetupResult> {
  console.log("")
  console.log("── Phase 1: Setup ──────────────────────────────────")

  const profileAbs = resolve(PROJECT_DIR, config.profilePath)
  try {
    await readFile(profileAbs, "utf-8")
  } catch {
    console.error(`ERROR: Profile not found at ${config.profilePath}`)
    process.exit(1)
  }

  if (config.dryRun) {
    log("setup", `Would export skill from ${config.profilePath}`)
    return { skillContent: "{{SKILL_CONTENT}}" }
  }

  log("setup", "Exporting skill from profile...")
  const { readProfile, exportProfile } = await import(
    join(PROJECT_DIR, "packages/profile/src/index.js")
  )
  const profile = await readProfile(profileAbs)
  const files: Array<{ path: string; content: string }> = exportProfile(profile, "skill")

  // Build inlined skill content: skill.md first, then references
  const skillFile = files.find((f) => f.path === "skill.md")
  if (!skillFile) {
    console.error("ERROR: Skill export produced no skill.md")
    process.exit(1)
  }

  const parts = [skillFile.content]
  const refs = files.filter((f) => f.path !== "skill.md").sort((a, b) => a.path.localeCompare(b.path))
  for (const ref of refs) {
    parts.push(`\n---\n\n### ${ref.path}\n\n${ref.content}`)
  }
  const skillContent = parts.join("\n")

  log("setup", `Exported ${files.length} skill file(s), inlined ${skillContent.length} chars`)
  log("setup", "Setup complete.")
  return { skillContent }
}

// ── Phase 2: Test Bench ─────────────────────────────────

interface BenchResult {
  promptId: string
  outputFile: string
  outputDir: string
  taskDescription: string
  success: boolean
}

async function phaseTestBench(
  config: RunConfig,
  skillContent: string,
  benchDir: string,
): Promise<BenchResult[]> {
  console.log("")
  console.log(`── Phase 2: Test Bench (${config.concurrency} concurrent) ────────`)

  const promptsDir = join(PROJECT_DIR, "scripts/diagnostic/prompts/test-bench")
  const promptFiles = await discoverPrompts(promptsDir)

  if (promptFiles.length === 0) {
    log("test-bench", "No prompts found.")
    return []
  }

  const tasks = promptFiles.map((file) => async (): Promise<BenchResult> => {
    const promptId = file.replace(".md", "")
    const promptPath = join(promptsDir, file)
    const outputFile = join(benchDir, `${promptId}.json`)
    const outputDir = join(benchDir, `${promptId}-files`)

    await mkdir(outputDir, { recursive: true })

    let promptContent = await readFile(promptPath, "utf-8")
    promptContent = promptContent
      .replaceAll("{{VERSION}}", config.version)
      .replaceAll("{{SKILL_CONTENT}}", skillContent)
      .replaceAll("{{OUTPUT_DIR}}", outputDir)

    const taskDescription = extractTaskDescription(promptContent)

    if (config.dryRun) {
      log("test-bench", `Would run ${promptId}: claude -p --model sonnet`)
      return { promptId, outputFile, outputDir, taskDescription, success: true }
    }

    try {
      const stdout = await runClaude(promptContent, outputFile, 300_000)
      await writeFile(outputFile, stdout, "utf-8")
      log("test-bench", `${promptId} complete`)
      return { promptId, outputFile, outputDir, taskDescription, success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError("test-bench", promptId, message, promptPath)
      return { promptId, outputFile, outputDir, taskDescription, success: false }
    }
  })

  const results = await withConcurrency(tasks, config.concurrency)
  const succeeded = results.filter((r) => r.success).length
  const failed = results.length - succeeded

  log("test-bench", `Complete: ${results.length} prompts, ${failed} failures`)
  return results
}

// ── Phase 3: Code-Style Check ───────────────────────────

async function phaseCheck(
  config: RunConfig,
  benchResults: BenchResult[],
  benchDir: string,
): Promise<void> {
  console.log("")
  console.log("── Phase 3: Code-Style Check ─────────────────────")

  const profileAbs = resolve(PROJECT_DIR, config.profilePath)
  let checked = 0
  let skipped = 0

  for (const result of benchResults) {
    if (!result.success) {
      skipped++
      continue
    }

    const checkFile = join(benchDir, `${result.promptId}-check.json`)

    if (config.dryRun) {
      log("check", `Would check ${result.promptId}`)
      checked++
      continue
    }

    let filesWritten: string[] = []
    try {
      const raw = await readFile(result.outputFile, "utf-8")
      const parsed = JSON.parse(raw)
      let inner = parsed.result ?? JSON.stringify(parsed)
      inner = inner.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "")
      const jsonStart = inner.indexOf("{")
      const jsonEnd = inner.lastIndexOf("}")
      if (jsonStart !== -1 && jsonEnd !== -1) {
        const obj = JSON.parse(inner.slice(jsonStart, jsonEnd + 1))
        if (Array.isArray(obj.files_written)) {
          filesWritten = obj.files_written
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError("check", result.promptId, `Failed to parse result JSON: ${message}`, result.outputFile)
      skipped++
      continue
    }

    if (filesWritten.length === 0) {
      skipped++
      continue
    }

    const absFiles: string[] = []
    for (const relpath of filesWritten) {
      const absPath = join(result.outputDir, relpath)
      try {
        await readFile(absPath)
        absFiles.push(absPath)
      } catch {
        // File listed but not found on disk — skip it
      }
    }

    if (absFiles.length === 0) {
      skipped++
      continue
    }

    log("check", `Checking ${result.promptId}: ${absFiles.length} file(s)`)

    try {
      const { readProfile } = await import(
        join(PROJECT_DIR, "packages/profile/src/index.js")
      )
      const { orchestrate } = await import(
        join(PROJECT_DIR, "packages/checker/src/index.js")
      )
      const profile = await readProfile(profileAbs)
      const checkResult = await orchestrate({
        profile,
        files: absFiles,
        language: "typescript",
      })
      const output = JSON.stringify(
        { diagnostics: checkResult.diagnostics, summary: checkResult.summary },
        null,
        2,
      )
      await writeFile(checkFile, output, "utf-8")
      checked++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError("check", result.promptId, message)
      skipped++
    }
  }

  log("check", `Complete: ${checked} checked, ${skipped} skipped`)
}

// ── Phase 4: Judge Evaluation ───────────────────────────

async function phaseJudge(
  config: RunConfig,
  benchResults: BenchResult[],
  benchDir: string,
): Promise<void> {
  console.log("")
  console.log("── Phase 4: Judge Evaluation ──────────────────────")

  const judgePath = join(PROJECT_DIR, "scripts/diagnostic/prompts/judge.md")
  let judgeTemplate: string
  try {
    judgeTemplate = await readFile(judgePath, "utf-8")
  } catch {
    console.error(`  ERROR: Judge prompt not found at ${judgePath}`)
    return
  }

  const profileAbs = resolve(PROJECT_DIR, config.profilePath)
  let profileJson: string
  try {
    profileJson = await readFile(profileAbs, "utf-8")
  } catch {
    console.error(`  ERROR: Could not read profile at ${profileAbs}`)
    return
  }

  let judged = 0
  let skipped = 0

  const tasks = benchResults.map((result) => async (): Promise<void> => {
    if (!result.success) {
      skipped++
      return
    }

    const judgeFile = join(benchDir, `${result.promptId}-judge.json`)

    if (config.dryRun) {
      log("judge", `Would judge ${result.promptId}`)
      judged++
      return
    }

    let codeContent = ""
    try {
      const entries = await readdir(result.outputDir)
      const codeFiles = entries
        .filter((f) => f.endsWith(".ts") || f.endsWith(".json"))
        .sort()

      for (const f of codeFiles) {
        const content = await readFile(join(result.outputDir, f), "utf-8")
        codeContent += `--- ${f} ---\n${content}\n\n`
      }
    } catch {
      skipped++
      return
    }

    if (!codeContent) {
      skipped++
      return
    }

    const prompt = judgeTemplate
      .replaceAll("{{PROFILE_JSON}}", profileJson)
      .replaceAll("{{CODE_CONTENT}}", codeContent)
      .replaceAll("{{TASK_DESCRIPTION}}", result.taskDescription)

    log("judge", `Judging ${result.promptId}...`)

    try {
      const stdout = await runClaude(prompt, judgeFile, 300_000)
      await writeFile(judgeFile, stdout, "utf-8")
      judged++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError("judge", result.promptId, message)
      skipped++
    }
  })

  await withConcurrency(tasks, config.concurrency)
  log("judge", `Complete: ${judged} judged, ${skipped} skipped`)
}

// ── Phase 5: Assemble ───────────────────────────────────

async function phaseAssemble(config: RunConfig): Promise<void> {
  console.log("")
  console.log("── Phase 5: Assemble Results ──────────────────────")

  if (config.dryRun) {
    log("assemble", `Would run: npx tsx scripts/diagnostic/assemble.ts ${config.version}`)
    return
  }

  try {
    await execFileAsync("npx", [
      "tsx", "scripts/diagnostic/assemble.ts", `${config.version}`,
    ], {
      cwd: PROJECT_DIR,
      timeout: 30_000,
    })
    log("assemble", `Wrote docs/diagnostic/${config.version}/scorecard.md`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logError("assemble", "all", message)
  }
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = parseCliArgs()

  const resultsDir = join(PROJECT_DIR, `docs/diagnostic/${config.version}`)
  const benchDir = join(resultsDir, "test-bench")

  console.log("================================================================")
  console.log(`  Code-Style Diagnostic — ${config.version}`)
  console.log(`  Profile:     ${config.profilePath}`)
  console.log(`  Concurrency: ${config.concurrency}`)
  console.log(`  Skip check:  ${config.skipCheck}`)
  console.log(`  Skip judge:  ${config.skipJudge}`)
  console.log(`  Dry run:     ${config.dryRun}`)
  console.log(`  Results:     ${resultsDir}/`)
  console.log("================================================================")

  await mkdir(benchDir, { recursive: true })

  const { skillContent } = await phaseSetup(config)

  const benchResults = await phaseTestBench(config, skillContent, benchDir)

  if (!config.skipCheck) {
    await phaseCheck(config, benchResults, benchDir)
  }

  if (!config.skipJudge) {
    await phaseJudge(config, benchResults, benchDir)
  }

  await phaseAssemble(config)

  console.log("")
  console.log("================================================================")
  console.log(`  Diagnostic ${config.version} complete`)
  console.log(`  Results:   ${resultsDir}/`)
  console.log(`  Scorecard: ${resultsDir}/scorecard.md`)
  console.log("================================================================")
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
