export const meta = {
  name: 'sota-scan-fanout',
  description: 'Exhaustive sota-scan fan-out: analyze each pre-discovered comparator concurrently, then synthesize field+rubric+matrix. Returns structured JSON; the caller writes the .sota artifacts.',
  phases: [
    { title: 'Fetch', detail: 'one agent per comparator → structured capability record' },
    { title: 'Synthesize', detail: 'merge records vs us-inventory into matrix + ranked gaps' },
  ],
}

// ── Contract ────────────────────────────────────────────────────────────────
// args (passed by the sota-scan skill after it discovers the field inline):
//   {
//     domain:    "git-hook-quality-gate",
//     comparators: [ { repo:"owner/name", url:"https://...", type:"canonical" }, ... ],  // discovered inline
//     rubric:    { domain, version, capabilities:[{id,tier,test}] } | null,              // existing rubric or null
//     us:        [ { id, name, status:"met|partial|missing", file:"path → backing file" } ] // Step-0 inventory
//   }
// returns: { field, rubric, matrix, coverage, tier, gaps_total, gaps }  — NO files written (no FS in workflows).
// ─────────────────────────────────────────────────────────────────────────────

// args normally arrives parsed, but some callers/harnesses deliver it as a JSON string — tolerate both.
let a = args || {}
if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { a = {} } }
const comparators = Array.isArray(a.comparators) ? a.comparators : []
const usInventory = Array.isArray(a.us) ? a.us : []
const priorRubric = a.rubric || null
const domain = a.domain || 'unknown-domain'

if (!comparators.length) {
  return { error: 'no comparators passed — discovery must happen inline in the skill before calling this workflow', field: [], matrix: [], gaps: [] }
}

