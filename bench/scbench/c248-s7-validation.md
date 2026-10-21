# C-248 S7: the cleanup runner as the A1 fix stage, validated on the C-246 seed set

Status: **done-when not met** (4 of 5 criteria fail; numbers below). The gates and config were not
tuned to pass (that is E4).

## What ran

- Wiring: not switched. The A1 `fix` stage (`agent/claude_code_cw.yaml`, `claude_code_cw.a1.yaml`)
  stays on `remediation/`. The candidate is `python -m runner /workspace ... --apply`, the C-248 S6
  cleanup runner, whose final tree `--apply` writes back over the workspace. It cannot run in the A1
  image yet: the image does not copy `runner/` or `gate/`, the agent does not set `CW_PROBLEM`, and
  the runner's sessions and diffgate need host Docker. With the done-when unmet, the switch is a human
  call.
- Validation: `c239/harness/run_s7.sh` is `run_c246.sh` with the NEW-C session replaced by
  `python -m runner ... --apply` on a copy of frozen cpN, then C-246's scoring unchanged: the C-240 regrade (hidden tests, eval
  mode), the C-241 gates, the C-242 in-loop diff gate and `cleanup_report.py` (the dilution-proof
  numbers). `lanes_s7.sh` drove it on the 22 non-holdout final checkpoints C-246 scored, with up to 4
  seeds at once, a load5 < 28 hold before each seed and each session (`--max-load`), and $1.5 per seed.
  `table_s7.py` builds the table. The C-243 holdout guard ran in every step and refused 0 (the queue
  holds only non-holdout seeds).
- C-246's dilution numbers are recomputed here from frozen cpN against frozen cpN plus C-246's
  `change.diff` (C-246 did not record them).
- Seeds the plan does not name are shown as `a-seedNN` / `s-seedNN`.

## Done when

| # | Criterion | NEW (S7) | C-246 | Result |
|---|---|---|---|---|
| 1 | 0 hidden regressions in eval mode | 1 seed (s-seed03, 1 test: 388 → 387 of 405); 2 of 2 reruns of the regrade on the same head gave 388 → 388 | 0 | FAIL as scored (did not reproduce) |
| 2 | All-gate pass rate ≥ 15/22 | 6/22 | 15/22 | FAIL |
| 3 | Median Δ high-CC mass and Δ total CC at least C-246's | mass −18.0%, total CC +1.5% | mass −17.4%, total CC −6.3% | FAIL (mass passes, total CC fails) |
| 4 | Single-caller growth not positive | +91 total, median +4.5 | −8 total | FAIL |
| 5 | Report shows the dilution-proof numbers | high-CC mass, CC>10 count, max CC, per seed and pooled | | PASS |

## Per seed and pooled

Gates: h hidden, g growth, h helpers, t tests, d in-loop diff gate; ✗ fails, ? unknown. Δ columns are
NEW / C-246. Sessions, no-op and retries are NEW only (C-246 ran one session per seed). Inconclusive
counts the diffgate cases that timed out on either side, per attempt (C-255).

