# SCBench prompt templates

Pinned prompt templates for the SCBench pilot, in the runner's Jinja format at
slop-code-bench commit `31ceea3`.

| Arm | Template |
|---|---|
| A0 | `just-solve.jinja`: the runner's stock `configs/prompts/just-solve.jinja`, byte for byte |
| A1a | `a1a.jinja` |
| A1 (`claude_code_cw`) | `a1a.jinja`, the same file as A1a |

`a1a.jinja` is the stock template plus two lines after its first line:

1. Keep a `NOTES.md` handoff for the next checkpoint.
2. Write tests for the spec's examples in a `tests` subdirectory, run them before
   finishing, and carry them forward.

Neither template reads `agent_type`, so A1a and A1 get the same prompt bytes whichever
agent type runs them.

The runner takes the prompt from the run config, not the agent config: pass
`--prompt <name>` to `slop-code run`. The runner's wheel does not ship `configs/`, so
when it runs from `bench/scbench`, a bare name resolves from `./prompts/`.
`--prompt just-solve` picks the stock copy here and `--prompt a1a` picks the A1a template.

## Manifest

```
python3 bench/scbench/prompts/record_manifest.py
```

This writes each arm's template path and sha256 under `prompts` in the run manifest. The
manifest is `~/.cache/codewatch-scbench/manifest.json`, or `$MANIFEST` or
`$SCBENCH_RUN_DIR/manifest.json` when set, the same defaults as `../image/build.sh`.

It also writes the effective caps under `caps`: `budget_usd` (the triage stage's
`--budget-usd` in `../agent/claude_code_cw.yaml`), `injection_token_cap` and
`open_items_cap` (from `CODEWATCH_CARRY_MAX_TOKENS` and `CODEWATCH_CARRY_MAX_OPEN_ITEMS`
in the environment of the recording run), and the runner's `step_limit`. A cap that is
not set is `null`.

## Tests

`test_prompts.py` renders both templates for a synthetic spec and checks that A1a equals
A0 plus the two lines. It also checks that the stock copy still matches the runner's sha256
at `31ceea3`. The render tests need `jinja2`. The test that renders through the runner's own
`render_prompt` needs slop-code-bench and is skipped without it.
