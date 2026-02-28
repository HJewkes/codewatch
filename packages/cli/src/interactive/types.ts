import type { StyleRule } from "@code-style/profile";

export type ReviewAction = "confirm" | "reject" | "adjust";

export interface ReviewDecision {
  action: ReviewAction;
  rule: StyleRule;
  category: string;
  ruleName: string;
}

export interface AdjustedRule extends StyleRule {
  userModified: boolean;
}

export interface ReviewSessionOptions {
  skipConfirmed?: boolean;
  autoConfirmAbove?: number;
}

export interface ReviewPromptDeps {
  selectAction: (
    rule: StyleRule,
    category: string,
    ruleName: string,
  ) => Promise<ReviewAction>;
  adjustRule: (rule: StyleRule) => Promise<StyleRule>;
}
