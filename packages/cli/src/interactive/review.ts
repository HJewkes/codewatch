import { select, input, number } from "@inquirer/prompts";
import type { StyleRule, Profile } from "@codewatch/profile";
import type {
  ReviewAction,
  ReviewPromptDeps,
  ReviewSessionOptions,
} from "./types.js";
import {
  presentRule,
  presentCategoryHeader,
  presentAutoConfirm,
} from "./presenters.js";

const REVIEWABLE_CATEGORIES = [
  "naming",
  "structure",
  "documentation",
  "errorHandling",
  "formatting",
  "patterns",
] as const;

function isStyleRule(value: unknown): value is StyleRule {
  return (
    typeof value === "object" &&
    value !== null &&
    "confidence" in value &&
    "convention" in value
  );
}

function defaultPromptDeps(): ReviewPromptDeps {
  return {
    selectAction: async (rule, category, ruleName) => {
      console.log(presentRule(category, ruleName, rule));
      const action = await select<ReviewAction>({
        message: "Action:",
        choices: [
          { name: "Confirm", value: "confirm" },
          { name: "Reject (remove from profile)", value: "reject" },
          { name: "Adjust (modify convention/confidence)", value: "adjust" },
        ],
      });
      return action;
    },
    adjustRule: async (rule) => {
      const newConvention = await input({
        message: `Convention (current: ${String(rule.convention)}):`,
        default: String(rule.convention),
      });

      const newConfidence = await number({
        message: `Confidence 0-100 (current: ${Math.round(rule.confidence * 100)}):`,
        default: Math.round(rule.confidence * 100),
        min: 0,
        max: 100,
      });

      const newDescription = await input({
        message: `Description (current: ${rule.description ?? "none"}):`,
        default: rule.description ?? "",
      });

      return {
        ...rule,
        convention: newConvention || rule.convention,
        confidence: (newConfidence ?? Math.round(rule.confidence * 100)) / 100,
        description: newDescription || rule.description,
      };
    },
  };
}

export async function reviewProfile(
  profile: Profile,
  deps?: ReviewPromptDeps,
  options?: ReviewSessionOptions,
): Promise<Profile> {
  const prompts = deps ?? defaultPromptDeps();
  const autoThreshold = options?.autoConfirmAbove ?? Infinity;

  const result: Profile = {
    ...profile,
    naming: { ...profile.naming },
    structure: { ...profile.structure },
    documentation: { ...profile.documentation },
    errorHandling: { ...profile.errorHandling },
    formatting: { ...profile.formatting },
    patterns: { ...profile.patterns },
  };

  for (const category of REVIEWABLE_CATEGORIES) {
    const section = profile[category];
    if (!section || typeof section !== "object") continue;

    const entries = Object.entries(section as Record<string, StyleRule>);
    if (entries.length === 0) continue;

    for (const [ruleName, rule] of entries) {
      if (!isStyleRule(rule)) continue;

      if (rule.confidence > autoThreshold) {
        console.log(presentAutoConfirm(category, ruleName, rule.confidence));
        continue;
      }

      const action = await prompts.selectAction(rule, category, ruleName);

      switch (action) {
        case "confirm":
          break;
        case "reject": {
          const cat = result[category] as Record<string, StyleRule>;
          delete cat[ruleName];
          break;
        }
        case "adjust": {
          const adjusted = await prompts.adjustRule(rule);
          const cat = result[category] as Record<string, StyleRule>;
          cat[ruleName] = adjusted;
          break;
        }
      }
    }
  }

  return result;
}

export async function runReviewSession(
  enrichedProfile: unknown,
): Promise<Profile> {
  const profile = enrichedProfile as Profile;
  return reviewProfile(profile);
}
