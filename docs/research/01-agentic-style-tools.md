# Agentic Style Tools Research

Research into existing tools, frameworks, and patterns designed to reproduce or enforce a developer's personal coding style.

---

## 1. Claude Code: Built-In Style Mechanisms

### 1.1 CLAUDE.md Files

**What it does:** CLAUDE.md is a Markdown file that Claude Code reads at the start of every session. It can encode personal coding preferences, project conventions, naming rules, tool choices, and workflow habits. Claude treats its contents as persistent instructions that apply to every interaction within scope.

**How it works:** Claude Code loads CLAUDE.md files from a hierarchy of locations:

| Location | Scope |
|---|---|
| `/Library/Application Support/ClaudeCode/CLAUDE.md` | Organization-wide (macOS) |
| `./CLAUDE.md` or `./.claude/CLAUDE.md` | Project, shared with team via source control |
| `./.claude/rules/*.md` | Modular project rules, support `paths:` frontmatter for file-scoped rules |
| `~/.claude/CLAUDE.md` | Personal, applies to all projects |
| `./CLAUDE.local.md` | Personal project-specific, excluded from git automatically |

Files higher in specificity take precedence. CLAUDE.md supports `@path/to/file` import syntax for composing from multiple sources (up to 5 hops deep). The `.claude/rules/` directory supports glob-scoped rules via YAML frontmatter — for example, a rule that only applies when Claude is editing files matching `src/api/**/*.ts`.

**What's good:**
- Zero overhead: write instructions once, they apply everywhere.
- Hierarchical: personal preferences compose cleanly with team/project conventions.
- Path-scoped rules allow language- or layer-specific style guidance.
- The `.claude/rules/` modular structure scales to large teams without a monolithic file.
- Symlinks are supported, so common rules can be shared across repos.

**What's limited:**
- Entirely manual: Claude does not observe your code and infer preferences automatically.
- Static text: no mechanism for rules to evolve or update themselves based on what you actually write.
- Context window pressure: everything loads at session start. Very large rule sets degrade quality elsewhere.
- No enforcement: instructions can be followed inconsistently; there is no hard rejection mechanism for violations.