| seed | NEW gates h/g/h/t/d | all-gate NEW / C-246 | Δ total CC % | Δ high-CC mass % | NEW mass·CC>10·max | single-caller Δ | sessions | no-op (accepted) | retries (no-op) | inconclusive | stderr-only rejects | $ NEW / C-246 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a-code_search | hg✗td | False / True | +0.5 / -23.3 | -5.1 / -43.1 | 1525·10·51 → 1448·10·51 | +2 / -4 | 4 | 0 (0) | 1 (0) | 0 | 0 | 0.70 / 1.79 |
| a-seed01 | h✗✗td | False / False | +2.8 / -4.6 | -28.5 / -15.5 | 1564·9·35 → 1118·7·27 | +8 / +0 | 6 | 0 (0) | 0 (0) | 0 | 0 | 0.72 / 0.32 |
| a-seed02 | h✗✗td | False / True | +1.5 / -8.9 | -14.2 / -17.8 | 3931·29·83 → 3373·22·83 | +4 / +0 | 12 | 0 (0) | 1 (0) | 0 | 0 | 1.77 / 0.73 |
| a-log_query | h✗✗td | False / True | +3.2 / -7.1 | -44.2 / -17.6 | 2498·14·83 → 1393·10·52 | +6 / +0 | 9 | 0 (0) | 0 (0) | 0 | 0 | 1.64 / 0.70 |
| a-seed03 | hg✗td | False / False | +0.3 / -7.3 | -2.2 / -19.5 | 1519·9·40 → 1486·9·40 | +1 / +1 | 1 | 0 (0) | 0 (0) | 0 | 0 | 0.12 / 0.61 |
| a-seed04 | h✗✗td | False / True | +4.9 / -27.5 | -34.7 / -40.1 | 1155·5·75 → 755·5·53 | +6 / +0 | 2 | 0 (0) | 0 (0) | 0 | 0 | 0.22 / 0.62 |
| s-seed01 | hg✗td | False / True | +1.7 / -3.0 | -34.0 / -14.8 | 663·8·22 → 438·5·19 | +2 / +0 | 4 | 0 (0) | 0 (0) | 0 | 0 | 0.45 / 0.38 |
| s-seed02 | h✗✗td | False / False | +2.3 / -52.0 | -25.0 / -68.2 | 2177·9·75 → 1632·8·60 | +9 / -4 | 5 | 0 (0) | 0 (0) | 0 | 0 | 0.68 / 3.59 |
| s-dag_execution | hg✗td | False / False | +2.2 / -4.2 | -29.0 / -10.4 | 4014·30·37 → 2849·27·30 | +8 / -2 | 14 | 0 (0) | 0 (0) | 0 | 0 | 1.54 / 0.88 |
| s-database_migration | h✗✗td | False / False | +1.7 / -3.3 | -28.2 / -8.9 | 1670·16·29 → 1199·11·27 | +7 / +1 | 8 | 0 (0) | 1 (0) | 0 | 0 | 1.50 / 0.46 |
| s-seed03 | ✗✗✗td | False / True | +1.7 / -3.7 | -29.5 / -11.8 | 897·12·22 → 633·9·18 | +5 / +0 | 5 | 0 (0) | 0 (0) | 0 | 0 | 0.60 / 0.23 |
| s-env_manager | hg✗td | False / True | +1.1 / -5.2 | -12.0 / -10.7 | 2507·12·56 → 2207·13·53 | +5 / +0 | 5 | 0 (0) | 0 (0) | 0 | 0 | 0.83 / 0.71 |
| s-seed04 | hg✗td | False / False | +1.4 / -14.4 | -17.0 / -23.5 | 1349·8·42 → 1119·7·42 | +3 / -1 | 5 | 0 (0) | 0 (0) | 0 | 0 | 0.61 / 0.47 |
| s-seed05 | hghtd | True / True | +0.0 / -4.2 | +0.0 / -20.4 | 1793·6·73 → 1793·6·73 | +0 / +0 | 2 | 1 (0) | 1 (1) | 0 | 0 | 0.58 / 1.08 |
| s-seed06 | hghtd | True / True | +0.0 / -15.6 | +0.0 / -61.2 | 646·5·31 → 646·5·31 | +0 / +0 | 6 | 3 (0) | 3 (3) | 0 | 0 | 0.96 / 0.85 |
| s-eve_market_tools | hghtd | True / True | +0.0 / -10.5 | +0.0 / -14.6 | 5192·21·79 → 5192·21·79 | +0 / +0 | 9 | 4 (0) | 4 (4) | 0 | 0 | 2.36 / 1.37 |
| s-seed07 | hghtd | True / True | +0.0 / -5.7 | +0.0 / -13.0 | 1677·11·38 → 1677·11·38 | +0 / +0 | 8 | 4 (0) | 4 (4) | 0 | 0 | 1.45 / 0.83 |
| s-seed08 | h✗✗td | False / False | +5.2 / -9.3 | -48.4 / -29.4 | 824·6·49 → 425·6·16 | +9 / +2 | 4 | 0 (0) | 0 (0) | 0 | 0 | 0.59 / 0.36 |
| s-seed09 | hght? | True / True | +0.0 / -3.4 | +0.0 / -11.3 | 604·3·40 → 604·3·40 | +0 / +0 | 2 | 1 (0) | 1 (1) | 0 | 0 | 0.40 / 0.31 |
| s-file_merger | h✗✗td | False / True | +1.6 / -6.4 | -22.4 / -19.1 | 2944·20·62 → 2286·15·62 | +9 / +0 | 11 | 1 (0) | 1 (1) | 23 | 2 | 1.53 / 1.04 |
| s-seed10 | h✗✗td | False / True | +1.5 / -6.1 | -19.0 / -17.3 | 4240·29·61 → 3434·24·54 | +7 / +0 | 13 | 0 (0) | 1 (0) | 0 | 0 | 1.87 / 1.38 |
| s-seed11 | hghtd | True / True | +0.0 / -2.4 | +0.0 / -9.6 | 508·4·26 → 508·4·26 | +0 / -1 | 0 | 0 (0) | 0 (0) | 0 | 0 | 0.00 / 0.37 |

