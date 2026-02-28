import type { Profile, Severity } from "@code-style/profile";

export type { Severity };

export interface CheckDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: Severity;
  message: string;
  category: string;
  rule: string;
  fixable: boolean;
  fix?: {
    range: [number, number];
    text: string;
  };
}

export interface CheckResult {
  diagnostics: CheckDiagnostic[];
  tool: "eslint" | "ruff";
  exitCode: number;
}

export interface OrchestratorOptions {
  profile: Profile;
  files: string[];
  fix?: boolean;
  language?: "typescript" | "python";
}

export interface OrchestratorResult {
  diagnostics: CheckDiagnostic[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    fixed: number;
  };
}
