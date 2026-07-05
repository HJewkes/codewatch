import { describe, it, expect } from "vitest";
import {
  openDatabase,
  type GraphDatabase,
  type GraphEdge,
  type GraphNode,
  type NodeRole,
} from "@codewatch/graph";
import { generateRetrievalSuite } from "../retrieval.js";
import { gradeRetrieval } from "../retrieval-grader.js";
import type { RetrievalTask } from "../retrieval-types.js";

/**
 * Same synthetic graph shape as oracle.test.ts, exercising all three neighbour
 * strata plus external-drop:
 *   - b.ts ↔ a.ts       via ./a.js (resolves direct)     → import-chain-reachable
 *   - b.ts ↔ util.ts    via ./index.js barrel (≠ origin) → structurally-hidden
 *   - a.ts ↔ util.ts    name-token util/util.ts          → semantic-findable
 *   - a.ts → npm:x       external                          → dropped
 */
function file(id: string, role?: NodeRole): GraphNode {
  return { id, kind: "file", name: id, role };
}
function symbol(id: string, parentId: string): GraphNode {
  return { id, kind: "symbol", name: id.split("#")[1]!, parentId, attrs: { exported: true } };
}
function ref(srcId: string, dstId: string, specifier: string): GraphEdge {
  return { srcId, dstId, kind: "references", attrs: { specifier, weight: 1 } };
}
function imp(srcId: string, dstId: string): GraphEdge {
  return { srcId, dstId, kind: "imports", attrs: { specifier: dstId, weight: 1 } };
}

function seedGraph(db: GraphDatabase): void {
  const snap = db.createSnapshot({ ref: "HEAD", indexVersion: "test" });
  db.insertNodes(snap, [
    file("src/a.ts"),
    file("src/b.ts"),
    file("src/util.ts"),
    file("src/index.ts", "barrel"),
    file("src/c.test.ts", "test"),
    symbol("src/a.ts#alpha", "src/a.ts"),
    symbol("src/util.ts#helper", "src/util.ts"),
    symbol("src/util.ts#utilRun", "src/util.ts"),
  ]);
  db.insertEdges(snap, [
    ref("src/b.ts", "src/a.ts#alpha", "./a.js"),
    ref("src/c.test.ts", "src/a.ts#alpha", "./a.js"),
    ref("src/b.ts", "src/util.ts#helper", "./index.js"),
    ref("src/c.test.ts", "src/util.ts#helper", "./util.js"),
    ref("src/a.ts", "src/util.ts#utilRun", "./util.js"),
    imp("src/b.ts", "src/a.ts"),
    imp("src/b.ts", "src/index.ts"),
    imp("src/a.ts", "npm:x"),
  ]);
}

function taskFor(tasks: RetrievalTask[], queryFileId: string): RetrievalTask {
  const t = tasks.find((x) => x.queryFileId === queryFileId);
  if (!t) throw new Error(`retrieval task for ${queryFileId} not found`);
  return t;
}
function stratumOf(t: RetrievalTask, fileId: string): string {
  const n = t.relevant.find((x) => x.fileId === fileId);
  if (!n) throw new Error(`${fileId} not a neighbour of ${t.queryFileId}`);
  return n.stratum;
}

describe("generateRetrievalSuite", () => {
  function suiteOf() {
    const db = openDatabase(":memory:");
    seedGraph(db);
    const suite = generateRetrievalSuite(db, { cap: 10 });
    db.close();
    return suite;
  }

  it("emits the undirected dependency neighbours per file, externals dropped", () => {
    const b = taskFor(suiteOf().tasks, "src/b.ts");
    expect(b.relevant.map((n) => n.fileId).sort()).toEqual([
      "src/a.ts",
      "src/index.ts",
      "src/util.ts",
    ]);
    // npm:x is external — never a neighbour of anyone
    const allNeighbours = suiteOf().tasks.flatMap((t) => t.relevant.map((n) => n.fileId));
    expect(allNeighbours).not.toContain("npm:x");
  });

  it("stratifies each neighbour by discoverability", () => {
    const tasks = suiteOf().tasks;
    const b = taskFor(tasks, "src/b.ts");
    expect(stratumOf(b, "src/util.ts")).toBe("structurally-hidden"); // barrel re-export
    expect(stratumOf(b, "src/a.ts")).toBe("import-chain-reachable"); // ./a.js resolves direct
    expect(stratumOf(b, "src/index.ts")).toBe("import-chain-reachable"); // imports-only link
    const a = taskFor(tasks, "src/a.ts");
    expect(stratumOf(a, "src/util.ts")).toBe("semantic-findable"); // util token match
  });

  it("counts relevant neighbours by stratum", () => {
    const counts = suiteOf().counts;
    expect(counts.total).toBe(5); // a, b, util, index, c.test all have ≥1 neighbour
    const sum =
      counts.relevantByStratum["semantic-findable"] +
      counts.relevantByStratum["import-chain-reachable"] +
      counts.relevantByStratum["structurally-hidden"];
    expect(sum).toBeGreaterThan(0);
  });

  it("is deterministic — same graph in, byte-identical suite out", () => {
    expect(JSON.stringify(suiteOf())).toEqual(JSON.stringify(suiteOf()));
  });

  it("grades an arm ranking against a generated task with stratified recall", () => {
    const b = taskFor(suiteOf().tasks, "src/b.ts");
    // an embedding-style arm that only surfaces the directly-resolvable neighbour
    const score = gradeRetrieval(b, ["src/a.ts"], 5);
    expect(score.recallAtK).toBeCloseTo(1 / 3);
    expect(score.recallByStratum["structurally-hidden"]).toBe(0);
    expect(score.recallByStratum["import-chain-reachable"]).toBe(0.5); // found a.ts, missed index.ts
  });
});
