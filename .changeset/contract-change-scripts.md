---
"@codewatch/cli": minor
---

`codewatch audit --changed-from <ref>` adds script contract changes to the `contract-change` signal. A changed script (one with an entry guard, `.mjs` included) whose exit codes or accepted flags changed gets an `exit-code-added`, `exit-code-removed` or `flag-removed` finding when an invoker outside the diff runs it. Invokers are `package.json` scripts, CI YAML, `Makefile` and shell lines, and source lines naming the script, plus one hop through `pnpm <script>`/`npm run <script>`.
