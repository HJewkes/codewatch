"""Render only public development rows and sealed aggregate summaries."""

from regrade.yardstick_metrics import METRICS


def cell(value):
    return "n/a" if value is None else f"{value:.4f}"


def cells(row):
    return " | ".join(cell(row.get(k)) for k in METRICS)


def checkpoint_rows(result):
    lines = ["", "## Development checkpoints: c209-a1a", "",
             "| Problem | CP | Tree | Erosion | Verbosity | Erosion ex-tests | Verbosity ex-tests | CC total | SLOC | CC ex-tests | SLOC ex-tests |",
             "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for row in result["rows"]:
        label = row["problem"].replace("|", "\\|").replace("\n", " ")
        if row["status"] != "ok":
            lines.append(f"| {label} | {row['checkpoint']} | scoring failed | " + "n/a | " * 7 + "n/a |")
            continue
        for kind in ("reference", "seed"):
            value = row[kind]
            tree = f"seed ({row['seed_status']})" if kind == "seed" and value is None else kind
            lines.append(f"| {label} | {row['checkpoint']} | {tree} | {cells(value or {})} |")
    return lines


def suite_section(suite):
    lines = ["", "## Separate c209-suite frozen comparison", "",
             f"Inventory captured {suite['captured_at']}. Frozen checkpoints: "
             f"{suite['frozen_checkpoints']}; matched: {suite['matched_checkpoints']}; "
             f"missing reference: {suite['missing_reference']}; failures: {suite['failures']}.", "",
             "Frozen permitted problems: " + ", ".join(suite["frozen_problems"]) + ".", "",
             "This arm is A1a solve-only. It is not pooled with c209-a1a; overlaps appear in both tables.", "",
             "| Population | Erosion | Verbosity | Erosion ex-tests | Verbosity ex-tests | CC total | SLOC | CC ex-tests | SLOC ex-tests |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for label, field in (("matched reference", "reference_mean"), ("c209-suite", "seed_mean")):
        lines.append(f"| {label} | {cells(suite[field])} |")
    if suite["matched_checkpoints"]:
        delta = {k: suite["seed_mean"][k] - suite["reference_mean"][k] for k in METRICS}
        lines.append(f"| c209-suite minus matched reference | {cells(delta)} |")
    lines += ["", "| Problem | CP | Tree | Erosion | Verbosity | Erosion ex-tests | Verbosity ex-tests | CC total | SLOC | CC ex-tests | SLOC ex-tests |",
              "|---|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for row in suite["rows"]:
        for kind in ("reference", "seed"):
            lines.append(f"| {row['problem']} | {row['checkpoint']} | {kind} | {cells(row.get(kind, {}))} |")
    return lines


def render(result):
    lines = ["# SCBench reference-solution yardstick — C-244", "",
             f"Pinned scb-check {result['scb_check_version']}; split `{result['split']}`. "
             f"Requested {result['requested_checkpoints']} checkpoints across "
             f"{result['catalog_problems']} problems. Failures: {result['failures']}. "
             f"Refused {result['refused_problems']} sealed problems / "
             f"{result['refused_checkpoints']} checkpoints; no sealed scores were computed.", "",
             "Evaluation only; no reference-derived signal is wired into a codewatch stage.", "",
             "Erosion and verbosity use the official pinned check --report --include-all invocation. "
             "Ex-tests means regrade's tests/ directory exclusion. Source lines are scb-check total_loc "
             "(Python SLOC); CC is the sum of its parsed functions' cyclomatic complexity, "
             "not the square-root-SLOC-weighted erosion mass. CC and SLOC populations are cross-checked.", "",
             "## Checkpoint-weighted aggregate means", "",
             "| Population | Checkpoints | Erosion | Verbosity | Erosion ex-tests | Verbosity ex-tests | CC total | SLOC | CC ex-tests | SLOC ex-tests |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for label, group in result["aggregates"].items():
        lines.append(f"| {label} | {group['checkpoints']} | {cells(group['mean'])} |")
    paired = result["aggregates"]["matched_reference"]
    seed = result["aggregates"]["a1a_seed"]
    if paired["checkpoints"]:
        difference = {k: seed["mean"][k] - paired["mean"][k] for k in METRICS}
        lines.append(f"| A1a minus matched reference | {paired['checkpoints']} | {cells(difference)} |")
    lines += ["", "A1a means use only existing c209-a1a snapshots at matching problem/checkpoint keys. "
              "Compare a1a_seed with matched_reference, not the larger reference_dev population. "
              "Absent snapshots are missing coverage, never zero scores.", "",
              "## Supplied leaderboard aggregates", "", "| Board row | Erosion | Verbosity |",
              "|---|---:|---:|"]
    for label, row in result["board"].items():
        lines.append(f"| {label} | {cell(row['erosion'])} | {cell(row['verbosity'])} |")
    lines += ["", "Board figures were supplied in the assignment; Claude figures are approximate. "
              "Its published aggregates lack per-problem rows and may use a different coverage/weighting. "
              "These are descriptive comparisons, not a controlled leaderboard replication or optimality proof."]
    lines += checkpoint_rows(result)
    names = sorted({r["problem"] for r in result["rows"]
                    if r.get("seed_status") in ("ok", "scoring_failed")})
    lines += ["", "Frozen permitted c209-a1a problems: " + ", ".join(names) + "."]
    if "suite" in result:
        lines += suite_section(result["suite"])
    return "\n".join(lines) + "\n"
