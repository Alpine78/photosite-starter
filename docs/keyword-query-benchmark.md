# Keyword hierarchy & gallery query benchmark (AB#65)

**Status: measured.** The tables below hold real numbers from an owner-run
measurement on 2026-08-27 against a dedicated live Sanity project (`qq8viq8z`,
dataset `production`, seeded with the fixture corpus and torn down afterward;
API `v2025-02-19`). 3 of the 4 hierarchy-move cells were measured; the 4th
(`deep` × strategy B) is modelled — see [AC7](#ac7--hierarchy-move-measured).
The [recommendation](#recommendation) is now evidence-backed, and it **reverses**
the pre-measurement hypothesis.

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
   non-empty dataset. On the Free plan (2-dataset cap) a fresh dataset cannot
   always be created; the 2026-08-27 run instead used the project's own empty
   `production` dataset with `--allow-nonempty` (it held only Sanity's ~12
   `system.*` records, which the emptiness check still counts). That is safe
   *only* because the benchmark's own `_type`s and `benchmarkRun` predicate
   isolate every query, and `clean` removes exactly the `kwbench--` ids — an
   audit afterward confirmed the dataset was back to its system records.

   ```bash
   npx sanity dataset create kwbench-YYYYMMDD   # preferred, if a slot is free
   ```

   Approaching the Free/Growth ~10 000-document dataset cap is refused
   (`DATASET_DOCUMENT_SOFT_LIMIT`).

2. **A temporary, write-scoped token** in `SANITY_BENCHMARK_TOKEN` — **Editor**
   role (Viewer gets 403 on the mutate API), minted for this run, revoked
   immediately after. Never the application's read token, never a seed token
   reused. Environment only, never a CLI flag (a process's argument list is
   world-readable via `ps`). `unset` it between shell sessions and re-`export`
   before `clean`.

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

## Results

Measured 2026-08-27, `benchmarkRun=kwbench-fixture-v1`, project `qq8viq8z`,
dataset `production`, API `v2025-02-19`, 8 repetitions/cell. Full raw table:
`keyword-benchmark-results-kwbench-fixture-v1.json` (kept out of the repo; the
distilled numbers are here). Requester was in the EU near the
`gcp-eu-w1-prod` shard.

### AC2 / AC3 — intersection queries

**Correctness gate: all 15 strategy × shape combinations returned an identical
ordered id list, matching the JS reference — including across the sub-second
`capturedAt` pairs. ADR-0012 §9's keyset-ordering risk did not materialise on
this data.**

Direct API (uncached), median wall ms / median server `ms` / total requests per
cell:

| Shape (rows) | media-expansion | materialized-ancestors (subquery) | materialized-ancestors (2-step) | query-time-traversal |
| --- | --- | --- | --- | --- |
| broad-root (5925) | **742** / 642 / 8 | 1256 / 1147 / 8 | 1727 / 1559 / 16 | 1757 / 1470 / 32 |
| narrow-leaf (7) | **73** / 6 / 8 | 1083 / 1007 / 8 | 1052 / 918 / 16 | 993 / 854 / 16 |
| parent+descendant pre-collapse (75) | **80** / 11 / 8 | 1254 / 1145 / 8 | 1499 / 1294 / 24 | 1785 / 1331 / 40 |
| parent+descendant collapsed (75) | **81** / 11 / 8 | 977 / 877 / 8 | 1060 / 872 / 16 | 1050 / 909 / 16 |
| five-wide (20) | **77** / 6 / 8 | 1194 / 1092 / 8 | 1529 / 1117 / 48 | 1470 / 1027 / 48 |
| empty (0) | **77** / 5 / 8 | 1051 / 976 / 8 | 1060 / 846 / 24 | 1159 / 952 / 24 |

**Findings:**

- **`media-expansion` is the fastest read at every shape**, by a wide margin —
  a broad 5925-row match in ~740 ms uncached, a narrow one in ~73 ms. Its match
  is one indexed `$k in expandedKeywordIds` per keyword, no join.
- **The join strategies pay ~1.3–1.7× on the broad query as a correlated
  subquery**, and **~2.3–2.4× as a two-step** (which also doubles-to-quadruples
  the request count for the resolve legs). `query-time-traversal` adds a resolve
  round trip per taxonomy level — up to 5 for the five-wide shape (48 requests
  for one measured cell).
- **Server `ms` tracks wall time closely on the direct API** — the cost is real
  query execution, not transport. `count(leafKeywordIds[@ in *[…]])` and
  `count(leafKeywordIds[@ in $ids])` are ~1 s of server compute against 8000
  media even when the result is tiny (narrow-leaf: 7 rows, still ~1 s).
- **CDN (`apicdn.sanity.io`)** collapses every cell's median wall time to
  **~50–335 ms** regardless of strategy (`cache-control: private, max-age=60,
  stale-while-revalidate=15`). Sanity's CDN did not surface `age` / `x-cache` /
  `cf-cache-status` headers, so a hit is inferred from wall time falling to
  ~1/10th while the returned server `ms` stays at the original ~600–1700 ms
  (the cached response carries its original compute time). p95 stays high
  (500–2100 ms): the first request of each 8-sample batch is a miss and pays
  full price, and the cache lives only 60 s.

### AC4 — ancestor + descendant redundancy

`Rally-A AND Class-000` (pre-collapse) vs `Class-000` alone (collapsed), same
75-row result:

| Strategy | pre-collapse | collapsed | redundant-term cost |
| --- | --- | --- | --- |
| media-expansion | 80 ms / 4377 B | 81 ms / 4377 B | **~0** — the extra `$k in expandedKeywordIds` term is free |
| materialized-ancestors (subquery) | 1254 ms | 977 ms | **~28%** — one extra correlated descendant subquery |
| materialized-ancestors (2-step) | 1499 ms | 1060 ms | ~29% + one extra resolve round trip |

**Finding:** ADR-0012 §3's ancestor-collapse is nearly free to skip for
`media-expansion` at query time, but removes a ~28% penalty for any join
strategy. It still matters for cache cardinality (see the analytical model)
whichever strategy wins.

### AC5 — pagination & count

Full keyset walk of the broad result (5925 rows, `pageSize` 24 → 247 pages),
direct API:

| Walk | Requests | Median page wall ms | p95 | Notes |
| --- | ---: | ---: | ---: | --- |
| keyset — media-expansion | 247 | **840** | 1035 | one round trip per page |
| keyset — materialized-ancestors (2-step) | 494 | 1475 | 1789 | re-resolves the descendant closure every page |
| keyset — query-time-traversal | 988 | 1649 | 1994 | re-resolves (4 levels) every page |
| offset — media-expansion (`[start...end]`) | 247 | **687** | 920 | baseline |

| Count strategy | Wall ms | Payload bytes | Rows |
| --- | ---: | ---: | ---: |
| `count(*[…])` as its own request | **68** | 47 | 1 |
| `*[…]{ mediaId }` then `.length` | 673 | 130 396 | 5925 |
| no count (first page only) | 681 | 1438 | 24 |

**Findings:**

- **Every keyset walk reproduced the reference order exactly** — no gap, no
  duplicate, across the duplicate-`capturedAt` cluster and the sub-second pairs.
- **`media-expansion` is the only strategy whose paginated walk is one request
  per page.** The join strategies re-resolve the descendant closure on every
  continuation (2× and 4× the request count here), because a stateless
  continuation request has no cached closure to reuse — a full walk is ~6 min
  for the two-step vs ~3.5 min for `media-expansion`.
- **Offset was slightly *faster* than keyset here** (687 vs 840 ms/page): at
  5925 rows / 247 pages Sanity's `[start...end]` is not yet punished, and
  keyset's `coalesce(capturedAt,"") < $afterKey || …` predicate adds a little
  cost. Keyset's advantage is stability under concurrent writes and at deep
  offsets, not raw speed at this scale — "offset is only a baseline" holds as a
  *correctness/robustness* statement, not a latency one.
- **`count()` as its own request is the clear winner** — ~68 ms and 47 bytes,
  ~10× faster and ~2800× smaller than fetching ids to measure length. No
  selectivity cliff observed. Skipping the count entirely saves that one cheap
  request.

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
| documents rewritten | 201 keyword | 1 keyword + 3541 media | 4 keyword | 1 keyword + 27 media *(modelled)* |
| tagged-but-unchanged media skipped | — | 2977 | — | 0 |
| mutation batches | 3 | 36 | 1 | 1 *(modelled)* |
| serialized forward bytes | 51 236 | 1 374 349 | 1 005 | ~11 000 *(modelled)* |
| forward acceptance ms (async) | 947 | 14 372 | 154 | not measured |
| **end-to-end write + re-sync ms** | **2 171** | **15 039** | **851** | not measured |
| revert wall ms (sync) | 3 122 | 44 780 | 895 | not measured |

The forward mutation is issued `visibility=async`, so the request returns on
acceptance and the harness then polls an aggregate `count()` (over the
`published` perspective) until it reflects *every* rewritten document — the real
re-sync measurement, not the next query's latency. The revert is
`visibility=sync`, so the baseline is queryable-again before the command exits.

**`deep` × strategy B was not measured live.** The move both *adds* the new
parent to a closure and *removes* the old one; 9 of its 27 affected media only
lose the old ancestor, so the single-`count()` re-sync probe could not prove
their visibility. The probe now polls one aggregate per added *and* removed
ancestor (fixed after this run), but re-running the one cell needs a fresh token
and reseed. Its write amplification is modelled (27 media, 1 batch) and its
re-sync is bracketed by `deep` × strategy A (851 ms) below and by the
27-vs-3541-document ratio against `broad` × strategy B — an unremarkable ~1 s.

**Findings:**

- **Strategy A's move is cheap and fast** even for the broad root: 201 keyword
  documents, ~2 s to write and become query-visible, ~3 s to revert. Bounded by
  `|subtree|`, independent of tagging volume.
- **Strategy B's broad move is a real operational event**: 3541 media documents
  (36 batches), **14 s** to accept, **15 s** end-to-end to re-sync, and **45 s**
  to revert. That is the cost of one admin reparenting a popular category.
- **Skipping the 2977 tagged-but-unchanged media matters** — the naive "rewrite
  everything under the subtree" would have made it a 6518-document, ~27 s write.
- Content Lake query visibility lagged the async acceptance by only ~0.7–1 s in
  every measured case (`re-sync − acceptance`): 2171 − 947, 15039 − 14372,
  851 − 154. The dominant cost is the write itself, not indexing lag.

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

## Recommendation

**Materialize the ancestor closure on the medium — strategy B
(`expandedKeywordIds`).** Optimize for the read that happens on every visitor
request; accept the expensive-but-rare hierarchy move.

The pre-measurement hypothesis was the opposite (strategy A, keyword-side
materialization, two-step resolve — chosen because its *move* is cheap). The
live numbers reverse it: the join cost strategy A and C pay is on the **read**,
every request, and it does not amortize.

Evidence:

- **Read latency (every request).** `media-expansion` returns a broad 5925-row
  match in ~740 ms uncached; the correlated-subquery form is ~1.7× slower, the
  two-step ~2.3× slower with 2× the requests, `query-time-traversal` ~2.4×
  slower with up to 4× the requests. On the CDN all strategies are ~50–100 ms on
  a hit, but the cache is `max-age=60` and every miss pays the full uncached
  price.
- **Paginated read (a full gallery walk).** `media-expansion` keyset is one
  request per page. Strategy A and C **re-resolve the descendant closure on
  every continuation page** — 2× and 4× the request count, ~6 min vs ~3.5 min
  for the full 247-page broad walk. A stateless `?cursor=` continuation has no
  closure to reuse; caching one per cursor scope is possible but is new
  machinery ADR-0012 has not designed. This is precisely ADR-0012's own recorded
  trigger: *"if strategy A's two-step resolve + keyset match cannot meet the
  keyset-pagination budget… strategy B wins on read."*
- **Redundant-term and count cost.** `media-expansion` pays ~0 for a redundant
  ancestor term (AC4) and `count()` as its own request is ~68 ms — the whole
  read path is cheap.
- **Write cost (rare, admin-only).** Strategy B's price is the hierarchy move:
  moving the broad root rewrote 3541 media documents — 14 s to accept, 15 s to
  re-sync, 45 s to revert. That is a real operational event, but it happens when
  an administrator reparents a popular category, not on a visitor request, and
  the ~46% of tagged media whose closure does not actually change are already
  skipped. Strategy A's equivalent move is ~2 s.

What strategy B needs from AB#55/56/57 to be safe:

- **A bounded, batched, resumable ingest path for the hierarchy move**, with its
  own visibility-lag handling — the `move` command demonstrates the shape
  (`visibility=async` accept, aggregate re-sync poll, `createOrReplace` so a
  partial failure is safe to re-run). A bulk re-tag or import could push a single
  move well past 3541 documents.
- **The `expandedKeywordIds` closure is derived, never authored** — recomputed
  from the authored `parentKeywordId` edges on every ingest, so it cannot drift.
- **ADR-0012 §3's ancestor-collapse still applies** to the canonical *cache key*
  even though it is free at query time for strategy B.

Strategy C (query-time traversal) is rejected outright: it is the slowest read
*and* the most round trips, and buys nothing strategy B does not.

---

## Feeds into

- **AB#55** — "The ancestor strategy is selected using AB#65 evidence; hierarchy
  move, reindex/re-sync, and failure-recovery cost is stated." The
  [recommendation](#recommendation) (strategy B, `expandedKeywordIds` on the
  medium), the [measured AC7 costs](#ac7--hierarchy-move-measured), and the
  [amplification model](#ac7--hierarchy-move-write-amplification-modelled) are
  that evidence. AB#55 also owns the batched/resumable ingest path strategy B
  requires for the hierarchy move.
- **ADR-0012 §4** — the matching *contract* holds: all three mechanisms returned
  an identical ordered result set at every shape. The evidence bears on which
  *mechanism* §4 leaves open, not on §4 itself; it does **not** trip the
  "no bounded mechanism → narrow the matching rule" trigger — a bounded
  mechanism exists (`media-expansion`), it just moves the cost to write time.
- **ADR-0012 §9** — the correctness gate's GROQ-vs-JS ordering check is the
  empirical verification ADR-0012 names as owed. **Result: GROQ's `ORDER BY` and
  the JS comparator agreed on every keyset walk, including across the
  sub-second-precision `capturedAt` pairs.** No write-time precision
  normalization is needed for this data.
- **ADR-0012 §6** — the [cardinality](#ac6--cache-cardinality) and
  [fan-out](#ac6--invalidation-fan-out) numbers size the coarse-invalidation
  trade-off ADR-0012 accepted; if they prove disruptive, ADR-0012's "design the
  precise per-cursor mechanism" trigger applies.

---

## Acceptance-criteria coverage

| AC | Where | Status |
| --- | --- | --- |
| 1 — ~8000 media, broad/narrow branches, duplicate sort values, 1–5-keyword intersections | fixture corpus + pinned intersections | **done** (8000 media, 243 keyword docs seeded) |
| 2 — materialized-ancestor vs media-expansion vs query-time traversal compared | 3 strategy builders + correctness gate + [live timings](#ac2--ac3--intersection-queries) | **done** — all 3 measured, all shapes; `media-expansion` fastest |
| 3 — broad/narrow/parent-descendant/max-width AND, uncached & CDN, payload & request count | measurement matrix, 48 intersection cells (6 shapes × 4 strategy variants × 2 endpoints) | **done** — see [AC2/AC3](#ac2--ac3--intersection-queries) |
| 4 — ancestor+descendant redundancy via the canonical collapse rule | `canonicalizeSelection` + pre/post-collapse cells | **done** — [~0 for media-expansion, ~28% for joins](#ac4--ancestor--descendant-redundancy) |
| 5 — cursor pagination & count strategies; offset only a baseline | keyset walk per strategy + offset baseline + 3 count cells + §9 correctness gate | **done** — [keyset walks all matched the reference order](#ac5--pagination--count) |
| 6 — cache cardinality & invalidation fan-out for canonical keyword sets | analytical model | **done** |
| 7 — hierarchy-move write amplification, reindex/re-sync, recovery | amplification model + `move` (async forward, aggregate re-sync poll, `finally` revert, baseline preflight) | **done** for 3/4 cells; `deep`×B modelled ([why](#ac7--hierarchy-move-measured)) |
| 8 — no personal archive material or secrets | `validateKeywordBenchmarkFixtures` label pattern + no-token/no-URL fields; live audit confirmed the dataset held only Sanity system records afterward | **done** |
| 9 — findings + recommendation feed the taxonomy & gallery-query ADRs | this document; [recommendation](#recommendation) reversed the hypothesis | **done** |
