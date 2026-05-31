---
name: sota-scan
description: Benchmark the current repo against the state of the art by scanning real online repos (GitHub and the wider web) in the same domain, then produce a cited capability matrix and a ranked, repo-grounded gap list. Use when the user asks "is our X top-tier", "what are we missing", "compare us to the best", "study online what others do", or types /sota-scan.
---

# sota-scan — benchmark this repo against the field

You answer one question with evidence: **"What do the best projects in this domain have that we don't?"**

The job is **grounded comparison**, not a generic best-practices listicle. Every gap you report must be tied to (a) something real in *this* repo and (b) a real online source. No source → no claim.

## Execution modes

Pick a mode before Step 1 and **state which mode you're running in one line** at the top of the output. Default to `standard` unless the user explicitly signals otherwise.

| Mode | Comparators | Saturation | Output |
|---|---|---|---|
| `quick` | 3–5 | none (early stop) | top 3 gaps only |
| `standard` | 5–10 | light — vary terms until no obvious new comparator appears | full dashboard |
| `exhaustive` | 10+ where useful | strict — two consecutive no-new-finding rounds | full dashboard + persisted artifacts |

- Use **`quick`** when the user asks for a fast/rough check ("quick look", "ballpark", "are we roughly competitive"). Always **disclose the early stop** — don't imply the field is complete.
- Use **`standard`** by default: inspect the repo, scan 5–10 comparators, vary search terms until no obvious new comparator surfaces, render the full dashboard.
- Use **`exhaustive`** when the user asks for a *serious* benchmark — investor/release-readiness, blocker audit, "do this properly", "leave nothing out". Scan 10+ comparators, require two empty saturation rounds (Step 1), and always persist the artifacts (Step 4).

### Exhaustive mode — delegate the fan-out to a Workflow

A prompt runs sequentially: in `quick`/`standard` you fetch comparators one at a time, which is fine at 3–10. At 10+ that serial fetch is the bottleneck. So `exhaustive` mode **hands the fan-out to the `sota-scan-fanout` Workflow**, which analyzes every comparator concurrently. The split is deliberate — discovery stays here, parallel analysis goes there, persistence comes back here:

1. **Discover inline (Step 1).** Run the saturation loop yourself — discovery is iterative (each round's queries depend on the last), so it doesn't parallelize. Produce the comparator list `[{repo, url, type}]`.
2. **Build the Us inventory inline (Step 0)** as `[{id, name, status, file}]`.
3. **Call the Workflow**, passing both plus any saved rubric:
   `Workflow({ name: "sota-scan-fanout", args: { domain, comparators, rubric: <saved or null>, us: <inventory> } })`
   It fans out one agent per comparator (each returning a structured capability record), then synthesizes and **returns** `{ field, rubric, matrix, coverage, tier, gaps_total, gaps }`.
4. **You persist and render (Step 4 + output shape).** The Workflow has **no filesystem access** — it returns data, it never writes. Take its return value, write `.sota/rubric.<domain>.json` and `.sota/last-scan.json` (or the read-only fallback), diff against the prior scan, and render the dashboard. All persistence logic lives here in exactly one place, so read-only handling is identical across modes.

If the Workflow tool is unavailable (e.g. headless run), fall back to a sequential `exhaustive` scan inline and disclose that the fan-out was skipped.

### Source quality — prefer primary, verify in code

When more than one source could back a claim, prefer in this order:

1. competitor repo **code**
2. official **docs**
3. release notes / changelog
4. package-registry metadata
5. first-party blog posts
6. secondary articles

**Do not use a README marketing claim alone to assert a table-stakes gap when code or docs can verify it.** "Their README says they have X" is not confirmation that they have X — confirm in code/docs before scoring it against us.

### Read-only fallback

If write access is unavailable (chat preview, CI sandbox, external-repo review), **do not fail.** Render `.sota/rubric.<domain-slug>.json` and `.sota/last-scan.json` as copyable JSON blocks in the output and mark persistence as **"not written — read-only environment."** The scan still completes; only the on-disk record is deferred to the user.

## Step 0 — Read us before reading them

Before any web search, build a short **capability inventory of the current repo** from its own evidence:
- Read `README*`, top-level docs, `Cargo.toml`/`package.json`/manifests, and the main entry modules.
- Extract: the repo's stated goal/domain, its concrete features, its tech stack, and its claimed differentiators.
- Write this as a bullet list. This is the left column of every later comparison. **Each capability you claim for *us* must name the file/feature backing it** (e.g. `✅ secrets gate — bin/anvil/Gate.ps1`) — the "Us" side is held to the same cite-it bar as the SOTA side.
- **Pick the field deliberately — this is the highest-leverage decision in the whole scan; the wrong field invalidates the entire matrix.** If the repo straddles 2–3 adjacent fields (e.g. "git-hook manager" *and* "quality-gate platform" *and* "AI-output verifier"), name each one in a single line and pull table-stakes from all of them rather than forcing one. If the domain is genuinely ambiguous, state your assumption in one line and continue (don't stall on it).

## Step 1 — Find the field

Search the web and GitHub for the **5–10 most relevant comparable projects** in that domain (prefer active, well-starred, or canonical repos). Use the deferred `WebSearch` and `WebFetch` tools (load them via ToolSearch first). For each candidate:
- Fetch its README / docs / feature list.
- Note: name, URL, star/activity signal, and its headline capabilities.
- **Tag a comparator *type*, not just popularity** — stars alone bias the field toward marketing reach. Classify each as one of: `canonical` (defines the expected workflow), `popular` (widely-adopted baseline), `technically advanced` (best implementation of some capability), `niche-relevant` (small but directly comparable), or `stale-reference` (matters historically but inactive/archived). A 2k-star `technically advanced` repo can set the bar higher than a 28k-star `popular` one — the type is what justifies inclusion.
- **Get hard numbers, not scraped guesses.** If `gh` is available, pull exact stars, last-push date, and archived status with `gh api repos/{owner}/{repo} --jq '{stars:.stargazers_count, pushed:.pushed_at, archived:.archived}'` (or `gh search repos`). Only fall back to web-scraped "~Nk" figures when `gh` is unavailable — and mark them `~` so the reader knows they're soft.
- **Recency is part of SOTA.** A capability "matched" by a repo last pushed years ago, or `archived: true`, is not state-of-the-art — flag such comparators rather than treating them as the bar.

Cast wide enough to cover the domain's table-stakes, not just the first repo you find.

**Search to saturation, not to a fixed count.** One pass over the first 5–10 hits can miss the actual SOTA leader and anchor the whole matrix on the wrong field. Keep searching — vary the query angle (by capability, by competitor name, by "X alternatives", by the academic/term-of-art name) — until **two consecutive rounds surface no new comparator and no new table-stakes capability.** Only then is the field mapped. If you stop early for cost, say so in one line rather than implying the field is complete.

## Step 2 — Build the capability matrix

### Field framing (required, render before the matrix)

The highest-risk failure mode is benchmarking the repo against the *wrong kind of project*. Make the framing auditable so the reader can catch a bad call before trusting the matrix:

```
### Field framing
Detected domain:           <domain>
Adjacent domains considered: <domain A>, <domain B>
Excluded domains:          <domain C> — <why it's out of scope>
Benchmark assumption:      <one sentence the whole matrix rests on>
```

If the repo genuinely straddles fields, name each detected domain rather than forcing one.

Produce one table. Rows = capabilities the field expects (derived from Step 1, not invented). Columns:

| Capability | Us | SOTA (who has it) | Gap? | Reference |
|---|---|---|---|---|

- **Us** = ✅ have it / ⚠️ partial / ❌ missing, grounded in your Step 0 inventory.
- **SOTA** = which real repo(s) demonstrate it.
- **Gap?** = blank / **table-stakes** (everyone serious has it) / *edge* (nice-to-have).
- **Reference** = a real `owner/repo`. Point to a specific *file* (`comp/liq-bot → src/markets/compound.rs`) **only if you actually confirmed that path** (via `gh api repos/{owner}/{repo}/contents/...`, repo browse, or the docs naming it). If you only confirmed the repo/feature exists but not the exact file, cite `owner/repo → <feature name>` — do **not** invent a plausible file path, that breaks the no-guessing rule. Never leave this empty.

### Score against a fixed rubric (deterministic axis)

The capability *list* — not the per-run scores — is what must stay stable so two scans of the same repo are comparable. Persist it per domain in the **scanned repo** at `.sota/rubric.<domain-slug>.json`:

```json
{ "domain": "git-hook-quality-gate", "version": 2, "capabilities": [
  { "id": "git-hook-install", "tier": "table-stakes", "test": "installs hooks that fire on commit/push" },
  { "id": "changed-files-only", "tier": "table-stakes", "test": "can scope a run to the diff" },
  { "id": "sarif-output",      "tier": "edge",         "test": "emits SARIF for CI security tab" }
] }
```

- **If a rubric file exists for the detected domain, score against THAT list** (mark each `met` / `partial` / `missing`). This is what makes coverage% and tier reproducible across runs — the axis doesn't drift with the model's mood.
- **If none exists**, derive the list from the Step-1 field scan and write it. If this run's field surfaces a genuinely new table-stakes capability, *add it and bump `version`* — don't silently re-weight; note the rubric change in the output so a score drop is attributable to a harder bar, not regression.
- "Deterministic" here means a **fixed scoring axis + a diffable record**, not byte-identical output — an LLM run never is. The rubric removes the axis drift; the persisted scan (Step 4) makes the rest auditable.

## Step 3 — Rank the gaps as an actionable to-do list

The user must be able to act in the next five minutes. Lead with the action, make every gap a copyable task. Each gap is rendered as a card:

```
[!]  #1  <Capability>                       table-stakes · effort ~Xd · confidence: high/medium/low
     Why:    <one line — why this matters for THIS repo's goal>
     Study:  <owner/repo → specific file/feature that implements it>
     Step 1: <the first concrete thing to do — name the first file to create/edit AND the first function/command/test to add>
```

- `[!]` = table-stakes gap (do these first), `[~]` = edge gap.
- **Effort** = your rough *estimate* (`~2h`, `~1d`, `~3d`) so the user can triage — it's a guess, not a cited fact; the `~` signals that. Don't dress it up as precise.
- **Study** is the load-bearing field — a gap without a reference to copy from is just a complaint.
- **Step 1 must be patch-oriented, not directional.** Name the first file to create or edit *and* the first function/command/test to add. ✅ ``create `src/config.rs` with `load_config(path) -> Result<Config>` and wire it into `main.rs` before command dispatch`` — ❌ "create a config loader." The reader should be able to start typing immediately.
- **Confidence** on every card: `high` (grounded in code/docs on both sides), `medium` (one side inferred or table-stakes classification is judgement), `low` (effort estimate or unverified inference dominates). This separates "we definitely lack a thing they definitely have" from a softer call.
- Order strictly highest-impact first. Cap the rendered **cards** at the top 5, but always print the *true* total gap count next to the tier (e.g. "BEHIND · 7 table-stakes gaps, top 5 shown") — capping the display must never hide how deep the tier goes, since the worst tier (LAGGING) starts at exactly 5 gaps.

## Step 4 — Persist the run, then diff against last time

A benchmark you can't re-run and compare can't show progress. After building the matrix, write the run to the **scanned repo** at `.sota/last-scan.json` (don't overwrite the rubric file):

```json
{ "date": "2026-05-31", "domains": ["git-hook-quality-gate"], "rubric_version": 2,
  "field": [ { "repo": "evilmartians/lefthook", "stars": 8300, "pushed": "2026-05-20" } ],
  "matrix": [ { "id": "git-hook-install", "us": "missing", "tier": "table-stakes" } ],
  "coverage": { "met": 4, "total": 8, "pct": 50 }, "tier": "BEHIND", "gaps_total": 4 }
```

- **Persist only after every `gh`/web/verification call has returned.** Don't pre-write the file with values you intend to fill in — a scan that writes stars before the `gh` results land will bake in guesses (this is a real, observed failure). Gather first, write once.
- Use **today's date from context** for `date` (don't invent one; if unknown, write `"unknown"`).
- **Before writing, read the previous `.sota/last-scan.json` if it exists** and render a one-line **"Since last scan"** delta at the top of the dashboard: coverage Δ (e.g. `50% → 63%, +1 met`), tier change, capabilities newly **met** or newly **lost**, and competitors **added/dropped** from the field. If the rubric `version` changed between runs, say so — a score move may be the bar moving, not the repo.
- **First run** (no prior file): say "baseline — no prior scan to diff" and just write the file.
- These files belong to the repo being benchmarked (so history travels with it). Mention them in the output so the user can choose to commit or `.gitignore` them.

## Rules — blockers vs. quality

### Hard blockers (violating any one invalidates the scan — fix before output)

- **Read the repo first.** A comparison not grounded in the actual code is a listicle — that's the failure mode this skill exists to prevent.
- **No source, no claim.** A gap row with no URL/repo gets dropped, not guessed.
- **No guessed file paths.** Cite a file only if you confirmed it exists; otherwise cite `owner/repo → <feature name>`.
- **Every "Us" claim is grounded in a repo file.**
- **Every gap is tied to both repo evidence and external evidence.**
- **Stay inside the repo's stated goal.** Don't recommend pivoting the product; recommend closing gaps within what it already aims to be.
- If web/git access is unavailable, say so plainly and stop — do not fabricate the field from memory.

### Quality checks (raise the grade; degrade gracefully and disclose if skipped)

- Saturation search (per the mode's requirement).
- Exact GitHub stars via `gh` (fall back to `~` web figures, marked).
- Score against a saved rubric.
- Persisted scan + "since last scan" diff (or read-only fallback).
- Coverage bar + comparator-type tags + confidence labels.
- **Distinguish table-stakes from edge** — flooding the user with edge features they don't need is noise.

## Before you output — self-check (enforce the hard rules)

Run this pass on your own draft. Treat the two groups differently: a failed **blocker** means the output is invalid — fix it before presenting (don't ship and apologize). A failed **quality** check is allowed only if you *disclose* it in one line; silently skipping it is not.

### Blocker checks — must pass or the output is invalid

1. **Every Reference resolves** to a real repo, and any file path named was actually confirmed (not guessed).
2. **Every gap is verified on both sides** — confirm against a primary source that the competitor *actually has* it **and** that we *actually lack* it; re-read the one source that proves it. Drop or mark "unverified" otherwise. **No table-stakes gap rests on a README marketing claim alone** when code/docs could verify it.
3. **Every ✅/⚠️/❌ in the "Us" column names the repo file** that backs it (you read us before reading them).
4. **No gap without a cited source**, and nothing recommends pivoting outside the repo's stated goal.
5. **Field framing is rendered before the matrix** (detected / adjacent / excluded / assumption) — the wrong field invalidates everything below it.

### Quality checks — disclose if skipped or only partially satisfied

6. **The execution mode is stated**, and its comparator/saturation budget was honored — searched to saturation for `standard`/`exhaustive`, or early stop disclosed for `quick`.
7. **Every star/recency figure has a source** — exact via `gh`, or marked `~` if web-scraped; stale/archived comparators flagged, not treated as the bar.
8. **Scored against the saved rubric** if one exists (axis didn't drift); a new/bumped rubric version is disclosed.
9. **Coverage math checks out:** bar is 10 segments, fill = round(pct/10), label shows real `met/total`; **tier matches the gap count** and the true total is shown even if cards are capped at 5.
10. **The run was persisted** to `.sota/last-scan.json` — written *once, after* all `gh`/web calls returned — with a "Since last scan" line (or baseline note); or, if read-only, rendered as copyable JSON marked "not written."
11. **Each leaderboard row has a comparator type**, and inclusion is justified by type — not stars alone.
12. **Every gap card carries a confidence label**, and the #1 task names a concrete file + function/command/test (patch-oriented, not directional).

## Output shape — action-first dashboard

Render in this exact order. The user reads top-down and must hit the *single next action* before any analysis.

```
## 🧭 SOTA Standing — <repo>   ·   mode: standard
> **Verdict:** <one sentence: are we behind, and on what?>

**Tier:** FRONTIER / COMPETITIVE / BEHIND / LAGGING (G table-stakes gaps)   ·   **Coverage** ███████░░░ 70% (7/10 table-stakes met)   ·   **Field scanned:** N repos
> **Since last scan:** <coverage Δ · tier change · newly met/lost · field added/dropped> — OR "baseline — no prior scan to diff."

### Field framing
Detected domain: <domain>  ·  Adjacent considered: <A>, <B>  ·  Excluded: <C> — <reason>
Benchmark assumption: <one sentence>

### ▶ Do this next
> **<the #1 gap as one imperative line>** — copy the approach from `owner/repo → file`. First step: create/edit `<file>`, add `<function/command/test>`. Effort ~Xd · confidence: <high/medium/low>.

### 🏆 The field
<leaderboard: rank · owner/repo · type (canonical/popular/technically advanced/niche-relevant/stale-reference) · stars · why included — top 5, each linked>

### 📊 Capability matrix
<Step 2 table>

### 🔧 Gaps — your to-do list, worst first
<Step 3 gap cards, each with a confidence label>

### What we already match
<one compact line listing the ✅ capabilities, so the user sees their strengths without scrolling a table>
```
> If the environment is read-only, append the two `.sota/*.json` files as copyable JSON blocks and note "not written — read-only environment."

### Presentation rules
- **Coverage bar** is always **10 segments wide regardless of how many table-stakes you found.** Compute `pct = round(met / total × 100)`; fill `round(pct / 10)` segments with `█` and the rest with `░`. The label shows the *real* fraction `(met/total table-stakes met)` — NOT `met/10`. Example: 4 of 8 met → `█████░░░░░ 50% (4/8 table-stakes met)`. The bar is the at-a-glance "how far behind" signal; the label keeps it honest when total ≠ 10.
- **Emoji are status, not decoration.** `[!]`/🔴 = table-stakes gap, `[~]`/🟡 = edge, ✅ = matched. Don't sprinkle others.
- **Tier rule (gaps = table-stakes capabilities you're MISSING or only ⚠️ partial):** FRONTIER = 0 gaps · COMPETITIVE = 1–2 · BEHIND = 3–4 · LAGGING = 5+. Tier is an absolute gap count, so always show it alongside the coverage % — a wide field can read "BEHIND" at a healthy-looking 67%. If the two seem to disagree, that's expected; name both, don't reconcile by fudging.
- **One screen to the verdict.** Verdict + Do-this-next + coverage must fit before any table. If the matrix is long, the user has already gotten the actionable part.
- Keep the whole thing skimmable — a busy maintainer should grasp standing + next action in under 15 seconds.
