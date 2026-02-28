# Integration & Diagnostic Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Add three tiers of integration testing — pipeline integration, export validation, and AI diagnostic suite — to validate end-to-end profile accuracy and export correctness.

**Architecture:** Tier 1 (pipeline) and Tier 2 (exports) are vitest integration tests that run with `pnpm test`. They live in `tests/integration/` at the workspace root with their own vitest config. Tier 3 (AI diagnostics) is a shell-based runner with prompt files, an assembler script, and results storage — not part of the CI test suite.

**Tech Stack:** vitest (existing), web-tree-sitter (existing), TypeScript fixtures, bash runner + `claude -p` for Tier 3

## Dependency Graph

```
Task 1: Integration test scaffold
  └─> Task 2: Golden corpus fixtures       ─┐
  └─> Task 3: Export validation fixtures    ─┤
                                              ├─> Task 5: Pipeline integration tests
Task 4: Vitest workspace config             ─┤
                                              └─> Task 6: Export validation tests
                                                    └─> Task 7: Roundtrip test
Task 8: Diagnostic prompt suite (independent)
Task 9: Diagnostic runner + assembler (depends on Task 8)
```

## Wave Plan

- **Wave 1** (parallel): Task 1, Task 4, Task 8
- **Wave 2** (depends on Wave 1): Task 2, Task 3
- **Wave 3** (depends on Wave 2): Task 5, Task 6
- **Wave 4** (depends on Wave 3 + Task 8): Task 7, Task 9

## Tasks

| # | Name | Files | Wave | Depends On |
|---|------|-------|------|------------|
| 1 | Integration test scaffold | `tests/integration/`, dirs only | 1 | — |
| 2 | Golden corpus fixtures | `tests/integration/fixtures/corpus/typescript/*.ts`, `expected-profile.json` | 2 | Task 1 |
| 3 | Export validation fixtures | `tests/integration/fixtures/exports/*` | 2 | Task 1 |
| 4 | Vitest workspace config | `vitest.config.ts`, `tests/integration/vitest.config.ts` | 1 | — |
| 5 | Pipeline integration tests | `tests/integration/pipeline/*.test.ts` | 3 | Task 2, Task 4 |
| 6 | Export validation tests | `tests/integration/exports/*.test.ts` | 3 | Task 3, Task 4 |
| 7 | Roundtrip test | `tests/integration/roundtrip/*.test.ts` | 4 | Task 5, Task 6 |
| 8 | Diagnostic prompt suite | `scripts/diagnostic/prompts/**/*.md` | 1 | — |
| 9 | Diagnostic runner + assembler | `scripts/diagnostic/run.sh`, `scripts/diagnostic/assemble.ts`, `scripts/diagnostic/prompts/*.md` | 4 | Task 8 |

Detailed task specs: `./briefings/task-NN.md`
