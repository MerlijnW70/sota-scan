export const meta = {
  name: 'sota-scan-fanout',
  description: 'Exhaustive sota-scan fan-out: profile each pre-discovered candidate, cluster them into peer groups, classify our repo into the closest cluster, then synthesize a cluster-scoped matrix + sectioned gaps. Returns structured JSON; the caller writes the .sota artifacts.',
  phases: [
    { title: 'Profile', detail: 'one agent per candidate → structured metadata + capability profile' },
    { title: 'Cluster', detail: 'deterministic: group peers, classify our repo, pick direct vs reference repos' },
    { title: 'Synthesize', detail: 'cluster-scoped matrix + gaps split into peer / maturity / onboarding / cross-cluster' },
  ],
}

// ── Contract ────────────────────────────────────────────────────────────────
// args (passed by the sota-scan skill after it discovers the candidate pool inline):
//   {
//     domain:    "context-management",
//     comparators: [ { repo:"owner/name", url:"https://...", type:"canonical" }, ... ],  // candidate POOL (aim for 50+)
//     rubric:    { domain, version, capabilities:[{id,tier,test}] } | null,              // existing rubric or null
//     us:        [ { id, name, status:"met|partial|missing", file:"path → backing file" } ], // Step-0 capability inventory
//     us_profile:{ primary_domain, methodology, target_user, feature_categories:[..], cluster_label } | null  // our repo's profile
//   }
// returns: { domain, clusters, user_cluster, selection, selection_explanation,
//            field, rubric, matrix, coverage, tier, gaps_total, gaps:{direct_peer,maturity,onboarding,cross_cluster} }
//          — NO files written (no FS in workflows).
// ─────────────────────────────────────────────────────────────────────────────

// args normally arrives parsed, but some callers/harnesses deliver it as a JSON string — tolerate both.
let a = args || {}
if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { a = {} } }
const comparators = Array.isArray(a.comparators) ? a.comparators : []
const usInventory = Array.isArray(a.us) ? a.us : []
const priorRubric = a.rubric || null
const domain = a.domain || 'unknown-domain'
let usProfile = a.us_profile || null

if (!comparators.length) {
  return { error: 'no comparators passed — discovery must happen inline in the skill before calling this workflow', clusters: [], field: [], matrix: [], gaps: { direct_peer: [], maturity: [], onboarding: [], cross_cluster: [] } }
}

/*__CORE_START__ inlined verbatim from lib/cluster.mjs — the Workflow sandbox cannot import modules; the test/cluster.test.mjs sync guard asserts this copy matches the source */
// Normalize an arbitrary label/word into a stable kebab token form.
function kebab(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Trivial singularization so "embeddings" and "embedding" hash together.
function singular(tok) {
  if (tok.length > 4 && tok.endsWith('ies')) return tok.slice(0, -3) + 'y'
  if (tok.length > 3 && tok.endsWith('es')) return tok.slice(0, -2)
  if (tok.length > 3 && tok.endsWith('s') && !tok.endsWith('ss')) return tok.slice(0, -1)
  return tok
}

// Stop-tokens that carry no clustering signal (every repo "is", "a", "for" …).
const STOP = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'with', 'over', 'on', 'in',
  'based', 'system', 'tool', 'tools', 'library', 'lib', 'framework', 'engine',
  'using', 'via', 'your', 'their', 'context', 'management', 'data',
])

function toTokens(text) {
  return kebab(text)
    .split('-')
    .map(singular)
    .filter((t) => t && t.length > 1 && !STOP.has(t))
}

// The bag of tokens that describes a candidate repo for similarity purposes.
// Methodology and feature tags are weighted heaviest (they define the approach);
// the cluster_label and primary_domain add a few more signal tokens.
function profileTokens(p) {
  if (!p || typeof p !== 'object') return new Set()
  const out = new Set()
  const add = (text) => toTokens(text).forEach((t) => out.add(t))
  add(p.cluster_label)
  add(p.methodology)
  add(p.primary_domain)
  if (Array.isArray(p.feature_categories)) p.feature_categories.forEach(add)
  return out
}

