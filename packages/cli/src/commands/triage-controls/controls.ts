import { pyClonedReaders } from "./python/cloned-readers.js";
import { pyCommentClean } from "./python/comment-clean.js";
import { pyCommentSlop } from "./python/comment-slop.js";
import { pyHelperClean } from "./python/helper-clean.js";
import { pyHelperSlop } from "./python/helper-slop.js";
import { pyIsinstanceClean } from "./python/isinstance-clean.js";
import { pyIsinstanceSlop } from "./python/isinstance-slop.js";
import { pyPassThroughClean } from "./python/pass-through-clean.js";
import { pyPassThroughSlop } from "./python/pass-through-slop.js";
import { pyRegnetRequired } from "./python/regnet-required.js";
import { pyWeakOracle } from "./python/weak-oracle.js";
import type { Control, ControlDefinition, ControlLabel, ExpectedVerdict } from "./types.js";

export const CONTROL_DEFINITIONS: readonly ControlDefinition[] = [
  pyHelperClean,
  pyHelperSlop,
  pyCommentClean,
  pyCommentSlop,
  pyIsinstanceClean,
  pyIsinstanceSlop,
  pyPassThroughClean,
  pyPassThroughSlop,
  pyRegnetRequired,
  pyWeakOracle,
  pyClonedReaders,
];

export function expectedVerdict(label: ControlLabel): ExpectedVerdict {
  return label === "slop" ? "confirmed" : "justified";
}

function toControl(def: ControlDefinition): Control {
  const expected = expectedVerdict(def.label);
  return {
    id: def.id,
    kind: def.kind,
    label: def.label,
    path: def.path,
    text: def.text,
    ...(def.spec === undefined ? {} : { spec: def.spec }),
    findings: def.findings.map(({ anchor: _anchor, ...row }) => ({ path: def.path, ...row, expected })),
  };
}

/** The planted control corpus, in a stable order; the run picks and positions controls by seed. */
export function loadControls(definitions: readonly ControlDefinition[] = CONTROL_DEFINITIONS): Control[] {
  return definitions.map(toControl);
}
