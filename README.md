# sota-scan

A [Claude Code](https://claude.com/claude-code) skill that **benchmarks a repository against the state of the art** — it scans real online repos (GitHub + the wider web) in the same domain, then produces a **cited capability matrix** and a **ranked, repo-grounded gap list**.

The job is *grounded comparison*, not a generic best-practices listicle. Every gap it reports is tied to **(a)** something real in *your* repo and **(b)** a real online source. **No source → no claim.**

## What you get

Run it and you get an action-first dashboard:

```
## 🧭 SOTA Standing — <repo>   ·   mode: exhaustive
> Verdict: <one sentence — are we behind, and on what?>
Tier: BEHIND (3 gaps)  ·  Coverage █████░░░░░ 63% (5/8 table-stakes met)  ·  Field: 11 repos

### ▶ Do this next
> <the #1 gap as one imperative line> — copy from owner/repo → file. First step: <concrete>. Effort ~Xd.

### 🏆 The field        ### 📊 Capability matrix        ### 🔧 Gaps (worst first)
```

- **Capability matrix** — rows = capabilities the field expects; columns = Us (✅/⚠️/❌) · who has it · gap? · cited reference.
- **Ranked gaps** — each a copyable, patch-oriented task (`Why / Study / Step 1`) with an effort estimate and a confidence label.
- **Reproducible** — scores against a saved per-domain rubric and persists each run to `.sota/`, so the next scan shows a *diff* (coverage Δ, tier change, newly met/lost).

## Execution modes

| Mode | Comparators | Saturation | Output |
|---|---|---|---|
| `quick` | 3–5 | none (early stop) | top 3 gaps |
| `standard` *(default)* | 5–10 | light | full dashboard |
| `exhaustive` | 10+ | strict (two empty rounds) | full dashboard + persisted artifacts |

In **exhaustive** mode the comparator analysis is fanned out across concurrent agents via the included [`workflows/sota-scan-fanout.js`](workflows/sota-scan-fanout.js) workflow (discovery stays inline, parallel analysis goes to the workflow, persistence comes back to the skill).

## Install

Copy the skill into your Claude Code config:

```bash
# the skill
mkdir -p ~/.claude/skills/sota-scan
cp SKILL.md ~/.claude/skills/sota-scan/SKILL.md

# the exhaustive-mode fan-out workflow
mkdir -p ~/.claude/workflows
cp workflows/sota-scan-fanout.js ~/.claude/workflows/sota-scan-fanout.js
```

On Windows:

```powershell
New-Item -ItemType Directory -Force ~/.claude/skills/sota-scan, ~/.claude/workflows | Out-Null
Copy-Item SKILL.md ~/.claude/skills/sota-scan/SKILL.md
Copy-Item workflows/sota-scan-fanout.js ~/.claude/workflows/sota-scan-fanout.js
```

Then, inside any repo, invoke it from Claude Code:

```
/sota-scan                     # standard scan of the current repo
/sota-scan exhaustive          # serious benchmark (investor/release readiness)
/sota-scan quick               # fast ballpark
```

…or just ask: *"is our X top-tier?"*, *"what are we missing vs the best?"*, *"study online what others do."*

## What it writes

Each repo you scan gets its own results folder (the skill leaves the report behind so progress is diffable over time):

```
<scanned-repo>/.sota/
├── rubric.<domain>.json   # the fixed scoring axis for that domain
└── last-scan.json         # the latest scan + its coverage/tier/gaps
```

Commit those or `.gitignore` them — your call.

## Requirements

- Claude Code with web access (`WebSearch`/`WebFetch`) and, ideally, the `gh` CLI for exact star/recency numbers.
- For `exhaustive` mode's parallel fan-out, the Workflow capability (the skill falls back to a sequential scan and discloses it if unavailable).

## Dogfooding

This repo's own [`.sota/`](.sota/) holds sota-scan's scan **of itself** against the deep-research-agent / repo-grading field (`gpt-researcher`, `storm`, `open_deep_research`, `ossf/scorecard`): **FRONTIER, 7/7 table-stakes met**.

## License

MIT — see [LICENSE](LICENSE).
