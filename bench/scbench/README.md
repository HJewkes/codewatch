# SCBench bench harness

Product-side harness for the SCBench pilot. The pilot compares three arms on the same
checkpoints, graded by the official `slop-code eval`:

- **A0**: stock Claude Code.
- **A1a**: A0 plus a handoff note and agent-written tests.
- **A1**: A1a plus codewatch stages.

The harness measures whether codewatch's stages (A1 minus A1a) improve code quality
without costing correctness.

## Rules

- **No benchmark content enters this repo.** Problem text, hidden tests and reference
  solutions stay out of it, as do eval outputs that quote them. Fixtures here are
  synthetic and written by hand.
- **Runs execute from a checkout under `~/projects/_bench/`.** The slop-code-bench runner
  and its problems live only there. This repo provides the harness code that the
  checkout calls.
- **The loop never sees the grader** (design section 3). No stage reads scb-check output,
  and the analysis never writes per-rule scb-check breakdowns.

## analysis/

`analysis/` reads each arm's `slop-code eval` output and A1's per-checkpoint
`stages.json`, then writes the decision table as `report.md` and `report.json`. It contains:

- paired per-checkpoint deltas
- per-problem final checkpoints
- the adopt / iterate / drop verdict
- the gaming checks
- mechanism signals
- erosion and verbosity recomputed with the agent's tests directory excluded

```
cd bench/scbench
python3 -m analysis --a0 <A0 eval dir> --a1a <A1a eval dir> --a1 <A1 eval dir> \
  --out <report dir> [--a0-replicate <A0' eval dir>] [--tests-dir tests]
```

**Why Python:** `slop-code` and `scb-check` are Python tools run through `uv`, and their
output is JSON written by Python. The checkout under `~/projects/_bench/` already has
Python, so the script needs nothing installed. It uses only the standard library.

**Eval format is assumed.** No real eval output has been read yet. Every format
assumption lives in `analysis/inputs.py`, so a fix there corrects the whole script. The
report's parity gap column compares each official metric with a recompute from per-file
rows. A gap above about 0.01 means the assumptions are wrong.

**Tests** use the standard library's `unittest` and run as part of `pnpm test`, which
is also how CI runs them:

```
pnpm test:bench
```
