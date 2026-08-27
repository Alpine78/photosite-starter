# Keyword hierarchy & gallery query benchmark (AB#65)

**Status: tooling landed, live measurement pending.** This spike delivers a
deterministic fixture corpus, a measurement harness, and the analytical models
that do not need a live store. The empirical result tables below are **empty on
purpose** — they are filled by an owner-run measurement against a real
non-production Sanity project (see [Methodology](#methodology)). AB#65 stays
**Active** until that run is done, its numbers are pasted in, and the
[recommendation](#preliminary-recommendation) is rewritten from a hypothesis into
an evidence-backed statement.

Nothing here selects a production schema or a runtime dependency. The output
feeds two decisions:

- **AB#55** ("ADR: image keyword taxonomy and ingest boundary") — which ancestor
  strategy the taxonomy schema materializes, and what a hierarchy move costs.
- **[ADR-0012](adr/0012-dynamic-keyword-gallery-query-contract.md)** — whether
  its §4 matching contract, §9 keyset-ordering assumption, and §6 coarse
  cache-invalidation trade-off survive contact with a realistic archive size, or
  trip one of its recorded migration triggers.

---

## Why a benchmark, not a decision

[ADR-0012 §4](adr/0012-dynamic-keyword-gallery-query-contract.md) fixes the
*observable contract* — "selecting a keyword is equivalent to selecting every one
of its configured descendants OR-ed together, and per-keyword expansions compose
by AND" — and explicitly defers the *mechanism*:

> How a parent-to-descendant match set is actually resolved by a query — walking
> the tree at read time, a precomputed closure per keyword, or a denormalized
> field on each medium — is deliberately not decided here. AB#55's taxonomy ADR
> and AB#65's benchmarking spike own that mechanism.

The three candidate mechanisms trade read cost against write cost differently, so
the spike measures both rather than assuming one wins overall.

---

## The fixture corpus

`scripts/keyword-benchmark-fixtures.mts` builds a deterministic, entirely
synthetic corpus. `npm run benchmark:keywords -- plan` prints its manifest.

| | |
| --- | --- |
| Media documents | ~8000 (`benchmarkMedia`), all `publiclyRenderable` |
| Keyword documents | ~240 (`benchmarkKeyword`) |
| Document `_id` namespace | `kwbench--…`, dot-free (a dotted id is hidden from tokenless reads) |
| Ownership predicate | every document carries `benchmarkRun`; every benchmark query filters on it |
| Personal data / secrets | none — labels are `Root`, `Rally-*`, `Marque-*`, `Team-*`, `Driver-*`, `Stage-*`, `Surface-*`, `Era-*`, `Class-*`; `validateKeywordBenchmarkFixtures` fails the build if any label escapes that pattern (**AC8**) |

Taxonomy shape:

- **Broad branch** — `Rally-A` → ~40 marques → ~4 models each. A wide, shallow
  subtree whose root sits over a large fraction of the corpus (~80%).
- **Narrow branch** — a depth-5 `Stage-00…Stage-04` chain, one child per level.
  Its leaf is carried by exactly 7 media, which carry *nothing else*, so any AND
  of the narrow leaf with another keyword is provably empty.
- **Facet branches** — `Team` (12), `Surface` (6), `Era` (6), `Driver` (8), so
  the five-wide AND draws pairwise-incomparable leaves from different facets.
- **Max depth 5** — "excess depth" is a rejected state (ADR-0012 §3 / AB#55), so
  the corpus does not exceed it.

Media shape:

- Both hierarchy representations on every corpus (see next section).
- `capturedAt`: a Z-normalized ISO-8601 instant, `null` for an undated block
  (~0.5%, exercising `coalesce(capturedAt, "")` fallback ordering), one exact
  shared instant for a ~25% cluster (**AC1** "duplicate sort values"), and three
  crafted pairs differing **only in sub-second precision** (ADR-0012 §9 keyset
  risk).
- `dynamicallyDiscoverable`: ~90% true, so ADR-0012 §2's eligibility AND is
  exercised. (The field is spike-local; ADR-0002 names it as unimplemented.)
- A configurable fraction (~15%) also carry a **direct tag on an internal node**,
  not only a leaf — AB#55 has not decided whether tagging is leaf-only, so the
  corpus models both.
- **Pinned intersection sizes** (1- through 5-keyword) the validator asserts, so
  the corpus cannot drift silently and a measured row can be sanity-checked
  against a known count.

---

## The strategies compared (AC2)

| Strategy | Representation | Match query | Round trips | Hierarchy-move cost |
| --- | --- | --- | --- | --- |
| **A — materialized ancestors on the keyword doc** | `benchmarkKeyword.ancestorKeywordIds` (path to root, excludes self) | resolve descendants (`keywordId == $k || $k in ancestorKeywordIds`), then `count(leafKeywordIds[@ in $descendants]) > 0` | 1 (correlated subquery) or 2 (explicit resolve) | rewrite `ancestorKeywordIds` on the moved node + every descendant |
| **B — ancestor expansion on the medium** | `benchmarkMedia.expandedKeywordIds` (self-inclusive closure) | `$k in expandedKeywordIds` | 1, no join | rewrite `expandedKeywordIds` on every medium tagged anywhere in the subtree |
| **C — query-time traversal** | authored `parentKeywordId` edge only | walk `parentKeywordId in $frontier` one level at a time, then match as in A's two-step | 1 + taxonomy depth | none (no materialized field) |

`descendantKeywordIds` is deliberately **not** a stored field: parent-edge
traversal does not need it, and maintaining it would distort strategy A's
hierarchy-move figure (a move would then also rewrite old/new ancestors'
descendant lists, breaking the clean `|subtree|` formula). The harness computes
descendant sets in memory where it needs them.

---

## Methodology

### Prerequisites

1. **A dedicated, disposable Sanity dataset.** The harness refuses to seed a
   non-empty dataset (pass `--allow-nonempty` only if you accept the
   contamination bias). Create one:

   ```bash
   npx sanity dataset create kwbench-YYYYMMDD   # in the customer's own project
   ```

   Approaching the Free/Growth ~10 000-document dataset cap is refused
   (`DATASET_DOCUMENT_SOFT_LIMIT`).

2. **A temporary, write-scoped token** in `SANITY_BENCHMARK_TOKEN` — minted for
   this run, revoked immediately after. Never the application's read token, never
   a seed token reused. Environment only, never a CLI flag (a process's argument
   list is world-readable via `ps`).

### Run

```bash
# 1. Inspect the corpus and the matrix (no network):
npm run benchmark:keywords -- plan

# 2. Seed the disposable dataset:
SANITY_BENCHMARK_TOKEN=… npm run benchmark:keywords -- \
  seed --project <id> --dataset kwbench-YYYYMMDD --api-version vYYYY-MM-DD --yes

# 3. Execute the matrix (writes a results JSON + prints a Markdown table):
SANITY_BENCHMARK_TOKEN=… npm run benchmark:keywords -- \
  run --project <id> --dataset kwbench-YYYYMMDD --api-version vYYYY-MM-DD

# 4. Measure the hierarchy moves (AC7). The results table wants all four
#    cells: {broad, deep} × {strategy a, strategy b}. Run each; every run
#    performs one real move (forward written visibility=async so the re-sync
#    lag is measurable) and reverts it (visibility=sync):
for scenario in broad deep; do
  for strategy in a b; do
    SANITY_BENCHMARK_TOKEN=… npm run benchmark:keywords -- \
      move --scenario "$scenario" --strategy "$strategy" \
      --project <id> --dataset kwbench-YYYYMMDD --api-version vYYYY-MM-DD --yes
  done
done

# 5. Tear down:
SANITY_BENCHMARK_TOKEN=… npm run benchmark:keywords -- \
  clean --project <id> --dataset kwbench-YYYYMMDD --api-version vYYYY-MM-DD --yes
# then: npx sanity dataset delete kwbench-YYYYMMDD
```

### What the numbers mean

- **Two endpoint passes, no cold/warm label.** `direct-api` (`…api.sanity.io`)
  is Sanity's uncached surface — the honest uncached baseline. The `cdn` pass
  issues the same request `--repetitions` times against `…apicdn.sanity.io` and
  records **every sample's own** `age` / `x-cache` / `cf-cache-status` /
  `x-vercel-cache` headers (both the descendant-resolution legs and the match)
  in the cell note. The warm-up curve is read from those headers, not asserted:
  an identical GROQ URL is issued by more than one strategy variant and by every
  re-run, so no single request can be *claimed* cold.
- **Distributions, not single points.** Each cell is issued `--repetitions`
  times (default 8); the table reports median and p95 wall time. For the
  `materialized-ancestors` two-step and `query-time-traversal` cells a "sample"
  is the **end-to-end** cost — descendant resolution *plus* the match, re-run
  every repetition — so the number answers "what does this strategy cost per
  query", not "what does its last request cost".
- **`published` perspective, matching production.** Every measurement query
  runs over the `published` perspective — what a real public query sees. Only
  the dataset-emptiness preflight and the cleanup scan use `raw` (they must also
  see drafts and release versions).
- **"Payload bytes" = decompressed JSON body length**, not compressed wire size.
- **Server `ms`** (Sanity's own `ms` response field) is recorded alongside
  wall time so processing time and transport time are not conflated.
- **Correctness gate.** Before any timing is trusted, `run` fetches the full
  ordered id list for each strategy and asserts all three agree with each other
  *and* with the JS reference comparator (`comparePublicMediaOrder`). Every
  keyset/offset page walk (one per strategy) is likewise checked against the
  reference order. Any mismatch — including a GROQ `ORDER BY` disagreement on
  sub-second `capturedAt` precision (ADR-0012 §9) — **aborts the run with no
  results written**, and is itself a headline finding.

---

## Results (owner fills from a live run)

Paste the `run` command's Markdown table here, then summarise:

### AC2 / AC3 — intersection queries

`strategy × {broad-root, narrow-leaf, parent+descendant, five-wide, empty} ×
{direct-api, cdn}`, median/p95 wall ms, server ms, payload bytes, request count,
per-sample cache-status headers.

_(pending live run)_

| Question | Answer |
| --- | --- |
| Which strategy is fastest for a **broad** query on the uncached direct API? | _pending_ |
| Which for a **narrow** query? | _pending_ |
| Does the strategy-A correlated subquery stay usable at 8000 media, or does it need the 2-step resolve? | _pending_ |
| Is strategy C (query-time traversal) viable within the request budget, or does round-trip count kill it? | _pending_ |
| CDN hit vs miss delta (from the recorded `age`/`x-cache` headers)? | _pending_ |

### AC4 — ancestor + descendant redundancy

Run `parent-descendant-pre-collapse` (`Rally-A AND Class-000`) vs
`parent-descendant-collapsed` (`Class-000` alone). The result sets are identical
by construction (a descendant's match set is a subset of its ancestor's); record
the **cost delta** of the redundant form.

_(pending live run)_

### AC5 — pagination & count

Keyset is walked **once per strategy** — this is ADR-0012's own decision
trigger: does the strategy's bounded page walk stay bounded at archive scale, or
does the per-page predicate force a full scan? Offset is a single baseline on the
simplest strategy. Count-strategy choice (`count()` vs id-projection length vs
none) is orthogonal to the ancestor strategy, so it is measured once.

| Walk | Requests for full walk | Median page wall ms | p95 | Notes |
| --- | --- | --- | --- | --- |
| keyset — media-expansion | _pending_ | _pending_ | _pending_ | |
| keyset — materialized-ancestors (two-step) | _pending_ | _pending_ | _pending_ | +N resolve round trips |
| keyset — query-time-traversal | _pending_ | _pending_ | _pending_ | +N resolve round trips |
| offset — media-expansion (`[start...end]` baseline) | _pending_ | _pending_ | _pending_ | does per-page cost grow with offset? |

| Count strategy | Wall ms | Payload bytes | Notes |
| --- | --- | --- | --- |
| `count(*[…])` as its own request | _pending_ | _pending_ | any selectivity cliff? |
| `*[…]{mediaId}` then `.length` | _pending_ | _pending_ | |
| no count (first page only) | _pending_ | _pending_ | the "don't count" baseline |

Every keyset walk is verified against the reference order across the
duplicate-`capturedAt` cluster and the sub-second pairs; a mismatch **aborts the
run** (no results file written) rather than being noted in a row.

### AC7 — hierarchy move (measured)

From `move --scenario broad|deep --strategy a|b`. Each invocation performs one
real move and reverts it:

- **strategy A** rewrites `ancestorKeywordIds` and `depth` on the moved node and
  every descendant keyword document; no media are touched.
- **strategy B** writes the moved node's new `parentKeywordId` (the one authored
  edit) and **recomputes the real `expandedKeywordIds` closure** on every medium
  tagged anywhere in the subtree — this is the reindex cost, not a synthetic
  marker. The descendant keyword docs' own `ancestorKeywordIds` are a
  strategy-A artefact a pure strategy-B store would not carry, so they are left
  untouched during a strategy-B move (and restored by the revert regardless).

| | strategy A (broad) | strategy B (broad) | strategy A (deep) | strategy B (deep) |
| --- | --- | --- | --- | --- |
| documents rewritten | _pending_ | _pending_ | _pending_ | _pending_ |
| mutation batches | _pending_ | _pending_ | _pending_ | _pending_ |
| serialized forward bytes | _pending_ | _pending_ | _pending_ | _pending_ |
| forward mutation acceptance ms (async) | _pending_ | _pending_ | _pending_ | _pending_ |
| **end-to-end write + re-sync ms** (until every rewritten doc is query-visible) | _pending_ | _pending_ | _pending_ | _pending_ |
| revert wall ms (sync) | _pending_ | _pending_ | _pending_ | _pending_ |

The forward mutation is issued `visibility=async`, so the request returns on
acceptance and the harness then polls an aggregate `count()` (over the
`published` perspective, the same a production query uses) until it reflects
*every* rewritten document — that poll is the real re-sync measurement, not
just the next query's latency. The revert is `visibility=sync`, so the baseline
is queryable-again before the command exits.

Recovery: every `move` reverts in a `finally`; a failed revert prints the exact
`clean` + `seed` reseed commands. The `kwbench--` prefix makes a full reseed the
always-available fallback.

---

## Analytical model (computed now, no store)

These come from `scripts/keyword-benchmark-model.mts` over the default corpus
(V ≈ 243 keyword documents). Regenerate with `npm run benchmark:keywords -- plan`.

### AC6 — cache cardinality

A *valid* canonical selection after ADR-0012 §3's ancestor collapse is exactly a
size-1..5 **antichain** in the taxonomy (a set with no element an ancestor of
another). That count depends on the tree's *shape*, not just its node count — so
`Σ C(V,k)` is only a ceiling.

| Quantity | Value (default corpus) |
| --- | --- |
| Vocabulary size V | 243 |
| Naive ceiling `Σ C(V,k), k=1..5` | 6 918 447 735 |
| Collapse-aware antichain selections | 6 193 172 650 |
| …by size `[k=1..5]` | `[243, 28 759, 2 256 844, 131 460 497, 6 059 426 307]` |

**Finding:** with a shallow, wide taxonomy the collapse removes only ~10% of the
selection space — most 5-subsets are *already* antichains because siblings
dominate. The `?cursor=` / cache-key space is effectively "choose ≤5 of V", which
is enormous. A per-selection cache entry is not a bounded set; ADR-0012 §8's
`noindex` + no-sitemap posture for dynamic pages is consistent with that.

### AC6 — invalidation fan-out

When one medium gains or loses keyword X, its membership can only change for a
canonical selection that names X **or an ancestor of X**. Every node on X's root
path is pairwise comparable, so an antichain holds at most one of them.

| X | selections affected | of total | fraction |
| --- | --- | --- | --- |
| broad root (`Rally-A`, depth 1) | 85 968 | 6 193 172 650 | 0.0% |
| internal (`Marque-00`, depth 2, has children) | 122 930 987 | 6 193 172 650 | 2.0% |
| deep leaf (`Stage-04`, depth 5) | 615 062 066 | 6 193 172 650 | 9.9% |

**Finding:** fan-out is monotone non-decreasing going down a root path — a
deeper node's chain is a superset of its ancestor's, so at least as many
antichains touch it. The deep-chain leaf touches an order of magnitude more
selections than the broad root, because its chain passes through a *shallow*
ancestor (`Stage-00`, depth 1) whose "compatible" set — everything not under it —
is nearly the whole tree. A membership change on a deep, popular leaf is the
expensive case for cache invalidation, not the shallow one.

The two coarse events ADR-0012 §6 names are not per-keyword:

- **Taxonomy structural change** (ancestor edge changed, alias retargeted) bumps
  the one global `taxonomyVersion` → **every outstanding dynamic cursor
  site-wide** is `wrong-scope`.
- **`visibilityVersion` change** (a caption edit, a newly-eligible photo) → every
  outstanding cursor for every query the changed medium matches — per-query
  scoped, but near-total for a broad or popular query.

### AC7 — hierarchy-move write amplification (modelled)

Strategy B rewrites a medium's `expandedKeywordIds` **only when its closure
actually changes** — a medium tagged in the moved subtree that already carries
the new ancestor via another tag needs no write.

| Move | strategy A (keyword docs) | strategy B (media docs) | ratio |
| --- | --- | --- | --- |
| broad root `Rally-A` | 201 (3 batches) | **3 541** written of 6 518 tagged; 2 977 already carry the new ancestor (36 batches) | **~17.6×** |
| deep node `Stage-01` | 4 (1 batch) | 27 written of 27 tagged (1 batch) | ~6.8× |

**Finding:** strategy B's move cost still scales with *tagged media*, not
taxonomy size, but the naive "every medium under the subtree" count roughly
doubles it — for the broad move, 46% of tagged media already reach the new
parent through a different facet tag and are left alone. Strategy A's cost is
bounded by `|subtree|` and is independent of how heavily the subtree is tagged.

---

## Preliminary recommendation

**Hypothesis, pending the live read numbers:** materialize on the **keyword
document** (strategy A), resolved as an explicit **two-step** (fetch the
descendant id set, then a keyset range query over `benchmarkMedia`), matching the
two-round-trip shape `readSanityCuratedGalleryPage` already uses for a curated
gallery.

Reasoning from what is already known:

- Strategy A's **hierarchy-move cost is bounded and small** (`|subtree|` keyword
  documents), and taxonomy edits are rare and admin-only — the exact profile the
  curated `visibilityVersion` approximation was already deemed acceptable for.
- Strategy B's **move cost is unbounded by anything the taxonomy controls** — it
  scales with tagging volume. Even after skipping the ~46% of tagged media whose
  closure does not change, moving the broad root is still a ~3 500-document
  rewrite (36 batches) with its own partial-failure and visibility-lag surface
  (AC7); a re-tag or bulk import only pushes that higher. A poor fit for "an
  admin renames a category".
- Strategy A's descendant-id set for any single keyword is **small** (the widest
  branch here has ~200 descendants), so it fits comfortably in a GROQ `in $ids`
  parameter and a bounded keyset follow-up — no 11 KB URL risk, no whole-document
  load (the AB#114 concern that split gallery placements into their own
  documents).
- Strategy C is kept as a **fallback only**: if the live numbers show strategy
  A's descendant-resolution round trip is cheap enough, C buys nothing and costs
  depth-many round trips.

**The trigger that flips this:** if the live run shows strategy A's two-step
resolve + keyset match cannot meet ADR-0012 / AB#134's existing keyset-pagination
budget at 8000 media (e.g. the `count(leafKeywordIds[@ in $ids])` predicate is
non-optimizable and forces a full scan per page), then **strategy B** wins on
read despite its move cost, and AB#55 must decide whether the move cost is
tolerable or whether the **matching contract itself narrows** — ADR-0012's
recorded migration trigger: *"AB#65's benchmarking finds no bounded mechanism for
descendant expansion → AB#55/56/57 need a narrower matching rule (e.g.
exact-tag-only, no ancestor expansion)"*, reflected via a dated ADR-0012
amendment.

---

## Feeds into

- **AB#55** — "The ancestor strategy is selected using AB#65 evidence; hierarchy
  move, reindex/re-sync, and failure-recovery cost is stated." The [strategy
  table](#the-strategies-compared-ac2), the [AC7 model](#ac7--hierarchy-move-write-amplification-modelled),
  and the live AC7 measurement are that evidence.
- **ADR-0012 §4** — the matching contract stands unless the live run trips the
  narrowing trigger above.
- **ADR-0012 §9** — the correctness gate's GROQ-vs-JS ordering check is the
  empirical verification ADR-0012 names as owed ("AB#58 must verify empirically
  that GROQ's own string ordering and the adapter's comparator agree on
  `coalesce(capturedAt, "") desc` at whatever precision is actually stored").
- **ADR-0012 §6** — the [cardinality](#ac6--cache-cardinality) and
  [fan-out](#ac6--invalidation-fan-out) numbers size the coarse-invalidation
  trade-off ADR-0012 accepted; if they prove disruptive, ADR-0012's "design the
  precise per-cursor mechanism" trigger applies.

---

## Acceptance-criteria coverage

| AC | Where | Status |
| --- | --- | --- |
| 1 — ~8000 media, broad/narrow branches, duplicate sort values, 1–5-keyword intersections | fixture corpus + pinned intersections | **done** |
| 2 — materialized-ancestor vs media-expansion vs query-time traversal compared | 3 strategy builders + correctness gate; live timings | tooling **done**, measurement **pending** |
| 3 — broad/narrow/parent-descendant/max-width AND, uncached & CDN, payload & request count | measurement matrix (48 intersection cells: 6 shapes × 4 strategy variants × 2 endpoints) | tooling **done**, measurement **pending** |
| 4 — ancestor+descendant redundancy via the canonical collapse rule | `canonicalizeSelection` + pre/post-collapse cells | model **done**, cost delta **pending** |
| 5 — cursor pagination & count strategies; offset only a baseline | keyset walk per strategy + offset baseline + 3 count cells + §9 correctness gate (aborts on disagreement) | tooling **done**, measurement **pending** |
| 6 — cache cardinality & invalidation fan-out for canonical keyword sets | analytical model | **done** |
| 7 — hierarchy-move write amplification, reindex/re-sync, recovery | amplification model + `move` (async forward write, aggregate re-sync poll, `finally` revert, baseline preflight) | model **done**, measured re-sync **pending** (4 runs: broad/deep × a/b) |
| 8 — no personal archive material or secrets | `validateKeywordBenchmarkFixtures` label pattern + no-token/no-URL fields | **done** |
| 9 — findings + recommendation feed the taxonomy & gallery-query ADRs | this document | **preliminary** — final after the live run |