function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a)
  const B = b instanceof Set ? b : new Set(b)
  if (A.size === 0 && B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

// Overlap coefficient = |A ∩ B| / min(|A|, |B|). Measures how fully the SMALLER
// set is contained in the larger — the right test for absorbing a stray small
// label (e.g. "fuzzy-finder") into the big canonical cluster it sits inside,
// where Jaccard is diluted by the large cluster's many tokens.
function overlapCoeff(a, b) {
  const A = a instanceof Set ? a : new Set(a)
  const B = b instanceof Set ? b : new Set(b)
  const min = Math.min(A.size, B.size)
  if (min === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / min
}

// Deterministic maturity score in [0,1] plus an auditable breakdown.
// `now` is passed in (no Date.now) so the score is reproducible in tests.
function maturityScore(p, now) {
  const m = (p && p.maturity) || {}
  const stars = Number.isFinite(m.stars) ? m.stars : 0
  // log-scaled stars: ~0 at 0 stars, ~1.0 at 100k.
  const starScore = Math.min(1, Math.log10(stars + 1) / 5)

  let recencyScore = 0.3 // unknown date → mild benefit of the doubt
  const last = parseDate(m.last_commit)
  const ref = parseDate(now)
  if (last != null && ref != null) {
    const days = (ref - last) / 86400000
    // 1.0 if committed today, decays to 0 by ~2 years stale.
    recencyScore = clamp01(1 - days / 730)
  }

  const signals = ['has_docs', 'has_tests', 'has_examples', 'releases']
  const signalHits = signals.reduce((n, k) => n + (m[k] ? 1 : 0), 0)
  const signalScore = signalHits / signals.length

  const score =
    0.4 * starScore + 0.3 * recencyScore + 0.3 * signalScore
  return {
    score: round3(score),
    breakdown: { starScore: round3(starScore), recencyScore: round3(recencyScore), signalScore: round3(signalScore), signalHits },
    stale: recencyScore < 0.2,
  }
}

// Days-only date parse that does not rely on Date.now / locale.
function parseDate(s) {
  if (!s || typeof s !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const round3 = (x) => Math.round(x * 1000) / 1000

// ── Clustering ────────────────────────────────────────────────────────────────
//
// 1. Seed one group per normalized cluster_label.
// 2. Union-find merge groups that are clearly the same peer space — either their
//    labels share most tokens, OR their member-token centroids overlap strongly
//    (this collapses synonyms like "fuzzy-finder" → "fuzzy-file-search").
// 3. Emit clusters sorted by size (desc) then id, each with a token centroid.
//
// Transparent on purpose: the merge reason is recorded so the report can explain
// why two labels became one cluster.
function clusterCandidates(profiles, opts = {}) {
  const labelMergeThreshold = opts.labelMergeThreshold ?? 0.7
  const absorbOverlapThreshold = opts.absorbOverlapThreshold ?? 0.6
  const smallGroupAbsorbMax = opts.smallGroupAbsorbMax ?? 2
  const list = Array.isArray(profiles) ? profiles.filter(Boolean) : []

  // Seed groups by normalized label.
  const seeds = new Map() // id -> { id, label, members:[], tokens:Set }
  for (const p of list) {
    const id = kebab(p.cluster_label) || 'unlabeled'
    if (!seeds.has(id)) seeds.set(id, { id, label: id, members: [], tokens: new Set() })
    const g = seeds.get(id)
    g.members.push(p)
    for (const t of profileTokens(p)) g.tokens.add(t)
  }

  const groups = [...seeds.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // Union-find over the seed groups.
  const parent = new Map(groups.map((g) => [g.id, g.id]))
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  const merges = []
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i]
      const b = groups[j]
      const labelSim = jaccard(new Set(a.id.split('-')), new Set(b.id.split('-')))
      // Absorb-by-overlap is gated to small stray groups so two well-populated
      // canonical clusters can never collapse into one — only a 1–2 member stray
      // label gets pulled into the canonical cluster whose tokens contain it.
      const minMembers = Math.min(a.members.length, b.members.length)
      const overlap = overlapCoeff(a.tokens, b.tokens)
      const absorb = minMembers <= smallGroupAbsorbMax && overlap >= absorbOverlapThreshold
      if (labelSim >= labelMergeThreshold || absorb) {
        const ra = find(a.id)
        const rb = find(b.id)
        if (ra !== rb) {
          // Keep the larger group's id as the canonical label.
          const sizeA = seeds.get(ra).members.length
          const sizeB = seeds.get(rb).members.length
          const [keep, drop] = sizeA >= sizeB ? [ra, rb] : [rb, ra]
          parent.set(drop, keep)
          merges.push({ kept: keep, merged: drop, by: labelSim >= labelMergeThreshold ? 'label' : 'overlap', labelSim: round3(labelSim), overlap: round3(overlap) })
        }
      }
    }
  }

  // Collapse to final clusters.
  const finals = new Map()
  for (const g of groups) {
    const root = find(g.id)
    if (!finals.has(root)) finals.set(root, { id: root, label: root, members: [], tokens: new Set(), mergedFrom: new Set([root]) })
    const f = finals.get(root)
    for (const p of g.members) f.members.push(p)
    for (const t of g.tokens) f.tokens.add(t)
    if (g.id !== root) f.mergedFrom.add(g.id)
  }

  const clusters = [...finals.values()]
    .map((f) => ({
      id: f.id,
      label: f.id,
      size: f.members.length,
      members: f.members,
      centroid: f.tokens,
      mergedFrom: [...f.mergedFrom].sort(),
    }))
    .sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1))

  return { clusters, merges }
}

