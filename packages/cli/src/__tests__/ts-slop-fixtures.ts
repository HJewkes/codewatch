/** One snippet each rule must flag and one near-miss it must leave alone. */
export interface RuleFixture {
  match: string;
  clean: string;
}

export const TS_SLOP_FIXTURES: Record<string, RuleFixture> = {
  "bool-literal-comparison": {
    match: "export const f = (a: number, b: number) => (a > b) === false;\n",
    clean: "export const f = (o: { a?: boolean }) => o.a === true;\n",
  },
  "redundant-bool-ternary": {
    match: "export const f = (n: number) => (n > 0 ? true : false);\n",
    clean: "export const f = (n: number) => (n > 0 ? 'yes' : 'no');\n",
  },
  "redundant-bool-cast-in-condition": {
    match: "export function f(x: string) {\n  if (!!x) {\n    return 1;\n  }\n  return 0;\n}\n",
    clean: "export const f = (x: string) => !!x;\n",
  },
  "null-and-undefined-check": {
    match: "export const f = (x: string | null | undefined) => x !== null && x !== undefined;\n",
    clean: "export const f = (x: string | null | undefined) => x != null;\n",
  },
  "boolean-return-if-else": {
    match: "export function f(n: number) {\n  if (n > 0) {\n    return true;\n  }\n  return false;\n}\n",
    clean: "export function f(n: number) {\n  if (n > 0) {\n    return true;\n  }\n  return n < -10;\n}\n",
  },
  "ternary-same-value": {
    match: "export const f = (c: boolean, a: number) => (c ? a : a);\n",
    clean: "export const f = (c: boolean, a: number, b: number) => (c ? a : b);\n",
  },
  "else-after-exit": {
    match: "export function f(n: number) {\n  if (n > 0) {\n    return 1;\n  } else {\n    console.log(n);\n  }\n  return 0;\n}\n",
    clean: "export function f(n: number) {\n  if (n > 0) {\n    console.log(n);\n  } else {\n    console.log(-n);\n  }\n  return 0;\n}\n",
  },
  "nested-if-no-else": {
    match: "export function f(a: boolean, b: boolean) {\n  if (a) {\n    if (b) {\n      console.log(1);\n    }\n  }\n}\n",
    clean: "export function f(a: boolean, b: boolean) {\n  if (a) {\n    if (b) {\n      console.log(1);\n    }\n    console.log(2);\n  }\n}\n",
  },
  "redundant-guard-same-return": {
    match: "export function f(n: number, r: number) {\n  if (n > 0) {\n    return r;\n  }\n  return r;\n}\n",
    clean: "export function f(n: number, r: number) {\n  if (n > 0) {\n    return r;\n  }\n  return -r;\n}\n",
  },
  "nullish-assign-default": {
    match: "export function f(x?: number) {\n  if (x === undefined) {\n    x = 1;\n  }\n  return x;\n}\n",
    clean: "export function f(x?: number) {\n  x ??= 1;\n  return x;\n}\n",
  },
  "typeof-guard-throw": {
    match: "export function f(x: unknown) {\n  if (typeof x !== 'string') {\n    throw new TypeError('x');\n  }\n  return x;\n}\n",
    clean: "export function f(x: unknown) {\n  if (typeof x !== 'string') {\n    return '';\n  }\n  return x;\n}\n",
  },
  "catch-return-sentinel": {
    match: "export function f(s: string) {\n  try {\n    return JSON.parse(s);\n  } catch {\n    return null;\n  }\n}\n",
    clean: "export function f(s: string) {\n  try {\n    return JSON.parse(s);\n  } catch (err) {\n    console.error(err);\n    return null;\n  }\n}\n",
  },
  "typeof-probe-ladder": {
    match: "export function f(x: unknown) {\n  if (typeof x === 'string') {\n    return 1;\n  }\n  if (typeof x === 'number') {\n    return 2;\n  }\n  return 3;\n}\n",
    clean: "export function f(x: unknown) {\n  if (typeof x === 'string') {\n    return 1;\n  }\n  return 3;\n}\n",
  },
  "return-nullish-guard-ladder": {
    match: "export function f(a?: number, b?: number) {\n  if (a === undefined) return null;\n  if (b == null) {\n    return null;\n  }\n  return a + b;\n}\n",
    clean: "export function f(a?: number, b?: number) {\n  if (a === undefined) return null;\n  const c = b ?? 0;\n  return a + c;\n}\n",
  },
  "nullish-continue-in-loop": {
    match: "export function f(xs: Array<number | null>) {\n  for (const x of xs) {\n    if (x === null) continue;\n    console.log(x);\n  }\n}\n",
    clean: "export function f(xs: number[]) {\n  for (const x of xs) {\n    if (x < 0) continue;\n    console.log(x);\n  }\n}\n",
  },
  "map-has-then-get": {
    match: "export function f(m: Map<string, number>, k: string) {\n  if (m.has(k)) {\n    return m.get(k)! + 1;\n  }\n  return 0;\n}\n",
    clean: "export function f(m: Map<string, number>, k: string) {\n  const v = m.get(k);\n  return v === undefined ? 0 : v + 1;\n}\n",
  },
  "manual-map-default-set": {
    match: "export function f(m: Map<string, number[]>, k: string) {\n  if (!m.has(k)) {\n    m.set(k, []);\n  }\n}\n",
    clean: "export function f(m: Map<string, number[]>, k: string) {\n  if (!m.has(k)) {\n    console.log(k);\n  }\n}\n",
  },
  "object-keys-then-index": {
    match: "export function f(o: Record<string, number>) {\n  for (const k of Object.keys(o)) {\n    console.log(k, o[k]);\n  }\n}\n",
    clean: "export function f(o: Record<string, number>) {\n  for (const k of Object.keys(o)) {\n    console.log(k);\n  }\n}\n",
  },
  "entries-unused-half": {
    match: "export function f(o: Record<string, number>) {\n  for (const [k] of Object.entries(o)) {\n    console.log(k);\n  }\n}\n",
    clean: "export function f(o: Record<string, number>) {\n  for (const [k, v] of Object.entries(o)) {\n    console.log(k, v);\n  }\n}\n",
  },
  "push-only-loop": {
    match: "export function f(xs: number[]) {\n  const out: number[] = [];\n  for (const x of xs) {\n    out.push(x * 2);\n  }\n  return out;\n}\n",
    clean: "export function f(xs: number[]) {\n  const out: number[] = [];\n  for (const x of xs) {\n    if (x > 0) out.push(x * 2);\n  }\n  return out;\n}\n",
  },
  "manual-sum-loop": {
    match: "export function f(xs: number[]) {\n  let total = 0;\n  for (const x of xs) {\n    total += x;\n  }\n  return total;\n}\n",
    clean: "export function f(xs: number[]) {\n  let total = 0;\n  for (const x of xs) {\n    total += x;\n    console.log(total);\n  }\n  return total;\n}\n",
  },
  "copy-before-iterate": {
    match: "export function f(xs: Set<number>) {\n  for (const x of [...xs]) {\n    console.log(x);\n  }\n}\n",
    clean: "export function f(xs: Set<number>) {\n  for (const x of xs) {\n    console.log(x);\n  }\n}\n",
  },
  "redundant-continue": {
    match: "export function f(xs: number[]) {\n  for (const x of xs) {\n    console.log(x);\n    continue;\n  }\n}\n",
    clean: "export function f(xs: number[]) {\n  outer: for (const x of xs) {\n    for (const y of xs) {\n      if (x === y) continue outer;\n      console.log(y);\n    }\n  }\n}\n",
  },
  "filter-then-first-or-length": {
    match: "export const f = (xs: number[]) => xs.filter((x) => x > 0).length > 0;\n",
    clean: "export const f = (xs: number[]) => xs.filter((x) => x > 0).length > 3;\n",
  },
  "catch-swallow-empty": {
    match: "export function f(s: string) {\n  try {\n    JSON.parse(s);\n  } catch {}\n}\n",
    clean: "export function f(s: string) {\n  try {\n    JSON.parse(s);\n  } catch (err) {\n    console.error(err);\n  }\n}\n",
  },
  "catch-rethrow": {
    match: "export function f(s: string) {\n  try {\n    return JSON.parse(s);\n  } catch (err) {\n    throw err;\n  }\n}\n",
    clean: "export function f(s: string) {\n  try {\n    return JSON.parse(s);\n  } catch (err) {\n    throw new Error('bad json', { cause: err });\n  }\n}\n",
  },
  "immediately-invoked-arrow": {
    match: "export const x = (() => 1 + 2)();\n",
    clean: "export const x = (() => {\n  const y = 1;\n  return y + 2;\n})();\n",
  },
  "unnecessary-arrow-wrapper": {
    match: "const double = (n: number) => n * 2;\nexport const f = (xs: number[]) => xs.map((x) => double(x));\n",
    clean: "const add = (a: number, b: number) => a + b;\nexport const f = (xs: number[]) => xs.map((x) => add(x, 1));\n",
  },
  "empty-constructor": {
    match: "export class A {\n  constructor() {}\n  run() {\n    return 1;\n  }\n}\n",
    clean: "export class A {\n  private constructor() {}\n  static make() {\n    return new A();\n  }\n}\n",
  },
  "redundant-trailing-return": {
    match: "export function f(x: number) {\n  console.log(x);\n  return;\n}\n",
    clean: "export function f(x: number) {\n  if (x > 0) {\n    return;\n  }\n  console.log(x);\n}\n",
  },
  "union-with-any": {
    match: "export type T = string | any;\n",
    clean: "export type T = string | number;\n",
  },
  "generic-with-any": {
    match: "export const m: Record<string, any> = {};\n",
    clean: "export const m: Record<string, number> = {};\n",
  },
  "function-type-any-return": {
    match: "export type Handler = (event: string) => any;\n",
    clean: "export type Handler = (event: string) => void;\n",
  },
  "object-type-annotation": {
    match: "export function f(o: object) {\n  return o;\n}\n",
    clean: "export function f(o: Record<string, unknown>) {\n  return o;\n}\n",
  },
  "string-plus-conversion": {
    match: "export const f = (n: number) => 'count: ' + String(n);\n",
    clean: "export const f = (n: number) => `count: ${n}`;\n",
  },
  "redundant-string-in-template": {
    match: "export const f = (n: number) => `count: ${String(n)}`;\n",
    clean: "export const f = (n: number) => `count: ${n.toFixed(2)}`;\n",
  },
  "json-roundtrip-clone": {
    match: "export const f = <T>(x: T): T => JSON.parse(JSON.stringify(x));\n",
    clean: "export const f = <T>(x: T): T => structuredClone(x);\n",
  },
  "string-concat-in-loop": {
    match: "export function f(xs: string[]) {\n  let s = '';\n  for (const x of xs) {\n    s += `${x},`;\n  }\n  return s;\n}\n",
    clean: "export function f(xs: number[]) {\n  let n = 0;\n  for (const x of xs) {\n    n += x;\n    console.log(n);\n  }\n  return n;\n}\n",
  },
};
