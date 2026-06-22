// Export a sota-scan run as a standalone, shareable Markdown report.
//
//   node scripts/sota-report.mjs            # preview to stdout (writes nothing)
//   node scripts/sota-report.mjs --report   # write .sota/report.<domain>.md
//   node scripts/sota-report.mjs --check     # fail if the on-disk report is stale
//
// Reads .sota/last-scan.json and renders it via lib/report.mjs (pure + deterministic),
// so the same scan always produces the same report. Native I/O only — no dependencies.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { renderReport, reportDomain } from "../lib/report.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sotaDir = join(here, "..", ".sota");
const scanPath = join(sotaDir, "last-scan.json");

function loadScan() {
  if (!existsSync(scanPath)) {
    console.error(`sota-report: no scan found at ${scanPath} — run a sota-scan first.`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(scanPath, "utf8"));
  } catch (e) {
    console.error(`sota-report: could not parse ${scanPath} — ${e.message}`);
    process.exit(1);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  const scan = loadScan();
  const markdown = renderReport(scan);
  const outPath = join(sotaDir, `report.${reportDomain(scan)}.md`);

  if (args.has("--check")) {
    const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
    if (current !== markdown) {
      console.error(`sota-report: ${outPath} is missing or stale — regenerate with --report.`);
      process.exit(1);
    }
    console.log(`sota-report: ${outPath} is up to date.`);
    return;
  }

  if (args.has("--report")) {
    writeFileSync(outPath, markdown);
    console.log(`sota-report: wrote ${outPath} (${markdown.length} bytes).`);
    return;
  }

  // Default: preview without touching disk.
  process.stdout.write(markdown);
}

main();
