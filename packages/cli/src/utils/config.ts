import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CliConfig {
  githubToken: string | undefined;
  defaultRepos: string[];
}

const DEFAULT_CONFIG: CliConfig = {
  githubToken: undefined,
  defaultRepos: [],
};

export async function loadConfig(configPath: string): Promise<CliConfig> {
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CliConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }
}

export async function saveConfig(
  configPath: string,
  config: CliConfig,
): Promise<void> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
}

export function getDefaultConfigDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return path.join(home, ".code-style");
}

export function getDefaultConfigPath(): string {
  return path.join(getDefaultConfigDir(), "config.json");
}

export function getDefaultProfilePath(): string {
  return path.join(getDefaultConfigDir(), "profile.json");
}
