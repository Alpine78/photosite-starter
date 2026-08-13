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
project-owned request headers, on the routes that can render a content 404.

Five constraints define it, and each is enforced rather than documented:

1. **O(1) and nothing more.** No content reads, no configuration parsing, no adapter
   calls, no `await`. Deciding whether a path is a published gallery is the 404's job, on
   the rare 404 — not this one's, on every request.
2. **The pathname, and one bit — never the token.** A continuation token is a signed value
   whose only legitimate reader is the gallery adapter; copying it into a header would
   spread it across a layer with no business holding it. What the 404 needs is not the
   token but the *reason*: a resolvable gallery path can 404 because its cursor was
   refused, or because the content behind it could not be read, and only the first has a
   first page worth offering. So the Proxy carries presence (`1`, or the header absent) and
   nothing else. Without that bit, a gallery whose content failed would be handed a link
   straight back to the address that just failed.
3. **No secrets.** The cursor signing key is server-only and lazily resolved. Nothing here
   touches it, and the Proxy runtime never needs it.
4. **Unconditional overwrite.** `Headers.set` replaces any client-supplied value of that
   name. The reader validates the value again anyway — as an absolute, same-origin,
   single-line, bounded path — because paths the matcher excludes never pass through the
   Proxy at all, and a header is untrusted input in its own right.
5. **A narrow matcher.** API routes, `_next/*`, and every path carrying a file extension
   are excluded. None of them renders the not-found boundary and every one of them would
   only pay the cost.

The 404 boundary for the public content space (`ContentRouteNotFound`) reads both headers
and offers a link only when a cursor was refused **and** the path resolves — through the
*same* resolver the route itself uses — to a published gallery. An unknown address, or a
gallery that failed for any other reason, keeps the bare 404: a guessed destination would
lead from one 404 to another.

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
| Proxy carrying the query as well | Rejected. It would put a signed cursor into a header read by a layer that must not interpret one. Carrying presence as one bit gives the 404 the only thing it actually needs. |
| Offering the link on any resolvable gallery path | Rejected. A gallery whose content failed to load would then link back to the address that just failed. |

## Consequences

- The project has a Proxy. Anything added to it later is paid on every matched request,
  and this ADR is the record that it is meant to stay O(1). Route decisions, content
  lookups, authentication, and personalization do not belong there.
- Both header names are project-owned and are overwritten, never merged. Reading either
  anywhere else means going through `readRequestPath` / `readRequestHasCursor`, which
  validate — the flag by exact match, so a client's own guess never becomes a link.
- A deployment platform that does not run the Proxy loses the 404 link and nothing else:
  the reader sees no header and the boundary renders exactly as it did before.
- The static route spaces stay statically rendered. A future need for the header outside
  the content routes has to weigh that cost again.

## Known limitation

**404 responses deliver their UI as RSC payload, not as server-rendered HTML, so the link
cannot be seen without JavaScript.** Every 404 on this site returns Next's internal
`__next_error__` document with a 53-character body containing no heading — not the bare
`404`, and not this link. The content is present, but only in the flight payload.

This is not caused by continuation, and it is not caused by anything this ADR adds:
verified on `main` before this branch, where `/`-level, `/services/*`, and content-tree
404s all behave identically.

Four candidate causes were tested against production builds and **all four ruled out**:

| Hypothesis | Test | Result |
| --- | --- | --- |
| Multiple root layouts (`(default)`, `[localePrefix]`) leave no document to render into | Collapsed to one root `layout.tsx`, segment layouts reduced to fragments | Unchanged |
| No root-level `not-found.tsx` for the synthetic `/_not-found` entry | Added `src/app/not-found.tsx` | Unchanged |
| `global-not-found.tsx` is the sanctioned fix for multiple root layouts | Added the file and `experimental.globalNotFound: true` | No effect, including on a fully unmatched URL |
| Turbopack-specific | Rebuilt with `next build --webpack` | Unchanged |

So it is a framework-level behaviour of Next.js 16.2.11 in this application's shape rather
than a structural mistake this project can correct by rearranging its own files. Resolving
it needs a Next.js issue, a version change, or serving that particular 404 through a
mechanism that does not rely on `notFound()` — all of which are their own work, and none of
which belongs inside a gallery story.

Until then the continuation journey covers the link with JavaScript enabled and says why at
the point it does. The link itself is server-rendered — a Server Component reading a
request header, with no client code involved — so it needs no change when the framework
behaviour does.

## Action items

- [x] `src/proxy.ts` with the bounded copy, the unconditional overwrite, and a narrow matcher
- [x] `src/lib/request-path.ts` owning the header name, the bound, and the validation
- [x] `ContentRouteNotFound` resolving the path through the route resolver
- [x] Tests: path validation including protocol-relative and backslash forms, return-link
      resolution, and a journey proving a spoofed header cannot choose the target
- [ ] A work item for the empty 404 document. The four structural fixes above are ruled
      out, so it starts as a Next.js investigation: reproduce on a minimal app, check
      against a newer release, and open an upstream issue if it still holds.
