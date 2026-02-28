# Open Source Landscape: Code Style Learning, Authorship, and Pattern Detection

**Research date:** 2026-02-27
**Scope:** Open source projects that learn, analyze, reproduce, or exploit a developer's personal coding style. Covers style learning tools, authorship attribution, convention extraction, consistency checkers, clone/pattern detection, and AI-based style transfer.

---

## Table of Contents

1. [Code Style Learning Tools](#1-code-style-learning-tools)
   - 1.1 Naturalize (mast-group)
   - 1.2 JSNice / Nice2Predict (ETH SRI Lab)
   - 1.3 UnuglifyJS (ETH SRI Lab)
   - 1.4 HowYouCode
2. [Code Authorship Attribution](#2-code-authorship-attribution)
   - 2.1 CodeStylometry (calaylin)
   - 2.2 CoderID (danielWatson3141)
   - 2.3 JetBrains Research: Authorship Detection
   - 2.4 AuthAttLyzer / AuthAttLyzer-V2 (ahlashkari)
   - 2.5 RoPGen (ICSE 2022)
   - 2.6 Forsee (ISSTA 2024)
   - 2.7 Code-Imitator (adversarial attack)
3. [Automated Convention / Config Extraction](#3-automated-convention--config-extraction)
   - 3.1 ECLint
   - 3.2 editorconfig-tools (notslang)
   - 3.3 CodRep Competition (ASSERT-KTH)
4. [Code Consistency and Internal Pattern Checkers](#4-code-consistency-and-internal-pattern-checkers)
   - 4.1 Semgrep
   - 4.2 ast-grep
   - 4.3 Hound CI
   - 4.4 reviewdog
5. [Code Clone and Pattern Detection](#5-code-clone-and-pattern-detection)
   - 5.1 PMD / CPD
   - 5.2 jscpd
   - 5.3 NiCad (Open-NiCad)
   - 5.4 GumTree / gumtree-spoon-ast-diff
6. [AI-Based Code Style Transfer and Representation](#6-ai-based-code-style-transfer-and-representation)
   - 6.1 code2vec / code2seq (tech-srl)
   - 6.2 CodeBERT / UniXcoder (Microsoft)
   - 6.3 MISIM (IntelLabs)
   - 6.4 Microsoft Visual Studio IntelliCode (Team Completions)
   - 6.5 Tabnine (codota)
7. [Research Infrastructure and Surveys](#7-research-infrastructure-and-surveys)
   - 7.1 ML for Big Code and Naturalness (ml4code)
   - 7.2 src-d: Awesome Machine Learning on Source Code
   - 7.3 Joern (Code Property Graphs)
8. [Summary Table](#8-summary-table)
9. [Key Takeaways and Relevance](#9-key-takeaways-and-relevance)

---

## 1. Code Style Learning Tools

### 1.1 Naturalize (mast-group)

- **GitHub:** https://github.com/mast-group/naturalize
- **Paper:** "Learning Natural Coding Conventions" (Allamanis & Sutton, FSE 2014)
- **Stars:** 56
- **Status:** Archived June 2021 (read-only)
- **Language:** Java (99.6%), BSD-3-Clause

**What it does:** Naturalize is a language-agnostic framework that learns coding conventions from a codebase—primarily identifier naming and formatting—and suggests revisions to improve stylistic consistency. It was one of the first tools explicitly designed to learn a project's own conventions rather than enforce a fixed external standard.

**How it works:**
- Uses n-gram language models trained on a target codebase's own token sequences
- Models the probability of identifier names in context (their surrounding tokens form the "context")
- Proposes high-confidence renamings when a different identifier would be more "natural" given the learned model
- Ships three CLI tools: `styleprofile` (profile files and retrieve suggestions), `naturalizecheck` (pre-commit hook wrapper), and a `devstyle` Eclipse plugin

**What we can learn from it:** This is the clearest academic precedent for the idea of "learn style from the codebase itself." The n-gram approach is simple but interpretable. The pre-commit hook integration pattern is directly reusable. The authors successfully submitted 18 patches to evaluation projects; 4 were merged—validating the approach produces real, non-trivial suggestions.

---

### 1.2 JSNice / Nice2Predict (ETH SRI Lab)

- **JSNice live tool:** http://jsnice.org/
- **Nice2Predict GitHub:** https://github.com/eth-sri/Nice2Predict
- **Paper:** "Predicting Program Properties from Big Code" (Raychev et al., POPL 2015)
- **Stars:** 218 (Nice2Predict)
- **Status:** Inactive since February 2021 (last commit)
- **Language:** C++ (57.8%), JavaScript (34.9%), Apache-2.0

**What it does:** JSNice is a statistical predictor for JavaScript: given minified/obfuscated code, it renames variables to human-meaningful names learned from thousands of open source projects. It also predicts type annotations. In its first week it was used by 30,000+ developers.

**How it works:**
- Extracts features from JavaScript ASTs representing relationships between identifiers and their usage contexts
- Frames prediction as structured prediction using Conditional Random Fields (CRFs)
- Nice2Predict is a general server-side framework for training and serving predictions; JSNice is one client
- Training corpus: large body of public JavaScript on GitHub

**What we can learn from it:** CRFs and probabilistic graphical models for joint prediction across all identifiers in a file (rather than identifier-by-identifier). The insight that naming is a structured problem—the names of two related variables should be predicted together—is relevant for holistic style suggestion.

---

### 1.3 UnuglifyJS (ETH SRI Lab)

- **GitHub:** https://github.com/eth-sri/UnuglifyJS
- **Stars:** Not prominently listed (older research repo)
- **Status:** Inactive (research prototype)
- **Language:** JavaScript (built on UglifyJS 2)

**What it does:** Open-source reimplementation of JSNice's deminification capability. Renames JavaScript variables and parameters to statistically likely names based on a model trained on open source projects.

**How it works:**
- Identifies "unknown properties" (local variables) vs. "known properties" (globals, DOM APIs)
- Extracts features as JSON representing relationships between code elements
- Calls a running Nice2Predict server to get predictions
- Supports both Node.js CLI and browser use

**What we can learn from it:** Shows how to separate the feature extraction (JavaScript-specific) from the model server (language-agnostic). The JSON-based intermediate representation for passing features to a prediction server is a clean integration pattern.

---

### 1.4 HowYouCode

- **Website:** https://howyoucode.dev/
- **Source code:** Not publicly available (closed source web service)
- **Status:** Active as of 2026

**What it does:** Analyzes a developer's real GitHub repositories to generate a "developer fingerprint"—a scored profile across 8 coding quality dimensions.

**How it works:**
- GitHub OAuth integration; analysis runs in-browser (no source sent to servers)
- Evaluates 8 dimensions: Comment Ratio, Small Functions, Error Handling, Naming Consistency, Low Complexity, Cleanliness, Language Diversity, Modularity
- Uses language-aware scoring calibrated per language (import patterns, naming conventions, error patterns)
- Produces a Code Score (0–100, pure quality) and Dev Score (combines quality with activity)

**What we can learn from it:** The 8 dimensions it scores are a reasonable, human-interpretable decomposition of "coding quality" that maps well to stylometric features we might extract. The browser-side privacy model (no source uploaded) is worth noting as a user trust design.

---

## 2. Code Authorship Attribution

### 2.1 CodeStylometry (calaylin)

- **GitHub:** https://github.com/calaylin/CodeStylometry
- **Paper:** "De-anonymizing Programmers via Code Stylometry" (Caliskan-Islam et al., USENIX Security 2015)
- **Status:** Old research artifact, no recent activity
- **Language:** Java (96.3%), Python (3.7%)

**What it does:** Implements programmer de-anonymization from C/C++ source code. Identifies authorship via stylometric classification, achieving 98% accuracy on 250-class closed-world tasks and 93% on 1,600-class tasks.

**How it works:**
- Uses Joern and python-joern to extract code property graphs and ASTs
- Extracts three feature categories:
  - **Syntactic features**: AST node type distributions
  - **Layout/lexical features**: indentation, spacing, naming, token distributions
  - **Semantic features**: dependency analysis
- Exports features in ARFF format for WEKA-based random forest classification
- Attribute selection to identify the most discriminating features

**What we can learn from it:** The three-category feature taxonomy (syntactic, layout/lexical, semantic) is the canonical decomposition for code stylometry and maps directly to what a style learner would need to capture. The specific feature types extracted (AST node distributions, indentation patterns) are a practical starting checklist.

---

### 2.2 CoderID (danielWatson3141)

- **GitHub:** https://github.com/danielWatson3141/coderID
- **Stars:** 3
- **Status:** Last commit September 2023 (nominally active but "not entirely functional")
- **Language:** Python

**What it does:** Source code authorship attribution prototype offering a module and CLI for source-code stylometry. Extracts stylistic features and uses ML classification to attribute authorship.

**How it works:**
- AST-based feature extraction
- Stylometric feature profiles per author
- Classification via ML models

**What we can learn from it:** Lightweight Python reference implementation of authorship attribution that could be studied for feature extraction patterns. The project explicitly acknowledges it is "under active development" and incompletely documented—useful as a research starting point, not a library to depend on.

---

### 2.3 JetBrains Research: Authorship Detection

- **GitHub:** https://github.com/JetBrains-Research/authorship-detection
- **Stars:** 23
- **Status:** Most active 2019–2020, sparse since
- **Language:** Python (Gitminer), Kotlin (Pathminer)

**What it does:** Research evaluation of code2vec-based authorship identification. Explores and attempts to fix problems with existing authorship attribution datasets.

**How it works:**
- **Gitminer** (Python): processes Git repository histories, extracts Java code blobs across commit history
- **Pathminer** (Kotlin): uses GumTree to parse code and track method changes across commits
- Extracts path-contexts from ASTs for code2vec input
- Compares code2vec-based neural network (PbNN) vs. random forest (PbRF) vs. stylometry-based (JCaliskan) methods
- Validates with context-separation and time-separation strategies

**What we can learn from it:** The Git history mining approach—extracting per-author code blobs from commit history—is directly applicable for building a personal style corpus from a developer's own repos. The comparison of code2vec vs. random forest vs. classic stylometry provides empirical guidance on which approach is strongest.

---

### 2.4 AuthAttLyzer / AuthAttLyzer-V2 (ahlashkari)

- **GitHub:** https://github.com/ahlashkari/AuthAttLyzer
- **Papers:** ICCNS 2022 (v1), arXiv 2406.19896 (v2, 2024)
- **Status:** Active research; V2 published 2024
- **Language:** Python

**What it does:** Feature extraction framework for Source Code Authorship Attribution (SCAA) of C/C++ code. V2 incorporates 54 distinct features covering lexical, semantic, syntactic, and N-gram categories.

**How it works (V2):**
- Extracts AST-based language-dependent features
- Extracts language-independent N-gram and word-based embedding features
- Classification via Random Forest, Gradient Boosting, XGBoost
- Uses SHAP (SHapley Additive exPlanations) for feature interpretability
- Evaluated on BCCC-AuthAtt-2024 dataset: 24,000 samples from 3,000 C++ authors

**What we can learn from it:** The 54-feature taxonomy is among the most comprehensive publicly documented feature sets for code stylometry. The SHAP interpretability integration is directly applicable—if we build a style learner, SHAP can explain which features are most characteristic of a specific developer.

---

### 2.5 RoPGen (ICSE 2022)

- **GitHub:** https://github.com/RoPGen/RoPGen
- **Paper:** "RoPGen: Towards Robust Code Authorship Attribution via Automatic Coding Style Transformation" (ICSE 2022)
- **Stars:** 16
- **Status:** Research artifact, limited recent activity
- **Language:** Python, Java

**What it does:** Improves robustness of deep learning-based code authorship attribution against adversarial attacks. Uses 23 style attributes and gradient augmentation to learn style patterns that are hard for attackers to manipulate.

**How it works:**
- Defines 23 style attributes across C and Java
- Combines data augmentation (diverse training examples) with gradient augmentation (focus on hard-to-manipulate patterns)
- Introduces two attack modes: coding style imitation and hiding
- Achieves 22.8% reduction in targeted attack success rate and 41.0% reduction in untargeted

**What we can learn from it:** The explicit enumeration of 23 style attributes is a practical reference. The adversarial framing also defines which style features are most robust/stable across a developer's work (i.e., which features a developer cannot easily suppress)—these are the most reliable signals for style learning.

---

### 2.6 Forsee (ISSTA 2024)

- **GitHub:** https://github.com/keepTheFlowerOfTime/Forsee
- **Paper:** "Enhancing Robustness of Code Authorship Attribution through Expert Feature Knowledge" (ISSTA 2024)
- **Status:** Recent (2024), research artifact
- **Language:** Python

**What it does:** Addresses dataset bias in authorship attribution by combining expert-defined features with shallow neural networks, achieving significantly improved robustness over mainstream methods.

**How it works:**
- Expert knowledge guides feature extraction rather than relying solely on learned representations
- Simple shallow network architecture with controllable feature learning
- Achieves 23.4% average drop in targeted attack success rate and 25.9% in untargeted

**What we can learn from it:** The "expert feature knowledge" approach—hybridizing hand-crafted stylometric features with learned representations—is more interpretable and robust than pure deep learning. This validates a hybrid approach for a style learner: extract known features explicitly, then learn residual patterns.

---

### 2.7 Code-Imitator (adversarial attack)

- **GitHub:** https://github.com/EQuiw/code-imitator
- **Paper:** "Misleading Authorship Attribution of Source Code using Adversarial Learning" (USENIX Security 2019)
- **Stars:** 32
- **Status:** Research artifact, 16 commits total
- **License:** GPL-3.0

**What it does:** Adversarial attack against ML-based code authorship attribution. Deceives attribution systems by applying semantics-preserving code transformations guided by Monte-Carlo tree search.

**How it works:**
- Transforms code using semantics-preserving operations (e.g., for-loop to while-loop, equivalent operator substitutions)
- Monte-Carlo tree search navigates the space of valid transformations
- Black-box attack: no internal knowledge of the target attribution system required

**What we can learn from it:** The set of semantics-preserving transformations it uses (loop form, operator choice, etc.) is a catalogue of the stylistic variations that exist within equivalent code—exactly the style dimensions a style learner needs to be sensitive to. This work is the inverse of what we want to build, but the feature space it operates on is identical.

---

## 3. Automated Convention / Config Extraction

### 3.1 ECLint

- **GitHub:** https://github.com/jednano/eclint
- **Stars:** 306
- **Status:** Archived October 2020 (read-only)
- **Language:** JavaScript/TypeScript

**What it does:** Validates or fixes code against `.editorconfig` settings and, critically, **infers** EditorConfig settings from existing code.

**How it works:**
- `eclint infer` examines files to determine the dominant patterns
- For indentation style: examines the first character of each line to determine the trend (tabs vs spaces)
- For indent size: counts leading spaces, computes modular candidates (1–8), assigns scores across all lines, selects highest-scoring candidate
- Generates a `.editorconfig` file representing the inferred conventions

**What we can learn from it:** This is the simplest end-to-end example of "infer config from code" in production. The frequency-voting approach (most common pattern wins) is naive but works. The per-rule inference methodology is a model for how to handle each distinct style dimension independently. Despite archival, the code remains valuable as a reference implementation.

---

### 3.2 editorconfig-tools (notslang)

- **GitHub:** https://github.com/notslang/editorconfig-tools
- **Status:** Experimental / not actively maintained
- **Language:** JavaScript

**What it does:** Similar to ECLint—validates, fixes, and infers EditorConfig settings. The `infer` subcommand generates a `.editorconfig` that matches all provided files.

**What we can learn from it:** Another reference for EditorConfig inference. Less mature than ECLint but demonstrates the same approach with different implementation choices.

---

### 3.3 CodRep Competition (ASSERT-KTH)

- **GitHub (2018):** https://github.com/ASSERT-KTH/CodRep
- **GitHub (2019):** https://github.com/ASSERT-KTH/codrep-2019
- **Paper:** "The CodRep Machine Learning on Source Code Competition" (arXiv 1807.03200)
- **Status:** Concluded; dataset and code remain available

**What it does:** A machine learning competition on 58,069 real Java source code diffs (2018 edition). 2019 edition focused on ranking character offsets by likelihood of containing a formatting error.

**How it works (2019):**
- Participants predict which position in a source file contains a formatting error
- Dataset derived from real commits in open-source projects
- All committed one-line replacement changes were extracted as training examples

**What we can learn from it:** The 2019 task—predicting where a formatting deviation exists—is structurally similar to "does this code deviate from the project's learned style?" The competition attracted diverse approaches (rule-based, neural) providing empirical comparison data. The dataset itself (real formatting corrections) is a valuable training resource.

---

## 4. Code Consistency and Internal Pattern Checkers

### 4.1 Semgrep

- **GitHub:** https://github.com/semgrep/semgrep
- **Stars:** ~10,000+
- **Status:** Actively maintained, commercially backed (Semgrep Inc.)
- **Language:** OCaml core, with YAML rules

**What it does:** Lightweight static analysis across 30+ languages. Rules look like the code they match—no AST DSL. Finds bug variants, security issues, and arbitrary code patterns.

**How it works:**
- Parses code into ASTs for each supported language
- Rules specify code patterns in YAML using pseudo-code syntax (e.g., `$FUNC(...)` matches any function call)
- Supports metavariables, ellipsis operators, and boolean combinations of patterns
- Community rules registry with 2,000+ rules

**Relevance to style learning:** Semgrep cannot learn patterns; it enforces pre-written ones. However, it is a practical delivery vehicle: if a style learner extracts patterns from a developer's code, those patterns could be expressed as Semgrep rules for enforcement. The rule format is well-documented and tooling-rich.

---

### 4.2 ast-grep

- **GitHub:** https://github.com/ast-grep/ast-grep
- **Stars:** 12,600+
- **Status:** Actively maintained (last commit February 2026)
- **Language:** Rust (uses tree-sitter)

**What it does:** CLI tool for structural code search, lint, and rewriting. Operates on ASTs via tree-sitter parsers. Written in Rust for performance.

**How it works:**
- Patterns are expressed in the target language's own syntax with `$VAR` metavariables
- Supports structural search, lint rules (YAML), and code rewriting
- Leverages tree-sitter for multi-language parsing

**Relevance to style learning:** Like Semgrep, ast-grep is a pattern enforcement tool rather than a learner. Its tree-sitter foundation and Rust performance make it a strong candidate for the enforcement layer of a style learning pipeline. The YAML rule format supports programmatic rule generation.

---

### 4.3 Hound CI

- **GitHub:** https://github.com/houndci/hound
- **Status:** Maintained (last activity visible in repository)
- **Language:** Ruby

**What it does:** Automated code review for GitHub pull requests. Posts inline comments when pull requests violate configured style rules. Supports Ruby, JavaScript, Go, Swift, CoffeeScript, Elixir, and more.

**How it works:**
- Integrates with GitHub via webhooks—triggers on PR open/update
- Runs configured linters (Rubocop, ESLint, etc.) against PR diff
- Posts review comments directly on the offending lines

**Relevance to style learning:** Hound's architecture—GitHub webhook → linter run → inline comment—is a deployment model worth studying. A style learner could plug into this pipeline: instead of a fixed linter, run the learned-style checker and post comments. The infrastructure is already open source.

---

### 4.4 reviewdog

- **GitHub:** https://github.com/reviewdog/reviewdog
- **Stars:** ~7,000+
- **Status:** Actively maintained
- **Language:** Go

**What it does:** Automated code review tool that accepts any linter's output (in standard error formats) and posts comments to GitHub, GitLab, Bitbucket PRs.

**How it works:**
- Accepts any tool output matching `{file}:{line}:{col}: {message}` or similar formats
- `.reviewdog.yml` config specifies which commands to run
- Supports GitHub Actions, CI integrations

**Relevance to style learning:** reviewdog is the most flexible delivery mechanism for custom style checkers. Any script that produces findings in standard format can be plugged in. A style learning tool producing violations would trivially integrate with reviewdog for PR review automation.

---

## 5. Code Clone and Pattern Detection

### 5.1 PMD / CPD

- **GitHub:** https://github.com/pmd/pmd
- **Stars:** 5,300+
- **Status:** Actively maintained (v7.21.0, released January 2026)
- **License:** BSD-style

**What it does:** PMD is an extensible multilanguage static code analyzer with 400+ rules. CPD (Copy/Paste Detector) is bundled within PMD and finds duplicated code blocks.

**How CPD works:**
- Implements the Rabin-Karp string search algorithm over tokenized code
- Supports 30+ languages including Java, Python, JavaScript, TypeScript, C/C++, Ruby, Swift
- Configurable minimum token count for duplicate detection
- Outputs duplicated fragments with file locations

**Relevance to style learning:** CPD identifies recurring code structures—which is one signal for "this developer has a habitual pattern." More directly, pattern mining on top of CPD output could identify idioms characteristic of a developer's style.

---

### 5.2 jscpd

- **GitHub:** https://github.com/kucherenko/jscpd
- **Stars:** 5,400+
- **Status:** Actively maintained (1,230+ commits, modern pnpm/turbo build)
- **Language:** TypeScript

**What it does:** Copy/paste detector for 150+ programming languages and digital formats. More language-diverse than CPD and has a rich ecosystem including VS Code extension and programmatic API.

**How it works:**
- Implements Rabin-Karp algorithm for duplicate detection
- CLI, server, and API modes
- Outputs reports in multiple formats (HTML, JSON, console)
- VS Code integration via extension

**Relevance to style learning:** jscpd is the most practically useful clone detector for a TypeScript-focused project. Its programmatic API and broad language support make it suitable as a component for identifying repetitive code patterns that characterize a developer's style.

---

### 5.3 NiCad (Open-NiCad)

- **GitHub:** https://github.com/CordyJ/Open-NiCad
- **Homepage:** http://www.txl.ca/txl-nicaddownload.html
- **Status:** v7.0 released January 2024 (actively maintained)
- **Language:** TXL (domain-specific), with Shell scripting

**What it does:** Flexible TXL-based hybrid clone detection system designed for near-miss intentional clones. Handles C, Java, Python, C#, and more via plugin architecture.

**How it works:**
- Extracts code fragments (functions, blocks) using language-specific TXL grammars
- Normalizes fragments (renaming, whitespace) to detect near-miss clones
- Configurable granularity: function-level, block-level, statement-level
- Plugin architecture: adding a new language requires only naming a TXL parser following convention

**Relevance to style learning:** NiCad's normalization pipeline is relevant—its "pretty-printing then text-diffing" approach is a way to detect structurally similar code that differs only in surface style. The near-miss detection capability (not just exact clones) is more useful for style analysis than exact-match detectors.

---

### 5.4 GumTree / gumtree-spoon-ast-diff

- **GitHub (main):** https://github.com/GumTreeDiff/gumtree
- **GitHub (Java specialist):** https://github.com/SpoonLabs/gumtree-spoon-ast-diff
- **Paper:** "Fine-grained and Accurate Source Code Differencing" (Falleri et al., ASE 2014)
- **Status:** Actively maintained

**What it does:** Syntax-aware diff tool that computes fine-grained AST differences between two versions of source code. Outputs an edit script with insert, delete, update, and move operations on AST nodes.

**How it works:**
- Greedy top-down search for identical subtrees
- Bottom-up search to match remaining nodes
- Reports moves (not just insertions/deletions), crucial for detecting refactoring
- Supports C, Java, JavaScript, Python, R, Ruby, and more

**Relevance to style learning:** GumTree is the foundational tool for understanding what changed between code versions at the semantic level. Mining a developer's commit history with GumTree produces a dataset of "the kinds of changes this developer makes"—which are precisely their stylistic preferences and habits. JetBrains Research's authorship detection project uses GumTree for exactly this purpose.

---

## 6. AI-Based Code Style Transfer and Representation

### 6.1 code2vec / code2seq (tech-srl)

- **code2vec GitHub:** https://github.com/tech-srl/code2vec
- **code2seq GitHub:** https://github.com/tech-srl/code2seq
- **Papers:** code2vec (POPL 2019), code2seq (ICLR 2019)
- **Status:** Research artifacts; actively cited but not under active development
- **Language:** TensorFlow (Python)

**What they do:**
- **code2vec**: Represents a code snippet as a fixed-length vector by attending over AST path-contexts. Primary use case: method name prediction.
- **code2seq**: Uses LSTMs to encode AST paths node-by-node and decode to sequences (e.g., code summaries, commit messages).

**How they work:**
- Extract paths between leaves of the AST (path-contexts)
- Encode each path as a vector; attend over all paths to produce a snippet embedding
- code2seq encodes paths with LSTMs for richer sequential representation

**Relevance to style learning:** code2vec embeddings capture semantic structure of code. Per-developer embeddings (average of their code snippets) form a style representation that can be used to measure similarity, detect drift, or generate style-consistent code. The JetBrains authorship detection project directly builds on code2vec for this purpose.

---

### 6.2 CodeBERT / UniXcoder (Microsoft)

- **GitHub:** https://github.com/microsoft/CodeBERT
- **Status:** Actively maintained; UniXcoder updated for multiple downstream tasks
- **Language:** Python (PyTorch)

**What it does:** Pre-trained bimodal (code + natural language) models. CodeBERT is trained on NL-PL pairs in 6 programming languages. UniXcoder is a unified cross-modal model supporting both code understanding and generation.

**How it works:**
- Transformer architecture pre-trained on large code corpora
- Can be fine-tuned for tasks: clone detection, code search, code completion, vulnerability detection
- UniXcoder adds prefix-tuning for generation tasks

**Relevance to style learning:** Fine-tuning CodeBERT or UniXcoder on a developer's personal code history could produce a personalized code model. Code generated or completed by this model would carry the statistical patterns of the training code. However, fine-tuning requires substantial code volume and GPU resources.

---

### 6.3 MISIM (IntelLabs)

- **GitHub:** https://github.com/IntelLabs/MICSAS
- **Paper:** "MISIM: An End-to-End Neural Code Similarity System" (arXiv 2006.05265)
- **Status:** Research artifact

**What it does:** Neural code semantics similarity system using a novel "context-aware semantics structure" (CASS) representation. Achieves at least 8% better accuracy than competing systems across 18 million lines of code.

**How it works:**
- Constructs CASS from code, capturing semantic context
- Vectorizes CASS inputs for a neural network producing feature vectors
- Similarity measured by cosine similarity between code vectors

**Relevance to style learning:** MISIM's semantic similarity could distinguish style-similar from style-dissimilar code. Using MISIM embeddings, a style learner could cluster a developer's code to identify stylistic clusters and outliers.

---

### 6.4 Microsoft Visual Studio IntelliCode (Team Completions)

- **Documentation:** https://learn.microsoft.com/en-us/visualstudio/intellicode/
- **Status:** Active (closed source; Team Completions feature has evolved)

**What it does:** AI-assisted code completions that are personalized to the codebase. Team Completions trained a model on a team's own code to suggest team-specific API patterns and idioms.

**How it works:**
- Previous version: trained a model locally on the team's codebase, uploaded a distilled model artifact (not source code) to Microsoft servers
- Current version: deep learning model running locally on-machine, replacing team model uploads
- Provides AI-starred completions that rank team-specific patterns higher

**Relevance to style learning:** IntelliCode Team Completions is the closest Microsoft has come to "learn from your team's style." The architecture—local model trained on private code, producing prioritized completions—is a viable pattern for personal style learning. The GitHub Action for automating Team Completions updates is a deployment model worth studying.

---

### 6.5 Tabnine (codota)

- **GitHub (VS Code client):** https://github.com/codota/tabnine-vscode
- **GitHub (core):** https://github.com/codota/TabNine
- **Status:** Actively maintained; enterprise product

**What it does:** AI code completion tool that learns from the local codebase and, in enterprise tiers, trains custom models on the team's private code.

**How it works:**
- Local model learns developer's and project's patterns continuously
- Enterprise: trains a bespoke model on the full codebase
- "Team Learning": continuously improves as it observes coding decisions
- Provides completions that reflect both global training and local codebase patterns

**Relevance to style learning:** Tabnine's local-model architecture is the closest open-source-adjacent example of continuous personal style learning. The VS Code extension code is open source and shows how to integrate a local model into the IDE feedback loop.

---

## 7. Research Infrastructure and Surveys

### 7.1 ML for Big Code and Naturalness (ml4code)

- **Website:** https://ml4code.github.io/
- **GitHub:** https://github.com/ml4code/ml4code.github.io
- **Status:** Active living literature review

**What it is:** The authoritative survey and curated bibliography for "machine learning on source code." Tags and indexes papers by task type including code style, naturalness, authorship, and convention learning.

**Key entries relevant to this project:**
- Naturalize (Allamanis 2014): learning natural coding conventions
- JSNice (Raychev 2015): predicting program properties
- code2vec (Alon 2019): distributed code representations
- MISIM (Ye 2020): neural code similarity

**Value:** The tags page at https://ml4code.github.io/tags.html and papers page at https://ml4code.github.io/papers.html are the fastest way to find new academic work in this space. Any future literature search should start here.

---

### 7.2 src-d: Awesome Machine Learning on Source Code

- **GitHub:** https://github.com/src-d/awesome-machine-learning-on-source-code
- **Status:** Archived (source{d} company dissolved)

**What it is:** Curated list of papers and tools covering program synthesis, language modeling, embeddings, clone detection, and more. Includes sections on code style and conventions.

**Value:** Good historical reference for the 2016–2020 period. Less current than ml4code.github.io but includes tool links that ml4code does not.

---

### 7.3 Joern (Code Property Graphs)

- **GitHub:** https://github.com/joernio/joern
- **Stars:** 2,000+
- **Status:** Actively maintained; community via Discord
- **Language:** Scala

**What it does:** Open-source code analysis platform for C/C++/Java/JavaScript/Python/Kotlin/Binary. Generates Code Property Graphs (CPGs) that unify AST, control flow graph, and program dependence graph into one queryable structure.

**How it works:**
- Language-specific frontends parse source to CPG
- Custom query language (CPG query language) for searching and analyzing the graph
- Extensible: new language support via new frontend

**Relevance to style learning:** Joern's CPG is used as the foundation of CodeStylometry (the seminal authorship attribution tool). It provides richer structural information than a plain AST. For deep style analysis (data flow patterns, control flow idioms), Joern is the state-of-the-art extraction tool.

---

## 8. Summary Table

| Project | Category | Technique | Language(s) | Maintained | Stars | Key Relevance |
|---|---|---|---|---|---|---|
| Naturalize | Style learning | N-gram LM on tokens | Java (analyzes any) | Archived 2021 | 56 | First "learn from your own codebase" tool; pre-commit hook pattern |
| JSNice / Nice2Predict | Style learning | CRF structured prediction | JavaScript | Inactive 2021 | 218 | Joint prediction over all identifiers; probabilistic naming |
| UnuglifyJS | Style learning | ML feature extraction + server | JavaScript | Inactive | Low | Client/server separation for style prediction |
| HowYouCode | Developer fingerprint | Heuristic scoring | Multi-language | Active | N/A | 8-dimension style decomposition; browser-privacy model |
| CodeStylometry | Authorship | Random forest + AST/layout/semantic | C/C++ | Old artifact | Low | Canonical three-category feature taxonomy |
| CoderID | Authorship | AST + ML | Python | 2023 (incomplete) | 3 | Python reference implementation |
| JetBrains Authorship Detection | Authorship | code2vec + GumTree git mining | Java | ~2020 | 23 | Git history mining approach; code2vec for style vectors |
| AuthAttLyzer V2 | Authorship | 54-feature ML ensemble + SHAP | C/C++ | Active 2024 | Low | Most comprehensive public feature taxonomy; SHAP interpretability |
| RoPGen | Authorship (robust) | Data + gradient augmentation; 23 attributes | C, Java | Artifact 2022 | 16 | Enumerates 23 style attributes; identifies stable features |
| Forsee | Authorship (robust) | Expert features + shallow NN | Multi | Artifact 2024 | Low | Hybrid expert+learned approach validated at ISSTA |
| Code-Imitator | Adversarial attack | Monte-Carlo tree search on transformations | C++ | Artifact 2019 | 32 | Catalogue of style-neutral code transformations |
| ECLint | Convention extraction | Frequency voting per rule | Any (.editorconfig) | Archived 2020 | 306 | End-to-end "infer config from code" reference |
| editorconfig-tools | Convention extraction | Similar to ECLint | Any | Experimental | Low | Alternative EditorConfig inference approach |
| CodRep (KTH) | Benchmark | ML on real formatting diffs | Java | Concluded | N/A | Dataset of real formatting errors; benchmark for style correction |
| Semgrep | Pattern enforcement | AST pattern matching | 30+ languages | Active | ~10K | Delivery vehicle for learned patterns; rule format |
| ast-grep | Pattern enforcement | Tree-sitter structural search | 30+ languages | Active 2026 | 12.6K | Fastest structural linting; programmatic rule generation |
| Hound CI | PR style review | Delegates to linters | Multi | Active | ~1K | GitHub PR review architecture |
| reviewdog | PR review delivery | Any linter output format | Any | Active | ~7K | Most flexible review comment delivery |
| PMD / CPD | Clone detection | Rabin-Karp tokenized | 30+ languages | Active 2026 | 5.3K | Baseline duplicate detection across many languages |
| jscpd | Clone detection | Rabin-Karp | 150+ languages | Active | 5.4K | Best multi-language CLI for copy detection; TS API |
| NiCad | Clone detection | TXL normalization + text diff | C, Java, Python, C# | Active 2024 | Low | Near-miss clone detection; normalisation pipeline |
| GumTree | Structural diff | AST edit script | C, Java, JS, Python++ | Active | ~2K | Foundation for commit-history style mining |
| code2vec / code2seq | Code representation | AST path-context embeddings | Multi | Artifact | ~4K | Per-snippet style embeddings for similarity and clustering |
| CodeBERT / UniXcoder | Code representation | Transformer pre-training | 6+ languages | Active | ~4K | Fine-tunable for personal style; strong baseline |
| MISIM | Code similarity | CASS + neural network | Multi | Artifact | Low | Semantic-aware similarity for style comparison |
| IntelliCode Team Completions | AI completion | Local model on team code | C#, Python++ | Active (evolved) | N/A | Team-style learning architecture; GitHub Action |
| Tabnine | AI completion | Continuous local model | Multi | Active | ~900 | Open-source VS Code client; personal style learning loop |
| Joern | Code analysis | Code property graph | C/C++/Java/JS/Py++ | Active | ~2K | Richest structural extraction; used by CodeStylometry |

---

## 9. Key Takeaways and Relevance

### What exists that directly does what we want

Nothing in the open source ecosystem does exactly what a "personal style learner" would need to do—learn an individual developer's specific idiosyncratic patterns from their own code history and enforce or suggest those patterns on new code. The closest approximation is:

1. **Naturalize**: learns from a codebase, but only for identifier naming; archived.
2. **IntelliCode Team Completions**: learns from a team's codebase, but only for completion ranking; closed source.
3. **Tabnine enterprise**: continuous local learning, but black-box; not a style analysis tool.

### What exists that covers significant sub-problems

- **Feature extraction**: The three-category taxonomy (syntactic/AST features, layout/lexical features, semantic features) from CodeStylometry and expanded to 54 features in AuthAttLyzer V2 is the practical starting point for a feature set.
- **Style signals**: The 23 style attributes from RoPGen and the 8 dimensions from HowYouCode provide complementary perspectives on what to measure.
- **Inference from code**: ECLint's frequency-voting approach shows how to go from "a corpus of code" to "a set of conventions" without labelled training data.
- **Enforcement**: Semgrep and ast-grep are the leading pattern enforcement tools; any learned patterns can be expressed in their rule formats.
- **Delivery**: reviewdog and Hound CI provide proven GitHub PR review comment architectures.
- **Training data**: GumTree-based git mining (as used by JetBrains Research) is the right approach for extracting per-developer style corpora from commit history.
- **Interpretability**: SHAP (used in AuthAttLyzer V2) is the right tool for explaining which features are most characteristic of a specific developer.

### Key research gaps this project could address

1. **Personal-scale style learning** (not team or project-scale): existing tools either enforce a project-wide style or require large corpora.
2. **Live feedback loop**: no open source tool today offers a continuous "did this new code match your own past style?" signal integrated into the IDE or PR flow.
3. **Style evolution tracking**: as a developer's style changes over time, no tool tracks this drift and helps them understand it.
4. **Cross-file pattern learning**: most tools are file or function scoped; learning patterns that span files (e.g., "this developer always structures module boundaries this way") is unsolved.

### Integration opportunities

- Use **tree-sitter** (already used by ast-grep and many others) for multi-language AST extraction—it is the de facto standard.
- Use **jscpd** or **CPD** for identifying repeated structural patterns as a signal for "habitual idioms."
- Use **GumTree** for commit-history mining to build a personal style corpus.
- Express learned rules in **Semgrep YAML** or **ast-grep YAML** format for enforcement.
- Deliver violations via **reviewdog** for PR integration with zero infrastructure overhead.
- Reference **AuthAttLyzer V2's 54-feature taxonomy** as the starting checklist for what to measure.
- Reference **Naturalize's** pre-commit hook architecture for IDE/pre-commit integration patterns.
