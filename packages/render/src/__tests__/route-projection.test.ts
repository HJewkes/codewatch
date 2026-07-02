import { describe, it, expect } from "vitest";
import { projectRoute } from "../edge-routing.js";

interface Pt {
  x: number;
  y: number;
}

// Cytoscape reconstructs a segment point (with edge-distances:node-position) as
// Cs + w·(Ct−Cs) + d·n, where n = (−uy, ux). If projectRoute is correct, feeding
// its output back through that formula must recover the original bend point.
function reconstruct(cs: Pt, ct: Pt, w: number, d: number): Pt {
  const ax = ct.x - cs.x;
  const ay = ct.y - cs.y;
  const L = Math.hypot(ax, ay) || 1;
  const ux = ax / L;
  const uy = ay / L;
  const nx = -uy;
  const ny = ux;
  return { x: cs.x + w * ax + d * nx, y: cs.y + w * ay + d * ny };
}

describe("projectRoute", () => {
  it("reconstructs bend points exactly (the segments invariant)", () => {
    const cs = { x: 0, y: 0 };
    const ct = { x: 100, y: 100 };
    const route: Pt[] = [
      { x: 0, y: 0 }, // start
      { x: 100, y: 0 }, // bend (right angle)
      { x: 100, y: 100 }, // end
    ];
    const r = projectRoute(route, cs, ct)!;
    expect(r.w).toHaveLength(1);
    const back = reconstruct(cs, ct, r.w[0], r.d[0]);
    expect(back.x).toBeCloseTo(100, 2);
    expect(back.y).toBeCloseTo(0, 2);
  });

  it("recovers a multi-bend orthogonal route around an obstacle", () => {
    const cs = { x: 90, y: 36 };
    const ct = { x: 643, y: 352 };
    // The real cli→graph route ELK produced (wraps out to x=713, then down).
    const route: Pt[] = [
      { x: 162, y: 60 },
      { x: 162, y: 70 },
      { x: 713, y: 70 },
      { x: 713, y: 228 },
      { x: 673, y: 228 },
      { x: 673, y: 328 },
    ];
    const r = projectRoute(route, cs, ct)!;
    expect(r.w).toHaveLength(4); // 6 points − start − end
    const bends = route.slice(1, -1);
    bends.forEach((b, i) => {
      const back = reconstruct(cs, ct, r.w[i], r.d[i]);
      expect(back.x).toBeCloseTo(b.x, 2);
      expect(back.y).toBeCloseTo(b.y, 2);
    });
    // Endpoints pinned as px offsets from each node center.
    expect(r.se).toBe("72px 24px"); // (162,60) − (90,36)
    expect(r.te).toBe("30px -24px"); // (673,328) − (643,352)
  });

  it("returns undefined for a degenerate (<2 point) route", () => {
    expect(projectRoute([{ x: 0, y: 0 }], { x: 0, y: 0 }, { x: 1, y: 1 })).toBeUndefined();
  });

  it("emits no bends for a straight two-point route", () => {
    const r = projectRoute(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    )!;
    expect(r.w).toHaveLength(0);
    expect(r.d).toHaveLength(0);
  });
});
