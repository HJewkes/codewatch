import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/**
 * Request guard for the HTTP MCP server (C-214). Binding to 127.0.0.1 is not
 * enough on its own: with DNS rebinding a web page can point its own hostname
 * at 127.0.0.1 and have the owner's browser call the server, so every request
 * must name a loopback Host on the bound port, carry no foreign Origin, and
 * present the bearer token from the daemon's 0600 token file.
 */
export interface GuardConfig {
  port: number;
  token: string;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const match = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(host.toLowerCase());
  return match !== null && LOOPBACK_HOSTNAMES.has(match[1]!) && Number(match[2]) === port;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") && LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

export function hasBearerToken(authorization: string | undefined, token: string): boolean {
  const presented = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (!presented) return false;
  return timingSafeEqual(digest(presented), digest(token));
}

/** The status to refuse the request with, or null when it may be served. */
export function refusalStatus(headers: IncomingHttpHeaders, config: GuardConfig): 401 | 403 | null {
  if (!isLoopbackHost(headers.host, config.port)) return 403;
  if (!isAllowedOrigin(headers.origin)) return 403;
  if (!hasBearerToken(headers.authorization, config.token)) return 401;
  return null;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
