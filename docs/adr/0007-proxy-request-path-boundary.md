# ADR-0007: A Proxy request boundary carrying the requested path

**Status:** Proposed
**Date:** 2026-08-13
**Deciders:** Project owner (Ilkka Rytkönen)
**Work item:** AB#72

## Context

ADR-0003 decision 8 requires one thing this application could not do:

> An unknown section and a malformed, tampered, wrong-scope, or stale cursor return an
> accessible 404 response **with a link to the gallery's parameter-free first page**.

The route that refuses the request knows exactly which gallery that is. The 404 that
renders does not, and there is no supported way to tell it. Two facts, both verified
against Next.js 16.2 rather than assumed:

- **`not-found.tsx` is rendered with no props.** In `create-component-tree.tsx` the
  boundary is created as `createElement(Component, null)` — no `params`, no
  `searchParams`. This is the only rendering path for every not-found boundary in App
  Router, so no route context reaches it.
- **The boundary renders *before* the page.** A per-request `React.cache()` holder,
  written by the page immediately before `notFound()` and read by the boundary, reads back
  empty. Instrumented against a production build, the read logged ahead of the write with
  the same holder identity — the cache scope is shared, but the data would have to travel
  backwards through render order.

So the refused address has to arrive out of band. Next.js 16 renamed Middleware to
**Proxy** (`proxy.ts`), which runs before a request completes and can add request headers
via `NextResponse.next({ request: { headers } })`. That is the remaining mechanism.

Introducing it is not a small thing. It runs on every matched request, so its cost is the
site's cost on every page view, and a request-header boundary is a place where trusted and
untrusted data meet.

## Decision

Add `src/proxy.ts`. It copies the requested pathname into `x-photosite-request-path`, and
whether a `cursor` parameter was present into `x-photosite-request-has-cursor` — two
project-owned request headers, on the routes that can render a content 404. It also owns
trailing-slash normalization: `skipTrailingSlashRedirect` disables Next.js's earlier
automatic redirect so a gallery token can be validated before any permanent response.

Five constraints define it, and each is enforced rather than documented:

1. **O(1) and nothing more.** No content reads, adapter calls, secrets, or `await`. An
   ordinary request copies two bounded facts. A trailing-slash request additionally reads
   the cached locale route configuration to distinguish a possible story path from an
   ordinary route; it does not resolve the path or gallery.
2. **The pathname, and one bit — never the token.** A continuation token is a signed value
   whose only legitimate reader is the gallery adapter; copying it into a header would
   spread it across a layer with no business holding it. What the 404 needs is not the
   token but the first gate on the *reason*: without a cursor this cannot be the
   invalid-continuation case. So the Proxy carries presence (`1`, or the header absent) and
   nothing else. The 404 then resolves the path and verifies both the content page and the
   parameter-free gallery result; presence alone never proves a destination works.
3. **No secrets.** The cursor signing key is server-only and lazily resolved. Nothing here
   touches it, and the Proxy runtime never needs it.
4. **Unconditional overwrite.** `Headers.set` replaces any client-supplied value of that
   name. The reader validates the value again anyway — as an absolute, same-origin,
   single-line, bounded path — because paths the matcher excludes never pass through the
   Proxy at all, and a header is untrusted input in its own right.
5. **A narrow matcher.** `_next/*` and every path carrying a file extension are excluded.
   API routes remain matched only so the Proxy can preserve Next.js's former trailing-slash
   308 after the global automatic redirect is disabled; ordinary API requests pass through
   without either project header.

The 404 boundary for the public content space (`ContentRouteNotFound`) reads both headers
and offers a link only when a cursor was refused **and** the path resolves — through the
*same* resolver the route itself uses — to a gallery whose content page and parameter-free
result are both served. It may follow one resolver-owned canonical redirect so casing,
redundant-prefix, trailing-slash, and retired-path spellings still get the required link.
An unknown address, or a gallery that failed for any other reason, keeps the bare 404: a
guessed destination would lead from one 404 to another.

For trailing slashes, Proxy restores the ordinary direct 308 itself on non-story routes.
A possible story path reaches the route with the original bounded pathname in the header.
The resolver treats the slash as one more normalization defect: a valid gallery cursor is
carried unchanged to the direct canonical destination, an invalid one 404s before a
redirect, and a path with casing or prefix defects collapses them in the same hop.

`RouteNotFound` — the static route spaces' 404 — is deliberately left alone. Reading
`headers()` is a dynamic API, and a boundary that reads one opts every route beneath it
out of static rendering; confining it to the content routes, which are already dynamic
because they read `searchParams`, keeps `/`, `/contact`, `/services`, and
`/services/[slug]` prerendered. That was measured, not assumed: a shared header-reading
404 turned all four dynamic in the build output.

## Options considered

