import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Profile } from "../schema/profile.js";
import type { GeneratedFile } from "./types.js";
import {
  getTopRules,
  getRulesForCategory,
  detectLanguages,
  extractAllRules,
} from "./template-helpers.js";

const TEMPLATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../skills/code-style-personal/templates",
);

function loadTemplate(name: string): Handlebars.TemplateDelegate {
  const templatePath = join(TEMPLATES_DIR, name);
  const source = readFileSync(templatePath, "utf-8");
  return Handlebars.compile(source);
}

function buildTopRulesContext(profile: Profile) {
  return getTopRules(profile).map((r) => ({
    name: `${r.category}.${r.name}`,
    description:
      r.description ??
      `Use ${typeof r.convention === "string" ? r.convention : JSON.stringify(r.convention)} (${(r.confidence * 100).toFixed(0)}% confidence)`,
  }));
}

function buildNamingContext(profile: Profile) {
  return getRulesForCategory(profile, "naming").map((r) => ({
    label: r.name.charAt(0).toUpperCase() + r.name.slice(1),
    convention:
      typeof r.convention === "string"
        ? r.convention
        : JSON.stringify(r.convention),
    confidencePercent: (r.confidence * 100).toFixed(0),
    stability: r.stability,
    description: r.description,
    examples: r.examples,
  }));
}

function buildPatternsContext(profile: Profile) {
  const patternRules = getRulesForCategory(profile, "patterns").map((r) => ({
    name: r.name,
    strength:
      typeof r.convention === "string" ? r.convention : "detected",
    confidencePercent: (r.confidence * 100).toFixed(0),
    description: r.description,
  }));

  const preferredPatterns = profile.structure?.preferredPatterns;
  let preferredList: string[] | undefined;
  if (preferredPatterns && Array.isArray(preferredPatterns.convention)) {
    preferredList = preferredPatterns.convention as string[];
  }

  return { patterns: patternRules, preferredPatterns: preferredList };
}

export function generateSkillFiles(profile: Profile): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const languages = detectLanguages(profile);

  const skillTemplate = loadTemplate("skill.md.hbs");
  files.push({
    path: "skill.md",
    content: skillTemplate({
      author: profile.author,
      topRules: buildTopRulesContext(profile),
      languages,
    }),
  });

  const namingTemplate = loadTemplate("naming.md.hbs");
  files.push({
    path: "references/naming.md",
    content: namingTemplate({ rules: buildNamingContext(profile) }),
  });

  const patternsTemplate = loadTemplate("patterns.md.hbs");
  files.push({
    path: "references/patterns.md",
    content: patternsTemplate(buildPatternsContext(profile)),
  });

  const langTemplate = loadTemplate("per-language.md.hbs");
  for (const lang of languages) {
    const allRules = extractAllRules(profile).map((r) => ({
      category: r.category,
      name: r.name,
      convention:
        typeof r.convention === "string"
          ? r.convention
          : JSON.stringify(r.convention),
      confidencePercent: (r.confidence * 100).toFixed(0),
      description: r.description,
    }));

    files.push({
      path: `references/per-language/${lang}.md`,
      content: langTemplate({
        language: lang.charAt(0).toUpperCase() + lang.slice(1),
        rules: allRules,
      }),
    });
  }

  return files;
}