// ── Classifying the user repo into the closest cluster ─────────────────────────
function classifyRepo(userProfile, clusters, opts = {}) {
  const strong = opts.strongThreshold ?? 0.35
  const secondaryThreshold = opts.secondaryThreshold ?? 0.15
  const weak = opts.weakThreshold ?? 0.1
  const userTokens = profileTokens(userProfile)
  const userLabel = kebab(userProfile && userProfile.cluster_label)

  if (!clusters || clusters.length === 0) {
    return { primaryId: null, confidence: 'low', degraded: true, secondary: [], scores: [], reason: 'no clusters available — field treated as one undifferentiated group' }
  }

  // Exact / near-exact label hit beats token similarity.
  const labelHit = clusters.find(
    (c) => c.id === userLabel || (c.mergedFrom || []).includes(userLabel) ||
      jaccard(new Set(c.id.split('-')), new Set(userLabel.split('-'))) >= (opts.labelMergeThreshold ?? 0.7),
  )

  const scores = clusters
    .map((c) => ({ id: c.id, score: round3(jaccard(userTokens, c.centroid)) }))
    .sort((a, b) => b.score - a.score)

  const best = scores[0]
  if (labelHit) {
    const secondary = scores.filter((s) => s.id !== labelHit.id && s.score >= secondaryThreshold).map((s) => s.id)
    return { primaryId: labelHit.id, confidence: 'high', degraded: false, secondary, scores, reason: `user cluster_label "${userLabel}" matched cluster "${labelHit.id}"` }
  }

  if (!best || best.score < weak) {
    return { primaryId: null, confidence: 'low', degraded: true, secondary: [], scores, reason: `no cluster scored above ${weak} similarity — field treated as one group (best ${best ? best.id + ' @ ' + best.score : 'n/a'})` }
  }

  const confidence = best.score >= strong ? 'medium' : 'low'
  const secondary = scores.slice(1).filter((s) => s.score >= secondaryThreshold).map((s) => s.id)
  return { primaryId: best.id, confidence, degraded: false, secondary, scores, reason: `closest cluster by methodology/feature overlap: "${best.id}" @ ${best.score}` }
}

