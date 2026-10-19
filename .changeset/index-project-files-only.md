---
"@codewatch/cli": patch
---

`graph index`, and so `audit`, `triage` and everything that reads their output, index only the project's own files. In a git work tree that means tracked files plus untracked files that no ignore rule covers. Gitignored files are left out, and so are untracked tool environments: `.venv`, `venv`, any directory holding `pyvenv.cfg`, `__pycache__`, `.pytest_cache`, `node_modules` and `.tox`. Outside git, the tool environments are left out of the walk. A virtualenv in the workspace no longer turns into thousands of audit findings and triage questions.
