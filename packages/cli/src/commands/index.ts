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