const COMPARATOR_RECORD = {
  type: 'object',
  required: ['repo', 'url', 'type', 'capabilities'],
  additionalProperties: false,
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    url: { type: 'string' },
    type: { type: 'string', enum: ['canonical', 'popular', 'technically advanced', 'niche-relevant', 'stale-reference'] },
    stars: { type: ['integer', 'null'], description: 'exact via gh; null if unobtainable' },
    pushed: { type: ['string', 'null'], description: 'last-push ISO date' },
    archived: { type: ['boolean', 'null'] },
    why: { type: 'string', description: 'one line: why this repo is in the field, justified by its type not its stars' },
    capabilities: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'evidence', 'confidence'],
        additionalProperties: false,
        properties: {
          id: { type: 'string', description: 'kebab-case capability id; reuse rubric ids when one is supplied' },
          name: { type: 'string' },
          evidence: {
            type: 'object',
            required: ['kind', 'reference'],
            additionalProperties: false,
            properties: {
              kind: { type: 'string', enum: ['code', 'docs', 'changelog', 'registry', 'blog', 'secondary'] },
              reference: { type: 'string', description: 'owner/name → path or feature; file path only if confirmed' },
            },
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const SYNTHESIS = {
  type: 'object',
  required: ['field', 'rubric', 'matrix', 'coverage', 'tier', 'gaps_total', 'gaps'],
  additionalProperties: false,
  properties: {
    field: {
      type: 'array',
      items: {
        type: 'object',
        required: ['repo', 'type', 'why'],
        properties: {
          repo: { type: 'string' }, type: { type: 'string' },
          stars: { type: ['integer', 'null'] }, pushed: { type: ['string', 'null'] },
          archived: { type: ['boolean', 'null'] }, why: { type: 'string' },
        },
      },
    },
    rubric: {
      type: 'object',
      required: ['domain', 'version', 'capabilities'],
      properties: {
        domain: { type: 'string' },
        version: { type: 'integer' },
        capabilities: {
          type: 'array',
          items: { type: 'object', required: ['id', 'tier', 'test'], properties: {
            id: { type: 'string' }, tier: { type: 'string', enum: ['table-stakes', 'edge'] }, test: { type: 'string' },
          } },
        },
      },
    },
    matrix: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'us', 'tier'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' },
          us: { type: 'string', enum: ['met', 'partial', 'missing'] },
          sota: { type: 'string', description: 'which repo(s) demonstrate it' },
          tier: { type: 'string', enum: ['table-stakes', 'edge'] },
          reference: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    coverage: { type: 'object', required: ['met', 'total', 'pct'], properties: {
      met: { type: 'integer' }, total: { type: 'integer' }, pct: { type: 'integer' },
    } },
    tier: { type: 'string', enum: ['FRONTIER', 'COMPETITIVE', 'BEHIND', 'LAGGING'] },
    gaps_total: { type: 'integer' },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rank', 'capability', 'tier', 'confidence', 'why', 'study', 'step1'],
        properties: {
          rank: { type: 'integer' },
          capability: { type: 'string' },
          tier: { type: 'string', enum: ['table-stakes', 'edge'] },
          effort: { type: 'string', description: '~2h / ~1d / ~3d estimate' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          why: { type: 'string' },
          study: { type: 'string', description: 'owner/repo → file/feature to copy from' },
          step1: { type: 'string', description: 'patch-oriented: first file to create/edit AND first function/command/test' },
        },
      },
    },
  },
}

// ── Phase 1: fan out — one analyzer per comparator (barrier: synthesis needs them all) ──
phase('Fetch')
log(`Analyzing ${comparators.length} comparators concurrently`)

const rubricHint = priorRubric
  ? `Score capabilities against THIS existing rubric where they map (reuse its ids):\n${JSON.stringify(priorRubric.capabilities)}`
  : `No saved rubric yet — surface the repo's notable capabilities bottom-up with stable kebab-case ids.`

const records = (await parallel(comparators.map((c) => () =>
  agent(
    `You are analyzing ONE comparator repo for a state-of-the-art benchmark in the domain "${domain}".

Repo: ${c.repo}
URL: ${c.url}
Pre-tagged type hint: ${c.type || '(confirm it yourself)'}

Do this:
1. Pull hard signals with gh if available: \`gh api repos/${c.repo} --jq '{stars:.stargazers_count, pushed:.pushed_at, archived:.archived}'\`. If gh is unavailable, fetch the repo page and mark figures soft (you may leave stars null rather than guess).
2. Confirm or correct the comparator type (canonical / popular / technically advanced / niche-relevant / stale-reference). Justify inclusion by type, not stars.
3. Read README/docs AND, where it matters, the actual code to extract its concrete capabilities. Prefer evidence in this order: code > docs > changelog > registry > blog > secondary. Do NOT assert a capability from a README marketing claim alone when code/docs could verify it.
4. For each capability give: stable id (reuse rubric ids when supplied), name, evidence {kind, reference} where reference is "${c.repo} → path-or-feature" (name a file path ONLY if you confirmed it exists), and a confidence label.

${rubricHint}

Return ONLY the structured record. Your text IS the data, not a message to a human.`,
    { label: `fetch:${c.repo}`, phase: 'Fetch', schema: COMPARATOR_RECORD },
  )
))).filter(Boolean)

if (!records.length) {
  return { error: 'every comparator analysis failed — likely no web/gh access', field: [], matrix: [], gaps: [] }
}

// ── Phase 2: synthesize — one pass over ALL records + the us-inventory ──
phase('Synthesize')
log(`Synthesizing matrix from ${records.length} records`)

const result = await agent(
  `You are the synthesis stage of a state-of-the-art benchmark for the domain "${domain}".

OUR repo's capability inventory (the "Us" column — each item names its backing file):
${JSON.stringify(usInventory, null, 2)}

The field (one structured record per comparator, gathered concurrently):
${JSON.stringify(records, null, 2)}

${priorRubric
    ? `An existing rubric is supplied — score against THIS list so coverage/tier stay comparable across runs. If this field surfaces a genuinely new table-stakes capability, ADD it and BUMP the version, and the rubric you return must reflect that:\n${JSON.stringify(priorRubric, null, 2)}`
    : `No saved rubric — derive the capability list bottom-up from what the field expects (rows = capabilities the field demands, not invented ones) and return it as version 1.`}

Produce:
- field[]: the leaderboard (repo, type, stars, pushed, archived, why) — top entries first.
- rubric: {domain, version, capabilities:[{id, tier:"table-stakes|edge", test}]}. table-stakes = everyone serious has it; edge = nice-to-have.
- matrix[]: one row per rubric capability — {id, name, us:"met|partial|missing", sota (which repos demonstrate it), tier, reference (owner/repo → file/feature; never empty, never a guessed path), confidence}. The "us" value must be justifiable from the Us inventory above.
- coverage: {met, total, pct} computed over TABLE-STAKES capabilities only. pct = round(met/total*100).
- tier: gaps = table-stakes capabilities we MISS or only PARTIAL. FRONTIER=0 · COMPETITIVE=1-2 · BEHIND=3-4 · LAGGING=5+.
- gaps_total: true count of table-stakes gaps.
- gaps[]: ranked worst-first. Each {rank, capability, tier, effort (~2h/~1d/~3d guess), confidence, why (for THIS repo's goal), study (owner/repo → file to copy), step1 (PATCH-ORIENTED: name the first file to create/edit AND the first function/command/test to add — not "create a loader")}. Include all gaps; the skill will cap the display.

Hard rules: no gap without a cited source; no guessed file paths; every gap must be tied to both repo evidence and external evidence. Return ONLY the structured object.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS },
)

return result
