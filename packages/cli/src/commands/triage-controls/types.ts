/** Whether a control's flagged code should be left alone (clean) or changed (slop). */
export type ControlLabel = "clean" | "slop";

/** The verdict a correct reader gives every finding in a control. */
export type ExpectedVerdict = "confirmed" | "justified";

/** The triage question a control exercises; one clean and one slop control per kind. */
export type ControlKind = "single-caller-helper" | "comment" | "unnecessary-isinstance" | "pass-through";

/** A finding row as `codewatch audit` writes it to findings.jsonl, minus the run-specific fields. */
export interface ControlFindingRow {
  path: string;
  lineStart: number;
  lineEnd: number;
  symbol?: string;
  signal: string;
  tool: string;
}

/** A finding as authored in a control, with the text that must start its first cited line. */
export interface ControlFindingDefinition extends Omit<ControlFindingRow, "path"> {
  anchor: string;
}

export interface ControlDefinition {
  id: string;
  kind: ControlKind;
  label: ControlLabel;
  /** Why the label is right, for whoever reviews a disagreeing verdict. Never shown to the reader. */
  rationale: string;
  path: string;
  text: string;
  findings: readonly ControlFindingDefinition[];
}

export interface ControlFinding extends ControlFindingRow {
  expected: ExpectedVerdict;
}

/** A control as a triage run consumes it: one planted file bundle with known answers. */
export interface Control {
  id: string;
  kind: ControlKind;
  label: ControlLabel;
  path: string;
  text: string;
  findings: ControlFinding[];
}
