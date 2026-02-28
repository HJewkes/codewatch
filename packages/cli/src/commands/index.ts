export { runInitPipeline, promptForInitOptions } from "./init.js";
export type { InitPipelineDeps, InitCommandOptions } from "./init.js";

export { formatProfileText, formatProfileJson } from "./show.js";
export {
  diffAgainstProfile,
  getStagedFiles,
  getChangedFiles,
} from "./diff.js";
export type { Deviation, DiffResult } from "./diff.js";

export {
  formatCheckOutput,
  determineExitCode,
  resolveFilePaths,
  runCheck,
} from "./check.js";
export type { CheckCommandOptions, OutputFormat } from "./check.js";

export { mergeProfiles, runUpdate } from "./update.js";
export type { UpdateCommandOptions, MergeOptions } from "./update.js";

export { compareProfiles, formatComparison } from "./compare.js";
export type { ProfileDiff } from "./compare.js";

export { installHook, removeHook } from "./hook.js";

export { runExport } from "./export.js";
export type { ExportCommandOptions } from "./export.js";