// ── Selecting direct comparators vs. broader references ────────────────────────
function selectBenchmarks(clusters, classification, opts = {}) {
  const now = opts.now
  const refPerCluster = opts.refPerCluster ?? 2
  const minMaturityForRef = opts.minMaturityForRef ?? 0
  const byMaturity = (a, b) => maturityScore(b, now).score - maturityScore(a, now).score

  const repoOf = (p) => p.repo
  const ranked = (members) => [...members].sort(byMaturity)

  // Degraded path: no confident cluster → one flat peer group, top-by-maturity.
  if (!classification || classification.degraded || !classification.primaryId) {
    const all = clusters.flatMap((c) => c.members)
    const direct = ranked(all).slice(0, opts.directMax ?? all.length)
    return {
      degraded: true,
      primaryClusterId: null,
      direct: direct.map(repoOf),
      directProfiles: direct,
      references: [],
      excluded: [],
      note: 'no distinct peer cluster — compared against the whole field ranked by maturity',
    }
  }

  const primary = clusters.find((c) => c.id === classification.primaryId)
  const directProfiles = ranked(primary ? primary.members : [])
  const direct = directProfiles.map(repoOf)

  const references = []
  const excluded = []
  for (const c of clusters) {
    if (c.id === classification.primaryId) continue
    const ranks = ranked(c.members)
    let taken = 0
    for (const p of ranks) {
      const mat = maturityScore(p, now)
      if (taken < refPerCluster && mat.score >= minMaturityForRef) {
        references.push({ repo: repoOf(p), cluster: c.id, maturity: mat.score, why: `top of "${c.id}" cluster — broader-space reference, not a direct peer` })
        taken++
      } else {
        excluded.push({ repo: repoOf(p), cluster: c.id, reason: `other cluster "${c.id}"${mat.stale ? ', stale' : ''} — kept as background, not a direct comparator` })
      }
    }
  }

  return {
    degraded: false,
    primaryClusterId: classification.primaryId,
    direct,
    directProfiles,
    references,
    excluded,
    note: null,
  }
}

// ── Routing gaps into honest sections ─────────────────────────────────────────
//
// Enforces the central fairness rule deterministically: any gap whose evidence
// comes from a NON-primary cluster is forced into `cross_cluster` and marked
// strategic/optional — it can never be presented as a mandatory missing feature,
// regardless of how the synthesis agent labeled it. Only direct-peer + maturity +
// onboarding table-stakes count toward the coverage/tier gap total.
//
// Each gap is expected to carry: { capability, section?, source_cluster?, tier?, kind? }
//   section ∈ direct-peer | maturity | onboarding | cross-cluster
//   kind    ∈ (free) — 'docs'/'onboarding'/'tests'/'ci'/'release' route to onboarding/maturity
function partitionGaps(gaps, ctx = {}) {
  const primaryId = ctx.primaryClusterId || null
  const buckets = { direct_peer: [], maturity: [], onboarding: [], cross_cluster: [] }
  const MATURITY_KINDS = new Set(['tests', 'ci', 'releases', 'release', 'coverage', 'maturity'])
  const ONBOARDING_KINDS = new Set(['docs', 'doc', 'onboarding', 'examples', 'tutorial', 'quickstart', 'readme'])

  for (const g0 of Array.isArray(gaps) ? gaps : []) {
    const g = { ...g0 }
    const fromOtherCluster = g.source_cluster && primaryId && kebab(g.source_cluster) !== kebab(primaryId)
    let section = kebab(g.section || '')
    const kind = kebab(g.kind || '')

    // Hard rule: cross-cluster evidence is never a mandatory gap.
    if (fromOtherCluster || section === 'cross-cluster') {
      g.strategic = true
      g.optional = true
      g.tier = 'edge'
      buckets.cross_cluster.push(g)
      continue
    }

    if (section === 'maturity' || MATURITY_KINDS.has(kind)) {
      buckets.maturity.push(g)
    } else if (section === 'onboarding' || section === 'documentation' || ONBOARDING_KINDS.has(kind)) {
      buckets.onboarding.push(g)
    } else {
      // default: a genuine same-cluster capability gap
      buckets.direct_peer.push(g)
    }
  }
  return buckets
}