| Option | Verdict |
| --- | --- |
| **Proxy sets a request header** | **Chosen.** Server-rendered, no client dependency, one small file, and the reader can verify the path against the content tree. |
| Per-request `React.cache()` handoff | Rejected — verified not to work: the boundary renders before the page. |
| Client component using `usePathname`/`useSearchParams` | Rejected. The link would depend on JavaScript, which is the opposite of what continuation is built for, `useSearchParams` forces a client bailout on every 404, and the path is not verified, so it can link to another 404. |
| Amend ADR-0003 to drop the requirement | Rejected. A stale indexed continuation URL is exactly the case the requirement exists for. |
| Proxy carrying the query as well | Rejected. It would put a signed cursor into a header read by a layer that must not interpret one. Presence is the only query fact the 404 needs before it independently verifies the destination. |
| Offering the link on any resolvable gallery path | Rejected. A gallery whose content failed to load would then link back to the address that just failed. |
| Keep Next.js's automatic trailing-slash redirect | Rejected. It runs before the route can validate a cursor, so a malformed token would create a cached 308 in direct conflict with ADR-0003 decision 8. |

## Consequences

- The project has a Proxy. Anything added to it later is paid on every matched request,
  and this ADR is the record that it is meant to stay O(1). Route decisions, content
  lookups, authentication, and personalization do not belong there.
- Both header names are project-owned and are overwritten, never merged. Reading either
  anywhere else means going through `readRequestPath` / `readRequestHasCursor`, which
  validate — the flag by exact match, so a client's own guess never becomes a link.
- Running Proxy is now part of the routing contract. Without it the 404 loses its request
  facts and, because Next.js's automatic trailing-slash redirect is disabled, slash
  variants are no longer normalized. A deployment that cannot run Proxy is unsupported.
- The static route spaces stay statically rendered. A future need for the header outside
  the content routes has to weigh that cost again.

## Known limitation

**404 responses deliver their semantic UI as RSC payload, not as initially rendered HTML,
so the link cannot be seen without JavaScript.** Every tested 404 on this site returns
Next's internal `__next_error__` document. Its body contains a hidden placeholder and
scripts carrying the flight payload, but no rendered heading or link; the `404` and this
return link appear only after that payload is applied.

This is not caused by continuation, and it is not caused by anything this ADR adds:
verified on `main` before this branch, where `/`-level, `/services/*`, and content-tree
404s all behave identically.

Four candidate explanations were explored against production builds:

| Hypothesis | Test | Result |
| --- | --- | --- |
| Multiple root layouts (`(default)`, `[localePrefix]`) leave no document to render into | Collapsed to one root `layout.tsx`, segment layouts reduced to fragments | Unchanged |
| No root-level `not-found.tsx` for the synthetic `/_not-found` entry | Added `src/app/not-found.tsx` | Unchanged |
| `global-not-found.tsx` is the sanctioned fix for multiple root layouts | Added the file and `experimental.globalNotFound: true` | No effect on tested URLs. The app's optional catch-all route matches unknown public paths, so this does not test `global-not-found`'s unmatched-route case. |
| Turbopack-specific | Rebuilt with `next build --webpack` | Unchanged |

The observed behavior is therefore unresolved in this Next.js 16.2.11 application; the
experiments narrow it but do not establish a framework root cause. Resolving it needs a
minimal reproduction, comparison with a newer Next.js release, and then either an upstream
issue or a project mechanism that does not rely on this `notFound()` rendering path. That
investigation is separate from gallery continuation.

**2026-09-03: still reproduces on Next.js 16.3.2.** AB#117 bumped the framework as part of
its dependency remediation, so the "comparison with a newer release" was worth performing
directly. A plain `curl` of an unknown path against a production build — `next build` then
`next start`, no browser and no JavaScript at any point — returns
`<html id="__next_error__">` with no `<h1>` anywhere in the initially rendered HTML. One
version step is not the full comparison this record asks for, and it establishes no root
cause; what it does establish is that the limitation is not already fixed, so nothing here
is retired.

AB#132 owns that investigation and is `Active`. It was briefly closed and reopened on
2026-09-03, because none of its own "Done when" conditions held: the semantic 404 HTML
above, the removal of the continuation journeys' JavaScript-enabled exception, and an
updated or retired limitation here. Until it lands, the continuation journey covers the link
with JavaScript enabled and says why at the point it does. The link itself is server-rendered — a Server Component reading a
request header, with no client code involved — so it needs no change when the framework
behaviour does.

## Action items

- [x] `src/proxy.ts` with the bounded copy, the unconditional overwrite, and a narrow matcher
- [x] `src/lib/request-path.ts` owning the header name, the bound, and the validation
- [x] `ContentRouteNotFound` resolving the path through the route resolver
- [x] Tests: path validation including protocol-relative and backslash forms, served
      return-link resolution through canonical normalization, cursor-aware trailing-slash
      behavior, and a journey proving spoofed headers cannot choose the target
- [x] A work item for the non-semantic initial 404 document: **AB#132**, which carries the
      ruled-out experiments above. Start with a minimal reproduction, check a newer
      release, and open an upstream issue if it still holds. Retiring the limitation below
      also retires the JavaScript-enabled exception in the continuation journey.
