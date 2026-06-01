// ── sota-scan clustering core ─────────────────────────────────────────────────
//
// Deterministic, dependency-free peer-grouping for the benchmark pipeline.
//
// Why this exists: when a repo's domain is broad (e.g. "context-management"),
// the best-known repos in that space often represent *different approaches*
// (fuzzy file search vs. vector database vs. knowledge graph). Treating them as
// one flat peer group produces noisy, unfair gaps — a focused fuzzy-search tool
// gets dinged for lacking vector-DB features. This module clusters the candidate
// pool into peer groups, classifies the user repo into the closest one, and
// keeps cross-cluster differences as OPTIONAL ideas rather than mandatory gaps.
//
// SOURCE OF TRUTH. The sota-scan-fanout Workflow inlines a copy of the core
// functions (the fenced block below) because the Workflow sandbox cannot import
// modules. test/cluster.test.mjs validates THIS file, and the sync guard test
// asserts the inlined copy matches it verbatim.
// ─────────────────────────────────────────────────────────────────────────────

/*__CORE_START__ keep in sync with workflows/sota-scan-fanout.js */

// Normalize an arbitrary label/word into a stable kebab token form.
export function kebab(s) {
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
export function profileTokens(p) {
  if (!p || typeof p !== 'object') return new Set()
  const out = new Set()
  const add = (text) => toTokens(text).forEach((t) => out.add(t))
  add(p.cluster_label)
  add(p.methodology)
  add(p.primary_domain)
  if (Array.isArray(p.feature_categories)) p.feature_categories.forEach(add)
  return out
}

export function jaccard(a, b) {
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
export function maturityScore(p, now) {
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
export function clusterCandidates(profiles, opts = {}) {
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
export function classifyRepo(userProfile, clusters, opts = {}) {
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
export function selectBenchmarks(clusters, classification, opts = {}) {
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
export function partitionGaps(gaps, ctx = {}) {
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
export function countTableStakesGaps(buckets) {
  const isTs = (g) => (g.tier || 'table-stakes') === 'table-stakes'
  return (
    buckets.direct_peer.filter(isTs).length +
    buckets.maturity.filter(isTs).length +
    buckets.onboarding.filter(isTs).length
  )
}

export function tierFor(gapCount) {
  if (gapCount <= 0) return 'FRONTIER'
  if (gapCount <= 2) return 'COMPETITIVE'
  if (gapCount <= 4) return 'BEHIND'
  return 'LAGGING'
}

// ── Human-auditable explanation of the benchmark selection ─────────────────────
export function explainSelection(classification, clusters, selection, opts = {}) {
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
