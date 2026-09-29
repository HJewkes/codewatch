---
"@codewatch/cli": patch
"@codewatch/core": patch
---

`graph conventions` now summarizes through `@titan-design/agent`'s claude-print harness instead of spawning `claude` itself. The prompt goes on stdin, the call runs with no tools, MCP servers or setting sources, one turn and a $1 budget cap, and `ANTHROPIC_API_KEY` is stripped so the call bills the CLI login. `CLAUDE_BIN` selects the `claude` binary. A failed call rejects with the CLI's own message.

`@codewatch/core` loses its unused LLM exports: `ClaudeHaikuProvider`, `OllamaProvider`, `createProvider`, `LlmRunner` and the `LlmMessage`, `LlmResponse`, `LlmProvider`, `LlmJob`, `LlmJobSuccess`, `LlmJobFailure`, `LlmRunResult` and `LlmRunnerConfig` types.
