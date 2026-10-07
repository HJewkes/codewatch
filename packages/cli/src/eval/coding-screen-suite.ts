import {
  emptyFunnel,
  mineCandidates,
  miningParams,
  resolveMiningOptions,
  type Candidate,
  type MiningOptions,
} from "./coding-candidates.js";
import { resolveHead } from "./coding-mine.js";
import type { HardnessFeatures } from "./coding-screen.js";
import type { CodingTaskType } from "./impact-types.js";
import type { AdmissionFunnel, MiningParams } from "./coding-types.js";
import type { Stratum } from "./types.js";

/**
 * Screen-only mining (`--screen-only`): mine, scope-filter and hardness-screen
 * a repo's history, and stop before the admission gate. Reads git only, so it
 * never checks out, installs or runs a test command.
 */

/** A screened candidate. The commit subject is left out so no task can leak it. */
export interface ScreenedCandidate {
  fixCommit: string;
  parentCommit: string;
  testFiles: string[];
  editFiles: string[];
  testPatchDiff: string;
  goldDiff: string;
  stratum: Stratum;
  hardness: HardnessFeatures;
  packagesSpanned: number;
  /** Rule-assigned task type; unset when the rules cannot decide. */
  type?: CodingTaskType;
}

export interface CodingScreen {
  source: { repo: string; ref: string; headCommit: string | null };
  params: MiningParams;
  /** Mining and screen stages only; the gate counts stay 0. */
  funnel: AdmissionFunnel;
  candidates: ScreenedCandidate[];
}

export function screenCodingCandidates(
  repo: string,
  options: Partial<MiningOptions> = {},
): CodingScreen {
  const opts = resolveMiningOptions(options);
  const funnel = emptyFunnel();
  const candidates = mineCandidates(repo, opts, funnel).map(toScreened);
  return {
    source: { repo, ref: opts.ref, headCommit: resolveHead(repo, opts.ref) },
    params: miningParams(opts),
    funnel,
    candidates,
  };
}

function toScreened(c: Candidate): ScreenedCandidate {
  return {
    fixCommit: c.commit.sha,
    parentCommit: c.parentCommit,
    testFiles: c.testFiles,
    editFiles: c.editFiles,
    testPatchDiff: c.testPatchDiff,
    goldDiff: c.goldDiff,
    stratum: c.stratum,
    hardness: c.hardness,
    packagesSpanned: c.packagesSpanned,
    ...(c.type ? { type: c.type } : {}),
  };
}
