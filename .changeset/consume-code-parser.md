---
"@codewatch/core": minor
"@codewatch/graph": minor
"@codewatch/cli": minor
---

Parse files with `@titan-design/code-parser@^0.1.0` instead of `@codewatch/core`'s own
parser. `@codewatch/core` no longer exports `parseFile`, `getSupportedLanguages`,
`shouldIncludeFile`, `getLanguageFromPath`, `isExcludedDir`, `ParsedFile` or `Extractor`;
import them from `@titan-design/code-parser`, which has the same signatures. `@codewatch/core`
keeps `GitHubService`, the LLM providers, `LlmRunner` and `FileCache`. `@codewatch/graph` no
longer depends on `@codewatch/core`. The package brings two behaviour changes.

`.tsx` files are now parsed with the TSX grammar. Before, they were parsed with the
TypeScript grammar, which cannot read JSX, so almost every `.tsx` file produced a tree with
parse errors. On titan-design, files with parse errors fell from 543 of 569 `.tsx` files to 6.
Every number computed from those trees changes for `.tsx` files only:

- `graph index`: cognitive and cyclomatic complexity, nesting depth, function counts, unused
  parameters and locals, and symbol line spans. Components the broken parse missed now appear
  as symbols, and symbols it invented disappear. Imports and other edges do not change.
  Because the same bytes now give different values, the index version moves to `0.12.0` and
  the first `graph index` after upgrading rebuilds every file instead of reusing an older
  snapshot.
- `graph check`, `graph report` and `graph top` follow those metrics, so `.tsx` files can
  newly cross a complexity threshold or enter a hotspot list.
- `analyze`, `diff`, `init` and `update` see more observations in `.tsx` files (functions,
  ternaries, array methods and JSDoc that the broken parse lost), so profile confidences can
  move. `.ts` and `.py` results are unchanged.

`.js` and `.jsx` files are no longer recognised as a language. codewatch never had a
JavaScript grammar: before, a `.js` or `.jsx` file was classed as `javascript` and then
failed to parse, which stopped the whole run with `Unsupported language: javascript`. That
happened in `codewatch diff` whenever a `.js` file was staged or changed, in
`codewatch analyze --lang javascript`, and in `init` and `update` when `javascript` was among
the requested languages. Now those files are skipped and the run finishes with the other
files.
