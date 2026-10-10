import type { ControlDefinition } from "../types.js";

export const pyLooseOutputTests: ControlDefinition = {
  id: "py-loose-output-tests",
  kind: "missing-test-kind",
  label: "slop",
  rationale: "The report is deterministic and nothing pins its text: both tests check only names, a line count and a prefix, so a wrong value, a lost decimal or a broken column passes.",
  path: "inventory/report.py",
  findings: [
    {
      lineStart: 15,
      lineEnd: 22,
      symbol: "render_report",
      signal: "missing-test-kind",
      tool: "codewatch",
      anchor: "def render_report(",
      evidence: "code kind: output boundary\nmissing: snapshot or exact-output test\ntests: tests/test_report.py:6-11, tests/test_report.py:14-16",
    },
  ],
  text: `"""Plain-text stock report for the inventory command."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Item:
    sku: str
    quantity: int
    unit_price: float


def render_report(items: list[Item]) -> str:
    lines = [f"{'SKU':<10}{'QTY':>6}{'VALUE':>12}"]
    for item in sorted(items, key=lambda i: i.sku):
        value = item.quantity * item.unit_price
        lines.append(f"{item.sku:<10}{item.quantity:>6}{value:>12.2f}")
    total = sum(i.quantity * i.unit_price for i in items)
    lines.append(f"{'TOTAL':<10}{'':>6}{total:>12.2f}")
    return "\\n".join(lines)
`,
  related: {
    "tests/test_report.py": `"""Tests for the stock report."""

from inventory.report import Item, render_report


def test_report_lists_every_item():
    items = [Item("B-200", 3, 2.5), Item("A-100", 10, 1.25)]
    out = render_report(items)
    assert "A-100" in out
    assert "B-200" in out
    assert len(out.splitlines()) == 4


def test_report_has_total_row():
    out = render_report([Item("A-100", 2, 4.0)])
    assert out.splitlines()[-1].startswith("TOTAL")
`,
  },
};