// Table-stakes gaps that count toward coverage/tier — EXCLUDES cross-cluster.
function countTableStakesGaps(buckets) {
  const isTs = (g) => (g.tier || 'table-stakes') === 'table-stakes'
  return (
    buckets.direct_peer.filter(isTs).length +
    buckets.maturity.filter(isTs).length +
    buckets.onboarding.filter(isTs).length
  )
}

function tierFor(gapCount) {
  if (gapCount <= 0) return 'FRONTIER'
  if (gapCount <= 2) return 'COMPETITIVE'
  if (gapCount <= 4) return 'BEHIND'
  return 'LAGGING'
}

// ── Human-auditable explanation of the benchmark selection ─────────────────────
function explainSelection(classification, clusters, selection, opts = {}) {
  const domain = opts.domain || 'unknown'
  const primary = clusters.find((c) => c.id === (selection && selection.primaryClusterId))
  const lines = []
  lines.push(`Detected domain: ${domain}`)
  if (selection && selection.degraded) {
    lines.push(`Detected cluster: none distinct — ${classification ? classification.reason : 'field treated as one group'}`)
    lines.push(`Direct comparators: top ${selection.direct.length} of the whole field by maturity (graceful fallback).`)
    return { lines, text: lines.join('\n') }
  }
  lines.push(`Detected cluster: ${selection.primaryClusterId} (confidence ${classification ? classification.confidence : '?'}) — ${classification ? classification.reason : ''}`)
  lines.push(`Clusters found: ${clusters.map((c) => `${c.id} (${c.size})`).join(', ')}`)
  lines.push(`Direct comparators (same cluster): ${selection.direct.join(', ') || '(none)'}`)
  lines.push(`Broader-space references: ${selection.references.map((r) => `${r.repo} [${r.cluster}]`).join(', ') || '(none)'}`)
  if (selection.excluded && selection.excluded.length) {
    lines.push(`Excluded from direct comparison: ${selection.excluded.length} repos in other clusters (background only).`)
  }
  if (primary && primary.mergedFrom && primary.mergedFrom.length > 1) {
    lines.push(`Note: cluster "${primary.id}" merged the labels ${primary.mergedFrom.join(' + ')} (same peer space).`)
  }
  return { lines, text: lines.join('\n') }
}
/*__CORE_END__*/

// ── Schemas ──────────────────────────────────────────────────────────────────
const MATURITY = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stars: { type: ['integer', 'null'] },
    last_commit: { type: ['string', 'null'], description: 'ISO date of last push' },
    has_docs: { type: ['boolean', 'null'] },
    has_tests: { type: ['boolean', 'null'] },
    has_examples: { type: ['boolean', 'null'] },
    releases: { type: ['boolean', 'null'] },
  },
}

