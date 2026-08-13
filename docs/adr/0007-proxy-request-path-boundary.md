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

Add `src/proxy.ts`. It does exactly one thing: copy the requested pathname into
`x-photosite-request-path`, a project-owned request header, on the routes that can render
a content 404.

Five constraints define it, and each is enforced rather than documented:

1. **O(1) and nothing more.** No content reads, no configuration parsing, no adapter
   calls, no `await`. Deciding whether a path is a published gallery is the 404's job, on
   the rare 404 — not this one's, on every request.
2. **The pathname only.** No query string and therefore no cursor. A continuation token is
   a signed value whose only legitimate reader is the gallery adapter; copying it into a
   header would spread it across a layer with no business holding it. The 404 does not
   need it either — the pathname alone names the gallery, and a *resolvable* gallery path
   only 404s because its cursor was refused.
3. **No secrets.** The cursor signing key is server-only and lazily resolved. Nothing here
   touches it, and the Proxy runtime never needs it.
4. **Unconditional overwrite.** `Headers.set` replaces any client-supplied value of that
   name. The reader validates the value again anyway — as an absolute, same-origin,
   single-line, bounded path — because paths the matcher excludes never pass through the
   Proxy at all, and a header is untrusted input in its own right.
5. **A narrow matcher.** API routes, `_next/*`, and every path carrying a file extension
   are excluded. None of them renders the not-found boundary and every one of them would
   only pay the cost.

The 404 boundary for the public content space (`ContentRouteNotFound`) reads the header,
resolves the path through the *same* resolver the route itself uses, and offers a link
only when it identifies a published gallery. An unknown address keeps the bare 404: a
guessed destination would lead from one 404 to another.

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
| Proxy carrying the query as well | Rejected. It would put a signed cursor into a header read by a layer that must not interpret one, for no gain: the pathname is sufficient. |

## Consequences

- The project has a Proxy. Anything added to it later is paid on every matched request,
  and this ADR is the record that it is meant to stay O(1). Route decisions, content
  lookups, authentication, and personalization do not belong there.
- `x-photosite-request-path` is a project-owned name and is overwritten, never merged.
  Reading it anywhere else means re-reading it through `readRequestPath`, which validates.
- A deployment platform that does not run the Proxy loses the 404 link and nothing else:
  the reader sees no header and the boundary renders exactly as it did before.
- The static route spaces stay statically rendered. A future need for the header outside
  the content routes has to weigh that cost again.

## Known limitation

**404 documents render no HTML body without JavaScript, and the link inherits that.** This
application has no root `src/app/layout.tsx` — both layouts sit inside segments (the
`(default)` group and `[localePrefix]`) — so Next.js falls back to its internal
`__next_error__` document for a 404. Its body is empty; the entire 404 UI, including the
bare `404` heading, arrives only in the RSC payload.

This is site-wide and predates continuation: verified on `main`, where `/`-level,
`/services/*`, and content-tree 404s all serve a 53-character body containing no heading.
It is therefore not a consequence of this ADR, but it does bound it — the link is produced
by a Server Component with no client code involved, and still cannot be seen without
JavaScript.

Fixing it means giving the app a root layout or adopting Next.js 16's
`global-not-found.tsx`, which restructures the layout tree and belongs to its own work
item. Until then the continuation journey tests cover the link with JavaScript enabled and
say why at the point they do it.

## Action items

- [x] `src/proxy.ts` with the bounded copy, the unconditional overwrite, and a narrow matcher
- [x] `src/lib/request-path.ts` owning the header name, the bound, and the validation
- [x] `ContentRouteNotFound` resolving the path through the route resolver
- [x] Tests: path validation including protocol-relative and backslash forms, return-link
      resolution, and a journey proving a spoofed header cannot choose the target
- [ ] A work item for the empty 404 document (root layout or `global-not-found.tsx`)
