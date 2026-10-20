"""Benchmark curves (Alves, Ypma & Visser 2010) and band scoring.

Each entity weighs its SLOC as a share of its system's SLOC for that entity kind, so every system
counts equally and, within a system, a quantile means "this share of the code", not of the entities.
The 70/80/90 points of the pooled distribution are the band edges: low up to p70, moderate up to
p80, high up to p90, very high beyond.
"""

from __future__ import annotations

QUANTILES = (0.7, 0.8, 0.9)
BANDS = ("low", "moderate", "high", "very_high")
COGNITIVE_NOTE = "approximate port: matches scb-check exactly in 11 of 44 trees"

# family -> measure -> (entity kind, field)
MEASURES = {
    "complexity": {"cc": ("units", "cc"), "cog": ("units", "cog"), "cc_scb": ("units", "cc_scb")},
    "size": {"sloc": ("units", "sloc")},
    "interface": {"in": ("units", "in")},
    "module": {"module_sloc": ("modules", "sloc"), "class_methods": ("classes", "methods")},
    "coupling": {"fan_in": ("modules", "fan_in"), "fan_out": ("modules", "fan_out"),
                 "instability": ("modules", "instability")},
}
PROVISIONAL = {"cog": COGNITIVE_NOTE}


def system_pairs(rows: list[dict], field: str) -> list[tuple[float, float]]:
    """(value, weight) per entity, the weights summing to 1 over the system (empty if it has no SLOC)."""
    total = sum(r["sloc"] for r in rows)
    return [(r[field], r["sloc"] / total) for r in rows] if total else []


def weighted_quantiles(pairs: list[tuple[float, float]], qs=QUANTILES) -> list[float]:
    """The smallest value whose cumulative weight reaches q of the total, for each q."""
    pairs = sorted(pairs)
    total = sum(w for _, w in pairs)
    out, acc, i = [], 0.0, 0
    for q in qs:
        while i < len(pairs) - 1 and acc + pairs[i][1] < q * total - 1e-12:
            acc += pairs[i][1]
            i += 1
        out.append(pairs[i][0] if pairs else 0)
    return out


def derive(systems: list[dict]) -> dict:
    """Per family and measure, the SLOC-weighted, per-system-normalised 70/80/90 points."""
    families = {}
    for family, measures in MEASURES.items():
        families[family] = {}
        for name, (kind, field) in measures.items():
            pairs = [p for s in systems for p in system_pairs(s[kind], field)]
            p70, p80, p90 = weighted_quantiles(pairs)
            entry = {"entity": kind, "weight": "sloc", "p70": p70, "p80": p80, "p90": p90,
                     "entities": len(pairs)}
            if name in PROVISIONAL:
                entry.update(provisional=True, note=PROVISIONAL[name])
            families[family][name] = entry
    return families


def band(value: float, edges: dict) -> str:
    for label, key in zip(BANDS, ("p70", "p80", "p90")):
        if value <= edges[key]:
            return label
    return BANDS[-1]


def band_shares(rows: list[dict], field: str, edges: dict) -> dict:
    """Share of the rows' SLOC in each band."""
    total = sum(r["sloc"] for r in rows)
    shares = dict.fromkeys(BANDS, 0.0)
    for r in rows:
        shares[band(r[field], edges)] += r["sloc"] / total if total else 0.0
    return {k: round(v, 4) for k, v in shares.items()}


def score(system: dict, families: dict) -> dict:
    """Band shares of one measured system against a curve set."""
    return {family: {name: band_shares(system[e["entity"]], MEASURES[family][name][1], e)
                     for name, e in measures.items()}
            for family, measures in families.items()}