const PROFILE = {
  type: 'object',
  required: ['repo', 'url', 'primary_domain', 'methodology', 'cluster_label', 'feature_categories', 'capabilities', 'maturity'],
  additionalProperties: false,
  properties: {
    repo: { type: 'string', description: 'owner/name' },
    url: { type: 'string' },
    description: { type: 'string' },
    readme_summary: { type: 'string', description: '2-3 sentence summary of what it does' },
    primary_domain: { type: 'string' },
    methodology: { type: 'string', description: 'the core approach/architecture, e.g. "fuzzy string matching" or "embedding vector store"' },
    target_user: { type: 'string' },
    feature_categories: { type: 'array', items: { type: 'string' }, description: '3-6 short kebab-case capability tags' },
    cluster_label: { type: 'string', description: 'a short kebab-case name for the methodology/peer group this repo belongs to (e.g. "fuzzy-file-search", "vector-database"). Use a CONSISTENT vocabulary across repos.' },
    type: { type: 'string', enum: ['canonical', 'popular', 'technically advanced', 'niche-relevant', 'stale-reference'] },
    maturity: MATURITY,
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

const US_PROFILE = {
  type: 'object',
  required: ['primary_domain', 'methodology', 'cluster_label', 'feature_categories'],
  additionalProperties: false,
  properties: {
    primary_domain: { type: 'string' },
    methodology: { type: 'string' },
    target_user: { type: 'string' },
    feature_categories: { type: 'array', items: { type: 'string' } },
    cluster_label: { type: 'string', description: 'which peer group OUR repo belongs to — use the SAME vocabulary you would apply to the candidates' },
  },
}

const SYNTHESIS = {
  type: 'object',
  required: ['rubric', 'matrix', 'coverage', 'gaps'],
  additionalProperties: false,
  properties: {
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
          sota: { type: 'string', description: 'which direct-cluster repo(s) demonstrate it' },
          tier: { type: 'string', enum: ['table-stakes', 'edge'] },
          reference: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    coverage: { type: 'object', required: ['met', 'total', 'pct'], properties: {
      met: { type: 'integer' }, total: { type: 'integer' }, pct: { type: 'integer' },
    } },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['rank', 'capability', 'section', 'tier', 'gap_confidence', 'impl_confidence', 'why', 'study', 'step1'],
        properties: {
          rank: { type: 'integer' },
          capability: { type: 'string' },
          section: { type: 'string', enum: ['direct-peer', 'maturity', 'onboarding', 'cross-cluster'], description: 'direct-peer = a capability our peers in the SAME cluster have; maturity = tests/CI/releases quality; onboarding = docs/examples/quickstart; cross-cluster = an idea borrowed from ANOTHER cluster (optional/strategic, never mandatory)' },
          source_cluster: { type: 'string', description: 'the cluster id this gap evidence comes from. If it is NOT our cluster, this is a cross-cluster idea.' },
          kind: { type: 'string', description: 'free tag, e.g. tests / ci / docs / examples / feature' },
          tier: { type: 'string', enum: ['table-stakes', 'edge'] },
          effort: { type: 'string', description: '~2h / ~1d / ~3d estimate' },
          gap_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          impl_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          needs_verification: { type: 'string' },
          why: { type: 'string' },
          study: { type: 'string', description: 'owner/repo → file/feature — SOURCE OF INSPIRATION (desired UX), not a verified integration path' },
          step1: { type: 'string', description: 'patch-oriented: first file to create/edit AND first function/command/test' },
        },
      },
    },
  },
}

// ── Phase 1: profile — one agent per candidate (extract metadata + capabilities) ──
phase('Profile')
log(`Profiling ${comparators.length} candidate repos concurrently`)

const rubricHint = priorRubric
  ? `Score capabilities against THIS existing rubric where they map (reuse its ids):\n${JSON.stringify(priorRubric.capabilities)}`
  : `No saved rubric yet — surface the repo's notable capabilities bottom-up with stable kebab-case ids.`

const profiles = (await parallel(comparators.map((c) => () =>
  agent(
    `You are profiling ONE candidate repo for a state-of-the-art benchmark in the broad domain "${domain}".

Repo: ${c.repo}
URL: ${c.url}
Pre-tagged type hint: ${c.type || '(confirm it yourself)'}

Do this:
1. Pull hard maturity signals with gh if available: \`gh api repos/${c.repo} --jq '{stars:.stargazers_count, pushed:.pushed_at, archived:.archived}'\`, and note whether the repo has docs, tests, examples, and tagged releases. If gh is unavailable, fetch the repo page and mark figures soft (leave stars null rather than guess).
2. Read README/docs AND, where it matters, the actual code to extract: a short description, a 2-3 sentence readme_summary, its primary_domain, its core methodology/architecture, its target_user, and 3-6 kebab-case feature_categories.
3. Assign a cluster_label: a **broad methodology FAMILY** name in kebab-case (e.g. "fuzzy-file-search", "vector-database", "classic-knowledge-graph", "deep-research-agent", "repo-quality-scorecard"). This is the most important field for grouping, and you are profiling in parallel with no view of the others — so pick the **most generic family that fits**, 1–3 words, based on HOW the repo works. Do NOT invent a hyper-specific per-repo label (❌ "langgraph-super-agent-harness", "iterative-llm-deep-research" — these fragment the field; ✅ "deep-research-agent" covers all of them). When two repos share a methodology, they MUST get the same family label even if their tech stacks differ.
4. Extract its concrete capabilities: each with a stable id (reuse rubric ids when supplied), name, evidence {kind, reference="${c.repo} → path-or-feature" — file path only if confirmed}, and a confidence label. Prefer evidence code > docs > changelog > registry > blog > secondary; do NOT assert a capability from a README marketing claim alone when code/docs could verify it.

${rubricHint}

Return ONLY the structured profile. Your text IS the data, not a message to a human.`,
    { label: `profile:${c.repo}`, phase: 'Profile', schema: PROFILE },
  )
))).filter(Boolean)

