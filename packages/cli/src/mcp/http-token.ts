import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { getDefaultConfigDir } from "../utils/config.js";

/** Per-port, so two daemons on different ports never overwrite each other's token. */
export function defaultTokenPath(port: number): string {
  return path.join(getDefaultConfigDir(), `mcp-http-${port}.token`);
}

/**
 * Writes a fresh bearer token readable only by the owner. A new token on every
 * start means a token leaked from an earlier run stops working. Writing a new
 * file and renaming it over the old one means the token never sits in a file
 * with a looser mode, even when an earlier token file had one.
 */
export function createTokenFile(tokenPath: string): string {
  const token = randomBytes(32).toString("hex");
  mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
  const staging = `${tokenPath}.${process.pid}.tmp`;
  writeFileSync(staging, `${token}\n`, { mode: 0o600, flag: "wx" });
  chmodSync(staging, 0o600);
  renameSync(staging, tokenPath);
  return token;
}
