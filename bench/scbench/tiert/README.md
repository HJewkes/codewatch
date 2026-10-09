# tiert: Tier T Python subset

Test-shape checks for pytest functions (design unit U4). It uses only the standard library
and `ast`, and never imports or runs the code it reads.

```
python3 bench/scbench/tiert <root> [--out FILE] [--append]
python3 /opt/codewatch-a1/tiert <root> ...        # inside the A1 image
```

Without `--out`, rows go to stdout and the counts go to stderr. With `--out`, the counts are
the last stdout line, `{"items_in": <tests>, "items_out": <rows>, "signals": {...}}`, which
is the stage report line `stages.json` reads.

## Signals

One `findings.jsonl` row per test and signal: `tool` `tier-t`, `symbol` the test's name
(`Class.method` for methods), `path` relative to `<root>`, the `def` line to the last line,
and `severity` `warning`. `codewatch triage` asks the weak-oracle question for each signal.

| Signal | Meaning | `value` |
|---|---|---|
| `symbol_assertion_free` | No oracle in the test or in a helper it reaches within 4 calls. The evidence lists `@pytest.mark` markers, so a smoke policy can be read off the row | 1 |
| `symbol_weak_oracle_only` | Every oracle it reaches checks only shape (`.shape`, `.ndim`, `.dtype`, `len`), type, not-None, truthiness, or a value against itself | 1 |
| `symbol_duplicate_assert` | An assertion's text repeats an earlier one in the same test | repeats |
| `symbol_self_compare` | An equality assertion's two sides are the same expression | count |

An oracle is an `assert`, a `pytest.raises` / `warns` / `deprecated_call` / `fail`, or a
call whose name starts with `assert` or is `expect`.

**Tests** are pytest's default collection: `test*` functions and `test*` methods of `Test*`
classes, in `test_*.py` or `*_test.py` files.

**Helpers** are functions in the tree's test-role files (test files, `conftest.py`, and
anything under a `test`, `tests` or `testing` directory). A call resolves to one through a
same-file definition, `self.` / `cls.` methods (bases included), or an import of a
test-role module, absolute or relative. Calls into product code are not followed.

## Reference count

On linearmodels at `ec0f288906af00e1bada43b5a802a0c7a746c292` (`v7.0-82-gec0f288906`), the
commit the Tier T research measured, it finds 592 test functions and 26 assertion-free,
the research's count. To re-check:

```
git clone https://github.com/bashtage/linearmodels.git ~/.cache/tiert-linearmodels
git -C ~/.cache/tiert-linearmodels checkout ec0f288906
TIERT_LINEARMODELS=~/.cache/tiert-linearmodels pnpm test:bench
```

## Where it runs

The A1 image copies this directory to `/opt/codewatch-a1/tiert`, and `build.sh` checks it
gives 7 rows on `fixtures/flagged`. The `audit` stage in `agent/claude_code_cw.yaml` runs
`codewatch audit` and then appends these rows to its `findings.jsonl`.