**References:**
- [Manage Claude's memory – Claude Code Docs](https://code.claude.com/docs/en/memory)
- [How to Write a Good CLAUDE.md File – Builder.io](https://www.builder.io/blog/claude-md-guide)

---

### 1.2 Auto Memory

**What it does:** Auto memory is Claude's own persistent note-taking system. As Claude works, it records project patterns, debugging insights, architecture notes, and developer preferences to a directory at `~/.claude/projects/<project>/memory/`. These notes are loaded at the start of each subsequent session.

**How it works:** The memory directory contains a `MEMORY.md` index file (first 200 lines loaded automatically into the system prompt) and optional topic files (`debugging.md`, `api-conventions.md`, etc.) that Claude reads on demand. Claude writes to this directory during a session whenever it discovers something worth saving. The developer can also say "remember that we use pnpm, not npm" and Claude will write it explicitly.

**What's good:**
- Automatic capture: Claude can record style conventions it discovers during a session without the developer stopping to document them.
- Session continuity: preferences do not need to be re-stated at the start of every session.
- Editable: auto memory files are plain markdown; the developer can review, correct, or extend them at any time.
- The `/memory` command gives quick access to edit or toggle the feature.

**What's limited:**
- Still dependent on what happens to be discovered in a session, not a systematic analysis of the developer's entire codebase.
- The 200-line limit on automatic loading means only the index is guaranteed to be in context; topic files are loaded on demand, which Claude may or may not do proactively.
- No deduplication or conflict resolution: memory can drift from actual current conventions over time.
- Observation is opportunistic, not analytical — it captures what surfaces during work, not what characterizes the developer's overall style.

**References:**
- [Manage Claude's memory – Claude Code Docs](https://code.claude.com/docs/en/memory)
- [The Architecture of Persistent Memory for Claude Code – DEV Community](https://dev.to/suede/the-architecture-of-persistent-memory-for-claude-code-17d)

---

### 1.3 Output Styles

**What it does:** Output styles swap out Claude Code's main system prompt entirely, replacing it with a custom Markdown file that controls Claude's behavior, tone, and response structure. They are always active once selected, unlike skills which are invoked situationally.

**How it works:** Output styles are Markdown files with YAML frontmatter, stored at `~/.claude/output-styles/` (user-level) or `.claude/output-styles/` (project-level). Running `/output-style:new` scaffolds one from a description. A `keep-coding-instructions: true` flag retains the default coding-oriented system prompt alongside the custom instructions.

Built-in styles: `default`, `explanatory` (adds educational insights between code), `learning` (collaborative, leaves TODO markers for the developer to fill).

**What's good:**
- Most powerful customization available: controls the entire system prompt, not just an appended note.
- Can encode a developer's preferred communication contract (verbose/terse, opinionated/neutral, directive/collaborative).
- Composable with skills and CLAUDE.md — styles affect *how* Claude responds while skills affect *what* Claude does.

**What's limited:**
- Primarily addresses communication style (how Claude talks), not code style (what code Claude writes).
- Custom output styles drop coding instructions by default; using `keep-coding-instructions: true` is easy to forget.
- No style learning: the developer must author the entire style file from scratch or scaffold and manually edit it.
- Switching styles requires a deliberate action; there is no automatic style detection.

**References:**
- [Output styles – Claude Code Docs](https://code.claude.com/docs/en/output-styles)
- [Claude Code now lets you customize its communication style – Tessl](https://tessl.io/blog/claude-code-now-lets-you-customize-its-communication-style/)

---

### 1.4 Hooks

**What it does:** Hooks are shell commands or LLM prompts that fire automatically at specific lifecycle events in a Claude Code session. They can intercept, validate, block, or respond to Claude's tool calls — including file edits.

**How it works:** Hooks are configured in `.claude/settings.json` (project-level) or `~/.claude/settings.json` (user-level). Each hook listens to a lifecycle event (`PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, etc.), optionally filtered by a matcher (e.g., only fire on the `Write` tool). The hook receives JSON context on stdin and can return decisions (`allow`, `deny`, inject feedback).

For style enforcement, the typical pattern is a `PostToolUse` hook on file-write events that runs a linter or formatter and either auto-corrects output or returns an error message to Claude, which then attempts a fix.

**What's good:**
- Hard enforcement: hooks can block or force-correct style violations programmatically, unlike CLAUDE.md which is advisory.
- Composable with any existing linter (ESLint, Prettier, Ruff, etc.) — no new tooling required.
- Fires on every relevant tool use, not just when explicitly invoked.
- Feedback loop: rejection messages from hooks are fed back to Claude, allowing self-correction within the same session.

**What's limited:**
- Requires authoring and maintaining hook scripts — not zero-cost to set up.
- Linters encode known, enumerable rules. They cannot enforce emergent or personal style preferences that are not already captured in a linter config.
- Hooks operate on the output of Claude's tool calls, not upstream in generation — style correction is reactive, not preventive.
- No style inference: the hook knows what the linter says, not what the developer's codebase actually looks like.

**References:**
- [Hooks reference – Claude Code Docs](https://code.claude.com/docs/en/hooks)
- [Forcing Claude Code to Reliably Pass Lint with Lefthook – Liam ERD](https://liambx.com/blog/ai-agent-lint-enforcement-lefthook-claude-code)

---

### 1.5 Self-Improve Skill (Local)

**What it does:** A user-authored skill at `~/.claude/skills/self-improve/` that runs a session learning loop: after a productive session, it reviews what was learned (patterns, techniques, corrected mistakes), classifies each learning by destination, and proposes changes for approval before writing anything.

**How it works:** The skill uses a routing table (priority 1–5) to assign each learning to the right place:
1. Update an existing skill
2. Create a new skill
3. Add to project CLAUDE.md
4. Write to auto memory
5. Add to global CLAUDE.md (last resort)

Changes are drafted and presented for explicit user approval. The key design rule is: "the instinct to put things in ~/CLAUDE.md is usually wrong" — learnings should go to the most focused scope available.

**What's good:**
- Surfaced at the right time: invoked after productive sessions, not continuously.
- Approval gate: no auto-apply; the developer stays in control.
- Routes to the right level of scope — avoids polluting global config with project-specific rules.
- Session-to-session knowledge accumulation is explicit and auditable.

**What's limited:**
- Reactive, not analytical: only captures what surfaced during work, not what could be inferred from the codebase.
- Relies on the developer remembering to invoke it ("learn from this" or similar trigger phrase).
- Cannot analyze existing code to bootstrap style knowledge — starts from zero.
- No conflict detection across sessions: accumulated memory can become inconsistent over time.

---

### 1.6 Community Memory Plugins

Two notable third-party plugins extend Claude Code's memory for style-adjacent use:

**claude-mem** (`github.com/thedotmack/claude-mem`): A lifecycle-hook plugin that captures all tool activity during sessions, compresses it with AI, and stores it in a local SQLite database with vector embeddings. Future sessions can query project history via natural language search (~10x token efficiency through filtered retrieval). Focuses on *project continuity* (what happened) rather than *style* (how code is written).

**claude-supermemory** (`github.com/supermemoryai/claude-supermemory`): Integrates Claude Code with the Supermemory cloud service to persist and search session context across projects. Can index codebase architecture and patterns with `/claude-supermemory:index`. Distinguishes personal vs. team memories. Requires a paid Supermemory Pro subscription.

**What's limited (both):** Neither tool analyzes a developer's existing codebase to infer style. They capture what happens during sessions, which is better continuity but not style learning from first principles.

**References:**
- [claude-mem – GitHub](https://github.com/thedotmack/claude-mem)
- [claude-supermemory – GitHub](https://github.com/supermemoryai/claude-supermemory)

---

## 2. Claude Code: Skills Ecosystem

### 2.1 What Exists in the Wild

A search across major community repositories (`hesreallyhim/awesome-claude-code`, `travisvn/awesome-claude-skills`, `ComposioHQ/awesome-claude-skills`, `VoltAgent/awesome-agent-skills`) found **no published skills explicitly focused on learning or reproducing a developer's personal coding style**.

The skills ecosystem is rich in workflow automation (PR review, git branching, CI checks), domain knowledge (frontend design, testing, security), and tool integrations (Buildkite, Jira, GitHub). Style-related skills are nearly absent.

The closest adjacent skill type is the **frontend-design** skill (present in the user's local skills at `~/.claude/skills/frontend-design/`). This skill encodes strong aesthetic opinions about UI work — it instructs Claude to choose a bold aesthetic direction, avoid generic "AI slop" aesthetics, and consult reference files for typography, color, and motion guidelines. This is style encoding as *curated instruction* rather than *learned inference*, but it demonstrates the pattern.

**Gap identified:** There is no published skill that takes an existing codebase as input, analyzes its patterns, and generates a style profile for Claude to follow. This is a clear gap.

---

## 3. Cursor

**What it does:** Cursor is a VS Code fork with deep AI integration. Its rules system lets developers encode persistent coding conventions that are injected into the model context for every relevant interaction.

**How it works:** Rules are stored as `.mdc` files inside `.cursor/rules/` (the older `.cursorrules` format is deprecated). Each rule file is a system-prompt-style document — naming conventions, file organization, type safety requirements, commit message format, library preferences, etc. Rules can be scoped to specific file types or directories. When the matcher fires, rule contents are prepended to the model context.

Cursor also maintains implicit context from open files and recently edited code, giving the model local codebase awareness during completions.

**What's good:**
- Rules are composable and version-controlled with the project.
- Huge community catalog (`PatrickJS/awesome-cursorrules`) of pre-built rule sets for popular stacks.
- File-type scoping allows language-specific style rules.
- Reported 50% reduction in style-related PR comments in at least one team adopting project rules.
- Completion model implicitly adapts to local file patterns — if all your existing functions use a certain signature shape, new completions tend to match.

**What's limited:**
- Rules are still manually authored; Cursor does not infer style from existing code.
- No persistent session memory: the model does not accumulate knowledge about what the developer accepted or rejected over time.
- Rule quality depends entirely on the author; vague rules produce inconsistent results.
- Implicit style matching from local context is shallow — it follows patterns visible in the open file, not patterns across the entire codebase.

**References:**
- [Cursor – Rules](https://docs.cursor.com/context/rules)
- [awesome-cursorrules – GitHub](https://github.com/PatrickJS/awesome-cursorrules)
- [Cursor IDE Rules for AI – Kirill Markin](https://kirill-markin.com/articles/cursor-ide-rules-for-ai/)

---

## 4. GitHub Copilot

### 4.1 Custom Instructions

**What it does:** Copilot supports personal instructions (github.com level), repository instructions (`.github/copilot-instructions.md`), and organization instructions. Personal instructions have highest priority. These apply to all Copilot chat interactions and to the Coding Agent.

**How it works:** Instructions are plain text documents describing the developer's preferences — preferred libraries, naming conventions, commit message format, response language, coding style. Copilot incorporates them as system-level context for completions and chat.

**What's good:**
- Three-level hierarchy (personal → repo → org) allows fine-grained scoping.
- Personal instructions persist across all projects on github.com without per-project setup.
- No code changes required — Copilot reads the instruction file and adapts.

**What's limited:**
- Completely manual: Copilot does not analyze the repository and propose instructions.
- File length limit: instruction files should be kept under ~1,000 lines for reliable processing.
- Instructions influence but do not enforce: Copilot cannot guarantee style compliance.
- No learning from accept/reject signals on completions.

### 4.2 Implicit Style Matching (Completions)

Copilot's completion model implicitly tries to match the style visible in the current file. If the surrounding code uses a particular pattern, completions tend to follow it. This is a property of how the model was trained (next-token prediction on real codebases) rather than a dedicated style-matching feature.

GitHub has also launched enterprise-tier **fine-tuned models**: organizations can fine-tune Copilot on their private codebase using LoRA adapters (limited public beta as of late 2024), trained with the Fill-in-the-Middle objective. Fine-tuned models can learn internal API names, proprietary patterns, and team-specific idioms that no standard instruction file could encode.

**What's limited (fine-tuning):** Requires enterprise tier (expensive), significant data collection effort, ongoing maintenance as the codebase evolves, and does not adapt to individual developer style — only team-level patterns in the training corpus.

**References:**
- [Personal custom instructions for Copilot – GitHub Changelog](https://github.blog/changelog/2025-03-06-personal-custom-instructions-for-copilot-are-now-generally-available-on-github-com/)
- [Adding personal custom instructions for GitHub Copilot – GitHub Docs](https://docs.github.com/copilot/customizing-copilot/adding-personal-custom-instructions-for-github-copilot)
- [Fine-tuned models for GitHub Copilot Enterprise – GitHub Blog](https://github.blog/news-insights/product-news/fine-tuned-models-are-now-in-limited-public-beta-for-github-copilot-enterprise/)

---

## 5. Windsurf (Codeium)

**What it does:** Windsurf is an AI-native IDE built on VS Code. Its Cascade AI system includes a **Memories** feature that explicitly persists context and preferences across sessions, including inferred coding style preferences.

**How it works:**
- **Wave 1:** Explicit memories — developer tells Cascade to "remember" specific things (preferred APIs, communication style, architectural decisions). Stored in a persistent database, recalled in future sessions.
- **Wave 2:** Automatic memories — Cascade observes how the developer codes and autonomously adds memories based on patterns it detects. This happens passively, without requiring explicit instruction.

The system distinguishes user-generated rules (explicit) from automatically generated memories (inferred), and maintains both.

**What's good:**
- Wave 2 automatic learning is the closest thing to genuine style inference in any commercially available tool: the system watches and learns rather than waiting to be told.
- Memories persist across sessions without developer action.
- Reported 78% accuracy in matching existing code patterns (naming conventions, component structure, variable names) on a tested 50,000-line React/Node.js project.
- Both explicit and implicit memories coexist in the same system.

**What's limited:**
- Automatic memory learning takes ~48 hours of initial analysis — not immediate.
- 78% accuracy means roughly 1 in 5 suggestions still mismatches the existing style.
- The memory system is opaque: it is not clear exactly what was learned, what patterns were detected, or why a particular suggestion was made.
- Memories can drift or conflict as the codebase evolves.
- Tied to the Windsurf IDE and Cascade model; not portable to other tools.

**References:**
- [Windsurf Wave 2 now memorizes your preferred coding styles – Neowin](https://www.neowin.net/news/windsurf-wave-2-now-memorizes-your-preferred-coding-styles-for-its-suggestion/)
- [Understanding Windsurf's Memories System – Arsturn](https://www.arsturn.com/blog/understanding-windsurf-memories-system-persistent-context)

---

## 6. Aider

**What it does:** Aider is an open-source CLI coding agent. It supports explicit convention files that define the developer's preferred style, library choices, and type annotation preferences. These are loaded as read-only context in every session.

**How it works:** Create any Markdown file documenting conventions (e.g., `CONVENTIONS.md`), then load it with `aider --read CONVENTIONS.md` or configure it permanently in `.aider.conf.yml` under the `read:` key. Aider uses prompt caching when the convention file is loaded as read-only, improving efficiency. The community maintains a conventions repository with shareable, pre-authored convention files for common stacks and preferences.

**What's good:**
- Simple, portable, explicit: works with any LLM backend Aider supports (Claude, GPT-4, Gemini, etc.).
- Prompt caching reduces the cost of including large convention documents in every session.
- Community conventions repository means developers can start from existing, well-tested style documents.
- Open-source: fully auditable and extensible.

**What's limited:**
- Entirely manual: Aider does not infer conventions from the existing codebase.
- The convention file must be maintained by hand as preferences evolve.
- No session-to-session learning: each session starts from the same static document.
- Enforcement is advisory — the LLM may deviate from conventions despite instructions.

**References:**
- [Specifying coding conventions – Aider docs](https://aider.chat/docs/usage/conventions.html)

---

## 7. JetBrains Junie

**What it does:** Junie is JetBrains' autonomous coding agent. It uses a `.junie/guidelines.md` file to specify coding style, best practices, and architecture preferences. Crucially, it can also *generate* this file by analyzing the existing codebase.

**How it works:** Place style rules in `.junie/guidelines.md`. Junie reads this file before generating code and applies the guidelines without requiring them in every prompt. The key differentiator: running "create a guidelines.md that captures the coding conventions in this codebase" causes Junie to analyze the existing code and produce an initial guidelines document. JetBrains also provides a public `junie-guidelines` repository with technology-specific guideline templates.

**What's good:**
- Codebase-derived guidelines: Junie can bootstrap a style document from real code, which no other tool in this survey does out of the box at the guidelines level.
- Guidelines persist without repetition in every prompt.
- Community guideline catalog provides starting points for common technologies.
- Tight IDE integration (IntelliJ IDEA, PyCharm, etc.).

**What's limited:**
- The quality of auto-generated guidelines depends on how consistently the existing codebase already follows conventions — noisy codebases produce noisy guidelines.
- Generated guidelines are a one-time snapshot; they do not update automatically as the codebase evolves.
- Enforcement is still advisory: generating code that violates guidelines requires the developer to notice and correct.
- Tied to JetBrains IDEs.

**References:**
- [Coding Guidelines for Your AI Agents – JetBrains Blog](https://blog.jetbrains.com/idea/2025/05/coding-guidelines-for-your-ai-agents/)
- [Meet Junie – JetBrains Blog](https://blog.jetbrains.com/junie/2025/01/meet-junie-your-coding-agent-by-jetbrains/)

---

## 8. Sourcegraph Cody

**What it does:** Cody is a code AI assistant that uses Sourcegraph's code graph and semantic search to provide codebase-aware completions and chat. Its style-related capability comes from deep codebase indexing rather than explicit style instructions.

**How it works:** Cody indexes the entire codebase into a code graph with symbolic relationships (not just text search). Completions use graph context: if a function is defined elsewhere in the codebase, Cody finds and incorporates that pattern. A shared prompt library allows teams to encode and reuse style-relevant prompts. Enterprise customers can reference entire repositories as context.

**What's good:**
- Whole-codebase context is Cody's core differentiator: suggestions are grounded in actual patterns from the full repository, not just the current file.
- Code graph awareness means suggestions respect existing abstractions and naming patterns.
- Shared prompt library enables team-level style encoding.

**What's limited:**
- Cody does not have an explicit "style profile" concept; style matching is an emergent side-effect of codebase context.
- No personal preference learning — no persistent memory of what a specific developer accepted or rejected.
- Primarily enterprise-focused; the codebase context feature is most powerful at that scale.

**References:**
- [What is Cody – Sourcegraph docs](https://docs.sourcegraph.com/cody)
- [Sourcegraph Cody – Real Python](https://realpython.com/ref/ai-coding-tools/sourcegraph-cody/)

---

## 9. Qodo (formerly CodiumAI)

**What it does:** Qodo is an AI code integrity platform focused on code review, testing, and style enforcement. Its Rules System encodes team standards and applies them automatically on every PR.

**How it works:** Teams define rules for style, architecture patterns, security, and compliance. These run as automated checks during code review in the IDE and at PR time. The **Rules Discovery Agent** (introduced 2025–2026) automatically generates rules by analyzing the existing codebase and past PR feedback — finding real patterns, not just what a developer thinks their conventions are.

**What's good:**
- Rules Discovery Agent is an interesting approach: it infers style conventions from actual code and review decisions, not from manually authored documentation.
- Rules apply consistently at PR time, creating a hard gate rather than advisory suggestions.
- Automatic rule maintenance: the Rules Expert Agent monitors rules for conflicts and staleness.
- Team-wide scope: once defined, rules apply to all contributors and all services.

**What's limited:**
- Primarily a code review tool, not a code generation tool — it flags violations after the fact rather than guiding generation proactively.
- Rule quality depends on the quality of the existing codebase and past review decisions.
- Requires integrating into the PR workflow; not per-developer style preference learning.
- No individual developer style profiles — enforces team conventions, not personal style.

**References:**
- [Qodo unveils AI-driven governance system – Help Net Security](https://www.helpnetsecurity.com/2026/02/18/qodo-rules-system-ai-governance/)
- [Qodo 2.1 adds AI-driven rules for smarter code review – IT Brief](https://itbrief.com.au/story/qodo-2-1-adds-ai-driven-rules-for-smarter-code-review)

---

## 10. Personal Copilot via Fine-Tuning (Hugging Face)

**What it does:** A Hugging Face tutorial demonstrates fine-tuning an open code model (StarCoder) on a specific codebase using QLoRA, creating a model that generates code in the style of that codebase. The result is a personalized code completion assistant embedded in VS Code.

**How it works:**
1. Clone target repositories locally.
2. Filter to code files only (exclude images, assets, generated files).
3. Fine-tune StarCoder using QLoRA on a single A100 GPU (~12.5 hours, ~$14).
4. Deploy via Hugging Face Inference Endpoints; configure VS Code extension to use the custom endpoint.

Multiple LoRA adapters can be composed: a `copilot` adapter (trained on a specific codebase for completions) combined with an `assistant` adapter (trained for chat/QA) produces a model that can both complete code in the target style and answer questions about it.

**What's good:**
- The most direct implementation of "learn this codebase's style and generate in it": the model weights literally encode the patterns.
- QLoRA is accessible (single GPU, under $15 for a 1B parameter model) — genuinely feasible for individuals, not just enterprises.
- Adapter composition is powerful: style knowledge and general reasoning can coexist in one model.
- No context window overhead: style knowledge is baked into weights, not loaded as text at each session.

**What's limited:**
- Significant technical overhead: requires data collection, training, deployment, and ongoing maintenance.
- Static: once trained, the model's style knowledge is frozen at training time. As the codebase evolves, the model goes stale.
- No dynamic learning: does not adapt to what the developer accepts or rejects session by session.
- Fine-tuning improves style but does not guarantee correctness — HumanEval pass rate was essentially unchanged (33.57% → 33.37%) in the Hugging Face experiment.
- Not integrated with any agentic workflow — this is an autocomplete improvement, not an agent capability.

**References:**
- [Personal Copilot: Train Your Own Coding Assistant – Hugging Face](https://huggingface.co/blog/personal-copilot)
- [Fine-tuning a Code LLM on Custom Code on a single GPU – Hugging Face Cookbook](https://huggingface.co/learn/cookbook/en/fine_tuning_code_llm_on_single_gpu)

---

## 11. Style2Code (Research)

**What it does:** An academic framework (arXiv:2505.19442, May 2025) for style-controllable code generation. Given a reference code sample encoding a target style, the model generates new code that matches that style — same naming conventions, indentation patterns, structural layout — while correctly implementing the requested functionality.

**How it works:** A dual-modal contrastive learning approach:
1. Stage 1: Train a style encoder that maps code samples to continuous style vectors capturing naming conventions, indentation, structural layout, and utility function preferences.
2. Stage 2: Fine-tune a language model (Flan-T5) conditioned on the style vector, guiding generation to match the encoded style.

Style vectors can be interpolated (blend two styles) or mixed for personalization. The method achieves style transfer without user-specific retraining — a single model can serve many style targets.

**What's good:**
- The style vector representation is explicit and separable: style is encoded independently from semantics.
- Style interpolation enables nuanced control — not just "match this style" but "blend these two styles with these weights."
- No per-user fine-tuning required: the trained model generalizes to new style references via the encoding.
- CSS (Code Style Similarity) score of 0.910, 12.3% relative improvement over the strongest baseline — demonstrates meaningful style fidelity.

**What's limited:**
- Research prototype, not a shipping product. No public deployment or integration with developer tooling.
- Style is inferred from code samples provided at inference time, not from long-term session history or interaction patterns.
- Small base model (Flan-T5): competitive with baselines on style metrics but not necessarily with modern LLMs on reasoning or correctness.
- Evaluated on narrow style dimensions (naming, indentation, structure) — does not capture higher-level architectural patterns or idiomatic preferences.

**References:**
- [Style2Code – arXiv:2505.19442](https://arxiv.org/abs/2505.19442)

---

## Summary Comparison

| Tool / Feature | Style Source | Learning | Enforcement | Persistence | Scope |
|---|---|---|---|---|---|
| CLAUDE.md | Manual text | None | Advisory | Permanent | Personal / Project |
| Claude Auto Memory | Session observation | Opportunistic | Advisory | Per-project | Personal |
| Claude Output Styles | Manual authoring | None | System prompt | Until changed | Personal / Project |
| Claude Hooks | Linter output | None | Hard (block/correct) | Configuration | Project / Personal |
| Self-Improve Skill | Session reflection | Explicit approval | Advisory | Manual | Personal |
| Cursor Rules (.mdc) | Manual text | None | Advisory | Per-project | Project / Personal |
| GitHub Copilot Instructions | Manual text | None | Advisory | Personal account | Personal / Repo / Org |
| Copilot Fine-tuning (enterprise) | Codebase training data | One-time | Weights-baked | Static after training | Org |
| Windsurf Memories | Session observation + auto analysis | Automatic (Wave 2) | Advisory | Cross-session | Personal |
| Aider CONVENTIONS.md | Manual text | None | Advisory | Per-session (configured) | Project |
| JetBrains Junie Guidelines | Manual or codebase-derived | One-time snapshot | Advisory | Per-project | Project |
| Sourcegraph Cody | Codebase index | None | Advisory | Codebase-lifetime | Project |
| Qodo Rules System | Codebase + PR history | Automatic (discovery agent) | Hard (PR gate) | Ongoing | Team |
| Personal Copilot (fine-tuned) | Codebase training data | One-time | Weights-baked | Static after training | Personal / Project |
| Style2Code (research) | Reference code sample | Contrastive learning | Weights + conditioning | Model-lifetime | Generalizable |

---

## Key Gaps Identified

1. **No tool analyzes an existing codebase and automatically generates a comprehensive personal style profile for use in agentic workflows.** JetBrains Junie gets closest with its one-time guideline generation, but the result is a static document, not a live profile.

2. **Style learning and style enforcement are almost always separate concerns.** Tools that can learn style (Windsurf auto memories, Qodo rules discovery, fine-tuning) do not use that knowledge to guide generation from the start; tools that enforce style (Claude hooks, Qodo PR gates, linters) cannot learn new style rules automatically.

3. **No tool captures a developer's individual style at the level of personal idiosyncrasies** — micro-patterns like preferred loop styles, comment density and format, how errors are handled, naming patterns across different contexts. The available approaches capture what is enumerable (naming conventions, indentation) but miss what is stylistic in the deeper sense.

4. **Persistence is shallow.** Most tools rely on the current session's context. Tools with real persistence (auto memory, Windsurf memories) still lack a mechanism to systematically reconcile new observations with accumulated knowledge, or to detect when old style knowledge no longer applies.

5. **The gap between style description and style reproduction is large.** Instruction-based approaches (CLAUDE.md, rules) require the developer to articulate their preferences in words — which most developers cannot do accurately for their own code. Style2Code and fine-tuning address this by learning directly from code, but neither is available in a practical, integrated form for individual developers.
