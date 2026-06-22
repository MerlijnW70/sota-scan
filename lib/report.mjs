// Deterministic Markdown report renderer for a sota-scan run.
//
// Pure: `renderReport(scan)` maps a parsed .sota/last-scan.json object to a standalone,
// GitHub-Flavored-Markdown string — no I/O, no clock, no randomness. The same scan
// object always yields byte-identical output, so a regenerated report only changes when
// the scan does. scripts/sota-report.mjs is the thin CLI that reads/writes files.

const US_SYMBOL = { met: "✅", partial: "⚠️", missing: "❌" };

// Status glyph for the Us column; unknown values pass through unchanged.
function usSymbol(us) {
  return US_SYMBOL[us] ?? String(us);
}

// "Gap?" cell: blank when we have the capability, otherwise its tier.
function gapCell(row) {
  return row.us === "met" ? "" : (row.tier ?? "");
}

// owner/repo → a GitHub link; any other string is returned verbatim.
function repoLink(repo) {
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `[${repo}](https://github.com/${repo})` : repo;
}

// A Reference cell: "owner/repo", "owner/repo → feature", a path, or free text.
function referenceCell(ref) {
  if (!ref) return "—";
  const arrow = ref.indexOf("→");
  if (arrow !== -1) {
    return `${repoLink(ref.slice(0, arrow).trim())} ${ref.slice(arrow).trim()}`;
  }
  return repoLink(ref);
}

// Render a GFM table with each column padded to a fixed width (min 3, so the dash
// separator is always valid) for readability in a raw editor; web previewers align
// by the pipes regardless. `rows` is an array of string arrays matching `headers`.
function mdTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(3, h.length, ...rows.map((r) => String(r[i] ?? "").length)),
  );
  const line = (cells) =>
    `| ${cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join(" | ")} |`;
  const sep = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  return [line(headers), sep, ...rows.map(line)].join("\n");
}

// "FRONTIER · 7/7 table-stakes met · 2/3 edge" — derived from coverage, deterministic.
function summaryLine(scan) {
  const cov = scan.coverage ?? {};
  const edge = scan.edge_coverage;
  const parts = [scan.tier ?? "?"];
  if (cov.met !== undefined && cov.total !== undefined) {
    parts.push(`${cov.met}/${cov.total} table-stakes met`);
  }
  if (edge && edge.met !== undefined && edge.total !== undefined) {
    parts.push(`${edge.met}/${edge.total} edge`);
  }
  return parts.join(" · ");
}

function headerSection(scan, domain) {
  return [
    `# SOTA Report — ${domain}`,
    "",
    `- **Date:** ${scan.date ?? "unknown"}`,
    `- **Domain:** ${domain}`,
    `- **Tier:** ${scan.tier ?? "?"}`,
    `- **Mode:** ${scan.mode ?? "?"}`,
  ].join("\n");
}

function summarySection(scan) {
  const lines = ["## Summary", "", `**${summaryLine(scan)}**`];
  if (scan.verdict) {
    lines.push("", scan.verdict);
  }
  return lines.join("\n");
}

function matrixSection(scan) {
  const rows = (scan.matrix ?? []).map((row) => [
    row.capability ?? row.id,
    usSymbol(row.us),
    row.sota ?? "—",
    gapCell(row),
    referenceCell(row.reference),
  ]);
  const table = rows.length
    ? mdTable(["Capability", "Us", "SOTA", "Gap?", "Reference"], rows)
    : "_No matrix rows recorded._";
  return ["## Capability matrix", "", table].join("\n");
}

function gapsSection(scan) {
  const high = (scan.gaps ?? []).filter((g) => g.gap === "high");
  const lines = ["## Actionable gaps (high confidence)", ""];
  if (high.length === 0) {
    lines.push("_None — frontier status; no high-confidence gaps._");
    return lines.join("\n");
  }
  for (const g of high) {
    const tier = g.tier ? ` (${g.tier})` : "";
    lines.push(`- **${g.capability ?? g.id}**${tier} — ${g.why ?? ""}`.trimEnd());
    if (g.study) lines.push(`  - Study: ${referenceCell(g.study)}`);
    if (g.step) lines.push(`  - Step 1: ${g.step}`);
  }
  return lines.join("\n");
}

// "73.1k⭐" for thousands, "15⭐" for small counts — never round 15 down to "0.0k".
function starLabel(stars) {
  if (stars === undefined) return "";
  return stars >= 1000 ? ` — ${(stars / 1000).toFixed(1)}k⭐` : ` — ${stars}⭐`;
}

function auditSection(scan) {
  const lines = ["## Audit trail", "", "**Sources**"];
  for (const f of scan.field ?? []) {
    const type = f.type ? ` (${f.type})` : "";
    lines.push(`- ${repoLink(f.repo)}${type}${starLabel(f.stars)}`);
  }
  for (const u of scan.field_unverified ?? []) {
    lines.push(`- _unverified:_ ${u.name}${u.note ? ` — ${u.note}` : ""}`);
  }
  if (scan.caveat) {
    lines.push("", "**Disclosures**", "", scan.caveat);
  }
  return lines.join("\n");
}

// Render the full report for a parsed last-scan.json object.
export function renderReport(scan) {
  const domain = reportDomain(scan);
  return (
    [
      headerSection(scan, domain),
      summarySection(scan),
      matrixSection(scan),
      gapsSection(scan),
      auditSection(scan),
    ].join("\n\n") + "\n"
  );
}

// The domain slug a report is written for: first declared domain, sanitised.
export function reportDomain(scan) {
  const raw = (scan.domains && scan.domains[0]) || scan.domain || "unknown";
  return String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
