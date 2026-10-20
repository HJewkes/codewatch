# Calibration curves

SLOC-weighted, per-system-normalised 70/80/90 points per measure (Alves, Ypma & Visser 2010) over
the pinned corpus in `python-v1.manifest.json`. `python3 -I bench/scbench/calibration curves`
writes them and `score` bands a tree against them; `../curves.py` lists the families.

| Version | Families | Change |
| --- | --- | --- |
| python-v1 | complexity, size, interface, module, coupling | first corpus curves (C-252) |
| python-v1.1 | as v1, plus `cog_scb` | cognitive measured by `../cognitive.py` (C-248 S4a) |
| python-v1.2 | as v1.1, plus control, stamp, common, cohesion, cycles | the cleanup planner's coupling detectors (C-248 S3c) |

All three versions use the same manifest. In v1.2 the v1.1 families are byte-identical to v1.1.

**Thresholds come from the corpus, not from the SCBench references.** The non-holdout
references are known-good only for the false-reject check: their band shares show how much
accepted code a gate set at a corpus band would reject. They never set or move a band edge
(owner decision K1, 2026-10-20).

## v1.2 measures

Each one is a count, read from the planner's detectors (`../interface.py`), so the curves and the
gate agree on what they count.

| Family | Measure | Entity | Counts |
| --- | --- | --- | --- |
| control | `control` | unit | control parameters in the control-coupling fixpoint (flag crossings) |
| control | `control_origin` | unit | the ones with their own evidence (flag origins) |
| stamp | `stamp` | unit | parameters used only through one attribute or one constant key |
| common | `common` | unit | global stores, in-place writes to module mutables, temporary-field writes, parameter bags |
| cohesion | `lcom4` | class | connected components of the methods (code-graph `lcom4OfClass`) |
| cohesion | `temp_fields` | class | `self` attributes stored outside `__init__`, `__post_init__` and the class body |
| cycles | `cycle` | module | modules in the import cycle it belongs to (0 if none) |

Most code has none of these findings, so most unit edges are 0. A gate on a 0 band edge
rejects any new finding, so read it as "no new findings" rather than as a tolerance.