if (!profiles.length) {
  return { error: 'every candidate profile failed — likely no web/gh access', clusters: [], field: [], matrix: [], gaps: { direct_peer: [], maturity: [], onboarding: [], cross_cluster: [] } }
}

// If the skill did not supply our repo's profile, derive one so we can classify it.
if (!usProfile) {
  usProfile = await agent(
    `From OUR repo's capability inventory below, produce a profile in the SAME vocabulary used to cluster the candidate repos, for the domain "${domain}".

Our capability inventory:
${JSON.stringify(usInventory, null, 2)}

Assign a cluster_label describing OUR methodology/peer-group using the same kind of short kebab-case names the candidates use. Return ONLY the structured profile.`,
    { label: 'profile:us', phase: 'Profile', schema: US_PROFILE },
  )
}

// ── Phase 2: cluster (deterministic) — group peers, classify us, pick comparators ──
phase('Cluster')
const { clusters, merges } = clusterCandidates(profiles)
const classification = classifyRepo(usProfile, clusters)
const selection = selectBenchmarks(clusters, classification, { now: a.now || null })
const explanation = explainSelection(classification, clusters, selection, { domain })
log(`Found ${clusters.length} peer clusters; our repo → ${selection.primaryClusterId || 'no distinct cluster'} · ${selection.direct.length} direct comparators, ${selection.references.length} broader references`)

const profileByRepo = new Map(profiles.map((p) => [p.repo, p]))
const directProfiles = selection.directProfiles || []
const referenceProfiles = selection.references.map((r) => profileByRepo.get(r.repo)).filter(Boolean)

// ── Phase 3: synthesize — cluster-scoped matrix + sectioned gaps ──
phase('Synthesize')
log(`Synthesizing matrix from ${directProfiles.length} direct peers (+${referenceProfiles.length} references)`)

