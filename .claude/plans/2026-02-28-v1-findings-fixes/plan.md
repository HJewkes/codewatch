# Diagnostic v1 Findings Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Fix all pre-run diagnostic findings — aggregation bugs, skill export signal quality, test hardening, runner rewrite, prompt refinement, and assembler fixes.

**Architecture:** Seven fix areas mapped to 10 tasks. Fix 1 (aggregation) must complete first since it changes expected-profile.json which cascades to test thresholds. Fixes 2, 3, 5 are independent. Fix 4 (runner) depends on Fix 5 (prompts). Fix 6 (assembler) is independent. Fix 7 (findings update) is last.

**Tech Stack:** TypeScript, vitest, Handlebars templates, tsx (new dev dep), web-tree-sitter

## Dependency Graph

```
Task 1: Import order observation + stability map fix
Task 2: Regenerate expected profile script  ─────────────┐
  └─> Task 3: Regenerate expected profile + drift test   │
                                                          │
Task 4: Skill export tiering + humanization               │
Task 5: Skill export idioms/antipatterns/fixability        │
                                                          │
Task 6: Test hardening (depends on Task 3)  <─────────────┘
Task 7: Prompt refinement
  └─> Task 8: Runner rewrite in TypeScript
Task 9: Assembler fixes
Task 10: Update findings document (last)
```

## Wave Plan

- **Wave 1** (parallel): Task 1, Task 4, Task 5, Task 7
- **Wave 2** (depends on Task 1): Task 2, Task 3
- **Wave 3** (depends on Tasks 3, 5, 7): Task 6, Task 8, Task 9
- **Wave 4** (depends on all): Task 10

## Tasks

| # | Name | Files | Wave | Depends On |
|---|------|-------|------|------------|
| 1 | Import order observation + stability map | `structure.ts`, `stability.ts`, `structure.test.ts` | 1 | — |
| 2 | Regenerate expected profile script | `scripts/regenerate-expected-profile.ts` | 2 | Task 1 |
| 3 | Run regeneration + drift test | `expected-profile.json`, `stability.test.ts` | 2 | Task 1, Task 2 |
| 4 | Skill export tiering + humanization | `template-helpers.ts`, `skill.ts`, `skill.md.hbs`, `per-language.md.hbs`, skill tests | 1 | — |
| 5 | Skill export idioms/fixability/examples | `skill.ts`, `skill.md.hbs`, `naming.md.hbs`, `patterns.md.hbs`, `per-language.md.hbs` | 1 | — |
| 6 | Test hardening | `full-pipeline.test.ts`, `roundtrip.test.ts`, `eslint-config.test.ts` | 3 | Task 3 |
| 7 | Prompt refinement | `D-01.md`, `D-04.md`, `D-05.md`, `D-12.md`, `D-13.md`, `judge.md` | 1 | — |
| 8 | Runner rewrite in TypeScript | `run.ts`, `run.sh` (delete), `package.json` | 3 | Task 7 |
| 9 | Assembler fixes | `assemble.ts` | 3 | — |
| 10 | Update findings document | `docs/diagnostic/v1/findings.md` | 4 | All |

Detailed task specs: `./briefings/task-NN.md`