- NEW (S7): runs 22; hidden regressions 1; all-gate pass 6/22; median Δ total CC +1.5%; median Δ high-CC mass -18.0%; median Δ CC>10 count -0.5; median Δ max CC -1.0; single-caller Δ total +91 (median +4.5); gate failures hidden 1, growth 10, helpers 16, tests 0, diff 0; $ total 21.12
- C-246: runs 22; hidden regressions 0; all-gate pass 15/22; median Δ total CC -6.3%; median Δ high-CC mass -17.4%; median Δ CC>10 count -1.0; median Δ max CC -5.0; single-caller Δ total -8 (median +0.0); gate failures hidden 0, growth 0, helpers 3, tests 0, diff 5; $ total 19.08
- sessions (NEW): sessions 135, noop 14, noop_accepts 0, retries 18, noop_retries 14, inconclusive 23, stderr_rejects 2

## Findings

- **The passes are the unchanged trees.** All 6 all-gate passes are seeds where no lane was accepted and
  the final tree equals cpN. Every seed the runner changed fails the helpers gate (16/16), and 10 also
  fail growth.
- **Dilution.** High-CC mass falls about as much as C-246 (median −18.0% vs −17.4%), but total CC rises
  (+1.5%) and single-caller helpers grow by 91. The accepted edits split high-CC functions into
  single-caller helpers. The S4 final gate accepts these (98 of 117 first attempts accepted at T2), while
  the C-241 helpers and growth gates reject the result.
- **The visible gate rejects every lane on 4 seeds (s-eve_market_tools, s-seed05, s-seed06, s-seed07).**
  Their visible suites already fail on the unchanged base in the runner's visible step (checked on one
  seed: 12 failed, 3 errors on frozen cpN), so `visible tests fail` rejects every attempt (25 of 35
  rejects). The gate is absolute, not relative to the base.
- **No-op sessions.** I opened all 135 session run.json files: 14 left the tree unchanged, all of them
  retries (12 on those 4 seeds, 1 on s-file_merger, 1 on s-seed09). The gate accepted 0 no-op sessions.
  `tree_changed` matches `changed_files` in all 135.
- **Diffgate (C-255, not fixed here).** Timeout-inconclusive cases: 23, all on s-file_merger (0 on the
  other 21). Rejects on stderr-only differences: 2, both on s-file_merger. On s-seed09 the replay hung at
  100% CPU three times (wave-3 a1 and a2, and the scoring run on an unchanged tree), so this is the base
  program, not the change. I stopped those containers by name: the two attempts were read as
  diffgate failures, and the scoring d gate is unknown.
- **T3 was never reached** (T1 29, T2 106 attempts), so there was no reviewer spend.

## Cost

- Model: $21.12 in the 22 scored runs (C-246: $19.08). Harness incidents wasted another $3.98: two
  killed or crashed runs of s-database_migration ($1.27, $1.10), s-env_manager scored once and then
  overwritten by a driver rerun ($1.00 + $0.32), and s-seed08 backed out to keep 4 seeds in flight
  ($0.29). Total $25.10.
- Sessions: 135 (C-246: 22).