const result = await agent(
  `You are the synthesis stage of a state-of-the-art benchmark for the domain "${domain}".

We have already CLUSTERED the candidate pool into peer groups and classified OUR repo into one cluster. Benchmark us PRIMARILY against our DIRECT cluster — do not treat capabilities that only exist in other clusters as mandatory gaps.

OUR repo's profile: ${JSON.stringify(usProfile)}
OUR detected cluster: ${selection.primaryClusterId || '(none — field treated as one group)'}
OUR capability inventory (the "Us" column — each item names its backing file):
${JSON.stringify(usInventory, null, 2)}

DIRECT peers (same cluster — the rubric and matrix must be derived from what THESE repos expect):
${JSON.stringify(directProfiles, null, 2)}

BROADER-SPACE references (OTHER clusters — use ONLY for optional cross-cluster ideas, never for table-stakes gaps):
${JSON.stringify(referenceProfiles.map((p) => ({ repo: p.repo, cluster: p.cluster_label, methodology: p.methodology, capabilities: (p.capabilities || []).map((c) => c.name) })), null, 2)}

${priorRubric
    ? `An existing rubric is supplied — score against THIS list so coverage/tier stay comparable across runs. If the DIRECT cluster surfaces a genuinely new table-stakes capability, ADD it and BUMP the version:\n${JSON.stringify(priorRubric, null, 2)}`
    : `No saved rubric — derive the capability list bottom-up from what the DIRECT cluster expects (rows = capabilities our direct peers demand, not invented ones) and return it as version 1.`}

Produce:
- rubric: {domain, version, capabilities:[{id, tier:"table-stakes|edge", test}]} derived from the DIRECT cluster.
- matrix[]: one row per rubric capability — {id, name, us:"met|partial|missing", sota (which DIRECT-cluster repos demonstrate it), tier, reference (owner/repo → file/feature; never empty, never a guessed path), confidence}.
- coverage: {met, total, pct} over TABLE-STAKES capabilities only. pct = round(met/total*100).
- gaps[]: ranked worst-first, each tagged with a SECTION:
    * "direct-peer"  — a capability our same-cluster peers have that we lack (these are the real, fair gaps).
    * "maturity"     — tests / CI / releases / coverage quality gaps (kind: tests/ci/releases).
    * "onboarding"   — docs / examples / quickstart gaps (kind: docs/examples).
    * "cross-cluster" — an idea worth borrowing from ANOTHER cluster (set source_cluster to that cluster). These are OPTIONAL/STRATEGIC, never mandatory. Only include the genuinely high-value ones; do not pad.
  Each gap: {rank, capability, section, source_cluster, kind, tier, effort, gap_confidence, impl_confidence, needs_verification, why (for THIS repo's goal), study (owner/repo → file — SOURCE OF INSPIRATION, NOT a verified call), step1 (PATCH-ORIENTED: first file to create/edit AND first function/command/test)}.
  For any gap whose evidence comes from a repo OUTSIDE our cluster, you MUST use section "cross-cluster" and set source_cluster — never present it as a direct-peer table-stakes gap.

Inspiration vs. integration: \`study\` shows the UX to aim for; it does NOT establish that the reference's specific API is the right thing for us to call. When \`step1\` depends on a third-party API/crate you have NOT confirmed is public, stable, and intended for this use, do NOT prescribe the exact call as settled — set \`impl_confidence\` below "high", name the open question in \`needs_verification\`, and make \`step1\` list 2-3 implementation OPTIONS rather than one over-specific line. A real gap with an unsure patch is gap_confidence:high + impl_confidence:medium — keep the two axes separate.

Hard rules: no gap without a cited source; no guessed file paths; every gap tied to both repo evidence and external evidence. Return ONLY the structured object.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTHESIS },
)

// ── Deterministic post-processing: enforce honest gap sectioning + tier ──
const buckets = partitionGaps(result.gaps || [], { primaryClusterId: selection.primaryClusterId })
const gapsTotal = countTableStakesGaps(buckets)
const tier = tierFor(gapsTotal)

const field = [
  ...directProfiles.map((p) => ({ repo: p.repo, cluster: p.cluster_label, role: 'direct', type: p.type || null, stars: (p.maturity || {}).stars ?? null, pushed: (p.maturity || {}).last_commit ?? null, why: p.why || '' })),
  ...selection.references.map((r) => ({ repo: r.repo, cluster: r.cluster, role: 'reference', stars: ((profileByRepo.get(r.repo) || {}).maturity || {}).stars ?? null, why: r.why })),
]

return {
  domain,
  clusters: clusters.map((c) => ({ id: c.id, size: c.size, members: c.members.map((m) => m.repo), mergedFrom: c.mergedFrom })),
  merges,
  user_cluster: {
    id: selection.primaryClusterId,
    confidence: classification.confidence,
    degraded: !!selection.degraded,
    reason: classification.reason,
    secondary: classification.secondary,
  },
  selection: {
    direct: selection.direct,
    references: selection.references,
    excluded: selection.excluded,
    degraded: !!selection.degraded,
    note: selection.note,
  },
  selection_explanation: explanation.lines,
  field,
  rubric: result.rubric,
  matrix: result.matrix,
  coverage: result.coverage,
  tier,
  gaps_total: gapsTotal,
  gaps: buckets,
}
