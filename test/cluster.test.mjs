import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  kebab,
  jaccard,
  profileTokens,
  maturityScore,
  clusterCandidates,
  classifyRepo,
  selectBenchmarks,
  partitionGaps,
  countTableStakesGaps,
  tierFor,
  explainSelection,
} from '../lib/cluster.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'context-management.json'), 'utf8'))
const { candidates, user_repo: user, now } = fixture

// Map a profile to its canonical fuzzy-ness for assertions that must not depend
// on exact fixture wording.
const isFuzzy = (p) => ['fuzzy-file-search', 'fuzzy-finder'].includes(kebab(p.cluster_label))
const isVector = (p) => ['vector-database', 'vector-db'].includes(kebab(p.cluster_label))

test('fixture sanity: 50+ candidates spanning multiple labels', () => {
  assert.ok(candidates.length >= 50, `expected >=50 candidates, got ${candidates.length}`)
  const labels = new Set(candidates.map((c) => kebab(c.cluster_label)))
  assert.ok(labels.size >= 5, `expected >=5 raw labels, got ${labels.size}`)
})

test('jaccard + tokens behave', () => {
  assert.equal(jaccard(new Set(['a', 'b']), new Set(['a', 'b'])), 1)
  assert.equal(jaccard(new Set(['a']), new Set(['b'])), 0)
  assert.equal(kebab('Fuzzy File  Search!'), 'fuzzy-file-search')
  assert.ok(profileTokens(user).size > 0)
})

test('maturityScore is deterministic and ordered by signals', () => {
  const strong = { maturity: { stars: 50000, last_commit: now, has_docs: true, has_tests: true, has_examples: true, releases: true } }
  const weak = { maturity: { stars: 5, last_commit: '2023-01-01', has_docs: false, has_tests: false, has_examples: false, releases: false } }
  const s = maturityScore(strong, now)
  const w = maturityScore(weak, now)
  assert.ok(s.score > w.score)
  assert.equal(maturityScore(strong, now).score, s.score) // reproducible
  assert.ok(w.stale, 'old last_commit should read as stale')
})

test('clusters: the field is NOT one undifferentiated group', () => {
  const { clusters } = clusterCandidates(candidates)
  assert.ok(clusters.length >= 4, `expected >=4 peer clusters, got ${clusters.length}: ${clusters.map((c) => c.id)}`)
})

test('synonym labels merge into their canonical cluster', () => {
  const { clusters } = clusterCandidates(candidates)
  // The cluster holding fuzzy-file-search members should also hold the fuzzy-finder variant.
  const fuzzyCluster = clusters.find((c) => c.members.some((m) => kebab(m.cluster_label) === 'fuzzy-file-search'))
  assert.ok(fuzzyCluster, 'a fuzzy-file-search cluster should exist')
  assert.ok(
    fuzzyCluster.members.some((m) => kebab(m.cluster_label) === 'fuzzy-finder'),
    'fuzzy-finder variant should merge into the fuzzy cluster',
  )
  const vectorCluster = clusters.find((c) => c.members.some((m) => kebab(m.cluster_label) === 'vector-database'))
  assert.ok(
    vectorCluster.members.some((m) => kebab(m.cluster_label) === 'vector-db'),
    'vector-db variant should merge into the vector-database cluster',
  )
})

test('user repo is classified into the fuzzy cluster', () => {
  const { clusters } = clusterCandidates(candidates)
  const cls = classifyRepo(user, clusters)
  assert.ok(!cls.degraded, 'a clear fuzzy repo should classify confidently')
  const primary = clusters.find((c) => c.id === cls.primaryId)
  const fuzzyShare = primary.members.filter(isFuzzy).length / primary.members.length
  assert.ok(fuzzyShare > 0.5, `user's primary cluster should be predominantly fuzzy (was ${fuzzyShare.toFixed(2)})`)
})

test('direct comparators stay in-cluster; no vector-DB repo is a direct peer', () => {
  const { clusters } = clusterCandidates(candidates)
  const cls = classifyRepo(user, clusters)
  const sel = selectBenchmarks(clusters, cls, { now })

  assert.ok(sel.direct.length >= 3, 'should have several direct comparators')
  // CRITICAL fairness check: a fuzzy tool is never directly benchmarked on vector-DB repos,
  // even though the fixture makes vector-DB repos more popular.
  const directVectors = sel.directProfiles.filter(isVector)
  assert.equal(directVectors.length, 0, `no vector-DB repo should be a direct comparator, found: ${directVectors.map((p) => p.repo)}`)
  // every direct comparator belongs to the primary cluster
  const primary = clusters.find((c) => c.id === cls.primaryId)
  const primaryRepos = new Set(primary.members.map((m) => m.repo))
  for (const r of sel.direct) assert.ok(primaryRepos.has(r), `${r} should be in the primary cluster`)
})

