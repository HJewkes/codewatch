import { describe, it, expect } from "vitest";
import type { Extractor, ParsedFile } from "../parser/types.js";

/**
 * Phase 4 acceptance: Extractor<T> in core must be specializable for any
 * observation shape — not just style observations. This test exercises a
 * non-style use case (graph fragments, modeling what packages/graph will
 * eventually need) without touching analyzer or core code beyond the type.
 */

interface GraphFragment {
  nodes: { id: string; label: string }[];
  edges: { from: string; to: string }[];
}

class FakeGraphExtractor implements Extractor<GraphFragment> {
  readonly name = "fake-graph";

  extract(_file: ParsedFile): GraphFragment[] {
    return [
      {
        nodes: [{ id: "a", label: "module-a" }],
        edges: [{ from: "a", to: "b" }],
      },
    ];
  }
}

describe("Extractor<T> generic", () => {
  it("accepts a non-style observation shape (graph fragments)", () => {
    const extractor: Extractor<GraphFragment> = new FakeGraphExtractor();
    const fragments = extractor.extract({} as ParsedFile);

    expect(extractor.name).toBe("fake-graph");
    expect(fragments).toHaveLength(1);
    expect(fragments[0].nodes[0].id).toBe("a");
    expect(fragments[0].edges[0].from).toBe("a");
  });

  it("preserves T inference at the call site", () => {
    const extractor = new FakeGraphExtractor();
    const fragments = extractor.extract({} as ParsedFile);

    // If T weren't preserved, fragments[0].nodes wouldn't typecheck.
    const firstNodeId: string = fragments[0].nodes[0].id;
    expect(firstNodeId).toBe("a");
  });
});
