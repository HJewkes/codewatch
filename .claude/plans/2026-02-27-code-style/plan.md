# code-style Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI tool that analyzes GitHub contributions to create a personal coding style profile, with programmatic linting and Claude Code skill export.

**Architecture:** TypeScript pnpm monorepo with 4 packages (profile, analyzer, checker, cli). Tree-sitter is the primary AST engine. Profile schema is the foundation — everything reads/writes it. Pipeline: Ingest (GitHub API) → Extract (tree-sitter) → Aggregate (statistics) → Enrich (Haiku) → Review (interactive CLI).

**Tech Stack:** TypeScript, pnpm workspaces, tree-sitter, octokit, jscpd, zod, commander, @inquirer/prompts, chalk, vitest, tsup

## Dependency Graph

```
Task 1 (scaffold) ──┬──→ Task 3 (ingest)      ──→ Task 9 (aggregator)  ──→ Task 11 (CLI init)
                     │                                                       ↓
Task 2 (schema)  ───┤──→ Task 4 (extract fw)  ──┬→ Task 5 (extractors) ──→ Task 12 (review)
                     │                           ├→ Task 6 (extractors)     ↓
                     │                           ├→ Task 7 (extractors) → Task 13 (show/diff)
                     │                           └→ Task 8 (extractors)     ↓
                     │                                                   Task 10 (enricher)
                     │                                                      ↓
                     └──→ Task 14 (checker) ──→ Task 17 (check cmd)
                     └──→ Task 15 (skill export)
                     └──→ Task 16 (tool export)
                     └──→ Task 18 (update/compare/hook)
```

## Wave Plan

- **Wave 1** (parallel): Task 1, Task 2 — Foundation
- **Wave 2** (parallel, depends on Wave 1): Task 3, Task 4 — Ingest + Extract framework
- **Wave 3** (parallel, depends on Task 4): Task 5, Task 6, Task 7, Task 8 — All extractors
- **Wave 4** (parallel, depends on Wave 3): Task 9, Task 10 — Aggregator + Enricher
- **Wave 5** (sequential, depends on Wave 4): Task 11, Task 12, Task 13 — CLI + Interactive Review
- **Wave 6** (parallel, depends on Wave 5): Task 14, Task 15, Task 16 — Checker + Exports
- **Wave 7** (depends on Wave 6): Task 17, Task 18 — Remaining CLI commands

## Tasks

| # | Name | Files | Wave | Depends On |
|---|------|-------|------|------------|
| 1 | Project scaffolding | Root configs, package stubs | 1 | — |
| 2 | Profile schema | `packages/profile/src/**` | 1 | — |
| 3 | GitHub ingest service | `packages/analyzer/src/ingest/**` | 2 | Task 1 |
| 4 | Extractor framework + naming | `packages/analyzer/src/extractors/**` | 2 | Task 1, Task 2 |
| 5 | Structure + control-flow extractors | `packages/analyzer/src/extractors/**` | 3 | Task 4 |
| 6 | Documentation + error-handling extractors | `packages/analyzer/src/extractors/**` | 3 | Task 4 |
| 7 | Formatting + complexity extractors | `packages/analyzer/src/extractors/**` | 3 | Task 4 |
| 8 | jscpd idiom + review-voice extractors | `packages/analyzer/src/extractors/**` | 3 | Task 4 |
| 9 | Aggregator | `packages/analyzer/src/aggregator/**` | 4 | Wave 3 |
| 10 | AI enricher | `packages/analyzer/src/enricher/**` | 4 | Wave 3 |
| 11 | CLI framework + init command | `packages/cli/src/**` | 5 | Task 9, Task 10 |
| 12 | Interactive review session | `packages/cli/src/interactive/**` | 5 | Task 11 |
| 13 | show + diff commands | `packages/cli/src/commands/**` | 5 | Task 11 |
| 14 | Checker orchestration | `packages/checker/src/**` | 6 | Task 2 |
| 15 | Skill + Claude rules + hooks export | `packages/profile/src/exporters/**` | 6 | Task 2 |
| 16 | ESLint + Ruff + misc exports | `packages/profile/src/exporters/**` | 6 | Task 2 |
| 17 | check command | `packages/cli/src/commands/check.ts` | 7 | Task 14 |
| 18 | update + compare + hook commands | `packages/cli/src/commands/**` | 7 | Task 11 |

Detailed task specs: `./briefings/task-NN.md`
