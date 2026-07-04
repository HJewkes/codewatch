import { SyntaxKind, type SourceFile } from "ts-morph";

/**
 * String-literal specifiers of dynamic `import("…")` expressions in a file
 * (C-65). The static import graph only records `import`/`export` *declarations*,
 * so a module loaded lazily — e.g. `cli/src/index.ts` doing
 * `import("./commands/analyze.js")` to register a command — otherwise has no
 * inbound edge and reads `fan_in` 0, falsely appearing dead. Capturing these
 * closes that blind spot for the common case.
 *
 * Only string-literal specifiers are returned; a computed specifier
 * (`import(variable)`) is genuinely unresolvable statically and is left out (a
 * documented blind spot, same class as DI/registry-string wiring).
 */
export function dynamicImportSpecifiers(sourceFile: SourceFile): string[] {
  const out: string[] = [];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const arg = call.getArguments()[0];
    if (arg && arg.getKind() === SyntaxKind.StringLiteral) {
      out.push(arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText());
    }
  }
  return out;
}
