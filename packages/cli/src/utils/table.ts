export function padLeft(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}

export function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

export function visualWidth(s: string): number {
  return s.replace(/\[[0-9;]*m/g, "").length;
}
