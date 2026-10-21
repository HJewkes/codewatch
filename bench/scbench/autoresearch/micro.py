"""micro.py: the L1 micro rung's pieces behind ar_micro.sh (C-256). No model calls.

  micro.py replay <bench> <run dir>   re-judge every lane a --keep-lanes S7 run recorded with <bench>'s final
                                      gate, config and re-inline rule, on the recorded visible and diffgate
                                      verdicts. A T3 lane gets its recorded verdict back (no reviewer call); a
                                      lane that newly reaches T3 holds. Prints the counts as one JSON line.
  micro.py recorded <bench> <run dir> [task]
                                      the counts as the run recorded them, optionally for one task
                                      (the cluster rung).
  micro.py compare <base> <idea> <signal> <rung> [usd]
                                      ar-micro/v1 from two count lines; <signal> is `<count>:<up|down>`, the
                                      idea's predicted move of one count against the base.
Counts: accepts, rejects, holds, accepted_net_cc (own ΔCC summed over accepted lanes), accepted_new_helpers,
and, for replay, how many lanes changed outcome against the record. No task ids: they name the case.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

def recorded_reviewer(final: dict):
    """A T3 model that answers with the lane's recorded verdict, so replay costs nothing."""
    from synthesis.taste import ModelReply

    def model(prompt: str) -> ModelReply:
        if final.get("tier") != "T3" or final.get("outcome") not in ("accept", "reject"):
            raise RuntimeError("no recorded T3 verdict")
        count = len(re.findall(r"^\d+\. ", prompt.split("Findings:\n", 1)[-1], flags=re.M))
        real = final["outcome"] == "reject"
        reply = {"verdict": final["outcome"], "findings": [{"id": i, "real": real} for i in range(1, count + 1)],
                 "reason": "recorded verdict"}
        return ModelReply(text=json.dumps(reply), tokens=0, usd=0.0)
    return model


def local(cleanup: Path, recorded: str) -> Path:
    return cleanup / recorded.split("/cleanup/")[-1]


def lanes(run: Path) -> list[dict]:
    """Each lane's last attempt with its wave base (the previous wave's tree)."""
    from runner.run import slug
    cleanup = run / "cleanup"
    waves = json.loads((cleanup / "run.json").read_text())["waves"]
    out = []
    for i, wave in enumerate(waves):
        base = cleanup / "base" if i == 0 else local(cleanup, waves[i - 1]["tree"])
        for session in wave["sessions"]:
            lane = cleanup / f"wave{wave['wave']}" / slug(session["task"])
            last = session["attempts"][-1]
            out.append({"task": session["task"], "wave": wave["wave"], "base": base, "lane": lane,
                        "attempt": lane / f"a{last['n']}", "recorded": last["outcome"]})
    return out


def _json(path: Path, missing: dict) -> dict:
    return json.loads(path.read_text()) if path.is_file() else missing


def judge(lane: dict, rows: list[dict]) -> dict:
    from gate.__main__ import find_task
    from gate.gates import final_gate
    from ledger.rules import reinlined
    from planner.families import load_config
    from runner.container import settle_timeouts
    task = find_task(lane["base"], lane["task"], lane["lane"] / "gate" / "plan.json")
    visible = _json(lane["attempt"] / "visible.json", {"pass": False})
    dg = settle_timeouts(_json(lane["attempt"] / "diffgate" / "gate.json", {"pass": False, "error": "no gate.json"}))
    final = _json(lane["attempt"] / "final.json", {})
    result = final_gate(lane["base"], lane["lane"] / "ws", task, load_config(), visible, dg, recorded_reviewer(final))
    earlier = [r for r in rows if r.get("wave", 0) < lane["wave"]]
    outcome = "reject" if reinlined(earlier, result["report"]) else result["outcome"]
    return {"outcome": outcome, "report": result["report"]}


def counts(judged: list[dict]) -> dict:
    accepted = [j for j in judged if j["outcome"] == "accept"]
    return {"accepts": len(accepted), "rejects": sum(j["outcome"] == "reject" for j in judged),
            "holds": sum(j["outcome"] == "review-unavailable" for j in judged),
            "accepted_net_cc": sum(j["report"]["t1"]["cc_added"] for j in accepted if j.get("report")),
            "accepted_new_helpers": sum(len(j["report"]["new"]) for j in accepted if j.get("report"))}


def replay(bench: Path, run: Path) -> dict:
    sys.path.insert(0, str(bench))
    ledger = run / "cleanup" / "ledger.jsonl"
    rows = [json.loads(line) for line in ledger.read_text().splitlines() if line.strip()] if ledger.is_file() else []
    all_lanes = lanes(run)
    judged = [judge(lane, rows) for lane in all_lanes]
    changed = sum(j["outcome"] != lane["recorded"] for j, lane in zip(judged, all_lanes))
    return {**counts(judged), "lanes": len(judged), "changed": changed}


def recorded(bench: Path, run: Path, only: str | None = None) -> dict:
    """The run's own verdicts; net CC and helpers are re-measured from the lane trees with <bench>'s gate."""
    sys.path.insert(0, str(bench))
    from gate.family import check
    from gate.__main__ import find_task
    from planner.families import load_config
    judged = []
    for lane in (lane for lane in lanes(run) if only in (None, lane["task"])):
        task = find_task(lane["base"], lane["task"], lane["lane"] / "gate" / "plan.json")
        judged.append({"outcome": lane["recorded"], "report": check(lane["base"], lane["lane"] / "ws", task, load_config())})
    return {**counts(judged), "lanes": len(judged)}


def compare(base: dict, idea: dict, signal: str, rung: str, usd: float = 0.0) -> dict:
    name, _, direction = signal.partition(":")
    if name not in base or direction not in ("up", "down"):
        raise SystemExit(f"micro.py: signal must be <count>:<up|down> over {sorted(base)}, got {signal!r}")
    moved = idea[name] - base[name]
    return {"schema": "ar-micro/v1", "rung": rung, "predicted_direction_met": moved > 0 if direction == "up" else moved < 0,
            "usd": round(usd, 6), "signal": signal, "base": base, "idea": idea}


def main(argv: list[str]) -> int:
    mode, *args = argv
    if mode == "replay":
        out = replay(Path(args[0]).resolve(), Path(args[1]))
    elif mode == "recorded":
        out = recorded(Path(args[0]).resolve(), Path(args[1]), args[2] if len(args) > 2 else None)
    elif mode == "compare":
        out = compare(json.loads(args[0]), json.loads(args[1]), args[2], args[3], float(args[4]) if len(args) > 4 else 0.0)
    else:
        raise SystemExit(f"micro.py: unknown mode {mode!r}")
    print(json.dumps(out, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
