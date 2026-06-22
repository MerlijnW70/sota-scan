// Tests for the standalone report renderer (lib/report.mjs).
// Hermetic: builds its own scan fixtures, never reads .sota, so it is deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";

import { renderReport, reportDomain } from "../lib/report.mjs";

const SCAN = {
  date: "2026-06-22",
  mode: "standard",
  domains: ["sota-benchmark-agent"],
  tier: "FRONTIER",
  verdict: "Frontier — everything present.",
  field: [
    { repo: "assafelovic/gpt-researcher", stars: 27842, type: "canonical" },
    { repo: "bytedance/deer-flow", stars: 73118, type: "technically-advanced" },
  ],
  field_unverified: [{ name: "Repo Research (skill)", note: "429 — not scored" }],
  matrix: [
    {
      id: "web-retrieval",
      capability: "Multi-source retrieval",
      us: "met",
      tier: "table-stakes",
      sota: "gpt-researcher",
      reference: "assafelovic/gpt-researcher",
    },
    {
      id: "shareable-report-export",
      capability: "Report export",
      us: "missing",
      tier: "edge",
      sota: "gpt-researcher",
      reference: "assafelovic/gpt-researcher → report export",
    },
  ],
  coverage: { met: 7, total: 7, pct: 100 },
  edge_coverage: { met: 2, total: 3 },
  gaps: [
    {
      capability: "Report export",
      id: "shareable-report-export",
      tier: "edge",
      gap: "high",
      impl: "medium",
      why: "peers ship a shareable file",
      study: "assafelovic/gpt-researcher → export",
      step: "add scripts/sota-report.mjs",
    },
    { capability: "Local clone diffing", gap: "low", why: "nice-to-have" },
  ],
  caveat: "Standard mode — light saturation.",
};

test("renderReport is deterministic — identical input, identical output", () => {
  assert.equal(renderReport(SCAN), renderReport(SCAN));
});

test("report contains the required sections and header metadata", () => {
  const md = renderReport(SCAN);
  assert.match(md, /^# SOTA Report — sota-benchmark-agent/m);
  assert.match(md, /- \*\*Date:\*\* 2026-06-22/);
  assert.match(md, /- \*\*Tier:\*\* FRONTIER/);
  assert.match(md, /## Summary/);
  assert.match(md, /## Capability matrix/);
  assert.match(md, /## Actionable gaps \(high confidence\)/);
  assert.match(md, /## Audit trail/);
});

test("summary reflects coverage and edge tallies", () => {
  assert.match(renderReport(SCAN), /FRONTIER · 7\/7 table-stakes met · 2\/3 edge/);
});

test("matrix renders a valid GFM table with aligned, consistent columns", () => {
  const md = renderReport(SCAN);
  const lines = md.split("\n").filter((l) => l.startsWith("|"));
  assert.ok(lines.length >= 4, "header + separator + 2 rows");
  const cols = (l) => l.split("|").length; // leading/trailing pipes => constant count
  const expected = cols(lines[0]);
  for (const l of lines) {
    assert.equal(cols(l), expected, `ragged row: ${l}`);
  }
  // The separator row is all dashes/spaces/pipes.
  assert.match(lines[1], /^\|[-| ]+\|$/);
  // A met capability shows ✅ and a blank Gap? cell; a missing one shows ❌ + tier.
  assert.match(md, /Multi-source retrieval\s*\| ✅/);
  assert.match(md, /Report export\s*\| ❌ .*\| edge/);
});

test("audit trail hyperlinks owner/repo sources to GitHub", () => {
  const md = renderReport(SCAN);
  assert.match(
    md,
    /\[assafelovic\/gpt-researcher\]\(https:\/\/github\.com\/assafelovic\/gpt-researcher\)/,
  );
  assert.match(md, /27\.8k⭐/);
  assert.match(md, /_unverified:_ Repo Research \(skill\)/);
  assert.match(md, /\*\*Disclosures\*\*/);
});

test("actionable gap list extracts only gap:high items", () => {
  const md = renderReport(SCAN);
  assert.match(md, /- \*\*Report export\*\* \(edge\) — peers ship a shareable file/);
  // The low-confidence gap must not appear in the high-confidence section.
  assert.doesNotMatch(md, /Local clone diffing/);
});

test("a frontier scan with no high gaps renders the empty-state line", () => {
  const clean = { ...SCAN, gaps: [] };
  assert.match(renderReport(clean), /_None — frontier status; no high-confidence gaps\._/);
});

test("reportDomain slugifies the first declared domain", () => {
  assert.equal(reportDomain(SCAN), "sota-benchmark-agent");
  assert.equal(reportDomain({ domain: "Git Hook / Quality Gate" }), "git-hook-quality-gate");
});
