# SOTA Report — sota-benchmark-agent

- **Date:** 2026-06-22
- **Domain:** sota-benchmark-agent
- **Tier:** FRONTIER
- **Mode:** standard

## Summary

**FRONTIER · 7/7 table-stakes met · 3/3 edge**

Frontier — every table-stakes capability is present, and with the new report exporter (scripts/sota-report.mjs) the last open edge item, shareable-report-export, is now closed (edge 3/3).

## Capability matrix

| Capability                            | Us  | SOTA                      | Gap? | Reference                                                                   |
| ------------------------------------- | --- | ------------------------- | ---- | --------------------------------------------------------------------------- |
| Multi-source web + GitHub retrieval   | ✅   | gpt-researcher, deer-flow |      | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) |
| Cited grounding (no source, no claim) | ✅   | gpt-researcher            |      | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) |
| Structured action-first report        | ✅   | gaphunter-skill           |      | [debba/gaphunter-skill](https://github.com/debba/gaphunter-skill)           |
| Per-gap claim verification            | ✅   | gpt-researcher            |      | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) |
| Saturating search (2 empty rounds)    | ✅   | deer-flow                 |      | [bytedance/deer-flow](https://github.com/bytedance/deer-flow)               |
| Deterministic saved rubric            | ✅   | ossf/scorecard            |      | [ossf/scorecard](https://github.com/ossf/scorecard)                         |
| Reproducible rerun + diff             | ✅   | ossf/scorecard            |      | [ossf/scorecard](https://github.com/ossf/scorecard)                         |
| Parallel comparator fan-out           | ✅   | deer-flow                 |      | [bytedance/deer-flow](https://github.com/bytedance/deer-flow)               |
| Machine-readable matrix (JSON)        | ✅   | ossf/scorecard            |      | [ossf/scorecard](https://github.com/ossf/scorecard)                         |
| Standalone shareable report export    | ✅   | gpt-researcher            |      | [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) |

## Actionable gaps (high confidence)

_None — frontier status; no high-confidence gaps._

## Audit trail

**Sources**
- [bytedance/deer-flow](https://github.com/bytedance/deer-flow) (technically-advanced) — 73.1k⭐
- [stanford-oval/storm](https://github.com/stanford-oval/storm) (stale-reference) — 29.2k⭐
- [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) (canonical) — 27.8k⭐
- [langchain-ai/open_deep_research](https://github.com/langchain-ai/open_deep_research) (popular) — 11.8k⭐
- [ossf/scorecard](https://github.com/ossf/scorecard) (canonical) — 5.5k⭐
- [debba/gaphunter-skill](https://github.com/debba/gaphunter-skill) (niche-relevant) — 15⭐
- _unverified:_ Repo Research (Claude Code skill, mcpmarket) — same-modality skill that discovers + analyzes external repos and writes comparative Markdown reports; could not verify rubric/persistence this run (source 429) — listed, not scored.

**Disclosures**

Standard mode — light saturation. Field refreshed live via gh (deer-flow 73.1k and fresh; gpt-researcher 27.8k; storm ~9mo stale; scorecard 5.5k). No new table-stakes surfaced, so the rubric stays at v3. The prior edge gap shareable-report-export is now MET: scripts/sota-report.mjs (lib/report.mjs) exports .sota/report.<domain>.md. Edge now 3/3. One same-modality candidate (Repo Research skill) remained unverifiable (429) and is listed, not scored.