test('vector-DB repos survive as broader references, not direct gaps', () => {
  const { clusters } = clusterCandidates(candidates)
  const cls = classifyRepo(user, clusters)
  const sel = selectBenchmarks(clusters, cls, { now })
  const refRepos = sel.references.map((r) => r.repo)
  // at least one vector repo should appear as a reference (broader space), and it must NOT be direct
  const vectorRefs = sel.references.filter((r) => ['vector-database', 'vector-db'].includes(kebab(r.cluster)))
  assert.ok(vectorRefs.length >= 1, 'vector-DB cluster should contribute a broader-space reference')
  for (const vr of vectorRefs) assert.ok(!sel.direct.includes(vr.repo), 'a reference must not also be a direct comparator')
})

test('cross-cluster gaps are forced optional/strategic and excluded from the gap count', () => {
  const buckets = partitionGaps(
    [
      { capability: 'fuzzy-ranking-config', section: 'direct-peer', tier: 'table-stakes', source_cluster: 'fuzzy-file-search' },
      { capability: 'test-suite', section: 'maturity', kind: 'tests', tier: 'table-stakes', source_cluster: 'fuzzy-file-search' },
      { capability: 'getting-started-guide', kind: 'docs', tier: 'table-stakes', source_cluster: 'fuzzy-file-search' },
      // A vector-DB idea: must NOT become a mandatory gap.
      { capability: 'semantic-embedding-search', section: 'direct-peer', tier: 'table-stakes', source_cluster: 'vector-database' },
    ],
    { primaryClusterId: 'fuzzy-file-search' },
  )
  assert.equal(buckets.direct_peer.length, 1)
  assert.equal(buckets.maturity.length, 1)
  assert.equal(buckets.onboarding.length, 1)
  assert.equal(buckets.cross_cluster.length, 1, 'the vector-DB idea routes to cross-cluster despite its label')
  const xc = buckets.cross_cluster[0]
  assert.equal(xc.strategic, true)
  assert.equal(xc.optional, true)
  assert.equal(xc.tier, 'edge', 'cross-cluster ideas are demoted from table-stakes')
  // Gap count (coverage/tier) counts the 3 in-cluster table-stakes, not the cross-cluster idea.
  assert.equal(countTableStakesGaps(buckets), 3)
  assert.equal(tierFor(countTableStakesGaps(buckets)), 'BEHIND')
})

test('graceful degradation: empty clusters → flat fallback', () => {
  const cls = classifyRepo(user, [])
  assert.ok(cls.degraded)
  const sel = selectBenchmarks([], cls, { now })
  assert.ok(sel.degraded)
})

test('graceful degradation: a single small cluster (<50 repos) still selects direct peers', () => {
  const fuzzyOnly = candidates.filter(isFuzzy).slice(0, 6) // a thin pool
  const { clusters } = clusterCandidates(fuzzyOnly)
  assert.ok(clusters.length >= 1)
  const cls = classifyRepo(user, clusters)
  const sel = selectBenchmarks(clusters, cls, { now })
  assert.ok(sel.direct.length >= 1, 'thin single-cluster pool should still yield direct comparators')
  assert.equal(sel.references.length, 0, 'with only one cluster there are no broader references')
})

test('explainSelection produces an auditable, non-empty rationale', () => {
  const { clusters } = clusterCandidates(candidates)
  const cls = classifyRepo(user, clusters)
  const sel = selectBenchmarks(clusters, cls, { now })
  const ex = explainSelection(cls, clusters, sel, { domain: fixture.domain })
  assert.match(ex.text, /Detected domain: context-management/)
  assert.match(ex.text, /Detected cluster:/)
  assert.match(ex.text, /Direct comparators/)
})

// ── Sync guard: the Workflow inlines a copy of the core; it must not drift. ─────
test('workflow inlined cluster-core matches lib/cluster.mjs verbatim', () => {
  const libSrc = readFileSync(join(here, '..', 'lib', 'cluster.mjs'), 'utf8')
  const wfSrc = readFileSync(join(here, '..', 'workflows', 'sota-scan-fanout.js'), 'utf8')
  const grab = (src) => {
    const m = /__CORE_START__[^\n]*\n([\s\S]*?)\/\*__CORE_END__/.exec(src)
    return m ? m[1].trim() : null
  }
  const lib = grab(libSrc)
  const wf = grab(wfSrc)
  assert.ok(lib, 'lib must contain a cluster-core block')
  assert.ok(wf, 'workflow must contain a cluster-core block')
  // The workflow copy uses plain (non-export) function declarations; normalize that
  // single difference before comparing so the bodies must otherwise be identical.
  const norm = (s) => s.replace(/export function /g, 'function ').trim()
  assert.equal(norm(wf), norm(lib), 'workflow cluster-core has drifted from lib/cluster.mjs — re-sync the inlined copy')
})
