import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

export class FileCache {
  constructor(private readonly cacheDir: string) {}

  async get(key: string): Promise<unknown | null> {
    const filePath = this.keyToPath(key);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const filePath = this.keyToPath(key);
    await fs.writeFile(filePath, JSON.stringify(value));
  }

  async has(key: string): Promise<boolean> {
    const filePath = this.keyToPath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private keyToPath(key: string): string {
    const hash = createHash("sha256").update(key).digest("hex");
    return path.join(this.cacheDir, `${hash}.json`);
  }
}
