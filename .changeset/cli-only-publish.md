---
"@codewatch/cli": minor
---

Publish `@codewatch/cli` as the only codewatch package. The CLI build now bundles the code of
`@codewatch/core` and `@codewatch/render`, and declares their runtime dependencies (`octokit`,
`cytoscape`, `cytoscape-cose-bilkent`, `cose-base`, `layout-base`, `elkjs`) itself. Those two
packages are private and will not be published again; install `@codewatch/cli` instead.
Every `@titan-design/*` package remains an ordinary npm dependency.
